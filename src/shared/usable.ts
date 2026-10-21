import type { OmniRouteEnrichmentMap } from "./enrich.js";
import type { OmniRouteRawCombo } from "./combos-map.js";

/** Subset of `/api/providers` connections read by the usableOnly filter. */
export interface OmniRouteProviderConnection {
  /** Connection UUID. */
  id: string;
  /** Canonical provider id, e.g. `claude`, `gemini`, `kiro`. */
  provider: string;
  /** Operator toggle — when false, the connection is provisioned but disabled. */
  isActive?: boolean;
  /** Health-check verdict — `active` means routable. */
  testStatus?: string;
  /** Permissive bag — additional fields pass through untouched. */
  [k: string]: unknown;
}

export type OmniRouteProvidersFetcher = (
  baseURL: string,
  apiKey: string,
  timeoutMs?: number,
  onSourceError?: (endpoint: string, reason: string) => void
) => Promise<OmniRouteProviderConnection[]>;

export interface UsableProviderSet {
  aliases: Set<string>;
  canonicals: Set<string>;
  knownAliases: Set<string>;
}

/**
 * Default providers fetcher: `GET <baseURL>/api/providers` with bearer auth
 * + AbortController timeout. Accepts the `{ connections: [...] }` envelope
 * the gateway emits today, a bare-array envelope, and a `{ data: [...] }`
 * envelope (defensive). Refusals and network errors THROW so the caller keeps
 * last-known instead of silently disabling the filter; a 2xx with an empty
 * list is the only empty answer.
 */
export const defaultOmniRouteProvidersFetcher: OmniRouteProvidersFetcher = async (
  baseURL,
  apiKey,
  timeoutMs = 10_000,
  onSourceError
) => {
  const empty: OmniRouteProviderConnection[] = [];
  if (!baseURL || !apiKey) return empty;
  const root = baseURL.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const url = `${root}/api/providers`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: ac.signal,
    });
    if (!res.ok) {
      // A refusal (403 behind a management-token gate, 503 mid-outage) is a
      // failure, not an empty allowlist: the caller keeps last-known instead
      // of silently disabling the filter.
      onSourceError?.("/api/providers", `HTTP ${res.status}`);
      throw new Error(`HTTP ${res.status}`);
    }
    const body = (await res.json()) as unknown;
    const list = Array.isArray(body)
      ? body
      : Array.isArray((body as { connections?: unknown[] })?.connections)
        ? (body as { connections: unknown[] }).connections
        : Array.isArray((body as { data?: unknown[] })?.data)
          ? (body as { data: unknown[] }).data
          : [];
    const out: OmniRouteProviderConnection[] = [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const provider = (raw as { provider?: unknown }).provider;
      if (typeof provider !== "string" || provider.length === 0) continue;
      const id = (raw as { id?: unknown }).id;
      const idStr = typeof id === "string" && id.length > 0 ? id : provider;
      out.push({ ...(raw as Record<string, unknown>), id: idStr, provider });
    }
    return out;
  } catch (err) {
    // Network error, timeout, abort: keep last-known, never silently unfilter.
    onSourceError?.("/api/providers", err instanceof Error ? err.message : String(err));
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Compute the provider prefixes safe to keep. A canonical provider is usable
 * when at least one connection is not explicitly disabled (`isActive: false`)
 * and has no failing health verdict (`testStatus` present and not "active"). Aliases (e.g. `cc` -> `claude`) resolve through the enrichment
 * map, which records every alias in `knownAliases` so the downstream filter
 * decides "this prefix was in /api/pricing/models" in O(1).
 *
 * Subtract-filter semantics: callers keep prefixes unknown to BOTH tables.
 */
export function usableProviderAliasSet(
  connections: OmniRouteProviderConnection[],
  enrichment: OmniRouteEnrichmentMap | undefined
): UsableProviderSet {
  const usableCanonicals = new Set<string>();
  const aliases = new Set<string>();
  const knownAliases = new Set<string>();
  // `providerSpecificData.prefix` is the public prefix a compatible provider
  // node is served under, and the only spelling that matches `/v1/models` when
  // no pricing slot describes the connection. Track it for every connection so
  // an explicitly disabled one can be dropped, not just the usable ones.
  const prefixUsable = new Map<string, boolean>();

  for (const c of connections) {
    if (!c) continue;
    // A missing toggle means "no opinion", not "disabled": the field only
    // exists on newer gateways, and treating its absence as a veto would hide
    // every model behind a filter the operator never asked to tighten. Only an
    // explicit `false` disables.
    const usable = c.isActive !== false && !(typeof c.testStatus === "string" && c.testStatus !== "active");
    if (usable && typeof c.provider === "string" && c.provider.length > 0) {
      usableCanonicals.add(c.provider);
    }
    const data = c.providerSpecificData;
    if (data !== null && typeof data === "object") {
      const prefix = (data as { prefix?: unknown }).prefix;
      if (typeof prefix === "string" && prefix.trim().length > 0) {
        const trimmed = prefix.trim();
        prefixUsable.set(trimmed, (prefixUsable.get(trimmed) ?? false) || usable);
      }
    }
  }

  if (enrichment) {
    for (const entry of enrichment.values()) {
      const alias = entry.providerAlias;
      const canonical = entry.providerCanonical;
      if (typeof alias !== "string" || alias.length === 0) continue;
      knownAliases.add(alias);
      if (typeof canonical !== "string" || canonical.length === 0) continue;
      if (usableCanonicals.has(canonical)) aliases.add(alias);
    }
  }
  for (const canonical of usableCanonicals) aliases.add(canonical);
  for (const [prefix, usable] of prefixUsable) {
    knownAliases.add(prefix);
    if (usable) aliases.add(prefix);
  }
  return { aliases, canonicals: usableCanonicals, knownAliases };
}

/**
 * Whether `prefix` names a provider the gateway described, in any spelling it
 * uses for it (public prefix, display prefix, or canonical node id).
 */
function resolvesTo(usable: UsableProviderSet, prefix: string): boolean {
  return usable.aliases.has(prefix) || usable.canonicals.has(prefix);
}

/**
 * Decide whether a raw `/v1/models` id passes the usableOnly filter.
 *
 * Three states, subtract-filter, biased toward keep:
 *   - no `/` (bare id)                         -> keep
 *   - resolves to a usable provider            -> keep
 *   - unknown to every table                   -> keep (cannot prove unroutable)
 *   - resolves to a known, unusable provider   -> drop
 */
export function isUsableRawModelId(id: string, usable: UsableProviderSet): boolean {
  const slash = id.indexOf("/");
  if (slash <= 0) return true;
  const prefix = id.slice(0, slash);
  if (resolvesTo(usable, prefix)) return true;
  if (usable.knownAliases.has(prefix)) return false;
  return true;
}

/**
 * Decide whether a combo passes the usableOnly filter. A combo keeps when AT
 * LEAST ONE member maps to a usable provider or to a provider nobody
 * described; it drops only when every resolvable member is known-unusable.
 * Combos with zero resolvable members keep.
 */
export function isUsableCombo(combo: OmniRouteRawCombo, usable: UsableProviderSet): boolean {
  const steps = Array.isArray(combo.models) ? combo.models : [];
  if (steps.length === 0) return true;
  let sawResolvableMember = false;
  for (const step of steps) {
    if (step?.kind === "combo-ref") continue;
    const modelId = typeof step?.model === "string" ? step.model : "";
    const slash = modelId.indexOf("/");
    if (slash <= 0) continue;
    sawResolvableMember = true;
    const prefix = modelId.slice(0, slash);
    if (resolvesTo(usable, prefix)) return true;
    if (!usable.knownAliases.has(prefix)) return true;
  }
  if (!sawResolvableMember) return true;
  return false;
}
