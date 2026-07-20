import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    // Generated third-party engine bundles are copied during postinstall.
    // Linting multi-megabyte Emscripten output adds minutes and no signal.
    "public/stockfish/*.js",
    "public/stockfish/*.wasm",
    "public/stockfish/*.nnue",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
