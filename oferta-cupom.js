// Ordenação e junção idênticas para comparar uma cesta, mesmo com linhas repetidas.
export const opcoesOrdenadas = (e = {}) => Object.fromEntries(Object.keys(e).sort().map((g) => [g, Object.fromEntries(Object.entries(e[g]).filter(([,n]) => n > 0).sort(([a],[b]) => a.localeCompare(b)))]).filter(([,v]) => Object.keys(v).length));
export function cestaCanonica(linhas) {
  const mapa = new Map();
  linhas.forEach((l) => {
    const escolhas = opcoesOrdenadas(l.escolhas), k = `${l.itemId}:${JSON.stringify(escolhas)}`;
    const a = mapa.get(k);
    if (a) { a.qtd += l.qtd; a.total += l.total; } else mapa.set(k, { itemId: l.itemId, escolhas, qtd: l.qtd, nome: l.nome, resumo: l.resumo || "", total: l.total });
  });
  return [...mapa.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([,v]) => v);
}
export const mesmaCesta = (a, b) => JSON.stringify(cestaCanonica(a)) === JSON.stringify(cestaCanonica(b));
export async function hashDestinatario(codigo, telefone) {
  const hash = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`${codigo}:${telefone}`));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2,"0")).join("");
}
