import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import vm from 'node:vm';

const fonte = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const acompanhamento = (fonte.slice(fonte.indexOf('let pararAcomp ='), fonte.indexOf('async function acompanhar(id)'))
  + fonte.slice(fonte.indexOf('function mensagemResumo('), fonte.indexOf('function renderPagamentoPendente(')))
  .replace('await import("./firebase-init.js?v=3")', 'await importarFirebase()')
  .replace('await import(FIRESTORE)', 'await importarFirestore()');
const cards = fonte.slice(fonte.indexOf('const SITUACAO ='), fonte.indexOf('// pedidos de exemplo'));
const leitura = fonte.slice(fonte.indexOf('async function lerFicha('), fonte.indexOf('async function renderPedidos('))
  .replaceAll('await import("./firebase-init.js?v=3")', 'await importarFirebase()')
  .replaceAll('await import(FIRESTORE)', 'await importarFirestore()');
const roteamento = fonte.slice(fonte.indexOf('function irParaHash()'), fonte.indexOf('window.addEventListener("hashchange"'));
const hash = '0123456789abcdef', outro = 'fedcba9876543210';
const telefoneFicticio = '00000000000';
const resumo = { numero: 123, status: 'preparo', criadoEm: new Date('2026-10-28T15:00:00Z'),
  tipo: 'entrega', total: 4200, itens: [{ qtd: 2, nome: '<script>teste</script>' }] };
const elemento = { innerHTML: '' }, esc = (v) => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function ambiente() {
  const leituras = [], ouvintes = [], gravacoes = [], rotas = [];
  let ficha = { pedidos: { [hash]: resumo } }, falhaImport = false, liberarImport = null, pendurarImport = false;
  const c = {
    Date, Intl, SLUG: 'loja-teste', LOJA: { id: 'loja-teste', aberta: true }, STATE: { cliente: { telefone: telefoneFicticio }, sacola: [] },
    location: { hash: `#pedido/resumo/${hash}` }, document: { body: { dataset: {} }, getElementById: () => elemento, querySelectorAll: () => [] },
    window: { scrollTo() {} }, history: { replaceState() {} }, pc: { matches: false }, CHECKOUT: [], ABAS: [],
    esc, reais: (v) => `VALOR:${v}`, quando: (v) => v instanceof Date ? v : v?.toDate?.(), quandoFoi: () => 'data real',
    pintarIcones() {}, fecharInfo() {}, agenda: { fechar() {} }, sincronizarVideos() {},
    meusPedidos: () => [], chavePedido: async () => outro, pagamentoDisponivel: () => false, checkoutAtual: null,
    localStorage: { setItem: (...args) => gravacoes.push(args) },
    importarFirebase: async () => { if (pendurarImport) await new Promise((resolve) => { liberarImport = resolve; }); if (falhaImport) throw new Error('falha import'); return { db: {} }; },
    importarFirestore: async () => ({
      doc: (...args) => { const caminho = args.slice(1).join('/'); leituras.push(caminho); return caminho; },
      getDoc: async () => ({ exists: () => !!ficha, data: () => ficha }),
      onSnapshot: (caminho, ok, erro) => { const o = { caminho, ok, erro, parado: false }; ouvintes.push(o); return () => { o.parado = true; }; },
    }),
  };
  vm.createContext(c);
  vm.runInContext(`${acompanhamento}\n${cards}\n${leitura}\n${roteamento}\nthis.api={acompanharResumo,pararAcompanhar,renderResumoPedido,cartaoPedido,lerPedidos,irParaHash};\nfunction acompanhar(id){ rotas.push(id); }`, Object.assign(c, { rotas }));
  return { c, leituras, ouvintes, gravacoes, rotas, api: c.api, emitir: (o, valor) => o.ok({ exists: () => !!valor, data: () => valor }),
    ficha: (v) => { ficha = v; }, pendurar: () => { pendurarImport = true; }, liberar: () => liberarImport?.(), falhar: () => { falhaImport = true; } };
}
const a = ambiente();
const lista = await a.api.lerPedidos();
assert.equal(lista.length, 1); assert.equal(lista[0].resumoChave, hash); assert.equal(lista[0].id, undefined);
const card = a.api.cartaoPedido(lista[0]);
assert.match(card, new RegExp(`href="#pedido/resumo/${hash}"`)); assert.match(card, /data-ic="direita"/);
assert(!card.includes(telefoneFicticio));
assert.match(a.api.cartaoPedido({ ...resumo, id: 'pedido-local' }), /href="#pedido\/pedido-local"/);
assert(!a.api.cartaoPedido({ ...resumo, resumoChave: 'invalida' }).includes('<a'));
a.leituras.length = 0;
await a.api.acompanharResumo(hash);
assert.equal(a.ouvintes.length, 1);
assert.equal(a.leituras[0], `lojas/loja-teste/clientes/${telefoneFicticio}`);
const primeiro = a.ouvintes[0];
for (const [status, tipo, rotulo] of [['novo', 'entrega', 'Enviado'], ['preparo', 'entrega', 'Em preparo'], ['saiu', 'entrega', 'Saiu para entrega'], ['entregue', 'entrega', 'Entregue'], ['entregue', 'retirada', 'Retirado'], ['entregue', 'local', 'Servido'], ['cancelado', 'entrega', 'Não aceito']]) {
  a.emitir(primeiro, { pedidos: { [hash]: { ...resumo, status, tipo, endereco: { rua: 'PRIVADO' }, aceitoEm: new Date(), pagamento: { pago: true } } } });
  assert.match(elemento.innerHTML, new RegExp(`<h1>${rotulo}</h1>`));
  assert.match(elemento.innerHTML, /28\/10\/2026,? 12:00/);
  assert.match(elemento.innerHTML, /&lt;script&gt;teste&lt;\/script&gt;/);
  for (const proibido of ['PRIVADO', 'Nada foi cobrado', 'previsão', 'Começou', 'Pago', '<script>', telefoneFicticio]) assert(!elemento.innerHTML.includes(proibido), proibido);
  assert.match(elemento.innerHTML, /Voltar aos pedidos/); assert.match(elemento.innerHTML, /VALOR:4200/);
}
a.emitir(primeiro, null); assert.match(elemento.innerHTML, /Não encontramos/);
primeiro.erro(new Error('offline')); assert.match(elemento.innerHTML, /Não foi possível atualizar/);
a.c.location.hash = `#pedido/resumo/${outro}`; await a.api.acompanharResumo(outro); assert(primeiro.parado);
const atual = elemento.innerHTML; a.emitir(primeiro, { pedidos: { [hash]: resumo } }); primeiro.erro(); assert.equal(elemento.innerHTML, atual);
a.api.pararAcompanhar(); assert(a.ouvintes.at(-1).parado);
a.emitir(a.ouvintes.at(-1), { pedidos: { [outro]: resumo } }); assert.equal(elemento.innerHTML, atual);
assert(a.leituras.every((caminho) => caminho.includes('/clientes/')), 'Rota resumo lê somente ficha, nunca pedidos privados/pagamento');
assert.equal(a.gravacoes.length, 0, 'Resumo não grava IDs no armazenamento');
for (const [chave, telefone] of [['invalido', telefoneFicticio], [hash, null], [hash, 'invalido']]) {
  const b = ambiente(); b.c.STATE.cliente = telefone ? { telefone } : null; await b.api.acompanharResumo(chave);
  assert.equal(b.leituras.length, 0); assert.match(elemento.innerHTML, /Voltar aos pedidos/);
}
const b = ambiente(); b.pendurar(); const esperando = b.api.acompanharResumo(hash);
b.api.pararAcompanhar(); b.liberar(); await esperando; assert.equal(b.ouvintes.length, 0, 'Saída durante import não abre escuta');
const d = ambiente(); d.pendurar(); const trocando = d.api.acompanharResumo(hash);
d.c.location.hash = '#pedidos'; d.liberar(); await trocando; assert.equal(d.ouvintes.length, 0);
const e = ambiente(); e.falhar(); await e.api.acompanharResumo(hash); assert.match(elemento.innerHTML, /Não foi possível carregar/);
const f = ambiente(); await f.api.acompanharResumo(hash); f.c.STATE.cliente = { telefone: '0000000000' };
const antesPerfil = elemento.innerHTML; f.emitir(f.ouvintes[0], { pedidos: { [hash]: resumo } }); assert.equal(elemento.innerHTML, antesPerfil);
const g = ambiente(); g.c.location.hash = `#pedido/resumo/${hash}`; g.api.irParaHash();
await new Promise((resolve) => setImmediate(resolve)); assert.equal(g.ouvintes.length, 1); assert.equal(g.rotas.length, 0);
g.c.location.hash = '#pedido/pedido-local'; g.api.irParaHash(); assert.equal(g.rotas[0], 'pedido-local');
g.c.location.hash = '#inicio'; g.api.irParaHash(); assert(g.ouvintes[0].parado);
console.log('Resumo público: links, leitura só da ficha, estados, escape, validação, falhas, limpeza, imports/respostas obsoletas e rota completa preservada: OK.');

if (process.argv.includes('--fixture')) {
  const vivo = fonte.slice(fonte.indexOf('let pararAcomp ='), fonte.indexOf('function renderPagamentoPendente('))
    .replaceAll('await import("./firebase-init.js?v=3")', 'await importarFirebase()')
    .replaceAll('await import(FIRESTORE)', 'await importarFirestore()');
  const rendererCompleto = fonte.slice(fonte.indexOf('const quando = (t)'), fonte.indexOf('/* ===== S20 / D20'));
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Teste local de resumo</title>
    <link rel="stylesheet" href="../../tokens.css?v=1"><link rel="stylesheet" href="../../loja.css?v=teste-resumo">
    <body><aside style="padding:12px;display:flex;gap:8px;flex-wrap:wrap;background:#fff;border-bottom:1px solid #ddd;position:relative;z-index:40">
    <b>Teste local, dados fictícios</b><a href="#pedidos">Pedidos</a>
    <select id="estado-teste" aria-label="Estado simulado"><option value="preparo">Em preparo</option><option value="novo">Enviado</option><option value="saiu">Saiu para entrega</option><option value="entregue">Entregue</option><option value="cancelado">Não aceito</option></select>
    <select id="tipo-teste" aria-label="Tipo simulado"><option value="entrega">Entrega</option><option value="retirada">Retirada</option><option value="local">No local</option></select>
    <button id="ausente-teste">Resumo inexistente</button><button id="erro-teste">Falha de leitura</button><button id="restaurar-teste">Restaurar</button><small id="escutas-teste" role="status"></small></aside>
    <section class="tela pagina" id="tela-pedidos"><div class="topo so-cel"><h1>Pedidos</h1></div><div class="inicio-grade"><div class="inicio-main"><h1 class="pag-t so-pc">Pedidos</h1><p class="pag-s">Exemplos locais: primeiro sem id, segundo com id deste aparelho.</p><div id="lista-pedidos"></div></div></div></section>
    <section class="tela" id="tela-inicio"><a href="#pedidos">Voltar aos pedidos</a></section>
    <section class="tela" id="tela-pedido"><div class="faixa-fina so-pc"><div class="dentro">Loja de teste</div></div><div class="topo-x so-cel"><a class="fechar" href="#pedidos" aria-label="Fechar"><i data-ic="x"></i></a></div><div class="cartao-ok" id="acompanhar"></div></section>
    <script type="module">
    import { esc, fmtMoeda } from '../../shared.js?v=1'; import { pintarIcones } from '../../icones.js?v=2';
    const SLUG='loja-teste', LOJA={id:SLUG,aberta:true}, STATE={cliente:{telefone:'00000000000'},sacola:[]}, pc=matchMedia('(min-width:1024px)'), CHECKOUT=[], ABAS=[];
    const PAGAMENTOS={servico:'desligado'},checkoutAtual=null,pagamentoDisponivel=()=>false;
    const reais=(v)=>fmtMoeda(v/100),hh=(d)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Belem',hour:'2-digit',minute:'2-digit'}).format(d),somaMin=(d,m)=>new Date(d.getTime()+m*60000),janela=()=>[30,40],textoAgendamento=()=>'',quandoFoi=(d)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Belem',dateStyle:'short',timeStyle:'short'}).format(d);
    const agenda={fechar(){}},fecharInfo=()=>{},sincronizarVideos=()=>{},encerrarTentativa=()=>{},concluirCheckout=()=>{},toast=()=>{},renderPagamentoPendente=()=>{};
    const chave='${hash}',pedido={numero:123,status:'preparo',tipo:'entrega',criadoEm:new Date('2026-10-28T15:00:00Z'),total:4200,itens:[{qtd:2,nome:'Pizza de teste <especial>'}]};
    const streams=new Set(),leituras=new Set();let ausente=false;
    function contar(){document.getElementById('escutas-teste').textContent='Escutas ativas: '+streams.size+'; coleções lidas: '+[...leituras].join(', ');}
    function emitir(o){if(o.parado)return;const dados=o.colecao==='clientes'?(ausente?null:{pedidos:{[chave]:pedido}}):o.colecao==='pedidos'?{...pedido,id:'pedido-local',numero:456}:null;o.ok({exists:()=>!!dados,data:()=>dados});}
    const importarFirebase=async()=>({db:{}}),importarFirestore=async()=>({doc:(...args)=>args.slice(1),onSnapshot:(ref,ok,erro)=>{const o={colecao:ref[2],ok,erro,parado:false};streams.add(o);leituras.add(o.colecao);contar();queueMicrotask(()=>emitir(o));return()=>{o.parado=true;streams.delete(o);contar();};}});
    ${vivo}
    ${rendererCompleto}
    ${cards}
    function renderPedidos(){document.getElementById('lista-pedidos').innerHTML=cartaoPedido({...pedido,resumoChave:chave})+cartaoPedido({...pedido,id:'pedido-local',numero:456});pintarIcones();}
    ${roteamento}
    document.getElementById('estado-teste').onchange=(e)=>{pedido.status=e.target.value;streams.forEach(emitir);};
    document.getElementById('tipo-teste').onchange=(e)=>{pedido.tipo=e.target.value;streams.forEach(emitir);};
    document.getElementById('ausente-teste').onclick=()=>{ausente=true;streams.forEach(emitir);};
    document.getElementById('erro-teste').onclick=()=>streams.forEach((o)=>o.erro(new Error('Falha simulada')));
    document.getElementById('restaurar-teste').onclick=()=>{ausente=false;streams.forEach(emitir);};
    addEventListener('hashchange',irParaHash);if(!location.hash)location.hash='#pedidos';else irParaHash();
    </script></body></html>`;
  const pasta = new URL('./evidencias/', import.meta.url); await mkdir(pasta, { recursive: true });
  const destino = new URL('testar-resumo-pedido.html', pasta); await writeFile(destino, html);
  console.log('Fixture offline gerada em rea/evidencias/testar-resumo-pedido.html (ignorada no Git); usa funções extraídas do app.js atual.');
}
