/*
  entregas.js: Entregas e bairros do painel (imagens PD30 a PD32, P30 a P33).

  Grava o que a loja usa para a taxa (loja-dados.js, conta-entrega.js):
    lojas/{loja}           local { lat, lng }, endereco, entrega { taxaBairro, porKm,
                           arredondar, raioMaxKm, minutosBase, minutosPorKm }
    lojas/{loja}/bairros   nome, lat, lng
  O bairro do próprio restaurante (lojas/{loja}.bairro) entra sozinho na lista
  e não se exclui: é a base da taxa. Mapa e busca pelo OpenStreetMap (Leaflet e
  Nominatim), sem chave. No modo exemplo (?exemplo=painel) nada é gravado.

  Endereços: #entregas, #entregas/bairro/<id|novo>, #entregas/ponto, #entregas/regra (celular).
*/

import { db } from "./firebase-init.js?v=2";
import { collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { esc, fmtMoeda, toast, confirmar, gerarId } from "./shared.js?v=1";
import { pintarIcones } from "./icones.js?v=3";
import { regraDe, distanciaKm, taxaKm, minutosKm } from "./conta-entrega.js?v=1";

const $ = (id) => document.getElementById(id);
const reais = (c) => fmtMoeda((c || 0) / 100);
const km1 = (km) => `${km.toFixed(1).replace(".", ",")} km`.replace(",0 km", " km");
const semAcento = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const pc = window.matchMedia("(min-width: 1024px)");
const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";

const E = { loja: null, exemplo: false, bairros: [], janela: null, rasc: null, mapa: null, mini: null, parar: [], avisou: false };

/* ===== conta de cada bairro (a mesma da loja) ===== */
function linhas() {
  const e = regraDe(E.loja);
  const base = semAcento(E.loja.bairro);
  const proprio = E.loja.bairro ? [{ id: null, nome: E.loja.bairro, proprio: true, km: 0 }] : [];
  const outros = E.bairros.filter((b) => semAcento(b.nome) !== base)
    .map((b) => ({ ...b, km: E.loja.local && b.lat != null ? distanciaKm(E.loja.local, b) : null }))
    .sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9) || a.nome.localeCompare(b.nome));
  return [...proprio, ...outros].map((b) => {
    if (b.km == null) return { ...b, estado: "sem-ponto" };
    const min = minutosKm(b.km, e);
    return { ...b, estado: b.km <= e.raioMaxKm ? "ok" : "fora", taxa: taxaKm(b.km, !!b.proprio, e), min, max: min + 10 };
  });
}

/* ===== gravar: no Firestore, ou só na tela no modo exemplo ===== */
async function gravar(fazer, local) {
  if (E.exemplo) {
    local();
    if (!E.avisou) { toast("Exemplo: as mudanças ficam só nesta tela.", "info", 3000); E.avisou = true; }
    render();
    return true;
  }
  try { await fazer(); return true; }
  catch { toast("Não deu para salvar. Confira a internet e tente de novo.", "erro", 4500); return false; }
}
const refLoja = () => doc(db, "lojas", E.loja.id);

/* ===== PD30 / P30 ===== */
function renderIndicadores(ls) {
  const e = regraDe(E.loja);
  const ok = ls.filter((l) => l.estado === "ok");
  const barata = ok.reduce((m, l) => (!m || l.taxa < m.taxa ? l : m), null);
  const cara = ok.reduce((m, l) => (!m || l.taxa > m.taxa ? l : m), null);
  $("e-kpis").innerHTML = `
    <div class="kpi"><small>Bairros atendidos</small><b>${ok.length}</b><em class="neutro so-pc">${E.loja.bairro ? "contando o do restaurante" : "o restaurante ainda não tem bairro"}</em></div>
    <div class="kpi"><small>Taxa mais barata</small><b>${barata ? reais(barata.taxa) : "-"}</b><em class="neutro so-pc">${barata ? `no ${esc(barata.nome)}` : ""}</em></div>
    <div class="kpi"><small>Taxa mais cara</small><b>${cara ? reais(cara.taxa) : "-"}</b><em class="neutro so-pc">${cara ? `${esc(cara.nome)}, a ${km1(cara.km)}` : ""}</em></div>
    <div class="kpi so-pc"><small>Alcance</small><b>${e.raioMaxKm} km</b><em class="neutro">depois disso, não entrega</em></div>`;
}

function marcaEstado(l) {
  if (l.proprio) return `<span class="proprio">Do restaurante</span>`;
  if (l.estado === "sem-ponto") return `<span class="aviso-b">Sem distância</span>`;
  if (l.estado === "fora") return `<span class="aviso-b">Fora do alcance</span>`;
  return "";
}
function renderBairros(ls) {
  const tempo = (l) => (l.estado === "sem-ponto" ? "-" : `${l.min} a ${l.max} min`);
  const taxa = (l) => (l.estado === "ok" ? reais(l.taxa) : "-");
  const dist = (l) => (l.km == null ? "-" : l.proprio ? "0 km" : km1(l.km));
  $("e-bairros").innerHTML = `
    <div class="e-cab"><h2 class="so-pc">Bairros atendidos</h2><span class="sec-t so-cel">Bairros atendidos</span><small class="so-pc">do mais perto ao mais longe</small></div>
    <div class="so-pc">
      <div class="tab-cab"><span>Bairro</span><span>Distância</span><span>Taxa</span><span>Tempo</span><span></span></div>
      ${ls.map((l) => `
        <div class="tab-l${l.estado !== "ok" ? " apagada" : ""}">
          <span><b>${esc(l.nome)}</b>${marcaEstado(l)}</span><span>${dist(l)}</span><span class="taxa">${taxa(l)}</span><span>${tempo(l)}</span>
          <span class="acoes">${l.proprio ? "" : `<a href="#entregas/bairro/${esc(l.id)}" aria-label="Editar ${esc(l.nome)}"><i data-ic="editar"></i></a><button type="button" data-excluir-bairro="${esc(l.id)}" aria-label="Excluir ${esc(l.nome)}"><i data-ic="lixo"></i></button>`}</span>
        </div>`).join("")}
    </div>
    <div class="so-cel">
      ${ls.map((l) => {
        const dentro = `<span class="t"><b>${esc(l.nome)}${marcaEstado(l)}</b><small>${dist(l)} · ${tempo(l)}</small></span><span class="v">${taxa(l)}</span>`;
        return l.proprio ? `<div class="bai">${dentro}</div>` : `<a class="bai" href="#entregas/bairro/${esc(l.id)}">${dentro}<i data-ic="direita"></i></a>`;
      }).join("")}
    </div>
    ${ls.length <= 1 ? `<p class="vazio-c">Nenhum outro bairro ainda. Use Adicionar bairro.</p>` : ""}
    <div class="rodape-t so-pc"><i data-ic="info"></i><span>Bairro fora da lista: o cliente vê "Ainda não entregamos nesse bairro". A distância é em linha reta, do restaurante até o centro do bairro.</span></div>`;
}

function renderPonto() {
  const l = E.loja;
  $("e-ponto").innerHTML = `
    <div class="e-cab"><h2 class="so-pc">Ponto de saída</h2><span class="sec-t so-cel">Ponto de saída</span><a href="#entregas/ponto">${l.local ? "Alterar" : "Marcar"}</a></div>
    ${l.local
      ? `<div class="ponto-corpo"><div class="mapa-mini" id="e-mini"></div>
          <div class="ponto-t"><b>${esc(l.endereco || "Ponto marcado no mapa")}</b><p><span class="so-pc">${esc([l.bairro, l.cidade].filter(Boolean).join(", "))} · é daqui que a distância é medida</span><span class="so-cel">${esc(l.bairro || "")} · os bairros são medidos daqui</span></p></div></div>`
      : `<div class="ponto-vazio"><p>Marque no mapa de onde sai a entrega. Sem esse ponto, só o bairro do restaurante tem taxa.</p><a class="btn" href="#entregas/ponto">Marcar no mapa</a></div>`}`;
  if (l.local) miniMapa();
}

const CAMPOS_REGRA = [
  ["taxaBairro", "No bairro do restaurante", "R$", "dinheiro"],
  ["porKm", "A mais por km, nos outros", "R$", "dinheiro"],
  ["arredondar", "Arredondar para cima em", "R$", "dinheiro"],
  ["raioMaxKm", "Entrega até", "km", "numero"],
  ["minutosBase", "Tempo de preparo", "min", "numero"],
  ["minutosPorKm", "A mais por km", "min", "numero"],
];
const mostrarCentavos = (c) => (c / 100).toFixed(2).replace(".", ",");
// rotulos: textos do celular (P32), quando diferem do computador (PD30)
function camposRegra(e, chaves = CAMPOS_REGRA.map((c) => c[0]), rotulos = {}, ajudas = {}) {
  return CAMPOS_REGRA.filter(([k]) => chaves.includes(k)).map(([k, rotPc, un, tipo]) => [k, rotulos[k] || rotPc, un, tipo]).map(([k, rot, un, tipo]) => `
    <div class="campo c-${k}"><label>${rot}</label><div class="in">${tipo === "dinheiro" ? `<small>R$</small>` : ""}<input data-regra="${k}" inputmode="decimal" value="${tipo === "dinheiro" ? mostrarCentavos(e[k]) : e[k]}" aria-label="${rot}" />${tipo === "numero" ? `<span class="un">${un}</span>` : ""}</div>${ajudas[k] ? `<p class="ajuda">${ajudas[k]}</p>` : ""}</div>`).join("");
}
function textoSimula(e) {
  if (!e) return "Confira os valores: use só números, como 1,50.";
  const min = minutosKm(3, e);
  return `Exemplo: um bairro a 3 km paga ${reais(taxaKm(3, false, e))} e recebe em ${min} a ${min + 10} min.`;
}
function renderRegra() {
  const e = regraDe(E.loja);
  $("e-regra").innerHTML = `
    <div class="e-cab"><h2 class="so-pc">Regra da taxa</h2><span class="sec-t so-cel">Regra da taxa</span><a class="so-cel" href="#entregas/regra">Alterar</a></div>
    <div class="regra so-pc" data-form-regra>
      <div class="r-g">${camposRegra(e)}</div>
      <div class="simula"><i data-ic="check"></i><span data-simula>${textoSimula(e)}</span></div>
      <button type="button" class="btn" data-salvar-regra>Salvar regra</button>
    </div>
    <div class="regra-r so-cel"><b>${reais(e.taxaBairro)}</b> no bairro do restaurante<br><b>+ ${reais(e.porKm)} por km</b> nos outros, até <b>${e.raioMaxKm} km</b><br>Tempo: <b>${e.minutosBase} min + ${e.minutosPorKm} por km</b></div>`;
}

function render() {
  if (!E.loja) return;
  const ls = linhas();
  renderIndicadores(ls);
  renderBairros(ls);
  renderPonto();
  // com o cursor dentro da regra, redesenhar apagaria o que está sendo digitado
  if (!$("e-regra").contains(document.activeElement)) renderRegra();
  pintarIcones($("vista-entregas"));
}

/* ===== regra: lê o formulário (do lado no computador ou da janela no celular) ===== */
function lerRegra(raiz) {
  const r = {};
  for (const [k, , , tipo] of CAMPOS_REGRA) {
    const v = raiz.querySelector(`[data-regra="${k}"]`).value.trim().replace(/\./g, "").replace(",", ".");
    const n = Number(v);
    if (v === "" || !Number.isFinite(n) || n < 0) return null;
    r[k] = tipo === "dinheiro" ? Math.round(n * 100) : n;
  }
  if (r.raioMaxKm <= 0 || r.raioMaxKm > 100) return null;
  r.minutosBase = Math.round(r.minutosBase);
  return r;
}
async function salvarRegra(raiz) {
  const r = lerRegra(raiz);
  if (!r) return toast("Confira a regra: só números, como 1,50, e o alcance entre 1 e 100 km.", "erro", 4500);
  const ok = await gravar(() => updateDoc(refLoja(), { entrega: r }), () => { E.loja.entrega = r; });
  if (!ok) return;
  if (!E.exemplo) toast("Regra salva. A loja já usa os novos valores.", "sucesso", 3000);
  if (E.janela?.tipo === "regra") location.hash = "#entregas";
}

/* ===== mapa (Leaflet + OpenStreetMap) ===== */
function carregarLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((ok, falha) => {
    const s = document.createElement("script");
    s.src = LEAFLET; s.onload = () => ok(window.L); s.onerror = falha;
    document.head.appendChild(s);
  });
}
const pinoSvg = (cor, meio) => `<svg viewBox="-14 -36 28 38" width="28" height="38" aria-hidden="true">${meio ? `<circle r="14" fill="${cor}" fill-opacity=".14"/>` : ""}<path d="M0 0c-7-9-12-15-12-21a12 12 0 0 1 24 0c0 6-5 12-12 21z" fill="${cor}"/><circle cy="-21" r="4.4" fill="#fff"/></svg>`;
const icone = (L, tipo) => L.divIcon({ className: "pino-mapa", html: pinoSvg(tipo === "restaurante" ? "#991b1b" : "#1d4ed8", tipo === "restaurante"), iconSize: [28, 38], iconAnchor: [14, 36] });
function camadaOsm(L) {
  return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" });
}
async function miniMapa() {
  const el = $("e-mini");
  if (!el) return;
  try {
    const L = await carregarLeaflet();
    if (E.mini) { E.mini.remove(); E.mini = null; }
    if (!document.body.contains(el)) return;
    const p = [E.loja.local.lat, E.loja.local.lng];
    E.mini = L.map(el, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false }).setView(p, 15);
    camadaOsm(L).addTo(E.mini);
    L.marker(p, { icon: icone(L, "restaurante"), interactive: false }).addTo(E.mini);
  } catch { el.textContent = ""; }
}
async function mapaJanela(pinos, aoMover) {
  const L = await carregarLeaflet();
  if (E.mapa) { E.mapa.remove(); E.mapa = null; }
  const el = $("e-mapa");
  if (!el) return null;
  const pontos = pinos.filter((p) => p.lat != null);
  E.mapa = L.map(el, { attributionControl: true });
  camadaOsm(L).addTo(E.mapa);
  const marcas = {};
  pinos.forEach((p) => {
    if (p.lat == null) return;
    marcas[p.tipo] = L.marker([p.lat, p.lng], { icon: icone(L, p.tipo), draggable: !!p.arrasta }).addTo(E.mapa);
    if (p.arrasta) marcas[p.tipo].on("dragend", () => aoMover(marcas[p.tipo].getLatLng()));
  });
  const arrastavel = pinos.find((p) => p.arrasta);
  E.mapa.on("click", (ev) => {
    if (!arrastavel) return;
    if (!marcas[arrastavel.tipo]) marcas[arrastavel.tipo] = L.marker(ev.latlng, { icon: icone(L, arrastavel.tipo), draggable: true }).addTo(E.mapa).on("dragend", () => aoMover(marcas[arrastavel.tipo].getLatLng()));
    else marcas[arrastavel.tipo].setLatLng(ev.latlng);
    aoMover(ev.latlng);
  });
  if (pontos.length > 1) E.mapa.fitBounds(pontos.map((p) => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 15 });
  else if (pontos.length) E.mapa.setView([pontos[0].lat, pontos[0].lng], 15);
  else E.mapa.setView([-15.8, -47.9], 4); // sem ponto nenhum: o Brasil inteiro
  setTimeout(() => E.mapa?.invalidateSize(), 50);
  return { L, marcas };
}
// busca de lugar no OpenStreetMap (Nominatim): só o texto do bairro ou do endereço sai daqui
async function buscarLugar(texto) {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.search = new URLSearchParams({ q: texto, format: "jsonv2", limit: "1", countrycodes: "br", "accept-language": "pt-BR" });
  const r = await fetch(u, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("busca");
  const [achado] = await r.json();
  return achado ? { lat: Number(achado.lat), lng: Number(achado.lon) } : null;
}
const ondeBuscar = (t) => [t, E.loja.cidade].filter(Boolean).join(", ");

/* ===== janelas: bairro (PD31 / P31), ponto de saída (PD32 / P33), regra (P32) ===== */
function cabecalho(titulo) {
  return `<a class="voltar so-cel" href="#entregas" aria-label="Voltar"><i data-ic="esquerda"></i></a><h2 id="e-titulo">${titulo}</h2><a class="fechar so-pc" href="#entregas" aria-label="Fechar"><i data-ic="x"></i></a>`;
}
function resultadoBairro() {
  const r = E.rasc, el = $("e-resultado");
  if (!el) return;
  if (r.lat == null) { el.className = "resultado neutro"; el.innerHTML = `<i data-ic="info"></i><span>Busque pelo nome ou toque no mapa onde fica o meio do bairro.</span>`; }
  else if (!E.loja.local) { el.className = "resultado alerta"; el.innerHTML = `<i data-ic="info"></i><span>Marque o ponto de saída para calcular a taxa.</span>`; }
  else {
    const e = regraDe(E.loja), km = distanciaKm(E.loja.local, r), min = minutosKm(km, e);
    if (km > e.raioMaxKm) { el.className = "resultado alerta"; el.innerHTML = `<i data-ic="info"></i><span>${km1(km)}: fora do alcance de ${e.raioMaxKm} km</span>`; }
    else { el.className = "resultado"; el.innerHTML = `<i data-ic="check"></i><span>${km1(km)} do restaurante</span>${reais(taxaKm(km, false, e))}<span class="so-pc">&nbsp;· ${min} a ${min + 10} min</span>`; }
  }
  pintarIcones(el);
}
async function abrirBairro(id) {
  const b = id === "novo" ? null : E.bairros.find((x) => x.id === id);
  if (id !== "novo" && !b) { if (E.carregou) location.hash = "#entregas"; else fecharJanela(); return; } // sem a lista ainda: abre quando chegar
  if (!E.rasc || E.rasc.id !== (b?.id || null)) E.rasc = b ? { ...b } : { id: null, nome: "", lat: null, lng: null };
  const r = E.rasc;
  $("e-cab").innerHTML = cabecalho(b ? "Editar bairro" : "Novo bairro");
  $("e-corpo").innerHTML = `
    <div class="sec">
      <div class="campo"><label for="b-nome">Nome do bairro <i class="obrig">*</i></label>
        <div class="busca-l"><input id="b-nome" maxlength="60" value="${esc(r.nome)}" placeholder="Ex.: Jardim das Flores" /><button type="button" class="btn fantasma" data-buscar-bairro><span class="so-pc">Buscar no mapa</span><span class="so-cel">Buscar</span></button></div></div>
      <div class="mapa-j" id="e-mapa"></div>
      <p class="ajuda" id="e-ajuda">${r.lat != null ? "Centro do bairro marcado no mapa. Se o pino não estiver no meio do bairro, arraste até lá." : "Busque pelo nome ou toque no mapa onde fica o meio do bairro."}</p>
    </div>
    <div class="resultado" id="e-resultado"></div>
    ${b ? `<button type="button" class="excluir so-cel" data-excluir-bairro="${esc(b.id)}"><i data-ic="lixo"></i>Excluir bairro</button>` : ""}`;
  $("e-pe").innerHTML = `
    ${b ? `<button type="button" class="excluir so-pc" data-excluir-bairro="${esc(b.id)}"><i data-ic="lixo"></i>Excluir bairro</button>` : ""}
    <a class="btn fantasma so-pc" href="#entregas">Cancelar</a>
    <button type="button" class="btn" data-salvar-bairro>Salvar bairro</button>`;
  pintarIcones($("e-modal"));
  resultadoBairro();
  try {
    const m = await mapaJanela([
      { tipo: "restaurante", ...(E.loja.local || {}) },
      { tipo: "bairro", lat: r.lat, lng: r.lng, arrasta: true },
    ], (p) => { r.lat = p.lat; r.lng = p.lng; resultadoBairro(); });
    E.marcas = m?.marcas;
  } catch { $("e-mapa").innerHTML = `<p class="sem-mapa">O mapa não carregou. Confira a internet.</p>`; }
}
async function buscarBairro() {
  const r = E.rasc, nome = $("b-nome").value.trim();
  if (nome.length < 2) return toast("Digite o nome do bairro.", "erro", 3000);
  r.nome = nome;
  const botao = document.querySelector("[data-buscar-bairro]");
  botao.classList.add("desligado");
  try {
    const p = await buscarLugar(ondeBuscar(nome));
    if (!p) { toast("Não achamos esse bairro no mapa. Toque no mapa onde ele fica.", "info", 4500); return; }
    r.lat = p.lat; r.lng = p.lng;
    $("e-ajuda").textContent = `Achamos o bairro${E.loja.cidade ? ` em ${E.loja.cidade}` : ""}. Se o pino não estiver no meio do bairro, arraste até lá.`;
    const m = await mapaJanela([{ tipo: "restaurante", ...(E.loja.local || {}) }, { tipo: "bairro", lat: p.lat, lng: p.lng, arrasta: true }],
      (q) => { r.lat = q.lat; r.lng = q.lng; resultadoBairro(); });
    E.marcas = m?.marcas;
    resultadoBairro();
  } catch { toast("A busca no mapa não respondeu. Tente de novo ou toque no mapa.", "erro", 4500); }
  finally { botao.classList.remove("desligado"); }
}
async function salvarBairro() {
  const r = E.rasc;
  r.nome = $("b-nome").value.trim().replace(/\s+/g, " ");
  if (r.nome.length < 2) return toast("Digite o nome do bairro.", "erro", 3000);
  if (semAcento(r.nome) === semAcento(E.loja.bairro)) return toast("Esse é o bairro do restaurante: ele já está na lista.", "erro", 4000);
  if (E.bairros.some((b) => b.id !== r.id && semAcento(b.nome) === semAcento(r.nome))) return toast("Esse bairro já está na lista.", "erro", 3500);
  if (r.lat == null) return toast("Marque o bairro no mapa: busque pelo nome ou toque no mapa.", "erro", 4000);
  const id = r.id || gerarId().replace(/-/g, "").slice(0, 20);
  const dados = { nome: r.nome, lat: Math.round(r.lat * 1e6) / 1e6, lng: Math.round(r.lng * 1e6) / 1e6 };
  const ok = await gravar(() => setDoc(doc(db, "lojas", E.loja.id, "bairros", id), dados), () => {
    const i = E.bairros.findIndex((b) => b.id === id);
    if (i >= 0) E.bairros[i] = { id, ...dados }; else E.bairros.push({ id, ...dados });
  });
  if (!ok) return;
  if (!E.exemplo) toast(r.id ? "Bairro salvo." : "Bairro adicionado.", "sucesso", 2500);
  location.hash = "#entregas";
}
async function excluirBairro(id) {
  const b = E.bairros.find((x) => x.id === id);
  if (!b || !(await confirmar(`Tirar "${b.nome}" dos bairros atendidos? Quem mora lá não vai conseguir pedir entrega.`, { textoConfirmar: "Excluir" }))) return;
  const ok = await gravar(() => deleteDoc(doc(db, "lojas", E.loja.id, "bairros", id)), () => { E.bairros = E.bairros.filter((x) => x.id !== id); });
  if (ok && E.janela) location.hash = "#entregas";
}

async function abrirPonto() {
  const l = E.loja;
  if (!E.rasc || E.rasc.tipo !== "ponto") E.rasc = { tipo: "ponto", endereco: l.endereco || "", lat: l.local?.lat ?? null, lng: l.local?.lng ?? null };
  const r = E.rasc;
  $("e-cab").innerHTML = cabecalho("Ponto de saída");
  $("e-corpo").innerHTML = `
    <div class="sec">
      <div class="campo"><label for="p-end">Endereço do restaurante</label>
        <div class="busca-l"><input id="p-end" maxlength="120" value="${esc(r.endereco)}" placeholder="Rua e número" /><button type="button" class="btn fantasma" data-buscar-ponto><span class="so-pc">Buscar no mapa</span><span class="so-cel">Buscar</span></button></div></div>
      <button type="button" class="loc" data-minha-loc><i data-ic="alvo"></i>Usar a localização deste aparelho</button>
      <div class="mapa-j" id="e-mapa"></div>
      <p class="ajuda">Arraste o pino até a porta do restaurante. Todos os bairros são medidos a partir daqui.</p>
    </div>`;
  $("e-pe").innerHTML = `<a class="btn fantasma so-pc" href="#entregas">Cancelar</a><button type="button" class="btn" data-salvar-ponto>Salvar ponto</button>`;
  pintarIcones($("e-modal"));
  // sem ponto ainda: começa pelo bairro do restaurante, para não abrir no Brasil inteiro
  if (r.lat == null && l.bairro) {
    try { const p = await buscarLugar(ondeBuscar(l.bairro)); if (p && r.lat == null) { r.lat = p.lat; r.lng = p.lng; } } catch { /* segue sem sugestão */ }
  }
  await desenharPonto();
}
async function desenharPonto() {
  const r = E.rasc;
  try { await mapaJanela([{ tipo: "restaurante", lat: r.lat, lng: r.lng, arrasta: true }], (p) => { r.lat = p.lat; r.lng = p.lng; }); }
  catch { $("e-mapa").innerHTML = `<p class="sem-mapa">O mapa não carregou. Confira a internet.</p>`; }
}
async function buscarPonto() {
  const r = E.rasc, end = $("p-end").value.trim();
  if (end.length < 3) return toast("Digite o endereço do restaurante.", "erro", 3000);
  r.endereco = end;
  try {
    // o mapa nem sempre tem o número da casa nem o bairro certo: tenta do mais exato ao mais solto
    const semNumero = end.replace(/,?\s*\d+\s*$/, "").trim();
    const tentativas = [[end, E.loja.bairro], [end], [semNumero]].map((t) => ondeBuscar(t.filter(Boolean).join(", ")));
    let p = null;
    for (const t of [...new Set(tentativas)]) { p = await buscarLugar(t); if (p) break; }
    if (!p) return toast("Não achamos esse endereço. Arraste o pino até a porta do restaurante.", "info", 4500);
    r.lat = p.lat; r.lng = p.lng;
    await desenharPonto();
  } catch { toast("A busca no mapa não respondeu. Tente de novo ou arraste o pino.", "erro", 4500); }
}
function minhaLocalizacao() {
  if (!navigator.geolocation) return toast("Este aparelho não informa a localização.", "erro", 3500);
  navigator.geolocation.getCurrentPosition(async (pos) => {
    E.rasc.lat = pos.coords.latitude; E.rasc.lng = pos.coords.longitude;
    await desenharPonto();
  }, () => toast("Não deu para pegar a localização. Confira a permissão do navegador.", "erro", 4500), { enableHighAccuracy: true, timeout: 15000 });
}
async function salvarPonto() {
  const r = E.rasc;
  r.endereco = $("p-end").value.trim().replace(/\s+/g, " ");
  if (r.lat == null) return toast("Marque o restaurante no mapa.", "erro", 3500);
  const local = { lat: Math.round(r.lat * 1e6) / 1e6, lng: Math.round(r.lng * 1e6) / 1e6 };
  const ok = await gravar(() => updateDoc(refLoja(), { local, endereco: r.endereco }), () => { E.loja.local = local; E.loja.endereco = r.endereco; });
  if (!ok) return;
  if (!E.exemplo) toast("Ponto de saída salvo. As taxas foram recalculadas.", "sucesso", 3000);
  location.hash = "#entregas";
}

function abrirRegra() {
  const e = regraDe(E.loja);
  $("e-cab").innerHTML = cabecalho("Regra da taxa");
  $("e-corpo").innerHTML = `
    <div data-form-regra>
      <div class="sec"><div class="sec-t">Taxa</div><div class="r-g">${camposRegra(e, ["taxaBairro", "porKm", "arredondar", "raioMaxKm"], { porKm: "A mais por km, nos outros bairros", arredondar: "Arredondar para cima" },
        { porKm: `Somado aos ${reais(e.taxaBairro)}, pela distância em linha reta.` })}</div></div>
      <div class="sec"><div class="sec-t">Tempo</div><div class="r-g">${camposRegra(e, ["minutosBase", "minutosPorKm"], { minutosBase: "Preparo" })}</div></div>
      <div class="simula"><i data-ic="check"></i><span data-simula>${textoSimula(e)}</span></div>
    </div>`;
  $("e-pe").innerHTML = `<a class="btn fantasma so-pc" href="#entregas">Cancelar</a><button type="button" class="btn" data-salvar-regra>Salvar regra</button>`;
  pintarIcones($("e-modal"));
}

function abrirJanela(tipo) {
  E.janela = { tipo };
  document.querySelector(".e-janela").dataset.tipo = tipo;
  $("e-modal").hidden = false;
  document.body.classList.add("com-janela");
}
function fecharJanela() {
  if (E.mapa) { E.mapa.remove(); E.mapa = null; }
  E.janela = null; E.rasc = null;
  $("e-modal").hidden = true;
  document.body.classList.remove("com-janela");
}

/* ===== entrada pelo endereço ===== */
export function mostrarEntregas(partes) {
  const [, tipo, id] = partes;
  if (!E.loja) return;
  if (tipo === "bairro") { if (E.janela?.tipo !== "bairro" || (E.rasc?.id || "novo") !== id) { fecharJanela(); abrirJanela("bairro"); abrirBairro(id); } return; }
  if (tipo === "ponto") { if (E.janela?.tipo !== "ponto") { fecharJanela(); abrirJanela("ponto"); abrirPonto(); } return; }
  if (tipo === "regra" && !pc.matches) { if (E.janela?.tipo !== "regra") { fecharJanela(); abrirJanela("regra"); abrirRegra(); } return; }
  fecharJanela();
  render();
}
export function fecharEntregas() { if (E.janela) fecharJanela(); }

/* ===== cliques e digitação ===== */
function aoClicar(e) {
  if ($("vista-entregas").hidden && $("e-modal").hidden) return;
  const alvo = (s) => e.target.closest(s);
  let el;
  if (e.target.id === "e-modal") { if (pc.matches) location.hash = "#entregas"; return; }
  if ((el = alvo("[data-excluir-bairro]"))) { excluirBairro(el.dataset.excluirBairro); return; }
  if ((el = alvo("[data-salvar-regra]"))) { salvarRegra(el.closest(".e-cartao, .e-janela").querySelector("[data-form-regra]")); return; }
  if (alvo("[data-buscar-bairro]")) { buscarBairro(); return; }
  if (alvo("[data-salvar-bairro]")) { salvarBairro(); return; }
  if (alvo("[data-buscar-ponto]")) { buscarPonto(); return; }
  if (alvo("[data-minha-loc]")) { minhaLocalizacao(); return; }
  if (alvo("[data-salvar-ponto]")) { salvarPonto(); return; }
}
function aoDigitar(e) {
  const campo = e.target.closest("[data-regra]");
  if (campo) { const f = campo.closest("[data-form-regra]"); f.querySelector("[data-simula]").textContent = textoSimula(lerRegra(f)); }
}
function aoTeclar(e) {
  if (e.key === "Escape" && E.janela) { e.preventDefault(); location.hash = "#entregas"; }
  if (e.key === "Enter" && e.target.id === "b-nome") buscarBairro();
  if (e.key === "Enter" && e.target.id === "p-end") buscarPonto();
}

/* ===== ligar e desligar ===== */
export function iniciarEntregas(loja, { exemplo = null } = {}) {
  pararEntregas();
  E.loja = { ...loja };
  document.addEventListener("click", aoClicar);
  document.addEventListener("input", aoDigitar);
  document.addEventListener("keydown", aoTeclar);
  if (exemplo) {
    E.exemplo = true;
    E.loja = { ...E.loja, ...exemplo.loja };
    E.bairros = exemplo.bairros.map((b, n) => ({ id: `b${n}`, ...b }));
    E.carregou = true;
    render();
    return;
  }
  E.exemplo = false;
  E.carregou = false;
  E.parar.push(onSnapshot(refLoja(), (s) => { if (s.exists()) { E.loja = { id: s.id, ...s.data() }; render(); } }));
  E.parar.push(onSnapshot(collection(db, "lojas", loja.id, "bairros"), (snap) => {
    E.bairros = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const primeira = !E.carregou;
    E.carregou = true;
    render();
    if (primeira && !E.janela && location.hash.startsWith("#entregas/")) mostrarEntregas(location.hash.slice(1).split("/"));
  }, () => toast("Não deu para ler os bairros.", "erro", 5000)));
}
export function pararEntregas() {
  E.parar.forEach((f) => f());
  E.parar = [];
  if (E.mini) { E.mini.remove(); E.mini = null; }
  document.removeEventListener("click", aoClicar);
  document.removeEventListener("input", aoDigitar);
  document.removeEventListener("keydown", aoTeclar);
}
