/*
  horario.js: aberto ou fechado agora, num lugar só (loja, painel e prévia).

  lojas/{loja}.horario = { seg: { aberto, abre: "18:00", fecha: "23:00" }, ter: ..., dom: ... }
  lojas/{loja}.abrirSozinho = true: fora do horário a loja fecha sozinha.
  lojas/{loja}.aberta = false: pausa da chave em Pedidos; fecha de qualquer jeito.
  Fechar em "00:00" ou antes de abrir quer dizer que passa da meia-noite.
  A hora é a de Belém (sem horário de verão), não a do aparelho de quem olha.
*/

export const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"]; // na ordem do getDay()
export const NOMES = { seg: "Segunda", ter: "Terça", qua: "Quarta", qui: "Quinta", sex: "Sexta", sab: "Sábado", dom: "Domingo" };
export const ORDEM = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"]; // como aparece no painel

const FUSO = "America/Belem";
export function agora(data = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: FUSO, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(data).map((x) => [x.type, x.value]));
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { dia, minutos: Number(p.hour) * 60 + Number(p.minute) };
}
const min = (hhmm) => { const [h, m] = String(hhmm || "").split(":").map(Number); return h * 60 + (m || 0); };
export const horaValida = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || "");
const texto = (hhmm) => (min(hhmm) === 0 ? "à meia-noite" : `às ${hhmm.replace(":", "h")}`);

// o turno de um dia vale do "abre" até o "fecha", que pode cair no dia seguinte
const virada = (d) => min(d.fecha) <= min(d.abre);
function turnoAgora(horario, t) {
  const hoje = horario?.[DIAS[t.dia]], ontem = horario?.[DIAS[(t.dia + 6) % 7]];
  if (hoje?.aberto && t.minutos >= min(hoje.abre) && (virada(hoje) || t.minutos < min(hoje.fecha))) return hoje;
  if (ontem?.aberto && virada(ontem) && t.minutos < min(ontem.fecha)) return ontem;
  return null;
}
function proximaAbertura(horario, t) {
  for (let n = 0; n < 7; n++) {
    const dia = DIAS[(t.dia + n) % 7], d = horario?.[dia];
    if (!d?.aberto || (n === 0 && t.minutos >= min(d.abre))) continue;
    const quando = n === 0 ? "" : n === 1 ? " amanhã" : ` ${NOMES[dia].toLowerCase()}`;
    return `Abre${quando} ${texto(d.abre)}`;
  }
  return "";
}

// { aberta, texto } para a loja agora
export function situacao(loja, t = agora()) {
  if (loja.aberta === false) return { aberta: false, texto: "Fechado agora" };
  const turno = turnoAgora(loja.horario, t);
  if (loja.abrirSozinho && loja.horario && !turno) {
    const prox = proximaAbertura(loja.horario, t);
    return { aberta: false, texto: prox ? `Fechado agora • ${prox}` : "Fechado agora" };
  }
  return { aberta: true, texto: turno ? `Aberto agora • Fecha ${texto(turno.fecha)}` : "Aberto agora" };
}
