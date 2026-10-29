import { PAGAMENTOS } from "./pagamentos-config.js?v=3";

export const pagamentoDisponivel = () => PAGAMENTOS.ativo === true;
const falha = (codigo, mensagem) => Object.assign(new Error(mensagem), { codigo });
let appCheck;

// Login e checkout acontecem exclusivamente nos endereços do Mercado Pago.
export function urlMercadoPago(valor) {
  try {
    const url = new URL(valor);
    const dominio = url.hostname === "mercadopago.com.br" || url.hostname.endsWith(".mercadopago.com.br")
      || url.hostname === "mercadopago.com" || url.hostname.endsWith(".mercadopago.com");
    return url.protocol === "https:" && !url.username && !url.password && !url.port && dominio ? url.href : "";
  } catch { return ""; }
}

async function cabecalhos(autenticado, emulador) {
  const headers = { "Content-Type": "application/json" };
  if (autenticado) {
    const { auth } = await import("./firebase-init.js?v=3");
    if (!auth.currentUser) throw falha("NAO_AUTENTICADO", "Entre novamente no painel.");
    headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  }
  if (emulador) return headers;
  if (!PAGAMENTOS.chaveAppCheck) throw falha("INDISPONIVEL", "O pagamento online ainda não está disponível.");
  if (!appCheck) appCheck = (async () => {
    await import("./firebase-init.js?v=3");
    const [{ getApp }, { initializeAppCheck, ReCaptchaEnterpriseProvider }] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.16.0/firebase-app-check.js"),
    ]);
    return initializeAppCheck(getApp(), { provider: new ReCaptchaEnterpriseProvider(PAGAMENTOS.chaveAppCheck), isTokenAutoRefreshEnabled: true });
  })().catch((erro) => { appCheck = null; throw erro; });
  const { getToken } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-app-check.js");
  headers["X-Firebase-AppCheck"] = (await getToken(await appCheck)).token;
  return headers;
}

export async function chamarPagamento(rota, dados, { autenticado = false, signal } = {}) {
  if (!pagamentoDisponivel()) throw falha("INDISPONIVEL", "Conexão disponível após a ativação do serviço.");
  if (!["status", "conectar", "ativar", "pausar", "checkout", "consultar", "recusar"].includes(rota)) throw falha("VALIDACAO", "Operação de pagamento inválida.");
  const emulador = new URLSearchParams(location.search).get("emulator") === "1";
  const appscript = PAGAMENTOS.servico === "appscript";
  const base = !appscript && emulador ? "http://localhost:5001/cardapio-delivery-ae048/southamerica-east1/pagamentos" : PAGAMENTOS.url;
  if (appscript) {
    let url;
    try { url = new URL(base); } catch { /* configuração ainda não preenchida */ }
    if (!url || url.protocol !== "https:" || url.hostname !== "script.google.com" || url.username || url.password || url.port
      || url.search || url.hash || !/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname)) throw falha("INDISPONIVEL", "O serviço de pagamento ainda não foi configurado.");
  }
  const controle = new AbortController(), abortar = () => controle.abort();
  if (signal?.aborted) controle.abort();
  signal?.addEventListener("abort", abortar, { once: true });
  const tempo = setTimeout(() => controle.abort(), 30000);
  try {
    const headers = await cabecalhos(autenticado, emulador);
    if (controle.signal.aborted) throw Object.assign(new Error("Cancelado"), { name: "AbortError" });
    const url = appscript ? base : `${base}/${rota}${rota === "status" ? `?lojaId=${encodeURIComponent(dados.lojaId)}` : ""}`;
    const { token: _token, appCheckToken: _appCheckToken, ...payload } = dados || {};
    const token = headers.Authorization?.replace(/^Bearer /, ""), appCheckToken = headers["X-Firebase-AppCheck"];
    const resposta = await fetch(url, { method: appscript || rota !== "status" ? "POST" : "GET",
      headers: appscript ? { "Content-Type": "text/plain;charset=UTF-8" } : headers,
      ...(appscript ? { body: JSON.stringify({ ...payload, rota, ...(token ? { token } : {}), ...(appCheckToken ? { appCheckToken } : {}) }) }
        : rota === "status" ? {} : { body: JSON.stringify(dados) }), signal: controle.signal, credentials: "omit" });
    const corpo = await resposta.json().catch(() => null);
    if (!resposta.ok || corpo?.ok !== true) throw falha(corpo?.erro?.codigo || "ERRO_SERVICO", corpo?.erro?.mensagem || "Não deu para concluir. Tente novamente.");
    const data = corpo.data || {};
    const endereco = data.url || data.checkoutUrl;
    if ((rota === "conectar" || (rota === "checkout" && endereco)) && !urlMercadoPago(endereco)) throw falha("ERRO_SERVICO", "O endereço de pagamento não pôde ser confirmado.");
    if (rota === "checkout" && !endereco && !["gerando", "aguardando", "reconciliar", "aprovado", "erro", "expirado", "cancelado", "reembolsado", "estorno_pendente"].includes(data.estado)) throw falha("ERRO_SERVICO", "Não foi possível confirmar a situação do pagamento.");
    return data;
  } catch (erro) {
    if (erro.codigo) throw erro;
    throw falha("CONEXAO", erro.name === "AbortError" ? "O serviço demorou a responder. Confira seu pedido antes de tentar novamente." : "Não foi possível conectar. Confira a internet e tente novamente.");
  } finally { clearTimeout(tempo); signal?.removeEventListener("abort", abortar); }
}
