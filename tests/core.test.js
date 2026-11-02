import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, saoPauloDay, parseLiters, readDeliveries, dailyCount, confirmDelivery, confirmPevDelivery, deliveryPayload, isPevRecord, authenticatePevDemo, DEMO_PASSWORD, ACCESS_TEST_ACCOUNTS } from '../core.js';
import { requireApprovedPev } from '../pev-access.js';

function storage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
const now = '2026-11-01T12:00:00Z';
const operation = (id, extra = {}) => ({ id, participantId: 'b2c-001', operatorId: 'op-001', rawLiters: '5,50', ...extra });

test('data diária usa São Paulo, inclusive na virada do dia UTC', () => {
  assert.equal(saoPauloDay('2026-11-02T02:59:59Z'), '2026-11-01');
  assert.equal(saoPauloDay('2026-11-02T03:00:00Z'), '2026-11-02');
});
test('aceita litros positivos e decimais em português, rejeita valores ambíguos', () => {
  assert.equal(parseLiters(' 30 '), 30);
  assert.equal(parseLiters('5,50'), 5.5);
  assert.equal(parseLiters('0.01'), 0.01);
  for (const input of ['', '0', '-1', 'NaN', 'Infinity', '1.000,50', '1,2,3', '1e3', '1.234', '1 litro']) {
    assert.throws(() => parseLiters(input));
  }
});
test('repetir a mesma confirmação não duplica operação ou litros', () => {
  const store = storage();
  const record = confirmDelivery(store, operation('delivery-1'), now);
  assert.deepEqual(confirmDelivery(store, operation('delivery-1'), now), record);
  assert.throws(() => confirmDelivery(store, operation('delivery-1', { rawLiters: '99' }), now), /Conflito de reenvio/);
  assert.equal(readDeliveries(store).length, 1);
  assert.equal(readDeliveries(store)[0].liters, 5.5);
});
test('permite duas entregas próximas e bloqueia a terceira no mesmo ponto', () => {
  const store = storage();
  confirmDelivery(store, operation('delivery-1'), now);
  confirmDelivery(store, operation('delivery-2'), now);
  assert.equal(dailyCount(readDeliveries(store), 'b2c-001', 'pev-centro', now), 2);
  assert.throws(() => confirmDelivery(store, operation('delivery-3'), now), /duas entregas/);
  // Reenviar uma operação já salva continua válido mesmo após atingir o limite.
  assert.equal(confirmDelivery(store, operation('delivery-2'), now).id, 'delivery-2');
  assert.equal(readDeliveries(store).length, 2);
});
test('PEVs têm contagens independentes e B2B não pode ser lançado como entrega B2C', () => {
  const store = storage();
  confirmDelivery(store, operation('delivery-1'), now);
  confirmDelivery(store, operation('delivery-2'), now);
  confirmDelivery(store, operation('delivery-3', { operatorId: 'op-002' }), now);
  assert.throws(() => confirmDelivery(store, operation('delivery-4', { participantId: 'b2b-001' }), now), /API B2C aceita somente cidadão/);
  assert.equal(readDeliveries(store).length, 3);
  assert.equal(dailyCount(readDeliveries(store), 'b2c-001', 'pev-vila', now), 1);
});

test('payload B2C segue nomes atuais, limite de volume e preserva data no reenvio', () => {
  const payload = deliveryPayload({ id: 'key', participantId: 'b2c-001', rawLiters: '999,99', deliveryDate: now });
  assert.deepEqual(Object.keys(payload), ['idempotencyKey', 'qrToken', 'oilVolumeLiters', 'deliveryDate']);
  assert.equal(payload.oilVolumeLiters, 999.99);
  assert.throws(() => deliveryPayload({ id: 'key', participantId: 'b2c-001', rawLiters: '1000', deliveryDate: now }));
  const store = storage();
  const input = operation('date-key', { deliveryDate: now });
  confirmDelivery(store, input, now);
  assert.equal(confirmDelivery(store, input, '2026-11-01T13:00:00Z').deliveryDate, now);
  assert.throws(() => confirmDelivery(store, operation('date-key', { deliveryDate: '2026-11-01T13:00:00Z' }), '2026-11-01T13:00:00Z'), /Conflito de reenvio/);
});
test('limite libera no dia seguinte em São Paulo, não à meia-noite UTC', () => {
  const store = storage();
  confirmDelivery(store, operation('delivery-1'), now);
  confirmDelivery(store, operation('delivery-2'), now);
  assert.throws(() => confirmDelivery(store, operation('delivery-3'), '2026-11-02T02:59:59Z'), /duas entregas/);
  assert.equal(confirmDelivery(store, operation('delivery-3'), '2026-11-02T03:00:00Z').id, 'delivery-3');
});
test('identificador de outra operação não pode ser reutilizado por outro responsável', () => {
  const store = storage();
  confirmDelivery(store, operation('delivery-1'), now);
  assert.throws(() => confirmDelivery(store, operation('delivery-1', { operatorId: 'op-002' }), now), /outra operação/);
});
test('dados locais corrompidos não são apagados ou substituídos', () => {
  for (const value of ['{', '{}', '[{"id":"invalid"}]', '[null]']) {
    const store = storage(); store.setItem(STORAGE_KEY, value);
    assert.throws(() => confirmDelivery(store, operation('delivery-1'), now));
    assert.equal(store.getItem(STORAGE_KEY), value);
  }
});
test('falha de armazenamento não devolve uma confirmação falsa', () => {
  const store = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.throws(() => confirmDelivery(store, operation('delivery-1'), now), /Nenhum recebimento foi confirmado/);
});
test('participantes e responsáveis inexistentes não podem registrar', () => {
  const store = storage();
  assert.throws(() => confirmDelivery(store, operation('delivery-1', { participantId: 'invalid' }), now), /inválida/);
  assert.throws(() => confirmDelivery(store, operation('delivery-1', { operatorId: 'invalid' }), now), /inválida/);
  assert.equal(readDeliveries(store).length, 0);
});

test('PEV recebe B2B e B2C sem motorista, com identidades e limite independentes', () => {
  const store = storage();
  const input = operation('pev-b2b-1', { participantId: 'b2b-001', rawLiters: '30' });
  const first = confirmPevDelivery(store, input, now);
  assert.equal(first.flow, 'PEV'); assert.equal(first.participantType, 'B2B');
  assert.equal(first.liters, 30); assert.equal(first.driverId, undefined);
  assert.deepEqual(confirmPevDelivery(store, input, now), first);
  confirmPevDelivery(store, { ...input, id: 'pev-b2b-2' }, now);
  assert.throws(() => confirmPevDelivery(store, { ...input, id: 'pev-b2b-3' }, now), /duas entregas/);
  confirmPevDelivery(store, operation('pev-b2c-1'), now);
  confirmPevDelivery(store, { ...input, id: 'other-pev', operatorId: 'op-002' }, now);
  assert.equal(readDeliveries(store).length, 4);
  assert.equal(store.getItem('olius.forms.b2b.v1'), null);
  assert.throws(() => deliveryPayload({ id: 'key', participantId: 'b2b-001', rawLiters: '30', deliveryDate: now }), /API B2C/);
});

test('registros antigos não marcados como entrega B2B em PEV não entram nesse histórico', () => {
  assert.equal(isPevRecord({ participantId: 'b2b-001' }), false);
  assert.equal(isPevRecord({ participantId: 'b2b-001', flow: 'PEV' }), true);
  assert.equal(isPevRecord({ participantId: 'b2c-001' }), true);
});

test('acesso por e-mail libera apenas conta ativa com PEV aprovado vinculado', () => {
  assert.equal(authenticatePevDemo(' BRUNO@OLIUS.DEMO ', DEMO_PASSWORD).pevId, 'pev-vila');
  assert.equal(authenticatePevDemo('ana@olius.demo', DEMO_PASSWORD).pevId, 'pev-centro');
  assert.throws(() => authenticatePevDemo('bruno@olius.demo', 'errada'), /E-mail ou senha/);
  assert.throws(() => authenticatePevDemo('sempev@olius.demo', DEMO_PASSWORD), /Somente o responsável/);
  assert.throws(() => authenticatePevDemo('pendente@olius.demo', DEMO_PASSWORD), /não está aprovado/);
  assert.throws(() => authenticatePevDemo('inativo@olius.demo', DEMO_PASSWORD), /inativa/);
});

test('validação de perfil usa vínculo PEV e seu status, não o texto do e-mail ou apenas tipo B2B/B2C', () => {
  const user = { id: 'user-test', userType: 'CITIZENS', status: 'ACTIVE' };
  assert.deepEqual(requireApprovedPev(user, { id: 'pev-test', status: 'APPROVED' }), { userId: 'user-test', pevId: 'pev-test' });
  assert.throws(() => requireApprovedPev(user, null), /Somente o responsável/);
  for (const status of ['PENDING', 'REJECTED', 'INACTIVE']) assert.throws(() => requireApprovedPev(user, { id: 'pev-test', status }), /não está aprovado/);
  assert.throws(() => requireApprovedPev({ ...user, userType: 'ADMIN' }, { id: 'pev-test', status: 'APPROVED' }), /Somente o responsável/);
});

test('conta sem autorização não grava entrega B2B ou B2C, mesmo chamando a função diretamente', () => {
  const store = storage();
  for (const account of ACCESS_TEST_ACCOUNTS) {
    for (const participantId of ['b2b-001', 'b2c-001']) {
      assert.throws(() => confirmPevDelivery(store, operation('denied', { participantId, operatorId: account.id }), now));
    }
  }
  assert.equal(store.getItem(STORAGE_KEY), null);
});
