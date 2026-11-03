# Olius Forms

Formulários de recebimento de óleo em HTML, CSS e JavaScript puro, com o visual do mobile Olius. Projeto separado do portal ADM, com dois caminhos: **entrega em PEV (B2B ou B2C)** e **coleta da operadora com motorista**.

A escolha é feita pelo tipo de operação, não apenas pelo tipo de participante. O mesmo QR de empresa pode seguir os dois caminhos. O fluxo com motorista mantém o contrato atual de API_Olius/DB_Segundo; a entrega B2B em PEV representa a nova regra de produto na simulação. A API e o banco não foram alterados.

## Estado desta versão

Endereço público do Forms: https://olius-frontend-forms-segundo.onrender.com. Entrada do modo API: https://olius-frontend-forms-segundo.onrender.com/?modo=api.

Links com `qrToken` real ou `modo=api` abrem a integração com a API. Estão conectados o login e a validação de PEV, a identificação do cidadão e o registro de entrega B2C; no motorista, contexto, paginação, chegada explícita, atualização do aceite e confirmação da coleta. Só a resposta do servidor libera um comprovante real. Pontos, ranking e saldo são responsabilidade das rotinas da API, sem cálculo ou atualização local pelo Forms.

Os links fictícios `?participante=b2b-001` e `?participante=b2c-001` continuam abrindo a demonstração local, identificada como tal. Fixtures, contas e registros da demonstração não são enviados à API. A entrega B2B em PEV, sem motorista, permanece somente na demonstração: o contrato atual de resolução e entrega atende cidadão beneficiário, e não foi reaproveitado incorretamente para empresas.

O contrato foi conferido em API_Olius `origin/main` (`4bf8083`) em 03/11/2026. As alterações posteriores à revisão anterior não mudaram os DTOs operacionais. A API publicada respondeu 200 em `/api/v1/establishment-types`, mas recusou a origem `http://127.0.0.1:5186` com 403 `Invalid CORS request`. A gravação real ainda não pôde ser validada: é necessário liberar CORS e usar contas, tokens, motorista e solicitações de teste válidos. Nenhuma gravação foi feita na AWS durante esta implementação.

## Entrar com uma conta existente na API

O endereço da AWS foi informado e o acesso real está disponível separadamente em `/?modo=api&fluxo=pev`, ou pelo link **Usar conta existente na API** no login da demonstração.

O módulo `pev-api-auth.js` aponta para `https://tvkgo0evuj.execute-api.us-east-1.amazonaws.com`. Ele prepara CSRF, envia login com cookies, consulta `GET /api/v1/users/me` e `GET /api/v1/pevs/me` com Bearer e valida conta ativa/PEV próprio aprovado. Não cria contas; a gravação de entrega ocorre somente na confirmação explícita. Login incorreto, ausência de PEV, ponto pendente e falha de rede não são substituídos por sucesso local. O encerramento usa o logout da API; falha remota é informada.

Após entrar, o responsável identifica o participante do link e informa os litros recebidos. O nome é retornado por `/api/v1/qr/resolutions` e não tem campo editável. A confirmação envia somente idempotencyKey, qrToken, oilVolumeLiters e deliveryDate para o PEV vinculado à sessão. O servidor revalida autorização, titularidade e regras de entrega. Senha é removida do campo após a tentativa; dados de acesso, documentos e rascunhos reais ficam somente em memória, sem localStorage/sessionStorage.

O primeiro envio fixa a chave, a quantidade e a data. Se houver falha ou resposta incerta, a tela permite reenviar a mesma operação, sem repetição automática. No motorista, a solicitação continua sendo a chave da coleta. Campos ficam bloqueados durante a verificação e há proteção contra saída acidental; não recarregue nem feche a página até verificar o resultado. O PEV permite reautenticação com a mesma conta preservando o envio pendente. O aviso de saída do navegador não garante recuperação se a aba for fechada ou o processo encerrar.

### Link enviado pelo mobile

```text
https://olius-frontend-forms-segundo.onrender.com/?qrToken=TOKEN_REAL_DO_PERFIL
```

Sem `fluxo`, o usuário escolhe PEV ou motorista. Acrescente `&fluxo=pev` ou `&fluxo=motorista` para abrir diretamente. `&tipo=b2b` sinaliza a pendência da entrega B2B/PEV, sem conceder autorização. O parâmetro `participante` também aceita o token de 43 caracteres por compatibilidade; UUID ou ID fictício sozinho não substitui o qrToken exigido pelo contrato atual. Não colocar CPF, CNH, e-mail ou senha no link. O Forms não gera nem escaneia QR; só recebe o link produzido pelo mobile.

### Motorista

O acesso real está em `/?modo=api&fluxo=motorista&qrToken=TOKEN_REAL_DO_ESTABELECIMENTO`. O motorista informa CPF/CNH, seleciona uma solicitação aprovada/agendada retornada pela API e registra a chegada. A tela consulta novamente o contexto para verificar o aceite realizado pelo estabelecimento no próprio mobile. Não há botão de simular aceite no modo real. Depois, envia volumes, condição, ocorrências, motivos do catálogo real e observação. O Forms não chama o endpoint de aceite em nome do estabelecimento.

O endereço público é `https://olius-frontend-forms-segundo.onrender.com`. Em 03/11/2026, a API retornou 200 no CSRF para essa origem, com `Access-Control-Allow-Origin` correspondente e credenciais permitidas. Essa liberação não substitui a validação de login e gravação com dados de teste válidos.

A origem exata deve constar em `OLIUS_ALLOWED_ORIGINS`, preservando as origens existentes. Para desenvolvimento local, usar `http://127.0.0.1:5186` ou, no `npm start` sem PORT, `http://127.0.0.1:5185`; a origem 5186 continuava bloqueada na verificação anterior. A configuração deve permitir GET/POST/OPTIONS, credenciais de login e os cabeçalhos Content-Type, Authorization e X-XSRF-TOKEN. Se o acesso estiver bloqueado, a tela informa o erro; não há proxy nem desativação de proteção. Credenciais reais devem ser digitadas somente no modo API.

## Executar

Com Node.js 20 ou superior, sem instalação de pacotes:

```sh
npm start
```

Abra http://127.0.0.1:5185. Use um servidor HTTP; abrir o arquivo diretamente não carrega os módulos JavaScript.

```sh
npm test
```

Os testes de regras usam o executor nativo do Node.js.

## Escolher o tipo de registro

Abra `/?participante=b2b-001` ou `/?participante=b2c-001`. Após a leitura do QR, a página mostra quem foi identificado e apresenta as opções:

- **Entrega em PEV:** B2B ou B2C leva o óleo a um ponto. O responsável pelo PEV faz login e informa apenas a quantidade real; nome, ponto e data são obtidos do contexto. Não pede motorista, solicitação, chegada ou condição do óleo.
- **Coleta com motorista:** operadora, como Óleo Amigo, atende uma coleta no estabelecimento B2B. O motorista utiliza CPF/CNH e segue as etapas atuais. Esta opção não é liberada para QR de cidadão porque a operação atual da API exige estabelecimento.

Os links com `fluxo=pev` ou `fluxo=motorista` abrem o caminho escolhido. Links sem um fluxo válido mostram a seleção, inclusive os antigos com `fluxo=atual`. É possível trocar o tipo de registro preservando a identificação do participante. Escolher um caminho não cria registro nem concede permissões no backend.

### Validação de quem pode registrar no PEV

O login da demonstração confere e-mail/senha e só libera o formulário se a conta estiver ACTIVE, for CITIZENS ou ESTABLISHMENT e possuir um PEV próprio APPROVED. A mesma checagem é aplicada ao recuperar a sessão e ao salvar. Conta sem PEV, ponto pendente/rejeitado/inativo ou conta inativa não podem registrar. Ser B2B, B2C ou ADMIN por si só não concede essa permissão. O caminho de motorista mantém sua identificação separada.

Em **Usar uma conta de demonstração**, os botões **Conta sem PEV**, **PEV pendente** e **Conta inativa** permitem apresentar os bloqueios. Usam a mesma senha fictícia de teste e não criam sessão autorizada.

O helper `requireApprovedPev()` em `pev-access.js` recebe o status da conta e o status do ponto em seu vínculo. PEV não é um valor literal no status da conta. No modo API, os dados vêm de `GET /api/v1/users/me` e `GET /api/v1/pevs/me`, após autenticação real; na demonstração, vêm das fixtures locais. Não usar uma lista pública de PEVs para decidir titularidade. O frontend controla a experiência; a API revalida autorização e titularidade na resolução e na gravação.

O Forms não gera, exibe ou oferece escolha de QR Code. O QR existe somente no mobile e abre o link do Forms com o identificador do participante. Abrir a raiz sem identificador mostra uma orientação para entrar pelo aplicativo; nenhum participante é escolhido automaticamente. Links antigos com tela=qr não exibem mais uma tela de QR.

## Apresentar coleta com motorista

Abra `/?participante=b2b-001` e escolha **Coleta com motorista**, ou acesse `/?participante=b2b-001&fluxo=motorista`.

1. Abra **Usar motorista de demonstração**, escolha um motorista e clique em **Consultar solicitações**. O acesso é por CPF/CNH, sem login de e-mail e senha, conforme o contrato atual.
2. Escolha **Atender** em um pedido aprovado e agendado da empresa identificada pelo QR.
3. Clique em **Registrar chegada**. Consultar o QR e escolher um pedido não registram chegada nem coleta.
4. Aguarde o aceite do estabelecimento no aplicativo. Para apresentar, abra **Controles da apresentação** e use **Simular aceite pelo estabelecimento**. Esse controle é exclusivo da demo: na integração, o motorista não confirma pelo estabelecimento.
5. Informe volumes apresentado e coletado, condição do óleo, ocorrência, motivos aplicáveis e observação quando necessária. Nenhum desses fatos é preenchido silenciosamente.
6. Confirme o resultado e consulte o comprovante. Cada solicitação gera no máximo uma coleta. Reenvio equivalente não duplica; dados diferentes na mesma solicitação geram conflito.
7. Volte às solicitações para atender outro pedido. Comprovantes locais é um recurso da apresentação, sem promessa de endpoint de histórico para motorista sem sessão.

Documentos inteiramente fictícios:

| Motorista | CPF de teste | CNH de teste |
| --- | --- | --- |
| Carlos Almeida | 12345678901 | 12345678901 |
| Luciana Costa | 98765432109 | 98765432109 |

Os documentos ficam somente em memória; recarregar a página exige informar novamente a identificação. CPF, CNH e token QR não são gravados no histórico B2B. Os rascunhos de fatos ficam na sessão.

Uma visita sem óleo pode registrar zero litros: apresentado zero, condição Não avaliado, observação obrigatória e motivo coerente com o resultado. A demo usa a tolerância de 90% a 110% do volume estimado, conferida na rotina atual. Não simula pontos ou saldo.

Os dois pedidos fictícios começam sem chegada nem aceite e saem da lista de aptos após a confirmação. Não é criada uma solicitação artificial para repetir a mesma coleta.

## Apresentar entrega simples em PEV: B2B ou B2C

Abra `/?participante=b2c-001` ou `/?participante=b2b-001` e escolha **Entrega em PEV**. O caminho direto usa `fluxo=pev`.

1. No login, abra **Usar uma conta de demonstração**, escolha o PEV e continue.
2. O nome da pessoa ou empresa vem do QR e não possui edição.
3. Informe mais que zero e até 999,99 litros, com até duas casas decimais. Esse limite é o do contrato B2C e também é usado como limite técnico na demonstração B2B em PEV; não constitui contrato de API novo para empresas.
4. Confirme e consulte o comprovante ou histórico local.
5. Use **Novo recebimento** para outra entrega. Reabrir uma operação confirmada mostra o comprovante existente.

| Responsável | E-mail fictício | Ponto |
| --- | --- | --- |
| Ana Souza | ana@olius.demo | PEV Centro |
| Bruno Lima | bruno@olius.demo | PEV Vila |

Senha de teste das duas contas: `OliusDemo123!`.

O limite de duas entregas por participante/PEV/dia de São Paulo permanece como regra adicional da apresentação para B2B e B2C no PEV, com contagens independentes. Não foi encontrado no backend inspecionado e não garante um limite entre dispositivos. O caminho do motorista segue unicidade por solicitação, sem consumir os registros da entrega em PEV. Uma empresa recebida no PEV é armazenada como B2B/PEV local, sem ser lançada na API como cidadão.

## Contratos conferidos

Fontes: [API_Olius](https://github.com/Olius-Inter/API_Olius), revisão 4bf8083 (DTOs operacionais sem alteração desde c75c750); [DB_Segundo](https://github.com/Olius-Inter/DB_Segundo), revisão 5a9ff74.

### B2C

- `GET /api/v1/auth/web/csrf`: preparação CSRF do login web.
- `POST /api/v1/auth/web/login`: email/password; autenticação real com cookie de renovação e CSRF.
- `GET /api/v1/pevs/me`: PEV do responsável autenticado.
- `POST /api/v1/qr/resolutions`: qrToken; identifica cidadão beneficiário para PEV autorizado.
- `POST /api/v1/pevs/{pevId}/deliveries`: idempotencyKey, qrToken, oilVolumeLiters e deliveryDate no JSON. O responsável vem da sessão.
- `GET /api/v1/pevs/{pevId}/deliveries` e `GET /api/v1/pevs/{pevId}/deliveries/{deliveryId}`: histórico e comprovante.
- `GET /api/v1/users/me/deliveries`: histórico do doador no mobile.

`deliveryPayload()` em core.js produz o objeto da demonstração; `deliveryDTO()` em delivery-api.js produz o objeto do modo API. Quantidade e data originais são preservadas nos reenvios. O createdAt real é do servidor. Não há citizenId ou validatorId editáveis no formulário. As rotas GET de histórico estão documentadas como contrato disponível; a nova tela conectada mostra o comprovante retornado pelo POST e não implementa uma listagem remota.

`confirmPevDelivery()` permite o recebimento local de B2B ou B2C no PEV. Para cidadãos, reutiliza a regra existente; para empresas, usa um registro local marcado com `flow: PEV`, sem chamar a API B2C ou as rotinas de motorista. `deliveryPayload()` continua rejeitando empresa, para evitar uma integração incorreta com a rota exclusiva de cidadão. A futura integração B2B/PEV deve identificar o estabelecimento doador, o responsável autenticado pelo PEV e a quantidade, com idempotência e persistência próprias ao modelo aprovado.

### B2B

- `POST /api/v1/operations/b2b/context`: cpf, cnh e qrToken; retorna motorista, empresa, pedidos aptos e motivos ativos.
- `POST /api/v1/operations/b2b/requests/{id}/arrival`: mesmo objeto de identificação.
- `POST /api/v1/collection-requests/{id}/service-acceptance`: ação do estabelecimento no app, com sua própria sessão.
- `POST /api/v1/operations/b2b/requests/{id}/collection`: access (cpf/cnh/qrToken), collectedVolumeLiters, presentedVolumeLiters, oilCondition, hasCompromisingOccurrence, failureReasonCodes e observation.

`collectionPayload()` em b2b-core.js produz o objeto da demonstração; `collectionDTO()` em collection-api.js produz o objeto do modo API. A solicitação é a chave de idempotência. Data, resultado, pontos, recorrência e certificados reais são determinados pela API e pelas rotinas oficiais. A demo só representa o fluxo e os fatos. O modo API carrega motivos e solicitações do contexto real.

## Mobile e QR

A imagem do QR pertence exclusivamente ao aplicativo B2B/B2C. O mobile abre o Forms já com o identificador do participante; não há geração de QR, cópia de link de QR ou seleção de participante dentro do Forms. Para apresentar localmente, abra diretamente `/?participante=b2b-001` ou `/?participante=b2c-001`, simulando o link recebido do mobile. O identificador é preservado ao escolher o fluxo e fazer login; nome e identidade não possuem edição.

O token real já existe no perfil de `GET /api/v1/users/me`. O mobile precisa codificar um endereço HTTPS do Forms transportando esse token conforme a convenção combinada. Os links com participante=b2b-001 ou b2c-001 identificam somente as fixtures desta versão.

Um QR com localhost ou 127.0.0.1 aponta para o próprio aparelho leitor. Publique em HTTPS para testar entre aparelhos. O histórico local de quem confirma não sincroniza com o app do participante.

## Armazenamento e limites da demo

- Entregas B2B/B2C em PEV: localStorage, chave `olius.forms.deliveries.v1`, com marcação `flow: PEV` nos novos registros.
- Coletas com motorista (chegadas, aceites simulados e resultados): localStorage, chave `olius.forms.b2b.v1`.
- Sessão fictícia de PEV e rascunhos: sessionStorage, prefixo `olius.forms.`. Senhas não são armazenadas.
- Identificação de motorista: memória da página, descartada na recarga.
- Web Locks serializa gravações entre abas quando disponível; sem ela, não há garantia de concorrência.
- Dados podem ser manipulados ou apagados e ficam apenas na mesma origem/navegador. Não comprovam uma operação real.
- Falhas de armazenamento são exibidas; dados inválidos não são apagados silenciosamente.
- Registros B2B antigos da primeira demo sem marcação PEV permanecem preservados, mas não entram no histórico do novo caminho PEV. Registros B2C anteriores continuam visíveis.

Para reiniciar a apresentação, exclua apenas as chaves olius.forms.* nas ferramentas do navegador. Nenhum banco real é afetado.

## Organização e verificação

- index.html: entrada; style.css: visual responsivo.
- script.js/core.js: escolha de caminho, navegação e entrega simples em PEV para B2B/B2C.
- b2b.js/b2b-core.js: telas, fixtures e regras da coleta da operadora com motorista.
- api-flow.js: telas conectadas à API, separadas da demonstração.
- pev-api-auth.js/delivery-api.js: login, autorização PEV, identificação e entrega B2C.
- driver-api.js/collection-api.js: contexto, chegada e coleta B2B com dados reais.
- mobile-link.js: leitura do token recebido do mobile, sem gerar QR.
- assets/: elementos oficiais do Figma e fonte local.
- tests/: regras e roteiro de navegador; server.js: servidor de arquivos opcional.

Para o roteiro opcional de navegador, com o servidor já iniciado:

```sh
npm install --no-save playwright @axe-core/playwright
node tests/browser.cjs
node tests/pev-existing-account.browser.cjs
node tests/live-api.browser.cjs
```

No Windows usa Edge headless; nos demais sistemas requer `npx playwright install chromium`. OLIUS_TEST_URL seleciona outro endereço para os dois primeiros roteiros; OLIUS_TEST_DEPENDENCIES reutiliza dependências de outro diretório. Os testes de conta existente e integração iniciam seus servidores nas portas 5196 e 5197. Capturas e relatórios ficam em artifacts/, ignorado pelo Git. As integrações são exercitadas com respostas simuladas, incluindo falha após envio, reautenticação com outra conta, reenvio idêntico, ausência de aceite, conflito, validação de perfil e acessibilidade; não comprovam gravação na AWS.

## Visual e publicação

Referência principal: [login mobile B2B V2](https://www.figma.com/design/yBZd5MfeNRhxzkBHXEJutl/Olius---Geral?node-id=379-725), com fundo claro/degradê amarelo, cartão branco, Inter e botão amarelo. O [botão QR](https://www.figma.com/design/yBZd5MfeNRhxzkBHXEJutl/Olius---Geral?node-id=2839-2737) orienta o fluxo. Os formulários são adaptações, sem menu administrativo.

Recursos locais, sem URLs temporárias em execução. Fonte Inter sob SIL OFL (assets/fonts/Inter-OFL.txt). A biblioteca de geração de QR foi removida do Forms.

O projeto permanece no repositório independente `Olius_Frontend_Forms_Segundo`. A hospedagem é estática, sem build, com a raiz como pasta de publicação. O servidor local é opcional e não faz proxy da API. Não há importação de código, rotas ou dependências do portal ADM.
