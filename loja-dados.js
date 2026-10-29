/*
  loja-dados.js: de onde a loja tira os dados.

  Com ?loja=<link> na URL, lê o restaurante no Firestore (lojas/{link} e as
  subcoleções categorias, itens e bairros). Sem ?loja=, usa os dados de
  exemplo e nada sai do aparelho.

  Formato no Firestore (o editor de cardápio do painel vai gravar assim):
    categorias/{id}  nome, ordem
    itens/{id}       categoriaId, nome, descricao, preco, precoPromo, selo,
                     destaque, esgotado, fotoUrl, videoUrl, videoArquivo, grupos[], ordem
    bairros/{id}     nome, lat, lng
*/

import { LOJA, BAIRROS, CATEGORIAS, SUGESTOES } from "./dados-exemplo.js?v=7";
import { regraDe } from "./conta-entrega.js?v=1";
import { pagamentoDisponivel } from "./pagamentos.js?v=3";

export const SLUG = document.documentElement.dataset.loja || new URLSearchParams(location.search).get("loja");
if (SLUG === "casa-jambu-delivery" && !document.documentElement.dataset.loja) {
  const entrada = new URL("./casa-jambu-delivery.html", location.href);
  entrada.search = location.search;
  entrada.searchParams.delete("loja");
  entrada.hash = location.hash;
  history.replaceState(null, "", entrada);
}

// A primeira leitura é pública: não precisa baixar Auth/Firestore para desenhar.
// O SDK continua responsável por pedidos e atualizações em tempo real no app.
function camposPublicos(campos = {}) {
  return Object.fromEntries(Object.entries(campos).map(([nome, valor]) => [nome, valorPublico(valor)]));
}
function valorPublico(valor) {
  if (valor.mapValue) return camposPublicos(valor.mapValue.fields);
  if (valor.arrayValue) return (valor.arrayValue.values || []).map(valorPublico);
  if ("integerValue" in valor) return Number(valor.integerValue);
  return valor.stringValue ?? valor.booleanValue ?? valor.doubleValue ?? valor.timestampValue ?? valor.geoPointValue ?? null;
}
const documentoPublico = (d) => ({ id: d.name.split("/").pop(), ...camposPublicos(d.fields) });
async function lerPublico(url) {
  const resposta = await fetch(url, { credentials: "omit", cache: "no-store" });
  if (resposta.status === 404) return null;
  if (!resposta.ok) throw new Error("Não deu para ler o cardápio.");
  return resposta.json();
}
async function listarPublico(base, colecao) {
  const documentos = [];
  let proxima = "";
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (proxima) params.set("pageToken", proxima);
    const pagina = await lerPublico(`${base}/${colecao}?${params}`);
    if (!pagina) throw new Error("Não deu para ler o cardápio.");
    documentos.push(...(pagina.documents || []).map(documentoPublico));
    proxima = pagina.nextPageToken || "";
  } while (proxima);
  return documentos;
}

export async function carregarLoja() {
  // loja de exemplo; ?exemplo=fechada e ?exemplo=na-entrega mostram os estados das imagens S01b e S14b
  const ex = new URLSearchParams(location.search).get("exemplo");
  if (!SLUG) return {
    real: false, BAIRROS, CATEGORIAS, SUGESTOES,
    LOJA: {
      ...LOJA, aberta: ex !== "fechada", aceitaAgendamento: true, pagamentoOnline: ex !== "na-entrega", whatsapp: "91900000000",
      // o que aparece em Mais informações (S20, D20)
      endereco: "Travessa das Flores, 120",
      horario: Object.fromEntries(["seg", "ter", "qua", "qui", "sex", "sab", "dom"].map((d) => [d,
        { aberto: d !== "dom", abre: "18:00", fecha: ["sex", "sab"].includes(d) ? "00:00" : "23:00" }])),
    },
  };

  if (!/^[a-z0-9-]{3,40}$/.test(SLUG)) return null;
  const servidor = new URLSearchParams(location.search).get("emulator") === "1"
    ? "http://localhost:8080" : "https://firestore.googleapis.com";
  const base = `${servidor}/v1/projects/cardapio-delivery-ae048/databases/(default)/documents/lojas/${SLUG}`;
  const [loja, cats, itens, bairros] = await Promise.all([
    lerPublico(base), ...["categorias", "itens", "bairros"].map((c) => listarPublico(base, c)),
  ]);
  if (!loja) return null;
  const d = camposPublicos(loja.fields);
  const porOrdem = (a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || String(a.nome).localeCompare(String(b.nome));
  const todosItens = itens.map((x) => ({ descricao: "", fotoUrl: "", grupos: [], ...x })).sort(porOrdem);
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
      aceitaAgendamento: d.aceitaAgendamento === true,
      abrirSozinho: !!d.abrirSozinho,
      whatsapp: d.whatsapp || "",
      endereco: d.endereco || "", // o ponto de saída marcado em Entregas
      // pagar online só depois que a loja ligar o Mercado Pago (decisão 8)
      pagamentoOnline: pagamentoDisponivel() && d.pagamentoOnline?.ativo === true,
    },
    BAIRROS: bairros.filter((b) => b.nome),
    CATEGORIAS: cats.sort(porOrdem)
      .map((c) => ({ ...c, itens: todosItens.filter((i) => i.categoriaId === c.id) }))
      .filter((c) => c.itens.length),
    SUGESTOES: d.sugestoes || [],
  };
}
