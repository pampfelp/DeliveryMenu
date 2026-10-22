import { cestaCanonica, opcoesOrdenadas } from "./oferta-cupom.js?v=1";
export { hashDestinatario, mesmaCesta } from "./oferta-cupom.js?v=1";
import { precoUnitario, resumoOpcoes, escolhasValidas } from "./preco-item.js?v=1";
export const normalizar = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export const dataDe = (v) => v instanceof Date ? v : v?.toDate ? v.toDate() : v?.seconds != null ? new Date(v.seconds * 1000) : v ? new Date(v) : null;
const mesFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Belem", year: "numeric", month: "2-digit" });
const diaFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Belem" });
export const mesDe = (v = new Date()) => { const d = dataDe(v); return d && !isNaN(d) ? mesFmt.format(d) : ""; };
export const dataCurta = (v) => { const d = dataDe(v); return d && !isNaN(d) ? diaFmt.format(d) : "—"; };
export function itemDoHistorico(linha, itens) {
  if (linha.itemId) return itens.find((i) => i.id === linha.itemId);
  const iguais = itens.filter((i) => normalizar(i.nome) === normalizar(linha.nome));
  return iguais.length === 1 ? iguais[0] : null;
}
export function tipoItem(i, categorias) {
  if (!i) return "";
  const cat = normalizar(categorias.find((c) => c.id === i.categoriaId)?.nome);
  if (/pizza|tradiciona|especia|sabores da amazonia/.test(cat)) return "pizza";
  if (/bebida|refrigerante|suco|cerveja/.test(cat)) return "bebida";
  if (/acompanhamento|porcao|petisco|entrada/.test(cat)) return "acompanhamento";
  const nome = normalizar(i.nome);
  if (/pizza|tradiciona|especia|mussarela|calabresa|portuguesa|margherita/.test(nome)) return "pizza";
  if (/bebida|refrigerante|suco|agua|cerveja|coca|guarana|fanta|sprite/.test(nome)) return "bebida";
  if (/acompanhamento|porcao|batata|petisco|entrada/.test(nome)) return "acompanhamento";
  return "";
}
// Quantidade comprada, depois recência. Cancelados e pedidos em aberto não entram.
export function preferencias(pedidos, itens, categorias) {
  const contagem = new Map();
  pedidos.filter((p) => p.status === "entregue").forEach((p) => (p.itens || []).forEach((l) => {
    const i = itemDoHistorico(l, itens), tipo = tipoItem(i, categorias);
    if (!tipo || !(l.qtd > 0)) return;
    const k = `${tipo}:${i.id}`, c = contagem.get(k) || { id: i.id, tipo, nome: i.nome, qtd: 0, recente: 0 };
    c.qtd += l.qtd; c.recente = Math.max(c.recente, +(dataDe(p.criadoEm) || 0)); contagem.set(k, c);
  }));
  return Object.fromEntries(["pizza", "acompanhamento", "bebida"].map((tipo) => [tipo, [...contagem.values()].filter((x) => x.tipo === tipo).sort((a,b) => b.qtd-a.qtd || b.recente-a.recente || a.nome.localeCompare(b.nome))[0] || null]));
}
export function resumirCliente(ficha, mes, itens, categorias) {
  const pedidos = Object.values(ficha.pedidos || {}), feitos = pedidos.filter((p) => p.status === "entregue").sort((a,b) => +(dataDe(b.criadoEm) || 0) - +(dataDe(a.criadoEm) || 0));
  const favoritos = preferencias(feitos, itens, categorias), ultimo = feitos[0];
  return { nome: ficha.nome || "Cliente", telefone: ficha.telefone, noMes: pedidos.some((p) => p.status !== "cancelado" && mesDe(p.criadoEm) === mes),
    concluidos: feitos.length, media: feitos.length ? Math.round(feitos.reduce((s,p) => s + (p.total || 0), 0) / feitos.length) : 0,
    ultimo: ultimo ? { total: ultimo.total || 0, data: dataCurta(ultimo.criadoEm) } : null,
    favoritos: Object.fromEntries(Object.entries(favoritos).map(([k,v]) => {
      const variantes = new Map();
      feitos.forEach((p) => (p.itens || []).filter((l) => v && itemDoHistorico(l,itens)?.id === v.id).forEach((l) => variantes.set(l.resumo || "",(variantes.get(l.resumo || "") || 0)+l.qtd)));
      const resumo = [...variantes].sort((a,b) => b[1]-a[1])[0]?.[0];
      return [k, v ? `${v.nome}${resumo ? ` · ${resumo}` : ""}` : ""];
    })) };
}
function resolverEscolhas(l, i) {
  if (l.escolhas) return l.escolhas;
  const escolhas = {}, tokens = (l.resumo || "").split(", ").filter(Boolean), usados = new Set();
  (i.grupos || []).forEach((g) => g.opcoes.forEach((o) => {
    tokens.forEach((t,n) => {
      if (usados.has(n)) return;
      let qtd = 0;
      if (g.tipo === "unica" && normalizar(t) === normalizar(o.nome)) qtd = 1;
      else if (g.tipo !== "unica") { const m = t.match(/^(\d+) (.+)$/); if (m && normalizar(m[2]) === normalizar(o.nome)) qtd = Number(m[1]); }
      if (qtd) { (escolhas[g.id] ||= {})[o.id] = qtd; usados.add(n); }
    });
  }));
  if (usados.size !== tokens.length) return null;
  return escolhas;
}
export function montarFavorito(pedidos, itens, categorias) {
  const feitos = pedidos.filter((p) => p.status === "entregue"), preferidos = preferencias(feitos, itens, categorias);
  if (!preferidos.pizza) throw new Error("Este cliente ainda não tem uma pizza favorita em pedidos concluídos.");
  const linhas = Object.values(preferidos).filter(Boolean).map((p) => {
    const i = itens.find((x) => x.id === p.id), variantes = new Map();
    feitos.forEach((pedido) => (pedido.itens || []).filter((l) => itemDoHistorico(l, itens)?.id === i.id).forEach((l) => {
      const e = resolverEscolhas(l, i), chave = e ? JSON.stringify(opcoesOrdenadas(e)) : "desconhecida";
      const v = variantes.get(chave) || { escolhas: e, qtd: 0, recente: 0, quantidades: new Map() };
      v.qtd += l.qtd; v.recente = Math.max(v.recente, +(dataDe(pedido.criadoEm) || 0)); v.quantidades.set(l.qtd, (v.quantidades.get(l.qtd) || 0) + 1); variantes.set(chave,v);
    }));
    const v = [...variantes.values()].sort((a,b) => b.qtd-a.qtd || b.recente-a.recente)[0];
    if (!v?.escolhas || !escolhasValidas(i, v.escolhas)) throw new Error(`Não foi possível oferecer ${i.nome}: confira a disponibilidade e as opções do histórico. Não vamos escolher outro tamanho automaticamente.`);
    const qtd = [...v.quantidades].sort((a,b) => b[1]-a[1] || a[0]-b[0])[0][0];
    return { itemId: i.id, nome: i.nome, escolhas: v.escolhas, qtd, resumo: resumoOpcoes(i,v.escolhas), total: precoUnitario(i,v.escolhas) * qtd };
  });
  return cestaCanonica(linhas);
}
