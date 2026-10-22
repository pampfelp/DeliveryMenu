# CRM de clientes — decisões de 22/10/2026

Composição aprovada por Felipe no chat: PD70, P70 e PD71. Estado atual:
implementação em andamento, ainda não publicada.

Esqueleto HTML montado em telas/maquete/PD70-clientes-esqueleto.html.
Conferido no navegador em 1440 x 900 e 390 x 844, com lista, cartões e
abertura/fechamento da oferta. Sem erro ou aviso no console, sem rolagem
lateral na largura móvel. Capturas em telas/verificacao-crm/. Felipe autorizou seguir e publicar após o commit d3089ad. As camadas
visuais e o fluxo foram implementados; a prévia continua fictícia e sem
emissão. O painel autenticado emite cupom e abre a mensagem para o humano enviar.

## Requisitos confirmados

- Total de clientes, clientes com pedido no mês e clientes sem pedido no mês.
- Favoritos de pizza/sabor, acompanhamento e bebida por cliente.
- Média e último total, ambos incluindo entrega, com pedidos concluídos/entregues.
- Desconto informado antes da mensagem. A entrega não recebe desconto, conforme decisão de 16/10.
- Cupom individual de um uso, somente para o pedido favorito (itens, variações e quantidades).
- Após confirmar, abrir o WhatsApp com cupom, descrição e link do cardápio. O humano envia.

## Fontes existentes

ficha-cliente.js registra nome e resumo de pedidos em clientes/{telefone};
a lista era bloqueada até para o dono. Esses resumos já contêm o total com
entrega, a data e a situação, mas não preservam detalhes de opções.
Pedidos completos ficam em pedidos/{id}, acessíveis somente à administração
para consultas. O pedido novo ainda não tem itemId/escolhas: será enriquecido.

## Implementação

Ler as fichas existentes em páginas, uma vez por sessão, e acompanhar somente
alterações posteriores; não varrer todos os pedidos a cada abertura. Reusar o
catálogo já ouvido pelo painel. Ler pedidos completos só do cliente escolhido
para a oferta e resolver detalhes sem adivinhar tamanho/preço.
Não copiar endereço nem dados de oferta para a ficha pública.

Cupom público contém produtos/valores permitidos e hash do destinatário;
vínculo do telefone e registro de emissão ficam privados. Reserva de uso e
pedido são gravados atomicamente; o servidor verifica destinatário e conteúdo.
A recusa libera a reserva; o aceite consome o uso. A validação precisa impedir
corrida de dois envios e aceite duplicado.

## Isolamento

A área de usuários do painel está em trabalho paralelo. Este CRM usa o worktree
C:/Users/Camille Oliveira/.codex/worktrees/deliverymenu-clientes-crm e a branch
codex/clientes-crm. O criador de worktree do app não aceitou o repositório
porque o chat está em Projetos (pai); criado com Git, sem alterar o checkout
principal. Integrar a versão mais recente de usuários antes de publicar.

## Prévia visual

Ferramenta: image_gen integrado, sem API Gemini ou geração de vídeo.
Referência: telas/PD10-pedidos.png. Artefatos aprovados: PD70-clientes-crm.png,
P70-clientes-crm.png, PD71-oferta-cliente.png. As imagens usam apenas dados
fictícios. Instruções: seguir Rubik, vermelho #991b1b, fundo #f3f4f6, cards brancos,
raios discretos e ícones de contorno. Lista PC com 42/18/24, favoritos e valores;
mobile reorganizado em cartões; oferta individual com subtotal 90, entrega 6,
desconto 10 e total 86, cupom ANA10JAMBU, um uso e itens exatos da oferta.


## Verificação de 22/10

- Base integrada por fast-forward até d3089ad, incluindo usuários e serviço de vídeo.
- 54 verificações locais passaram: finanças com entrega, cancelados, virada de
  mês em Belém, preços dos quatro modos de opções, legado por nome/tamanho,
  separação entre lojas, vínculo privado e reserva de uso simultâneo.
- Fluxo pela interface no emulador: emitir desconto R$ 10, aplicar na cesta de
  R$ 90, taxa R$ 6, total R$ 86; aceitar em duas abas gerou apenas #1001 e usos=1.
  Entregar atualizou 12 para 13 compras, média R$ 89,90 para R$ 89,60 e último
  total R$ 86. O pedido em preparo não alterou a média.
- Busca, filtro sem resultados, mês de setembro/outubro, percentual inválido
  101 e válido 20 (total R$ 78), Escape e retorno ao botão de origem conferidos.
- Sem console de erro no fluxo; 390 px sem rolagem lateral. Capturas salvas em
  telas/verificacao-crm. O acabamento preserva o menu Usuários do commit novo,
  usa seletor de mês nativo e mensagem detalhada com entrega estimada. A janela
  tem rolagem interna quando a altura não comporta o conteúdo.
- verificar-projeto: zero falhas, dois avisos (telefones fictícios/públicos e
  ausência de parâmetro de nomes). verificar-pwa não executou: puppeteer-core
  ausente neste checkout; nenhuma mudança de instalação/PWA nesta tarefa.
- Regras compiladas e publicadas pelo Firebase CLI no projeto
  cardapio-delivery-ae048. Nenhum pedido, cupom ou cadastro fictício em produção.
- Catálogo público real consultado uma vez: dez pizzas e cinco categorias;
  inclui Sabores da Amazônia na classificação. Não consultou dados pessoais.

Não verificado em aparelho real: Safari/iPhone. Emissão/resgate foram verificados
no emulador; nenhuma mensagem foi enviada pelo WhatsApp. A comparação automatizada
com as imagens não prova equivalência de pixels: tamanhos e conteúdo dos estados
são diferentes. As capturas e diferenças estão guardadas para inspeção.

Recusa pela interface também conferida: pedido recusa-ui ficou cancelado,
reserva RECUSACRM passou a 404 e o cupom permaneceu com usos=0.
