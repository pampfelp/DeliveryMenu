// Teste local das regras de pagamento. Usa apenas o Firestore Emulator.
// URL e projeto são fixos; este arquivo não aceita destino externo.
import assert from "node:assert/strict";

const root = "http://127.0.0.1:8080/v1/projects/cardapio-delivery-ae048/databases/(default)/documents";
const prefix = "projects/cardapio-delivery-ae048/databases/(default)/documents/";
const sufixo = Date.now().toString(36);
const loja = `pag-teste-${sufixo}`;
const outraLoja = `pag-outra-${sufixo}`;
const donoUid = `pag-dono-${sufixo}`;
const equipeEmail = `equipe-${sufixo}@pagamento.test`;
const equipeUid = `pag-equipe-${sufixo}`;
const outroUid = `pag-outro-${sufixo}`;

const jwt = (uid, email) => `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify({
  sub: uid, user_id: uid, email, aud: "cardapio-delivery-ae048",
  iss: "https://securetoken.google.com/cardapio-delivery-ae048",
  iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
  firebase: { sign_in_provider: "password" },
})).toString("base64url")}.`;
const dono = jwt(donoUid, `dono-${sufixo}@pagamento.test`);
const equipe = jwt(equipeUid, equipeEmail);
const outro = jwt(outroUid, `outro-${sufixo}@pagamento.test`);

const enc = (v) => v === null ? { nullValue: null }
  : v instanceof Date ? { timestampValue: v.toISOString() }
    : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
      : typeof v === "object" ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } }
        : typeof v === "boolean" ? { booleanValue: v }
          : typeof v === "number" ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
            : { stringValue: v };
const fields = (data) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)]));
const docName = (path) => prefix + path;
const write = (path, data, stamp = false) => ({
  update: { name: docName(path), fields: fields(data) },
  ...(stamp ? { updateTransforms: [{ fieldPath: "criadoEm", setToServerValue: "REQUEST_TIME" }] } : {}),
});
const patch = (path, data) => ({
  update: { name: docName(path), fields: fields(data) },
  updateMask: { fieldPaths: Object.keys(data) },
});
const del = (path) => ({ delete: docName(path) });
const request = async (path, token = "", body = null, method = body ? "POST" : "GET") => {
  const response = await fetch(root + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
};
const commit = (writes, token = "") => request(":commit", token, { writes });
const p = (collection, id) => `lojas/${loja}/${collection}/${id}`;
const otherP = (collection, id) => `lojas/${outraLoja}/${collection}/${id}`;
let passed = 0;
function check(label, ok, detail = "") {
  assert.ok(ok, `${label}: ${detail}`);
  passed++;
  console.log(`OK ${label}`);
}
async function allowed(label, promise) {
  const result = await promise;
  check(label, result.status === 200, JSON.stringify(result.data));
  return result;
}
async function denied(label, promise) {
  const result = await promise;
  check(label, result.status === 403, `HTTP ${result.status}: ${JSON.stringify(result.data)}`);
  return result;
}

const ready = await fetch("http://127.0.0.1:8080/").then((r) => r.ok).catch(() => false);
if (!ready) throw new Error("Firestore Emulator não respondeu em 127.0.0.1:8080.");

// Seed somente no emulador; o token literal `owner` é o bypass local do emulator.
const horario = Object.fromEntries(["seg", "ter", "qua", "qui", "sex", "sab", "dom"]
  .map((dia) => [dia, { aberto: true, abre: "00:00", fecha: "23:59" }]));
const pedidoBase = {
  cliente: { nome: "Cliente Teste", telefone: "91900000000" }, tipo: "retirada", endereco: null,
  itens: [{ itemId: "pizza-teste", escolhas: {}, qtd: 1, nome: "Pizza teste", resumo: "", total: 5000, obs: "" }],
  subtotal: 5000, taxa: 0, total: 5000, pagamento: { forma: "Pix", online: false, pago: false }, status: "novo",
};
const seed = [
  write(`lojas/${loja}`, { donoId: donoUid, slug: loja, nome: "Pizzaria Pagamentos Teste", cidade: "Belém", bairro: "Centro", cor: "#991b1b", logoUrl: "", aberta: true, pagamentoOnline: false, contador: 1000, horario }, true),
  write(`lojas/${outraLoja}`, { donoId: outroUid, slug: outraLoja, nome: "Outra Pizzaria Teste", cidade: "Belém", bairro: "Centro", cor: "#991b1b", logoUrl: "", aberta: true, pagamentoOnline: false, contador: 1000, horario }, true),
  write(`acessos/${equipeEmail}`, { lojaId: loja, nome: "Equipe Teste", email: equipeEmail, dono: false, trocarSenha: false }, true),
  write(`lojas/${loja}/cupons/RESERVA`, { tipo: "pct", valor: 10, minimo: 0, validoAte: null, limite: 1, usos: 0, reservasOnline: 1, ativo: true }),
  write(p("pagamentosPedidos", "recibo-publico"), { estado: "aguardando", checkoutUrl: "https://www.mercadopago.com.br/checkout/teste", expiresAt: new Date(Date.now() + 3600000) }),
  write(`integracoesPagamento/${loja}`, { ativo: true, token: "token-ficticio" }),
  write(`integracoesPagamento/${loja}/contas/teste`, { accessToken: "token-ficticio", refreshToken: "refresh-ficticio" }),
  write(`oauthPagamento/oauth-${sufixo}`, { lojaId: loja, uid: donoUid, verifier: "verifier-ficticio", expiresAt: new Date(Date.now() + 60000), consumido: false }),
  write(`transacoesPagamento/transacao-${sufixo}`, { lojaId: loja, contaId: "teste", estado: "aguardando", pedido: pedidoBase }),
  write(p("pedidos", "online-existente"), { ...pedidoBase, pagamento: { forma: "Mercado Pago", online: true, pago: true, paymentId: "id-ficticio" }, status: "preparo", numero: 1001, aceitoEm: new Date() }),
  write(p("pagamentosPedidos", "recibo-pago"), { estado: "pago", paymentId: "id-ficticio", total: 5000 }),
];
const seeded = await commit(seed, "owner");
check("seed local criado pelo bypass do emulador", seeded.status === 200, JSON.stringify(seeded.data));

// A loja só permite alterar pagamentoOnline por servidor; os demais ajustes continuam editáveis.
await denied("membro não ativa pagamento online", commit([patch(`lojas/${loja}`, { pagamentoOnline: true })], equipe));
await denied("dono não ativa pagamento online pelo cliente", commit([patch(`lojas/${loja}`, { pagamentoOnline: true })], dono));
await allowed("membro ainda altera horário e contador", commit([patch(`lojas/${loja}`, { horario: { ...horario, seg: { aberto: true, abre: "08:00", fecha: "22:00" } }, contador: 1001 })], equipe));

// Recibo: consulta pontual pública; listagem e todas as escritas ficam fechadas.
await allowed("cliente lê recibo pelo id", request(`/` + p("pagamentosPedidos", "recibo-publico")));
await denied("anônimo não lista recibos", request(`/` + `lojas/${loja}/pagamentosPedidos?pageSize=10`));
await denied("outra loja não lista recibos", request(`/` + `lojas/${loja}/pagamentosPedidos?pageSize=10`, outro));
await allowed("membro lista recibos da própria loja", request(`/` + `lojas/${loja}/pagamentosPedidos?pageSize=10`, equipe));
await denied("cliente não cria recibo", commit([write(p("pagamentosPedidos", "recibo-forjado"), { estado: "pago", total: 1 })]));
await denied("dono não altera recibo pago", commit([patch(p("pagamentosPedidos", "recibo-pago"), { estado: "aguardando" })], dono));
await denied("dono não apaga recibo", commit([del(p("pagamentosPedidos", "recibo-pago"))], dono));

// Integração, OAuth e transações não ficam legíveis ou graváveis nem para o dono.
for (const path of [`integracoesPagamento/${loja}`, `integracoesPagamento/${loja}/contas/teste`, `oauthPagamento/oauth-${sufixo}`, `transacoesPagamento/transacao-${sufixo}`]) {
  await denied(`dono não lê ${path.split("/")[0]}`, request(`/` + path, dono));
  await denied(`dono não escreve ${path.split("/")[0]}`, commit([patch(path, { alteradoPeloDono: true })], dono));
}

// Pedido sem pagamento online segue aceito; os dois indicadores de pagamento online são negados.
await allowed("pedido legado offline continua aceito", commit([write(p("pedidosEntrada", "offline-legado"), pedidoBase, true)]));
await denied("cliente não marca pedido como online", commit([write(p("pedidosEntrada", "online-cliente"), { ...pedidoBase, pagamento: { forma: "Pix", online: true, pago: false } }, true)]));
await denied("cliente não marca pedido como pago", commit([write(p("pedidosEntrada", "pago-cliente"), { ...pedidoBase, pagamento: { forma: "Pix", online: false, pago: true } }, true)]));

// Usos consumidos e reservas de checkout compartilham o limite do cupom.
const pedidoComCupom = { ...pedidoBase, subtotal: 5000, total: 4500, cupom: "RESERVA", desconto: 500 };
await denied("reserva de pagamento online ocupa o último uso do cupom", commit([write(p("pedidosEntrada", "cupom-reservado"), pedidoComCupom, true)]));

// Aceite online copia somente a entrada paga e preserva todos os dados financeiros.
const online = {
  ...pedidoBase,
  pagamento: { forma: "Mercado Pago", online: true, pago: true, paymentId: "pay-teste", estornoPendente: false },
  criadoEm: new Date(),
};
const seedEntrada = async (id, data = online) => {
  const entrada = { ...data, criadoEm: data.criadoEm || new Date() };
  const result = await commit([write(p("pedidosEntrada", id), entrada)], "owner");
  return { entrada, result };
};
const aceite = (id, data = online) => ({
  ...data, status: "preparo", numero: 1200, aceitoEm: new Date(),
});
async function aceitar(label, id, entrada = online, pedidoAceito = null) {
  const seededEntry = await seedEntrada(id, entrada);
  await allowed(`${label}: prepara entrada paga`, Promise.resolve(seededEntry.result));
  pedidoAceito ||= aceite(id, seededEntry.entrada);
  const result = await commit([write(p("pedidos", id), pedidoAceito, false), del(p("pedidosEntrada", id))], equipe);
  await allowed(label, result);
}
await aceitar("aceite copia pedido pago e apaga a entrada", "aceite-ok", online);
await denied("sem entrada paga não aceita pedido online", commit([write(p("pedidos", "aceite-sem-entrada"), aceite("aceite-sem-entrada"))], equipe));

const entradaEstorno = { ...online, pagamento: { ...online.pagamento, estornoPendente: true } };
const estornoSeed = await seedEntrada("aceite-estorno", entradaEstorno);
await allowed("preparar entrada com estorno pendente", Promise.resolve(estornoSeed.result));
await denied("pedido com estorno pendente não é aceito", commit([write(p("pedidos", "aceite-estorno"), aceite("aceite-estorno", estornoSeed.entrada))], equipe));

for (const [nome, alteracao] of [
  ["pagamento", { pagamento: { ...online.pagamento, paymentId: "outro-id" } }],
  ["total", { total: 5001 }],
  ["subtotal", { subtotal: 5001 }],
  ["taxa", { taxa: 1 }],
  ["itens", { itens: [{ ...online.itens[0], total: 4999 }] }],
]) {
  const id = `aceite-diverge-${nome}`;
  const seededEntry = await seedEntrada(id);
  await allowed(`preparar entrada para comparar ${nome}`, Promise.resolve(seededEntry.result));
  await denied(`aceite rejeita divergência em ${nome}`, commit([write(p("pedidos", id), { ...aceite(id, seededEntry.entrada), ...alteracao })], equipe));
}

// Depois de aceito, a equipe pode avançar o estado, mas não reescrever valores nem pagamento.
const onlineExistente = { ...pedidoBase, pagamento: { forma: "Mercado Pago", online: true, pago: true, paymentId: "id-ficticio" }, status: "preparo", numero: 1001, aceitoEm: new Date() };
await allowed("equipe avança status do pedido pago", commit([patch(p("pedidos", "online-existente"), { status: "saiu" })], equipe));
for (const [nome, alteracao] of [
  ["pagamento", { pagamento: { ...onlineExistente.pagamento, pago: false } }],
  ["total", { total: 5001 }],
  ["itens", { itens: [{ ...onlineExistente.itens[0], total: 4999 }] }],
]) {
  await denied(`equipe não altera ${nome} do pedido online`, commit([patch(p("pedidos", "online-existente"), alteracao)], equipe));
}

console.log(`${passed} verificações passaram. Emulador: ${loja}.`);
