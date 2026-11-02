import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionDTO, createCollectionApi } from '../collection-api.js';

const requestId = '10000000-0000-4000-8000-000000000001';
const payload = () => ({ access: { cpf: '12345678901', cnh: '12345678901', qrToken: 'b'.repeat(43) },
  collectedVolumeLiters: 30, presentedVolumeLiters: 30, oilCondition: 'ACCEPTABLE',
  hasCompromisingOccurrence: false, failureReasonCodes: [], observation: null });

test('chamada isolada usa apenas a rota de coleta e o DTO atual, sem módulos ou credenciais adicionais', async () => {
  const calls = [];
  const api = createCollectionApi({ baseUrl: 'https://api.example.test', fetchImpl: async (...args) => {
    calls.push(args); return { ok: true, json: async () => ({ collection: { id: 'collection-1', requestId }, calculation: {} }) };
  } });
  const input = { ...payload(), admin: true, result: 'SUCCESSFUL', pointsEarned: 999 };
  const result = await api.confirmCollection({ requestId, payload: input });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], `https://api.example.test/api/v1/operations/b2b/requests/${requestId}/collection`);
  assert.deepEqual(JSON.parse(calls[0][1].body), payload());
  assert.equal(calls[0][1].headers.Authorization, undefined);
  assert.equal(calls[0][1].credentials, 'omit');
  assert.equal(result.collection.id, 'collection-1');
});
test('não inventa campos ausentes nem envia dados incompletos', async () => {
  let called = false;
  const api = createCollectionApi({ baseUrl: 'http://127.0.0.1:8080', fetchImpl: async () => { called = true; } });
  const missing = payload(); delete missing.oilCondition;
  await assert.rejects(() => api.confirmCollection({ requestId, payload: missing }), /condição/);
  assert.equal(called, false);
  assert.throws(() => collectionDTO({ qrToken: 'b'.repeat(43), liters: 30 }), /identificação/);
});
test('preserva pedido e payload e não repete automaticamente uma falha de rede', async () => {
  let calls = 0;
  const input = payload(); const before = JSON.stringify(input);
  const api = createCollectionApi({ baseUrl: 'https://api.example.test', fetchImpl: async () => { calls++; throw new TypeError('network'); } });
  await assert.rejects(() => api.confirmCollection({ requestId, payload: input }), /mesmos dados/);
  assert.equal(calls, 1); assert.equal(JSON.stringify(input), before);
});
test('retorna conflito e falha de autorização sem sucesso fictício ou dados internos', async () => {
  for (const status of [403, 409]) {
    const api = createCollectionApi({ baseUrl: 'https://api.example.test', fetchImpl: async () => ({ ok: false, status }) });
    await assert.rejects(() => api.confirmCollection({ requestId, payload: payload() }), status === 409 ? /conflito/ : /não foi autorizada/);
  }
});
test('não aceita comprovante de outro pedido nem destino remoto em HTTP', async () => {
  assert.throws(() => createCollectionApi({ baseUrl: 'http://remote.example.test' }), /HTTPS/);
  const api = createCollectionApi({ baseUrl: 'https://api.example.test', fetchImpl: async () => ({ ok: true, json: async () => ({ collection: { id: 'other', requestId: 'other' } }) }) });
  await assert.rejects(() => api.confirmCollection({ requestId, payload: payload() }), /comprovante esperado/);
});
