export function linkCardapio(lojaId) {
  return lojaId === "casa-jambu-delivery"
    ? "./casa-jambu-delivery.html"
    : `./?loja=${encodeURIComponent(lojaId)}`;
}

export const linkPublico = (lojaId) => new URL(linkCardapio(lojaId), "https://pampfelp.github.io/DeliveryMenu/").href;
