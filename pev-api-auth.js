import { requireApprovedPev } from './pev-access.js';

export const API_BASE_URL = 'https://tvkgo0evuj.execute-api.us-east-1.amazonaws.com';

export class PevApiError extends Error {
  constructor(message, code) { super(message); this.name = 'PevApiError'; this.code = code; }
}

export function createPevApiAuth({ baseUrl = API_BASE_URL, fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('O endereço da API deve usar HTTPS, sem credenciais ou parâmetros.');
  const prefix = base.pathname.replace(/\/$/, '');
  let accessToken = null;
  let account = null;

  async function request(path, { method = 'GET', body, csrf, authenticated = false } = {}) {
    if (authenticated && !accessToken) throw new PevApiError('Entre novamente para consultar sua conta.', 'SESSION_REQUIRED');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrf) headers[csrf.headerName] = csrf.token;
    if (authenticated) headers.Authorization = `Bearer ${accessToken}`;
    try {
      let response;
      try {
        response = await fetchImpl(`${base.origin}${prefix}${path}`, {
          method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          credentials: authenticated ? 'omit' : 'include', cache: 'no-store', redirect: 'error',
          referrerPolicy: 'no-referrer', signal: controller.signal,
        });
      } catch {
        throw new PevApiError('Não foi possível conectar à API. Verifique sua conexão e se o acesso deste site foi liberado pelo serviço.', 'CONNECTION_FAILED');
      }
      if (!response.ok) {
        if (response.status === 401) throw new PevApiError(path.endsWith('/login') ? 'E-mail ou senha inválidos.' : 'Sua sessão não foi aceita. Entre novamente.', 'UNAUTHORIZED');
        if (path === '/api/v1/pevs/me' && [403, 404].includes(response.status)) throw new PevApiError('Esta conta não possui um PEV disponível para registrar recebimentos.', 'PEV_REQUIRED');
        if (response.status === 403) throw new PevApiError('A API recusou o acesso. Confira a permissão da conta e a liberação deste site.', 'FORBIDDEN');
        if (response.status === 429) throw new PevApiError('Muitas tentativas. Aguarde antes de entrar novamente.', 'RATE_LIMITED');
        throw new PevApiError('O serviço não conseguiu concluir o acesso. Tente novamente mais tarde.', 'SERVICE_UNAVAILABLE');
      }
      if (response.status === 204) return null;
      try { return await response.json(); }
      catch { throw new PevApiError('A API retornou uma resposta inválida. O acesso não foi liberado.', 'INVALID_RESPONSE'); }
    } finally { clearTimeout(timer); }
  }

  async function getCsrf() {
    const csrf = await request('/api/v1/auth/web/csrf');
    if (csrf?.headerName !== 'X-XSRF-TOKEN' || typeof csrf.token !== 'string' || !csrf.token || /[\r\n]/.test(csrf.token)) throw new PevApiError('Não foi possível preparar o acesso seguro à API.', 'INVALID_CSRF');
    return csrf;
  }

  async function logout() {
    try {
      const csrf = await getCsrf();
      await request('/api/v1/auth/web/logout', { method: 'POST', csrf });
    } finally { accessToken = null; account = null; }
  }

  return {
    async login(email, password) {
      accessToken = null; account = null;
      if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) throw new PevApiError('Informe o e-mail e a senha da sua conta existente.', 'INVALID_CREDENTIALS');
      const csrf = await getCsrf();
      const tokens = await request('/api/v1/auth/web/login', { method: 'POST', csrf, body: { email: email.trim(), password } });
      if (typeof tokens?.accessToken !== 'string' || !tokens.accessToken || tokens.tokenType !== 'Bearer') throw new PevApiError('A API não devolveu uma sessão válida.', 'INVALID_RESPONSE');
      accessToken = tokens.accessToken;
      try {
        const user = await request('/api/v1/users/me', { authenticated: true });
        const ownPev = await request('/api/v1/pevs/me', { authenticated: true });
        requireApprovedPev(user, ownPev);
        if (typeof user.name !== 'string' || !user.name.trim()) throw new PevApiError('O perfil retornado pela API está incompleto.', 'INVALID_RESPONSE');
        account = Object.freeze({ userId: user.id, name: user.name, userType: user.userType,
          userStatus: user.status, pevId: ownPev.id, pevStatus: ownPev.status,
          city: typeof ownPev.address?.city === 'string' ? ownPev.address.city : null });
        return account;
      } catch (error) {
        try { await logout(); } catch { /* A autorização local permanece negada. */ }
        throw error;
      }
    },
    logout,
    currentAccount: () => account,
  };
}
