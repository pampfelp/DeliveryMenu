/*
  app.js da loja (o que o cliente vê). Por enquanto lê os dados de exemplo;
  o Firestore entra depois das telas fechadas. O painel do restaurante mora
  em painel.html / painel.js.
*/

import { esc, fmtMoeda } from "./shared.js?v=1";
import { LOJA, CATEGORIAS, SUGESTOES, SACOLA_EXEMPLO } from "./dados-exemplo.js?v=2";
import { pintarIcones } from "./icones.js?v=1";

const reais = (centavos) => fmtMoeda(centavos / 100);
const ITENS = CATEGORIAS.flatMap((c) => c.itens);
const SELOS = { recomendado: "Recomendado", oferta: "Oferta", novo: "Novo" };

// foto enviada pela loja, ou o espaço reservado com o ícone de imagem
const foto = (url, classe = "foto") =>
  url ? `<img class="${classe}" src="${esc(url)}" alt="" loading="lazy" />` : `<div class="${classe}"><i data-ic="foto"></i></div>`;

/* ===== navegação por hash: #inicio, #produto/<id>, #sacola, ... ===== */
function irParaHash() {
  const [tela, param] = (location.hash.slice(1) || "inicio").split("/");
  const alvo = document.getElementById(`tela-${tela}`) ? tela : "inicio";
  document.querySelectorAll(".tela").forEach((s) => s.classList.toggle("ativa", s.id === `tela-${alvo}`));
  document.body.dataset.tela = alvo;
  if (alvo === "produto") renderProduto(param || ITENS[0].id);
  pintarIcones();
}
window.addEventListener("hashchange", irParaHash);

/* ===== S01 início ===== */
function renderInicio() {
  document.documentElement.style.setProperty("--accent", LOJA.cor);
  document.getElementById("loja-nome").textContent = LOJA.nome;
  document.getElementById("loja-cidade").textContent = LOJA.cidade;
  document.getElementById("loja-situacao").textContent = LOJA.situacao.texto;
  document.getElementById("loja-logo").innerHTML = LOJA.logoUrl ? `<img src="${esc(LOJA.logoUrl)}" alt="${esc(LOJA.nome)}" />` : "SEU LOGO";

  document.getElementById("destaques").innerHTML = ITENS.filter((i) => i.destaque).map((i) => `
    <a class="dest" href="#produto/${esc(i.id)}">
      ${foto(i.fotoUrl)}
      <div class="corpo">
        ${i.selo ? `<span class="selo selo-${esc(i.selo)}">${SELOS[i.selo]}</span>` : ""}
        <h3>${esc(i.nome)}</h3><p>${esc(i.descricao)}</p>
        <div class="preco${i.precoPromo ? " promo" : ""}">${reais(i.precoPromo ?? i.preco)}</div>
      </div>
    </a>`).join("");

  document.getElementById("categorias").innerHTML = CATEGORIAS.map((c) => `
    <h2 class="secao">${esc(c.nome)}</h2>
    ${c.itens.filter((i) => !i.destaque).map(cardItem).join("")}`).join("");

  const total = SACOLA_EXEMPLO.reduce((s, l) => s + l.total, 0);
  document.getElementById("barra-qtd").innerHTML = `<b>${SACOLA_EXEMPLO.reduce((s, l) => s + l.qtd, 0)}</b>`;
  document.getElementById("barra-total").textContent = reais(total);
}

function cardItem(i) {
  const desconto = i.precoPromo ? Math.round((1 - i.precoPromo / i.preco) * 100) : 0;
  const valores = i.esgotado
    ? `<span class="preco">${reais(i.preco)}</span><span class="tag">Esgotado</span>`
    : i.precoPromo
      ? `<span class="preco promo">${reais(i.precoPromo)}</span><span class="riscado">${reais(i.preco)}</span><span class="desconto">-${desconto}%</span>`
      : `<span class="preco">${reais(i.preco)}</span>`;
  return `
    <a class="item${i.esgotado ? " esgotado" : ""}" href="${i.esgotado ? "#inicio" : `#produto/${esc(i.id)}`}">
      <div class="txt"><h3>${esc(i.nome)}</h3><p>${esc(i.descricao)}</p><div class="valores">${valores}</div></div>
      ${foto(i.fotoUrl)}
    </a>`;
}

/* ===== S04 produto ===== */
function renderProduto(id) {
  const i = ITENS.find((x) => x.id === id) || ITENS[0];
  document.getElementById("produto-info").innerHTML = `
    <h1>${esc(i.nome)}</h1><p>${esc(i.descricao)}</p><div class="preco">${reais(i.precoPromo ?? i.preco)}</div>`;

  // seleção de exemplo da imagem validada: ao ponto e 1 bacon
  const escolha = { ponto: { "ao-ponto": 1 }, adicionais: { bacon: 1 } };
  document.getElementById("produto-grupos").innerHTML = i.grupos.map((g) => {
    const marcadas = Object.values(escolha[g.id] || {}).reduce((s, n) => s + n, 0);
    const regra = g.tipo === "unica" ? `Escolha ${g.max} opção` : `Escolha até ${g.max}`;
    const completo = marcadas >= g.min && g.min > 0;
    return `
      <div class="grupo">
        <div class="t"><h2>${esc(g.nome)}</h2><small>${regra}</small></div>
        <span class="chip${completo ? " ok" : ""}">${completo ? '<i data-ic="check"></i>' : ""}${marcadas}/${g.max}</span>
      </div>
      ${g.opcoes.map((o) => {
        const qtd = (escolha[g.id] || {})[o.id] || 0;
        const preco = o.preco ? ` <span class="v">+ ${reais(o.preco)}</span>` : "";
        const controle = o.esgotado
          ? `<span class="falta">EM FALTA</span>`
          : g.tipo === "unica"
            ? `<span class="radio${qtd ? " on" : ""}"></span>`
            : `<span class="passo">${qtd ? `<button aria-label="Menos"><i data-ic="menos"></i></button><b>${qtd}</b>` : ""}<button aria-label="Mais"><i data-ic="mais"></i></button></span>`;
        return `<div class="op"><span class="n">${esc(o.nome)}${preco}</span>${controle}</div>`;
      }).join("")}`;
  }).join("");

  document.getElementById("btn-adicionar").innerHTML = `<span>Adicionar</span><span>${reais(3100)}</span>`;
}

/* ===== S08 sacola ===== */
function renderSacola() {
  document.getElementById("sacola-loja").textContent = LOJA.nome;
  document.getElementById("sacola-itens").innerHTML = SACOLA_EXEMPLO.map((l) => `
    <div class="it">
      <div class="t"><h3><b>${l.qtd}x</b>${esc(l.nome)}</h3><p>${esc(l.resumo)}</p><div class="acoes"><button>Editar</button><button>Remover</button></div></div>
      <div class="lado"><span class="preco${l.promo ? " promo" : ""}">${reais(l.total)}</span>${foto(ITENS.find((i) => i.id === l.itemId)?.fotoUrl)}</div>
    </div>`).join("");
  document.getElementById("sugestoes").innerHTML = SUGESTOES.map((s) => `
    <div class="c">${foto(s.fotoUrl)}<div>${esc(s.nome)}<b>${reais(s.preco)}</b></div></div>`).join("");
  const subtotal = SACOLA_EXEMPLO.reduce((s, l) => s + l.total, 0);
  document.getElementById("sacola-subtotal").textContent = reais(subtotal);
  document.getElementById("sacola-total").textContent = reais(subtotal);
}

renderInicio();
renderSacola();
irParaHash();
