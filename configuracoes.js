/*
  configuracoes.js: Configurações do painel (imagens PD40, P40 e P40b).

  Grava em lojas/{loja}: nome, cidade, bairro, whatsapp, horario, abrirSozinho,
  cor, logoUrl. A loja lê tudo isso (loja-dados.js) e o horário passa pela conta
  de horario.js. O link (o id da loja) não muda. Edita num rascunho e grava tudo
  de uma vez em "Salvar alterações". No modo exemplo nada é gravado.
*/

import { db } from "./firebase-init.js?v=3";
import { doc, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { esc, fmtMoeda, toast } from "./shared.js?v=1";
import { pintarIcones } from "./icones.js?v=3";
import { regraDe } from "./conta-entrega.js?v=1";
import { ORDEM, NOMES, situacao, horaValida } from "./horario.js?v=1";
import { linkCardapio, linkPublico } from "./links-cardapio.js?v=1";
import { pagamentoDisponivel, chamarPagamento, urlMercadoPago } from "./pagamentos.js?v=3";

const $ = (id) => document.getElementById(id);
const CORES = ["#991b1b", "#c2410c", "#15803d", "#1d4ed8", "#6d28d9", "#1f2937"];
const soDigitos = (t) => String(t || "").replace(/\D/g, "");
const fmtFone = (d) => (d.length > 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`
  : d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d);
const fmtHora = (t) => { const d = soDigitos(t).slice(0, 4); return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d; };

const C = { loja: null, exemplo: false, rasc: null, sujo: false, parar: [], salvando: false, pagamento: null, pagamentoOcupado: false, pagamentoErro: "", pagamentoConsulta: null, pagamentoSessao: null };

const horarioPadrao = () => Object.fromEntries(ORDEM.map((d) => [d, { aberto: true, abre: "18:00", fecha: "23:00" }]));
function rascunhoDe(l) {
  return {
    nome: l.nome || "", cidade: l.cidade || "", bairro: l.bairro || "", whatsapp: soDigitos(l.whatsapp),
    horario: JSON.parse(JSON.stringify(l.horario || horarioPadrao())), abrirSozinho: !!l.abrirSozinho,
    aceitaAgendamento: l.aceitaAgendamento === true,
    cor: l.cor || "#991b1b", logoUrl: l.logoUrl || "",
  };
}

/* ===== tela ===== */
function textoPrevia(r) {
  if (C.exemplo) return "Aberto agora • Fecha às 23h00"; // como na imagem, para conferir
  return situacao({ ...r, aberta: C.loja.aberta }).texto;
}
function corTexto(cor) {
  const [rr, g, b] = (cor.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i) || [0, "99", "1b", "1b"]).slice(1).map((x) => parseInt(x, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * rr + 0.7152 * g + 0.0722 * b > 0.22 ? "#1f2937" : "#ffffff"; // a mesma conta da loja (app.js)
}
function htmlPrevia(r) {
  return `<div class="faixa" style="background:${esc(r.cor)}"></div>
    <div class="cabeca">${r.logoUrl ? `<img class="logo-p" src="${esc(r.logoUrl)}" alt="" />` : ""}<b>${esc(r.nome || "Nome do restaurante")}</b><small class="${textoPrevia(r).startsWith("Fechado") ? "fechada" : ""}">${esc(textoPrevia(r))}</small></div>
    <div class="btn-p" style="background:${esc(r.cor)};color:${corTexto(r.cor)}">Ver sacola</div>
    <div class="previa-t">Prévia do topo do cardápio</div>`;
}
function htmlDias(r) {
  return ORDEM.map((d) => {
    const h = r.horario[d] || { aberto: false };
    const nome = `<b><span class="so-pc">${NOMES[d]}</span><span class="so-cel">${NOMES[d].slice(0, 3)}</span></b>`;
    const meio = h.aberto
      ? `<div class="horas"><input class="in-h" data-cf-abre="${d}" value="${esc(h.abre || "")}" inputmode="numeric" maxlength="5" aria-label="${NOMES[d]}: abre" />às<input class="in-h" data-cf-fecha="${d}" value="${esc(h.fecha || "")}" inputmode="numeric" maxlength="5" aria-label="${NOMES[d]}: fecha" /></div>`
      : `<div class="fechado-t">Fechado</div>`;
    return `<div class="dia">${nome}${meio}<button type="button" class="chave-p${h.aberto ? "" : " off"}" data-cf-dia="${d}" aria-pressed="${!!h.aberto}" aria-label="${NOMES[d]} aberto"><span class="trilho"></span></button></div>`;
  }).join("");
}
function htmlPagamento() {
  const disponivel = pagamentoDisponivel(), conectado = !!C.pagamento?.conectado, ativo = !!C.pagamento?.ativo;
  const conhecido = !!C.pagamento && !C.pagamentoErro && !C.pagamentoConsulta;
  const mensagem = C.exemplo ? "Exemplo: nenhuma conta será conectada e nenhum pagamento será ativado."
    : !disponivel ? "Pagamento online indisponível. Entre em contato com o suporte para liberar a conexão."
    : C.pagamentoErro || (!conhecido ? "Conferindo a conexão da sua empresa…"
      : conectado ? (ativo ? "Conta conectada. Pagamento online ativo. Acompanhe os pedidos no painel." : "Conta conectada. Pagamento online pausado. Confira a conta abaixo e ative quando estiver pronto.")
        : "Conta não conectada. Comece pelo passo 1 para conectar ou reconectar a conta da sua empresa.");
  const acao = C.pagamentoErro ? "consultar" : conectado ? ativo ? "pausar" : "ativar" : "conectar";
  return `<section class="cf-cartao cf-pagamento-cartao"><div class="cf-cab"><h2>Pagamento online</h2></div><div class="cf-corpo cf-pagamento">
    <b>Mercado Pago</b><p>Sua empresa recebe diretamente na própria conta. A senha é informada somente no Mercado Pago.</p>
    <ol class="cf-pagamento-passos">
      <li><b>Conectar sua conta</b><p>Clique em Conectar conta Mercado Pago. Entre na conta da empresa e confira se é a conta certa antes de autorizar.</p></li>
      <li><b>Autorizar no Mercado Pago</b><p>Confira e autorize o acesso. Se houver verificação de identidade, conclua no próprio Mercado Pago. Ao terminar, clique em Voltar ao painel. Não precisa informar chaves ou códigos de integração.</p></li>
      <li><b>Ativar recebimentos</b><p>De volta ao painel, confira a conta conectada e clique em Ativar pagamento online. Conectar a conta mantém os recebimentos pausados até essa ativação.</p></li>
    </ol>
    <p class="cf-pagamento-estado" role="status">${esc(mensagem)}</p>
    ${conectado && conhecido ? `<p>Conta conectada: <b>${esc(C.pagamento.conta ?? "Identificação não disponível")}</b></p>` : ""}
    <button type="button" class="btn" data-cf-pagamento="${acao}" ${C.exemplo || !disponivel || C.pagamentoOcupado || C.pagamentoConsulta || (!conhecido && !C.pagamentoErro) ? "disabled" : ""}>${C.pagamentoOcupado ? "Aguarde..." : C.pagamentoErro ? "Tentar novamente" : conectado && ativo ? "Pausar pagamento online" : conectado ? "Ativar pagamento online" : "Conectar conta Mercado Pago"}</button>
    <p>Pausar impede novos pagamentos online. Continue acompanhando os pedidos já pagos ou em processamento. Se precisar trocar uma conta conectada, fale com o suporte antes.</p>
    <p><a href="./pagamento-online.html" target="_blank" rel="noopener">Ver o passo a passo completo</a></p>
  </div></section>`;
}
function atualizarPagamento() {
  const cartao = document.querySelector(".cf-pagamento")?.closest("section");
  if (cartao) cartao.outerHTML = htmlPagamento();
}
async function consultarPagamento() {
  if (!pagamentoDisponivel() || C.exemplo || C.pagamentoConsulta || C.pagamentoOcupado) return;
  const lojaId = C.loja.id, consulta = {};
  C.pagamentoConsulta = consulta; C.pagamentoErro = ""; C.pagamento = null;
  atualizarPagamento();
  try {
    const estado = await chamarPagamento("status", { lojaId }, { autenticado: true });
    if (C.loja?.id !== lojaId || C.pagamentoConsulta !== consulta) return;
    if (typeof estado.conectado !== "boolean" || typeof estado.ativo !== "boolean") throw new Error("Situação da conta não confirmada.");
    C.pagamento = estado;
  } catch {
    if (C.loja?.id === lojaId && C.pagamentoConsulta === consulta) C.pagamentoErro = "Não foi possível conferir a conexão. Tente novamente. Se continuar, fale com o suporte.";
  } finally {
    if (C.loja?.id === lojaId && C.pagamentoConsulta === consulta) { C.pagamentoConsulta = null; atualizarPagamento(); }
  }
}
async function mudarPagamento(acao) {
  if (acao === "consultar") { await consultarPagamento(); return; }
  if (C.pagamentoOcupado || C.pagamentoConsulta || !pagamentoDisponivel()) return;
  if (C.exemplo) { toast("Exemplo: nenhuma conta foi conectada.", "info", 3500); return; }
  if (!C.pagamento || C.pagamentoErro || !["conectar", "ativar", "pausar"].includes(acao)) return;
  if ((acao === "conectar" && C.pagamento.conectado) || (acao !== "conectar" && !C.pagamento.conectado)) return;
  if (C.sujo && acao === "conectar") { toast("Salve as alterações antes de conectar a conta.", "info", 4000); return; }
  const lojaId = C.loja.id, sessao = C.pagamentoSessao;
  C.pagamentoOcupado = true;
  atualizarPagamento();
  try {
    const dados = await chamarPagamento(acao, { lojaId }, { autenticado: true });
    if (C.loja?.id !== lojaId || C.pagamentoSessao !== sessao) return;
    if (acao === "conectar") location.assign(urlMercadoPago(dados.url));
    else {
      if (typeof dados.ativo !== "boolean") throw new Error("Situação do pagamento não confirmada.");
      C.pagamento = { ...C.pagamento, ativo: dados.ativo }; toast(dados.ativo ? "Pagamento online ativado." : "Pagamento online pausado. Os pedidos já pagos continuam disponíveis.", "sucesso", 4500);
    }
  } catch {
    if (C.loja?.id === lojaId && C.pagamentoSessao === sessao) { C.pagamento = null; C.pagamentoErro = "Não foi possível confirmar a ação. Tente novamente para conferir a situação da conta."; }
  } finally {
    if (C.loja?.id === lojaId && C.pagamentoSessao === sessao) { C.pagamentoOcupado = false; atualizarPagamento(); }
  }
}
function render() {
  if (!C.loja) return;
  const r = C.rasc, base = ORDEM.find((d) => r.horario[d]?.aberto);
  $("cf-ver").href = C.exemplo ? "./?exemplo=1" : linkCardapio(C.loja.id);
  $("cf-grade").innerHTML = `
    ${htmlPagamento()}
    <div class="cf-col">
      <section class="cf-cartao"><div class="cf-cab"><h2>Dados do restaurante</h2></div><div class="cf-corpo">
        <div class="campo"><label for="cf-nome">Nome do restaurante <i class="obrig">*</i></label><input id="cf-nome" maxlength="120" value="${esc(r.nome)}" /></div>
        <div class="campo"><label>Link do cardápio</label><div class="in fixo"><i data-ic="link"></i><span class="t">${esc(linkPublico(C.loja.id).replace("https://", ""))}</span><button type="button" class="copiar" data-cf-copiar>Copiar</button></div>
          <p class="ajuda">Compartilhe este link com seus clientes. Os links anteriores continuam funcionando.</p></div>
        <div class="dupla">
          <div class="campo"><label for="cf-cidade">Cidade <i class="obrig">*</i></label><input id="cf-cidade" maxlength="60" value="${esc(r.cidade)}" /></div>
          <div class="campo"><label for="cf-bairro">Bairro do restaurante <i class="obrig">*</i></label><input id="cf-bairro" maxlength="60" value="${esc(r.bairro)}" /></div>
        </div>
        <p class="ajuda">O bairro do restaurante paga a taxa fixa de ${fmtMoeda(regraDe(C.loja).taxaBairro / 100)}. O ponto de saída fica em Entregas e bairros.</p>
      </div></section>
      <section class="cf-cartao"><div class="cf-cab"><h2>WhatsApp</h2></div><div class="cf-corpo">
        <div class="campo"><label for="cf-whats">WhatsApp da loja</label><div class="in"><i data-ic="fone"></i><input id="cf-whats" type="tel" inputmode="numeric" placeholder="(00) 00000-0000" value="${esc(fmtFone(r.whatsapp))}" /></div>
          <p class="ajuda">Aparece para o cliente no botão "Falar com o restaurante", depois do pedido.</p></div>
      </div></section>
    </div>
    <section class="cf-cartao"><div class="cf-cab"><h2>Horário de funcionamento</h2></div><div class="cf-corpo">
      ${htmlDias(r)}
      ${base ? `<button type="button" class="copiar-t" data-cf-repetir="${base}">Usar o horário de ${NOMES[base].toLowerCase()} em todos os dias abertos</button>` : ""}
      <div class="auto"><div>Abrir e fechar sozinho pelo horário<small>Ligado, a loja abre e fecha no horário acima. Desligado, você usa a chave em Pedidos.</small></div>
        <button type="button" class="chave-p${r.abrirSozinho ? "" : " off"}" data-cf-sozinho aria-pressed="${r.abrirSozinho}" aria-label="Abrir e fechar sozinho"><span class="trilho"></span></button></div>
      <div class="auto"><div>Aceitar pedidos agendados<small>O cliente escolhe dia e hora dentro do horário acima, até 3 dias à frente.</small></div>
        <button type="button" class="chave-p${r.aceitaAgendamento ? "" : " off"}" data-cf-agendamento aria-pressed="${r.aceitaAgendamento}" aria-label="Aceitar pedidos agendados"><span class="trilho"></span></button></div>
    </div></section>
    <section class="cf-cartao"><div class="cf-cab"><h2>Aparência</h2></div><div class="cf-corpo">
      <div class="logo-l"><button type="button" class="logo-c${r.logoUrl ? " com" : ""}" data-cf-logo aria-label="Enviar logo">${r.logoUrl ? `<img src="${esc(r.logoUrl)}" alt="" />` : `<i data-ic="foto"></i>`}</button>
        <div><button type="button" class="logo-b" data-cf-logo>${r.logoUrl ? "Trocar logo" : "Enviar logo"}</button>${r.logoUrl ? ` <button type="button" class="logo-tirar" data-cf-tirar-logo>Tirar</button>` : ""}<span>Quadrado, de preferência. Sem logo, o espaço dele some do cardápio.</span></div></div>
      <span class="rot">Cor da loja</span>
      <div class="cores">${CORES.map((c) => `<button type="button" class="cor${c === r.cor.toLowerCase() ? " on" : ""}" style="background:${c}" data-cf-cor="${c}" aria-label="Cor ${c}">${c === r.cor.toLowerCase() ? `<i data-ic="check"></i>` : ""}</button>`).join("")}
        <label class="outra${CORES.includes(r.cor.toLowerCase()) ? "" : " on"}"><i class="amostra"${CORES.includes(r.cor.toLowerCase()) ? "" : ` style="background:${esc(r.cor)}"`}></i>Outra cor<input type="color" id="cf-cor-outra" value="${esc(r.cor)}" /></label></div>
      <div class="previa" id="cf-previa">${htmlPrevia(r)}</div>
    </div></section>`;
  pintarIcones($("vista-configuracoes"));
}
const atualizarPrevia = () => { const p = $("cf-previa"); if (p) p.innerHTML = htmlPrevia(C.rasc); };

// o que está digitado vai para o rascunho (antes de redesenhar ou salvar)
function lerCampos() {
  const r = C.rasc;
  if (!$("cf-nome")) return;
  r.nome = $("cf-nome").value.trim().replace(/\s+/g, " ");
  r.cidade = $("cf-cidade").value.trim().replace(/\s+/g, " ");
  r.bairro = $("cf-bairro").value.trim().replace(/\s+/g, " ");
  r.whatsapp = soDigitos($("cf-whats").value);
  document.querySelectorAll("[data-cf-abre]").forEach((el) => (r.horario[el.dataset.cfAbre].abre = el.value.trim()));
  document.querySelectorAll("[data-cf-fecha]").forEach((el) => (r.horario[el.dataset.cfFecha].fecha = el.value.trim()));
}

/* ===== salvar ===== */
async function salvar() {
  if (C.salvando) return;
  lerCampos();
  const r = C.rasc;
  if (r.nome.length < 2) return toast("Informe o nome do restaurante.", "erro", 3500);
  if (r.cidade.length < 2) return toast("Informe a cidade.", "erro", 3500);
  if (r.bairro.length < 2) return toast("Informe o bairro do restaurante.", "erro", 3500);
  if (r.whatsapp && ![10, 11].includes(r.whatsapp.length)) return toast("WhatsApp: digite com DDD, como (91) 90000-0000.", "erro", 4000);
  const errado = ORDEM.find((d) => r.horario[d]?.aberto && (!horaValida(r.horario[d].abre) || !horaValida(r.horario[d].fecha)));
  if (errado) return toast(`${NOMES[errado]}: use o horário no formato 18:00.`, "erro", 4000);
  if (r.abrirSozinho && !ORDEM.some((d) => r.horario[d]?.aberto)) return toast("Para abrir sozinho, deixe pelo menos um dia aberto.", "erro", 4000);
  if (r.aceitaAgendamento && !ORDEM.some((d) => r.horario[d]?.aberto)) return toast("Para agendar, deixe pelo menos um dia aberto.", "erro", 4000);
  const dados = { nome: r.nome, cidade: r.cidade, bairro: r.bairro, whatsapp: r.whatsapp, horario: r.horario, abrirSozinho: r.abrirSozinho, aceitaAgendamento: r.aceitaAgendamento, cor: r.cor, logoUrl: r.logoUrl };
  if (C.exemplo) {
    Object.assign(C.loja, dados); C.sujo = false;
    toast("Exemplo: as mudanças ficam só nesta tela.", "info", 3000);
    return;
  }
  C.salvando = true;
  document.querySelectorAll("[data-cf-salvar]").forEach((b) => b.classList.add("desligado"));
  try {
    await updateDoc(doc(db, "lojas", C.loja.id), dados);
    C.sujo = false;
    toast("Configurações salvas. A loja já mostra as mudanças.", "sucesso", 3000);
  } catch { toast("Não deu para salvar. Confira a internet e tente de novo.", "erro", 4500); }
  finally { C.salvando = false; document.querySelectorAll("[data-cf-salvar]").forEach((b) => b.classList.remove("desligado")); }
}

/* ===== logo: reduzido no navegador e guardado na própria loja (até ~250 KB) ===== */
async function prepararLogo(arquivo) {
  if (!arquivo.type.startsWith("image/")) { toast("Escolha um arquivo de imagem.", "erro", 3500); return null; }
  try {
    const img = await createImageBitmap(arquivo);
    const escala = Math.min(1, 400 / Math.max(img.width, img.height));
    const tela = document.createElement("canvas");
    tela.width = Math.round(img.width * escala); tela.height = Math.round(img.height * escala);
    tela.getContext("2d").drawImage(img, 0, 0, tela.width, tela.height);
    const png = tela.toDataURL("image/png"); // mantém o fundo transparente, se houver
    if (png.length < 340000) return png;
    const branco = document.createElement("canvas");
    branco.width = tela.width; branco.height = tela.height;
    const g = branco.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, branco.width, branco.height); g.drawImage(tela, 0, 0);
    const jpg = branco.toDataURL("image/jpeg", 0.85);
    if (jpg.length < 340000) return jpg;
    toast("Esse logo ficou grande demais. Tente outro arquivo.", "erro", 4000);
  } catch { toast("Não deu para abrir essa imagem.", "erro", 4000); }
  return null;
}

/* ===== cliques e digitação ===== */
function aoClicar(e) {
  if ($("vista-configuracoes").hidden) return;
  const alvo = (s) => e.target.closest(s);
  let el;
  if ((el = alvo("[data-cf-pagamento]"))) { mudarPagamento(el.dataset.cfPagamento); return; }
  if (alvo("[data-cf-salvar]")) { salvar(); return; }
  if (alvo("[data-cf-copiar]")) {
    navigator.clipboard?.writeText(linkPublico(C.loja.id)).then(() => toast("Link copiado.", "sucesso", 2000), () => toast("Não deu para copiar. Selecione o link e copie.", "erro", 3500));
    return;
  }
  if ((el = alvo("[data-cf-dia]"))) { lerCampos(); const h = C.rasc.horario[el.dataset.cfDia]; h.aberto = !h.aberto; if (h.aberto && !h.abre) Object.assign(h, { abre: "18:00", fecha: "23:00" }); C.sujo = true; render(); return; }
  if ((el = alvo("[data-cf-repetir]"))) {
    lerCampos();
    const b = C.rasc.horario[el.dataset.cfRepetir];
    ORDEM.forEach((d) => { if (C.rasc.horario[d]?.aberto) Object.assign(C.rasc.horario[d], { abre: b.abre, fecha: b.fecha }); });
    C.sujo = true; render(); return;
  }
  if (alvo("[data-cf-sozinho]")) { lerCampos(); C.rasc.abrirSozinho = !C.rasc.abrirSozinho; C.sujo = true; render(); return; }
  if (alvo("[data-cf-agendamento]")) { lerCampos(); C.rasc.aceitaAgendamento = !C.rasc.aceitaAgendamento; C.sujo = true; render(); return; }
  if ((el = alvo("[data-cf-cor]"))) { lerCampos(); C.rasc.cor = el.dataset.cfCor; C.sujo = true; render(); return; }
  if (alvo("[data-cf-tirar-logo]")) { lerCampos(); C.rasc.logoUrl = ""; C.sujo = true; render(); return; }
  if (alvo("[data-cf-logo]")) { $("cf-logo").click(); return; }
}
function aoMudar(e) {
  if (e.target.id === "cf-cor-outra") { lerCampos(); C.rasc.cor = e.target.value; render(); }
}
function aoDigitar(e) {
  if ($("vista-configuracoes").hidden || !e.target.closest("#cf-grade")) return;
  if (e.target.id === "cf-whats") e.target.value = fmtFone(soDigitos(e.target.value).slice(0, 11));
  if (e.target.matches(".in-h")) e.target.value = fmtHora(e.target.value);
  // arrastando no seletor de cor: só a prévia muda; redesenhar fecharia o seletor no meio
  if (e.target.id === "cf-cor-outra") { C.rasc.cor = e.target.value; C.sujo = true; atualizarPrevia(); return; }
  C.sujo = true;
  lerCampos();
  atualizarPrevia();
}

/* ===== ligar e desligar ===== */
export function mostrarConfiguracoes() { if (C.loja && !$("cf-nome")) render(); }
export function iniciarConfiguracoes(loja, { exemplo = null } = {}) {
  pararConfiguracoes();
  C.loja = { ...loja, ...(exemplo || {}) };
  C.exemplo = !!exemplo;
  C.rasc = rascunhoDe(C.loja);
  C.sujo = false;
  C.pagamento = null;
  C.pagamentoOcupado = false;
  C.pagamentoErro = "";
  C.pagamentoConsulta = null;
  C.pagamentoSessao = {};
  document.addEventListener("click", aoClicar);
  document.addEventListener("input", aoDigitar);
  document.addEventListener("change", aoMudar);
  $("cf-logo").onchange = async (ev) => {
    const arq = ev.target.files?.[0];
    ev.target.value = "";
    if (!arq) return;
    lerCampos();
    const url = await prepararLogo(arq);
    if (url) { C.rasc.logoUrl = url; C.sujo = true; render(); }
  };
  render();
  consultarPagamento();
  if (C.exemplo) return;
  // o banco só redesenha a tela quando não há mudança por salvar
  C.parar.push(onSnapshot(doc(db, "lojas", loja.id), (s) => {
    if (!s.exists()) return;
    C.loja = { id: s.id, ...s.data() };
    if (!C.sujo) { C.rasc = rascunhoDe(C.loja); render(); }
  }));
}
export function pararConfiguracoes() {
  C.pagamentoConsulta = null;
  C.pagamentoSessao = null;
  C.parar.forEach((f) => f());
  C.parar = [];
  document.removeEventListener("click", aoClicar);
  document.removeEventListener("input", aoDigitar);
  document.removeEventListener("change", aoMudar);
}
