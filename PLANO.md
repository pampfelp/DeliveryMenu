# Plano do DeliveryMenu

Atualizado em 2026-10-14. A lista de recursos com o andamento de cada um
está em [`replica/features.csv`](replica/features.csv) (rode
`parity.py` para a nota). As decisões e o histórico do dia ficam no
relatório `Relatórios Claude/DeliveryMenu - 2026-10-14.txt`.

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

Depende dele: criar o projeto no Firebase e colar a configuração pública
(passo a passo em `segundo-cerebro/padroes/conectar-firebase.md`).

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
- Taxa e tempo de entrega. O original calcula no servidor e a regra não é
  visível. Proposta: tabela por bairro preenchida no painel, com "não
  entregamos" para bairro fora da lista. **Decisão dele.**
- Pedido mínimo, entrega grátis a partir de um valor, cupom.
- Mensagem pronta para o WhatsApp da loja (P6).

### Fase 4. Painel do restaurante

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

Depende dele: escolher e contratar o provedor (Mercado Pago, Asaas,
Pagar.me ou outro) e criar a conta.

- A chave do provedor fica no Apps Script (`Code.gs`), nunca no navegador
  (crença 13).
- Pix: QR Code e copia e cola na tela de espera; o pedido só vai para a
  cozinha quando o provedor confirma.
- O aviso de pagamento do provedor é tratado sem duplicar pedido
  (`padroes/desenhar-api-e-apps-script.md`, idempotência).

### Fase 6. Telas que ainda não têm imagem

Cada uma passa pelo fluxo de imagem primeiro antes de virar código: mais
informações da loja; promoções; pedidos e conta do cliente (entrada por
telefone); lista de categorias aberta; cálculo de taxa antes do checkout;
escolha do horário agendado; revisão do pedido e troco; espera do Pix; loja
fechada.

### Fase 7. Instalável e lançamento

- Ícones, nome no `manifest.json`, service worker e `verificar-pwa.mjs`
  (crença 39).
- Política de privacidade e termos (`padroes/checklist-legal-basico.md`),
  porque o app guarda telefone e endereço.
- Domínio próprio, se ele quiser. Título e imagem de compartilhamento.
- `sweep.py` sem resquício do original antes de divulgar.

## Decisões que ele precisa tomar

1. Projeto do Firebase: criar agora ou quando o painel começar.
2. Taxa de entrega: tabela por bairro (proposta) ou por distância.
3. Provedor de pagamento online.
4. Logo sem logo enviado: hoje aparece "SEU LOGO"; trocar pelas iniciais?
5. Nome do app para o ícone e para o link (hoje "DeliveryMenu").
