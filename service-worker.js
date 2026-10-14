/*
  Service worker padrão — ver padroes/pwa-checklist.md
  Network-first com fallback pro cache. Cacheia só o "esqueleto" estático,
  NUNCA as chamadas de API (Firestore/Apps Script) — essas precisam estar
  sempre frescas, e o próprio SDK do Firestore já cuida da persistência de
  dados offline (ver firebase-init.js).
*/

// Vários apps dele dividem a origem pampfelp.github.io. O Cache Storage é POR
// ORIGEM, então o nome do cache tem PREFIXO PRÓPRIO do app (troque "app-") e o
// activate só apaga o que começa com ele. Apagar "tudo que não é o meu"
// derruba o cache offline dos outros apps (pwa-checklist.md, 2026-09-10).
const PREFIXO = "app-";
const CACHE_NAME = PREFIXO + "shell-v1"; // bump manual a cada mudança relevante de assets
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./shared.js",
  "./manifest.json",
];

self.addEventListener("install", (e) => {
  // { cache: "reload" } por arquivo, não caches.addAll(SHELL) puro — evita
  // que o cache HTTP comum do navegador (camada diferente do Cache Storage
  // do SW) sirva JS/CSS desatualizado mesmo com o SW novo já instalado
  // (achado real, Sistema IEQ Tapajós, 2026-08-24 — ver pwa-checklist.md).
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(SHELL.map((url) => fetch(url, { cache: "reload" }).then((res) => cache.put(url, res))))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIXO) && k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = e.request.url;

  // Nunca cachear chamadas de API/tempo real — sempre precisam de dado fresco.
  const isApiCall =
    url.includes("googleapis.com") || // Firestore
    url.includes("script.google.com") || // Apps Script (upload/proxy)
    url.includes("gstatic.com/firebasejs"); // SDK — deixa o navegador cachear via HTTP normal

  if (e.request.method !== "GET" || isApiCall) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        return res;
      })
      // abre o próprio cache: caches.match() solto procura no de todos os apps da origem
      .catch(() => caches.open(CACHE_NAME).then((c) => c.match(e.request, { ignoreSearch: true })))
  );
});
