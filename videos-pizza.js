import { carregarVideo } from "./midias-video.js?v=2";

const reduzirMovimento = matchMedia("(prefers-reduced-motion: reduce)");
let observados = new Set();
let visiveis = new WeakSet();
const automatico = () => !reduzirMovimento.matches && !navigator.connection?.saveData && !document.hidden;
const ativo = (video) => video.closest(".tela")?.classList.contains("ativa");
async function preparar(video) {
  if (video.dataset.src && !video.getAttribute("src")) {
    const src = await carregarVideo(video.dataset.src, video.hasAttribute("data-video-remoto"));
    if (video.isConnected) video.src = src;
  }
}
const observador = new IntersectionObserver((entradas) => {
  entradas.forEach(async ({ target: video, isIntersecting }) => {
    if (isIntersecting) visiveis.add(video); else visiveis.delete(video);
    if (!isIntersecting || !ativo(video) || !automatico() || video.dataset.pausado === "true") { video.pause(); return; }
    try { await preparar(video); } catch { if (video.isConnected) video.dispatchEvent(new Event("error")); return; }
    if (!video.isConnected || !visiveis.has(video) || !ativo(video) || !automatico() || video.dataset.pausado === "true") return;
    if (video.ended) video.currentTime = 0;
    video.play().catch(() => { /* autoplay bloqueado: a foto continua visível */ });
  });
}, { threshold: 0.4 });

export function sincronizarVideos() {
  observador.disconnect();
  visiveis = new WeakSet();
  const atuais = new Set(document.querySelectorAll("video[data-video-pizza]"));
  observados.forEach((video) => {
    if (!atuais.has(video)) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } else if (!ativo(video) || !automatico()) video.pause();
  });
  atuais.forEach((video) => {
    if (!observados.has(video)) {
      video.muted = true;
      video.addEventListener("playing", () => video.parentElement.classList.add("video-pronto"));
      video.addEventListener("error", () => {
        video.parentElement.classList.remove("video-pronto");
        video.hidden = true;
      });
      // Abrir o produto permite carregar seu arquivo também para reprodução manual.
      if (video.hasAttribute("data-video-detalhe")) preparar(video).catch(() => video.dispatchEvent(new Event("error")));
    }
    if (!video.hidden) observador.observe(video);
  });
  observados = atuais;
}

document.addEventListener("visibilitychange", sincronizarVideos);
if (reduzirMovimento.addEventListener) reduzirMovimento.addEventListener("change", sincronizarVideos);
else reduzirMovimento.addListener(sincronizarVideos);
