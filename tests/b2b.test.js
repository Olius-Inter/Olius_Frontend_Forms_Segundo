import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTICIPANTS } from '../core.js';
import { B2B_KEY, DRIVERS, REQUESTS, identifyDriver, b2bContext, readB2B, recordArrival, simulateEstablishmentAcceptance, collectionPayload, recordB2BCollection } from '../b2b-core.js';

function storage() { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; }
const access = { cpf: DRIVERS[0].cpf, cnh: DRIVERS[0].cnh, qrToken: PARTICIPANTS[0].qrToken };
const other = { cpf: DRIVERS[1].cpf, cnh: DRIVERS[1].cnh, qrToken: PARTICIPANTS[0].qrToken };
const request = REQUESTS[0].id;
const facts = (extra = {}) => ({ collected: '30', presented: '30', oilCondition: 'ACCEPTABLE', occurrence: 'false', observation: '', failureReasonCodes: [], ...extra });
const now = '2026-11-01T12:00:00Z';
function ready(store) { recordArrival(store, request, access, now); simulateEstablishmentAcceptance(store, request, now); }

test('identificação exige motorista e QR da empresa; consulta não registra chegada', () => {
  assert.throws(() => identifyDriver({ ...access, cpf: 'invalid' }));
  assert.throws(() => identifyDriver({ ...access, qrToken: PARTICIPANTS[1].qrToken }));
  const store = storage();
  assert.equal(b2bContext(store, access).requests.length, 2);
  assert.deepEqual(readB2B(store), { requests: [], collections: [] });
});
test('chegada é explícita, idempotente e não pode ser assumida por outro motorista', () => {
  const store = storage();
  const arrival = recordArrival(store, request, access, now);
  assert.deepEqual(recordArrival(store, request, access, '2026-11-01T13:00:00Z'), arrival);
  assert.throws(() => recordArrival(store, request, other, now), /outro motorista/);
  assert.equal(readB2B(store).collections.length, 0);
});
test('registro exige chegada do mesmo motorista e aceite separado', () => {
  const store = storage();
  assert.throws(() => recordB2BCollection(store, request, access, facts(), now), /chegada/);
  recordArrival(store, request, access, now);
  assert.throws(() => recordB2BCollection(store, request, access, facts(), now), /aceite/);
  simulateEstablishmentAcceptance(store, request, now);
  assert.throws(() => recordB2BCollection(store, request, other, facts(), now), /chegada/);
  assert.equal(readB2B(store).collections.length, 0);
});
test('payload B2B não inventa condição, ocorrência nem volume apresentado', () => {
  assert.throws(() => collectionPayload(access, facts({ oilCondition: '' })), /condição/);
  assert.throws(() => collectionPayload(access, facts({ occurrence: '' })), /ocorrência/);
  assert.throws(() => collectionPayload(access, facts({ presented: '' })));
  assert.throws(() => collectionPayload(access, facts({ collected: '31', presented: '30' })), /maior/);
  assert.throws(() => collectionPayload(access, facts({ presented: '0', collected: '0' })), /Não avaliado/);
  assert.throws(() => collectionPayload(access, facts({ oilCondition: 'NOT_ASSESSED' })), /Não avaliado/);
  assert.throws(() => collectionPayload(access, facts({ occurrence: 'true' })), /observação/);
  assert.throws(() => collectionPayload(access, facts({ oilCondition: 'UNACCEPTABLE' })), /observação/);
  assert.deepEqual(Object.keys(collectionPayload(access, facts())), ['access', 'collectedVolumeLiters', 'presentedVolumeLiters', 'oilCondition', 'hasCompromisingOccurrence', 'failureReasonCodes', 'observation']);
});
test('cada pedido gera uma coleta; reenvio equivalente não duplica e divergência conflita', () => {
  const store = storage(); ready(store);
  const first = recordB2BCollection(store, request, access, facts(), now);
  assert.equal(first.result, 'SUCCESSFUL');
  assert.equal(first.recordStatus, 'RECORDED');
  assert.deepEqual(recordB2BCollection(store, request, access, facts(), '2026-11-01T13:00:00Z'), first);
  assert.throws(() => recordB2BCollection(store, request, access, facts({ presented: '31' }), now), /Conflito/);
  assert.equal(readB2B(store).collections.length, 1);
  assert.equal(b2bContext(store, access).requests.length, 1);
  const saved = store.getItem(B2B_KEY);
  assert.equal(saved.includes(access.cpf), false);
  assert.equal(saved.includes(access.qrToken), false);
});
test('visita sem recolhimento registra zero com condição e motivos coerentes', () => {
  const store = storage(); ready(store);
  const empty = facts({ collected: '0', presented: '0', oilCondition: 'NOT_ASSESSED', observation: 'Não havia óleo disponível.', failureReasonCodes: ['VOLUME_OUT_OF_TOLERANCE'] });
  const result = recordB2BCollection(store, request, access, empty, now);
  assert.equal(result.collectedVolumeLiters, 0); assert.equal(result.result, 'UNSUCCESSFUL');
});
test('motivos precisam refletir os fatos e não podem usar exceções administrativas', () => {
  const store = storage(); ready(store);
  assert.throws(() => recordB2BCollection(store, request, access, facts({ collected: '10' }), now), /motivos/);
  assert.throws(() => recordB2BCollection(store, request, access, facts({ failureReasonCodes: ['OIL_UNACCEPTABLE'] }), now), /motivos/);
  assert.throws(() => collectionPayload(access, facts({ failureReasonCodes: ['ESTABLISHMENT_CLOSED'] })), /inválido/);
  const result = recordB2BCollection(store, request, access, facts({ oilCondition: 'UNACCEPTABLE', observation: 'Óleo contaminado.', failureReasonCodes: ['OIL_UNACCEPTABLE'] }), now);
  assert.equal(result.result, 'UNSUCCESSFUL');
});
test('falha de gravação ou estado corrompido não confirma operação', () => {
  const store = storage(); ready(store);
  const original = store.getItem(B2B_KEY);
  store.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.throws(() => recordB2BCollection(store, request, access, facts(), now), /não foi confirmada/);
  assert.equal(store.getItem(B2B_KEY), original);
  const corrupted = storage(); corrupted.setItem(B2B_KEY, '{');
  assert.throws(() => recordArrival(corrupted, request, access, now));
  assert.equal(corrupted.getItem(B2B_KEY), '{');
});
