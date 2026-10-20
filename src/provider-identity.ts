/**
 * Normalized provider identity.
 *
 * OmniRoute describes the same upstream connection in three places, each with
 * a different vocabulary:
 *
 *   /v1/models        id prefix (`openagentic/deepseek-v4-flash`)
 *   /api/providers    `provider` = node id (`openai-compatible-chat-<uuid>`),
 *                     `providerSpecificData.prefix` = the public prefix
 *   /api/pricing/models  slot key (often the node id) + `displayPrefix`
 *
 * Before this module the enrichment pass keyed everything by the pricing slot
 * key. A UUID-keyed slot therefore never matched the served prefix, every
 * lookup fell through to the bare-id fallback, and the model lost its provider
 * label and prices. This module builds one index that every downstream stage
 * (enrichment, pricing, display naming, `usableOnly`) reads, so the three
 * vocabularies cannot drift apart again.
 *
 * Precedence, in order:
 *   1. the served prefix (text before the first `/`), verbatim;
 *   2. a known alias — `providerSpecificData.prefix`, `displayPrefix`, or the
 *      pricing slot key — matched case-insensitively;
 *   3. `owned_by`, only when the served prefix is absent or unknown;
 *   4. unverified: the served prefix is its own label and no metadata is
 *      borrowed from an unrelated slot.
 *
 * Nested ids keep their first segment as the prefix (`no-think/openagentic/x`
 * is provider `no-think`); the module never reinterprets the rest.
 */
import type { OmniRouteEnrichmentEntry, OmniRouteEnrichmentMap } from "./shared/enrich.js";
import type { OmniRouteProviderConnection } from "./shared/usable.js";

/** Health verdict for one connection, as far as the gateway tells us. */
export type ProviderHealth = "active" | "unhealthy" | "unknown";

/** Routing state of the connection(s) behind one prefix. */
export type ProviderUsability = "usable" | "unusable" | "unknown";

export interface ProviderConnectionState {
  /** At least one connection claims this prefix. */
  configured: boolean;
  /** `false` only on an explicit operator disable. */
  active?: boolean;
  health: ProviderHealth;
}

export interface ProviderIdentity {
  /** Prefix as it appears in `/v1/models`, original spelling. */
  prefix: string;
  /** Canonical connection/node id when one is known. */
  canonical?: string;
  /** Human label for the prefix. Never a UUID-style node id. */
  label: string;
  /** Every spelling that resolves to this identity, lowercased. */
  aliases: ReadonlySet<string>;
  /** False when no gateway source claimed the prefix. */
  verified: boolean;
  /** Present when a connection claims the prefix. */
  state?: ProviderConnectionState;
}

export interface ProviderIdentityIndex {
  /** Lowercased prefix/alias → identity. */
  readonly byAlias: ReadonlyMap<string, ProviderIdentity>;
  /** Lowercased canonical/node id → identity. */
  readonly byCanonical: ReadonlyMap<string, ProviderIdentity>;
}

export interface ProviderIdentityInput {
  connections?: readonly OmniRouteProviderConnection[];
  enrichment?: OmniRouteEnrichmentMap;
}

/** A connection's public prefix, when it carries one. */
function connectionPrefix(connection: OmniRouteProviderConnection): string | undefined {
  const data = connection.providerSpecificData;
  if (data === undefined || data === null || typeof data !== "object") return undefined;
  const prefix = (data as { prefix?: unknown }).prefix;
  if (typeof prefix !== "string") return undefined;
  const trimmed = prefix.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Whether a spelling looks like a generated node id rather than a public
 * prefix. Those must never reach a model title.
 */
export function isGeneratedNodeId(value: string): boolean {
  return /^(?:openai|anthropic)-compatible-(?:chat|responses)-/i.test(value);
}

function stateOf(connection: OmniRouteProviderConnection): ProviderConnectionState {
  const active = connection.isActive;
  const testStatus = typeof connection.testStatus === "string" ? connection.testStatus : undefined;
  const health: ProviderHealth =
    testStatus === undefined ? "unknown" : testStatus === "active" ? "active" : "unhealthy";
  return {
    configured: true,
    ...(typeof active === "boolean" ? { active } : {}),
    health,
  };
}

/** Fold several connections claiming one prefix into a single state. */
function mergeState(states: readonly ProviderConnectionState[]): ProviderConnectionState {
  if (states.length === 0) return { configured: false, health: "unknown" };
  const active = states.some((s) => s.active !== false) ? true : false;
  const health: ProviderHealth = states.some((s) => s.health === "active")
    ? "active"
    : states.every((s) => s.health === "unknown")
      ? "unknown"
      : "unhealthy";
  return { configured: true, active, health };
}

/** Pick a label that is never a generated node id. */
function labelFor(
  prefix: string,
  canonical: string | undefined,
  configuredPrefix: string | undefined,
  displayPrefix: string | undefined
): string {
  if (!isGeneratedNodeId(prefix)) return prefix;
  for (const candidate of [configuredPrefix, displayPrefix, canonical]) {
    if (candidate !== undefined && candidate.length > 0 && !isGeneratedNodeId(candidate)) {
      return candidate;
    }
  }
  return prefix;
}

interface MutableIdentity {
  prefix: string;
  canonical?: string;
  label: string;
  aliases: Set<string>;
  verified: boolean;
  states: ProviderConnectionState[];
  configuredPrefix?: string;
  displayPrefix?: string;
}

/**
 * Build the index from the two gateway sources that carry identity.
 *
 * Both inputs are optional: a build with neither yields an empty index, and
 * `resolveProviderForModel` then returns an unverified identity for every id.
 * That is the documented fail-open state, not an error.
 */
export function buildProviderIdentityIndex(
  input: ProviderIdentityInput = {}
): ProviderIdentityIndex {
  const identities = new Map<string, MutableIdentity>();
  const byCanonical = new Map<string, ProviderIdentity>();

  const upsert = (prefix: string, seed?: Partial<MutableIdentity>): MutableIdentity => {
    const key = prefix.toLowerCase();
    let identity = identities.get(key);
    if (!identity) {
      identity = {
        prefix,
        label: prefix,
        aliases: new Set([key]),
        verified: false,
        states: [],
      };
      identities.set(key, identity);
    }
    if (seed?.canonical !== undefined && identity.canonical === undefined) {
      identity.canonical = seed.canonical;
    }
    if (seed?.configuredPrefix !== undefined && identity.configuredPrefix === undefined) {
      identity.configuredPrefix = seed.configuredPrefix;
    }
    if (seed?.displayPrefix !== undefined && identity.displayPrefix === undefined) {
      identity.displayPrefix = seed.displayPrefix;
    }
    if (seed?.verified === true) identity.verified = true;
    for (const alias of seed?.aliases ?? []) {
      const lowered = alias.toLowerCase();
      identity.aliases.add(lowered);
      // Alias spellings resolve to the same identity, so a model id that uses
      // the canonical or the display prefix reaches the same metadata.
      const existing = identities.get(lowered);
      if (existing === undefined) identities.set(lowered, identity);
    }
    return identity;
  };

  // 1. Connections: the authoritative source for prefix ↔ canonical and for
  //    the active/health state.
  for (const connection of input.connections ?? []) {
    const canonical =
      typeof connection.provider === "string" && connection.provider.length > 0
        ? connection.provider
        : undefined;
    const configuredPrefix = connectionPrefix(connection);
    const prefix = configuredPrefix ?? canonical;
    if (prefix === undefined) continue;
    const identity = upsert(prefix, {
      canonical,
      configuredPrefix,
      verified: true,
      aliases: canonical !== undefined ? new Set([canonical]) : undefined,
    });
    identity.states.push(stateOf(connection));
    if (canonical !== undefined) byCanonical.set(canonical.toLowerCase(), identity);
  }

  // 2. Enrichment: every pricing slot names a served prefix (its `displayPrefix`
  //    when present, else its key) and the canonical node id behind it.
  for (const entry of input.enrichment?.values() ?? []) {
    const alias = typeof entry.providerAlias === "string" ? entry.providerAlias.trim() : "";
    if (alias.length === 0) continue;
    const canonical =
      typeof entry.providerCanonical === "string" && entry.providerCanonical.length > 0
        ? entry.providerCanonical
        : undefined;
    const displayPrefix =
      typeof entry.displayPrefix === "string" && entry.displayPrefix.trim().length > 0
        ? entry.displayPrefix.trim()
        : undefined;
    const identity = upsert(alias, {
      canonical,
      displayPrefix,
      verified: true,
      aliases: canonical !== undefined ? new Set([canonical]) : undefined,
    });
    if (canonical !== undefined && !byCanonical.has(canonical.toLowerCase())) {
      byCanonical.set(canonical.toLowerCase(), identity);
    }
  }

  // 3. Freeze: resolve labels and fold connection states.
  const byAlias = new Map<string, ProviderIdentity>();
  for (const [key, identity] of identities) {
    const state = identity.states.length > 0 ? mergeState(identity.states) : undefined;
    const frozen: ProviderIdentity = {
      prefix: identity.prefix,
      ...(identity.canonical !== undefined ? { canonical: identity.canonical } : {}),
      label: labelFor(
        identity.prefix,
        identity.canonical,
        identity.configuredPrefix,
        identity.displayPrefix
      ),
      aliases: identity.aliases,
      verified: identity.verified,
      ...(state !== undefined ? { state } : {}),
    };
    byAlias.set(key, frozen);
  }
  for (const [key, identity] of byCanonical) {
    const resolved = byAlias.get(key);
    if (resolved !== undefined) byCanonical.set(key, resolved);
    else byCanonical.set(key, identity);
  }

  return { byAlias, byCanonical };
}

/** Prefix of a raw model id, verbatim. `undefined` for a bare id. */
export function servedPrefixOf(modelId: string): string | undefined {
  if (typeof modelId !== "string") return undefined;
  const slash = modelId.indexOf("/");
  if (slash <= 0) return undefined;
  const prefix = modelId.slice(0, slash);
  return prefix.length > 0 ? prefix : undefined;
}

/**
 * Resolve the identity for one served model id.
 *
 * Returns `undefined` only for a bare id with no `owned_by` claim; callers then
 * treat the model as unowned and publish it unchanged.
 */
export function resolveProviderForModel(
  index: ProviderIdentityIndex,
  modelId: string,
  ownedBy?: string
): ProviderIdentity | undefined {
  const prefix = servedPrefixOf(modelId);
  if (prefix !== undefined) {
    const known = index.byAlias.get(prefix.toLowerCase());
    if (known !== undefined) return known;
    // Unknown served prefix: `owned_by` may still name the connection, but the
    // prefix keeps its own spelling so the title never claims a different
    // provider than the one the request routes to.
    const owner = ownedBy !== undefined ? index.byAlias.get(ownedBy.toLowerCase()) : undefined;
    if (owner !== undefined) {
      return {
        prefix,
        ...(owner.canonical !== undefined ? { canonical: owner.canonical } : {}),
        label: prefix,
        aliases: new Set([prefix.toLowerCase()]),
        verified: false,
        ...(owner.state !== undefined ? { state: owner.state } : {}),
      };
    }
    return {
      prefix,
      label: prefix,
      aliases: new Set([prefix.toLowerCase()]),
      verified: false,
    };
  }
  if (ownedBy !== undefined) {
    const owner = index.byAlias.get(ownedBy.toLowerCase());
    if (owner !== undefined) return owner;
  }
  return undefined;
}

/** Every spelling that resolves to the same connection as `name`. */
export function providerAliasesFor(
  index: ProviderIdentityIndex,
  name: string
): ReadonlySet<string> {
  const identity =
    index.byAlias.get(name.toLowerCase()) ?? index.byCanonical.get(name.toLowerCase());
  return identity?.aliases ?? new Set([name.toLowerCase()]);
}

/**
 * Three-state usability for one prefix.
 *
 * `unknown` is not a synonym for `unusable`: a prefix the gateway never
 * described cannot be proven unroutable, so it stays published.
 */
export function providerUsability(
  index: ProviderIdentityIndex,
  name: string
): ProviderUsability {
  const identity =
    index.byAlias.get(name.toLowerCase()) ?? index.byCanonical.get(name.toLowerCase());
  const state = identity?.state;
  if (state === undefined || !state.configured) return "unknown";
  if (state.active === false) return "unusable";
  if (state.health === "unhealthy") return "unusable";
  return "usable";
}

/** Display label for a prefix; falls back to the prefix itself. */
export function providerLabelFor(index: ProviderIdentityIndex, name: string): string {
  const identity =
    index.byAlias.get(name.toLowerCase()) ?? index.byCanonical.get(name.toLowerCase());
  return identity?.label ?? name;
}

export interface ProviderMetadata {
  label?: string;
  canonical?: string;
  state?: ProviderConnectionState;
}

/**
 * Merge two descriptions of the same connection. An incoming value fills a
 * gap; it never replaces a resolved label or an explicit state, because the
 * first source to describe a connection is the one closest to the served id.
 */
export function mergeProviderMetadata(
  existing: ProviderMetadata,
  incoming: ProviderMetadata
): ProviderMetadata {
  const out: ProviderMetadata = {};
  const label = existing.label ?? incoming.label;
  if (label !== undefined) out.label = label;
  const canonical = existing.canonical ?? incoming.canonical;
  if (canonical !== undefined) out.canonical = canonical;
  const state = existing.state ?? incoming.state;
  if (state !== undefined) out.state = state;
  return out;
}

/** Enrichment entry keyed for a served prefix, when the slot describes it. */
export function enrichmentForPrefix(
  enrichment: OmniRouteEnrichmentMap | undefined,
  prefix: string,
  modelId: string
): OmniRouteEnrichmentEntry | undefined {
  if (enrichment === undefined) return undefined;
  const direct = enrichment.get(`${prefix}/${modelId}`);
  if (direct !== undefined) return direct;
  return undefined;
}
