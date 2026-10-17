/*
  loja-dados.js: de onde a loja tira os dados.

  Com ?loja=<link> na URL, lê o restaurante no Firestore (lojas/{link} e as
  subcoleções categorias, itens e bairros). Sem ?loja=, usa os dados de
  exemplo e nada sai do aparelho.

  Formato no Firestore (o editor de cardápio do painel vai gravar assim):
    categorias/{id}  nome, ordem
    itens/{id}       categoriaId, nome, descricao, preco, precoPromo, selo,
                     destaque, esgotado, fotoUrl, grupos[], ordem
    bairros/{id}     nome, lat, lng
*/

import { LOJA, BAIRROS, CATEGORIAS, SUGESTOES } from "./dados-exemplo.js?v=7";
import { regraDe } from "./conta-entrega.js?v=1";

export const SLUG = new URLSearchParams(location.search).get("loja");

export async function carregarLoja() {
  // loja de exemplo; ?exemplo=fechada e ?exemplo=na-entrega mostram os estados das imagens S01b e S14b
  const ex = new URLSearchParams(location.search).get("exemplo");
  if (!SLUG) return {
    real: false, BAIRROS, CATEGORIAS, SUGESTOES,
    LOJA: {
      ...LOJA, aberta: ex !== "fechada", pagamentoOnline: ex !== "na-entrega", whatsapp: "91900000000",
      // o que aparece em Mais informações (S20, D20)
      endereco: "Travessa das Flores, 120",
      horario: Object.fromEntries(["seg", "ter", "qua", "qui", "sex", "sab", "dom"].map((d) => [d,
        { aberto: d !== "dom", abre: "18:00", fecha: ["sex", "sab"].includes(d) ? "00:00" : "23:00" }])),
    },
  };

  const { db } = await import("./firebase-init.js?v=2");
  const { doc, getDoc, collection, getDocs } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js");
  const lojaSnap = await getDoc(doc(db, "lojas", SLUG));
  if (!lojaSnap.exists()) return null;
  const d = lojaSnap.data();
  const [cats, itens, bairros] = await Promise.all(
    ["categorias", "itens", "bairros"].map((c) => getDocs(collection(db, "lojas", SLUG, c)))
  );
  const porOrdem = (a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || String(a.nome).localeCompare(String(b.nome));
  const todosItens = itens.docs.map((x) => ({ id: x.id, descricao: "", fotoUrl: "", grupos: [], ...x.data() })).sort(porOrdem);
  return {
    real: true,
    LOJA: {
      id: SLUG,
      slug: SLUG,
      nome: d.nome,
      cidade: d.cidade || "",
      cor: d.cor || "#991b1b",
      logoUrl: d.logoUrl || "",
      bairro: d.bairro || "",
      local: d.local || null,
      entrega: regraDe(d), // loja que ainda não configurou a entrega fica com o padrão
      aberta: d.aberta !== false, // a chave de Pedidos; o app junta com o horário (horario.js)
      ligada: d.aberta !== false,
      horario: d.horario || null,
      abrirSozinho: !!d.abrirSozinho,
      whatsapp: d.whatsapp || "",
      endereco: d.endereco || "", // o ponto de saída marcado em Entregas
      // pagar online só depois que a loja ligar o Mercado Pago (decisão 8)
      pagamentoOnline: false,
    },
    BAIRROS: bairros.docs.map((x) => x.data()).filter((b) => b.nome),
    CATEGORIAS: cats.docs.map((x) => ({ id: x.id, ...x.data() })).sort(porOrdem)
      .map((c) => ({ ...c, itens: todosItens.filter((i) => i.categoriaId === c.id) }))
      .filter((c) => c.itens.length),
    SUGESTOES: d.sugestoes || [],
  };
}
