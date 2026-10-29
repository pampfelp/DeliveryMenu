# Cardápio Delivery

Nome do app (decisão dele, 2026-10-15); o repositório continua `DeliveryMenu`.
No ar em https://pampfelp.github.io/DeliveryMenu/ e o que falta está em
[`PLANO.md`](PLANO.md).

App de delivery (cardápio, sacola e pedido) do restaurante do Felipe,
estruturado desde o início para atender vários restaurantes: cada loja tem
os próprios dados, separados das outras.

Ponto de partida: o funcionamento de uma loja pública da plataforma
Cardápio Web, levantado por observação e engenharia reversa em 2026-10-14.
Nome, logo, textos e imagens dela não entram aqui.

## Onde está cada coisa

- `replica/` levantamento de telas, fluxos e lista de recursos
  (`features.csv`), no método de `recriar-app-existente.md` do segundo
  cérebro.
- `rea/ACHADOS.md` o registro da investigação: observação, inferência e
  desconhecido, com a origem de cada achado.

A saída bruta da análise (Evidence do REA, arquivos baixados do site
analisado) fica fora deste repositório, em `C:\rea-alvos\` e
`C:\rea-trabalho\DeliveryMenu\`, porque o repositório é público.

## Stack

HTML, CSS e JavaScript puros, sem build step, Firebase/Firestore e GitHub
Pages, a partir do `boilerplate/` do segundo cérebro.

O serviço de pagamento está publicado na versão 6 do Apps Script, em
29/10/2026 às 13h29, com URL preservada e health `ativo:true`. O projeto de cota
dos acessos privados ao Google foi corrigido; diagnóstico real Firestore/Auth
retornou HTTP 200. Credenciais privadas, rotina de cinco
minutos e registro do App Check Enterprise foram configurados. Firebase Auth
e Firestore continuam no Spark; o adiantamento de R$150 foi recusado.
O OAuth da Casa Jambu foi concluído na interface de produção e o painel
confirmou conta conectada, com recebimentos pausados. Cada empresa conecta
a própria conta no painel, sem criar aplicação ou copiar chaves; o guia está
em [Conectar sua conta](pagamento-online.html). O frontend `abccd2f` foi
publicado no Pages (run 40908990535); dez assets HTTP 200 iguais à fonte.
Um checkout real de R$5 abriu no Mercado Pago em uma loja de homologação
isolada; pagamento, confirmação e devolução ainda não foram concluídos.
A sessão do vendedor apareceu como comprador ("Eu mesmo"), com pagamento
bloqueado. Isso não comprova a causa do bloqueio. O frontend
continua sem build. Estado e testes estão em
[`PAGAMENTOS-APPS-SCRIPT.md`](PAGAMENTOS-APPS-SCRIPT.md).
A alternativa Firebase Functions está documentada em
[`PAGAMENTOS-FIREBASE.md`](PAGAMENTOS-FIREBASE.md), sem deploy.

## Vídeos das pizzas Casa Jambu

Os dez sabores da loja `casa-jambu-delivery` usam os MP4 de
`midias/casa-jambu/`, associados aos ids dos produtos em `midias-video.js`.
Os arquivos foram gerados a partir das fotos e descrições da própria loja.
Outras lojas continuam usando as fotos cadastradas.

Nos cards, o clipe toca sem som em loop quando fica visível. Ao abrir a
pizza, o vídeo tem controles e repetição. A reprodução automática respeita
redução de movimento e economia de dados; a foto permanece como alternativa
se houver falha. Nenhuma geração de IA acontece ao navegar no cardápio.

O banner animado da mesma loja funciona como capa no topo, com a logo de
perfil sobreposta à borda inferior. Usa arquivos próprios para computador
e celular, reprodução silenciosa em loop e botão para pausar. O vídeo
inteiro fica centralizado sobre um fundo desfocado da própria animação,
preservando a marca na proporção larga da capa.

No painel, cada item tem imagem e vídeo independentes. Imagens são
reduzidas no navegador e guardadas no item. Vídeos MP4/WebM de até 10 MB
são enviados apenas ao salvar, para o serviço Apps Script indicado em
`midias-config.js`. `Code.gs` confere o login Firebase e o acesso à loja;
`appsscript.json` usa Drive v3 com escopo `drive.file`, limitado aos
arquivos criados pelo serviço. O Firestore guarda só a referência em
`videoArquivo`; o cardápio carrega o arquivo quando ele fica visível.
Remover o vídeo do item deixa somente a imagem; os arquivos anteriores
permanecem no Drive. O modo de exemplo mantém tudo apenas na página.

## Link com prévia da Casa Jambu

Compartilhar `https://pampfelp.github.io/DeliveryMenu/casa-jambu-delivery.html`.
Essa entrada tem nome e logo em metadados Open Graph no próprio HTML.
Os endereços anteriores continuam abrindo o cardápio e passam a mostrar
o novo endereço na barra do navegador. O painel copia o novo link.

`node gerar-pagina-casa-jambu.mjs` mantém essa entrada igual ao
`index.html`; rodar depois de mudar a estrutura ou versões do início.
A logo da prévia está em `midias/casa-jambu/logo-compartilhar.jpg` e
precisa ser republicada se a identidade da loja mudar. Outras lojas
continuam com seus próprios links e dados.

## Abertura em navegadores móveis

`abrir-cardapio.js` carrega o app e acompanha sua promessa `pronto`, sem
`await` no topo do módulo. Uma falha de importação ou de inicialização
mostra uma mensagem com botão para tentar novamente. Após 20 segundos
sem resposta, a mesma opção aparece; se a leitura terminar depois, o
cardápio abre normalmente.

Na página pública, Firestore usa cache em memória, sem depender do banco
IndexedDB do aparelho. O painel conserva a persistência. Mídias e sacola
também têm alternativas para APIs ausentes em versões antigas do Safari.
Essa compatibilidade precisa ser confirmada no iPhone que apresentou a
falha; teste responsivo em Chromium não equivale a Safari real.

A primeira leitura do cardápio usa a API REST pública do Firestore: loja,
categorias, itens e bairros em paralelo, com paginação de 100 documentos.
Não espera bibliotecas de Auth/banco. O SDK permanece no painel, pedidos
e atualização em tempo real; esta começa depois de montar a tela. Os
dados são buscados no servidor em cada abertura, sem cache de preços.
O carregamento tem oito bolinhas em círculo e Rubik; respeita redução
de movimento e desaparece assim que o cardápio estiver pronto.

A página pública serve a mesma Rubik (pesos 300 a 600) de
`fontes/rubik-latin.woff2`, sem esperar CSS do Google Fonts. Arquivo obtido
da distribuição oficial do Google Fonts; licença em `fontes/Rubik-OFL.txt`.

## Clientes e ofertas individuais

No painel, **Clientes** lista as fichas da própria loja, com filtro de mês,
busca e paginação. O total inclui os clientes registrados nas fichas; pedidos
cancelados não contam como compras do mês. Favoritos, média e último total
usam os pedidos entregues. O total do pedido já contém entrega e desconto.

**Fazer oferta** consulta o histórico completo apenas daquele cliente e usa
os preços atuais do catálogo. O favorito é definido pela quantidade comprada;
as opções mais frequentes e a quantidade habitual compõem a oferta. Um
histórico sem tamanho identificável ou item indisponível exige conferência,
sem substituir opções automaticamente. A entrega exibida é uma estimativa
para o último bairro; o checkout confirma a taxa do novo pedido.

O desconto pode ser em reais ou porcentagem, somente sobre os produtos.
Confirmar cria um cupom individual de um uso e abre a mensagem no WhatsApp,
para o operador enviar. Também aparece um link caso o navegador bloqueie a
janela. A vinculação usa o número informado no cardápio, sem verificação por
SMS, conforme a identificação de cliente já adotada pelo projeto.

As regras do Firestore exigem o telefone e a cesta da oferta (produtos,
opções, quantidades e valores). A criação do pedido e a reserva são atômicas:
dois envios não conseguem reservar o mesmo cupom. Recusar libera a reserva;
aceitar consome o uso uma vez. Telefone do destinatário e id do pedido ficam
nas coleções privadas `ofertasClientes` e `reservasCupons`; o cupom público
contém apenas o hash do vínculo e a cesta permitida.

Prévia fictícia: `painel.html?exemplo=painel#clientes`. Verificações locais
de cálculo e regras: `node rea/verificar-crm.mjs`, com o emulador Firestore
em `127.0.0.1:8080`. O script não aceita endereço de produção.

## Pedidos agendados

Em Configurações, a loja liga **Aceitar pedidos agendados**. A chave começa
desligada. O cliente escolhe na etapa Como receber um horário futuro, de
30 em 30 minutos, dentro dos próximos três dias (72 horas) e do horário de
funcionamento em Belém. Turnos que atravessam a meia-noite são respeitados.
A pausa geral em Pedidos também impede agendamentos.

O horário acompanha a revisão, o pedido, o painel e a ficha do cliente.
Aceitar confirma o agendamento e dá o número ao pedido; o preparo continua
sendo conduzido pela equipe. Não há limite de pedidos por faixa nem
antecedência mínima além de ser um horário futuro: esses valores não foram
definidos. A validação de horário também roda nas regras do Firestore.

`node rea/verificar-agendamento.mjs` verifica a conta dos horários.
Com o Firestore Emulator em `127.0.0.1:8080`, acrescente `--regras` para
conferir também as permissões. Esses testes nunca usam produção.
