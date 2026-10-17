/*
  cupons.js: Cupons do painel (imagens PD50, P50, P51).

    lojas/{loja}/cupons/{CODIGO}   tipo, valor, minimo, validoAte, limite, usos, ativo
  A conta do desconto mora em cupom.js, a mesma da loja e da regra do Firestore.
  Os usos sobem quando o pedido com cupom é aceito (pedidos.js).
  Endereços: #cupons, #cupons/novo, #cupons/<CODIGO>. No modo exemplo nada é gravado.
*/

import { db } from "./firebase-init.js?v=2";
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, getDoc, getDocs, query, where, Timestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { esc, fmtMoeda, toast, confirmar } from "./shared.js?v=1";
import { pintarIcones } from "./icones.js?v=3";
import { normalizarCodigo, codigoValido, descontoDe } from "./cupom.js?v=1";

const $ = (id) => document.getElementById(id);
const reais = (c) => fmtMoeda((c || 0) / 100);
const pc = window.matchMedia("(min-width: 1024px)");
const U = { loja: null, exemplo: false, cupons: [], mes: { usos: 0, desconto: 0, vendido: 0 }, janela: null, rasc: null, parar: [], avisou: false };

const comoData = (v) => (v instanceof Date ? v : v?.toDate ? v.toDate() : v ? new Date(v) : null);
const ddmm = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
const vencido = (c) => { const d = comoData(c.validoAte); return !!d && new Date() > d; };
const esgotado = (c) => c.limite != null && (c.usos || 0) >= c.limite;
const valeAgora = (c) => c.ativo && !vencido(c) && !esgotado(c);
const textoValor = (c) => (c.tipo === "pct" ? `${c.valor}%` : reais(c.valor));
const textoMinimo = (c) => (c.minimo ? `A partir de ${reais(c.minimo)}` : "Sem mínimo");
const textoUsos = (c) => (c.limite != null ? `${c.usos || 0} de ${c.limite}` : `${c.usos || 0}`);
function textoValidade(c) {
  const d = comoData(c.validoAte);
  if (!d) return "Sem data";
  return vencido(c) ? `venceu ${ddmm(d)}` : `até ${ddmm(d)}`;
}
// linha de baixo no celular: "A partir de R$ 60,00 · 21 usos"
// vencido mostra só a data e os usos (P50)
function resumoCel(c) {
  const usos = c.limite != null ? `${c.usos || 0} de ${c.limite} usos` : `${c.usos || 0} usos`;
  if (vencido(c)) return `<span class="venc">Venceu em ${ddmm(comoData(c.validoAte))}</span> · ${usos}`;
  const partes = [textoMinimo(c)];
  if (comoData(c.validoAte)) partes.push(`até ${ddmm(comoData(c.validoAte))}`);
  partes.push(c.ativo ? usos : "desligado");
  return partes.join(" · ");
}

/* ===== gravar: no Firestore, ou só na tela no modo exemplo ===== */
async function gravar(fazer, local) {
  if (U.exemplo) {
    local();
    if (!U.avisou) { toast("Exemplo: as mudanças ficam só nesta tela.", "info", 3000); U.avisou = true; }
    render();
    return true;
  }
  try { await fazer(); return true; }
  catch { toast("Não deu para salvar. Confira a internet e tente de novo.", "erro", 4500); return false; }
}
const refCupom = (codigo) => doc(db, "lojas", U.loja.id, "cupons", codigo);

/* ===== PD50 / P50 ===== */
function render() {
  if (!U.loja) return;
  const ativos = U.cupons.filter(valeAgora).length;
  $("u-kpis").innerHTML = `
    <div class="kpi"><small>Cupons ativos</small><b>${ativos}</b><em class="neutro so-pc">de ${U.cupons.length} cadastrados</em></div>
    <div class="kpi"><small>Usados este mês</small><b>${U.mes.usos}</b><em class="neutro so-pc">pedidos com cupom</em></div>
    <div class="kpi"><small>Desconto dado</small><b>${reais(U.mes.desconto)}</b><em class="neutro so-pc">este mês</em></div>
    <div class="kpi so-pc"><small>Vendido com cupom</small><b>${reais(U.mes.vendido)}</b><em class="neutro">este mês</em></div>`;
  // valendo primeiro, depois os desligados, os vencidos por último
  const peso = (c) => (valeAgora(c) ? 0 : vencido(c) ? 2 : 1);
  const ordem = [...U.cupons].sort((a, b) => peso(a) - peso(b) || a.codigo.localeCompare(b.codigo));
  $("u-lista").innerHTML = !ordem.length
    ? `<p class="vazio-c">Nenhum cupom ainda. Use ${pc.matches ? "Novo cupom" : "+ Cupom"} para criar o primeiro.</p>`
    : `
    <div class="so-pc">
      <div class="tab-cab u-g"><span>Código</span><span>Desconto</span><span>Pedido mínimo</span><span>Validade</span><span>Usos</span><span>Ligado</span><span></span></div>
      ${ordem.map((c) => `
        <div class="tab-l u-g${valeAgora(c) ? "" : " apagada"}">
          <span><b>${esc(c.codigo)}</b></span><span>${textoValor(c)}</span><span>${c.minimo ? reais(c.minimo) : "Sem mínimo"}</span>
          <span class="${vencido(c) ? "venc" : ""}">${textoValidade(c)}</span><span>${textoUsos(c)}</span>
          <span><button type="button" class="chave-u${c.ativo ? "" : " off"}" data-ligar-cupom="${esc(c.codigo)}" aria-label="${c.ativo ? "Desligar" : "Ligar"} ${esc(c.codigo)}"><span class="trilho"></span></button></span>
          <span class="acoes"><a href="#cupons/${esc(c.codigo)}" aria-label="Editar ${esc(c.codigo)}"><i data-ic="editar"></i></a><button type="button" data-excluir-cupom="${esc(c.codigo)}" aria-label="Excluir ${esc(c.codigo)}"><i data-ic="lixo"></i></button></span>
        </div>`).join("")}
      <div class="rodape-t"><i data-ic="info"></i><span>O desconto vale sobre os itens, não sobre a entrega. O cliente usa um cupom por pedido.</span></div>
    </div>
    <div class="so-cel">
      ${ordem.map((c) => `
        <div class="cup${valeAgora(c) ? "" : " off"}">
          <a class="t" href="#cupons/${esc(c.codigo)}"><span class="cod">${esc(c.codigo)}</span><span class="val">${textoValor(c)}</span><small>${resumoCel(c)}</small></a>
          <button type="button" class="chave-u${c.ativo ? "" : " off"}" data-ligar-cupom="${esc(c.codigo)}" aria-label="${c.ativo ? "Desligar" : "Ligar"} ${esc(c.codigo)}"><span class="trilho"></span></button>
          <a href="#cupons/${esc(c.codigo)}" aria-label="Editar ${esc(c.codigo)}"><i data-ic="direita"></i></a>
        </div>`).join("")}
    </div>`;
  pintarIcones($("vista-cupons"));
}

// usos do mês: os pedidos aceitos com cupom desde o dia 1
async function lerMes() {
  if (U.exemplo) { U.mes = { usos: 37, desconto: 21460, vendido: 213000 }; render(); return; }
  const ini = new Date(); ini.setDate(1); ini.setHours(0, 0, 0, 0);
  try {
    const snap = await getDocs(query(collection(db, "lojas", U.loja.id, "pedidos"), where("criadoEm", ">=", Timestamp.fromDate(ini))));
    const com = snap.docs.map((d) => d.data()).filter((p) => p.cupom && p.status !== "cancelado");
    U.mes = { usos: com.length, desconto: com.reduce((s, p) => s + (p.desconto || 0), 0), vendido: com.reduce((s, p) => s + (p.total || 0), 0) };
  } catch { /* os indicadores ficam em zero */ }
  render();
}

/* ===== P51 / janela do PD50: novo e editar ===== */
const centavosDe = (t) => Math.round(Number(String(t || "").replace(/\./g, "").replace(",", ".")) * 100);
const mostrarCentavos = (c) => (c / 100).toFixed(2).replace(".", ",");
const dataDoCampo = (v) => (v ? new Date(`${v}T23:59:59-03:00`) : null); // fim do dia em Belém
const campoDaData = (d) => { const x = comoData(d); return x ? `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}` : ""; };

function textoPrevia(r) {
  const base = Math.max(8000, r.minimo || 0);
  const c = { tipo: r.tipo, valor: r.tipo === "pct" ? Math.min(100, Math.max(0, Math.round(r.valor || 0))) : Math.max(0, r.valor || 0) };
  if (!c.valor) return "Preencha o desconto para ver a conta.";
  return `Num pedido de ${reais(base)} em itens, o cliente paga ${reais(base - descontoDe(c, base))} mais a entrega.`;
}
function lerForm() {
  const r = U.rasc;
  if (!r.editando) r.codigo = normalizarCodigo($("u-codigo").value);
  r.valor = r.tipo === "pct" ? Math.round(Number(String($("u-valor").value).replace(",", "."))) : centavosDe($("u-valor").value);
  r.minimo = $("u-minimo").value.trim() ? centavosDe($("u-minimo").value) : 0;
  r.validoAte = $("u-validade").value || "";
  r.limite = $("u-limite").value.trim() ? Math.round(Number($("u-limite").value)) : null;
  return r;
}
function abrirCupom(codigo) {
  const c = codigo === "novo" ? null : U.cupons.find((x) => x.codigo === codigo);
  if (codigo !== "novo" && !c) { if (U.carregou) location.hash = "#cupons"; else fecharJanela(); return; }
  const outro = !U.rasc || (c ? !(U.rasc.editando && U.rasc.codigo === c.codigo) : U.rasc.editando);
  if (outro) U.rasc = c ? { ...c, editando: true, validoAte: campoDaData(c.validoAte) } : { codigo: "", tipo: "pct", valor: 10, minimo: 0, validoAte: "", limite: null, ativo: true, usos: 0, editando: false };
  const r = U.rasc;
  $("u-cab").innerHTML = `<a class="voltar so-cel" href="#cupons" aria-label="Voltar"><i data-ic="esquerda"></i></a><h2 id="u-titulo">${c ? "Editar cupom" : "Novo cupom"}</h2><a class="fechar so-pc" href="#cupons" aria-label="Fechar"><i data-ic="x"></i></a>`;
  $("u-corpo").innerHTML = `
    <div class="sec u-form">
      <div class="campo"><label for="u-codigo">Código</label><input id="u-codigo" class="cod" maxlength="20" value="${esc(r.codigo)}" ${r.editando ? "disabled" : ""} autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Ex.: PIZZA10" />
        <p class="ajuda">${r.editando ? "O código não muda depois de criado. Para outro código, crie um cupom novo." : "Letras e números, sem espaço. O cliente digita na sacola."}</p></div>
      <div class="campo"><label>Tipo de desconto</label><div class="seg u-seg"><button type="button" data-tipo-cupom="pct" class="${r.tipo === "pct" ? "on" : ""}">Porcentagem</button><button type="button" data-tipo-cupom="valor" class="${r.tipo === "valor" ? "on" : ""}">Valor em R$</button></div></div>
      <div class="dupla">
        <div class="campo"><label for="u-valor">Desconto</label><div class="in">${r.tipo === "valor" ? "<small>R$</small>" : ""}<input id="u-valor" inputmode="decimal" value="${r.valor ? (r.tipo === "pct" ? r.valor : mostrarCentavos(r.valor)) : ""}" />${r.tipo === "pct" ? '<small class="un">%</small>' : ""}</div></div>
        <div class="campo"><label for="u-minimo">Pedido mínimo</label><div class="in"><small>R$</small><input id="u-minimo" inputmode="decimal" value="${r.minimo ? mostrarCentavos(r.minimo) : ""}" placeholder="Sem mínimo" /></div></div>
      </div>
      <div class="dupla">
        <div class="campo"><label for="u-validade">Válido até</label><input id="u-validade" type="${r.validoAte ? "date" : "text"}" value="${esc(r.validoAte || "")}" placeholder="Sem data" data-data /></div>
        <div class="campo"><label for="u-limite">Limite de usos</label><input id="u-limite" inputmode="numeric" value="${r.limite ?? ""}" placeholder="Sem limite" /></div>
      </div>
      <div class="auto-u"><div>Cupom ligado<small>Desligado, o código deixa de valer na hora.</small></div><button type="button" class="chave-u${r.ativo ? "" : " off"}" data-ativo-form aria-label="Ligar ou desligar o cupom"><span class="trilho"></span></button></div>
      <div class="previa-u" data-previa-u>${textoPrevia(r)}</div>
    </div>
    ${c ? `<button type="button" class="excluir so-cel" data-excluir-cupom="${esc(c.codigo)}"><i data-ic="lixo"></i>Excluir cupom</button>` : ""}`;
  $("u-pe").innerHTML = `
    ${c ? `<button type="button" class="excluir so-pc" data-excluir-cupom="${esc(c.codigo)}"><i data-ic="lixo"></i>Excluir</button>` : ""}
    <a class="btn fantasma so-pc" href="#cupons">Cancelar</a>
    <button type="button" class="btn" data-salvar-cupom>Salvar cupom</button>`;
  pintarIcones($("u-modal"));
}
async function salvarCupom() {
  const r = lerForm();
  if (!codigoValido(r.codigo)) return toast("O código precisa de 3 a 20 letras ou números.", "erro", 3500);
  if (!r.editando && U.cupons.some((c) => c.codigo === r.codigo)) return toast("Já existe um cupom com esse código.", "erro", 3500);
  if (!Number.isFinite(r.valor) || r.valor <= 0) return toast("Digite o valor do desconto.", "erro", 3000);
  if (r.tipo === "pct" && r.valor > 100) return toast("A porcentagem vai até 100.", "erro", 3000);
  if (!Number.isFinite(r.minimo) || r.minimo < 0) return toast("Pedido mínimo: digite só o valor, por exemplo 60,00.", "erro", 3500);
  if (r.limite != null && (!Number.isInteger(r.limite) || r.limite < 1)) return toast("Limite de usos: um número inteiro, ou deixe vazio.", "erro", 3500);
  const ate = dataDoCampo(r.validoAte);
  const dados = { tipo: r.tipo, valor: r.valor, minimo: r.minimo, validoAte: ate ? Timestamp.fromDate(ate) : null, limite: r.limite, ativo: !!r.ativo };
  if (!r.editando && !U.exemplo) {
    // o código é o id: confere no banco, porque a lista pode estar atrasada
    try { if ((await getDoc(refCupom(r.codigo))).exists()) return toast("Já existe um cupom com esse código.", "erro", 3500); } catch { /* segue: a gravação avisa */ }
  }
  const ok = await gravar(
    () => (r.editando ? updateDoc(refCupom(r.codigo), dados) : setDoc(refCupom(r.codigo), { ...dados, usos: 0 })),
    () => {
      const i = U.cupons.findIndex((c) => c.codigo === r.codigo);
      const novo = { codigo: r.codigo, ...dados, validoAte: ate, usos: i >= 0 ? U.cupons[i].usos : 0 };
      if (i >= 0) U.cupons[i] = novo; else U.cupons.push(novo);
    });
  if (!ok) return;
  if (!U.exemplo) toast(r.editando ? "Cupom salvo." : "Cupom criado.", "sucesso", 2500);
  location.hash = "#cupons";
}
async function ligarCupom(codigo) {
  const c = U.cupons.find((x) => x.codigo === codigo);
  if (!c) return;
  await gravar(() => updateDoc(refCupom(codigo), { ativo: !c.ativo }), () => { c.ativo = !c.ativo; });
}
async function excluirCupom(codigo) {
  if (!(await confirmar(`Excluir o cupom ${codigo}? Quem tiver o código não consegue mais usar.`, { textoConfirmar: "Excluir" }))) return;
  const ok = await gravar(() => deleteDoc(refCupom(codigo)), () => { U.cupons = U.cupons.filter((c) => c.codigo !== codigo); });
  if (ok && U.janela) location.hash = "#cupons";
}

function abrirJanela() {
  U.janela = true;
  $("u-modal").hidden = false;
  document.body.classList.add("com-janela");
}
function fecharJanela() {
  U.janela = null; U.rasc = null;
  $("u-modal").hidden = true;
  document.body.classList.remove("com-janela");
}

/* ===== entrada pelo endereço ===== */
export function mostrarCupons(partes) {
  const [, codigo] = partes;
  if (!U.loja) return;
  if (codigo) {
    if (!U.janela || (U.rasc?.editando ? U.rasc.codigo : "novo") !== codigo) { fecharJanela(); render(); lerMes(); abrirJanela(); abrirCupom(codigo); }
    return;
  }
  fecharJanela();
  render();
  lerMes();
}
export function fecharCupons() { if (U.janela) fecharJanela(); }

function aoClicar(e) {
  if ($("vista-cupons").hidden && $("u-modal").hidden) return;
  const alvo = (s) => e.target.closest(s);
  let el;
  if (e.target.id === "u-modal") { if (pc.matches) location.hash = "#cupons"; return; }
  if ((el = alvo("[data-ligar-cupom]"))) { ligarCupom(el.dataset.ligarCupom); return; }
  if ((el = alvo("[data-excluir-cupom]"))) { excluirCupom(el.dataset.excluirCupom); return; }
  if ((el = alvo("[data-tipo-cupom]"))) { lerForm(); U.rasc.tipo = el.dataset.tipoCupom; U.rasc.valor = 0; abrirCupom(U.rasc.editando ? U.rasc.codigo : "novo"); return; }
  if (alvo("[data-ativo-form]")) { U.rasc.ativo = !U.rasc.ativo; alvo("[data-ativo-form]").classList.toggle("off", !U.rasc.ativo); return; }
  if (alvo("[data-salvar-cupom]")) { salvarCupom(); return; }
}
function aoDigitar(e) {
  if (!U.janela || !e.target.closest("#u-modal")) return;
  if (e.target.id === "u-codigo") e.target.value = normalizarCodigo(e.target.value);
  const p = document.querySelector("[data-previa-u]");
  if (p) p.textContent = textoPrevia(lerForm());
}
function aoFocar(e) {
  const d = e.target.closest?.("[data-data]");
  if (!d || d.type === "date") return;
  d.type = "date";
  try { d.showPicker(); } catch { /* navegador sem showPicker */ }
}
function aoSair(e) {
  const d = e.target.closest?.("[data-data]");
  if (d && !d.value) d.type = "text";
}
function aoTeclar(e) {
  if (e.key === "Escape" && U.janela) { e.preventDefault(); location.hash = "#cupons"; }
}

/* ===== ligar e desligar ===== */
export function iniciarCupons(loja, { exemplo = null } = {}) {
  pararCupons();
  U.loja = { ...loja };
  document.addEventListener("click", aoClicar);
  document.addEventListener("input", aoDigitar);
  document.addEventListener("keydown", aoTeclar);
  document.addEventListener("focusin", aoFocar);
  document.addEventListener("focusout", aoSair);
  if (exemplo) {
    U.exemplo = true;
    U.cupons = exemplo.map((c) => ({ ...c }));
    U.carregou = true;
    return;
  }
  U.exemplo = false;
  U.carregou = false;
  U.parar.push(onSnapshot(collection(db, "lojas", loja.id, "cupons"), (snap) => {
    U.cupons = snap.docs.map((d) => ({ codigo: d.id, ...d.data() }));
    const primeira = !U.carregou;
    U.carregou = true;
    render();
    if (primeira && !U.janela && location.hash.startsWith("#cupons/")) mostrarCupons(location.hash.slice(1).split("/"));
  }, () => toast("Não deu para ler os cupons.", "erro", 5000)));
}
export function pararCupons() {
  U.parar.forEach((f) => f());
  U.parar = [];
  document.removeEventListener("click", aoClicar);
  document.removeEventListener("input", aoDigitar);
  document.removeEventListener("keydown", aoTeclar);
  document.removeEventListener("focusin", aoFocar);
  document.removeEventListener("focusout", aoSair);
}

