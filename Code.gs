// DeliveryMenu: somente armazenamento/entrega de mídia pelo Drive.
// O banco e as regras do restaurante continuam no Firestore.
var PROJETO_FIREBASE = "cardapio-delivery-ae048";
var CHAVE_PUBLICA_FIREBASE = "AIzaSyCsY34ZT38ZjAkdNidqG45Nz4qPCVTamEs";
var MAX_VIDEO_BYTES = 10 * 1024 * 1024;
var TIPOS_VIDEO = ["video/mp4", "video/webm"];

function doPost(e) {
  try {
    if (!e || !e.postData || e.postData.contents.length > Math.ceil(MAX_VIDEO_BYTES * 4 / 3) + 20000) throw new Error("Arquivo maior que 10 MB.");
    var body = JSON.parse(e.postData.contents);
    if (body.action !== "uploadVideo") throw new Error("Ação desconhecida.");
    conferirDono_(body.lojaId, body.token);
    if (TIPOS_VIDEO.indexOf(body.tipo) === -1) throw new Error("Use MP4 ou WebM.");
    if (typeof body.base64 !== "string" || !body.base64.length || body.base64.length > Math.ceil(MAX_VIDEO_BYTES * 4 / 3)) throw new Error("Vídeo vazio ou maior que 10 MB.");
    var bytes = Utilities.base64Decode(body.base64);
    if (!bytes.length || bytes.length > MAX_VIDEO_BYTES || !assinaturaVideo_(bytes, body.tipo)) throw new Error("Esse arquivo não é um vídeo válido.");
    var pasta = pastaDaLoja_(body.lojaId, true);
    var nome = String(body.nome || "video.mp4").replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 100);
    var arquivo = Drive.Files.create({ name: nome, mimeType: body.tipo, parents: [pasta] }, Utilities.newBlob(bytes, body.tipo, nome), { fields: "id" });
    // Arquivo privado no Drive. O GET só entrega mídia desta pasta.
    return json_({ ok: true, id: arquivo.id });
  } catch (erro) { return json_({ ok: false, erro: erro.message || "Não deu para enviar o vídeo." }); }
}

function doGet(e) {
  try {
    var p = e && e.parameter || {};
    if (!p.action) return json_({ ok: true, servico: "DeliveryMenu midias", versao: 1 });
    if (p.action !== "video" || !/^[\w-]{10,100}$/.test(p.id || "")) throw new Error("Vídeo não encontrado.");
    var pasta = pastaDaLoja_(p.lojaId, false);
    if (!pasta) throw new Error("Vídeo não encontrado.");
    var arquivo = Drive.Files.get(p.id, { fields: "id,parents,trashed,mimeType,size" });
    if ((arquivo.parents || []).indexOf(pasta) === -1 || arquivo.trashed || TIPOS_VIDEO.indexOf(arquivo.mimeType) === -1 || Number(arquivo.size) > MAX_VIDEO_BYTES) throw new Error("Vídeo não encontrado.");
    var resposta = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files/" + p.id + "?alt=media", { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() } });
    return json_({ ok: true, tipo: arquivo.mimeType, base64: Utilities.base64Encode(resposta.getBlob().getBytes()) });
  } catch (erro) { return json_({ ok: false, erro: "Vídeo não encontrado." }); }
}

function conferirDono_(lojaId, token) {
  conferirLoja_(lojaId);
  if (typeof token !== "string" || !token || token.length > 10000) throw new Error("Entre no painel para enviar vídeos.");
  var conta = UrlFetchApp.fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + CHAVE_PUBLICA_FIREBASE, {
    method: "post", contentType: "application/json", payload: JSON.stringify({ idToken: token }), muteHttpExceptions: true,
  });
  if (conta.getResponseCode() !== 200) throw new Error("Sua sessão expirou. Entre novamente.");
  var usuario = JSON.parse(conta.getContentText()).users[0];
  if (!usuario || usuario.disabled) throw new Error("Entre novamente.");
  var loja = UrlFetchApp.fetch("https://firestore.googleapis.com/v1/projects/" + PROJETO_FIREBASE + "/databases/(default)/documents/lojas/" + lojaId + "?mask.fieldPaths=donoId", { muteHttpExceptions: true });
  if (loja.getResponseCode() !== 200 || JSON.parse(loja.getContentText()).fields.donoId.stringValue !== usuario.localId) throw new Error("Só o dono desta loja pode enviar vídeos.");
}

function conferirLoja_(lojaId) {
  if (typeof lojaId !== "string" || !/^[a-z0-9-]{3,40}$/.test(lojaId)) throw new Error("Loja inválida.");
}

function pastaDaLoja_(lojaId, criar) {
  conferirLoja_(lojaId);
  var props = PropertiesService.getScriptProperties(), chave = "PASTA_" + lojaId, id = props.getProperty(chave);
  if (id) return id;
  if (!criar) return null;
  var trava = LockService.getScriptLock();
  trava.waitLock(10000);
  try {
    id = props.getProperty(chave);
    if (id) return id;
    var pasta = Drive.Files.create({ name: "DeliveryMenu - Midias - " + lojaId, mimeType: "application/vnd.google-apps.folder" }, null, { fields: "id" });
    props.setProperty(chave, pasta.id);
    return pasta.id;
  } finally { trava.releaseLock(); }
}

function assinaturaVideo_(bytes, tipo) {
  var b = bytes.slice(0, 16).map(function (v) { return v & 255; });
  if (tipo === "video/webm") return b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
  return b.length > 12 && b[4] === 102 && b[5] === 116 && b[6] === 121 && b[7] === 112;
}

function json_(dados) {
  return ContentService.createTextOutput(JSON.stringify(dados)).setMimeType(ContentService.MimeType.JSON);
}
