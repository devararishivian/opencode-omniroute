/**
 * Authenticated transport for the two OmniRoute REST endpoints the web tools
 * use. Kept transport-only: no mapping to OpenCode shapes, no retries, no
 * provider routing. OmniRoute owns failover when the request omits a provider.
 */
import type { Logger } from "../shared/logger.js";
import { ensureV1Suffix, isHttpUrl } from "../shared/models-map.js";

/** One row of a `/v1/search` response, already narrowed to what we trust. */
export interface OmniRouteSearchResult {
  title?: string;
  url: string;
  snippet?: string;
  content?: string;
  publishedAt?: string;
}

export interface OmniRouteSearchResponse {
  provider?: string;
  results: OmniRouteSearchResult[];
}

export interface OmniRouteFetchResponse {
  provider?: string;
  url: string;
  content: string;
  metadata?: { title?: string | null; description?: string | null };
}

export type WebFetchFormat = "markdown" | "html";

export interface WebClientConfig {
  baseURL: string;
  apiKey: string;
  timeoutMs: number;
  logger?: Pick<Logger, "debug" | "warn">;
}

/**
 * A failure the caller may surface to the model. `status` is the gateway's
 * HTTP status when there was one; `aborted` marks a caller cancellation so a
 * fallback path does not mask it.
 */
export class OmniRouteWebError extends Error {
  readonly status?: number;
  readonly aborted: boolean;

  constructor(message: string, options: { status?: number; aborted?: boolean } = {}) {
    super(message);
    this.name = "OmniRouteWebError";
    if (options.status !== undefined) this.status = options.status;
    this.aborted = options.aborted === true;
  }
}

/** Trim trailing slashes without a backtracking regex on user input. */
function trimSlashes(value: string): string {
  let i = value.length;
  while (i > 0 && value.charCodeAt(i - 1) === 0x2f) i--;
  return i === value.length ? value : value.slice(0, i);
}

/**
 * Resolve an endpoint URL, tolerating a `baseURL` that already ends in `/v1`.
 * `ensureV1Suffix` keeps the two forms from producing `/v1/v1/search`.
 */
export function webEndpoint(baseURL: string, path: "/v1/search" | "/v1/web/fetch"): string {
  const withV1 = ensureV1Suffix(trimSlashes(baseURL));
  return `${withV1}${path.slice(3)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Read a gateway error body without ever echoing it verbatim. */
function gatewayReason(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const error = body.error;
  if (isRecord(error)) return nonEmptyString(error.message);
  if (typeof error === "string") return nonEmptyString(error);
  return nonEmptyString(body.message);
}

export class OmniRouteWebClient {
  private readonly config: WebClientConfig;

  constructor(config: WebClientConfig) {
    this.config = config;
  }

  /** Whether the client has everything it needs to issue a request. */
  get usable(): boolean {
    return isHttpUrl(this.config.baseURL) && this.config.apiKey.length > 0;
  }

  /**
   * `POST /v1/search`. `provider` is never sent: OmniRoute selects and fails
   * over between the search providers its operator configured.
   */
  async search(
    input: { query: string; maxResults: number },
    signal?: AbortSignal
  ): Promise<OmniRouteSearchResponse> {
    const body = {
      query: input.query,
      max_results: input.maxResults,
      search_type: "web",
    };
    const payload = await this.post("/v1/search", body, signal);
    if (!isRecord(payload)) throw new OmniRouteWebError("search response was not an object");
    const results = Array.isArray(payload.results) ? payload.results : [];
    const out: OmniRouteSearchResult[] = [];
    for (const row of results) {
      if (!isRecord(row)) continue;
      const url = nonEmptyString(row.url);
      // A result without a URL is not citable, so it is not returned.
      if (url === undefined) continue;
      const content = isRecord(row.content) ? nonEmptyString(row.content.text) : undefined;
      out.push({
        url,
        ...(nonEmptyString(row.title) !== undefined ? { title: nonEmptyString(row.title) } : {}),
        ...(nonEmptyString(row.snippet) !== undefined
          ? { snippet: nonEmptyString(row.snippet) }
          : {}),
        ...(content !== undefined ? { content } : {}),
        ...(nonEmptyString(row.published_at) !== undefined
          ? { publishedAt: nonEmptyString(row.published_at) }
          : {}),
      });
    }
    const provider = nonEmptyString(payload.provider);
    return { ...(provider !== undefined ? { provider } : {}), results: out };
  }

  /**
   * `POST /v1/web/fetch`. `provider` is never sent, for the same reason as
   * search; `format` is limited to the two formats OpenCode's webfetch exposes
   * and the gateway actually serves as text.
   */
  async fetch(
    input: {
      url: string;
      format: WebFetchFormat;
      includeMetadata: boolean;
      timeoutSeconds?: number;
    },
    signal?: AbortSignal
  ): Promise<OmniRouteFetchResponse> {
    const body = {
      url: input.url,
      format: input.format,
      depth: 0,
      include_metadata: input.includeMetadata,
    };
    const payload = await this.post("/v1/web/fetch", body, signal);
    if (!isRecord(payload)) throw new OmniRouteWebError("fetch response was not an object");
    const content = typeof payload.content === "string" ? payload.content : undefined;
    if (content === undefined) throw new OmniRouteWebError("fetch response had no content");
    const url = nonEmptyString(payload.url) ?? input.url;
    const provider = nonEmptyString(payload.provider);
    const metadata = isRecord(payload.metadata)
      ? {
          ...(typeof payload.metadata.title === "string" ? { title: payload.metadata.title } : {}),
          ...(typeof payload.metadata.description === "string"
            ? { description: payload.metadata.description }
            : {}),
        }
      : undefined;
    return {
      url,
      content,
      ...(provider !== undefined ? { provider } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    };
  }

  private async post(
    path: "/v1/search" | "/v1/web/fetch",
    body: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<unknown> {
    if (!this.usable) {
      throw new OmniRouteWebError("OmniRoute baseURL or apiKey is missing");
    }
    const endpoint = webEndpoint(this.config.baseURL, path);
    // One deadline for the whole request, plus the caller's cancellation.
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (err) {
      // A caller cancellation is not a gateway failure: the caller decides
      // whether to fall back, and a cancelled turn must not keep working.
      if (signal?.aborted === true) {
        throw new OmniRouteWebError("request cancelled", { aborted: true });
      }
      if (timeout.aborted) {
        throw new OmniRouteWebError(`request timed out after ${this.config.timeoutMs}ms`);
      }
      const reason = err instanceof Error ? err.message : String(err);
      throw new OmniRouteWebError(`request failed: ${reason}`);
    }
    const text = await response.text().catch(() => "");
    let parsed: unknown;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (!response.ok) {
      const reason = gatewayReason(parsed);
      throw new OmniRouteWebError(
        `OmniRoute answered HTTP ${response.status}${reason !== undefined ? `: ${reason}` : ""}`,
        { status: response.status }
      );
    }
    if (parsed === undefined) {
      throw new OmniRouteWebError("OmniRoute answered with an empty or non-JSON body");
    }
    this.config.logger?.debug(`[oc-omniroute] ${path} ok`);
    return parsed;
  }
}
