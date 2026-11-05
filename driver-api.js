import { API_BASE_URL } from './pev-api-auth.js';
import { createCollectionApi } from './collection-api.js';

export function driverAccess({ cpf, cnh, qrToken }) {
  const clean = (value) => String(value || '').replace(/[.\s-]/g, '');
  cpf = clean(cpf); cnh = clean(cnh);
  if (!/^\d{11}$/.test(cpf) || !/^\d{11}$/.test(cnh) || !/^[A-Za-z0-9_-]{43}$/.test(qrToken)) {
    throw new Error('Informe CPF e CNH com 11 dígitos e abra o link válido da empresa pelo mobile.');
  }
  return Object.freeze({ cpf, cnh, qrToken });
}

export function createDriverApi({ baseUrl = API_BASE_URL, fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const collection = createCollectionApi({ baseUrl, fetchImpl });
  const base = new URL(baseUrl);
  const prefix = base.pathname.replace(/\/$/, '');
  async function post(path, input) {
    const body = JSON.stringify(driverAccess(input));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response;
      try {
        response = await fetchImpl(`${base.origin}${prefix}${path}`, {
          method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body, credentials: 'omit', cache: 'no-store', redirect: 'error',
          referrerPolicy: 'no-referrer', signal: controller.signal,
        });
      } catch (error) {
        throw new Error('Não foi possível consultar a operação. Confira a conexão e a liberação do Forms na API. Se estava registrando chegada, consulte novamente antes de continuar.');
      }
      if (!response.ok) {
        const messages = { 400: 'Confira CPF, CNH e o link recebido do mobile.',
          401: 'A identificação do motorista não foi aceita.', 403: 'Motorista ou operação sem autorização.',
          404: 'Motorista, empresa ou solicitação não encontrados.',
          409: 'A solicitação está em conflito. Atualize o contexto antes de continuar.',
          422: 'O estado desta solicitação não permite esta operação.', 429: 'Aguarde antes de tentar novamente.' };
        throw new Error(messages[response.status] || 'A API não concluiu a operação.');
      }
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  return {
    async context(access, page = 0) {
      if (!Number.isSafeInteger(page) || page < 0) throw new Error('Página inválida.');
      const result = await post(`/api/v1/operations/b2b/context?page=${page}&size=20`, access);
      if (!result?.establishmentId || typeof result.establishmentName !== 'string' || !result.driverId ||
          typeof result.driverName !== 'string' || !Array.isArray(result.requests) || !Array.isArray(result.failureReasons) ||
          result.page !== page || result.size !== 20 || !Number.isSafeInteger(result.totalElements) ||
          result.requests.some((item) => !item?.id || !Number.isFinite(Date.parse(item.scheduledAt))) ||
          result.failureReasons.some((item) => typeof item?.code !== 'string' || typeof item.name !== 'string')) {
        throw new Error('O contexto retornado pela API está incompleto.');
      }
      return result;
    },
    async arrival(requestId, access) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw new Error('Solicitação inválida.');
      const result = await post(`/api/v1/operations/b2b/requests/${requestId}/arrival`, access);
      if (result?.id !== requestId || !Number.isFinite(Date.parse(result.arrival?.arrivedAt))) {
        throw new Error('A API não devolveu a chegada esperada. Consulte o contexto novamente.');
      }
      return result;
    },
    async confirmCollection(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const result = await collection.confirmCollection({ ...input, signal: controller.signal });
        if (Number(result.collection.collectedVolumeLiters) !== input.payload.collectedVolumeLiters ||
            !Number.isFinite(Date.parse(result.collection.collectionDate)) ||
            !['SUCCESSFUL', 'UNSUCCESSFUL'].includes(result.collection.result)) {
          throw new Error('A API não devolveu o comprovante completo. Preserve os mesmos dados para verificar o resultado.');
        }
        return result;
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('O tempo de resposta terminou. O resultado é incerto; reenvie a mesma operação para verificar sem duplicar.');
        throw error;
      }
      finally { clearTimeout(timer); }
    },
  };
}
