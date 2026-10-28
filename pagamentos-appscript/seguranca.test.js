import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHmac, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { configurarAleatoriedade, aleatorio, sha256, desafioPKCE, canonico, cifrar, decifrar, verificarAppCheckJWT, tokenWebhook, verificarTokenWebhook, assinaturaWebhook } from "./seguranca.js?v=1";

test("sem fonte segura configurada não gera bytes nem cifra", () => {
  assert.throws(() => aleatorio(), /não foi configurada/);
  assert.throws(() => cifrar({ token: "fictício" }, randomBytes(32).toString("base64"), "loja", "conta"), /não foi configurada/);
});
test("aleatoriedade vem exclusivamente da fonte configurada", () => {
  const tamanhos = [];
  configurarAleatoriedade((n) => { tamanhos.push(n); return new Uint8Array(n).fill(17); });
  assert.equal(aleatorio(), Buffer.alloc(32, 17).toString("base64url"));
  const dados = cifrar({ token: "fictício" }, randomBytes(32).toString("base64"), "loja", "conta");
  assert.deepEqual(Buffer.from(dados.iv, "base64"), Buffer.alloc(12, 17)); assert.deepEqual(tamanhos, [32, 12]);
});
test("fonte com quantidade ou valor inválido falha sem fallback", () => {
  for (const fonte of [() => [], () => new Uint8Array(31), () => Array(32).fill(256), () => "x", () => Array(32).fill(0.5), () => "Ā".repeat(32)]) {
    configurarAleatoriedade(fonte); assert.throws(() => aleatorio());
  }
  assert.throws(() => configurarAleatoriedade(null)); configurarAleatoriedade(randomBytes);
});
test("SHA256 conhecido e desafio PKCE RFC7636", () => {
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(desafioPKCE("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});
test("serialização canônica é compatível com Node", () => assert.equal(canonico({ z: [2, { b: 2, a: 1 }], a: null }), '{"a":null,"z":[2,{"a":1,"b":2}]}'));
test("AES Forge cifra e Node decifra com AAD e UTF8", () => {
  const chave = randomBytes(32), original = { access_token: "fictício á", refresh_token: "renovação fictícia" };
  const envelope = cifrar(original, chave.toString("base64"), "loja-á", "123");
  const cipher = createDecipheriv("aes-256-gcm", chave, Buffer.from(envelope.iv, "base64"));
  cipher.setAAD(Buffer.from("loja-á:123")); cipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  assert.deepEqual(JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.texto, "base64")), cipher.final()]).toString("utf8")), original);
  assert.deepEqual(decifrar(envelope, chave.toString("base64"), "loja-á", "123"), original);
});
function envelopeNode(original, chave, loja = "loja", conta = "123") {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", chave, iv); cipher.setAAD(Buffer.from(`${loja}:${conta}`));
  const texto = Buffer.concat([cipher.update(JSON.stringify(original), "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), texto: texto.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}
test("AES Node cifra e Forge decifra", () => {
  const chave = randomBytes(32), original = { access_token: "falso", refresh_token: "também falso", numero: 1 };
  assert.deepEqual(decifrar(envelopeNode(original, chave), chave.toString("base64"), "loja", "123"), original);
});
test("AAD isola loja e conta", () => {
  const chave = randomBytes(32), envelope = envelopeNode({ token: "fictício" }, chave);
  assert.throws(() => decifrar(envelope, chave.toString("base64"), "outra-loja", "123"));
  assert.throws(() => decifrar(envelope, chave.toString("base64"), "loja", "outra-conta"));
});
for (const campo of ["iv", "texto", "tag"]) test(`AES rejeita ${campo} adulterado`, () => {
  const chave = randomBytes(32), envelope = envelopeNode({ token: "fictício" }, chave), bytes = Buffer.from(envelope[campo], "base64"); bytes[0] ^= 1; envelope[campo] = bytes.toString("base64");
  assert.throws(() => decifrar(envelope, chave.toString("base64"), "loja", "123"));
});
test("AES rejeita chave errada, tamanho errado e base64 inválida", () => {
  const chave = randomBytes(32), envelope = envelopeNode({ token: "fictício" }, chave);
  assert.throws(() => decifrar(envelope, randomBytes(32).toString("base64"), "loja", "123"));
  for (const k of ["", randomBytes(31).toString("base64"), "!".repeat(44)]) assert.throws(() => cifrar({}, k, "loja", "123"));
  assert.throws(() => decifrar({ ...envelope, iv: "!!!" }, chave.toString("base64"), "loja", "123"));
  assert.throws(() => decifrar({ ...envelope, tag: randomBytes(15).toString("base64") }, chave.toString("base64"), "loja", "123"));
});

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "google-chave-teste", use: "sig", alg: "RS256" };
const agora = Date.UTC(2026, 9, 27, 12), agoraSegundos = agora / 1000;
const header = { alg: "RS256", typ: "JWT", kid: jwk.kid };
const claims = { iss: "https://firebaseappcheck.googleapis.com/1234567890", aud: ["projects/1234567890"], sub: "1:1234567890:web:ficticio", iat: agoraSegundos - 60, exp: agoraSegundos + 3600 };
const config = { projectNumber: "1234567890", appId: claims.sub, jwks: { keys: [jwk] }, agora };
function jwt(payload = claims, cabecalho = header, privateKey = pair.privateKey) {
  const texto = `${Buffer.from(JSON.stringify(cabecalho)).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${texto}.${sign("RSA-SHA256", Buffer.from(texto), privateKey).toString("base64url")}`;
}
test("JWT RSA Node é aceito por Forge e devolve claims", () => assert.deepEqual(verificarAppCheckJWT(jwt(), config), claims));
test("JWT aceita audiência string exata e JWK sem metadados opcionais", () => {
  const { use, alg, ...semMetadados } = jwk;
  assert.equal(verificarAppCheckJWT(jwt({ ...claims, aud: "projects/1234567890" }), { ...config, jwks: [semMetadados] }).sub, claims.sub);
});
for (const [nome, mudanca] of [["alg", { alg: "HS256" }], ["typ", { typ: "JOSE" }], ["kid", { kid: "ausente" }], ["kid longo", { kid: "x".repeat(201) }], ["JSON perigoso", { constructor: "não permitido" }]]) {
  test(`JWT rejeita cabeçalho ${nome}`, () => assert.throws(() => verificarAppCheckJWT(jwt(claims, { ...header, ...mudanca }), config)));
}
for (const [nome, mudanca] of [
  ["issuer", { iss: "https://outro.test/1234567890" }], ["audience", { aud: ["projects/999"] }], ["audience substring", { aud: "prefixo-projects/1234567890" }],
  ["subject", { sub: "outro-app" }], ["exp expirado", { exp: agoraSegundos }], ["exp string", { exp: String(agoraSegundos + 3600) }],
  ["iat futuro", { iat: agoraSegundos + 61 }], ["iat string", { iat: String(agoraSegundos) }], ["iat negativo", { iat: -1 }], ["iat ausente", { iat: undefined }],
  ["JSON perigoso", { extra: { constructor: "não permitido" } }],
]) test(`JWT rejeita claim ${nome}`, () => assert.throws(() => verificarAppCheckJWT(jwt({ ...claims, ...mudanca }), config)));
test("JWT respeita tolerância máxima de60 segundos para iat", () => assert.equal(verificarAppCheckJWT(jwt({ ...claims, iat: agoraSegundos + 60 }), config).iat, agoraSegundos + 60));
test("JWT rejeita assinatura trocada ou de outra chave", () => {
  const original = jwt(), partes = original.split("."), sig = Buffer.from(partes[2], "base64url"); sig[10] ^= 1; partes[2] = sig.toString("base64url");
  assert.throws(() => verificarAppCheckJWT(partes.join("."), config));
  const outra = generateKeyPairSync("rsa", { modulusLength: 2048 }); assert.throws(() => verificarAppCheckJWT(jwt(claims, header, outra.privateKey), config));
});
test("JWT exige JWK RSA de assinatura e RS256 quando especificado", () => {
  for (const mudanca of [{ kty: "EC" }, { use: "enc" }, { alg: "RS512" }, { n: "!!!" }, { e: "=" }]) assert.throws(() => verificarAppCheckJWT(jwt(), { ...config, jwks: { keys: [{ ...jwk, ...mudanca }] } }));
  assert.throws(() => verificarAppCheckJWT(jwt(), { ...config, jwks: { keys: [jwk, jwk] } }));
});
test("JWT rejeita formato, padding e base64url não canônica", () => {
  for (const token of ["", "x.y", "x.y.z.w", "x".repeat(20001), `${jwt().split(".")[0]}=.e30.x`, "!.e30.x", "AB.e30.x"]) assert.throws(() => verificarAppCheckJWT(token, config));
});
test("JWT não aceita chave indicada em jku pelo cliente", () => assert.throws(() => verificarAppCheckJWT(jwt(claims, { ...header, kid: "chave-externa", jku: "https://falso.test/jwks" }), config)));
test("JWT rejeita configuração de outro projeto ou aplicativo", () => {
  assert.throws(() => verificarAppCheckJWT(jwt(), { ...config, projectNumber: "999" }));
  assert.throws(() => verificarAppCheckJWT(jwt(), { ...config, appId: "outro" }));
});
test("token de webhook é HMACSHA256 compatível com Node e separado por domínio", () => {
  const segredo = "segredo exclusivamente fictício", esperado = createHmac("sha256", segredo).update("webhook:v1:loja:pedido").digest("base64url");
  assert.equal(tokenWebhook("loja", "pedido", segredo), esperado);
  assert.equal(verificarTokenWebhook(esperado, "loja", "pedido", segredo), true);
  assert.equal(verificarTokenWebhook(esperado, "outra", "pedido", segredo), false);
  assert.equal(verificarTokenWebhook(esperado, "loja", "outro", segredo), false);
  assert.equal(verificarTokenWebhook(esperado, "loja", "pedido", "outro segredo"), false);
});
test("token de webhook rejeita adulteração e comprimento diferente", () => {
  const token = tokenWebhook("loja", "pedido", "segredo fictício");
  for (const valor of [null, "", token.slice(1), token + "a", (token[0] === "a" ? "b" : "a") + token.slice(1)]) assert.equal(verificarTokenWebhook(valor, "loja", "pedido", "segredo fictício"), false);
  assert.throws(() => tokenWebhook("loja", "pedido", "")); assert.equal(assinaturaWebhook({ assinatura: "qualquer" }), false);
});
