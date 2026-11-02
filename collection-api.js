// Integração isolada: uma confirmação, uma chamada HTTP, sem módulos administrativos.
// O chamador fornece dados reais obtidos no fluxo operacional. Não usa fixtures da demo.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOCUMENT = /^\d{11}$/;
const QR_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const CONDITIONS = ['ACCEPTABLE', 'UNACCEPTABLE', 'NOT_ASSESSED'];

export function collectionDTO(input) {
  if (!input || !DOCUMENT.test(input.access?.cpf) || !DOCUMENT.test(input.access?.cnh) || !QR_TOKEN.test(input.access?.qrToken)) {
    throw new Error('Informe a identificação operacional válida e o QR do estabelecimento.');
  }
  const volume = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 999999.99 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
  if (!volume(input.collectedVolumeLiters) || !volume(input.presentedVolumeLiters) || input.collectedVolumeLiters > input.presentedVolumeLiters) {
    throw new Error('Confira os volumes apresentado e coletado, com até duas casas decimais.');
  }
  if (!CONDITIONS.includes(input.oilCondition) || (input.presentedVolumeLiters === 0) !== (input.oilCondition === 'NOT_ASSESSED') || typeof input.hasCompromisingOccurrence !== 'boolean') {
    throw new Error('Informe a condição do óleo e se houve ocorrência comprometedora.');
  }
  if (!Array.isArray(input.failureReasonCodes) || input.failureReasonCodes.length > 100 || input.failureReasonCodes.some((code) => typeof code !== 'string' || !code.trim() || code.length > 50)) {
    throw new Error('Informe os motivos válidos da operação.');
  }
  const observation = input.observation == null ? null : input.observation;
  if (observation !== null && (typeof observation !== 'string' || !observation.trim() || observation.length > 1000)) {
    throw new Error('A observação deve conter texto e ter até 1.000 caracteres.');
  }
  if ((input.presentedVolumeLiters === 0 || input.oilCondition === 'UNACCEPTABLE' || input.hasCompromisingOccurrence) && !observation) {
    throw new Error('Esta condição de visita exige observação.');
  }
  // Não inferir fatos ou enviar o objeto inteiro da tela. Estes são os campos do DTO atual.
  return {
    access: { cpf: input.access.cpf, cnh: input.access.cnh, qrToken: input.access.qrToken },
    collectedVolumeLiters: input.collectedVolumeLiters,
    presentedVolumeLiters: input.presentedVolumeLiters,
    oilCondition: input.oilCondition,
    hasCompromisingOccurrence: input.hasCompromisingOccurrence,
    failureReasonCodes: [...input.failureReasonCodes],
    observation,
  };
}

export function createCollectionApi({ baseUrl, fetchImpl = globalThis.fetch }) {
  const base = new URL(baseUrl);
  if (base.username || base.password || base.search || base.hash || !['http:', 'https:'].includes(base.protocol)) throw new Error('Configure apenas a origem e o prefixo da API, sem credenciais.');
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Use HTTPS para conectar a API fora do ambiente local.');
  const prefix = base.pathname.replace(/\/$/, '');

  return {
    async confirmCollection({ requestId, payload, signal }) {
      if (!UUID.test(requestId)) throw new Error('Selecione uma solicitação real da API.');
      const dto = collectionDTO(payload);
      const target = new URL(base.href);
      // baseUrl deve ser a origem ou o prefixo de implantação, sem /api/v1.
      target.pathname = `${prefix}/api/v1/operations/b2b/requests/${requestId}/collection`;
      let response;
      try {
        response = await fetchImpl(target.href, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'omit', cache: 'no-store', redirect: 'error', body: JSON.stringify(dto), signal,
        });
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        // Sem retorno, não é possível afirmar que o servidor não salvou. Preservar payload e pedido.
        throw new Error('Não foi possível receber a confirmação da API. Preserve esta solicitação e os mesmos dados para consultar ou reenviar sem duplicar.');
      }
      if (!response.ok) {
        const messages = {
          400: 'A API recusou os dados da coleta. Confira os campos da operação.',
          401: 'A identificação operacional não foi aceita pela API.',
          403: 'A operação não foi autorizada. Confira motorista, chegada e aceite do estabelecimento.',
          404: 'Solicitação ou identificação não encontrada na API.',
          409: 'A solicitação está em conflito ou já possui coleta com outros dados. Não crie outro pedido para repetir o envio.',
          422: 'Os fatos ou o estado da solicitação não permitem confirmar esta coleta.',
          429: 'A API atingiu o limite temporário de tentativas. Aguarde antes de reenviar.',
        };
        throw new Error(messages[response.status] || 'A API não confirmou a operação. Preserve os dados para verificar o resultado antes de tentar novamente.');
      }
      let detail;
      try { detail = await response.json(); }
      catch { throw new Error('A API respondeu, mas o comprovante não pôde ser lido. Preserve o pedido e os dados antes de reenviar.'); }
      if (!detail?.collection || typeof detail.collection.id !== 'string' || detail.collection.requestId !== requestId) {
        throw new Error('A resposta não contém o comprovante esperado desta solicitação. Verifique o resultado na API antes de reenviar.');
      }
      return detail;
    },
  };
}
