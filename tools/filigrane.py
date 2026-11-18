"""Pastille « RetroRevente » posée sur les photos retouchées de la formule gratuite (Découverte).

Petite pastille sombre et arrondie, éclair anis + nom en Unbounded, dans le coin bas droit.
Elle est placée dans la zone que Le Bon Coin garde toujours visible quand il recadre ses vignettes
(4:3 en liste, carré ailleurs, coins arrondis), à l'opposé de la pastille de numéro (en haut à gauche).
Dépend seulement de Pillow.
"""
import os
from PIL import Image, ImageDraw, ImageFont

POLICE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "polices", "Unbounded-Bold.ttf")
ANIS, NUIT = (212, 245, 122, 255), (26, 26, 26)
ECLAIR = [(51, 27), (59, 27), (55, 34), (62, 34), (48, 49), (51, 39), (44, 39)]  # même éclair que le logo
SS = 4  # suréchantillonnage, pour des bords nets


def poser(im: Image.Image) -> Image.Image:
    im = im.convert("RGB")
    W, H = im.size
    sw, sh = min(W, H * 4 / 3, H), min(H, W * 3 / 4, W)      # zone toujours visible (4:3 ∩ carré), centrée
    ox, oy = (W - sw) / 2, (H - sh) / 2
    cote = min(sw, sh)
    h = max(26, round(cote * .072))                          # hauteur de la pastille
    marge = round(cote * .05)
    police = ImageFont.truetype(POLICE, round(h * .40 * SS))
    texte = "RetroRevente"
    tw = police.getbbox(texte)[2]
    pad, rond = round(h * .14 * SS), h * SS
    w = pad + rond + round(h * .26 * SS) + tw + round(h * .42 * SS)
    calque = Image.new("RGBA", (w, h * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(calque)
    d.rounded_rectangle((0, 0, w - 1, h * SS - 1), radius=h * SS // 2, fill=NUIT + (205,), outline=(255, 255, 255, 46), width=max(1, SS))
    r = rond - 2 * pad                                        # rond anis avec l'éclair
    d.ellipse((pad, pad, pad + r, pad + r), fill=ANIS)
    k, cx, cy = r / 30, pad + r / 2, pad + r / 2
    d.polygon([(cx + (x - 53) * k, cy + (y - 38) * k) for x, y in ECLAIR], fill=NUIT + (255,))
    b = police.getbbox(texte)
    d.text((pad + r + round(h * .26 * SS), (h * SS - (b[3] + b[1])) / 2), texte, font=police, fill=(255, 255, 255, 255))
    calque = calque.resize((round(w / SS), h), Image.LANCZOS)
    x = round(ox + sw - marge - calque.width)
    y = round(oy + sh - marge - h)
    fond = im.convert("RGBA")
    fond.alpha_composite(calque, (max(0, x), max(0, y)))
    return fond.convert("RGB")
