// End-to-end: sign up and sign in with an email code (no passkey). Reads the code from the dev server log.
// Run: E2E_ORIGIN=http://localhost:3000 E2E_LOG=/path/to/server.log node apps/web/e2e/email-code-flow.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const B = process.env.E2E_ORIGIN ?? 'http://localhost:3000';
const lastCode = () => { const m = [...fs.readFileSync(process.env.E2E_LOG ?? 'server.log', 'utf8').matchAll(/Your code is (\d{6})/g)]; return m.at(-1)[1]; };
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await p.goto(B + '/signup');
  await p.getByLabel('Your name').fill('Code Person');
  await p.getByLabel('Your email').fill('code@example.com');
  await p.getByRole('button', { name: 'Email me a code instead' }).click();
  await p.getByLabel('Your code').waitFor();
  await p.screenshot({ path: require('path').join(require('os').tmpdir(), 'lp-e2e-code.png') });
  await p.getByLabel('Your code').fill('000000');
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.waitForTimeout(1500);
  console.log('wrong code:', await p.locator('p[role=alert]').textContent());
  await p.getByLabel('Your code').fill(lastCode());
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.waitForURL('**/plan/edit');
  console.log('signed up with code ->', new URL(p.url()).pathname);
  await p.context().clearCookies();
  await p.goto(B + '/signin');
  await p.getByRole('button', { name: 'Email me a code instead' }).click();
  await p.getByLabel('Your email').fill('code@example.com');
  const before = lastCode();
  await p.getByRole('button', { name: 'Email me a code', exact: true }).click();
  await p.getByLabel('Your code').waitFor();
  for (let i = 0; i < 50 && lastCode() === before; i++) await p.waitForTimeout(100); // the new email, not the sign-up one
  await p.getByLabel('Your code').fill(lastCode());
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.waitForURL('**/home');
  console.log('signed in with code ->', new URL(p.url()).pathname);
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
