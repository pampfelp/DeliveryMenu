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
        preco: 6800,
        precoPromo: 5990,
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
  {
    id: "pizzas",
    nome: "Pizzas",
    itens: [
      {
        id: "pizza-meio",
        nome: "Pizza meio a meio",
        descricao: "35 cm, dois sabores. Vale o preço do sabor mais caro",
        preco: 0,
        fotoUrl: "",
        grupos: [
          {
            id: "sabores", nome: "Sabores", tipo: "somavel", min: 2, max: 2, regraPreco: "maior",
            opcoes: [
              { id: "mussarela", nome: "Mussarela", preco: 4500 },
              { id: "calabresa", nome: "Calabresa", preco: 4800 },
              { id: "frango", nome: "Frango com catupiry", preco: 5500 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "acompanhamentos",
    nome: "Acompanhamentos e bebidas",
    itens: [
      { id: "batata", nome: "Batata média", descricao: "Batata frita crocante, 200 g", preco: 1400, fotoUrl: "", grupos: [] },
      { id: "onion", nome: "Onion rings", descricao: "Anéis de cebola empanados", preco: 1600, fotoUrl: "", grupos: [] },
      {
        id: "refri", nome: "Refrigerante lata", descricao: "350 ml", preco: 600, fotoUrl: "",
        grupos: [
          {
            id: "sabor", nome: "Sabor", tipo: "unica", min: 1, max: 1, regraPreco: "soma",
            opcoes: [
              { id: "cola", nome: "Cola", preco: 0 },
              { id: "guarana", nome: "Guaraná", preco: 0 },
              { id: "cola-zero", nome: "Cola zero", preco: 0 },
            ],
          },
        ],
      },
    ],
  },
];

// Itens oferecidos em "Peça também" na sacola.
export const SUGESTOES = ["batata", "refri", "onion"];

// Sacola das imagens validadas (S01, S08, D01). Só entra com ?exemplo=1 na URL.
export const SACOLA_EXEMPLO = [
  { itemId: "classico", qtd: 1, escolhas: { ponto: { "ao-ponto": 1 }, adicionais: { bacon: 1 } }, obs: "" },
  { itemId: "smash", qtd: 1, escolhas: {}, obs: "Sem picles" },
];
