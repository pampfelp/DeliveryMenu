"""Monta imagem e tela lado a lado: telas/<S>.png em cima, <pasta>/<S>.png embaixo.
Uso: python _comparar.py <pasta>   (grava <pasta>/_comparacao.png)
"""
import pathlib, sys
from PIL import Image

telas = pathlib.Path(__file__).resolve().parent.parent
pasta = pathlib.Path(sys.argv[1]).resolve()
nomes = ["S01-inicio", "S04-produto", "S08-sacola", "S12-entrega", "S14-pagamento", "S16-enviado"]
w, h, g = 780, 1688, 24
c = Image.new("RGB", (6 * w + 7 * g, 2 * h + 3 * g), (229, 231, 235))
for i, n in enumerate(nomes):
    c.paste(Image.open(telas / f"{n}.png"), (g + i * (w + g), g))
    c.paste(Image.open(pasta / f"{n}.png"), (g + i * (w + g), 2 * g + h))
c.save(pasta / "_comparacao.png")
print("ok", pasta / "_comparacao.png")
