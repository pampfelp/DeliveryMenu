/*
  Autenticação real (Firebase Auth) + papéis — só usar quando o projeto
  precisar de acesso real, não uso pessoal (ver decisoes.md #1: sempre
  perguntar, nunca assumir). Ponto de partida testado em produção (Sistema
  IEQ Tapajós, primeiro projeto do Felipe com Auth real ponta a ponta,
  2026-08-27) — ver padroes/dados-e-seguranca.md.

  Modelo de dados esperado (adapte os nomes de coleção ao domínio):
    usuarios/{uid}      -> { perfilId, email, createdAt }   (ponte Auth → perfil)
    perfis/{id}         -> { nome, papeis: [...], ... }     (dado de negócio)
    config/bootstrap    -> { adminCriado: bool }            (trava do 1º admin)

  Papéis ATRIBUÍDOS diretamente ficam em perfis/{id}.papeis (ex.: "admin").
  Papéis DERIVADOS (ex.: "líder de X") NUNCA duplicam aqui — calcule via
  referência reversa (ver padroes/dados-e-seguranca.md "Papel/função
  derivado por referência"), do jeito que souLiderDe()/etc. fazem abaixo
  como exemplo a adaptar.
*/

import { db, auth, firebaseConfig } from "../firebase-init.js?v=1";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword, updatePassword, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, collection, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

export const AUTH = {
  pronto: false,   // primeiro carregamento (login + papéis) já resolvido
  user: null,      // objeto do Firebase Auth
  perfil: null,    // { id, nome, papeis, ... } — doc de perfis/{id}
};

let _pararListenerPerfil = null;
let _onChangeCallback = null;

function _limparListeners() {
  _pararListenerPerfil?.();
  _pararListenerPerfil = null;
}

/** Chame uma vez no bootstrap do app.js. onChange(AUTH) dispara a cada mudança relevante. */
export function iniciarAuth(onChange) {
  _onChangeCallback = onChange;
  onAuthStateChanged(auth, async (user) => {
    _limparListeners();
    AUTH.user = user;
    AUTH.perfil = null;

    if (!user) {
      AUTH.pronto = true;
      onChange(AUTH);
      return;
    }

    const usuarioSnap = await getDoc(doc(db, "usuarios", user.uid));
    if (!usuarioSnap.exists()) {
      // Conta existe no Auth mas sem vínculo de perfil — estado inconsistente,
      // trata como não-logado pra não travar a tela.
      AUTH.pronto = true;
      onChange(AUTH);
      return;
    }
    const perfilId = usuarioSnap.data().perfilId;

    _pararListenerPerfil = onSnapshot(doc(db, "perfis", perfilId), (snap) => {
      AUTH.perfil = snap.exists() ? { id: snap.id, ...snap.data() } : null;
      AUTH.pronto = true;
      onChange(AUTH);
    });

    // Adicione aqui listeners de papel DERIVADO se o domínio precisar
    // (ex.: "sou líder de quais X" via query where("liderId","==",perfilId))
    // — ver js/auth.js do Sistema IEQ Tapajós como referência completa.
  });
}

/** Traduz erros comuns do Firebase Auth pra mensagem em português. */
export function mensagemErroAuth(err) {
  const codigo = err?.code || "";
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"].includes(codigo)) {
    return "E-mail ou senha incorretos.";
  }
  if (codigo === "auth/too-many-requests") return "Muitas tentativas. Tente novamente em alguns minutos.";
  if (codigo === "auth/weak-password") return "Senha muito curta (mínimo 6 caracteres).";
  if (codigo === "auth/email-already-in-use") return "Já existe uma conta (de outro perfil) usando esse e-mail — use um e-mail diferente.";
  return err?.message || "Não foi possível concluir. Tente novamente.";
}

export function temPapel(papel) { return !!AUTH.perfil?.papeis?.includes(papel); }
export function isAdmin() { return temPapel("admin"); }

export async function login(email, senha) {
  await signInWithEmailAndPassword(auth, email, senha);
}
export async function logout() {
  await signOut(auth);
}
export async function alterarMinhaSenha(novaSenha) {
  await updatePassword(auth.currentUser, novaSenha);
}
export async function enviarResetSenha(email) {
  await sendPasswordResetEmail(auth, email);
}

/* ===== bootstrap do primeiro admin (sem acesso ao console do Firebase) ===== */

/**
 * Autocorreção: se o usuário logado já é admin de verdade mas
 * config/bootstrap não reflete isso, fecha a janela de bootstrap agora.
 * Idempotente e barata — chamar toda vez que um admin loga não tem custo
 * real. Ver padroes/dados-e-seguranca.md pro porquê disso ser necessário
 * (bug real de regra que negava a própria escrita que deveria fechar a
 * janela — corrigido, mas dados já gravados errado não se corrigem sozinhos).
 */
export async function garantirBootstrapFechado() {
  try {
    const snap = await getDoc(doc(db, "config", "bootstrap"));
    if (!snap.exists() || snap.data().adminCriado !== true) {
      await setDoc(doc(db, "config", "bootstrap"), { adminCriado: true }, { merge: true });
    }
  } catch {
    // Sem permissão ou offline — não é crítico, só não fecha a janela agora.
  }
}

export async function bootstrapNecessario() {
  const snap = await getDoc(doc(db, "config", "bootstrap"));
  return !snap.exists() || snap.data().adminCriado === false;
}

export async function criarPrimeiroAdmin({ nome, email, senha }) {
  const cred = await createUserWithEmailAndPassword(auth, email, senha);
  const perfilRef = doc(collection(db, "perfis")); // reserva um ID novo do Firestore
  await setDoc(perfilRef, { nome, papeis: ["admin"], createdAt: serverTimestamp() });
  await setDoc(doc(db, "usuarios", cred.user.uid), { perfilId: perfilRef.id, email, createdAt: serverTimestamp() });
  await setDoc(doc(db, "config", "bootstrap"), { adminCriado: true }, { merge: true });
}

/*
  Criar login pra um perfil que já existe — só admin chama isso. Usa uma
  SEGUNDA instância descartável do Firebase App só pra criar o usuário no
  Auth, sem derrubar a sessão do admin (createUserWithEmailAndPassword loga
  automaticamente como o usuário recém-criado NA INSTÂNCIA em que é
  chamado — por isso nunca usar a `auth` principal aqui). Não usa Cloud
  Functions nem Admin SDK — só o Web SDK duas vezes (ver arquitetura.md#segredos).
*/
export async function criarLoginParaPerfil(perfilId, email, senhaTemporaria) {
  const nomeInstancia = "secundaria-" + Date.now();
  const appSecundario = initializeApp(firebaseConfig, nomeInstancia);
  const authSecundario = getAuth(appSecundario);
  try {
    const cred = await createUserWithEmailAndPassword(authSecundario, email, senhaTemporaria);
    // O vínculo usa o `db` da instância PRINCIPAL (autenticada como admin) —
    // só a criação da conta em si usa a instância secundária.
    await setDoc(doc(db, "usuarios", cred.user.uid), { perfilId, email, createdAt: serverTimestamp() });
    return cred.user.uid;
  } finally {
    await signOut(authSecundario).catch(() => {});
    await deleteApp(appSecundario).catch(() => {});
  }
}

export async function atualizarPapeis(perfilId, papeis) {
  await updateDoc(doc(db, "perfis", perfilId), { papeis });
}
