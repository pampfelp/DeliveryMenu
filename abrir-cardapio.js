// A abertura fica fora do grafo de módulos para também tratar falhas de importação.
(function () {
  function mostrarFalha(naoEncontrado) {
    const aviso = document.getElementById("carregando");
    if (!aviso) return;
    aviso.setAttribute("role", "alert");
    aviso.classList.add("falhou");
    aviso.textContent = naoEncontrado
      ? "Não encontramos este cardápio. Confira o link com o restaurante. "
      : "Não deu para abrir o cardápio. Confira a internet e tente novamente. ";
    const tentar = document.createElement("button");
    tentar.type = "button";
    tentar.className = "tentar-cardapio";
    tentar.textContent = "Tentar novamente";
    tentar.addEventListener("click", function () { location.reload(); });
    aviso.appendChild(tentar);
  }
  const espera = setTimeout(function () { mostrarFalha(false); }, 20000);
  import("./app.js?v=34").then(function (app) {
    return app.pronto;
  }).then(function () {
    clearTimeout(espera);
  }).catch(function (erro) {
    clearTimeout(espera);
    console.error("Falha ao abrir o cardápio:", erro);
    mostrarFalha(erro.code === "cardapio-nao-encontrado");
  });
})();
