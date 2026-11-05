import { createPevApiAuth } from './pev-api-auth.js';
import { createDriverApi, driverAccess } from './driver-api.js';
import { deliveryDTO } from './delivery-api.js';
import { collectionDTO } from './collection-api.js';
import { mobileContext } from './mobile-link.js';
import { parseLiters } from './core.js';

export function createApiFlow({ shell, escape, errorBox, feedback, isActive }) {
  const pev = createPevApiAuth();
  const driver = createDriverApi();
  const date = (value) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(value)) : 'Não informado';
  let participant = null, context = null, access = null, selectedId = null;
  let receipt = null, pending = null, busy = false, volume = '';
  let reauthenticate = false, pendingActor = null;
  let currentUrl = null, currentFlow = null, currentToken = null;
  let facts = { presented: '', collected: '', condition: 'ACCEPTABLE', occurrence: 'false', reasons: [], observation: '' };
  const link = () => mobileContext();
  const request = () => context?.requests.find((item) => item.id === selectedId);

  window.addEventListener('beforeunload', (event) => {
    if (pending && !receipt) { event.preventDefault(); event.returnValue = ''; }
  });

  function show(content) {
    shell(`<section class="card login-card">${content}</section>`, null, 'login-layout');
    document.querySelectorAll('[data-flow]').forEach((button) => button.addEventListener('click', () => {
      if (pending && !receipt) { feedback('Preserve esta operação. Reenvie os mesmos dados para verificar a confirmação antes de trocar o fluxo.'); return; }
      access = null; context = null; selectedId = null; participant = null; receipt = null; pending = null;
      const target = new URL(location.href);
      target.searchParams.set('modo', 'api');
      target.searchParams.set('fluxo', button.dataset.flow);
      history.pushState(null, '', target); render();
    }));
  }

  async function act(operation) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    let message;
    try { await operation(); }
    catch (error) { message = error.message || 'Não foi possível concluir a operação.'; }
    finally {
      busy = false;
      if (isActive()) { render(); if (message) feedback(message); }
    }
  }

  function changeFlow() {
    return '<button type="button" class="word-link" data-flow="">Trocar tipo de registro</button>';
  }
  function identity(name, type) {
    return `<div class="qr-context"><img src="./assets/lock.svg" alt=""><span>Participante identificado pela API<strong>${escape(name)}</strong></span><span class="tag">${escape(type)}</span></div>`;
  }

  function render() {
    const flow = new URLSearchParams(location.search).get('fluxo');
    const token = link().qrToken;
    if (busy) { if (currentUrl) history.replaceState(null, '', currentUrl); return; }
    if (flow !== currentFlow || token !== currentToken) {
      if (pending) {
        history.replaceState(null, '', currentUrl); render();
        feedback('Verifique o resultado da operação atual antes de trocar de participante ou fluxo.'); return;
      }
      participant = null; context = null; access = null; selectedId = null; receipt = null; volume = '';
      facts = { presented: '', collected: '', condition: 'ACCEPTABLE', occurrence: 'false', reasons: [], observation: '' };
      currentFlow = flow; currentToken = token;
    }
    currentUrl = location.href;
    if (!['pev', 'motorista'].includes(flow)) {
      show(`<span class="eyebrow">RECEBIMENTO DE ÓLEO</span><h1 tabindex="-1">Como deseja<br>registrar?</h1>
        <p class="intro">Escolha quem está recebendo o óleo. A API confirmará a identidade do participante.</p>
        <div class="flow-options"><button class="button primary" data-flow="pev">Entrega em PEV</button>
        <button class="button secondary" data-flow="motorista">Coleta com motorista</button></div>${errorBox()}`);
      return;
    }
    if (flow === 'motorista') { renderDriver(); return; }
    renderPev();
  }

  function renderPev() {
    const account = pev.currentAccount();
    if (!account || reauthenticate) {
      show(`<span class="eyebrow">CONTA EXISTENTE · PEV</span><h1 tabindex="-1">Entre com<br>sua conta.</h1>
        <p class="intro">Use a conta vinculada a um PEV aprovado para confirmar o óleo recebido.</p>
        <form id="real-login-form"><div class="field"><label for="real-email">E-mail</label><div class="input-icon"><img src="./assets/mail.svg" alt=""><input id="real-email" type="email" autocomplete="username" required></div></div>
        <div class="field"><label for="real-password">Senha</label><div class="input-icon"><img src="./assets/lock.svg" alt=""><input id="real-password" type="password" autocomplete="current-password" required></div></div>
        ${errorBox()}<button class="button primary" type="submit">Validar meu PEV →</button></form>
        ${changeFlow()}<p class="local-note">A autorização e o vínculo com o PEV são verificados pelo serviço.</p>`);
      document.querySelector('#real-login-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const email = document.querySelector('#real-email').value;
        const password = document.querySelector('#real-password').value;
        document.querySelector('#real-password').value = '';
        act(async () => {
          const authenticated = await pev.login(email, password);
          if (pending && authenticated.userId !== pendingActor) {
            try { await pev.logout(); } catch { /* Conta divergente não autoriza o reenvio. */ }
            throw new Error('Entre com a mesma conta que iniciou esta entrega para reenviar a operação.');
          }
          reauthenticate = false;
        });
      });
      return;
    }
    const logout = '<button type="button" class="word-link" id="real-logout">Encerrar acesso</button>';
    const footer = `<p class="local-note">Responsável: ${escape(account.name)}. Dados de acesso mantidos somente em memória.</p>${logout}`;
    if (receipt) {
      show(`<span class="eyebrow">CONFIRMADO PELA API</span><h1 tabindex="-1">Recebimento<br>registrado.</h1>
        ${identity(participant.name, 'B2C')}<dl class="receipt-details"><div><dt>Óleo recebido</dt><dd>${escape(receipt.oilVolumeLiters)} L</dd></div>
        <div><dt>Data</dt><dd>${escape(date(receipt.deliveryDate))}</dd></div><div><dt>Comprovante</dt><dd>${escape(receipt.id)}</dd></div>
        <div><dt>Pontos</dt><dd>${escape(receipt.pointsEarned ?? 'Consulte no app')}</dd></div></dl>
        <p class="notice soft">O registro foi confirmado pelo serviço. Os dados do app dependem das rotinas da API.</p>${errorBox()}${footer}`);
    } else if (!link().qrToken || link().type === 'B2B') {
      show(`<span class="eyebrow">ACESSO VALIDADO NA API</span><h1 tabindex="-1">Seu PEV<br>está aprovado.</h1>
        <div class="qr-context"><span>Responsável<strong>${escape(account.name)}</strong></span><span class="tag confirmed">Aprovado</span></div>
        <p class="intro">${link().type === 'B2B' ? 'O registro de entrega B2B em PEV ainda depende de uma rota compatível na API.' : 'Abra o link gerado pelo mobile com o qrToken do participante para registrar a entrega. Um ID de demonstração não identifica uma conta real.'}</p>
        ${errorBox()}${changeFlow()}${footer}`);
    } else if (!participant) {
      show(`<span class="eyebrow">ENTREGA EM PEV</span><h1 tabindex="-1">Identificar<br>participante.</h1>
        <p class="intro">Consulte o participante do link. O nome retornado pela API não poderá ser alterado.</p>
        ${errorBox()}<button class="button primary" id="resolve-participant">Identificar participante</button>${changeFlow()}${footer}`);
      document.querySelector('#resolve-participant').addEventListener('click', () => act(async () => {
        participant = await pev.resolveParticipant(link().qrToken);
      }));
    } else {
      show(`<span class="eyebrow">ENTREGA EM PEV</span><h1 tabindex="-1">Confirme o<br>óleo recebido.</h1>${identity(participant.name, 'B2C')}
        <form id="real-delivery-form" class="api-form"><div class="field"><label for="real-volume">Quantidade recebida (litros)</label>
        <input id="real-volume" inputmode="decimal" value="${escape(volume)}" ${pending ? 'readonly' : ''} required></div>
        <p class="local-note">A data e hora da entrega são definidas ao confirmar.</p>${errorBox()}
        ${pending ? '<p class="notice soft">Operação enviada. Em caso de falha, o reenvio preserva quantidade, data e chave para evitar duplicação. Não recarregue a página até verificar o resultado.</p>' : ''}
        <button class="button primary" type="submit">${pending ? 'Reenviar mesma entrega' : 'Confirmar recebimento'}</button></form>
        ${pending ? '<button type="button" class="word-link" id="reauthenticate">Entrar novamente com a mesma conta</button>' : ''}${footer}`);
      document.querySelector('#reauthenticate')?.addEventListener('click', () => { reauthenticate = true; render(); });
      document.querySelector('#real-volume').addEventListener('input', (event) => { volume = event.target.value; });
      document.querySelector('#real-delivery-form').addEventListener('submit', (event) => {
        event.preventDefault();
        act(async () => {
          if (!pending) {
            pending = deliveryDTO({ idempotencyKey: crypto.randomUUID(), qrToken: link().qrToken,
              oilVolumeLiters: parseLiters(volume), deliveryDate: new Date().toISOString() });
            pendingActor = account.userId;
          }
          receipt = await pev.confirmDelivery(pending, participant.id);
          pending = null;
        });
      });
    }
    document.querySelector('#real-logout').addEventListener('click', () => {
      if (pending) { feedback('Verifique primeiro o resultado da entrega reenviando os mesmos dados.'); return; }
      act(async () => {
        try { await pev.logout(); }
        finally { participant = null; receipt = null; volume = ''; }
      });
    });
  }

  function renderDriver() {
    if (!link().qrToken) {
      show(`<span class="eyebrow">COLETA COM MOTORISTA</span><h1 tabindex="-1">Abra pelo<br>aplicativo.</h1>
        <p class="intro">O link do estabelecimento precisa conter o qrToken real. CPF e CNH são informados somente no formulário.</p>${errorBox()}${changeFlow()}`);
      return;
    }
    if (!context) {
      show(`<span class="eyebrow">COLETA COM MOTORISTA</span><h1 tabindex="-1">Identifique-se<br>para coletar.</h1>
        <form id="real-driver-form" class="api-form"><div class="field"><label for="driver-cpf">CPF do motorista</label><input id="driver-cpf" inputmode="numeric" autocomplete="off" required></div>
        <div class="field"><label for="driver-cnh">CNH do motorista</label><input id="driver-cnh" inputmode="numeric" autocomplete="off" required></div>
        ${errorBox()}<button class="button primary" type="submit">Consultar solicitações</button></form>${changeFlow()}
        <p class="local-note">A consulta não registra chegada. Seus documentos não são salvos no navegador.</p>`);
      document.querySelector('#real-driver-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const input = { cpf: document.querySelector('#driver-cpf').value, cnh: document.querySelector('#driver-cnh').value, qrToken: link().qrToken };
        document.querySelector('#driver-cpf').value = ''; document.querySelector('#driver-cnh').value = '';
        act(async () => {
          const validated = driverAccess(input);
          const result = await driver.context(validated);
          access = validated; context = result;
        });
      });
      return;
    }
    if (receipt) {
      const collection = receipt.collection;
      show(`<span class="eyebrow">CONFIRMADO PELA API</span><h1 tabindex="-1">Coleta<br>registrada.</h1>${identity(context.establishmentName, 'B2B')}
        <dl class="receipt-details"><div><dt>Quantidade</dt><dd>${escape(collection.collectedVolumeLiters)} L</dd></div>
        <div><dt>Data</dt><dd>${escape(date(collection.collectionDate))}</dd></div><div><dt>Comprovante</dt><dd>${escape(collection.id)}</dd></div>
        <div><dt>Resultado</dt><dd>${collection.result === 'SUCCESSFUL' ? 'Bem-sucedida' : 'Sem sucesso'}</dd></div><div><dt>Pontos</dt><dd>${escape(collection.pointsEarned ?? 'Consulte no app')}</dd></div></dl>
        ${errorBox()}<button class="button primary" id="finish-driver">Encerrar operação</button>`);
      document.querySelector('#finish-driver').addEventListener('click', () => {
        access = null; context = null; selectedId = null; receipt = null; pending = null;
        facts = { presented: '', collected: '', condition: 'ACCEPTABLE', occurrence: 'false', reasons: [], observation: '' };
        render();
      });
      return;
    }
    const selected = request();
    if (!selected) {
      show(`<span class="eyebrow">SOLICITAÇÕES DISPONÍVEIS</span><h1 tabindex="-1">Selecione<br>a coleta.</h1>${identity(context.establishmentName, 'B2B')}
        <p class="intro">Motorista: ${escape(context.driverName)}. Somente solicitações retornadas pela API.</p>
        <ul class="request-list">${context.requests.map((item) => `<li><span>${escape(date(item.scheduledAt))}<br>${escape(item.estimatedVolumeLiters)} L previstos</span>
        <button class="button secondary small-button" data-request="${escape(item.id)}">Selecionar</button></li>`).join('')}</ul>
        ${context.requests.length ? '' : '<p class="notice soft">Nenhuma solicitação disponível nesta página.</p>'}
        ${errorBox()}${context.page > 0 ? '<button class="word-link" id="previous-page">Página anterior</button>' : ''}
        ${(context.page + 1) * context.size < context.totalElements ? '<button class="word-link" id="next-page">Próxima página</button>' : ''}
        <button class="word-link" id="reload-context">Atualizar solicitações</button>${changeFlow()}`);
      document.querySelectorAll('[data-request]').forEach((button) => button.addEventListener('click', () => { selectedId = button.dataset.request; render(); }));
      document.querySelector('#previous-page')?.addEventListener('click', () => reload(context.page - 1));
      document.querySelector('#next-page')?.addEventListener('click', () => reload(context.page + 1));
      document.querySelector('#reload-context').addEventListener('click', () => reload(context.page));
      return;
    }
    const allowed = Boolean(selected.arrivedAt && selected.serviceAcceptedAt);
    show(`<span class="eyebrow">COLETA COM MOTORISTA</span><h1 tabindex="-1">Confirme<br>a visita.</h1>${identity(context.establishmentName, 'B2B')}
      <div class="notice soft">Chegada: ${escape(selected.arrivedAt ? date(selected.arrivedAt) : 'Não registrada')}<br>
      Aceite no mobile: ${escape(selected.serviceAcceptedAt ? date(selected.serviceAcceptedAt) : 'Aguardando estabelecimento')}</div>
      ${!selected.arrivedAt ? '<button class="button primary" id="register-arrival">Registrar minha chegada</button>' : ''}
      ${!allowed ? '<p class="intro">O estabelecimento precisa aceitar o atendimento no próprio app após a chegada.</p>' : ''}
      <button class="word-link" id="reload-context">Atualizar chegada e aceite</button>
      ${allowed || pending ? driverForm() : ''}${errorBox()}
      ${pending ? '<p class="notice soft">Preserve esta operação e reenvie os mesmos dados até verificar o resultado. Não recarregue a página.</p>' : changeFlow()}`);
    document.querySelector('#register-arrival')?.addEventListener('click', () => act(async () => {
      const arrival = await driver.arrival(selected.id, access);
      if (arrival.establishmentId !== context.establishmentId || arrival.arrival.driverId !== context.driverId) throw new Error('A chegada não corresponde à operação atual. Consulte novamente.');
      selected.arrivedAt = arrival.arrival.arrivedAt;
      selected.serviceAcceptedAt = arrival.acceptance?.acceptedAt || null;
    }));
    document.querySelector('#reload-context').disabled = Boolean(pending);
    document.querySelector('#reload-context').addEventListener('click', () => reload(context.page));
    document.querySelector('#real-collection-form')?.addEventListener('input', captureFacts);
    document.querySelector('#real-collection-form')?.addEventListener('change', captureFacts);
    document.querySelector('#real-collection-form')?.addEventListener('submit', (event) => {
      event.preventDefault(); captureFacts();
      act(async () => {
        if (!pending) {
          if (!allowed) throw new Error('Atualize a chegada e o aceite antes de confirmar.');
          const payload = collectionDTO({ access, presentedVolumeLiters: parseLiters(facts.presented, { allowZero: true, max: 999999.99 }),
            collectedVolumeLiters: parseLiters(facts.collected, { allowZero: true, max: 999999.99 }),
            oilCondition: facts.condition, hasCompromisingOccurrence: facts.occurrence === 'true',
            failureReasonCodes: facts.reasons, observation: facts.observation.trim() || null });
          pending = { requestId: selected.id, payload };
        }
        const confirmed = await driver.confirmCollection(pending);
        if (confirmed.collection.establishmentId !== context.establishmentId || confirmed.collection.driverId !== context.driverId) {
          throw new Error('A resposta não corresponde à empresa e ao motorista desta operação. Preserve os dados para verificar o resultado.');
        }
        receipt = confirmed;
        pending = null; access = null;
      });
    });
  }

  function reload(page) {
    act(async () => {
      const result = await driver.context(access, page);
      if (result.establishmentId !== context.establishmentId || result.driverId !== context.driverId) throw new Error('A identidade operacional mudou. Abra novamente pelo mobile.');
      context = result;
      if (!request()) selectedId = null;
    });
  }

  function captureFacts() {
    if (pending) return;
    const form = document.querySelector('#real-collection-form');
    if (!form) return;
    const values = new FormData(form);
    facts = { presented: values.get('presented'), collected: values.get('collected'), condition: values.get('condition'),
      occurrence: values.get('occurrence'), reasons: values.getAll('reasons'), observation: values.get('observation') };
  }

  function driverForm() {
    const option = (value, label, current) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;
    return `<form id="real-collection-form" class="api-form"><fieldset ${pending ? 'disabled' : ''} class="api-fields"><legend>Dados da coleta</legend>
      <div class="field"><label for="presented">Volume apresentado (litros)</label><input id="presented" name="presented" inputmode="decimal" value="${escape(facts.presented)}" required></div>
      <div class="field"><label for="collected">Volume coletado (litros)</label><input id="collected" name="collected" inputmode="decimal" value="${escape(facts.collected)}" required></div>
      <div class="field"><label for="condition">Condição do óleo</label><select id="condition" name="condition">${option('ACCEPTABLE', 'Adequado', facts.condition)}${option('UNACCEPTABLE', 'Inadequado', facts.condition)}${option('NOT_ASSESSED', 'Sem óleo para avaliar', facts.condition)}</select></div>
      <div class="field"><label for="occurrence">Houve ocorrência comprometedora?</label><select id="occurrence" name="occurrence">${option('false', 'Não', facts.occurrence)}${option('true', 'Sim', facts.occurrence)}</select></div>
      <fieldset class="reason-options"><legend>Motivos aplicáveis</legend>${context.failureReasons.map((reason) => `<label><input type="checkbox" name="reasons" value="${escape(reason.code)}" ${facts.reasons.includes(reason.code) ? 'checked' : ''}>${escape(reason.name)}</label>`).join('')}</fieldset>
      <div class="field"><label for="observation">Observação</label><textarea id="observation" name="observation" maxlength="1000">${escape(facts.observation)}</textarea></div>
      </fieldset><button class="button primary" type="submit">${pending ? 'Reenviar mesma coleta' : 'Confirmar coleta'}</button></form>`;
  }
  return { render, hasPending: () => Boolean(pending) || busy };
}
