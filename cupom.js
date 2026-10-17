/*
  cupom.js: a conta do cupom, igual na loja, no painel e na regra do Firestore.

  lojas/{loja}/cupons/{CODIGO} = {
    tipo: "pct" | "valor", valor (pct: 1 a 100; valor: centavos),
    minimo (centavos, 0 = sem mínimo), validoAte (Timestamp do fim do dia, ou null),
    limite (usos no total, ou null), usos, ativo
  }
  O desconto vale só sobre os itens, nunca sobre a taxa de entrega
  (decisão dele, 2026-10-16). Um cupom por pedido. Os usos sobem no aceite.
*/

export const normalizarCodigo = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
export const codigoValido = (c) => /^[A-Z0-9]{3,20}$/.test(c);

const comoData = (v) => (v instanceof Date ? v : v?.toDate ? v.toDate() : v ? new Date(v) : null);

// desconto em centavos: arredonda como o math.round da regra
export function descontoDe(c, subtotal) {
  if (!c) return 0;
  return c.tipo === "pct" ? Math.round((subtotal * c.valor) / 100) : Math.min(c.valor, subtotal);
}

// por que o cupom não serve agora; vazio quando serve
export function motivoRecusa(c, subtotal, reais, agora = new Date()) {
  if (!c || c.ativo === false) return "Não achamos esse cupom. Confira o código.";
  const ate = comoData(c.validoAte);
  if (ate && agora > ate) return `Esse cupom venceu em ${String(ate.getDate()).padStart(2, "0")}/${String(ate.getMonth() + 1).padStart(2, "0")}.`;
  if (c.limite != null && (c.usos || 0) >= c.limite) return "Esse cupom já foi usado o máximo de vezes.";
  if (subtotal < (c.minimo || 0)) return `Esse cupom vale para pedidos a partir de ${reais(c.minimo)}. Faltam ${reais(c.minimo - subtotal)}.`;
  return "";
}

export const textoDesconto = (c, reais) => (c.tipo === "pct" ? `${c.valor}% de desconto` : `${reais(c.valor)} de desconto`);
