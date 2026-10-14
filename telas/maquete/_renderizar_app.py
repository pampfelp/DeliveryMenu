"""Fotografa as telas do app rodando no servidor local, 390 x 844.

Uso: python _renderizar_app.py <pasta-de-saida> [porta]
Precisa do servidor de pé (TESTAR - index.html.bat, ou o preview na porta 8735).
"""
import pathlib, subprocess, sys
from PIL import Image

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
TELAS = {"S01-inicio": "inicio", "S04-produto": "produto/classico", "S08-sacola": "sacola",
         "S12-entrega": "entrega", "S14-pagamento": "pagamento", "S16-enviado": "enviado"}
aqui = pathlib.Path(__file__).resolve().parent
saida = pathlib.Path(sys.argv[1]).resolve()
porta = sys.argv[2] if len(sys.argv) > 2 else "8735"
saida.mkdir(parents=True, exist_ok=True)
for nome, rota in TELAS.items():
    png = saida / f"{nome}.png"
    url = (aqui / "_quadro390.html").as_uri() + f"#http://localhost:{porta}/index.html#{rota}"
    subprocess.run([CHROME, "--headless=new", "--hide-scrollbars", "--virtual-time-budget=6000",
                    "--force-device-scale-factor=2", "--window-size=500,900",
                    f"--screenshot={png}", url], check=True, capture_output=True)
    Image.open(png).crop((0, 0, 780, 1688)).save(png)
    print("ok", png.name)
