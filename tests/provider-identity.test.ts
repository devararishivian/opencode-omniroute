import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildProviderIdentityIndex,
  isGeneratedNodeId,
  mergeProviderMetadata,
  providerAliasesFor,
  providerLabelFor,
  providerUsability,
  resolveProviderForModel,
  servedPrefixOf,
  wrapperOf,
} from "../src/provider-identity.js";
import { defaultOmniRouteEnrichmentFetcher, lookupEnrichment, buildCanonicalToAliasMap } from "../src/shared/enrich.js";
import { usableProviderAliasSet, isUsableRawModelId } from "../src/shared/usable.js";
import type { OmniRouteProviderConnection } from "../src/shared/usable.js";
import { buildModelDisplayName } from "../src/shared/naming.js";

/**
 * The exact shape observed on a live gateway: the connection names the public
 * prefix in `providerSpecificData.prefix`, the pricing slot is keyed by the
 * generated node id and repeats the prefix in `displayPrefix`.
 */
const NODE_ID = "openai-compatible-chat-7f3c1e8a-2b4d-4c9e-9a11-5d6e7f8a9b0c";

const connections: OmniRouteProviderConnection[] = [
  {
    id: "conn-1",
    provider: NODE_ID,
    isActive: true,
    testStatus: "active",
    providerSpecificData: { prefix: "customprovider" },
  },
];

const pricingBody = {
  providers: {
    [NODE_ID]: {
      id: NODE_ID,
      alias: NODE_ID,
      name: "Openai-compatible-chat-7f3c1e8a",
      displayPrefix: "customprovider",
      models: [
        { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
        { id: "kimi-k3", name: "Kimi K3" },
      ],
    },
  },
};

const pricingValues = {
  [NODE_ID]: {
    "deepseek-v4-flash": { input: 0.14, output: 0.28, cached: 0.01 },
  },
};

function stubGateway() {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/pricing/models")) {
      return new Response(JSON.stringify(pricingBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/pricing")) {
      return new Response(JSON.stringify(pricingValues), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ perModel: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe("provider identity from a UUID-keyed pricing slot", () => {
  it("uses displayPrefix, not the slot key, as the public prefix", async () => {
    const restore = stubGateway();
    try {
      const enrichment = await defaultOmniRouteEnrichmentFetcher("https://gw.example.com", "k", 1000);
      const entry = enrichment.get("customprovider/deepseek-v4-flash");
      assert.ok(entry, "the slot must be indexed under its public prefix");
      assert.equal(entry.providerAlias, "customprovider");
      assert.equal(entry.displayPrefix, "customprovider");
      assert.equal(entry.providerCanonical, NODE_ID);
      assert.equal(entry.slotKey, NODE_ID);
      // The node-keyed price is joined through the slot key, so it lands on
      // the public prefix instead of a key nothing reads.
      assert.equal(entry.pricing?.input, 0.14);
      assert.equal(entry.pricing?.output, 0.28);
      assert.equal(entry.pricing?.cacheRead, 0.01);
      // No entry may be keyed by the generated node id: nothing serves it.
      assert.equal(enrichment.get(`${NODE_ID}/deepseek-v4-flash`), undefined);
    } finally {
      restore();
    }
  });

  it("resolves the served prefix to the connection, label and state", async () => {
    const restore = stubGateway();
    try {
      const enrichment = await defaultOmniRouteEnrichmentFetcher("https://gw.example.com", "k", 1000);
      const index = buildProviderIdentityIndex({ connections, enrichment });
      const identity = resolveProviderForModel(index, "customprovider/deepseek-v4-flash");
      assert.ok(identity);
      assert.equal(identity.prefix, "customprovider");
      assert.equal(identity.label, "customprovider");
      assert.equal(identity.canonical, NODE_ID);
      assert.equal(identity.verified, true);
      assert.deepEqual(identity.state, { configured: true, active: true, health: "active" });
      assert.equal(providerUsability(index, "customprovider"), "usable");
      // The canonical spelling resolves to the same identity.
      assert.equal(providerLabelFor(index, NODE_ID), "customprovider");
      assert.deepEqual(
        [...providerAliasesFor(index, NODE_ID)].sort(),
        ["customprovider", NODE_ID].sort()
      );
    } finally {
      restore();
    }
  });

  it("never puts a generated node id in a title", async () => {
    const restore = stubGateway();
    try {
      const enrichment = await defaultOmniRouteEnrichmentFetcher("https://gw.example.com", "k", 1000);
      const index = buildProviderIdentityIndex({ connections, enrichment });
      // Even a model id that *is* the node id falls back to the configured
      // prefix, because a UUID is not a name a human can search for.
      const identity = resolveProviderForModel(index, `${NODE_ID}/some-model`);
      assert.ok(identity);
      assert.equal(isGeneratedNodeId(identity.label), false);
      assert.equal(identity.label, "customprovider");
    } finally {
      restore();
    }
  });

  it("still finds the price when only the canonical alias is known", async () => {
    const restore = stubGateway();
    try {
      const enrichment = await defaultOmniRouteEnrichmentFetcher("https://gw.example.com", "k", 1000);
      const canonicalToAlias = buildCanonicalToAliasMap(enrichment);
      const hit = lookupEnrichment(
        `${NODE_ID}/deepseek-v4-flash`,
        enrichment,
        canonicalToAlias
      );
      assert.ok(hit);
      assert.equal(hit.providerAlias, "customprovider");
    } finally {
      restore();
    }
  });
});

describe("nested namespaces", () => {
  it("takes the provider from behind a known wrapper namespace", () => {
    // `no-think` wraps a provider; the request routes to the segment after it.
    // The earlier rule (first segment = provider) labelled every wrapped model
    // `no-think`, which merged models served by different connections.
    assert.equal(servedPrefixOf("no-think/customprovider/deepseek-v4-flash"), "customprovider");
    assert.equal(servedPrefixOf("no-think/myprovider/claude-opus-5"), "myprovider");
    assert.equal(servedPrefixOf("customprovider/deepseek-v4-flash"), "customprovider");
    assert.equal(servedPrefixOf("bare-model"), undefined);
  });

  it("keeps an unknown first segment as the provider, never relabels it", () => {
    // A genuinely new provider must not be mistaken for a wrapper.
    assert.equal(servedPrefixOf("brandnew/x/y"), "brandnew");
    assert.equal(wrapperOf("brandnew/x/y"), undefined);
  });

  it("reports the wrapper separately so titles can keep it", () => {
    assert.equal(wrapperOf("no-think/customprovider/x"), "no-think");
    assert.equal(wrapperOf("customprovider/x"), undefined);
  });

  it("resolves a wrapped id to the provider it routes to", () => {
    const index = buildProviderIdentityIndex({ connections });
    const wrapped = resolveProviderForModel(index, "no-think/customprovider/deepseek-v4-flash");
    assert.ok(wrapped);
    assert.equal(wrapped.prefix, "customprovider");
    assert.equal(wrapped.label, "customprovider");
  });
});

describe("identity precedence", () => {
  it("prefers the served prefix over owned_by", () => {
    const index = buildProviderIdentityIndex({ connections });
    const identity = resolveProviderForModel(index, "customprovider/x", "someone-else");
    assert.equal(identity?.label, "customprovider");
    assert.equal(identity?.verified, true);
  });

  it("uses owned_by only for a bare id", () => {
    const index = buildProviderIdentityIndex({ connections });
    const identity = resolveProviderForModel(index, "x", "customprovider");
    assert.equal(identity?.label, "customprovider");
  });

  it("keeps an unknown prefix unknown rather than borrowing a label", () => {
    const index = buildProviderIdentityIndex({ connections });
    const identity = resolveProviderForModel(index, "mystery/model");
    assert.equal(identity?.label, "mystery");
    assert.equal(identity?.verified, false);
    assert.equal(identity?.state, undefined);
  });

  it("returns nothing for a bare id with no owner claim", () => {
    const index = buildProviderIdentityIndex({ connections });
    assert.equal(resolveProviderForModel(index, "bare-model"), undefined);
  });

  it("fills gaps without overwriting a resolved value", () => {
    assert.deepEqual(
      mergeProviderMetadata({ label: "customprovider" }, { label: "other", canonical: "c" }),
      { label: "customprovider", canonical: "c" }
    );
  });
});

describe("usableOnly uses the same vocabulary", () => {
  it("keeps a model whose connection is active but absent from pricing", () => {
    // The connection names the prefix; the pricing slot never lists this
    // model. Without `providerSpecificData.prefix` in the vocabulary, the
    // prefix would be unknown and (worse) could be dropped by a stricter
    // filter. It must be kept.
    const usable = usableProviderAliasSet(connections, undefined);
    assert.equal(isUsableRawModelId("customprovider/never-priced", usable), true);
  });

  it("drops a model whose connection is explicitly disabled", () => {
    const disabled: OmniRouteProviderConnection[] = [
      {
        id: "conn-2",
        provider: NODE_ID,
        isActive: false,
        providerSpecificData: { prefix: "customprovider" },
      },
    ];
    const usable = usableProviderAliasSet(disabled, undefined);
    assert.equal(isUsableRawModelId("customprovider/deepseek-v4-flash", usable), false);
    const index = buildProviderIdentityIndex({ connections: disabled });
    assert.equal(providerUsability(index, "customprovider"), "unusable");
  });

  it("drops a model whose health check failed", () => {
    const unhealthy: OmniRouteProviderConnection[] = [
      {
        id: "c",
        provider: NODE_ID,
        isActive: true,
        testStatus: "error",
        providerSpecificData: { prefix: "customprovider" },
      },
    ];
    const index = buildProviderIdentityIndex({ connections: unhealthy });
    assert.equal(providerUsability(index, "customprovider"), "unusable");
  });

  it("treats a missing isActive as no opinion, not as disabled", () => {
    const unknownToggle: OmniRouteProviderConnection[] = [{ id: "c", provider: NODE_ID }];
    const usable = usableProviderAliasSet(unknownToggle, undefined);
    assert.equal(isUsableRawModelId(`${NODE_ID}/x`, usable), true);
    const index = buildProviderIdentityIndex({ connections: unknownToggle });
    assert.equal(providerUsability(index, NODE_ID), "usable");
  });

  it("keeps unknown prefixes when the management endpoint is unavailable", () => {
    // No connections at all: the filter cannot be evaluated, so it must not
    // drop anything.
    const usable = usableProviderAliasSet([], undefined);
    assert.equal(isUsableRawModelId("customprovider/deepseek-v4-flash", usable), true);
    assert.equal(isUsableRawModelId("myprovider/whatever", usable), true);
  });
});

describe("display titles", () => {
  it("leads with the capitalised provider, then the model name", () => {
    assert.equal(
      buildModelDisplayName({
        rawId: "customprovider/deepseek-v4-flash",
        enrichmentName: "DeepSeek V4 Flash",
        providerLabel: "customprovider",
      }),
      "Customprovider - DeepSeek V4 Flash"
    );
  });

  it("strips the prefix and humanises a base name that is only the id", () => {
    // Without this the title repeats the id the picker already shows; the
    // humaniser then turns the model segment into readable words.
    assert.equal(
      buildModelDisplayName({
        rawId: "customprovider/deepseek-v4-flash",
        providerLabel: "customprovider",
      }),
      "Customprovider - Deepseek v4 Flash"
    );
  });

  it("does not add a second provider to an already-tagged name", () => {
    assert.equal(
      buildModelDisplayName({
        rawId: "x",
        enrichmentName: "Customprovider - DeepSeek V4 Flash",
        providerLabel: "customprovider",
      }),
      "Customprovider - DeepSeek V4 Flash"
    );
  });

  it("keeps the free marker and budget around the name", () => {
    assert.equal(
      buildModelDisplayName({
        rawId: "customprovider/free-model",
        enrichmentName: "Free Model",
        providerLabel: "customprovider",
        isFree: true,
        freeType: "recurring-daily",
        monthlyTokens: 25_000_000,
      }),
      "[Free] Customprovider - Free Model · 25M tokens/day"
    );
  });

  it("never tags a combo", () => {
    assert.equal(
      buildModelDisplayName({
        rawId: "combo-fast",
        enrichmentName: "Combo Fast",
        providerLabel: "customprovider",
        isCombo: true,
      }),
      "Combo Fast"
    );
  });

  it("makes every custom-provider model findable by its prefix", () => {
    // The TUI fuzzy-matches titles; the model id is not a search key.
    const names = ["customprovider/a", "customprovider/b", "no-think/customprovider/c"].map((rawId) =>
      buildModelDisplayName({
        rawId,
        enrichmentName: `Model ${rawId}`,
        providerLabel: servedPrefixOf(rawId),
        namespace: wrapperOf(rawId),
      })
    );
    assert.equal(names.filter((name) => name.includes("Customprovider")).length, 3);
    assert.equal(names.filter((name) => name.startsWith("No-think - Customprovider - ")).length, 1);
  });
});
