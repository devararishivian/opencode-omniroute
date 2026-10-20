import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OmniRouteWebClient, webEndpoint } from "../src/web/client.js";
import { registerWebSearch, toOpenCodeResults } from "../src/web/search.js";
import { resolveWebOptions } from "../src/options.js";

const BASE = "https://gw.example.com";

/** Capture the definition the registration hands to the host. */
function searchHost() {
  const added: Array<{
    id: string;
    name: string;
    execute: (
      input: { query: string },
      context: { signal: AbortSignal }
    ) => Promise<readonly { url: string; title?: string; content?: string; time: object }[]>;
  }> = [];
  const selection: { value: string | false | undefined } = { value: undefined };
  return {
    added,
    selection,
    host: {
      transform: async (
        cb: (editor: {
          add: (definition: (typeof added)[number]) => void;
          default: { get: () => string | false | undefined; set: (value: string | false) => void };
        }) => void
      ) => {
        cb({
          add: (definition) => added.push(definition),
          default: {
            get: () => selection.value,
            set: (value) => {
              selection.value = value;
            },
          },
        });
        return { dispose: async () => {} };
      },
    },
  };
}

function stubFetch(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
    return handler(url, init);
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

describe("webEndpoint", () => {
  it("accepts a baseURL with or without /v1", () => {
    assert.equal(webEndpoint(BASE, "/v1/search"), `${BASE}/v1/search`);
    assert.equal(webEndpoint(`${BASE}/v1`, "/v1/search"), `${BASE}/v1/search`);
    assert.equal(webEndpoint(`${BASE}/`, "/v1/web/fetch"), `${BASE}/v1/web/fetch`);
  });
});

describe("web options", () => {
  it("is disabled by default, with every default filled in", () => {
    const web = resolveWebOptions(undefined);
    assert.equal(web.search.enabled, false);
    assert.equal(web.fetch.enabled, false);
    assert.equal(web.fetch.fallbackToNative, true);
    assert.equal(web.search.maxResults, 5);
    assert.equal(web.timeoutMs, 30_000);
  });

  it("enables search and fetch independently", () => {
    const searchOnly = resolveWebOptions({ search: { enabled: true } });
    assert.equal(searchOnly.search.enabled, true);
    assert.equal(searchOnly.fetch.enabled, false);
    const fetchOnly = resolveWebOptions({ fetch: { enabled: true } });
    assert.equal(fetchOnly.search.enabled, false);
    assert.equal(fetchOnly.fetch.enabled, true);
  });
});

describe("OmniRoute web search", () => {
  it("registers nothing when search is disabled", async () => {
    const { host, added } = searchHost();
    const client = new OmniRouteWebClient({ baseURL: BASE, apiKey: "k", timeoutMs: 1000 });
    const result = await registerWebSearch(
      host,
      client,
      resolveWebOptions(undefined),
      "omniroute",
      "OmniRoute",
      silent
    );
    assert.equal(result.registered, false);
    assert.equal(result.reason, "disabled");
    assert.equal(added.length, 0);
  });

  it("registers nothing when credentials are missing, and says why", async () => {
    const { host, added } = searchHost();
    const warnings: string[] = [];
    const client = new OmniRouteWebClient({ baseURL: BASE, apiKey: "", timeoutMs: 1000 });
    const result = await registerWebSearch(
      host,
      client,
      resolveWebOptions({ search: { enabled: true } }),
      "omniroute",
      "OmniRoute",
      { warn: (message: string) => warnings.push(message), debug: () => {} }
    );
    assert.equal(result.registered, false);
    assert.equal(result.reason, "missing-credentials");
    assert.equal(added.length, 0);
    assert.ok(warnings.some((w) => w.includes("baseURL/apiKey")));
  });

  it("registers, selects the provider, and omits the provider field", async () => {
    const { host, added, selection } = searchHost();
    const client = new OmniRouteWebClient({ baseURL: BASE, apiKey: "k", timeoutMs: 1000 });
    const fetchStub = stubFetch(() =>
      json({
        provider: "serper-search",
        results: [
          {
            title: "Result one",
            url: "https://example.com/one",
            snippet: "snippet one",
            content: { format: "markdown", text: "full text", length: 9 },
            published_at: "2026-10-20T10:00:00.000Z",
          },
        ],
      })
    );
    try {
      const result = await registerWebSearch(
        host,
        client,
        resolveWebOptions({ search: { enabled: true, maxResults: 3 } }),
        "omniroute",
        "OmniRoute",
        silent
      );
      assert.equal(result.registered, true);
      assert.equal(added.length, 1);
      assert.equal(added[0]?.id, "omniroute");
      assert.equal(added[0]?.name, "OmniRoute");
      // Enabling the feature is the opt-in, so it also becomes the selection.
      assert.equal(selection.value, "omniroute");

      const results = await added[0]!.execute(
        { query: "hello" },
        { signal: new AbortController().signal }
      );
      assert.equal(results.length, 1);
      assert.equal(results[0]?.url, "https://example.com/one");
      assert.equal(results[0]?.title, "Result one");
      // `content.text` wins over `snippet` when the gateway extracted a page.
      assert.equal(results[0]?.content, "full text");
      assert.deepEqual(results[0]?.time, { published: Date.parse("2026-10-20T10:00:00.000Z") });

      const body = fetchStub.calls[0]?.body as Record<string, unknown>;
      assert.equal(body["query"], "hello");
      assert.equal(body["max_results"], 3);
      assert.equal(body["search_type"], "web");
      // OmniRoute owns provider selection: the plugin must not send one.
      assert.equal("provider" in body, false);
    } finally {
      fetchStub.restore();
    }
  });

  it("drops results without a URL and always returns a time object", () => {
    const results = toOpenCodeResults(
      [
        { url: "https://example.com/a" },
        { url: "https://example.com/b", publishedAt: "not-a-date" },
      ],
      5
    );
    assert.equal(results.length, 2);
    assert.deepEqual(results[0]?.time, {});
    assert.deepEqual(results[1]?.time, {});
  });

  it("caps the result list", () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ url: `https://example.com/${String(i)}` }));
    assert.equal(toOpenCodeResults(rows, 4).length, 4);
  });

  it("surfaces a gateway refusal without leaking the key", async () => {
    const { host, added } = searchHost();
    const client = new OmniRouteWebClient({ baseURL: BASE, apiKey: "super-secret-key", timeoutMs: 1000 });
    const fetchStub = stubFetch(() => json({ error: { message: "search provider unavailable" } }, 502));
    try {
      await registerWebSearch(
        host,
        client,
        resolveWebOptions({ search: { enabled: true } }),
        "omniroute",
        "OmniRoute",
        silent
      );
      await assert.rejects(
        added[0]!.execute({ query: "x" }, { signal: new AbortController().signal }),
        (err: Error) => {
          assert.match(err.message, /HTTP 502/);
          assert.match(err.message, /search provider unavailable/);
          assert.doesNotMatch(err.message, /super-secret-key/);
          return true;
        }
      );
    } finally {
      fetchStub.restore();
    }
  });

  it("reports malformed results as a failure rather than an empty answer", async () => {
    const { host, added } = searchHost();
    const client = new OmniRouteWebClient({ baseURL: BASE, apiKey: "k", timeoutMs: 1000 });
    const fetchStub = stubFetch(() => new Response("not json", { status: 200 }));
    try {
      await registerWebSearch(
        host,
        client,
        resolveWebOptions({ search: { enabled: true } }),
        "omniroute",
        "OmniRoute",
        silent
      );
      await assert.rejects(
        added[0]!.execute({ query: "x" }, { signal: new AbortController().signal }),
        /non-JSON|not an object/
      );
    } finally {
      fetchStub.restore();
    }
  });

  it("propagates caller cancellation as an abort", async () => {
    const client = new OmniRouteWebClient({ baseURL: BASE, apiKey: "k", timeoutMs: 5000 });
    const controller = new AbortController();
    const fetchStub = stubFetch(
      () =>
        new Promise<Response>((_resolve, reject) => {
          controller.signal.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        })
    );
    try {
      const pending = client.search({ query: "x", maxResults: 5 }, controller.signal);
      controller.abort();
      await assert.rejects(pending, (err: Error & { aborted?: boolean }) => {
        assert.equal(err.aborted, true);
        return true;
      });
    } finally {
      fetchStub.restore();
    }
  });
});
