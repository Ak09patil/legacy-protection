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
      { find: /^@lp\/vault$/, replacement: src("vault") },
      { find: /^@lp\/db\/url$/, replacement: fileURLToPath(new URL("./packages/db/src/url.ts", import.meta.url)) },
      // The web app's server code, tested without Next.js running.
      { find: /^@\//, replacement: fileURLToPath(new URL("./apps/web/src/", import.meta.url)) },
      { find: /^server-only$/, replacement: fileURLToPath(new URL("./apps/web/test/shims/server-only.ts", import.meta.url)) },
      { find: /^next\/headers$/, replacement: fileURLToPath(new URL("./apps/web/test/shims/next-headers.ts", import.meta.url)) },
      { find: /^next\/navigation$/, replacement: fileURLToPath(new URL("./apps/web/test/shims/next-navigation.ts", import.meta.url)) },
      { find: /^@lp\/db\/audit$/, replacement: fileURLToPath(new URL("./packages/db/src/audit.ts", import.meta.url)) },
    ],
  },
  test: { include: ["packages/*/test/**/*.test.ts", "workers/*/test/**/*.test.ts", "apps/web/test/**/*.test.ts"], testTimeout: 30_000 },
});
