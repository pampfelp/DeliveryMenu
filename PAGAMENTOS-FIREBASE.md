# Pagamento online por restaurante

Estado em 27/10/2026: integração preparada no código e testada localmente,
com o pagamento desativado. `pagamentos-config.js` mantém `ativo: false` e
o parâmetro do backend `PAGAMENTOS_ATIVOS` tem padrão `false`. Não houve
mudança para Blaze, deploy das funções, conexão com conta real nem cobrança
no Mercado Pago. As regras novas e o índice de reconciliação são locais;
ainda não foram publicados.

Atualização da tentativa de ativação: Felipe relatou adiantamento de R$150
na etapa de faturamento do Google e recusou. O diálogo de upgrade foi
fechado; o projeto continua Spark, conferido no Console. Não habilitar
Blaze nem vincular faturamento com base na autorização anterior.
A alternativa em Apps Script foi implementada e publicada, desativada.
O estado atual e a sequência de configuração estão em
[PAGAMENTOS-APPS-SCRIPT.md](PAGAMENTOS-APPS-SCRIPT.md). Este arquivo descreve
a rota Firebase Functions preparada anteriormente; não executá-la sem nova
autorização de faturamento. Pagamento real ainda não está disponível.

No Console atual, o registro de reCAPTCHA clássico está descontinuado,
com o campo de segredo desabilitado. Retomar a rota Firebase exige usar
Fraud Defense/reCAPTCHA Enterprise e adaptar o provedor no cliente;
essa adaptação ainda não está feita. A criação da aplicação Mercado Pago
foi autorizada, mas voltou à validação de segurança e não foi confirmada.

## Modelo implementado

Cada restaurante conecta a própria conta pelo OAuth do Mercado Pago, com
autorização no site do provedor. O código usa Checkout Pro com o token do
vendedor conectado. Não envia `marketplace_fee`, portanto não configura
comissão para o Cardápio Delivery. As tarifas do provedor continuam sendo
as aplicáveis à conta do vendedor.

O servidor recalcula catálogo, opções, quantidade, cupom e entrega. Se o
subtotal ou total apresentado pelo cliente divergir, exige conferir o
pedido antes de pagar. A criação do checkout reserva o cupom e é
idempotente. O pedido entra na antessala do restaurante somente depois da
confirmação consultada na API do Mercado Pago, com conferência de vendedor,
valor, moeda e identificação do pedido. O retorno do navegador não comprova
pagamento.

O callback OAuth usa estado de uso único e PKCE. Tokens de acesso e de
renovação ficam cifrados com AES-256-GCM em coleções privadas do Firestore;
não são enviados ao navegador. Webhooks exigem assinatura. Há tratamento
de renovação de token, reconexão, recusa com estorno, pagamento duplicado ou
tardio e reconciliação de pendências. Esses comportamentos foram exercitados
com provedor simulado; não são homologação no Mercado Pago.

## Código e execução

- `functions/index.js`: entrada HTTP `pagamentos` e rotina
  `expirarPagamentos`, na região `southamerica-east1`.
- `functions/pagamentos.js`: OAuth, checkout, confirmação, reserva e
  liberação de cupom, estorno e reconciliação.
- `functions/seguranca.js`: cifragem, PKCE e assinatura de webhook.
- `functions/calcular-pedido.js`: cálculo e validação do pedido; importa os
  mesmos módulos puros de preço, entrega, horário e cupom da loja.
- `pagamentos.js` e `pagamentos-config.js`: transporte do cliente e chave
  de ativação. O checkout da loja e a conexão nas Configurações usam esse
  transporte.
- `firestore.rules` e `firestore.indexes.json`: acesso privado aos tokens e
  transações, proteção dos pedidos pagos e índice da reconciliação.

O `firebase.json` usa `source: "."`, codebase `pagamentos` e Node.js 22.
Isso inclui os módulos puros da raiz sem criar build do frontend. O pacote
Node serve às funções; a loja continua em HTML, CSS e JavaScript puros.
O arquivo de configuração exclui segredos e arquivos de interface do pacote
de deploy.

A função HTTP tem mínimo zero e máximo de duas instâncias. A rotina tem
mínimo zero, máximo de uma instância e roda a cada 15 minutos, processando
até 50 transações por passagem. Atrasos ou falhas de reconciliação precisam
ser acompanhados nos logs. Limitar instâncias e criar alertas de orçamento
não estabelece um teto de gastos.

## Configuração futura

Não colocar valores secretos neste documento, no repositório ou no frontend.
Os segredos são lidos pelo Firebase Secret Manager:

| Segredo | Uso |
|---|---|
| `MP_CLIENT_SECRET` | Troca e renovação da autorização OAuth da aplicação. |
| `MP_WEBHOOK_SECRET` | Validação das notificações assinadas. |
| `MP_TOKENS_KEY` | Chave de 32 bytes codificada em base64 para AES-256-GCM. |

Preservar `MP_TOKENS_KEY` com recuperação segura. Trocar a chave sem migrar
os registros cifrados impede decifrar as contas já conectadas. Não gerar
outra chave a cada deploy.

| Parâmetro | Valor ou finalidade |
|---|---|
| `MP_CLIENT_ID` | Identificador público da aplicação no Mercado Pago. |
| `FRONTEND_URL` | URL base da loja, atualmente `https://pampfelp.github.io/DeliveryMenu/`. |
| `PAGAMENTOS_URL` | Base HTTPS da função, sem `/callback`. |
| `PAGAMENTOS_ATIVOS` | Manter `false` até a homologação controlada. |

Base prevista:
`https://southamerica-east1-cardapio-delivery-ae048.cloudfunctions.net/pagamentos`.

Registrar no provedor o callback exato:
`https://southamerica-east1-cardapio-delivery-ae048.cloudfunctions.net/pagamentos/callback`.

O webhook fica na mesma base, terminado em `/webhook`. As URLs são as
previstas pelo código; não comprovam serviço publicado.
Cada preferência recebe sua URL de notificação com `lojaId` e `pedidoId`
na query. Conferir na homologação que o provedor conserva esses parâmetros
e envia `data.id`, `x-signature` e `x-request-id` para a validação.

Configurar App Check para o app web com reCAPTCHA V3 e os domínios usados.
A site key pública vai em `chaveAppCheck`, em `pagamentos-config.js`.
Não inserir a chave secreta do reCAPTCHA no frontend. O backend confere o
token App Check nas chamadas públicas de checkout e consulta.

## Sequência para publicar e homologar

1. Com autorização para faturamento, habilitar Blaze e configurar orçamento,
   alertas e acompanhamento de consumo. O código pronto não habilita o plano.
2. Cadastrar os três segredos e os parâmetros, conservando
   `PAGAMENTOS_ATIVOS=false` e `PAGAMENTOS.ativo=false`. Configurar aplicação
   Mercado Pago, callback e App Check.
3. Publicar a codebase, as regras e o índice. O comando previsto, para uma
   execução futura autorizada, é:

   ```powershell
   firebase deploy --only functions:pagamentos,firestore:rules,firestore:indexes --project cardapio-delivery-ae048
   ```

   A codebase `pagamentos` inclui a função HTTP e a rotina agendada. Conferir
   URLs, índice pronto, logs e restrições de acesso após o deploy.
4. Homologar em ambiente de teste isolado, com suas próprias flags habilitadas
   e contas de teste do provedor. Manter produção desativada. Cobrir dois
   vendedores, Pix, cartão aprovado/recusado, webhooks repetidos ou atrasados,
   volta do navegador, recusa e estorno, pagamento após expiração, cupons
   concorrentes, renovação e reconexão. Conferir que cada vendedor recebe
   somente as transações da própria loja.
5. Somente depois da homologação, ativar o backend de produção e a flag do
   frontend, publicar os arquivos e conferir uma operação autorizada. Não
   ativar só uma das pontas e apresentar o fluxo como disponível.

Para suspender novos pagamentos de uma loja, usar **Pausar pagamento
online** no painel. A pausa mantém a autorização da conta para conciliar
e devolver pedidos anteriores; não revoga o OAuth no Mercado Pago.
A chave global `PAGAMENTOS_ATIVOS=false` interrompe também webhooks,
devoluções e reconciliação; após o início da operação, exige tratar as
pendências antes de ser usada como desligamento geral.

## Verificações locais registradas

Em 27/10/2026, backend e cálculo passaram em 70 testes, com Firestore
Emulator em `127.0.0.1:8080` e provedor simulado. Para repetir:

```powershell
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
$env:METADATA_SERVER_DETECTION='none'
node --test functions/pagamentos.test.js functions/calcular-pedido.test.js
```

Sem `FIRESTORE_EMULATOR_HOST`, os testes de integração são pulados; uma
execução sem essa variável não equivale aos 70 testes completos. O emulador
precisa estar iniciado antes do comando.

As regras de pagamento passaram em 42 verificações locais. O transporte do
cliente é conferido por `node rea/verificar-pagamentos-cliente.mjs`.
Esses resultados não comprovam carga, Safari/iPhone real, disponibilidade
das funções publicadas ou homologação do Mercado Pago. Nada foi ativado por
esses testes.

## Fontes oficiais

- [Mercado Pago: Checkout Pro para marketplace](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/how-tos/integrate-marketplace).
- [Mercado Pago: obter Access Token por OAuth](https://www.mercadopago.com.br/developers/pt/docs/security/oauth/creation).
- [Firebase: gerenciar funções, runtime e instâncias](https://firebase.google.com/docs/functions/manage-functions).
- [Firebase: cotas e limites das funções](https://firebase.google.com/docs/functions/quotas).
- [Firebase: alertas de orçamento](https://firebase.google.com/docs/projects/billing/budget-alerts).
