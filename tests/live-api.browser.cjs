const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { spawn } = require('node:child_process');
const { mkdir, writeFile } = require('node:fs/promises');
const root = resolve(__dirname, '..');
const dependencies = process.env.OLIUS_TEST_DEPENDENCIES || root;
const { chromium } = require(require.resolve('playwright', { paths: [dependencies] }));
const { default: AxeBuilder } = require(require.resolve('@axe-core/playwright', { paths: [dependencies] }));
const origin = 'http://127.0.0.1:5197';
const api = 'https://tvkgo0evuj.execute-api.us-east-1.amazonaws.com';
const token = 'A'.repeat(43);
const id = '10000000-0000-4000-8000-000000000001';
const pevId = '20000000-0000-4000-8000-000000000001';
const citizenId = '30000000-0000-4000-8000-000000000001';

(async () => {
  const server = spawn(process.execPath, ['server.js'], { cwd: root, windowsHide: true, stdio: 'pipe',
    env: { ...process.env, PORT: '5197', HOST: '127.0.0.1' } });
  let browser;
  const report = { errors: [], scans: [], writes: [] };
  try {
    await new Promise((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error('Servidor não iniciou.')), 10000);
      server.once('error', reject);
      server.once('exit', () => { clearTimeout(timer); reject(new Error('Servidor encerrou.')); });
      server.stdout.on('data', (data) => { if (data.toString().includes('Olius Forms:')) { clearTimeout(timer); resolveReady(); } });
    });
    await mkdir(resolve(root, 'artifacts'), { recursive: true });
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.message));
    let actor = 'actor-test', deliveries = 0, collections = 0, arrived = false, accepted = false;
    const calls = [], deliveryBodies = [], collectionBodies = [];
    await context.route(`${api}/**`, async (route) => {
      const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
      const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type,x-xsrf-token' };
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
      calls.push({ path, method: request.method() });
      let body, status = 200;
      if (path.endsWith('/csrf')) body = { headerName: 'X-XSRF-TOKEN', token: 'csrf-test' };
      else if (path.endsWith('/login')) body = { accessToken: 'access-test', tokenType: 'Bearer' };
      else if (path.endsWith('/logout')) status = 204;
      else if (path.endsWith('/users/me')) body = { id: actor, name: 'Responsável de teste', status: 'ACTIVE', userType: 'CITIZENS' };
      else if (path.endsWith('/pevs/me')) body = { id: pevId, status: 'APPROVED' };
      else if (path.endsWith('/qr/resolutions')) {
        assert.deepEqual(request.postDataJSON(), { qrToken: token });
        assert.equal(request.headers().authorization, 'Bearer access-test');
        body = { id: citizenId, name: 'Participante retornado pela API' };
      } else if (path.endsWith('/deliveries')) {
        deliveryBodies.push(request.postDataJSON());
        assert.equal(request.headers().authorization, 'Bearer access-test');
        assert.equal(path, `/api/v1/pevs/${pevId}/deliveries`);
        if (++deliveries === 1) { await route.abort('failed'); return; }
        body = { id, pevId, citizenId, oilVolumeLiters: 5.5, deliveryDate: request.postDataJSON().deliveryDate,
          createdAt: new Date().toISOString(), pointsEarned: 17 };
      } else if (path.endsWith('/context')) {
        assert.equal(url.searchParams.get('size'), '20');
        assert.equal(url.search.includes('12345678901'), false);
        assert.deepEqual(request.postDataJSON(), { cpf: '12345678901', cnh: '12345678901', qrToken: token });
        body = { driverId: 'driver-test', driverName: 'Motorista de teste', establishmentId: 'company-test', establishmentName: 'Empresa confirmada pela API',
          requests: [{ id, estimatedVolumeLiters: 10, scheduledAt: '2026-01-01T12:00:00Z',
            arrivedAt: arrived ? '2026-01-01T12:00:00Z' : null, serviceAcceptedAt: accepted ? '2026-01-01T12:01:00Z' : null }],
          failureReasons: [{ code: 'OIL_UNACCEPTABLE', name: 'Óleo inadequado' }], page: 0, size: 20, totalElements: 1 };
      } else if (path.endsWith('/arrival')) {
        arrived = true;
        body = { id, establishmentId: 'company-test', arrival: { arrivedAt: '2026-01-01T12:00:00Z', driverId: 'driver-test' }, acceptance: null };
      } else if (path.endsWith('/collection')) {
        collectionBodies.push(request.postDataJSON());
        assert.equal(arrived && accepted, true);
        if (++collections === 1) status = 409;
        body = { collection: { id, requestId: id, establishmentId: 'company-test', driverId: 'driver-test', collectedVolumeLiters: 10,
          collectionDate: '2026-01-01T12:02:00Z', result: 'SUCCESSFUL', pointsEarned: 20 } };
      } else throw new Error(`Endpoint inesperado: ${path}`);
      await route.fulfill({ status, headers, ...(status === 204 ? {} : { contentType: 'application/json', body: JSON.stringify(body) }) });
    });
    async function login() {
      await page.getByLabel('E-mail', { exact: true }).fill('test@example.test');
      await page.getByLabel('Senha', { exact: true }).fill('fixture-password');
      await page.getByRole('button', { name: /Validar meu PEV/ }).click();
    }
    async function scan(name) {
      await page.evaluate(() => document.fonts.ready);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      report.scans.push({ name, violations: result.violations });
      assert.equal(result.violations.length, 0, `${name}: acessibilidade`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: resolve(root, 'artifacts', `api-${name}.png`), fullPage: true });
    }

    await page.goto(`${origin}/?qrToken=${token}&fluxo=pev`);
    assert.equal(await page.locator('[data-account]').count(), 0);
    await login();
    await page.getByRole('button', { name: 'Identificar participante' }).click();
    await page.getByText('Participante retornado pela API', { exact: true }).waitFor();
    assert.equal(await page.getByLabel(/nome/i).count(), 0);
    await page.getByLabel('Quantidade recebida (litros)').fill('5,50');
    await scan('pev-form-mobile');
    await page.getByRole('button', { name: 'Confirmar recebimento' }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(deliveryBodies.length, 1);
    assert.equal(await page.getByLabel('Quantidade recebida (litros)').getAttribute('readonly'), '');
    await page.getByRole('button', { name: 'Entrar novamente com a mesma conta' }).click();
    actor = 'other-actor'; await login();
    await page.getByRole('alert').filter({ hasText: /mesma conta/ }).waitFor();
    assert.equal(deliveryBodies.length, 1);
    actor = 'actor-test'; await login();
    await page.getByRole('button', { name: 'Reenviar mesma entrega' }).click();
    await page.getByRole('heading', { name: /Recebimento registrado/ }).waitFor();
    assert.deepEqual(deliveryBodies[0], deliveryBodies[1]);
    await scan('pev-receipt-mobile');
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);

    await page.goto(`${origin}/?qrToken=${token}&fluxo=motorista`);
    await page.getByLabel('CPF do motorista').fill('123.456.789-01');
    await page.getByLabel('CNH do motorista').fill('12345678901');
    await page.getByRole('button', { name: 'Consultar solicitações' }).click();
    await page.getByRole('button', { name: 'Selecionar', exact: true }).click();
    assert.equal(calls.some((call) => call.path.endsWith('/arrival')), false);
    await page.getByRole('button', { name: 'Registrar minha chegada' }).click();
    await page.getByText('Chegada:', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Atualizar chegada e aceite' }).click();
    await page.getByRole('button', { name: 'Atualizar chegada e aceite' }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('#real-collection-form').count(), 0);
    accepted = true;
    // Aguarda a consulta anterior antes de disparar outra atualização.
    await page.waitForFunction(() => !document.querySelector('#reload-context').disabled);
    await page.getByRole('button', { name: 'Atualizar chegada e aceite' }).click();
    await page.getByLabel('Volume apresentado (litros)').fill('10');
    await page.getByLabel('Volume coletado (litros)').fill('10');
    await scan('driver-form-mobile');
    await page.getByRole('button', { name: 'Confirmar coleta' }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(collectionBodies.length, 1);
    assert.equal(await page.getByLabel('Volume coletado (litros)').isDisabled(), true);
    await page.getByRole('button', { name: 'Reenviar mesma coleta' }).click();
    await page.getByRole('heading', { name: /Coleta registrada/ }).waitFor();
    await page.getByText('Bem-sucedida', { exact: true }).waitFor();
    assert.deepEqual(collectionBodies[0], collectionBodies[1]);
    assert.equal(calls.some((call) => call.path.includes('service-acceptance')), false);
    await scan('driver-receipt-mobile');
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.deepEqual(report.errors, []);
    report.writes = calls.filter((call) => call.path.endsWith('/deliveries') || call.path.endsWith('/collection'));
    console.log('PEV e motorista: identidade, chegada explícita, aceite externo, envio real do cliente, reautenticação e reenvios idempotentes verificados contra API simulada.');
  } finally {
    if (browser) await browser.close();
    server.kill();
    await mkdir(resolve(root, 'artifacts'), { recursive: true });
    await writeFile(resolve(root, 'artifacts', 'live-api-browser-report.json'), JSON.stringify(report, null, 2));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
