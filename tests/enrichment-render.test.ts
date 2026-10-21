import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyEnrichment } from "../src/shared/enrich.js";
import type { LegacyModel as ModelV2 } from "../src/legacy-model.js";

function model(id: string, name = id): ModelV2 {
  return {
    id,
    name,
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  } as unknown as ModelV2;
}

describe("the enrichment overlay reaches the picker", () => {
  it("renders the upstream provider a model routes to", () => {
    const m = applyEnrichment(model("cc/sonnet"), {
      name: "the model 4.6",
      providerDisplayName: "Claude",
      providerAlias: "cc",
    });
    assert.equal(m.name, "Cc - the model 4.6");
  });

  it("marks a free model and states the budget the user actually gets", () => {
    const m = applyEnrichment(model("pol/grok"), {
      name: "Grok 4 Fast",
      providerDisplayName: "Pollinations",
      providerAlias: "pol",
      freeType: "recurring-monthly" as const,
      monthlyTokens: 1_000_000,
    });
    assert.match(m.name, /\[Free\]/);
    assert.match(m.name, /Grok 4 Fast/);
    assert.match(
      m.name,
      /tokens\/month/,
      "the budget the gateway reports is stated, not just the fact it is free"
    );
    assert.equal(m.name, "[Free] Pol - Grok 4 Fast · 1M tokens/month");
  });

  it("drops the tag when the caller turns it off", () => {
    const m = applyEnrichment(
      model("cc/sonnet"),
      { name: "the model 4.6", providerDisplayName: "Claude" },
      { providerTag: false }
    );
    assert.equal(m.name, "the model 4.6");
  });

  it("prefers the resolved provider label over the enrichment alias", () => {
    // The identity index resolves the served prefix; the enrichment row only
    // knows its own slot key, which may be a node id.
    const m = applyEnrichment(
      model("customprovider/deepseek-v4-flash"),
      { name: "DeepSeek V4 Flash", providerAlias: "openai-compatible-chat-abc" },
      { providerLabel: "customprovider" }
    );
    assert.equal(m.name, "Customprovider - DeepSeek V4 Flash");
  });

  it("never tags a combo: it routes across providers, not to one", () => {
    const m = applyEnrichment(
      model("combo-fast", "Combo Fast"),
      { name: "Combo Fast", providerDisplayName: "Claude" },
      { isCombo: true }
    );
    assert.equal(m.name, "Combo Fast");
  });

  it("still overlays pricing", () => {
    const m = applyEnrichment(model("x"), { pricing: { input: 3, output: 15 } });
    assert.equal(m.cost.input, 3);
    assert.equal(m.cost.output, 15);
  });
});

describe("free budget under alias and without cap", () => {
  it("renders the budget of an alias-served model", () => {
    const m = applyEnrichment(model("cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast"), {
      name: "Llama 3.3 70B",
      providerDisplayName: "Cloudflare",
      providerAlias: "cf",
      freeType: "recurring-monthly" as const,
      monthlyTokens: 1_000_000,
    });
    assert.equal(m.name, "[Free] Cf - Llama 3.3 70B · 1M tokens/month");
  });

  it("renders the uncapped label with no counters", () => {
    const m = applyEnrichment(model("cf/open-m"), {
      name: "Open Model",
      providerDisplayName: "Cloudflare",
      providerAlias: "cf",
      freeType: "recurring-uncapped" as const,
    });
    assert.match(m.name, /\(uncapped\)/);
  });

  it("renders nothing extra when the budget is unknown", () => {
    const m = applyEnrichment(model("cf/open-m"), { name: "Open Model" });
    assert.ok(!m.name.includes("·"));
  });
});
