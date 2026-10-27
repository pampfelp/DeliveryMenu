import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256 = (v) => createHash("sha256").update(v).digest("hex");
export const aleatorio = () => randomBytes(32).toString("base64url");
export const desafioPKCE = (v) => createHash("sha256").update(v).digest("base64url");
export function canonico(v) {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
function chaveAES(chave) {
  const bytes = Buffer.from(chave || "", "base64");
  if (bytes.length !== 32) throw new Error("Chave de proteção inválida.");
  return bytes;
}
export function cifrar(dados, chave, lojaId, contaId) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", chaveAES(chave), iv);
  c.setAAD(Buffer.from(`${lojaId}:${contaId}`));
  const texto = Buffer.concat([c.update(JSON.stringify(dados), "utf8"), c.final()]).toString("base64");
  return { iv: iv.toString("base64"), texto, tag: c.getAuthTag().toString("base64") };
}
export function decifrar(dados, chave, lojaId, contaId) {
  const c = createDecipheriv("aes-256-gcm", chaveAES(chave), Buffer.from(dados.iv, "base64"));
  c.setAAD(Buffer.from(`${lojaId}:${contaId}`)); c.setAuthTag(Buffer.from(dados.tag, "base64"));
  return JSON.parse(Buffer.concat([c.update(Buffer.from(dados.texto, "base64")), c.final()]).toString("utf8"));
}
export function assinaturaWebhook({ assinatura, requestId, dataId, segredo, agora = Date.now() }) {
  if (typeof assinatura !== "string" || typeof requestId !== "string" || !requestId || requestId.length > 200
    || typeof dataId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(dataId) || !segredo) return false;
  const partes = assinatura.split(",").map((p) => p.trim().split("="));
  const ts = partes.filter(([k]) => k === "ts"), hashes = partes.filter(([k]) => k === "v1");
  if (ts.length !== 1 || hashes.length !== 1 || !/^\d{10,13}$/.test(ts[0][1]) || !/^[a-f0-9]{64}$/i.test(hashes[0][1])) return false;
  const instante = Number(ts[0][1]) * (ts[0][1].length <= 10 ? 1000 : 1);
  if (Math.abs(agora - instante) > 5 * 60000) return false;
  const esperado = createHmac("sha256", segredo).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts[0][1]};`).digest();
  return timingSafeEqual(esperado, Buffer.from(hashes[0][1], "hex"));
}
