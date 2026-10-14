# DeliveryMenu

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
