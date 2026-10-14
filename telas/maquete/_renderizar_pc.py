"""Renderiza cada D*.html desta pasta em telas/<nome>.png, 1440 x 900.
Uso: python _renderizar_pc.py [D01-inicio.html ...]
"""
import pathlib, subprocess, sys

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
aqui = pathlib.Path(__file__).resolve().parent
saida = aqui.parent
nomes = sys.argv[1:] or sorted(p.name for p in aqui.glob("D*.html"))
for nome in nomes:
    png = saida / (pathlib.Path(nome).stem + ".png")
    subprocess.run([CHROME, "--headless=new", "--hide-scrollbars", "--virtual-time-budget=6000",
                    "--window-size=1440,900", f"--screenshot={png}", (aqui / nome).as_uri()],
                   check=True, capture_output=True)
    print("ok", png.name)
