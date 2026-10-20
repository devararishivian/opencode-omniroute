# OpenCode OmniRoute Plugin

**Status:** Design/specification only; implementation has not started.

This repository is the planned home for `@devvara/oc-omniroute-plugin`, an independent OpenCode V2 plugin package that
integrates OmniRoute model catalogs and optional OmniRoute-backed web search/fetch.

- **Package:** `@devvara/oc-omniroute-plugin`
- **Plugin ID:** `opencode-omniroute`
- **Default provider ID:** `omniroute`
- **Supports:** OpenCode `@opencode/plugin >=2.1.0 <3`, OmniRoute `>=3.8.52`, Node.js `>=22.22.3`
- **Credentials:** one key, the same one used to connect OpenCode V2 to OmniRoute

Web search and fetch are independent opt-ins and are disabled by default. The plugin does not register or require an
OmniRoute MCP server.

## Documents

- [Design specification](docs/superpowers/specs/2026-10-20-opencode-omniroute-design.md)
- [Research and session handoff](docs/research/2026-10-20-research-and-session-handoff.md)
- [Implementation plan](docs/superpowers/plans/2026-10-20-opencode-omniroute-implementation.md)

This project is an independent community derivative of the MIT-licensed OmniRoute OpenCode V2 plugin. It is not an
official OmniRoute or OpenCode package and is not endorsed by either project. The upstream MIT license and copyright
notice are preserved.
