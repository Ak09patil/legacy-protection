// End-to-end: the one-tap "I'm okay"' link from an email. Opening changes nothing; the tap does; a changed link does nothing.
// Run after a flow that sent an "Are you okay?" email: node apps/web/e2e/one-tap-ok.cjs "<link from the email>"
const { chromium } = require('playwright');
const fs = require('fs');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await p.goto(process.argv[2]);
  console.log('opened:', (await p.locator('h1').textContent()).trim());
  await p.addScriptTag({ content: AXE });
  console.log('axe:', JSON.stringify(await p.evaluate(async () => (await axe.run()).violations.map(v => v.id))));
  await p.screenshot({ path: '/tmp/ok-1.png' });
  await p.getByRole('button', { name: 'I’m okay' }).click();
  await p.waitForURL(/done=1/);
  console.log('after tap:', (await p.getByRole('status').textContent()).trim());
  await p.screenshot({ path: '/tmp/ok-2.png' });
  await p.goto(process.argv[2].slice(0, -3) + 'xyz');
  console.log('tampered:', (await p.locator('h1').textContent()).trim());
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
