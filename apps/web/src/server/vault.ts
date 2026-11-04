import "server-only";

/** The web app's vault client (INV-24). It can read payment notes and plan documents only for the purposes the vault allows "web". */

import { httpVault, unsealedDevVault, type Vault } from "@lp/vault";

const g = globalThis as unknown as { __lpVault?: Vault };

export function webVault(): Vault {
  if (!g.__lpVault) {
    const url = process.env.VAULT_URL;
    const secret = process.env.VAULT_SECRET_WEB;
    g.__lpVault = url && secret ? httpVault(url, "web", secret) : unsealedDevVault();
  }
  return g.__lpVault;
}
