/**
 * Test process setup.
 *
 * The plugin caches its catalog snapshot under `OPENCODE_DATA_DIR` (falling
 * back to `~/.local/share/opencode`). Without an override, every test run
 * writes into the developer's real OpenCode data directory and later runs
 * warm-start from those snapshots, which silently skips the network calls a
 * test is asserting on.
 *
 * `node --test` gives each test file its own process, so one temporary
 * directory per process is enough and no test can see another's snapshot.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.OPENCODE_DATA_DIR = mkdtempSync(join(tmpdir(), "oc-omniroute-test-"));
