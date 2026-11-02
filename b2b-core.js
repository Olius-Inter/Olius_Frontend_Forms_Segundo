import { PARTICIPANTS, parseLiters, saoPauloDay } from './core.js';

// Fixtures exclusivamente fictícias; nenhum documento real deve ser usado na demo.
export const DRIVERS = Object.freeze([
  Object.freeze({ id: 'driver-demo-001', name: 'Carlos Almeida', cpf: '12345678901', cnh: '12345678901' }),
  Object.freeze({ id: 'driver-demo-002', name: 'Luciana Costa', cpf: '98765432109', cnh: '98765432109' }),
]);
export const B2B_KEY = 'olius.forms.b2b.v1';
export const REQUESTS = Object.freeze([
  Object.freeze({ id: '10000000-0000-4000-8000-000000000001', label: 'Coleta de 30 litros', establishmentId: 'b2b-001', estimatedVolumeLiters: 30, status: 'APPROVED' }),
  Object.freeze({ id: '10000000-0000-4000-8000-000000000002', label: 'Coleta de 50 litros', establishmentId: 'b2b-001', estimatedVolumeLiters: 50, status: 'APPROVED' }),
]);
export const FAILURE_REASONS = Object.freeze([
  Object.freeze({ code: 'VOLUME_OUT_OF_TOLERANCE', name: 'Volume fora da tolerância do pedido' }),
  Object.freeze({ code: 'OIL_UNACCEPTABLE', name: 'Óleo inadequado' }),
  Object.freeze({ code: 'COMPROMISING_OCCURRENCE', name: 'Ocorrência comprometedora' }),
]);

export function identifyDriver({ cpf, cnh, qrToken }) {
  const driver = DRIVERS.find((person) => person.cpf === cpf && person.cnh === cnh);
  const participant = PARTICIPANTS.find((person) => person.type === 'B2B' && person.qrToken === qrToken);
  if (!driver || !participant) throw new Error('Identificação operacional inválida. Use os dados fictícios de um motorista da demonstração.');
  return { driverId: driver.id, driverName: driver.name, establishmentId: participant.id, establishmentName: participant.name };
}

export function readB2B(storage) {
  let state;
  try { state = JSON.parse(storage.getItem(B2B_KEY) || '{"requests":[],"collections":[]}'); }
  catch { throw new Error('Não foi possível ler as operações B2B. Os dados locais foram preservados.'); }
  const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
  if (!state || !Array.isArray(state.requests) || !Array.isArray(state.collections) ||
      state.requests.some((item) => !item || !REQUESTS.some((request) => request.id === item.id) ||
        !DRIVERS.some((driver) => driver.id === item.arrivalDriverId) || !validTime(item.arrivedAt) ||
        (item.serviceAcceptedAt !== null && !validTime(item.serviceAcceptedAt))) ||
      state.collections.some((row) => !row || typeof row.id !== 'string' || !REQUESTS.some((request) => request.id === row.requestId) ||
        !DRIVERS.some((driver) => driver.id === row.driverId) || !validTime(row.collectionDate) ||
        !Number.isFinite(row.collectedVolumeLiters) || row.collectedVolumeLiters < 0 ||
        !row.facts || !Array.isArray(row.failureReasonCodes)) ||
      new Set(state.requests.map((item) => item.id)).size !== state.requests.length ||
      new Set(state.collections.map((item) => item.requestId)).size !== state.collections.length) {
    throw new Error('As operações B2B locais estão em formato inválido. Os dados não foram apagados.');
  }
  return state;
}

function writeB2B(storage, state) {
  try { storage.setItem(B2B_KEY, JSON.stringify(state)); }
  catch { throw new Error('Não foi possível salvar a operação B2B neste navegador. A ação não foi confirmada.'); }
}

function requireRequest(requestId, identity) {
  const request = REQUESTS.find((item) => item.id === requestId && item.establishmentId === identity.establishmentId);
  if (!request) throw new Error('Solicitação indisponível para esta empresa.');
  return request;
}

export function b2bContext(storage, access) {
  const identity = identifyDriver(access);
  const state = readB2B(storage);
  const scheduledAt = `${saoPauloDay()}T15:00:00.000Z`;
  return {
    ...identity,
    requests: REQUESTS.filter((request) => request.establishmentId === identity.establishmentId && !state.collections.some((row) => row.requestId === request.id))
      .map((request) => ({ ...request, scheduledAt, arrivedAt: null, serviceAcceptedAt: null, ...state.requests.find((item) => item.id === request.id) })),
    failureReasons: FAILURE_REASONS,
  };
}

export function recordArrival(storage, requestId, access, now = new Date()) {
  const identity = identifyDriver(access);
  requireRequest(requestId, identity);
  const state = readB2B(storage);
  if (state.collections.some((row) => row.requestId === requestId)) throw new Error('Esta solicitação já possui uma coleta registrada.');
  const previous = state.requests.find((request) => request.id === requestId);
  if (previous) {
    if (previous.arrivalDriverId !== identity.driverId) throw new Error('A chegada já foi registrada por outro motorista.');
    return previous;
  }
  const arrival = { id: requestId, arrivedAt: new Date(now).toISOString(), arrivalDriverId: identity.driverId, serviceAcceptedAt: null };
  state.requests.push(arrival); writeB2B(storage, state); return arrival;
}

// Recurso da apresentação: representa uma ação feita pelo estabelecimento no app.
// O formulário real NÃO deve chamar service-acceptance com a identidade do motorista.
export function simulateEstablishmentAcceptance(storage, requestId, now = new Date()) {
  const state = readB2B(storage);
  const request = state.requests.find((item) => item.id === requestId);
  if (!request) throw new Error('Registre a chegada antes de simular o aceite no aplicativo.');
  if (!request.serviceAcceptedAt) { request.serviceAcceptedAt = new Date(now).toISOString(); writeB2B(storage, state); }
  return request;
}

export function collectionPayload(access, facts) {
  identifyDriver(access);
  const collectedVolumeLiters = parseLiters(facts.collected, { allowZero: true, max: 999999.99 });
  const presentedVolumeLiters = parseLiters(facts.presented, { allowZero: true, max: 999999.99 });
  if (collectedVolumeLiters > presentedVolumeLiters) throw new Error('O volume coletado não pode ser maior que o volume apresentado.');
  if (!['ACCEPTABLE', 'UNACCEPTABLE', 'NOT_ASSESSED'].includes(facts.oilCondition)) throw new Error('Selecione a condição do óleo.');
  if ((presentedVolumeLiters === 0) !== (facts.oilCondition === 'NOT_ASSESSED')) throw new Error('Sem óleo apresentado, use “Não avaliado”. Com óleo apresentado, informe se é adequado ou inadequado.');
  if (!['true', 'false'].includes(String(facts.occurrence))) throw new Error('Informe se houve ocorrência comprometedora.');
  const hasCompromisingOccurrence = String(facts.occurrence) === 'true';
  const observation = String(facts.observation || '').trim() || null;
  if (observation && observation.length > 1000) throw new Error('A observação deve ter no máximo 1000 caracteres.');
  if ((presentedVolumeLiters === 0 || facts.oilCondition === 'UNACCEPTABLE' || hasCompromisingOccurrence) && !observation) throw new Error('Descreva a ausência de óleo, condição inadequada ou ocorrência no campo de observação.');
  const failureReasonCodes = [...new Set(facts.failureReasonCodes || [])].sort();
  if (failureReasonCodes.some((code) => !FAILURE_REASONS.some((reason) => reason.code === code))) throw new Error('Motivo de insucesso inválido para o fluxo do motorista.');
  return { access: { cpf: access.cpf, cnh: access.cnh, qrToken: access.qrToken }, collectedVolumeLiters, presentedVolumeLiters,
    oilCondition: facts.oilCondition, hasCompromisingOccurrence, failureReasonCodes, observation };
}

export function expectedReasons(request, payload) {
  // Mesmos limites conferidos em record_collection_internal; só a API oficial calcula o resultado real.
  const volumeOut = payload.collectedVolumeLiters < request.estimatedVolumeLiters * .9 - 1e-8 || payload.collectedVolumeLiters > request.estimatedVolumeLiters * 1.1 + 1e-8;
  return [volumeOut && 'VOLUME_OUT_OF_TOLERANCE', payload.oilCondition === 'UNACCEPTABLE' && 'OIL_UNACCEPTABLE', payload.hasCompromisingOccurrence && 'COMPROMISING_OCCURRENCE'].filter(Boolean).sort();
}

export function recordB2BCollection(storage, requestId, access, facts, now = new Date()) {
  const identity = identifyDriver(access);
  const request = requireRequest(requestId, identity);
  const payload = collectionPayload(access, facts);
  const { access: ignoredAccess, ...canonical } = payload; // Não persistir CPF, CNH ou token QR.
  const state = readB2B(storage);
  const existing = state.collections.find((row) => row.requestId === requestId);
  if (existing) {
    if (existing.driverId !== identity.driverId || JSON.stringify(existing.facts) !== JSON.stringify(canonical)) throw new Error('Conflito de reenvio: esta solicitação já possui coleta com outros dados.');
    return existing;
  }
  const arrival = state.requests.find((item) => item.id === requestId);
  if (!arrival || arrival.arrivalDriverId !== identity.driverId) throw new Error('Registre a chegada com este motorista antes de confirmar a coleta.');
  if (!arrival.serviceAcceptedAt) throw new Error('Aguarde o aceite do estabelecimento no aplicativo.');
  const expected = expectedReasons(request, payload);
  if (JSON.stringify(expected) !== JSON.stringify(payload.failureReasonCodes)) throw new Error('Os motivos de insucesso devem corresponder aos volumes, à condição do óleo e à ocorrência informados.');
  const record = { id: crypto.randomUUID(), requestId, establishmentId: identity.establishmentId,
    driverId: identity.driverId, driverName: identity.driverName, ...canonical, facts: canonical,
    result: expected.length ? 'UNSUCCESSFUL' : 'SUCCESSFUL', recordStatus: 'RECORDED', revision: 1,
    collectionDate: new Date(now).toISOString(), createdAt: new Date(now).toISOString() };
  state.collections.push(record); writeB2B(storage, state); return record;
}
