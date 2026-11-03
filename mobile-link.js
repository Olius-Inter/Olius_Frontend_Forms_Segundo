const TOKEN = /^[A-Za-z0-9_-]{43}$/;

// O token é fornecido pelo mobile; nome e vínculo sempre vêm da API.
export function mobileContext(search = location.search) {
  const params = new URLSearchParams(search);
  const token = params.get('qrToken') || params.get('participante') || '';
  return { qrToken: TOKEN.test(token) ? token : null,
    type: (params.get('tipo') || '').toUpperCase() };
}

export function usesLiveApi(search = location.search) {
  const params = new URLSearchParams(search);
  return params.get('modo') === 'api' || params.has('qrToken') || Boolean(mobileContext(search).qrToken);
}
