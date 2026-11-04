import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(`./packages/${p}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests always run against source, never stale build output.
    alias: [
      { find: /^@lp\/core\/lifecycle$/, replacement: fileURLToPath(new URL("./packages/core/src/lifecycle.ts", import.meta.url)) },
      { find: /^@lp\/core$/, replacement: src("core") },
      { find: /^@lp\/policy$/, replacement: src("policy") },
      { find: /^@lp\/paypal$/, replacement: src("paypal") },
      { find: /^@lp\/db$/, replacement: src("db") },
      { find: /^@lp\/ai$/, replacement: src("ai") },
      { find: /^@lp\/guard$/, replacement: src("guard") },
      { find: /^@lp\/service$/, replacement: src("service") },
      { find: /^@lp\/db\/audit$/, replacement: fileURLToPath(new URL("./packages/db/src/audit.ts", import.meta.url)) },
    ],
  },
  test: { include: ["packages/*/test/**/*.test.ts", "workers/*/test/**/*.test.ts"], testTimeout: 30_000 },
});
