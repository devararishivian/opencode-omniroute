# oc-omniroute-plugin

[![npm version](https://img.shields.io/npm/v/@devvara/oc-omniroute-plugin.svg?color=cb3837)](https://www.npmjs.com/package/@devvara/oc-omniroute-plugin)
[![npm downloads](https://img.shields.io/npm/dm/@devvara/oc-omniroute-plugin.svg)](https://www.npmjs.com/package/@devvara/oc-omniroute-plugin)
[![CI Status](https://github.com/devararishivian/opencode-omniroute/actions/workflows/ci.yml/badge.svg)](https://github.com/devararishivian/opencode-omniroute/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-v2-black.svg)](https://opencode.ai)

A fast, clean OpenCode V2 plugin for [OmniRoute](https://github.com/diegosouzapw/OmniRoute).

It connects OpenCode directly to your OmniRoute gateway, keeps your model picker clean and organized, and optionally
adds fast web search and web fetch tools using OmniRoute's REST API.

```sh
# Inside your project directory (or in ~/.config/opencode for global setup):
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

The standard `/v1/models` endpoint from a gateway often contains hundreds of raw models. This can clutter your editor
with image generators, embeddings, and duplicate rows.

This plugin fixes those problems automatically:

- **Chat models only (Clean Picker)**  
  Filters out non-chat models that you cannot use for coding or conversation. Image generators (`flux`,
  `ali-qwen-image-*`), text embeddings (`text-embedding-3`, `nemotron-embed`), audio, video, and rerank models are
  automatically removed.

- **No duplicate rows (Smart Tier Folding)**  
  Gateways often list flat effort rows like `claude-opus-5-low`, `claude-opus-5-medium`, and `claude-opus-5-high`. This
  plugin folds them into a single base model (`claude-opus-5`) and exposes the effort levels inside OpenCode's native
  variant selector.

- **Full Thinking / Reasoning control**  
  Reads reasoning effort tiers directly from OmniRoute. You can easily switch thinking levels (`low`, `medium`, `high`,
  `xhigh`, `max`) right from the OpenCode interface.

- **Clean, searchable titles**  
  Models are named with a provider-first format: `CustomProvider - Deepseek v4.1 Flash`.
    - Cleans up ugly repository prefixes (e.g. `nvidia/deepseek-ai/deepseek-v4.1-flash` becomes
      `Nvidia - Deepseek v4.1 Flash`).
    - Preserves special routing wrappers clearly (e.g. `No-think - CustomProvider - Claude Opus 5`).
    - Makes searching in the model picker fast and natural.

- **No fake "Free" badges**  
  OpenCode shows a `Free` tag on models with zero pricing. When a gateway does not send price data for private or custom
  connections, other plugins leave the price at 0, falsely labeling expensive models as "Free". This plugin leaves
  unpriced models clean while keeping the `[Free]` label only on models that are genuinely free.

- **Active connections only (`usableOnly`)**  
  Enabled by default. It checks connection status and hides upstream providers that are disabled or unhealthy, while
  making sure active models remain available.

- **Built-in REST Web Search & Fetch (No MCP required)**  
  Give your AI agents real-time web access directly through OmniRoute's REST endpoints (`/v1/search` and
  `/v1/web/fetch`).
    - **Zero extra MCP servers**: No need to configure or run heavy background MCP daemons.
    - **High performance**: Fast HTTP REST calls managed by OmniRoute's built-in search engine integrations (Serper,
      Tavily, Firecrawl, Bing, etc.) with automatic upstream failover.
    - **Safe & resilient**: Enforces OpenCode's native permission checks before requesting any URL. If your gateway has
      a temporary outage, fetch automatically falls back to OpenCode's native web fetch tool.

- **One key for everything**  
  Uses one API key for inference (`/v1/*`), search/fetch, and metadata (`/api/*`). No separate management token is
  required.

---

## Installation & Setup

### Scenario A: New user (First time connecting OmniRoute)

1. **Install the plugin:**
    - **For a single project:** Run this command inside your project root folder (where your project's `opencode.json`
      lives):
      ```sh
      bun add -d @devvara/oc-omniroute-plugin
      # or
      npm install -D @devvara/oc-omniroute-plugin
      ```
    - **For all projects (global):** Run this command inside your global OpenCode directory:
      ```sh
      cd ~/.config/opencode
      bun add -d @devvara/oc-omniroute-plugin
      # or: npm install -D @devvara/oc-omniroute-plugin
      ```

2. **Add the plugin to `opencode.json`:**
   Open your project's `opencode.json` (or global `~/.config/opencode/opencode.json`):
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

```jsonc
// Remove or replace manual static provider configuration
"provider": {
  "omniroute": {
    "npm": "@ai-sdk/openai-compatible",
    "options": {
      "baseURL": "...",
      "apiKey": "..."
    },
    "models": {
      ...
    }
  }
}
```

1. Remove the static `"omniroute"` entry from `"provider"` in `opencode.json`.
2. Install the plugin in your project (or in `~/.config/opencode` for global use) as shown in Scenario A.
3. Add `@devvara/oc-omniroute-plugin` under `"plugins"` in `opencode.json`.
4. Restart OpenCode. The plugin will discover and configure your models automatically with live limits and capabilities.

---

### Scenario C: Migrating from `@omniroute/opencode-plugin-v2`

If you used the earlier upstream plugin:

1. **Update your dependencies:**
   In the directory where you previously installed the plugin (your project root or `~/.config/opencode`):
   ```sh
   # Inside your project root or ~/.config/opencode:
   bun remove @omniroute/opencode-plugin-v2 && bun add -d @devvara/oc-omniroute-plugin
   # or
   npm uninstall @omniroute/opencode-plugin-v2 && npm install -D @devvara/oc-omniroute-plugin
   ```

2. **In `opencode.json`:**
    - Change `"package": "@omniroute/opencode-plugin-v2"` to `"package": "@devvara/oc-omniroute-plugin"`.
    - Remove `"managementReadToken"` if you had it (this plugin only requires your standard `apiKey`).

3. **Delete the old snapshot file (run from any terminal directory):**
   ```sh
   rm -f ~/.local/share/opencode/plugins/omniroute-omniroute.json
   ```

4. Restart OpenCode.

---

## How to Update

To update the plugin to the latest version:

- **If installed in a project:** Run inside your project root folder:
  ```sh
  bun update @devvara/oc-omniroute-plugin
  # or
  npm update @devvara/oc-omniroute-plugin
  ```

- **If installed globally:** Run inside your global config folder:
  ```sh
  cd ~/.config/opencode && bun update @devvara/oc-omniroute-plugin
  # or
  cd ~/.config/opencode && npm update @devvara/oc-omniroute-plugin
  ```

If you ever want to force OpenCode to immediately rebuild its cached model catalog, delete the snapshot cache and
restart OpenCode (**run from any directory**):

```sh
rm -f ~/.local/share/opencode/plugins/omniroute-omniroute.json
```

---

## OmniRoute MCP Server Notice

**This plugin does NOT require OmniRoute MCP.**

- This plugin communicates directly with OmniRoute using high-performance HTTP REST endpoints.
- **Can you still use OmniRoute MCP?** Yes! If you use OmniRoute's MCP server for custom agent tools, you can keep it in
  your config. They operate independently and will not interfere with each other.

---

## Optional: Web Search & Fetch Tools (REST)

OmniRoute can handle web searches and URL scraping directly via HTTP REST without running a separate MCP server. You can
enable either or both tools:

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
            "enabled": true,
            "maxResults": 5
          },
          "fetch": {
            "enabled": true,
            "fallbackToNative": true,
            "includeMetadata": true
          },
          "timeoutMs": 30000
        }
      }
    }
  ]
}
```

### How `web.search` Works

- Registers OmniRoute as an active search provider in OpenCode via `ctx.websearch`.
- Routes query requests to `POST /v1/search`.
- Parses search results, snippets, full markdown content (e.g. from Tavily, Serper, Firecrawl), and publication dates
  into OpenCode's native search result structure.
- Rejects empty or whitespace-only queries client-side before sending network requests.
- Capped by `maxResults` (default: 5).

### How `web.fetch` Works

- Replaces OpenCode's built-in `webfetch` tool in the tool registry.
- Routes URL fetch requests to `POST /v1/web/fetch`.
- **Security First**: Always asserts the native OpenCode `webfetch` permission before making any HTTP request. If
  permission is denied, no network call is ever made.
- **Graceful Fallback**: If `fallbackToNative: true` (default), any gateway outage or upstream error automatically falls
  back to OpenCode's native fetch implementation so your agent tasks never fail.
- **Cancellation & Timeout**: Respects per-request caller timeouts (1..120 seconds) and cleanly stops without fallback
  if the turn was cancelled by the user.

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
- `web.search.enabled` *(boolean, default: `false`)*: Enables REST web search provider.
- `web.fetch.enabled` *(boolean, default: `false`)*: Enables REST web fetch tool with native fallback.

---

## Contributing

Contributions, bug reports, and suggestions are welcome!

1. **Fork & Clone** the repository.
2. **Install dependencies**:
   ```sh
   bun install
   ```
3. **Run tests**:
   ```sh
   bun run test
   ```
4. **Check types & build**:
   ```sh
   bun run typecheck
   bun run build
   ```
5. Create a branch and submit your Pull Request to the `develop` branch. Please make sure all tests pass before
   submitting.

---

## Issue Reporting & Support

If you encounter a bug, an unhandled model format, or unexpected behavior:

- Open an issue on [GitHub Issues](https://github.com/devararishivian/opencode-omniroute/issues).
- Include your OpenCode version, OmniRoute gateway version, and a brief description of the issue.
- **Security Reminder:** Never include your private API keys, bearer tokens, or sensitive endpoint URLs in issue
  descriptions or logs.

---

## Support, Star & Sponsor ⭐

If this plugin makes your OpenCode workflow smoother:

- **Star the repository:** Give us a ⭐ on GitHub! It helps other developers find this project.
- **Sponsor / Donate:** If this tool brings value to you or your company, consider sponsoring or supporting ongoing
  maintenance via [GitHub Sponsors](https://github.com/sponsors/devararishivian) or donation links on the profile. Your
  support keeps the project active and independent!

---

## Acknowledgments & Credits

This project was built upon and inspired by the work of the open-source community:

- **[OmniRoute](https://github.com/diegosouzapw/OmniRoute)** by [Diego Souza](https://github.com/diegosouzapw) &
  contributors:  
  This plugin is an independent derivative of the original `@omniroute/opencode-plugin-v2`. We are grateful for
  OmniRoute's powerful AI gateway and their initial OpenCode integration.
- **[pi-omniroute-sync](https://github.com/JasonLandbridge/pi-omniroute-sync)**
  by [JasonLandbridge](https://github.com/JasonLandbridge), with displaying and custom-prefix discovery contributions by
  the author:  
  Special thanks for inspiring key ideas around chat-only model filtering, dual-level effort tier discovery, and clean
  provider-first naming conventions.
- **[OpenCode](https://github.com/anomalyco/opencode)**:  
  For building an incredible, hackable coding agent harness and extensible plugin architecture.

---

## License & Disclaimer

MIT License. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for full license terms and historical attribution.

**Disclaimer:** This is an independent, non-official community plugin. It is not endorsed by, sponsored by, or
affiliated with OmniRoute or OpenCode. All product and company names are trademarks™ or registered® trademarks of their
respective holders.
