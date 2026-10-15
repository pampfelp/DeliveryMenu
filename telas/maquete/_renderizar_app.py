"""Fotografa as telas do app rodando no servidor local.

Uso: python _renderizar_app.py <pasta-de-saida> [porta] [--pc] [--painel]
  sem --pc: celular, 390 x 844 (S01...S16)
  com --pc: computador, 1440 x 900 (D01...D16)
Usa ?exemplo=1, que põe na sacola os itens das imagens validadas.
Precisa do servidor de pé (TESTAR - index.html.bat, ou o preview na porta 8735).
"""
import pathlib, subprocess, sys
from PIL import Image

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
CELULAR = {"S01-inicio": "inicio", "S04-produto": "produto/classico/ex0", "S08-sacola": "sacola",
           "S12-entrega": "entrega", "S14-pagamento": "pagamento", "S16-enviado": "enviado"}
PC = {"D01-inicio": "inicio", "D04-produto": "produto/classico/ex0", "D12-entrega": "entrega",
      "D14-pagamento": "pagamento", "D16-enviado": "enviado"}
PAINEL_CEL = {"P01-login": "entrar", "P02-cadastro-dados": "cadastro/1", "P03-cadastro-loja": "cadastro/2"}
PAINEL_PC = {"PD01-login": "entrar", "PD02-cadastro-loja": "cadastro/2"}
args = [a for a in sys.argv[1:] if not a.startswith("--")]
no_pc = "--pc" in sys.argv
painel = "--painel" in sys.argv
aqui = pathlib.Path(__file__).resolve().parent
saida = pathlib.Path(args[0]).resolve()
porta = args[1] if len(args) > 1 else "8735"
saida.mkdir(parents=True, exist_ok=True)
telas = (PAINEL_PC if no_pc else PAINEL_CEL) if painel else (PC if no_pc else CELULAR)
for nome, rota in telas.items():
    png = saida / f"{nome}.png"
    app = f"http://localhost:{porta}/{'painel' if painel else 'index'}.html?exemplo=1#{rota}"
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
