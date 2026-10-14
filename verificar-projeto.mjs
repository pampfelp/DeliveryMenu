#!/usr/bin/env node
// Confere em um projeto as regras do segundo cérebro que dá para checar por texto.
// Node puro, sem dependência. Copie este arquivo para a raiz do projeto, junto do
// verificar-pwa.mjs.
//
//   node verificar-projeto.mjs                       confere a pasta atual
//   node verificar-projeto.mjs ..\OutroProjeto        confere outra pasta
//   node verificar-projeto.mjs --nome "Fulano de Tal" --nome "Beltrana"
//   node verificar-projeto.mjs --max-linhas 2000 --ignorar legado,dados-antigos
//
// FALHA  = a regra foi quebrada; o script sai com código 1.
// AVISO  = merece olhar, mas pode ser legítimo (o script não sabe o contexto).
//
// Regras conferidas, e de onde vêm:
//   crença 7   todo <script src> e <link href> local leva ?v=
//   crença 3   nada de confirm(), alert() ou prompt() nativos
//   crença 5   emoji na interface (AVISO: em copy e WhatsApp pode)
//   crença 8   arquivo .js que passou do tamanho em que vale dividir (AVISO)
//   crença 13  segredo no código
//   crença 38  CPF, telefone e nome próprio antes do primeiro commit
//   design-system, regra 9   z-index fora da escala (AVISO)
//   design-system, regra 13  tabela sem largura mínima (AVISO)
//
// Só entra aqui regra que já foi quebrada de verdade. Antes de acrescentar uma
// verificação nova, confirme que ela teria pegado um caso real.

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const pegar = (flag) => {
  const v = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === flag && argv[i + 1]) v.push(argv[i + 1]);
  return v;
};
const nomes = pegar('--nome');
const maxLinhas = Number(pegar('--max-linhas')[0] || 1500);
const ignorar = new Set(
  ['node_modules', '.git', '.firebase', 'dist', 'vendor', 'lib', 'graphify-out',
    ...(pegar('--ignorar')[0] || '').split(',').filter(Boolean)],
);
const valoresDeFlag = new Set(['--nome', '--max-linhas', '--ignorar'].flatMap((f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? [argv[i + 1]] : [];
}));
const pastaArg = argv.find((a, i) => !a.startsWith('--') && !valoresDeFlag.has(a) && (i === 0 || !argv[i - 1].startsWith('--')));
const RAIZ = path.resolve(pastaArg || '.');

const ESCALA_Z = new Set([400, 350, 300, 250, 120, 110, 40, 30]);
const EXT_CODIGO = new Set(['.html', '.htm', '.js', '.mjs', '.css']);
const EXT_DADOS = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json', '.md', '.txt', '.csv', '.gs']);

const falhas = [];
const avisos = [];
const oks = [];

function listar(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignorar.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listar(p, acc);
    else if (e.isFile()) acc.push(p);
  }
  return acc;
}

const rel = (p) => path.relative(RAIZ, p).replace(/\\/g, '/');
const ler = (p) => fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
const semAcento = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

if (!fs.existsSync(RAIZ) || !fs.statSync(RAIZ).isDirectory()) {
  console.error(`Pasta não encontrada: ${RAIZ}`);
  process.exit(2);
}

const SCRIPTS_DE_VERIFICACAO = new Set(['verificar-projeto.mjs', 'verificar-pwa.mjs']);
const todos = listar(RAIZ).filter((p) => fs.statSync(p).size < 2_000_000
  && !/\.min\.(js|css)$/i.test(p)
  && !SCRIPTS_DE_VERIFICACAO.has(path.basename(p)));
const codigo = todos.filter((p) => EXT_CODIGO.has(path.extname(p).toLowerCase()));
const dados = todos.filter((p) => EXT_DADOS.has(path.extname(p).toLowerCase()));
const conteudo = new Map();
const texto = (p) => {
  if (!conteudo.has(p)) conteudo.set(p, ler(p));
  return conteudo.get(p);
};

// Troca comentários por espaços, preservando as quebras de linha (os números de linha não mudam).
function semComentarios(t, ext) {
  const apagar = (s) => s.replace(/[^\n]/g, ' ');
  let r = t;
  if (ext === '.html' || ext === '.htm') r = r.replace(/<!--[\s\S]*?-->/g, apagar);
  if (['.html', '.htm', '.js', '.mjs', '.css'].includes(ext)) r = r.replace(/\/\*[\s\S]*?\*\//g, apagar);
  if (['.js', '.mjs', '.html', '.htm'].includes(ext)) r = r.replace(/(^|[^:\\'"`])\/\/[^\n]*/g, (m, a) => a + apagar(m.slice(a.length)));
  return r;
}
const limpos = new Map();
const textoLimpo = (p) => {
  if (!limpos.has(p)) limpos.set(p, semComentarios(texto(p), path.extname(p).toLowerCase()));
  return limpos.get(p);
};

// Acha ocorrências de uma regex linha a linha e devolve "arquivo:linha".
// Com { limpo: true } ignora o que está dentro de comentário.
function achar(arquivos, regex, filtro, { limpo = false } = {}) {
  const saida = [];
  for (const p of arquivos) {
    (limpo ? textoLimpo(p) : texto(p)).split(/\r?\n/).forEach((linha, i) => {
      const m = regex.exec(linha);
      if (m && (!filtro || filtro(linha, m))) saida.push({ onde: `${rel(p)}:${i + 1}`, achado: m[0], linha });
    });
  }
  return saida;
}

function relatar(lista, tipo, mensagem, mostrar = 8) {
  if (!lista.length) return false;
  const alvo = tipo === 'falha' ? falhas : avisos;
  alvo.push(`${mensagem} (${lista.length})`);
  for (const x of lista.slice(0, mostrar)) alvo.push(`   ${x.onde}  ${x.achado}`);
  if (lista.length > mostrar) alvo.push(`   ... e mais ${lista.length - mostrar}`);
  return true;
}

// ---------- crença 7: ?v= ----------
const htmls = codigo.filter((p) => /\.html?$/i.test(p));
const semVersao = [];
let comVersao = 0;
for (const p of htmls) {
  const t = textoLimpo(p);
  for (const m of t.matchAll(/<(script|link)\b[^>]*?\b(src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const url = m[3];
    if (/^(https?:|\/\/|data:|#|mailto:|tel:)/i.test(url)) continue;
    const arquivo = url.split(/[?#]/)[0];
    if (!/\.(js|mjs|css)$/i.test(arquivo)) continue;
    if (/[?&]v=/.test(url)) comVersao++;
    else {
      const linha = t.slice(0, m.index).split('\n').length;
      semVersao.push({ onde: `${rel(p)}:${linha}`, achado: url });
    }
  }
}
if (!relatar(semVersao, 'falha', 'crença 7: arquivo local sem ?v= na URL')) {
  if (htmls.length) oks.push('crença 7: todo script e css local leva ?v=');
}
if (comVersao > 0) {
  const imports = achar(
    codigo.filter((p) => /\.m?js$/i.test(p)),
    /\bfrom\s+['"](\.{1,2}\/[^'"?]+\.m?js)['"]/,
    null,
    { limpo: true },
  );
  relatar(imports, 'aviso', 'crença 7 / antecipação B8: import relativo sem ?v= (versione a cadeia inteira, não só a entrada)');
}

// ---------- crença 3: diálogo nativo ----------
const dialogos = achar(
  codigo.filter((p) => /\.(m?js|html?)$/i.test(p)),
  /(?:^|[^\w$.])(?:window\.)?(alert|confirm|prompt)\s*\(/,
  (linha) => !/function\s+(alert|confirm|prompt)\b/.test(linha),
  { limpo: true },
);
if (!relatar(dialogos, 'falha', 'crença 3: confirm(), alert() ou prompt() nativo')) {
  oks.push('crença 3: nenhum diálogo nativo');
}

// ---------- crença 5: emoji ----------
const emoji = achar(codigo, /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u, null, { limpo: true });
if (!relatar(emoji, 'aviso', 'crença 5: emoji no código (na interface não pode; em copy e WhatsApp, um ou dois por peça, pode)')) {
  oks.push('crença 5: nenhum emoji no código');
}

// ---------- crença 8: tamanho ----------
const grandes = codigo
  .filter((p) => /\.m?js$/i.test(p))
  .map((p) => ({ p, n: texto(p).split('\n').length }))
  .filter((x) => x.n >= maxLinhas)
  .map((x) => ({ onde: rel(x.p), achado: `${x.n} linhas` }));
if (!relatar(grandes, 'aviso', `crença 8: arquivo .js com ${maxLinhas} linhas ou mais, hora de pensar em dividir`)) {
  oks.push(`crença 8: nenhum .js com ${maxLinhas} linhas ou mais`);
}

// ---------- z-index ----------
const zs = [];
for (const p of codigo) {
  textoLimpo(p).split(/\r?\n/).forEach((linha, i) => {
    for (const m of linha.matchAll(/z-?index\s*[:=]\s*['"]?(-?\d+)/gi)) {
      const n = Number(m[1]);
      if (n >= 50 && !ESCALA_Z.has(n)) zs.push({ onde: `${rel(p)}:${i + 1}`, achado: `z-index ${n}` });
    }
  });
}
if (!relatar(zs, 'aviso', 'design-system regra 9: z-index acima de 49 fora da escala (400, 350, 300, 250, 120, 110)')) {
  oks.push('design-system regra 9: z-index dentro da escala');
}

// ---------- tabela sem largura mínima ----------
const temTabela = codigo.some((p) => /<table\b/i.test(texto(p)));
if (temTabela) {
  const css = codigo.filter((p) => /\.css$/i.test(p) || /\.html?$/i.test(p));
  const regraComMin = css.some((p) => /(^|[}\s,])(table|\.table[\w-]*|\.tabela[\w-]*)\b[^{]*\{[^}]*min-width/i.test(texto(p)));
  if (!regraComMin) {
    avisos.push('design-system regra 13: há <table> e nenhuma regra de tabela com min-width (sem ela o texto espreme no celular em vez de rolar)');
  } else oks.push('design-system regra 13: tabela com min-width');
}

// ---------- crença 13: segredo ----------
const PADROES_SEGREDO = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\bghp_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/,
  /\bsk-[A-Za-z0-9_-]{32,}/,
  /\bgsk_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /["']client_secret["']\s*:\s*["'][^"']{10,}["']/,
];
const segredos = [];
for (const p of dados) {
  texto(p).split(/\r?\n/).forEach((linha, i) => {
    for (const re of PADROES_SEGREDO) {
      const m = re.exec(linha);
      if (m) segredos.push({ onde: `${rel(p)}:${i + 1}`, achado: `${m[0].slice(0, 8)}... (mascarado)` });
    }
  });
}
if (!relatar(segredos, 'falha', 'crença 13: segredo no código')) oks.push('crença 13: nenhum segredo conhecido no código');

// ---------- crença 38: dado pessoal ----------
function cpfValido(s) {
  const d = s.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dig = (n) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dig(9) === Number(d[9]) && dig(10) === Number(d[10]);
}
const cpfs = achar(dados, /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/, (_l, m) => cpfValido(m[0]));
if (!relatar(cpfs, 'falha', 'crença 38: CPF válido no repositório')) oks.push('crença 38: nenhum CPF válido');

const telefones = achar(dados, /(?:\(\d{2}\)|\b\d{2})\s?9\d{4}[-\s]?\d{4}\b/);
relatar(telefones, 'aviso', 'crença 38: número de celular (confira se é dado de terceiro; o da própria empresa pode ficar)');

if (nomes.length) {
  const alvos = nomes.map((n) => semAcento(n));
  const achados = [];
  for (const p of dados) {
    texto(p).split(/\r?\n/).forEach((linha, i) => {
      const l = semAcento(linha);
      for (const a of alvos) if (l.includes(a)) achados.push({ onde: `${rel(p)}:${i + 1}`, achado: a });
    });
  }
  if (!relatar(achados, 'falha', 'crença 38: nome informado em --nome aparece no repositório')) {
    oks.push(`crença 38: nenhum dos ${nomes.length} nome(s) informado(s) aparece`);
  }
} else {
  avisos.push('crença 38: nenhum --nome informado, então a varredura de nome próprio não rodou');
}

// ---------- PWA ----------
if (fs.existsSync(path.join(RAIZ, 'manifest.json')) && !fs.existsSync(path.join(RAIZ, 'verificar-pwa.mjs'))) {
  avisos.push('crença 39: há manifest.json e não há verificar-pwa.mjs na pasta (copie de boilerplate/)');
}

console.log(`Projeto: ${RAIZ}`);
console.log(`Arquivos lidos: ${dados.length}\n`);
for (const m of oks) console.log(`OK     ${m}`);
for (const m of avisos) console.log(m.startsWith('   ') ? `       ${m.trim()}` : `AVISO  ${m}`);
for (const m of falhas) console.log(m.startsWith('   ') ? `       ${m.trim()}` : `FALHA  ${m}`);
const nFalhas = falhas.filter((m) => !m.startsWith('   ')).length;
const nAvisos = avisos.filter((m) => !m.startsWith('   ')).length;
console.log(`\n${nFalhas} falha(s), ${nAvisos} aviso(s), ${oks.length} conferência(s) ok`);
process.exit(nFalhas ? 1 : 0);
