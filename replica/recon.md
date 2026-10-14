# Recon: loja de delivery da plataforma Cardápio Web

Levantamento de 2026-10-14, feito numa loja pública da plataforma (uma
hamburgueria de Belém, endereço `app.cardapioweb.com/<loja>`). Nome, logo,
textos, fotos e preços dessa loja **não** entram neste repositório. Daqui
só sai o funcionamento.

Fontes, separadas como manda a crença 24:

- **Visto na tela**: navegador do Claude Desktop, 390 x 844 px, sem conta.
- **Lido no código**: os arquivos JavaScript que a página carrega, baixados
  para `C:\rea-alvos\cardapioweb-2026-10-14\` (fora do repositório, com os
  hashes em `SHA256SUMS.txt`). Ver [`../rea/ACHADOS.md`](../rea/ACHADOS.md).
- **Não observado**: o painel do restaurante, que fica atrás de login. O
  que está escrito sobre ele é dedução a partir dos dados que a loja
  pública recebe.

Nenhum pedido foi enviado. O percurso parou na tela de telefone, antes de
qualquer dado pessoal.

## Telas

| Id | Tela | Fonte | O que tem |
|---|---|---|---|
| S00 | Carregamento | vista | Tela inteira na cor da loja com um indicador no centro |
| S01 | Início da loja | vista | Topo na cor da loja, logo redondo, nome, cidade, "Mais informações", situação ("Apenas agendamento • Abrimos às 18h00"); faixa "Calcular taxa e tempo de entrega"; seletor de categorias e lupa; Destaques em faixa horizontal; categorias em lista; barra inferior Início, Promoções, Pedidos e Perfil; com item na sacola aparece a barra "Ver sacola" com contador e total |
| S02 | Promoções | vista | Janela central que abre sozinha ao entrar (e pela aba Promoções); cards com preço novo em verde, preço antigo riscado e porcentagem |
| S03 | Busca | código | Campo "Pesquise por um produto", "Limpar", "Nenhum produto encontrado", "Ver todos os produtos" |
| S04 | Produto | vista | Foto grande no topo, nome, descrição, preço; grupos de adicionais com regra ("Escolha de 1 a 3 opções"), contador `0/1`, selo OBRIGATÓRIO, opção "EM FALTA", rádio para escolha única e `- 1 +` para quantidade; cabeçalho fixo com nome e X ao rolar; rodapé fixo com quantidade e "Adicionar R$ total" |
| S05 | Mais informações: Sobre | vista | Logo, Instagram, contato (WhatsApp e telefone), endereço |
| S06 | Mais informações: Horário | vista | Um dia por linha, com o dia de hoje destacado |
| S07 | Mais informações: Pagamento | vista | Dinheiro, Pix, cartão de crédito, cartão de débito, cada um com ícone |
| S08 | Sacola | vista | "Sua sacola", LIMPAR, item com adicionais escolhidos em cinza, Editar e Remover, "Adicionar mais itens", "Peça também" em faixa horizontal, subtotal, taxa de entrega ("A definir"), total, "Tem um cupom?", botão "Continuar pedido" |
| S09 | Telefone | vista | "Informe seu número de telefone", campo com máscara `(00) 90000-0000`, CONFIRMAR. A aba Perfil abre a mesma tela |
| S10 | Seus pedidos | vista | Sem conta: "Identifique-se" e ENTRAR. Com conta (código): pendentes e finalizados, e os finalizados só depois da senha |
| S11 | Como receber | código | "Como você quer receber o pedido?": entrega, retirada, consumo no local |
| S12 | Endereço | código | CEP ("BUSCAR CEP", "Não sei meu CEP"), rua, número, bairro, complemento, ponto de referência, "USAR MINHA LOCALIZAÇÃO", conferência no mapa, endereços salvos |
| S13 | Agendamento | código | "Agendar pedido", data, intervalo, "Confirmar agendamento", "Remover agendamento" |
| S14 | Pagamento | código | Pagar na entrega ou online; uma ou duas formas; troco ("Troco pra quanto?"); bandeira do cartão |
| S15 | Confirmação | código | Resumo, observação, "Enviar pedido", "Enviando pedido" |
| S16 | Pedido enviado | código | "Pedido enviado com sucesso", "Acompanhar meu pedido", aguardando Pix |

## Fluxos

```
F-A Cliente faz um pedido de entrega
    S01 -> S04 (escolhe adicionais) -> Adicionar -> S01 com barra
    -> S08 -> Continuar pedido -> S09 telefone -> nome (primeira vez)
    -> S11 entrega -> S12 endereço -> taxa e tempo -> S13 agendamento (se a
    loja só agenda) -> S14 pagamento -> S15 -> Enviar -> S16
    + mensagem pronta para o WhatsApp da loja
    caminho feliz observado até S09: 7 toques (fechar promoções, produto,
    2 adicionais obrigatórios, Adicionar, Ver sacola, Continuar pedido)
    borda: item esgotado, adicional obrigatório faltando, endereço fora da
    área, loja fechada, horário de agendamento que acabou de lotar, cupom
    inválido, rede caindo no envio

F-B Cliente confere taxa antes de escolher
    S01 -> Calcular taxa e tempo de entrega -> S12 -> volta para S01 com a taxa

F-C Cliente acompanha o pedido
    S10 -> telefone -> senha -> pendentes e finalizados -> avaliar
```

## Modelo de dados que a loja pública recebe

Só os nomes dos campos e o tipo, sem os valores da loja analisada.

**Loja** (`profile`): id, nome, `url_name` (o endereço da loja), cor,
endereço e coordenadas, WhatsApp de pedidos, fuso, tempo de preparo, logo,
`business_hours` (intervalos por dia da semana, datas especiais,
fechamento temporário com fim), formas de pagamento (tipo, taxa fixa ou
percentual, bandeiras, se aceita no primeiro pedido), `flags` (entrega,
retirada, consumo no local, agendamento, envio pelo WhatsApp, esconder
status do pedido, ponto de referência obrigatório, mostrar janela de
promoções e outras), bairros atendidos, configuração de agendamento
(antecedência em horas, dias máximos, intervalo em minutos, pedidos por
intervalo, só o próximo dia disponível, janela de entrega por dia), pedido
mínimo, entrega grátis a partir de, cupons, programa de fidelidade.

**Categoria**: id, nome, descrição, posição, imagem, status, horários
permitidos, itens.

**Item**: id, nome, descrição, preço, preço promocional ativo, preço
promocional e a agenda dele (dias e horários), destaque, selo
(`recommended`, `offer`), status (`ACTIVE`, `MISSING` = esgotado), estoque
com controle ligado ou não, para quais tipos de pedido vale, horários
permitidos, esconder observação, só maiores de idade, tipo (`regular_item`,
combo), imagem e miniatura, grupos de adicionais, etapas de combo.

**Grupo de adicionais**: nome, mínimo, máximo, tipo de escolha (`SINGLE`,
`MULTIPLE`, `SUMMABLE`), regra de preço (`SUM`, `MEAN`, `MIN`, `MAX`),
opções (nome, preço, estoque, status, quantidade máxima).

**Pedido** (lido no código do checkout): tipo (`delivery`, `takeout`,
`onsite`, mesa), itens (quantidade, preço, observação, opções escolhidas,
itens do combo, pago com pontos), endereço, data e período agendados, taxa
de entrega, taxa da maquininha, taxa adicional, descontos, valor final,
formas de pagamento com valores e troco, tempo estimado.

## O que não dá para recriar só olhando

- Como a taxa de entrega é calculada: acontece no servidor deles (por
  bairro ou por distância, não dá para saber de fora). No app dele, a regra
  vai ser escrita do zero.
- O painel do restaurante inteiro (F47 a F49).
- Pagamento online: depende de contratar um provedor.

## Tamanho

L (um trimestre) para tudo; M para a primeira fatia que roda de ponta a
ponta (cardápio, sacola, checkout com envio pelo WhatsApp e um painel
mínimo de pedidos e cardápio). Estimativa, não medida.
