import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../src/index.js";

/**
 * The plugin must not touch anything that is not its own provider or its own
 * optional web tools. These tests read the calls it makes, not the config it
 * would like to make.
 */
function setupCtx(options: Record<string, unknown>) {
  const calls: string[] = [];
  const added: unknown[] = [];
  const mcpCalls: unknown[] = [];
  const ctx = {
    options,
    provider: {
      transform: (cb: (editor: { add: (input: unknown) => void }) => void) => {
        calls.push("provider.transform");
        cb({ add: (input) => added.push(input) });
        return Promise.resolve({ dispose: async () => {} });
      },
      reload: async () => {},
    },
    model: {
      transform: () => {
        calls.push("model.transform");
        return Promise.resolve({ dispose: async () => {} });
      },
    },
    integration: {
      transform: (cb: (draft: unknown) => void) => {
        calls.push("integration.transform");
        cb({
          update: () => {},
          method: { update: () => {} },
        });
        return Promise.resolve({ dispose: async () => {} });
      },
    },
    mcp: {
      transform: (cb: (draft: unknown) => void) => {
        mcpCalls.push(cb);
        return Promise.resolve({ dispose: async () => {} });
      },
    },
    websearch: {
      transform: () => {
        calls.push("websearch.transform");
        return Promise.resolve({ dispose: async () => {} });
      },
    },
    tool: {
      transform: () => {
        calls.push("tool.transform");
        return Promise.resolve({ dispose: async () => {} });
      },
      get: () => undefined,
    },
    permission: { assert: async () => {} },
  };
  return { ctx, calls, added, mcpCalls };
}

const DATA_DIR = mkdtempSync(join(tmpdir(), "oc-mcp-check-"));
process.env.OPENCODE_DATA_DIR = DATA_DIR;

function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const warn = console.warn;
  const log = console.log;
  console.warn = () => {};
  console.log = () => {};
  return fn().finally(() => {
    console.warn = warn;
    console.log = log;
  });
}

describe("MCP is never registered", () => {
  it("does not call ctx.mcp.transform with default options", async () => {
    const { ctx, mcpCalls } = setupCtx({
      baseURL: "https://gw.example.com",
      apiKey: "k",
      providerId: "mcp-none",
      enrichment: false,
    });
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    await quiet(() => (plugin as unknown as { setup: (c: unknown) => Promise<void> }).setup(ctx));
    assert.equal(mcpCalls.length, 0);
  });

  it("does not call ctx.mcp.transform when both web tools are enabled", async () => {
    const { ctx, mcpCalls } = setupCtx({
      baseURL: "https://gw.example.com",
      apiKey: "k",
      providerId: "mcp-web",
      enrichment: false,
      web: { search: { enabled: true }, fetch: { enabled: true } },
    });
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    await quiet(() => (plugin as unknown as { setup: (c: unknown) => Promise<void> }).setup(ctx));
    assert.equal(mcpCalls.length, 0);
  });

  it("registers the web domains only when asked", async () => {
    const off = setupCtx({
      baseURL: "https://gw.example.com",
      apiKey: "k",
      providerId: "web-off",
      enrichment: false,
    });
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    await quiet(() =>
      (plugin as unknown as { setup: (c: unknown) => Promise<void> }).setup(off.ctx)
    );
    assert.equal(off.calls.includes("websearch.transform"), false);
    assert.equal(off.calls.includes("tool.transform"), false);

    const on = setupCtx({
      baseURL: "https://gw.example.com",
      apiKey: "k",
      providerId: "web-on",
      enrichment: false,
      web: { search: { enabled: true }, fetch: { enabled: true } },
    });
    await quiet(() =>
      (plugin as unknown as { setup: (c: unknown) => Promise<void> }).setup(on.ctx)
    );
    assert.ok(on.calls.includes("websearch.transform"));
    assert.ok(on.calls.includes("tool.transform"));
  });

  it("publishes only its own provider entry", async () => {
    const { ctx, added } = setupCtx({
      baseURL: "https://gw.example.com",
      apiKey: "k",
      providerId: "own-provider",
      enrichment: false,
    });
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ id: "m1" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    await quiet(() => (plugin as unknown as { setup: (c: unknown) => Promise<void> }).setup(ctx));
    const ids = (added as Array<{ info?: { id?: string } }>).map((entry) => entry.info?.id);
    assert.deepEqual(ids, ["own-provider"]);
  });
});
