# Deploying Legacy Protection on Render

Everything is defined in `render.yaml` (a Render Blueprint). Only the web app is public; the vault, risk model and Temporal are private services, and both databases accept no connections from the internet.

## First deploy

1. Push this repository to GitHub.
2. In Render: **New → Blueprint**, pick the repository. Render reads `render.yaml` and proposes 2 databases and 5 services.
3. Fill in the secrets Render asks for (never commit them):

| Secret | Where it goes | How to make it |
|---|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | env group `lp-shared` | Sandbox app on developer.paypal.com (the US one) |
| `VAULT_MASTER_KEY` | `lp-vault` | `openssl rand -hex 32` |
| `VAULT_SECRET_WEB` | `lp-vault` **and** `lp-web` (same value) | `openssl rand -hex 32` |
| `VAULT_SECRET_WORKER` | `lp-vault` **and** `lp-worker` (same value) | `openssl rand -hex 32` |
| `APP_ORIGIN` | `lp-web` | the web service's URL, e.g. `https://lp-web.onrender.com` |
| `ANTHROPIC_API_KEY` | `lp-web` | with a monthly spending limit |
| `RESEND_API_KEY`, `EMAIL_FROM` | `lp-web` | resend.com |
| `OPS_EMAILS` | `lp-web` | emails allowed to see the operations page |

4. Deploy. Before each web deploy, Render runs `pnpm db:migrate:ci` as the database owner, which also creates the least-privilege `lp_app` role. The web app and worker connect as `lp_app`, building that URL from the owner URL's host and `LP_APP_PASSWORD`.

## Checks after deploy

- `https://<web>/api/health` returns `{"ok":true}`.
- Sign up, confirm a plan, and see its timeline start (worker logs: `Reconciled … active plan(s)`).
- A payment with a message: in the Render database shell, `select left(note, 5) from payments;` shows `lpv1.` (sealed).

## Production differences (beyond the hackathon)

- Temporal: use Temporal Cloud (`TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_API_KEY`) instead of the single-binary server.
- Vault master key: a cloud KMS key instead of an environment variable.
- PayPal: live credentials only after PayPal-side endpoints exist (see `docs/WHAT_PAYPAL_NEEDS.md`); the code refuses live endpoints today (INV-19).
