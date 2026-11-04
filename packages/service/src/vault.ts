/**
 * The vault this process uses to read and write sealed fields (INV-24).
 * The worker configures an HTTP vault at start; tests and local development
 * fall back to the unsealed development vault, which refuses in production.
 */

import { unsealedDevVault, type Vault } from "@lp/vault";

let configured: Vault | null = null;

export function configureVault(v: Vault): void {
  configured = v;
}

export function serviceVault(): Vault {
  configured ??= unsealedDevVault();
  return configured;
}
