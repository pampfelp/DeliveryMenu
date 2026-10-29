// Datas civis de Belém (UTC-3), sem depender do fuso do computador.
const DIA = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const civil = (agora) => new Date(agora.getTime() - 3 * 3600000);
const inicio = (valor) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor || "")) return null;
  const d = new Date(`${valor}T03:00:00.000Z`);
  return Number.isFinite(d.getTime()) && iso(d) === valor ? d : null;
};

export function periodoPedidos(tipo = "hoje", agora = new Date(), de = "", ate = "") {
  const hoje = civil(agora), ano = hoje.getUTCFullYear(), mes = hoje.getUTCMonth();
  const dia = new Date(Date.UTC(ano, mes, hoje.getUTCDate(), 3));
  let primeiro = dia, ultimo = dia;
  if (tipo === "mes") { primeiro = new Date(Date.UTC(ano, mes, 1, 3)); ultimo = new Date(Date.UTC(ano, mes + 1, 0, 3)); }
  else if (tipo === "passado") { primeiro = new Date(Date.UTC(ano, mes - 1, 1, 3)); ultimo = new Date(Date.UTC(ano, mes, 0, 3)); }
  else if (tipo === "90dias") primeiro = new Date(dia.getTime() - 89 * DIA);
  else if (tipo === "personalizado") {
    primeiro = inicio(de); ultimo = inicio(ate);
    if (!primeiro || !ultimo) throw new Error("Preencha De e Até com datas válidas.");
    if (primeiro > ultimo) throw new Error("A data De deve ser anterior ou igual à data Até.");
  } else if (tipo !== "hoje") throw new Error("Escolha um período válido.");
  const fim = new Date(ultimo.getTime() + DIA);
  return { tipo, inicio: primeiro, fim, de: iso(primeiro), ate: iso(ultimo),
    // Hoje conserva a janela operacional de agendados e a comparação com ontem.
    consultaInicio: tipo === "hoje" ? new Date(dia.getTime() - 4 * DIA) : primeiro };
}

export function noPeriodo(criadoEm, periodo) {
  const d = criadoEm instanceof Date ? criadoEm : criadoEm?.toDate?.();
  return !!d && d >= periodo.inicio && d < periodo.fim;
}

export function pedidoVisivel(pedido, periodo) {
  if (noPeriodo(pedido.criadoEm, periodo)) return true;
  const criado = pedido.criadoEm instanceof Date ? pedido.criadoEm : pedido.criadoEm?.toDate?.();
  const agenda = pedido.agendadoPara instanceof Date ? pedido.agendadoPara : pedido.agendadoPara?.toDate?.();
  return periodo.tipo === "hoje" && !!criado && criado >= periodo.consultaInicio && criado < periodo.fim && !!agenda && agenda >= periodo.inicio;
}
