/*
  pedidos.js: tela de pedidos do painel (imagens PD10, PD11, P10, P11).

  Caminho de um pedido no Firestore:
    lojas/{loja}/pedidosEntrada/{id}   o cliente cria (status "novo")
    lojas/{loja}/pedidos/{id}          o dono aceita e o pedido passa para cá
  Situações: novo -> preparo -> saiu (só entrega) -> entregue; recusado = cancelado.
  A cada aceite, recusa ou mudança, o resumo vai para a ficha do cliente pelo
  número (lojas/{loja}/clientes/{telefone}, ver ficha-cliente.js).
  O número do pedido (#1051) nasce no aceite, a partir do contador da loja.
*/

import { db } from "./firebase-init.js?v=3";
import {
  collection, doc, onSnapshot, query, where, orderBy, writeBatch, runTransaction, updateDoc, serverTimestamp, Timestamp, getDocs,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { camposFicha, telefoneDe } from "./ficha-cliente.js?v=3";
import { esc, fmtMoeda, toast, confirmar } from "./shared.js?v=1";
import { pintarIcones } from "./icones.js?v=3";
import { regraDe, minutosKm } from "./conta-entrega.js?v=1";
import { textoAgendamento } from "./agendamento.js?v=1";
import { chamarPagamento } from "./pagamentos.js?v=4";
import { periodoPedidos, noPeriodo, pedidoVisivel } from "./periodo-pedidos.js?v=1";

const reais = (c) => fmtMoeda((c || 0) / 100);
const $ = (id) => document.getElementById(id);
const ATRASO_MIN = 25; // em preparo há mais que isso aparece em vermelho
const COLUNAS = [
  { id: "novo", nome: "Novos", aba: "Novos" },
  { id: "preparo", nome: "Em preparo", aba: "Preparo" },
  { id: "saiu", nome: "Saiu para entrega", aba: "Entrega" },
  { id: "fim", nome: "Concluídos", aba: "Concluídos" },
];
const TIPOS = { entrega: ["entrega", "Entrega"], retirada: ["loja", "Retirada"], local: ["mesa", "No local"] };

const P = { loja: null, entrada: [], pedidos: [], aba: "novo", verTodos: false, parar: [], agora: () => new Date(), exemplo: false, aberto: null,
  periodo: null, pararPeriodo: null, versao: 0, sessao: 0, carregando: false, erroPeriodo: "", erroEntrada: "" };

/* ===== tempo ===== */
const data = (t) => (t instanceof Date ? t : t?.toDate ? t.toDate() : null);
const hhmm = (t) => { const d = data(t); return d ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Belem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d).replace(":", "h") : ""; };
const minutosDesde = (t) => { const d = data(t); return d ? Math.max(0, Math.round((P.agora() - d) / 60000)) : 0; };
// previsão de chegada: a mesma conta da loja (conta-entrega.js), com janela de 10 min
function previsao(p) {
  if (p.agendadoPara) return "";
  const d = data(p.criadoEm), km = p.endereco?.km;
  if (!d || km == null) return "";
  const ate = new Date(d.getTime() + minutosKm(km, regraDe(P.loja)) * 60000);
  return ` · previsão ${hhmm(ate)} a ${hhmm(new Date(ate.getTime() + 600000))}`;
}
const inicioDoDia = (deslocamento = 0) => {
  const d = new Date(P.agora().getTime() - 3 * 3600000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + deslocamento, 3));
};
const dataHistorica = (t) => { const d = data(t); return d ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Belem", day: "2-digit", month: "2-digit", year: "numeric" }).format(d) : ""; };
const quando = (t) => `${P.periodo.tipo === "hoje" ? "" : `${dataHistorica(t)} · `}${hhmm(t)}`;

function avisoPeriodo(texto = "", erro = false) {
  $("periodo-aviso").textContent = texto;
  $("periodo-aviso").classList.toggle("erro", erro);
}
function renderPeriodo() {
  document.querySelectorAll("[data-periodo]").forEach((el) => el.setAttribute("aria-pressed", String(el.dataset.periodo === P.periodo.tipo)));
  $("periodo-de").value = P.periodo.de;
  $("periodo-ate").value = P.periodo.ate;
  $("k-qtd-rotulo").textContent = P.periodo.tipo === "hoje" ? "Pedidos hoje" : "Pedidos no período";
}
function atualizarPedidos() {
  renderQuadro(); renderIndicadores();
  if (P.aberto) {
    if (todos().some((p) => p.id === P.aberto)) abrirDetalhe(P.aberto);
    else fecharDetalhe();
  }
}
function consultarPeriodo() {
  const versao = ++P.versao;
  P.pararPeriodo?.(); P.pararPeriodo = null;
  P.erroPeriodo = "";
  if (P.exemplo) { P.carregando = false; avisoPeriodo(); atualizarPedidos(); return; }
  P.pedidos = []; P.carregando = true;
  avisoPeriodo("Carregando pedidos do período…"); atualizarPedidos();
  P.pararPeriodo = onSnapshot(query(collection(db, "lojas", P.loja.id, "pedidos"),
    where("criadoEm", ">=", Timestamp.fromDate(P.periodo.consultaInicio)),
    where("criadoEm", "<", Timestamp.fromDate(P.periodo.fim)), orderBy("criadoEm", "desc")), (snap) => {
    if (versao !== P.versao) return;
    P.pedidos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    P.carregando = false; P.erroPeriodo = "";
    avisoPeriodo(P.erroEntrada, !!P.erroEntrada); atualizarPedidos();
  }, () => {
    if (versao !== P.versao) return;
    P.carregando = false; P.erroPeriodo = "Não foi possível carregar os pedidos deste período. Selecione o período para tentar novamente.";
    avisoPeriodo(P.erroPeriodo, true); atualizarPedidos();
  });
}
function escolherPeriodo(tipo, de = "", ate = "") {
  let periodo;
  try { periodo = periodoPedidos(tipo, P.agora(), de, ate); }
  catch (erro) { avisoPeriodo(erro.message, true); return; }
  P.periodo = periodo; P.verTodos = false; fecharDetalhe();
  renderPeriodo(); consultarPeriodo();
}
function aoFiltrar(e) {
  if (e.target.id !== "filtro-periodo") return;
  e.preventDefault(); escolherPeriodo("personalizado", $("periodo-de").value, $("periodo-ate").value);
}

/* ===== situação de cada pedido ===== */
const coluna = (p) => (p.status === "novo" ? "novo" : p.status === "preparo" ? "preparo" : p.status === "saiu" ? "saiu" : "fim");
const numero = (p) => (p.numero ? `#${p.numero}` : "Novo");
function proximaAcao(p) {
  if (p.pagamento?.estornoPendente) return null;
  if (p.status === "novo") return { rotulo: "Aceitar pedido", forte: true, fazer: () => aceitar(p) };
  if (p.status === "preparo") return p.tipo === "entrega"
    ? { rotulo: "Saiu para entrega", fazer: () => mudarStatus(p, "saiu") }
    : { rotulo: p.tipo === "retirada" ? "Marcar retirado" : "Marcar servido", fazer: () => mudarStatus(p, "entregue") };
  if (p.status === "saiu") return { rotulo: "Marcar entregue", fazer: () => mudarStatus(p, "entregue") };
  return null;
}
function rotuloPagamento(p) {
  const g = p.pagamento || {};
  if (p.status === "cancelado") return ["cancelado", g.online ? (g.reembolsado ? "Pagamento devolvido" : "Devolução pendente") : "Cancelado"];
  if (g.estornoPendente) return ["cancelado", "Conferindo devolução"];
  if (g.pago) return ["pago", `${g.forma || "Pix"} pago`];
  const onde = p.tipo === "retirada" ? "na retirada" : "na entrega";
  if (g.forma === "Dinheiro" && g.troco) return ["receber", `Dinheiro, troco p/ ${reais(g.troco).replace(",00", "")}`];
  return ["receber", `${g.forma || "Pagamento"} ${onde}`];
}

/* ===== indicadores do período por data de criação ===== */
function renderIndicadores() {
  if (P.carregando || P.erroPeriodo) {
    ["k-qtd", "k-fat", "k-ticket", "k-tempo"].forEach((id) => { $(id).textContent = "—"; });
    $("k-qtd-ontem").textContent = ""; return;
  }
  const hoje = inicioDoDia(0), ontem = inicioDoDia(-1);
  const doDia = (d0, d1) => P.pedidos.filter((p) => { const d = data(p.criadoEm); return d && d >= d0 && (!d1 || d < d1) && p.status !== "cancelado"; });
  const hojeP = P.pedidos.filter((p) => noPeriodo(p.criadoEm, P.periodo) && p.status !== "cancelado"), ontemP = doDia(ontem, hoje);
  const qtd = hojeP.length + P.entrada.filter((p) => noPeriodo(p.criadoEm, P.periodo)).length;
  const fat = hojeP.reduce((s, p) => s + (p.subtotal || 0) - (p.desconto || 0), 0);
  const saidas = hojeP.filter((p) => p.saiuEm).map((p) => (data(p.saiuEm) - data(p.criadoEm)) / 60000);
  $("k-qtd").textContent = qtd;
  const dif = qtd - ontemP.length;
  $("k-qtd-ontem").textContent = P.periodo.tipo === "hoje" && ontemP.length ? (dif === 0 ? "igual a ontem" : `${Math.abs(dif)} a ${dif > 0 ? "mais" : "menos"} que ontem`) : "";
  $("k-fat").textContent = reais(fat);
  $("k-ticket").textContent = reais(hojeP.length ? Math.round(fat / hojeP.length) : 0);
  $("k-tempo").textContent = saidas.length ? `${Math.round(saidas.reduce((s, m) => s + m, 0) / saidas.length)} min` : "-";
}

/* ===== quadro (computador) e abas (celular) ===== */
function cartao(p) {
  const [ic, tipo] = TIPOS[p.tipo] || TIPOS.entrega;
  const [classePag, textoPag] = rotuloPagamento(p);
  const min = minutosDesde(p.criadoEm);
  const agendado = data(p.agendadoPara);
  const atrasado = p.status === "preparo" && (agendado ? P.agora() > new Date(agendado.getTime() + 15 * 60000) : min > ATRASO_MIN);
  const acao = proximaAcao(p);
  const lugar = p.tipo === "entrega" && p.endereco?.bairro ? ` · ${esc(p.endereco.bairro)}` : "";
  const itens = (p.itens || []).map((i) => `${i.qtd}x ${esc(i.nome)}`).join(", ");
  return `
    <article class="ped${p.status === "novo" ? " novo" : ""}" data-abrir="${esc(p.id)}" tabindex="0">
      <div class="l1"><span class="num">${numero(p)}</span><span class="hora">${quando(p.criadoEm)}</span><span class="tipo"><i data-ic="${ic}"></i>${tipo}</span></div>
      <div class="cli">${esc(p.cliente?.nome || "")}${lugar}</div>
      <div class="itens">${itens}</div>
      ${p.agendadoPara ? `<div class="agenda-pedido"><i data-ic="agenda"></i>Agendado para ${esc(textoAgendamento(p.agendadoPara))}</div>` : ""}
      <div class="l3"><span class="total">${reais(p.total)}</span><span class="pag ${classePag}">${esc(textoPag)}</span><span class="tempo${atrasado ? " atrasado" : ""}">há ${min} min</span></div>
      ${acao ? `<button type="button" class="btn ${acao.forte ? "" : "fantasma "}acao" data-acao="${esc(p.id)}">${acao.rotulo}</button>` : ""}
    </article>`;
}
function linhaConcluido(p) {
  const fim = p.status === "cancelado" ? `<span class="pag cancelado">Cancelado</span>`
    : `<span>${p.tipo === "retirada" ? "Retirado" : "Entregue"} ${hhmm(p.concluidoEm)}</span>`;
  const resumo = p.agendadoPara ? `<span>${fim}<small class="agenda-mini">Agendado para ${esc(textoAgendamento(p.agendadoPara))}</small></span>` : fim;
  return `<button type="button" class="mini" data-abrir="${esc(p.id)}"><b>${numero(p)}${P.periodo.tipo !== "hoje" ? `<small class="agenda-mini">${dataHistorica(p.criadoEm)}</small>` : ""}</b>${resumo}<span>${reais(p.total)}</span></button>`;
}

function todos() { return [...P.entrada, ...P.pedidos].filter((p) => pedidoVisivel(p, P.periodo)); }
function renderQuadro() {
  if (P.carregando || P.erroPeriodo) {
    $("abas").innerHTML = "";
    $("quadro").innerHTML = `<p class="vazio">${P.erroPeriodo ? "Pedidos indisponíveis. Tente carregar o período novamente." : "Carregando pedidos…"}</p>`;
    return;
  }
  const lista = todos();
  const por = (col) => lista.filter((p) => coluna(p) === col)
    .sort((a, b) => (col === "fim" ? data(b.concluidoEm || b.criadoEm) - data(a.concluidoEm || a.criadoEm) : data(b.criadoEm) - data(a.criadoEm)));
  const novos = por("novo").length;
  document.querySelectorAll("[data-novos]").forEach((el) => { el.textContent = novos || ""; el.hidden = !novos; });

  $("abas").innerHTML = COLUNAS.map((c) => {
    const n = por(c.id).length;
    return `<button type="button" class="${P.aba === c.id ? "on" : ""}" data-aba="${c.id}">${c.aba}${c.id !== "fim" && n ? `<span class="cont">${n}</span>` : ""}</button>`;
  }).join("");

  $("quadro").innerHTML = COLUNAS.map((c) => {
    const itens = por(c.id);
    const visiveis = c.id === "fim" && !P.verTodos ? itens.slice(0, 4) : itens;
    const corpo = c.id === "fim" ? visiveis.map(linhaConcluido).join("") : visiveis.map(cartao).join("");
    const mais = c.id === "fim" && itens.length > 4 && !P.verTodos ? `<button type="button" class="mais" data-ver-todos>Ver os ${itens.length} ${P.periodo.tipo === "hoje" ? "de hoje" : "do período"}</button>` : "";
    const vazio = !itens.length ? `<p class="vazio">${c.id === "novo" ? "Nenhum pedido novo agora." : "Nada aqui."}</p>` : "";
    return `<section class="coluna${P.aba === c.id ? " ativa" : ""}" data-coluna="${c.id}">
      <h2>${c.nome}<span class="cont${c.id === "novo" && itens.length ? " forte" : ""}">${itens.length}</span></h2>${corpo}${mais}${vazio}</section>`;
  }).join("");
  pintarIcones($("tela-painel"));
}

/* ===== detalhe (PD11 / P11) ===== */
function abrirDetalhe(id) {
  const p = todos().find((x) => x.id === id) || P.pedidos.find((x) => x.id === id);
  if (!p) return;
  P.aberto = p.id;
  const [ic, tipo] = TIPOS[p.tipo] || TIPOS.entrega;
  const g = p.pagamento || {};
  const [classePag] = rotuloPagamento(p);
  const tel = (p.cliente?.telefone || "").replace(/\D/g, "");
  const telFmt = tel.length === 11 ? `(${tel.slice(0, 2)}) ${tel.slice(2, 7)}-${tel.slice(7)}` : tel;
  const e = p.endereco || {};
  const estados = { novo: "Novo", preparo: "Em preparo", saiu: "Saiu para entrega", entregue: p.tipo === "retirada" ? "Retirado" : "Entregue", cancelado: "Cancelado" };
  $("d-titulo").textContent = p.numero ? `Pedido #${p.numero}` : "Pedido novo";
  $("d-estado").textContent = estados[p.status] || "";
  $("d-hora").innerHTML = `<span class="so-pc">Recebido ${P.periodo.tipo === "hoje" ? "às" : "em"} ${quando(p.criadoEm)}, há ${minutosDesde(p.criadoEm)} min</span><span class="so-cel">${quando(p.criadoEm)}</span>`;
  // no celular o pagamento não tem caixa própria: vai embaixo do total (P11)
  const textoPag = g.reembolsado ? `Pagamento devolvido${g.estornoEm ? ` às ${hhmm(g.estornoEm)}` : ""}` : g.estornoPendente ? "Conferindo a devolução do pagamento" : g.pago ? `Pago às ${hhmm(g.pagoEm || p.criadoEm)}` : g.troco ? `Levar troco para ${reais(g.troco)}` : p.tipo === "retirada" ? "Receber na retirada" : "Receber na entrega";
  const km = e.km != null ? `${String(e.km.toFixed(1)).replace(".", ",")} km` : "";
  $("d-corpo").innerHTML = `
    ${p.agendadoPara ? `<div class="agenda-faixa"><i data-ic="agenda"></i><span>Agendado para ${esc(textoAgendamento(p.agendadoPara))}<small>${p.tipo === "entrega" ? "Entregar" : "Deixar pronto"} até ${hhmm(new Date(data(p.agendadoPara).getTime() + 15 * 60000))}.${p.status === "novo" ? " Aceite agora e prepare mais perto da hora." : p.status === "preparo" ? " Prepare mais perto da hora." : ""}</small></span></div>` : ""}
    <div class="d-itens">
      <div class="bloco-t">Itens</div>
      ${(p.itens || []).map((i) => `<div class="item"><div><b><span>${i.qtd}x</span>${esc(i.nome)}</b>${i.resumo ? `<p>${esc(i.resumo)}</p>` : ""}${i.obs ? `<p class="obs">OBS: ${esc(i.obs)}</p>` : ""}</div><span class="v">${reais(i.total)}</span></div>`).join("")}
      <div class="totais">
        <div class="tl"><span>Subtotal</span><span>${reais(p.subtotal)}</span></div>
        ${p.tipo === "entrega" ? `<div class="tl"><span><span class="so-pc">Taxa de entrega${e.bairro ? ` (${esc(e.bairro)})` : ""}</span><span class="so-cel">Entrega</span></span><span>${reais(p.taxa)}</span></div>` : ""}
        ${p.desconto ? `<div class="tl"><span>Cupom ${esc(p.cupom || "")}</span><span>- ${reais(p.desconto)}</span></div>` : ""}
        <div class="tl total"><span>Total</span><span>${reais(p.total)}</span></div>
        <p class="pag-cel so-cel"><span class="pag ${classePag}">${g.pago ? `${esc(g.forma || "Pix")} pago às ${hhmm(g.pagoEm || p.criadoEm)}` : `${esc(g.forma || "")}: ${textoPag.toLowerCase()}`}</span></p>
      </div>
    </div>
    <div class="d-lado">
      <div><div class="bloco-t">Cliente</div>
        <div class="caixa"><b>${esc(p.cliente?.nome || "")}</b><p>${telFmt}</p>
          <div class="acoes-c"><a class="btn fantasma" href="https://wa.me/55${tel}" target="_blank" rel="noopener"><i data-ic="conversa"></i>WhatsApp</a><a class="btn fantasma" href="tel:+55${tel}">Ligar</a></div></div></div>
      <div><div class="bloco-t">${tipo}</div>
        <div class="caixa">${p.tipo === "entrega"
          ? `<b>${esc(e.rua || "")}, ${esc(e.numero || "")}</b><p>${esc(e.bairro || "")}${e.complemento ? `, ${esc(e.complemento)}` : ""}</p><div class="so-pc">${e.referencia ? `<p class="ref">Ref.: ${esc(e.referencia)}</p>` : ""}${km ? `<p class="ref">${km}${previsao(p)}</p>` : ""}</div><p class="ref so-cel">${[e.referencia ? `Ref.: ${esc(e.referencia)}` : "", km].filter(Boolean).join(" · ")}</p>`
          : `<b><i data-ic="${ic}"></i>${tipo}</b><p>Sem taxa de entrega</p>`}</div></div>
      <div class="so-pc"><div class="bloco-t">Pagamento</div>
        <div class="caixa"><b>${esc(g.forma || "")}</b><p><span class="pag ${classePag}">${textoPag}</span></p></div></div>
    </div>`;
  const acao = proximaAcao(p);
  $("d-pe").innerHTML = `
    ${p.status === "novo" ? `<button type="button" class="recusar" data-recusar="${esc(p.id)}">Recusar<span class="so-pc"> pedido</span></button>` : ""}
    <button type="button" class="btn fantasma so-pc" data-imprimir>Imprimir</button>
    ${acao ? `<button type="button" class="btn" data-acao="${esc(p.id)}">${acao.rotulo}</button>` : ""}`;
  $("detalhe").hidden = false;
  document.body.classList.add("com-detalhe");
  pintarIcones($("detalhe"));
}
function fecharDetalhe() {
  P.aberto = null;
  $("detalhe").hidden = true;
  document.body.classList.remove("com-detalhe");
}

/* ===== escritas no Firestore ===== */
async function aceitar(p) {
  if (P.exemplo) { toast("Exemplo: nada é gravado.", "info", 2500); return; }
  const lojaId=P.loja.id, lojaRef=doc(db,"lojas",lojaId), entradaRef=doc(db,"lojas",lojaId,"pedidosEntrada",p.id);
  try {
    const feito = await runTransaction(db,async (tx) => {
      const entrada=await tx.get(entradaRef);
      if (!entrada.exists()) return false; // outra aba já aceitou/recusou
      const atual={id:entrada.id,...entrada.data()}, loja=await tx.get(lojaRef);
      if (atual.pagamento?.online && (!atual.pagamento.pago || atual.pagamento.estornoPendente)) throw new Error("pagamento");
      const refC=atual.cupom ? doc(db,"lojas",lojaId,"cupons",atual.cupom) : null;
      const cupom=refC ? await tx.get(refC) : null;
      if (cupom?.data()?.individual) {
        const reserva=await tx.get(doc(db,"lojas",lojaId,"reservasCupons",atual.cupom));
        if (!reserva.exists() || reserva.data().pedidoId!==p.id || cupom.data().usos!==0) throw new Error("reserva");
      }
      const n=(loja.data().contador || 1000)+1, {id,...dados}=atual;
      const ficha=await camposFicha(atual,{status:"preparo",numero:n},serverTimestamp());
      tx.update(lojaRef,{contador:n});
      if (cupom?.exists()) {
        const c = cupom.data(), reservou = atual.pagamento?.online && atual.pagamento.reservaCupom && !c.individual;
        if (reservou && !(c.reservasOnline > 0)) throw new Error("reserva");
        if (!reservou && c.limite != null && (c.usos || 0) + (c.reservasOnline || 0) >= c.limite) throw new Error("limite");
        tx.update(refC,{usos:(c.usos || 0)+1,...(reservou ? {reservasOnline:c.reservasOnline-1} : {})});
      }
      tx.set(doc(db,"lojas",lojaId,"pedidos",id),{...dados,status:"preparo",numero:n,aceitoEm:serverTimestamp()});
      tx.delete(entradaRef);
      if (temFicha(atual)) tx.set(doc(db,"lojas",lojaId,"clientes",telefoneDe(atual)),ficha,{merge:true});
      return true;
    });
    fecharDetalhe(); toast(feito ? "Pedido aceito." : "Este pedido já foi tratado em outra aba.",feito ? "sucesso" : "info",3500);
  } catch { toast("Não deu para aceitar. Confira a conexão e o cupom do pedido.","erro",4500); }
}
async function mudarStatus(p, status) {
  if (P.exemplo) { toast("Exemplo: nada é gravado.", "info", 2500); return; }
  const lojaId=P.loja.id, pedidoRef=doc(db,"lojas",lojaId,"pedidos",p.id);
  try {
    const feito=await runTransaction(db,async (tx) => {
      const snap=await tx.get(pedidoRef); if (!snap.exists()) return false;
      const atual={id:snap.id,...snap.data()};
      if (atual.status!==p.status || !["preparo","saiu"].includes(atual.status)) return false;
      const campo=status==="saiu" ? {saiuEm:serverTimestamp()} : {concluidoEm:serverTimestamp()};
      const ficha=await camposFicha(atual,{status},serverTimestamp());
      tx.update(pedidoRef,{status,...campo});
      if (temFicha(atual)) tx.set(doc(db,"lojas",lojaId,"clientes",telefoneDe(atual)),ficha,{merge:true});
      return true;
    });
    if (!feito) toast("A situação deste pedido já mudou em outra aba.","info",3500);
  } catch { toast("Não deu para atualizar. Tente de novo.","erro",4000); }
}
async function recusar(p) {
  if (!(await confirmar(p.pagamento?.online ? "Recusar este pedido e solicitar a devolução do pagamento pelo Mercado Pago?" : "Recusar este pedido? O cliente vê na tela do pedido que ele não foi aceito.", { textoConfirmar: p.pagamento?.online ? "Recusar e devolver" : "Recusar" }))) return;
  if (P.exemplo) { toast("Exemplo: nada é gravado.", "info", 2500); return; }
  if (p.pagamento?.online) {
    try {
      await chamarPagamento("recusar", { lojaId: P.loja.id, pedidoId: p.id }, { autenticado: true });
      fecharDetalhe(); toast("Pedido recusado. A situação da devolução aparece no pedido.", "sucesso", 5000);
    } catch (erro) { toast(erro.message || "Não foi possível conferir a devolução. Tente novamente.", "erro", 6000); }
    return;
  }
  const lojaId=P.loja.id, entradaRef=doc(db,"lojas",lojaId,"pedidosEntrada",p.id);
  try {
    const feito=await runTransaction(db,async (tx) => {
      const entrada=await tx.get(entradaRef); if (!entrada.exists()) return false;
      const atual={id:entrada.id,...entrada.data()}, {id,...dados}=atual;
      const reservaRef=atual.cupom ? doc(db,"lojas",lojaId,"reservasCupons",atual.cupom) : null;
      const reserva=reservaRef ? await tx.get(reservaRef) : null;
      const ficha=await camposFicha(atual,{status:"cancelado"},serverTimestamp());
      tx.set(doc(db,"lojas",lojaId,"pedidos",id),{...dados,status:"cancelado",concluidoEm:serverTimestamp()});
      tx.delete(entradaRef);
      if (reserva?.exists() && reserva.data().pedidoId===id) tx.delete(reservaRef);
      if (temFicha(atual)) tx.set(doc(db,"lojas",lojaId,"clientes",telefoneDe(atual)),ficha,{merge:true});
      return true;
    });
    fecharDetalhe(); toast(feito ? "Pedido recusado." : "Este pedido já foi tratado em outra aba.","info",3500);
  } catch { toast("Não deu para recusar. Tente de novo.","erro",4000); }
}
const refFicha = (p) => doc(db, "lojas", P.loja.id, "clientes", telefoneDe(p));
const temFicha = (p) => /^\d{10,11}$/.test(telefoneDe(p)); // a regra só aceita ficha com 10 ou 11 dígitos

// uma vez por loja: os pedidos de antes da ficha também entram nela
async function fichasDosAntigos() {
  if (P.exemplo || P.loja.fichasV1) return;
  try {
    const snap = await getDocs(collection(db, "lojas", P.loja.id, "pedidos"));
    const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => /^\d{10,11}$/.test(telefoneDe(p)));
    for (let i = 0; i < lista.length; i += 400) {
      const batch = writeBatch(db);
      for (const p of lista.slice(i, i + 400)) batch.set(refFicha(p), await camposFicha(p, {}, serverTimestamp()), { merge: true });
      await batch.commit();
    }
    await updateDoc(doc(db, "lojas", P.loja.id), { fichasV1: true });
  } catch (e) { console.warn("fichas dos pedidos antigos: tenta de novo na próxima abertura", e); }
}

async function alternarAberta() {
  const aberta = P.loja.aberta !== false;
  if (P.exemplo) { P.loja.aberta = !aberta; renderChave(); return; }
  try { await updateDoc(doc(db, "lojas", P.loja.id), { aberta: !aberta }); }
  catch { toast("Não deu para mudar. Tente de novo.", "erro", 4000); }
}
function renderChave() {
  const aberta = P.loja.aberta !== false;
  document.querySelectorAll("[data-chave]").forEach((b) => {
    b.setAttribute("aria-pressed", String(aberta));
    b.classList.toggle("desligada", !aberta);
    b.querySelector(".chave-txt").textContent = b.closest(".barra-topo") ? (aberta ? "Aberto" : "Fechado") : (aberta ? "Recebendo pedidos" : "Pausado");
  });
}

/* som curto quando chega pedido novo (o navegador só toca depois de um toque na página) */
function tocar() {
  try {
    const ctx = new AudioContext();
    [0, 0.18].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.12);
    });
  } catch { /* sem áudio */ }
}

/* ===== cliques ===== */
function aoClicar(e) {
  const periodo = e.target.closest("[data-periodo]");
  if (periodo) { escolherPeriodo(periodo.dataset.periodo); return; }
  const acao = e.target.closest("[data-acao]");
  if (acao) { e.stopPropagation(); const p = todos().find((x) => x.id === acao.dataset.acao); const a = p && proximaAcao(p); if (a) a.fazer(); return; }
  const recusarBtn = e.target.closest("[data-recusar]");
  if (recusarBtn) { const p = todos().find((x) => x.id === recusarBtn.dataset.recusar); if (p) recusar(p); return; }
  if (e.target.closest("[data-imprimir]")) { window.print(); return; }
  if (e.target.closest("[data-fechar]") || e.target.id === "detalhe") { fecharDetalhe(); return; }
  const aba = e.target.closest("[data-aba]");
  if (aba) { P.aba = aba.dataset.aba; renderQuadro(); return; }
  if (e.target.closest("[data-ver-todos]")) { P.verTodos = true; renderQuadro(); return; }
  if (e.target.closest("[data-chave]")) { alternarAberta(); return; }
  if (e.target.closest("[data-em-breve]")) { toast("Essa parte do painel é a próxima etapa.", "info", 3000); return; }
  const abrir = e.target.closest("[data-abrir]");
  if (abrir && !e.target.closest("a")) abrirDetalhe(abrir.dataset.abrir);
}
function aoTeclar(e) {
  if (e.key === "Escape" && P.aberto) fecharDetalhe();
  if (e.key === "Enter" && e.target.matches("[data-abrir]")) abrirDetalhe(e.target.dataset.abrir);
}

/* ===== ligar e desligar ===== */
export function iniciarPedidos(loja, { exemplo = null } = {}) {
  pararPedidos();
  P.loja = loja;
  const sessao = P.sessao;
  P.exemplo = !!exemplo;
  P.agora = exemplo ? () => new Date(exemplo.agora) : () => new Date();
  P.periodo = periodoPedidos("hoje", P.agora());
  P.entrada = []; P.pedidos = []; P.verTodos = false; P.aba = "novo";
  P.erroEntrada = ""; P.erroPeriodo = ""; P.carregando = false;
  renderPeriodo(); avisoPeriodo();
  document.querySelectorAll(".nome-loja").forEach((el) => (el.textContent = loja.nome));
  document.addEventListener("click", aoClicar);
  document.addEventListener("keydown", aoTeclar);
  document.addEventListener("submit", aoFiltrar);
  renderChave();
  const relogio = setInterval(() => {
    const atual = periodoPedidos(P.periodo.tipo, P.agora(), P.periodo.de, P.periodo.ate);
    if (atual.de !== P.periodo.de || atual.ate !== P.periodo.ate) {
      P.periodo = atual; renderPeriodo(); consultarPeriodo();
    } else { renderQuadro(); renderIndicadores(); }
  }, 30000);
  P.parar.push(() => clearInterval(relogio));

  if (exemplo) {
    P.entrada = exemplo.entrada;
    P.pedidos = exemplo.pedidos;
    renderQuadro(); renderIndicadores();
    return;
  }
  let primeira = true;
  P.parar.push(onSnapshot(collection(db, "lojas", loja.id, "pedidosEntrada"), (snap) => {
    if (sessao !== P.sessao) return;
    const antes = P.entrada.length;
    P.entrada = snap.docs.map((d) => ({ id: d.id, ...d.data(), status: "novo" }));
    if (!primeira && P.entrada.length > antes) tocar();
    primeira = false;
    P.erroEntrada = "";
    if (!P.erroPeriodo && !P.carregando) avisoPeriodo();
    atualizarPedidos();
  }, () => {
    if (sessao !== P.sessao) return;
    P.erroEntrada = "Não foi possível atualizar os pedidos novos. Confira a conexão e reabra o painel.";
    avisoPeriodo(P.erroEntrada, true);
  }));
  consultarPeriodo();
  P.parar.push(onSnapshot(doc(db, "lojas", loja.id), (snap) => { if (sessao === P.sessao && snap.exists()) { P.loja = { id: snap.id, ...snap.data() }; renderChave(); } }));
  fichasDosAntigos();
}
export function abrirPedido(id) { abrirDetalhe(id); }
export function pararPedidos() {
  ++P.sessao; ++P.versao;
  P.pararPeriodo?.(); P.pararPeriodo = null;
  P.parar.forEach((f) => f());
  P.parar = [];
  document.removeEventListener("click", aoClicar);
  document.removeEventListener("keydown", aoTeclar);
  document.removeEventListener("submit", aoFiltrar);
  fecharDetalhe();
}
