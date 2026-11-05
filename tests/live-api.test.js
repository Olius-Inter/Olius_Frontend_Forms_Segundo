import test from 'node:test';
import assert from 'node:assert/strict';
import { createPevApiAuth } from '../pev-api-auth.js';
import { createDriverApi, driverAccess } from '../driver-api.js';
import { deliveryDTO } from '../delivery-api.js';
import { mobileContext, usesLiveApi } from '../mobile-link.js';

const token = 'A'.repeat(43);
const id = '10000000-0000-4000-8000-000000000001';
const pevId = '20000000-0000-4000-8000-000000000001';
const citizenId = '30000000-0000-4000-8000-000000000001';
const access = { cpf: '12345678901', cnh: '12345678901', qrToken: token };
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const context = { driverId: 'driver-test', driverName: 'Motorista de teste', establishmentId: 'company-test',
  establishmentName: 'Empresa de teste', requests: [{ id, scheduledAt: '2026-01-01T12:00:00Z', arrivedAt: null, serviceAcceptedAt: null }],
  failureReasons: [{ code: 'OIL_UNACCEPTABLE', name: 'Óleo inadequado' }], page: 0, size: 20, totalElements: 1 };
const input = () => deliveryDTO({ idempotencyKey: id, qrToken: token, oilVolumeLiters: 5.5, deliveryDate: '2026-01-01T12:00:00.000Z' });

test('link real aceita token do mobile e nunca converte ID fictício em identidade real', () => {
  assert.equal(mobileContext('?participante=b2b-001').qrToken, null);
  assert.equal(usesLiveApi('?participante=b2b-001'), false);
  assert.equal(usesLiveApi(`?qrToken=${token}`), true);
  assert.equal(usesLiveApi('?qrToken=invalido'), true);
  assert.equal(mobileContext(`?participante=${token}`).qrToken, token);
  assert.equal(mobileContext(`?qrToken=${token}&tipo=b2b`).type, 'B2B');
});

test('entrega exige quantidade positiva, precisão, UUID e data original válida', () => {
  for (const changes of [{ oilVolumeLiters: 0 }, { oilVolumeLiters: NaN }, { oilVolumeLiters: 1000 },
    { oilVolumeLiters: 1.234 }, { qrToken: 'b2c-001' }, { deliveryDate: 'amanhã' },
    { deliveryDate: '2999-01-01T00:00:00Z' }, { idempotencyKey: 'id' }]) {
    assert.throws(() => deliveryDTO({ ...input(), ...changes }));
  }
  assert.equal(Object.isFrozen(input()), true);
});

test('PEV resolve nome no servidor e reenvia o mesmo DTO sem campos editáveis de identidade', async () => {
  const calls = [];
  let saves = 0;
  const api = createPevApiAuth({ fetchImpl: async (url, options) => {
    const path = new URL(url).pathname; calls.push({ path, options });
    if (path.endsWith('/csrf')) return reply({ headerName: 'X-XSRF-TOKEN', token: 'csrf-test' });
    if (path.endsWith('/login')) return reply({ tokenType: 'Bearer', accessToken: 'access-test' });
    if (path.endsWith('/users/me')) return reply({ id: 'actor-test', name: 'Responsável', status: 'ACTIVE', userType: 'CITIZENS' });
    if (path.endsWith('/pevs/me')) return reply({ id: pevId, status: 'APPROVED' });
    if (path.endsWith('/qr/resolutions')) return reply({ id: citizenId, name: 'Nome do servidor' });
    if (path.endsWith('/deliveries')) {
      if (++saves === 1) throw new TypeError('Resposta perdida depois de gravar');
      return reply({ id, pevId, citizenId, oilVolumeLiters: 5.5, createdAt: '2026-01-01T12:00:01Z' });
    }
    throw new Error('Rota inesperada');
  } });
  await assert.rejects(() => api.resolveParticipant(token), /Entre/);
  await api.login('test@example.test', 'password-test');
  assert.deepEqual(await api.resolveParticipant(token), { id: citizenId, name: 'Nome do servidor' });
  const payload = { ...input(), citizenId: 'forged', validatorId: 'forged', pevId: 'forged' };
  await assert.rejects(() => api.confirmDelivery(payload, citizenId), /conectar/);
  assert.equal(saves, 1, 'não deve repetir automaticamente');
  await api.confirmDelivery(payload, citizenId);
  const writes = calls.filter((call) => call.path.endsWith('/deliveries'));
  assert.equal(writes[0].options.body, writes[1].options.body);
  assert.deepEqual(JSON.parse(writes[0].options.body), input());
  assert.equal(writes[0].path, `/api/v1/pevs/${pevId}/deliveries`);
  assert.equal(writes[0].options.headers.Authorization, 'Bearer access-test');
  assert.equal(writes[0].options.credentials, 'omit');
});

test('motorista envia documentos somente no JSON e chegada é ação separada da consulta', async () => {
  const calls = [];
  const api = createDriverApi({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return reply(url.includes('/arrival') ? { id, arrival: { arrivedAt: '2026-01-01T12:00:00Z' } } : context);
  } });
  await api.context(access);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).search, '?page=0&size=20');
  assert.equal(calls[0].url.includes(access.cpf), false);
  assert.equal(calls[0].url.includes(token), false);
  assert.deepEqual(JSON.parse(calls[0].options.body), access);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[0].options.credentials, 'omit');
  await api.arrival(id, access);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1].url).pathname, `/api/v1/operations/b2b/requests/${id}/arrival`);
  assert.deepEqual(driverAccess({ ...access, cpf: '123.456.789-01' }), access);
});

test('motorista não aceita contexto incompleto, erro de autorização ou resposta de outra chegada', async () => {
  const invalid = createDriverApi({ fetchImpl: async () => reply({ ...context, requests: null }) });
  await assert.rejects(() => invalid.context(access), /incompleto/);
  const denied = createDriverApi({ fetchImpl: async () => reply({}, 403) });
  await assert.rejects(() => denied.context(access), /autorização/);
  const other = createDriverApi({ fetchImpl: async () => reply({ id: 'other' }) });
  await assert.rejects(() => other.arrival(id, access), /chegada/);
});

test('confirmação do motorista tem prazo e não repete automaticamente um envio incerto', async () => {
  let calls = 0;
  const api = createDriverApi({ timeoutMs: 5, fetchImpl: (_url, options) => {
    calls++;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError'))));
  } });
  const payload = { access, collectedVolumeLiters: 5, presentedVolumeLiters: 5, oilCondition: 'ACCEPTABLE', hasCompromisingOccurrence: false,
    failureReasonCodes: [], observation: null };
  await assert.rejects(() => api.confirmCollection({ requestId: id, payload }), /incerto/);
  assert.equal(calls, 1);
});

test('resultado da coleta segue os valores definidos pelo Swagger', async () => {
  const payload = { access, collectedVolumeLiters: 5, presentedVolumeLiters: 5, oilCondition: 'ACCEPTABLE',
    hasCompromisingOccurrence: false, failureReasonCodes: [], observation: null };
  for (const result of ['SUCCESSFUL', 'UNSUCCESSFUL', 'SUCCESS']) {
    const api = createDriverApi({ fetchImpl: async () => reply({ collection: { id, requestId: id,
      collectedVolumeLiters: 5, collectionDate: '2026-01-01T12:00:00Z', result } }) });
    const confirmation = api.confirmCollection({ requestId: id, payload });
    if (result === 'SUCCESS') await assert.rejects(() => confirmation, /comprovante completo/);
    else assert.equal((await confirmation).collection.result, result);
  }
});
