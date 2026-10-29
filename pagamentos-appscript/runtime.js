import "core-js/actual/url/index.js";
import "core-js/actual/url-search-params/index.js";
import { criarHandler } from "../functions/pagamentos.js?v=1";
import { criarFirestoreRest, SERVER_TIMESTAMP } from "./firestore.js?v=1";
import { configurarAleatoriedade, verificarAppCheckJWT, tokenWebhook, verificarTokenWebhook } from "./seguranca.js?v=1";

const PROJETO = "cardapio-delivery-ae048", NUMERO = "308771638053";
const APP = "1:308771638053:web:b2076912a86188fbff68cc";
const FIREBASE_KEY = "AIzaSyCsY34ZT38ZjAkdNidqG45Nz4qPCVTamEs";
const FRONTEND = "https://pampfelp.github.io/DeliveryMenu/";
const props = () => PropertiesService.getScriptProperties();
const erro = (codigo, mensagem) => Object.assign(new Error(mensagem), { codigo });
const json = (v) => ContentService.createTextOutput(JSON.stringify(v)).setMimeType(ContentService.MimeType.JSON);
function requisicao(url, { method = "GET", body, headers = {} } = {}) {
  const r = UrlFetchApp.fetch(url, { method: method.toLowerCase(), headers,
    ...(body !== undefined ? { contentType: "application/json", payload: JSON.stringify(body) } : {}),
    muteHttpExceptions: true, followRedirects: false, validateHttpsCertificates: true });
  let dados;
  try { dados = JSON.parse(r.getContentText()); } catch { throw erro("SERVICO_INDISPONIVEL", "O serviço não respondeu corretamente. Tente novamente."); }
  if (r.getResponseCode() >= 300) throw Object.assign(erro("SERVICO_INDISPONIVEL", "O serviço não concluiu a operação. Tente novamente."), { status: r.getResponseCode(), code: dados?.error?.status });
  return dados;
}
function segredo() {
  const p = props(), tokensKey = p.getProperty("MP_TOKENS_KEY") || "";
  return { clientSecret: p.getProperty("MP_CLIENT_SECRET") || "", tokensKey,
    webhookSecret: p.getProperty("MP_WEBHOOK_SECRET") || tokensKey };
}
// HMAC com chave de 32 bytes gerada fora do script e contador persistente único.
// Nunca usa Math.random, relógio ou UUID como fonte do segredo.
function gerarBytes(n) {
  const key = segredo().tokensKey;
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key) || Utilities.base64Decode(key).length !== 32) throw erro("CONFIGURACAO", "Configure a chave de proteção dos pagamentos.");
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw erro("OCUPADO", "O serviço está ocupado. Tente novamente.");
  let sequencia;
  try {
    const p = props(), atual = Number(p.getProperty("RNG_SEQUENCIA") || "0");
    if (!Number.isSafeInteger(atual) || atual < 0 || atual >= Number.MAX_SAFE_INTEGER) throw erro("CONFIGURACAO", "Confira o contador de segurança do serviço.");
    sequencia = atual + 1; p.setProperty("RNG_SEQUENCIA", String(sequencia));
  } finally { lock.releaseLock(); }
  const entrada = `deliverymenu:rng:v1:${sequencia}:${Utilities.getUuid()}`;
  const bytes = Utilities.computeHmacSha256Signature(entrada, key);
  return bytes.slice(0, n).map((v) => v & 255);
}
function jwks() {
  const cache = CacheService.getScriptCache(), salvo = cache.get("APP_CHECK_JWKS");
  if (salvo) return JSON.parse(salvo);
  const keys = requisicao("https://firebaseappcheck.googleapis.com/v1/jwks");
  if (!Array.isArray(keys.keys)) throw erro("APP_CHECK", "Não foi possível verificar este acesso.");
  cache.put("APP_CHECK_JWKS", JSON.stringify(keys), 3600); return keys;
}
function conferirApp(token) {
  try { return verificarAppCheckJWT(token, { projectNumber: NUMERO, appId: APP, jwks: jwks() }); }
  catch { throw erro("APP_CHECK", "Não foi possível verificar este acesso. Reabra o cardápio."); }
}
function criarServico() {
  const p = props(), url = p.getProperty("PAGAMENTOS_URL") || ScriptApp.getService().getUrl();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url || "")) throw erro("CONFIGURACAO", "O serviço ainda não foi publicado.");
  if (p.getProperty("PAGAMENTOS_ATIVOS") === "true" && (!/^\d{1,30}$/.test(p.getProperty("MP_CLIENT_ID") || "") || !segredo().clientSecret || !segredo().tokensKey)) throw erro("CONFIGURACAO", "Configure as credenciais do serviço de pagamento.");
  configurarAleatoriedade(gerarBytes);
  const headersGoogle = () => ({ Authorization: `Bearer ${ScriptApp.getOAuthToken()}` });
  const db = criarFirestoreRest({ projectId: PROJETO, request: (u, op) => requisicao(u, { ...op, headers: headersGoogle() }) });
  const auth = {
    verifyIdToken(token) {
      if (typeof token !== "string" || !token || token.length > 20000) throw erro("NAO_AUTENTICADO", "Entre no painel.");
      const r = requisicao(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_KEY}`, { method: "POST", body: { idToken: token } });
      const u = r.users?.[0]; if (!u?.localId || u.disabled) throw erro("NAO_AUTENTICADO", "Entre novamente no painel.");
      return { uid: u.localId };
    },
    getUser(uid) {
      const r = requisicao(`https://identitytoolkit.googleapis.com/v1/projects/${PROJETO}/accounts:lookup`, { method: "POST", headers: headersGoogle(), body: { localId: [uid] } });
      const u = r.users?.[0]; if (!u || u.localId !== uid) throw erro("NAO_AUTENTICADO", "Entre novamente no painel.");
      return { uid, email: u.email || "", disabled: !!u.disabled };
    },
  };
  const callback = new URL(url); callback.searchParams.set("rota", "callback");
  const config = { ativos: p.getProperty("PAGAMENTOS_ATIVOS") === "true", clientId: p.getProperty("MP_CLIENT_ID") || "",
    frontend: FRONTEND, url, callbackURL: callback.href, emulador: false,
    webhookURL(lojaId, pedidoId) {
      const u = new URL(url); u.search = new URLSearchParams({ rota: "webhook", lojaId, pedidoId,
        wtoken: tokenWebhook(lojaId, pedidoId, segredo().webhookSecret) }).toString(); return u.href;
    },
    verificarWebhook(req) {
      const q = req.query || {};
      return /^[a-z0-9-]{3,40}$/.test(q.lojaId || "") && /^[a-zA-Z0-9_-]{20,80}$/.test(q.pedidoId || "")
        && verificarTokenWebhook(q.wtoken, q.lojaId, q.pedidoId, segredo().webhookSecret);
    },
  };
  const buscar = (u, op) => {
    if (!u.startsWith("https://api.mercadopago.com/")) throw erro("CONFIGURACAO", "Destino de pagamento inválido.");
    const r = UrlFetchApp.fetch(u, { method: (op.method || "GET").toLowerCase(), headers: op.headers,
      ...(op.body ? { contentType: "application/json", payload: op.body } : {}),
      muteHttpExceptions: true, followRedirects: false, validateHttpsCertificates: true });
    const status = r.getResponseCode();
    return { ok: status >= 200 && status < 300, status, json: () => JSON.parse(r.getContentText()) };
  };
  return criarHandler({ db, auth, appCheck: { verifyToken: conferirApp }, config, segredos: segredo, fetch: buscar, carimbo: () => SERVER_TIMESTAMP });
}
function resposta() {
  return { http: 200, corpo: null, destino: null,
    set() { return this; }, status(n) { this.http = n; return this; }, json(v) { this.corpo = v; return this; },
    end() { return this; }, redirect(n, destino) { this.http = n; this.destino = destino; return this; } };
}
function falhou(err) {
  return json({ ok: false, erro: { codigo: err.codigo || "ERRO_INTERNO", mensagem: err.codigo ? err.message : "Não foi possível concluir. Tente novamente." } });
}
export function receberPost(e) {
  try {
    const raw = e?.postData?.contents;
    if (typeof raw !== "string" || raw.length > 100000) throw erro("VALIDACAO", "Pedido inválido ou muito grande.");
    const v = JSON.parse(raw), q = e.parameter || {};
    if (!v || typeof v !== "object" || Array.isArray(v)) throw erro("VALIDACAO", "Pedido inválido.");
    const { rota: fornecida, token, appCheckToken, ...body } = v;
    const rota = q.rota === "webhook" ? "webhook" : fornecida;
    if (!["status", "conectar", "ativar", "pausar", "checkout", "consultar", "recusar", "webhook"].includes(rota)) throw erro("VALIDACAO", "Operação inválida.");
    if (rota === "webhook" && q.rota !== "webhook") throw erro("VALIDACAO", "Notificação inválida.");
    const res = resposta();
    criarServico()({ path: `/${rota}`, method: rota === "status" ? "GET" : "POST", rawBody: raw,
      body, query: rota === "status" ? { lojaId: body.lojaId } : q,
      headers: { ...(typeof token === "string" ? { authorization: `Bearer ${token}` } : {}),
        ...(typeof appCheckToken === "string" ? { "x-firebase-appcheck": appCheckToken } : {}) } }, res);
    if (!res.corpo) throw erro("ERRO_SERVICO", "O serviço não concluiu a operação.");
    return json(res.corpo);
  } catch (err) { return falhou(err); }
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function receberGet(e) {
  const q = e?.parameter || {};
  if (!q.rota) return json({ ok: true, data: { servico: "DeliveryMenu pagamentos", ativo: props().getProperty("PAGAMENTOS_ATIVOS") === "true" } });
  if (q.rota !== "callback") return json({ ok: false, erro: { codigo: "VALIDACAO", mensagem: "Operação inválida." } });
  let ok = false;
  try { const res = resposta(); criarServico()({ path: "/callback", method: "GET", query: q, body: {}, headers: {} }, res); ok = !!res.destino; }
  catch { /* Retorno não revela código, state, tokens nem erro do provedor. */ }
  const titulo = ok ? "Conta conectada" : "Não foi possível conectar a conta";
  const destino = `${FRONTEND}painel.html?pagamento=${ok ? "conectado" : "erro"}#configuracoes`;
  return HtmlService.createHtmlOutput(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title><body style="font-family:system-ui;background:#f3f4f6;color:#1f2937;padding:32px"><h1>${titulo}</h1><p>${ok ? "Pagamento online pausado. Volte ao painel para ativar após a conferência." : "Volte ao painel e tente conectar novamente."}</p><a target="_top" href="${esc(destino)}" style="display:inline-block;padding:14px 20px;background:#991b1b;color:white;border-radius:8px;text-decoration:none">Voltar ao painel</a></body>`);
}
export function reconciliar() {
  const resultados = criarServico().expirarPendentes({ consultarEmAberto: true });
  const pendentes = resultados.filter((r) => r.estado === "reconciliar").length;
  if (pendentes) console.warn(`pagamentos_reconciliacao_pendente:${pendentes}`);
  return resultados.length;
}
export function instalarRotina() {
  if (!ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === "reconciliarPagamentos")) {
    ScriptApp.newTrigger("reconciliarPagamentos").timeBased().everyMinutes(5).create();
  }
  return "Rotina configurada. Pagamento só inicia após configurar as propriedades e ativar as duas pontas.";
}
