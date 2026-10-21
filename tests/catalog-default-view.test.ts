import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectCatalog, isPublishableRawModelId } from "../src/catalog.js";
import { parsePluginOptions, toResolvedOptions } from "../src/options.js";

const baseOpts = {
  providerId: "omniroute",
  baseURL: "https://gw.example.com",
  apiKey: "k",
  timeoutMs: 1000,
  modelCacheTtlMs: 300000,
  usableOnly: false,
};

describe("the plugin publishes the whole catalog by default", () => {
  it("maps an absent visibleModels to the full view", () => {
    const resolved = toResolvedOptions(parsePluginOptions({ baseURL: "https://gw.example.com" }));
    assert.deepEqual(resolved.visibleModels, ["*"]);
  });

  it("keeps an explicit list as the operator wrote it", () => {
    const resolved = toResolvedOptions(
      parsePluginOptions({ baseURL: "https://gw.example.com", visibleModels: ["customprovider/*"] })
    );
    assert.deepEqual(resolved.visibleModels, ["customprovider/*"]);
  });

  it("does not cap models per provider when the default view is used", async () => {
    // Upstream's showcase view keeps ten models per owner. With the plugin's
    // default that cap must not apply, or a model the user already selected
    // disappears from the picker and reads as "unavailable".
    const raw = Array.from({ length: 25 }, (_, i) => ({
      id: `customprovider/model-${String(i)}`,
      owned_by: "customprovider",
      context_length: 1000,
    }));
    const collected = await collectCatalog(
      { ...baseOpts, visibleModels: ["*"] },
      { fetcher: async () => raw, combosFetcher: async () => [] }
    );
    assert.equal(collected.entries.size, 25);
  });

  it("still narrows when the operator asks for the showcase view", async () => {
    const raw = Array.from({ length: 25 }, (_, i) => ({
      id: `customprovider/model-${String(i)}`,
      owned_by: "customprovider",
      context_length: 1000,
    }));
    const collected = await collectCatalog(baseOpts, {
      fetcher: async () => raw,
      combosFetcher: async () => [],
    });
    assert.ok(collected.entries.size < 25, "an explicit narrow list keeps the cap");
  });
});

describe("prefix-only rows are not models", () => {
  it("rejects an id with nothing after the prefix", () => {
    assert.equal(isPublishableRawModelId("antigravity/"), false);
    assert.equal(isPublishableRawModelId("no-think/antigravity/"), false);
    assert.equal(isPublishableRawModelId("/leading"), false);
    assert.equal(isPublishableRawModelId(""), false);
    assert.equal(isPublishableRawModelId(undefined), false);
  });

  it("accepts a normal id, including a nested one", () => {
    assert.equal(isPublishableRawModelId("customprovider/kimi-k3"), true);
    assert.equal(isPublishableRawModelId("nvidia/black-forest-labs/flux.1-dev"), true);
    assert.equal(isPublishableRawModelId("bare-model"), true);
  });

  it("drops the blank row instead of publishing an empty model", async () => {
    const collected = await collectCatalog(
      { ...baseOpts, visibleModels: ["*"] },
      {
        fetcher: async () => [
          { id: "antigravity/" },
          { id: "no-think/antigravity/" },
          { id: "antigravity/gemini-3-flash" },
        ],
        combosFetcher: async () => [],
      }
    );
    assert.deepEqual([...collected.entries.keys()], ["omniroute/antigravity/gemini-3-flash"]);
  });
});
