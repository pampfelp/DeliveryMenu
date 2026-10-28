// Uma sessão por vez; a raiz fica no lugar mesmo quando a linha muda de posição.
let cancelarAtual = null;

export function cancelarOrdenacao() { cancelarAtual?.(); }

function areaDeRolagem(elemento) {
  for (let el = elemento; el; el = el.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) return el;
  }
  return document.scrollingElement;
}

function criarPrevia(linha, rect) {
  const previa = linha.cloneNode(true);
  const originais = [linha, ...linha.querySelectorAll("*")];
  const copias = [previa, ...previa.querySelectorAll("*")];
  originais.forEach((original, i) => {
    const estilo = getComputedStyle(original), copia = copias[i];
    for (const propriedade of estilo) copia.style.setProperty(propriedade, estilo.getPropertyValue(propriedade));
    copia.removeAttribute("id");
    if ("value" in original) copia.value = original.value;
    if ("checked" in original) copia.checked = original.checked;
  });
  previa.classList.add("ordenacao-previa");
  previa.setAttribute("aria-hidden", "true");
  previa.inert = true;
  Object.assign(previa.style, {
    position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`,
    height: `${rect.height}px`, boxSizing: "border-box", margin: "0", zIndex: "350",
    pointerEvents: "none", opacity: ".94", boxShadow: "0 6px 20px #0002", transition: "none",
  });
  document.body.append(previa);
  return previa;
}

export function ordenavel(raiz, aoSoltar) {
  raiz.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.button !== 0) return;
    const alca = e.target.closest("[data-alca]"), linha = alca?.parentElement;
    if (!alca || !raiz.contains(alca) || !linha?.dataset.id) return;
    cancelarOrdenacao();
    e.preventDefault();
    const pai = linha.parentElement, originais = [...pai.children];
    const idsAntes = originais.map((el) => el.dataset.id).filter(Boolean);
    const rect = linha.getBoundingClientRect(), area = areaDeRolagem(pai);
    const inicioX = e.clientX, inicioY = e.clientY, deslocamento = e.clientY - rect.top;
    const controle = new AbortController(), opcoes = { signal: controle.signal };
    let x = inicioX, y = inicioY, previa = null, raf = 0, terminou = false, ultimoTempo = 0;

    function posicionar() {
      previa.style.top = `${y - deslocamento}px`;
      previa.style.left = `${rect.left + x - inicioX}px`;
      const irmaos = [...pai.children].filter((el) => el !== linha && el.dataset.id);
      const antes = irmaos.find((el) => {
        const r = el.getBoundingClientRect();
        return y < r.top + r.height / 2;
      });
      if (antes) { if (linha.nextElementSibling !== antes) pai.insertBefore(linha, antes); }
      else if (irmaos.length && irmaos.at(-1).nextElementSibling !== linha) irmaos.at(-1).after(linha);
    }
    function quadro(tempo) {
      raf = 0;
      if (!linha.isConnected || linha.parentElement !== pai || !raiz.isConnected) return finalizar(false);
      const documento = area === document.scrollingElement;
      const bordas = documento ? { top: 0, bottom: window.innerHeight } : area.getBoundingClientRect();
      const margem = Math.min(50, (bordas.bottom - bordas.top) / 3);
      const velocidade = y < bordas.top + margem ? -Math.min(1, (bordas.top + margem - y) / margem)
        : y > bordas.bottom - margem ? Math.min(1, (y - bordas.bottom + margem) / margem) : 0;
      const intervalo = ultimoTempo ? Math.min(32, tempo - ultimoTempo) : 16;
      ultimoTempo = tempo;
      area.scrollTop += velocidade * intervalo * .65;
      posicionar();
      raf = requestAnimationFrame(quadro);
    }
    function finalizar(aplicar) {
      if (terminou) return;
      terminou = true;
      if (aplicar && previa && linha.isConnected && linha.parentElement === pai) posicionar();
      else aplicar = false;
      cancelAnimationFrame(raf);
      controle.abort();
      observador.disconnect();
      try { if (raiz.hasPointerCapture(e.pointerId)) raiz.releasePointerCapture(e.pointerId); } catch { /* captura já encerrada */ }
      previa?.remove();
      linha.classList.remove("arrastando");
      document.body.classList.remove("ordenacao-ativa");
      cancelarAtual = null;
      if (!aplicar) {
        originais.filter((el) => el.parentElement === pai).forEach((el) => pai.append(el));
        return;
      }
      const ids = [...pai.children].map((el) => el.dataset.id).filter(Boolean);
      if (ids.some((id, i) => id !== idsAntes[i])) aoSoltar(pai, ids);
    }
    const observador = new MutationObserver(() => {
      if (!linha.isConnected || linha.parentElement !== pai || !raiz.isConnected) finalizar(false);
    });
    observador.observe(document.body, { childList: true, subtree: true });
    cancelarAtual = () => finalizar(false);
    try { raiz.setPointerCapture(e.pointerId); } catch { /* eventos documentais continuam acompanhando */ }
    document.addEventListener("pointermove", (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      x = ev.clientX; y = ev.clientY;
      if (!previa && Math.hypot(x - inicioX, y - inicioY) >= 5) {
        previa = criarPrevia(linha, rect);
        linha.classList.add("arrastando");
        document.body.classList.add("ordenacao-ativa");
        raf = requestAnimationFrame(quadro);
      }
      ev.preventDefault();
    }, { ...opcoes, passive: false });
    document.addEventListener("pointerup", (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      x = ev.clientX; y = ev.clientY;
      finalizar(true);
    }, opcoes);
    document.addEventListener("pointercancel", (ev) => { if (ev.pointerId === e.pointerId) finalizar(false); }, opcoes);
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopImmediatePropagation(); finalizar(false); }
    }, { ...opcoes, capture: true });
    window.addEventListener("blur", () => finalizar(false), opcoes);
  });
}
