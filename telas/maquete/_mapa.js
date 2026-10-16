// Mapa de mentira para as maquetes de Entregas e bairros: ruas, rio, praças e os pinos.
// No app o mapa vem do OpenStreetMap; aqui é só desenho.
document.querySelectorAll(".mapa").forEach((el) => {
  const pinos = (el.dataset.pinos || "50,50,restaurante").split(";").map((p) => p.split(","));
  const pino = ([x, y, tipo]) => tipo === "restaurante"
    ? `<g transform="translate(${x * 4},${y * 2.4})"><circle r="16" fill="#991b1b" fill-opacity=".14"/><path d="M0 0c-6-8-10-13-10-18a10 10 0 0 1 20 0c0 5-4 10-10 18z" fill="#991b1b" transform="translate(0,-2)"/><circle cy="-20" r="3.6" fill="#fff"/></g>`
    : tipo === "bairro"
      ? `<g transform="translate(${x * 4},${y * 2.4})"><path d="M0 0c-6-8-10-13-10-18a10 10 0 0 1 20 0c0 5-4 10-10 18z" fill="#1d4ed8" transform="translate(0,-2)"/><circle cy="-20" r="3.6" fill="#fff"/></g>`
      : `<circle cx="${x * 4}" cy="${y * 2.4}" r="5" fill="#1d4ed8" stroke="#fff" stroke-width="2"/>`;
  el.innerHTML = `<svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true">
    <rect width="400" height="240" fill="#eef0e6"/>
    <path d="M-10 190 C 80 170, 140 215, 230 196 S 360 160, 420 176 L 420 250 L -10 250 Z" fill="#cfe3f1"/>
    <rect x="250" y="34" width="70" height="44" rx="6" fill="#d9ead0"/>
    <rect x="40" y="110" width="52" height="38" rx="6" fill="#d9ead0"/>
    <g stroke="#fff" stroke-width="9" fill="none" stroke-linecap="round">
      <path d="M-10 60 L 420 92"/><path d="M-10 140 L 420 120"/><path d="M120 -10 L 150 250"/><path d="M290 -10 L 262 250"/>
    </g>
    <g stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round">
      <path d="M-10 100 L 420 104"/><path d="M60 -10 L 70 250"/><path d="M210 -10 L 205 250"/><path d="M350 -10 L 345 250"/><path d="M-10 26 L 420 40"/>
    </g>
    ${pinos.map(pino).join("")}
  </svg>`;
});
