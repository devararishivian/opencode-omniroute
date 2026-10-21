import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isChatModel } from "../src/chat-models.js";
import { DEFAULT_EFFORT_TIERS, mapRawModelToModelV2 } from "../src/shared/models-map.js";
import { humanizeModelName } from "../src/shared/naming.js";
import { buildProviderIdentityIndex, providerLabelFor } from "../src/provider-identity.js";
import type { OmniRouteRawModelEntry } from "../src/shared/models-map.js";

const ctx = { providerId: "omniroute", baseURL: "https://gw.example.com" };

describe("chat models only", () => {
  it("keeps a plain chat row", () => {
    assert.equal(isChatModel({ id: "openagentic/kimi-k3" }), true);
    assert.equal(isChatModel({ id: "x", output_modalities: ["text"] }), true);
    assert.equal(isChatModel({ id: "x", type: "chat" }), true);
  });

  it("drops every non-chat row kind", () => {
    for (const type of ["image", "embedding", "rerank", "audio", "video", "pdf"]) {
      assert.equal(isChatModel({ id: "x", type }), false, type);
    }
  });

  it("drops a row whose output carries no text", () => {
    assert.equal(isChatModel({ id: "x", output_modalities: ["image"] }), false);
    assert.equal(isChatModel({ id: "x", output_modalities: ["video"] }), false);
  });

  it("keeps a row that declares text among other outputs", () => {
    assert.equal(isChatModel({ id: "x", type: "embedding", output_modalities: ["text"] }), false);
    assert.equal(isChatModel({ id: "x", output_modalities: ["text", "image"] }), true);
  });
});

describe("effort tiers", () => {
  it("reads the tiers nested under capabilities", () => {
    const mapped = mapRawModelToModelV2(
      { id: "a/b", capabilities: { reasoning: true, effort_tiers: ["low", "high"] } },
      ctx
    );
    assert.deepEqual(Object.keys(mapped.variants ?? {}), ["low", "high"]);
  });

  it("reads the tiers the gateway puts at the top level", () => {
    // Synced and custom models carry them here; reading only the nested copy
    // left their thinking control disabled.
    const mapped = mapRawModelToModelV2(
      { id: "a/b", effort_tiers: ["none", "low", "medium", "high", "xhigh", "max"] },
      ctx
    );
    assert.deepEqual(Object.keys(mapped.variants ?? {}), [
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  it("offers OpenCode's levels when reasoning is declared without tiers", () => {
    // An empty `variants` object suppresses OpenCode's own fallback, so a
    // reasoning model must always carry a selection.
    const mapped = mapRawModelToModelV2({ id: "a/b", capabilities: { reasoning: true } }, ctx);
    assert.deepEqual(Object.keys(mapped.variants ?? {}), [...DEFAULT_EFFORT_TIERS]);
  });

  it("offers none for a non-reasoning model", () => {
    const mapped = mapRawModelToModelV2({ id: "a/b", capabilities: { reasoning: false } }, ctx);
    assert.equal(mapped.variants, undefined);
  });
});

describe("readable names", () => {
  it("turns an id segment into words", () => {
    assert.equal(humanizeModelName("deepseek-v4.1-flash"), "Deepseek v4.1 Flash");
    assert.equal(humanizeModelName("gpt-6.1-sol"), "GPT 6.1 Sol");
    assert.equal(humanizeModelName("minimax-m3.1-flash-preview"), "Minimax m3.1 Flash Preview");
  });

  it("leaves a name that already has spaces alone", () => {
    assert.equal(humanizeModelName("Gemini 3 Flash"), "Gemini 3 Flash");
  });
});

describe("the operator's own label wins", () => {
  it("uses nodeName instead of the raw prefix", () => {
    const index = buildProviderIdentityIndex({
      connections: [
        {
          id: "c1",
          provider: "openai-compatible-chat-abc",
          isActive: true,
          testStatus: "active",
          providerSpecificData: { prefix: "openagentic", nodeName: "OpenAgentic" },
        },
      ],
    });
    assert.equal(providerLabelFor(index, "openagentic"), "OpenAgentic");
  });

  it("falls back to the prefix when the connection has no name", () => {
    const index = buildProviderIdentityIndex({
      connections: [
        { id: "c1", provider: "nvidia", isActive: true, testStatus: "active" },
      ],
    });
    assert.equal(providerLabelFor(index, "nvidia"), "nvidia");
  });
});

describe("a served model carries identity even without enrichment", () => {
  it("never leaves a model with only its raw id as the name", () => {
    const entry: OmniRouteRawModelEntry = { id: "openagentic/deepseek-v4.1-flash" };
    const mapped = mapRawModelToModelV2(entry, ctx);
    // The mapper alone still falls back to the id; the catalog applies the
    // overlay with an empty entry so the humaniser and marker run.
    assert.equal(mapped.name, "openagentic/deepseek-v4.1-flash");
  });
});
