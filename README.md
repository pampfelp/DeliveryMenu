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
`midias-config.js`. `Code.gs` confere o login Firebase e o dono da loja;
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
