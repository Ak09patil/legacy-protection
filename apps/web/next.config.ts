import path from "node:path";
import type { NextConfig } from "next";

const pkg = (name: string) => path.resolve(__dirname, `../../packages/${name}/src/index.ts`);

const nextConfig: NextConfig = {
  // The monorepo root, so Next never guesses from an unrelated lockfile higher up.
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  // The engine packages are TypeScript source in this monorepo; compile them with the app.
  transpilePackages: ["@lp/core", "@lp/policy", "@lp/ai", "@lp/db", "@lp/service", "@lp/guard", "@lp/paypal"],
  serverExternalPackages: ["pg", "@temporalio/client", "@paypal/agent-toolkit"],
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@lp/core$": pkg("core"),
      "@lp/policy$": pkg("policy"),
      "@lp/ai$": pkg("ai"),
      "@lp/service$": pkg("service"),
      "@lp/guard$": pkg("guard"),
      "@lp/paypal$": pkg("paypal"),
      "@lp/db/audit$": path.resolve(__dirname, "../../packages/db/src/audit.ts"),
    };
    // Source files import siblings with .js extensions (NodeNext style).
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};

export default nextConfig;
