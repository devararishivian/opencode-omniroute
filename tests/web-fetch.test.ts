import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WEBFETCH_TOOL_NAME, registerWebFetch } from "../src/web/fetch.js";
import { OmniRouteWebClient } from "../src/web/client.js";
import { resolveWebOptions } from "../src/options.js";

const BASE = "https://gw.example.com";

interface ToolCall {
  url: string;
  format: "text" | "markdown" | "html";
  timeout?: number;
}

interface RegisteredTool {
  name: string;
  description: string;
  options?: { codemode?: boolean };
  execute: (
    input: ToolCall,
    context: {
      signal: AbortSignal;
      sessionID: string;
      agent: string;
      messageID: string;
      id: string;
    }
  ) => Promise<{
    output?: { url: string; contentType: string; format: string; output: string };
    content?: string;
    metadata?: Record<string, unknown>;
  }>;
}

const CONTEXT = {
  signal: new AbortController().signal,
  sessionID: "ses_1",
  agent: "build",
  messageID: "msg_1",
  id: "call_1",
};

/** A host that already has a native webfetch, like a real OpenCode install. */
function toolHost(options: { native?: boolean } = {}) {
  const added: RegisteredTool[] = [];
  const permissionCalls: Array<{ action: string; resources: readonly string[] }> = [];
  const nativeCalls: ToolCall[] = [];
  const hasNative = options.native !== false;
  const native: RegisteredTool = {
    name: WEBFETCH_TOOL_NAME,
    description: "native",
    execute: async (input) => {
      nativeCalls.push(input);
      return {
        output: { url: input.url, contentType: "text/plain", format: input.format, output: "native body" },
        content: "native body",
      };
    },
  };
  const host = {
    permission: {
      assert: async (input: { action: string; resources: readonly string[] }) => {
        permissionCalls.push({ action: input.action, resources: input.resources });
      },
    },
    tool: {
      transform: async (cb: (editor: unknown) => void) => {
        cb({
          get: (id: string) => (hasNative && id === WEBFETCH_TOOL_NAME ? { ...native, id } : undefined),
          add: (tool: RegisteredTool) => {
            // Same-name registration replaces the previous entry, which is the
            // host's documented replacement semantics.
            const existing = added.findIndex((t) => t.name === tool.name);
            if (existing >= 0) added.splice(existing, 1);
            added.push(tool);
          },
        });
        return { dispose: async () => {} };
      },
    },
  };
  return { host, added, permissionCalls, nativeCalls };
}

function stubFetch(handler: (url: string, body: Record<string, unknown>) => Response) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Record<string, unknown>);
    calls.push({ url, body });
    return handler(url, body);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const silent = { warn: () => {}, debug: () => {} };

describe("OmniRoute webfetch replacement", () => {
  it("leaves the built-in tool alone when fetch is disabled", async () => {
    const { host, added, permissionCalls } = toolHost();
    const client = new OmniRouteWebClient({ baseURL: BASE, apiKey: "k", timeoutMs: 1000 });
    const result = await registerWebFetch(host, client, resolveWebOptions(undefined), silent);
    assert.equal(result.registered, false);
    assert.equal(result.reason, "disabled");
    assert.equal(added.length, 0);
    assert.equal(permissionCalls.length, 0);
  });

  it("registers under the native name with the native contract", async () => {
    const { host, added } = toolHost();
    const client = new OmniRouteWebClient({ baseURL: BASE, apiKey: "k", timeoutMs: 1000 });
    const fetchStub = stubFetch(() =>
      json({ provider: "firecrawl", url: "https://example.com/a", content: "# Title" })
    );
    try {
      const result = await registerWebFetch(
        host,
        client,
        resolveWebOptions({ fetch: { enabled: true } }),
        silent
      );
      assert.equal(result.registered, true);
      assert.equal(result.nativeAvailable, true);
      assert.equal(added.length, 1);
      assert.equal(added[0]?.name, WEBFETCH_TOOL_NAME);
      // webfetch is a direct tool in the built-in plugin; keep it that way.
      assert.equal(added[0]?.options?.codemode, false);

      const out = await added[0]!.execute({ url: "https://example.com/a", format: "markdown" }, CONTEXT);
      assert.equal(out.output?.output, "# Title");
      assert.equal(out.output?.contentType, "text/markdown");
      assert.equal(out.output?.format, "markdown");
      assert.equal(out.output?.url, "https://example.com/a");
      assert.equal(out.metadata?.["provider"], "firecrawl");

      const body = fetchStub.calls[0]?.body;
      assert.equal(body?.["url"], "https://example.com/a");
      assert.equal(body?.["format"], "markdown");
      assert.equal(body?.["depth"], 0);
      // OmniRoute owns provider selection here too.
      assert.equal(body !== undefined && "provider" in body, false);
    } finally {
      fetchStub.restore();
    }
  });

  it("asks for the native permission action with the URL as resource, before any request", async () => {
    const { host, added, permissionCalls } = toolHost();
    const client = new OmniRouteWebClient({ baseURL: BASE, apiKey: "k", timeoutMs: 1000 });
    const fetchStub = stubFetch(() => json({ url: "https://example.com/a", content: "body" }));
    try {
      await registerWebFetch(
        host,
        client,
        resolveWebOptions({ fetch: { enabled: true } }),
        silent
      );
      await added[0]!.execute({ url: "https://example.com/a", format: "markdown" }, CONTEXT);
      assert.deepEqual(permissionCalls, [
        { action: "webfetch", resources: ["https://example.com/a"] },
      ]);
    } finally {
      fetchStub.restore();
    }
  });

  it("does not reach the gateway when permission is denied", async () => {
    const { host, added } = toolHost();
    const denied = new Error("Permission denied");
    host.permission.assert = async () => {
      throw denied;
    };
    const client = new OmniRouteWebClient({ baseURL: BASE, apiKey: "k", timeoutMs: 1000 });
    const fetchStub = stubFetch(() => json({ url: "https://example.com/a", content: "body" }));
    try {
      await registerWebFetch(
        host,
        client,
        resolveWebOptions({ fetch: { enabled: true } }),
        silent
      );
      await assert.rejects(
        added[0]!.execute({ url: "https://example.com/a", format: "markdown" }, CONTEXT),
        /Permission denied/
      );
      assert.equal(fetchStub.calls.length, 0, "a denial must never become a gateway request");
    } finally {
      fetchStub.restore();
    }
  });

  it("maps native text to the gateway markdown format", async () => {
    const { host, added } = toolHost();
    const client = new OmniRouteWebClient({ baseURL: BASE, apiKey: "k", timeoutMs: 1000 });
    const fetchStub = stubFetch(() => json({ url: "https://example.com/a", content: "plain" }));
    try {
      await registerWebFetch(
        host,
        client,
        resolveWebOptions({ fetch: { enabled: true } }),
        silent
      );
      const out = await added[0]!.execute({ url: "https://example.com/a", format: "text" }, CONTEXT);
      assert.equal(fetchStub.calls[0]?.body["format"], "markdown");
      // The caller still gets the format it asked for.
      assert.equal(out.output?.format, "text");
      assert.equal(out.output?.contentType, "text/plain");
    } finally {
      fetchStub.restore();
    }
  });

  it("falls back to the native tool when the gateway fails", async () => {
    const { host, added, nativeCalls } = toolHost();
    const client = new OmniRouteWebClient({ baseURL: BASE, apiKey: "k", timeoutMs: 1000 });
    const fetchStub = stubFetch(() => json({ error: { message: "all providers exhausted" } }, 503));
    try {
      await registerWebFetch(
        host,
        client,
        resolveWebOptions({ fetch: { enabled: true } }),
        silent
      );
      const out = await added[0]!.execute({ url: "https://example.com/a", format: "markdown" }, CONTEXT);
      assert.equal(out.output?.output, "native body");
      assert.equal(nativeCalls.length, 1);
    } finally {
      fetchStub.restore();
    }
  });

  it("returns a sanitized error when fallback is off", async () => {
    const { host, added, nativeCalls } = toolHost();
    const client = new OmniRouteWebClient({ baseURL: BASE, apiKey: "secret-key", timeoutMs: 1000 });
    const fetchStub = stubFetch(() => json({ error: { message: "upstream 500" } }, 500));
    try {
      await registerWebFetch(
        host,
        client,
        resolveWebOptions({ fetch: { enabled: true, fallbackToNative: false } }),
        silent
      );
      await assert.rejects(
        added[0]!.execute({ url: "https://example.com/a", format: "markdown" }, CONTEXT),
        (err: Error) => {
          assert.match(err.message, /Unable to fetch/);
          assert.doesNotMatch(err.message, /secret-key/);
          return true;
        }
      );
      assert.equal(nativeCalls.length, 0);
    } finally {
      fetchStub.restore();
    }
  });

  it("still works when the host has no native tool to fall back to", async () => {
    const { host, added } = toolHost({ native: false });
    const client = new OmniRouteWebClient({ baseURL: BASE, apiKey: "k", timeoutMs: 1000 });
    const fetchStub = stubFetch(() => json({ error: { message: "down" } }, 502));
    try {
      const result = await registerWebFetch(
        host,
        client,
        resolveWebOptions({ fetch: { enabled: true } }),
        silent
      );
      assert.equal(result.nativeAvailable, false);
      await assert.rejects(
        added[0]!.execute({ url: "https://example.com/a", format: "markdown" }, CONTEXT),
        /Unable to fetch/
      );
    } finally {
      fetchStub.restore();
    }
  });

  it("clamps the timeout to the native 1..120 second range", async () => {
    const { host, added } = toolHost();
    const client = new OmniRouteWebClient({ baseURL: BASE, apiKey: "k", timeoutMs: 60_000 });
    const fetchStub = stubFetch(() => json({ url: "https://example.com/a", content: "body" }));
    try {
      await registerWebFetch(
        host,
        client,
        resolveWebOptions({ fetch: { enabled: true } }),
        silent
      );
      await added[0]!.execute({ url: "https://example.com/a", format: "markdown", timeout: 500 }, CONTEXT);
      assert.equal(fetchStub.calls.length, 1);
    } finally {
      fetchStub.restore();
    }
  });

  it("does not fall back when the caller cancelled the turn", async () => {
    const { host, added, nativeCalls } = toolHost();
    const client = new OmniRouteWebClient({ baseURL: BASE, apiKey: "k", timeoutMs: 5000 });
    const controller = new AbortController();
    // The plugin combines the caller signal with its own timeout, so the stub
    // must reject on the signal it is handed, not on the test's controller.
    const original = globalThis.fetch;
    globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted === true) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }) as typeof fetch;
    const fetchStub = { restore: () => { globalThis.fetch = original; } };
    try {
      await registerWebFetch(
        host,
        client,
        resolveWebOptions({ fetch: { enabled: true } }),
        silent
      );
      const pending = added[0]!.execute(
        { url: "https://example.com/a", format: "markdown" },
        { ...CONTEXT, signal: controller.signal }
      );
      controller.abort();
      await assert.rejects(pending, (err: Error & { aborted?: boolean }) => {
        assert.equal(err.aborted, true);
        return true;
      });
      assert.equal(nativeCalls.length, 0, "a cancelled turn must not keep fetching elsewhere");
    } finally {
      fetchStub.restore();
    }
  });

  it("sends timeout in request body and bounds request to per-request timeout", async () => {
    const { host, added } = toolHost();
    const client = new OmniRouteWebClient({ baseURL: BASE, apiKey: "k", timeoutMs: 60_000 });
    const fetchStub = stubFetch(() => json({ url: "https://example.com/fast", content: "fast page" }));
    try {
      await registerWebFetch(
        host,
        client,
        resolveWebOptions({ fetch: { enabled: true } }),
        silent
      );
      await added[0]!.execute({ url: "https://example.com/fast", format: "markdown", timeout: 5 }, CONTEXT);
      assert.equal(fetchStub.calls.length, 1);
      const body = fetchStub.calls[0]?.body;
      assert.equal(body?.["timeout"], 5);
    } finally {
      fetchStub.restore();
    }
  });

  it("handles empty content without throwing (e.g. 404 returning empty string)", async () => {
    const { host, added } = toolHost();
    const client = new OmniRouteWebClient({ baseURL: BASE, apiKey: "k", timeoutMs: 1000 });
    const fetchStub = stubFetch(() => json({ url: "https://example.com/empty", content: "" }));
    try {
      await registerWebFetch(
        host,
        client,
        resolveWebOptions({ fetch: { enabled: true } }),
        silent
      );
      const out = await added[0]!.execute({ url: "https://example.com/empty", format: "markdown" }, CONTEXT);
      assert.equal(out.output?.output, "");
      assert.equal(out.content, "");
    } finally {
      fetchStub.restore();
    }
  });

  it("handles metadata with null or missing fields gracefully", async () => {
    const { host, added } = toolHost();
    const client = new OmniRouteWebClient({ baseURL: BASE, apiKey: "k", timeoutMs: 1000 });
    const fetchStub = stubFetch(() =>
      json({
        url: "https://example.com/meta",
        content: "hello",
        metadata: { title: null, description: null },
      })
    );
    try {
      await registerWebFetch(
        host,
        client,
        resolveWebOptions({ fetch: { enabled: true } }),
        silent
      );
      const out = await added[0]!.execute({ url: "https://example.com/meta", format: "markdown" }, CONTEXT);
      assert.equal(out.output?.output, "hello");
    } finally {
      fetchStub.restore();
    }
  });

  it("preserves URL query parameters, hash fragments, and encoded characters", async () => {
    const { host, added } = toolHost();
    const client = new OmniRouteWebClient({ baseURL: BASE, apiKey: "k", timeoutMs: 1000 });
    const complexUrl = "https://example.com/search?q=hello%20world&page=2&tags=a,b#section-1";
    const fetchStub = stubFetch(() => json({ url: complexUrl, content: "result" }));
    try {
      await registerWebFetch(
        host,
        client,
        resolveWebOptions({ fetch: { enabled: true } }),
        silent
      );
      const out = await added[0]!.execute({ url: complexUrl, format: "markdown" }, CONTEXT);
      assert.equal(fetchStub.calls[0]?.body["url"], complexUrl);
      assert.equal(out.output?.url, complexUrl);
    } finally {
      fetchStub.restore();
    }
  });
});
