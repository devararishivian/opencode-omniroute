# Configuration

`@devvara/oc-omniroute-plugin` connects OpenCode to an OmniRoute gateway. It
publishes the gateway's model catalog, fixes custom-provider identity, and can
optionally route OpenCode's native web tools through OmniRoute REST.

```json
{
  "plugins": [
    {
      "package": "@devvara/oc-omniroute-plugin",
      "options": {
        "baseURL": "http://localhost:20128",
        "apiKey": "…"
      }
    }
  ]
}
```

## Requirements

| Component           | Version                       |
|---------------------|-------------------------------|
| OpenCode plugin API | `@opencode/plugin >=2.1.0 <3` |
| OmniRoute gateway   | `>=3.8.52`                    |
| Node.js             | `>=22.22.3`                   |

## One key

The plugin uses exactly one credential: the key that connects OpenCode to
OmniRoute. The same value authenticates `/v1/models`, `/v1/search`,
`/v1/web/fetch`, and every `/api/*` metadata request.

Resolution order: `apiKey` option, then `OMNIROUTE_API_KEY`.

There is no management-token option. If that key has no management scope, the
gateway refuses `/api/*` and the plugin publishes the served catalog without
enrichment: no display names, no provider markers beyond what `/v1/models`
gives you, no pricing overlay, and `usableOnly` falls back to keeping every
model. Models keep working; only metadata degrades. The plugin logs one line
naming the endpoint and what is lost.

Credentials are never logged. Avoid putting keys in a committed
`opencode.json`; `opencode auth` or the environment is preferable.

## Options

Unknown keys are rejected with a message naming the key, because a silently
ignored option is worse than a load failure.

| Option               | Default             | Meaning                                                                |
|----------------------|---------------------|------------------------------------------------------------------------|
| `baseURL`            | — (required)        | Gateway URL, with or without a trailing `/v1`                          |
| `apiKey`             | `OMNIROUTE_API_KEY` | The one key, used for every endpoint                                   |
| `providerId`         | `omniroute`         | OpenCode provider id and model-ID prefix                               |
| `displayName`        | `OmniRoute`         | Provider name, also used as the websearch provider name                |
| `usableOnly`         | `true`              | Keep only models the gateway can actually route                        |
| `enrichment`         | `true`              | Fetch names, prices and free-tier data from `/api/*`                   |
| `providerTag`        | `true`              | Append the served prefix to every model title                          |
| `visibleModels`      | all                 | Allowlist by full id or bare suffix; `"*"` disables                    |
| `hiddenModels`       | none                | Denylist by full id or bare suffix                                     |
| `providersAllow`     | none                | Keep only these upstream providers                                     |
| `combosSource`       | `"api"`             | `"api"` folds `/api/combos`; `"models"` skips it                       |
| `freeOnly`           | `false`             | Publish free-tier models only                                          |
| `toolsOnly`          | `false`             | Publish tool-calling models only                                       |
| `visionOnly`         | `false`             | Publish vision models only                                             |
| `modelCacheTtlMs`    | `300000`            | Catalog cache lifetime                                                 |
| `timeoutMs`          | `10000`             | Default per-request timeout                                            |
| `timeouts`           | —                   | Per-endpoint overrides: `models`, `combos`, `autoCombos`, `enrichment` |
| `usageMemory`        | `true`              | Restore recently used models the default view dropped                  |
| `logLevel`           | `"warn"`            | `error`, `warn`, `info`, `debug`                                       |
| `startupDebug`       | `false`             | Force debug logging at startup                                         |
| `apiFormat`          | —                   | `allowAnthropic`, `anthropicModels`, `anthropicPrefixes`               |
| `geminiSanitization` | `true`              | Strip tool-schema keywords Gemini rejects                              |
| `telemetry`          | `false`             | Mark inference telemetry on the SDK options                            |
| `web`                | both off            | See below                                                              |

### Web tools

Search and fetch are independent, and both are off by default.

```json
{
  "web": {
    "timeoutMs": 30000,
    "search": {
      "enabled": false,
      "maxResults": 5
    },
    "fetch": {
      "enabled": false,
      "fallbackToNative": true,
      "includeMetadata": true
    }
  }
}
```

`web.search.enabled` registers OmniRoute as an OpenCode web-search provider and
selects it. It only calls `POST /v1/search`; it never changes your other tools.

`web.fetch.enabled` replaces OpenCode's built-in `webfetch` with a gateway-backed
one for every caller. Because that is a bigger change than adding a provider,
it is a separate switch. The replacement:

- asks for the same `webfetch` permission, with the URL as the resource, before
  any request — a denial is never turned into a gateway request;
- keeps the native input and output shape, including the 1..120 second timeout;
- maps the native `text` format to the gateway's `markdown` (the gateway serves
  `markdown`, `html`, `links` and `screenshot`, and has no plain-text format);
- falls back to the captured built-in tool when the gateway fails, unless
  `fallbackToNative` is `false`;
- does not fall back when the turn itself was cancelled.

Both tools omit the `provider` field on purpose. OmniRoute then selects among
the search/fetch providers its operator configured and handles failover. The
plugin adds no routing heuristics of its own.

MCP is not involved: the plugin never registers, replaces, or requires an
OmniRoute MCP server.

## Display names

Titles lead with the model name and end with the provider prefix it routes to:

```text
DeepSeek V4 Flash (openagentic)
[Free] DeepSeek V4 Flash (openagentic) · 25M tokens/day
```

The prefix is what makes a provider findable: the picker searches titles, not
model IDs. `providerTag: false` removes it and brings back the original
"cannot find it by provider name" problem.

A prefix is never a generated connection id such as
`openai-compatible-chat-<uuid>`. Nested ids keep their first segment (`no-think/openagentic/...` belongs to `no-think`),
because that is what the
request routes to.

## Management endpoints and degradation

`/api/providers` drives `usableOnly`, `/api/pricing/models` plus `/api/pricing`
drive names and prices, `/api/combos` drives combos, `/api/free-tier/summary`
drives free budgets. Each is optional:

- a refusal or failure keeps the last known value (memory or the on-disk
  snapshot) and warns once per endpoint;
- with no last known value, the catalog publishes from `/v1/models` alone;
- an empty successful answer is treated as a real answer, not an outage.

`usableOnly` drops only what it can prove unroutable: a connection that is
explicitly disabled, or whose health check reported something other than
`active`. Models whose prefix the gateway never described stay published,
because absence of metadata is not evidence of a broken connection.
