// O transporte é substituído antes dos testes: nenhuma chamada ao provedor.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
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

  const scriptURL = "https://script.google.com/macros/s/deploy-simulado/exec";
  const carregar = async (config, headers = {}, authErro = false) => {
    const src = fonte.replace(/\r\n/g, "\n")
      .replace(/import \{ PAGAMENTOS \} from [^;]+;/, `const PAGAMENTOS = ${JSON.stringify({ ativo: true, servico: "appscript", url: scriptURL, chaveAppCheck: "", ...config })};`)
      .replace(/async function cabecalhos\([\s\S]*?\n}\n\nexport async function chamarPagamento/, `async function cabecalhos() { ${authErro ? 'throw new Error("Detalhe interno do provedor");' : `return ${JSON.stringify(headers)};`} }\n\nexport async function chamarPagamento`);
    return import(`data:text/javascript;base64,${Buffer.from(src).toString("base64")}`);
  };
  globalThis.location = { search: "" };
  status = 200; resposta = { ok: true, data: { ativo: true } };
  globalThis.fetch = async (url, init) => { chamadas.push([url, init]); return { ok: status < 400, json: async () => resposta }; };
  const apps = await carregar({}, { Authorization: "Bearer jwt-simulado", "X-Firebase-AppCheck": "appcheck-simulado" });
  await apps.chamarPagamento("status", { lojaId: "loja-teste", token: "ignorar", appCheckToken: "ignorar" }, { autenticado: true });
  let [destino, envio] = chamadas.at(-1);
  assert.equal(destino, scriptURL); assert.equal(envio.method, "POST"); assert.equal(envio.credentials, "omit");
  assert.deepEqual(envio.headers, { "Content-Type": "text/plain;charset=UTF-8" });
  assert.deepEqual(JSON.parse(envio.body), { lojaId: "loja-teste", rota: "status", token: "jwt-simulado", appCheckToken: "appcheck-simulado" });
  for (const valor of ["jwt-simulado", "appcheck-simulado", "Authorization", "X-Firebase-AppCheck"]) assert.equal(destino.includes(valor), false);
  assert.equal(envio.headers.Authorization, undefined); assert.equal(envio.headers["X-Firebase-AppCheck"], undefined);
  resposta = { ok: true, data: { estado: "aguardando", checkoutUrl: "https://www.mercadopago.com.br/checkout/teste" } };
  await apps.chamarPagamento("checkout", pedido);
  assert.equal(chamadas.at(-1)[0], scriptURL); assert.equal(JSON.parse(chamadas.at(-1)[1].body).rota, "checkout");
  resposta = { ok: false, erro: { codigo: "SEM_PERMISSAO", mensagem: "Acesso não permitido." } };
  await assert.rejects(apps.chamarPagamento("pausar", { lojaId: "loja-teste" }), { codigo: "SEM_PERMISSAO", message: "Acesso não permitido." });
  resposta = { ok: true, data: { url: "https://outro.test/" } };
  await assert.rejects(apps.chamarPagamento("conectar", { lojaId: "loja-teste" }), { codigo: "ERRO_SERVICO" });
  const semCredenciais = await carregar({}); resposta = { ok: true, data: { estado: "aguardando" } };
  await semCredenciais.chamarPagamento("consultar", { lojaId: "loja-teste", pedidoId: "pedido-local" });
  const corpoSemCredenciais = JSON.parse(chamadas.at(-1)[1].body);
  assert.equal(Object.hasOwn(corpoSemCredenciais, "token"), false); assert.equal(Object.hasOwn(corpoSemCredenciais, "appCheckToken"), false);
  const proibidas = ["", "http://script.google.com/macros/s/id/exec", "https://script.google.com.exemplo.test/macros/s/id/exec", "https://usuario@script.google.com/macros/s/id/exec", "https://script.google.com:444/macros/s/id/exec", "https://script.google.com/macros/s/id/dev", "https://script.google.com/macros/s/id/exec?token=teste", "https://script.google.com/macros/s/id/exec#teste", "https://script.googleusercontent.com/macros/s/id/exec"];
  for (const url of proibidas) {
    const antes = chamadas.length, invalido = await carregar({ url });
    await assert.rejects(invalido.chamarPagamento("checkout", pedido), { codigo: "INDISPONIVEL" }); assert.equal(chamadas.length, antes);
  }
  const antes = chamadas.length, desativado = await carregar({ ativo: false });
  await assert.rejects(desativado.chamarPagamento("conectar", {}), { codigo: "INDISPONIVEL" }); assert.equal(chamadas.length, antes);
  const authFalha = await carregar({}, {}, true);
  await assert.rejects(authFalha.chamarPagamento("status", { lojaId: "loja-teste" }), (erro) => erro.codigo === "CONEXAO" && !erro.message.includes("Detalhe interno"));
  const firebase = await carregar({ servico: "firebase", url: "https://servico-teste.invalid" }, { Authorization: "Bearer jwt-simulado", "X-Firebase-AppCheck": "appcheck-simulado" });
  resposta = { ok: true, data: { ativo: true } };
  await firebase.chamarPagamento("status", { lojaId: "loja-teste" }, { autenticado: true });
  [destino, envio] = chamadas.at(-1); assert.equal(destino, "https://servico-teste.invalid/status?lojaId=loja-teste"); assert.equal(envio.method, "GET");
  assert.equal(envio.headers.Authorization, "Bearer jwt-simulado"); assert.equal(envio.headers["X-Firebase-AppCheck"], "appcheck-simulado"); assert.equal(envio.body, undefined);
  assert.match(fonte, /ReCaptchaEnterpriseProvider/); assert.doesNotMatch(fonte, /ReCaptchaV3Provider/);
  console.log("OK Apps Script: POST simples, URLs restritas, credenciais só no corpo, erro lógico e App Check Enterprise");

  const appFonte = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const trecho = appFonte.slice(appFonte.indexOf("let pararAcomp ="), appFonte.indexOf("function renderPagamentoPendente("))
    .replace('await import("./firebase-init.js?v=3")', '({ db: {} })')
    .replace("await import(FIRESTORE)", "({ doc: (...args) => args, onSnapshot: capturarSnapshot })");
  function acompanhamento(servico = "appscript") {
    const timers = new Map(), eventos = new Map(), streams = new Map(), chamadas = [], telas = [], avisos = [];
    let serial = 0, ativo = true, resolucao = null, pendurar = false, falhar = false;
    const document = { hidden: false, getElementById: () => ({ innerHTML: "" }), addEventListener: (n, fn) => eventos.set(n, fn), removeEventListener: (n) => eventos.delete(n) };
    const window = { addEventListener: (n, fn) => eventos.set(n, fn), removeEventListener: (n) => eventos.delete(n) };
    const contexto = {
      AbortController, SLUG: "loja-teste", LOJA: { id: "loja-teste" }, PAGAMENTOS: { servico }, checkoutAtual: null,
      location: { hash: "#pedido/pedido-local" }, document, window, navigator: { onLine: true },
      pagamentoDisponivel: () => ativo, renderAcompanhar: (p) => telas.push(p), renderPagamentoPendente: (p) => telas.push(p), encerrarTentativa() {}, concluirCheckout() {},
      toast: (...v) => avisos.push(v), setTimeout: (fn, ms) => { assert.equal(ms, 15000); timers.set(++serial, fn); return serial; }, clearTimeout: (id) => timers.delete(id),
      capturarSnapshot: (ref, fn) => { const nome = ref[3]; streams.set(nome, fn); return () => streams.delete(nome); },
      chamarPagamento: async (rota, dados, opts) => {
        chamadas.push({ rota, dados, opts });
        if (falhar) throw new Error("Falha simulada");
        if (pendurar) await new Promise((resolve, reject) => { resolucao = resolve; opts.signal.addEventListener("abort", () => reject(new Error("Cancelado")), { once: true }); });
        return { estado: "aguardando" };
      },
    };
    vm.createContext(contexto); vm.runInContext(`${trecho}\nthis.api = { acompanhar, pararAcompanhar };`, contexto);
    return { contexto, timers, eventos, streams, chamadas, telas, avisos,
      async abrir() { await contexto.api.acompanhar("pedido-local"); this.emitir("pedidosEntrada", null); this.emitir("pedidos", null); this.emitir("pagamentosPedidos", { estado: "aguardando" }); },
      emitir(nome, dados) { streams.get(nome)?.({ exists: () => !!dados, data: () => dados }); },
      tick() { const [id, fn] = timers.entries().next().value || []; if (!fn) return Promise.resolve(); timers.delete(id); return fn(); },
      ocupar(v) { pendurar = v; }, resolver() { resolucao?.(); }, desativar() { ativo = false; },
      falhar() { falhar = true; },
    };
  }
  const ac = acompanhamento(); await ac.abrir(); assert.equal(ac.timers.size, 1);
  await ac.tick(); assert.equal(ac.chamadas.length, 1); assert.equal(ac.chamadas[0].rota, "consultar"); assert.equal(ac.timers.size, 1);
  ac.contexto.document.hidden = true; ac.eventos.get("visibilitychange")(); assert.equal(ac.timers.size, 0);
  ac.contexto.document.hidden = false; ac.eventos.get("visibilitychange")(); assert.equal(ac.timers.size, 1);
  ac.contexto.navigator.onLine = false; ac.eventos.get("offline")(); assert.equal(ac.timers.size, 0);
  ac.contexto.navigator.onLine = true; ac.eventos.get("online")(); assert.equal(ac.timers.size, 1);
  ac.ocupar(true); const emAndamento = ac.tick(); assert.equal(ac.chamadas.length, 2); assert.equal(ac.timers.size, 0);
  ac.eventos.get("visibilitychange")(); assert.equal(ac.timers.size, 0, "não sobrepor consulta em andamento");
  const callbackAntigo = ac.streams.get("pagamentosPedidos"), telasAntes = ac.telas.length;
  ac.contexto.location.hash = "#inicio"; ac.contexto.api.pararAcompanhar(); await emAndamento;
  assert.equal(ac.chamadas.at(-1).opts.signal.aborted, true); assert.equal(ac.timers.size, 0); assert.equal(ac.streams.size, 0); assert.equal(ac.eventos.size, 0);
  callbackAntigo({ exists: () => true, data: () => ({ estado: "aguardando" }) }); assert.equal(ac.telas.length, telasAntes);
  assert.equal(ac.avisos.length, 0, "falha automática não mostra toast");
  for (const estado of ["aprovado", "expirado", "cancelado", "reembolsado", "erro"]) {
    const x = acompanhamento(); await x.abrir(); x.emitir("pagamentosPedidos", { estado }); assert.equal(x.timers.size, 0); x.contexto.api.pararAcompanhar();
  }
  for (const estado of ["gerando", "aguardando", "reconciliar", "estorno_pendente"]) {
    const x = acompanhamento(); await x.abrir(); x.emitir("pagamentosPedidos", { estado }); assert.equal(x.timers.size, 1); x.contexto.api.pararAcompanhar();
  }
  const pago = acompanhamento(); await pago.abrir(); pago.emitir("pedidosEntrada", { pagamento: { pago: true } }); assert.equal(pago.timers.size, 0);
  pago.emitir("pedidosEntrada", { pagamento: { pago: true, estornoPendente: true } }); assert.equal(pago.timers.size, 1); pago.contexto.api.pararAcompanhar();
  const legado = acompanhamento("firebase"); await legado.abrir(); assert.equal(legado.timers.size, 0); legado.contexto.api.pararAcompanhar();
  const desligado = acompanhamento(); await desligado.abrir(); desligado.desativar(); desligado.eventos.get("visibilitychange")(); assert.equal(desligado.timers.size, 0); desligado.contexto.api.pararAcompanhar();
  const indisponivel = acompanhamento(); await indisponivel.abrir(); indisponivel.falhar(); await indisponivel.tick(); assert.equal(indisponivel.avisos.length, 0); assert.equal(indisponivel.timers.size, 1); indisponivel.contexto.api.pararAcompanhar();
  const saiuDuranteImport = acompanhamento(), inicializando = saiuDuranteImport.contexto.api.acompanhar("pedido-local");
  saiuDuranteImport.contexto.location.hash = "#inicio"; saiuDuranteImport.contexto.api.pararAcompanhar(); await inicializando;
  assert.equal(saiuDuranteImport.streams.size, 0); assert.equal(saiuDuranteImport.timers.size, 0);
  console.log("OK consulta automática: 15s, estados pendentes, visibilidade, offline, abortar, sem sobreposição ou callback antigo");
} finally {
  globalThis.fetch = fetchOriginal;
  if (locationOriginal === undefined) delete globalThis.location; else globalThis.location = locationOriginal;
}
