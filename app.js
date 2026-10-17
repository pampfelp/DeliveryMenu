/*
  app.js da loja (o que o cliente vê). Com ?loja=<link> lê o restaurante no
  Firestore e grava o pedido em lojas/{loja}/pedidosEntrada, que cai no
  painel. Sem ?loja= é a loja de exemplo e nada sai do aparelho.

  Dinheiro sempre em centavos. A sacola, os dados do cliente e os pedidos
  feitos ficam no aparelho (localStorage); a sacola é separada por loja.
*/

import { esc, fmtMoeda, toast, confirmar } from "./shared.js?v=1";
import { SACOLA_EXEMPLO, CUPONS_EXEMPLO } from "./dados-exemplo.js?v=7";
import { normalizarCodigo, codigoValido, descontoDe, motivoRecusa, textoDesconto } from "./cupom.js?v=1";
import { carregarLoja, SLUG } from "./loja-dados.js?v=5";
import { distanciaKm, taxaKm, minutosKm } from "./conta-entrega.js?v=1";
import { situacao, agora, DIAS, NOMES, ORDEM } from "./horario.js?v=1";
import { pintarIcones } from "./icones.js?v=2";
import { chavePedido } from "./ficha-cliente.js?v=1";

const FIRESTORE = "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
const EXEMPLO = new URLSearchParams(location.search).has("exemplo");
const semAcento = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

let DADOS;
try { DADOS = await carregarLoja(); } catch { DADOS = undefined; }
if (!DADOS) {
  document.getElementById("app").innerHTML = `<p class="nao-achou">${DADOS === null
    ? "Não encontramos este cardápio. Confira o link com o restaurante."
    : "Não deu para abrir o cardápio. Confira a internet e tente de novo."}</p>`;
  await new Promise(() => {}); // para aqui sem erro: não há loja para montar
}
const { LOJA, CATEGORIAS, SUGESTOES } = DADOS;
// o bairro do próprio restaurante sempre está na lista de entrega
const BAIRROS = !LOJA.bairro || DADOS.BAIRROS.some((b) => semAcento(b.nome) === semAcento(LOJA.bairro))
  ? DADOS.BAIRROS : [{ nome: LOJA.bairro, ...(LOJA.local || {}) }, ...DADOS.BAIRROS];

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
  if (EXEMPLO) return SACOLA_EXEMPLO.map((l, n) => ({ uid: `ex${n}`, ...l }));
  let linhas = [];
  try { linhas = JSON.parse(localStorage.getItem(CHAVE)) || []; } catch { /* sem armazenamento */ }
  // item que saiu do cardápio ou esgotou desde a última visita sai da sacola
  return linhas.filter((l) => item(l.itemId) && !item(l.itemId).esgotado);
}

/* ===== dados do cliente (S09): guardados no aparelho para o próximo pedido ===== */
const CHAVE_CLIENTE = "deliverymenu:cliente";
const soDigitos = (t) => String(t || "").replace(/\D/g, "");
const fmtFone = (d) => (d.length > 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`
  : d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d);
const clienteValido = (c) => !!c && (c.nome || "").trim().length >= 2 && /^\d{10,11}$/.test(c.telefone || "");
function lerCliente() {
  if (EXEMPLO) return { nome: "Ana Paula", telefone: "91900000000" };
  try { return JSON.parse(localStorage.getItem(CHAVE_CLIENTE)); } catch { return null; }
}

const STATE = {
  sacola: lerSacola(), tipo: "entrega", produto: null, entrega: { status: "vazio" },
  // pagar online só aparece com o Mercado Pago ligado (decisão 8)
  aba: LOJA.pagamentoOnline ? "online" : "entrega", forma: LOJA.pagamentoOnline ? "pix" : "dinheiro",
  cliente: lerCliente(), enviando: false, exemploPedido: null, cupom: null,
};
function salvarSacola() {
  try { localStorage.setItem(CHAVE, JSON.stringify(STATE.sacola)); } catch { /* modo anônimo: a sacola vale só nesta aba */ }
  if (STATE.cupom && subtotal() < (STATE.cupom.minimo || 0)) {
    toast(`O cupom ${STATE.cupom.codigo} saiu: ele vale a partir de ${reais(STATE.cupom.minimo)} em itens.`, "info", 4500);
    tirarCupom(false);
  }
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
const precoMinimo = (i) => i.grupos.filter((g) => g.min > 0).reduce((s, g) => {
  const barata = g.opcoes.filter((o) => !o.esgotado).sort((x, y) => x.preco - y.preco)[0];
  return barata ? s + valorGrupo(g, { [barata.id]: g.min }) : s;
}, 0);
function precoVitrine(i) {
  if (i.preco) return reais(precoBase(i));
  return `A partir de ${reais(precoMinimo(i))}`;
}
const precoUnitario = (i, escolhas) => precoBase(i) + i.grupos.reduce((s, g) => s + valorGrupo(g, escolhas[g.id]), 0);
const totalLinha = (l) => precoUnitario(item(l.itemId), l.escolhas) * l.qtd;
const subtotal = () => STATE.sacola.reduce((s, l) => s + totalLinha(l), 0);
const taxa = () => (STATE.tipo === "entrega" && STATE.entrega.status === "ok" ? STATE.entrega.valor : 0);
const desconto = () => descontoDe(STATE.cupom, subtotal()); // só sobre os itens (cupom.js)
const totalPedido = () => subtotal() + taxa() - desconto();
const linhaDesconto = () => (desconto() ? `<div class="tl desc"><span>Cupom ${esc(STATE.cupom.codigo)}</span><span>- ${reais(desconto())}</span></div>` : "");

/* ===== taxa de entrega por bairro: a conta mora em conta-entrega.js ===== */
function calcularEntrega(nomeBairro) {
  const e = LOJA.entrega;
  if (!nomeBairro.trim()) return { status: "vazio" };
  const bairro = BAIRROS.find((b) => semAcento(b.nome) === semAcento(nomeBairro.trim()));
  if (!bairro) return { status: "fora" };
  const mesmo = semAcento(bairro.nome) === semAcento(LOJA.bairro);
  if (!mesmo && (!LOJA.local || bairro.lat == null)) return { status: "fora" }; // sem coordenada não dá para medir
  const km = mesmo ? 0 : distanciaKm(LOJA.local, bairro);
  if (km > e.raioMaxKm) return { status: "fora" };
  const min = minutosKm(km, e);
  return { status: "ok", bairro: bairro.nome, km, valor: taxaKm(km, mesmo, e), min, max: min + 10 };
}
// texto da taxa nos resumos: sem bairro válido ainda não há taxa para mostrar
const textoTaxa = () => (STATE.tipo !== "entrega" ? "Grátis" : STATE.entrega.status === "ok" ? reais(STATE.entrega.valor) : "A definir");
const qtdItens = () => STATE.sacola.reduce((s, l) => s + l.qtd, 0);

function resumoLinha(l, comObs = true) {
  const i = item(l.itemId);
  const partes = [];
  i.grupos.forEach((g) => g.opcoes.forEach((o) => {
    const n = (l.escolhas[g.id] || {})[o.id] || 0;
    if (n) partes.push(g.tipo === "unica" ? o.nome : `${n} ${o.nome.toLowerCase()}`);
  }));
  if (l.obs && comObs) partes.push(l.obs);
  return partes.join(", ");
}

/* ===== navegação por hash: #inicio, #produto/<id>, #produto/<id>/<uid>, #sacola, ... ===== */
// o que falta no endereço para seguir; vazio quando está tudo certo
function faltaEndereco() {
  if (STATE.tipo !== "entrega") return "";
  if (STATE.entrega.status === "fora") return "Ainda não entregamos nesse bairro.";
  if (STATE.entrega.status !== "ok") return "Informe o bairro da entrega.";
  if (!campo("f-rua") || !campo("f-num")) return "Informe a rua e o número.";
  if (!campo("f-ref")) return "Informe um ponto de referência.";
  return "";
}
const campo = (id) => document.getElementById(id).value.trim();
const CHECKOUT = ["dados", "entrega", "pagamento", "revisar"];
const ABAS = ["inicio", "promocoes", "pedidos", "perfil"]; // telas da barra de navegação

function irParaHash() {
  let [tela, param, uid] = (location.hash.slice(1) || "inicio").split("/");
  const desvio = (nova) => { tela = nova; history.replaceState(null, "", `#${nova}`); };
  if (!document.getElementById(`tela-${tela}`)) tela = "inicio";
  if (pc.matches && tela === "sacola") tela = "inicio"; // no computador a sacola é a coluna do início
  if (CHECKOUT.includes(tela) && !STATE.sacola.length) tela = "inicio";
  if (CHECKOUT.includes(tela) && !LOJA.aberta) desvio(pc.matches ? "inicio" : "sacola");
  if (["entrega", "pagamento", "revisar"].includes(tela) && !clienteValido(STATE.cliente)) desvio("dados");
  if (["pagamento", "revisar"].includes(tela) && faltaEndereco()) { toast(faltaEndereco(), "erro", 3500); desvio("entrega"); }
  if (tela === "pedido" && !param) desvio("pedidos");
  if (tela !== "pedido") pararAcompanhar();
  document.querySelectorAll(".tela").forEach((s) => s.classList.toggle("ativa", s.id === `tela-${tela}`));
  document.body.dataset.tela = tela;
  const aba = ABAS.includes(tela) ? tela : "inicio";
  document.querySelectorAll(".nav [data-aba]").forEach((a) => a.classList.toggle("on", a.dataset.aba === aba));
  if (tela !== "inicio") fecharInfo();
  if (tela === "produto") abrirProduto(param, uid);
  if (tela === "promocoes") renderPromocoes();
  if (tela === "pedidos") renderPedidos();
  if (tela === "perfil") renderPerfil();
  if (tela === "dados") preencherDados();
  if (tela === "pagamento") renderPagamento();
  if (tela === "revisar") renderRevisar();
  if (tela === "pedido") acompanhar(param);
  if (tela !== "produto") window.scrollTo(0, 0);
  pintarIcones();
}
window.addEventListener("hashchange", irParaHash);
pc.addEventListener("change", irParaHash);

/* ===== S01 início ===== */
function renderInicio() {
  document.documentElement.style.setProperty("--accent", LOJA.cor);
  // cor clara pede texto escuro nos botões: acima de 0,22 de luminância o texto escuro dá mais contraste que o branco
  const [r, g, b] = (LOJA.cor.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i) || [0, "99", "1b", "1b"]).slice(1).map((x) => parseInt(x, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  document.documentElement.style.setProperty("--on-accent", 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.22 ? "#1f2937" : "#ffffff");
  document.querySelectorAll(".loja-nome").forEach((el) => (el.textContent = LOJA.nome));
  document.getElementById("loja-cidade").textContent = LOJA.cidade;
  renderAberta();
  // sem logo, o espaço dele some (decisão dele, 2026-10-15)
  document.body.classList.toggle("sem-logo", !LOJA.logoUrl);
  document.getElementById("loja-logo").innerHTML = LOJA.logoUrl ? `<img src="${esc(LOJA.logoUrl)}" alt="${esc(LOJA.nome)}" />` : "";
  document.querySelectorAll(".mini").forEach((el) => (el.innerHTML = LOJA.logoUrl ? `<img src="${esc(LOJA.logoUrl)}" alt="" />` : ""));
  document.querySelectorAll("#loja-logo img, .mini img").forEach(logoInteiro);
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

  document.querySelector("#cardapio > .secao").hidden = !ITENS.some((i) => i.destaque);
  document.getElementById("vazio-cardapio").hidden = ITENS.length > 0;
  // categoria só com itens em destaque não tem seção própria
  const comSecao = CATEGORIAS.filter((c) => c.itens.some((i) => !i.destaque));
  document.getElementById("categorias").innerHTML = comSecao.map((c) => `
    <h2 class="secao" id="cat-${esc(c.id)}">${esc(c.nome)}</h2>
    <div class="lista-itens">${c.itens.filter((i) => !i.destaque).map(cardItem).join("")}</div>`).join("");
  document.getElementById("cat-sel").innerHTML = `<option value="" selected disabled>Categorias</option>`
    + (ITENS.some((i) => i.destaque) ? `<option value="destaques">Destaques</option>` : "")
    + comSecao.map((c) => `<option value="cat-${esc(c.id)}">${esc(c.nome)}</option>`).join("");
}

/* Categorias: a lista nativa do aparelho leva até a seção escolhida */
document.getElementById("cat-sel").addEventListener("change", (e) => {
  const alvo = e.target.value === "destaques" ? document.querySelector("#cardapio > .secao") : document.getElementById(e.target.value);
  e.target.value = "";
  if (!alvo) return;
  if (campoBusca.value) { campoBusca.value = ""; campoBusca.dispatchEvent(new Event("input")); document.querySelector(".filtros").classList.remove("buscando"); }
  window.scrollTo({ top: alvo.getBoundingClientRect().top + window.scrollY - 12, behavior: "smooth" });
});

// logo que não é quadrado aparece inteiro no círculo, sobre a cor do canto da própria imagem
function logoInteiro(img) {
  const ajustar = () => {
    const proporcao = img.naturalWidth / img.naturalHeight;
    if (!proporcao || Math.abs(proporcao - 1) < 0.08) return;
    img.classList.add("inteira");
    try {
      const c = document.createElement("canvas"); c.width = c.height = 1;
      const ctx = c.getContext("2d");
      // um pouco para dentro do canto: a borda da imagem costuma vir clareada
      ctx.drawImage(img, img.naturalWidth * 0.04, img.naturalHeight * 0.04, 1, 1, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      img.style.background = `rgb(${r}, ${g}, ${b})`;
    } catch { img.style.background = "#fff"; } // imagem de outro site não deixa ler a cor
  };
  if (img.complete) ajustar(); else img.addEventListener("load", ajustar, { once: true });
}

// aberta agora = chave de Pedidos + horário, quando a loja abre e fecha sozinha (horario.js).
// A loja de exemplo fica com o texto fixo das imagens.
function recalcularAberta() {
  if (!SLUG) return false;
  const s = situacao({ ...LOJA, aberta: LOJA.ligada });
  const mudou = s.aberta !== LOJA.aberta;
  LOJA.aberta = s.aberta;
  LOJA.textoSituacao = s.texto;
  return mudou;
}
// loja fechada: mostra o aviso e trava o envio (S01b, S08b, D01b)
function renderAberta() {
  const el = document.getElementById("loja-situacao");
  el.textContent = LOJA.textoSituacao || (LOJA.aberta ? (LOJA.situacao?.texto || "Aberto agora") : "Fechado agora");
  el.classList.toggle("fechada", !LOJA.aberta);
  document.querySelector(".aviso-fechada").hidden = LOJA.aberta;
  document.body.classList.toggle("loja-fechada", !LOJA.aberta);
}

function cardItem(i) {
  const desconto = i.precoPromo ? Math.round((1 - i.precoPromo / i.preco) * 100) : 0;
  const valores = i.esgotado
    ? `<span class="preco">${precoVitrine(i)}</span><span class="tag">Esgotado</span>`
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
  // editando pela sacola do celular, fechar volta para a sacola
  document.querySelector("#tela-produto .x").setAttribute("href", linha && !pc.matches ? "#sacola" : "#inicio");
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
        // pizza sem preço próprio: o tamanho é o preço, não um acréscimo
        const soma = precoBase(i) > 0 || g.tipo !== "unica" || !g.min;
        const preco = o.preco ? ` <span class="v">${soma ? "+ " : ""}${reais(o.preco)}</span>` : "";
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
  // pizza sem preço próprio: antes de escolher o tamanho, o botão pede a escolha em vez de mostrar R$ 0,00
  const unitario = precoUnitario(i, escolhas);
  const falta = !unitario && i.grupos.find((g) => Object.values(escolhas[g.id] || {}).reduce((s, n) => s + n, 0) < g.min);
  const botao = document.getElementById("btn-adicionar");
  botao.classList.toggle("escolher", !!falta);
  botao.innerHTML = falta ? `<span>Escolha: ${esc(falta.nome)}</span>`
    : `<span>${STATE.produto.uid ? "Atualizar" : "Adicionar"}</span><span>${reais(unitario * qtd)}</span>`;
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
  if (e.key === "Escape" && document.body.dataset.tela === "produto") location.hash = document.querySelector("#tela-produto .x").getAttribute("href");
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
  location.hash = document.querySelector("#tela-produto .x").getAttribute("href");
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
      ${linhaDesconto()}
      <div class="tl"><span>Taxa de entrega</span><span>${textoTaxa()}</span></div>
      <div class="tl total"><span>Total</span><span>${reais(totalPedido())}</span></div>
    </div>
    <a class="btn" href="${aside.dataset.destino}">${esc(aside.dataset.resumo)}</a>`;
}

// "Calcular taxa e tempo de entrega": depois do bairro informado, mostra a taxa e o tempo
function htmlLinhaTaxa() {
  const e = STATE.entrega;
  const texto = STATE.tipo === "entrega" && e.status === "ok" ? `${esc(e.bairro)}: ${reais(e.valor)} • ${e.min}-${e.max} min` : "Calcular taxa e tempo de entrega";
  return `<i data-ic="pino"></i><span>${texto}</span><i data-ic="direita" class="seta"></i>`;
}

function renderSacolas() {
  const vazia = !STATE.sacola.length;
  const sub = subtotal();
  document.querySelectorAll(".linha-taxa").forEach((el) => (el.innerHTML = htmlLinhaTaxa()));
  document.querySelectorAll("[data-subtotal]").forEach((el) => (el.textContent = reais(sub)));
  document.querySelectorAll("[data-taxa]").forEach((el) => (el.textContent = textoTaxa()));
  document.querySelectorAll("[data-total]").forEach((el) => (el.textContent = reais(totalPedido())));
  document.querySelectorAll("[data-desc-linha]").forEach((el) => (el.hidden = !desconto()));
  document.querySelectorAll("[data-desc-nome]").forEach((el) => (el.textContent = STATE.cupom ? `Cupom ${STATE.cupom.codigo}` : ""));
  document.querySelectorAll("[data-desc]").forEach((el) => (el.textContent = `- ${reais(desconto())}`));
  document.querySelectorAll("[data-cupom-linha]").forEach((el) => (el.innerHTML = htmlCupom()));

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
  // sugestão que saiu do cardápio ou esgotou não aparece
  const sugeridos = SUGESTOES.filter((id) => !STATE.sacola.some((l) => l.itemId === id)).map(item).filter((s) => s && !s.esgotado);
  document.getElementById("sacola-sugestoes").hidden = !sugeridos.length;
  document.getElementById("sugestoes").innerHTML = sugeridos.map((s) => `
    <a class="c" href="#produto/${esc(s.id)}">${foto(s.fotoUrl)}<div>${esc(s.nome)}<b>${precoVitrine(s)}</b></div></a>`).join("");
  const continuar = document.querySelector("[data-continuar]");
  continuar.classList.toggle("desligado", vazia);
  continuar.classList.toggle("fechada", !LOJA.aberta);
  continuar.innerHTML = LOJA.aberta ? "Continuar pedido" : `<i data-ic="relogio"></i>Restaurante fechado agora`;

  // coluna do computador
  const lateral = `
    <button class="linha-taxa" data-calcular>${htmlLinhaTaxa()}</button>
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
          ${linhaDesconto()}
          <div class="tl"><span>Taxa de entrega</span><span>${textoTaxa()}</span></div>
          <div class="tl total"><span>Total</span><span>${reais(totalPedido())}</span></div>
        </div>`}
    ${htmlCupom()}
    ${vazia ? `<span class="btn desligado">Sacola vazia</span>`
      : !LOJA.aberta ? `<span class="btn fechada"><i data-ic="relogio"></i>Restaurante fechado agora</span>`
      : `<a class="btn" href="#entrega">Continuar pedido</a>`}`;
  document.querySelectorAll(".sacola-lateral").forEach((el) => (el.innerHTML = lateral));

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
  if (e.target.closest("[data-calcular]")) {
    if (!STATE.sacola.length) toast("Escolha um item primeiro. A taxa sai pelo bairro, no endereço de entrega.", "info", 3500);
    else if (!LOJA.aberta) toast("O restaurante está fechado agora.", "info", 3000);
    else location.hash = "#entrega";
    return;
  }
  if (e.target.closest(".desligado, .fechada")) { e.preventDefault(); return; }
  if (e.target.closest('#tela-dados a[href="#entrega"]') && !salvarDados()) { e.preventDefault(); return; }
  if (e.target.closest("[data-sem-troco]")) { document.getElementById("troco").value = ""; toast("Certo, sem troco.", "info", 2000); return; }
  if (e.target.closest("[data-enviar]")) enviarPedido();
});

/* ===== S12 entrega: tipo de pedido e taxa ===== */
function renderEntrega() {
  STATE.entrega = calcularEntrega(document.getElementById("f-bairro").value);
  const caixa = document.querySelector(".resultado");
  const e = STATE.entrega;
  caixa.classList.toggle("fora", e.status === "fora");
  caixa.classList.toggle("neutro", e.status === "vazio");
  caixa.innerHTML = e.status === "ok"
    ? `<i data-ic="check"></i><span>Entregamos no seu endereço</span><span>${reais(e.valor)} • ${e.min}-${e.max} min</span>`
    : e.status === "fora"
      ? `<i data-ic="info"></i><span>Ainda não entregamos nesse bairro</span>`
      : `<i data-ic="info"></i><span>Informe o bairro para calcular a taxa</span>`;
  pintarIcones(caixa);
  renderSacolas();
}
document.getElementById("f-bairro").addEventListener("input", renderEntrega);

/* CEP e localização preenchem rua e bairro; o bairro vira o nome da lista da loja quando bate */
function preencherEndereco({ rua, numero, bairros }) {
  const set = (id, v) => { if (v) document.getElementById(id).value = v; };
  set("f-rua", rua);
  set("f-num", numero);
  const nomes = bairros.filter(Boolean);
  const daLoja = nomes.map((n) => BAIRROS.find((b) => semAcento(n).includes(semAcento(b.nome)))).find(Boolean);
  set("f-bairro", daLoja ? daLoja.nome : nomes[0]);
  renderEntrega();
}
const campoCep = document.getElementById("f-cep");
campoCep.addEventListener("input", () => {
  const d = soDigitos(campoCep.value).slice(0, 8);
  campoCep.value = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
});
async function buscarCep() {
  const cep = soDigitos(campoCep.value);
  if (cep.length !== 8) { toast("Digite os 8 números do CEP.", "erro", 3000); campoCep.focus(); return; }
  try {
    const r = await (await fetch(`https://viacep.com.br/ws/${cep}/json/`)).json();
    if (r.erro) { toast("Não achamos esse CEP. Confira os números.", "erro", 3500); return; }
    preencherEndereco({ rua: r.logradouro, bairros: [r.bairro] });
    toast(r.logradouro ? "Endereço preenchido. Falta o número." : "CEP sem rua cadastrada. Digite a rua.", "info", 3000);
    document.getElementById(r.logradouro ? "f-num" : "f-rua").focus();
  } catch { toast("Não deu para buscar o CEP. Confira a internet ou digite o endereço.", "erro", 4000); }
}
document.querySelectorAll("[data-cep]").forEach((b) => b.addEventListener("click", buscarCep));
campoCep.addEventListener("keydown", (e) => { if (e.key === "Enter") buscarCep(); });

document.querySelector("[data-localizacao]").addEventListener("click", (e) => {
  const botao = e.currentTarget;
  if (!navigator.geolocation) { toast("Este aparelho não informa a localização. Digite o endereço.", "erro", 4000); return; }
  botao.disabled = true;
  navigator.geolocation.getCurrentPosition(async ({ coords }) => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&accept-language=pt-BR&lat=${coords.latitude}&lon=${coords.longitude}`;
      const a = (await (await fetch(url)).json()).address || {};
      preencherEndereco({ rua: a.road, numero: a.house_number, bairros: [a.suburb, a.neighbourhood, a.quarter, a.city_district] });
      if (a.postcode) campoCep.value = a.postcode;
      toast("Confira o endereço e o número antes de seguir.", "info", 3500);
    } catch { toast("Não deu para achar o endereço. Digite ele, por favor.", "erro", 4000); }
    botao.disabled = false;
  }, () => {
    botao.disabled = false;
    toast("Sem permissão para a localização. Digite o endereço.", "erro", 4000);
  }, { enableHighAccuracy: true, timeout: 15000 });
});
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
  document.getElementById("abas-pagamento").hidden = !LOJA.pagamentoOnline;
  document.getElementById("titulo-na-entrega").hidden = LOJA.pagamentoOnline;
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

/* ===== S09 seus dados ===== */
function preencherDados() {
  const c = STATE.cliente || {};
  document.getElementById("c-nome").value = c.nome || "";
  document.getElementById("c-fone").value = fmtFone(c.telefone || "");
}
document.querySelectorAll("#c-fone, #p-fone").forEach((el) => el.addEventListener("input", (e) => {
  e.target.value = fmtFone(soDigitos(e.target.value).slice(0, 11));
  if (soDigitos(e.target.value).length === 11) buscarNome(e.target);
}));
// número de quem já pediu: o nome vem da ficha, em qualquer aparelho
async function buscarNome(campoFone) {
  const campoNome = document.getElementById(campoFone.id === "p-fone" ? "p-nome" : "c-nome");
  if (campoNome.value.trim()) return;
  const ficha = await lerFicha(soDigitos(campoFone.value)).catch(() => null);
  if (!ficha?.nome || campoNome.value.trim()) return;
  campoNome.value = ficha.nome;
  toast(`Que bom te ver de novo, ${ficha.nome.split(" ")[0]}.`, "sucesso", 3000);
}
function salvarDados(idNome = "c-nome", idFone = "c-fone") {
  const c = { nome: campo(idNome).replace(/\s+/g, " "), telefone: soDigitos(campo(idFone)) };
  if (c.nome.length < 2) { toast("Digite seu nome.", "erro", 3000); return false; }
  if (!/^\d{10,11}$/.test(c.telefone)) { toast("Digite o WhatsApp com DDD.", "erro", 3000); return false; }
  STATE.cliente = c;
  if (!EXEMPLO) try { localStorage.setItem(CHAVE_CLIENTE, JSON.stringify(c)); } catch { /* vale só nesta visita */ }
  return true;
}

/* ===== S15 revisar e enviar ===== */
const hh = (d) => `${String(d.getHours()).padStart(2, "0")}h${String(d.getMinutes()).padStart(2, "0")}`;
const somaMin = (d, m) => new Date(d.getTime() + m * 60000);
// minutos até chegar: a conta da entrega pela distância; retirada e no local têm 20 a 30 min
function janela(tipo, km) {
  if (tipo !== "entrega") return [20, 30];
  const min = minutosKm(km, LOJA.entrega);
  return [min, min + 10];
}
const ONDE = { entrega: "na entrega", retirada: "na retirada", local: "no local" };
const formaAtual = () => FORMAS[STATE.aba].find((f) => f.id === STATE.forma) || FORMAS[STATE.aba][0];
const textoForma = () => (STATE.aba === "online" ? `${formaAtual().nome} online` : `${formaAtual().nome} ${ONDE[STATE.tipo]}`);

function renderRevisar() {
  const sub = subtotal(), tx = taxa();
  const [min, max] = janela(STATE.tipo, STATE.entrega.km);
  const agora = new Date();
  const chega = `${STATE.tipo === "entrega" ? "Chega" : "Fica pronto"} entre ${hh(somaMin(agora, min))} e ${hh(somaMin(agora, max))}`;
  const receber = STATE.tipo === "entrega"
    ? `<i data-ic="entrega"></i><div><b>${esc(campo("f-rua"))}, ${esc(campo("f-num"))}</b><p>${esc(STATE.entrega.bairro)}${campo("f-compl") ? `, ${esc(campo("f-compl"))}` : ""} · Ref.: ${esc(campo("f-ref"))}</p><p class="ok">${chega}</p></div>`
    : `<i data-ic="${STATE.tipo === "retirada" ? "loja" : "mesa"}"></i><div><b>${STATE.tipo === "retirada" ? "Retirada no restaurante" : "Consumo no local"}</b><p>${esc(LOJA.nome)}</p><p class="ok">${chega}</p></div>`;
  const dinheiro = STATE.aba === "entrega" && STATE.forma === "dinheiro";
  const trocoAntes = document.getElementById("troco")?.value ?? (EXEMPLO ? "100,00" : "");
  const linhas = STATE.sacola.map((l) => {
    const r = resumoLinha(l);
    return `<div class="linha"><div><b><span>${l.qtd}x</span>${esc(item(l.itemId).nome)}</b>${r ? `<p>${esc(r)}</p>` : ""}</div><span class="v">${reais(totalLinha(l))}</span></div>`;
  }).join("");
  const totais = `
    <div class="tl"><span>Subtotal</span><span>${reais(sub)}</span></div>
    ${linhaDesconto()}
    ${STATE.tipo === "entrega" ? `<div class="tl"><span>Taxa de entrega</span><span>${reais(tx)}</span></div>` : ""}
    <div class="tl total"><span>Total</span><span>${reais(totalPedido())}</span></div>`;

  document.getElementById("revisar-main").innerHTML = `
    <div class="sec so-cel"><div class="sec-t"><span>Itens</span><a href="#sacola">Editar</a></div>${linhas}</div>
    <div class="sec"><div class="sec-t"><span>${{ entrega: "Entrega", retirada: "Retirada", local: "No local" }[STATE.tipo]}</span><a href="#entrega">Alterar</a></div><div class="info">${receber}</div></div>
    <div class="sec"><div class="sec-t"><span>Seus dados</span><a href="#dados">Alterar</a></div>
      <div class="info"><i data-ic="user"></i><div><b>${esc(STATE.cliente.nome)}</b><p>${fmtFone(STATE.cliente.telefone)}</p></div></div></div>
    <div class="sec"><div class="sec-t"><span>Pagamento</span><a href="#pagamento">Alterar</a></div>
      <div class="info"><i data-ic="${formaAtual().ic}"></i><div><b>${textoForma()}</b>${dinheiro ? "<p>Troco para quanto?</p>" : ""}</div></div>
      ${dinheiro ? `<div class="troco"><label class="in"><small>R$</small><input id="troco" inputmode="decimal" placeholder="0,00" value="${esc(trocoAntes)}" aria-label="Troco para quanto" /></label><button type="button" class="sem-troco" data-sem-troco>Não preciso<span class="so-pc"> de troco</span></button></div>` : ""}</div>
    <div class="sec so-cel">${totais}</div>`;
  document.getElementById("revisar-lado").innerHTML = `
    <div class="h"><h2>Seu pedido</h2><a href="#inicio">Editar</a></div>
    ${STATE.sacola.map((l) => {
      const i = item(l.itemId), r = resumoLinha(l);
      return `<div class="li"><span><b>${l.qtd}x</b>${esc(i.nome)}${r ? `<small>${esc(r)}</small>` : ""}</span><span class="${i.precoPromo ? "preco-promo" : ""}">${reais(totalLinha(l))}</span></div>`;
    }).join("")}
    <div class="tls">${totais}</div>
    <button class="btn enviar" data-enviar></button>`;
  marcarEnviar();
  pintarIcones(document.getElementById("tela-revisar"));
}
function marcarEnviar() {
  document.querySelectorAll(".btn.enviar").forEach((b) => {
    b.classList.toggle("desligado", STATE.enviando);
    b.innerHTML = STATE.enviando ? "<span>Enviando...</span>" : `<span>Enviar pedido</span><span>${reais(totalPedido())}</span>`;
  });
}
// "100", "100,00" ou "1.000,50" em centavos; vazio é sem troco
function lerTroco() {
  const el = document.getElementById("troco");
  if (!el || !el.value.trim()) return 0;
  const n = Math.round(Number(el.value.replace(/\./g, "").replace(",", ".")) * 100);
  if (!Number.isFinite(n) || n <= 0) { toast("Troco: digite só o valor, por exemplo 100,00.", "erro", 3500); return null; }
  if (n <= totalPedido()) { toast("O troco precisa ser para um valor maior que o total.", "erro", 3500); return null; }
  return n;
}

/* ===== envio: grava em pedidosEntrada; o painel move para pedidos quando aceita ===== */
const CHAVE_PEDIDOS = `deliverymenu:pedidos:${LOJA.id}`;
function meusPedidos() { try { return JSON.parse(localStorage.getItem(CHAVE_PEDIDOS)) || []; } catch { return []; } }

async function enviarPedido() {
  if (STATE.enviando) return; // duplo clique não manda dois pedidos
  if (!LOJA.aberta) { toast("O restaurante não está recebendo pedidos agora.", "erro", 4000); return; }
  const troco = lerTroco();
  if (troco === null) return;
  const km = STATE.entrega.km || 0;
  const pedido = {
    cliente: { nome: STATE.cliente.nome, telefone: STATE.cliente.telefone },
    tipo: STATE.tipo,
    endereco: STATE.tipo === "entrega"
      ? { rua: campo("f-rua"), numero: campo("f-num"), bairro: STATE.entrega.bairro, complemento: campo("f-compl"), referencia: campo("f-ref"), cep: campo("f-cep"), km: Math.round(km * 10) / 10 }
      : null,
    itens: STATE.sacola.map((l) => ({ qtd: l.qtd, nome: item(l.itemId).nome, total: totalLinha(l), resumo: resumoLinha(l, false), obs: l.obs || "" })),
    subtotal: subtotal(),
    taxa: taxa(),
    total: totalPedido(),
    ...(desconto() ? { cupom: STATE.cupom.codigo, desconto: desconto() } : {}),
    pagamento: { forma: formaAtual().nome, online: STATE.aba === "online", ...(troco ? { troco } : {}) },
    status: "novo",
  };

  if (!SLUG) { // loja de exemplo: mostra o acompanhamento sem mandar nada
    STATE.exemploPedido = { id: "exemplo", ...pedido, criadoEm: new Date() };
    if (!EXEMPLO) { STATE.sacola = []; salvarSacola(); tirarCupom(false); }
    location.hash = "#pedido/exemplo";
    toast("Versão de demonstração: o pedido não foi enviado a nenhum restaurante.", "info", 6000);
    return;
  }
  STATE.enviando = true;
  marcarEnviar();
  try {
    const { db } = await import("./firebase-init.js?v=2");
    const { collection, addDoc, serverTimestamp } = await import(FIRESTORE);
    const ref = await addDoc(collection(db, "lojas", LOJA.id, "pedidosEntrada"), { ...pedido, criadoEm: serverTimestamp() });
    try { localStorage.setItem(CHAVE_PEDIDOS, JSON.stringify([ref.id, ...meusPedidos()].slice(0, 20))); } catch { /* sem armazenamento */ }
    if (pedido.endereco) guardarEndereco(pedido.endereco);
    tirarCupom(false);
    STATE.sacola = [];
    salvarSacola();
    location.hash = `#pedido/${ref.id}`;
  } catch (err) {
    // o cupom pode ter vencido ou esgotado entre a sacola e o envio
    const motivo = err?.code === "permission-denied" && STATE.cupom ? await cupomAindaServe() : "";
    if (motivo) { tirarCupom(false); toast(`${motivo} O cupom saiu do pedido; confira o total e envie de novo.`, "erro", 6000); renderRevisar(); return; }
    toast(err?.code === "permission-denied" ? "O restaurante não está recebendo pedidos agora." : "Não deu para enviar. Confira a internet e tente de novo.", "erro", 5000);
  } finally {
    STATE.enviando = false;
    marcarEnviar();
  }
}

/* ===== S16 a S18 acompanhar: lê o pedido pelo id, na entrada ou já aceito ===== */
let pararAcomp = null;
function pararAcompanhar() { if (pararAcomp) { pararAcomp(); pararAcomp = null; } }
async function acompanhar(id) {
  pararAcompanhar();
  if (!SLUG) {
    const p = id === "exemplo" && STATE.exemploPedido ? STATE.exemploPedido : EXEMPLO && /^exemplo/.test(id) ? pedidoExemplo(id) : null;
    if (p) renderAcompanhar(p); else location.replace("#inicio");
    return;
  }
  const { db } = await import("./firebase-init.js?v=2");
  const { doc, onSnapshot } = await import(FIRESTORE);
  const vivo = { entrada: undefined, aceito: undefined, viu: false };
  const mostrar = () => {
    if (vivo.entrada === undefined || vivo.aceito === undefined) return; // espera as duas leituras
    const p = vivo.aceito || vivo.entrada;
    if (p) { vivo.viu = true; renderAcompanhar(p); }
    else if (!vivo.viu) document.getElementById("acompanhar").innerHTML = `<p class="nao-achou">Não encontramos este pedido.</p>`;
    // as duas vazias depois de ter visto: é o instante em que o painel move o pedido; fica a última tela
  };
  const ler = (snap) => (snap.exists() ? { id, ...snap.data({ serverTimestamps: "estimate" }) } : null);
  const erro = () => toast("Não deu para atualizar o pedido. Confira a internet.", "erro", 4000);
  const u1 = onSnapshot(doc(db, "lojas", LOJA.id, "pedidosEntrada", id), (s) => { vivo.entrada = ler(s) && { ...ler(s), status: "novo" }; mostrar(); }, erro);
  const u2 = onSnapshot(doc(db, "lojas", LOJA.id, "pedidos", id), (s) => { vivo.aceito = ler(s); mostrar(); }, erro);
  pararAcomp = () => { u1(); u2(); };
}

// estados das imagens S16 a S18 no modo exemplo: #pedido/exemplo, exemplo-aceito, exemplo-recusado
function pedidoExemplo(id) {
  const base = new Date(); base.setHours(19, 5, 0, 0);
  const p = { id, tipo: "entrega", endereco: { km: 1.6 }, criadoEm: base, status: "novo" };
  if (id === "exemplo-aceito") Object.assign(p, { status: "preparo", numero: 1052, aceitoEm: somaMin(base, 1) });
  if (id === "exemplo-recusado") Object.assign(p, { status: "cancelado", concluidoEm: somaMin(base, 2) });
  if (id === "exemplo-entregue") Object.assign(p, { status: "entregue", numero: 1031, aceitoEm: somaMin(base, 1), saiuEm: somaMin(base, 20), concluidoEm: somaMin(base, 38) });
  return p;
}
const quando = (t) => (t instanceof Date ? t : t?.toDate ? t.toDate() : null);
function renderAcompanhar(p) {
  const criado = quando(p.criadoEm) || new Date();
  const aceito = quando(p.aceitoEm), saiu = quando(p.saiuEm), fim = quando(p.concluidoEm);
  const entrega = p.tipo === "entrega";
  const cancelado = p.status === "cancelado";
  const nomeFim = entrega ? "Entregue" : p.tipo === "retirada" ? "Retirado" : "Servido";
  const topo = {
    novo: ["relogio", "espera", "Pedido enviado!", "Assim que o restaurante aceitar, o pedido ganha número e vai para o preparo."],
    preparo: ["check", "", "Pedido aceito!", "O restaurante já está preparando o seu pedido."],
    saiu: ["entrega", "", "Saiu para entrega!", "O pedido está a caminho."],
    entregue: ["check", "", `Pedido ${nomeFim.toLowerCase()}!`, "Obrigado pela preferência."],
    cancelado: ["x", "nao", "Pedido não aceito", "O restaurante não pôde aceitar este pedido agora. Nada foi cobrado."],
  }[p.status] || ["relogio", "espera", "Pedido enviado!", ""];

  // etapas: [nome, texto pequeno quando feita ou atual]
  const etapas = cancelado
    ? [["Pedido enviado", hh(criado)], ["Não aceito pelo restaurante", fim ? hh(fim) : ""]]
    : [
      ["Pedido enviado", hh(criado)],
      ["Aceito pelo restaurante", aceito ? hh(aceito) : "Aguardando o restaurante aceitar"],
      ["Em preparo", aceito ? `Começou às ${hh(aceito)}` : ""],
      ...(entrega ? [["Saiu para entrega", saiu ? hh(saiu) : ""]] : []),
      [nomeFim, fim ? hh(fim) : ""],
    ];
  const atual = cancelado ? 1 : { novo: 1, preparo: 2, saiu: 3 }[p.status] ?? etapas.length;
  const passos = etapas.map(([nome, peq], n) => {
    const classe = cancelado && n === 1 ? "nao" : n < atual ? "feito" : n === atual ? "atual" : "";
    const marca = classe === "feito" ? `<i data-ic="check" class="marca"></i>` : classe === "nao" ? `<i data-ic="x" class="marca"></i>` : "";
    return `<li class="${classe}">${marca}${nome}${classe && peq ? ` <small>${peq}</small>` : ""}</li>`;
  }).join("");

  const [min, max] = janela(p.tipo, p.endereco?.km);
  const rotuloPrazo = entrega ? "Previsão de entrega" : p.tipo === "retirada" ? "Previsão para retirar" : "Previsão";
  const numero = p.numero ? `<b>#${p.numero}</b>` : `<b class="espera">${cancelado ? "Sem número" : "Aguardando aceite"}</b>`;
  // depois de entregue, a previsão dá lugar à hora em que terminou
  const terminou = p.status === "entregue";
  const prazo = cancelado ? `<b class="espera">-</b>` : terminou ? `<b>${fim ? hh(fim) : "-"}</b>` : `<b>${hh(somaMin(criado, min))} - ${hh(somaMin(criado, max))}</b>`;
  const segue = !cancelado && p.status !== "entregue";
  const zap = LOJA.whatsapp ? `<a class="btn fantasma" href="https://wa.me/55${soDigitos(LOJA.whatsapp)}" target="_blank" rel="noopener"><i data-ic="conversa"></i>Falar com o restaurante</a>` : "";

  const caixa = document.getElementById("acompanhar");
  caixa.innerHTML = `
    <div class="ok"><div class="selo-ok ${topo[1]}"><i data-ic="${topo[0]}"></i></div><h1>${topo[2]}</h1><p>${topo[3]}</p></div>
    <div class="num"><div><small>Pedido</small>${numero}</div><div><small>${terminou ? `${nomeFim} às` : rotuloPrazo}</small>${prazo}</div></div>
    <ol class="passos">${passos}</ol>
    ${segue ? `<p class="fica"><i data-ic="info"></i><span><span class="so-cel">Pode fechar esta tela: o pedido fica em Pedidos, na barra de baixo, e a situação atualiza sozinha.</span><span class="so-pc">Pode fechar esta página: o pedido fica em Pedidos, no topo, e a situação atualiza sozinha.</span></span></p>` : ""}
    <div class="rodape duplo${zap ? "" : " um"}">${zap}<a class="btn" href="#inicio">Voltar ao cardápio</a></div>`;
  pintarIcones(caixa);
}

/* ===== S20 / D20 mais informações ===== */
const horaTexto = (hhmm) => (hhmm === "00:00" ? "meia-noite" : hhmm.replace(":", "h"));
function faixaTaxas() {
  const valores = BAIRROS.map((b) => calcularEntrega(b.nome)).filter((e) => e.status === "ok").map((e) => e.valor);
  return valores.length ? [Math.min(...valores), Math.max(...valores)] : null;
}
const CHIPS = { dinheiro: "Dinheiro", "pix-entrega": "Pix", credito: "Crédito", debito: "Débito" };
function abrirInfo() {
  const hoje = DIAS[agora().dia];
  const blocos = [];
  if (LOJA.endereco || LOJA.local) {
    // bairro e cidade só na linha de baixo quando o endereço ainda não traz
    const resto = [LOJA.bairro, LOJA.cidade].filter((x) => x && !semAcento(LOJA.endereco || "").includes(semAcento(x.split(" - ")[0])));
    const mapa = LOJA.local ? `${LOJA.local.lat},${LOJA.local.lng}` : `${LOJA.endereco}, ${LOJA.cidade}`;
    blocos.push(`<div class="b-info b-end"><div class="rot-i">Endereço</div>
      <div class="lin"><i data-ic="pino"></i><div><b>${esc(LOJA.endereco || "Ponto marcado no mapa")}</b>${resto.length ? `<p>${esc(resto.join(", "))}</p>` : ""}
      <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapa)}" target="_blank" rel="noopener">Ver no mapa</a></div></div></div>`);
  }
  if (LOJA.horario) blocos.push(`<div class="b-info b-hor"><div class="rot-i">Horário</div><div class="dias">${ORDEM.map((d) => {
    const h = LOJA.horario[d];
    const quando = h?.aberto ? `${horaTexto(h.abre)} ${h.fecha === "00:00" ? "à" : "às"} ${horaTexto(h.fecha)}` : `<span class="fec">Fechado</span>`;
    return `<div class="dia-i${d === hoje ? " hoje" : ""}"><span>${NOMES[d]}${d === hoje ? " (hoje)" : ""}</span><span>${quando}</span></div>`;
  }).join("")}</div></div>`);
  blocos.push(`<div class="b-info b-pag"><div class="rot-i">Pagamento na entrega</div><div class="chips">${FORMAS.entrega.map((f) => `<span class="chip-pag"><i data-ic="${f.ic}"></i>${CHIPS[f.id]}</span>`).join("")}</div></div>`);
  const faixa = faixaTaxas();
  if (faixa) blocos.push(`<div class="b-info b-ent"><div class="rot-i">Entrega</div><div class="lin"><i data-ic="entrega"></i><div>
    <b>${faixa[0] === faixa[1] ? reais(faixa[0]) : `${reais(faixa[0])} a ${reais(faixa[1])}`}</b><p>Depende do bairro. Calcule no endereço de entrega.</p></div></div></div>`);
  document.getElementById("info-corpo").innerHTML = blocos.join("");
  const rodape = document.getElementById("info-rodape");
  rodape.innerHTML = LOJA.whatsapp
    ? `<a class="btn fantasma" href="https://wa.me/55${soDigitos(LOJA.whatsapp)}" target="_blank" rel="noopener"><i data-ic="conversa"></i>Falar no WhatsApp</a>` : "";
  rodape.hidden = !LOJA.whatsapp;
  document.getElementById("info-loja").hidden = false;
  document.body.classList.add("com-janela");
  pintarIcones(document.getElementById("info-loja"));
}
function fecharInfo() {
  document.getElementById("info-loja").hidden = true;
  document.body.classList.remove("com-janela");
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-info]")) abrirInfo();
  else if (e.target.closest("[data-fechar-info]")) fecharInfo();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharInfo(); });

/* ===== S21 / D21 promoções: itens com preço de oferta ===== */
function renderPromocoes() {
  const promo = ITENS.filter((i) => i.precoPromo && !i.esgotado);
  document.getElementById("promocoes").innerHTML = promo.length
    ? `<div class="lista-itens">${promo.map(cardItem).join("")}</div>`
    : `<div class="vazio-pag"><i data-ic="promo"></i><b>Nenhuma promoção agora</b><p>Quando o restaurante baixar um preço, o item aparece aqui.</p></div>`;
  pintarIcones(document.getElementById("tela-promocoes"));
}

/* ===== S22 / D22 pedidos feitos neste aparelho ===== */
const DIA_CURTO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
function quandoFoi(d) {
  const zero = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((zero(new Date()) - zero(d)) / 86400000);
  const dia = dias === 0 ? "Hoje" : dias === 1 ? "Ontem" : `${DIA_CURTO[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `${dia}, ${hh(d)}`;
}
const SITUACAO = {
  novo: ["novo", "Enviado"], preparo: ["prep", "Em preparo"], saiu: ["prep", "Saiu para entrega"],
  entregue: ["ok", "Entregue"], cancelado: ["nao", "Não aceito"],
};
function cartaoPedido(p) {
  const [classe, texto] = SITUACAO[p.status] || SITUACAO.novo;
  const rotulo = p.status === "entregue" ? { retirada: "Retirado", local: "Servido" }[p.tipo] || texto : texto;
  const num = p.numero ? `<b>#${p.numero}</b>` : `<b class="espera">${p.status === "cancelado" ? "Sem número" : "Aguardando aceite"}</b>`;
  const itens = (p.itens || []).map((i) => `${i.qtd}x ${i.nome}`).join(", ");
  const corpo = `<div class="l1">${num}<span class="quando">${quandoFoi(quando(p.criadoEm) || new Date())}</span>${p.id ? '<i data-ic="direita"></i>' : ""}</div>
    <p>${esc(itens)}</p><div class="l3"><span class="st ${classe}">${rotulo}</span><strong>${reais(p.total || 0)}</strong></div>`;
  // pedido feito em outro aparelho vem só da ficha, sem o acompanhamento
  return p.id ? `<a class="ped-c" href="#pedido/${esc(p.id)}">${corpo}</a>` : `<div class="ped-c">${corpo}</div>`;
}
// pedidos de exemplo das imagens S22 e D22
function pedidosExemplo() {
  const em = (dias, h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); d.setDate(d.getDate() - dias); return d; };
  return [
    { id: "exemplo-aceito", numero: 1052, status: "preparo", criadoEm: em(0, 19, 5), total: 5490, itens: [{ qtd: 1, nome: "Clássico da Casa" }, { qtd: 1, nome: "Smash Simples" }] },
    { id: "exemplo-novo", status: "novo", criadoEm: em(0, 19, 22), total: 3100, itens: [{ qtd: 2, nome: "Milk-shake 400 ml" }] },
    { id: "exemplo-entregue", numero: 1031, status: "entregue", tipo: "entrega", criadoEm: em(4, 20, 14), total: 7790, itens: [{ qtd: 1, nome: "Combo Dupla" }, { qtd: 1, nome: "Batata média" }] },
    { id: "exemplo-recusado", status: "cancelado", criadoEm: em(5, 21, 40), total: 3700, itens: [{ qtd: 1, nome: "Bacon Duplo" }] },
  ];
}
// ficha do cliente pelo número (ficha-cliente.js): o nome e o resumo dos pedidos, sem endereço
async function lerFicha(telefone) {
  if (!SLUG || !/^\d{10,11}$/.test(telefone || "")) return null;
  const { db } = await import("./firebase-init.js?v=2");
  const { doc, getDoc } = await import(FIRESTORE);
  const snap = await getDoc(doc(db, "lojas", LOJA.id, "clientes", telefone));
  return snap.exists() ? snap.data() : null;
}
// os pedidos deste aparelho (abrem o acompanhamento) e os da ficha do número, feitos em outro aparelho
async function lerPedidos() {
  if (!SLUG) return EXEMPLO ? pedidosExemplo() : STATE.exemploPedido ? [STATE.exemploPedido] : [];
  const ids = meusPedidos();
  const { db } = await import("./firebase-init.js?v=2");
  const { doc, getDoc } = await import(FIRESTORE);
  const [lidos, ficha] = await Promise.all([
    Promise.all(ids.map(async (id) => {
      const [aceito, entrada] = await Promise.all(["pedidos", "pedidosEntrada"].map((c) => getDoc(doc(db, "lojas", LOJA.id, c, id)).catch(() => null)));
      if (aceito?.exists()) return { id, ...aceito.data({ serverTimestamps: "estimate" }) };
      if (entrada?.exists()) return { id, ...entrada.data({ serverTimestamps: "estimate" }), status: "novo" };
      return null; // apagado no painel
    })),
    lerFicha(STATE.cliente?.telefone).catch(() => null),
  ]);
  const daqui = lidos.filter(Boolean);
  const chaves = new Set(await Promise.all(daqui.map((x) => chavePedido(x.id))));
  const deFora = Object.entries(ficha?.pedidos || {}).filter(([k, r]) => !chaves.has(k) && r.status).map(([, r]) => r);
  return [...daqui, ...deFora].sort((a, b) => (quando(b.criadoEm)?.getTime() || 0) - (quando(a.criadoEm)?.getTime() || 0));
}
async function renderPedidos() {
  const caixa = document.getElementById("lista-pedidos");
  caixa.innerHTML = `<p class="carregando-p">Buscando seus pedidos...</p>`;
  let lista;
  try { lista = await lerPedidos(); } catch { caixa.innerHTML = `<p class="carregando-p">Não deu para buscar os pedidos. Confira a internet.</p>`; return; }
  if (document.body.dataset.tela !== "pedidos") return;
  const andamento = lista.filter((p) => ["novo", "preparo", "saiu"].includes(p.status));
  const antes = lista.filter((p) => !andamento.includes(p));
  caixa.innerHTML = !lista.length
    ? `<div class="vazio-pag"><i data-ic="sacola"></i><b>Nenhum pedido ainda</b><p>${STATE.cliente ? "Os pedidos que você fizer neste restaurante aparecem aqui."
      : `Já pediu antes em outro aparelho? Salve seu WhatsApp em <a href="#perfil">Perfil</a> e os pedidos aparecem aqui.`}</p></div>`
    : (andamento.length ? `<h2 class="sub-t">Em andamento</h2>${andamento.map(cartaoPedido).join("")}` : "")
      + (antes.length ? `<h2 class="sub-t">Anteriores</h2>${antes.map(cartaoPedido).join("")}` : "");
  pintarIcones(caixa);
}

/* ===== S23 / D23 perfil: nome, WhatsApp e o último endereço, só no aparelho ===== */
const CHAVE_END = "deliverymenu:endereco";
const ENDERECO_EXEMPLO = { rua: "Travessa das Flores", numero: "120", bairro: "Centro", complemento: "", referencia: "Em frente à praça", cep: "66000-000" };
function lerEndereco() {
  if (EXEMPLO) return ENDERECO_EXEMPLO;
  try { return JSON.parse(localStorage.getItem(CHAVE_END)); } catch { return null; }
}
function guardarEndereco(e) {
  if (EXEMPLO) return;
  try { localStorage.setItem(CHAVE_END, JSON.stringify({ rua: e.rua, numero: e.numero, bairro: e.bairro, complemento: e.complemento, referencia: e.referencia, cep: e.cep })); } catch { /* sem armazenamento */ }
}
// o endereço guardado entra nos campos da entrega, só nos que ainda estão vazios
function preencherEnderecoGuardado() {
  const e = lerEndereco();
  if (!e || EXEMPLO) return;
  [["f-cep", e.cep], ["f-rua", e.rua], ["f-num", e.numero], ["f-bairro", e.bairro], ["f-compl", e.complemento], ["f-ref", e.referencia]]
    .forEach(([id, v]) => { const el = document.getElementById(id); if (!el.value && v) el.value = v; });
}
function renderPerfil() {
  const c = STATE.cliente || {};
  document.getElementById("p-nome").value = c.nome || "";
  document.getElementById("p-fone").value = fmtFone(c.telefone || "");
  const e = lerEndereco();
  document.getElementById("perfil-endereco").innerHTML = e
    ? `<div class="end-g"><i data-ic="pino"></i><div><b>${esc(e.rua)}, ${esc(e.numero)}</b><p>${esc(e.bairro)}${e.complemento ? `, ${esc(e.complemento)}` : ""} · Ref.: ${esc(e.referencia)}</p></div><button type="button" data-esquecer-end>Esquecer</button></div>`
    : `<p class="end-vazio">Nenhum endereço guardado. Ele fica aqui depois do primeiro pedido com entrega.</p>`;
  pintarIcones(document.getElementById("tela-perfil"));
}
document.addEventListener("click", async (e) => {
  if (e.target.closest("[data-salvar-perfil]")) {
    if (salvarDados("p-nome", "p-fone")) { toast("Dados salvos neste aparelho.", "sucesso", 2500); renderPerfil(); }
  } else if (e.target.closest("[data-esquecer-end]")) {
    try { localStorage.removeItem(CHAVE_END); } catch { /* sem armazenamento */ }
    renderPerfil();
  } else if (e.target.closest("[data-apagar-dados]")) {
    if (!(await confirmar("Apagar nome, WhatsApp, endereço e a lista de pedidos deste aparelho?", { textoConfirmar: "Apagar" }))) return;
    try {
      Object.keys(localStorage).filter((k) => k === CHAVE_CLIENTE || k === CHAVE_END || k.startsWith("deliverymenu:pedidos:")).forEach((k) => localStorage.removeItem(k));
    } catch { /* sem armazenamento */ }
    STATE.cliente = null;
    toast("Dados apagados deste aparelho.", "info", 2500);
    renderPerfil();
  }
});

/* ===== S24 / D24 cupom: a conta mora em cupom.js ===== */
const CHAVE_CUPOM = `deliverymenu:cupom:${LOJA.id}`;
function htmlCupom() {
  const c = STATE.cupom;
  return c
    ? `<div class="cupom ok"><i data-ic="cupom"></i><span>${esc(c.codigo)}<small>${textoDesconto(c, reais)} aplicado</small></span><button type="button" class="tirar" data-tirar-cupom>Remover</button></div>`
    : `<button type="button" class="cupom" data-cupom><i data-ic="cupom"></i><span>Tem um cupom?<small>${pc.matches ? "Clique" : "Toque"} e digite o código</small></span><i data-ic="direita" class="seta"></i></button>`;
}
async function buscarCupom(codigo) {
  if (!SLUG) return CUPONS_EXEMPLO.find((c) => c.codigo === codigo) || null;
  const { db } = await import("./firebase-init.js?v=2");
  const { doc, getDoc } = await import(FIRESTORE);
  const snap = await getDoc(doc(db, "lojas", LOJA.id, "cupons", codigo));
  return snap.exists() ? { codigo, ...snap.data() } : null;
}
const guardavel = (c) => ({ codigo: c.codigo, tipo: c.tipo, valor: c.valor, minimo: c.minimo || 0,
  validoAte: c.validoAte ? (c.validoAte.toDate ? c.validoAte.toDate() : new Date(c.validoAte)).toISOString() : null });
function abrirCupom() {
  document.getElementById("cupom-erro").hidden = true;
  document.getElementById("cupom-codigo").value = "";
  document.getElementById("cupom-janela").hidden = false;
  document.body.classList.add("com-janela");
  pintarIcones(document.getElementById("cupom-janela"));
  document.getElementById("cupom-codigo").focus();
}
function fecharCupom() {
  document.getElementById("cupom-janela").hidden = true;
  if (document.getElementById("info-loja").hidden) document.body.classList.remove("com-janela");
}
function erroCupom(texto) {
  const el = document.getElementById("cupom-erro");
  el.innerHTML = `<i data-ic="info"></i><span>${esc(texto)}</span>`;
  el.hidden = false;
  pintarIcones(el);
}
async function aplicarCupom() {
  const codigo = normalizarCodigo(document.getElementById("cupom-codigo").value);
  if (!codigoValido(codigo)) { erroCupom("Digite o código do cupom."); return; }
  const botao = document.querySelector("[data-aplicar-cupom]");
  botao.classList.add("desligado");
  try {
    const c = await buscarCupom(codigo);
    const motivo = motivoRecusa(c, subtotal(), reais);
    if (motivo) { erroCupom(motivo); return; }
    STATE.cupom = guardavel(c);
    if (!EXEMPLO) try { localStorage.setItem(CHAVE_CUPOM, JSON.stringify(STATE.cupom)); } catch { /* vale só nesta visita */ }
    fecharCupom();
    renderSacolas();
    if (document.body.dataset.tela === "revisar") renderRevisar();
    toast("Cupom aplicado.", "sucesso", 2500);
  } catch { erroCupom("Não deu para conferir o cupom. Confira a internet e tente de novo."); }
  finally { botao.classList.remove("desligado"); }
}
function tirarCupom(redesenhar = true) {
  STATE.cupom = null;
  try { localStorage.removeItem(CHAVE_CUPOM); } catch { /* sem armazenamento */ }
  if (redesenhar) { renderSacolas(); if (document.body.dataset.tela === "revisar") renderRevisar(); }
}
// antes do envio recusado: o cupom ainda serve? devolve o motivo quando não serve
async function cupomAindaServe() {
  try { return motivoRecusa(await buscarCupom(STATE.cupom.codigo), subtotal(), reais); } catch { return ""; }
}
function lerCupomGuardado() {
  if (EXEMPLO) return null;
  try { return JSON.parse(localStorage.getItem(CHAVE_CUPOM)); } catch { return null; }
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-cupom]")) abrirCupom();
  else if (e.target.closest("[data-fechar-cupom]")) fecharCupom();
  else if (e.target.closest("[data-aplicar-cupom]")) aplicarCupom();
  else if (e.target.closest("[data-tirar-cupom]")) tirarCupom();
});
document.getElementById("cupom-codigo").addEventListener("keydown", (e) => { if (e.key === "Enter") aplicarCupom(); });
document.getElementById("cupom-codigo").addEventListener("input", (e) => {
  e.target.value = normalizarCodigo(e.target.value);
  document.getElementById("cupom-erro").hidden = true;
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharCupom(); });

function atualizarAberta() {
  const antes = document.getElementById("loja-situacao").textContent;
  const mudou = recalcularAberta();
  if (!mudou && antes === LOJA.textoSituacao) return;
  renderAberta();
  renderSacolas();
  if (!LOJA.aberta && CHECKOUT.includes(document.body.dataset.tela)) irParaHash();
}
setInterval(atualizarAberta, 60000); // o horário vira sozinho, sem recarregar

/* loja real: abrir e fechar no painel chega aqui na hora */
async function vigiarLoja() {
  if (!SLUG) return;
  const { db } = await import("./firebase-init.js?v=2");
  const { doc, onSnapshot } = await import(FIRESTORE);
  onSnapshot(doc(db, "lojas", SLUG), (snap) => {
    if (!snap.exists()) return;
    const d = snap.data();
    LOJA.ligada = d.aberta !== false;
    LOJA.horario = d.horario || null;
    LOJA.abrirSozinho = !!d.abrirSozinho;
    atualizarAberta();
  }, () => { /* sem internet: segue com o que já leu */ });
}

// modo exemplo: o endereço das imagens validadas (S12, D12)
if (EXEMPLO) [["f-cep", "66000-000"], ["f-rua", "Travessa das Flores"], ["f-num", "120"], ["f-bairro", "Centro"], ["f-ref", "Em frente à praça"]]
  .forEach(([id, v]) => (document.getElementById(id).value = v));
preencherEnderecoGuardado();
STATE.cupom = lerCupomGuardado();
vigiarLoja();
recalcularAberta();
renderInicio();
renderEntrega();
renderTipo();
irParaHash();
document.getElementById("carregando").remove();
