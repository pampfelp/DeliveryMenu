/*
  Inicialização do Firestore — padrão consolidado (ver padroes/arquitetura.md).
  SDK modular via CDN gstatic, sem npm/bundler. O painel mantém cache
  persistente; o cardápio público usa memória para abrir também quando
  o navegador restringe o IndexedDB.

  A config abaixo (apiKey, projectId, etc.) NÃO é segredo — é a config
  pública do Firebase Web SDK, pode ir pro repositório/GitHub Pages sem
  problema. A segurança de verdade vive nas firestore.rules.
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentSingleTabManager,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

// Projeto cardapio-delivery-ae048, criado em 2026-10-15 na conta dele.
export const firebaseConfig = {
  apiKey: "AIzaSyCsY34ZT38ZjAkdNidqG45Nz4qPCVTamEs",
  authDomain: "cardapio-delivery-ae048.firebaseapp.com",
  projectId: "cardapio-delivery-ae048",
  storageBucket: "cardapio-delivery-ae048.firebasestorage.app",
  messagingSenderId: "308771638053",
  appId: "1:308771638053:web:b2076912a86188fbff68cc",
};

const app = initializeApp(firebaseConfig);

export const db = initializeFirestore(app, {
  localCache: /\/painel\.html$/.test(location.pathname)
    ? persistentLocalCache({ tabManager: persistentSingleTabManager() })
    : memoryLocalCache(),
});

// auth só é usado de fato se o projeto precisar de Firebase Auth real (ver
// decisoes.md #1 — sempre perguntar, nunca assumir). Exportar aqui não tem
// custo se o projeto não usar; ver boilerplate/js/auth.js quando usar.
export const auth = getAuth(app);

// Emulador local: abrir com ?emulator=1 na URL
if (new URLSearchParams(location.search).get("emulator") === "1") {
  connectFirestoreEmulator(db, "localhost", 8080);
  connectAuthEmulator(auth, "http://localhost:9099");
  console.log("[firebase-init] usando emulador local do Firestore + Auth");
}
