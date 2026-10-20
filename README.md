# oc-omniroute-plugin

An independent OpenCode V2 plugin that connects [OmniRoute](https://github.com/diegosouzapw/OmniRoute) as a custom
provider, publishes its model catalog, and can optionally route OpenCode's native web tools through OmniRoute's REST
API.

```sh
bun add -d @devvara/oc-omniroute-plugin
```

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

- **Plugin id:** `opencode-omniroute`
- **Provider id:** `omniroute` (configurable)
- **Requires:** OpenCode `@opencode/plugin >=2.1.0 <3`, OmniRoute `>=3.8.52`, Node.js `>=22.22.3`

## What it does

- Publishes every model the gateway serves, with capabilities, modalities, limits, pricing, free-tier budgets, combos,
  and reasoning/effort variants as OpenCode variants.
- Resolves custom-provider identity from the *served* prefix, so a compatible provider node keyed by
  `openai-compatible-chat-<uuid>` still gets its real name, prices, and a searchable title.
- Titles read name-first, with the provider last: `DeepSeek V4 Flash (openagentic)`. The picker searches titles, not
  model ids, so this is what makes a provider findable.
- `usableOnly` (on by default) hides models whose upstream connection is explicitly disabled or unhealthy, and keeps
  anything it cannot prove unroutable.
- Optionally replaces `websearch` and `webfetch` with OmniRoute-backed versions. Both are **off by default**, both call
  `/v1/search` and `/v1/web/fetch` directly, and neither needs an MCP server.

## One key

The plugin uses the same key that connects OpenCode to OmniRoute, for `/v1/*` and `/api/*`. There is no second
management token. If that key has no management scope the gateway refuses the metadata endpoints, and the plugin
publishes the catalog without enrichment instead of failing: models keep working, names and prices degrade, and one log
line says which endpoint was refused.

Prefer `OMNIROUTE_API_KEY` or `opencode auth` over a key written into a committed config file.

## Optional web tools

```json
{
  "web": {
    "search": {
      "enabled": true
    },
    "fetch": {
      "enabled": true,
      "fallbackToNative": true
    }
  }
}
```

Search adds OmniRoute as a web-search provider and selects it. Fetch replaces the built-in `webfetch` for every caller,
which is why it is a separate switch; it keeps the native input/output contract, asks for the native `webfetch`
permission with the URL as the resource before any request, and falls back to the built-in tool when the gateway fails.

Neither tool sends a `provider` field: OmniRoute chooses among its own configured providers and handles failover.

## Documentation

- [Configuration](docs/configuration.md) — every option, defaults, and what degrades when the gateway cannot answer.
- [Migration and attribution](docs/migration.md) — moving off the upstream plugin or the local title workaround.

## Compatibility

Built against `@opencode/plugin` 2.1.0 and OmniRoute 3.8.52. Options from the upstream
`@omniroute/opencode-plugin-v2` keep their names except `managementReadToken`, which no longer exists; a config that
still carries it fails to load and names the key, so the fix is visible rather than silent.

## License and attribution

MIT. This package is a derivative of the MIT-licensed `@omniroute/opencode-plugin-v2` from the OmniRoute project; the
upstream copyright notice is preserved in [LICENSE](LICENSE) and the relationship is described in [NOTICE](NOTICE).

This is an independent community project. It is **not** an official OmniRoute or OpenCode package and is **not**
endorsed by or affiliated with either.
