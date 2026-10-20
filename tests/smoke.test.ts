import { describe, it } from "node:test";
import assert from "node:assert/strict";
import plugin from "../src/index.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.OPENCODE_DATA_DIR = mkdtempSync(join(tmpdir(), "oc-smoke-"));

describe("package entrypoint", () => {
  it("exposes the plugin id and a setup function", () => {
    const asPlugin = plugin as unknown as { id: string; setup: unknown };
    assert.equal(asPlugin.id, "opencode-omniroute");
    assert.equal(typeof asPlugin.setup, "function");
  });

  it("publishes a provider without throwing on a minimal host", async () => {
    const added: unknown[] = [];
    const ctx = {
      options: { baseURL: "https://gw.example.com", apiKey: "k", enrichment: false },
      provider: {
        transform: (cb: (editor: { add: (input: unknown) => void }) => void) => {
          cb({ add: (input) => added.push(input) });
          return Promise.resolve({ dispose: async () => {} });
        },
        reload: async () => {},
      },
      model: { transform: () => Promise.resolve({ dispose: async () => {} }) },
      integration: { transform: () => Promise.resolve({ dispose: async () => {} }) },
    };
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ id: "m1" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    const warn = console.warn;
    console.warn = () => {};
    try {
      await (plugin as unknown as { setup: (c: unknown) => Promise<void> }).setup(ctx);
    } finally {
      globalThis.fetch = original;
      console.warn = warn;
    }
    assert.equal(added.length, 1);
    const payload = added[0] as { info?: { id?: string }; models?: unknown[] };
    assert.equal(payload.info?.id, "omniroute");
    assert.equal(payload.models?.length, 1);
  });
});
