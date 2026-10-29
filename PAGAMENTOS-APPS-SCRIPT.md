# Pagamento por empresa sem habilitar o Blaze

Rota escolhida em 27/10/2026 após Felipe recusar o adiantamento apresentado
na etapa de faturamento do Google. Firestore e Auth continuam no Spark.
Apps Script executa o backend, em projeto separado do upload de vídeos.
As tarifas das transações do Mercado Pago continuam sendo as do vendedor.

## O que está publicado e o que falta

Projeto: [DeliveryMenu - Pagamentos](https://script.google.com/home/projects/1SN3JkKZrgOD60f-DTwj66a8hArsf48DOeLxAIrOMvJ_rGZ0Hokg0s1DJ/edit).
Identificação da versão e endereço público em `pagamentos-appscript/projeto.json`.
Em 29/10/2026, a versão 2 está publicada na implantação existente. Após
recarregar o editor, o código foi comparado com o pacote local, normalizando
somente as quebras de linha. O health público respondeu HTTP 200 e
`ativo:true`; a rota `ativar`, sem Firebase ID token, respondeu
`NAO_AUTENTICADO`. Isso comprova publicação e rejeição sem autenticação.

Credenciais OAuth e chave mestre já estão nas propriedades privadas. A rotina
de cinco minutos foi instalada em 28/10 às 22h34, com um gatilho observado.
O provedor App Check Enterprise foi conferido na interface; Auth e Firestore
continuam no Spark, sem habilitar faturamento.

O frontend local está com `ativo:true` e a site key pública configurada.
A publicação desse frontend aguarda a conferência de infraestrutura, domínios
e regras atuais. Conectar a conta mantém o pagamento da loja pausado; ativar
e pausar são ações explícitas autenticadas. A chave global do serviço não
ativa automaticamente o checkout de uma loja.

Ainda falta homologar OAuth, checkout, notificação, consulta, recusa e estorno
no Mercado Pago. Não há confirmação de conta conectada nem de cobrança real.

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

Na conferência de 29/10/2026, a lógica de pagamentos teve 45 testes aprovados
e 26 ignorados; Apps Script teve 83 aprovados e um ignorado. Os cinco grupos
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
[reCAPTCHA sem faturamento](https://docs.cloud.google.com/recaptcha/docs/billing-information).
