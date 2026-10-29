# Pagamento por empresa sem habilitar o Blaze

Rota escolhida em 27/10/2026 após Felipe recusar o adiantamento apresentado
na etapa de faturamento do Google. Firestore e Auth continuam no Spark.
Apps Script executa o backend, em projeto separado do upload de vídeos.
As tarifas das transações do Mercado Pago continuam sendo as do vendedor.

## O que está publicado e o que falta

Projeto: [DeliveryMenu - Pagamentos](https://script.google.com/home/projects/1SN3JkKZrgOD60f-DTwj66a8hArsf48DOeLxAIrOMvJ_rGZ0Hokg0s1DJ/edit).
Identificação da versão e endereço público em `pagamentos-appscript/projeto.json`.
Em 29/10/2026 às 14h15, a versão 7 foi publicada na implantação existente,
com endereço preservado. A fonte foi comparada ao pacote local por cópia
do editor, normalizando as quebras de linha. Health `ativo:true` e rejeição
`NAO_AUTENTICADO` em `ativar` sem Firebase ID token já foram conferidos.

O diagnóstico real inicial retornou Firestore HTTP 200 e Auth HTTP 403,
`PERMISSION_DENIED`/`SERVICE_DISABLED`, com projeto de cota incorreto.
O helper dos acessos privados ao Google passou a enviar `x-goog-user-project`
com o projeto Firebase. Novo diagnóstico real: Firestore HTTP 200 e Auth
HTTP 200. A versão 3 foi atualizada com sucesso pela interface nativa.
Não houve migração de projeto GCP nem alteração de escopos ou faturamento.
O diagnóstico fica no editor, sem rota web, e não registra tokens nem corpos.

Credenciais OAuth e chave mestre já estão nas propriedades privadas. A rotina
de cinco minutos foi instalada em 28/10 às 22h34, com um gatilho observado.
O provedor App Check Enterprise foi conferido na interface; Auth e Firestore
continuam no Spark, sem habilitar faturamento.

O frontend `bac4651` está publicado: Pages concluído com sucesso e dez assets
HTTP 200 iguais à fonte conferidos em 29/10. Está com `ativo:true` e a site key
pública configurada. O botão **Conectar** foi testado na interface de produção:
passou por Auth/App Check SDK, ID token no backend e Firestore, e abriu a
autorização oficial da aplicação Cardapio Delivery no Mercado Pago, após
selecionar Brasil. A tela pede acesso a perfil/movimentações e criação,
cancelamento e devolução de pagamentos. O usuário autorizou; o callback
concluiu e o painel confirmou a conta conectada, com recebimentos pausados.
Conectar mantém o pagamento da loja pausado; ativar e pausar são ações
explícitas autenticadas. A chave global não ativa o checkout de uma loja.

O frontend `abccd2f` publicou a orientação em três etapas no painel e o
guia público `pagamento-online.html`: cada empresa autoriza sua própria
conta pela aplicação central, sem editar código nem copiar credenciais.
Pages run 40908990535 success; dez assets HTTP 200 iguais à fonte.

Um checkout real de R$5 foi criado pelo cardápio normal com App Check JWT,
em loja isolada `homologacao-2eff489530234329`, e abriu no Mercado Pago.
O usuário não conseguiu pagar: a sessão reconheceu comprador e vendedor
como a mesma conta ("Eu mesmo"). Não houve pagamento confirmado. Ainda
falta homologar aprovação, notificação, consulta final, recusa e devolução.
Pix sem conta também mostrou erro genérico ao usuário. Diagnóstico privado
do editor em 29/10 às 13h27: search HTTP200 com zero pagamentos; preferência
HTTP200, não expirada, recebedor/total/referência/prazo correspondentes.
O MP não retornou motivo de recusa porque nenhum pagamento foi criado.
Isso não identifica a causa da falha de processamento no checkout.
O helper de homologação é administrativo e não faz parte do cadastro de
empresas: preserva a origem pausada, recifra a conta com AAD da loja isolada
e bloqueia renovação de sua cópia para não duplicar o refresh token.

A versão 5 verifica `/users/me` antes da ativação, fora da transação, e
confere conta e versão da credencial antes de gravar. Revogação confirmada
pausa somente a conta ainda atual; falha transitória preserva a autorização.
O status renova uma autorização ativa vencida antes de responder, evitando
anunciar pausa quando o checkout continuaria ativo. A cópia de homologação
tem `renovacaoBloqueada:true`, confirmado em produção; nunca renova tokens.

## Desvincular e conectar outra conta

O painel pede confirmação dentro do cartão antes de enviar `desvincular`.
A rota POST exige sessão e vínculo com a loja e confere a conta esperada;
se outra conta foi conectada enquanto a tela estava aberta, recusa a ação.
Uma transação remove a conta dos novos recebimentos e pausa loja e integração.
Não apaga credenciais, transações nem pedidos e não revoga a autorização no
Mercado Pago: consultas e devoluções anteriores usam a conta gravada no
pagamento, mesmo que a loja já tenha outra conta conectada.

Cada tentativa de conexão usa `oauthVersao` privado, conferido antes da troca
de código e no commit do callback. Desvincular ou iniciar uma tentativa nova
invalida links antigos. Repetir a desvinculação já concluída não invalida uma
conexão nova pendente. Reconectar mantém a loja pausada até ativação explícita.
O fluxo não transfere pagamentos anteriores para a nova conta.

## Segurança e confirmação

- O script executa como o proprietário e usa seu OAuth do Google somente em
  URLs fixas do Firestore/Auth do projeto `cardapio-delivery-ae048`.
- O navegador envia o Firebase ID token no corpo, nunca na URL. O servidor
  consulta o Firebase Auth e revalida o vínculo com a loja a cada ação privada.
- Checkout/consulta públicos exigem App Check RS256: assinatura JWKS do Google,
  emissor, projeto, aplicativo, datas e algoritmo. Chaves do Google em cache
  por uma hora; sem registro válido não há checkout. Não aplicar enforcement
  global no Firestore/Auth usado pelos clientes antigos nesta implantação.
- Tokens dos vendedores permanecem cifrados AES256GCM, vinculados a loja e
  conta. A chave fica nas propriedades privadas do script; não no repositório.
  AES, SHA, HMAC e verificação RSA usam node-forge 1.4.1, com testes cruzados
  contra a criptografia do Node. Licenças acompanham o pacote.
- O runtime exige uma chave mestre de 32 bytes gerada com CSPRNG fora do
  script. A fonte de nonces usa HMAC dessa chave e contador persistente sob
  LockService. Não resetar contador, trocar a chave ou restaurar propriedades
  antigas sem tratar as credenciais cifradas e o estado de segurança.
- Apps Script não expõe os cabeçalhos de entrada usados por `x-signature`.
  Nesta rota a autenticação do aviso usa um token HMAC exclusivo por loja e
  pedido, enviado somente na URL privada de notificação ao Mercado Pago.
  O token não aparece no recibo público nem no checkout devolvido ao cliente.
  Isso é diferente da assinatura nativa de webhook usada na rota Firebase.
- Mesmo com aviso autenticado, o script consulta o recurso real na API do
  Mercado Pago e confere conta recebedora, valor, moeda, loja e pedido.
  O aviso e a volta do navegador nunca marcam um pedido como pago por si sós.
- Firestore REST mantém transações, precondições e reservas de cupom. O cálculo
  de catálogo, adicionais, entrega, desconto e agenda é compartilhado com a loja.
  OAuth/state e checkout idempotentes preservam as proteções da rota anterior.
- O acompanhamento consulta pendências a cada 15 segundos quando visível e
  online. Uma rotina de cinco minutos também confere até 50 pendências,
  inclusive dentro do prazo. Rotina e consulta servem de recuperação do aviso.
- A recusa só conclui após confirmação de devolução do provedor. A autorização
  de contas antigas é preservada para conciliar/estornar pedidos anteriores.

## Configurar nas propriedades privadas do script

| Propriedade | Finalidade |
|---|---|
| `PAGAMENTOS_ATIVOS` | Habilita o serviço global; confirmado `true` em 29/10/2026. Cada loja exige ativação própria. |
| `PAGAMENTOS_URL` | URL `/exec` da implantação do projeto. |
| `MP_CLIENT_ID` | Identificador da aplicação Mercado Pago própria do app. |
| `MP_CLIENT_SECRET` | Segredo OAuth da mesma aplicação, somente no servidor. |
| `MP_TOKENS_KEY` | 32 bytes aleatórios em base64; preservar para ler as contas. |
| `MP_WEBHOOK_SECRET` | Opcional: chave própria do token HMAC de aviso; por padrão deriva o uso da chave protegida. |
| `RNG_SEQUENCIA` | Contador mantido pelo serviço; não preencher/resetar manualmente. |

O callback cadastrado no Mercado Pago deve ser a URL `/exec` acrescida de
`?rota=callback`, exatamente igual à enviada na autorização. O servidor gera
a URL de notificação de cada preferência; não copiar seu token para documentos,
prints, logs ou configuração pública. Configurar notificações genéricas da
aplicação não substitui essa URL autenticada por pedido.

No frontend, `pagamentos-config.js` usa `servico:'appscript'`, URL pública,
site key pública do App Check e a chave `ativo`, atualmente `true` no código
local. Essa configuração disponibiliza a integração; o callback OAuth apenas
conecta a conta, sem ativar o pagamento da loja. A ativação própria da loja
é feita pela ação **Ativar pagamento online** no painel.

Executar `configurarPagamentos` no editor para autorizar os escopos e instalar
a rotina de cinco minutos. A instalação é idempotente. Os escopos são chamadas
externas, Google Cloud (Firestore/Auth) e gerenciamento da rotina. Publicar
como proprietário, acesso externo para checkout/avisos, com as validações
acima. Atualizações exigem nova versão da implantação existente para conservar
URL e callback; salvar arquivos no editor não atualiza a versão publicada.

## Código e verificações

`runtime.js` adapta Apps Script; `firestore.js` implementa o protocolo REST;
`seguranca.js` implementa os adaptadores criptográficos. `gerar.mjs` empacota
somente o servidor em `publicar/Code.gs` e manifesto, reutilizando a lógica
de `functions/pagamentos.js` e os cálculos puros. Converte apenas esse módulo
controlado para I/O síncrono e adapta o hash da ficha; o frontend não tem build.
Revisar o gerador se a forma das funções compartilhadas mudar.

```powershell
node pagamentos-appscript/gerar.mjs
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
$env:METADATA_SERVER_DETECTION='none'
node --test pagamentos-appscript/*.test.js
node rea/verificar-pagamentos-cliente.mjs
```

Na conferência de 29/10/2026, a lógica de pagamentos teve 46 testes aprovados
e 26 ignorados; Apps Script teve 105 aprovados e um ignorado. Os seis grupos
do cliente passaram, incluindo conectar sem ativar a loja e ativação/pausa
explícitas autenticadas. O teste do serviço desligado injeta `ativo:false`,
independente da configuração de produção, e os transportes são simulados.

A execução integrada atual não rodou: o emulador falhou no selector loopback
com JRE 21. Há uma execução anterior do fluxo compilado contra emulador real
com provedor simulado, mas ela não valida a versão atual. Testes ignorados
não equivalem à execução completa. Não houve transação real nesses testes.

## Limites de operação

Apps Script não tem a mesma capacidade de um backend dedicado. A documentação
indica, para conta pessoal, 20 mil chamadas UrlFetch/dia, 90 minutos/dia de
rotinas e até 30 execuções simultâneas por usuário; cada execução tem teto de
seis minutos. Não foram feitos testes de carga ou de latência real. Ao atingir
as cotas, o serviço pode falhar/parar; não liberar pedido sem confirmação nem
prometer preparo imediato antes da atualização do pagamento.

O App Check/reCAPTCHA Enterprise tem franquia própria; sem faturamento,
exceder a cota pode impedir novas verificações. Não habilitar faturamento
automaticamente para superar limites. Conferir o comportamento do webhook e
dos redirecionamentos do Apps Script na homologação real do Mercado Pago.

Fontes: [Apps Script web apps](https://developers.google.com/apps-script/guides/web),
[cotas](https://developers.google.com/apps-script/guides/services/quotas),
[V8](https://developers.google.com/apps-script/guides/v8-runtime),
[App Check para backend próprio](https://firebase.google.com/docs/app-check/custom-resource-backend),
[reCAPTCHA sem faturamento](https://docs.cloud.google.com/recaptcha/docs/billing-information),
[autenticação REST e projeto de cota](https://docs.cloud.google.com/docs/authentication/rest),
[Identity Platform e projeto de cota](https://docs.cloud.google.com/identity-platform/docs/activity-logging).
