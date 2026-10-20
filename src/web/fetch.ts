/**
 * OmniRoute-backed replacement for OpenCode's built-in `webfetch`.
 *
 * A V2 tool transform can register a later tool with the same effective name,
 * and the host's tool map uses replacement semantics. That is the only way to
 * route fetch through the gateway, because OpenCode has no web-fetch provider
 * domain.
 *
 * Replacing a built-in tool means owning its contract:
 *   - input/output shape stays `{url, format, timeout?}` → `{url, contentType,
 *     format, output}`;
 *   - the native `webfetch` permission action is asserted with the URL as its
 *     resource, before any network call;
 *   - cancellation and a bounded timeout are honoured;
 *   - on gateway failure the captured native tool runs instead, so a gateway
 *     outage degrades the feature rather than removing the capability.
 */
import { z } from "zod";
import type { ToolEditor } from "@opencode/plugin/promise/tool";
import type { Logger } from "../shared/logger.js";
import type { ResolvedWebOptions } from "../options.js";
import { OmniRouteWebClient, OmniRouteWebError } from "./client.js";

export const WEBFETCH_TOOL_NAME = "webfetch";

/** Native input contract, mirrored so the model sees no difference. */
export const webFetchInput = z.object({
  url: z.string().describe("The HTTP or HTTPS URL to fetch content from"),
  format: z
    .enum(["text", "markdown", "html"])
    .default("markdown")
    .describe("The format to return the content in. Defaults to markdown."),
  timeout: z
    .number()
    .positive()
    .max(120)
    .optional()
    .describe("Optional timeout in seconds (maximum: 120)."),
});

/** Native output contract. */
export const webFetchOutput = z.object({
  url: z.string(),
  contentType: z.string(),
  format: z.enum(["text", "markdown", "html"]),
  output: z.string(),
});

type WebFetchInput = z.infer<typeof webFetchInput>;
type WebFetchOutput = z.infer<typeof webFetchOutput>;

export const WEBFETCH_DESCRIPTION = `Fetch content from an HTTP or HTTPS URL and return it as text, markdown, or HTML. Markdown is the default.

Use a more targeted tool when one is available. This tool is read-only. Large text results may be replaced with a preview while the complete output is retained in managed storage.`;

/** How the gateway format maps from the native one. */
function gatewayFormat(format: WebFetchInput["format"]): "markdown" | "html" {
  // The gateway serves `markdown|html|links|screenshot`. Native `text` has no
  // equivalent, so it requests markdown and keeps `text` in the output shape:
  // the caller asked for prose, and markdown is prose with markup.
  return format === "html" ? "html" : "markdown";
}

function contentTypeFor(format: WebFetchInput["format"]): string {
  if (format === "html") return "text/html";
  if (format === "text") return "text/plain";
  return "text/markdown";
}

/** The subset of `ctx.tool` and `ctx.permission` this module touches. */
export interface ToolHost {
  tool: {
    transform(callback: (editor: ToolEditor) => void): Promise<unknown>;
  };
  permission: {
    assert(input: {
      action: string;
      resources: readonly string[];
      save: readonly string[];
      metadata?: Record<string, unknown>;
      sessionID: string;
      agent?: string;
      source?: { type: "tool"; messageID: string; id: string };
    }): Promise<void>;
  };
}

export interface FetchRegistration {
  registered: boolean;
  reason?: string;
  /** Whether a native implementation was found to fall back to. */
  nativeAvailable: boolean;
}

/**
 * Register the replacement when `web.fetch.enabled` is true.
 *
 * The native tool is read from the editor inside the same transform, before
 * the replacement is added, so the fallback is the host's own implementation
 * rather than a copy of it.
 */
export async function registerWebFetch(
  host: ToolHost,
  client: OmniRouteWebClient,
  options: ResolvedWebOptions,
  log: Pick<Logger, "warn" | "debug">
): Promise<FetchRegistration> {
  if (!options.fetch.enabled) return { registered: false, reason: "disabled", nativeAvailable: false };
  if (!client.usable) {
    log.warn(
      `[oc-omniroute] web.fetch is enabled but baseURL/apiKey is missing; webfetch stays on OpenCode's built-in tool.`
    );
    return { registered: false, reason: "missing-credentials", nativeAvailable: false };
  }

  let nativeAvailable = false;

  await host.tool.transform((editor) => {
    const native = editor.get(WEBFETCH_TOOL_NAME);
    nativeAvailable = native !== undefined;

    editor.add({
      name: WEBFETCH_TOOL_NAME,
      description: WEBFETCH_DESCRIPTION,
      input: webFetchInput,
      output: webFetchOutput,
      // `codemode: false` matches the built-in: webfetch is a direct tool, not
      // something the code-mode sandbox calls on the model's behalf.
      options: { codemode: false },
      execute: async (input, context) => {
        // Permission first, and identical to the built-in assertion: a denial
        // must never be turned into a gateway request, and the fallback must
        // not become a way around it.
        await host.permission.assert({
          action: WEBFETCH_TOOL_NAME,
          resources: [input.url],
          save: ["*"],
          metadata: input,
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool", messageID: context.messageID, id: context.id },
        });

        const seconds = Math.min(Math.max(input.timeout ?? options.timeoutMs / 1000, 1), 120);
        const timeoutMs = Math.round(seconds * 1000);

        try {
          const response = await client.fetch(
            {
              url: input.url,
              format: gatewayFormat(input.format),
              includeMetadata: options.fetch.includeMetadata,
              timeoutSeconds: seconds,
            },
            context.signal
          );
          const result: WebFetchOutput = {
            url: response.url,
            contentType: contentTypeFor(input.format),
            format: input.format,
            output: response.content,
          };
          return {
            output: result,
            content: result.output,
            metadata: {
              contentType: result.contentType,
              ...(response.provider !== undefined ? { provider: response.provider } : {}),
            },
          };
        } catch (err) {
          // A cancelled turn is not a gateway failure: rethrow so the host
          // stops the step instead of quietly fetching through another path.
          if (err instanceof OmniRouteWebError && err.aborted) throw err;
          const reason = err instanceof Error ? err.message : String(err);
          if (!options.fetch.fallbackToNative || native === undefined) {
            throw new Error(`Unable to fetch ${input.url}: ${reason}`);
          }
          log.debug(`[oc-omniroute] webfetch gateway path failed (${reason}); using the native tool`);
          return native.execute(input, context);
        }
      },
    });
  });

  return { registered: true, nativeAvailable };
}
