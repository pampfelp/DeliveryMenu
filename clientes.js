import { db } from "./firebase-init.js?v=3";
import { collection, doc, getDocs, query, orderBy, documentId, startAfter, limit, where, onSnapshot, Timestamp, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { esc, fmtMoeda, toast } from "./shared.js?v=1";
import { pintarIcones } from "./icones.js?v=3";
import { observarCatalogo } from "./cardapio.js?v=5";
import { taxaParaCliente } from "./entregas.js?v=5";
import { resumirCliente, mesDe, montarFavorito, dataDe, hashDestinatario, mesmaCesta, normalizar, tipoItem } from "./crm-dados.js?v=1";
import { descontoDe } from "./cupom.js?v=1";
import { htmlClientes, htmlOferta } from "./clientes-vista.js?v=2";
import { linkPublico } from "./links-cardapio.js?v=1";
const $ = (id) => document.getElementById(id), reais = (c) => fmtMoeda(c / 100);
const C = { loja: null, fichas: new Map(), itens: [], cats: [], mes: mesDe(), filtro: "todos", busca: "", pagina: 1, carregou: false, carregando: false, exemplo: null, parar: [], geracao: 0, oferta: null, foco: null, ocupado: false };
const ref = (col,id) => doc(db,"lojas",C.loja.id,col,id);
const tamanhoPagina = () => C.exemplo ? 3 : 20;
function render() {
  if (!C.loja || $("vista-clientes").hidden) return;
  if (!C.carregou) { $("crm-lista").innerHTML = `<p class="crm-vazio" role="status">${C.carregando ? "Carregando clientes…" : 'Não foi possível ler os clientes. <button data-crm-recarregar>Tentar novamente</button>'}</p>`; return; }
  const todos = [...C.fichas.values()].map((c) => resumirCliente(c,C.mes,C.itens,C.cats)).sort((a,b) => a.nome.localeCompare(b.nome,"pt-BR"));
  const ativos = todos.filter((c) => c.noMes).length, termo = normalizar(C.busca), digitos = C.busca.replace(/\D/g,"");
  const lista = todos.filter((c) => (C.filtro === "todos" || (C.filtro === "pediram" ? c.noMes : !c.noMes)) && (!termo || normalizar(c.nome).includes(termo) || (digitos && c.telefone.includes(digitos))));
  const paginas = Math.max(1,Math.ceil(lista.length/tamanhoPagina())); C.pagina = Math.max(1,Math.min(C.pagina,paginas));
  const foco = document.activeElement?.id === "crm-busca", pos = foco ? $("crm-busca").selectionStart : null;
  $("crm-lista").innerHTML = htmlClientes(lista.slice((C.pagina-1)*tamanhoPagina(),C.pagina*tamanhoPagina()),{ total: todos.length, ativos, mes: C.mes, filtro: C.filtro, pagina: C.pagina, paginas, encontrados: lista.length, exemplo: !!C.exemplo });
  $("crm-busca").value = C.busca;
  if (foco) { $("crm-busca").focus(); $("crm-busca").setSelectionRange(pos,pos); }
  pintarIcones($("crm-lista"));
}
async function carregar() {
  if (C.carregou || C.carregando || !C.loja) return;
  C.carregando = true; render();
  const geracao = C.geracao, lojaId = C.loja.id, col = collection(db,"lojas",lojaId,"clientes");
  try {
    // Corte obtido no servidor, sem depender do relógio do computador.
    const ultimo = await getDocs(query(col,orderBy("atualizadoEm","desc"),limit(1)));
    const corte = ultimo.docs[0]?.data().atualizadoEm || Timestamp.fromMillis(0);
    let cursor = null;
    do {
      const snap = await getDocs(query(col,orderBy(documentId()),...(cursor ? [startAfter(cursor)] : []),limit(100)));
      if (geracao !== C.geracao) return;
      snap.docs.forEach((d) => C.fichas.set(d.id,{telefone:d.id,...d.data()}));
      cursor = snap.size === 100 ? snap.docs.at(-1) : null;
    } while (cursor);
    if (geracao !== C.geracao) return;
    C.carregou = true;
    C.parar.push(onSnapshot(query(col,where("atualizadoEm",">=",corte)),(s) => {
      if (geracao !== C.geracao) return;
      s.docChanges().forEach(({type,doc:d}) => type === "removed" ? C.fichas.delete(d.id) : C.fichas.set(d.id,{telefone:d.id,...d.data()})); render();
    },() => toast("Não foi possível atualizar os clientes. Reabra o painel para tentar novamente.","erro",5000)));
  } catch { if (geracao === C.geracao) toast("Não deu para ler os clientes. Confira a conexão e o acesso à loja.","erro",5000); }
  finally { if (geracao === C.geracao) { C.carregando = false; render(); } }
}
async function pedidosDo(telefone) {
  if (C.exemplo) return C.exemplo.pedidos.filter((p) => p.cliente.telefone === telefone);
  const lista = [], lojaId = C.loja.id; let cursor = null;
  do {
    const snap = await getDocs(query(collection(db,"lojas",lojaId,"pedidos"),where("cliente.telefone","==",telefone),orderBy(documentId()),...(cursor ? [startAfter(cursor)] : []),limit(100)));
    lista.push(...snap.docs.map((d) => ({id:d.id,...d.data()})));
    cursor = snap.size === 100 ? snap.docs.at(-1) : null;
  } while(cursor);
  return lista;
}
function codigoNovo() {
  const a = crypto.getRandomValues(new Uint8Array(8));
  return `JAM${[...a].map((n) => n.toString(16).padStart(2,"0")).join("").toUpperCase()}`;
}
async function abrirOferta(telefone, botao) {
  if (C.ocupado || C.oferta) return;
  C.ocupado = true; if (botao) botao.disabled = true;
  const geracao = C.geracao;
  try {
    const ficha = C.fichas.get(telefone); if (!ficha) return;
    const pedidos = await pedidosDo(telefone);
    if (geracao !== C.geracao || $("vista-clientes").hidden) return;
    const itens = montarFavorito(pedidos,C.itens,C.cats);
    const ultimo = pedidos.filter((p) => p.status === "entregue").sort((a,b) => +dataDe(b.criadoEm)-+dataDe(a.criadoEm))[0];
    const taxa = C.exemplo ? 600 : taxaParaCliente(ultimo);
    if (taxa == null) throw new Error("Confira o bairro de entrega deste cliente antes de emitir a oferta. A taxa atual não pôde ser calculada.");
    C.oferta = {cliente:{nome:ficha.nome,telefone},pedidos,itens,subtotal:itens.reduce((s,i) => s+i.total,0),taxa,tipo:"valor",valor:"",codigo:C.exemplo ? "ANA10JAMBU" : codigoNovo(),criado:false};
    C.foco = botao; $("crm-modal").hidden = false; document.body.classList.add("com-janela"); desenharOferta(); $("crm-desconto").focus();
  } catch (e) { toast(e.message || "Não foi possível consultar este histórico. Tente novamente.","erro",6500); }
  finally { C.ocupado = false; if (botao) botao.disabled = false; }
}
const valorDesconto = () => C.oferta.tipo === "pct" ? Number(C.oferta.valor.replace(",",".")) : Math.round(Number(C.oferta.valor.replace(/\./g,"").replace(",","."))*100);
function itensNaOferta(o) {
  const ordem = {pizza:0,acompanhamento:1,bebida:2};
  return [...o.itens].sort((a,b) => ordem[tipoItem(C.itens.find((i) => i.id===a.itemId),C.cats)]-ordem[tipoItem(C.itens.find((i) => i.id===b.itemId),C.cats)]);
}
function mensagem(o, desconto) {
  return `Olá, ${o.cliente.nome.split(" ")[0]}! Aqui é da ${C.loja.nome}. Temos uma oferta para o seu pedido favorito:\n\n${itensNaOferta(o).map((i) => `${i.qtd}x ${i.nome}${i.resumo ? ` (${i.resumo})` : ""}`).join("\n")}\n\nDesconto de ${reais(desconto)} nos produtos. Com a entrega estimada de ${reais(o.taxa)}, fica ${reais(o.subtotal+o.taxa-desconto)}. A entrega é confirmada pelo bairro no cardápio.\n\nUse o cupom ${o.codigo}: um único uso para o seu WhatsApp, somente nos itens, opções e quantidades desta oferta.\nPeça pelo cardápio: ${linkPublico(C.loja.id)}`;
}
function desenharOferta() {
  const o = C.oferta; if (!o) return;
  const valor = valorDesconto(), desconto = Number.isFinite(valor) && valor > 0 && (o.tipo !== "pct" || valor <= 100) ? descontoDe({tipo:o.tipo,valor},o.subtotal) : 0;
  $("crm-oferta").innerHTML = htmlOferta({...o,itens:itensNaOferta(o),desconto,mensagem:mensagem(o,desconto),exemplo:!!C.exemplo,link:linkPublico(C.loja.id)});
  atualizarPrevia();
}
function atualizarPrevia(validar = false) {
  const o = C.oferta; if (!o) return;
  const valor = valorDesconto(), valido = Number.isInteger(valor) && valor > 0 && (o.tipo === "pct" ? valor <= 100 : valor <= o.subtotal);
  const desconto = valido ? descontoDe({tipo:o.tipo,valor},o.subtotal) : 0;
  $("crm-total-oferta").textContent = reais(o.subtotal+o.taxa-desconto); $("crm-mensagem").value = mensagem(o,desconto);
  $("crm-oferta").querySelector("[data-crm-confirmar]").disabled = !valido || C.ocupado;
  $("crm-desconto").setAttribute("aria-invalid",String(!!o.valor && !valido));
  if (validar && !o.criado && !C.ocupado) erroOferta(o.valor && !valido ? (o.tipo === "pct" ? "Informe uma porcentagem inteira de 1 a 100." : `Informe um desconto entre R$ 0,01 e ${reais(o.subtotal)}.`) : "");
}
export function fecharClientes() {
  if (C.ocupado && C.oferta) return;
  C.oferta = null; $("crm-modal").hidden = true; document.body.classList.remove("com-janela");
  if (C.foco?.isConnected) C.foco.focus(); C.foco = null;
}
async function confirmarOferta() {
  const o = C.oferta; if (!o || C.ocupado) return;
  const geracao = C.geracao;
  const valor = valorDesconto(); if (!Number.isInteger(valor) || valor <= 0 || (o.tipo === "pct" ? valor > 100 : valor > o.subtotal)) return;
  if (C.exemplo) { toast("Exemplo: nenhum cupom foi criado e nenhuma conversa foi aberta.","info",5000); return; }
  if (!navigator.onLine) { erroOferta("Conecte-se à internet para criar o cupom."); return; }
  C.ocupado = true; atualizarPrevia(); erroOferta("");
  try {
    const atuais = montarFavorito(o.pedidos,C.itens,C.cats);
    if (!mesmaCesta(atuais,o.itens)) throw new Error("O cardápio mudou. Feche a oferta e abra novamente para conferir os preços e opções atuais.");
    if (!o.criado) {
      const publicoRef = ref("cupons",o.codigo), privadoRef = ref("ofertasClientes",o.codigo);
      const destinatarioHash = await hashDestinatario(o.codigo,o.cliente.telefone);
      await runTransaction(db,async (tx) => {
        const r = publicoRef, existe = await tx.get(r);
        if (existe.exists()) {
          const anterior=existe.data(), vinculo=await tx.get(privadoRef);
          if (vinculo.data()?.telefone===o.cliente.telefone && anterior.destinatarioHash===destinatarioHash && anterior.tipo===o.tipo && anterior.valor===valor && mesmaCesta(anterior.oferta,o.itens)) return;
          throw new Error("Este código já existe. Feche e abra a oferta para gerar outro.");
        }
        tx.set(r,{tipo:o.tipo,valor,minimo:o.subtotal,validoAte:null,limite:1,usos:0,ativo:true,individual:true,destinatarioHash,oferta:o.itens,subtotalOferta:o.subtotal,criadoEm:serverTimestamp()});
        tx.set(privadoRef,{telefone:o.cliente.telefone,nome:o.cliente.nome,criadoEm:serverTimestamp()});
      });
      o.criado = true;
    }
    if (geracao !== C.geracao) return;
    const url = `https://wa.me/55${o.cliente.telefone}?text=${encodeURIComponent($("crm-mensagem").value)}`;
    // Link explícito também cobre bloqueadores de janela e permite repetir sem emitir outro cupom.
    $("crm-erro").innerHTML = `Cupom ${esc(o.codigo)} criado. <a href="${esc(url)}" target="_blank" rel="noopener">Abrir WhatsApp com a oferta</a>`; $("crm-erro").hidden = false;
    window.open(url,"_blank","noopener,noreferrer");
    $("crm-oferta").querySelector("[data-crm-confirmar]").textContent = "Abrir WhatsApp novamente";
    $("crm-desconto").disabled = true; $("crm-oferta").querySelectorAll("[data-crm-tipo]").forEach((b) => b.disabled = true);
  } catch (e) { if (geracao===C.geracao) erroOferta(e.code ? "Não foi possível criar o cupom. Confira a conexão e seu acesso à loja." : e.message); }
  finally { if (geracao===C.geracao) { C.ocupado = false; atualizarPrevia(); } }
}
function erroOferta(msg) { $("crm-erro").textContent = msg; $("crm-erro").hidden = !msg; }
function clicar(e) {
  if (!C.loja) return;
  const b = e.target.closest("button");
  if (e.target.closest("[data-crm-fechar]") || e.target.id === "crm-modal") fecharClientes();
  else if (b?.hasAttribute("data-crm-oferta")) abrirOferta(b.dataset.crmOferta,b);
  else if (b?.hasAttribute("data-crm-filtro")) { C.filtro=b.dataset.crmFiltro; C.pagina=1; render(); }
  else if (b?.hasAttribute("data-crm-pagina")) { C.pagina=Number(b.dataset.crmPagina); render(); }
  else if (b?.hasAttribute("data-crm-tipo") && !C.oferta?.criado) { C.oferta.tipo=b.dataset.crmTipo; C.oferta.valor=""; desenharOferta(); $("crm-desconto").focus(); }
  else if (b?.hasAttribute("data-crm-confirmar")) confirmarOferta();
  else if (b?.hasAttribute("data-crm-recarregar")) carregar();
}
function digitar(e) {
  if (e.target.id === "crm-busca") { C.busca=e.target.value; C.pagina=1; render(); }
  else if (e.target.id === "crm-desconto" && C.oferta && !C.oferta.criado) { C.oferta.valor=e.target.value; atualizarPrevia(true); }
}
function mudar(e) { if (e.target.id === "crm-mes" && /^\d{4}-\d{2}$/.test(e.target.value)) { C.mes=e.target.value; C.pagina=1; render(); } }
function teclado(e) {
  if (!C.oferta) return;
  if (e.key === "Escape") { e.preventDefault(); fecharClientes(); }
  if (e.key === "Tab") {
    const f = [...$("crm-oferta").querySelectorAll('button:not(:disabled),input:not(:disabled),textarea,a[href]')].filter((el) => el.getClientRects().length);
    if (e.shiftKey && document.activeElement===f[0]) { e.preventDefault(); f.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement===f.at(-1)) { e.preventDefault(); f[0].focus(); }
  }
}
export function iniciarClientes(loja,{exemplo=null}={}) {
  pararClientes(); C.loja=loja; C.exemplo=exemplo; C.mes=mesDe();
  if (!exemplo) C.parar.push(observarCatalogo((catalogo) => { if (catalogo.lojaId===C.loja?.id) { C.itens=catalogo.itens; C.cats=catalogo.cats; render(); } }));
  if (exemplo) { C.itens=exemplo.itens; C.cats=exemplo.cats; exemplo.fichas.forEach((c) => C.fichas.set(c.telefone,c)); C.carregou=true; C.mes=exemplo.mes; }
  document.addEventListener("click",clicar); document.addEventListener("input",digitar); document.addEventListener("change",mudar); document.addEventListener("keydown",teclado);
}
export function mostrarClientes() { if (!C.loja) return; if (!C.carregou) carregar(); render(); }
export function pararClientes() {
  C.geracao++; C.parar.forEach((f) => f()); C.parar=[]; C.ocupado=false; fecharClientes(); C.loja=null; C.fichas.clear(); C.itens=[]; C.cats=[]; C.carregou=false; C.carregando=false; C.busca=""; C.filtro="todos"; C.pagina=1;
  document.removeEventListener("click",clicar); document.removeEventListener("input",digitar); document.removeEventListener("change",mudar); document.removeEventListener("keydown",teclado);
}
