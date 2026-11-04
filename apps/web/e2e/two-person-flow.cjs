// End-to-end: Eleanor sets up a plan, Priya accepts and confirms with a real (virtual) passkey, Eleanor checks in.
// Needs a running app and a fresh database. Run: E2E_ORIGIN=http://localhost:3000 node apps/web/e2e/two-person-flow.cjs
const { chromium } = require('playwright');
const B = process.env.E2E_ORIGIN ?? 'http://localhost:3000';
async function person(b) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
  p.on('pageerror', e => console.log('pageerror', e.message));
  return p;
}
const shot = (p, n) => p.screenshot({ path: `${require('os').tmpdir()}/lp-e2e-${n}.png`, fullPage: true });
(async () => {
  const b = await chromium.launch();
  const E = await person(b);
  await E.goto(B + '/signup');
  await E.getByLabel('Your name').fill('Eleanor Hughes');
  await E.getByLabel('Your email').fill('eleanor@example.com');
  await E.getByRole('button', { name: 'Create my passkey' }).click();
  await E.waitForURL('**/plan/edit');
  await E.getByLabel('Their name', { exact: true }).fill('Priya Hughes');
  await E.getByLabel('Their email', { exact: true }).fill('priya@example.com');
  await E.getByRole('button', { name: 'Add someone' }).click();
  await E.getByLabel('Name', { exact: true }).fill('Maria');
  await E.getByLabel('Their PayPal email').fill('maria@example.com');
  await E.getByLabel('Each payment ($)').fill('320');
  await E.getByLabel('Never more than this a month ($)').fill('1400');
  await shot(E, '1-edit');
  await E.getByRole('button', { name: 'Review my plan' }).click();
  await E.getByRole('button', { name: 'Confirm my plan' }).click();
  await E.waitForURL('**/plan?confirmed=*');
  await shot(E, '2-plan');
  await E.getByRole('button', { name: /Get a new invite link for Priya/ }).click();
  const link = (await E.getByTestId('invite-link').textContent()).trim();
  console.log('invite link ok:', link.startsWith(B + '/invite/'));

  const P = await person(b);
  await P.goto(link);
  await shot(P, '3-invite');
  await P.getByRole('button', { name: 'Create my passkey' }).click();
  await P.waitForURL('**/contact');
  await shot(P, '4-contact');
  await P.getByText('If something has happened to Eleanor').click();
  await P.getByRole('button', { name: 'I know something has happened' }).click();
  await P.getByRole('button', { name: 'Confirm it’s me' }).click();
  await P.getByRole('heading', { name: 'We’ve told Eleanor' }).waitFor({ timeout: 10000 });
  await shot(P, '5-contact-confirmed');

  await E.goto(B + '/home');
  await shot(E, '6-eleanor-asked');
  console.log('eleanor sees:', await E.locator('h1').textContent());
  await E.getByRole('button', { name: /I’m here, I’m all right/ }).click();
  await E.getByRole('heading', { name: /You’re protected/ }).waitFor({ timeout: 10000 });
  await P.goto(B + '/contact');
  await shot(P, '7-contact-after');
  console.log('priya sees:', await P.locator('h1').textContent());
  // Priya cannot open Eleanor's pages
  await P.goto(B + '/plan');
  console.log('priya at /plan ->', new URL(P.url()).pathname);
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
