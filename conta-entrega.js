/*
  conta-entrega.js: a conta da taxa e do tempo de entrega, num lugar só.
  Usada pela loja (app.js, loja-dados.js), pelo painel (entregas.js) e pelos
  pedidos (pedidos.js), para os números nunca divergirem.

  Regra (decisão dele, 2026-10-15): R$ 3 no bairro do restaurante; nos
  outros, R$ 3 mais R$ 1,50 por km em linha reta até o centro do bairro,
  arredondado para cima em R$ 0,50, até 10 km. Tempo: 25 min + 4 por km,
  numa janela de 10 min. Os valores podem mudar no painel (Entregas e bairros).
  Dinheiro em centavos.
*/

export const ENTREGA_PADRAO = { taxaBairro: 300, porKm: 150, arredondar: 50, raioMaxKm: 10, minutosBase: 25, minutosPorKm: 4 };
export const regraDe = (loja) => ({ ...ENTREGA_PADRAO, ...(loja?.entrega || {}) });

// distância em linha reta, em km, entre dois pontos { lat, lng }
export function distanciaKm(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// taxa em centavos de um bairro a km do restaurante; mesmo = é o bairro do próprio restaurante
export function taxaKm(km, mesmo, e) {
  if (mesmo) return e.taxaBairro;
  const bruto = e.taxaBairro + km * e.porKm;
  return e.arredondar > 0 ? Math.ceil(bruto / e.arredondar) * e.arredondar : Math.round(bruto);
}

// minutos até chegar (o começo da janela de 10 min)
export const minutosKm = (km, e) => Math.round(e.minutosBase + (km || 0) * e.minutosPorKm);
