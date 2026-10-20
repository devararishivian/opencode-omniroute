import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../src/index.js";

/**
 * The optional tier (enrichment, combos, providers) lands *after* the first
 * publish. `refreshAndPublish` projects a snapshot onto the payload the host
 * reads, then reloads; the host replays the transform and publishes that
 * payload. If the late upgrade reloads without re-projecting, the picker keeps
 * the empty-enrichment projection — raw ids, no provider markers — for the
 * whole TTL even though the snapshot already has names.
 */
process.env.OPENCODE_DATA_DIR = mkdtempSync(join(tmpdir(), "oc-late-enrich-"));

interface Published {
  info: { id: string };
  models: Array<{ modelID: string; name: string }>;
}

async function setupWithDelayedEnrichment(): Promise<{
  published: () => Published | undefined;
}> {
  let added: unknown[] = [];
  const ctx = {
    options: {
      baseURL: "https://gw.example.com",
      apiKey: "k",
      providerId: `late-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
      modelCacheTtlMs: 300_000,
    },
    provider: {
      transform: (cb: (editor: { add: (input: unknown) => void }) => void) => {
        cb({ add: (input) => added.push(input) });
        return Promise.resolve({ dispose: async () => {} });
      },
      reload: async () => {
        // The host replays the registered transform on reload, which is how a
        // new payload reaches the picker.
        added = [];
        transformCb?.({ add: (input) => added.push(input) });
      },
    },
    model: { transform: () => Promise.resolve({ dispose: async () => {} }) },
    integration: { transform: () => Promise.resolve({ dispose: async () => {} }) },
  };
  let transformCb: ((editor: { add: (input: unknown) => void }) => void) | undefined;
  const originalTransform = ctx.provider.transform;
  ctx.provider.transform = (cb: (editor: { add: (input: unknown) => void }) => void) => {
    transformCb = cb;
    return originalTransform(cb);
  };

  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/pricing/models")) {
      return new Response(
        JSON.stringify({
          providers: {
            openai: {
              id: "openai",
              displayPrefix: "openagentic",
              models: [{ id: "kimi-k3", name: "Kimi K3" }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/v1/models")) {
      return new Response(JSON.stringify({ data: [{ id: "openagentic/kimi-k3" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const warn = console.warn;
  console.warn = () => {};
  try {
    await (plugin as unknown as { setup: (c: unknown) => Promise<void> }).setup(ctx);
    // Let the optional tier settle and reload.
    await new Promise((resolve) => setTimeout(resolve, 300));
  } finally {
    globalThis.fetch = original;
    console.warn = warn;
  }

  return {
    published: () => (added[0] as Published | undefined) ?? undefined,
  };
}

describe("late enrichment reaches the picker", () => {
  it("publishes the friendly name and provider marker, not the raw id", async () => {
    const { published } = await setupWithDelayedEnrichment();
    const payload = published();
    assert.ok(payload, "a payload must be published after the optional tier lands");
    const model = payload.models.find((m) => m.modelID === "openagentic/kimi-k3");
    assert.ok(model, "the model must still be published");
    assert.equal(
      model.name,
      "Kimi K3 (openagentic)",
      "the reload must publish the re-projected payload, not the empty-enrichment one"
    );
  });
});
