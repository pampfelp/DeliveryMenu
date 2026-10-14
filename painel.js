/*
  app.js — exemplo mínimo de ponta a ponta usando o boilerplate consolidado.
  Mostra o fluxo completo: listener em tempo real, render, modal de criação,
  escrita otimista, exclusão com confirmação customizada.

  Troque "itens" pela(s) coleção(ões) reais do projeto e siga o mesmo padrão
  para cada uma. Para múltiplas páginas do mesmo projeto (ex.: planilha.html),
  todas importam deste mesmo shared.js — não duplique utilitário.
*/

import { db } from "./firebase-init.js?v=1";
import {
  collection, addDoc, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  esc, fmtData, toast, abrirModal, fecharModal, confirmar, emSegundoPlano, iniciarNavegacao, iniciarBannerInstalacao, ICONS, rastrearSincronizacao,
} from "./shared.js?v=1";

const STATE = { itens: [] };

iniciarNavegacao();
iniciarBannerInstalacao();

/* ===== listener em tempo real =====
   includeMetadataChanges:true é necessário pro indicador de sincronização
   (bolinha no canto superior direito) reagir quando um doc deixa de estar
   pendente, não só quando o dado muda — ver rastrearSincronizacao() em shared.js */
onSnapshot(
  query(collection(db, "itens"), orderBy("createdAt", "desc")),
  { includeMetadataChanges: true },
  (snap) => {
    STATE.itens = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderItens();
    renderPainel();
    rastrearSincronizacao("itens", snap, (d) => d.nome);
  },
  (err) => toast(err.message, "erro")
);

/* ===== render ===== */
function renderItens() {
  const tbody = document.getElementById("tbody-itens");
  const empty = document.getElementById("empty-itens");
  empty.style.display = STATE.itens.length ? "none" : "block";

  tbody.innerHTML = STATE.itens
    .map(
      (item) => `
      <tr>
        <td>${esc(item.nome)}</td>
        <td>${fmtData(item.createdAt)}</td>
        <td style="text-align:right;">
          <button class="btn" data-excluir="${item.id}" aria-label="Excluir"><span class="ico">${ICONS.excluir}</span></button>
        </td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll("[data-excluir]").forEach((btn) => {
    btn.addEventListener("click", () => excluirItem(btn.dataset.excluir));
  });
}

function renderPainel() {
  document.getElementById("kpi-total").textContent = STATE.itens.length;
}

/* ===== criar (modal + escrita otimista com ID pré-gerado) ===== */
document.getElementById("btn-novo-item").addEventListener("click", () => {
  const corpo = abrirModal(
    "Novo item",
    `<div class="field">
       <label for="input-nome">Nome</label>
       <input id="input-nome" type="text" required maxlength="200" />
     </div>`,
    `<span></span>
     <button type="button" class="btn" data-fechar-modal>Cancelar</button>
     <button type="button" class="btn primary" id="btn-salvar-item">Salvar</button>`
  );

  corpo.querySelector("#input-nome").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btn-salvar-item").click();
  });

  document.getElementById("btn-salvar-item").addEventListener("click", async () => {
    const nome = corpo.querySelector("#input-nome").value.trim();
    if (!nome) return toast("Informe um nome.", "erro");

    fecharModal();
    await emSegundoPlano(
      addDoc(collection(db, "itens"), { nome, createdAt: serverTimestamp() }),
      "Não foi possível salvar o item."
    );
    toast("Item salvo.", "sucesso");
  });
});

/* ===== excluir (confirmação customizada — nunca confirm() nativo) ===== */
async function excluirItem(id) {
  const ok = await confirmar("Excluir este item? Essa ação não pode ser desfeita.");
  if (!ok) return;

  await emSegundoPlano(deleteDoc(doc(db, "itens", id)), "Não foi possível excluir o item.");
  toast("Item excluído.", "sucesso");
}
