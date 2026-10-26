// S25 / D25: escolha de recebimento. A conta dos horários fica em agendamento.js.
import { horariosDisponiveis, motivoAgendamento, textoAgendamento } from "./agendamento.js?v=1";
import { esc, toast } from "./shared.js?v=1";
import { pintarIcones } from "./icones.js?v=2";

export function iniciarAgenda(loja, { previsao, aoMudar }) {
  const caixa = document.getElementById("ag-janela"), botao = document.querySelector(".agendar");
  const dialogo = caixa.querySelector('[role="dialog"]');
  let salvo = null, escolha = null, dia = "", modo = "agendar", retorno = null;
  const valor = () => salvo;
  function atualizar() {
    botao.hidden = !loja.aceitaAgendamento;
    botao.classList.toggle("on", !!salvo);
    botao.querySelector("span").innerHTML = salvo
      ? `Agendado para ${esc(textoAgendamento(salvo))}<small>Toque para trocar ou receber agora</small>`
      : "Agendar pedido<small>Receber agora ou escolher um horário</small>";
    if (!loja.aceitaAgendamento || !loja.aberta) fechar();
  }
  function fechar() {
    if (caixa.hidden) return;
    caixa.hidden = true;
    document.body.classList.remove("com-janela");
    retorno?.focus();
  }
  function render() {
    const foco = document.activeElement, chave = ["agModo", "agDia", "agHora"].find((k) => foco?.dataset?.[k]);
    const focoValor = chave && foco.dataset[chave];
    const dias = horariosDisponiveis(loja), selecionado = dias.find((d) => d.data === dia) || dias[0];
    dia = selecionado?.data || "";
    document.getElementById("ag-corpo").innerHTML = `
      <div class="ag-opcoes">${["agora", "agendar"].map((m) => `<button type="button" class="ag-opcao${modo === m ? " on" : ""}" data-ag-modo="${m}" aria-pressed="${modo === m}"><span>${m === "agora" ? "Agora" : "Agendar"}<small>${m === "agora" ? esc(previsao()) : "Escolha o dia e a hora"}</small></span><i class="ag-radio" aria-hidden="true"></i></button>`).join("")}</div>
      ${modo === "agendar" ? `<div class="ag-dias">${dias.map((d) => `<button type="button" class="ag-dia${d.data === dia ? " on" : ""}" data-ag-dia="${d.data}" aria-pressed="${d.data === dia}">${esc(d.rotulo)}<small>${esc(d.detalhe)}</small></button>`).join("")}</div>
      <p class="ag-rotulo">Horário do pedido</p>
      <div class="ag-horas">${(selecionado?.horarios || []).map((h) => `<button type="button" class="ag-hora${escolha === h.valor ? " on" : ""}" data-ag-hora="${h.valor}" aria-pressed="${escolha === h.valor}">${esc(h.texto)}</button>`).join("")}</div>
      ${dias.length ? "" : '<p class="ag-vazio">Não há horários disponíveis nos próximos três dias.</p>'}
      <p class="ag-ajuda">Só aparecem horários em que o restaurante está aberto. O pedido chega até 15 min depois da hora escolhida.</p>` : ""}`;
    const confirmar = document.getElementById("ag-confirmar");
    confirmar.textContent = modo === "agora" ? "Receber agora" : escolha ? `Agendar para ${textoAgendamento(escolha)}` : "Escolha um horário";
    confirmar.disabled = modo !== "agora" && !escolha;
    pintarIcones(caixa);
    if (chave) [...caixa.querySelectorAll("button")].find((b) => b.dataset[chave] === focoValor)?.focus();
  }
  function abrir() {
    if (!loja.aceitaAgendamento || !loja.aberta) return;
    retorno = document.activeElement;
    escolha = salvo;
    modo = "agendar";
    dia = horariosDisponiveis(loja).find((d) => d.horarios.some((h) => h.valor === escolha))?.data || "";
    render();
    caixa.hidden = false;
    document.body.classList.add("com-janela");
    caixa.querySelector("button[data-ag-fechar]").focus();
  }
  function limpar() { salvo = null; atualizar(); }
  function conferir() {
    const motivo = salvo ? motivoAgendamento(loja, salvo) : "";
    if (!motivo) return true;
    limpar(); fechar(); aoMudar(); toast(`${motivo} Escolha outro horário ou receba agora.`, "erro", 6000);
    return false;
  }
  botao.addEventListener("click", abrir);
  caixa.addEventListener("click", (e) => {
    let el;
    if (e.target.closest("[data-ag-fechar]")) { fechar(); return; }
    if ((el = e.target.closest("[data-ag-modo]"))) { modo = el.dataset.agModo; render(); return; }
    if ((el = e.target.closest("[data-ag-dia]"))) { dia = el.dataset.agDia; escolha = null; render(); return; }
    if ((el = e.target.closest("[data-ag-hora]"))) { escolha = el.dataset.agHora; render(); return; }
    if (e.target.closest("#ag-confirmar")) {
      const motivo = modo === "agendar" ? motivoAgendamento(loja, escolha) : "";
      if (motivo) { toast(motivo, "erro", 4500); render(); return; }
      salvo = modo === "agendar" ? escolha : null;
      atualizar(); fechar(); aoMudar();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (caixa.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); fechar(); }
    if (e.key === "Tab") {
      const itens = [...dialogo.querySelectorAll("button:not([disabled])")].filter((el) => el.getClientRects().length);
      const primeiro = itens[0], ultimo = itens.at(-1);
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    }
  });
  atualizar();
  return { valor, limpar, conferir, atualizar, fechar };
}
