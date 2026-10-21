import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectCatalog, buildProviderPayload } from "../src/catalog.js";

const baseOpts = {
  providerId: "omniroute",
  apiKey: "k",
  timeoutMs: 1000,
  modelCacheTtlMs: 300000,
  usableOnly: false,
  visibleModels: ["*"],
  enrichment: false,
} as Record<string, unknown>;

async function publish(
  models: Array<Record<string, unknown>>,
  enrichment = new Map<string, unknown>()
) {
  const opts = { ...baseOpts, baseURL: "https://gw.example.com", enrichment: true };
  const collected = await collectCatalog(opts as never, {
    models: async () => models as never,
    combos: async () => [],
    providers: async () => [],
    enrichment: async () => enrichment as never,
  });
  return buildProviderPayload(collected, opts as never) as {
    models: Array<{ modelID: string; name: string; variants?: Array<{ id: string }> }>;
  };
}

describe("non-chat rows never reach the picker", () => {
  it("drops image, video, embedding, rerank and audio models", async () => {
    const payload = await publish([
      { id: "openrouter/openai/whisper-1", type: "audio" },
      { id: "openrouter/google/veo-3.1", output_modalities: ["video"] },
      { id: "openrouter/baai/bge-m3", type: "embedding" },
      { id: "openrouter/cohere/rerank-v3.5", type: "rerank" },
      { id: "openrouter/openai/gpt-image-2.5-flare", output_modalities: ["image"] },
      { id: "openagentic/kimi-k3", output_modalities: ["text"] },
    ]);
    assert.deepEqual(
      payload.models.map((m) => m.modelID),
      ["openagentic/kimi-k3"]
    );
  });

  it("drops image and embedding models even when the gateway provides no type or modalities", async () => {
    // Upstream gateway sometimes omits `type` and `output_modalities` on image
    // generation or embedding rows (e.g. `ali-qwen-image-*`, `nemotron-*-embed-*`).
    // These cannot handle chat completions and must never reach the chat picker.
    const payload = await publish([
      { id: "openagentic/ali-qwen-image-2.0-pro" },
      { id: "openagentic/ali-wan2.7-image" },
      { id: "openagentic/ali-z-image-turbo" },
      { id: "nvidia/nvidia/nemotron-3.5-embed-1b" },
      { id: "openagentic/deepseek-v4-flash-vision-exp" }, // vision chat is kept!
      { id: "openagentic/kimi-k3" },
    ]);
    assert.deepEqual(
      payload.models.map((m) => m.modelID),
      ["openagentic/deepseek-v4-flash-vision-exp", "openagentic/kimi-k3"]
    );
  });
});

describe("flat effort rows fold into their base model", () => {
  it("drops the level row when the base is served", async () => {
    // The base model already offers every level as a variant, so publishing
    // `kimi-k3-high` as its own model shows a duplicate with another name.
    const payload = await publish([
      { id: "openagentic/kimi-k3", capabilities: { reasoning: true, effort_tiers: ["low", "high"] } },
      { id: "openagentic/kimi-k3-high", capabilities: { reasoning: true } },
      { id: "openagentic/kimi-k3-low", capabilities: { reasoning: true } },
    ]);
    assert.deepEqual(
      payload.models.map((m) => m.modelID),
      ["openagentic/kimi-k3"]
    );
  });

  it("keeps the level row when its base is not served", async () => {
    const payload = await publish([{ id: "openagentic/model-high", capabilities: { reasoning: true } }]);
    assert.deepEqual(
      payload.models.map((m) => m.modelID),
      ["openagentic/model-high"]
    );
  });
});

describe("names come from the operator and the id", () => {
  it("uses nodeName and humanises an id-only name", async () => {
    const opts = { ...baseOpts, baseURL: "https://gw.example.com", enrichment: true };
    const collected = await collectCatalog(opts as never, {
      models: async () => [{ id: "openagentic/deepseek-v4.1-flash" }] as never,
      combos: async () => [],
      providers: async () =>
        [
          {
            id: "c1",
            provider: "openai-compatible-chat-abc",
            isActive: true,
            testStatus: "active",
            providerSpecificData: { prefix: "openagentic", nodeName: "OpenAgentic" },
          },
        ] as never,
      enrichment: async () => new Map(),
    });
    const payload = buildProviderPayload(collected, opts as never) as {
      models: Array<{ name: string }>;
    };
    assert.equal(payload.models[0]?.name, "OpenAgentic - Deepseek v4.1 Flash");
  });

  it("keeps the free marker on an id that ends in -free", async () => {
    const payload = await publish([
      { id: "openagentic/deepseek-v4.1-flash" },
      { id: "openagentic/deepseek-v4.1-flash-free" },
    ]);
    const free = payload.models.find((m) => m.modelID.endsWith("-free"));
    assert.ok(free);
    assert.equal(free.name, "[Free] Openagentic - Deepseek v4.1 Flash");
  });

  it("keeps nested namespaces distinguishable in titles", async () => {
    // `no-think/cosmoshub/x` and `no-think/openagentic/x` both route through the
    // no-think wrapper to different connections. The title must name the
    // connection, otherwise the two read as one model.
    const payload = await publish([
      { id: "no-think/cosmoshub/claude-opus-5" },
      { id: "no-think/openagentic/claude-opus-5" },
    ]);
    const names = payload.models.map((m) => m.name);
    assert.equal(new Set(names).size, 2, JSON.stringify(names));
    assert.ok(names.some((n) => n.includes("Cosmoshub")), JSON.stringify(names));
    assert.ok(names.some((n) => n.includes("Openagentic")), JSON.stringify(names));
  });

  it("keeps two providers' identical model names distinguishable", async () => {
    const payload = await publish([
      { id: "openagentic/kimi-k3" },
      { id: "cosmoshub/kimi-k3" },
    ]);
    assert.equal(new Set(payload.models.map((m) => m.name)).size, 2);
  });

  it("deduplicates case-insensitive duplicate model IDs from the gateway", async () => {
    // Gateway sometimes serves both `openagentic/deepseek-v4-pro` and
    // `openagentic/DeepSeek-V4-Pro`. Publishing both shows two nearly identical rows.
    const payload = await publish([
      { id: "openagentic/deepseek-v4-pro" },
      { id: "openagentic/DeepSeek-V4-Pro" },
    ]);
    assert.equal(payload.models.length, 1);
    assert.equal(payload.models[0]?.modelID, "openagentic/deepseek-v4-pro");
  });

  it("cleans repository org prefixes from model display names", async () => {
    // Upstream enrichment names like `deepseek-ai/deepseek-v4.1-flash` or
    // `z-ai/glm-5.3-flash` shouldn't leak the repo slash into the title.
    const payload = await publish([
      { id: "nvidia/deepseek-ai/deepseek-v4.1-flash" },
      { id: "nvidia/z-ai/glm-5.3-flash" },
    ]);
    const names = payload.models.map((m) => m.name);
    assert.ok(names.some((n) => n.includes("Nvidia") && n.includes("Deepseek v4.1 Flash")));
    assert.ok(!names.some((n) => n.includes("deepseek-ai/")));
    assert.ok(names.some((n) => n.includes("Nvidia") && n.includes("GLM 5.3 Flash")));
    assert.ok(!names.some((n) => n.includes("z-ai/")));
  });
});

describe("pricing and free badges", () => {
  it("emits empty cost array for unpriced non-free models to prevent fake Free badges", async () => {
    // OpenCode checks `cost.length > 0 && cost.every(c => c.input === 0)` to show a "Free" badge.
    // If an unpriced model is given `cost: [{ input: 0, output: 0 }]`, OpenCode displays "Free"
    // even for expensive models. Unpriced models must emit `cost: []` so OpenCode displays no Free badge.
    const payload = await publish([
      { id: "openagentic/kimi-k3" }, // unpriced paid model -> cost: []
      { id: "openagentic/deepseek-v4.1-flash-free" }, // explicitly free model -> cost: [{ input: 0, output: 0 }]
      { id: "antigravity/gemini-3.1-pro", pricing: { input: 1.5, output: 5 } }, // priced model -> cost: [{ input: 1.5, ... }]
    ]) as unknown as {
      models: Array<{ modelID: string; cost: Array<{ input: number; output: number }> }>;
    };

    const unpriced = payload.models.find((m) => m.modelID === "openagentic/kimi-k3");
    assert.ok(unpriced);
    assert.deepEqual(unpriced.cost, []);

    const free = payload.models.find((m) => m.modelID === "openagentic/deepseek-v4.1-flash-free");
    assert.ok(free);
    assert.equal(free.cost.length, 1);
    assert.equal(free.cost[0]?.input, 0);

    const priced = payload.models.find((m) => m.modelID === "antigravity/gemini-3.1-pro");
    assert.ok(priced);
    assert.equal(priced.cost.length, 1);
    assert.equal(priced.cost[0]?.input, 1.5);
  });
});
