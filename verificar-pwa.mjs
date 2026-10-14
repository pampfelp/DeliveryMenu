// Verifica se o app é instalável, com o motor real do Chromium (Edge ou Chrome).
//
//   npm install puppeteer-core
//   py -m http.server 8099            (numa janela; ou o TESTAR - index.html.bat)
//   node verificar-pwa.mjs http://localhost:8099/index.html
//
// Por que existe: em 2026-09-24 um sistema foi dado por pronto sem oferecer
// instalação no Android nem no iPhone, e o navegador de teste embutido do
// Claude não registra service worker, então ele NÃO serve pra provar isso.
// Este script usa o Edge da máquina, que serve. Sai com código 1 se algo falhar.
//
// O que confere:
//  - Android (Chromium emulado): service worker ativo, manifest sem erro, e a
//    verificação OFICIAL de instalabilidade do Chromium (a mesma que decide se
//    o Android oferece "Instalar"), o evento real e o banner.
//  - iPhone (Safari emulado, evento bloqueado, porque o Safari real não o tem):
//    banner com o passo a passo do Compartilhar.
//  - Já instalado: não mostra banner.  - Dispensa: some por 14 dias.
//
// Ajuste CAMINHO_NAVEGADOR e o seletor do banner (.pwa-banner) se o projeto
// usar outra classe.

import puppeteer from "puppeteer-core";

const URL = process.argv[2] || "http://localhost:8099/index.html";
const CAMINHO_NAVEGADOR = process.env.NAVEGADOR
  || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BANNER = ".pwa-banner";
const UA_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const espera = ms => new Promise(r => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: CAMINHO_NAVEGADOR, headless: "new", args: ["--no-first-run"] });
const falhas = [];
const conferir = (ok, msg) => { console.log((ok ? "  ok    " : "  FALHA ") + msg); if (!ok) falhas.push(msg); };
const bloquearEventoAndroid = p => p.evaluateOnNewDocument(() =>
  window.addEventListener("beforeinstallprompt", e => e.stopImmediatePropagation(), true));

console.log("\nAndroid");
{
  const p = await b.newPage();
  await p.emulate({ viewport: { width: 393, height: 851, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: UA_ANDROID });
  const cdp = await p.createCDPSession(); await cdp.send("Page.enable");
  await p.goto(URL, { waitUntil: "networkidle2" }); await espera(4000);
  const sw = await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration();
    return { reg: !!r, estado: (r?.active || r?.waiting || r?.installing)?.state }; });
  conferir(sw.reg && sw.estado === "activated", "service worker registrado e ativo");
  const inst = await cdp.send("Page.getInstallabilityErrors");
  conferir(inst.installabilityErrors.length === 0,
    "Chromium não aponta erro de instalabilidade" + (inst.installabilityErrors.length ? " → " + inst.installabilityErrors.map(e => e.errorId).join(", ") : ""));
  const man = await cdp.send("Page.getAppManifest");
  conferir(man.errors.length === 0, "manifest sem erro" + (man.errors.length ? " → " + man.errors[0].message : ""));
  const aparece = await p.evaluate(async sel => {
    if (!document.querySelector(sel)) {
      const ev = new Event("beforeinstallprompt", { cancelable: true }); ev.prompt = () => {}; ev.userChoice = Promise.resolve({});
      window.dispatchEvent(ev); await new Promise(r => setTimeout(r, 900));
    }
    return !!document.querySelector(sel);
  }, BANNER);
  conferir(aparece, "banner de instalação aparece");
  await p.close();
}

console.log("\niPhone (Safari)");
{
  const p = await b.newPage();
  await p.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, userAgent: UA_IPHONE });
  await bloquearEventoAndroid(p);
  await p.goto(URL, { waitUntil: "networkidle2" });
  await p.evaluate(() => localStorage.removeItem("pwa_dispensado_ate"));
  await p.reload({ waitUntil: "networkidle2" }); await espera(4000);
  const r = await p.evaluate(sel => { const x = document.querySelector(sel);
    return { tem: !!x, texto: x?.innerText.replace(/\s+/g, " ") || "" }; }, BANNER);
  conferir(r.tem && /Compartilhar/i.test(r.texto), "banner do iPhone mostra o caminho pelo Compartilhar");
  const tags = await p.evaluate(() => ({
    capable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content,
    touch: !!document.querySelector('link[rel="apple-touch-icon"]') }));
  conferir(tags.capable === "yes" && tags.touch, "tags do iOS (capable + apple-touch-icon)");
  await p.close();
}

console.log("\nJá instalado");
{
  const p = await b.newPage();
  await p.emulate({ viewport: { width: 390, height: 844, isMobile: true, hasTouch: true }, userAgent: UA_IPHONE });
  await bloquearEventoAndroid(p);
  await p.evaluateOnNewDocument(() => Object.defineProperty(window.navigator, "standalone", { get: () => true }));
  await p.goto(URL, { waitUntil: "networkidle2" }); await espera(3800);
  conferir(!(await p.evaluate(sel => !!document.querySelector(sel), BANNER)), "não mostra banner quando já está instalado");
  await p.close();
}

await b.close();
console.log(falhas.length ? `\n${falhas.length} falha(s). NÃO dê o projeto por pronto.\n` : "\nInstalável em Android e iPhone.\n");
process.exit(falhas.length ? 1 : 0);
