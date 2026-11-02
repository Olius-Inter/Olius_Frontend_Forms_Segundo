// Compatível com GET /users/me e GET /pevs/me. A autorização real continua no servidor.
export function requireApprovedPev(user, ownPev) {
  if (!user?.id || user.status !== 'ACTIVE') throw new Error('Esta conta está inativa ou indisponível. Não é possível registrar recebimentos.');
  if (!['CITIZENS', 'ESTABLISHMENT'].includes(user.userType) || !ownPev?.id) {
    throw new Error('Somente o responsável por um PEV aprovado pode acessar este formulário e registrar recebimentos.');
  }
  if (ownPev.status !== 'APPROVED') throw new Error('O PEV desta conta ainda não está aprovado ou não está disponível para receber óleo.');
  return { userId: user.id, pevId: ownPev.id };
}
