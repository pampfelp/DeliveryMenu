import test from "node:test";
import assert from "node:assert/strict";
import { calcularPedido } from "./calcular-pedido.js?v=1";

const agora = new Date("2026-10-26T22:00:00Z"); // segunda, 19h em Belém
const telefone = ["91", "90000", "0000"].join("");
const contexto = () => ({ loja: { aberta: true, aceitaAgendamento: true, bairro: "Centro", local: { lat: -1.45, lng: -48.49 }, horario: Object.fromEntries(["seg", "ter", "qua", "qui", "sex", "sab", "dom"].map((d) => [d, { aberto: true, abre: "18:00", fecha: "23:00" }])) }, itens: [{ id: "pizza", nome: "Pizza atual", preco: 4500, grupos: [] }], bairros: [{ nome: "Centro" }, { nome: "Nazaré", lat: -1.44, lng: -48.49 }] });
const entrada = () => ({ cliente: { nome: " Cliente  Teste ", telefone }, tipo: "entrega", endereco: { rua: "Rua A", numero: "1", bairro: "centro", referencia: "Praça", km: 999 }, itens: [{ itemId: "pizza", escolhas: {}, qtd: 1, nome: "Preço adulterado", total: 1, obs: " sem orégano " }], subtotal: 4500, total: 4800 });
const calcular = (e = entrada(), c = contexto(), data = agora) => calcularPedido(c, e, data);
const falha = (fn, codigo = "VALIDACAO") => assert.throws(fn, (e) => e.codigo === codigo && !!e.message);
const cupom = (dados = {}) => ({ ativo: true, tipo: "valor", valor: 1000, minimo: 0, usos: 0, limite: null, ...dados });

test("recalcula catálogo e entrega, normaliza e não marca pago", () => {
  const p = calcular();
  assert.equal(p.itens[0].nome, "Pizza atual"); assert.equal(p.itens[0].total, 4500); assert.equal(p.itens[0].obs, "sem orégano");
  assert.equal(p.cliente.nome, "Cliente Teste"); assert.equal(p.endereco.bairro, "Centro"); assert.equal(p.endereco.km, 0);
  assert.deepEqual(p.pagamento, { forma: "Mercado Pago", online: true, pago: false }); assert.equal(p.status, "novo");
});
test("ignora taxa, nome e pagamento informados pelo cliente", () => {
  const e = entrada(); e.taxa = 999; e.pagamento = { pago: true }; e.itens[0].resumo = "Outro item";
  const p = calcular(e); assert.equal(p.taxa, 300); assert.equal(p.itens[0].resumo, ""); assert.equal(p.pagamento.pago, false);
});
test("subtotal adulterado exige conferir novamente", () => { const e = entrada(); e.subtotal = 1; falha(() => calcular(e), "PRECO_ALTERADO"); });
test("total adulterado exige conferir novamente", () => { const e = entrada(); e.total = 1; falha(() => calcular(e), "PRECO_ALTERADO"); });
test("mudança do catálogo exige novo consentimento", () => { const c = contexto(); c.itens[0].preco = 4600; falha(() => calcular(entrada(), c), "PRECO_ALTERADO"); });
test("promoção atual é usada", () => { const c = contexto(), e = entrada(); c.itens[0].precoPromo = 4000; e.subtotal = 4000; e.total = 4300; assert.equal(calcular(e, c).subtotal, 4000); });
for (const [regra, adicional] of [["soma", 3000], ["media", 1500], ["menor", 1000], ["maior", 2000]]) {
  test(`preço de grupo usa regra ${regra}`, () => {
    const c = contexto(), e = entrada(); c.itens[0].grupos = [{ id: "sabores", min: 2, max: 2, regraPreco: regra, opcoes: [{ id: "a", nome: "Sabor A", preco: 1000 }, { id: "b", nome: "Sabor B", preco: 2000 }] }];
    e.itens[0].escolhas = { sabores: { a: 1, b: 1 } }; e.subtotal += adicional; e.total += adicional;
    assert.equal(calcular(e, c).subtotal, 4500 + adicional);
  });
}
test("taxa usa distância e coordenadas do catálogo", () => {
  const e = entrada(); e.endereco.bairro = "nazare"; e.endereco.km = 0; e.total = 5000;
  const p = calcular(e); assert.equal(p.taxa, 500); assert.equal(p.endereco.bairro, "Nazaré"); assert.equal(p.endereco.km, 1.1);
});
test("bairro fora da lista é recusado", () => { const e = entrada(); e.endereco.bairro = "Fora"; falha(() => calcular(e)); });
test("distância além do raio é recusada", () => { const c = contexto(), e = entrada(); c.bairros[1].lat = -2; e.endereco.bairro = "Nazaré"; falha(() => calcular(e, c)); });
test("coordenada não finita é recusada", () => { const c = contexto(), e = entrada(); c.bairros[1].lat = NaN; e.endereco.bairro = "Nazaré"; falha(() => calcular(e, c)); });
for (const tipo of ["retirada", "local"]) test(`${tipo} tem taxa zero e dispensa endereço`, () => { const e = entrada(); e.tipo = tipo; e.endereco = null; e.total = 4500; const p = calcular(e); assert.equal(p.taxa, 0); assert.equal(p.endereco, null); });
test("endereço incompleto é recusado", () => { const e = entrada(); delete e.endereco.referencia; falha(() => calcular(e)); });
test("cupom comum desconta apenas produtos", () => { const c = contexto(), e = entrada(); c.cupom = cupom(); e.cupom = "TESTE"; e.total = 3800; const p = calcular(e, c); assert.equal(p.desconto, 1000); assert.equal(p.taxa, 300); });
test("cupom percentual segue arredondamento compartilhado", () => { const c = contexto(), e = entrada(); c.itens[0].preco = 999; c.cupom = cupom({ tipo: "pct", valor: 15 }); e.cupom = "TESTE"; e.subtotal = 999; e.total = 1149; assert.equal(calcular(e, c).desconto, 150); });
for (const [nome, dados] of [["inativo", { ativo: false }], ["vencido", { validoAte: new Date("2026-10-25T23:00:00Z") }], ["mínimo não atingido", { minimo: 5000 }], ["limite consumido", { limite: 1, usos: 1 }], ["último uso reservado online", { limite: 2, usos: 1, reservasOnline: 1 }]]) {
  test(`cupom ${nome} é recusado`, () => { const c = contexto(), e = entrada(); c.cupom = cupom(dados); e.cupom = "TESTE"; e.total = 3800; falha(() => calcular(e, c)); });
}
test("cupom individual exige telefone e cesta atuais", () => {
  const c = contexto(), e = entrada(); c.cupom = cupom({ individual: true, limite: 1, oferta: [{ itemId: "pizza", escolhas: {}, qtd: 1, nome: "Pizza atual", resumo: "", total: 4500 }] }); c.oferta = { telefone }; e.cupom = "TESTE"; e.total = 3800;
  assert.equal(calcular(e, c).cupom, "TESTE"); c.oferta.telefone = "outro"; falha(() => calcular(e, c));
  c.oferta.telefone = telefone; c.cupom.oferta[0].total = 4400; falha(() => calcular(e, c));
});
test("loja pausada recusa pagamento imediato", () => { const c = contexto(); c.loja.aberta = false; falha(() => calcular(entrada(), c)); });
test("fechamento automático usa horário de Belém", () => { const c = contexto(); c.loja.abrirSozinho = true; falha(() => calcular(entrada(), c, new Date("2026-10-26T20:00:00Z"))); assert.equal(calcular(entrada(), c).total, 4800); });
test("agenda aceita horário futuro mesmo fora do turno atual", () => { const c = contexto(), e = entrada(); c.loja.abrirSozinho = true; e.agendadoPara = "2026-10-27T21:00:00Z"; assert.equal(calcular(e, c, new Date("2026-10-26T20:00:00Z")).agendadoPara.toISOString(), "2026-10-27T21:00:00.000Z"); });
test("agenda recusa loja pausada, passado, grade e mais de72h", () => {
  for (const horario of ["2026-10-26T21:00:00Z", "2026-10-27T21:15:00Z", "2026-10-30T21:00:00Z"]) { const e = entrada(); e.agendadoPara = horario; falha(() => calcular(e)); }
  const c = contexto(), e = entrada(); e.agendadoPara = "2026-10-27T21:00:00Z"; c.loja.aberta = false; falha(() => calcular(e, c));
});
test("agenda conserva virada de domingo para segunda", () => { const c = contexto(), e = entrada(); c.loja.horario = { dom: { aberto: true, abre: "18:00", fecha: "02:00" } }; e.agendadoPara = "2026-10-26T03:30:00Z"; assert.ok(calcular(e, c, new Date("2026-10-26T02:30:00Z")).agendadoPara instanceof Date); });
test("produto esgotado ou ausente é recusado", () => { const c = contexto(); c.itens[0].esgotado = true; falha(() => calcular(entrada(), c)); c.itens = []; falha(() => calcular(entrada(), c)); });
test("grupo obrigatório, opção inexistente e esgotada são recusados", () => {
  const c = contexto(), e = entrada(); c.itens[0].grupos = [{ id: "tamanho", tipo: "unica", min: 1, max: 1, opcoes: [{ id: "grande", nome: "Grande", preco: 1000, esgotado: true }] }];
  falha(() => calcular(e, c)); e.itens[0].escolhas = { tamanho: { media: 1 } }; falha(() => calcular(e, c)); e.itens[0].escolhas = { tamanho: { grande: 1 } }; falha(() => calcular(e, c));
});
test("recusa quantidade inválida ou excessiva", () => { for (const qtd of [0, 51, 1.5, Infinity, "1"]) { const e = entrada(); e.itens[0].qtd = qtd; falha(() => calcular(e)); } });
test("recusa observação longa e quantidade inválida de linhas", () => { const e = entrada(); e.itens[0].obs = "a".repeat(501); falha(() => calcular(e)); e.itens = []; falha(() => calcular(e)); e.itens = Array.from({ length: 51 }, () => entrada().itens[0]); falha(() => calcular(e)); });
test("recusa arrays e protótipos estranhos", () => {
  falha(() => calcular([])); const e = entrada(); Object.setPrototypeOf(e, { herdado: true }); falha(() => calcular(e));
  for (const escolhas of [[], { grupo: [] }, JSON.parse('{"__proto__":{}}'), { grupo: { opcao: Infinity } }]) { const a = entrada(); a.itens[0].escolhas = escolhas; falha(() => calcular(a)); }
});
test("recusa nome ou telefone inválidos", () => { const e = entrada(); e.cliente.nome = "a"; falha(() => calcular(e)); e.cliente.nome = "Cliente"; e.cliente.telefone = 123; falha(() => calcular(e)); });
test("recusa preços não finitos ou total fora do limite", () => {
  for (const preco of [NaN, Infinity, -1, 10000001]) { const c = contexto(); c.itens[0].preco = preco; falha(() => calcular(entrada(), c)); }
  const c = contexto(), e = entrada(); c.itens[0].preco = 0; e.tipo = "retirada"; e.subtotal = e.total = 0; falha(() => calcular(e, c));
});
test("não altera entrada ou catálogo", () => { const e = entrada(), c = contexto(), antes = structuredClone({ e, c }); calcular(e, c); assert.deepEqual({ e, c }, antes); });
