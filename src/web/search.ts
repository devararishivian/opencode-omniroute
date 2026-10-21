/**
 * OmniRoute as an OpenCode web-search provider.
 *
 * Registers through `ctx.websearch.transform`, which exposes the host's
 * websearch domain: `add({id, name, execute})` plus `default.set(id)`. The
 * provider is only added when the user enabled `web.search`, and enabling it
 * also selects it — that selection is the explicit opt-in.
 */
import type { WebSearchDefinition } from "@opencode/plugin/promise/websearch";
import type { Logger } from "../shared/logger.js";
import type { ResolvedWebOptions } from "../options.js";
import { OmniRouteWebClient, OmniRouteWebError } from "./client.js";

/** The subset of the host websearch editor this module touches. */
interface WebSearchEditor {
  add(definition: WebSearchDefinition): void;
  readonly default: {
    get(): string | false | undefined;
    set(selection: string | false): void;
  };
}

/** The subset of `ctx.websearch` this module touches. */
export interface WebSearchHost {
  transform(callback: (editor: WebSearchEditor) => void): Promise<unknown>;
}

/** One result in the shape OpenCode's `WebSearch.Result` requires. */
export interface OpenCodeSearchResult {
  url: string;
  title?: string;
  content?: string;
  /** Required by the schema; `published` is optional inside it. */
  time: { published?: number };
}

/**
 * Convert the gateway's search response to OpenCode results.
 *
 * `time` is always present because the host schema requires the object, not
 * just the field. A timestamp the gateway did not supply is simply absent
 * rather than invented.
 */
export function toOpenCodeResults(
  results: readonly {
    url: string;
    title?: string;
    snippet?: string;
    content?: string;
    publishedAt?: string;
  }[],
  maxResults: number
): OpenCodeSearchResult[] {
  const out: OpenCodeSearchResult[] = [];
  for (const row of results) {
    if (out.length >= maxResults) break;
    const published = row.publishedAt !== undefined ? Date.parse(row.publishedAt) : Number.NaN;
    const rawContent = typeof row.content === "string" ? row.content.trim() : "";
    const rawSnippet = typeof row.snippet === "string" ? row.snippet.trim() : "";
    const content =
      rawContent.length > 0 ? row.content : rawSnippet.length > 0 ? row.snippet : undefined;
    out.push({
      url: row.url,
      ...(row.title !== undefined ? { title: row.title } : {}),
      ...(content !== undefined ? { content } : {}),
      time: Number.isNaN(published) ? {} : { published },
    });
  }
  return out;
}

export interface SearchRegistration {
  /** Whether a provider was registered. */
  registered: boolean;
  /** Why it was not, for the caller's single diagnostic line. */
  reason?: string;
}

/**
 * Register the OmniRoute search provider when `web.search.enabled` is true.
 *
 * The provider id is the configured provider id, so a second gateway in the
 * same config registers under its own id instead of colliding.
 */
export async function registerWebSearch(
  host: WebSearchHost,
  client: OmniRouteWebClient,
  options: ResolvedWebOptions,
  providerId: string,
  displayName: string,
  log: Pick<Logger, "warn">
): Promise<SearchRegistration> {
  if (!options.search.enabled) return { registered: false, reason: "disabled" };
  if (!client.usable) {
    log.warn(
      `[oc-omniroute] web.search is enabled but baseURL/apiKey is missing; search stays on OpenCode's own provider.`
    );
    return { registered: false, reason: "missing-credentials" };
  }

  const definition: WebSearchDefinition = {
    id: providerId,
    name: displayName,
    execute: async (input: { query: string }, context: { readonly signal: AbortSignal }) => {
      try {
        const response = await client.search(
          { query: input.query, maxResults: options.search.maxResults },
          context.signal
        );
        return toOpenCodeResults(response.results, options.search.maxResults);
      } catch (err) {
        // The host turns a rejection into a tool failure; the message must be
        // safe to show, which OmniRouteWebError already guarantees.
        throw err instanceof OmniRouteWebError ? err : new Error("OmniRoute search failed");
      }
    },
  };

  await host.transform((editor) => {
    editor.add(definition);
    // Enabling the feature is the opt-in, so it also becomes the selection.
    editor.default.set(providerId);
  });
  return { registered: true };
}
