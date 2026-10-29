import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { criarHandler, validarPagamento } from "./pagamentos.js?v=1";
import { assinaturaWebhook, canonico, cifrar, decifrar, desafioPKCE, sha256 } from "./seguranca.js?v=1";

const chave = Buffer.alloc(32, 7).toString("base64");
const segredos = { clientSecret: "somente-simulado", webhookSecret: "assinatura-somente-simulada", tokensKey: chave };
const instante = new Date("2026-10-27T21:00:00Z");
const assinar = (id, ts = String(Math.floor(+instante / 1000)), requestId = "notificacao-simulada") => ({
  "x-request-id": requestId,
  "x-signature": `ts=${ts},v1=${createHmac("sha256", segredos.webhookSecret).update(`id:${id.toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex")}`,
});
const contextoAssinatura = (id, h = assinar(id)) => ({ assinatura: h["x-signature"], requestId: h["x-request-id"], dataId: id, segredo: segredos.webhookSecret, agora: +instante });

test("AES autentica a loja e a conta como AAD", () => {
  const protegido = cifrar({ access_token: "simulado", refresh_token: "renovacao" }, chave, "loja-teste", "123");
  assert.equal(decifrar(protegido, chave, "loja-teste", "123").access_token, "simulado");
  assert.throws(() => decifrar(protegido, chave, "outra-loja", "123"));
  assert.throws(() => decifrar(protegido, chave, "loja-teste", "456"));
  assert.throws(() => decifrar({ ...protegido, tag: Buffer.alloc(16).toString("base64") }, chave, "loja-teste", "123"));
  assert.equal(JSON.stringify(protegido).includes("simulado"), false);
});
test("PKCE segue o vetor S256 do RFC7636", () => assert.equal(desafioPKCE("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"));
test("fingerprint independe da ordem dos campos", () => assert.equal(sha256(canonico({ b: 1, a: { y: 2, x: 3 } })), sha256(canonico({ a: { x: 3, y: 2 }, b: 1 }))));
test("webhook aceita assinatura válida e normaliza id", () => assert.equal(assinaturaWebhook(contextoAssinatura("AbC123")), true));
test("webhook rejeita replay antigo, data trocada e request id trocado", () => {
  assert.equal(assinaturaWebhook(contextoAssinatura("123", assinar("123", String(Math.floor(+instante / 1000) - 301)))), false);
  assert.equal(assinaturaWebhook({ ...contextoAssinatura("123"), dataId: "124" }), false);
  assert.equal(assinaturaWebhook({ ...contextoAssinatura("123"), requestId: "outra" }), false);
});
test("webhook rejeita campos duplicados ou assinatura malformada", () => {
  const c = contextoAssinatura("123");
  assert.equal(assinaturaWebhook({ ...c, assinatura: `${c.assinatura},ts=1` }), false);
  assert.equal(assinaturaWebhook({ ...c, assinatura: "ts=1,v1=errado" }), false);
});
const transacao = { lojaId: "loja-teste", pedidoId: "pedido-aleatorio-1234567890", contaId: "123", pedido: { total: 5000 } };
const pagamento = () => ({ id: 987, collector_id: 123, currency_id: "BRL", transaction_amount: 50, external_reference: `${transacao.lojaId}:${transacao.pedidoId}`, metadata: { loja_id: transacao.lojaId, pedido_id: transacao.pedidoId } });
test("pagamento é vinculado a valor, moeda, recebedor e pedido", () => {
  assert.doesNotThrow(() => validarPagamento(pagamento(), transacao, "987"));
  for (const alteracao of [{ collector_id: 456 }, { currency_id: "USD" }, { transaction_amount: 1 }, { external_reference: "outro" }, { metadata: { loja_id: "outra", pedido_id: transacao.pedidoId } }]) {
    assert.throws(() => validarPagamento({ ...pagamento(), ...alteracao }, transacao), (err) => err.codigo === "PAGAMENTO_DIVERGENTE");
  }
  assert.throws(() => validarPagamento(pagamento(), transacao, "988"));
});

const emulador = process.env.FIRESTORE_EMULATOR_HOST;
if (emulador && !/^(127\.0\.0\.1|localhost):8080$/.test(emulador)) throw new Error("Os testes só aceitam o emulador local do Firestore.");
const integracao = (nome, fn) => test(nome, { skip: !emulador }, fn);

test("desvincular aceita somente POST antes de consultar autenticação ou banco", async () => {
  const handler = criarHandler({ db: {}, auth: {}, appCheck: {}, config: { ativos: true, frontend: "https://pampfelp.github.io/DeliveryMenu/" }, segredos });
  const res = { http: 200, set() { return this; }, status(v) { this.http = v; return this; }, json(v) { this.body = v; return this; } };
  await handler({ path: "/desvincular", method: "GET", headers: {}, body: {} }, res);
  assert.equal(res.http, 405); assert.equal(res.body.erro.codigo, "METODO_INVALIDO");
});

async function fixture(t, opcoes = {}) {
  const sufixo = randomUUID().replaceAll("-", "").slice(0, 15), lojaId = `pag-test-${sufixo}`, pedidoId = randomUUID();
  const app = initializeApp({ projectId: "cardapio-delivery-ae048" }, `pagamentos-${sufixo}`), db = getFirestore(app);
  const colecao = `lojas/${lojaId}`, privado = `integracoesPagamento/${lojaId}`;
  const chamadas = [];
  let relogio = new Date(instante), pagamentoAtual = null, preferenciaErro = false, refundErro = false, antesRefund = null, antesToken = null, refreshErro = null;
  const contaToken = "token-conta-original";
  await db.doc(colecao).set({ donoId: "dono", nome: "Loja simulada", aberta: true, bairro: "Centro" });
  await db.doc(`${colecao}/itens/pizza`).set({ nome: "Pizza", preco: 5000, grupos: [] });
  await db.doc(privado).set({ ativo: true, contaId: "123" });
  await db.doc(`${privado}/contas/123`).set({ protegido: cifrar({ access_token: contaToken, refresh_token: "renovar-original" }, chave, lojaId, "123"), expiresAt: new Date(+instante + 86400000), versao: "inicial", refreshAte: new Date(0) });
  const pedido = { cliente: { nome: "Pessoa de teste", telefone: ["91", "90000", "0000"].join("") }, tipo: "retirada", itens: [{ itemId: "pizza", qtd: 1, escolhas: {} }], subtotal: 5000, total: 5000 };
  const respostaMP = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
  const buscar = async (url, req) => {
    assert.ok(url.startsWith("https://api.mercadopago.com/"));
    const body = req.body ? JSON.parse(req.body) : null; chamadas.push({ url, method: req.method, headers: req.headers, body });
    if (url.endsWith("/oauth/token")) {
      if (antesToken) await antesToken();
      if (body.grant_type === "refresh_token" && refreshErro) return respostaMP({ error: refreshErro.codigo }, refreshErro.http);
      return respostaMP({ access_token: "novo-token", refresh_token: "novo-refresh", expires_in: 3600, user_id: 123 });
    }
    if (url.endsWith("/users/me")) return respostaMP({ id: 123 });
    if (url.endsWith("/checkout/preferences")) {
      if (preferenciaErro) throw new Error("queda simulada depois do envio");
      return respostaMP({ id: "preferencia-simulada", init_point: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=simulado" });
    }
    if (url.includes("/v1/payments/search?")) return respostaMP({ results: pagamentoAtual ? [{ id: pagamentoAtual.id, status: pagamentoAtual.status }] : [] });
    if (/\/v1\/payments\/\d+\/refunds$/.test(url)) {
      if (antesRefund) await antesRefund();
      if (refundErro) throw new Error("queda simulada após envio do estorno");
      pagamentoAtual = { ...pagamentoAtual, status: "refunded" };
      return respostaMP({ id: 555, payment_id: pagamentoAtual.id, amount: pedido.total / 100, status: "approved" });
    }
    if (/\/v1\/payments\/\d+$/.test(url)) return respostaMP(pagamentoAtual || {}, pagamentoAtual ? 200 : 404);
    throw new Error(`Chamada inesperada no provedor simulado: ${new URL(url).pathname}`);
  };
  const config = { ativos: true, clientId: "999", frontend: "https://pampfelp.github.io/DeliveryMenu/", url: "https://exemplo.test/pagamentos", emulador: false, ...opcoes.config };
  const auth = { verifyIdToken: async (token, revoked) => { assert.equal(revoked, true); if (!["dono", "intruso", "equipe"].includes(token)) throw new Error("inválido"); return { uid: token }; }, getUser: async (uid) => ({ uid, email: `${uid}@exemplo.test`, disabled: uid === "desativado" }) };
  const handler = criarHandler({ db, auth, appCheck: { verifyToken: async (token) => { if (token !== "app-valido") throw new Error("inválido"); } }, config, segredos, fetch: buscar, agora: () => new Date(relogio), carimbo: () => new Date(relogio) });
  const chamar = async (rota, { body = {}, query = {}, headers = {}, method = "POST" } = {}) => {
    const req = { path: `/${rota}`, method, body, query, headers: { "x-firebase-appcheck": "app-valido", ...headers } };
    const res = { http: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(n) { this.http = n; return this; }, json(v) { this.body = v; return this; }, end() { return this; }, redirect(status, url) { this.http = status; this.url = url; return this; } };
    await handler(req, res); return res;
  };
  const iniciar = (id = pedidoId, entrada = pedido) => chamar("checkout", { body: { lojaId, pedidoId: id, pedido: entrada } });
  const confirmar = async (status = "approved", alteracoes = {}) => {
    pagamentoAtual = { id: 987, status, collector_id: 123, currency_id: "BRL", transaction_amount: pedido.total / 100, date_approved: relogio.toISOString(), external_reference: `${lojaId}:${pedidoId}`, metadata: { loja_id: lojaId, pedido_id: pedidoId }, ...alteracoes };
    const id = String(pagamentoAtual.id);
    return chamar("webhook", { query: { lojaId, pedidoId, "data.id": id }, body: { type: "payment", data: { id: pagamentoAtual.id } }, headers: assinar(id, String(Math.floor(+relogio / 1000))) });
  };
  t.after(async () => {
    assert.ok(/^(127\.0\.0\.1|localhost):8080$/.test(process.env.FIRESTORE_EMULATOR_HOST));
    await db.recursiveDelete(db.doc(colecao)); await db.recursiveDelete(db.doc(privado));
    const transacoes = await db.collection("transacoesPagamento").where("lojaId", "==", lojaId).get();
    await Promise.all(transacoes.docs.map((d) => d.ref.delete()));
    const estados = await db.collection("oauthPagamento").where("lojaId", "==", lojaId).get();
    await Promise.all(estados.docs.map((d) => d.ref.delete()));
    await db.doc("acessos/equipe@exemplo.test").delete(); await db.terminate(); await deleteApp(app);
  });
  return { db, lojaId, pedidoId, pedido, chamar, iniciar, confirmar, chamadas, handler, config,
    agora(v) { relogio = new Date(v); }, erroPreferencia(v = true) { preferenciaErro = v; }, erroEstorno(v = true) { refundErro = v; }, antesEstorno(fn) { antesRefund = fn; },
    antesToken(fn) { antesToken = fn; }, erroRefresh(erro) { refreshErro = erro; },
    getPagamento() { return pagamentoAtual; }, setPagamento(p) { pagamentoAtual = p; }, entradaRef: db.doc(`${colecao}/pedidosEntrada/${pedidoId}`), finalRef: db.doc(`${colecao}/pedidos/${pedidoId}`), txRef: db.doc(`transacoesPagamento/${pedidoId}`), publicoRef: db.doc(`${colecao}/pagamentosPedidos/${pedidoId}`), privado,
  };
}

integracao("desligado por padrão e App Check bloqueiam antes da API", async (t) => {
  const f = await fixture(t, { config: { ativos: false } });
  assert.equal((await f.iniciar()).http, 503); assert.equal(f.chamadas.length, 0);
  f.config.ativos = true;
  assert.equal((await f.chamar("checkout", { body: { lojaId: f.lojaId, pedidoId: f.pedidoId, pedido: f.pedido }, headers: { "x-firebase-appcheck": "" } })).http, 401);
  assert.equal(f.chamadas.length, 0);
});
integracao("status e conexão exigem membro da loja e origem autorizada", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.chamar("status", { method: "GET", query: { lojaId: f.lojaId } })).http, 401);
  assert.equal((await f.chamar("status", { method: "GET", query: { lojaId: f.lojaId }, headers: { authorization: "Bearer intruso" } })).http, 403);
  assert.equal((await f.chamar("status", { method: "GET", query: { lojaId: f.lojaId }, headers: { authorization: "Bearer dono", origin: "https://outro.test" } })).http, 403);
  const r = await f.chamar("status", { method: "GET", query: { lojaId: f.lojaId }, headers: { authorization: "Bearer dono" } });
  assert.equal(r.body.data.ativo, true); assert.equal(r.body.data.conta, "123");
});
integracao("OAuth usa PKCE, estado de uso único e tokens ficam cifrados", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.chamar("desvincular", { body: { lojaId: f.lojaId, contaIdEsperada: "123" }, headers: { authorization: "Bearer dono" } })).http, 200);
  const r = await f.chamar("conectar", { body: { lojaId: f.lojaId }, headers: { authorization: "Bearer dono" } });
  assert.equal(r.http, 200); const url = new URL(r.body.data.url), state = url.searchParams.get("state");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const estados = (await f.db.doc(`oauthPagamento/${sha256(state)}`).get()).data();
  assert.equal(desafioPKCE(estados.verifier), url.searchParams.get("code_challenge"));
  const callback = await f.chamar("callback", { method: "GET", query: { state, code: "codigo-simulado" } });
  assert.equal(callback.http, 303); assert.match(callback.url, /pagamento=conectado#configuracoes/);
  assert.equal((await f.db.doc(f.privado).get()).data().ativo, false);
  assert.equal((await f.db.doc(`lojas/${f.lojaId}`).get()).data().pagamentoOnline.ativo, false);
  assert.equal((await f.iniciar()).body.erro.codigo, "PAGAMENTO_DESATIVADO");
  const conta = (await f.db.doc(`${f.privado}/contas/123`).get()).data();
  assert.equal(decifrar(conta.protegido, chave, f.lojaId, "123").access_token, "novo-token");
  assert.equal(JSON.stringify((await f.db.doc(`lojas/${f.lojaId}`).get()).data()).includes("novo-token"), false);
  const antes = f.chamadas.length;
  assert.equal((await f.chamar("callback", { method: "GET", query: { state, code: "codigo-simulado" } })).http, 400);
  assert.equal(f.chamadas.length, antes);
});
integracao("ativar exige membro e conta cifrada atual; repetir e pausar preservam a conta", async (t) => {
  const f = await fixture(t), body = { lojaId: f.lojaId }, headers = { authorization: "Bearer dono" };
  assert.equal((await f.chamar("ativar", { body })).http, 401);
  assert.equal((await f.chamar("ativar", { body, headers: { authorization: "Bearer intruso" } })).http, 403);
  await f.chamar("pausar", { body, headers });
  for (let i = 0; i < 2; i++) assert.equal((await f.chamar("ativar", { body, headers })).body.data.ativo, true);
  assert.equal((await f.db.doc(`lojas/${f.lojaId}`).get()).data().pagamentoOnline.ativo, true);
  await f.chamar("pausar", { body, headers });
  await f.db.doc(`${f.privado}/contas/123`).update({ reconectar: true });
  assert.equal((await f.chamar("ativar", { body, headers })).body.erro.codigo, "RECONECTAR");
  assert.equal((await f.db.doc(f.privado).get()).data().ativo, false);
  await f.db.doc(f.privado).update({ contaId: "456" });
  assert.equal((await f.chamar("ativar", { body, headers })).body.erro.codigo, "RECONECTAR");
});
integracao("OAuth vencido ou acesso removido não faz troca de token", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.chamar("desvincular", { body: { lojaId: f.lojaId, contaIdEsperada: "123" }, headers: { authorization: "Bearer dono" } })).http, 200);
  const r = await f.chamar("conectar", { body: { lojaId: f.lojaId }, headers: { authorization: "Bearer dono" } });
  const state = new URL(r.body.data.url).searchParams.get("state");
  f.agora(new Date(+instante + 11 * 60000));
  assert.equal((await f.chamar("callback", { method: "GET", query: { state, code: "codigo" } })).http, 400);
  assert.equal(f.chamadas.length, 0);
});
integracao("checkout concorrente e repetição geram uma única preferência", async (t) => {
  const f = await fixture(t);
  const respostas = await Promise.all([f.iniciar(), f.iniciar()]);
  assert.ok(respostas.every((r) => r.http === 200));
  assert.equal(f.chamadas.filter((c) => c.url.endsWith("/checkout/preferences")).length, 1);
  assert.equal((await f.iniciar()).body.data.checkoutUrl.includes("mercadopago"), true);
  assert.equal((await f.entradaRef.get()).exists, false);
  const preferencia = f.chamadas.find((c) => c.url.endsWith("/checkout/preferences")).body;
  assert.equal(preferencia.items[0].unit_price, 50); assert.equal(preferencia.marketplace_fee, undefined);
  assert.deepEqual(preferencia.payment_methods.excluded_payment_types, [{ id: "ticket" }, { id: "atm" }]);
  assert.equal(preferencia.external_reference, `${f.lojaId}:${f.pedidoId}`);
  assert.equal((await f.iniciar(f.pedidoId, { ...f.pedido, total: 1 })).http, 409);
});
integracao("valor adulterado não reserva nem chama provedor", async (t) => {
  const f = await fixture(t); f.pedido.total = 1;
  const r = await f.iniciar(); assert.equal(r.http, 400); assert.equal(r.body.erro.codigo, "PRECO_ALTERADO");
  assert.equal(f.chamadas.length, 0); assert.equal((await f.txRef.get()).exists, false);
});
integracao("falha ambígua não cria nova preferência na repetição", async (t) => {
  const f = await fixture(t); f.erroPreferencia();
  assert.equal((await f.iniciar()).http, 502); assert.equal((await f.iniciar()).body.data.estado, "reconciliar");
  assert.equal(f.chamadas.filter((c) => c.url.endsWith("/checkout/preferences")).length, 1);
});
integracao("webhook duplicado cria um pedido e não ressuscita após recusa", async (t) => {
  const f = await fixture(t); await f.iniciar();
  assert.equal((await f.confirmar()).body.data.estado, "aprovado");
  assert.equal((await f.confirmar()).body.data.estado, "aprovado");
  assert.equal((await f.entradaRef.get()).data().pagamento.pago, true);
  assert.equal((await f.txRef.get()).data().finalizado, true);
  assert.equal((await f.db.collection(`lojas/${f.lojaId}/pedidosEntrada`).get()).size, 1);
  const r = await f.chamar("recusar", { body: { lojaId: f.lojaId, pedidoId: f.pedidoId }, headers: { authorization: "Bearer dono" } });
  assert.equal(r.http, 200); assert.equal((await f.finalRef.get()).data().status, "cancelado");
  await f.confirmar(); assert.equal((await f.entradaRef.get()).exists, false); assert.equal((await f.txRef.get()).data().estado, "reembolsado");
});
integracao("webhook inválido e pagamento de outro recebedor não liberam cozinha", async (t) => {
  const f = await fixture(t); await f.iniciar(); const chamadas = f.chamadas.length;
  assert.equal((await f.chamar("webhook", { query: { lojaId: f.lojaId, pedidoId: f.pedidoId, "data.id": "987" } })).http, 401);
  assert.equal(f.chamadas.length, chamadas);
  assert.equal((await f.confirmar("approved", { collector_id: 456 })).http, 409); assert.equal((await f.entradaRef.get()).exists, false);
});
integracao("consultar não aceita status informado no retorno do navegador", async (t) => {
  const f = await fixture(t); await f.iniciar();
  const r = await f.chamar("consultar", { body: { lojaId: f.lojaId, pedidoId: f.pedidoId, status: "approved" } });
  assert.equal(r.body.data.estado, "aguardando"); assert.equal((await f.entradaRef.get()).exists, false);
  assert.equal((await f.chamar("consultar", { body: { lojaId: "outra-loja", pedidoId: f.pedidoId } })).http, 404);
});
integracao("pausar preserva conta original e bloqueia novos checkouts", async (t) => {
  const f = await fixture(t); await f.iniciar();
  assert.equal((await f.chamar("pausar", { body: { lojaId: f.lojaId }, headers: { authorization: "Bearer dono" } })).http, 200);
  assert.equal((await f.iniciar(randomUUID())).http, 409);
  await f.db.doc(f.privado).set({ ativo: true, contaId: "456" });
  assert.equal((await f.confirmar()).http, 200);
  assert.equal(f.chamadas.at(-1).headers.Authorization, "Bearer token-conta-original");
});
integracao("cupom comum tem reserva atômica e prazo só libera depois da API", async (t) => {
  const f = await fixture(t), cRef = f.db.doc(`lojas/${f.lojaId}/cupons/TESTE`);
  await cRef.set({ ativo: true, tipo: "valor", valor: 1000, minimo: 0, usos: 0, limite: 1 });
  f.pedido.cupom = "TESTE"; f.pedido.total = 4000;
  assert.equal((await f.iniciar()).http, 200);
  assert.equal((await cRef.get()).data().reservasOnline, 1);
  assert.equal((await f.iniciar(randomUUID())).http, 400);
  f.agora(new Date(+instante + 31 * 60000));
  const antes = f.chamadas.length;
  const r = await f.chamar("consultar", { body: { lojaId: f.lojaId, pedidoId: f.pedidoId } });
  assert.equal(r.body.data.estado, "expirado"); assert.ok(f.chamadas.length > antes);
  assert.equal((await cRef.get()).data().reservasOnline, 0);
  assert.equal((await f.txRef.get()).data().finalizado, true);
});
integracao("recusar trava aceite antes do estorno e só cancela após confirmação", async (t) => {
  const f = await fixture(t); await f.iniciar(); await f.confirmar();
  let flagVista = false;
  f.antesEstorno(async () => { flagVista = (await f.entradaRef.get()).data().pagamento.estornoPendente === true; });
  const r = await f.chamar("recusar", { body: { lojaId: f.lojaId, pedidoId: f.pedidoId }, headers: { authorization: "Bearer dono" } });
  assert.equal(r.body.data.estado, "reembolsado"); assert.equal(flagVista, true);
  const p = (await f.finalRef.get()).data(); assert.equal(p.status, "cancelado"); assert.equal(p.pagamento.reembolsado, true); assert.equal(p.pagamento.estornoPendente, false);
  assert.equal((await f.entradaRef.get()).exists, false);
});
integracao("se aceite vencer a corrida, backend não solicita estorno", async (t) => {
  const f = await fixture(t); await f.iniciar(); await f.confirmar();
  const p = (await f.entradaRef.get()).data(); await f.finalRef.set({ ...p, status: "preparo" }); await f.entradaRef.delete();
  const r = await f.chamar("recusar", { body: { lojaId: f.lojaId, pedidoId: f.pedidoId }, headers: { authorization: "Bearer dono" } });
  assert.equal(r.http, 409); assert.equal(f.chamadas.some((c) => c.url.endsWith("/refunds")), false);
  assert.equal((await f.finalRef.get()).data().status, "preparo");
});
integracao("estorno incerto conserva pedido travado e repete chave idempotente", async (t) => {
  const f = await fixture(t); await f.iniciar(); await f.confirmar(); f.erroEstorno();
  const req = { body: { lojaId: f.lojaId, pedidoId: f.pedidoId }, headers: { authorization: "Bearer dono" } };
  assert.equal((await f.chamar("recusar", req)).http, 502);
  assert.equal((await f.entradaRef.get()).data().pagamento.estornoPendente, true);
  assert.equal((await f.finalRef.get()).exists, false);
  f.erroEstorno(false); assert.equal((await f.chamar("recusar", req)).http, 200);
  const devolucoes = f.chamadas.filter((c) => c.url.endsWith("/refunds")); assert.equal(devolucoes.length, 2);
  assert.equal(devolucoes[0].headers["X-Idempotency-Key"], devolucoes[1].headers["X-Idempotency-Key"]);
});
integracao("estorno externo preserva pedido aceito e registra dinheiro devolvido", async (t) => {
  const f = await fixture(t); await f.iniciar(); await f.confirmar();
  const p = (await f.entradaRef.get()).data(); await f.finalRef.set({ ...p, status: "entregue" }); await f.entradaRef.delete();
  assert.equal((await f.confirmar("refunded")).http, 200);
  assert.equal((await f.finalRef.get()).data().status, "entregue"); assert.equal((await f.finalRef.get()).data().pagamento.reembolsado, true);
  assert.equal((await f.entradaRef.get()).exists, false);
});
integracao("job consulta provedor e finaliza reservas vencidas sem criar pedido", async (t) => {
  const f = await fixture(t); await f.iniciar(); f.agora(new Date(+instante + 31 * 60000));
  const r = await f.handler.expirarPendentes();
  assert.equal(r.find((p) => p.pedidoId === f.pedidoId)?.estado, "expirado");
  assert.equal((await f.entradaRef.get()).exists, false); assert.equal((await f.txRef.get()).data().finalizado, true);
});
integracao("preferência agendada vence antes da hora prometida", async (t) => {
  const f = await fixture(t);
  await f.db.doc(`lojas/${f.lojaId}`).update({ aceitaAgendamento: true, horario: { ter: { aberto: true, abre: "17:00", fecha: "23:00" } } });
  f.agora("2026-10-27T21:10:00Z"); f.pedido.agendadoPara = "2026-10-27T21:30:00Z";
  assert.equal((await f.iniciar()).http, 200);
  assert.equal(f.chamadas.find((c) => c.url.endsWith("/checkout/preferences")).body.expiration_date_to, "2026-10-27T21:30:00.000Z");
  f.agora("2026-10-27T21:31:00Z");
  const r = await f.confirmar(); assert.equal(r.http, 200); assert.equal(r.body.data.estado, "reembolsado");
  assert.equal((await f.entradaRef.get()).exists, false); assert.equal((await f.finalRef.get()).exists, false);
  assert.equal(f.chamadas.filter((c) => c.url.endsWith("/refunds")).length, 1);
});
integracao("pagamento tardio com estorno incerto é retomado pelo job", async (t) => {
  const f = await fixture(t); await f.iniciar(); f.agora(new Date(+instante + 31 * 60000));
  await f.chamar("consultar", { body: { lojaId: f.lojaId, pedidoId: f.pedidoId } });
  f.erroEstorno(); assert.equal((await f.confirmar()).http, 502);
  assert.equal((await f.entradaRef.get()).exists, false); assert.equal((await f.txRef.get()).data().finalizado, false);
  f.erroEstorno(false); const job = await f.handler.expirarPendentes();
  assert.equal(job.find((p) => p.pedidoId === f.pedidoId)?.estado, "reembolsado"); assert.equal((await f.txRef.get()).data().finalizado, true);
});
integracao("segunda cobrança aprovada é devolvida sem duplicar o pedido", async (t) => {
  const f = await fixture(t); await f.iniciar(); await f.confirmar();
  const r = await f.confirmar("approved", { id: 988 });
  assert.equal(r.http, 200); assert.equal((await f.txRef.get()).data().paymentId, "987");
  assert.equal((await f.txRef.get()).data().estado, "aprovado");
  assert.equal((await f.entradaRef.get()).data().pagamento.paymentId, "987");
  assert.equal(f.chamadas.filter((c) => c.url.endsWith("/988/refunds")).length, 1);
  assert.equal((await f.db.collection(`lojas/${f.lojaId}/pedidosEntrada`).get()).size, 1);
});
integracao("refresh concorrente usa lease e não sobrescreve a renovação", async (t) => {
  const f = await fixture(t), contaRef = f.db.doc(`${f.privado}/contas/123`);
  await contaRef.update({ expiresAt: new Date(+instante - 1000) });
  let liberar, chegou; const gate = new Promise((resolve) => { liberar = resolve; }), iniciou = new Promise((resolve) => { chegou = resolve; });
  f.antesToken(async () => { chegou(); await gate; });
  const primeiro = f.iniciar(); await iniciou;
  const segundo = await f.iniciar(randomUUID()); assert.equal(segundo.http, 503);
  liberar(); assert.equal((await primeiro).http, 200);
  assert.equal(f.chamadas.filter((c) => c.url.endsWith("/oauth/token")).length, 1);
  const c = (await contaRef.get()).data(); assert.equal(c.refreshLease, null);
  assert.equal(decifrar(c.protegido, chave, f.lojaId, "123").refresh_token, "novo-refresh");
});
integracao("falha transitória no refresh conserva autorização e permite retry", async (t) => {
  const f = await fixture(t), contaRef = f.db.doc(`${f.privado}/contas/123`);
  await contaRef.update({ expiresAt: new Date(+instante - 1000) }); f.erroRefresh({ http: 503, codigo: "temporarily_unavailable" });
  assert.equal((await f.iniciar()).http, 502);
  const conta = (await contaRef.get()).data(); assert.equal(conta.reconectar, false); assert.equal(conta.refreshLease, null);
  f.erroRefresh(null); assert.equal((await f.iniciar(randomUUID())).http, 200);
});
integracao("refresh comprovadamente revogado pede reconexão", async (t) => {
  const f = await fixture(t), contaRef = f.db.doc(`${f.privado}/contas/123`);
  await contaRef.update({ expiresAt: new Date(+instante - 1000) }); f.erroRefresh({ http: 400, codigo: "invalid_grant" });
  assert.equal((await f.iniciar()).http, 502); assert.equal((await contaRef.get()).data().reconectar, true);
  const s = await f.chamar("status", { method: "GET", query: { lojaId: f.lojaId }, headers: { authorization: "Bearer dono" } });
  assert.equal(s.body.data.conectado, false); assert.equal(s.body.data.ativo, false);
});
integracao("OAuth revalida vínculo removido antes de trocar a autorização", async (t) => {
  const f = await fixture(t), acesso = f.db.doc("acessos/equipe@exemplo.test");
  await acesso.set({ lojaId: f.lojaId });
  assert.equal((await f.chamar("desvincular", { body: { lojaId: f.lojaId, contaIdEsperada: "123" }, headers: { authorization: "Bearer equipe" } })).http, 200);
  const r = await f.chamar("conectar", { body: { lojaId: f.lojaId }, headers: { authorization: "Bearer equipe" } });
  assert.equal(r.http, 200); const state = new URL(r.body.data.url).searchParams.get("state"); await acesso.delete();
  assert.equal((await f.chamar("callback", { method: "GET", query: { state, code: "codigo" } })).http, 403);
  assert.equal(f.chamadas.length, 0);
});
integracao("cupom individual reserva uma vez e libera quando pagamento expira", async (t) => {
  const f = await fixture(t), base = `lojas/${f.lojaId}`;
  await f.db.doc(`${base}/cupons/EXCLUSIVO`).set({ ativo: true, individual: true, tipo: "valor", valor: 1000, minimo: 0, usos: 0, limite: 1, oferta: [{ itemId: "pizza", qtd: 1, escolhas: {}, nome: "Pizza", resumo: "", total: 5000 }] });
  await f.db.doc(`${base}/ofertasClientes/EXCLUSIVO`).set({ telefone: f.pedido.cliente.telefone });
  f.pedido.cupom = "EXCLUSIVO"; f.pedido.total = 4000;
  assert.equal((await f.iniciar()).http, 200);
  assert.equal((await f.iniciar(randomUUID())).http, 409);
  assert.equal((await f.db.doc(`${base}/reservasCupons/EXCLUSIVO`).get()).data().pedidoId, f.pedidoId);
  f.agora(new Date(+instante + 31 * 60000));
  assert.equal((await f.chamar("consultar", { body: { lojaId: f.lojaId, pedidoId: f.pedidoId } })).body.data.estado, "expirado");
  assert.equal((await f.db.doc(`${base}/reservasCupons/EXCLUSIVO`).get()).exists, false);
});
