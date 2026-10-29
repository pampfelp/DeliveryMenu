import "core-js/actual/url/index.js";
import "core-js/actual/url-search-params/index.js";
import { criarHandler } from "../functions/pagamentos.js?v=1";
import { criarFirestoreRest, SERVER_TIMESTAMP } from "./firestore.js?v=1";
import { configurarAleatoriedade, verificarAppCheckJWT, tokenWebhook, verificarTokenWebhook, cifrar, decifrar, aleatorio } from "./seguranca.js?v=1";

const PROJETO = "cardapio-delivery-ae048", NUMERO = "308771638053";
const APP = "1:308771638053:web:b2076912a86188fbff68cc";
const FIREBASE_KEY = "AIzaSyCsY34ZT38ZjAkdNidqG45Nz4qPCVTamEs";
const FRONTEND = "https://pampfelp.github.io/DeliveryMenu/";
const props = () => PropertiesService.getScriptProperties();
const headersGoogle = () => ({ Authorization: `Bearer ${ScriptApp.getOAuthToken()}`, "x-goog-user-project": PROJETO });
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
    if (!["status", "conectar", "ativar", "pausar", "desvincular", "checkout", "consultar", "recusar", "webhook"].includes(rota)) throw erro("VALIDACAO", "Operação inválida.");
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
export function prepararHomologacao() {
  try {
    configurarAleatoriedade(gerarBytes);
    const p = props(), origem = "casa-jambu-delivery", salvo = p.getProperty("HOMOLOGACAO_LOJA_ID");
    const id = salvo || `homologacao-${Utilities.getUuid().replace(/-/g, "").slice(0, 16).toLowerCase()}`;
    if (!/^homologacao-[a-f0-9]{16}$/.test(id)) throw erro("HOMOLOGACAO", "Identificação de homologação inválida.");
    const db = criarFirestoreRest({ projectId: PROJETO, request: (u, op) => requisicao(u, { ...op, headers: headersGoogle() }) });
    db.runTransaction((tx) => {
      const ler = (path) => tx.get(db.doc(path)).data();
      const loja = ler(`lojas/${origem}`), integracao = ler(`integracoesPagamento/${origem}`);
      if (typeof loja?.donoId !== "string" || !loja.donoId || loja.pagamentoOnline?.ativo !== false || integracao?.ativo !== false || !/^\d{1,30}$/.test(String(integracao?.contaId || ""))) throw erro("HOMOLOGACAO", "Confira a loja de origem pausada e conectada.");
      const contaId = String(integracao.contaId), conta = ler(`integracoesPagamento/${origem}/contas/${contaId}`);
      const conferirConta = (v, lojaId) => {
        if (v?.reconectar !== false || !(+new Date(v.expiresAt) > Date.now() + 30 * 60000)
          || +new Date(v.refreshAte || 0) > Date.now() || v.refreshLease) throw erro("HOMOLOGACAO", "Confira a validade da conexão antes do teste.");
        const tokens = decifrar(v.protegido, segredo().tokensKey, lojaId, contaId);
        if (typeof tokens.access_token !== "string" || !tokens.access_token || typeof tokens.refresh_token !== "string" || !tokens.refresh_token) throw erro("HOMOLOGACAO", "Conexão indisponível para o teste.");
        return tokens;
      };
      const tokens = conferirConta(conta, origem), destino = ler(`lojas/${id}`);
      const vinculo = ler(`integracoesPagamento/${id}`), privada = ler(`integracoesPagamento/${id}/contas/${contaId}`);
      const categoria = ler(`lojas/${id}/categorias/homologacao`), item = ler(`lojas/${id}/itens/pix-teste`);
      if (salvo) {
        if (destino?.homologacaoOrigem !== origem || destino.donoId !== loja.donoId || destino.slug !== id
          || destino.pagamentoOnline?.ativo !== true || destino.aberta !== true || destino.abrirSozinho !== false || vinculo?.contaId !== contaId || vinculo.ativo !== true
          || categoria?.nome !== "Homologação" || item?.preco !== 500 || item.categoriaId !== "homologacao" || item.esgotado !== false || !Array.isArray(item.grupos) || item.grupos.length) throw erro("HOMOLOGACAO", "A homologação existente precisa ser conferida.");
        conferirConta(privada, id);
        if (privada.renovacaoBloqueada !== true) tx.update(db.doc(`integracoesPagamento/${id}/contas/${contaId}`), { renovacaoBloqueada: true });
        return;
      }
      if (destino || vinculo || privada || categoria || item) throw erro("HOMOLOGACAO", "Destino de homologação já existe.");
      tx.create(db.doc(`lojas/${id}`), { donoId: loja.donoId, slug: id, nome: "Homologação Casa Jambu", homologacaoOrigem: origem,
        aberta: true, abrirSozinho: false, aceitaAgendamento: false, cor: "#991b1b", moeda: "BRL", pagamentoOnline: { ativo: true, provedor: "mercadopago" } });
      tx.create(db.doc(`lojas/${id}/categorias/homologacao`), { nome: "Homologação", ordem: 0 });
      tx.create(db.doc(`lojas/${id}/itens/pix-teste`), { categoriaId: "homologacao", nome: "Pix de teste", descricao: "Homologação de pagamento — R$ 5,00", preco: 500, esgotado: false, grupos: [], ordem: 0 });
      tx.create(db.doc(`integracoesPagamento/${id}`), { contaId, ativo: true });
      tx.create(db.doc(`integracoesPagamento/${id}/contas/${contaId}`), { protegido: cifrar(tokens, segredo().tokensKey, id, contaId),
        expiresAt: new Date(conta.expiresAt), versao: aleatorio(), reconectar: false, refreshAte: new Date(0), refreshLease: null, renovacaoBloqueada: true });
    });
    p.setProperty("HOMOLOGACAO_LOJA_ID", id);
    return { link: `${FRONTEND}index.html?loja=${id}`, valor: 500 };
  } catch { throw erro("HOMOLOGACAO", "Não foi possível preparar a loja isolada. Confira a origem pausada, a conexão e o destino do teste."); }
}
export function diagnosticarHomologacao() {
  const codigos = ["unauthorized", "forbidden", "bad_request", "not_found", "invalid_token", "invalid_grant", "internal_error", "service_unavailable",
    "CONFIGURACAO", "VALIDACAO", "PERMISSION_DENIED", "NOT_FOUND", "UNAUTHENTICATED", "RESOURCE_EXHAUSTED", "UNAVAILABLE"];
  const codigo = (v) => codigos.includes(v) ? v : "";
  try {
    const p = props(), lojaId = p.getProperty("HOMOLOGACAO_LOJA_ID");
    if (!/^homologacao-[a-f0-9]{16}$/.test(lojaId || "")) return { http: 0, codigo: "CONFIGURACAO" };
    const db = criarFirestoreRest({ projectId: PROJETO, request: (u, op) => requisicao(u, { ...op, headers: headersGoogle() }) });
    const consultas = db.collection("transacoesPagamento").where("lojaId", "==", lojaId).limit(5).get();
    const texto = (v) => typeof v === "string" && /^[a-z_]{1,80}$/.test(v) ? v : "";
    const pedidos = consultas.docs.map((doc) => {
      try {
        const t = doc.data();
        if (t.lojaId !== lojaId || t.pedidoId !== doc.id || !/^[a-zA-Z0-9_-]{20,80}$/.test(doc.id) || t.pedido?.total !== 500
          || !/^\d{1,30}$/.test(String(t.contaId || "")) || !/^[a-zA-Z0-9_-]{1,160}$/.test(t.preferenceId || "")) return { http: 0, codigo: "VALIDACAO" };
        const conta = db.doc(`integracoesPagamento/${lojaId}/contas/${t.contaId}`).get().data();
        const tokens = decifrar(conta?.protegido, p.getProperty("MP_TOKENS_KEY"), lojaId, t.contaId);
        if (typeof tokens.access_token !== "string" || !tokens.access_token) return { http: 0, codigo: "CONFIGURACAO" };
        const buscar = (path, resumir) => {
          let http = 0;
          try {
            const resposta = UrlFetchApp.fetch(`https://api.mercadopago.com${path}`, { method: "get", headers: { Authorization: `Bearer ${tokens.access_token}` },
              followRedirects: false, muteHttpExceptions: true, validateHttpsCertificates: true });
            const status = resposta.getResponseCode(); http = Number.isInteger(status) ? status : 0;
            const dados = JSON.parse(resposta.getContentText());
            if (http < 200 || http >= 300) return { http, codigo: codigo(dados.error) };
            return { http, ...resumir(dados) };
          } catch { return { http, codigo: "" }; }
        };
        const referencia = `${lojaId}:${doc.id}`;
        const pagamentos = buscar(`/v1/payments/search?external_reference=${encodeURIComponent(referencia)}`, (dados) => {
          if (!Array.isArray(dados.results)) return { codigo: "VALIDACAO" };
          return { count: dados.results.length, resultados: dados.results.map((v) => ({ status: texto(v.status), status_detail: texto(v.status_detail),
            totalCorreto: Number.isFinite(Number(v.transaction_amount)) && Math.round(Number(v.transaction_amount) * 100) === 500,
            recebedorCorreto: String(v.collector_id) === String(t.contaId), referenciaCorreta: v.external_reference === referencia,
            ...(typeof v.live_mode === "boolean" ? { live_mode: v.live_mode } : {}) })) };
        });
        const preferencia = buscar(`/checkout/preferences/${encodeURIComponent(t.preferenceId)}`, (v) => ({
          ...(typeof v.active === "boolean" ? { active: v.active } : {}), ...(typeof v.expires === "boolean" ? { expires: v.expires } : {}),
          expiracaoIgual: Number.isFinite(+new Date(v.expiration_date_to)) && +new Date(v.expiration_date_to) === +new Date(t.expiresAt),
          referenciaCorreta: v.external_reference === referencia, recebedorCorreto: String(v.collector_id) === String(t.contaId),
          totalCorreto: Array.isArray(v.items) && Math.round(v.items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0) * 100) === 500,
          ...(typeof v.live_mode === "boolean" ? { live_mode: v.live_mode } : {}) }));
        return { estado: texto(t.estado), expirou: !(+new Date(t.expiresAt) > Date.now()), pagamentos, preferencia };
      } catch (err) { return { http: Number.isInteger(err?.status) ? err.status : 0, codigo: codigo(err?.code) }; }
    });
    return { count: pedidos.length, pedidos };
  } catch (err) { return { http: Number.isInteger(err?.status) ? err.status : 0, codigo: codigo(err?.code) }; }
}
export function diagnosticar() {
  return [
    ["firestore", `https://firestore.googleapis.com/v1/projects/${PROJETO}/databases/(default)/documents/lojas/casa-jambu-delivery`],
    ["auth", `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJETO}/config`],
  ].map(([servico, url]) => {
    let http = 0;
    const resultado = () => ({ servico, http, codigo: "", motivo: "", api: "", projetoCorreto: false });
    try {
      const resposta = UrlFetchApp.fetch(url, { method: "get", headers: headersGoogle(),
        followRedirects: false, muteHttpExceptions: true, validateHttpsCertificates: true });
      const status = resposta.getResponseCode();
      http = Number.isInteger(status) ? status : 0;
      if (http >= 200 && http < 300) return { servico, http };
      const dados = JSON.parse(resposta.getContentText()), falha = dados?.error;
      const detalhe = Array.isArray(falha?.details) ? falha.details.find((d) => d?.["@type"] === "type.googleapis.com/google.rpc.ErrorInfo") : null;
      const campo = (valor) => typeof valor === "string" && /^[A-Z][A-Z_]{0,79}$/.test(valor) ? valor : "";
      return { ...resultado(), codigo: campo(falha?.status), motivo: campo(detalhe?.reason),
        api: ["firestore.googleapis.com", "identitytoolkit.googleapis.com"].includes(detalhe?.metadata?.service) ? detalhe.metadata.service : "",
        projetoCorreto: detalhe?.metadata?.consumer === `projects/${NUMERO}` };
    } catch { return resultado(); }
  });
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
