import { escolhasValidas, precoUnitario, resumoOpcoes } from "../preco-item.js?v=1";
import { distanciaKm, regraDe, taxaKm } from "../conta-entrega.js?v=1";
import { motivoAgendamento } from "../agendamento.js?v=1";
import { agora as horaLocal, situacao } from "../horario.js?v=1";
import { codigoValido, descontoDe, motivoRecusa } from "../cupom.js?v=1";
import { cestaCanonica, mesmaCesta } from "../oferta-cupom.js?v=1";

const MAX = 10000000;
const erro = (mensagem, codigo = "VALIDACAO") => { throw Object.assign(new Error(mensagem), { codigo }); };
const inteiro = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const mapa = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v))
  && Reflect.ownKeys(v).every((k) => typeof k === "string" && !["__proto__", "prototype", "constructor"].includes(k));
const texto = (v, min, max) => typeof v === "string" && v.trim().length >= min && v.length <= max;
const normalizar = (v) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
const ponto = (p) => mapa(p) && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180;

function escolhasDaLinha(v = {}) {
  if (!mapa(v) || Object.keys(v).length > 50) erro("Confira as opções dos produtos.");
  for (const grupo of Object.values(v)) {
    if (!mapa(grupo) || Object.keys(grupo).length > 50 || Object.values(grupo).some((n) => !inteiro(n, 1, 50))) erro("Confira as quantidades das opções.");
  }
  return Object.fromEntries(Object.entries(v).map(([k, opcoes]) => [k, { ...opcoes }]));
}

function enderecoDoPedido(loja, bairros, tipo, entrada) {
  if (tipo !== "entrega") return { endereco: null, taxa: 0 };
  if (!mapa(entrada) || !texto(entrada.bairro, 1, 100) || !texto(entrada.rua, 1, 160)
    || !texto(entrada.numero, 1, 30) || !texto(entrada.referencia, 1, 200)
    || !texto(entrada.complemento ?? "", 0, 160) || !texto(entrada.cep ?? "", 0, 10)) erro("Confira o endereço completo da entrega.");
  const nome = normalizar(entrada.bairro), mesmo = nome === normalizar(loja.bairro || "");
  const bairro = bairros.find((b) => normalizar(b.nome || "") === nome);
  if (!mesmo && !bairro) erro("Ainda não entregamos nesse bairro.");
  const regra = regraDe(loja);
  if (!inteiro(regra.taxaBairro, 0, MAX) || !inteiro(regra.porKm, 0, MAX) || !inteiro(regra.arredondar, 0, MAX)
    || !Number.isFinite(regra.raioMaxKm) || regra.raioMaxKm < 0) erro("A loja precisa conferir a configuração da entrega.");
  if (!mesmo && (!ponto(loja.local) || !ponto(bairro))) erro("A loja precisa conferir o bairro da entrega.");
  const km = mesmo ? 0 : distanciaKm(loja.local, bairro);
  if (!Number.isFinite(km) || km > regra.raioMaxKm) erro("Ainda não entregamos nesse endereço.");
  const taxa = taxaKm(km, mesmo, regra);
  if (!inteiro(taxa, 0, MAX)) erro("A loja precisa conferir a taxa de entrega.");
  return { taxa, endereco: {
    rua: entrada.rua.trim(), numero: entrada.numero.trim(), bairro: mesmo ? loja.bairro : bairro.nome,
    complemento: (entrada.complemento || "").trim(), referencia: entrada.referencia.trim(), cep: (entrada.cep || "").trim(), km: Math.round(km * 10) / 10,
  } };
}

export function calcularPedido({ loja, itens, bairros = [], cupom = null, oferta = null }, entrada, agora = new Date()) {
  if (!mapa(entrada) || !mapa(entrada.cliente) || !texto(entrada.cliente.nome, 2, 80)
    || !/^\d{10,11}$/.test(entrada.cliente.telefone || "") || typeof entrada.cliente.telefone !== "string") erro("Confira seu nome e WhatsApp com DDD.");
  if (!Array.isArray(entrada.itens) || entrada.itens.length < 1 || entrada.itens.length > 50
    || !["entrega", "retirada", "local"].includes(entrada.tipo)) erro("Confira os itens e a forma de receber o pedido.");
  let agendadoPara;
  if (Object.hasOwn(entrada, "agendadoPara")) {
    if (!(entrada.agendadoPara instanceof Date) && typeof entrada.agendadoPara !== "string") erro("Confira o horário agendado.");
    const motivo = motivoAgendamento(loja, entrada.agendadoPara, agora);
    if (motivo) erro(motivo);
    agendadoPara = new Date(entrada.agendadoPara);
  } else if (!situacao(loja, horaLocal(agora)).aberta) erro("O restaurante não está recebendo pedidos agora.");
  const linhas = entrada.itens.map((linha) => {
    if (!mapa(linha) || !texto(linha.itemId, 1, 100) || !inteiro(linha.qtd, 1, 50) || !texto(linha.obs ?? "", 0, 500)) erro("Confira as quantidades e observações dos produtos.");
    const item = itens.find((i) => i.id === linha.itemId), escolhas = escolhasDaLinha(linha.escolhas);
    if (!item || !escolhasValidas(item, escolhas)) erro("Um produto ou opção não está mais disponível. Confira sua sacola.");
    const unitario = precoUnitario(item, escolhas), total = unitario * linha.qtd;
    if (!inteiro(unitario, 0, MAX) || !inteiro(total, 0, MAX)) erro("A loja precisa conferir o preço desse produto.");
    return { itemId: item.id, escolhas, qtd: linha.qtd, nome: item.nome, resumo: resumoOpcoes(item, escolhas), total, obs: (linha.obs || "").trim() };
  });
  const subtotal = linhas.reduce((s, l) => s + l.total, 0);
  if (!inteiro(subtotal, 0, MAX)) erro("O valor dos produtos ultrapassa o limite do pedido.");
  const entrega = enderecoDoPedido(loja, bairros, entrada.tipo, entrada.endereco);
  let desconto = 0;
  const codigo = entrada.cupom;
  if (codigo !== undefined) {
    if (typeof codigo !== "string" || !codigoValido(codigo) || !cupom || cupom.ativo !== true
      || !["pct", "valor"].includes(cupom.tipo) || !inteiro(cupom.valor, 1, cupom.tipo === "pct" ? 100 : MAX)
      || !inteiro(cupom.minimo ?? 0, 0, MAX) || !inteiro(cupom.usos ?? 0, 0, MAX)
      || !inteiro(cupom.reservasOnline ?? 0, 0, MAX) || (cupom.limite != null && !inteiro(cupom.limite, 1, MAX))) erro("Confira o cupom do pedido.");
    if (cupom.validoAte != null) {
      const ate = cupom.validoAte?.toDate ? cupom.validoAte.toDate() : new Date(cupom.validoAte);
      if (!Number.isFinite(+ate)) erro("A loja precisa conferir a validade do cupom.");
    }
    const motivo = motivoRecusa({ ...cupom, usos: (cupom.usos || 0) + (cupom.reservasOnline || 0) }, subtotal, (v) => `R$ ${(v / 100).toFixed(2)}`, agora);
    if (motivo) erro(motivo);
    if (cupom.individual && (oferta?.telefone !== entrada.cliente.telefone || !Array.isArray(cupom.oferta)
      || !mesmaCesta(cestaCanonica(linhas), cupom.oferta))) erro("Este cupom vale somente para o destinatário e os itens da oferta.");
    desconto = descontoDe(cupom, subtotal);
  }
  const total = subtotal + entrega.taxa - desconto;
  if (!inteiro(total, 1, MAX)) erro("Confira o valor total do pedido.");
  if (entrada.subtotal !== subtotal || entrada.total !== total) erro("O preço ou a taxa mudou. Confira sua sacola antes de pagar.", "PRECO_ALTERADO");
  return {
    cliente: { nome: entrada.cliente.nome.trim().replace(/\s+/g, " "), telefone: entrada.cliente.telefone },
    tipo: entrada.tipo, endereco: entrega.endereco, itens: linhas, subtotal, taxa: entrega.taxa, total,
    pagamento: { forma: "Mercado Pago", online: true, pago: false }, status: "novo",
    ...(codigo ? { cupom: codigo, desconto } : {}), ...(agendadoPara ? { agendadoPara } : {}),
  };
}
