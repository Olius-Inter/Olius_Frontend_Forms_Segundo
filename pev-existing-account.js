import { createPevApiAuth } from './pev-api-auth.js';

// Painel independente: não autentica com fixtures nem grava recebimentos locais.
export function createExistingPevAccount({ shell, escape, errorBox, feedback, isActive }) {
  const api = createPevApiAuth();
  let account = null;
  let busy = false;

  function show(content) {
    shell(`<section class="card login-card">${content}</section>`, null, 'login-layout');
    document.querySelector('.demo-badge').innerHTML = '<span aria-hidden="true"></span> Conta existente · API';
  }

  function render() {
    if (account) {
      show(`<span class="eyebrow">ACESSO VALIDADO NA API</span><h1 tabindex="-1">Seu PEV<br>está aprovado.</h1>
        <p class="intro">A conta existente foi autenticada e o vínculo com seu PEV foi confirmado pelo serviço.</p>
        <div class="qr-context"><span>Responsável<strong>${escape(account.name)}</strong></span><span class="tag confirmed">Aprovado</span></div>
        <div class="notice soft">${account.city ? `PEV em ${escape(account.city)}. ` : ''}Conta ativa e ponto aprovado.</div>
        <p class="intro">Esta etapa valida o acesso real. O registro de entregas nesta conexão ainda não foi ativado.</p>
        ${errorBox()}<button type="button" class="button primary" id="real-logout">Encerrar acesso</button>
        <a class="subtle-link" href="./">Voltar à demonstração</a>
        <p class="local-note">Sua senha e o token de acesso não são salvos no armazenamento do navegador. Recarregar a página exige entrar novamente.</p>`);
      document.querySelector('#real-logout').addEventListener('click', async (event) => {
        if (busy) return;
        busy = true; event.currentTarget.disabled = true;
        let error;
        try { await api.logout(); } catch (failure) { error = failure; }
        account = null; busy = false;
        if (!isActive()) return;
        render();
        if (error) feedback('O acesso foi encerrado nesta página, mas não foi possível confirmar o encerramento da sessão no serviço.');
      });
      return;
    }
    show(`<span class="eyebrow">CONTA EXISTENTE · PEV</span><h1 tabindex="-1">Entre com<br>sua conta.</h1>
      <p class="intro">Use a conta que já está cadastrada e vinculada a um PEV aprovado.</p>
      <form id="real-login-form">
        <div class="field"><label for="real-email">E-mail</label><div class="input-icon"><img src="./assets/mail.svg" alt=""><input id="real-email" name="email" type="email" autocomplete="username" placeholder="Seu e-mail cadastrado" required></div></div>
        <div class="field"><label for="real-password">Senha</label><div class="input-icon"><img src="./assets/lock.svg" alt=""><input id="real-password" name="password" type="password" autocomplete="current-password" placeholder="Sua senha" required></div></div>
        ${errorBox()}<button class="button primary" type="submit">Validar meu PEV <span aria-hidden="true">→</span></button>
      </form>
      <p class="local-note">O serviço verifica seu login, o status da conta e a aprovação do PEV. As contas de demonstração não são utilizadas aqui.</p>
      <a class="subtle-link" href="./">Voltar à demonstração</a>`);
    document.querySelector('#real-login-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      const email = document.querySelector('#real-email');
      const password = document.querySelector('#real-password');
      const button = event.currentTarget.querySelector('[type="submit"]');
      busy = true; button.disabled = true; button.textContent = 'Validando acesso…';
      email.readOnly = true; password.readOnly = true;
      document.querySelector('#feedback').hidden = true;
      try {
        account = await api.login(email.value, password.value);
        password.value = '';
        if (isActive()) { render(); document.querySelector('main h1')?.focus(); }
      } catch (error) {
        password.value = '';
        if (isActive()) {
          feedback(error.message || 'Não foi possível validar o acesso.');
          button.disabled = false; button.innerHTML = 'Validar meu PEV <span aria-hidden="true">→</span>';
          email.readOnly = false; password.readOnly = false;
        }
      } finally { busy = false; }
    });
  }

  return { render };
}
