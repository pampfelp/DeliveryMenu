import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHmac, createCipheriv, createDecipheriv } from "node:crypto";
import vm from "node:vm";

const bundle = await readFile(new URL("./publicar/Code.gs", import.meta.url), "utf8");
const projeto = "cardapio-delivery-ae048";
const prefixo = `projects/${projeto}/databases/(default)/documents/`;
const firestoreBase = `https://firestore.googleapis.com/v1/${prefixo.slice(0, -1)}`;
const scriptURL = "https://script.google.com/macros/s/deploy-runtime-simulado/exec";
const frontend = "https://pampfelp.github.io/DeliveryMenu/";
const clienteJWT = "JWT-CLIENTE-SOMENTE-SIMULADO", googleToken = "OAUTH-GOOGLE-SOMENTE-SIMULADO";
const chave = Buffer.alloc(32, 11).toString("base64");

function codificar(v) {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return { integerValue: String(v) };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(codificar) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, codificar(x)])) } };
}
function campo(fields, path) {
  let alvo = fields;
  const partes = path.split(".");
  for (const p of partes.slice(0, -1)) alvo = alvo[p]?.mapValue?.fields;
  return alvo?.[partes.at(-1)];
}
function gravarCampo(fields, path, valor) {
  let alvo = fields;
  const partes = path.split(".");
  for (const p of partes.slice(0, -1)) { alvo[p] ??= { mapValue: { fields: {} } }; alvo = alvo[p].mapValue.fields; }
  if (valor === undefined) delete alvo[partes.at(-1)]; else alvo[partes.at(-1)] = structuredClone(valor);
}

// Os únicos primitivos criptográficos do contexto vêm de Utilities, como no Apps Script.
// Node crypto e Buffer ficam exclusivamente neste simulador, fora da VM.
function fixture({ propriedades = {}, lojaDono = "dono", disabled = false, identidadeErro = false, publicar = scriptURL, permitirMP = false, mpFalha = false } = {}) {
  const valores = new Map(Object.entries(propriedades)), cache = new Map(), docs = new Map(), chamadas = [], logs = [], reads = [], triggers = [], locks = [];
  let sequencia = 0, googleTokens = 0, instalacoes = 0;
  const prop = { getProperty(k) { reads.push(k); return valores.get(k) ?? null; }, setProperty(k, v) { valores.set(k, String(v)); return this; } };
  const seed = (path, v) => docs.set(path, codificar(v).mapValue.fields);
  seed("lojas/loja-teste", { nome: "Loja de teste", donoId: lojaDono });
  seed("integracoesPagamento/loja-teste", { contaId: "123", ativo: true });
  seed("integracoesPagamento/loja-teste/contas/123", { protegido: { iv: "simulado", texto: "simulado", tag: "simulado" }, reconectar: false, expiresAt: new Date(Date.now() + 3600000) });
  const resposta = (dados, codigo = 200) => ({ getResponseCode: () => codigo, getContentText: () => JSON.stringify(dados) });
  const contexto = {
    URL: undefined, URLSearchParams: undefined, crypto: undefined, Buffer: undefined, AbortSignal: undefined,
    process: undefined, require: undefined, setTimeout: undefined, setInterval: undefined, setImmediate: undefined,
    console: { log: (...a) => logs.push(a), warn: (...a) => logs.push(a), error: (...a) => logs.push(a) },
    PropertiesService: { getScriptProperties: () => prop },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) || null, put(k, v) { cache.set(k, v); } }) },
    LockService: { getScriptLock: () => ({ tryLock(ms) { locks.push(ms); return true; }, releaseLock() {} }) },
    Utilities: {
      base64Decode: (v) => Array.from(Buffer.from(v, "base64"), (b) => b > 127 ? b - 256 : b),
      computeHmacSha256Signature: (texto, key) => Array.from(createHmac("sha256", key).update(texto).digest(), (b) => b > 127 ? b - 256 : b),
      getUuid: () => `uuid-simulado-${++sequencia}`,
    },
    ScriptApp: {
      getOAuthToken() { googleTokens++; return googleToken; },
      getService: () => ({ getUrl: () => publicar }),
      getProjectTriggers: () => triggers,
      newTrigger(nome) { return { timeBased() { return this; }, everyMinutes(n) { assert.equal(n, 5); return this; }, create() { instalacoes++; const trigger = { getHandlerFunction: () => nome }; triggers.push(trigger); return trigger; } }; },
    },
    ContentService: { MimeType: { JSON: "application/json" }, createTextOutput: (texto) => ({ kind: "json", texto, setMimeType(tipo) { this.mimeType = tipo; return this; } }) },
    HtmlService: { createHtmlOutput: (html) => ({ kind: "html", html }) },
    UrlFetchApp: { fetch(url, op) {
      const body = op.payload ? JSON.parse(op.payload) : null;
      chamadas.push({ url, op, body });
      assert.equal(op.followRedirects, false); assert.equal(op.validateHttpsCertificates, true);
      const privadoGoogle = url.startsWith(firestoreBase) || url === `https://identitytoolkit.googleapis.com/v1/projects/${projeto}/accounts:lookup`;
      assert.equal(op.headers?.["x-goog-user-project"], privadoGoogle ? projeto : undefined);
      if (url.startsWith("https://identitytoolkit.googleapis.com/v1/accounts:lookup?")) {
        assert.equal(op.method, "post"); assert.equal(body.idToken, clienteJWT); assert.equal(op.headers.Authorization, undefined);
        if (identidadeErro) return resposta({ error: { message: "DETALHE-PRIVADO-IDENTIDADE" } }, 400);
        return resposta({ users: [{ localId: "dono", email: "dono@exemplo.test", disabled }] });
      }
      if (url === `https://identitytoolkit.googleapis.com/v1/projects/${projeto}/accounts:lookup`) {
        assert.equal(op.headers.Authorization, `Bearer ${googleToken}`); assert.deepEqual(body.localId, ["dono"]);
        return resposta({ users: [{ localId: "dono", email: "dono@exemplo.test", disabled }] });
      }
      if (url === "https://firebaseappcheck.googleapis.com/v1/jwks") return resposta({ keys: [] });
      if (url.startsWith(firestoreBase)) {
        assert.equal(op.headers.Authorization, `Bearer ${googleToken}`, "Firestore usa o OAuth do script, nunca o JWT do cliente");
        if (url === `${firestoreBase}:beginTransaction`) return resposta({ transaction: `tx-${++sequencia}` });
        if (url === `${firestoreBase}:rollback`) return resposta({});
        if (url === `${firestoreBase}:batchGet`) return resposta(body.documents.map((name) => {
          const path = name.slice(prefixo.length); return docs.has(path) ? { found: { name, fields: docs.get(path) } } : { missing: name };
        }));
        if (url === `${firestoreBase}:commit`) {
          for (const w of body.writes) {
            if (w.delete) { docs.delete(w.delete.slice(prefixo.length)); continue; }
            const path = w.update.name.slice(prefixo.length), atual = structuredClone(docs.get(path) || {}), fields = w.update.fields;
            if (w.currentDocument?.exists === false) assert.equal(docs.has(path), false);
            if (w.currentDocument?.exists === true) assert.equal(docs.has(path), true);
            const resultado = w.updateMask ? atual : structuredClone(fields);
            for (const k of w.updateMask?.fieldPaths || []) gravarCampo(resultado, k, campo(fields, k));
            for (const transform of w.updateTransforms || []) gravarCampo(resultado, transform.fieldPath, { timestampValue: new Date().toISOString() });
            docs.set(path, resultado);
          }
          return resposta({ writeResults: [] });
        }
        if (url.endsWith(":runQuery")) return resposta([]);
        if (op.method === "get" && url.startsWith(`${firestoreBase}/`)) {
          const path = decodeURIComponent(url.slice(firestoreBase.length + 1));
          return docs.has(path) ? resposta({ name: prefixo + path, fields: docs.get(path) }) : resposta({ error: { status: "NOT_FOUND" } }, 404);
        }
      }
      if (permitirMP && url === "https://api.mercadopago.com/oauth/token") {
        assert.equal(op.method, "post"); assert.equal(body.client_secret, "segredo-simulado");
        if (mpFalha) return resposta({ error: "invalid_grant", message: "ERRO-PROVEDOR-NAO-EXIBIR" }, 400);
        return resposta({ access_token: "token-vendedor-simulado", refresh_token: "renovacao-simulada", expires_in: 3600, user_id: 123 });
      }
      if (permitirMP && url === "https://api.mercadopago.com/users/me") {
        assert.equal(op.headers.Authorization, "Bearer token-vendedor-simulado"); return resposta({ id: 123 });
      }
      throw new Error("REDE_NAO_AUTORIZADA_NO_TESTE");
    } },
  };
  vm.createContext(contexto);
  vm.runInContext(bundle, contexto, { filename: "Code.gs", timeout: 10000 });
  const jsonSaida = (saida) => {
    assert.ok(saida && typeof saida.then !== "function", "Apps Script precisa devolver resposta síncrona");
    assert.equal(saida.kind, "json"); assert.equal(saida.mimeType, "application/json"); return JSON.parse(saida.texto);
  };
  return { contexto, chamadas, logs, reads, docs, valores, triggers, locks, seed,
    get(q = {}) { return contexto.doGet({ parameter: q }); },
    post(body, parameter = {}) { return jsonSaida(contexto.doPost({ postData: { contents: typeof body === "string" ? body : JSON.stringify(body) }, parameter })); },
    jsonSaida, googleTokens: () => googleTokens, instalacoes: () => instalacoes,
  };
}
const ativo = { PAGAMENTOS_ATIVOS: "true", MP_CLIENT_ID: "999", MP_CLIENT_SECRET: "segredo-simulado", MP_TOKENS_KEY: chave };

function homologacaoFixture() {
  const f = fixture({ propriedades: { ...ativo, RNG_SEQUENCIA: "47" } }), origem = "casa-jambu-delivery";
  const id = "homologacao-0123456789abcdef", contaId = "123", tokens = { access_token: "ACESSO-TESTE-PRIVADO", refresh_token: "REFRESH-TESTE-PRIVADO" };
  f.contexto.Utilities.getUuid = () => "01234567-89ab-cdef-0123-456789abcdef";
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(chave, "base64"), Buffer.alloc(12, 3));
  cipher.setAAD(Buffer.from(`${origem}:${contaId}`));
  const texto = Buffer.concat([cipher.update(JSON.stringify(tokens)), cipher.final()]);
  f.seed(`lojas/${origem}`, { donoId: "dono", pagamentoOnline: { ativo: false }, endereco: "ENDERECO-NAO-COPIAR", nome: "ORIGEM-NAO-COPIAR" });
  f.seed(`integracoesPagamento/${origem}`, { contaId, ativo: false });
  f.seed(`integracoesPagamento/${origem}/contas/${contaId}`, { protegido: { iv: Buffer.alloc(12, 3).toString("base64"), texto: texto.toString("base64"), tag: cipher.getAuthTag().toString("base64") }, expiresAt: new Date(Date.now() + 3600000), reconectar: false, refreshAte: new Date(0), refreshLease: null });
  return { f, origem, id, contaId, tokens };
}

test("homologação isolada é atômica, recifra AAD e reutiliza sem alterar histórico/origem", () => {
  const { f, origem, id, contaId, tokens } = homologacaoFixture();
  const antes = new Map([...f.docs].map(([k, v]) => [k, JSON.stringify(v)]));
  const resultado = f.contexto.prepararHomologacaoPagamentos();
  assert.deepEqual(JSON.parse(JSON.stringify(resultado)), { link: `${frontend}index.html?loja=${id}`, valor: 500 });
  for (const [k, v] of antes) assert.equal(JSON.stringify(f.docs.get(k)), v);
  const criados = [...f.docs.keys()].filter((k) => !antes.has(k)); assert.equal(criados.length, 5);
  assert.equal(f.docs.get(`lojas/${id}`).pagamentoOnline.mapValue.fields.ativo.booleanValue, true);
  assert.equal(f.docs.get(`lojas/${id}/itens/pix-teste`).preco.integerValue, "500");
  const protegidos = f.docs.get(`integracoesPagamento/${id}/contas/${contaId}`).protegido.mapValue.fields;
  const decifrar = (loja) => {
    const dec = createDecipheriv("aes-256-gcm", Buffer.from(chave, "base64"), Buffer.from(protegidos.iv.stringValue, "base64"));
    dec.setAAD(Buffer.from(`${loja}:${contaId}`)); dec.setAuthTag(Buffer.from(protegidos.tag.stringValue, "base64"));
    return JSON.parse(Buffer.concat([dec.update(Buffer.from(protegidos.texto.stringValue, "base64")), dec.final()]).toString());
  };
  assert.deepEqual(decifrar(id), tokens); assert.throws(() => decifrar(origem));
  assert.equal(f.valores.get("HOMOLOGACAO_LOJA_ID"), id); assert(Number(f.valores.get("RNG_SEQUENCIA")) > 47);
  const commits = f.chamadas.filter((c) => c.url === `${firestoreBase}:commit`); assert.equal(commits.length, 1); assert.equal(commits[0].body.writes.length, 5);
  f.seed(`lojas/${id}/pedidosEntrada/pedido-preservado`, { total: 500, status: "novo" });
  const historico = JSON.stringify([...f.docs]); f.contexto.prepararHomologacaoPagamentos(); assert.equal(JSON.stringify([...f.docs]), historico);
  const saida = JSON.stringify([resultado, f.logs, criados.map((k) => k.startsWith(`lojas/${id}`) ? f.docs.get(k) : null)]);
  for (const valor of [tokens.access_token, tokens.refresh_token, chave, googleToken, "ENDERECO-NAO-COPIAR", "ORIGEM-NAO-COPIAR"]) assert.equal(saida.includes(valor), false);
  assert.equal(f.chamadas.some((c) => c.url.startsWith("https://api.mercadopago.com/")), false);
});

test("homologação falha sem sobrescrever destino ou origem e sem registrar erro cru", () => {
  for (const caso of ["destino", "flag", "expirada", "cifra", "reconectar", "origem-ativa"]) {
    const { f, origem, id, contaId } = homologacaoFixture();
    if (caso === "destino") f.seed(`lojas/${id}`, { donoId: "outro" });
    if (caso === "flag") f.valores.set("HOMOLOGACAO_LOJA_ID", origem);
    if (caso === "origem-ativa") f.seed(`lojas/${origem}`, { donoId: "dono", pagamentoOnline: { ativo: true } });
    if (["expirada", "cifra", "reconectar"].includes(caso)) {
      const conta = f.docs.get(`integracoesPagamento/${origem}/contas/${contaId}`);
      if (caso === "expirada") conta.expiresAt.timestampValue = new Date(Date.now() + 60000).toISOString();
      if (caso === "cifra") conta.protegido.mapValue.fields.tag.stringValue = Buffer.alloc(16).toString("base64");
      if (caso === "reconectar") conta.reconectar.booleanValue = true;
    }
    const antes = JSON.stringify([...f.docs]);
    assert.throws(() => f.contexto.prepararHomologacaoPagamentos(), { codigo: "HOMOLOGACAO" });
    assert.equal(JSON.stringify([...f.docs]), antes); assert.equal(f.logs.length, 0);
    assert.equal(f.chamadas.filter((c) => c.url === `${firestoreBase}:commit`).length, 0);
  }
  const { f, id } = homologacaoFixture(); f.contexto.prepararHomologacaoPagamentos();
  f.docs.get(`lojas/${id}`).homologacaoOrigem.stringValue = "outra";
  const antes = JSON.stringify([...f.docs]); assert.throws(() => f.contexto.prepararHomologacaoPagamentos(), { codigo: "HOMOLOGACAO" }); assert.equal(JSON.stringify([...f.docs]), antes);
});

test("homologação só guarda propriedade após commit e não aceita rota web", () => {
  const { f } = homologacaoFixture(), fetch = f.contexto.UrlFetchApp.fetch;
  f.contexto.UrlFetchApp.fetch = (url, op) => {
    if (url === `${firestoreBase}:commit`) throw new Error(`DETALHE-PRIVADO ${googleToken}`);
    return fetch(url, op);
  };
  assert.throws(() => f.contexto.prepararHomologacaoPagamentos(), (e) => e.codigo === "HOMOLOGACAO" && !e.message.includes("DETALHE-PRIVADO"));
  assert.equal(f.valores.has("HOMOLOGACAO_LOJA_ID"), false); assert.equal(f.logs.length, 0);
  assert.equal(f.jsonSaida(f.get({ rota: "prepararHomologacao" })).erro.codigo, "VALIDACAO");
  assert.equal(f.post({ rota: "prepararHomologacao" }).erro.codigo, "VALIDACAO");
});

test("página QA limita namespace, valor, estado e sessão antes da devolução normal", async () => {
  const html = await readFile(new URL("../rea/homologar-pagamento.html", import.meta.url), "utf8");
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm, "");
  assert.match(html, /name="robots" content="noindex,nofollow"/);
  function pagina(search) {
    const elementos = Object.fromEntries(["estado", "conferir", "recusar"].map((id) => [id, { disabled: true, textContent: "", addEventListener(n, fn) { this[n] = fn; } }]));
    const listeners = new Map(), chamadas = [], auth = { currentUser: null };
    let recibo = { estado: "aprovado" }, entrada = { total: 500, pagamento: { online: true, pago: true } }, leituras = 0;
    const snapshot = (dados) => ({ exists: () => !!dados, data: () => dados });
    const contexto = { URLSearchParams, location: { search }, document: { getElementById: (id) => elementos[id] }, window: { addEventListener() {} }, db: {}, auth,
      doc: (...args) => args.at(-2), onSnapshot: (ref, fn) => { listeners.set(ref, fn); return () => {}; }, onAuthStateChanged: () => () => {},
      getDocFromServer: async (ref) => { leituras++; return snapshot(ref === "pagamentosPedidos" ? recibo : entrada); },
      chamarPagamento: async (...args) => { chamadas.push(args); return {}; } };
    vm.createContext(contexto); vm.runInContext(script, contexto);
    return { elementos, chamadas, auth, listeners, leituras: () => leituras,
      emitir(r = recibo, e = entrada) { recibo = r; entrada = e; listeners.get("pagamentosPedidos")?.(snapshot(r)); listeners.get("pedidosEntrada")?.(snapshot(e)); } };
  }
  for (const loja of ["casa-jambu-delivery", "homologacao-XYZ", "homologacao-0123456789abcdef/outro"]) {
    const p = pagina(`?loja=${encodeURIComponent(loja)}&pedido=pedido_local_1234567890`);
    assert.equal(p.listeners.size, 0); assert.equal(p.elementos.recusar.disabled, true); assert.equal(p.chamadas.length, 0);
  }
  const p = pagina("?loja=homologacao-0123456789abcdef&pedido=pedido_local_1234567890");
  p.emitir(); assert.equal(p.elementos.recusar.disabled, true);
  p.auth.currentUser = { uid: "dono" };
  p.emitir({ estado: "aguardando" }); await p.elementos.recusar.click(); assert.equal(p.chamadas.length, 0);
  p.emitir({ estado: "aprovado" }, { total: 501, pagamento: { online: true, pago: true } }); await p.elementos.recusar.click(); assert.equal(p.chamadas.length, 0);
  p.emitir({ estado: "aprovado" }, { total: 500, pagamento: { online: true, pago: true } }); assert.equal(p.elementos.recusar.disabled, false);
  assert.equal(p.chamadas.length, 0); await p.elementos.recusar.click(); assert.equal(p.leituras(), 2);
  assert.deepEqual(JSON.parse(JSON.stringify(p.chamadas[0])), ["recusar", { lojaId: "homologacao-0123456789abcdef", pedidoId: "pedido_local_1234567890" }, { autenticado: true }]);
  assert.doesNotMatch(p.elementos.estado.textContent, /pedido_local|homologacao-|dono/);
});

test("diagnóstico de homologação resume recusa ou ausência de pagamento sem mutar nem expor dados", () => {
  for (const comPagamento of [true, false]) {
    const { f, id } = homologacaoFixture(); f.contexto.prepararHomologacaoPagamentos(); f.logs.length = 0;
    const pedidoId = "pedido_diagnostico_1234567890", preferenceId = "preferencia-teste", expiresAt = new Date(Date.now() + 600000);
    const path = `transacoesPagamento/${pedidoId}`;
    f.seed(path, { lojaId: id, pedidoId, contaId: "123", preferenceId, estado: "aguardando", pedido: { total: 500, cliente: { nome: "NOME-PRIVADO" } }, expiresAt });
    const antes = JSON.stringify([...f.docs]), propsAntes = JSON.stringify([...f.valores]), fetch = f.contexto.UrlFetchApp.fetch;
    const referencia = `${id}:${pedidoId}`, chamadas = [];
    f.contexto.UrlFetchApp.fetch = (url, op) => {
      chamadas.push({ url, op });
      if (url === `${firestoreBase}:runQuery`) {
        const query = JSON.parse(op.payload).structuredQuery;
        assert.equal(op.method, "post"); assert.equal(query.limit, 5);
        assert.equal(query.where.fieldFilter.field.fieldPath, "lojaId"); assert.equal(query.where.fieldFilter.value.stringValue, id);
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify([{ document: { name: prefixo + path, fields: f.docs.get(path) } }]) };
      }
      if (url.startsWith("https://api.mercadopago.com/")) {
        assert.equal(op.method, "get"); assert.equal(op.followRedirects, false); assert.equal(op.muteHttpExceptions, true); assert.equal(op.validateHttpsCertificates, true);
        assert.equal(op.headers.Authorization, "Bearer ACESSO-TESTE-PRIVADO"); assert.equal(op.headers["x-goog-user-project"], undefined);
        const dados = url.includes("/v1/payments/search?") ? { results: comPagamento ? [{ status: "rejected", status_detail: "cc_rejected_other_reason", transaction_amount: 5,
          collector_id: 123, external_reference: referencia, live_mode: true, payer: { email: "PRIVADO@exemplo.test" }, id: "IDENTIFICADOR-PRIVADO", raw: "CORPO-PRIVADO" }] : [] }
          : { active: true, expires: true, expiration_date_to: expiresAt.toISOString(), external_reference: referencia, collector_id: 123, items: [{ quantity: 1, unit_price: 5 }], live_mode: true, payer: { name: "NOME-PRIVADO" } };
        if (url.includes("/v1/payments/search?")) assert.equal(url, `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(referencia)}`);
        else assert.equal(url, `https://api.mercadopago.com/checkout/preferences/${preferenceId}`);
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(dados) };
      }
      assert.equal(op.method, "get"); return fetch(url, op);
    };
    const resultado = JSON.parse(JSON.stringify(f.contexto.diagnosticarHomologacaoPagamentos()));
    assert.equal(resultado.count, 1); const pedido = resultado.pedidos[0];
    assert.equal(pedido.estado, "aguardando"); assert.equal(pedido.expirou, false); assert.equal(pedido.pagamentos.count, comPagamento ? 1 : 0);
    if (comPagamento) assert.deepEqual(pedido.pagamentos.resultados[0], { status: "rejected", status_detail: "cc_rejected_other_reason", totalCorreto: true, recebedorCorreto: true, referenciaCorreta: true, live_mode: true });
    assert.deepEqual(pedido.preferencia, { http: 200, active: true, expires: true, expiracaoIgual: true, referenciaCorreta: true, recebedorCorreto: true, totalCorreto: true, live_mode: true });
    assert.equal(JSON.stringify([...f.docs]), antes); assert.equal(JSON.stringify([...f.valores]), propsAntes);
    assert.equal(chamadas.filter((c) => c.url.startsWith("https://api.mercadopago.com/")).length, 2);
    assert.equal(chamadas.some((c) => /:commit|:beginTransaction|oauth\/token/.test(c.url)), false);
    for (const valor of ["NOME-PRIVADO", "CORPO-PRIVADO", "IDENTIFICADOR-PRIVADO", "PRIVADO@", "ACESSO-TESTE-PRIVADO", "REFRESH-TESTE-PRIVADO", googleToken, chave, pedidoId, id, preferenceId, "https://"]) assert.equal(JSON.stringify([resultado, f.logs]).includes(valor), false);
  }
});

test("diagnóstico de homologação restringe destino, erros e rotas sem renovar", () => {
  const { f, id } = homologacaoFixture(); f.contexto.prepararHomologacaoPagamentos(); f.logs.length = 0;
  const pedidoId = "pedido_diagnostico_1234567890", path = `transacoesPagamento/${pedidoId}`, fetch = f.contexto.UrlFetchApp.fetch;
  f.seed(path, { lojaId: id, pedidoId, contaId: "123", preferenceId: "preferencia-teste", estado: "aguardando", pedido: { total: 500 }, expiresAt: new Date(Date.now() + 60000) });
  let chamadasMP = 0;
  f.contexto.UrlFetchApp.fetch = (url, op) => {
    if (url.endsWith(":runQuery")) return { getResponseCode: () => 200, getContentText: () => JSON.stringify([{ document: { name: prefixo + path, fields: f.docs.get(path) } }]) };
    if (url.startsWith("https://api.mercadopago.com/")) { chamadasMP++; assert.equal(op.method, "get"); return { getResponseCode: () => 403, getContentText: () => '{"error":"forbidden","message":"SEGREDO-NAO-EXIBIR","payer":"PRIVADO"}' }; }
    return fetch(url, op);
  };
  const r = JSON.parse(JSON.stringify(f.contexto.diagnosticarHomologacaoPagamentos()));
  assert.deepEqual(r.pedidos[0].pagamentos, { http: 403, codigo: "forbidden" }); assert.equal(chamadasMP, 2);
  assert.doesNotMatch(JSON.stringify([r, f.logs]), /SEGREDO-NAO-EXIBIR|PRIVADO/);
  f.docs.get(path).preferenceId.stringValue = "../../oauth/token";
  assert.equal(f.contexto.diagnosticarHomologacaoPagamentos().pedidos[0].codigo, "VALIDACAO"); assert.equal(chamadasMP, 2);
  f.valores.set("HOMOLOGACAO_LOJA_ID", "casa-jambu-delivery");
  assert.equal(f.contexto.diagnosticarHomologacaoPagamentos().codigo, "CONFIGURACAO"); assert.equal(chamadasMP, 2);
  assert.equal(f.jsonSaida(f.get({ rota: "diagnosticarHomologacao" })).erro.codigo, "VALIDACAO");
  assert.equal(f.post({ rota: "diagnosticarHomologacao" }).erro.codigo, "VALIDACAO");
});

test("diagnóstico do editor filtra erro Google e não divulga documento nem OAuth", () => {
  const f = fixture(), chamadas = [];
  f.contexto.UrlFetchApp.fetch = (url, op) => {
    chamadas.push(url);
    assert.equal(op.method, "get"); assert.equal(op.headers.Authorization, `Bearer ${googleToken}`);
    assert.equal(op.headers["x-goog-user-project"], projeto);
    assert.equal(op.followRedirects, false); assert.equal(op.muteHttpExceptions, true); assert.equal(op.validateHttpsCertificates, true);
    const firestore = chamadas.length === 1;
    assert.equal(url, firestore ? `${firestoreBase}/lojas/casa-jambu-delivery` : `https://identitytoolkit.googleapis.com/admin/v2/projects/${projeto}/config`);
    return { getResponseCode: () => firestore ? 403 : 200, getContentText: () => JSON.stringify(firestore
      ? { error: { status: "PERMISSION_DENIED", message: "PAYLOAD-GOOGLE-PRIVADO", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED", metadata: { service: "firestore.googleapis.com", consumer: "projects/projeto-errado", privado: "DADO-NAO-PUBLICAR" } }] } }
      : { config: "CONFIG-AUTH-PRIVADA", documento: "USUARIO-PRIVADO" }) };
  };
  const resultado = f.contexto.diagnosticarPagamentos();
  assert.deepEqual(JSON.parse(JSON.stringify(resultado)), [
    { servico: "firestore", http: 403, codigo: "PERMISSION_DENIED", motivo: "SERVICE_DISABLED", api: "firestore.googleapis.com", projetoCorreto: false },
    { servico: "auth", http: 200 },
  ]);
  assert.equal(chamadas.length, 2); assert.equal(f.logs.length, 1);
  const saida = JSON.stringify([resultado, f.logs]);
  for (const privado of [googleToken, "PAYLOAD-GOOGLE-PRIVADO", "DADO-NAO-PUBLICAR", "CONFIG-AUTH-PRIVADA", "USUARIO-PRIVADO", "projects/projeto-errado", "https://"]) assert.equal(saida.includes(privado), false);
});

test("diagnóstico continua após exceção e reconhece projeto correto sem expor metadados", () => {
  const f = fixture(); let chamadas = 0;
  f.contexto.UrlFetchApp.fetch = () => {
    if (++chamadas === 1) throw new Error(`ERRO-PRIVADO ${googleToken}`);
    return { getResponseCode: () => 403, getContentText: () => JSON.stringify({ error: { status: "PERMISSION_DENIED", details: [
      { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED", metadata: { consumer: "projects/308771638053", service: "destino-nao-permitido" } },
    ] } }) };
  };
  const resultado = JSON.parse(JSON.stringify(f.contexto.diagnosticarPagamentos()));
  assert.equal(chamadas, 2);
  assert.deepEqual(resultado[0], { servico: "firestore", http: 0, codigo: "", motivo: "", api: "", projetoCorreto: false });
  assert.deepEqual(resultado[1], { servico: "auth", http: 403, codigo: "PERMISSION_DENIED", motivo: "SERVICE_DISABLED", api: "", projetoCorreto: true });
  assert.doesNotMatch(JSON.stringify(f.logs), /ERRO-PRIVADO|OAUTH-GOOGLE|308771638053|destino-nao-permitido/);
});

test("diagnóstico com sucesso não lê documentos nem configuração", () => {
  const f = fixture(); let leituras = 0;
  f.contexto.UrlFetchApp.fetch = () => ({ getResponseCode: () => 200, getContentText: () => { leituras++; return JSON.stringify({ usuario: "USUARIO-PRIVADO", config: "CONFIG-PRIVADA" }); } });
  assert.deepEqual(JSON.parse(JSON.stringify(f.contexto.diagnosticarPagamentos())), [{ servico: "firestore", http: 200 }, { servico: "auth", http: 200 }]);
  assert.equal(leituras, 0); assert.doesNotMatch(JSON.stringify(f.logs), /USUARIO-PRIVADO|CONFIG-PRIVADA|OAUTH-GOOGLE/);
});

test("diagnóstico não é uma rota web", () => {
  const f = fixture();
  assert.equal(f.jsonSaida(f.get({ rota: "diagnosticar" })).erro.codigo, "VALIDACAO");
  assert.equal(f.post({ rota: "diagnosticar" }).erro.codigo, "VALIDACAO");
  assert.equal(f.chamadas.length, 0); assert.equal(f.logs.length, 0);
});

test("bundle carrega sem nativos Node e fornece URL pelo core-js", () => {
  const f = fixture();
  assert.equal(vm.runInContext('typeof URL + ":" + typeof URLSearchParams', f.contexto), "function:function");
  assert.equal(vm.runInContext('new URL("painel.html", "https://exemplo.test/app/").href', f.contexto), "https://exemplo.test/app/painel.html");
  for (const nome of ["crypto", "Buffer", "AbortSignal", "process", "require", "setTimeout", "setInterval", "setImmediate"]) assert.equal(vm.runInContext(`typeof ${nome}`, f.contexto), "undefined");
  assert.equal(f.chamadas.length, 0);
});
test("health JSON desligado não consulta rede nem segredos", () => {
  const f = fixture(), r = f.jsonSaida(f.get());
  assert.deepEqual(r, { ok: true, data: { servico: "DeliveryMenu pagamentos", ativo: false } });
  assert.equal(f.chamadas.length, 0); assert.equal(f.googleTokens(), 0);
  assert.deepEqual(f.reads, ["PAGAMENTOS_ATIVOS"]); assert.equal(f.logs.length, 0);
});
test("JSON malformado, array, rota inválida e corpo grande falham sem IO", () => {
  const f = fixture();
  for (const body of ['{"segredo":"DADO-NAO-PUBLICAR"', [], { rota: "apagar" }, "x".repeat(100001)]) {
    const r = f.post(body); assert.equal(r.ok, false); assert.equal(JSON.stringify(r).includes("DADO-NAO-PUBLICAR"), false);
  }
  assert.equal(f.chamadas.length, 0); assert.equal(f.googleTokens(), 0);
});
test("rota webhook só entra pelo retorno configurado, não pelo corpo do cliente", () => {
  const f = fixture(); assert.equal(f.post({ rota: "webhook" }).erro.codigo, "VALIDACAO");
  assert.equal(f.chamadas.length, 0);
});
test("desativado rejeita checkout antes de autenticação, Firestore e Mercado Pago", () => {
  const f = fixture(); const r = f.post({ rota: "checkout", lojaId: "loja-teste", pedidoId: "pedido-aleatorio-1234567890", pedido: {} });
  assert.equal(r.erro.codigo, "PAGAMENTO_DESATIVADO"); assert.equal(f.chamadas.length, 0); assert.equal(f.googleTokens(), 0);
});
test("status exige token; inválido e usuário desativado não chegam ao banco", () => {
  const f = fixture(); assert.equal(f.post({ rota: "status", lojaId: "loja-teste" }).erro.codigo, "NAO_AUTENTICADO"); assert.equal(f.chamadas.length, 0);
  for (const opcoes of [{ identidadeErro: true }, { disabled: true }]) {
    const x = fixture(opcoes), r = x.post({ rota: "status", lojaId: "loja-teste", token: clienteJWT });
    assert.equal(r.erro.codigo, "NAO_AUTENTICADO"); assert.equal(x.chamadas.length, 1); assert.equal(x.googleTokens(), 0);
    assert.equal(JSON.stringify(r).includes("DETALHE-PRIVADO-IDENTIDADE"), false);
  }
});
test("status do dono usa OAuth do script no banco e nunca põe JWT na URL", () => {
  const f = fixture({ propriedades: ativo });
  const r = f.post({ rota: "status", lojaId: "loja-teste", token: clienteJWT });
  assert.deepEqual(r, { ok: true, data: { conectado: true, ativo: true, conta: "123" } });
  assert.ok(f.chamadas.some((c) => c.url.startsWith(firestoreBase)));
  for (const c of f.chamadas) assert.equal(c.url.includes(clienteJWT), false);
  for (const c of f.chamadas.filter((c) => c.url.startsWith(firestoreBase))) assert.equal(c.op.headers.Authorization, `Bearer ${googleToken}`);
});
test("status de outro restaurante é negado sem consultar a conta privada dele", () => {
  const f = fixture({ propriedades: ativo, lojaDono: "outro-dono" });
  const r = f.post({ rota: "status", lojaId: "loja-teste", token: clienteJWT });
  assert.equal(r.erro.codigo, "SEM_PERMISSAO");
  assert.equal(f.chamadas.some((c) => c.url.includes("integracoesPagamento/")), false);
});
test("App Check inválido impede acesso ao Firestore e ao pagamento", () => {
  const f = fixture({ propriedades: ativo });
  const r = f.post({ rota: "checkout", lojaId: "loja-teste", pedidoId: "pedido-aleatorio-1234567890", pedido: {}, appCheckToken: "JWT-APP-CHECK-INVALIDO" });
  assert.equal(r.erro.codigo, "APP_CHECK");
  assert.equal(f.chamadas.some((c) => c.url.startsWith(firestoreBase) || c.url.startsWith("https://api.mercadopago.com/")), false);
  assert.equal(f.chamadas.filter((c) => c.url === "https://firebaseappcheck.googleapis.com/v1/jwks").length, 1);
  f.post({ rota: "consultar", lojaId: "loja-teste", pedidoId: "pedido-aleatorio-1234567890", appCheckToken: "JWT-APP-CHECK-INVALIDO" });
  assert.equal(f.chamadas.filter((c) => c.url === "https://firebaseappcheck.googleapis.com/v1/jwks").length, 1, "JWKS em cache");
});
test("callback com erro devolve HTML fixo sem state, code, segredo ou erro interno", () => {
  const f = fixture(), r = f.get({ rota: "callback", state: "STATE-PRIVADO-NAO-EXIBIR", code: "CODE-PRIVADO-NAO-EXIBIR", error: "<script>ERRO-NAO-EXIBIR</script>" });
  assert.equal(r.kind, "html"); assert.equal(typeof r.then, "undefined");
  assert.match(r.html, /Não foi possível conectar a conta/);
  assert.ok(r.html.includes(`${frontend}painel.html?pagamento=erro#configuracoes`));
  for (const texto of ["STATE-PRIVADO", "CODE-PRIVADO", "ERRO-NAO-EXIBIR", "segredo-simulado"]) assert.equal(r.html.includes(texto), false);
  assert.equal(f.chamadas.length, 0); assert.equal(f.logs.length, 0);
});
test("GET só aceita health e callback; parâmetro não cria uma rota privada", () => {
  const f = fixture(); assert.equal(f.jsonSaida(f.get({ rota: "status", token: clienteJWT })).erro.codigo, "VALIDACAO"); assert.equal(f.chamadas.length, 0);
});
test("instalar rotina de cinco minutos é idempotente e não ativa pagamento", () => {
  const f = fixture();
  assert.equal(typeof f.contexto.configurarPagamentos(), "string"); assert.equal(typeof f.contexto.configurarPagamentos(), "string");
  assert.equal(f.instalacoes(), 1); assert.equal(f.triggers[0].getHandlerFunction(), "reconciliarPagamentos");
  assert.equal(f.valores.has("PAGAMENTOS_ATIVOS"), false); assert.equal(f.chamadas.length, 0);
  assert.equal(f.contexto.reconciliarPagamentos(), 0); assert.equal(f.chamadas.length, 0);
});
test("sem chave de proteção não cria state nem chama OAuth do Mercado Pago", () => {
  const propriedades = { ...ativo }; delete propriedades.MP_TOKENS_KEY;
  const f = fixture({ propriedades }), r = f.post({ rota: "conectar", lojaId: "loja-teste", token: clienteJWT });
  assert.equal(r.erro.codigo, "CONFIGURACAO");
  assert.equal([...f.docs.keys()].some((k) => k.startsWith("oauthPagamento/")), false);
  assert.equal(f.chamadas.some((c) => c.url.startsWith("https://api.mercadopago.com/")), false);
});
test("OAuth completo é síncrono, usa PKCE e cifra os tokens sem crypto Node", () => {
  const f = fixture({ propriedades: ativo, permitirMP: true });
  const inicio = f.post({ rota: "conectar", lojaId: "loja-teste", token: clienteJWT });
  assert.equal(inicio.ok, true); const url = new URL(inicio.data.url), state = url.searchParams.get("state");
  assert.equal(url.origin, "https://auth.mercadopago.com"); assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("redirect_uri"), `${scriptURL}?rota=callback`);
  const html = f.get({ rota: "callback", state, code: "codigo-simulado" });
  assert.equal(html.kind, "html"); assert.match(html.html, /Conta conectada/); assert.ok(html.html.includes("pagamento=conectado#configuracoes"));
  assert.match(html.html, /Pagamento online pausado/);
  assert.equal(f.docs.get("integracoesPagamento/loja-teste").ativo.booleanValue, false);
  assert.equal(f.docs.get("lojas/loja-teste").pagamentoOnline.mapValue.fields.ativo.booleanValue, false);
  const conta = f.docs.get("integracoesPagamento/loja-teste/contas/123"); assert.ok(conta.protegido.mapValue.fields.tag.stringValue);
  assert.equal(JSON.stringify(conta).includes("token-vendedor-simulado"), false);
  assert.equal(JSON.stringify(f.docs.get("lojas/loja-teste")).includes("token-vendedor-simulado"), false);
  assert.equal(JSON.stringify(f.logs).includes("token-vendedor-simulado"), false);
  for (const c of f.chamadas) for (const valor of [clienteJWT, "segredo-simulado", "token-vendedor-simulado", "codigo-simulado"]) assert.equal(c.url.includes(valor), false);
  const oauth = f.chamadas.find((c) => c.url === "https://api.mercadopago.com/oauth/token"); assert.equal(oauth.body.redirect_uri, `${scriptURL}?rota=callback`); assert.ok(oauth.body.code_verifier);
  const antes = f.chamadas.filter((c) => c.url === "https://api.mercadopago.com/oauth/token").length;
  const repetido = f.get({ rota: "callback", state, code: "codigo-simulado" }); assert.match(repetido.html, /Não foi possível/);
  assert.equal(f.chamadas.filter((c) => c.url === "https://api.mercadopago.com/oauth/token").length, antes);
});

function contaConectada() {
  const f = fixture({ propriedades: ativo, permitirMP: true });
  const inicio = f.post({ rota: "conectar", lojaId: "loja-teste", token: clienteJWT });
  const state = new URL(inicio.data.url).searchParams.get("state");
  assert.match(f.get({ rota: "callback", state, code: "codigo-simulado" }).html, /Conta conectada/);
  return f;
}
test("ativar valida provedor fora de transação e rejeita corrida de conta ou versão", () => {
  for (const corrida of ["nenhuma", "conta", "versao", "id-provedor"]) {
    const f = contaConectada(), fetch = f.contexto.UrlFetchApp.fetch; let transacao = false, validacoes = 0;
    f.contexto.UrlFetchApp.fetch = (url, op) => {
      if (url === `${firestoreBase}:beginTransaction`) transacao = true;
      if (url === "https://api.mercadopago.com/users/me") {
        assert.equal(transacao, false); validacoes++;
        if (corrida === "conta") f.docs.get("integracoesPagamento/loja-teste").contaId.stringValue = "456";
        if (corrida === "versao") f.docs.get("integracoesPagamento/loja-teste/contas/123").versao.stringValue = "versao-nova";
        if (corrida === "id-provedor") return { getResponseCode: () => 200, getContentText: () => '{"id":456}' };
      }
      const resultado = fetch(url, op);
      if ([`${firestoreBase}:commit`, `${firestoreBase}:rollback`].includes(url)) transacao = false;
      return resultado;
    };
    const r = f.post({ rota: "ativar", lojaId: "loja-teste", token: clienteJWT });
    assert.equal(validacoes, 1);
    if (corrida === "nenhuma") assert.equal(r.data.ativo, true);
    else { assert.equal(r.erro.codigo, "RECONECTAR"); assert.equal(f.docs.get("integracoesPagamento/loja-teste").ativo.booleanValue, false); }
  }
});

test("credencial revogada exige reconexão; erro transitório preserva conta e troca OAuth", () => {
  for (const caso of ["401", "invalid_grant", "transitorio", "troca-conta", "troca-versao"]) {
    const f = contaConectada(), fetch = f.contexto.UrlFetchApp.fetch;
    f.docs.get("integracoesPagamento/loja-teste").ativo.booleanValue = true;
    f.contexto.UrlFetchApp.fetch = (url, op) => {
      if (url !== "https://api.mercadopago.com/users/me") return fetch(url, op);
      if (caso === "troca-conta") f.docs.get("integracoesPagamento/loja-teste").contaId.stringValue = "456";
      if (caso === "troca-versao") f.docs.get("integracoesPagamento/loja-teste/contas/123").versao.stringValue = "nova-versao";
      return { getResponseCode: () => caso === "transitorio" ? 503 : caso === "invalid_grant" ? 400 : 401,
        getContentText: () => JSON.stringify({ error: caso === "invalid_grant" ? "invalid_grant" : "erro_simulado", message: "NAO-EXIBIR" }) };
    };
    const r = f.post({ rota: "ativar", lojaId: "loja-teste", token: clienteJWT });
    assert.equal(r.ok, false);
    const revogado = ["401", "invalid_grant"].includes(caso);
    assert.equal(f.docs.get("integracoesPagamento/loja-teste/contas/123").reconectar.booleanValue, revogado);
    assert.equal(f.docs.get("integracoesPagamento/loja-teste").ativo.booleanValue, !revogado);
    if (revogado) {
      assert.equal(f.post({ rota: "status", lojaId: "loja-teste", token: clienteJWT }).data.conectado, false);
      assert.equal(f.docs.get("lojas/loja-teste").pagamentoOnline.mapValue.fields.ativo.booleanValue, false);
    }
    assert.doesNotMatch(JSON.stringify([r, f.logs]), /NAO-EXIBIR|token-vendedor-simulado/);
  }
});

test("status renova conta normal ativa; clone vencido é pausado sem renovar", () => {
  const normal = contaConectada();
  normal.docs.get("integracoesPagamento/loja-teste/contas/123").expiresAt.timestampValue = new Date(Date.now() - 1000).toISOString();
  normal.docs.get("integracoesPagamento/loja-teste").ativo.booleanValue = true;
  const antes = normal.chamadas.filter((c) => c.url.endsWith("/oauth/token")).length;
  assert.deepEqual(normal.post({ rota: "status", lojaId: "loja-teste", token: clienteJWT }).data, { conectado: true, ativo: true, conta: "123" });
  assert.equal(normal.chamadas.filter((c) => c.url.endsWith("/oauth/token")).length, antes + 1);
  assert.equal(normal.post({ rota: "ativar", lojaId: "loja-teste", token: clienteJWT }).data.ativo, true);
  assert.equal(normal.chamadas.filter((c) => c.url.endsWith("/oauth/token")).length, antes + 1);
  const { f, id } = homologacaoFixture(); f.contexto.prepararHomologacaoPagamentos();
  f.docs.get(`integracoesPagamento/${id}/contas/123`).expiresAt.timestampValue = new Date(Date.now() - 1000).toISOString();
  assert.deepEqual(f.post({ rota: "status", lojaId: id, token: clienteJWT }).data, { conectado: false, ativo: false, conta: "123" });
  assert.equal(f.docs.get(`integracoesPagamento/${id}`).ativo.booleanValue, false);
  assert.equal(f.docs.get(`lojas/${id}`).pagamentoOnline.mapValue.fields.ativo.booleanValue, false);
  assert.equal(f.post({ rota: "ativar", lojaId: id, token: clienteJWT }).erro.codigo, "RECONECTAR");
  assert.equal(f.chamadas.some((c) => c.url.startsWith("https://api.mercadopago.com/")), false);
});

test("status conserva pausa, retorna erro transitório e reflete revogação confirmada", () => {
  for (const caso of ["pausada", "transitorio", "revogada", "troca-conta"]) {
    const f = contaConectada(), fetch = f.contexto.UrlFetchApp.fetch;
    f.docs.get("integracoesPagamento/loja-teste/contas/123").expiresAt.timestampValue = new Date(Date.now() - 1000).toISOString();
    f.docs.get("integracoesPagamento/loja-teste").ativo.booleanValue = caso !== "pausada";
    f.contexto.UrlFetchApp.fetch = (url, op) => {
      if (url !== "https://api.mercadopago.com/oauth/token") return fetch(url, op);
      if (caso === "troca-conta") f.seed("integracoesPagamento/loja-teste", { contaId: "456", ativo: false });
      return { getResponseCode: () => caso === "transitorio" ? 503 : 400,
        getContentText: () => JSON.stringify({ error: caso === "transitorio" ? "temporarily_unavailable" : "invalid_grant" }) };
    };
    const antes = f.chamadas.length, r = f.post({ rota: "status", lojaId: "loja-teste", token: clienteJWT });
    if (caso === "transitorio" || caso === "troca-conta") {
      assert.equal(r.ok, false); assert.equal(r.erro.codigo, "ERRO_PROVEDOR");
      assert.equal(f.docs.get("integracoesPagamento/loja-teste/contas/123").reconectar.booleanValue, false);
      if (caso === "transitorio") assert.equal(f.docs.get("integracoesPagamento/loja-teste").ativo.booleanValue, true);
    } else {
      assert.deepEqual(r.data, { conectado: caso === "pausada", ativo: false, conta: "123" });
      if (caso === "pausada") assert.equal(f.chamadas.slice(antes).some((c) => c.url.startsWith("https://api.mercadopago.com/")), false);
      else assert.equal(f.docs.get("integracoesPagamento/loja-teste/contas/123").reconectar.booleanValue, true);
    }
  }
});

test("refresh revogado pausa somente a mesma conexão; falha transitória permite retry", () => {
  for (const caso of ["401", "invalid_grant", "transitorio", "troca-conta"]) {
    const f = contaConectada(), fetch = f.contexto.UrlFetchApp.fetch;
    f.docs.get("integracoesPagamento/loja-teste/contas/123").expiresAt.timestampValue = new Date(Date.now() - 1000).toISOString();
    f.docs.get("integracoesPagamento/loja-teste").ativo.booleanValue = true;
    f.contexto.UrlFetchApp.fetch = (url, op) => {
      if (url !== "https://api.mercadopago.com/oauth/token") return fetch(url, op);
      if (caso === "troca-conta") f.docs.get("integracoesPagamento/loja-teste").contaId.stringValue = "456";
      return { getResponseCode: () => caso === "transitorio" ? 503 : caso === "invalid_grant" ? 400 : 401,
        getContentText: () => JSON.stringify({ error: caso === "invalid_grant" ? "invalid_grant" : "erro_simulado" }) };
    };
    assert.equal(f.post({ rota: "ativar", lojaId: "loja-teste", token: clienteJWT }).ok, false);
    const revogado = ["401", "invalid_grant"].includes(caso), conta = f.docs.get("integracoesPagamento/loja-teste/contas/123");
    assert.equal(conta.reconectar.booleanValue, revogado); assert.equal(conta.refreshLease.nullValue, null);
    assert.equal(f.docs.get("integracoesPagamento/loja-teste").ativo.booleanValue, !revogado);
    if (caso === "transitorio") {
      f.contexto.UrlFetchApp.fetch = fetch;
      assert.equal(f.post({ rota: "ativar", lojaId: "loja-teste", token: clienteJWT }).data.ativo, true);
    }
  }
});

test("reuso da homologação protege renovação do clone sem alterar origem ou histórico", () => {
  const { f, id } = homologacaoFixture(); f.contexto.prepararHomologacaoPagamentos();
  const path = `integracoesPagamento/${id}/contas/123`;
  assert.equal(f.docs.get(path).renovacaoBloqueada.booleanValue, true);
  delete f.docs.get(path).renovacaoBloqueada;
  f.seed(`lojas/${id}/pedidosEntrada/historico-preservado`, { total: 500 });
  const antes = new Map([...f.docs].map(([k, v]) => [k, JSON.stringify(v)]));
  f.contexto.prepararHomologacaoPagamentos();
  assert.equal(f.docs.get(path).renovacaoBloqueada.booleanValue, true);
  for (const [k, v] of antes) if (k !== path) assert.equal(JSON.stringify(f.docs.get(k)), v);
});

test("dono A não ativa loja B nem consulta credencial ou provedor dela", () => {
  const f = contaConectada();
  f.seed("lojas/loja-b", { donoId: "dono-b", pagamentoOnline: { ativo: false } });
  f.seed("integracoesPagamento/loja-b", { contaId: "123", ativo: false });
  const antes = JSON.stringify([...f.docs]), chamadas = f.chamadas.length;
  assert.equal(f.post({ rota: "ativar", lojaId: "loja-b", token: clienteJWT }).erro.codigo, "SEM_PERMISSAO");
  assert.equal(JSON.stringify([...f.docs]), antes);
  const novas = f.chamadas.slice(chamadas);
  assert.equal(novas.some((c) => c.url.includes("integracoesPagamento/loja-b") || c.url.startsWith("https://api.mercadopago.com/")), false);
});

test("ativação explícita exige autenticação/membro, é repetível e pausa preserva a conta", () => {
  const f = contaConectada(), body = { rota: "ativar", lojaId: "loja-teste", token: clienteJWT };
  assert.equal(f.post({ ...body, token: undefined }).erro.codigo, "NAO_AUTENTICADO");
  f.seed("lojas/outra-loja", { donoId: "outro-dono", pagamentoOnline: { ativo: false } });
  assert.equal(f.post({ ...body, lojaId: "outra-loja" }).erro.codigo, "SEM_PERMISSAO");
  const privado = JSON.stringify(f.docs.get("integracoesPagamento/loja-teste/contas/123"));
  for (let i = 0; i < 2; i++) assert.deepEqual(f.post(body), { ok: true, data: { ativo: true } });
  assert.equal(f.docs.get("integracoesPagamento/loja-teste").ativo.booleanValue, true);
  assert.equal(f.docs.get("lojas/loja-teste").pagamentoOnline.mapValue.fields.ativo.booleanValue, true);
  assert.deepEqual(f.post({ ...body, rota: "pausar" }), { ok: true, data: { ativo: false } });
  assert.equal(JSON.stringify(f.docs.get("integracoesPagamento/loja-teste/contas/123")), privado);
  assert.equal(JSON.stringify(f.docs.get("lojas/loja-teste")).includes("token-vendedor-simulado"), false);
});
test("ativar rejeita conta ausente, revogada, trocada ou cifrada para outra loja", () => {
  const body = { rota: "ativar", lojaId: "loja-teste", token: clienteJWT };
  for (const mudar of [
    (f) => f.docs.delete("integracoesPagamento/loja-teste/contas/123"),
    (f) => { f.docs.get("integracoesPagamento/loja-teste/contas/123").reconectar = { booleanValue: true }; },
    (f) => { f.docs.get("integracoesPagamento/loja-teste").contaId = { stringValue: "456" }; },
    (f) => { f.docs.get("integracoesPagamento/loja-teste/contas/123").protegido.mapValue.fields.tag = { stringValue: "invalida" }; },
  ]) {
    const f = contaConectada(); mudar(f);
    assert.equal(f.post(body).erro.codigo, "RECONECTAR");
    assert.equal(f.docs.get("lojas/loja-teste").pagamentoOnline.mapValue.fields.ativo.booleanValue, false);
    assert.equal(f.docs.get("integracoesPagamento/loja-teste").ativo.booleanValue, false);
  }
  const f = contaConectada();
  f.seed("lojas/outra-loja", { donoId: "dono", pagamentoOnline: { ativo: false } });
  f.seed("integracoesPagamento/outra-loja", { contaId: "123", ativo: false });
  f.docs.set("integracoesPagamento/outra-loja/contas/123", structuredClone(f.docs.get("integracoesPagamento/loja-teste/contas/123")));
  assert.equal(f.post({ ...body, lojaId: "outra-loja" }).erro.codigo, "RECONECTAR");
  assert.equal(f.docs.get("lojas/outra-loja").pagamentoOnline.mapValue.fields.ativo.booleanValue, false);
});
test("OAuth sem client secret falha antes de enviar o código ao provedor", () => {
  const propriedades = { ...ativo }; delete propriedades.MP_CLIENT_SECRET;
  const f = fixture({ propriedades });
  const inicio = f.post({ rota: "conectar", lojaId: "loja-teste", token: clienteJWT });
  if (inicio.ok) {
    const state = new URL(inicio.data.url).searchParams.get("state");
    const fim = f.get({ rota: "callback", state, code: "codigo-simulado" });
    assert.match(fim.html, /Não foi possível/);
  } else assert.equal(inicio.erro.codigo, "CONFIGURACAO");
  assert.equal(f.chamadas.some((c) => c.url.startsWith("https://api.mercadopago.com/")), false);
});
test("erro do OAuth não aparece no HTML, nos logs ou na URL de retorno", () => {
  const f = fixture({ propriedades: ativo, permitirMP: true, mpFalha: true });
  const inicio = f.post({ rota: "conectar", lojaId: "loja-teste", token: clienteJWT });
  const state = new URL(inicio.data.url).searchParams.get("state");
  const fim = f.get({ rota: "callback", state, code: "codigo-simulado" });
  assert.match(fim.html, /Não foi possível/);
  for (const texto of [state, "codigo-simulado", "segredo-simulado", "ERRO-PROVEDOR-NAO-EXIBIR", "invalid_grant"]) {
    assert.equal(fim.html.includes(texto), false); assert.equal(JSON.stringify(f.logs).includes(texto), false);
  }
});
