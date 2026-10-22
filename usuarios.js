/*
  usuarios.js: Usuários do painel (imagens PD60, PD61, P60, P61).

    acessos/{email}   lojaId, nome, email, dono, trocarSenha, criadoEm
  Todo usuário vê e mexe em tudo da loja dele, sem papéis (decisão dele, 2026-10-22).
  A conta nasce numa instância secundária do Firebase, para quem cadastra não perder
  a própria sessão (padroes/dados-e-seguranca.md). Excluir tira o acesso: a conta do
  Auth fica, e o mesmo e-mail pode voltar depois. O dono e a própria pessoa não saem.
  Endereços: #usuarios, #usuarios/novo. No modo exemplo nada é gravado.
*/

import { db, firebaseConfig } from "./firebase-init.js?v=3";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  collection, doc, onSnapshot, setDoc, deleteDoc, query, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { esc, toast, confirmar } from "./shared.js?v=1";
import { pintarIcones } from "./icones.js?v=3";

const $ = (id) => document.getElementById(id);
const U = { loja: null, eu: "", exemplo: false, usuarios: [], janela: false, ocupado: false, parar: [] };

const comoData = (v) => (v instanceof Date ? v : v?.toDate ? v.toDate() : null);
const ddmm = (d) => (d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}` : "-");
const iniciais = (nome) => nome.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
const primeiroNome = (nome) => nome.trim().split(/\s+/)[0];
const emailValido = (t) => /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(t);
// o dono aparece com a data do cadastro do restaurante, não a do dia em que o acesso dele foi gravado
const desde = (u) => comoData(u.dono ? U.loja.criadoEm || u.criadoEm : u.criadoEm);

// senha provisória fácil de ditar no balcão: palavra e quatro números
function gerarSenha() {
  const palavras = ["pizza", "forno", "massa", "molho", "sabor", "fatia"];
  const n = crypto.getRandomValues(new Uint32Array(2));
  return `${palavras[n[0] % palavras.length]}-${String(n[1] % 10000).padStart(4, "0")}`;
}

/* ===== PD60 / P60 ===== */
function render() {
  if (!U.loja) return;
  // dono primeiro, depois na ordem em que entraram
  const ordem = [...U.usuarios].sort((a, b) => (b.dono - a.dono) || ((desde(a)?.getTime() || 0) - (desde(b)?.getTime() || 0)));
  const esperando = ordem.filter((u) => u.trocarSenha).length;
  const ultimo = ordem.filter((u) => !u.dono).at(-1);
  $("us-kpis").innerHTML = `
    <div class="kpi"><small><span class="so-pc">Com acesso ao painel</span><span class="so-cel">Com acesso</span></small><b>${ordem.length}</b><em class="neutro">contando com você</em></div>
    <div class="kpi"><small><span class="so-pc">Falta o primeiro acesso</span><span class="so-cel">Falta o 1º acesso</span></small><b>${esperando}</b><em class="${esperando ? "alerta" : "neutro"}"><span class="so-pc">${esperando ? "ainda com a senha provisória" : "todos já criaram a senha"}</span><span class="so-cel">${esperando ? "senha provisória" : "tudo certo"}</span></em></div>
    <div class="kpi so-pc"><small>Adicionado por último</small><b>${ultimo ? esc(ultimo.nome) : "Ninguém ainda"}</b><em class="neutro">${ultimo ? `em ${ddmm(desde(ultimo))}` : "só você tem acesso"}</em></div>`;
  const podeTirar = (u) => !u.dono && u.email !== U.eu;
  const selos = (u) => `${u.dono ? '<span class="selo">Dono</span>' : ""}${u.email === U.eu ? '<span class="selo voce">Você</span>' : ""}`;
  const lixo = (u) => (podeTirar(u) ? `<button type="button" class="lixo" data-tirar-acesso="${esc(u.email)}" aria-label="Tirar o acesso de ${esc(u.nome)}"><i data-ic="lixo"></i></button>` : "");
  $("us-lista").innerHTML = `
    <div class="so-pc">
      <div class="tab-cab us-g"><span>Nome</span><span>E-mail</span><span>Adicionado em</span><span>Situação</span><span></span></div>
      ${ordem.map((u) => `
        <div class="tab-l us-g">
          <span class="pessoa"><span class="avatar">${esc(iniciais(u.nome))}</span><b>${esc(u.nome)}</b>${selos(u)}</span>
          <span>${esc(u.email)}</span><span>${ddmm(desde(u))}</span>
          <span class="sit${u.trocarSenha ? " espera" : ""}">${u.trocarSenha ? "Falta o 1º acesso" : "Ativo"}</span>
          <span class="acoes">${lixo(u)}</span>
        </div>`).join("")}
      <div class="rodape-t"><i data-ic="info"></i><span>Todo usuário vê e mexe em tudo deste restaurante: pedidos, cardápio, entregas, cupons, configurações e usuários. Ninguém daqui vê outro restaurante.</span></div>
    </div>
    <div class="so-cel">
      ${ordem.map((u) => `
        <div class="pes">
          <span class="avatar">${esc(iniciais(u.nome))}</span>
          <div class="t"><b>${esc(u.nome)} ${selos(u)}</b>
            <small class="${u.trocarSenha ? "espera" : ""}">${u.dono ? esc(u.email) : `${u.trocarSenha ? "Falta o 1º acesso" : esc(u.email)} · ${ddmm(desde(u))}`}</small></div>
          ${lixo(u)}
        </div>`).join("")}
    </div>`;
  pintarIcones($("vista-usuarios"));
}

/* ===== P61 / PD61 novo usuário ===== */
function abrirJanela() {
  U.janela = true;
  $("us-nome").value = $("us-email").value = "";
  $("us-senha").value = gerarSenha();
  $("us-aviso").textContent = "Essa pessoa vai ver e mexer em tudo deste restaurante, como você.";
  $("us-modal").hidden = false;
  document.body.classList.add("com-janela");
  pintarIcones($("us-modal"));
  $("us-nome").focus();
}
function fecharJanela() {
  U.janela = false;
  $("us-modal").hidden = true;
  document.body.classList.remove("com-janela");
}

async function adicionar() {
  if (U.ocupado) return;
  const nome = $("us-nome").value.trim().replace(/\s+/g, " ");
  const email = $("us-email").value.trim().toLowerCase();
  const senha = $("us-senha").value.trim();
  if (nome.length < 2) return toast("Informe o nome da pessoa.", "erro", 3500);
  if (!emailValido(email)) return toast("Esse e-mail não parece certo.", "erro", 3500);
  if (senha.length < 8) return toast("A senha provisória precisa de pelo menos 8 caracteres.", "erro", 3500);
  if (U.usuarios.some((u) => u.email === email)) return toast("Essa pessoa já tem acesso.", "erro", 3500);
  const novo = { lojaId: U.loja.id, nome, email, dono: false, trocarSenha: true };
  if (U.exemplo) {
    U.usuarios.push({ ...novo, criadoEm: new Date() });
    toast("Exemplo: as mudanças ficam só nesta tela.", "info", 3000);
    location.hash = "#usuarios";
    return;
  }
  U.ocupado = true;
  $("us-salvar").classList.add("desligado");
  const ref = doc(db, "acessos", email);
  try {
    // o acesso primeiro: se o e-mail já é de outro restaurante, a regra recusa e nenhuma conta nasce
    try { await setDoc(ref, { ...novo, criadoEm: serverTimestamp() }); }
    catch (err) {
      toast(err?.code === "permission-denied" ? "Esse e-mail já tem acesso a outro restaurante." : "Não deu para salvar. Confira a internet e tente de novo.", "erro", 5000);
      return;
    }
    let jaTinhaConta = false;
    const app2 = initializeApp(firebaseConfig, `usuario-${Date.now()}`);
    const auth2 = getAuth(app2);
    // no teste local a conta nasce no emulador, como a sessão principal (firebase-init.js)
    if (new URLSearchParams(location.search).get("emulator") === "1") connectAuthEmulator(auth2, "http://localhost:9099", { disableWarnings: true });
    try { await createUserWithEmailAndPassword(auth2, email, senha); }
    catch (err) {
      if (err?.code === "auth/email-already-in-use") jaTinhaConta = true;
      else {
        await deleteDoc(ref).catch(() => {});
        toast(err?.code === "auth/network-request-failed" ? "Sem conexão. Confira a internet e tente de novo." : "Não deu para criar a conta. Tente de novo.", "erro", 5000);
        return;
      }
    } finally {
      await signOut(auth2).catch(() => {});
      await deleteApp(app2).catch(() => {});
    }
    // quem já tinha conta (foi removido antes, por exemplo) entra com a senha que já usa
    toast(jaTinhaConta
      ? `${primeiroNome(nome)} já tinha conta no Cardápio Delivery: entra com a senha que já usa, ou com Esqueci minha senha.`
      : `${primeiroNome(nome)} já pode entrar. Passe a senha provisória para essa pessoa.`, "sucesso", 7000);
    location.hash = "#usuarios";
  } finally {
    U.ocupado = false;
    $("us-salvar").classList.remove("desligado");
  }
}

async function tirarAcesso(email) {
  const u = U.usuarios.find((x) => x.email === email);
  if (!u || u.dono || u.email === U.eu) return;
  if (!(await confirmar(`Tirar o acesso de ${u.nome}? A partir de agora, ${u.email} não entra mais no painel deste restaurante. Se estiver com o painel aberto, sai na hora. Dá para adicionar de novo depois.`, { textoConfirmar: "Tirar acesso" }))) return;
  if (U.exemplo) { U.usuarios = U.usuarios.filter((x) => x.email !== email); render(); return; }
  try { await deleteDoc(doc(db, "acessos", email)); toast(`${primeiroNome(u.nome)} não tem mais acesso.`, "sucesso", 3500); }
  catch { toast("Não deu para tirar o acesso. Confira a internet e tente de novo.", "erro", 4500); }
}

/* ===== entrada pelo endereço ===== */
export function mostrarUsuarios(partes) {
  if (!U.loja) return;
  render();
  if (partes[1] === "novo") { if (!U.janela) abrirJanela(); }
  else if (U.janela) fecharJanela();
}
export function fecharUsuarios() { if (U.janela) fecharJanela(); }

function aoClicar(e) {
  if ($("vista-usuarios").hidden && $("us-modal").hidden) return;
  const el = e.target.closest("[data-tirar-acesso]");
  if (el) { tirarAcesso(el.dataset.tirarAcesso); return; }
  if (e.target.closest("[data-gerar-senha]")) { $("us-senha").value = gerarSenha(); return; }
  if (e.target.id === "us-modal" && window.matchMedia("(min-width: 1024px)").matches) location.hash = "#usuarios";
}
function aoEnviar(e) {
  if (e.target.id !== "us-form") return;
  e.preventDefault();
  adicionar();
}
function aoDigitar(e) {
  if (e.target.id !== "us-nome") return;
  const nome = primeiroNome(e.target.value);
  $("us-aviso").textContent = `${nome || "Essa pessoa"} vai ver e mexer em tudo deste restaurante, como você.`;
}
function aoTeclar(e) {
  if (e.key === "Escape" && U.janela) { e.preventDefault(); location.hash = "#usuarios"; }
}

/* ===== ligar e desligar ===== */
export function iniciarUsuarios(loja, { eu = "", exemplo = null } = {}) {
  pararUsuarios();
  U.loja = { ...loja };
  U.eu = eu;
  document.addEventListener("click", aoClicar);
  document.addEventListener("submit", aoEnviar);
  document.addEventListener("input", aoDigitar);
  document.addEventListener("keydown", aoTeclar);
  if (exemplo) { U.exemplo = true; U.usuarios = exemplo.map((u) => ({ ...u })); return; }
  U.exemplo = false;
  U.parar.push(onSnapshot(query(collection(db, "acessos"), where("lojaId", "==", loja.id)), (snap) => {
    U.usuarios = snap.docs.map((d) => d.data({ serverTimestamps: "estimate" })); // quem acabou de entrar já mostra a data
    if (!$("vista-usuarios").hidden) render();
  }, (err) => {
    // acesso retirado: quem avisa e fecha o painel é o vigia do painel.js, sem um segundo aviso aqui
    if (err?.code !== "permission-denied") toast("Não deu para ler os usuários.", "erro", 5000);
  }));
}
export function pararUsuarios() {
  U.parar.forEach((f) => f());
  U.parar = [];
  document.removeEventListener("click", aoClicar);
  document.removeEventListener("submit", aoEnviar);
  document.removeEventListener("input", aoDigitar);
  document.removeEventListener("keydown", aoTeclar);
}
