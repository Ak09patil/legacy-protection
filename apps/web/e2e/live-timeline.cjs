// Live: web app + Temporal dev server + worker + Postgres. Simulates 11 silent days and the 72-hour wait by moving timestamps in the database, then signals the timeline.
// Needs: temporal server start-dev, the worker, the app, a fresh database. Run: E2E_ORIGIN=http://localhost:3000 E2E_DB=postgresql://... node apps/web/e2e/live-timeline.cjs
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const B = process.env.E2E_ORIGIN ?? 'http://localhost:3000';
const sql = (q) => execSync(`psql "${process.env.E2E_DB}" -tAc "${q}"`).toString().trim();
const signal = (planId) => execSync(`temporal workflow signal --workflow-id plan-${planId} --name changed`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function person(b) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
  return p;
}
(async () => {
  const b = await chromium.launch();
  const E = await person(b);
  await E.goto(B + '/signup');
  await E.getByLabel('Your name').fill('Eleanor Hughes');
  await E.getByLabel('Your email').fill('eleanor@example.com');
  await E.getByRole('button', { name: 'Create my passkey' }).click();
  await E.waitForURL('**/plan/edit');
  await E.getByLabel('Their name', { exact: true }).fill('Priya');
  await E.getByLabel('Their email', { exact: true }).fill('priya@example.com');
  await E.getByRole('button', { name: 'Add someone' }).click();
  await E.getByLabel('Name', { exact: true }).fill('Maria');
  await E.getByLabel('Their PayPal email').fill('maria@example.com');
  await E.getByLabel('Each payment ($)').fill('320');
  await E.getByLabel('Never more than this a month ($)').fill('1400');
  await E.getByRole('button', { name: 'Review my plan' }).click();
  await E.getByRole('button', { name: 'Confirm my plan' }).click();
  await E.waitForURL('**/plan?confirmed=*');
  await E.getByRole('button', { name: /Get a new invite link for Priya/ }).click();
  const link = (await E.getByTestId('invite-link').textContent()).trim();
  const P = await person(b);
  await P.goto(link);
  await P.getByRole('button', { name: 'Create my passkey' }).click();
  await P.waitForURL('**/contact');
  const planId = sql("select plan_id from plan_state limit 1");
  await sleep(1500);
  console.log('workflow running:', execSync(`temporal workflow describe --workflow-id plan-${planId} -o json`).toString().includes('"RUNNING"') || execSync(`temporal workflow describe --workflow-id plan-${planId}`).toString().includes('Running'));
  // Time passes: Eleanor last checked in 11 days ago.
  sql(`update plan_state set last_checkin_at = now() - interval '11 days' where plan_id = '${planId}'`);
  signal(planId);
  await sleep(4000);
  console.log('after 11 silent days:', sql(`select phase||' missed='||checkins_missed from plan_state`), '| contact told:', sql(`select string_agg(kind, ',') from notifications where kind like 'CONTACT_%'`));
  await P.goto(B + '/contact');
  await P.getByRole('button', { name: 'I know something has happened' }).click();
  await P.getByRole('button', { name: 'Confirm it’s me' }).click();
  await P.getByRole('heading', { name: 'We’ve told Eleanor' }).waitFor({ timeout: 10000 });
  await sleep(2000);
  console.log('after Priya confirms:', sql(`select phase from plan_state`));
  // Three days pass with no word from Eleanor.
  sql(`update plan_state set waiting_started_at = now() - interval '73 hours' where plan_id = '${planId}'`);
  signal(planId);
  await sleep(8000);
  console.log('after the wait:', sql(`select phase from plan_state`));
  console.log('steps:', sql(`select string_agg(id||'='||status, ', ' order by due_at, id) from execution_steps`));
  console.log('audit chain tail:', sql(`select string_agg(kind, ' > ' order by seq) from (select kind, seq from audit_events order by seq desc limit 9) x`));
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
