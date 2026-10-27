import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getAppCheck } from "firebase-admin/app-check";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineBoolean, defineString, defineSecret } from "firebase-functions/params";
import { warn } from "firebase-functions/logger";
import { criarHandler } from "./pagamentos.js?v=1";

initializeApp();
const ativos = defineBoolean("PAGAMENTOS_ATIVOS", { default: false });
const clientId = defineString("MP_CLIENT_ID", { default: "" });
const frontend = defineString("FRONTEND_URL", { default: "https://pampfelp.github.io/DeliveryMenu/" });
const url = defineString("PAGAMENTOS_URL", { default: "https://southamerica-east1-cardapio-delivery-ae048.cloudfunctions.net/pagamentos" });
const clientSecret = defineSecret("MP_CLIENT_SECRET"), webhookSecret = defineSecret("MP_WEBHOOK_SECRET"), tokensKey = defineSecret("MP_TOKENS_KEY");

const handler = () => criarHandler({
  db: getFirestore(), auth: getAuth(), appCheck: getAppCheck(),
  config: { ativos: ativos.value(), clientId: clientId.value(), frontend: frontend.value(), url: url.value(), emulador: process.env.FUNCTIONS_EMULATOR === "true" },
  segredos: () => ({ clientSecret: clientSecret.value(), webhookSecret: webhookSecret.value(), tokensKey: tokensKey.value() }),
});

export const pagamentos = onRequest({
  region: "southamerica-east1", minInstances: 0, maxInstances: 2, memory: "256MiB", timeoutSeconds: 60,
  secrets: [clientSecret, webhookSecret, tokensKey],
}, async (req, res) => handler()(req, res));

export const expirarPagamentos = onSchedule({
  schedule: "every 15 minutes", timeZone: "America/Belem", region: "southamerica-east1",
  minInstances: 0, maxInstances: 1, memory: "256MiB", timeoutSeconds: 300,
  secrets: [clientSecret, webhookSecret, tokensKey],
}, async () => {
  const resultados = await handler().expirarPendentes();
  const quantidade = resultados.filter((r) => r.estado === "reconciliar").length;
  if (quantidade) warn("pagamentos_reconciliacao_pendente", { quantidade });
});
