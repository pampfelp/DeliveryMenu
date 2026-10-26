// node rea/verificar-agendamento.mjs [--regras]. Dados somente no emulador local.
import assert from "node:assert/strict";
import { horariosDisponiveis, motivoAgendamento, textoAgendamento } from "../agendamento.js?v=1";

if (process.argv.slice(2).some((v) => v !== "--regras")) throw new Error("Use somente --regras; endereço de produção não é aceito.");
let total = 0;
const ok = (nome, valor) => { assert.ok(valor, nome); total++; console.log(`OK ${nome}`); };
const atual = new Date("2026-10-26T20:20:00Z"); // segunda, 17h20 em Belém
const dias = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
const loja = { aceitaAgendamento: true, aberta: true, horario: Object.fromEntries(dias.map((d) => [d, { aberto: true, abre: "18:00", fecha: "23:00" }])) };
const motivo = (valor, l = loja, data = atual) => motivoAgendamento(l, valor, data);
ok("horário futuro dentro do turno", !motivo("2026-10-26T21:00:00Z"));
ok("horário exatamente agora é recusado", !!motivo(atual));
ok("horário passado é recusado", !!motivo("2026-10-25T21:00:00Z"));
ok("mais de 72h é recusado", !!motivo("2026-10-29T21:00:00Z"));
ok("minutos fora da grade são recusados", !!motivo("2026-10-26T21:15:00Z"));
ok("segundos fora da grade são recusados", !!motivo("2026-10-26T21:00:01Z"));
ok("milissegundos fora da grade são recusados", !!motivo("2026-10-26T21:00:00.001Z"));
ok("horário inválido é recusado", !!motivo("invalido"));
ok("valor ausente é recusado", !!motivo(null));
ok("agendamento desligado é recusado", !!motivo("2026-10-26T21:00:00Z", { ...loja, aceitaAgendamento: false }));
ok("chave pausada é recusada", !!motivo("2026-10-26T21:00:00Z", { ...loja, aberta: false }));
ok("fechamento automático não substitui chave física", !motivo("2026-10-26T21:00:00Z", { ...loja, aberta: false, ligada: true }));
ok("loja sem horários não agenda", !!motivo("2026-10-26T21:00:00Z", { ...loja, horario: null }));
ok("abertura incluída", !motivo("2026-10-26T21:00:00Z"));
ok("fechamento excluído", !!motivo("2026-10-27T02:00:00Z"));
ok("antes de abrir é recusado", !!motivo("2026-10-26T20:30:00Z"));
const madrugada = { ...loja, horario: { dom: { aberto: true, abre: "18:00", fecha: "02:00" } } };
ok("madrugada usa o turno do domingo", !motivo("2026-10-26T03:30:00Z", madrugada, new Date("2026-10-26T02:30:00Z")));
ok("madrugada após fechar é recusada", !!motivo("2026-10-26T05:00:00Z", madrugada, new Date("2026-10-26T02:30:00Z")));
const virada = { ...loja, horario: { sab: { aberto: true, abre: "18:00", fecha: "02:00" } } };
ok("madrugada atravessa mês", !motivo("2026-11-01T03:30:00Z", virada, new Date("2026-11-01T02:30:00Z")));
ok("aceita Timestamp do Firestore", !motivo({ toDate: () => new Date("2026-10-26T21:00:00Z") }));
const disponiveis = horariosDisponiveis(loja, atual);
ok("primeiro dia tem rótulo e data local", disponiveis[0].rotulo === "Hoje" && disponiveis[0].data === "2026-10-26" && disponiveis[0].detalhe === "Seg, 26/10");
ok("amanhã tem rótulo próprio", disponiveis[1].rotulo === "Amanhã");
ok("slot fornece ISO e texto", disponiveis[0].horarios[0].valor === "2026-10-26T21:00:00.000Z" && disponiveis[0].horarios[0].texto === "18h00");
ok("todos os slots disponíveis passam na validação", disponiveis.flatMap((d) => d.horarios).every((h) => !motivo(h.valor)));
ok("chave desligada não oferece horários", horariosDisponiveis({ ...loja, aberta: false }, atual).length === 0);
ok("default não habilita agendamento", horariosDisponiveis({ ...loja, aceitaAgendamento: undefined }, atual).length === 0);
ok("texto usa Belém", textoAgendamento("2026-10-26T21:30:00Z", atual) === "hoje, 18h30");
ok("texto de amanhã", textoAgendamento("2026-10-27T21:30:00Z", atual) === "amanhã, 18h30");
ok("texto de outro dia", textoAgendamento("2026-10-28T21:30:00Z", atual) === "28/10, 18h30");
const integral = { ...loja, horario: Object.fromEntries(dias.map((d) => [d, { aberto: true, abre: "00:00", fecha: "00:00" }])) };
const limite = new Date("2026-10-29T20:30:00Z"), arredondado = new Date("2026-10-26T20:30:00Z");
ok("72 horas exatas são permitidas", !motivo(limite, integral, arredondado));
ok("listagem inclui limite exato de 72h", horariosDisponiveis(integral, arredondado).at(-1).horarios.at(-1).valor === limite.toISOString());

if (process.argv.includes("--regras")) {
  const projeto = "cardapio-delivery-ae048", prefix = `projects/${projeto}/databases/(default)/documents/`;
  const root = `http://127.0.0.1:8080/v1/${prefix}`, id = `teste-agenda-${Date.now().toString(36)}`;
  const enc = (v) => v === null ? { nullValue: null } : v instanceof Date ? { timestampValue: v.toISOString() }
    : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : typeof v === "object" ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } }
      : typeof v === "boolean" ? { booleanValue: v } : typeof v === "number" ? { integerValue: String(v) } : { stringValue: v };
  const write = (path, data, stamp = false) => ({ update: { name: prefix + path, fields: enc(data).mapValue.fields }, ...(stamp ? { updateTransforms: [{ fieldPath: "criadoEm", setToServerValue: "REQUEST_TIME" }] } : {}) });
  const commit = async (writes, admin = false) => {
    const r = await fetch(root.slice(0, -1) + ":commit", { method: "POST", headers: { "Content-Type": "application/json", ...(admin ? { Authorization: "Bearer owner" } : {}) }, body: JSON.stringify({ writes }) });
    return { status: r.status, data: await r.json() };
  };
  const setLoja = async (l) => { const r = await commit([write(`lojas/${id}`, { ...l, donoId: "dono-agenda" })], true); assert.equal(r.status, 200, JSON.stringify(r.data)); };
  const pedido = { cliente: { nome: "Cliente de teste", telefone: "00000000000" }, tipo: "retirada", endereco: null, itens: [{ nome: "Item", qtd: 1 }], subtotal: 1000, taxa: 0, total: 1000, pagamento: { forma: "Dinheiro", online: false }, status: "novo" };
  let seq = 0;
  const criar = async (nome, dados, esperado) => {
    const r = await commit([write(`lojas/${id}/pedidosEntrada/teste-${++seq}`, { ...pedido, ...dados }, true)]);
    ok(`rules: ${nome}`, r.status === esperado || (assert.fail(JSON.stringify(r.data)), false));
  };
  const futuro = new Date((Math.floor(Date.now() / 1800000) + 2) * 1800000);
  await setLoja(integral);
  await criar("agendado válido", { agendadoPara: futuro }, 200);
  await criar("pedido legado sem agenda preservado", {}, 200);
  await criar("texto não substitui timestamp", { agendadoPara: futuro.toISOString() }, 403);
  await criar("timestamp nulo recusado", { agendadoPara: null }, 403);
  await criar("passado recusado", { agendadoPara: new Date(+futuro - 4 * 86400000) }, 403);
  await criar("mais de 72 horas recusado", { agendadoPara: new Date(+futuro + 3 * 86400000) }, 403);
  await criar("minuto fora da grade recusado", { agendadoPara: new Date(+futuro + 60000) }, 403);
  await criar("segundo fora da grade recusado", { agendadoPara: new Date(+futuro + 1000) }, 403);
  await criar("milissegundo fora da grade recusado", { agendadoPara: new Date(+futuro + 1) }, 403);
  await setLoja({ ...integral, aceitaAgendamento: false });
  await criar("agenda desligada recusada", { agendadoPara: futuro }, 403);
  await criar("agenda desligada conserva pedido imediato", {}, 200);
  await setLoja({ ...integral, aberta: false });
  await criar("pausa bloqueia agenda", { agendadoPara: futuro }, 403);
  await setLoja({ ...integral, horario: {} });
  await criar("sem horário recusado", { agendadoPara: futuro }, 403);
  const amanha = new Date(Date.now() - 3 * 3600000); amanha.setUTCDate(amanha.getUTCDate() + 1); amanha.setUTCHours(0, 30, 0, 0);
  const madrugadaUTC = new Date(+amanha + 3 * 3600000), anterior = dias[(amanha.getUTCDay() + 6) % 7];
  await setLoja({ ...integral, horario: { [anterior]: { aberto: true, abre: "18:00", fecha: "02:00" } } });
  await criar("turno anterior após meia-noite aceito", { agendadoPara: madrugadaUTC }, 200);
  await criar("fim do turno anterior recusado", { agendadoPara: new Date(+madrugadaUTC + 90 * 60000) }, 403);
}
console.log(`${total} verificações de agendamento passaram.`);
