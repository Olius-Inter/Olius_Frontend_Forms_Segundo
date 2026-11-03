import {
  PARTICIPANTS, OPERATORS, ACCESS_TEST_ACCOUNTS, DEMO_ACCOUNTS, DEMO_PASSWORD, DAILY_LIMIT,
  readDeliveries, dailyCount, confirmPevDelivery, isPevRecord, requireDemoPev, authenticatePevDemo,
} from './core.js';
import { createB2BFlow } from './b2b.js';
import { createApiFlow } from './api-flow.js';
import { usesLiveApi } from './mobile-link.js';

const app = document.querySelector('#app');
const SESSION_KEY = 'olius.forms.session.v1';
const dateFormat = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const params = () => new URL(location.href).searchParams;
const participantNow = () => PARTICIPANTS.find((person) => person.id === params().get('participante'));
const draftKey = (participant, operator) => `olius.forms.draft.${participant.type === 'B2B' ? 'pev.' : ''}${participant.id}.${operator.id}`;
const liters = (value) => `${numberFormat.format(value)} L`;
const b2bFlow = createB2BFlow({ shell, url, navigate, escape, feedback, errorBox, dateFormat, numberFormat, rerender: render });
const apiFlow = createApiFlow({ shell, escape, errorBox, feedback, isActive: () => usesLiveApi() });
let sessionNotice = '';

function session() {
  const id = sessionStorage.getItem(SESSION_KEY);
  if (!id) return undefined;
  try { return requireDemoPev(DEMO_ACCOUNTS.find((account) => account.id === id)); }
  catch (error) {
    sessionStorage.removeItem(SESSION_KEY);
    sessionNotice = error.message;
    return undefined;
  }
}

function url(values = {}) {
  const target = new URL(location.href);
  target.search = '';
  const flow = params().get('fluxo');
  if ((values.participante || values.tela) && ['pev', 'motorista'].includes(flow) && !Object.hasOwn(values, 'fluxo')) target.searchParams.set('fluxo', flow);
  for (const [key, value] of Object.entries(values)) if (value) target.searchParams.set(key, value);
  return target.href;
}

function navigate(values) {
  history.pushState(null, '', url(values));
  render();
  document.querySelector('main h1')?.focus();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function brand() {
  return '<a class="brand" href="./" aria-label="Olius, início"><img src="./assets/logo-mark.svg" alt=""><span>Olius</span></a>';
}

function shell(content, operator, extraClass = '') {
  app.innerHTML = `
    <header class="site-header">
      <span class="header-spacer" aria-hidden="true"></span>
      ${operator ? '<button class="word-link" id="logout" type="button">Sair <span aria-hidden="true">↗</span></button>' : '<span class="header-spacer"></span>'}
    </header>
    <main id="main" class="${extraClass}">
      ${brand()}
      ${content}
    </main>
    <footer class="site-footer">Colete. Transforme. Preserve.<span>Uma nova história para cada gota.</span></footer>`;
  document.querySelector('#logout')?.addEventListener('click', () => {
    sessionStorage.removeItem(SESSION_KEY);
    navigate({ participante: params().get('participante') });
  });
}

function feedback(message, id = 'feedback') {
  const element = document.getElementById(id);
  element.textContent = message;
  element.hidden = false;
  element.focus();
}

function errorBox() { return '<p id="feedback" class="notice error" role="alert" tabindex="-1" hidden></p>'; }

function missingParticipant(operator) {
  shell(`<section class="card error-card"><span class="eyebrow">RECEBIMENTO DE ÓLEO</span><h1 tabindex="-1">Abra pelo<br>aplicativo.</h1><p class="intro">O QR Code exibido no mobile abre este formulário com o participante já identificado.</p><div class="notice soft">Use o link aberto pela leitura do QR no aplicativo B2B ou B2C para registrar o recebimento da pessoa ou empresa correta.</div>${operator ? `<a class="button primary" href="${escape(url({ tela: 'historico', fluxo: 'pev' }))}">Consultar histórico local <span aria-hidden="true">→</span></a>` : `<a class="subtle-link" href="${escape(url({ modo: 'api', fluxo: 'pev' }))}">Acessar minha conta existente</a>`}</section>`, operator);
}

function flowSelection(participant, operator) {
  const destination = (flow) => url({ participante: participant.id, fluxo: flow });
  const driverAllowed = participant.type === 'B2B';
  shell(`<section class="card flow-card">
    <span class="eyebrow">RECEBIMENTO DE ÓLEO</span><h1 tabindex="-1">Como deseja<br>registrar?</h1>
    <p class="intro">Escolha o fluxo de acordo com quem está recebendo o óleo.</p>
    <div class="qr-context"><img src="./assets/lock.svg" alt=""><span>Participante identificado<strong>${escape(participant.name)}</strong></span><span class="tag">${participant.type}</span></div>
    <div class="flow-options">
      <a class="flow-option" href="${escape(destination('pev'))}"><span class="flow-icon" aria-hidden="true">01</span><span class="flow-option-copy"><strong>Entrega em PEV</strong><span>Para B2B ou B2C que entrega óleo a um ponto de recebimento. O responsável informa apenas os litros recebidos.</span><span class="flow-caption">Login do responsável · quantidade de óleo</span></span><span class="flow-arrow" aria-hidden="true">→</span></a>
      ${driverAllowed ? `<a class="flow-option" href="${escape(destination('motorista'))}"><span class="flow-icon" aria-hidden="true">02</span><span class="flow-option-copy"><strong>Coleta com motorista</strong><span>Para a coleta de uma empresa operadora, como a Óleo Amigo, no estabelecimento B2B.</span><span class="flow-caption">CPF e CNH · solicitação e coleta</span></span><span class="flow-arrow" aria-hidden="true">→</span></a>` : '<div class="flow-option unavailable" aria-disabled="true"><span class="flow-icon" aria-hidden="true">02</span><span class="flow-option-copy"><strong>Coleta com motorista</strong><span>Este fluxo utiliza o QR de um estabelecimento B2B. Para este cidadão, use a entrega em PEV.</span></span></div>'}
    </div><p class="local-note">A escolha do fluxo não registra recebimento. A confirmação acontece no formulário.</p>
  </section>`, operator);
}

function switchFlow(participant) {
  return `<a class="subtle-link" href="${escape(url({ participante: participant?.id, fluxo: null }))}">Trocar tipo de registro</a>`;
}

function login() {
  const participant = participantNow();
  shell(`<section class="card login-card">
    <span class="eyebrow">RECEBIMENTO DE ÓLEO</span>
    <h1 tabindex="-1">Entre para confirmar<br>o recebimento.</h1>
    <p class="intro">Acesse com a conta responsável por um PEV aprovado para registrar o óleo recebido.</p>
    <a class="subtle-link" href="${escape(url({ modo: 'api', fluxo: 'pev', participante: participant?.id }))}">Usar conta existente na API</a>
    ${participant ? `<div class="qr-context"><img src="./assets/lock.svg" alt=""><span>Participante identificado<strong>${escape(participant.name)}</strong></span><span class="tag">${participant.type}</span></div>` : ''}
    <form id="login-form">
      <div class="field"><label for="email">E-mail</label><div class="input-icon"><img src="./assets/mail.svg" alt=""><input id="email" name="email" type="email" placeholder="Seu e-mail" autocomplete="username" required></div></div>
      <div class="field"><label for="password">Senha</label><div class="input-icon"><img src="./assets/lock.svg" alt=""><input id="password" name="password" type="password" placeholder="Sua senha" autocomplete="current-password" required><button id="password-toggle" type="button" class="password-toggle" aria-label="Mostrar senha" aria-pressed="false">Mostrar</button></div></div>
      ${errorBox()}
      <button class="button primary" type="submit">Continuar <span aria-hidden="true">→</span></button>
    </form>
    <details class="demo-accounts"><summary>Usar uma conta de demonstração</summary><p>Escolha um responsável com PEV aprovado.</p><div class="account-options">${OPERATORS.map((operator) => `<button class="account-option" data-account="${operator.id}" type="button"><strong>${operator.pevName}</strong><span>${operator.name}</span></button>`).join('')}</div><p>Testar um acesso bloqueado:</p><div class="access-test-options">${ACCESS_TEST_ACCOUNTS.map((account) => `<button class="word-link" data-account="${account.id}" type="button">${account.name}</button>`).join('')}</div><p class="credentials">Senha de teste: <code>${DEMO_PASSWORD}</code></p></details>
    ${switchFlow(participant)}<p class="local-note">Acesso simulado para apresentação. Use apenas as contas de teste.</p>
  </section>`, null, 'login-layout');
  if (sessionNotice) { feedback(sessionNotice); sessionNotice = ''; }
  document.querySelector('#password-toggle').addEventListener('click', (event) => {
    const input = document.querySelector('#password');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    event.currentTarget.textContent = show ? 'Ocultar' : 'Mostrar';
    event.currentTarget.setAttribute('aria-pressed', String(show));
    event.currentTarget.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
  });
  document.querySelectorAll('[data-account]').forEach((button) => button.addEventListener('click', () => {
    const operator = DEMO_ACCOUNTS.find((person) => person.id === button.dataset.account);
    document.querySelector('#email').value = operator.email;
    document.querySelector('#password').value = DEMO_PASSWORD;
    document.querySelector('#login-form button[type="submit"]').focus();
  }));
  document.querySelector('#login-form').addEventListener('submit', (event) => {
    event.preventDefault();
    let operator;
    try { operator = authenticatePevDemo(document.querySelector('#email').value, document.querySelector('#password').value); }
    catch (error) { feedback(error.message); return; }
    try {
      sessionStorage.setItem(SESSION_KEY, operator.id);
      navigate({ participante: participant?.id, fluxo: 'pev' });
    } catch { feedback('O navegador está impedindo o armazenamento da sessão. Libere o armazenamento para continuar.'); }
  });
}

function operatorLine(operator) {
  return `<div class="operator-line"><span class="avatar small">${escape(operator.name[0])}</span><span><strong>${escape(operator.name)}</strong><span>${escape(operator.pevName)} · responsável pelo recebimento</span></span></div>`;
}

function tabs(active) {
  return `<nav class="section-nav" aria-label="Navegação do formulário"><a ${active === 'historico' ? 'aria-current="page"' : ''} href="${escape(url({ tela: 'historico', fluxo: 'pev' }))}">Histórico local</a></nav>`;
}

function getDraft(participant, operator) {
  const key = draftKey(participant, operator);
  const raw = sessionStorage.getItem(key);
  if (raw) {
    const draft = JSON.parse(raw);
    if (typeof draft.id !== 'string' || !draft.id || typeof draft.value !== 'string') throw new Error('Não foi possível recuperar esta operação. Abra um novo formulário.');
    return draft;
  }
  const draft = { id: crypto.randomUUID(), value: '' };
  sessionStorage.setItem(key, JSON.stringify(draft));
  return draft;
}

function collectionForm(participant, operator) {
  const rows = readDeliveries(localStorage);
  const draft = getDraft(participant, operator);
  const existing = rows.find((row) => row.id === draft.id);
  if (existing) { receipt(existing, operator); return; }
  const count = dailyCount(rows, participant.id, operator.pevId);
  const blocked = count >= DAILY_LIMIT;
  shell(`<section class="card form-card">
    <div class="card-heading"><span class="eyebrow">ENTREGA EM PEV · ${participant.type}</span><span class="tag confirmed"><span aria-hidden="true">✓</span> QR identificado</span></div>
    <h1 tabindex="-1">Registrar entrega</h1>
    <p class="intro">Confirme o óleo que você recebeu deste participante.</p>
    <ol class="steps" aria-label="Etapas do recebimento"><li class="done"><span aria-hidden="true">✓</span> Identificação</li><li class="current" aria-current="step"><span>2</span> Quantidade</li><li><span>3</span> Confirmação</li></ol>
    <div class="identity-card"><span class="avatar">${participant.initials}</span><div><span class="muted identity-label">Participante identificado pelo QR</span><h2>${escape(participant.name)}</h2><span class="muted identity-id">${participant.id} · ${participant.type}</span></div><img class="identity-lock" src="./assets/lock.svg" alt="Identidade sem edição"></div>
    <p class="identity-help">A identificação vem do QR Code e não pode ser alterada neste formulário.</p>
    <form id="collection-form" novalidate>
      <div class="context-grid"><div><span class="field-label">Local de recebimento</span><p>${escape(operator.pevName)}</p></div><div><span class="field-label">Data e horário</span><p id="operation-time">${dateFormat.format(new Date())}</p><span class="timezone">Horário de São Paulo</span></div></div>
      <div class="quantity-section"><label for="liters">Qual a quantidade recebida?</label><p id="liters-help" class="muted">Volume real em litros. Até 999,99 L por entrega.</p><div class="quantity-input"><input id="liters" name="liters" type="text" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${escape(draft.value)}" aria-describedby="liters-help quantity-error" ${blocked ? 'disabled' : ''}><span aria-hidden="true">L</span></div><p id="quantity-error" class="field-error" aria-live="polite"></p></div>
      ${blocked ? '<p class="notice warning" role="status">Este participante já registrou duas entregas neste PEV hoje. Uma nova entrega poderá ser registrada amanhã.</p>' : `<div class="daily-info"><span class="daily-dots" aria-hidden="true"><i class="${count > 0 ? 'filled' : ''}"></i><i></i></span><span><strong>${count} de 2</strong> registros neste PEV hoje</span></div>`}
      ${errorBox()}
      <button class="button primary" type="submit" ${blocked ? 'disabled' : ''}>Confirmar recebimento <span aria-hidden="true">→</span></button>
      <p class="local-note">O recebimento só será registrado depois da confirmação.</p>
    </form>
    ${operatorLine(operator)}${tabs('')}${switchFlow(participant)}
  </section>`, operator);
  const input = document.querySelector('#liters');
  input.addEventListener('input', () => {
    draft.value = input.value;
    // Nova tentativa após uma falha pode ajustar fatos; um reenvio confirmado nunca os altera.
    delete draft.deliveryDate;
    input.removeAttribute('aria-invalid');
    document.querySelector('#quantity-error').textContent = '';
    try { sessionStorage.setItem(draftKey(participant, operator), JSON.stringify(draft)); }
    catch { feedback('Não foi possível guardar o rascunho. Verifique o armazenamento do navegador.'); }
  });
  let saving = false;
  document.querySelector('#collection-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving || blocked) return;
    const button = event.currentTarget.querySelector('[type="submit"]');
    saving = true; button.disabled = true; button.textContent = 'Confirmando…';
    try {
      const activeOperator = session();
      if (!activeOperator || activeOperator.id !== operator.id) throw new Error('A sessão mudou ou não possui acesso ao PEV. Entre novamente antes de registrar.');
      draft.deliveryDate ||= new Date().toISOString();
      sessionStorage.setItem(draftKey(participant, operator), JSON.stringify(draft));
      const save = () => confirmPevDelivery(localStorage, { id: draft.id, participantId: participant.id, operatorId: operator.id, rawLiters: input.value, deliveryDate: draft.deliveryDate });
      // Serializa envios entre abas quando o navegador oferece Web Locks.
      const record = navigator.locks ? await navigator.locks.request('olius.forms.confirm', save) : save();
      navigate({ tela: 'comprovante', id: record.id, fluxo: 'pev' });
    } catch (error) {
      input.setAttribute('aria-invalid', 'true');
      document.querySelector('#quantity-error').textContent = error.message;
      feedback(error.message);
      input.focus();
      button.disabled = false; button.innerHTML = 'Confirmar recebimento <span aria-hidden="true">→</span>';
      saving = false;
    }
  });
}

function receipt(record, operator) {
  if (record.operatorId !== operator.id) { invalid('Este comprovante não pertence ao responsável desta sessão.', operator); return; }
  const participant = PARTICIPANTS.find((person) => person.id === record.participantId);
  shell(`<section class="card receipt-card">
    <div class="success-icon" aria-hidden="true">✓</div><span class="eyebrow">RECEBIMENTO CONFIRMADO</span>
    <h1 tabindex="-1">Cada gota conta.</h1><p class="intro">O recebimento foi salvo neste navegador.</p>
    <div class="receipt-volume">${numberFormat.format(record.liters)}<span>litros de óleo recebidos</span></div>
    <dl class="receipt-details"><div><dt>${participant.type === 'B2B' ? 'Empresa' : 'Participante'}</dt><dd>${escape(participant.name)}</dd></div><div><dt>Local</dt><dd>${escape(operator.pevName)}</dd></div><div><dt>Responsável</dt><dd>${escape(operator.name)}</dd></div><div><dt>Data e horário</dt><dd>${dateFormat.format(new Date(record.createdAt))}</dd></div><div><dt>Identificador</dt><dd class="record-id">${escape(record.id)}</dd></div></dl>
    <button id="new-delivery" class="button primary" type="button">Novo recebimento <span aria-hidden="true">→</span></button>
    <a class="subtle-link" href="${escape(url({ tela: 'historico', fluxo: 'pev' }))}">Consultar histórico local</a>
    ${switchFlow(participant)}
    <p class="local-note">Comprovante de demonstração. Não comprova pagamento nem destinação final.</p>
  </section>`, operator);
  document.querySelector('#new-delivery').addEventListener('click', () => {
    sessionStorage.removeItem(draftKey(participant, operator));
    navigate({ participante: participant.id, fluxo: 'pev' });
  });
}

function historyPage(operator) {
  const rows = readDeliveries(localStorage).filter((row) => row.pevId === operator.pevId && isPevRecord(row)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const total = rows.reduce((sum, row) => sum + row.liters, 0);
  shell(`<section class="card history-card"><span class="eyebrow">${escape(operator.pevName)}</span><h1 tabindex="-1">Histórico local</h1><p class="intro">Os recebimentos registrados neste navegador.</p>
    <div class="history-summary"><div><strong>${rows.length}</strong><span>recebimentos</span></div><div><strong>${liters(total)}</strong><span>óleo recebido</span></div></div>
    ${rows.length ? `<ul class="history-list">${rows.map((row) => {
      const person = PARTICIPANTS.find((participant) => participant.id === row.participantId);
      return `<li><div><span class="tag">${person.type} · PEV</span><h2>${escape(person.name)}</h2><p>${dateFormat.format(new Date(row.createdAt))}</p></div><div class="history-amount"><strong>${liters(row.liters)}</strong><a href="${escape(url({ tela: 'comprovante', id: row.id, fluxo: 'pev' }))}">Comprovante <span aria-hidden="true">↗</span></a></div></li>`;
    }).join('')}</ul>` : '<div class="empty-state"><span aria-hidden="true">↗</span><h2>O primeiro passo começa aqui.</h2><p>Quando você confirmar um recebimento, ele aparecerá neste histórico.</p></div>'}
    <p class="notice soft">Para registrar outro participante, abra o link vindo do aplicativo dele.</p>
    ${operatorLine(operator)}${tabs('historico')}
    <p class="local-note">Os dados não sincronizam com o aplicativo ou outros dispositivos.</p>
  </section>`, operator);
}

function invalid(message, operator) {
  shell(`<section class="card error-card"><span class="eyebrow">NÃO FOI POSSÍVEL CONTINUAR</span><h1 tabindex="-1">Vamos tentar de novo?</h1><p class="intro">${escape(message)}</p><a class="button primary" href="${escape(url())}">Voltar ao início <span aria-hidden="true">→</span></a></section>`, operator);
}

function render() {
  let operator;
  try {
    if (apiFlow.hasPending()) { apiFlow.render(); return; }
    if (usesLiveApi()) { apiFlow.render(); return; }
    operator = session();
    const participant = participantNow();
    const view = params().get('tela');
    const flow = params().get('fluxo');
    if (params().has('participante') && !participant) { invalid('Não foi possível identificar o participante deste link. Abra novamente pelo aplicativo B2B ou B2C.', operator); return; }
    if (!participant && !['historico', 'comprovante'].includes(view)) { missingParticipant(operator); return; }
    if (flow === 'motorista') {
      if (!participant) { missingParticipant(operator); return; }
      if (participant.type !== 'B2B') { flowSelection(participant, operator); return; }
      b2bFlow.render(participant); return;
    }
    if (flow !== 'pev' && !['historico', 'comprovante'].includes(view)) { flowSelection(participant, operator); return; }
    if (!operator) { login(); return; }
    if (view === 'historico') { historyPage(operator); return; }
    if (view === 'comprovante') {
      const record = readDeliveries(localStorage).find((row) => row.id === params().get('id'));
      if (!record) { invalid('O comprovante não foi encontrado neste navegador.', operator); return; }
      receipt(record, operator); return;
    }
    if (participant) collectionForm(participant, operator);
    else missingParticipant(operator);
  } catch (error) { invalid(error.message || 'O navegador não disponibilizou o armazenamento necessário para a demonstração.', operator); }
}

document.addEventListener('click', (event) => {
  const anchor = event.target.closest('a');
  if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.target || anchor.hasAttribute('download')) return;
  const destination = new URL(anchor.href);
  if (destination.origin === location.origin && destination.pathname === location.pathname && !destination.hash) {
    event.preventDefault();
    history.pushState(null, '', destination.href); render();
    document.querySelector('main h1')?.focus(); window.scrollTo(0, 0);
  }
});
window.addEventListener('popstate', render);
window.addEventListener('storage', (event) => { if (['olius.forms.deliveries.v1', 'olius.forms.b2b.v1'].includes(event.key)) render(); });
render();
