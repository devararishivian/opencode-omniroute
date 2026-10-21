# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-10-21

### Added

- Official repository, homepage, and issue tracker metadata in `package.json`.
- Exported subpath `./server` in `package.json` for OpenCode runtime loaders.
- Expanded discoverability keywords in `package.json` (`ai-agent`, `coding-agent`, `ai-gateway`, `model-router`,
  `web-search`, `web-fetch`).
- Automated GitHub Actions CI workflow for test, typecheck, and build steps.
- GitHub Issue Forms with security reminders for bug reports and feature requests.
- Dependabot configuration for weekly dependency and GitHub Actions updates.

### Fixed

- Replaced residual private provider names in comments and fixtures with generic examples, preventing leaks in compiled
  declaration files (`dist/*.d.ts`).
- Included `supportsThinking` in model capability reasoning mapping in `src/shared/models-map.ts`.
- Propagated per-request timeout in `OmniRouteWebClient.fetch`, bounding requests to caller-defined timeouts and
  forwarding `timeout` in request bodies.
- Validated search queries in `OmniRouteWebClient.search` to reject empty or whitespace queries before network
  roundtrips.
- Supported string content and camelCase `publishedAt` timestamp fields in search result processing.
- Handled empty content responses (e.g. 404 pages) in web fetch without throwing.

## [0.1.0] - 2026-10-21

### Added

- Initial release of `@devvara/oc-omniroute-plugin`.
- Dynamic OmniRoute model catalog discovery with OpenCode V2 plugin architecture.
- Automatic filtering of non-chat models (image generators, embeddings, video, audio, rerank).
- Dual-level reasoning effort tier discovery with native OpenCode variants (`low`, `medium`, `high`, `xhigh`, `max`).
- Provider-first model naming (`Provider - Model Name`) with clean repository prefix stripping.
- Suppression of false `Free` badges on unpriced models (`cost: []`), preserving `[Free]` only for genuine free models.
- Usable-only upstream provider filtering (`usableOnly: true`).
- Optional REST-based web search (`/v1/search`) and web fetch (`/v1/web/fetch`) tools with native permission assertions
  and automatic fallback.
- Single API key configuration for inference, web tools, and metadata.
- In-memory TTL cache with on-disk warm startup snapshot.
