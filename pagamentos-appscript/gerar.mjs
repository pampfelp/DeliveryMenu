// Gera apenas o backend Apps Script. O frontend continua sem build.
import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const saida = path.join(raiz, "pagamentos-appscript", "publicar");
await mkdir(saida, { recursive: true });
const resultado = await build({ entryPoints: [path.join(raiz, "pagamentos-appscript/runtime.js")],
  bundle: true, write: false, format: "iife", globalName: "DeliveryPagamentos", platform: "browser", target: "es2022",
  minify: true, legalComments: "eof", define: { "process.browser": "true", window: "globalThis" },
  plugins: [{ name: "apps-script-sincrono", setup(b) {
    b.onResolve({ filter: /\?v=\d+$/ }, (args) => ({ path: path.resolve(args.resolveDir, args.path.replace(/\?v=\d+$/, "")) }));
    b.onLoad({ filter: /functions[\\/]pagamentos\.js$/ }, async (args) => {
      let fonte = await readFile(args.path, "utf8");
      fonte = fonte.replace('import { FieldValue } from "firebase-admin/firestore";', 'import { SERVER_TIMESTAMP } from "../pagamentos-appscript/firestore.js?v=1"; const FieldValue = {serverTimestamp:()=>SERVER_TIMESTAMP};')
        .replace('from "./seguranca.js?v=1"', 'from "../pagamentos-appscript/seguranca.js?v=1"')
        .replace(/\basync\s+(?=function|\()/g, "").replace(/\bawait\s+/g, "")
        .replace('signal: AbortSignal.timeout(15000)', 'signal: undefined');
      if (/\b(async|await)\s/.test(fonte)) throw new Error("Há operação assíncrona não convertida no backend.");
      return { contents: fonte, loader: "js", resolveDir: path.dirname(args.path) };
    });
    b.onLoad({ filter: /[\\/]ficha-cliente\.js$/ }, async (args) => {
      let fonte = await readFile(args.path, "utf8");
      const antigo = /^export async function chavePedido\(id\) \{[\s\S]*?^\}/m;
      if (!antigo.test(fonte)) throw new Error("Confira a função de hash da ficha antes de gerar Apps Script.");
      fonte = 'import { sha256 } from "./pagamentos-appscript/seguranca.js?v=1";\n' + fonte.replace(antigo, 'export function chavePedido(id) { return sha256(String(id)).slice(0,16); }');
      fonte = fonte.replace(/\basync\s+(?=function|\()/g, "").replace(/\bawait\s+/g, "");
      return { contents: fonte, loader: "js", resolveDir: path.dirname(args.path) };
    });
  } }],
});
const rodape = '\nfunction doGet(e){return DeliveryPagamentos.receberGet(e);}\nfunction doPost(e){return DeliveryPagamentos.receberPost(e);}\nfunction reconciliarPagamentos(){return DeliveryPagamentos.reconciliar();}\nfunction configurarPagamentos(){return DeliveryPagamentos.instalarRotina();}\nfunction diagnosticarPagamentos(){const resultado=DeliveryPagamentos.diagnosticar();console.log(JSON.stringify(resultado));return resultado;}\nfunction prepararHomologacaoPagamentos(){const resultado=DeliveryPagamentos.prepararHomologacao();console.log(JSON.stringify(resultado));return resultado;}\nfunction diagnosticarHomologacaoPagamentos(){const resultado=DeliveryPagamentos.diagnosticarHomologacao();console.log(JSON.stringify(resultado));return resultado;}\n';
const licencas = await Promise.all(["node-forge", "core-js"].map(async (nome) => `${nome}\n${await readFile(path.join(raiz, "node_modules", nome, "LICENSE"), "utf8")}`));
const aviso = `/* Backend DeliveryMenu. Gerado de runtime.js e módulos compartilhados.\n${licencas.join("\n\n").replace(/\*\//g, "* /")}\n*/\n`;
await writeFile(path.join(saida, "Code.gs"), aviso + resultado.outputFiles[0].text + rodape, "utf8");
await writeFile(path.join(raiz, "pagamentos-appscript", "LICENCAS.txt"), licencas.join("\n\n"), "utf8");
const manifesto = { timeZone: "America/Belem", runtimeVersion: "V8", oauthScopes: [
  "https://www.googleapis.com/auth/script.external_request", "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/script.scriptapp"], exceptionLogging: "STACKDRIVER" };
await writeFile(path.join(saida, "appsscript.json"), JSON.stringify(manifesto, null, 2) + "\n");
console.log(`Backend Apps Script gerado: ${resultado.outputFiles[0].text.length} caracteres. Sem credenciais.`);
