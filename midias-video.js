const SABORES = new Set([
  "mussarela", "frango", "mista", "calabresa", "portuguesa-especial",
  "palmito-especial", "suprema", "camarao-cremoso", "jambu-amazonico", "marajoara",
]);
const carregados = new Map();

export function videoDoItem(lojaId, item) {
  const arquivo = item.videoArquivo;
  if (arquivo?.id && /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(arquivo.endpoint)) {
    const params = new URLSearchParams({ action: "video", lojaId, id: arquivo.id });
    return { url: `${arquivo.endpoint}?${params}`, remoto: true };
  }
  if (Object.prototype.hasOwnProperty.call(item, "videoUrl")) return { url: item.videoUrl || "", remoto: false };
  return { url: lojaId === "casa-jambu-delivery" && SABORES.has(item.id) ? `./midias/casa-jambu/${item.id}.mp4?v=1` : "", remoto: false };
}

// O Drive fica no serviço de upload. O navegador recebe o arquivo público
// apenas quando precisa reproduzir; cards repetidos compartilham o mesmo blob.
export async function carregarVideo(url, remoto = false) {
  if (!remoto || !url) return url;
  if (!carregados.has(url)) carregados.set(url, (async () => {
    const resposta = await fetch(url, { credentials: "omit" });
    const dados = await resposta.json();
    if (!resposta.ok || !dados.ok || !["video/mp4", "video/webm"].includes(dados.tipo) || !dados.base64) throw new Error("Vídeo indisponível.");
    const bytes = Uint8Array.from(atob(dados.base64), (c) => c.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: dados.tipo }));
  })().catch((erro) => { carregados.delete(url); throw erro; }));
  return carregados.get(url);
}
