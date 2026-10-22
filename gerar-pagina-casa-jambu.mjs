// Entrada estática para os leitores de prévia que não executam o app.
// Rodar sempre que index.html mudar, para manter o mesmo cardápio nas duas entradas.
import { readFileSync, writeFileSync } from "node:fs";

const url = "https://pampfelp.github.io/DeliveryMenu/casa-jambu-delivery.html";
const imagem = "https://pampfelp.github.io/DeliveryMenu/midias/casa-jambu/logo-compartilhar.jpg?v=1";
let html = readFileSync(new URL("index.html", import.meta.url), "utf8");
html = html.replace('<html lang="pt-BR">', '<html lang="pt-BR" data-loja="casa-jambu-delivery">')
  .replace("<title>Cardápio Delivery</title>", `<title>Casa Jambu | Cardápio</title>
<meta name="description" content="Veja os sabores e faça seu pedido na Casa Jambu." />
<link rel="canonical" href="${url}" />
<meta property="og:type" content="website" />
<meta property="og:locale" content="pt_BR" />
<meta property="og:site_name" content="Casa Jambu" />
<meta property="og:title" content="Casa Jambu | Cardápio" />
<meta property="og:description" content="Veja os sabores e faça seu pedido na Casa Jambu." />
<meta property="og:url" content="${url}" />
<meta property="og:image" content="${imagem}" />
<meta property="og:image:type" content="image/jpeg" />
<meta property="og:image:width" content="600" />
<meta property="og:image:height" content="600" />
<meta property="og:image:alt" content="Logo da Pizzaria Casa Jambu" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="Casa Jambu | Cardápio" />
<meta name="twitter:image" content="${imagem}" />`);
writeFileSync(new URL("casa-jambu-delivery.html", import.meta.url), html);
console.log("Entrada Casa Jambu atualizada.");
