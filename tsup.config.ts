import { defineConfig } from "tsup";

/**
 * JS bundling only. Declarations are emitted by `tsc --emitDeclarationOnly`
 * (see package.json), because tsup's `dts` pipeline runs rollup-plugin-dts on
 * the TypeScript compiler API, which the native TypeScript 7 compiler does not
 * expose.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: false,
  splitting: false,
  treeshake: false,
  target: "node22",
  outDir: "dist",
  minify: false,
  cjsInterop: false,
  noExternal: ["zod"],
});
