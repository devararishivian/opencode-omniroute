/**
 * Universal model naming template for the OmniRoute plugin.
 *
 * Naming pipeline:
 *   [tag] <provider-label><separator><display-name><suffix>
 *
 *   [Free] <provider> - <name> · <budget>     ← free model
 *   Auto: <variant> (<N>p)                     ← auto combo
 *   Combo: <name>                              ← DB combo
 *   <provider> - <name>                        ← regular model
 */

// ── Constants ────────────────────────────────────────────────────────────

/** Separator between provider label and model display name. */
export const PROVIDER_TAG_SEPARATOR = " - ";

/** Threshold beyond which providerDisplayName is abbreviated. */
const PROVIDER_LABEL_MAX_CHARS = 12;

/** Aliases longer than this get title-case instead of UPPER. */
const ALIAS_UPPER_MAX_CHARS = 5;

// ── Auto Combo Types ─────────────────────────────────────────────────────

export type AutoVariant = "coding" | "fast" | "cheap" | "offline" | "smart" | "lkgp";

export const AUTO_VARIANTS: AutoVariant[] = ["coding", "fast", "cheap", "offline", "smart", "lkgp"];

export const AUTO_VARIANT_DESCRIPTIONS: Record<AutoVariant | "default", string> = {
  default: "Best provider via scoring",
  coding: "Quality-first for code tasks",
  fast: "Latency-optimized routing",
  cheap: "Cost-optimized routing",
  offline: "Offline-friendly providers",
  smart: "Quality-first with exploration",
  lkgp: "Last-Known-Good-Provider routing",
};

// ── Free Model Types ─────────────────────────────────────────────────────

export type FreeModelFreeType =
  | "recurring-daily"
  | "recurring-monthly"
  | "recurring-credit"
  | "recurring-uncapped"
  | "one-time-initial"
  | "keyless"
  | "discontinued";

/**
 * Free types the `freeOnly` preset admits. Single-use credits and
 * retired models stay visible without the preset but never pass it;
 * an unrecognised gateway value stays unpublished under the preset
 * until it is classified here.
 */
const FREE_ONLY_FREE_TYPES: ReadonlySet<string> = new Set([
  "recurring-daily",
  "recurring-monthly",
  "recurring-credit",
  "recurring-uncapped",
  "keyless",
]);

/** Whether a free-tier entry counts as free under the `freeOnly` preset. */
export function isFreeOnlyFreeType(freeType: unknown): boolean {
  return typeof freeType === "string" && FREE_ONLY_FREE_TYPES.has(freeType);
}

// ── Provider Label ────────────────────────────────────────────────────────

/**
 * Title-case a long, lowercase-looking alias.
 * `antigravity` → `Antigravity`
 */
function titleCaseAlias(alias: string): string {
  if (alias.length === 0) return alias;
  return alias.charAt(0).toUpperCase() + alias.slice(1).toLowerCase();
}

/**
 * Pick the short label for an upstream provider.
 *
 * Rules:
 *   1. Trim `providerDisplayName`. If ≤12 chars → use verbatim.
 *   2. Alias ≤5 chars → UPPER(alias). Alias >5 → titleCase.
 *   3. Neither → undefined.
 */
export function shortProviderLabel(
  enrichment: { providerDisplayName?: string; providerAlias?: string } | undefined
): string | undefined {
  if (!enrichment) return undefined;
  const raw =
    typeof enrichment.providerDisplayName === "string" ? enrichment.providerDisplayName.trim() : "";
  if (raw.length > 0 && raw.length <= PROVIDER_LABEL_MAX_CHARS) return raw;
  const alias = typeof enrichment.providerAlias === "string" ? enrichment.providerAlias.trim() : "";
  if (alias.length > 0) {
    return alias.length <= ALIAS_UPPER_MAX_CHARS ? alias.toUpperCase() : titleCaseAlias(alias);
  }
  // Long displayName with no alias to fall back on: keep the long label
  // rather than dropping the provider prefix entirely.
  return raw.length > 0 ? raw : undefined;
}

// ── Free Label ────────────────────────────────────────────────────────────

/**
 * Normalise display name so free-tier models get a consistent `[Free] ` prefix.
 *
 * "GPT-4.1 (Free)"          → "[Free] GPT-4.1"
 * "DeepSeek V4 Flash Free"  → "[Free] DeepSeek V4 Flash"
 * "Claude Opus 4.7"         → "Claude Opus 4.7"  (unchanged)
 */
export function normaliseFreeLabel(name: string): string {
  // Bounded whitespace quantifiers ({0,8}/{1,8}) avoid the polynomial-ReDoS
  // backtracking that unbounded \s* before an anchored \s*$ would allow on
  // attacker-influenced display names. 8 covers any realistic label spacing.
  const cleaned = name
    .replace(/\s{0,8}\(free\)\s{0,8}$/i, "")
    .replace(/[\s-]{1,8}free\s{0,8}$/i, "")
    .trim();
  const wasFree = cleaned.length < name.trim().length;
  if (!wasFree) return name;
  return `[Free] ${cleaned}`;
}

// ── Free Budget Formatting ────────────────────────────────────────────────

/** Scales, largest first, so the unit is chosen by descending magnitude. */
const TOKEN_UNITS = [
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
] as const;

/**
 * Format a token count as a short magnitude string: `25M`, `1.5K`, `999`.
 *
 * The unit has to be picked from the value that will actually be *printed*,
 * not from the raw input. `toFixed(1)` rounds to the nearest tenth, so at the
 * K scale 999_950 and above render as `1000.0` — and by then the M branch has
 * already been skipped, producing `1000K` for a number that is `1M`. The same
 * carry turns just under a billion into `1000M`. When the rounded value reaches
 * the next scale, re-render at that scale instead.
 */
function fmtTokens(n: number): string {
  for (let i = 0; i < TOKEN_UNITS.length; i++) {
    const [scale, suffix] = TOKEN_UNITS[i]!;
    if (n < scale) continue;
    const value = Number((n / scale).toFixed(1));
    // `Number()` also drops a trailing `.0`, which the previous regex did.
    if (value < 1000 || i === 0) return `${value}${suffix}`;
    const [nextScale, nextSuffix] = TOKEN_UNITS[i - 1]!;
    return `${Number((n / nextScale).toFixed(1))}${nextSuffix}`;
  }
  return String(n);
}

/**
 * Format a free model budget into a short human-readable suffix.
 *
 * recurring-daily     → "25M tokens/day"
 * recurring-monthly   → "25M tokens/month"
 * recurring-credit    → "10M credits"
 * recurring-uncapped  → "(uncapped)"
 * one-time-initial    → "1M credits (one-time)"
 * keyless             → "(keyless)"
 * discontinued        → "(discontinued)"
 * unknown future type → "(<type>)", never empty
 *
 * The uncapped label reuses the dashboard wording ("uncapped" in
 * `FreeBudgetCard.tsx:133`), parenthesised like the other cap-less labels.
 */
export function formatFreeBudget(params: {
  freeType: FreeModelFreeType;
  monthlyTokens?: number;
  creditTokens?: number;
}): string {
  const { freeType, monthlyTokens = 0, creditTokens = 0 } = params;

  switch (freeType) {
    case "recurring-daily":
      return `${fmtTokens(monthlyTokens)} tokens/day`;
    case "recurring-monthly":
      return `${fmtTokens(monthlyTokens)} tokens/month`;
    case "recurring-credit":
      return `${fmtTokens(creditTokens)} credits`;
    case "recurring-uncapped":
      return "(uncapped)";
    case "one-time-initial":
      return `${fmtTokens(creditTokens)} credits (one-time)`;
    case "keyless":
      return "(keyless)";
    case "discontinued":
      return "(discontinued)";
    default:
      return `(${String(freeType)})`;
  }
}

// ── Auto Combo Naming ─────────────────────────────────────────────────────

/**
 * Format auto combo display name.
 *
 * "Auto: Coding (4p)"
 * "Auto: Default (6p)"
 * "Auto" (no candidate count when unknown)
 */
export function formatAutoComboName(
  variant: AutoVariant | undefined,
  candidateCount?: number
): string {
  const label = variant ? variant.charAt(0).toUpperCase() + variant.slice(1) : "Default";
  const count =
    typeof candidateCount === "number" && candidateCount > 0 ? ` (${candidateCount}p)` : "";
  return `Auto: ${label}${count}`;
}

/**
 * Build the model ID for an auto combo entry.
 * "auto/coding", "auto/fast", "auto" (default).
 */
export function autoComboModelId(variant: AutoVariant | undefined): string {
  return variant ? `auto/${variant}` : "auto";
}

// ── Universal Display Name Builder ────────────────────────────────────────

export interface ModelDisplayNameParams {
  /** Raw model ID (e.g. "cc/" or "openagentic/deepseek-v4-flash"). */
  rawId: string;
  /** Enrichment display name (e.g. "the model 4.6"). */
  enrichmentName?: string;
  /**
   * Public provider prefix the model is served under (`openagentic`, `cc`).
   * This is what the title carries: the TUI searches titles and provider
   * category, and the model id is not a search key, so the prefix has to be
   * in the title for the provider to stay findable.
   */
  providerAlias?: string;
  /** Human-readable upstream provider label, used only when no alias exists. */
  providerDisplayName?: string;
  /** Explicit label; wins over both alias and display name. */
  providerLabel?: string;
  /**
   * Leading wrapper segments of a nested id (`no-think` in
   * `no-think/openagentic/x`). They route the request differently, so they are
   * part of what makes two titles different, and they stay in the title.
   */
  namespace?: string;
  /** Whether model is free tier. */
  isFree?: boolean;
  /** Free model budget info. */
  freeType?: FreeModelFreeType;
  /** Monthly token budget (for recurring free models). */
  monthlyTokens?: number;
  /** Credit token budget (for credit-based free models). */
  creditTokens?: number;
  /** Whether this is a combo entry (skip provider tag). */
  isCombo?: boolean;
  /** Whether this is an auto combo entry. */
  isAutoCombo?: boolean;
  /** Auto combo variant. */
  autoVariant?: AutoVariant;
  /** Auto combo candidate count. */
  autoCandidateCount?: number;
}

/** Suffix format for the provider marker in a display name. */
export function formatProviderSuffix(label: string): string {
  return ` (${label})`;
}

/**
 * Build the final display name.
 *
 * Provider-first policy: the served prefix leads, capitalised, followed by the
 * model name. The picker searches titles, so the provider has to be visible for
 * a model to be findable by its provider, and leading with it keeps that
 * guarantee while reading as a name:
 *
 *   `OpenAgentic - DeepSeek V4 Flash`
 *   `[Free] OpenAgentic - DeepSeek V4 Flash .. 25M tokens/day`
 *   `Auto: Coding (4p)`                        <- auto combo
 *   `Combo: Daily driver`                      <- DB combo
 *
 * The label is the served prefix, never a generated node id or a UUID. A base
 * name that is only the id repeats the prefix, so it is stripped before the
 * label is added.
 */
export function buildModelDisplayName(params: ModelDisplayNameParams): string {
  // Auto combos
  if (params.isAutoCombo) {
    return formatAutoComboName(params.autoVariant, params.autoCandidateCount);
  }

  // Determine base name - strip any existing free suffix first. When the
  // gateway has no display name, the id is the name; humanising it keeps the
  // picker readable without inventing data.
  // An enrichment name that is just the id again (`deepseek-v4.1-flash`) is
  // not a name, so it goes through the same humaniser as a missing one.
  // The free suffix is removed BEFORE the id is compared, because a bare
  // `...-free` id would otherwise never match the name the catalog carries
  // for its paid twin and would stay un-humanised.
  const stripFree = (value: string): string =>
    value
      .replace(/\s*\(free\)\s*$/i, "")
      .replace(/[\s-]+free\s*$/i, "")
      .trim();
  const supplied = params.enrichmentName?.trim();
  // If the supplied name is org-prefixed like `deepseek-ai/deepseek-v4.1-flash`,
  // compare and humanise using the leaf segment so the repo slash does not leak.
  const suppliedLeaf =
    supplied !== undefined && supplied.includes("/")
      ? supplied.slice(supplied.lastIndexOf("/") + 1).trim()
      : supplied;
  const rawSegment = params.rawId.slice(params.rawId.lastIndexOf("/") + 1);
  const idSegment = stripFree(rawSegment);
  const nameIsId =
    suppliedLeaf === undefined ||
    suppliedLeaf.length === 0 ||
    suppliedLeaf === params.rawId ||
    stripFree(suppliedLeaf).toLowerCase() === idSegment.toLowerCase();
  const named = nameIsId ? humanizeModelName(idSegment) : suppliedLeaf;
  // Free-ness is a property of the id and of the gateway's own label, so it is
  // read before either is stripped: `deepseek-v4.1-flash-free` must stay
  // marked free even though its title is the paid model's name.
  const wasFree =
    stripFree(rawSegment).length < rawSegment.trim().length ||
    (supplied !== undefined && stripFree(supplied).length < supplied.length);
  const cleanedBase = stripFree(named);
  const isFree = !!params.isFree || wasFree;

  let baseName = cleanedBase;

  // Provider marker (skip for combos: they route across providers).
  if (!params.isCombo) {
    const explicit = params.providerLabel?.trim();
    const alias = params.providerAlias?.trim();
    const display = params.providerDisplayName?.trim();
    const raw =
      explicit !== undefined && explicit.length > 0
        ? explicit
        : alias !== undefined && alias.length > 0
          ? alias
          : display;
    if (raw !== undefined && raw.length > 0) {
      const provider = displayLabel(raw);
      const namespace = params.namespace?.trim();
      const label =
        namespace !== undefined && namespace.length > 0
          ? `${displayLabel(namespace)} - ${provider}`
          : provider;
      // The model segment alone is not a name: `deepseek-v4-pro` repeats the id
      // the picker already shows under the title. Prefer the segment stripped of
      // the provider prefix, so the title reads as a name rather than an id.
      const bare = stripProviderPrefix(baseName, raw);
      if (!hasProviderMarker(bare, label)) {
        baseName = `${label}${PROVIDER_TAG_SEPARATOR}${bare}`;
      } else {
        baseName = bare;
      }
    }
  }

  // Prepend [Free] if applicable (AFTER the provider marker for ordering)
  if (isFree) {
    baseName = `[Free] ${baseName}`;
  }

  // Free budget suffix
  if (isFree && params.freeType) {
    const budget = formatFreeBudget({
      freeType: params.freeType,
      monthlyTokens: params.monthlyTokens,
      creditTokens: params.creditTokens,
    });
    if (budget) {
      baseName = `${baseName} · ${budget}`;
    }
  }

  return baseName;
}

/**
 * Words whose casing a title must not invent. Kept deliberately small: these
 * are the tokens that read as wrong when capitalised (`Gpt`, `Glm`).
 */
const KEPT_CASE: ReadonlySet<string> = new Set([
  "gpt",
  "glm",
  "oss",
  "asr",
  "tts",
  "vl",
  "vlm",
  "pdf",
  "api",
  "url",
]);

/**
 * Turn an id-shaped name into a readable one: `deepseek-v4.1-flash` becomes
 * `DeepSeek V4.1 Flash`. Only used when the gateway supplied no display name
 * and the name is the id itself, so it never overrides real data. Tokens that
 * carry digits or dots are left alone (`v4.1`), and known acronyms keep their
 * casing.
 */
export function humanizeModelName(value: string): string {
  if (value.length === 0 || value.includes(" ")) return value;
  const tokens = value.split(/[-_]+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return value;
  return tokens
    .map((token) => {
      const lower = token.toLowerCase();
      if (KEPT_CASE.has(lower)) return lower.toUpperCase();
      if (/[0-9.]/.test(token)) return token;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/**
 * Format a provider prefix or wrapper namespace for display when the connection
 * carried no custom operator `nodeName`: `cosmoshub` -> `Cosmoshub`, `no-think` -> `No-think`.
 * A label that already carries mixed/upper case from the operator is left untouched.
 */
export function displayLabel(label: string): string {
  if (label.length === 0) return label;
  if (label !== label.toLowerCase()) return label;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Strip a leading `<prefix>/` from a name that is really an id. */
function stripProviderPrefix(name: string, prefix: string): string {
  const needle = `${prefix.toLowerCase()}/`;
  return name.toLowerCase().startsWith(needle) ? name.slice(needle.length) : name;
}

/** Whether `name` already carries this provider marker in any spelling. */
function hasProviderMarker(name: string, label: string): boolean {
  const lowered = name.toLowerCase();
  const needle = label.toLowerCase();
  if (lowered.includes(`(${needle})`)) return true;
  // A title that already leads with the provider must not gain a second one.
  return lowered.startsWith(`${needle}${PROVIDER_TAG_SEPARATOR.toLowerCase()}`);
}
