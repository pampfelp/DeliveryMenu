/**
 * Este arquivo NÃO é o banco de dados deste sistema. Só existe para:
 * 1) Subir arquivo/foto pro Google Drive (Firestore/Storage não fazem
 *    isso de graça — Firebase Storage exige plano pago mesmo dentro da
 *    cota gratuita).
 * 2) Guardar segredo de API de terceiro que não pode ir pro frontend
 *    público (proxy de client secret).
 * Não adicione lógica de negócio aqui. O banco de dados é o Firestore,
 * gerenciado direto pelo app.js via SDK modular.
 *
 * Ver padroes/arquitetura.md.
 */

function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  var action = body.action;

  try {
    switch (action) {
      case "uploadPhoto":
        return jsonOutput_({ ok: true, url: uploadPhoto_(body.base64, body.filename, body.mimeType) });

      // Exemplo de proxy de segredo — troque pela API de terceiro que o
      // projeto precisar (ex.: Pluggy, Autentique). Nunca devolva o
      // segredo em si pro frontend, só o resultado da chamada.
      // case "minhaAcaoComSegredo":
      //   return jsonOutput_({ ok: true, resultado: chamarApiComSegredo_(body) });

      default:
        return jsonOutput_({ ok: false, erro: "Ação desconhecida: " + action });
    }
  } catch (err) {
    return jsonOutput_({ ok: false, erro: String(err) });
  }
}

// Tipos aceitos e tamanho máximo do upload — validados aqui, não só no
// front-end: defesa em profundidade contra alguém chamando a API direto
// (DevTools/curl), pulando a compressão/checagem que o app.js normalmente
// faz antes de enviar. Ajuste a lista conforme o projeto precisar.
var TIPOS_ACEITOS_UPLOAD = ["image/jpeg", "image/png", "image/webp"];
var TAMANHO_MAXIMO_BASE64 = 8 * 1024 * 1024; // ~8MB de texto base64 (~6MB de arquivo real)

function uploadPhoto_(base64, filename, mimeType) {
  if (TIPOS_ACEITOS_UPLOAD.indexOf(mimeType) === -1) {
    throw new Error("Tipo de arquivo não permitido: " + mimeType);
  }
  if (!base64 || base64.length > TAMANHO_MAXIMO_BASE64) {
    throw new Error("Arquivo muito grande ou vazio.");
  }

  var folder = getUploadsFolder_();
  var bytes = Utilities.base64Decode(base64.split(",").pop());
  var blob = Utilities.newBlob(bytes, mimeType, filename || "foto.jpg");
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w1000";
}

// Cache do ID da pasta via PropertiesService — evita busca repetida e um
// bug conhecido de escopo do Apps Script sob doPost (lição do App Legendarios).
function getUploadsFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty("UPLOADS_FOLDER_ID");
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      // pasta foi apagada/movida — recria abaixo
    }
  }
  var folder = DriveApp.getRootFolder().createFolder("Uploads - " + ScriptApp.getScriptId());
  props.setProperty("UPLOADS_FOLDER_ID", folder.getId());
  return folder;
}

// Exemplo de como buscar um segredo guardado em Script Properties —
// nunca hardcode aqui, sempre configure manualmente em
// Extensões > Apps Script > Configurações do projeto > Propriedades do script.
function obterSegredo_(chave) {
  var valor = PropertiesService.getScriptProperties().getProperty(chave);
  if (!valor) throw new Error("Segredo não configurado: " + chave);
  return valor;
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
