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
`midias/casa-jambu/`, associados aos ids dos produtos em `videos-pizza.js`.
Os arquivos foram gerados a partir das fotos e descrições da própria loja.
Outras lojas continuam usando as fotos cadastradas.

Nos cards, o clipe toca sem som em loop quando fica visível. Ao abrir a
pizza, o vídeo tem controles e repetição. A reprodução automática respeita
redução de movimento e economia de dados; a foto permanece como alternativa
se houver falha. Nenhuma geração de IA acontece ao navegar no cardápio.

O banner animado da mesma loja aparece antes das categorias, com arquivos
próprios para computador e celular, reprodução silenciosa em loop e
controles para pausar. O enquadramento preserva a marca completa.
