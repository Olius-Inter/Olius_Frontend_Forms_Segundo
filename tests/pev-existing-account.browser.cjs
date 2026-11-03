const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');
const { spawn } = require('node:child_process');
const root = resolve(__dirname, '..');
const dependencies = process.env.OLIUS_TEST_DEPENDENCIES || root;
const { chromium } = require(require.resolve('playwright', { paths: [dependencies] }));
const { default: AxeBuilder } = require(require.resolve('@axe-core/playwright', { paths: [dependencies] }));
const origin = process.env.OLIUS_TEST_URL || 'http://127.0.0.1:5196';
const api = 'https://tvkgo0evuj.execute-api.us-east-1.amazonaws.com';
const output = resolve(root, 'artifacts');

(async () => {
  await mkdir(output, { recursive: true });
  const server = process.env.OLIUS_TEST_URL ? null : spawn(process.execPath, ['server.js'], {
    cwd: root, windowsHide: true, stdio: 'pipe', env: { ...process.env, PORT: '5196', HOST: '127.0.0.1' },
  });
  let browser;
  const report = { scenarios: [], errors: [], scans: [] };
  try {
    if (server) {
      await new Promise((resolveReady, reject) => {
        const timer = setTimeout(() => reject(new Error('Servidor de teste não iniciou.')), 10000);
        server.once('error', reject);
        server.once('exit', () => { clearTimeout(timer); reject(new Error('Servidor de teste encerrou antes de iniciar.')); });
        server.stdout.on('data', (data) => { if (data.toString().includes('Olius Forms:')) { clearTimeout(timer); resolveReady(); } });
      });
    }
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.message));
    let scenario = 'approved';
    const requests = [];
    await context.route(`${api}/**`, async (route) => {
      const request = route.request(); const path = new URL(request.url()).pathname;
      requests.push({ path, method: request.method() });
      if (scenario === 'network') { await route.abort('failed'); return; }
      const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type,x-xsrf-token' };
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
      let status = 200; let body;
      if (path.endsWith('/csrf')) body = { headerName: 'X-XSRF-TOKEN', token: 'csrf-test' };
      else if (path.endsWith('/login')) {
        assert.equal(request.headers()['x-xsrf-token'], 'csrf-test');
        status = scenario === 'invalid' ? 401 : 200;
        body = { accessToken: 'access-test', tokenType: 'Bearer' };
      } else if (path === '/api/v1/users/me') body = { id: 'real-user-test', name: 'Conta existente de teste', status: 'ACTIVE', userType: 'CITIZENS' };
      else if (path === '/api/v1/pevs/me') { status = scenario === 'missing' ? 404 : 200; body = { id: 'real-pev-test', status: scenario === 'pending' ? 'PENDING' : 'APPROVED', address: { city: 'São Paulo' } }; }
      else if (path.endsWith('/logout')) { status = 204; }
      else throw new Error('Rota inesperada no teste.');
      await route.fulfill({ status, headers, ...(status === 204 ? {} : { contentType: 'application/json', body: JSON.stringify(body) }) });
    });
    for (const item of ['approved', 'pending', 'missing', 'invalid', 'network']) {
      scenario = item; requests.length = 0;
      await page.goto(origin + '/?modo=api&fluxo=pev');
      await page.getByRole('heading', { name: /Entre com/ }).waitFor();
      assert.equal(await page.locator('[data-account]').count(), 0);
      await page.getByLabel('E-mail', { exact: true }).fill('existing@example.test');
      await page.getByLabel('Senha', { exact: true }).fill('fixture-password');
      await page.getByRole('button', { name: /Validar meu PEV/ }).click();
      if (item === 'approved') {
        await page.getByRole('heading', { name: /Seu PEV/ }).waitFor();
        assert.equal(await page.getByText('Conta existente de teste', { exact: true }).count(), 1);
        assert.equal(await page.getByText(/Abra o link gerado pelo mobile/).count(), 1);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: resolve(output, 'existing-pev-approved-mobile.png'), fullPage: true });
        const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        report.scans.push({ name: 'conta existente aprovada', violations: scan.violations });
        assert.equal(scan.violations.length, 0);
        await page.getByRole('button', { name: 'Encerrar acesso' }).click();
        await page.getByRole('heading', { name: /Entre com/ }).waitFor();
      } else {
        await page.getByRole('alert').waitFor();
        assert.equal(await page.getByRole('heading', { name: /Seu PEV/ }).count(), 0);
        assert.equal(await page.getByLabel('Senha', { exact: true }).inputValue(), '');
        assert.equal(await page.getByRole('button', { name: /Validar meu PEV/ }).isEnabled(), true);
        if (item === 'network') {
          assert.equal(requests.some((request) => request.method === 'POST'), false);
          await page.screenshot({ path: resolve(output, 'existing-pev-connection-error-mobile.png'), fullPage: true });
        }
      }
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      report.scenarios.push(item);
    }
    assert.deepEqual(report.errors, []);
    console.log('Conta existente: aprovação, pendência, ausência de PEV, senha inválida, conexão recusada e logout verificados com respostas simuladas. Nenhuma conta real usada.');
  } finally {
    if (browser) await browser.close();
    if (server) server.kill();
    await writeFile(resolve(output, 'existing-pev-browser-report.json'), JSON.stringify(report, null, 2));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
