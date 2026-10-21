import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

/** Files that would land in the tarball, following package.json `files`. */
function packagedPaths(): string[] {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    files: string[];
  };
  const out: string[] = [];
  for (const entry of pkg.files) {
    const full = join(ROOT, entry);
    try {
      if (statSync(full).isDirectory()) walk(full, out);
      else out.push(full);
    } catch {
      // A `files` entry that does not exist yet (README/NOTICE before they are
      // written) is reported by the explicit assertions below, not here.
    }
  }
  return out.map((p) => relative(ROOT, p));
}

describe("package contents", () => {
  it("ships source attribution and a license", () => {
    const paths = packagedPaths();
    assert.ok(paths.includes("LICENSE"), "MIT license must be published");
    assert.ok(paths.includes("NOTICE"), "upstream attribution must be published");
    assert.ok(paths.includes("README.md"));
    assert.ok(paths.includes("dist/index.js"));
    assert.ok(paths.includes("server.js"), "the host probes a root server.js");
  });

  it("keeps the private design documents out of the package", () => {
    // docs/superpowers and docs/research are ignored by git on purpose; they
    // must never reach a published tarball either.
    for (const path of packagedPaths()) {
      assert.doesNotMatch(path, /^docs\/superpowers\//);
      assert.doesNotMatch(path, /^docs\/research\//);
    }
  });

  it("includes no credentials, local paths, or snapshots", () => {
    for (const path of packagedPaths()) {
      if (!/\.(ts|js|json|md|txt)$/.test(path) && !/^(LICENSE|NOTICE)$/.test(path)) continue;
      const text = readFileSync(join(ROOT, path), "utf8");
      assert.doesNotMatch(text, /\/Users\/[a-z0-9._-]+\//i, `${path} contains a local absolute path`);
      assert.doesNotMatch(text, /\bsk-[A-Za-z0-9]{16,}\b/, `${path} looks like it contains an API key`);
      assert.doesNotMatch(text, /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, `${path} looks like a token`);
      assert.doesNotMatch(text, /CosmosHub|OpenAgentic/i, `${path} contains private provider names`);
    }
  });

  it("declares the peer dependency and public access", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      name: string;
      peerDependencies: Record<string, string>;
      publishConfig: { access: string };
      engines: { node: string };
    };
    assert.equal(pkg.name, "@devvara/oc-omniroute-plugin");
    assert.equal(pkg.peerDependencies["@opencode/plugin"], ">=2.1.0 <3");
    assert.equal(pkg.publishConfig.access, "public");
    assert.equal(pkg.engines.node, ">=22.22.3");
  });
});
