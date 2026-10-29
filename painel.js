/*
  painel.js: entrada do painel do restaurante (imagens P01 a P03, PD01, PD02).
  Depois do login, a tela de pedidos mora em pedidos.js e o cardápio em cardapio.js.
  Cadastro do dono pelo próprio app (crença 38): cria a conta no Firebase
  Auth, a loja em lojas/{link} (o link é o id, então dois restaurantes não
  pegam o mesmo) e os dados privados em donos/{uid}.
  Usuários do painel (usuarios.js): quem não é dono acha a loja por
  acessos/{email}; quem entrou com a senha provisória cria a própria (P62).
*/

import { db, auth } from "./firebase-init.js?v=3";
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, createUserWithEmailAndPassword, updatePassword,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, limit, getDocs, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { toast } from "./shared.js?v=1";
import { pintarIcones } from "./icones.js?v=3";
import { iniciarPedidos, pararPedidos, abrirPedido } from "./pedidos.js?v=14";
import { iniciarCardapio, pararCardapio, mostrarCardapio, fecharCardapio } from "./cardapio.js?v=6";
import { iniciarEntregas, pararEntregas, mostrarEntregas, fecharEntregas } from "./entregas.js?v=5";
import { iniciarClientes, pararClientes, mostrarClientes, fecharClientes } from "./clientes.js?v=2";
import { CRM_EXEMPLO } from "./crm-exemplo.js?v=1";
import { iniciarConfiguracoes, pararConfiguracoes, mostrarConfiguracoes } from "./configuracoes.js?v=8";
import { iniciarCupons, pararCupons, mostrarCupons, fecharCupons } from "./cupons.js?v=4";
import { iniciarUsuarios, pararUsuarios, mostrarUsuarios, fecharUsuarios } from "./usuarios.js?v=1";
import { PEDIDOS_EXEMPLO, CATEGORIAS, LOJA as LOJA_EXEMPLO, BAIRROS as BAIRROS_EXEMPLO, CUPONS_EXEMPLO } from "./dados-exemplo.js?v=7";

import { linkPublico } from "./links-cardapio.js?v=1";
const $ = (id) => document.getElementById(id);
const valor = (id) => $(id).value.trim();
const STATE = { user: null, loja: null, passo: 1, ocupado: false, entrando: false, trocarSenha: false, pararAcesso: null };
const emailDe = (user) => (user?.email || "").toLowerCase();
const EXEMPLO_PAINEL = new URLSearchParams(location.search).get("exemplo") === "painel"; // pedidos das imagens, sem login e sem Firestore
const EXEMPLO_SENHA = new URLSearchParams(location.search).get("exemplo") === "senha"; // a P62 / PD62, para conferir a tela

/* ===== mensagens do Firebase em português ===== */
function mensagemErro(err) {
  const c = err?.code || "";
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(c)) return "E-mail ou senha incorretos.";
  if (c === "auth/invalid-email") return "Esse e-mail não parece certo.";
  if (c === "auth/too-many-requests") return "Muitas tentativas. Espere alguns minutos e tente de novo.";
  if (c === "auth/email-already-in-use") return "Já existe uma conta com esse e-mail. Use Entrar.";
  if (c === "auth/network-request-failed") return "Sem conexão. Confira a internet e tente de novo.";
  if (c === "auth/weak-password") return "Essa senha é fraca. Use pelo menos 8 caracteres.";
  if (c === "permission-denied") return "Esse link do cardápio já está em uso. Escolha outro.";
  return "Não deu certo. Tente de novo.";
}

/* ===== navegação por hash: #entrar, #cadastro/1, #cadastro/2, #painel, #painel/<pedido>, #cardapio/... ===== */
function irParaHash() {
  const partes = (location.hash.slice(1) || "entrar").split("/");
  let [tela, passo] = partes;
  let vista = "pedidos";
  if (STATE.trocarSenha || EXEMPLO_SENHA) {
    if (tela !== "senha") history.replaceState(null, "", "#senha");
    tela = "senha";
  } else if (STATE.user || EXEMPLO_PAINEL) {
    if (["cardapio", "clientes", "entregas", "cupons", "configuracoes", "usuarios"].includes(tela)) vista = tela;
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
  $("vista-entregas").hidden = vista !== "entregas";
  $("vista-configuracoes").hidden = vista !== "configuracoes";
  $("vista-cupons").hidden = vista !== "cupons";
  $("vista-usuarios").hidden = vista !== "usuarios";
  $("vista-clientes").hidden = vista !== "clientes";
  // no celular, Usuários abre pelos Ajustes e o item Ajustes fica marcado
  document.querySelectorAll("[data-vista]").forEach((a) => a.classList.toggle("on", a.dataset.vista.split(" ").includes(vista)));
  if (vista !== "cardapio") fecharCardapio();
  if (vista !== "entregas") fecharEntregas();
  if (vista !== "cupons") fecharCupons();
  if (vista !== "usuarios") fecharUsuarios();
  if (vista !== "clientes") fecharClientes();
  if (vista === "cardapio") mostrarCardapio(partes);
  else if (vista === "entregas") mostrarEntregas(partes);
  else if (vista === "configuracoes") mostrarConfiguracoes();
  else if (vista === "cupons") mostrarCupons(partes);
  else if (vista === "usuarios") mostrarUsuarios(partes);
  else if (vista === "clientes") mostrarClientes();
  else if (passo) abrirPedido(passo); // #painel/<id> abre o detalhe
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
const mostrarLink = () => ($("c-link").textContent = linkPublico(valor("c-slug") || "nome-do-restaurante").replace("https://", ""));

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
// O dono acha a loja pelo donoId; quem foi adicionado em Usuários, por acessos/{email}.
async function abrirPainel(user) {
  const achadas = await getDocs(query(collection(db, "lojas"), where("donoId", "==", user.uid), limit(1)));
  STATE.loja = achadas.empty ? null : { id: achadas.docs[0].id, ...achadas.docs[0].data() };
  let acesso = null;
  try { const a = await getDoc(doc(db, "acessos", emailDe(user))); if (a.exists()) acesso = a.data(); }
  catch { /* sem acesso gravado: segue como dono, ou sai abaixo */ }
  if (!STATE.loja && acesso) {
    const l = await getDoc(doc(db, "lojas", acesso.lojaId));
    if (l.exists()) STATE.loja = { id: l.id, ...l.data() };
  }
  if (!STATE.loja) { toast("Esta conta não tem restaurante ligado.", "erro", 5000); await signOut(auth); return; }
  const dono = STATE.loja.donoId === user.uid;
  document.querySelectorAll(".nome-loja").forEach((el) => (el.textContent = STATE.loja.nome || ""));
  $("papel").textContent = dono ? "Você está como dono" : "Você está como equipe";
  // o dono entra na lista de Usuários na primeira vez que abre o painel. Em try/catch
  // separado: se falhar, o painel abre do mesmo jeito (antecipacao.md A9)
  if (dono && !acesso) garantirAcessoDoDono(user).catch(() => {});
  if (!dono) {
    vigiarAcesso(user);
    if (acesso.trocarSenha) { STATE.trocarSenha = true; irParaHash(); return; }
  }
  iniciarPedidos(STATE.loja);
  iniciarCardapio(STATE.loja);
  iniciarEntregas(STATE.loja);
  iniciarConfiguracoes(STATE.loja);
  iniciarCupons(STATE.loja);
  iniciarUsuarios(STATE.loja, { eu: emailDe(user) });
  iniciarClientes(STATE.loja);
  if (!/^#(painel|cardapio|clientes|entregas|cupons|configuracoes|usuarios)/.test(location.hash)) location.hash = "#painel";
  irParaHash();
}

async function garantirAcessoDoDono(user) {
  let nome = "";
  try { nome = (await getDoc(doc(db, "donos", user.uid))).data()?.nome || ""; } catch { /* usa o e-mail */ }
  await setDoc(doc(db, "acessos", emailDe(user)), {
    lojaId: STATE.loja.id, nome: nome || emailDe(user).split("@")[0], email: emailDe(user),
    dono: true, trocarSenha: false, criadoEm: serverTimestamp(),
  });
}

// quem tirou o acesso desta pessoa em Usuários: o painel fecha na hora, mesmo aberto
function vigiarAcesso(user) {
  STATE.pararAcesso?.();
  STATE.pararAcesso = onSnapshot(doc(db, "acessos", emailDe(user)), (snap) => {
    if (!snap.exists() || snap.data().lojaId !== STATE.loja?.id) sair("Seu acesso a este restaurante foi retirado.");
  }, () => {});
}

function pararTudo() {
  STATE.pararAcesso?.();
  STATE.pararAcesso = null;
  pararClientes(); pararPedidos(); pararCardapio(); pararEntregas(); pararConfiguracoes(); pararCupons(); pararUsuarios();
}
async function sair(aviso) {
  pararTudo();
  STATE.trocarSenha = false;
  await signOut(auth);
  location.hash = "#entrar";
  if (aviso) toast(aviso, "erro", 6000);
}
document.querySelectorAll("[data-sair]").forEach((b) => b.addEventListener("click", () => sair()));

/* ===== P62 / PD62 criar a senha no primeiro acesso ===== */
$("tela-senha").addEventListener("submit", async (e) => {
  e.preventDefault();
  if ($("btn-senha").classList.contains("desligado")) return;
  const senha = $("s-senha").value;
  if (senha.length < 8) { toast("A senha precisa de pelo menos 8 caracteres.", "erro", 3500); return; }
  if (senha !== $("s-senha2").value) { toast("As duas senhas não são iguais.", "erro", 3500); return; }
  $("btn-senha").classList.add("desligado");
  try {
    await updatePassword(auth.currentUser, senha);
    await updateDoc(doc(db, "acessos", emailDe(auth.currentUser)), { trocarSenha: false });
    STATE.trocarSenha = false;
    $("s-senha").value = $("s-senha2").value = "";
    toast("Senha criada. Bem-vindo ao painel.", "sucesso", 4000);
    await abrirPainel(auth.currentUser);
  } catch (err) {
    // sessão aberta há muito tempo: o Firebase pede para entrar de novo antes de trocar a senha
    if (err?.code === "auth/requires-recent-login") await sair("Por segurança, entre de novo com a senha provisória.");
    else toast(mensagemErro(err), "erro", 4500);
  } finally { $("btn-senha").classList.remove("desligado"); }
});

// se o Firebase demorar a responder (rede lenta), mostra a entrada em vez de tela vazia
setTimeout(() => { if (document.body.dataset.tela === "carregando") irParaHash(); }, 1500);

if (EXEMPLO_PAINEL) {
  iniciarPedidos({ id: "exemplo", nome: "Nome do Restaurante" }, { exemplo: PEDIDOS_EXEMPLO });
  iniciarCardapio({ id: "exemplo", nome: "Nome do Restaurante" }, { exemplo: CATEGORIAS });
  iniciarClientes({id:"exemplo",nome:"Casa Jambu"},{exemplo:CRM_EXEMPLO});
  iniciarCupons({ id: "exemplo", nome: "Nome do Restaurante" }, { exemplo: CUPONS_EXEMPLO });
  // pessoas das imagens PD60 e P60 (fictícias, o repositório é público)
  const dia = (d) => new Date(2026, 9, d, 10);
  iniciarUsuarios({ id: "exemplo", nome: "Nome do Restaurante" }, { eu: "dono@restaurante.com", exemplo: [
    { email: "dono@restaurante.com", nome: "Nome Sobrenome", dono: true, trocarSenha: false, criadoEm: dia(15) },
    { email: "ana@restaurante.com", nome: "Ana Souza", dono: false, trocarSenha: false, criadoEm: dia(16) },
    { email: "bruno@restaurante.com", nome: "Bruno Lima", dono: false, trocarSenha: false, criadoEm: dia(18) },
    { email: "carla@restaurante.com", nome: "Carla Dias", dono: false, trocarSenha: true, criadoEm: dia(20) },
  ] });
  iniciarEntregas({ id: "exemplo", nome: "Nome do Restaurante" }, { exemplo: {
    loja: { bairro: LOJA_EXEMPLO.bairro, cidade: LOJA_EXEMPLO.cidade, local: LOJA_EXEMPLO.local, entrega: LOJA_EXEMPLO.entrega, endereco: "Rua do Exemplo, 100" },
    bairros: BAIRROS_EXEMPLO } });
  iniciarConfiguracoes({ id: "nome-do-restaurante" }, { exemplo: {
    nome: LOJA_EXEMPLO.nome, cidade: LOJA_EXEMPLO.cidade, bairro: LOJA_EXEMPLO.bairro, whatsapp: "91900000000", cor: LOJA_EXEMPLO.cor, logoUrl: "",
    abrirSozinho: true, aberta: true, entrega: LOJA_EXEMPLO.entrega,
    horario: { seg: { aberto: false }, ter: { aberto: true, abre: "18:00", fecha: "23:00" }, qua: { aberto: true, abre: "18:00", fecha: "23:00" },
      qui: { aberto: true, abre: "18:00", fecha: "23:00" }, sex: { aberto: true, abre: "18:00", fecha: "00:00" },
      sab: { aberto: true, abre: "18:00", fecha: "00:00" }, dom: { aberto: true, abre: "17:00", fecha: "23:00" } } } });
  irParaHash();
} else {
  onAuthStateChanged(auth, async (user) => {
    STATE.user = user;
    if (user && !STATE.ocupado) await abrirPainel(user);
    else { pararTudo(); STATE.trocarSenha = false; irParaHash(); }
  });
}

if (EXEMPLO_SENHA) document.querySelectorAll(".nome-loja").forEach((el) => (el.textContent = "Nome do Restaurante"));

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
