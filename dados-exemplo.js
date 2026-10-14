/*
  Dados de exemplo da loja, com o mesmo formato que vai sair do Firestore.
  Servem para montar as telas antes do banco existir. Dinheiro em centavos.
*/

export const LOJA = {
  id: "loja-exemplo",
  slug: "nome-do-restaurante",
  nome: "Nome do Restaurante",
  cidade: "Belém - PA",
  cor: "#991b1b",
  logoUrl: "",
  situacao: { aberta: true, texto: "Aberto agora • Fecha às 23h00" },
};

export const CATEGORIAS = [
  {
    id: "burgers",
    nome: "Burgers",
    itens: [
      {
        id: "classico",
        nome: "Clássico da Casa",
        descricao: "Pão brioche, blend de 160 g, queijo prato, alface, tomate e molho especial da casa",
        preco: 2700,
        selo: "recomendado",
        destaque: true,
        fotoUrl: "",
        grupos: [
          {
            id: "ponto", nome: "Ponto da carne", tipo: "unica", min: 1, max: 1, regraPreco: "soma",
            opcoes: [
              { id: "ao-ponto", nome: "Ao ponto", preco: 0 },
              { id: "bem-passado", nome: "Bem passado", preco: 0 },
            ],
          },
          {
            id: "adicionais", nome: "Adicionais", tipo: "somavel", min: 0, max: 5, regraPreco: "soma",
            opcoes: [
              { id: "bacon", nome: "Bacon", preco: 400 },
              { id: "cheddar", nome: "Cheddar extra", preco: 300 },
              { id: "ovo", nome: "Ovo", preco: 250, esgotado: true },
            ],
          },
        ],
      },
      {
        id: "combo-dupla",
        nome: "Combo Dupla",
        descricao: "2 burgers, batata média e refrigerante 1 L",
        preco: 5990,
        selo: "oferta",
        destaque: true,
        fotoUrl: "",
        grupos: [],
      },
      {
        id: "bacon-duplo",
        nome: "Bacon Duplo",
        descricao: "Dois blends, bacon e cheddar",
        preco: 3400,
        selo: "novo",
        destaque: true,
        fotoUrl: "",
        grupos: [],
      },
      {
        id: "smash",
        nome: "Smash Simples",
        descricao: "Blend de 90 g prensado na chapa, queijo prato e picles",
        preco: 2400,
        precoPromo: 1990,
        fotoUrl: "",
        grupos: [],
      },
      {
        id: "costela",
        nome: "Costela Desfiada",
        descricao: "Blend de 160 g, costela desfiada e cebola crispy",
        preco: 3600,
        esgotado: true,
        fotoUrl: "",
        grupos: [],
      },
    ],
  },
];

export const SUGESTOES = [
  { id: "batata", nome: "Batata média", preco: 1400 },
  { id: "refri", nome: "Refrigerante lata", preco: 600 },
  { id: "onion", nome: "Onion rings", preco: 1600 },
];

// Sacola das telas S01 e S08: o Clássico com bacon e um Smash em promoção.
export const SACOLA_EXEMPLO = [
  { itemId: "classico", nome: "Clássico da Casa", qtd: 1, resumo: "Ao ponto, 1 bacon", total: 3100 },
  { itemId: "smash", nome: "Smash Simples", qtd: 1, resumo: "Sem picles", total: 1990, promo: true },
];
