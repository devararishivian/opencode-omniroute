# oc-omniroute-plugin

A fast, clean OpenCode V2 plugin for [OmniRoute](https://github.com/diegosouzapw/OmniRoute).

It connects OpenCode directly to your OmniRoute gateway, keeps your model picker clean and organized, and optionally adds fast web search and web fetch tools using OmniRoute's REST API.

```sh
bun add -d @devvara/oc-omniroute-plugin
# or: npm install -D @devvara/oc-omniroute-plugin
```

```json
{
  "plugins": [
    {
      "package": "@devvara/oc-omniroute-plugin",
      "options": {
        "baseURL": "https://your-omniroute-gateway.com",
        "apiKey": "your-api-key"
      }
    }
  ]
}
```

---

## Why Use This Plugin?

The standard `/v1/models` endpoint from a gateway often contains hundreds of raw models. This can clutter your editor with image generators, embeddings, and duplicate rows.

This plugin fixes those problems automatically:

- **Chat models only (Clean Picker)**  
  Filters out non-chat models that you cannot use for coding or conversation. Image generators (`flux`, `ali-qwen-image-*`), text embeddings (`text-embedding-3`, `nemotron-embed`), audio, video, and rerank models are automatically removed.

- **No duplicate rows (Smart Tier Folding)**  
  Gateways often list flat effort rows like `claude-opus-5-low`, `claude-opus-5-medium`, and `claude-opus-5-high`. This plugin folds them into a single base model (`claude-opus-5`) and exposes the effort levels inside OpenCode's native variant selector.

- **Full Thinking / Reasoning control**  
  Reads reasoning effort tiers directly from OmniRoute. You can easily switch thinking levels (`low`, `medium`, `high`, `xhigh`, `max`) right from the OpenCode interface.

- **Clean, searchable titles**  
  Models are named with a provider-first format: `OpenAgentic - Deepseek v4.1 Flash`.
  - Cleans up ugly repository prefixes (e.g. `nvidia/deepseek-ai/deepseek-v4.1-flash` becomes `Nvidia - Deepseek v4.1 Flash`).
  - Preserves special routing wrappers clearly (e.g. `No-think - CosmosHub - Claude Opus 5`).
  - Makes searching in the model picker fast and natural.

- **No fake "Free" badges**  
  OpenCode shows a `Free` tag on models with zero pricing. When a gateway does not send price data for private or custom connections, other plugins leave the price at 0, falsely labeling expensive models as "Free". This plugin leaves unpriced models clean while keeping the `[Free]` label only on models that are genuinely free.

- **Active connections only (`usableOnly`)**  
  Enabled by default. It checks connection status and hides upstream providers that are disabled or unhealthy, while making sure active models remain available.

- **One key for everything**  
  Uses one API key for inference (`/v1/*`) and metadata (`/api/*`). No separate management token is required.

---

## Installation & Setup

### Scenario A: New user (First time connecting OmniRoute)

1. Install the plugin in your project (or global tool directory):
   ```sh
   bun add -d @devvara/oc-omniroute-plugin
   # or
   npm install -D @devvara/oc-omniroute-plugin
   ```

2. Add the plugin to your `opencode.json` (or `~/.config/opencode/opencode.json`):
   ```json
   {
     "plugins": [
       {
         "package": "@devvara/oc-omniroute-plugin",
         "options": {
           "baseURL": "https://omniroute.example.com",
           "apiKey": "your-api-key"
         }
       }
     ]
   }
   ```
   *Tip: You can also set `OMNIROUTE_API_KEY` in your environment instead of writing your key in the config file.*

---

### Scenario B: You previously connected OmniRoute manually

If you previously added OmniRoute under the `"provider"` block in `opencode.json`:

```json
// Remove or replace manual static provider configuration
"provider": {
  "omniroute": {
    "npm": "@ai-sdk/openai-compatible",
    "options": { "baseURL": "...", "apiKey": "..." },
    "models": { ... }
  }
}
```

1. Remove the static `"omniroute"` entry from `"provider"` in `opencode.json`.
2. Add `@devvara/oc-omniroute-plugin` under `"plugins"`.
3. Restart OpenCode. The plugin will discover and configure your models automatically with live limits and capabilities.

---

### Scenario C: Migrating from `@omniroute/opencode-plugin-v2`

If you used the earlier upstream plugin:

1. Update your `package.json` to use `@devvara/oc-omniroute-plugin`.
2. In `opencode.json`:
   - Change `"package": "@omniroute/opencode-plugin-v2"` to `"package": "@devvara/oc-omniroute-plugin"`.
   - Remove `"managementReadToken"` if you had it (this plugin only requires your standard `apiKey`).
3. Delete the old snapshot file once to ensure clean state:
   ```sh
   rm -f ~/.local/share/opencode/plugins/omniroute-omniroute.json
   ```
4. Restart OpenCode.

---

## How to Update

To update the plugin to the latest version:

```sh
bun update @devvara/oc-omniroute-plugin
# or
npm update @devvara/oc-omniroute-plugin
```

If you ever want to force OpenCode to immediately rebuild its cached model catalog, delete the snapshot cache and restart OpenCode:
```sh
rm -f ~/.local/share/opencode/plugins/omniroute-omniroute.json
```

---

## OmniRoute MCP Server Notice

**This plugin does NOT require OmniRoute MCP.**

- This plugin communicates directly with OmniRoute using high-performance HTTP REST endpoints.
- **Can you still use OmniRoute MCP?** Yes! If you use OmniRoute's MCP server for custom agent tools, you can keep it in your config. They operate independently and will not interfere with each other.

---

## Optional: Web Search & Fetch Tools

OmniRoute can handle web searches and URL fetches without running a separate MCP server. You can enable them directly through this plugin:

```json
{
  "plugins": [
    {
      "package": "@devvara/oc-omniroute-plugin",
      "options": {
        "baseURL": "https://omniroute.example.com",
        "apiKey": "your-api-key",
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
    }
  ]
}
```

- **`web.search`**: Registers OmniRoute web search as an available search provider in OpenCode.
- **`web.fetch`**: Replaces OpenCode's default fetch tool with OmniRoute's `/v1/web/fetch`. It always asks for native permission before making requests, and safely falls back to native fetch if the gateway fails.

Both tools are **disabled by default**.

---

## Full Configuration Options

For advanced filtering and timeout options, check [docs/configuration.md](docs/configuration.md).

Key options:
- `baseURL` *(string, required)*: The URL of your OmniRoute instance.
- `apiKey` *(string)*: Your OmniRoute gateway key (can also be set via `OMNIROUTE_API_KEY`).
- `usableOnly` *(boolean, default: `true`)*: Filters out models from inactive or failed connections.
- `enrichment` *(boolean, default: `true`)*: Fetches human-friendly names and live pricing metadata.
- `visibleModels` *(string[], default: `["*"]`)*: Allowlist of models to show.
- `hiddenModels` *(string[])*: Denylist of models to hide.

---

## License & Notice

MIT License. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for details.

*Note: This is an independent open-source project and is not officially affiliated with OmniRoute or OpenCode.*
