// Pessoas, telefones e compras fictícios. Nenhuma gravação ou WhatsApp neste modo.
const cats = [{id:"pizzas",nome:"Pizzas"},{id:"acomp",nome:"Acompanhamentos"},{id:"bebidas",nome:"Bebidas"}];
const pizza = (id,nome,preco) => ({id,nome,categoriaId:"pizzas",preco:0,grupos:[{id:"tamanho",nome:"Tamanho",tipo:"unica",min:1,max:1,opcoes:[{id:"grande",nome:"Grande",preco},{id:"media",nome:"Média",preco:preco-1000}]}]});
const itens = [pizza("calabresa","Calabresa",6500),pizza("mussarela","Mussarela",6000),pizza("jambu","Jambu Amazônico",8500),{id:"batata",nome:"Batata média",categoriaId:"acomp",preco:1500,grupos:[]},{id:"coca",nome:"Coca-Cola 2 L",categoriaId:"bebidas",preco:1000,grupos:[]},{id:"guarana",nome:"Guaraná 1 L",categoriaId:"bebidas",preco:1000,grupos:[]}];
const pessoas = [{nome:"Ana Costa",telefone:"91900001023",n:12,media:8990,ultimo:9600,dia:18,pizza:"calabresa",bebida:"coca",acomp:true},
  {nome:"Bruno Lima",telefone:"91900004089",n:4,media:6450,ultimo:6900,dia:29,pizza:"mussarela",bebida:"guarana",setembro:true},
  {nome:"Carla Souza",telefone:"91900002024",n:8,media:10900,ultimo:11200,dia:17,pizza:"jambu",bebida:"guarana",acomp:true},
  ...Array.from({length:39},(_,n) => ({nome:`Cliente ${String(n+4).padStart(2,"0")} de exemplo`,telefone:`9190000${String(n+5000).padStart(4,"0")}`,n:1,media:9600,ultimo:9600,dia:10,pizza:"calabresa",bebida:"coca",setembro:n>=16}))];
const pedidos = pessoas.flatMap((c) => Array.from({length:c.n},(_,n) => ({id:`${c.telefone}-${n}`,cliente:{nome:c.nome,telefone:c.telefone},status:"entregue",tipo:"entrega",endereco:{bairro:"Centro",km:0},criadoEm:new Date(2026,c.setembro?8:9,c.dia,12,n),taxa:600,
  total:n===c.n-1 ? c.ultimo : n===0 ? c.media*c.n-c.ultimo-(c.n-2)*c.media : c.media,
  itens:[{...itens.find((i) => i.id===c.pizza),itemId:c.pizza,qtd:1,total:6500,escolhas:{tamanho:{[c.setembro?"media":"grande"]:1}},resumo:c.setembro?"Média":"Grande"},...(c.acomp?[{itemId:"batata",nome:"Batata média",qtd:1,total:1500,escolhas:{},resumo:""}]:[]),{itemId:c.bebida,nome:itens.find((i) => i.id===c.bebida).nome,qtd:1,total:1000,escolhas:{},resumo:""}]})));
const fichas = pessoas.map((c) => ({nome:c.nome,telefone:c.telefone,pedidos:Object.fromEntries(pedidos.filter((p) => p.cliente.telefone===c.telefone).map((p) => [p.id,p]))}));
export const CRM_EXEMPLO = {cats,itens,pedidos,fichas,mes:"2026-10"};
