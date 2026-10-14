"""Renderiza cada S*.html desta pasta em telas/<nome>.png, 390 x 844.

O Chrome headless no Windows não abre janela menor que ~500 px, então a
tela é carregada num iframe de 390 px (_quadro390.html) e recortada.
Uso: python _renderizar.py [S01-inicio.html ...]
"""
import pathlib, subprocess, sys
from PIL import Image

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
aqui = pathlib.Path(__file__).resolve().parent
saida = aqui.parent
nomes = sys.argv[1:] or sorted(p.name for p in aqui.glob("S*.html"))
for nome in nomes:
    png = saida / (pathlib.Path(nome).stem + ".png")
    url = (aqui / "_quadro390.html").as_uri() + "#" + nome
    subprocess.run([CHROME, "--headless=new", "--hide-scrollbars", "--virtual-time-budget=6000",
                    "--force-device-scale-factor=2", "--window-size=500,900",
                    f"--screenshot={png}", url], check=True, capture_output=True)
    Image.open(png).crop((0, 0, 780, 1688)).save(png)
    print("ok", png.name)
