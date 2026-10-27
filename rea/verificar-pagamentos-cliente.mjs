// O transporte é substituído antes dos testes: nenhuma chamada ao provedor.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chamarPagamento, pagamentoDisponivel, urlMercadoPago } from "../pagamentos.js?v=1";

const fetchOriginal = globalThis.fetch, locationOriginal = globalThis.location;
let chamadas = [];
globalThis.fetch = async (...args) => { chamadas.push(args); throw new Error("Rede real proibida neste teste."); };
try {
  assert.equal(pagamentoDisponivel(), false, "o preparo deve continuar desativado");
  await assert.rejects(chamarPagamento("conectar", { lojaId: "loja-teste" }, { autenticado: true }), { codigo: "INDISPONIVEL" });
  assert.equal(chamadas.length, 0, "desativado não consulta rede ou autenticação");
  for (const url of ["https://auth.mercadopago.com/authorization", "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=teste"]) assert.ok(urlMercadoPago(url));
  for (const url of ["http://www.mercadopago.com.br/", "https://mercadopago.com.br.exemplo.test/", "https://usuario@mercadopago.com.br/", "javascript:void(0)", "https://mercadopago.com.br:444/"]) assert.equal(urlMercadoPago(url), "");
  console.log("OK integração desligada não usa rede e destinos externos são restritos");

  const fonte = await readFile(new URL("../pagamentos.js", import.meta.url), "utf8");
  const injetada = fonte.replace(/import \{ PAGAMENTOS \} from [^;]+;/, 'const PAGAMENTOS = {ativo:true,url:"https://servico-teste.invalid",chaveAppCheck:""};');
  const cliente = await import(`data:text/javascript;base64,${Buffer.from(injetada).toString("base64")}`);
  globalThis.location = { search: "?emulator=1" };
  let resposta = { ok: true, data: { pedidoId: "pedido-local", estado: "aguardando", checkoutUrl: "https://www.mercadopago.com.br/checkout/teste" } }, status = 200;
  globalThis.fetch = async (url, init) => {
    assert.match(url, /^http:\/\/localhost:5001\/cardapio-delivery-ae048\/southamerica-east1\/pagamentos\//);
    chamadas.push([url, init]); return { ok: status < 400, json: async () => resposta };
  };
  const pedido = { lojaId: "loja-teste", pedidoId: "pedido-local", pedido: { total: 4500 } };
  assert.equal((await cliente.chamarPagamento("checkout", pedido)).pedidoId, "pedido-local");
  assert.equal(chamadas.at(-1)[1].method, "POST");
  assert.deepEqual(JSON.parse(chamadas.at(-1)[1].body), pedido);
  resposta = { ok: true, data: { pedidoId: "pedido-local", estado: "reconciliar" } };
  assert.equal((await cliente.chamarPagamento("checkout", pedido)).estado, "reconciliar");
  resposta = { ok: true, data: { checkoutUrl: "https://destino-invalido.test/" } };
  await assert.rejects(cliente.chamarPagamento("checkout", pedido), { codigo: "ERRO_SERVICO" });
  status = 409; resposta = { ok: false, erro: { codigo: "PRECO_ALTERADO", mensagem: "Confira o valor." } };
  await assert.rejects(cliente.chamarPagamento("checkout", pedido), { codigo: "PRECO_ALTERADO", message: "Confira o valor." });
  console.log("OK contrato HTTP, repetição em reconciliação, destino e erro do servidor");
} finally {
  globalThis.fetch = fetchOriginal;
  if (locationOriginal === undefined) delete globalThis.location; else globalThis.location = locationOriginal;
}
