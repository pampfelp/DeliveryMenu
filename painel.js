/*
  painel.js: entrada do painel do restaurante (imagens P01 a P03, PD01, PD02).
  Depois do login, a tela de pedidos mora em pedidos.js e o cardápio em cardapio.js.
  Cadastro do dono pelo próprio app (crença 38): cria a conta no Firebase
  Auth, a loja em lojas/{link} (o link é o id, então dois restaurantes não
  pegam o mesmo) e os dados privados em donos/{uid}.
*/

import { db, auth } from "./firebase-init.js?v=2";
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, createUserWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, collection, query, where, limit, getDocs, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { toast } from "./shared.js?v=1";
import { pintarIcones } from "./icones.js?v=3";
import { iniciarPedidos, pararPedidos, abrirPedido } from "./pedidos.js?v=3";
import { iniciarCardapio, pararCardapio, mostrarCardapio, fecharCardapio } from "./cardapio.js?v=2";
import { PEDIDOS_EXEMPLO, CATEGORIAS } from "./dados-exemplo.js?v=6";

const BASE_LOJA = "pampfelp.github.io/DeliveryMenu/?loja=";
const $ = (id) => document.getElementById(id);
const valor = (id) => $(id).value.trim();
const STATE = { user: null, loja: null, passo: 1, ocupado: false, entrando: false };
const EXEMPLO_PAINEL = new URLSearchParams(location.search).get("exemplo") === "painel"; // pedidos das imagens, sem login e sem Firestore

/* ===== mensagens do Firebase em português ===== */
function mensagemErro(err) {
  const c = err?.code || "";
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(c)) return "E-mail ou senha incorretos.";
  if (c === "auth/invalid-email") return "Esse e-mail não parece certo.";
  if (c === "auth/too-many-requests") return "Muitas tentativas. Espere alguns minutos e tente de novo.";
  if (c === "auth/email-already-in-use") return "Já existe uma conta com esse e-mail. Use Entrar.";
  if (c === "auth/network-request-failed") return "Sem conexão. Confira a internet e tente de novo.";
  if (c === "permission-denied") return "Esse link do cardápio já está em uso. Escolha outro.";
  return "Não deu certo. Tente de novo.";
}

/* ===== navegação por hash: #entrar, #cadastro/1, #cadastro/2, #painel, #painel/<pedido>, #cardapio/... ===== */
function irParaHash() {
  const partes = (location.hash.slice(1) || "entrar").split("/");
  let [tela, passo] = partes;
  let vista = "pedidos";
  if (STATE.user || EXEMPLO_PAINEL) {
    if (tela === "cardapio") vista = "cardapio";
    else if (tela !== "painel") history.replaceState(null, "", "#painel"); // logado, o endereço acompanha
    tela = "painel";
  }
  else if (!["entrar", "cadastro"].includes(tela)) tela = "entrar";
  if (tela === "cadastro") {
    STATE.passo = passo === "2" && passo1Valido(false) ? 2 : 1;
    // passo 2 sem o passo 1 feito volta para o 1, e o endereço acompanha
    if (passo === "2" && STATE.passo === 1) history.replaceState(null, "", "#cadastro/1");
    renderPasso();
  }
  document.body.dataset.tela = tela;
  document.querySelectorAll(".direita > .form").forEach((f) => (f.hidden = f.id !== `tela-${tela}`));
  $("tela-painel").hidden = tela !== "painel";
  document.querySelector(".auth").hidden = tela === "painel";
  if (tela !== "painel") return;
  document.body.dataset.vista = vista;
  $("vista-pedidos").hidden = vista !== "pedidos";
  $("vista-cardapio").hidden = vista !== "cardapio";
  document.querySelectorAll("[data-vista]").forEach((a) => a.classList.toggle("on", a.dataset.vista === vista));
  if (vista === "cardapio") mostrarCardapio(partes);
  else { fecharCardapio(); if (passo) abrirPedido(passo); } // #painel/<id> abre o detalhe
}
window.addEventListener("hashchange", irParaHash);

/* ===== mostrar senha ===== */
document.querySelectorAll(".ver-senha").forEach((b) => b.addEventListener("click", () => {
  const campo = b.parentElement.querySelector("input");
  campo.type = campo.type === "password" ? "text" : "password";
  b.setAttribute("aria-label", campo.type === "password" ? "Mostrar senha" : "Esconder senha");
}));

/* ===== P01 entrar ===== */
$("tela-entrar").addEventListener("submit", async (e) => {
  e.preventDefault();
  // STATE.ocupado é só do cadastro (segura a carga da loja até ela existir); no login,
  // usar a mesma marca fazia o aviso de "entrou" do Firebase pular a carga do painel
  if (STATE.entrando) return;
  const email = valor("e-email"), senha = $("e-senha").value;
  if (!email || !senha) { toast("Informe o e-mail e a senha.", "erro", 3500); return; }
  STATE.entrando = true;
  $("btn-entrar").classList.add("desligado");
  try { await signInWithEmailAndPassword(auth, email, senha); }
  catch (err) { toast(mensagemErro(err), "erro", 4000); }
  finally { STATE.entrando = false; $("btn-entrar").classList.remove("desligado"); }
});

$("btn-esqueci").addEventListener("click", async () => {
  const email = valor("e-email");
  if (!email) { toast("Digite o seu e-mail no campo acima e toque de novo.", "info", 4000); $("e-email").focus(); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    toast("Se houver conta com esse e-mail, chega um link para trocar a senha.", "sucesso", 5000);
  } catch (err) { toast(mensagemErro(err), "erro", 4000); }
});

/* ===== P02 e P03 cadastro ===== */
const soDigitos = (t) => t.replace(/\D/g, "");
function formatarTelefone(t) {
  const d = soDigitos(t).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
$("c-whats").addEventListener("input", (e) => (e.target.value = formatarTelefone(e.target.value)));

// link do cardápio: minúsculas, sem acento, só letras, números e hífen
const virarLink = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
let linkEditado = false;
$("c-loja").addEventListener("input", () => { if (!linkEditado) $("c-slug").value = virarLink(valor("c-loja")); mostrarLink(); });
$("c-slug").addEventListener("input", (e) => { linkEditado = true; e.target.value = virarLink(e.target.value) + (e.target.value.endsWith("-") ? "-" : ""); mostrarLink(); });
const mostrarLink = () => ($("c-link").textContent = BASE_LOJA + (valor("c-slug") || "nome-do-restaurante"));

const emailValido = (t) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
function passo1Valido(avisar = true) {
  const falha = (msg) => { if (avisar) toast(msg, "erro", 3500); return false; };
  if (valor("c-nome").length < 3) return falha("Informe o seu nome completo.");
  if (!emailValido(valor("c-email"))) return falha("Esse e-mail não parece certo.");
  if (![10, 11].includes(soDigitos(valor("c-whats")).length)) return falha("Informe o WhatsApp com DDD.");
  if ($("c-senha").value.length < 8) return falha("A senha precisa de pelo menos 8 caracteres.");
  if ($("c-senha").value !== $("c-senha2").value) return falha("As duas senhas não são iguais.");
  return true;
}
function passo2Valido() {
  const falha = (msg) => { toast(msg, "erro", 3500); return false; };
  if (valor("c-loja").length < 2) return falha("Informe o nome do restaurante.");
  if (virarLink(valor("c-slug")).length < 3) return falha("O link do cardápio precisa de pelo menos 3 letras ou números.");
  if (valor("c-cidade").length < 2) return falha("Informe a cidade.");
  if (valor("c-bairro").length < 2) return falha("Informe o bairro do restaurante.");
  if (!$("c-aceite").checked) return falha("Para continuar, aceite os termos de uso e a política de privacidade.");
  return true;
}

function renderPasso() {
  const dois = STATE.passo === 2;
  $("passo-1").hidden = dois;
  $("passo-2").hidden = !dois;
  $("passo-n").textContent = `Passo ${STATE.passo} de 2`;
  $("passo-nome").textContent = dois ? "Restaurante" : "Seus dados";
  $("passo-barra").style.width = dois ? "100%" : "50%";
  $("btn-cadastro").textContent = dois ? "Criar conta e abrir o painel" : "Continuar";
  $("btn-voltar").hidden = !dois;
  $("ja-tem").hidden = dois;
  document.body.dataset.passo = STATE.passo;
  mostrarLink();
}

$("tela-cadastro").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (STATE.passo === 1) {
    if (passo1Valido()) location.hash = "#cadastro/2";
    return;
  }
  if (STATE.ocupado || !passo2Valido()) return;
  STATE.ocupado = true;
  $("btn-cadastro").classList.add("desligado");
  const slug = virarLink(valor("c-slug"));
  let usuario = null;
  try {
    if ((await getDoc(doc(db, "lojas", slug))).exists()) throw { code: "permission-denied" };
    usuario = (await createUserWithEmailAndPassword(auth, valor("c-email"), $("c-senha").value)).user;
    await setDoc(doc(db, "lojas", slug), {
      nome: valor("c-loja"), slug, cidade: valor("c-cidade"), bairro: valor("c-bairro"),
      cor: "#991b1b", logoUrl: "", donoId: usuario.uid, criadoEm: serverTimestamp(),
    });
    await setDoc(doc(db, "donos", usuario.uid), {
      nome: valor("c-nome"), email: usuario.email, whatsapp: soDigitos(valor("c-whats")),
      lojaId: slug, criadoEm: serverTimestamp(),
    });
    toast("Conta criada. Bem-vindo ao painel.", "sucesso", 4000);
    await abrirPainel(usuario);
  } catch (err) {
    // conta criada mas a loja não: apaga a conta para não deixar dono sem restaurante
    if (usuario) { try { await usuario.delete(); } catch { /* fica para o suporte */ } }
    toast(mensagemErro(err), "erro", 5000);
  } finally {
    STATE.ocupado = false;
    $("btn-cadastro").classList.remove("desligado");
  }
});

/* ===== depois do login: tela de pedidos ===== */
async function abrirPainel(user) {
  const achadas = await getDocs(query(collection(db, "lojas"), where("donoId", "==", user.uid), limit(1)));
  STATE.loja = achadas.empty ? null : { id: achadas.docs[0].id, ...achadas.docs[0].data() };
  if (!STATE.loja) { toast("Esta conta não tem restaurante ligado.", "erro", 5000); await signOut(auth); return; }
  iniciarPedidos(STATE.loja);
  iniciarCardapio(STATE.loja);
  if (!/^#(painel|cardapio)/.test(location.hash)) location.hash = "#painel";
  irParaHash();
}
document.querySelectorAll("[data-sair]").forEach((b) => b.addEventListener("click", async () => {
  pararPedidos();
  pararCardapio();
  await signOut(auth);
  location.hash = "#entrar";
}));

// se o Firebase demorar a responder (rede lenta), mostra a entrada em vez de tela vazia
setTimeout(() => { if (document.body.dataset.tela === "carregando") irParaHash(); }, 1500);

if (EXEMPLO_PAINEL) {
  iniciarPedidos({ id: "exemplo", nome: "Nome do Restaurante" }, { exemplo: PEDIDOS_EXEMPLO });
  iniciarCardapio({ id: "exemplo", nome: "Nome do Restaurante" }, { exemplo: CATEGORIAS });
  irParaHash();
} else {
  onAuthStateChanged(auth, async (user) => {
    STATE.user = user;
    if (user && !STATE.ocupado) await abrirPainel(user);
    else { pararPedidos(); pararCardapio(); irParaHash(); }
  });
}

// ?exemplo=1 preenche os campos como nas imagens validadas (para conferir a tela)
if (new URLSearchParams(location.search).has("exemplo")) {
  const ex = { "e-email": "dono@restaurante.com", "e-senha": "exemplo123", "c-nome": "Nome Sobrenome", "c-email": "dono@restaurante.com",
    "c-whats": "(91) 90000-0000", "c-senha": "exemplo123", "c-senha2": "exemplo123", "c-loja": "Nome do Restaurante",
    "c-slug": "nome-do-restaurante", "c-cidade": "Belém - PA", "c-bairro": "Centro" };
  Object.entries(ex).forEach(([id, v]) => ($(id).value = v));
  $("c-aceite").checked = true;
}

pintarIcones();
mostrarLink();
