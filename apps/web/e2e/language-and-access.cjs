// End-to-end: the product in German and Spanish, and an automated accessibility check (axe-core, WCAG 2.2 AA) of every screen.
// Needs the app on a fresh database and the risk service. Run: E2E_ORIGIN=http://localhost:3000 node apps/web/e2e/language-and-access.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const B = process.env.E2E_ORIGIN ?? 'http://localhost:3000';
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const failures = [];
async function audit(p, name) {
  await p.addScriptTag({ content: AXE });
  const r = await p.evaluate(async () =>
    // eslint-disable-next-line no-undef
    (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      sample: v.nodes[0]?.target?.join(' '),
    })),
  );
  const serious = r.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  console.log(`axe ${name}: ${r.length === 0 ? 'clean' : r.map((v) => `${v.id}(${v.impact}×${v.nodes})`).join(', ')}`);
  if (serious.length) failures.push(`${name}: ${serious.map((v) => `${v.id} at ${v.sample}`).join('; ')}`);
}

async function tapTargets(p, name) {
  // Every button and link people tap should be at least 44px tall (WCAG 2.5.5 AAA; we hold ourselves to it).
  const small = await p.evaluate(() =>
    [...document.querySelectorAll('main button, main a, header button, header a, main input[type=radio], main input[type=checkbox]')]
      .filter((e) => e.offsetParent !== null)
      .map((e) => {
        const target = e.closest('label') ?? e;
        return { text: (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 40), h: target.getBoundingClientRect().height };
      })
      .filter((x) => x.h < 44),
  );
  if (small.length) failures.push(`${name}: small tap targets ${JSON.stringify(small)}`);
}

(async () => {
  const b = await chromium.launch();
  // A German browser: the product should arrive in German without anyone choosing.
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE', timezoneId: 'Europe/Berlin', extraHTTPHeaders: { 'Accept-Language': 'de-DE,de;q=0.9' } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => failures.push(`pageerror ${e.message}`));
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });

  await p.goto(B + '/signup');
  console.log('signup heading:', await p.locator('h1').textContent());
  console.log('lang attribute:', await p.locator('[lang]').nth(1).getAttribute('lang'));
  await audit(p, 'signup (de)');
  await tapTargets(p, 'signup (de)');
  await p.getByLabel('Ihr Name').fill('Greta Weber');
  await p.getByLabel('Ihre E-Mail-Adresse').fill('greta@example.com');
  await p.getByRole('button', { name: 'Mit Fingerabdruck oder Gesicht' }).click();
  await p.waitForURL('**/plan/edit');
  await audit(p, 'plan editor (de)');
  await tapTargets(p, 'plan editor (de)');

  await p.getByLabel('Name', { exact: true }).first().fill('Lena');
  await p.getByLabel('E-Mail-Adresse', { exact: true }).first().fill('lena@example.com');
  await p.getByRole('button', { name: 'Jemanden hinzufügen' }).click();
  await p.getByLabel('PayPal-E-Mail-Adresse').fill('maria@example.com');
  await p.locator('input').filter({ hasNot: p.locator('[type]') }).nth(0); // keep focus order stable
  await p.getByLabel('Name', { exact: true }).nth(1).fill('Maria');
  await p.getByLabel('Jede Zahlung ($)').fill('320,50');
  await p.getByLabel('Nie mehr als das pro Monat ($)').fill('1400');
  await p.getByRole('button', { name: 'Meinen Plan vorlesen' }).click();
  await p.getByRole('heading', { name: 'Das werden wir tun' }).waitFor();
  const summary = await p.locator('#review-h').locator('xpath=ancestor::section').locator('li').allTextContents();
  console.log('summary (de):\n  ' + summary.join('\n  '));
  await p.getByRole('button', { name: 'Ja, das ist mein Plan' }).click();
  await p.waitForURL('**/plan?confirmed=*');
  console.log('saved:', (await p.getByRole('status').first().textContent()).trim());
  await audit(p, 'plan (de)');

  // A scam, in German.
  await p.goto(B + '/payments/new');
  await audit(p, 'send money (de)');
  await tapTargets(p, 'send money (de)');
  await p.getByLabel('Wen bezahlen Sie?').fill('Kundendienst');
  await p.getByLabel('Die PayPal-E-Mail-Adresse').fill('desk@example.net');
  await p.getByLabel(/Wie viel/).fill('1200');
  await p.getByLabel('Mit Geschenkkarten').check();
  await p.getByLabel(/Was hat die Person/).fill('DRINGEND: Kaufen Sie heute Geschenkkarten, sonst wird Ihr Konto gesperrt.');
  await p.getByRole('button', { name: 'Prüfen und senden' }).click();
  await p.waitForURL(/\/payments\/[0-9a-f-]{36}$/, { timeout: 15000 });
  console.log('payment (de):', (await p.locator('h1').textContent()).trim());
  console.log('  first reason:', (await p.locator('#why-title').locator('xpath=ancestor::section').locator('li').first().textContent()).trim());
  await audit(p, 'paused payment (de)');
  await tapTargets(p, 'paused payment (de)');
  await p.screenshot({ path: `${require('os').tmpdir()}/lp-e2e-de-paused.png`, fullPage: true });

  // Switch to Spanish with one tap; it sticks.
  await p.getByRole('button', { name: 'Español' }).click();
  await p.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('Hemos parado'));
  console.log('after switch:', (await p.locator('h1').textContent()).trim());
  await audit(p, 'paused payment (es)');
  await p.goto(B + '/plan');
  console.log('plan line (es):', (await p.locator('main li').first().textContent()).trim());
  await p.goto(B + '/home');
  console.log('home (es):', (await p.locator('h1').textContent()).trim());
  console.log('note shown:', await p.getByText('Esta página se tradujo con IA').count());
  await audit(p, 'home (es)');
  await tapTargets(p, 'home (es)');
  await p.screenshot({ path: `${require('os').tmpdir()}/lp-e2e-es-home.png`, fullPage: true });

  // And back to English.
  await p.getByRole('button', { name: 'English' }).click();
  await p.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('A payment is waiting'));
  console.log('home (en):', (await p.locator('h1').textContent()).trim());
  await audit(p, 'home (en)');

  await b.close();
  if (failures.length) {
    console.error('FAIL\n' + failures.join('\n'));
    process.exit(1);
  }
  console.log('OK');
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
