# Migration and attribution

## From `@omniroute/opencode-plugin-v2`

```diff
  {
    "plugins": [
      {
-       "package": "@omniroute/opencode-plugin-v2",
+       "package": "@devvara/oc-omniroute-plugin",
        "options": {
          "baseURL": "http://localhost:20128",
          "apiKey": "…",
-         "managementReadToken": "…",
          "usableOnly": true
        }
      }
    ]
  }
```

What changed and why:

| Upstream                                      | Here                                       | Why                                                                                                                                                            |
|-----------------------------------------------|--------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `managementReadToken`                         | removed                                    | One key covers `/v1/*` and `/api/*`. A second credential most users do not have.                                                                               |
| `OMNIROUTE_MANAGEMENT_API_KEY`                | removed                                    | Same reason.                                                                                                                                                   |
| `usableOnly` default `false`                  | default `true`                             | The catalog should show what the gateway can route. The filter only drops proven-unroutable providers, so an inference-only key still yields the full catalog. |
| Titles like `openagentic - DeepSeek V4 Flash` | `OpenAgentic - DeepSeek V4 Flash`          | Provider first with operator casing (nodeName), humanized names, and clean repo prefixes.                                                                      |
| Plugin id `omniroute-v2`                      | `opencode-omniroute`                       | Distinct plugin, distinct id.                                                                                                                                  |
| Web tools require an MCP server               | `web.search` / `web.fetch`, off by default | Direct REST, no MCP, no second credential.                                                                                                                     |

Options keep their upstream names and meanings otherwise: `providerId`, `baseURL`, `apiKey`, `displayName`,
`visibleModels`, `hiddenModels`, `providersAllow`, `combosSource`, `freeOnly`, `toolsOnly`, `visionOnly`,
`modelCacheTtlMs`, `timeoutMs`, `timeouts`, `usageMemory`, `logLevel`, `startupDebug`, `apiFormat`,
`geminiSanitization`, `telemetry`, `providerTag`, `enrichment`.

No runtime aliases are provided for removed keys: a config that still carries `managementReadToken` fails to load and
names the unknown key, which is the intended outcome. Delete the line.

The two packages are independent. Remove the upstream one from `plugins` before enabling this one, so the same models
are not published twice.

## From the local `omniroute-prefix-titles` workaround

A local plugin that re-prefixed titles existed to make custom-provider models searchable. This package does that itself,
from the served prefix, so remove that plugin from `plugins`. Keeping both would double the marker
(`OpenAgentic - OpenAgentic - DeepSeek V4 Flash` is avoided, but two plugins writing the same titles is still a race).

The workaround's option names do not exist here. Anything it needed beyond `baseURL` and `apiKey` belongs in the options
table in [`configuration.md`](configuration.md).

## Removing the manual OmniRoute MCP server

Once `web.search` or `web.fetch` is enabled and verified, the OmniRoute MCP server entry in your OpenCode config is
redundant. This plugin does not remove it, and it does not load it either: delete it yourself when you no longer use it
for other tools. With the web tools disabled, keep it if you rely on it.

## Attribution

This package is a derivative of the MIT-licensed `@omniroute/opencode-plugin-v2` from the OmniRoute project. The
upstream copyright notice and license are reproduced in [`LICENSE`](../LICENSE), and the relationship is described in [
`NOTICE`](../NOTICE).

This project is **not** an official OmniRoute package and is **not** endorsed by or affiliated with OmniRoute or
OpenCode. It is maintained independently.
