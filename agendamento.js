// Agendamento em Belém: até 72 horas, de meia em meia hora, dentro do turno.
import { DIAS, NOMES, horaValida } from "./horario.js?v=1";

const HORA = 3600000, PASSO = HORA / 2, LIMITE = 72 * HORA;
const dataDe = (v) => v instanceof Date ? v : v?.toDate ? v.toDate() : new Date(v);
const local = (v) => new Date(dataDe(v).getTime() - 3 * HORA);
const pad = (n) => String(n).padStart(2, "0");
const chaveData = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const minuto = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const ligada = (loja) => (loja.ligada ?? loja.aberta) !== false;

function dentroDoTurno(loja, data) {
  const d = local(data), m = d.getUTCHours() * 60 + d.getUTCMinutes(), dia = d.getUTCDay();
  const hoje = loja.horario?.[DIAS[dia]], ontem = loja.horario?.[DIAS[(dia + 6) % 7]];
  const valido = (h) => h?.aberto && horaValida(h.abre) && horaValida(h.fecha);
  if (valido(hoje)) {
    const abre = minuto(hoje.abre), fecha = minuto(hoje.fecha);
    if (m >= abre && (fecha <= abre || m < fecha)) return true;
  }
  return !!(valido(ontem) && minuto(ontem.fecha) <= minuto(ontem.abre) && m < minuto(ontem.fecha));
}

export function motivoAgendamento(loja, valor, agora = new Date()) {
  if (!loja.aceitaAgendamento) return "Este restaurante não está aceitando pedidos agendados.";
  if (!ligada(loja)) return "O restaurante não está recebendo pedidos agora.";
  const data = dataDe(valor), atual = dataDe(agora);
  if (!valor || !Number.isFinite(data.getTime())) return "Escolha o dia e o horário do pedido.";
  if (data <= atual) return "Esse horário já passou. Escolha outro horário.";
  if (data - atual > LIMITE) return "Escolha um horário até 3 dias à frente.";
  if (data.getTime() % PASSO !== 0) return "Escolha um dos horários de meia em meia hora.";
  if (!dentroDoTurno(loja, data)) return "O restaurante não funciona nesse horário. Escolha outro horário.";
  return "";
}

export function horariosDisponiveis(loja, data = new Date()) {
  if (!loja.aceitaAgendamento || !ligada(loja)) return [];
  const atual = dataDe(data), hoje = chaveData(local(atual)), amanha = chaveData(local(new Date(+atual + 24 * HORA)));
  const dias = new Map();
  // Um horário exatamente igual ao instante atual já não pode ser escolhido.
  for (let t = (Math.floor(+atual / PASSO) + 1) * PASSO; t <= +atual + LIMITE; t += PASSO) {
    const valor = new Date(t), d = local(valor);
    if (!dentroDoTurno(loja, valor)) continue;
    const chave = chaveData(d), nome = NOMES[DIAS[d.getUTCDay()]];
    if (!dias.has(chave)) dias.set(chave, {
      data: chave, rotulo: chave === hoje ? "Hoje" : chave === amanha ? "Amanhã" : nome,
      detalhe: `${nome.slice(0, 3)}, ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`, horarios: [],
    });
    dias.get(chave).horarios.push({ valor: valor.toISOString(), texto: `${pad(d.getUTCHours())}h${pad(d.getUTCMinutes())}` });
  }
  return [...dias.values()];
}

export function textoAgendamento(valor, agora = new Date()) {
  const data = dataDe(valor);
  if (!valor || !Number.isFinite(data.getTime())) return "";
  const d = local(data), chave = chaveData(d), atual = dataDe(agora);
  const dia = chave === chaveData(local(atual)) ? "hoje"
    : chave === chaveData(local(new Date(+atual + 24 * HORA))) ? "amanhã"
      : `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`;
  return `${dia}, ${pad(d.getUTCHours())}h${pad(d.getUTCMinutes())}`;
}
