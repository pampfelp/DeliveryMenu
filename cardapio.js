/*
  cardapio.js: editor de cardápio do painel (imagens PD20 a PD23, P20 a P23).

  Grava no formato que a loja lê (loja-dados.js):
    lojas/{loja}/categorias/{id}  nome, ordem
    lojas/{loja}/itens/{id}       categoriaId, nome, descricao, preco, precoPromo, selo,
                                  destaque, esgotado, fotoUrl, videoUrl, videoArquivo, grupos[], ordem
  Dinheiro em centavos. A foto é reduzida no navegador e vai no próprio item
  (o PLANO proíbe Firebase Storage). No modo exemplo (?exemplo=painel) tudo
  muda só na tela e nada é gravado.
  Vídeos escolhidos no aparelho vão ao Drive pelo serviço autenticado;
  o item guarda só a referência, nunca o vídeo em base64 no Firestore.

  Endereços: #cardapio, #cardapio/item/<id|novo>, #cardapio/item/<id>/grupo/<n|novo>,
  #cardapio/categorias (celular), #cardapio/categoria/<id|nova>.
*/

import { db } from "./firebase-init.js?v=3";
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { esc, fmtMoeda, toast, confirmar, gerarId } from "./shared.js?v=1";
import { pintarIcones } from "./icones.js?v=3";
import { linkCardapio } from "./links-cardapio.js?v=1";
import { videoDoItem, carregarVideo } from "./midias-video.js?v=2";
import { validarVideo, enviarVideo } from "./midias-upload.js?v=2";

const $ = (id) => document.getElementById(id);
const reais = (c) => fmtMoeda((c || 0) / 100);
const semAcento = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const pc = window.matchMedia("(min-width: 1024px)");
const SELOS = { "": "Nenhum", recomendado: "Recomendado", oferta: "Oferta", novo: "Novo" };
const REGRAS = { soma: "A soma", maior: "O maior preço", media: "A média", menor: "O menor" };
const REGRA_TEXTO = { soma: "soma os preços", maior: "cobra o maior preço", media: "cobra a média", menor: "cobra o menor" };

const C = { loja: null, exemplo: false, carregou: false, cats: [], itens: [], cat: null, busca: "", rascunho: null, grupo: null, janela: null, parar: [], avisou: false };
const leitoresCatalogo = new Set();
export function observarCatalogo(fn) {
  leitoresCatalogo.add(fn);
  if (C.carregou) fn({lojaId:C.loja?.id,cats:C.cats,itens:C.itens});
  return () => leitoresCatalogo.delete(fn);
}
let videoPendente = null, videoPrevia = "", salvandoItem = false;
const previasExemplo = new Set();
function limparVideoPendente() {
  if (videoPrevia && !previasExemplo.has(videoPrevia)) URL.revokeObjectURL(videoPrevia);
  videoPendente = null; videoPrevia = "";
}

/* ===== dinheiro digitado: "27", "27,5", "1.027,50" viram centavos; vazio vira null ===== */
function lerCentavos(t) {
  const v = String(t || "").trim();
  if (!v) return null;
  const n = Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}
const mostrarCentavos = (c) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));

/* ===== gravar: no Firestore, ou só na tela no modo exemplo ===== */
const ref = (colecao, id) => doc(db, "lojas", C.loja.id, colecao, id);
async function gravar(passos) {
  // passos: [{ op: "set" | "update" | "delete", colecao, id, dados }]
  if (C.exemplo) {
    passos.forEach(({ op, colecao, id, dados }) => {
      const lista = colecao === "itens" ? C.itens : C.cats;
      const i = lista.findIndex((x) => x.id === id);
      if (op === "delete") { if (i >= 0) lista.splice(i, 1); }
      else if (op === "set") { if (i >= 0) lista[i] = { id, ...dados }; else lista.push({ id, ...dados }); }
      else if (i >= 0) Object.assign(lista[i], dados);
    });
    if (!C.avisou) { toast("Exemplo: as mudanças ficam só nesta tela.", "info", 3000); C.avisou = true; }
    render();
    return true;
  }
  try {
    const lote = writeBatch(db);
    passos.forEach(({ op, colecao, id, dados }) => {
      if (op === "set") lote.set(ref(colecao, id), dados);
      else if (op === "update") lote.update(ref(colecao, id), dados);
      else lote.delete(ref(colecao, id));
    });
    await lote.commit();
    return true;
  } catch {
    toast("Não deu para salvar. Confira a internet e tente de novo.", "erro", 4500);
    return false;
  }
}

/* ===== leitura ===== */
const porOrdem = (a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || String(a.nome).localeCompare(String(b.nome));
const catsOrdenadas = () => [...C.cats].sort(porOrdem);
const itensDa = (catId) => C.itens.filter((i) => i.categoriaId === catId).sort(porOrdem);
const item = (id) => C.itens.find((i) => i.id === id);

// item que cobra pelas opções (pizza por tamanho): o menor preço possível, a mesma conta da loja (app.js, precoVitrine)
function aPartirDe(i) {
  const minimo = (i.grupos || []).filter((g) => g.min > 0).reduce((s, g) => {
    const precos = g.opcoes.filter((o) => !o.esgotado).map((o) => o.preco || 0);
    if (!precos.length) return s;
    const barata = Math.min(...precos);
    return s + (g.regraPreco === "soma" || !g.regraPreco ? barata * g.min : barata);
  }, 0);
  return minimo ? `A partir de ${reais(minimo)}` : "Pelas opções";
}

/* ===== PD20 / P20 lista ===== */
function renderIndicadores() {
  const esg = C.itens.filter((i) => i.esgotado), promo = C.itens.filter((i) => i.precoPromo), semFoto = C.itens.filter((i) => !i.fotoUrl);
  const nomes = (l) => (l.length <= 2 ? l.map((i) => i.nome).join(" e ") : `${l[0].nome}, ${l[1].nome} e mais ${l.length - 2}`);
  const n = C.cats.length;
  $("c-kpis").innerHTML = `
    <div class="kpi"><small>Itens no cardápio</small><b>${C.itens.length}</b><em class="neutro so-pc">em ${n} ${n === 1 ? "categoria" : "categorias"}</em></div>
    <div class="kpi"><small>Esgotados agora</small><b>${esg.length}</b><em class="alerta so-pc">${esg.length ? esc(nomes(esg)) : "nenhum"}</em></div>
    <div class="kpi"><small>Em promoção</small><b>${promo.length}</b><em class="so-pc">${promo.length ? esc(nomes(promo)) : "nenhum"}</em></div>
    <div class="kpi so-pc"><small>Sem foto</small><b>${semFoto.length}</b><em class="neutro">${semFoto.length ? "com foto o item vende mais" : "todos têm foto"}</em></div>`;
}

function linhaPc(i) {
  const marcas = [
    i.selo ? `<span class="marca-i ${i.selo === "oferta" ? "oferta" : "selo"}">${SELOS[i.selo]}</span>` : "",
    i.destaque ? `<span class="marca-i dest"><i data-ic="estrela"></i>Destaque</span>` : "",
    i.grupos?.length ? `<span class="marca-i">${i.grupos.length} ${i.grupos.length === 1 ? "grupo" : "grupos"} de adicionais</span>` : "",
  ].join("");
  return `
    <div class="linha${i.esgotado ? " esgot" : ""}" data-id="${esc(i.id)}">
      <span class="alca" data-alca aria-label="Arrastar"><i data-ic="arrastar"></i></span>
      ${i.fotoUrl ? `<img class="foto" src="${esc(i.fotoUrl)}" alt="" />` : `<div class="foto"><i data-ic="foto"></i></div>`}
      <div class="t"><div class="nome">${esc(i.nome)}</div>${i.descricao ? `<div class="desc">${esc(i.descricao)}</div>` : ""}${marcas ? `<div class="marcas">${marcas}</div>` : ""}</div>
      <div class="preco-c">${i.precoPromo ? `<b class="promo">${reais(i.precoPromo)}</b><s>${reais(i.preco)}</s>` : `<b>${i.preco ? reais(i.preco) : aPartirDe(i)}</b>`}</div>
      <button type="button" class="disp${i.esgotado ? " off" : ""}" data-disp="${esc(i.id)}" aria-pressed="${!i.esgotado}">${i.esgotado ? "Esgotado" : "Disponível"}<span class="trilho"></span></button>
      <a class="editar" href="#cardapio/item/${esc(i.id)}" aria-label="Editar ${esc(i.nome)}"><i data-ic="editar"></i></a>
    </div>`;
}
function linhaCel(i) {
  const selo = i.selo ? `<span class="selo-m${i.selo === "oferta" ? " oferta" : ""}">${SELOS[i.selo]}</span>` : "";
  const preco = i.precoPromo ? `<span class="promo">${reais(i.precoPromo)}</span><s>${reais(i.preco)}</s>` : (i.preco ? reais(i.preco) : aPartirDe(i));
  return `
    <div class="linha${i.esgotado ? " esgot" : ""}" data-id="${esc(i.id)}">
      <a class="abre" href="#cardapio/item/${esc(i.id)}">
        ${i.fotoUrl ? `<img class="foto" src="${esc(i.fotoUrl)}" alt="" />` : `<div class="foto"><i data-ic="foto"></i></div>`}
        <span class="t"><span class="nome">${esc(i.nome)}</span><span class="v">${preco}${selo}</span></span>
      </a>
      ${i.esgotado ? `<span class="esg">Esgotado</span>` : ""}
      <button type="button" class="disp-cel${i.esgotado ? " off" : ""}" data-disp="${esc(i.id)}" aria-pressed="${!i.esgotado}" aria-label="${i.esgotado ? "Esgotado" : "Disponível"}"><span class="trilho"></span></button>
    </div>`;
}

function render() {
  if (C.carregou) leitoresCatalogo.forEach((fn) => fn({lojaId:C.loja?.id,cats:C.cats,itens:C.itens}));
  if (!C.loja) return;
  const cats = catsOrdenadas();
  if (!cats.some((c) => c.id === C.cat)) C.cat = cats[0]?.id || null;
  renderIndicadores();
  const cont = (c) => itensDa(c.id).length;

  $("c-cats").innerHTML = `
    <h2>Categorias</h2>
    <div class="cats-lista">${cats.map((c) => `
      <div class="cat${c.id === C.cat ? " on" : ""}" data-id="${esc(c.id)}">
        <span class="alca" data-alca aria-label="Arrastar"><i data-ic="arrastar"></i></span>
        <button type="button" class="cat-nome" data-cat="${esc(c.id)}">${esc(c.nome)}</button><span class="cont">${cont(c)}</span>
      </div>`).join("")}</div>
    <a class="nova-cat" href="#cardapio/categoria/nova"><i data-ic="mais"></i>Nova categoria</a>`;

  $("c-abas").innerHTML = cats.map((c) => `<button type="button" class="${c.id === C.cat ? "on" : ""}" data-cat="${esc(c.id)}">${esc(c.nome)}<span class="cont">${cont(c)}</span></button>`).join("");

  const termo = semAcento(C.busca.trim());
  const cat = cats.find((c) => c.id === C.cat);
  let titulo, lista, vazio;
  if (termo) {
    lista = C.itens.filter((i) => semAcento(`${i.nome} ${i.descricao || ""}`).includes(termo)).sort(porOrdem);
    titulo = `<h2>Resultados</h2><small>${lista.length} ${lista.length === 1 ? "item" : "itens"}</small>`;
    vazio = "Nenhum item com esse nome.";
  } else if (cat) {
    lista = itensDa(cat.id);
    titulo = `<h2>${esc(cat.nome)}</h2><small><span class="so-pc">${lista.length} ${lista.length === 1 ? "item" : "itens"} · arraste para mudar a ordem</span><span class="so-cel">toque no item para editar</span></small>
      <a class="so-pc" href="#cardapio/categoria/${esc(cat.id)}">Renomear</a><a class="so-cel" href="#cardapio/categorias">Categorias</a>`;
    vazio = "Nenhum item nesta categoria ainda. Use Novo item.";
  } else {
    lista = [];
    titulo = `<h2>Comece pelas categorias</h2>`;
    vazio = `Crie a primeira categoria, como "Lanches" ou "Bebidas", e depois os itens.`;
  }
  $("c-lista").innerHTML = `
    <div class="lista-cab">${titulo}</div>
    ${lista.length
      ? `<div class="linhas so-pc" data-ordenar="itens">${lista.map(linhaPc).join("")}</div><div class="linhas so-cel">${lista.map(linhaCel).join("")}</div>`
      : `<p class="vazio-c">${vazio}${!cat && !termo ? ` <a href="#cardapio/categoria/nova">Criar categoria</a>` : ""}</p>`}`;
  pintarIcones($("vista-cardapio"));
  // a janela do item e a do grupo vivem do rascunho; redesenhar com o banco apagaria o que está sendo digitado
  if (C.janela?.tipo === "categorias") renderJanela();
}

/* ===== arrastar para ordenar (mouse e dedo) ===== */
function ordenavel(raiz, aoSoltar) {
  raiz.addEventListener("pointerdown", (e) => {
    const alca = e.target.closest("[data-alca]");
    const linha = alca?.parentElement;
    if (!alca || !linha?.dataset.id) return;
    e.preventDefault();
    const pai = linha.parentElement;
    linha.classList.add("arrastando");
    try { alca.setPointerCapture(e.pointerId); } catch { /* ponteiro que já saiu: segue sem capturar */ }
    const mover = (ev) => {
      const irmaos = [...pai.children].filter((x) => x !== linha && x.dataset.id);
      const antes = irmaos.find((x) => { const r = x.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
      if (antes) { if (linha.nextElementSibling !== antes) pai.insertBefore(linha, antes); }
      else if (irmaos.length && irmaos[irmaos.length - 1].nextElementSibling !== linha) irmaos[irmaos.length - 1].after(linha);
    };
    const soltar = () => {
      alca.removeEventListener("pointermove", mover);
      alca.removeEventListener("pointerup", soltar);
      alca.removeEventListener("pointercancel", soltar);
      linha.classList.remove("arrastando");
      aoSoltar(pai, [...pai.children].map((x) => x.dataset.id).filter(Boolean));
    };
    alca.addEventListener("pointermove", mover);
    alca.addEventListener("pointerup", soltar);
    alca.addEventListener("pointercancel", soltar);
  });
}
// grava a nova ordem só do que mudou de lugar
function salvarOrdem(colecao, ids) {
  const lista = colecao === "itens" ? C.itens : C.cats;
  const passos = ids.map((id, n) => ({ id, n })).filter(({ id, n }) => lista.find((x) => x.id === id)?.ordem !== n)
    .map(({ id, n }) => ({ op: "update", colecao, id, dados: { ordem: n } }));
  if (passos.length) gravar(passos);
}

/* ===== janela: item, grupo de opções, categoria ===== */
function abrirJanela() { $("c-modal").hidden = false; document.body.classList.add("com-janela"); }
function fecharJanela() {
  if (salvandoItem) return;
  limparVideoPendente();
  C.rascunho = null; C.grupo = null; C.janela = null;
  $("c-modal").hidden = true;
  document.body.classList.remove("com-janela");
}
const voltarLista = () => { location.hash = "#cardapio"; };

function itemNovo() {
  return { id: null, categoriaId: C.cat || catsOrdenadas()[0]?.id || "", nome: "", descricao: "", preco: null, precoPromo: null,
    selo: "", destaque: false, esgotado: false, fotoUrl: "", videoUrl: "", videoArquivo: null, grupos: [] };
}
const grupoNovo = () => ({ id: gerarId().slice(0, 8), nome: "", tipo: "somavel", min: 0, max: 1, regraPreco: "soma", opcoes: [{ id: gerarId().slice(0, 8), nome: "", preco: 0 }] });
const copia = (o) => JSON.parse(JSON.stringify(o));

function cabecalho(titulo, sub, voltar) {
  return `<a class="voltar ${voltar ? "" : "so-cel"}" href="${voltar || "#cardapio"}" aria-label="Voltar"><i data-ic="esquerda"></i></a>
    <h2 id="c-titulo">${titulo}</h2>${sub ? `<small class="so-pc">${sub}</small>` : ""}
    <a class="fechar so-pc" href="#cardapio" aria-label="Fechar"><i data-ic="x"></i></a>`;
}

function renderJanela() {
  const j = C.janela;
  if (!j) return;
  const cab = $("c-cab"), corpo = $("c-corpo-m"), pe = $("c-pe"), janela = document.querySelector(".c-janela");
  janela.dataset.tipo = j.tipo;
  if (j.tipo === "item") renderItem(cab, corpo, pe);
  else if (j.tipo === "grupo") renderGrupo(cab, corpo, pe);
  else if (j.tipo === "categoria") renderCategoria(cab, corpo, pe);
  else if (j.tipo === "categorias") renderCategorias(cab, corpo, pe);
  pintarIcones(janela);
}

/* PD21 / P21 item */
function renderItem(cab, corpo, pe) {
  const r = C.rascunho;
  const catNome = C.cats.find((c) => c.id === r.categoriaId)?.nome;
  cab.innerHTML = cabecalho(r.id ? "Editar item" : "Novo item", catNome ? `em ${esc(catNome)}` : "");
  const desc = r.descricao || "";
  corpo.innerHTML = `
    <div class="sec topo-item">
      <button type="button" class="foto-env${r.fotoUrl ? " com-foto" : ""}" data-foto aria-label="${r.fotoUrl ? "Trocar imagem" : "Adicionar imagem"}">
        ${r.fotoUrl ? `<img src="${esc(r.fotoUrl)}" alt="" /><span class="trocar">Trocar imagem</span>` : `<i data-ic="foto"></i><b>Adicionar imagem</b><span class="so-pc">JPG ou PNG. Quadrada fica melhor no cardápio.</span><span class="so-cel">Quadrada fica melhor no cardápio</span>`}
      </button>
      ${r.fotoUrl ? `<button type="button" class="tirar-foto" data-tirar-foto>Remover imagem</button>` : ""}
      <div class="campos">
        <div class="campo"><label for="i-nome">Nome <i class="obrig">*</i></label><input id="i-nome" maxlength="80" value="${esc(r.nome)}" /></div>
        <div class="campo"><label for="i-cat">Categoria</label><select id="i-cat">${catsOrdenadas().map((c) => `<option value="${esc(c.id)}"${c.id === r.categoriaId ? " selected" : ""}>${esc(c.nome)}</option>`).join("")}</select></div>
        <div class="campo larga"><label for="i-desc">Descrição</label><textarea id="i-desc" maxlength="200" rows="2">${esc(desc)}</textarea><p class="ajuda" id="i-desc-n">${desc.length} de 200 letras</p></div>
        <div class="campo"><label for="i-preco">Preço <i class="obrig">*</i></label><div class="in"><small>R$</small><input id="i-preco" inputmode="decimal" placeholder="0,00" value="${mostrarCentavos(r.preco)}" /></div></div>
        <div class="campo"><label for="i-promo"><span class="so-pc">Preço promocional</span><span class="so-cel">Promocional</span></label><div class="in"><small>R$</small><input id="i-promo" inputmode="decimal" placeholder="${pc.matches ? "Sem promoção" : "Nenhum"}" value="${mostrarCentavos(r.precoPromo)}" /></div></div>
      </div>
    </div>
    <div class="sec midias-item">
      <h3>Vídeo do produto</h3>
      <p class="ajuda">A imagem aparece enquanto o vídeo carrega. Você pode usar os dois ou só a imagem.</p>
      <div class="midias-acoes"><button type="button" class="btn fantasma" data-video>${videoPendente || videoDoItem(C.loja.id, r).url ? "Trocar vídeo" : "Adicionar vídeo"}</button>
        ${videoPendente || videoDoItem(C.loja.id, r).url ? `<button type="button" class="tirar-foto" data-tirar-video>Remover vídeo</button>` : ""}</div>
      <p class="ajuda">Vídeo MP4 ou WebM, até 10 MB. A prévia abaixo permite conferir antes de salvar.</p>
      <div id="i-video-previa"></div>
    </div>
    <div class="sec como">
      <div class="sec-t so-cel">Como aparece</div>
      <span class="rot so-pc">Selo</span>
      <div class="chips">${Object.entries(SELOS).map(([v, n]) => `<button type="button" class="chip-s${(r.selo || "") === v ? " on" : ""}" data-selo="${v}">${v ? n : `<span class="so-pc">Nenhum</span><span class="so-cel">Sem selo</span>`}</button>`).join("")}</div>
      <label class="marcar"><input type="checkbox" id="i-dest"${r.destaque ? " checked" : ""} /><span class="caixa-m"><i data-ic="check"></i></span><span>Mostrar em Destaques</span></label>
      <button type="button" class="disp-m${r.esgotado ? " off" : ""}" data-disp-rasc aria-pressed="${!r.esgotado}"><span>Disponível<small class="so-cel">Desligado, aparece como esgotado</small></span><span class="trilho"></span></button>
    </div>
    <div class="sec adic">
      <div class="adic-cab"><b>Adicionais</b><small class="so-pc">opções que o cliente escolhe ao pedir este item</small></div>
      <div class="grupos" data-ordenar="grupos">${r.grupos.map((g, n) => {
        const ops = g.opcoes.map((o) => o.esgotado ? `<em>${esc(o.nome)} em falta</em>` : `${esc(o.nome)}${o.preco ? ` + ${reais(o.preco)}` : ""}`).join(", ");
        const regra = g.tipo === "unica" ? `Escolhe 1` : `${g.min ? `De ${g.min} a ${g.max}` : `Até ${g.max}`}, ${REGRA_TEXTO[g.regraPreco] || REGRA_TEXTO.soma}`;
        return `<a class="grupo-r" href="#cardapio/item/${esc(r.id || "novo")}/grupo/${n}" data-id="${esc(g.id)}">
          <span class="alca so-pc" data-alca><i data-ic="arrastar"></i></span>
          <span class="g-t"><b>${esc(g.nome)}<span class="${g.min ? "obr" : ""}">${g.min ? "Obrigatório" : "Opcional"}</span></b><span class="g-d">${regra} · ${ops}</span></span>
          <span class="g-ir"><span class="so-pc">Editar</span><i data-ic="direita" class="so-cel"></i></span></a>`;
      }).join("")}</div>
      <a class="add" href="#cardapio/item/${esc(r.id || "novo")}/grupo/novo"><i data-ic="mais"></i>Adicionar grupo de opções</a>
    </div>
    ${r.id ? `<button type="button" class="excluir so-cel" data-excluir-item><i data-ic="lixo"></i>Excluir item</button>` : ""}`;
  pe.innerHTML = `
    ${r.id ? `<button type="button" class="excluir so-pc" data-excluir-item><i data-ic="lixo"></i>Excluir item</button>` : ""}
    <a class="btn fantasma so-pc" href="#cardapio">Cancelar</a>
    <button type="button" class="btn" data-salvar-item>Salvar</button>`;
  const midia = videoDoItem(C.loja.id, r), caixa = $("i-video-previa");
  if (videoPrevia || midia.url) {
    caixa.innerHTML = `<video controls playsinline muted preload="metadata" poster="${esc(r.fotoUrl)}" aria-label="Prévia do vídeo"></video>`;
    const elemento = caixa.querySelector("video");
    if (videoPrevia) elemento.src = videoPrevia;
    else carregarVideo(midia.url, midia.remoto).then((url) => { if (elemento.isConnected) elemento.src = url; }).catch(() => {
      if (caixa.isConnected) caixa.textContent = "Não deu para carregar a prévia. Você pode trocar ou remover o vídeo.";
    });
  }
}
// o que está digitado na janela do item vai para o rascunho (antes de abrir um grupo ou salvar)
function lerItem() {
  const r = C.rascunho;
  if (!r || !$("i-nome")) return;
  r.nome = $("i-nome").value.trim().replace(/\s+/g, " ");
  r.categoriaId = $("i-cat").value;
  r.descricao = $("i-desc").value.trim();
  r.preco = lerCentavos($("i-preco").value);
  r.precoPromo = lerCentavos($("i-promo").value);
  r.destaque = $("i-dest").checked;
}
async function salvarItem() {
  if (salvandoItem) return;
  lerItem();
  const r = C.rascunho;
  const lojaId = C.loja.id;
  const opcoesPagas = r.grupos.some((g) => g.min > 0 && g.opcoes.some((o) => o.preco > 0));
  if (r.nome.length < 2) return toast("Informe o nome do item.", "erro", 3500);
  if (!r.categoriaId) return toast("Escolha a categoria.", "erro", 3500);
  if (Number.isNaN(r.preco) || Number.isNaN(r.precoPromo)) return toast("Preço: digite só o valor, por exemplo 27,00.", "erro", 3500);
  if (!r.preco && !opcoesPagas) return toast("Informe o preço. Só fica sem preço o item que cobra pelas opções, como a pizza meio a meio.", "erro", 5000);
  if (r.precoPromo != null && (!r.preco || r.precoPromo >= r.preco)) return toast("O preço promocional precisa ser menor que o preço.", "erro", 4000);
  const novo = !r.id;
  const id = r.id || gerarId().replace(/-/g, "").slice(0, 20);
  const outros = itensDa(r.categoriaId).filter((i) => i.id !== id);
  const mudouCat = !novo && item(id)?.categoriaId !== r.categoriaId;
  const ordem = novo || mudouCat ? (outros.length ? Math.max(...outros.map((i) => i.ordem ?? 0)) + 1 : 0) : (item(id)?.ordem ?? 0);
  const dados = {
    categoriaId: r.categoriaId, nome: r.nome, descricao: r.descricao, preco: r.preco || 0, precoPromo: r.precoPromo ?? null,
    selo: r.selo || null, destaque: !!r.destaque, esgotado: !!r.esgotado, fotoUrl: r.fotoUrl || "", grupos: r.grupos, ordem,
  };
  dados.videoUrl = r.videoUrl ?? videoDoItem(C.loja.id, r).url;
  dados.videoArquivo = r.videoArquivo || null;
  const botao = document.querySelector("[data-salvar-item]");
  salvandoItem = true;
  document.querySelectorAll("#c-modal button, #c-modal input, #c-modal textarea, #c-modal select").forEach((el) => (el.disabled = true));
  botao.classList.add("desligado");
  let ok = false;
  try {
    if (videoPendente) {
      botao.textContent = "Enviando vídeo...";
      if (C.exemplo) { dados.videoUrl = videoPrevia; dados.videoArquivo = null; previasExemplo.add(videoPrevia); }
      else {
        r.videoArquivo = await enviarVideo(videoPendente, lojaId);
        r.videoUrl = "";
        dados.videoArquivo = r.videoArquivo; dados.videoUrl = "";
        limparVideoPendente();
      }
    }
    botao.textContent = "Salvando...";
    if (C.loja.id !== lojaId || C.rascunho !== r) throw new Error("A loja mudou durante o envio. Abra o item novamente.");
    ok = await gravar([{ op: "set", colecao: "itens", id, dados }]);
  } catch (erro) { toast(erro.message || "Não deu para enviar o vídeo. Tente novamente.", "erro", 5000); }
  finally {
    salvandoItem = false;
    document.querySelectorAll("#c-modal button, #c-modal input, #c-modal textarea, #c-modal select").forEach((el) => (el.disabled = false));
    botao.classList.remove("desligado"); botao.textContent = "Salvar";
  }
  if (!ok) return;
  if (!C.exemplo) toast(novo ? "Item criado." : "Item salvo.", "sucesso", 2500);
  C.cat = r.categoriaId;
  fecharJanela();
  voltarLista();
}
async function excluirItem() {
  const r = C.rascunho;
  if (!r?.id || !(await confirmar(`Excluir "${r.nome || "este item"}" do cardápio?`, { textoConfirmar: "Excluir" }))) return;
  if (await gravar([{ op: "delete", colecao: "itens", id: r.id }])) { fecharJanela(); voltarLista(); }
}

/* PD22 / P22 grupo de opções */
function renderGrupo(cab, corpo, pe) {
  const g = C.grupo.dados, r = C.rascunho;
  const voltar = `#cardapio/item/${r.id || "novo"}`;
  cab.innerHTML = cabecalho("Grupo de opções", r.nome ? `em ${esc(r.nome)}` : "", voltar);
  const uma = g.tipo === "unica";
  corpo.innerHTML = `
    <div class="sec grade-g">
      <div class="campo"><label for="g-nome">Nome do grupo <i class="obrig">*</i></label><input id="g-nome" maxlength="60" value="${esc(g.nome)}" placeholder="Ex.: Ponto da carne" />
        <p class="ajuda">É o título que o cliente vê, como "Ponto da carne"<span class="so-pc"> ou "Sabores"</span>.</p></div>
      <div class="campo"><label>Como o cliente escolhe</label><div class="seg"><button type="button" class="${uma ? "on" : ""}" data-tipo-g="unica">Só uma opção</button><button type="button" class="${uma ? "" : "on"}" data-tipo-g="somavel">Várias opções</button></div></div>
      <div class="dupla">
        <div class="campo"><label for="g-min">Mínimo</label><input id="g-min" inputmode="numeric" value="${g.min}" /><p class="ajuda so-pc">0 deixa o grupo opcional</p></div>
        <div class="campo"><label for="g-max">Máximo</label><input id="g-max" inputmode="numeric" value="${uma ? 1 : g.max}"${uma ? " disabled" : ""} /></div>
      </div>
      <p class="ajuda so-cel">Mínimo 0 deixa o grupo opcional.</p>
      <div class="campo${uma ? " apagado" : ""}"><label>Quando escolhe mais de uma, cobrar</label>
        <div class="chips">${Object.entries(REGRAS).map(([v, n]) => `<button type="button" class="chip-s${g.regraPreco === v ? " on" : ""}" data-regra="${v}"${uma ? " disabled" : ""}>${n}</button>`).join("")}</div>
        <p class="ajuda so-pc">Pizza meio a meio costuma cobrar o maior preço.</p></div>
    </div>
    <div class="sec ops">
      <div class="adic-cab"><b>Opções</b><small class="so-pc">arraste para mudar a ordem</small></div>
      <div class="op-cab so-pc"><span></span><span>Nome</span><span>Preço a mais</span><span></span><span></span></div>
      <div class="opcoes" data-ordenar="opcoes">${g.opcoes.map((o) => `
        <div class="op" data-id="${esc(o.id)}">
          <span class="alca so-pc" data-alca><i data-ic="arrastar"></i></span>
          <input class="o-nome" maxlength="60" value="${esc(o.nome)}" placeholder="Nome da opção" aria-label="Nome da opção" />
          <div class="l2">
            <div class="in"><small>+ R$</small><input class="o-preco" inputmode="decimal" placeholder="0,00" value="${o.preco ? mostrarCentavos(o.preco) : ""}" aria-label="Preço a mais" /></div>
            <button type="button" class="disp-m${o.esgotado ? " off" : ""}" data-disp-op="${esc(o.id)}" aria-pressed="${!o.esgotado}">${o.esgotado ? "Em falta" : "Disponível"}<span class="trilho"></span></button>
            <button type="button" class="lixo" data-tirar-op="${esc(o.id)}" aria-label="Tirar opção"><i data-ic="lixo"></i></button>
          </div>
        </div>`).join("")}</div>
      <button type="button" class="add" data-add-op><i data-ic="mais"></i>Adicionar opção</button>
    </div>
    ${C.grupo.n != null ? `<button type="button" class="excluir so-cel" data-excluir-grupo><i data-ic="lixo"></i>Excluir grupo</button>` : ""}`;
  pe.innerHTML = `
    ${C.grupo.n != null ? `<button type="button" class="excluir so-pc" data-excluir-grupo><i data-ic="lixo"></i>Excluir grupo</button>` : ""}
    <a class="btn fantasma so-pc" href="${voltar}">Cancelar</a>
    <button type="button" class="btn" data-pronto-grupo>Pronto</button>`;
}
function lerGrupo() {
  const g = C.grupo?.dados;
  if (!g || !$("g-nome")) return;
  g.nome = $("g-nome").value.trim().replace(/\s+/g, " ");
  g.min = parseInt($("g-min").value, 10);
  g.max = g.tipo === "unica" ? 1 : parseInt($("g-max").value, 10);
  document.querySelectorAll(".opcoes .op").forEach((linha) => {
    const o = g.opcoes.find((x) => x.id === linha.dataset.id);
    if (!o) return;
    o.nome = linha.querySelector(".o-nome").value.trim().replace(/\s+/g, " ");
    o.preco = lerCentavos(linha.querySelector(".o-preco").value) ?? 0;
  });
}
function prontoGrupo() {
  lerGrupo();
  const g = C.grupo.dados;
  g.opcoes = g.opcoes.filter((o) => o.nome || o.preco);
  if (g.nome.length < 2) return toast("Informe o nome do grupo.", "erro", 3500);
  if (!g.opcoes.length) return toast("Coloque pelo menos uma opção.", "erro", 3500);
  if (g.opcoes.some((o) => !o.nome)) return toast("Toda opção precisa de nome.", "erro", 3500);
  if (g.opcoes.some((o) => Number.isNaN(o.preco))) return toast("Preço da opção: digite só o valor, por exemplo 4,00.", "erro", 3500);
  if (!Number.isInteger(g.min) || !Number.isInteger(g.max) || g.min < 0 || g.max < 1 || g.min > g.max) return toast("Mínimo e máximo: o mínimo vai de 0 até o máximo, e o máximo é pelo menos 1.", "erro", 4500);
  if (g.tipo === "unica" && g.min > 1) g.min = 1;
  if (C.grupo.n == null) C.rascunho.grupos.push(g); else C.rascunho.grupos[C.grupo.n] = g;
  location.hash = `#cardapio/item/${C.rascunho.id || "novo"}`;
}

/* PD23 nova categoria e renomear; P23 lista de categorias no celular */
function renderCategoria(cab, corpo, pe) {
  const cat = C.janela.id ? C.cats.find((c) => c.id === C.janela.id) : null;
  const vazia = cat && !itensDa(cat.id).length;
  cab.innerHTML = cabecalho(cat ? "Renomear categoria" : "Nova categoria", "", pc.matches ? "" : "#cardapio/categorias");
  corpo.innerHTML = `<div class="sec"><div class="campo"><label for="k-nome">Nome <i class="obrig">*</i></label><input id="k-nome" maxlength="60" value="${esc(cat?.nome || "")}" placeholder="Ex.: Sobremesas" />
    <p class="ajuda">Aparece como título no cardápio, na ordem da lista de categorias.</p></div></div>`;
  pe.innerHTML = `
    ${vazia ? `<button type="button" class="excluir" data-excluir-cat="${esc(cat.id)}"><i data-ic="lixo"></i>Excluir categoria</button>` : ""}
    <a class="btn fantasma so-pc" href="#cardapio">Cancelar</a>
    <button type="button" class="btn" data-salvar-cat>${cat ? "Salvar" : "Criar categoria"}</button>`;
  setTimeout(() => $("k-nome")?.focus(), 0);
}
function renderCategorias(cab, corpo, pe) {
  cab.innerHTML = cabecalho("Categorias", "", "#cardapio");
  corpo.innerHTML = `
    <div class="sec"><div class="sec-t">Arraste para mudar a ordem</div>
      <div class="cats-cel" data-ordenar="categorias">${catsOrdenadas().map((c) => {
        const n = itensDa(c.id).length;
        return `<div class="cat-l" data-id="${esc(c.id)}"><span class="alca" data-alca><i data-ic="arrastar"></i></span><span class="c-n">${esc(c.nome)}</span><small>${n} ${n === 1 ? "item" : "itens"}</small>
          <a class="acao" href="#cardapio/categoria/${esc(c.id)}" aria-label="Renomear ${esc(c.nome)}"><i data-ic="editar"></i></a>
          <button type="button" class="acao" data-excluir-cat="${esc(c.id)}" aria-label="Excluir ${esc(c.nome)}"><i data-ic="lixo"></i></button></div>`;
      }).join("") || `<p class="vazio-c">Nenhuma categoria ainda.</p>`}</div></div>
    <p class="nota-c">Só dá para excluir categoria vazia. Mude os itens de categoria antes.</p>
    <div class="sec"><div class="campo"><label for="k-nome">Nova categoria</label><input id="k-nome" maxlength="60" placeholder="Ex.: Sobremesas" /></div></div>`;
  pe.innerHTML = `<button type="button" class="btn" data-salvar-cat>Criar categoria</button>`;
}
async function salvarCategoria() {
  const nome = $("k-nome").value.trim().replace(/\s+/g, " ");
  if (nome.length < 2) return toast("Informe o nome da categoria.", "erro", 3500);
  const id = C.janela.tipo === "categoria" ? C.janela.id : null;
  if (C.cats.some((c) => c.id !== id && semAcento(c.nome) === semAcento(nome))) return toast("Já existe uma categoria com esse nome.", "erro", 3500);
  const passo = id
    ? { op: "update", colecao: "categorias", id, dados: { nome } }
    : { op: "set", colecao: "categorias", id: gerarId().replace(/-/g, "").slice(0, 20), dados: { nome, ordem: C.cats.length ? Math.max(...C.cats.map((c) => c.ordem ?? 0)) + 1 : 0 } };
  if (!(await gravar([passo]))) return;
  if (!id) C.cat = passo.id;
  if (C.janela.tipo === "categorias") { $("k-nome").value = ""; toast("Categoria criada.", "sucesso", 2000); return; }
  fecharJanela();
  location.hash = pc.matches ? "#cardapio" : "#cardapio/categorias";
}
async function excluirCategoria(id) {
  const cat = C.cats.find((c) => c.id === id);
  if (!cat) return;
  if (itensDa(id).length) return toast("Só dá para excluir categoria vazia. Mude os itens de categoria antes.", "erro", 4500);
  if (!(await confirmar(`Excluir a categoria "${cat.nome}"?`, { textoConfirmar: "Excluir" }))) return;
  if (await gravar([{ op: "delete", colecao: "categorias", id }]) && C.janela?.tipo === "categoria") { fecharJanela(); location.hash = pc.matches ? "#cardapio" : "#cardapio/categorias"; }
}

/* ===== foto: reduzida no navegador para caber no item (até ~250 KB) ===== */
async function prepararFoto(arquivo) {
  if (!arquivo.type.startsWith("image/")) { toast("Escolha um arquivo de imagem.", "erro", 3500); return null; }
  try {
    const img = await createImageBitmap(arquivo);
    const lado = 600, escala = Math.min(1, lado / Math.max(img.width, img.height));
    const tela = document.createElement("canvas");
    tela.width = Math.round(img.width * escala); tela.height = Math.round(img.height * escala);
    tela.getContext("2d").drawImage(img, 0, 0, tela.width, tela.height);
    for (const q of [0.82, 0.7, 0.55]) {
      const url = tela.toDataURL("image/jpeg", q);
      if (url.length < 340000) return url;
    }
    toast("Essa foto ficou grande demais. Tente outra.", "erro", 4000);
  } catch { toast("Não deu para abrir essa imagem.", "erro", 4000); }
  return null;
}

/* ===== cliques e digitação ===== */
function aoClicar(e) {
  if (salvandoItem && e.target.closest("#c-modal")) { e.preventDefault(); return; }
  if ($("vista-cardapio").hidden && $("c-modal").hidden) return;
  const alvo = (sel) => e.target.closest(sel);
  let el;
  if ((el = alvo("[data-cat]"))) { C.cat = el.dataset.cat; C.busca = ""; document.querySelectorAll("[data-busca-item]").forEach((b) => (b.value = "")); render(); return; }
  if ((el = alvo("[data-disp]"))) {
    const i = item(el.dataset.disp);
    if (i) gravar([{ op: "update", colecao: "itens", id: i.id, dados: { esgotado: !i.esgotado } }]);
    return;
  }
  if (alvo("[data-novo-item]")) {
    if (!C.cats.length) { toast("Crie uma categoria primeiro.", "info", 3500); location.hash = pc.matches ? "#cardapio/categoria/nova" : "#cardapio/categorias"; return; }
    location.hash = "#cardapio/item/novo"; return;
  }
  if (e.target.id === "c-modal") { if (pc.matches) voltarLista(); return; }
  if (!C.janela) return;
  // janela do item
  if (alvo("[data-foto]")) { $("c-foto").click(); return; }
  if (alvo("[data-video]")) { $("c-video").click(); return; }
  if (alvo("[data-tirar-video]")) {
    lerItem(); limparVideoPendente(); C.rascunho.videoUrl = ""; C.rascunho.videoArquivo = null; renderJanela(); return;
  }
  if (alvo("[data-tirar-foto]")) { lerItem(); C.rascunho.fotoUrl = ""; renderJanela(); return; }
  if ((el = alvo("[data-selo]"))) { lerItem(); C.rascunho.selo = el.dataset.selo; renderJanela(); return; }
  if (alvo("[data-disp-rasc]")) { lerItem(); C.rascunho.esgotado = !C.rascunho.esgotado; renderJanela(); return; }
  if (alvo(".grupo-r, .c-janela .add[href]")) { if (!alvo("[data-alca]")) lerItem(); else e.preventDefault(); return; }
  if (alvo("[data-salvar-item]")) { salvarItem(); return; }
  if (alvo("[data-excluir-item]")) { excluirItem(); return; }
  // janela do grupo
  if ((el = alvo("[data-tipo-g]"))) { lerGrupo(); C.grupo.dados.tipo = el.dataset.tipoG; if (el.dataset.tipoG === "unica") C.grupo.dados.max = 1; renderJanela(); return; }
  if ((el = alvo("[data-regra]"))) { lerGrupo(); C.grupo.dados.regraPreco = el.dataset.regra; renderJanela(); return; }
  if ((el = alvo("[data-disp-op]"))) { lerGrupo(); const o = C.grupo.dados.opcoes.find((x) => x.id === el.dataset.dispOp); if (o) o.esgotado = !o.esgotado; renderJanela(); return; }
  if ((el = alvo("[data-tirar-op]"))) { lerGrupo(); C.grupo.dados.opcoes = C.grupo.dados.opcoes.filter((x) => x.id !== el.dataset.tirarOp); renderJanela(); return; }
  if (alvo("[data-add-op]")) { lerGrupo(); C.grupo.dados.opcoes.push({ id: gerarId().slice(0, 8), nome: "", preco: 0 }); renderJanela(); document.querySelector(".opcoes .op:last-child .o-nome")?.focus(); return; }
  if (alvo("[data-pronto-grupo]")) { prontoGrupo(); return; }
  if (alvo("[data-excluir-grupo]")) {
    C.rascunho.grupos.splice(C.grupo.n, 1);
    location.hash = `#cardapio/item/${C.rascunho.id || "novo"}`; return;
  }
  // categorias
  if (alvo("[data-salvar-cat]")) { salvarCategoria(); return; }
  if ((el = alvo("[data-excluir-cat]"))) { excluirCategoria(el.dataset.excluirCat); return; }
}
function aoDigitar(e) {
  if (e.target.matches("[data-busca-item]")) { C.busca = e.target.value; render(); document.querySelectorAll("[data-busca-item]").forEach((b) => b !== e.target && (b.value = C.busca)); e.target.focus(); return; }
  if (e.target.id === "i-desc") $("i-desc-n").textContent = `${e.target.value.length} de 200 letras`;
}
function aoTeclar(e) {
  if (salvandoItem) return;
  if (e.key === "Escape" && C.janela) { e.preventDefault(); location.hash = C.janela.tipo === "grupo" ? `#cardapio/item/${C.rascunho.id || "novo"}` : "#cardapio"; }
  if (e.key === "Enter" && e.target.id === "k-nome") salvarCategoria();
}

/* ===== entrada pelo endereço ===== */
export function mostrarCardapio(partes) {
  // partes: ["cardapio", "item", id, "grupo", n] etc.
  const [, tipo, id, sub, n] = partes;
  if (!C.loja) return;
  if (tipo === "item") {
    const novo = id === "novo";
    if (!C.rascunho || (C.rascunho.id || "novo") !== id) {
      limparVideoPendente();
      const base = novo ? itemNovo() : item(id);
      if (!base) { if (!C.exemplo && !C.carregou) return; voltarLista(); return; } // ainda carregando, ou item apagado
      C.rascunho = { selo: "", grupos: [], ...copia(base), selo: base.selo || "" };
    }
    if (sub === "grupo") {
      lerItem();
      const idx = n === "novo" ? null : Number(n);
      if (idx != null && !C.rascunho.grupos[idx]) { location.hash = `#cardapio/item/${id}`; return; }
      if (!C.grupo || C.grupo.n !== idx) C.grupo = { n: idx, dados: idx == null ? grupoNovo() : copia(C.rascunho.grupos[idx]) };
      C.janela = { tipo: "grupo" };
    } else { C.grupo = null; C.janela = { tipo: "item" }; }
  } else if (tipo === "categoria") {
    C.rascunho = null; C.grupo = null;
    C.janela = { tipo: "categoria", id: id === "nova" ? null : id };
  } else if (tipo === "categorias" && !pc.matches) {
    C.rascunho = null; C.grupo = null;
    C.janela = { tipo: "categorias" };
  } else {
    fecharJanela();
    render();
    return;
  }
  abrirJanela();
  renderJanela();
}
export function fecharCardapio() { if (C.janela) fecharJanela(); }

/* ===== ligar e desligar ===== */
export function iniciarCardapio(loja, { exemplo = null } = {}) {
  pararCardapio();
  C.loja = loja;
  $("ver-cliente").href = exemplo ? "./?exemplo=1" : linkCardapio(loja.id);
  document.addEventListener("click", aoClicar);
  document.addEventListener("input", aoDigitar);
  document.addEventListener("keydown", aoTeclar);
  $("c-foto").onchange = async (e) => {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo || !C.rascunho) return;
    lerItem();
    const rascunho = C.rascunho;
    const url = await prepararFoto(arquivo);
    if (url && C.rascunho === rascunho) { C.rascunho.fotoUrl = url; renderJanela(); }
  };
  $("c-video").onchange = (e) => {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo || !C.rascunho || salvandoItem) return;
    try { validarVideo(arquivo); } catch (erro) { toast(erro.message, "erro", 4000); return; }
    lerItem(); limparVideoPendente();
    videoPendente = arquivo; videoPrevia = URL.createObjectURL(arquivo);
    renderJanela();
  };
  if (exemplo) {
    C.exemplo = true;
    C.cats = exemplo.map((c, n) => ({ id: c.id, nome: c.nome, ordem: n }));
    C.itens = exemplo.flatMap((c) => c.itens.map((i, n) => ({ ...copia(i), categoriaId: c.id, ordem: n, selo: i.selo || null, precoPromo: i.precoPromo ?? null })));
    C.carregou = true;
    render();
    return;
  }
  C.exemplo = false;
  C.carregou = false;
  const prontos = new Set();
  const ouvir = (colecao) => onSnapshot(collection(db, "lojas", loja.id, colecao), (snap) => {
    const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (colecao === "itens") C.itens = lista; else C.cats = lista;
    prontos.add(colecao);
    C.carregou = prontos.size === 2;
    render();
    if (C.carregou && !C.janela && location.hash.startsWith("#cardapio/")) mostrarCardapio(location.hash.slice(1).split("/"));
  }, () => toast("Não deu para ler o cardápio.", "erro", 5000));
  C.parar.push(ouvir("categorias"), ouvir("itens"));
}
export function pararCardapio() {
  if (!salvandoItem) limparVideoPendente();
  previasExemplo.forEach((url) => URL.revokeObjectURL(url));
  previasExemplo.clear();
  C.parar.forEach((f) => f());
  C.parar = [];
  document.removeEventListener("click", aoClicar);
  document.removeEventListener("input", aoDigitar);
  document.removeEventListener("keydown", aoTeclar);
}

// arrastar: listas que existem desde o começo (o conteúdo delas é refeito a cada render)
ordenavel($("c-cats"), (_pai, ids) => salvarOrdem("categorias", ids));
ordenavel($("c-lista"), (_pai, ids) => salvarOrdem("itens", ids));
ordenavel($("c-corpo-m"), (pai, ids) => {
  const tipo = pai.dataset.ordenar;
  if (tipo === "categorias") salvarOrdem("categorias", ids);
  else if (tipo === "grupos") { lerItem(); C.rascunho.grupos.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)); renderJanela(); }
  else if (tipo === "opcoes") { lerGrupo(); C.grupo.dados.opcoes.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)); renderJanela(); }
});
