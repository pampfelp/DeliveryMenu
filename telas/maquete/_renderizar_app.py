"""Fotografa as telas do app rodando no servidor local.

Uso: python _renderizar_app.py <pasta-de-saida> [porta] [--pc] [--painel]
  sem --pc: celular, 390 x 844 (S01...S16)
  com --pc: computador, 1440 x 900 (D01...D16)
Usa ?exemplo=1, que põe na sacola os itens das imagens validadas.
Nas rotas #painel usa ?exemplo=painel, que mostra os pedidos das imagens sem login.
Precisa do servidor de pé (TESTAR - index.html.bat, ou o preview na porta 8735).
"""
import pathlib, subprocess, sys
from PIL import Image

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
# rota "estado|tela" usa ?exemplo=estado (fechada, na-entrega); sem estado, ?exemplo=1
CELULAR = {"S01-inicio": "inicio", "S04-produto": "produto/classico/ex0", "S08-sacola": "sacola",
           "S12-entrega": "entrega", "S14-pagamento": "pagamento", "S09-seus-dados": "dados",
           "S14b-so-na-entrega": "na-entrega|pagamento", "S15-revisar": "na-entrega|revisar", "S16-aguardando": "pedido/exemplo",
           "S17-aceito": "pedido/exemplo-aceito", "S18-recusado": "pedido/exemplo-recusado",
           "S01b-fechado": "fechada|inicio", "S08b-fechado": "fechada|sacola"}
PC = {"D01-inicio": "inicio", "D04-produto": "produto/classico/ex0", "D12-entrega": "entrega",
      "D14-pagamento": "pagamento", "D09-seus-dados": "dados", "D14b-so-na-entrega": "na-entrega|pagamento",
      "D15-revisar": "na-entrega|revisar", "D16-aguardando": "pedido/exemplo", "D17-aceito": "pedido/exemplo-aceito",
      "D18-recusado": "pedido/exemplo-recusado", "D01b-fechado": "fechada|inicio"}
PAINEL_CEL = {"P01-login": "entrar", "P02-cadastro-dados": "cadastro/1", "P03-cadastro-loja": "cadastro/2",
              "P10-pedidos": "painel", "P11-pedido-detalhe": "painel/1051",
              "P20-cardapio": "cardapio", "P21-editar-item": "cardapio/item/classico",
              "P22-grupo-opcoes": "cardapio/item/classico/grupo/1", "P23-categorias": "cardapio/categorias",
              "P30-entregas": "entregas", "P31-bairro": "entregas/bairro/b1", "P32-regra-taxa": "entregas/regra",
              "P33-ponto-saida": "entregas/ponto", "P40-ajustes": "configuracoes"}
PAINEL_PC = {"PD01-login": "entrar", "PD02-cadastro-loja": "cadastro/2",
             "PD10-pedidos": "painel", "PD11-pedido-detalhe": "painel/1051",
             "PD20-cardapio": "cardapio", "PD21-editar-item": "cardapio/item/classico",
             "PD22-grupo-opcoes": "cardapio/item/classico/grupo/1", "PD23-nova-categoria": "cardapio/categoria/nova",
             "PD30-entregas": "entregas", "PD31-bairro": "entregas/bairro/novo", "PD32-ponto-saida": "entregas/ponto",
             "PD40-configuracoes": "configuracoes"}
args = [a for a in sys.argv[1:] if not a.startswith("--")]
no_pc = "--pc" in sys.argv
painel = "--painel" in sys.argv
aqui = pathlib.Path(__file__).resolve().parent
saida = pathlib.Path(args[0]).resolve()
porta = args[1] if len(args) > 1 else "8735"
saida.mkdir(parents=True, exist_ok=True)
telas = (PAINEL_PC if no_pc else PAINEL_CEL) if painel else (PC if no_pc else CELULAR)
so = [a for a in args[2:]]  # nomes para fotografar só algumas
for nome, rota in telas.items():
    if so and nome not in so:
        continue
    estado, _, rota = rota.rpartition("|")
    png = saida / f"{nome}.png"
    app = f"http://localhost:{porta}/{'painel' if painel else 'index'}.html?exemplo={'painel' if rota.startswith(('painel', 'cardapio', 'entregas', 'configuracoes')) else (estado or '1')}#{rota}"
    if no_pc:
        cmd = ["--window-size=1440,900", f"--screenshot={png}", app]
    else:
        cmd = ["--force-device-scale-factor=2", "--window-size=500,900", f"--screenshot={png}",
               (aqui / "_quadro390.html").as_uri() + "#" + app]
    subprocess.run([CHROME, "--headless=new", "--hide-scrollbars", "--virtual-time-budget=6000", *cmd],
                   check=True, capture_output=True)
    if not no_pc:
        Image.open(png).crop((0, 0, 780, 1688)).save(png)
    print("ok", png.name)
