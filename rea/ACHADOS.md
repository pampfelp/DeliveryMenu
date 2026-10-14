# Achados: loja de delivery da Cardápio Web, versão servida em 2026-10-14

Alvo: o JavaScript e os dados que `app.cardapioweb.com/<loja>` carrega,
copiados para `C:\rea-alvos\cardapioweb-2026-10-14\` (39 arquivos, 2,6 MB;
hash de cada um em `SHA256SUMS.txt` ali). Respostas da API guardadas em
`C:\rea-trabalho\DeliveryMenu\api\`. Nada disso entra no repositório.

Ferramentas: navegador do Claude Desktop (observação da tela e da lista de
requisições), leitura estática dos arquivos (busca de texto com `grep` e
`node`) e REA 6.4.0 (Node 24.18, Windows dele, via `npx`, autorizado por
ele em 2026-10-14). A 6.5.0 saiu no mesmo dia e não foi usada, porque a
versão fica fixada.

REA, duas rodadas:

- Pasta inteira (35 arquivos JS): `ev_04df32d2...`, 4 min, 50 MB de
  Evidence. Cobertura da aplicação `partial`; semântica truncada; 10.370
  desconhecidos semânticos. A análise semântica do `index-CVhO1mfm.js`
  nem começou (orçamento esgotado), e outros 14 arquivos tiveram a
  semântica cortada.
- Só o `index-CVhO1mfm.js`, com 4 GB de memória: `ev_1398cc6c...`, 4,5
  min. O worker esgotou a memória de novo na análise semântica. Ficaram os
  fatos estáticos: 38 endpoints, 7 usos de armazenamento, 2 registros de
  service worker.

Conclusão prática: num bundle minificado de 1,4 MB, o REA 6.4.0 entrega o
inventário (endpoints, armazenamento, service worker) e não entrega o
rastreio. As respostas de P3 e P5 vieram da leitura direta do código.

Hashes dos arquivos citados abaixo:

| Arquivo | SHA-256 |
|---|---|
| `index-CVhO1mfm.js` | `5224327314c176003f830de35edc5bcb8608f23d0b2602a23c8658db4fa49f4c` |
| `Checkout-Eub9Fc76.js` | `21c1093e0e31e33e695532b319c88c9bcff1ce8e6760bb6c6e8f45e4031c4261` |
| `MainPage-CJiEiEiE.js` | `733ce9f185246b51d74d6059aa3ba1ae06eef13e8ddcdc721ef31ab0fa336b0d` |
| `api/profile.json` | `6a4d5eaee1c816e9a89fab2677fb9ea9a916c36fb944103f77c989adfa50efb9` |
| `api/categories-delivery.json` | `95b02d0fc58441160ff5f68b3e5b26b3f537df169bdb8662c9502129d02cf96a` |

Data: 2026-10-14.

## P1. Como a loja carrega o cardápio?

Status: respondida.

Observação: ao abrir a página saem duas chamadas para a API deles: uma
devolve os dados da loja (busca pelo endereço da loja na URL), outra
devolve categorias com itens e adicionais, filtradas por tipo de pedido. A
segunda só responde com o cabeçalho `company` igual ao endereço da loja;
sem ele volta 404 (testado). O valor do cabeçalho é colocado em
`index-CVhO1mfm.js` (`headers.common.company=...url_name`).

Inferência: uma aplicação só serve todas as lojas, e a loja é escolhida
pelo endereço. O cardápio inteiro vem de uma vez (174 KB nesta loja, 7
categorias, 45 itens) e a busca roda no próprio aparelho.

Desconhecido: se há cache no servidor e de quanto tempo.

Limite: só a loja aberta foi testada.

## P2. Como o preço do item com adicionais é calculado?

Status: respondida.

Observação: em `index-CVhO1mfm.js`, cada grupo de adicionais junta o preço
de cada unidade escolhida numa lista e aplica a regra do grupo: `SUM` soma,
`MEAN` tira a média (duas casas), `MIN` pega o menor, `MAX` pega o maior.
Fora de `SUM`, o valor do grupo é dividido igualmente entre as opções
escolhidas. O preço final do item é o preço base mais o resultado de cada
grupo, vezes a quantidade.

Inferência: `MEAN` e `MAX` são a pizza meio a meio (média dos sabores ou
o sabor mais caro). Nesta loja todos os grupos usam `SUM`.

Desconhecido: como o arredondamento de `MEAN` aparece na tela em casos de
dízima; não foi montado um caso na tela.

## P3. Quando um preço promocional ou um item vale?

Status: respondida.

Observação (`index-CVhO1mfm.js`, perto do caractere 452.300 e 455.300):

- Promoção: vale se o item tem uma linha na agenda para o dia da semana de
  agora. Linha sem início e sem fim vale o dia todo; com os dois, vale de
  `início:00` até `fim:59`, no fuso da loja. Sem agenda nenhuma, a
  promoção não vale.
- Item e categoria com `allowed_times` vazio aparecem sempre. Com
  horários, aparecem se alguma linha for do dia da semana de agora e
  `início <= HH:mm <= fim` (comparação de texto `HH:mm`). Categoria que
  falha esconde todos os itens dela; categoria sem nenhum item visível some.
- Item com promoção ligada fora da agenda aparece com a promoção desligada.
- Uma terceira função procura, nos próximos 7 dias, o próximo início ou
  fim de promoção ou de horário de item.

Inferência: essa terceira função marca quando o cardápio precisa ser
filtrado de novo sem recarregar a página. Uma janela que passa da
meia-noite (22:00 às 02:00) não funciona nessa regra, porque `início <=
agora <= fim` nunca é verdade; a loja precisa dividir em duas linhas.

Desconhecido: quem chama a terceira função; não foi seguido.

## P4. Como sai a taxa de entrega?

Status: parcial.

Observação: `index-CVhO1mfm.js` manda o endereço (rua, número, bairro,
cidade, estado, CEP e coordenadas) para o servidor e recebe tempo
estimado, distância, valor, taxa do entregador, observação e uma situação:
`ok`, `not_found`, `out_of_range`, `out_of_time_range` ou
`info_by_whatsapp`. Cada uma vira uma mensagem ("Endereço Inválido", "No
momento não estamos entregando na sua região", taxa a combinar pelo
WhatsApp). A loja tem uma lista de bairros atendidos.

Inferência: a taxa é decidida no servidor, por bairro ou por distância.

Desconhecido: a regra do servidor. Não dá para ver de fora sem mandar
endereços de teste para a API deles, e isso não foi feito.

## P5. Como funciona o agendamento?

Status: respondida no navegador; em aberto no servidor.

Observação (`index-CVhO1mfm.js`, perto do caractere 1.146.000):

1. Começo = agora + antecedência em horas. Fim = hoje + máximo de dias
   (45 se não houver), à meia-noite.
2. Para cada dia entre os dois: as janelas vêm da data especial, se houver,
   ou da janela daquele dia da semana (a lista vem achatada e é lida de
   dois em dois: início, fim).
3. Cada janela é cortada em faixas do tamanho do intervalo, no formato
   `HH:mm-HH:mm`; a última faixa termina no fim da janela, mesmo se ficar
   menor.
4. Sai a faixa que começa antes da hora do cursor (no primeiro dia, a hora
   de agora + antecedência; nos outros, meia-noite) e a faixa que já tem o
   limite de pedidos. A contagem por data e faixa vem pronta nos dados da
   loja.
5. Dia sem faixa nenhuma não aparece. "Bloquear o mesmo dia" tira hoje; "só
   o próximo dia disponível" deixa só o primeiro dia da lista.

Inferência: a contagem de lotação só é atualizada quando os dados da loja
são carregados de novo, então duas pessoas podem escolher a última vaga ao
mesmo tempo.

Desconhecido: se o servidor confere a lotação no envio ("O horário
escolhido não está disponível" sugere que sim, mas não foi visto).

## P6. O que acontece ao enviar o pedido?

Status: respondida.

Observação: `Checkout-Eub9Fc76.js` manda o pedido para a API deles e monta
uma mensagem de texto com cliente, endereço com link do Google Maps,
agendamento, itens com opções e observação, subtotal, entrega (valor,
"a negociar" ou grátis), taxas, descontos, valor final, pagamento e prazo,
que vai para o WhatsApp da loja. O envio leva um cabeçalho de assinatura
gerado no navegador.

Inferência: o WhatsApp funciona como aviso para a loja, ao lado do
registro no sistema.

Desconhecido: o que a loja vê no painel quando o pedido chega.

Limite: a assinatura do envio é um mecanismo de proteção da API deles. Não
foi reproduzida nem usada, e a chave não está registrada aqui. O app dele
grava o pedido no próprio Firestore e não depende da API da Cardápio Web.

## P7. O que existe além da loja?

Status: respondida para a existência, em aberto para o funcionamento.

Observação: o código traz conta de cliente (telefone, senha, código por
SMS), pedidos pendentes e finalizados, avaliação, fidelidade por pontos,
cashback, notificação push, pedido na mesa ou comanda, e um app de
entregador (pegar pedido por QR Code ou número, despachar, confirmar com
código do cliente, confirmação no iFood).

Desconhecido: as telas e as regras de cada um; só os textos e as chamadas
foram vistos.

## P8. O que o REA achou que a leitura manual não tinha visto?

Status: respondida.

Observação (REA, `ev_1398cc6c...`, fatos estáticos):

- Dois registros de service worker: a loja é instalável como app.
- Armazenamento local: `localStorage` (leitura, escrita e remoção) e
  `sessionStorage`, incluindo a chave `plus_eighteen`, ligada ao aviso de
  item só para maiores.
- Junto do código de horários (leitura manual) aparecem os modos do
  cardápio: só visualização, mesa, balcão, delivery, local, entrega e
  totem, escolhidos por um trecho da URL.

Inferência: a sacola fica no `localStorage`, o que explica ela continuar
depois de recarregar (F23). O aviso de maiores vale só para a aba aberta.

Desconhecido: quais chaves guardam a sacola; o REA registrou a chamada mas
não o nome da chave.

## Checklist

| Pergunta | Status |
|---|---|
| P1 carregamento do cardápio | respondida |
| P2 preço com adicionais | respondida |
| P3 promoção e disponibilidade por horário | respondida |
| P4 taxa de entrega | parcial (regra no servidor deles) |
| P5 agendamento | respondida no navegador; servidor em aberto |
| P6 envio do pedido | respondida |
| P7 recursos além da loja | em aberto |
| P8 achados do REA | respondida |

A investigação não está completa: P4 e P7 seguem abertas, e P5 no lado do
servidor. P4 e P5 não impedem o app dele, porque nele a regra da taxa e a
conferência de lotação vão ser escritas do zero, no Firestore.
