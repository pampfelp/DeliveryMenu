// Mesma conta na sacola e na oferta do CRM. Valores em centavos.
export function valorGrupo(grupo, escolhidas = {}) {
  const precos = [];
  grupo.opcoes.forEach((o) => { for (let n = 0; n < (escolhidas[o.id] || 0); n++) precos.push(o.preco); });
  if (!precos.length) return 0;
  const soma = precos.reduce((s, p) => s + p, 0);
  return grupo.regraPreco === "media" ? Math.round(soma / precos.length)
    : grupo.regraPreco === "menor" ? Math.min(...precos) : grupo.regraPreco === "maior" ? Math.max(...precos) : soma;
}
export const precoBase = (i) => i.precoPromo ?? i.preco;
export const precoUnitario = (i, escolhas = {}) => precoBase(i) + (i.grupos || []).reduce((s, g) => s + valorGrupo(g, escolhas[g.id]), 0);
export function resumoOpcoes(i, escolhas = {}) {
  const partes = [];
  (i.grupos || []).forEach((g) => g.opcoes.forEach((o) => {
    const n = escolhas[g.id]?.[o.id] || 0;
    if (n) partes.push(g.tipo === "unica" ? o.nome : `${n} ${o.nome.toLowerCase()}`);
  }));
  return partes.join(", ");
}
export function escolhasValidas(i, escolhas = {}) {
  if (i.esgotado || !escolhas || typeof escolhas !== "object") return false;
  const grupos = i.grupos || [];
  if (Object.keys(escolhas).some((id) => !grupos.some((g) => g.id === id))) return false;
  return grupos.every((g) => {
    const e = escolhas[g.id] || {}, pares = Object.entries(e);
    if (pares.some(([id, n]) => !Number.isInteger(n) || n < 1 || !g.opcoes.some((o) => o.id === id && !o.esgotado))) return false;
    const qtd = pares.reduce((s, [, n]) => s + n, 0);
    return qtd >= (g.min || 0) && qtd <= (g.max ?? (g.tipo === "unica" ? 1 : 50)) && (g.tipo !== "unica" || qtd <= 1);
  });
}
