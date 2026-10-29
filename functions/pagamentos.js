import { FieldValue } from "firebase-admin/firestore";
import { calcularPedido } from "./calcular-pedido.js?v=1";
import { camposFicha, telefoneDe } from "../ficha-cliente.js?v=2";
import { aleatorio, assinaturaWebhook, canonico, cifrar, decifrar, desafioPKCE, sha256 } from "./seguranca.js?v=1";

const falha = (codigo, mensagem, http = 400) => { throw Object.assign(new Error(mensagem), { codigo, http }); };
const data = (v) => v?.toDate ? v.toDate() : new Date(v);
const TERMINAIS = ["expirado", "cancelado", "reembolsado"];
const lojaValida = (v) => typeof v === "string" && /^[a-z0-9-]{3,40}$/.test(v);
const pedidoValido = (v) => typeof v === "string" && /^[a-zA-Z0-9_-]{20,80}$/.test(v);
const contaValida = (v) => /^\d{1,30}$/.test(String(v || ""));

export function validarPagamento(p, t, id) {
  const valor = Number(p.transaction_amount);
  if (!contaValida(p.id) || (id && String(p.id) !== String(id)) || String(p.collector_id) !== t.contaId
    || p.currency_id !== "BRL" || !Number.isFinite(valor) || valor <= 0 || Math.round(valor * 100) !== t.pedido.total
    || p.external_reference !== `${t.lojaId}:${t.pedidoId}`
    || p.metadata?.loja_id !== t.lojaId || p.metadata?.pedido_id !== t.pedidoId) {
    falha("PAGAMENTO_DIVERGENTE", "A confirmação não corresponde ao pedido.", 409);
  }
}

// Dependências injetadas permitem testar sem acesso ao Firebase ou ao provedor real.
export function criarHandler({ db, auth, appCheck, config, segredos, fetch: buscar = globalThis.fetch, agora = () => new Date(), carimbo = () => FieldValue.serverTimestamp() }) {
  const segredo = () => typeof segredos === "function" ? segredos() : segredos;
  const lojaRef = (id) => db.doc(`lojas/${id}`);
  const integracaoRef = (id) => db.doc(`integracoesPagamento/${id}`);
  const contaRef = (loja, conta) => db.doc(`integracoesPagamento/${loja}/contas/${conta}`);
  const transacaoRef = (id) => db.doc(`transacoesPagamento/${id}`);
  const publicoRef = (loja, id) => db.doc(`lojas/${loja}/pagamentosPedidos/${id}`);
  const pedidoRef = (loja, id, final = false) => db.doc(`lojas/${loja}/${final ? "pedidos" : "pedidosEntrada"}/${id}`);
  const callbackURL = () => config.callbackURL || `${config.url.replace(/\/$/, "")}/callback`;
  const publicar = (tx, t, estado, extra = {}) => tx.set(publicoRef(t.lojaId, t.pedidoId), { estado, ...extra, atualizadoEm: carimbo() }, { merge: true });
  const validarIds = (lojaId, pedidoId) => {
    if (!lojaValida(lojaId) || (pedidoId !== undefined && !pedidoValido(pedidoId))) falha("VALIDACAO", "Confira a loja e o pedido.");
  };
  async function membro(lojaId, uid) {
    const user = await auth.getUser(uid);
    if (user.disabled) falha("NAO_AUTENTICADO", "Entre novamente no painel.", 401);
    const loja = (await lojaRef(lojaId).get()).data();
    if (!loja) falha("NAO_ENCONTRADO", "Restaurante não encontrado.", 404);
    const email = String(user.email || "").toLowerCase();
    const acesso = loja.donoId !== uid && email ? (await db.doc(`acessos/${email}`).get()).data() : null;
    if (loja.donoId !== uid && acesso?.lojaId !== lojaId) falha("SEM_PERMISSAO", "Você não tem acesso a este restaurante.", 403);
    return user;
  }
  async function autenticar(req, lojaId) {
    const header = req.headers?.authorization || "", token = /^Bearer (.+)$/.exec(header)?.[1];
    if (!token) falha("NAO_AUTENTICADO", "Entre no painel.", 401);
    let user;
    try { user = await auth.verifyIdToken(token, true); } catch { falha("NAO_AUTENTICADO", "Sua sessão expirou. Entre novamente.", 401); }
    await membro(lojaId, user.uid);
    return user;
  }
  async function conferirApp(req) {
    if (config.emulador === true) return;
    const token = req.headers?.["x-firebase-appcheck"];
    if (typeof token !== "string" || !token) falha("APP_CHECK", "Reabra o cardápio e tente novamente.", 401);
    try { await appCheck.verifyToken(token); } catch { falha("APP_CHECK", "Não foi possível verificar este acesso.", 401); }
  }
  async function mp(caminho, { token, method = "GET", body, idempotencia } = {}) {
    let resposta;
    try {
      resposta = await buscar(`https://api.mercadopago.com${caminho}`, {
        method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(idempotencia ? { "X-Idempotency-Key": idempotencia } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
      });
    } catch { falha("PROVEDOR_INDISPONIVEL", "Não recebemos uma confirmação do pagamento. Aguarde a conferência.", 502); }
    let dados;
    try { dados = await resposta.json(); } catch { falha("PROVEDOR_INDISPONIVEL", "Resposta inválida do provedor. Aguarde a conferência.", 502); }
    if (!resposta.ok) {
      const providerCode = typeof dados.error === "string" && /^[a-z_]{1,50}$/.test(dados.error) ? dados.error : null;
      throw Object.assign(new Error("O provedor não concluiu a operação. Tente novamente mais tarde."), { codigo: "ERRO_PROVEDOR", http: resposta.status === 401 ? 503 : 502, providerStatus: resposta.status, providerCode });
    }
    return dados;
  }
  function tokensCifrados(tokens, lojaId, contaId) {
    if (typeof tokens.access_token !== "string" || !tokens.access_token || typeof tokens.refresh_token !== "string" || !tokens.refresh_token
      || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 || String(tokens.user_id) !== contaId) falha("OAUTH_INVALIDO", "A conta não pôde ser conectada.", 502);
    return { protegido: cifrar({ access_token: tokens.access_token, refresh_token: tokens.refresh_token }, segredo().tokensKey, lojaId, contaId), expiresAt: new Date(+agora() + tokens.expires_in * 1000), versao: aleatorio(), reconectar: false, refreshAte: new Date(0) };
  }
  async function tokenDaConta(lojaId, contaId, comVersao = false) {
    const ref = contaRef(lojaId, contaId), snap = await ref.get(), conta = snap.data();
    if (!conta?.protegido || conta.reconectar) falha("RECONECTAR", "Reconecte a conta de pagamento deste restaurante.", 503);
    const tokens = decifrar(conta.protegido, segredo().tokensKey, lojaId, contaId);
    if (typeof tokens.access_token !== "string" || !tokens.access_token || typeof tokens.refresh_token !== "string" || !tokens.refresh_token) falha("RECONECTAR", "Reconecte a conta de pagamento deste restaurante.", 503);
    if (+data(conta.expiresAt) > +agora() + 60000) return comVersao ? { token: tokens.access_token, versao: conta.versao } : tokens.access_token;
    if (conta.renovacaoBloqueada === true) falha("RECONECTAR", "A conexão de homologação venceu. Pause o teste e fale com o suporte.", 503);
    const lease = aleatorio();
    await db.runTransaction(async (tx) => {
      const atual = (await tx.get(ref)).data();
      if (atual.versao !== conta.versao || atual.renovacaoBloqueada === true || +data(atual.refreshAte) > +agora()) falha("RENOVANDO_CONEXAO", "A conexão está sendo renovada. Tente em instantes.", 503);
      tx.update(ref, { refreshLease: lease, refreshAte: new Date(+agora() + 60000) });
    });
    try {
      const novos = await mp("/oauth/token", { method: "POST", body: { client_id: config.clientId, client_secret: segredo().clientSecret, grant_type: "refresh_token", refresh_token: tokens.refresh_token } });
      const campos = tokensCifrados(novos, lojaId, contaId);
      const salvo = await db.runTransaction(async (tx) => {
        const atual = (await tx.get(ref)).data();
        if (atual.refreshLease !== lease || atual.versao !== conta.versao) return false;
        tx.update(ref, { ...campos, refreshLease: null }); return true;
      });
      return salvo ? comVersao ? { token: novos.access_token, versao: campos.versao } : novos.access_token : tokenDaConta(lojaId, contaId, comVersao);
    } catch (err) {
      await db.runTransaction(async (tx) => {
        const atual = (await tx.get(ref)).data();
        const integracao = (await tx.get(integracaoRef(lojaId))).data();
        const revogado = err.providerStatus === 401 || err.providerCode === "invalid_grant";
        if (atual?.refreshLease === lease && atual.versao === conta.versao) {
          tx.update(ref, { reconectar: atual.reconectar === true || (revogado && integracao?.contaId === contaId), refreshLease: null, refreshAte: new Date(0) });
          if (revogado && integracao?.contaId === contaId) {
            tx.update(integracaoRef(lojaId), { ativo: false });
            tx.update(lojaRef(lojaId), { pagamentoOnline: { ativo: false, provedor: "mercadopago" } });
          }
        }
      });
      throw err;
    }
  }
  async function status(lojaId) {
    let t = (await integracaoRef(lojaId).get()).data();
    let conta = t?.contaId ? (await contaRef(lojaId, t.contaId).get()).data() : null;
    if (config.ativos === true && t?.ativo === true && conta?.protegido && !conta.reconectar && !(+data(conta.expiresAt) > +agora() + 60000)) {
      const contaId = t.contaId;
      if (conta.renovacaoBloqueada === true) {
        const versao = conta.versao;
        await db.runTransaction(async (tx) => {
          const atual = (await tx.get(integracaoRef(lojaId))).data(), privada = (await tx.get(contaRef(lojaId, contaId))).data();
          if (atual?.contaId !== contaId || privada?.versao !== versao || privada.renovacaoBloqueada !== true
            || +data(privada.expiresAt) > +agora() + 60000) return;
          tx.update(integracaoRef(lojaId), { ativo: false });
          tx.update(lojaRef(lojaId), { pagamentoOnline: { ativo: false, provedor: "mercadopago" } });
        });
      } else {
        try { await tokenDaConta(lojaId, contaId); }
        catch (err) {
          const atual = (await integracaoRef(lojaId).get()).data(), privada = (await contaRef(lojaId, contaId).get()).data();
          if (atual?.contaId !== contaId || privada?.reconectar !== true || atual.ativo !== false) throw err;
        }
      }
      t = (await integracaoRef(lojaId).get()).data();
      conta = t?.contaId ? (await contaRef(lojaId, t.contaId).get()).data() : null;
    }
    const valido = +data(conta?.expiresAt) > +agora() + 60000;
    const conectado = !!conta?.protegido && !conta.reconectar && (conta.renovacaoBloqueada !== true || valido);
    return { conectado, ativo: config.ativos === true && t?.ativo === true && conectado && valido, ...(t?.contaId ? { conta: t.contaId } : {}) };
  }
  async function conectar(lojaId, uid) {
    if (!/^\d{1,30}$/.test(config.clientId || "")) falha("CONFIGURACAO", "A conexão de pagamentos ainda não foi configurada.", 503);
    const state = aleatorio(), verifier = aleatorio();
    await db.doc(`oauthPagamento/${sha256(state)}`).set({ lojaId, uid, verifier, expiresAt: new Date(+agora() + 10 * 60000), consumido: false });
    const url = new URL("https://auth.mercadopago.com/authorization");
    url.search = new URLSearchParams({ client_id: config.clientId, response_type: "code", platform_id: "mp", state, redirect_uri: callbackURL(), code_challenge: desafioPKCE(verifier), code_challenge_method: "S256" }).toString();
    return { url: url.href };
  }
  async function callback(query) {
    if (typeof query.state !== "string" || !/^[\w-]{40,80}$/.test(query.state) || typeof query.code !== "string" || !query.code || query.code.length > 2000) falha("OAUTH_INVALIDO", "Essa autorização não é válida ou venceu.");
    const ref = db.doc(`oauthPagamento/${sha256(query.state)}`);
    const estado = await db.runTransaction(async (tx) => {
      const e = (await tx.get(ref)).data();
      if (!e || e.consumido || +data(e.expiresAt) <= +agora()) falha("OAUTH_INVALIDO", "Essa autorização não é válida ou venceu.");
      tx.update(ref, { consumido: true, consumidoEm: carimbo() }); return e;
    });
    await membro(estado.lojaId, estado.uid);
    const tokens = await mp("/oauth/token", { method: "POST", body: { client_id: config.clientId, client_secret: segredo().clientSecret, grant_type: "authorization_code", code: query.code, redirect_uri: callbackURL(), code_verifier: estado.verifier } });
    if (!contaValida(tokens.user_id)) falha("OAUTH_INVALIDO", "A conta não pôde ser conectada.", 502);
    const contaId = String(tokens.user_id), eu = await mp("/users/me", { token: tokens.access_token });
    if (String(eu.id) !== contaId) falha("OAUTH_INVALIDO", "O provedor retornou uma conta diferente.", 502);
    const campos = tokensCifrados(tokens, estado.lojaId, contaId);
    await membro(estado.lojaId, estado.uid);
    await db.runTransaction(async (tx) => {
      // Conectar a conta não libera o checkout; ativação é uma ação separada.
      tx.set(contaRef(estado.lojaId, contaId), campos, { merge: true });
      tx.set(integracaoRef(estado.lojaId), { ativo: false, contaId, atualizadoEm: carimbo() }, { merge: true });
      tx.update(lojaRef(estado.lojaId), { pagamentoOnline: { ativo: false, provedor: "mercadopago" } });
    });
    const url = new URL("painel.html", config.frontend); url.searchParams.set("pagamento", "conectado"); url.hash = "configuracoes";
    return url.href;
  }
  async function pausar(lojaId) {
    await db.runTransaction(async (tx) => {
      tx.set(integracaoRef(lojaId), { ativo: false, atualizadoEm: carimbo() }, { merge: true });
      tx.update(lojaRef(lojaId), { pagamentoOnline: { ativo: false, provedor: "mercadopago" } });
    });
    return { ativo: false };
  }
  async function ativar(lojaId) {
    const ref = integracaoRef(lojaId), inicial = (await ref.get()).data();
    if (!contaValida(inicial?.contaId)) falha("RECONECTAR", "Conecte a conta de pagamento deste restaurante.", 409);
    const contaId = inicial.contaId;
    let credencial;
    try { credencial = await tokenDaConta(lojaId, contaId, true); }
    catch (err) { if (!err.codigo) falha("RECONECTAR", "Reconecte a conta de pagamento deste restaurante.", 409); throw err; }
    if (typeof credencial.versao !== "string" || !credencial.versao || typeof credencial.token !== "string" || !credencial.token) falha("RECONECTAR", "Reconecte a conta de pagamento deste restaurante.", 409);
    let eu;
    try { eu = await mp("/users/me", { token: credencial.token }); }
    catch (err) {
      if (err.providerStatus === 401 || err.providerCode === "invalid_grant") {
        await db.runTransaction(async (tx) => {
          const integracao = (await tx.get(ref)).data(), conta = (await tx.get(contaRef(lojaId, contaId))).data();
          if (integracao?.contaId !== contaId || conta?.versao !== credencial.versao) return;
          tx.update(contaRef(lojaId, contaId), { reconectar: true });
          tx.update(ref, { ativo: false });
          tx.update(lojaRef(lojaId), { pagamentoOnline: { ativo: false, provedor: "mercadopago" } });
        });
        falha("RECONECTAR", "Reconecte a conta de pagamento deste restaurante.", 409);
      }
      throw err;
    }
    if (String(eu.id) !== String(contaId)) falha("RECONECTAR", "O provedor não confirmou a conta conectada. Reconecte a conta.", 409);
    await db.runTransaction(async (tx) => {
      const integracao = (await tx.get(ref)).data(), conta = (await tx.get(contaRef(lojaId, contaId))).data();
      if (integracao?.contaId !== contaId || conta?.versao !== credencial.versao || conta.reconectar || !conta.protegido
        || !(+data(conta.expiresAt) > +agora() + 60000)) falha("RECONECTAR", "A conexão mudou. Confira a conta antes de ativar.", 409);
      tx.update(ref, { ativo: true, atualizadoEm: carimbo() });
      tx.update(lojaRef(lojaId), { pagamentoOnline: { ativo: true, provedor: "mercadopago" } });
    });
    return { ativo: true };
  }
  async function transacao(lojaId, id) {
    const t = (await transacaoRef(id).get()).data();
    if (!t || t.lojaId !== lojaId) falha("NAO_ENCONTRADO", "Pagamento não encontrado.", 404);
    return t;
  }
  const resumoCheckout = (t) => ({ pedidoId: t.pedidoId, estado: t.estado, ...(t.checkoutUrl ? { checkoutUrl: t.checkoutUrl } : {}) });
  async function checkout(lojaId, id, entrada) {
    if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) falha("VALIDACAO", "Confira seu pedido.");
    const hash = sha256(canonico(entrada));
    const reservado = await db.runTransaction(async (tx) => {
      const ref = transacaoRef(id), existente = (await tx.get(ref)).data();
      if (existente) {
        if (existente.lojaId !== lojaId || existente.hash !== hash) falha("CONFLITO", "Este envio já está vinculado a outro pedido.", 409);
        return { t: existente, novo: false };
      }
      const l = (await tx.get(lojaRef(lojaId))).data(), integracao = (await tx.get(integracaoRef(lojaId))).data();
      if (!l || !integracao?.ativo || !contaValida(integracao.contaId)) falha("PAGAMENTO_DESATIVADO", "O pagamento online está indisponível nesta loja.", 409);
      const itens = (await tx.get(db.collection(`lojas/${lojaId}/itens`))).docs.map((d) => ({ id: d.id, ...d.data() }));
      const bairros = (await tx.get(db.collection(`lojas/${lojaId}/bairros`))).docs.map((d) => ({ id: d.id, ...d.data() }));
      if (entrada.cupom !== undefined && (typeof entrada.cupom !== "string" || !/^[A-Z0-9]{3,20}$/.test(entrada.cupom))) falha("VALIDACAO", "Confira o cupom.");
      const cRef = entrada.cupom ? db.doc(`lojas/${lojaId}/cupons/${entrada.cupom}`) : null;
      const cupom = cRef ? (await tx.get(cRef)).data() : null;
      const oferta = cupom?.individual ? (await tx.get(db.doc(`lojas/${lojaId}/ofertasClientes/${entrada.cupom}`))).data() : null;
      const reservaRef = cupom?.individual ? db.doc(`lojas/${lojaId}/reservasCupons/${entrada.cupom}`) : null;
      if (reservaRef && (await tx.get(reservaRef)).exists) falha("CUPOM_RESERVADO", "Esse cupom já está reservado por outro pedido.", 409);
      const pedido = calcularPedido({ loja: l, itens, bairros, cupom, oferta }, entrada, agora());
      const expiresAt = new Date(Math.min(+agora() + 30 * 60000, pedido.agendadoPara ? +pedido.agendadoPara : Infinity));
      const t = { lojaId, pedidoId: id, contaId: String(integracao.contaId), pedido, hash, estado: "gerando", finalizado: false, criadoEm: carimbo(), expiresAt, reservaAtiva: !!cupom, reservaTipo: cupom ? cupom.individual ? "individual" : "comum" : null };
      if (reservaRef) tx.set(reservaRef, { pedidoId: id, criadoEm: carimbo() });
      if (cRef && !cupom.individual) tx.update(cRef, { reservasOnline: (cupom.reservasOnline || 0) + 1 });
      tx.create(ref, t); publicar(tx, t, "gerando", { expiresAt: t.expiresAt });
      return { t, novo: true };
    });
    const t = reservado.t;
    if (!reservado.novo) return resumoCheckout(t);
    try {
      const token = await tokenDaConta(lojaId, t.contaId), back = new URL(config.frontend);
      back.searchParams.set("loja", lojaId); back.hash = `pedido/${id}`;
      const notification = config.webhookURL ? new URL(config.webhookURL(lojaId, id)) : new URL(`${config.url.replace(/\/$/, "")}/webhook`);
      if (!config.webhookURL) notification.search = new URLSearchParams({ lojaId, pedidoId: id }).toString();
      const preferencia = await mp("/checkout/preferences", { method: "POST", token, idempotencia: sha256(`preferencia:${id}`), body: {
        items: [{ id, title: "Pedido no restaurante", quantity: 1, unit_price: t.pedido.total / 100, currency_id: "BRL" }],
        external_reference: `${lojaId}:${id}`, metadata: { loja_id: lojaId, pedido_id: id },
        back_urls: { success: back.href, failure: back.href, pending: back.href }, auto_return: "approved",
        payment_methods: { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] },
        notification_url: notification.href, expires: true, expiration_date_from: agora().toISOString(), expiration_date_to: t.expiresAt.toISOString(),
      } });
      const checkoutUrl = preferencia.init_point;
      if (typeof checkoutUrl !== "string" || !/^https:\/\/(www\.)?mercadopago\.com\.br\//.test(checkoutUrl) || !preferencia.id) falha("ERRO_PROVEDOR", "Não foi possível abrir o pagamento. Aguarde a conferência.", 502);
      await db.runTransaction(async (tx) => {
        const atual = (await tx.get(transacaoRef(id))).data();
        if (atual.estado !== "gerando") return;
        tx.update(transacaoRef(id), { estado: "aguardando", preferenceId: String(preferencia.id), checkoutUrl });
        publicar(tx, t, "aguardando", { checkoutUrl });
      });
      return resumoCheckout(await transacao(lojaId, id));
    } catch (err) {
      await db.runTransaction(async (tx) => {
        const atual = (await tx.get(transacaoRef(id))).data();
        if (atual?.estado === "gerando") { tx.update(transacaoRef(id), { estado: "reconciliar" }); publicar(tx, t, "reconciliar"); }
      });
      throw err;
    }
  }
  // Todas as leituras da reserva precedem suas escritas, como exige o Firestore.
  async function reserva(tx, t) {
    if (!t.reservaAtiva || !t.pedido.cupom) return () => {};
    const cRef = db.doc(`lojas/${t.lojaId}/cupons/${t.pedido.cupom}`), c = (await tx.get(cRef)).data();
    const rRef = db.doc(`lojas/${t.lojaId}/reservasCupons/${t.pedido.cupom}`);
    const r = t.reservaTipo === "individual" ? (await tx.get(rRef)).data() : null;
    return () => {
      if (t.reservaTipo === "individual" && r?.pedidoId === t.pedidoId) tx.delete(rRef);
      if (t.reservaTipo === "comum" && c) tx.update(cRef, { reservasOnline: Math.max(0, (c.reservasOnline || 0) - 1) });
    };
  }
  function agendarEstorno(tx, t, pagamento, motivo) {
    const id = String(pagamento.id), pendentes = [...new Set([...(t.estornosPendentes || []), id])];
    tx.update(transacaoRef(t.pedidoId), { estornosPendentes: pendentes, finalizado: false, expiresAt: agora(),
      ...(motivo === "tardio" ? { estado: "estorno_pendente", paymentId: id, requerEstorno: true } : {}) });
    publicar(tx, t, motivo === "tardio" ? "reconciliar" : t.estado, { devolucaoPendente: true });
    return { estado: motivo === "tardio" ? "reconciliar" : t.estado, estornoAutomatico: true };
  }
  async function processarEstornos(t) {
    for (const paymentId of t.estornosPendentes || []) {
      const token = await tokenDaConta(t.lojaId, t.contaId), pagamento = await mp(`/v1/payments/${paymentId}`, { token });
      validarPagamento(pagamento, t, paymentId);
      if (pagamento.status !== "refunded") {
        if (pagamento.status !== "approved") falha("ESTORNO_PENDENTE", "A devolução continua em conferência.", 502);
        const devolucao = await mp(`/v1/payments/${paymentId}/refunds`, { method: "POST", token, body: { amount: t.pedido.total / 100 }, idempotencia: sha256(`estorno:${t.pedidoId}:${paymentId}`) });
        if (devolucao.status !== "approved" || Math.round(Number(devolucao.amount) * 100) !== t.pedido.total || String(devolucao.payment_id) !== paymentId) falha("ESTORNO_PENDENTE", "A devolução continua em conferência.", 502);
      }
      await db.runTransaction(async (tx) => {
        const ref = transacaoRef(t.pedidoId), atual = (await tx.get(ref)).data();
        if (!(atual.estornosPendentes || []).includes(paymentId)) return;
        const principalTardio = atual.requerEstorno && atual.paymentId === paymentId;
        const liberar = principalTardio ? await reserva(tx, atual) : () => {};
        const pendentes = atual.estornosPendentes.filter((id) => id !== paymentId);
        liberar();
        tx.update(ref, { estornosPendentes: pendentes, [`estornosAutomaticos.${paymentId}`]: { estado: "reembolsado", reembolsadoEm: carimbo() },
          finalizado: pendentes.length === 0 && (principalTardio || ["aprovado", ...TERMINAIS].includes(atual.estado)),
          ...(principalTardio ? { estado: "reembolsado", reservaAtiva: false, reembolsadoEm: carimbo() } : {}) });
        publicar(tx, atual, principalTardio ? "reembolsado" : atual.estado, { devolucaoPendente: pendentes.length > 0 });
      });
    }
    return { estado: (await transacao(t.lojaId, t.pedidoId)).estado };
  }
  async function atualizarPagamento(t, pagamento) {
    validarPagamento(pagamento, t);
    const resultado = await db.runTransaction(async (tx) => {
      const ref = transacaoRef(t.pedidoId), atual = (await tx.get(ref)).data();
      if (!atual || atual.lojaId !== t.lojaId) falha("NAO_ENCONTRADO", "Pagamento não encontrado.", 404);
      const entradaSnap = await tx.get(pedidoRef(t.lojaId, t.pedidoId));
      const finalSnap = await tx.get(pedidoRef(t.lojaId, t.pedidoId, true));
      const outroPagamento = atual.paymentId && atual.paymentId !== String(pagamento.id);
      if (outroPagamento) {
        if (pagamento.status === "approved") return agendarEstorno(tx, atual, pagamento, "duplicado");
        return { estado: atual.estado };
      }
      if (pagamento.status === "refunded") {
        if (atual.estado === "reembolsado") return { estado: "reembolsado" };
        const liberar = !finalSnap.exists ? await reserva(tx, atual) : () => {};
        const anterior = entradaSnap.data() || finalSnap.data();
        const pagamentoFinal = { ...(anterior?.pagamento || atual.pedido.pagamento), pago: true, reembolsado: true, estornoPendente: false, estornoEm: carimbo(), paymentId: String(pagamento.id) };
        const ficha = entradaSnap.exists ? await camposFicha({ id: t.pedidoId, ...anterior }, { status: "cancelado" }, carimbo()) : null;
        liberar();
        if (entradaSnap.exists) {
          tx.set(pedidoRef(t.lojaId, t.pedidoId, true), { ...anterior, status: "cancelado", concluidoEm: carimbo(), pagamento: pagamentoFinal });
          tx.delete(pedidoRef(t.lojaId, t.pedidoId));
          tx.set(db.doc(`lojas/${t.lojaId}/clientes/${telefoneDe(anterior)}`), ficha, { merge: true });
        } else if (finalSnap.exists) tx.update(pedidoRef(t.lojaId, t.pedidoId, true), { pagamento: pagamentoFinal });
        tx.update(ref, { estado: "reembolsado", finalizado: !(atual.estornosPendentes || []).length, reservaAtiva: false, paymentId: String(pagamento.id), reembolsadoEm: carimbo() });
        publicar(tx, atual, "reembolsado"); return { estado: "reembolsado" };
      }
      if (atual.estado === "aprovado" || atual.estado === "estorno_pendente") return { estado: atual.estado };
      if (TERMINAIS.includes(atual.estado)) {
        if (pagamento.status === "approved" && atual.estado !== "reembolsado") return agendarEstorno(tx, atual, pagamento, "tardio");
        return { estado: atual.estado };
      }
      const entrada = entradaSnap.exists, final = finalSnap.exists;
      if (pagamento.status === "approved") {
        const agenda = atual.pedido.agendadoPara && data(atual.pedido.agendadoPara);
        const aprovadoEm = pagamento.date_approved ? new Date(pagamento.date_approved) : null;
        if (agenda && (!aprovadoEm || !Number.isFinite(+aprovadoEm) || +aprovadoEm > +data(atual.expiresAt) || +agora() >= +agenda)) return agendarEstorno(tx, atual, pagamento, "tardio");
        const pagoEm = carimbo();
        if (!entrada && !final) tx.create(pedidoRef(t.lojaId, t.pedidoId), { ...atual.pedido, criadoEm: carimbo(), pagamento: { forma: "Mercado Pago", online: true, pago: true, pagoEm, paymentId: String(pagamento.id), ...(atual.reservaAtiva && atual.reservaTipo === "comum" ? { reservaCupom: true } : {}) } });
        tx.update(ref, { estado: "aprovado", finalizado: true, paymentId: String(pagamento.id), pagoEm });
        publicar(tx, atual, "aprovado"); return { estado: "aprovado" };
      }
      // Um cartão recusado pode ser trocado no mesmo checkout. Só a expiração fecha a tentativa.
      const venceu = +data(atual.expiresAt) <= +agora();
      const aindaPendente = ["pending", "in_process", "authorized"].includes(pagamento.status)
        && (!pagamento.date_of_expiration || +new Date(pagamento.date_of_expiration) > +agora());
      if (venceu && !aindaPendente) {
        const liberar = await reserva(tx, atual); liberar();
        tx.update(ref, { estado: "expirado", finalizado: true, reservaAtiva: false }); publicar(tx, atual, "expirado"); return { estado: "expirado" };
      }
      return { estado: atual.estado };
    });
    return resultado.estornoAutomatico ? processarEstornos(await transacao(t.lojaId, t.pedidoId)) : resultado;
  }
  async function consultar(lojaId, id) {
    const t = await transacao(lojaId, id);
    if (t.estornosPendentes?.length) return processarEstornos(t);
    if (TERMINAIS.includes(t.estado) || t.estado === "aprovado") return { estado: t.estado };
    const token = await tokenDaConta(lojaId, t.contaId);
    const resultado = await mp(`/v1/payments/search?external_reference=${encodeURIComponent(`${lojaId}:${id}`)}`, { token });
    if (!Array.isArray(resultado.results)) falha("ERRO_PROVEDOR", "Não foi possível conferir o pagamento.", 502);
    const pagamentos = resultado.results;
    // Nunca confiar no status resumido: ler o recurso que a API identificou.
    const p = pagamentos.find((p) => p.status === "approved") || pagamentos.find((p) => ["pending", "in_process", "authorized"].includes(p.status)) || pagamentos[0];
    if (p) {
      if (!contaValida(p.id)) falha("ERRO_PROVEDOR", "Não foi possível conferir o pagamento.", 502);
      const pagamento = await mp(`/v1/payments/${p.id}`, { token }); validarPagamento(pagamento, t, p.id);
      return atualizarPagamento(t, pagamento);
    }
    if (+data(t.expiresAt) <= +agora()) {
      return db.runTransaction(async (tx) => {
        const atual = (await tx.get(transacaoRef(id))).data();
        if (["aprovado", "estorno_pendente", ...TERMINAIS].includes(atual.estado)) return { estado: atual.estado };
        const liberar = await reserva(tx, atual); liberar();
        tx.update(transacaoRef(id), { estado: "expirado", finalizado: true, reservaAtiva: false }); publicar(tx, atual, "expirado"); return { estado: "expirado" };
      });
    }
    return { estado: t.estado };
  }
  async function webhook(req) {
    const q = req.query || {}, id = q["data.id"];
    const assinou = config.verificarWebhook ? config.verificarWebhook(req) : assinaturaWebhook({ assinatura: req.headers?.["x-signature"], requestId: req.headers?.["x-request-id"], dataId: id, segredo: segredo().webhookSecret, agora: +agora() });
    if (!assinou) falha("ASSINATURA_INVALIDA", "Notificação não autorizada.", 401);
    validarIds(q.lojaId, q.pedidoId);
    if (!contaValida(id) || (req.body?.data?.id != null && String(req.body.data.id).toLowerCase() !== id.toLowerCase())) falha("VALIDACAO", "Notificação inválida.");
    const t = await transacao(q.lojaId, q.pedidoId), token = await tokenDaConta(t.lojaId, t.contaId);
    const pagamento = await mp(`/v1/payments/${id}`, { token }); validarPagamento(pagamento, t, id);
    return atualizarPagamento(t, pagamento);
  }
  async function recusar(lojaId, id) {
    let t = await transacao(lojaId, id);
    if (t.estado === "reembolsado") return { estado: "reembolsado" };
    if (!t.paymentId) falha("CONFLITO", "Aguarde a confirmação do pagamento antes de recusar.", 409);
    const token = await tokenDaConta(lojaId, t.contaId), p = await mp(`/v1/payments/${t.paymentId}`, { token });
    validarPagamento(p, t, t.paymentId);
    if (!["approved", "refunded"].includes(p.status)) falha("CONFLITO", "O provedor ainda não confirmou esse pagamento.", 409);
    await db.runTransaction(async (tx) => {
      const atual = (await tx.get(transacaoRef(id))).data(), final = (await tx.get(pedidoRef(lojaId, id, true))).data();
      const entrada = (await tx.get(pedidoRef(lojaId, id))).data();
      if (atual.estado === "reembolsado") return;
      if (final && final.status !== "cancelado") falha("CONFLITO", "Este pedido já foi aceito. Confira o atendimento antes de estornar.", 409);
      if ((!entrada || entrada.status !== "novo") && !atual.requerEstorno) falha("CONFLITO", "Este pedido não está mais aguardando aceite.", 409);
      if (entrada) tx.update(pedidoRef(lojaId, id), { "pagamento.estornoPendente": true });
      tx.update(transacaoRef(id), { estado: "estorno_pendente", finalizado: false, expiresAt: agora() }); publicar(tx, atual, "reconciliar");
    });
    try {
      if (p.status !== "refunded") {
        const devolucao = await mp(`/v1/payments/${t.paymentId}/refunds`, { token, method: "POST", body: { amount: t.pedido.total / 100 }, idempotencia: sha256(`estorno:${id}:${t.paymentId}`) });
        if (devolucao.status !== "approved" || Math.round(Number(devolucao.amount) * 100) !== t.pedido.total || String(devolucao.payment_id) !== t.paymentId) falha("ESTORNO_PENDENTE", "A devolução ainda não foi confirmada. O pedido permanece em conferência.", 502);
      }
      return await db.runTransaction(async (tx) => {
        const atual = (await tx.get(transacaoRef(id))).data();
        const entrada = await tx.get(pedidoRef(lojaId, id)), final = await tx.get(pedidoRef(lojaId, id, true));
        if (atual.estado === "reembolsado") return { estado: "reembolsado" };
        if (final.exists && final.data().status !== "cancelado") falha("CONFLITO", "O pedido mudou enquanto o pagamento era devolvido. Confira o atendimento.", 409);
        const liberar = await reserva(tx, atual), pedido = { id, ...atual.pedido, criadoEm: entrada.data()?.criadoEm || atual.criadoEm };
        const ficha = await camposFicha(pedido, { status: "cancelado" }, carimbo());
        liberar();
        tx.set(pedidoRef(lojaId, id, true), { ...atual.pedido, criadoEm: pedido.criadoEm, status: "cancelado", concluidoEm: carimbo(), pagamento: { forma: "Mercado Pago", online: true, pago: true, reembolsado: true, estornoPendente: false, estornoEm: carimbo(), paymentId: atual.paymentId } });
        if (entrada.exists) tx.delete(pedidoRef(lojaId, id));
        if (/^\d{10,11}$/.test(telefoneDe(pedido))) tx.set(db.doc(`lojas/${lojaId}/clientes/${telefoneDe(pedido)}`), ficha, { merge: true });
        tx.update(transacaoRef(id), { estado: "reembolsado", finalizado: true, reservaAtiva: false, reembolsadoEm: carimbo() }); publicar(tx, atual, "reembolsado"); return { estado: "reembolsado" };
      });
    } catch (err) { throw err; } // conserva estorno_pendente; repetir usa a mesma chave no provedor
  }

  const handler = async (req, res) => {
    res.set("Cache-Control", "no-store"); res.set("X-Content-Type-Options", "nosniff");
    const origem = req.headers?.origin, principal = new URL(config.frontend).origin;
    const local = typeof origem === "string" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origem);
    if (origem && origem !== principal && !(config.emulador && local)) return res.status(403).json({ ok: false, erro: { codigo: "ORIGEM_INVALIDA", mensagem: "Acesso não autorizado." } });
    if (origem) { res.set("Access-Control-Allow-Origin", origem); res.set("Vary", "Origin"); }
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Firebase-AppCheck"); res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.status(204).end();
    try {
      const rota = String(req.path || new URL(req.url, "http://local").pathname).replace(/\/$/, "").split("/").at(-1);
      const esperados = { status: "GET", conectar: "POST", callback: "GET", ativar: "POST", pausar: "POST", checkout: "POST", consultar: "POST", webhook: "POST", recusar: "POST" };
      if (!esperados[rota]) falha("NAO_ENCONTRADO", "Endereço não encontrado.", 404);
      if (req.method !== esperados[rota]) falha("METODO_INVALIDO", "Método não permitido.", 405);
      if (req.rawBody?.length > 100000 || (typeof req.body === "string" && req.body.length > 100000)) falha("VALIDACAO", "Pedido muito grande.", 413);
      if (typeof req.body === "string") { try { req.body = JSON.parse(req.body); } catch { falha("VALIDACAO", "Pedido inválido."); } }
      const body = req.body || {}, query = req.query || {}, lojaId = rota === "status" ? query.lojaId : body.lojaId;
      if (rota !== "status" && config.ativos !== true) falha("PAGAMENTO_DESATIVADO", "O pagamento online ainda não está disponível.", 503);
      if (["status", "conectar", "ativar", "pausar", "recusar"].includes(rota)) {
        validarIds(lojaId, rota === "recusar" ? body.pedidoId : undefined);
        const user = await autenticar(req, lojaId);
        const resultado = rota === "status" ? await status(lojaId) : rota === "conectar" ? await conectar(lojaId, user.uid) : rota === "ativar" ? await ativar(lojaId) : rota === "pausar" ? await pausar(lojaId) : await recusar(lojaId, body.pedidoId);
        return res.status(200).json({ ok: true, data: resultado });
      }
      if (rota === "callback") return res.redirect(303, await callback(query));
      if (rota === "webhook") return res.status(200).json({ ok: true, data: await webhook(req) });
      validarIds(lojaId, body.pedidoId); await conferirApp(req);
      const resultado = rota === "checkout" ? await checkout(lojaId, body.pedidoId, body.pedido) : await consultar(lojaId, body.pedidoId);
      return res.status(200).json({ ok: true, data: resultado });
    } catch (err) {
      const codigo = err.codigo || "ERRO_INTERNO", http = err.http || (err.codigo ? 400 : 500);
      return res.status(http).json({ ok: false, erro: { codigo, mensagem: err.codigo ? err.message : "Não foi possível concluir a operação. Tente novamente mais tarde." } });
    }
  };
  // A futura rotina periódica usa a mesma reconciliação; não libera reserva por relógio.
  handler.expirarPendentes = async ({ consultarEmAberto = false } = {}) => {
    if (config.ativos !== true) return [];
    let busca = db.collection("transacoesPagamento").where("finalizado", "==", false);
    if (!consultarEmAberto) busca = busca.where("expiresAt", "<=", agora());
    const vencidas = await busca.limit(50).get();
    const resultados = [];
    for (const d of vencidas.docs) {
      const t = d.data();
      if (!["gerando", "aguardando", "reconciliar", "estorno_pendente"].includes(t.estado) && !t.estornosPendentes?.length) continue;
      try {
        const resultado = t.estado === "estorno_pendente" && !t.estornosPendentes?.length ? await recusar(t.lojaId, d.id) : await consultar(t.lojaId, d.id);
        resultados.push({ pedidoId: d.id, ...resultado });
      } catch { resultados.push({ pedidoId: d.id, estado: "reconciliar" }); }
    }
    return resultados;
  };
  return handler;
}
