import { auth } from "./firebase-init.js?v=3";
import { MIDIAS_ENDPOINT } from "./midias-config.js?v=1";

export const MAX_VIDEO = 10 * 1024 * 1024;
export function validarVideo(arquivo) {
  if (!["video/mp4", "video/webm"].includes(arquivo.type)) throw new Error("Escolha um vídeo MP4 ou WebM.");
  if (!arquivo.size || arquivo.size > MAX_VIDEO) throw new Error("O vídeo precisa ter até 10 MB.");
}

export async function enviarVideo(arquivo, lojaId) {
  validarVideo(arquivo);
  if (!MIDIAS_ENDPOINT) throw new Error("O serviço de envio de vídeos ainda não foi ativado.");
  const usuario = auth.currentUser;
  if (!usuario) throw new Error("Entre novamente para enviar o vídeo.");
  const base64 = await new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result.split(",")[1]);
    leitor.onerror = () => reject(new Error("Não deu para abrir o vídeo."));
    leitor.readAsDataURL(arquivo);
  });
  if (auth.currentUser !== usuario) throw new Error("Sua sessão mudou. Entre novamente para enviar o vídeo.");
  const resposta = await fetch(MIDIAS_ENDPOINT, {
    method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "uploadVideo", lojaId, token: await usuario.getIdToken(), base64, nome: arquivo.name, tipo: arquivo.type }),
  });
  const dados = await resposta.json();
  if (!resposta.ok || !dados.ok || !dados.id) throw new Error(dados.erro || "Não deu para enviar. Tente novamente.");
  return { id: dados.id, endpoint: MIDIAS_ENDPOINT, nome: arquivo.name, tipo: arquivo.type, tamanho: arquivo.size };
}
