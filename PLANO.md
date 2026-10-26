# Plano do Cardápio Delivery

Atualizado em 2026-10-26. O estado vivo está em
`Relatórios Claude/estado/DeliveryMenu.md`; `replica/features.csv` é um
levantamento anterior e não comprova prontidão de produção.

## Situação atual

- Publicados anteriormente: loja com pedidos reais e acompanhamento,
  painel, usuários, CRM e ofertas individuais.
- Agendamento implementado em 26/10: chave por loja, horários a cada 30 min
  até 72 horas, conferência no Firestore e data/hora visível para equipe e
  cliente. Testes de regras e fluxo completo realizados no emulador.
- Cadastro de equipe retestado em Auth/Firestore Emulator: preserva sessão
  do dono, exige senha própria no primeiro acesso, impede vínculo cruzado
  entre restaurantes e encerra a sessão ao retirar acesso.
- Pagamento online continua desativado. Pedido atual: cada empresa conecta
  sua própria conta Mercado Pago por OAuth. Firebase Functions exige Blaze;
  aguarda decisão sobre faturamento; Apps Script foi indicado como opção.
- Pendentes: homologação em iPhone real, uso por funcionários reais,
  pagamento/estorno, instalação PWA, termos e preparação para carga.

## Histórico do plano de 15/10

As seções seguintes registram a sequência original; os estados antigos
de demonstração e recursos faltantes são superados pela situação acima.

## Onde está hoje

Pronto e publicado no GitHub Pages, com dados de exemplo:

- Loja do cliente no celular e no computador, idêntica às imagens validadas
  (imgdiff de 98,3 a 100 de layout nas onze telas).
- Sacola de verdade, guardada no aparelho; preço com adicionais pelas regras
  soma, média, menor e maior (a pizza meio a meio usa "maior"); limite e
  obrigatoriedade dos grupos; editar, remover e limpar com confirmação
  própria; busca sem acento; entrega, retirada e consumo no local; pagamento
  online primeiro e na entrega em segundo.
- O envio do pedido ainda não sai do aparelho. A tela avisa que é uma
  demonstração.

Link para ver como nas imagens, com a sacola de exemplo: acrescente
`?exemplo=1` ao endereço.

## O que falta, em ordem

Cada fase diz o que depende dele. Nada de conta, chave, cartão ou domínio é
criado por sessão de IA.

### Fase 2. Banco de dados (Firebase)

**Feito em 2026-10-15**, na conta dele pelo navegador do app: projeto
`cardapio-delivery-ae048`, app web "Cardápio Delivery" (config em
`firebase-init.js`), Firestore edição Standard em `southamerica-east1`,
Authentication com e-mail e senha, domínio `pampfelp.github.io` autorizado,
Gemini e Google Analytics desligados. As regras de `firestore.rules` estão
publicadas (conferido pelo hash) e testadas: ler lojas passa; criar loja sem
login, criar pedido em loja inexistente, ler pedidos sem ser dono e escrever
fora dos caminhos previstos voltam `permission-denied`. Plano Spark
(gratuito), sem backup automático, que pede o plano pago.

Falta no código desta fase:

- Modelo para várias lojas (decisão dele): `lojas/{lojaId}` com nome,
  endereço curto (slug), cor, logo, WhatsApp, horários, bairros, taxas,
  agendamento e formas de pagamento; `lojas/{lojaId}/categorias` e
  `lojas/{lojaId}/itens` com os grupos de adicionais dentro do item;
  dinheiro em centavos.
- A loja abre pelo endereço curto (`?loja=nome-do-restaurante`).
- Pedido do cliente anônimo grava numa antessala
  (`lojas/{lojaId}/pedidosEntrada`), nunca direto na base (crença 12). As
  `firestore.rules` só aceitam a forma certa do pedido.
- Cardápio é leitura pública; escrever é só para o dono da loja.
- Uma escuta por coleção (crença 10) e indicador de sincronização do
  boilerplate.

### Fase 3. Regras de negócio que já estão entendidas

Todas lidas no original e descritas em `rea/ACHADOS.md`.

- Aberto, fechado e "apenas agendamento" pelos horários da loja (P3).
- Promoção e item que valem só em certos dias e horas (P3). Atenção: janela
  que passa da meia-noite precisa ser dividida em duas.
- Horários de agendamento em faixas, com antecedência e lotação (P5). A
  lotação tem que ser conferida também na gravação, para duas pessoas não
  pegarem a última vaga.
- Taxa e tempo de entrega: **feito no app em 2026-10-15** com a regra dele.
  R$ 3,00 no bairro do restaurante; nos outros, R$ 3,00 mais R$ 1,50 por km
  em linha reta até o centro do bairro, arredondado para cima em R$ 0,50;
  fora da lista ou acima de 10 km, "ainda não entregamos". Valores
  confirmados por ele em 2026-10-15 e editáveis por loja no painel; a lista
  de bairros com o ponto de cada um também vem do painel. O tempo estimado
  (25 min + 4 min por km, faixa de 10 min) ainda é proposta minha.
- Pedido mínimo, entrega grátis a partir de um valor, cupom.
- Mensagem pronta para o WhatsApp da loja (P6).

### Fase 4. Painel do restaurante

Andamento (2026-10-15, noite): pedido de verdade no ar. A loja com
?loja=<link> lê o restaurante no Firestore, grava em pedidosEntrada e o
cliente acompanha pelo id; testado de ponta a ponta com recusa na Casa
Jambu. Falta o editor de cardápio para a loja real ter itens.

Andamento (2026-10-15): login e cadastro do dono no ar e testados por ele
(loja Casa Jambu criada). Imagens da tela de pedidos e do detalhe do pedido
(PD10, PD11, P10, P11) feitas e esperando validação. Ao gravar pedidos de
verdade, a regra de pedidosEntrada precisa aceitar desconto de cupom: hoje
ela exige total = subtotal + taxa.

Depende dele: validar as imagens das telas (crença 37). Base visual: os
mesmos tokens da loja.

- Cadastro e login do dono pelo Firebase Auth, com cadastro pronto (crença
  38). Papéis dono e atendente.
- Pedidos chegando em tempo real, mudando de status (recebido, em preparo,
  saiu, entregue), com som.
- Cardápio: categorias, itens, grupos de adicionais, esgotado, promoção.
- Configurações (tela central, regra 8 do design system): horários,
  fechar agora, bairros e taxas, agendamento, formas de pagamento, cor da
  loja, logo e fotos. Foto vai em base64 no Firestore ou no Drive pelo Apps
  Script; nunca Firebase Storage. Cor clara troca o texto do botão para
  preto (contraste).
- KPI em toda listagem (crença 17).

### Fase 5. Pagamento online

Decisão dele (2026-10-15): cada restaurante usa o provedor que preferir, e
o primeiro a ser ligado é o **Mercado Pago**. Depende de cada restaurante:
ter a conta no provedor e gerar as credenciais.

- O provedor é escolhido por loja no painel; o código fala com um provedor
  por vez através de um módulo próprio, começando pelo Mercado Pago.

- A chave do provedor fica no Apps Script (`Code.gs`), nunca no navegador
  (crença 13).
- Pix: QR Code e copia e cola na tela de espera; o pedido só vai para a
  cozinha quando o provedor confirma.
- O aviso de pagamento do provedor é tratado sem duplicar pedido
  (`padroes/desenhar-api-e-apps-script.md`, idempotência).
- Estorno (pedido dele, 2026-10-15): pedido pago online e recusado pelo
  restaurante precisa devolver o dinheiro pelo provedor. A tela S18 hoje
  diz "Nada foi cobrado", que só vale para pagar na entrega; com Pix ou
  cartão online o texto e o fluxo mudam junto com o estorno.
- Enquanto a loja não tiver o Mercado Pago ligado, "Pagar online" não
  aparece (S14b, decisão 8).

### Fase 6. Telas que ainda não têm imagem

Cada uma passa pelo fluxo de imagem primeiro antes de virar código: mais
informações da loja; promoções; pedidos e conta do cliente (entrada por
telefone); lista de categorias aberta; cálculo de taxa antes do checkout;
escolha do horário agendado; espera do Pix. Revisão do pedido, troco e loja
fechada já têm imagem (S09, S14b, S15 a S18, S01b, S08b).

### Fase 7. Instalável e lançamento

- Ícones, nome no `manifest.json`, service worker e `verificar-pwa.mjs`
  (crença 39).
- Política de privacidade e termos (`padroes/checklist-legal-basico.md`),
  porque o app guarda telefone e endereço.
- Domínio próprio, se ele quiser. Título e imagem de compartilhamento.
- `sweep.py` sem resquício do original antes de divulgar.

## Decisões dele (2026-10-15)

1. Firebase: criar agora, pela conta dele, no navegador do app.
2. Taxa: R$ 3 no mesmo bairro, escalonando pela distância dos outros
   bairros: R$ 1,50 por km, arredondado para cima em R$ 0,50, até 10 km.
3. Pagamento online: o que o restaurante preferir, começando pelo Mercado
   Pago.
4. Sem logo: o espaço some, como se não houvesse lugar para logo.
5. Nome do app: Cardápio Delivery.
6. Pedido que acabou de chegar aparece como "Novo" até ser aceito; o
   número sai no aceite, pelo contador da loja. As imagens PD10, PD11, P10
   e P11 mostram "#1051" e ficam assim, com essa diferença aceita.
7. Nome e WhatsApp do cliente numa tela própria depois da sacola (S09),
   guardados no aparelho para o próximo pedido.
8. "Pagar online" some enquanto a loja não ligar o Mercado Pago.
9. O cliente acompanha o pedido lendo pelo id (get, sem listar): a regra
   do Firestore passa a permitir isso em pedidosEntrada e pedidos. O id é
   aleatório e funciona como senha do pedido.
10. Casa Jambu abre e fecha pela chave em Pedidos, não pelo horário
    (abrirSozinho desligado, decisão dele em 16/10). O horário salvo só
    aparece como "Fecha às" dentro do turno.

## Ainda em aberto

- Tempo estimado de entrega: hoje 25 min mais 4 min por km, numa faixa de
  10 min. Proposta minha, a confirmar quando o painel existir.
