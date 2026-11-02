import { DRIVERS, b2bContext, collectionPayload, readB2B, recordArrival, simulateEstablishmentAcceptance, recordB2BCollection } from './b2b-core.js';

export function createB2BFlow({ shell, url, navigate, escape, feedback, errorBox, dateFormat, numberFormat, rerender }) {
  // Identificação operacional somente em memória. Reabrir a página exige identificá-la novamente.
  let access = null;
  const params = () => new URL(location.href).searchParams;
  const quantity = (value) => `${numberFormat.format(value)} L`;
  const draftKey = (id) => `olius.forms.collection-draft.${id}`;
  const link = (participant, values = {}) => url({ participante: participant.id, fluxo: 'motorista', ...values });
  const identityCard = (participant) => `<div class="identity-card"><span class="avatar">${participant.initials}</span><div><span class="muted identity-label">Empresa identificada pelo QR</span><h2>${escape(participant.name)}</h2><span class="muted identity-id">Coleta B2B · identificação sem edição</span></div><img class="identity-lock" src="./assets/lock.svg" alt="Identidade sem edição"></div>`;
  const driverLine = (context) => `<div class="operator-line"><span class="avatar small">${escape(context.driverName[0])}</span><span><strong>${escape(context.driverName)}</strong><span>Motorista identificado nesta página</span></span><button type="button" class="word-link driver-exit" id="driver-exit">Encerrar</button></div>`;
  const nav = (participant) => `<nav class="section-nav" aria-label="Navegação da coleta"><a href="${escape(link(participant))}">Solicitações</a><a href="${escape(link(participant, { tela: 'historico-b2b' }))}">Comprovantes locais</a><a href="${escape(link(participant, { fluxo: null }))}">Trocar tipo de registro</a></nav>`;
  const steps = (current) => `<ol class="steps b2b-steps" aria-label="Etapas da coleta">${['Solicitação', 'Chegada e aceite', 'Coleta'].map((name, index) => `<li class="${index < current ? 'done' : index === current ? 'current' : ''}" ${index === current ? 'aria-current="step"' : ''}><span>${index < current ? '✓' : index + 1}</span>${name}</li>`).join('')}</ol>`;

  function bindExit() {
    document.querySelector('#driver-exit')?.addEventListener('click', () => { access = null; rerender(); });
  }

  function show(content, context) {
    shell(`<section class="card form-card">${content}</section>`, null);
    if (context) bindExit();
  }

  function identify(participant) {
    show(`<span class="eyebrow">ACESSO OPERACIONAL · B2B</span><h1 tabindex="-1">Identifique-se<br>para a coleta.</h1><p class="intro">Informe os dados do motorista cadastrado. Neste fluxo, não há conta com e-mail e senha.</p>
      <div class="driver-identity">${identityCard(participant)}</div>
      <form id="driver-form" class="driver-form">
        <div class="field"><label for="cpf">CPF do motorista</label><input class="standard-input" id="cpf" name="cpf" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="Somente números" required aria-describedby="driver-help"></div>
        <div class="field"><label for="cnh">CNH do motorista</label><input class="standard-input" id="cnh" name="cnh" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="11 dígitos" required aria-describedby="driver-help"></div>
        <p class="local-note left-note" id="driver-help">Na apresentação, use apenas os documentos fictícios abaixo. A identificação é revalidada em cada ação no contrato real.</p>${errorBox()}
        <button class="button primary" type="submit">Consultar solicitações <span aria-hidden="true">→</span></button>
      </form>
      <details class="demo-accounts"><summary>Usar motorista de demonstração</summary><p>Dados fictícios, sem documentos reais.</p><div class="account-options">${DRIVERS.map((driver) => `<button class="account-option" data-driver="${driver.id}" type="button"><strong>${escape(driver.name)}</strong><span>Preencher identificação</span></button>`).join('')}</div></details>
      <a class="subtle-link" href="${escape(link(participant, { fluxo: null }))}">Trocar tipo de registro</a><p class="local-note">Abrir o link do aplicativo não registra chegada, coleta ou pontos.</p>`);
    document.querySelectorAll('[data-driver]').forEach((button) => button.addEventListener('click', () => {
      const driver = DRIVERS.find((person) => person.id === button.dataset.driver);
      document.querySelector('#cpf').value = driver.cpf; document.querySelector('#cnh').value = driver.cnh;
      document.querySelector('#driver-form button[type="submit"]').focus();
    }));
    document.querySelector('#driver-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const candidate = { cpf: document.querySelector('#cpf').value.replace(/\D/g, ''), cnh: document.querySelector('#cnh').value.replace(/\D/g, ''), qrToken: participant.qrToken };
      try { b2bContext(localStorage, candidate); access = candidate; rerender(); document.querySelector('main h1')?.focus(); }
      catch (error) { feedback(error.message); }
    });
  }

  async function action(button, work) {
    if (button.disabled) return;
    const text = button.textContent;
    button.disabled = true; button.textContent = 'Registrando…';
    try {
      if (navigator.locks) await navigator.locks.request('olius.forms.b2b.confirm', work);
      else work();
      rerender(); document.querySelector('main h1')?.focus();
    } catch (error) { feedback(error.message); button.disabled = false; button.textContent = text; }
  }

  function requests(participant, context) {
    show(`<span class="eyebrow">COLETA B2B</span><h1 tabindex="-1">Qual solicitação<br>você vai atender?</h1><p class="intro">Escolha um pedido aprovado e agendado desta empresa.</p>${steps(0)}${identityCard(participant)}
      ${context.requests.length ? `<ul class="request-list">${context.requests.map((request) => `<li><div><span class="tag confirmed">Aprovada e agendada</span><h2>${escape(request.label)}</h2><p>${dateFormat.format(new Date(request.scheduledAt))}</p>${request.arrivedAt ? '<span class="request-note">Chegada já registrada</span>' : ''}</div><a class="button secondary small-button" href="${escape(link(participant, { solicitacao: request.id }))}">Atender <span aria-hidden="true">→</span></a></li>`).join('')}</ul>` : '<div class="empty-state"><h2>Nenhum pedido disponível.</h2><p>As solicitações já registradas estão nos comprovantes locais. Novos pedidos precisam estar aprovados e agendados.</p></div>'}
      ${driverLine(context)}${nav(participant)}<p class="local-note">Solicitações fictícias da apresentação. O portal ADM continua separado.</p>`, context);
  }

  function arrival(participant, context, request) {
    const arrived = Boolean(request.arrivedAt);
    const accepted = Boolean(request.serviceAcceptedAt);
    show(`<span class="eyebrow">COLETA B2B</span><h1 tabindex="-1">${arrived ? 'Aguarde o aceite.' : 'Você chegou ao local?'}</h1><p class="intro">${arrived ? 'O estabelecimento confirma o atendimento no próprio aplicativo.' : 'Registre sua chegada antes de informar o resultado da coleta.'}</p>${steps(1)}${identityCard(participant)}
      <div class="context-grid"><div><span class="field-label">Solicitação</span><p>${escape(request.label)}</p></div><div><span class="field-label">Agendamento</span><p>${dateFormat.format(new Date(request.scheduledAt))}</p></div></div>
      <ul class="operation-status"><li><span class="status-dot ${arrived ? 'complete' : ''}" aria-hidden="true"></span><div><strong>${arrived ? 'Chegada registrada' : 'Chegada pendente'}</strong><p>${arrived ? dateFormat.format(new Date(request.arrivedAt)) : 'Confirme esta ação somente ao chegar.'}</p></div></li><li><span class="status-dot ${accepted ? 'complete' : ''}" aria-hidden="true"></span><div><strong>${accepted ? 'Atendimento aceito' : 'Aceite do estabelecimento pendente'}</strong><p>${accepted ? 'O atendimento foi aceito pelo estabelecimento.' : 'Essa confirmação pertence ao estabelecimento no app.'}</p></div></li></ul>
      ${errorBox()}
      ${!arrived ? '<button class="button primary" type="button" id="register-arrival">Registrar chegada <span aria-hidden="true">→</span></button>' : '<button class="button primary" type="button" id="refresh-acceptance">Atualizar status <span aria-hidden="true">↻</span></button>'}
      ${arrived && !accepted ? '<details class="demo-accounts"><summary>Controles da apresentação</summary><p>Simula uma ação que o estabelecimento faria no aplicativo. Não é uma confirmação do motorista.</p><button type="button" id="simulate-acceptance" class="button secondary">Simular aceite pelo estabelecimento</button></details>' : ''}
      <a class="subtle-link" href="${escape(link(participant))}">Trocar solicitação</a>${driverLine(context)}${nav(participant)}`, context);
    document.querySelector('#register-arrival')?.addEventListener('click', (event) => action(event.currentTarget, () => recordArrival(localStorage, request.id, access)));
    document.querySelector('#refresh-acceptance')?.addEventListener('click', rerender);
    document.querySelector('#simulate-acceptance')?.addEventListener('click', (event) => action(event.currentTarget, () => simulateEstablishmentAcceptance(localStorage, request.id)));
  }

  function collect(participant, context, request) {
    const draft = JSON.parse(sessionStorage.getItem(draftKey(request.id)) || '{"presented":"","collected":"","oilCondition":"","occurrence":"","failureReasonCodes":[],"observation":""}');
    show(`<span class="eyebrow">COLETA B2B</span><h1 tabindex="-1">Registrar resultado<br>da coleta.</h1><p class="intro">Informe o que aconteceu na visita, inclusive se não houve recolhimento.</p>${steps(2)}${identityCard(participant)}
      <div class="notice soft">${escape(request.label)} · chegada registrada e atendimento aceito. A data da coleta é definida na confirmação.</div>
      <form id="b2b-collection-form" novalidate>
        <div class="volume-grid"><div class="field"><label for="presented">Óleo apresentado (litros)</label><input id="presented" class="standard-input" name="presented" inputmode="decimal" placeholder="Ex.: 30" value="${escape(draft.presented)}" required aria-describedby="volume-help"></div><div class="field"><label for="collected">Óleo coletado (litros)</label><input id="collected" class="standard-input" name="collected" inputmode="decimal" placeholder="Ex.: 30" value="${escape(draft.collected)}" required aria-describedby="volume-help"></div></div>
        <p class="field-help" id="volume-help">O coletado não pode superar o apresentado. Para este pedido, volumes de ${quantity(request.estimatedVolumeLiters * .9)} a ${quantity(request.estimatedVolumeLiters * 1.1)} estão na tolerância prevista.</p>
        <div class="field"><label for="oil-condition">Condição do óleo</label><select id="oil-condition" name="oilCondition" class="standard-input" required><option value="">Selecione a condição</option><option value="ACCEPTABLE" ${draft.oilCondition === 'ACCEPTABLE' ? 'selected' : ''}>Adequado</option><option value="UNACCEPTABLE" ${draft.oilCondition === 'UNACCEPTABLE' ? 'selected' : ''}>Inadequado</option><option value="NOT_ASSESSED" ${draft.oilCondition === 'NOT_ASSESSED' ? 'selected' : ''}>Não avaliado · nenhum óleo apresentado</option></select></div>
        <div class="field"><label for="occurrence">Houve ocorrência comprometedora?</label><select id="occurrence" name="occurrence" class="standard-input" required><option value="">Selecione uma opção</option><option value="false" ${draft.occurrence === 'false' ? 'selected' : ''}>Não</option><option value="true" ${draft.occurrence === 'true' ? 'selected' : ''}>Sim</option></select></div>
        <fieldset class="reason-options"><legend>Motivos de insucesso, quando aplicável</legend><p class="field-help">Marque os motivos correspondentes aos fatos. Se tudo estiver adequado e dentro da tolerância, deixe sem marcação.</p>${context.failureReasons.map((reason) => `<label><input type="checkbox" name="failureReasonCodes" value="${reason.code}" ${(draft.failureReasonCodes || []).includes(reason.code) ? 'checked' : ''}><span>${escape(reason.name)}</span></label>`).join('')}</fieldset>
        <div class="field"><label for="observation">Observação</label><textarea id="observation" class="standard-input" name="observation" maxlength="1000" rows="3" placeholder="Descreva o que ocorreu na visita" aria-describedby="observation-help">${escape(draft.observation)}</textarea><p class="field-help" id="observation-help">Obrigatória se não houver óleo, se o óleo for inadequado ou se houver ocorrência. Até 1.000 caracteres.</p></div>
        ${errorBox()}<button type="submit" class="button primary">Confirmar resultado da coleta <span aria-hidden="true">→</span></button><p class="local-note">Solicitação, motorista, condição e volumes serão revalidados na operação real.</p>
      </form>${driverLine(context)}${nav(participant)}`, context);
    const form = document.querySelector('#b2b-collection-form');
    const facts = () => {
      const data = new FormData(form);
      return { presented: data.get('presented'), collected: data.get('collected'), oilCondition: data.get('oilCondition'), occurrence: data.get('occurrence'), failureReasonCodes: data.getAll('failureReasonCodes'), observation: data.get('observation') };
    };
    const saveDraft = () => {
      document.querySelector('#feedback').hidden = true;
      try { sessionStorage.setItem(draftKey(request.id), JSON.stringify(facts())); }
      catch { feedback('Não foi possível guardar o rascunho da coleta.'); }
    };
    form.addEventListener('input', saveDraft); form.addEventListener('change', saveDraft);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      if (button.disabled) return;
      const submitted = facts();
      try { collectionPayload(access, submitted); } catch (error) { feedback(error.message); return; }
      button.disabled = true; button.textContent = 'Confirmando…';
      try {
        const save = () => recordB2BCollection(localStorage, request.id, access, submitted);
        const record = navigator.locks ? await navigator.locks.request('olius.forms.b2b.confirm', save) : save();
        navigate({ participante: participant.id, tela: 'comprovante-b2b', id: record.id, fluxo: 'motorista' });
      } catch (error) { feedback(error.message); button.disabled = false; button.innerHTML = 'Confirmar resultado da coleta <span aria-hidden="true">→</span>'; }
    });
  }

  function receipt(participant, context, record) {
    if (record.driverId !== context.driverId) throw new Error('Este comprovante não pertence ao motorista identificado.');
    const successful = record.result === 'SUCCESSFUL';
    show(`<div class="receipt-card"><div class="success-icon" aria-hidden="true">✓</div><span class="eyebrow">RESULTADO REGISTRADO</span><h1 tabindex="-1">Visita registrada.</h1><p class="intro">${successful ? 'Coleta bem-sucedida na simulação.' : 'Coleta com insucesso registrado na simulação.'}</p><div class="receipt-volume">${numberFormat.format(record.collectedVolumeLiters)}<span>litros de óleo coletados</span></div>
      <dl class="receipt-details"><div><dt>Empresa</dt><dd>${escape(participant.name)}</dd></div><div><dt>Motorista</dt><dd>${escape(context.driverName)}</dd></div><div><dt>Apresentado</dt><dd>${quantity(record.presentedVolumeLiters)}</dd></div><div><dt>Condição</dt><dd>${({ ACCEPTABLE: 'Adequado', UNACCEPTABLE: 'Inadequado', NOT_ASSESSED: 'Não avaliado' })[record.oilCondition]}</dd></div><div><dt>Ocorrência</dt><dd>${record.hasCompromisingOccurrence ? 'Sim' : 'Não'}</dd></div><div><dt>Data</dt><dd>${dateFormat.format(new Date(record.collectionDate))}</dd></div><div><dt>Solicitação</dt><dd class="record-id">${escape(record.requestId)}</dd></div>${record.observation ? `<div><dt>Observação</dt><dd>${escape(record.observation)}</dd></div>` : ''}</dl>
      <a class="button primary" href="${escape(link(participant))}">Voltar às solicitações <span aria-hidden="true">→</span></a><p class="local-note">Simulação local. Na integração, a API registra o resultado e calcula pontos e efeitos oficiais; esta página não simula o saldo do app.</p></div>${driverLine(context)}${nav(participant)}`, context);
  }

  function history(participant, context) {
    const records = readB2B(localStorage).collections.filter((row) => row.driverId === context.driverId && row.establishmentId === participant.id);
    show(`<span class="eyebrow">COLETA B2B · DEMONSTRAÇÃO</span><h1 tabindex="-1">Comprovantes locais</h1><p class="intro">Visitas deste motorista salvas somente neste navegador.</p>${records.length ? `<ul class="history-list">${records.map((record) => `<li><div><span class="tag">${record.result === 'SUCCESSFUL' ? 'Bem-sucedida' : 'Com insucesso'}</span><h2>${escape(participant.name)}</h2><p>${dateFormat.format(new Date(record.collectionDate))}</p></div><div class="history-amount"><strong>${quantity(record.collectedVolumeLiters)}</strong><a href="${escape(link(participant, { tela: 'comprovante-b2b', id: record.id }))}">Comprovante ↗</a></div></li>`).join('')}</ul>` : '<div class="empty-state"><h2>Nenhuma visita registrada.</h2><p>As confirmações aparecerão aqui durante a apresentação.</p></div>'}<a class="button primary" href="${escape(link(participant))}">Consultar solicitações <span aria-hidden="true">→</span></a>${driverLine(context)}${nav(participant)}`, context);
  }

  function render(participant) {
    if (!access || access.qrToken !== participant.qrToken) { identify(participant); return; }
    const context = b2bContext(localStorage, access);
    if (params().get('tela') === 'historico-b2b') { history(participant, context); return; }
    const state = readB2B(localStorage);
    if (params().get('tela') === 'comprovante-b2b') {
      const record = state.collections.find((row) => row.id === params().get('id'));
      if (!record) throw new Error('Comprovante B2B não encontrado neste navegador.');
      receipt(participant, context, record); return;
    }
    const requestId = params().get('solicitacao');
    if (!requestId) { requests(participant, context); return; }
    const previous = state.collections.find((row) => row.requestId === requestId);
    if (previous) { receipt(participant, context, previous); return; }
    const request = context.requests.find((item) => item.id === requestId);
    if (!request) throw new Error('Esta solicitação não está disponível para o estabelecimento identificado.');
    if (request.arrivalDriverId && request.arrivalDriverId !== context.driverId) throw new Error('A chegada desta solicitação já pertence a outro motorista.');
    if (!request.arrivedAt || !request.serviceAcceptedAt) arrival(participant, context, request);
    else collect(participant, context, request);
  }

  return { render };
}
