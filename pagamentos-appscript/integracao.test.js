// Backend compilado + Firestore Emulator real; provedor e autenticação simulados.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID, generateKeyPairSync, sign, createHmac } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && host !== "127.0.0.1:8080") throw Error("Somente o emulador local é permitido.");
test("bundle síncrono: OAuth, checkout, webhook verificado e estorno no Firestore real local", { skip: !host }, async (t) => {
  const loja = `script-test-${randomUUID().slice(0, 12)}`, pedidoId = randomUUID();
  const app = initializeApp({ projectId: "cardapio-delivery-ae048" }, loja), db = getFirestore(app);
  t.after(async () => {
    await db.recursiveDelete(db.doc(`lojas/${loja}`)); await db.recursiveDelete(db.doc(`integracoesPagamento/${loja}`));
    await db.doc(`transacoesPagamento/${pedidoId}`).delete();
    const estados = await db.collection("oauthPagamento").where("lojaId", "==", loja).get();
    await Promise.all(estados.docs.map((d) => d.ref.delete())); await db.terminate(); await deleteApp(app);
  });
  await db.doc(`lojas/${loja}`).set({ donoId: "dono-script", nome: "Restaurante de teste", bairro: "Centro", aberta: true });
  await db.doc(`lojas/${loja}/itens/pizza`).set({ nome: "Pizza", preco: 5000, grupos: [] });
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "chave-local", alg: "RS256", use: "sig" };
  const tempo = Math.floor(Date.now() / 1000), b64 = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const entrada = `${b64({ alg: "RS256", typ: "JWT", kid: jwk.kid })}.${b64({ iss: "https://firebaseappcheck.googleapis.com/308771638053", aud: ["projects/308771638053"], sub: "1:308771638053:web:b2076912a86188fbff68cc", iat: tempo - 1, exp: tempo + 3600 })}`;
  const appToken = `${entrada}.${sign("RSA-SHA256", Buffer.from(entrada), privateKey).toString("base64url")}`;
  const dados = new Map(Object.entries({ PAGAMENTOS_ATIVOS: "true", PAGAMENTOS_URL: "https://script.google.com/macros/s/teste-local/exec", MP_CLIENT_ID: "999", MP_CLIENT_SECRET: "segredo-simulado", MP_TOKENS_KEY: randomBytes(32).toString("base64") }));
  const chamadas = [], cache = new Map(); let pagamento = null;
  const resposta = (v, status = 200) => ({ getContentText: () => JSON.stringify(v), getResponseCode: () => status });
  const contexto = vm.createContext({ console: { warn() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => dados.get(k) ?? null, setProperty: (k, v) => dados.set(k, v) }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) || null, put: (k, v) => cache.set(k, v) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { base64Decode: (s) => [...Buffer.from(s, "base64")], getUuid: randomUUID,
      computeHmacSha256Signature: (s, k) => [...createHmac("sha256", k).update(s).digest()] },
    ScriptApp: { getOAuthToken: () => "oauth-do-backend", getService: () => ({ getUrl: () => dados.get("PAGAMENTOS_URL") }) },
    ContentService: { MimeType: { JSON: "JSON" }, createTextOutput: (s) => ({ texto: s, setMimeType() { return this; } }) },
    HtmlService: { createHtmlOutput: (s) => ({ html: s }) },
    UrlFetchApp: { fetch(url, op = {}) {
      const body = op.payload ? JSON.parse(op.payload) : null; chamadas.push({ url, op, body });
      if (url === "https://firebaseappcheck.googleapis.com/v1/jwks") return resposta({ keys: [jwk] });
      if (url.startsWith("https://firestore.googleapis.com/v1/projects/cardapio-delivery-ae048/")) {
        assert.equal(op.headers.Authorization, "Bearer oauth-do-backend");
        const local = url.replace("https://firestore.googleapis.com", `http://${host}`);
        const args = ["--silent", "--show-error", "--max-time", "10", "-X", (op.method || "GET").toUpperCase(), "-H", "Authorization: Bearer owner", "-H", "Content-Type: application/json", "-w", "\n%{http_code}", local];
        if (op.payload) args.push("--data-binary", "@-");
        const s = execFileSync("curl.exe", args, { input: op.payload || "", encoding: "utf8", windowsHide: true });
        const pos = s.lastIndexOf("\n"), status = Number(s.slice(pos + 1));
        return { getContentText: () => s.slice(0, pos), getResponseCode: () => status };
      }
      if (url.startsWith("https://identitytoolkit.googleapis.com/")) {
        if (url.includes("/projects/")) { assert.equal(op.headers.Authorization, "Bearer oauth-do-backend"); return resposta({ users: [{ localId: "dono-script", email: "dono@exemplo.test" }] }); }
        return body.idToken === "sessao-dono" ? resposta({ users: [{ localId: "dono-script" }] }) : resposta({ error: { message: "token inválido" } }, 401);
      }
      if (url === "https://api.mercadopago.com/oauth/token") return resposta({ access_token: "token-vendedor", refresh_token: "renovacao-vendedor", expires_in: 3600, user_id: 123 });
      if (url === "https://api.mercadopago.com/users/me") return resposta({ id: 123 });
      if (url === "https://api.mercadopago.com/checkout/preferences") return resposta({ id: "pref-local", init_point: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=local" });
      if (url.includes("/v1/payments/search?")) return resposta({ results: pagamento ? [{ id: 987, status: pagamento.status }] : [] });
      if (url === "https://api.mercadopago.com/v1/payments/987/refunds") { pagamento.status = "refunded"; return resposta({ id: 555, payment_id: 987, amount: 50, status: "approved" }); }
      if (url === "https://api.mercadopago.com/v1/payments/987") return resposta(pagamento);
      throw Error(`Rede não permitida no teste: ${new URL(url).host}`);
    } },
  });
  vm.runInContext(await readFile(new URL("./publicar/Code.gs", import.meta.url), "utf8"), contexto, { timeout: 10000 });
  const post = (v, q = {}) => {
    const r = contexto.doPost({ postData: { contents: JSON.stringify(v) }, parameter: q });
    assert.equal(typeof r?.then, "undefined", "doPost precisa devolver resposta síncrona"); return JSON.parse(r.texto);
  };
  const conectado = post({ rota: "conectar", lojaId: loja, token: "sessao-dono" });
  assert.equal(conectado.ok, true, JSON.stringify(conectado));
  const u = new URL(conectado.data.url), state = u.searchParams.get("state");
  assert.equal(u.searchParams.get("redirect_uri"), `${dados.get("PAGAMENTOS_URL")}?rota=callback`);
  const callback = contexto.doGet({ parameter: { rota: "callback", code: "code-local", state } });
  assert.match(callback.html, /Conta conectada/); assert.doesNotMatch(callback.html, /token-vendedor|code-local/);
  assert.equal((await db.doc(`lojas/${loja}`).get()).data().pagamentoOnline.ativo, true);
  assert.match(contexto.doGet({ parameter: { rota: "callback", code: "code-local", state } }).html, /Não foi possível/);
  const pedido = { cliente: { nome: "Pessoa de teste", telefone: ["91", "90000", "0000"].join("") }, tipo: "retirada", itens: [{ itemId: "pizza", qtd: 1, escolhas: {} }], subtotal: 5000, total: 5000 };
  const iniciado = post({ rota: "checkout", lojaId: loja, pedidoId, pedido, appCheckToken: appToken });
  assert.equal(iniciado.ok, true, JSON.stringify(iniciado)); assert.equal(iniciado.data.estado, "aguardando");
  assert.equal((await db.doc(`lojas/${loja}/pedidosEntrada/${pedidoId}`).get()).exists, false);
  const preferencia = chamadas.find((r) => r.url.endsWith("/checkout/preferences"));
  const aviso = new URL(preferencia.body.notification_url), q = Object.fromEntries(aviso.searchParams);
  assert.equal(q.rota, "webhook"); assert.ok(q.wtoken); assert.equal(q.pedidoId, pedidoId);
  const publico = (await db.doc(`lojas/${loja}/pagamentosPedidos/${pedidoId}`).get()).data();
  assert.equal(JSON.stringify(publico).includes(q.wtoken), false);
  pagamento = { id: 987, collector_id: 123, transaction_amount: 50, currency_id: "BRL", status: "approved", date_approved: new Date().toISOString(), external_reference: `${loja}:${pedidoId}`, metadata: { loja_id: loja, pedido_id: pedidoId } };
  const corpoAviso = { type: "payment", data: { id: 987 } }, params = { ...q, "data.id": "987" };
  assert.equal(post(corpoAviso, { ...params, wtoken: "adulterado" }).ok, false);
  assert.equal((await db.doc(`lojas/${loja}/pedidosEntrada/${pedidoId}`).get()).exists, false);
  assert.equal(contexto.reconciliarPagamentos(), 1, "a rotina consulta pendências ainda dentro do prazo");
  assert.equal((await db.doc(`lojas/${loja}/pedidosEntrada/${pedidoId}`).get()).data().pagamento.pago, true);
  assert.equal(post(corpoAviso, params).ok, true);
  assert.equal((await db.doc(`lojas/${loja}/pedidosEntrada/${pedidoId}`).get()).data().pagamento.pago, true);
  assert.equal(post(corpoAviso, params).ok, true);
  const recusado = post({ rota: "recusar", lojaId: loja, pedidoId, token: "sessao-dono" });
  assert.equal(recusado.ok, true, JSON.stringify(recusado));
  const final = (await db.doc(`lojas/${loja}/pedidos/${pedidoId}`).get()).data();
  assert.equal(final.status, "cancelado"); assert.equal(final.pagamento.reembolsado, true);
  assert.equal((await db.doc(`lojas/${loja}/pedidosEntrada/${pedidoId}`).get()).exists, false);
});
