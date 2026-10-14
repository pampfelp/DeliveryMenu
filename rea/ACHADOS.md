# Achados: loja de delivery da Cardápio Web, versão servida em 2026-10-14

Alvo: o JavaScript e os dados que `app.cardapioweb.com/<loja>` carrega,
copiados para `C:\rea-alvos\cardapioweb-2026-10-14\` (39 arquivos, 2,6 MB;
hash de cada um em `SHA256SUMS.txt` ali). Respostas da API guardadas em
`C:\rea-trabalho\DeliveryMenu\api\`. Nada disso entra no repositório.

Ferramentas: navegador do Claude Desktop (observação da tela e da lista de
requisições) e leitura estática dos arquivos (busca de texto com `grep` e
`node`). **O REA ainda não foi rodado**: a análise com
`rea-agents@6.4.0 analyze-javascript-application` espera a aprovação dele
para baixar o pacote.

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

Status: parcial.

Observação: cada item tem `promotional_price_active`, o preço promocional,
os dias em que vale e uma agenda por dia com início e fim. Itens e
categorias têm `allowed_times` (dia, início, fim) e `available_for` (tipos
de pedido).

Inferência: o preço riscado só aparece dentro da agenda.

Desconhecido: a função que decide isso não foi localizada no código; a
regra de virada de meia-noite também não.

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

Status: parcial.

Observação: a loja guarda antecedência mínima em horas, máximo de dias,
intervalo em minutos, limite de pedidos por intervalo, "só o próximo dia
disponível" e a janela de entrega de cada dia. Os textos do código incluem
"O horário escolhido não está disponível" e "Apenas agendamento".

Inferência: os horários oferecidos são os intervalos da janela do dia,
começando depois da antecedência, e somem quando enchem.

Desconhecido: a conta exata dos intervalos e se o limite é conferido no
envio.

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

## Checklist

| Pergunta | Status |
|---|---|
| P1 carregamento do cardápio | respondida |
| P2 preço com adicionais | respondida |
| P3 promoção e disponibilidade por horário | parcial |
| P4 taxa de entrega | parcial |
| P5 agendamento | parcial |
| P6 envio do pedido | respondida |
| P7 recursos além da loja | em aberto |

A investigação não está completa: P3, P4, P5 e P7 seguem abertas.
