# Design do DeliveryMenu

O app não tem design system próprio. A base é o visual da loja da Cardápio
Web observada em 2026-10-14, medido no navegador e gravado em
[`tokens.json`](tokens.json). Decisões do Felipe em 2026-10-14:

- **Cor principal: vermelho escuro, editável.** O padrão é `#991b1b`. Cada
  loja troca a sua no painel, e a cor fica nos dados da loja, não no CSS.
- **Fonte: a mesma do original, Rubik.** Licença SIL OFL 1.1, conferida no
  repositório `google/fonts` (`ofl/rubik/OFL.txt`) em 2026-10-14.
- **Logo, imagens e ícones da loja: cada restaurante coloca os seus pelo
  próprio aplicativo.** Nada do original entra.

## O que mudou em relação ao original, e por quê

Cinco cores do original não passam no contraste mínimo (WCAG AA: 4,5:1 para
texto, 3:1 para borda de campo), medidas com `contrast.py`. Elas foram escurecidas e mantêm o mesmo
tom:

| Papel | Original | Aqui | Uso |
|---|---|---|---|
| success | `#16a34a` (3,3:1) | `#15803d` (5,0:1) | preço em promoção |
| info | `#2563eb` sobre `#dbeafe` (4,2:1) | `#1d4ed8` (5,5:1) | selo "recomendado" |
| warning | `#eab308` (1,9:1) | `#a16207` (4,9:1) | aviso de horário, "em falta" |
| text-muted | `#6b7280` sobre `#f4f5f7` (4,4:1) | `#666d7a` (4,8:1) | texto secundário |
| border-input | borda a 12% de preto (1,3:1) | `#6b7280` (4,8:1) | borda de campo |

## O que fica para quando a cor for editável

Quando a loja escolher uma cor clara (um amarelo, por exemplo), o texto
branco em cima dela deixa de ser legível. O painel precisa conferir o
contraste na hora de salvar a cor e trocar `on-accent` para preto quando o
branco não passar. Isso vale para o recurso F51.

## Ícones da interface

Carrinho, casa, lupa, setas e afins não são da loja: são da interface do
app. A sugestão é um conjunto aberto em SVG inline (crença 5). A escolha do
conjunto ainda está aberta.
