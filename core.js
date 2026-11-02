// Regras da demonstração. Não substituem autorização e validação no servidor.
import { requireApprovedPev } from './pev-access.js';
export const STORAGE_KEY = 'olius.forms.deliveries.v1';
export const DAILY_LIMIT = 2;
export const PARTICIPANTS = Object.freeze([
  Object.freeze({ id: 'b2b-001', name: 'Restaurante Sabor da Terra', type: 'B2B', initials: 'ST', qrToken: 'b'.repeat(43) }),
  Object.freeze({ id: 'b2c-001', name: 'Mariana Oliveira', type: 'B2C', initials: 'MO', qrToken: 'c'.repeat(43) }),
]);
export const OPERATORS = Object.freeze([
  Object.freeze({ id: 'op-001', name: 'Ana Souza', email: 'ana@olius.demo', status: 'ACTIVE', userType: 'ESTABLISHMENT', pevId: 'pev-centro', pevName: 'PEV Centro', pevStatus: 'APPROVED' }),
  Object.freeze({ id: 'op-002', name: 'Bruno Lima', email: 'bruno@olius.demo', status: 'ACTIVE', userType: 'CITIZENS', pevId: 'pev-vila', pevName: 'PEV Vila', pevStatus: 'APPROVED' }),
]);
export const ACCESS_TEST_ACCOUNTS = Object.freeze([
  Object.freeze({ id: 'access-no-pev', name: 'Conta sem PEV', email: 'sempev@olius.demo', status: 'ACTIVE', userType: 'CITIZENS', pevId: null, pevName: null, pevStatus: null }),
  Object.freeze({ id: 'access-pending', name: 'PEV pendente', email: 'pendente@olius.demo', status: 'ACTIVE', userType: 'ESTABLISHMENT', pevId: 'pev-pending', pevName: 'PEV pendente', pevStatus: 'PENDING' }),
  Object.freeze({ id: 'access-inactive', name: 'Conta inativa', email: 'inativo@olius.demo', status: 'INACTIVE', userType: 'CITIZENS', pevId: 'pev-inactive', pevName: 'PEV de teste', pevStatus: 'APPROVED' }),
]);
export const DEMO_ACCOUNTS = Object.freeze([...OPERATORS, ...ACCESS_TEST_ACCOUNTS]);
export const DEMO_PASSWORD = 'OliusDemo123!';

export function requireDemoPev(account) {
  requireApprovedPev(account, account?.pevId ? { id: account.pevId, status: account.pevStatus } : null);
  return account;
}

export function authenticatePevDemo(email, password) {
  const account = DEMO_ACCOUNTS.find((person) => person.email === String(email).trim().toLowerCase());
  if (!account || password !== DEMO_PASSWORD) throw new Error('E-mail ou senha incorretos. Para apresentar, use uma das contas de demonstração.');
  return requireDemoPev(account);
}

export function saoPauloDay(instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (name) => parts.find((part) => part.type === name).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function parseLiters(raw, { allowZero = false, max = 999.99 } = {}) {
  const value = String(raw).trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value)) {
    throw new Error('Informe os litros usando até duas casas decimais. Ex.: 5 ou 5,50.');
  }
  const liters = Number(value.replace(',', '.'));
  if (!Number.isFinite(liters) || (allowZero ? liters < 0 : liters <= 0) || liters > max) {
    throw new Error(`Informe uma quantidade ${allowZero ? 'a partir de zero' : 'maior que zero'}, até ${new Intl.NumberFormat('pt-BR').format(max)} litros.`);
  }
  return liters;
}

export function readDeliveries(storage) {
  let rows;
  try { rows = JSON.parse(storage.getItem(STORAGE_KEY) || '[]'); }
  catch { throw new Error('Não foi possível ler o histórico deste navegador. Os dados não foram alterados.'); }
  if (!Array.isArray(rows) || rows.some((row) => !row ||
    typeof row.id !== 'string' || !row.id ||
    !PARTICIPANTS.some((participant) => participant.id === row.participantId) ||
    !OPERATORS.some((operator) => operator.id === row.operatorId && operator.pevId === row.pevId) ||
    !Number.isFinite(row.liters) || row.liters <= 0 || !Number.isFinite(Date.parse(row.createdAt))) ||
    new Set(rows.map((row) => row.id)).size !== rows.length) {
    throw new Error('O histórico local está em um formato inválido. Os dados não foram alterados.');
  }
  return rows;
}

export function dailyCount(rows, participantId, pevId, now = new Date()) {
  const day = saoPauloDay(now);
  return rows.filter((row) => isPevRecord(row) && row.participantId === participantId && row.pevId === pevId && saoPauloDay(row.createdAt) === day).length;
}

export function isPevRecord(record) {
  return record.flow === 'PEV' || PARTICIPANTS.some((person) => person.id === record.participantId && person.type === 'B2C');
}

export function deliveryPayload({ id, participantId, rawLiters, deliveryDate }) {
  const participant = PARTICIPANTS.find((person) => person.id === participantId && person.type === 'B2C');
  if (!participant) throw new Error('A rota atual da API B2C aceita somente cidadão. A entrega B2B em PEV usa a simulação local separada.');
  return { idempotencyKey: id, qrToken: participant.qrToken, oilVolumeLiters: parseLiters(rawLiters), deliveryDate };
}

export function confirmDelivery(storage, { id, participantId, operatorId, rawLiters, deliveryDate }, now = new Date()) {
  // Adaptador do contrato B2C atual: não enviar estabelecimento à rota exclusiva de cidadão.
  if (!PARTICIPANTS.some((person) => person.id === participantId)) throw new Error('A identificação da operação é inválida. Abra novamente o link do QR Code.');
  const payload = deliveryPayload({ id, participantId, rawLiters, deliveryDate: deliveryDate || new Date(now).toISOString() });
  return savePevReceipt(storage, { id, participantId, operatorId, liters: payload.oilVolumeLiters, deliveryDate: payload.deliveryDate }, now);
}

export function confirmPevDelivery(storage, input, now = new Date()) {
  const participant = PARTICIPANTS.find((person) => person.id === input.participantId);
  if (!participant) throw new Error('A identificação da operação é inválida. Abra novamente o link do QR Code.');
  if (participant.type === 'B2C') return confirmDelivery(storage, input, now);
  // Regra de produto B2B → PEV, simulada localmente. Não chama a API B2C nem a de motorista.
  return savePevReceipt(storage, { id: input.id, participantId: participant.id, operatorId: input.operatorId,
    liters: parseLiters(input.rawLiters), deliveryDate: input.deliveryDate || new Date(now).toISOString() }, now);
}

function savePevReceipt(storage, { id, participantId, operatorId, liters, deliveryDate }, now) {
  const operator = DEMO_ACCOUNTS.find((person) => person.id === operatorId);
  const participant = PARTICIPANTS.find((person) => person.id === participantId);
  if (!operator || !participant || typeof id !== 'string' || !id) throw new Error('A identificação da operação é inválida. Abra novamente o link do QR Code.');
  requireDemoPev(operator);
  const rows = readDeliveries(storage);
  if (!Number.isFinite(Date.parse(deliveryDate)) || Date.parse(deliveryDate) > new Date(now).getTime()) throw new Error('A data da entrega deve ser válida e não pode estar no futuro.');
  const existing = rows.find((row) => row.id === id);
  if (existing) {
    if (existing.participantId !== participantId || existing.operatorId !== operatorId) throw new Error('Este código já pertence a outra operação.');
    if (existing.liters !== liters || (existing.deliveryDate || existing.createdAt) !== deliveryDate) throw new Error('Conflito de reenvio: preserve a quantidade e a data originais desta entrega.');
    return existing;
  }
  if (dailyCount(rows, participantId, operator.pevId, now) >= DAILY_LIMIT) {
    throw new Error('Este participante já registrou duas entregas neste PEV hoje. Uma nova entrega poderá ser registrada amanhã.');
  }
  const record = { id, participantId, participantType: participant.type, operatorId, pevId: operator.pevId, liters, deliveryDate,
    flow: 'PEV', createdAt: new Date(now).toISOString(), recordStatus: 'RECORDED' };
  try { storage.setItem(STORAGE_KEY, JSON.stringify([...rows, record])); }
  catch { throw new Error('Não foi possível salvar neste navegador. Verifique o armazenamento e tente novamente. Nenhum recebimento foi confirmado.'); }
  return record;
}
