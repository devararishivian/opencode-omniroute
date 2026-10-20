import type { Logger } from "./shared/index.js";

/** What the catalog loses when a given gateway source cannot be read. */
function consequenceOf(endpoint: string): string {
  if (endpoint.includes("/api/providers")) {
    return "the usable-provider filter is disabled for this refresh, so unprovisioned providers stay listed";
  }
  if (endpoint.includes("/api/usage")) {
    return "recently used models that the default view dropped stay unpublished";
  }
  return "model names, provider markers, canonical dedupe and pricing are degraded";
}

/**
 * A source the gateway refuses is not fatal — the catalog still publishes —
 * but staying quiet about it is: the picker then shows raw ids, or lists
 * providers that cannot serve, with nothing telling the user why. Say it once
 * per endpoint so a refresh loop cannot spam the log.
 *
 * The plugin uses one key for everything, so a 401/403 on `/api/*` almost
 * always means that key is an inference-only key. The catalog keeps working;
 * the hint says what is missing rather than telling the user to fix an error.
 */
export function createSourceErrorReporter(
  log: Logger
): (endpoint: string, reason: string) => void {
  const warned = new Set<string>();
  return (endpoint, reason) => {
    if (warned.has(endpoint)) return;
    warned.add(endpoint);
    const unauthorized = reason.includes("401") || reason.includes("403");
    const hint = !unauthorized
      ? ""
      : ` The key was refused here; a key without management scope cannot read /api/*, ` +
        `which only costs metadata, not model access.`;
    log.warn(
      `[omniroute-v2] gateway source ${endpoint} unavailable (${reason}): ${consequenceOf(endpoint)}.${hint}`
    );
  };
}
