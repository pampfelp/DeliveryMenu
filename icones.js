/*
  Ícones da interface da loja: traço simples em SVG inline, os mesmos das
  imagens validadas (telas/maquete/_icones.js). Uso: <i data-ic="nome"></i>
  no HTML, e pintarIcones() depois de cada render.
*/

export const ICONES = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  promo: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><circle cx="9.3" cy="9.3" r=".8"/><circle cx="14.7" cy="14.7" r=".8"/>',
  sacola: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V7a3 3 0 0 1 6 0v1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  baixo: '<path d="m6 9 6 6 6-6"/>',
  direita: '<path d="m9 6 6 6-6 6"/>',
  esquerda: '<path d="m15 6-6 6 6 6"/>',
  pino: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  menos: '<path d="M5 12h14"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  foto: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-8 8"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  dinheiro: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  cartao: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
  pix: '<path d="M12 3 21 12 12 21 3 12z"/><path d="m8 12 4-4 4 4-4 4z"/>',
  entrega: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  loja: '<path d="M4 10h16v10H4z"/><path d="M3 10 5 4h14l2 6"/><path d="M10 20v-5h4v5"/>',
  mesa: '<path d="M3 9h18M6 9v11M18 9v11M8 5h8"/>',
  agenda: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  cupom: '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2"/>',
  conversa: '<path d="M4 20l1.3-4A8 8 0 1 1 8 19z"/>',
  editar: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  lixo: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  alvo: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>'
};

export function pintarIcones(raiz = document) {
  raiz.querySelectorAll("i[data-ic]").forEach((el) => {
    const extra = el.className ? ` ${el.className}` : "";
    el.outerHTML = `<svg class="ic${extra}" viewBox="0 0 24 24" aria-hidden="true">${ICONES[el.dataset.ic] || ""}</svg>`;
  });
}
