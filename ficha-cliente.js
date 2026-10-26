/*
  ficha-cliente.js: a ficha do cliente pelo número (decisão dele, 2026-10-17).

  lojas/{loja}/clientes/{telefone} = {
    nome, atualizadoEm,
    pedidos: { <chave>: { numero, criadoEm, itens: [{ qtd, nome }], total, status, tipo } }
  }

  Quem sabe o número lê a ficha (get; a equipe lista no CRM): o nome e o resumo dos
  pedidos, sem endereço. A chave de cada pedido é um resumo SHA-256 do id, para
  a ficha não entregar o id, que abre o pedido inteiro com o endereço.
  Só o painel do dono escreve a ficha (aceitar, recusar, mudar a situação).
*/

export async function chavePedido(id) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(id)));
  return [...new Uint8Array(bytes)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// o que vai para a ficha: nada de endereço, telefone ou observação
export function resumoPedido(p, mudou = {}) {
  const q = { ...p, ...mudou };
  return {
    numero: q.numero ?? null,
    criadoEm: q.criadoEm ?? null,
    ...(q.agendadoPara ? { agendadoPara: q.agendadoPara } : {}),
    itens: (q.itens || []).slice(0, 50).map((i) => ({ qtd: i.qtd, nome: i.nome, ...(i.itemId ? {itemId:i.itemId} : {}), ...(i.resumo ? {resumo:i.resumo} : {}) })),
    total: q.total || 0,
    status: q.status,
    tipo: q.tipo || "entrega",
  };
}

// os campos da ficha para gravar com { merge: true }
export async function camposFicha(p, mudou = {}, carimbo = null) {
  return {
    nome: p.cliente?.nome || "",
    ...(carimbo ? { atualizadoEm: carimbo } : {}),
    pedidos: { [await chavePedido(p.id)]: resumoPedido(p, mudou) },
  };
}

export const telefoneDe = (p) => String(p.cliente?.telefone || "").replace(/\D/g, "");
