import test from "node:test";
import assert from "node:assert/strict";
import { criarFirestoreRest, SERVER_TIMESTAMP } from "./firestore.js?v=1";

const base = "https://firestore.googleapis.com/v1/projects/projeto-teste/databases/(default)/documents";
const prefixo = "projects/projeto-teste/databases/(default)/documents/";
function fixture(passos, options = {}) {
  const calls = [];
  const db = criarFirestoreRest({ projectId: "projeto-teste", ...options, request(url, req) {
    calls.push({ url, ...req });
    const passo = passos.shift(); assert.ok(passo, `Chamada inesperada: ${url}`);
    assert.equal(url, passo.url || base + passo.rota); assert.equal(req.method, passo.method || "POST");
    if (passo.body) assert.deepEqual(req.body, passo.body);
    if (passo.conferir) passo.conferir(req.body);
    if (passo.erro) throw passo.erro;
    return passo.resposta ?? {};
  } });
  return { db, calls, done() { assert.equal(passos.length, 0, "Chamadas esperadas não realizadas"); } };
}
const documento = (path, fields = {}) => ({ name: prefixo + path, fields });

test("codec preserva mapas, arrays, números, null, boolean e Date", () => {
  let fields;
  const dados = { nome: "Loja", ativa: true, contador: 7, taxa: 1.25, falta: null, data: new Date("2026-10-27T03:00:00Z"), mapa: { vazio: {}, lista: ["a", 2, false, null, { x: 4 }] } };
  const f = fixture([
    { rota: ":commit", conferir: (body) => { fields = body.writes[0].update.fields; assert.deepEqual(fields.contador, { integerValue: "7" }); assert.deepEqual(fields.taxa, { doubleValue: 1.25 }); } },
    { rota: "/lojas/a", method: "GET", get resposta() { return documento("lojas/a", fields); } },
  ]);
  f.db.doc("lojas/a").set(dados);
  const snap = f.db.doc("lojas/a").get(); assert.equal(snap.exists, true); assert.equal(snap.id, "a"); assert.equal(snap.ref.path, "lojas/a");
  assert.deepEqual(snap.data(), dados); f.done();
});
for (const [nome, valor] of [["undefined", undefined], ["NaN", NaN], ["Infinity", Infinity], ["Date inválida", new Date(NaN)]]) {
  test(`não envia ${nome}`, () => { const f = fixture([]); assert.throws(() => f.db.doc("lojas/a").set({ x: { valor } })); assert.equal(f.calls.length, 0); });
}
test("documento inexistente devolve exists false e data undefined", () => {
  const f = fixture([{ rota: "/lojas/ausente", method: "GET", erro: { status: 404 } }]); const snap = f.db.doc("lojas/ausente").get(); assert.equal(snap.exists, false); assert.equal(snap.data(), undefined); f.done();
});
test("não converte erro de acesso em documento inexistente", () => {
  const erro = { status: 403 }, f = fixture([{ rota: "/lojas/a", method: "GET", erro }]); assert.throws(() => f.db.doc("lojas/a").get(), (e) => e === erro); f.done();
});
test("carimbo de servidor aninhado vira transform sem serializar sentinela", () => {
  const f = fixture([{ rota: ":commit", body: { writes: [{ update: { name: prefixo + "lojas/a", fields: { pagamento: { mapValue: { fields: { pago: { booleanValue: true } } } } } }, updateMask: { fieldPaths: ["pagamento.pago"] }, updateTransforms: [{ fieldPath: "pagamento.confirmadoEm", setToServerValue: "REQUEST_TIME" }] }] } }]);
  f.db.doc("lojas/a").set({ pagamento: { pago: true, confirmadoEm: SERVER_TIMESTAMP } }, { merge: true }); f.done();
});
test("merge somente com carimbo não mascara os campos irmãos", () => {
  const f = fixture([{ rota: ":commit", conferir: ({ writes: [w] }) => { assert.deepEqual(w.updateMask, { fieldPaths: [] }); assert.deepEqual(w.updateTransforms, [{ fieldPath: "atualizadoEm", setToServerValue: "REQUEST_TIME" }]); assert.deepEqual(w.update.fields, {}); } }]);
  f.db.doc("lojas/a").set({ atualizadoEm: SERVER_TIMESTAMP }, { merge: true }); f.done();
});
test("carimbo alternativo funciona e carimbo em array é recusado", () => {
  const marca = Object.freeze({ marca: true });
  const f = fixture([{ rota: ":commit", conferir: (b) => assert.equal(b.writes[0].updateTransforms[0].fieldPath, "data") }], { carimbo: () => marca });
  f.db.doc("lojas/a").set({ data: marca }); f.done();
  assert.throws(() => f.db.doc("lojas/a").set({ array: [SERVER_TIMESTAMP] }));
  assert.throws(() => f.db.doc("lojas/a").set({ array: [{ data: SERVER_TIMESTAMP }] }));
});
test("merge usa caminhos das folhas, preservando mapas vazios e arrays", () => {
  const f = fixture([{ rota: ":commit", conferir: ({ writes: [w] }) => assert.deepEqual(w.updateMask.fieldPaths, ["a.b", "a.c", "vazio", "lista"]) }]);
  f.db.doc("lojas/a").set({ a: { b: 1, c: true }, vazio: {}, lista: [1, 2] }, { merge: true }); f.done();
});
test("update com ponto usa máscara e precondição de existência", () => {
  const f = fixture([{ rota: ":commit", body: { writes: [{ update: { name: prefixo + "lojas/a", fields: { pagamento: { mapValue: { fields: { pago: { booleanValue: true } } } } } }, updateMask: { fieldPaths: ["pagamento.pago"] }, updateTransforms: [{ fieldPath: "pagamento.quando", setToServerValue: "REQUEST_TIME" }], currentDocument: { exists: true } }] } }]);
  f.db.doc("lojas/a").update({ "pagamento.pago": true, "pagamento.quando": SERVER_TIMESTAMP }); f.done();
});
test("update de mapa substitui esse mapa; set literal com ponto recebe escape", () => {
  const f = fixture([
    { rota: ":commit", conferir: ({ writes: [w] }) => assert.deepEqual(w.updateMask.fieldPaths, ["mapa"]) },
    { rota: ":commit", conferir: ({ writes: [w] }) => { assert.deepEqual(w.updateMask.fieldPaths, ["`a.b`"]); assert.ok(w.update.fields["a.b"]); } },
  ]);
  f.db.doc("lojas/a").update({ mapa: { x: 1 } }); f.db.doc("lojas/a").set({ "a.b": 1 }, { merge: true }); f.done();
});
test("delete usa operação delete no commit", () => {
  const f = fixture([{ rota: ":commit", body: { writes: [{ delete: prefixo + "lojas/a" }] } }]); f.db.doc("lojas/a").delete(); f.done();
});
test("consulta de subcoleção usa parent correto, filtros AND e limite", () => {
  const quando = new Date("2026-10-27T03:00:00Z");
  const f = fixture([{ rota: "/lojas/a:runQuery", body: { structuredQuery: { from: [{ collectionId: "pedidos" }], where: { compositeFilter: { op: "AND", filters: [
    { fieldFilter: { field: { fieldPath: "finalizado" }, op: "EQUAL", value: { booleanValue: false } } },
    { fieldFilter: { field: { fieldPath: "expiresAt" }, op: "LESS_THAN_OR_EQUAL", value: { timestampValue: quando.toISOString() } } },
  ] } }, limit: 50 } }, resposta: [{ document: documento("lojas/a/pedidos/p1", { n: { integerValue: "2" } }) }, { readTime: "ignorado" }] }]);
  const snap = f.db.collection("lojas/a/pedidos").where("finalizado", "==", false).where("expiresAt", "<=", quando).limit(50).get();
  assert.equal(snap.size, 1); assert.equal(snap.empty, false); assert.equal(snap.docs[0].exists, true); assert.deepEqual(snap.docs[0].data(), { n: 2 }); f.done();
});
test("consulta vazia e encadeamento não alteram consulta original", () => {
  const f = fixture([{ rota: ":runQuery", body: { structuredQuery: { from: [{ collectionId: "lojas" }] } }, resposta: [{}] }]);
  const q = f.db.collection("lojas"); q.where("ativo", "==", true).limit(1); const snap = q.get(); assert.equal(snap.empty, true); f.done();
});
test("transação usa mesmo id nos documentos, consulta e commit único", () => {
  const f = fixture([
    { rota: ":beginTransaction", resposta: { transaction: "tx-1" } },
    { rota: ":batchGet", body: { documents: [prefixo + "lojas/a"], transaction: "tx-1" }, resposta: [{ found: documento("lojas/a", { contador: { integerValue: "7" } }) }] },
    { rota: ":batchGet", body: { documents: [prefixo + "lojas/ausente"], transaction: "tx-1" }, resposta: [{ missing: prefixo + "lojas/ausente" }] },
    { rota: "/lojas/a:runQuery", conferir: (b) => assert.equal(b.transaction, "tx-1"), resposta: [] },
    { rota: ":commit", conferir: (b) => {
      assert.equal(b.transaction, "tx-1"); assert.equal(b.writes.length, 4);
      assert.deepEqual(b.writes[0].currentDocument, { exists: false }); assert.deepEqual(b.writes[2].currentDocument, { exists: true });
      assert.deepEqual(b.writes[3], { delete: prefixo + "lojas/z" });
    } },
  ]);
  const resultado = f.db.runTransaction((tx) => {
    const loja = tx.get(f.db.doc("lojas/a")); assert.equal(tx.get(f.db.doc("lojas/ausente")).exists, false);
    assert.equal(tx.get(f.db.collection("lojas/a/pedidos").limit(1)).size, 0);
    tx.create(f.db.doc("lojas/novo"), { nome: "Nova" }); tx.set(f.db.doc("lojas/b"), { n: 1 });
    tx.update(f.db.doc("lojas/a"), { contador: loja.data().contador + 1 }); tx.delete(f.db.doc("lojas/z")); return "feito";
  });
  assert.equal(resultado, "feito"); f.done();
});
test("erro do callback faz rollback, sem commit", () => {
  const erro = new Error("Falha de regra de negócio"), f = fixture([{ rota: ":beginTransaction", resposta: { transaction: "tx" } }, { rota: ":rollback", body: { transaction: "tx" } }]);
  assert.throws(() => f.db.runTransaction(() => { throw erro; }), (e) => e === erro); f.done();
});
test("leitura depois de escrita e callback async são recusados com rollback", () => {
  for (const callback of [(db, tx) => { tx.set(db.doc("lojas/a"), { n: 1 }); tx.get(db.doc("lojas/b")); }, () => Promise.resolve(1)]) {
    const f = fixture([{ rota: ":beginTransaction", resposta: { transaction: "tx" } }, { rota: ":rollback", body: { transaction: "tx" } }]);
    assert.throws(() => f.db.runTransaction((tx) => callback(f.db, tx))); f.done();
  }
});
test("ABORTED409 repete com nova transação e novas leituras", () => {
  let callbacks = 0;
  const f = fixture([
    { rota: ":beginTransaction", resposta: { transaction: "tx-1" } },
    { rota: ":batchGet", resposta: [{ found: documento("lojas/a", { contador: { integerValue: "1" } }) }] },
    { rota: ":commit", erro: { status: 409, code: "ABORTED" } }, { rota: ":rollback", body: { transaction: "tx-1" } },
    { rota: ":beginTransaction", resposta: { transaction: "tx-2" } },
    { rota: ":batchGet", body: { documents: [prefixo + "lojas/a"], transaction: "tx-2" }, resposta: [{ found: documento("lojas/a", { contador: { integerValue: "10" } }) }] },
    { rota: ":commit", conferir: (b) => { assert.equal(b.transaction, "tx-2"); assert.equal(b.writes[0].update.fields.contador.integerValue, "11"); assert.equal(b.writes.length, 1); } },
  ]);
  assert.equal(f.db.runTransaction((tx) => { callbacks++; const n = tx.get(f.db.doc("lojas/a")).data().contador + 1; tx.update(f.db.doc("lojas/a"), { contador: n }); return n; }), 11);
  assert.equal(callbacks, 2); f.done();
});
test("no máximo três tentativas para ABORTED409", () => {
  const erro = { status: 409, error: { status: "ABORTED" } }, passos = [];
  for (let n = 1; n <= 3; n++) passos.push({ rota: ":beginTransaction", resposta: { transaction: `tx${n}` } }, { rota: ":commit", erro }, { rota: ":rollback", body: { transaction: `tx${n}` } });
  const f = fixture(passos); assert.throws(() => f.db.runTransaction(() => 1), (e) => e === erro); assert.equal(f.calls.length, 9); f.done();
});
for (const erro of [{ status: 409, code: "ALREADY_EXISTS" }, { status: 409 }, { status: 503, code: "ABORTED" }, { status: 403 }]) {
  test(`erro ${erro.status}/${erro.code || "sem código"} não repete`, () => {
    const f = fixture([{ rota: ":beginTransaction", resposta: { transaction: "tx" } }, { rota: ":commit", erro }, { rota: ":rollback", erro: { status: 503 } }]);
    assert.throws(() => f.db.runTransaction(() => 1), (e) => e === erro); f.done();
  });
}
test("valida caminhos, limite e operador antes de chamar rede", () => {
  const f = fixture([]);
  for (const p of ["lojas", "lojas/a/", "lojas/../pedidos/a"]) assert.throws(() => f.db.doc(p));
  assert.throws(() => f.db.collection("lojas/a")); assert.throws(() => f.db.collection("lojas").limit(0));
  assert.throws(() => f.db.collection("lojas").where("x", ">", 1)); assert.throws(() => f.db.doc("lojas/a").update({ "a..b": 1 }));
  assert.equal(f.calls.length, 0);
});
test("baseUrl e caracteres no id são codificados", () => {
  const f = fixture([{ url: "http://local/REST/lojas/Ol%C3%A1%20mundo", method: "GET", resposta: documento("lojas/Olá mundo") }], { baseUrl: "http://local/REST/" });
  assert.equal(f.db.doc("lojas/Olá mundo").get().id, "Olá mundo"); f.done();
});
