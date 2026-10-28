import forge from "node-forge";

let fonteAleatoria;
export function configurarAleatoriedade(fnBytes) {
  if (typeof fnBytes !== "function") throw new Error("Informe uma fonte segura de bytes aleatórios.");
  fonteAleatoria = fnBytes;
}
function bytesAleatorios(n) {
  if (!fonteAleatoria) throw new Error("A fonte segura de aleatoriedade não foi configurada.");
  const valor = fonteAleatoria(n);
  if (typeof valor === "string") {
    if (valor.length !== n || [...valor].some((c) => c.charCodeAt(0) > 255)) throw new Error("A fonte de aleatoriedade retornou bytes inválidos.");
    return valor;
  }
  if (!(valor instanceof Uint8Array) && !Array.isArray(valor)) throw new Error("A fonte de aleatoriedade não retornou bytes.");
  if (valor.length !== n || [...valor].some((b) => !Number.isInteger(b) || b < 0 || b > 255)) throw new Error("A fonte de aleatoriedade retornou bytes inválidos.");
  return Array.from(valor, (b) => String.fromCharCode(b)).join("");
}
const utf8 = (v) => { if (typeof v !== "string") throw new Error("Texto inválido."); return forge.util.encodeUtf8(v); };
const base64url = (v) => forge.util.encode64(v).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function lerBase64(v) {
  if (typeof v !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v)) throw new Error("Base64 inválida.");
  const bytes = forge.util.decode64(v);
  if (forge.util.encode64(bytes) !== v) throw new Error("Base64 não canônica.");
  return bytes;
}
function lerBase64url(v) {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]+$/.test(v) || v.length % 4 === 1) throw new Error("Base64url inválida.");
  const bytes = forge.util.decode64(v.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - v.length % 4) % 4));
  if (base64url(bytes) !== v) throw new Error("Base64url não canônica.");
  return bytes;
}
function jsonSeguro(texto) {
  return JSON.parse(texto, (k, v) => {
    if (["__proto__", "prototype", "constructor"].includes(k)) throw new Error("Campo JSON não permitido.");
    return v;
  });
}
const objeto = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function chaveAES(chave) {
  const bytes = lerBase64(chave);
  if (bytes.length !== 32) throw new Error("Chave de proteção inválida.");
  return bytes;
}
export const sha256 = (v) => forge.md.sha256.create().update(utf8(v)).digest().toHex();
export const desafioPKCE = (v) => base64url(forge.md.sha256.create().update(utf8(v)).digest().getBytes());
export const aleatorio = () => base64url(bytesAleatorios(32));
export function canonico(v) {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export function cifrar(dados, chave, lojaId, contaId) {
  const key = chaveAES(chave), iv = bytesAleatorios(12), cipher = forge.cipher.createCipher("AES-GCM", key);
  cipher.start({ iv, additionalData: utf8(`${lojaId}:${contaId}`), tagLength: 128 });
  cipher.update(forge.util.createBuffer(utf8(JSON.stringify(dados))));
  if (!cipher.finish()) throw new Error("Não foi possível proteger os tokens.");
  return { iv: forge.util.encode64(iv), texto: forge.util.encode64(cipher.output.getBytes()), tag: forge.util.encode64(cipher.mode.tag.getBytes()) };
}
export function decifrar(dados, chave, lojaId, contaId) {
  if (!objeto(dados)) throw new Error("Tokens protegidos inválidos.");
  const key = chaveAES(chave), iv = lerBase64(dados.iv), texto = lerBase64(dados.texto), tag = lerBase64(dados.tag);
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Tokens protegidos inválidos.");
  const cipher = forge.cipher.createDecipher("AES-GCM", key);
  cipher.start({ iv, additionalData: utf8(`${lojaId}:${contaId}`), tagLength: 128, tag: forge.util.createBuffer(tag) });
  cipher.update(forge.util.createBuffer(texto));
  if (!cipher.finish()) throw new Error("Não foi possível conferir os tokens protegidos.");
  return jsonSeguro(forge.util.decodeUtf8(cipher.output.getBytes()));
}
export function verificarAppCheckJWT(token, { projectNumber, appId, jwks, agora = Date.now() }) {
  if (typeof token !== "string" || token.length > 20000) throw new Error("App Check inválido.");
  const partes = token.split(".");
  if (partes.length !== 3) throw new Error("App Check inválido.");
  const header = jsonSeguro(forge.util.decodeUtf8(lerBase64url(partes[0]))), payload = jsonSeguro(forge.util.decodeUtf8(lerBase64url(partes[1])));
  const assinatura = lerBase64url(partes[2]);
  if (!objeto(header) || header.alg !== "RS256" || header.typ !== "JWT" || typeof header.kid !== "string" || !header.kid || header.kid.length > 200 || !objeto(payload)) throw new Error("App Check inválido.");
  const projeto = String(projectNumber), momento = agora / 1000;
  const audiencias = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!/^\d+$/.test(projeto) || typeof appId !== "string" || !appId || !Number.isFinite(momento)
    || payload.iss !== `https://firebaseappcheck.googleapis.com/${projeto}` || !audiencias.includes(`projects/${projeto}`) || payload.sub !== appId
    || !Number.isFinite(payload.exp) || payload.exp <= momento || !Number.isFinite(payload.iat) || payload.iat < 0 || payload.iat > momento + 60 || payload.iat >= payload.exp) throw new Error("App Check expirado ou de outro aplicativo.");
  const chaves = Array.isArray(jwks) ? jwks : jwks?.keys;
  if (!Array.isArray(chaves)) throw new Error("Chaves do App Check indisponíveis.");
  const candidatas = chaves.filter((k) => k.kid === header.kid && k.kty === "RSA" && (k.use === undefined || k.use === "sig") && (k.alg === undefined || k.alg === "RS256"));
  if (candidatas.length !== 1) throw new Error("Chave do App Check não encontrada.");
  const jwk = candidatas[0], n = lerBase64url(jwk.n), e = lerBase64url(jwk.e);
  const BigInteger = forge.jsbn.BigInteger;
  const key = forge.pki.rsa.setPublicKey(new BigInteger(forge.util.bytesToHex(n), 16), new BigInteger(forge.util.bytesToHex(e), 16));
  const digest = forge.md.sha256.create().update(utf8(`${partes[0]}.${partes[1]}`)).digest().getBytes();
  if (!key.verify(digest, assinatura)) throw new Error("Assinatura do App Check inválida.");
  return payload;
}
export function tokenWebhook(lojaId, pedidoId, segredo) {
  if (typeof segredo !== "string" || !segredo) throw new Error("Segredo do webhook não configurado.");
  const hmac = forge.hmac.create();
  hmac.start("sha256", utf8(segredo)); hmac.update(utf8(`webhook:v1:${lojaId}:${pedidoId}`));
  return base64url(hmac.digest().getBytes());
}
export function verificarTokenWebhook(token, lojaId, pedidoId, segredo) {
  if (typeof token !== "string") return false;
  const esperado = tokenWebhook(lojaId, pedidoId, segredo);
  let diferenca = esperado.length ^ token.length;
  for (let n = 0; n < esperado.length; n++) diferenca |= esperado.charCodeAt(n) ^ (token.charCodeAt(n) || 0);
  return diferenca === 0;
}
// Apps Script não fornece os cabeçalhos necessários para validar x-signature.
export const assinaturaWebhook = () => false;
