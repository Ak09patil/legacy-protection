import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(`./packages/${p}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests always run against source, never stale build output.
    alias: {
      "@lp/core": src("core"),
      "@lp/policy": src("policy"),
      "@lp/paypal": src("paypal"),
      "@lp/db": src("db"),
      "@lp/ai": src("ai"),
    },
  },
  test: { include: ["packages/*/test/**/*.test.ts"] },
});
