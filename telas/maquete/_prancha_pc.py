"""Junta as telas de computador (telas/D*.png) numa prancha só: telas/_prancha-pc.png."""
import pathlib
from PIL import Image

telas = pathlib.Path(__file__).resolve().parent.parent
nomes = ["D01-inicio", "D04-produto", "D12-entrega", "D14-pagamento", "D16-enviado"]
w, h, g = 1440, 900, 30
c = Image.new("RGB", (2 * w + 3 * g, 3 * h + 4 * g), (229, 231, 235))
for i, n in enumerate(nomes):
    c.paste(Image.open(telas / f"{n}.png"), (g + (i % 2) * (w + g), g + (i // 2) * (h + g)))
c.save(telas / "_prancha-pc.png")
print("ok", c.size)
