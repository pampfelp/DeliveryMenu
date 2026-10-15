/*
  app.js da loja (o que o cliente vê). Lê os dados de exemplo; o Firestore
  entra na fase 2 do PLANO.md. O painel do restaurante mora em painel.html.

  Dinheiro sempre em centavos. A sacola fica no aparelho (localStorage),
  separada por loja.
*/

import { esc, fmtMoeda, toast, confirmar } from "./shared.js?v=1";
import { LOJA, BAIRROS, CATEGORIAS, SUGESTOES, SACOLA_EXEMPLO } from "./dados-exemplo.js?v=5";
import { pintarIcones } from "./icones.js?v=2";

const reais = (centavos) => fmtMoeda(centavos / 100);
const ITENS = CATEGORIAS.flatMap((c) => c.itens);
const item = (id) => ITENS.find((i) => i.id === id);
const SELOS = { recomendado: "Recomendado", oferta: "Oferta", novo: "Novo" };
const pc = window.matchMedia("(min-width: 1024px)");

// foto enviada pela loja, ou o espaço reservado com o ícone de imagem
const foto = (url, classe = "foto") =>
  url ? `<img class="${classe}" src="${esc(url)}" alt="" loading="lazy" />` : `<div class="${classe}"><i data-ic="foto"></i></div>`;

/* ===== sacola (no aparelho) ===== */
const CHAVE = `deliverymenu:sacola:${LOJA.id}`;
function lerSacola() {
  if (new URLSearchParams(location.search).has("exemplo")) return SACOLA_EXEMPLO.map((l, n) => ({ uid: `ex${n}`, ...l }));
  try { return JSON.parse(localStorage.getItem(CHAVE)) || []; } catch { return []; }
}
const STATE = { sacola: lerSacola(), tipo: "entrega", aba: "online", forma: "pix", produto: null, entrega: { status: "vazio" } };
function salvarSacola() {
  try { localStorage.setItem(CHAVE, JSON.stringify(STATE.sacola)); } catch { /* modo anônimo: a sacola vale só nesta aba */ }
  renderSacolas();
}

/* ===== preço: regra de cada grupo de adicionais (ver rea/ACHADOS.md, P2) ===== */
function valorGrupo(grupo, escolhaDoGrupo = {}) {
  const precos = [];
  grupo.opcoes.forEach((o) => { for (let n = 0; n < (escolhaDoGrupo[o.id] || 0); n++) precos.push(o.preco); });
  if (!precos.length) return 0;
  const soma = precos.reduce((s, p) => s + p, 0);
  switch (grupo.regraPreco) {
    case "media": return Math.round(soma / precos.length);
    case "menor": return Math.min(...precos);
    case "maior": return Math.max(...precos);
    default: return soma;
  }
}
const precoBase = (i) => i.precoPromo ?? i.preco;
// item sem preço próprio (pizza meio a meio): mostra o menor valor possível pelas opções obrigatórias.
// Num grupo somável a mesma opção pode ser repetida, então o mínimo é a mais barata repetida.
function precoVitrine(i) {
  if (i.preco) return reais(precoBase(i));
  const minimo = i.grupos.filter((g) => g.min > 0).reduce((s, g) => {
    const barata = g.opcoes.filter((o) => !o.esgotado).sort((x, y) => x.preco - y.preco)[0];
    return barata ? s + valorGrupo(g, { [barata.id]: g.min }) : s;
  }, 0);
  return `A partir de ${reais(minimo)}`;
}
const precoUnitario = (i, escolhas) => precoBase(i) + i.grupos.reduce((s, g) => s + valorGrupo(g, escolhas[g.id]), 0);
const totalLinha = (l) => precoUnitario(item(l.itemId), l.escolhas) * l.qtd;
const subtotal = () => STATE.sacola.reduce((s, l) => s + totalLinha(l), 0);
const taxa = () => (STATE.tipo === "entrega" && STATE.entrega.status === "ok" ? STATE.entrega.valor : 0);

/* ===== taxa de entrega por bairro (decisão dele, 2026-10-15) =====
   R$ 3 no bairro do restaurante; nos outros, a taxa do bairro mais um valor
   por km em linha reta até o centro do bairro, arredondado para cima. */
function distanciaKm(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
function calcularEntrega(nomeBairro) {
  const e = LOJA.entrega;
  if (!nomeBairro.trim()) return { status: "vazio" };
  const bairro = BAIRROS.find((b) => semAcento(b.nome) === semAcento(nomeBairro.trim()));
  if (!bairro) return { status: "fora" };
  const mesmo = semAcento(bairro.nome) === semAcento(LOJA.bairro);
  const km = mesmo ? 0 : distanciaKm(LOJA.local, bairro);
  if (km > e.raioMaxKm) return { status: "fora" };
  const valor = mesmo ? e.taxaBairro : Math.ceil((e.taxaBairro + km * e.porKm) / e.arredondar) * e.arredondar;
  const min = Math.round(e.minutosBase + km * e.minutosPorKm);
  return { status: "ok", bairro: bairro.nome, km, valor, min, max: min + 10 };
}
// texto da taxa nos resumos: sem bairro válido ainda não há taxa para mostrar
const textoTaxa = () => (STATE.tipo !== "entrega" ? "Grátis" : STATE.entrega.status === "ok" ? reais(STATE.entrega.valor) : "A definir");
const qtdItens = () => STATE.sacola.reduce((s, l) => s + l.qtd, 0);

function resumoLinha(l) {
  const i = item(l.itemId);
  const partes = [];
  i.grupos.forEach((g) => g.opcoes.forEach((o) => {
    const n = (l.escolhas[g.id] || {})[o.id] || 0;
    if (n) partes.push(g.tipo === "unica" ? o.nome : `${n} ${o.nome.toLowerCase()}`);
  }));
  if (l.obs) partes.push(l.obs);
  return partes.join(", ");
}

/* ===== navegação por hash: #inicio, #produto/<id>, #produto/<id>/<uid>, #sacola, ... ===== */
function irParaHash() {
  let [tela, param, uid] = (location.hash.slice(1) || "inicio").split("/");
  if (!document.getElementById(`tela-${tela}`)) tela = "inicio";
  if (pc.matches && tela === "sacola") tela = "inicio"; // no computador a sacola é a coluna do início
  if (["entrega", "pagamento"].includes(tela) && !STATE.sacola.length) tela = "inicio";
  if (tela === "pagamento" && STATE.tipo === "entrega" && STATE.entrega.status !== "ok") {
    toast(STATE.entrega.status === "fora" ? "Ainda não entregamos nesse bairro." : "Informe o bairro da entrega.", "erro", 3500);
    tela = "entrega";
    history.replaceState(null, "", "#entrega");
  }
  document.querySelectorAll(".tela").forEach((s) => s.classList.toggle("ativa", s.id === `tela-${tela}`));
  document.body.dataset.tela = tela;
  if (tela === "produto") abrirProduto(param, uid);
  if (tela === "pagamento") renderPagamento();
  if (tela !== "produto") window.scrollTo(0, 0);
  pintarIcones();
}
window.addEventListener("hashchange", irParaHash);
pc.addEventListener("change", irParaHash);

/* ===== S01 início ===== */
function renderInicio() {
  document.documentElement.style.setProperty("--accent", LOJA.cor);
  document.querySelectorAll(".loja-nome").forEach((el) => (el.textContent = LOJA.nome));
  document.getElementById("loja-cidade").textContent = LOJA.cidade;
  document.getElementById("loja-situacao").textContent = LOJA.situacao.texto;
  // sem logo, o espaço dele some (decisão dele, 2026-10-15)
  document.body.classList.toggle("sem-logo", !LOJA.logoUrl);
  document.getElementById("loja-logo").innerHTML = LOJA.logoUrl ? `<img src="${esc(LOJA.logoUrl)}" alt="${esc(LOJA.nome)}" />` : "";
  document.querySelectorAll(".mini").forEach((el) => (el.innerHTML = LOJA.logoUrl ? `<img src="${esc(LOJA.logoUrl)}" alt="" />` : ""));
  document.title = `${LOJA.nome} | Cardápio Delivery`;

  document.getElementById("destaques").innerHTML = ITENS.filter((i) => i.destaque).map((i) => `
    <a class="dest" href="#produto/${esc(i.id)}">
      ${foto(i.fotoUrl)}
      <div class="corpo">
        ${i.selo ? `<span class="selo selo-${esc(i.selo)}">${SELOS[i.selo]}</span>` : ""}
        <h3>${esc(i.nome)}</h3><p>${esc(i.descricao)}</p>
        <div class="preco${i.precoPromo ? " promo" : ""}">${precoVitrine(i)}</div>
      </div>
    </a>`).join("");

  document.getElementById("categorias").innerHTML = CATEGORIAS.map((c) => `
    <h2 class="secao">${esc(c.nome)}</h2>
    <div class="lista-itens">${c.itens.filter((i) => !i.destaque).map(cardItem).join("")}</div>`).join("");
}

function cardItem(i) {
  const desconto = i.precoPromo ? Math.round((1 - i.precoPromo / i.preco) * 100) : 0;
  const valores = i.esgotado
    ? `<span class="preco">${reais(i.preco)}</span><span class="tag">Esgotado</span>`
    : i.precoPromo
      ? `<span class="preco promo">${reais(i.precoPromo)}</span><span class="riscado">${reais(i.preco)}</span><span class="desconto">-${desconto}%</span>`
      : `<span class="preco">${precoVitrine(i)}</span>`;
  const destino = i.esgotado ? ' aria-disabled="true"' : ` href="#produto/${esc(i.id)}"`;
  return `
    <a class="item${i.esgotado ? " esgotado" : ""}"${destino}>
      <div class="txt"><h3>${esc(i.nome)}</h3><p>${esc(i.descricao)}</p><div class="valores">${valores}</div></div>
      ${foto(i.fotoUrl)}
    </a>`;
}

/* busca: filtra pelo nome e pela descrição, sem ir ao servidor */
const semAcento = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const campoBusca = document.getElementById("busca");
campoBusca.addEventListener("input", () => {
  const termo = semAcento(campoBusca.value.trim());
  const caixa = document.getElementById("resultado-busca");
  document.getElementById("cardapio").hidden = !!termo;
  if (!termo) { caixa.innerHTML = ""; return; }
  const achados = ITENS.filter((i) => semAcento(`${i.nome} ${i.descricao}`).includes(termo));
  caixa.innerHTML = achados.length
    ? `<h2 class="secao">Resultados</h2><div class="lista-itens">${achados.map(cardItem).join("")}</div>`
    : `<p class="vazio-busca">Nenhum produto encontrado</p>`;
  pintarIcones(caixa);
});
document.querySelector(".lupa").addEventListener("click", () => {
  if (pc.matches) return;
  document.querySelector(".filtros").classList.add("buscando");
  campoBusca.focus();
});
campoBusca.addEventListener("blur", () => {
  if (!campoBusca.value) document.querySelector(".filtros").classList.remove("buscando");
});

/* ===== S04 produto ===== */
function abrirProduto(id, uid) {
  const i = item(id);
  if (!i || i.esgotado) { location.hash = "#inicio"; return; }
  const linha = uid && STATE.sacola.find((l) => l.uid === uid);
  STATE.produto = {
    item: i,
    uid: linha ? uid : null,
    qtd: linha ? linha.qtd : 1,
    escolhas: linha ? structuredClone(linha.escolhas) : {},
    obs: linha ? linha.obs : "",
  };
  document.getElementById("produto-foto").innerHTML = i.fotoUrl ? `<img src="${esc(i.fotoUrl)}" alt="" />` : `<i data-ic="foto"></i>`;
  document.getElementById("produto-info").innerHTML = `
    <h1>${esc(i.nome)}</h1><p>${esc(i.descricao)}</p><div class="preco${i.precoPromo ? " promo" : ""}">${precoVitrine(i)}</div>`;
  document.getElementById("obs").value = STATE.produto.obs;
  document.querySelector("#tela-produto .rolagem").scrollTop = 0;
  renderProduto();
}

function renderProduto() {
  const { item: i, escolhas, qtd } = STATE.produto;
  document.getElementById("produto-grupos").innerHTML = i.grupos.map((g) => {
    const marcadas = Object.values(escolhas[g.id] || {}).reduce((s, n) => s + n, 0);
    const regra = g.tipo === "unica" ? `Escolha ${g.max} opção` : g.min ? `Escolha de ${g.min} a ${g.max}` : `Escolha até ${g.max}`;
    const completo = g.min > 0 && marcadas >= g.min;
    const chip = completo
      ? `<span class="chip ok"><i data-ic="check"></i>${marcadas}/${g.max}</span>`
      : `<span class="chip">${marcadas}/${g.max}</span>${g.min ? '<span class="chip">OBRIGATÓRIO</span>' : ""}`;
    return `
      <div class="grupo"><div class="t"><h2>${esc(g.nome)}</h2><small>${regra}</small></div>${chip}</div>
      ${g.opcoes.map((o) => {
        const n = (escolhas[g.id] || {})[o.id] || 0;
        const preco = o.preco ? ` <span class="v">+ ${reais(o.preco)}</span>` : "";
        const controle = o.esgotado
          ? `<span class="falta">EM FALTA</span>`
          : g.tipo === "unica"
            ? `<span class="radio${n ? " on" : ""}"></span>`
            : `<span class="passo">${n ? `<button data-menos="${g.id}|${o.id}" aria-label="Menos ${esc(o.nome)}"><i data-ic="menos"></i></button><b>${n}</b>` : ""}<button data-mais="${g.id}|${o.id}" aria-label="Mais ${esc(o.nome)}"><i data-ic="mais"></i></button></span>`;
        const clicavel = !o.esgotado && g.tipo === "unica" ? ` data-unica="${g.id}|${o.id}" role="radio" aria-checked="${n ? "true" : "false"}" tabindex="0"` : "";
        return `<div class="op"${clicavel}><span class="n">${esc(o.nome)}${preco}</span>${controle}</div>`;
      }).join("")}`;
  }).join("");
  document.getElementById("qtd-valor").textContent = qtd;
  document.getElementById("btn-adicionar").innerHTML =
    `<span>${STATE.produto.uid ? "Atualizar" : "Adicionar"}</span><span>${reais(precoUnitario(i, escolhas) * qtd)}</span>`;
  pintarIcones(document.getElementById("tela-produto"));
}

function mudarOpcao(chave, delta) {
  const [gid, oid] = chave.split("|");
  const g = STATE.produto.item.grupos.find((x) => x.id === gid);
  const atual = STATE.produto.escolhas[gid] || {};
  if (g.tipo === "unica") {
    STATE.produto.escolhas[gid] = { [oid]: 1 };
  } else {
    const total = Object.values(atual).reduce((s, n) => s + n, 0);
    if (delta > 0 && total >= g.max) { toast(`Você já escolheu ${g.max} em ${g.nome.toLowerCase()}.`, "info", 3000); return; }
    const n = Math.max(0, (atual[oid] || 0) + delta);
    STATE.produto.escolhas[gid] = { ...atual, [oid]: n };
    if (!n) delete STATE.produto.escolhas[gid][oid];
  }
  renderProduto();
}

const telaProduto = document.getElementById("tela-produto");
telaProduto.addEventListener("click", (e) => {
  const alvo = e.target.closest("[data-mais], [data-menos], [data-unica]");
  if (!alvo) return;
  if (alvo.dataset.mais) mudarOpcao(alvo.dataset.mais, +1);
  else if (alvo.dataset.menos) mudarOpcao(alvo.dataset.menos, -1);
  else mudarOpcao(alvo.dataset.unica, +1);
});
telaProduto.addEventListener("keydown", (e) => {
  const alvo = e.target.closest("[data-unica]");
  if (alvo && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); mudarOpcao(alvo.dataset.unica, +1); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.body.dataset.tela === "produto") location.hash = "#inicio";
});
document.getElementById("qtd-mais").addEventListener("click", () => { STATE.produto.qtd++; renderProduto(); });
document.getElementById("qtd-menos").addEventListener("click", () => { STATE.produto.qtd = Math.max(1, STATE.produto.qtd - 1); renderProduto(); });
document.getElementById("obs").addEventListener("input", (e) => (STATE.produto.obs = e.target.value.trim()));

document.getElementById("btn-adicionar").addEventListener("click", () => {
  if (STATE.produto.salvo) return; // duplo clique não põe o item duas vezes
  const { item: i, escolhas, qtd, obs, uid } = STATE.produto;
  const faltando = i.grupos.find((g) => Object.values(escolhas[g.id] || {}).reduce((s, n) => s + n, 0) < g.min);
  if (faltando) { toast(`Escolha ${faltando.nome.toLowerCase()} para continuar.`, "erro", 3500); return; }
  const linha = { uid: uid || crypto.randomUUID(), itemId: i.id, qtd, escolhas, obs };
  const pos = STATE.sacola.findIndex((l) => l.uid === uid);
  if (pos >= 0) STATE.sacola[pos] = linha; else STATE.sacola.push(linha);
  STATE.produto.salvo = true;
  salvarSacola();
  toast(uid ? "Item atualizado." : "Adicionado à sacola.", "sucesso", 2500);
  location.hash = "#inicio";
});

/* ===== S08 sacola (celular) e coluna da sacola (computador) ===== */
function htmlResumoLateral(aside, sub) {
  return `
    <h2>Seu pedido</h2>
    ${STATE.sacola.map((l) => {
      const i = item(l.itemId);
      const r = resumoLinha(l);
      return `<div class="li"><span><b>${l.qtd}x</b>${esc(i.nome)}${r ? `<small>${esc(r)}</small>` : ""}</span><span class="${i.precoPromo ? "preco-promo" : ""}">${reais(totalLinha(l))}</span></div>`;
    }).join("")}
    <div class="tls">
      <div class="tl"><span>Subtotal</span><span>${reais(sub)}</span></div>
      <div class="tl"><span>Taxa de entrega</span><span>${textoTaxa()}</span></div>
      <div class="tl total"><span>Total</span><span>${reais(sub + taxa())}</span></div>
    </div>
    <a class="btn" href="${aside.dataset.destino}"${aside.dataset.destino === "#enviado" ? " data-enviar" : ""}>${esc(aside.dataset.resumo)}</a>`;
}

function renderSacolas() {
  const vazia = !STATE.sacola.length;
  const sub = subtotal();
  document.querySelectorAll("[data-subtotal]").forEach((el) => (el.textContent = reais(sub)));
  document.querySelectorAll("[data-taxa]").forEach((el) => (el.textContent = textoTaxa()));
  document.querySelectorAll("[data-total]").forEach((el) => (el.textContent = reais(sub + taxa())));

  // barra do início
  document.querySelector(".barra-sacola").hidden = vazia;
  document.getElementById("barra-qtd").innerHTML = `<b>${qtdItens()}</b>`;
  document.getElementById("barra-total").textContent = reais(sub);

  // tela da sacola
  document.getElementById("sacola-itens").innerHTML = vazia
    ? `<div class="sacola-vazia"><i data-ic="sacola"></i><p>Sua sacola está vazia</p></div>`
    : STATE.sacola.map((l) => {
      const i = item(l.itemId);
      return `
        <div class="it">
          <div class="t"><h3><b>${l.qtd}x</b>${esc(i.nome)}</h3><p>${esc(resumoLinha(l))}</p><div class="acoes"><a href="#produto/${esc(i.id)}/${esc(l.uid)}">Editar</a><button data-remover="${esc(l.uid)}">Remover</button></div></div>
          <div class="lado"><span class="preco${i.precoPromo ? " promo" : ""}">${reais(totalLinha(l))}</span>${foto(i.fotoUrl)}</div>
        </div>`;
    }).join("");
  const sugeridos = SUGESTOES.filter((id) => !STATE.sacola.some((l) => l.itemId === id)).map(item);
  document.getElementById("sacola-sugestoes").hidden = !sugeridos.length;
  document.getElementById("sugestoes").innerHTML = sugeridos.map((s) => `
    <a class="c" href="#produto/${esc(s.id)}">${foto(s.fotoUrl)}<div>${esc(s.nome)}<b>${reais(s.preco)}</b></div></a>`).join("");
  document.querySelector("[data-continuar]").classList.toggle("desligado", vazia);

  // coluna do computador
  document.getElementById("sacola-lateral").innerHTML = `
    <button class="linha-taxa"><i data-ic="pino"></i><span>Calcular taxa e tempo de entrega</span><i data-ic="direita" class="seta"></i></button>
    ${vazia
      ? `<div class="sacola-vazia"><i data-ic="sacola"></i><p>Sacola vazia</p></div>`
      : `<div class="cab"><h2>Sua sacola</h2><button data-limpar>LIMPAR</button></div>
        ${STATE.sacola.map((l) => {
          const i = item(l.itemId);
          return `
            <div class="it">
              <div class="l1"><span><b>${l.qtd}x</b>${esc(i.nome)}</span><span class="${i.precoPromo ? "preco-promo" : ""}">${reais(totalLinha(l))}</span></div>
              <p>${esc(resumoLinha(l))}</p>
              <div class="acoes"><a href="#produto/${esc(i.id)}/${esc(l.uid)}">Editar</a><button data-remover="${esc(l.uid)}">Remover</button></div>
            </div>`;
        }).join("")}
        <div class="tot">
          <div class="tl"><span>Subtotal</span><span>${reais(sub)}</span></div>
          <div class="tl"><span>Taxa de entrega</span><span>A definir</span></div>
          <div class="tl total"><span>Total</span><span>${reais(sub)}</span></div>
        </div>`}
    <button class="cupom"><i data-ic="cupom"></i><span>Tem um cupom?<small>Clique e digite o código</small></span><i data-ic="direita" class="seta"></i></button>
    ${vazia ? `<span class="btn desligado">Sacola vazia</span>` : `<a class="btn" href="#entrega">Continuar pedido</a>`}`;

  // resumo ao lado do checkout (computador)
  document.querySelectorAll(".resumo-lateral").forEach((aside) => (aside.innerHTML = htmlResumoLateral(aside, sub)));
  pintarIcones();
}

document.addEventListener("click", async (e) => {
  const remover = e.target.closest("[data-remover]");
  if (remover) {
    STATE.sacola = STATE.sacola.filter((l) => l.uid !== remover.dataset.remover);
    salvarSacola();
    return;
  }
  if (e.target.closest("[data-limpar]")) {
    if (!(await confirmar("Tirar todos os itens da sacola?", { textoConfirmar: "Limpar" }))) return;
    STATE.sacola = [];
    salvarSacola();
    location.hash = "#inicio";
    return;
  }
  if (e.target.closest(".desligado")) { e.preventDefault(); return; }
  if (e.target.closest("[data-enviar]")) enviarPedido();
});

/* ===== S12 entrega: tipo de pedido e taxa ===== */
function renderEntrega() {
  STATE.entrega = calcularEntrega(document.getElementById("f-bairro").value);
  const caixa = document.querySelector(".resultado");
  const e = STATE.entrega;
  caixa.classList.toggle("fora", e.status === "fora");
  caixa.innerHTML = e.status === "ok"
    ? `<i data-ic="check"></i><span>Entregamos no seu endereço</span><span>${reais(e.valor)} • ${e.min}-${e.max} min</span>`
    : e.status === "fora"
      ? `<i data-ic="info"></i><span>Ainda não entregamos nesse bairro</span>`
      : `<i data-ic="info"></i><span>Informe o bairro para calcular a taxa</span>`;
  pintarIcones(caixa);
  renderSacolas();
}
document.getElementById("f-bairro").addEventListener("input", renderEntrega);
document.getElementById("lista-bairros").innerHTML = BAIRROS.map((b) => `<option value="${esc(b.nome)}"></option>`).join("");

function renderTipo() {
  document.querySelectorAll("#tipos [data-tipo]").forEach((b) => b.classList.toggle("on", b.dataset.tipo === STATE.tipo));
  document.querySelectorAll(".so-entrega").forEach((el) => (el.hidden = STATE.tipo !== "entrega"));
  renderSacolas();
}
document.getElementById("tipos").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tipo]");
  if (!b) return;
  STATE.tipo = b.dataset.tipo;
  renderTipo();
});

/* ===== S14 pagamento: online primeiro (decisão dele, 2026-10-14) ===== */
const FORMAS = {
  online: [
    { id: "pix", nome: "Pix", detalhe: "Aprovação na hora", ic: "pix" },
    { id: "credito-online", nome: "Cartão de crédito", detalhe: "Adicionar cartão", ic: "cartao" },
  ],
  entrega: [
    { id: "dinheiro", nome: "Dinheiro", detalhe: "Informe se precisa de troco", ic: "dinheiro" },
    { id: "pix-entrega", nome: "Pix", detalhe: "Na hora da entrega", ic: "pix" },
    { id: "credito", nome: "Cartão de crédito", detalhe: "Na maquininha", ic: "cartao" },
    { id: "debito", nome: "Cartão de débito", detalhe: "Na maquininha", ic: "cartao" },
  ],
};
const NOTAS = {
  online: "<b>Como funciona</b>Depois de revisar o pedido, aparecem o QR Code e o código copia e cola. O restaurante começa a preparar assim que o pagamento é confirmado.",
  entrega: "<b>Como funciona</b>Você paga quando o pedido chegar. Se for em dinheiro, diga para quanto precisa de troco na revisão do pedido.",
};
function renderPagamento() {
  document.querySelectorAll("#abas-pagamento [data-aba]").forEach((b) => b.classList.toggle("on", b.dataset.aba === STATE.aba));
  if (!FORMAS[STATE.aba].some((f) => f.id === STATE.forma)) STATE.forma = FORMAS[STATE.aba][0].id;
  const formas = FORMAS[STATE.aba].map((f) => `
    <button class="forma${f.id === STATE.forma ? " on" : ""}" data-forma="${f.id}" role="radio" aria-checked="${f.id === STATE.forma}">
      <i data-ic="${f.ic}"></i><span class="rotulo">${f.nome} <small>${f.detalhe}</small></span><span class="radio${f.id === STATE.forma ? " on" : ""}"></span>
    </button>`);
  // como na imagem validada: a explicação logo depois da forma escolhida no celular, depois das formas no computador
  const nota = `<div class="nota">${NOTAS[STATE.aba]}</div>`;
  const pos = FORMAS[STATE.aba].findIndex((f) => f.id === STATE.forma);
  document.getElementById("formas").innerHTML = pc.matches
    ? `<div class="formas-grade">${formas.join("")}</div>${nota}`
    : [...formas.slice(0, pos + 1), nota, ...formas.slice(pos + 1)].join("");
  const rua = document.getElementById("f-rua").value, num = document.getElementById("f-num").value, bairro = document.getElementById("f-bairro").value;
  document.getElementById("entrega-resumo").innerHTML = STATE.tipo === "entrega"
    ? `<i data-ic="entrega"></i><span><b>Entrega em ${esc(rua)}, ${esc(num)}</b>${esc(bairro)} • ${STATE.entrega.min}-${STATE.entrega.max} min</span><a href="#entrega">Alterar</a>`
    : `<i data-ic="${STATE.tipo === "retirada" ? "loja" : "mesa"}"></i><span><b>${STATE.tipo === "retirada" ? "Retirada no restaurante" : "Consumo no local"}</b>Sem taxa de entrega</span><a href="#entrega">Alterar</a>`;
  renderSacolas();
}
document.getElementById("abas-pagamento").addEventListener("click", (e) => {
  const b = e.target.closest("[data-aba]");
  if (!b) return;
  STATE.aba = b.dataset.aba;
  renderPagamento();
});
document.getElementById("formas").addEventListener("click", (e) => {
  const b = e.target.closest("[data-forma]");
  if (!b) return;
  STATE.forma = b.dataset.forma;
  renderPagamento();
});

/* ===== S16 pedido enviado =====
   Sem Firestore ainda: nada sai do aparelho. O aviso deixa isso claro para
   quem abrir o link público. */
function enviarPedido() {
  const agora = new Date();
  const hh = (d) => `${String(d.getHours()).padStart(2, "0")}h${String(d.getMinutes()).padStart(2, "0")}`;
  document.getElementById("pedido-numero").textContent = `#${String(agora.getTime()).slice(-4)}`;
  document.getElementById("pedido-hora").textContent = hh(agora);
  const [min, max] = STATE.tipo === "entrega" && STATE.entrega.status === "ok" ? [STATE.entrega.min, STATE.entrega.max] : [20, 30];
  document.getElementById("pedido-previsao").textContent = `${hh(new Date(agora.getTime() + min * 60000))} - ${hh(new Date(agora.getTime() + max * 60000))}`;
  if (!new URLSearchParams(location.search).has("exemplo")) {
    STATE.sacola = [];
    salvarSacola();
  }
  toast("Versão de demonstração: o pedido não foi enviado a nenhum restaurante.", "info", 6000);
}

renderInicio();
renderEntrega();
renderTipo();
irParaHash();
