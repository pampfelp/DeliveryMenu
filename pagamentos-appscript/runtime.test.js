import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
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
  seed("integracoesPagamento/loja-teste/contas/123", { protegido: { iv: "simulado", texto: "simulado", tag: "simulado" }, reconectar: false });
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
