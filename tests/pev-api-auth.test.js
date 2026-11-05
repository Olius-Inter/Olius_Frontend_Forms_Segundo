import test from 'node:test';
import assert from 'node:assert/strict';
import { API_BASE_URL, createPevApiAuth } from '../pev-api-auth.js';

function apiMock({ loginStatus = 200, user = {}, pev = {}, pevStatus = 200, logoutFails = false, logoutStatus = 204 } = {}) {
  const calls = [];
  const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const fetchImpl = async (url, options) => {
    calls.push({ path: new URL(url).pathname, options });
    switch (new URL(url).pathname) {
      case '/api/v1/auth/web/csrf': return reply({ headerName: 'X-XSRF-TOKEN', token: 'csrf-test' });
      case '/api/v1/auth/web/login': return reply({ accessToken: 'access-test', tokenType: 'Bearer' }, loginStatus);
      case '/api/v1/users/me': return reply({ id: 'user-1', name: 'Responsável existente', status: 'ACTIVE', userType: 'CITIZENS', cpf: 'private-test', qrToken: 'private-test', ...user });
      case '/api/v1/pevs/me': return reply({ id: 'pev-1', status: 'APPROVED', address: { city: 'São Paulo' }, ...pev }, pevStatus);
      case '/api/v1/auth/web/logout':
        if (logoutFails) throw new TypeError('offline');
        return { ok: true, status: logoutStatus, json: async () => { throw new Error('Logout não retorna JSON.'); } };
      default: throw new Error('Unexpected route');
    }
  };
  return { calls, fetchImpl };
}

test('autentica a conta existente com CSRF e consulta apenas perfil e PEV próprios', async () => {
  const mock = apiMock(); const api = createPevApiAuth({ fetchImpl: mock.fetchImpl });
  const account = await api.login(' existing@example.test ', 'password-test');
  assert.deepEqual(mock.calls.map((call) => call.path), ['/api/v1/auth/web/csrf', '/api/v1/auth/web/login', '/api/v1/users/me', '/api/v1/pevs/me']);
  assert.equal(mock.calls[1].options.headers['X-XSRF-TOKEN'], 'csrf-test');
  assert.equal(mock.calls[1].options.credentials, 'include');
  assert.deepEqual(JSON.parse(mock.calls[1].options.body), { email: 'existing@example.test', password: 'password-test' });
  assert.equal(mock.calls[2].options.headers.Authorization, 'Bearer access-test');
  assert.equal(mock.calls[2].options.credentials, 'omit');
  assert.equal(account.pevStatus, 'APPROVED');
  assert.equal(account.userId, 'user-1');
  assert.equal(account.cpf, undefined); assert.equal(account.qrToken, undefined); assert.equal(account.accessToken, undefined);
  assert.equal(api.currentAccount(), account);
  assert.equal(API_BASE_URL, 'https://tvkgo0evuj.execute-api.us-east-1.amazonaws.com');
});

test('login inválido não consulta perfis nem libera conta fictícia', async () => {
  const mock = apiMock({ loginStatus: 401 }); const api = createPevApiAuth({ fetchImpl: mock.fetchImpl });
  await assert.rejects(() => api.login('existing@example.test', 'wrong'), /senha inválidos/);
  assert.equal(mock.calls.length, 2); assert.equal(api.currentAccount(), null);
});

test('sem PEV, pendente, conta inativa e ADMIN permanecem sem autorização', async () => {
  for (const setup of [{ pevStatus: 404 }, { pev: { status: 'PENDING' } }, { user: { status: 'INACTIVE' } }, { user: { userType: 'ADMIN' } }]) {
    const mock = apiMock(setup); const api = createPevApiAuth({ fetchImpl: mock.fetchImpl });
    await assert.rejects(() => api.login('existing@example.test', 'test'));
    assert.equal(api.currentAccount(), null);
    assert.equal(mock.calls.at(-1).path, '/api/v1/auth/web/logout');
  }
});

test('falha de conexão não envia senha nem consulta dados locais de demonstração', async () => {
  const calls = [];
  const api = createPevApiAuth({ fetchImpl: async (url, options) => { calls.push({ url, options }); throw new TypeError('CORS/network'); } });
  await assert.rejects(() => api.login('existing@example.test', 'private-password'), (error) => error.code === 'CONNECTION_FAILED');
  assert.equal(calls.length, 1); assert.equal(calls[0].options.body, undefined);
  assert.equal(api.currentAccount(), null);
});

test('CSRF inválido não pode definir cabeçalho arbitrário ou disparar login', async () => {
  let count = 0;
  const api = createPevApiAuth({ fetchImpl: async () => { count++; return { ok: true, status: 200, json: async () => ({ headerName: 'Authorization', token: 'invalid' }) }; } });
  await assert.rejects(() => api.login('existing@example.test', 'test'), (error) => error.code === 'INVALID_CSRF');
  assert.equal(count, 1);
});

test('encerrar apaga a conta em memória mesmo se a revogação remota falhar', async () => {
  const mock = apiMock({ logoutFails: true }); const api = createPevApiAuth({ fetchImpl: mock.fetchImpl });
  await api.login('existing@example.test', 'test');
  await assert.rejects(() => api.logout()); assert.equal(api.currentAccount(), null);
});

test('logout aceita 200 sem corpo do Swagger e 204 idempotente', async () => {
  for (const logoutStatus of [200, 204]) {
    const mock = apiMock({ logoutStatus });
    const api = createPevApiAuth({ fetchImpl: mock.fetchImpl });
    await api.login('existing@example.test', 'test');
    await api.logout();
    assert.equal(api.currentAccount(), null);
    const call = mock.calls.at(-1);
    assert.equal(call.path, '/api/v1/auth/web/logout');
    assert.equal(call.options.credentials, 'include');
    assert.equal(call.options.headers['X-XSRF-TOKEN'], 'csrf-test');
  }
});
