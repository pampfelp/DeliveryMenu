// O transporte é substituído antes dos testes: nenhuma chamada ao provedor.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const fetchOriginal = globalThis.fetch, locationOriginal = globalThis.location;
let chamadas = [];
globalThis.fetch = async (...args) => { chamadas.push(args); throw new Error("Rede real proibida neste teste."); };
try {
  const fonte = await readFile(new URL("../pagamentos.js", import.meta.url), "utf8");
  const fonteDesligada = fonte.replace(/import \{ PAGAMENTOS \} from [^;]+;/, 'const PAGAMENTOS = {ativo:false};');
  const { chamarPagamento, pagamentoDisponivel, urlMercadoPago } = await import(`data:text/javascript;base64,${Buffer.from(fonteDesligada).toString("base64")}`);
  assert.equal(pagamentoDisponivel(), false, "a configuração injetada deve estar desativada");
  await assert.rejects(chamarPagamento("conectar", { lojaId: "loja-teste" }, { autenticado: true }), { codigo: "INDISPONIVEL" });
  await assert.rejects(chamarPagamento("ativar", { lojaId: "loja-teste" }, { autenticado: true }), { codigo: "INDISPONIVEL" });
  assert.equal(chamadas.length, 0, "desativado não consulta rede ou autenticação");
  for (const url of ["https://auth.mercadopago.com/authorization", "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=teste"]) assert.ok(urlMercadoPago(url));
  for (const url of ["http://www.mercadopago.com.br/", "https://mercadopago.com.br.exemplo.test/", "https://usuario@mercadopago.com.br/", "javascript:void(0)", "https://mercadopago.com.br:444/"]) assert.equal(urlMercadoPago(url), "");
  console.log("OK integração desligada não usa rede e destinos externos são restritos");

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
  resposta = { ok: true, data: { ativo: true } };
  assert.equal((await apps.chamarPagamento("ativar", { lojaId: "loja-teste" }, { autenticado: true })).ativo, true);
  assert.equal(JSON.parse(chamadas.at(-1)[1].body).rota, "ativar");
  assert.equal(JSON.parse(chamadas.at(-1)[1].body).token, "jwt-simulado");
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

  const configuracoesFonte = await readFile(new URL("../configuracoes.js", import.meta.url), "utf8");
  const trechoConfiguracoes = configuracoesFonte.slice(configuracoesFonte.indexOf("function htmlPagamento()"), configuracoesFonte.indexOf("function render()"));
  const acoes = [], avisos = [], destinos = [], C = { loja: { id: "loja-teste" }, pagamento: null, exemplo: false, sujo: false };
  const cfgContexto = { C, pagamentoDisponivel: () => true, esc: (v) => String(v), document: { querySelector: () => null },
    location: { assign: (url) => destinos.push(url) }, urlMercadoPago: (url) => url,
    toast: (mensagem) => avisos.push(mensagem), chamarPagamento: async (rota, dados, opts) => { acoes.push({ rota, dados, opts }); return rota === "conectar" ? { url: "https://auth.mercadopago.com/authorization" } : rota === "status" ? { conectado: false, ativo: false } : { ativo: rota === "ativar" }; } };
  vm.createContext(cfgContexto); vm.runInContext(`${trechoConfiguracoes}\nthis.api={htmlPagamento,mudarPagamento,consultarPagamento};`, cfgContexto);
  assert.match(cfgContexto.api.htmlPagamento(), /data-cf-pagamento="conectar"/);
  assert.match(cfgContexto.api.htmlPagamento(), /Conferindo a conexão/);
  await cfgContexto.api.mudarPagamento("ativar"); assert.equal(acoes.length, 0);
  await cfgContexto.api.consultarPagamento(); assert.equal(acoes.at(-1).rota, "status");
  assert.match(cfgContexto.api.htmlPagamento(), /Conectar conta Mercado Pago/);
  assert.match(cfgContexto.api.htmlPagamento(), /Autorizar no Mercado Pago/);
  assert.match(cfgContexto.api.htmlPagamento(), /Ativar recebimentos/);
  C.pagamento = { conectado: true, ativo: false };
  assert.match(cfgContexto.api.htmlPagamento(), /data-cf-pagamento="ativar"/);
  assert.match(cfgContexto.api.htmlPagamento(), /Conta conectada\. Pagamento online pausado/);
  assert.match(cfgContexto.api.htmlPagamento(), /Ativar pagamento online/);
  await cfgContexto.api.mudarPagamento("ativar");
  assert.equal(C.pagamento.ativo, true); assert.equal(acoes.at(-1).rota, "ativar"); assert.equal(acoes.at(-1).opts.autenticado, true);
  assert.match(cfgContexto.api.htmlPagamento(), /Pausar pagamento online/);
  await cfgContexto.api.mudarPagamento("pausar"); assert.equal(C.pagamento.ativo, false);
  await cfgContexto.api.mudarPagamento("conectar"); assert.equal(destinos.length, 0, "conta conectada não oferece troca implícita");
  C.pagamento = { conectado: false, ativo: false };
  await cfgContexto.api.mudarPagamento("conectar"); assert.equal(destinos.length, 1); assert.equal(C.pagamento.ativo, false);
  assert(avisos.includes("Pagamento online ativado."));
  const chamarConfiguracao = cfgContexto.chamarPagamento;
  cfgContexto.chamarPagamento = async () => { throw new Error("Erro interno que não deve ficar no card"); };
  await cfgContexto.api.consultarPagamento(); assert.match(cfgContexto.api.htmlPagamento(), /Tentar novamente/);
  assert.equal(C.pagamento, null); await cfgContexto.api.mudarPagamento("ativar"); assert.equal(C.pagamento, null);
  let resolverStatus, consultas = 0;
  cfgContexto.chamarPagamento = async () => { consultas++; return new Promise((resolve) => { resolverStatus = resolve; }); };
  const consultaAntiga = cfgContexto.api.mudarPagamento("consultar");
  await cfgContexto.api.mudarPagamento("consultar"); assert.equal(consultas, 1, "retry não duplica consulta pendente");
  C.loja = { id: "outra-loja" }; C.pagamentoConsulta = null; C.pagamento = { conectado: false, ativo: false };
  resolverStatus({ conectado: true, ativo: true }); await consultaAntiga;
  assert.equal(C.pagamento.conectado, false, "resposta antiga não altera a loja atual");
  cfgContexto.chamarPagamento = chamarConfiguracao;
  await cfgContexto.api.consultarPagamento(); assert.equal(C.pagamentoErro, ""); assert.equal(C.pagamento.conectado, false);
  cfgContexto.esc = (v) => String(v).replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  C.pagamento = { conectado: true, ativo: false, conta: "<conta-teste>" };
  assert.match(cfgContexto.api.htmlPagamento(), /&lt;conta-teste&gt;/); assert.doesNotMatch(cfgContexto.api.htmlPagamento(), /<conta-teste>/);
  const antesDesvincular = acoes.length;
  C.pagamento = { conectado: false, ativo: false, conta: "conta-anterior" };
  assert.match(cfgContexto.api.htmlPagamento(), /data-cf-pagamento="desvincular"/);
  await cfgContexto.api.mudarPagamento("desvincular");
  assert.equal(acoes.length, antesDesvincular, "abrir a confirmação não faz requisição");
  assert.equal(C.pagamentoDesvincular, "conta-anterior");
  assert.match(cfgContexto.api.htmlPagamento(), /Desvincular esta conta\?/);
  assert.match(cfgContexto.api.htmlPagamento(), /pagamentos anteriores seguem pela conta que recebeu/);
  await cfgContexto.api.mudarPagamento("cancelar-desvinculacao");
  assert.equal(C.pagamentoDesvincular, null); assert.equal(acoes.length, antesDesvincular);
  assert.doesNotMatch(cfgContexto.api.htmlPagamento(), /Desvincular esta conta\?/);
  await cfgContexto.api.mudarPagamento("confirmar-desvinculacao"); assert.equal(acoes.length, antesDesvincular);
  await cfgContexto.api.mudarPagamento("desvincular");
  C.pagamento.conta = "conta-alterada";
  await cfgContexto.api.mudarPagamento("confirmar-desvinculacao"); assert.equal(acoes.length, antesDesvincular, "não troca silenciosamente a conta esperada");
  C.pagamento.conta = "conta-anterior";
  let resolverDesvinculacao, chamadasDesvincular = 0, envioDesvincular;
  cfgContexto.chamarPagamento = async (rota, dados, opts) => {
    chamadasDesvincular++; envioDesvincular = { rota, dados, opts };
    return new Promise((resolve) => { resolverDesvinculacao = resolve; });
  };
  const desvinculacao = cfgContexto.api.mudarPagamento("confirmar-desvinculacao");
  assert.equal(envioDesvincular.rota, "desvincular");
  assert.equal(envioDesvincular.dados.lojaId, "outra-loja");
  assert.equal(envioDesvincular.dados.contaIdEsperada, "conta-anterior");
  assert.equal(envioDesvincular.opts.autenticado, true);
  assert.match(cfgContexto.api.htmlPagamento(), /data-cf-pagamento="confirmar-desvinculacao" disabled/);
  await cfgContexto.api.mudarPagamento("confirmar-desvinculacao");
  await cfgContexto.api.mudarPagamento("cancelar-desvinculacao");
  assert.equal(chamadasDesvincular, 1); assert.equal(C.pagamentoDesvincular, "conta-anterior");
  resolverDesvinculacao({ conectado: false, ativo: false }); await desvinculacao;
  assert.equal(C.pagamento.conectado, false); assert.equal(C.pagamento.ativo, false);
  assert.equal(C.pagamento.conta, undefined); assert.equal(C.pagamentoDesvincular, null);
  assert.match(cfgContexto.api.htmlPagamento(), /Conectar conta Mercado Pago/);
  assert.doesNotMatch(cfgContexto.api.htmlPagamento(), /data-cf-pagamento="desvincular"/);
  assert.equal(destinos.length, 1, "desvincular não redireciona automaticamente");
  C.pagamento = { conectado: true, ativo: true, conta: "conta-anterior" };
  await cfgContexto.api.mudarPagamento("desvincular");
  cfgContexto.chamarPagamento = async () => { throw new Error("Falha interna"); };
  await cfgContexto.api.mudarPagamento("confirmar-desvinculacao");
  assert.equal(C.pagamento, null); assert.equal(C.pagamentoDesvincular, null);
  assert.match(cfgContexto.api.htmlPagamento(), /Tentar novamente/);
  cfgContexto.chamarPagamento = chamarConfiguracao;
  await cfgContexto.api.mudarPagamento("consultar"); assert.equal(C.pagamentoErro, "");
  C.pagamento = { conectado: true, ativo: true, conta: "conta-anterior" };
  C.pagamentoSessao = {};
  await cfgContexto.api.mudarPagamento("desvincular");
  cfgContexto.chamarPagamento = async () => new Promise((resolve) => { resolverDesvinculacao = resolve; });
  const desvinculacaoAntiga = cfgContexto.api.mudarPagamento("confirmar-desvinculacao");
  C.loja = { id: "loja-depois" }; C.pagamentoSessao = {}; C.pagamentoOcupado = false;
  C.pagamentoDesvincular = null; C.pagamento = { conectado: true, ativo: true, conta: "conta-depois" };
  resolverDesvinculacao({ conectado: false, ativo: false }); await desvinculacaoAntiga;
  assert.equal(C.pagamento.conta, "conta-depois"); assert.equal(C.pagamento.ativo, true);
  await cfgContexto.api.mudarPagamento("desvincular");
  const respostaMesmaLoja = cfgContexto.api.mudarPagamento("confirmar-desvinculacao");
  C.pagamentoSessao = {}; C.pagamentoOcupado = false; C.pagamentoDesvincular = null;
  resolverDesvinculacao({ conectado: false, ativo: false }); await respostaMesmaLoja;
  assert.equal(C.pagamento.conta, "conta-depois", "outra sessão da mesma loja ignora a resposta antiga");
  cfgContexto.chamarPagamento = chamarConfiguracao;
  cfgContexto.pagamentoDisponivel = () => false;
  assert.match(cfgContexto.api.htmlPagamento(), /indisponível.*suporte/);
  assert.doesNotMatch(cfgContexto.api.htmlPagamento(), /Developers/);
  cfgContexto.pagamentoDisponivel = () => true; C.exemplo = true;
  assert.match(cfgContexto.api.htmlPagamento(), /Exemplo: nenhuma conta será conectada/);
  assert.doesNotMatch(cfgContexto.api.htmlPagamento(), /data-cf-pagamento="desvincular"/);
  const antesExemplo = acoes.length;
  await cfgContexto.api.mudarPagamento("desvincular"); await cfgContexto.api.mudarPagamento("confirmar-desvinculacao");
  await cfgContexto.api.mudarPagamento("ativar"); assert.equal(acoes.length, antesExemplo);
  assert.equal(C.pagamentoDesvincular, null);
  C.exemplo = false;
  C.pagamentoDesvincular = "conta-pendente"; C.parar = [];
  cfgContexto.document.removeEventListener = () => {};
  cfgContexto.aoClicar = cfgContexto.aoDigitar = cfgContexto.aoMudar = () => {};
  vm.runInContext(configuracoesFonte.slice(configuracoesFonte.indexOf("export function pararConfiguracoes()")).replace("export ", ""), cfgContexto);
  cfgContexto.pararConfiguracoes(); assert.equal(C.pagamentoDesvincular, null);
  console.log("OK configuração: passos, desvinculação inline autenticada, cancelamento sem rede, conta esperada, retry, bloqueio ocupado e troca de loja/sessão");

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
  const consumidores = await Promise.all(["app.js", "loja-dados.js", "pedidos.js", "configuracoes.js"]
    .map((arquivo) => readFile(new URL(`../${arquivo}`, import.meta.url), "utf8")));
  const moduloPagamento = consumidores.map((src) => src.match(/from ["'](\.\/pagamentos\.js\?v=[^"']+)["']/)?.[1]);
  assert.ok(moduloPagamento.every(Boolean));
  assert.equal(new Set(moduloPagamento).size, 1, "loja e painel compartilham a mesma instância de pagamentos");
  const configuracoes = [consumidores[0], fonte].map((src) => src.match(/from ["'](\.\/pagamentos-config\.js\?v=[^"']+)["']/)?.[1]);
  assert.ok(configuracoes.every(Boolean));
  assert.equal(new Set(configuracoes).size, 1, "a disponibilidade do pagamento usa a mesma configuração");
  console.log("OK imports: loja, checkout e painel compartilham pagamentos e configuração sem versões antigas");
} finally {
  globalThis.fetch = fetchOriginal;
  if (locationOriginal === undefined) delete globalThis.location; else globalThis.location = locationOriginal;
}
