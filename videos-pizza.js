// Mídias publicadas da Casa Jambu, vinculadas aos ids conferidos no Firestore.
const SABORES = new Set([
  "mussarela", "frango", "mista", "calabresa", "portuguesa-especial",
  "palmito-especial", "suprema", "camarao-cremoso", "jambu-amazonico", "marajoara",
]);

export function videoDaPizza(lojaId, itemId) {
  return lojaId === "casa-jambu-delivery" && SABORES.has(itemId)
    ? `./midias/casa-jambu/${itemId}.mp4?v=1` : "";
}

const reduzirMovimento = matchMedia("(prefers-reduced-motion: reduce)");
let observados = new Set();
const automatico = () => !reduzirMovimento.matches && !navigator.connection?.saveData && !document.hidden;
const ativo = (video) => video.closest(".tela")?.classList.contains("ativa");
const observador = new IntersectionObserver((entradas) => {
  entradas.forEach(({ target: video, isIntersecting }) => {
    if (!isIntersecting || !ativo(video) || !automatico()) { video.pause(); return; }
    if (video.dataset.src && !video.getAttribute("src")) video.src = video.dataset.src;
    if (video.ended) video.currentTime = 0;
    video.play().catch(() => { /* autoplay bloqueado: a foto continua visível */ });
  });
}, { threshold: 0.4 });

export function sincronizarVideos() {
  observador.disconnect();
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
    }
    if (!video.hidden) observador.observe(video);
  });
  observados = atuais;
}

document.addEventListener("visibilitychange", sincronizarVideos);
reduzirMovimento.addEventListener("change", sincronizarVideos);
