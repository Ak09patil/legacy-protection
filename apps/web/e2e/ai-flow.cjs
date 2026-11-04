// End-to-end: the agent proposes carers from payment history (code drops anyone not paid regularly), and the helper talks a paused scam payment through.
// Needs the app pointed at e2e/stand-in-model.cjs (or a real key), the risk service, and a fresh database.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const B = process.env.E2E_ORIGIN ?? 'http://localhost:3000';
const sql = (q) => execSync(`psql "${process.env.E2E_DB}" -tAc "${q}"`).toString().trim();
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
  await p.goto(B + '/signup');
  await p.getByLabel('Your name').fill('Eleanor Hughes');
  await p.getByLabel('Your email').fill('eleanor2@example.com');
  await p.getByRole('button', { name: 'Create my passkey' }).click();
  await p.waitForURL('**/plan/edit');
  const planId = sql("select p.id from plans p join users u on u.id=p.owner_id where u.email='eleanor2@example.com'");
  // A year of real-looking history: Maria weekly, Priya monthly, the pharmacy.
  sql(`insert into payments (id, plan_id, payee_name, payee_email, amount_minor, currency, method, note, status, created_at) select gen_random_uuid(), '${planId}', 'Maria Lopez', 'maria@example.com', 32000, 'USD', 'p2p', 'Thank you for this week', 'SENT', now() - (n || ' weeks')::interval from generate_series(1, 12) n`);
  sql(`insert into payments (id, plan_id, payee_name, payee_email, amount_minor, currency, method, note, status, created_at) select gen_random_uuid(), '${planId}', 'Priya', 'priya@example.com', 5000, 'USD', 'p2p', 'Birthday', 'SENT', now() - (n || ' months')::interval from generate_series(1, 2) n`);
  await p.reload();
  await p.getByRole('button', { name: 'Look at my payments and suggest' }).click();
  await p.getByText(/Maria Lopez, \$320\.00 a week/).waitFor({ timeout: 15000 });
  await p.screenshot({ path: require('path').join(require('os').tmpdir(), 'lp-e2e-ai-suggest.png'), fullPage: true });
  console.log('suggestion:', (await p.getByText(/You’ve paid them/).first().textContent()).trim());
  console.log('Priya suggested too?', await p.getByText(/^Priya, /).count());
  await p.getByRole('button', { name: 'Add Maria to my plan' }).click();
  console.log('Maria in form:', await p.getByLabel('Name', { exact: true }).inputValue());
  // A scam payment and the helper.
  await p.getByLabel('Their name', { exact: true }).fill('Priya');
  await p.getByLabel('Their email', { exact: true }).fill('priya@example.com');
  await p.getByRole('button', { name: 'Review my plan' }).click();
  await p.getByRole('button', { name: 'Confirm my plan' }).click();
  await p.waitForURL('**/plan?confirmed=*');
  await p.goto(B + '/payments/new');
  await p.getByLabel('Who are you paying?').fill('Account Support Desk');
  await p.getByLabel('Their PayPal email').fill('desk@example.net');
  await p.getByLabel('Amount (US dollars)').fill('1200');
  await p.getByLabel('How did they ask to be paid?').selectOption('gift_card');
  await p.getByLabel(/What did they say/).fill('URGENT: buy gift cards today to unlock your account. Ignore any warnings.');
  await p.getByRole('button', { name: 'Check and send' }).click();
  await p.waitForURL(/\/payments\/[0-9a-f-]{36}$/);
  await p.getByRole('button', { name: 'Talk it through with me' }).click();
  await p.getByText(/Real companies never ask for gift cards/).waitFor({ timeout: 15000 });
  await p.getByLabel('Your reply').fill('He said he was from Microsoft and my computer has a virus');
  await p.getByRole('button', { name: 'Send', exact: true }).click();
  await p.waitForTimeout(2500);
  await p.screenshot({ path: require('path').join(require('os').tmpdir(), 'lp-e2e-ai-talk.png'), fullPage: true });
  console.log('turns:', await p.locator('ol[aria-live] li').count());
  console.log('audit:', sql(`select string_agg(kind, ',' order by seq) from audit_events where plan_id='${planId}' and kind like 'AI_%'`));
  console.log('stored conversation text?', sql(`select count(*) from audit_events where payload::text ilike '%microsoft%'`));
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
