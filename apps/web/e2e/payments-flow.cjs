// End-to-end: normal payment, registered carer, gift-card scam, and the risk service going down (must hold).
// Needs the app, a fresh database and the risk service on :8765. Run: E2E_ORIGIN=http://localhost:3000 node apps/web/e2e/payments-flow.cjs
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const B = process.env.E2E_ORIGIN ?? 'http://localhost:3000';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
  await p.goto(B + '/signup');
  await p.getByLabel('Your name').fill('Eleanor Hughes');
  await p.getByLabel('Your email').fill('eleanor@example.com');
  await p.getByRole('button', { name: 'Use my fingerprint or face' }).click();
  await p.waitForURL('**/plan/edit');
  await p.getByLabel('Their name', { exact: true }).fill('Priya');
  await p.getByLabel('Their email', { exact: true }).fill('priya@example.com');
  await p.getByRole('button', { name: 'Add someone' }).click();
  await p.getByLabel('Name', { exact: true }).fill('Maria');
  await p.getByLabel('Their PayPal email').fill('maria@example.com');
  await p.getByLabel('Each payment ($)').fill('320');
  await p.getByLabel('Never more than this a month ($)').fill('1400');
  await p.getByRole('button', { name: 'Read my plan back to me' }).click();
  await p.getByRole('button', { name: 'Yes, this is my plan' }).click();
  await p.waitForURL('**/plan?confirmed=*');
  const pay = async (name, email, amount, method, note, shot) => {
    await p.goto(B + '/payments/new');
    await p.getByLabel('Who are you paying?').fill(name);
    await p.getByLabel('Their PayPal email').fill(email);
    await p.getByLabel('How much? (US dollars)').fill(amount);
    await p.locator(`input[name="method"][value="${method}"]`).check();
    if (note) await p.getByLabel(/What did they say/).fill(note);
    await p.getByRole('button', { name: 'Check and send' }).click();
    await p.waitForURL(/\/payments\/[0-9a-f-]{36}$/, { timeout: 15000 });
    await p.waitForTimeout(500);
    if (shot) await p.screenshot({ path: `${require('os').tmpdir()}/lp-e2e-pay-${shot}.png`, fullPage: true });
    console.log(`${name} $${amount}:`, (await p.locator('h1').textContent()).trim());
    // A payment that went: wait for PayPal's confirmation to appear on its own (the page refreshes while sending).
    if ((await p.getByText(/Sending it through PayPal/).count()) || (await p.getByTestId('paypal-ref').count())) {
      await p.getByTestId('paypal-ref').waitFor({ timeout: 20000 });
      console.log('   ', (await p.getByTestId('paypal-ref').textContent()).trim());
    }
  };
  await pay('Riverside Pharmacy', 'pharmacy@example.com', '42.10', 'p2p', '', 'normal');
  await pay('Maria', 'maria@example.com', '320', 'p2p', 'Thanks for this week', null);
  await pay('Account Support Desk', 'support-desk@example.net', '1200', 'gift_card', 'URGENT: buy gift cards today to unlock your account', 'scam');
  execSync('kill  2>/dev/null || fuser -k 8765/tcp');
  await pay('Riverside Pharmacy', 'pharmacy@example.com', '42.10', 'p2p', '', 'risk-down');
  await p.goto(B + '/home'); await p.screenshot({ path: require('path').join(require('os').tmpdir(), 'lp-e2e-pay-home.png'), fullPage: true });
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
