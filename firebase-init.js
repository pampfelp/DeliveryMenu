/*
  Inicialização do Firestore — padrão consolidado (ver padroes/arquitetura.md).
  SDK modular via CDN gstatic, sem npm/bundler. Persistência offline ligada
  por padrão (persistentLocalCache) — se o projeto não precisar funcionar
  sem sinal, isso não atrapalha, só não é usado.

  A config abaixo (apiKey, projectId, etc.) NÃO é segredo — é a config
  pública do Firebase Web SDK, pode ir pro repositório/GitHub Pages sem
  problema. A segurança de verdade vive nas firestore.rules.
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

export const firebaseConfig = {
  apiKey: "COLE_AQUI",
  authDomain: "SEU-PROJETO.firebaseapp.com",
  projectId: "SEU-PROJETO",
  storageBucket: "SEU-PROJETO.appspot.com",
  messagingSenderId: "COLE_AQUI",
  appId: "COLE_AQUI",
};

const app = initializeApp(firebaseConfig);

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
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
