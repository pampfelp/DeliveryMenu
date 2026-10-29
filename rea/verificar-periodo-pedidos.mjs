import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const raiz = new URL('../', import.meta.url);
const fonteHelper = await readFile(new URL('periodo-pedidos.js', raiz), 'utf8');
const helper = await import(`data:text/javascript;base64,${Buffer.from(fonteHelper).toString('base64')}`);
const { periodoPedidos, noPeriodo, pedidoVisivel } = helper;
const agora = new Date('2026-10-28T15:00:00Z');
const hoje = periodoPedidos('hoje', agora);
assert.equal(hoje.inicio.toISOString(), '2026-10-28T03:00:00.000Z');
assert.equal(hoje.fim.toISOString(), '2026-10-29T03:00:00.000Z');
for (const fuso of ['Pacific/Auckland', 'America/Los_Angeles', 'UTC']) {
  process.env.TZ = fuso;
  assert.equal(periodoPedidos('hoje', new Date('2026-11-01T02:59:59Z')).de, '2026-10-31');
  assert.equal(periodoPedidos('hoje', new Date('2026-11-01T03:00:00Z')).de, '2026-11-01');
}
assert.equal(periodoPedidos('mes', new Date('2024-02-15T12:00:00Z')).ate, '2024-02-29');
assert.equal(periodoPedidos('passado', new Date('2026-01-15T12:00:00Z')).de, '2025-12-01');
assert.equal(periodoPedidos('passado', new Date('2026-01-15T12:00:00Z')).ate, '2025-12-31');
const noventa = periodoPedidos('90dias', agora);
assert.equal(noventa.de, '2026-07-31');
assert.equal((noventa.fim - noventa.inicio) / 86400000, 90);
const personalizado = periodoPedidos('personalizado', agora, '2025-12-31', '2026-01-01');
assert.equal(personalizado.fim.toISOString(), '2026-01-02T03:00:00.000Z');
assert(noPeriodo(new Date('2026-01-02T02:59:59.999Z'), personalizado));
assert(!noPeriodo(personalizado.fim, personalizado));
assert(noPeriodo(personalizado.inicio, personalizado));
for (const [de, ate] of [['', '2026-01-01'], ['2026-01-01', ''], ['2026-02-30', '2026-03-01'], ['2026-02-01', '2026-01-01']]) {
  assert.throws(() => periodoPedidos('personalizado', agora, de, ate));
}
const pedido = (id, criadoEm, extra = {}) => ({ id, criadoEm: new Date(criadoEm), status: 'preparo', subtotal: 1000, total: 1000, ...extra });
const agendado = pedido('agenda', '2026-10-27T15:00:00Z', { agendadoPara: new Date('2026-10-29T15:00:00Z') });
assert(pedidoVisivel(agendado, hoje));
assert(!pedidoVisivel(agendado, periodoPedidos('personalizado', agora, hoje.de, hoje.ate)));
assert(!pedidoVisivel(pedido('antigo', '2026-10-20T15:00:00Z', { agendadoPara: agendado.agendadoPara }), hoje));

// Executa o módulo real com Firestore e DOM pequenos, sem rede nem dados reais.
const elementos = new Map();
const elemento = (id) => {
  if (!elementos.has(id)) elementos.set(id, { textContent: '', innerHTML: '', value: '', hidden: false, classList: { add() {}, remove() {}, toggle() {} } });
  return elementos.get(id);
};
const ouvintes = [], eventos = new Map();
let sons = 0;
const ambiente = {
  ...helper, db: {},
  document: { getElementById: elemento, querySelectorAll: () => [], body: elemento('body'),
    addEventListener: (tipo, fn) => eventos.set(tipo, fn), removeEventListener: (tipo) => eventos.delete(tipo) },
  collection: (...args) => ({ caminho: args.slice(1).join('/') }), doc: (...args) => ({ caminho: args.slice(1).join('/') }),
  query: (ref, ...filtros) => ({ ...ref, filtros }), where: (campo, operador, valor) => ({ campo, operador, valor }), orderBy: (campo) => ({ ordem: campo }),
  Timestamp: { fromDate: (d) => d },
  onSnapshot: (consulta, sucesso, erro) => { const o = { consulta, sucesso, erro, parado: false }; ouvintes.push(o); return () => { o.parado = true; }; },
  pintarIcones() {}, esc: (v) => String(v), fmtMoeda: (v) => String(v), textoAgendamento: () => 'data agendada',
  setInterval: () => 1, clearInterval() {}, toast() {},
  AudioContext: class { constructor() { sons++; } createOscillator() { throw new Error('som simulado'); } },
};
let fonte = await readFile(new URL('pedidos.js', raiz), 'utf8');
fonte = fonte.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*$/gm, '').replace(/export function /g, 'function ');
const modulo = new Function(...Object.keys(ambiente), `${fonte}\nreturn { iniciarPedidos, pararPedidos, escolherPeriodo, P, todos };`)(...Object.values(ambiente));
const snap = (lista) => ({ docs: lista.map(({ id, ...p }) => ({ id, data: () => p })) });
modulo.iniciarPedidos({ id: 'teste', nome: 'Teste', fichasV1: true });
modulo.P.agora = () => agora;
modulo.escolherPeriodo('hoje');
const entrada = ouvintes.find((o) => o.consulta.caminho.endsWith('/pedidosEntrada'));
let consulta = ouvintes.at(-1);
assert.equal(consulta.consulta.filtros[0].operador, '>=');
assert.equal(consulta.consulta.filtros[1].operador, '<');
assert.equal(consulta.consulta.filtros[1].valor.toISOString(), hoje.fim.toISOString());
const atual = pedido('atual', '2026-10-28T15:00:00Z');
consulta.sucesso(snap([atual, agendado, pedido('ontem', '2026-10-27T15:00:00Z')]));
entrada.sucesso(snap([pedido('novo', '2026-10-28T16:00:00Z')]));
assert.equal(modulo.todos().length, 3, 'Hoje mantém novos, pedidos e agendados');
assert.equal(elemento('k-qtd').textContent, 2, 'KPI usa a criação de hoje');
assert.match(elemento('k-qtd-ontem').textContent, /ontem/);
modulo.escolherPeriodo('passado');
assert(consulta.parado);
const historico = ouvintes.at(-1);
assert.equal(historico.consulta.filtros[0].valor.toISOString(), '2026-09-01T03:00:00.000Z');
assert.equal(historico.consulta.filtros[1].valor.toISOString(), '2026-10-01T03:00:00.000Z');
consulta.sucesso(snap([atual]));
consulta.erro(new Error('erro atrasado'));
assert.equal(modulo.P.pedidos.length, 0, 'Snapshot atrasado não troca os dados');
assert.equal(modulo.P.erroPeriodo, '', 'Erro de consulta antiga também é ignorado');
const antigos = Array.from({ length: 5 }, (_, i) => pedido(`antigo-${i}`, '2026-09-10T15:00:00Z', { status: 'entregue' }));
historico.sucesso(snap(antigos));
assert.equal(modulo.todos().length, 5, 'Entradas de hoje não vazam no histórico');
assert.equal(elemento('k-qtd').textContent, 5);
assert.equal(elemento('k-qtd-ontem').textContent, '');
assert.match(elemento('quadro').innerHTML, /do período/);
assert.match(elemento('quadro').innerHTML, /10\/09\/2026/);
const totalOuvintes = ouvintes.length;
modulo.escolherPeriodo('personalizado', '', '2026-10-01');
assert.equal(ouvintes.length, totalOuvintes, 'Filtro inválido não troca consulta válida');
assert.equal(modulo.P.periodo.tipo, 'passado');
assert(!historico.parado);
entrada.sucesso(snap([pedido('novo', '2026-10-28T16:00:00Z'), pedido('novo-2', '2026-10-28T17:00:00Z')]));
assert.equal(sons, 1, 'Alerta de entrada permanece no histórico');
assert.equal(modulo.todos().length, 5);
historico.erro(new Error('offline'));
assert.equal(elemento('k-qtd').textContent, '—');
assert.match(elemento('periodo-aviso').textContent, /Não foi possível/);
modulo.pararPedidos();
assert(ouvintes.every((o) => o.parado), 'Todos os listeners encerram ao sair');
historico.sucesso(snap([atual]));
assert.equal(modulo.P.pedidos.length, 5, 'Snapshot após sair é ignorado');
assert.equal(eventos.size, 0);
modulo.iniciarPedidos({ id: 'outra', nome: 'Outra', fichasV1: true });
entrada.sucesso(snap([atual]));
assert.equal(modulo.P.entrada.length, 0, 'Entrada da sessão anterior é ignorada');
assert.equal(modulo.P.periodo.tipo, 'hoje');
assert.equal(ouvintes.filter((o) => !o.parado).length, 3, 'Reinício mantém apenas os três listeners necessários');
for (const tipo of ['mes', '90dias']) {
  const anterior = ouvintes.findLast((o) => !o.parado && o.consulta.caminho.endsWith('/pedidos'));
  eventos.get('click')({ target: { closest: (seletor) => seletor === '[data-periodo]' ? { dataset: { periodo: tipo } } : null } });
  const esperado = periodoPedidos(tipo, modulo.P.agora());
  const filtro = ouvintes.at(-1).consulta.filtros;
  assert.equal(filtro[0].valor.toISOString(), esperado.inicio.toISOString());
  assert.equal(filtro[1].valor.toISOString(), esperado.fim.toISOString());
  assert(anterior.parado);
}
elemento('periodo-de').value = '2026-01-31'; elemento('periodo-ate').value = '2026-02-01';
let preveniu = false;
const antesPersonalizado = ouvintes.at(-1);
eventos.get('submit')({ target: { id: 'filtro-periodo' }, preventDefault: () => { preveniu = true; } });
assert(preveniu);
assert(antesPersonalizado.parado);
assert.equal(ouvintes.at(-1).consulta.filtros[0].valor.toISOString(), '2026-01-31T03:00:00.000Z');
assert.equal(ouvintes.at(-1).consulta.filtros[1].valor.toISOString(), '2026-02-02T03:00:00.000Z');
assert.equal(ouvintes.filter((o) => !o.parado).length, 3);
modulo.pararPedidos();
console.log('Períodos: limites de Belém, calendário, 90 dias, datas inválidas e integração dos listeners/KPIs/quadro passaram.');
