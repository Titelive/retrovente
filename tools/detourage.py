"""Service de retouche photo de RetroRevente (127.0.0.1:7001), sans dépendance à un service payant.

POST /retoucher?rot=0|90|180|270 avec l'image en corps (JPEG, PNG ou WebP) → JPEG retouché, VRAI FOND GARDÉ :
  - le jeu est repéré (masque rembg) pour redresser la photo et la recadrer autour de lui ;
  - les objets posés à côté et les poussières du fond sont effacés (retouche locale, « inpainting ») ;
  - les reflets sur le jeu sont atténués, la lumière est corrigée doucement.
Pas de détourage ni de fond remplacé : l'acheteur doit voir une vraie photo.
POST /detourer (ancien) → PNG avec transparence.
"""
import io, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import numpy as np
from PIL import Image, ImageOps
from rembg import new_session, remove
from scipy import ndimage
import cv2
import filigrane

MODELE = os.environ.get("REMBG_MODEL", "isnet-general-use")
SESSION = new_session(MODELE)
MAX = 12_000_000
ENTREE = 2400   # côté max traité : le recadrage autour du jeu garde ainsi assez de pixels
SORTIE = 1600   # côté max rendu


def detourer(data: bytes) -> bytes:
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    if max(im.size) > 1600:
        im.thumbnail((1600, 1600))
    cut = np.asarray(remove(im, session=SESSION)).copy()
    lab, n = ndimage.label(cut[:, :, 3] > 128)
    if n > 1:
        tailles = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        garde = ndimage.binary_dilation(lab == 1 + int(np.argmax(tailles)), iterations=3)
        cut[:, :, 3] = np.where(garde, cut[:, :, 3], 0)
    out = io.BytesIO()
    Image.fromarray(cut, "RGBA").save(out, "PNG", optimize=False)
    return out.getvalue()


def retoucher(data: bytes, rot: int = 0, carre: bool = False, pastille: bool = False) -> bytes:
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    if max(im.size) > ENTREE:
        im.thumbnail((ENTREE, ENTREE), Image.LANCZOS)
    img = np.asarray(im).copy()
    H, W = img.shape[:2]
    m = np.asarray(remove(im, session=SESSION, only_mask=True)) > 128
    lab, n = ndimage.label(m)
    if n == 0:
        raise ValueError("objet introuvable")
    tailles = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    obj = lab == 1 + int(np.argmax(tailles))
    obj = ndimage.binary_fill_holes(obj)
    pres = ndimage.binary_dilation(obj, iterations=max(6, W // 120))
    # Repérage fiable ? Si l'objet touche un bord (photo prise de près, objet coupé, tenu en main),
    # s'il est minuscule, énorme ou de forme confuse (main + objet), on ne recadre pas et on n'efface rien :
    # mieux vaut la vraie photo entière qu'un zoom au hasard qui coupe l'article.
    ys_, xs_ = np.nonzero(obj)
    bx0, bx1, by0, by1 = xs_.min(), xs_.max(), ys_.min(), ys_.max()
    bord = max(2, int(min(H, W) * .015))
    touche = bx0 <= bord or by0 <= bord or bx1 >= W - 1 - bord or by1 >= H - 1 - bord
    frac = float(obj.mean())
    rempli = obj.sum() / float((bx1 - bx0 + 1) * (by1 - by0 + 1))
    fiable = (not touche) and .03 < frac < .85 and rempli > .45
    # 1) objets à côté : autres zones repérées, assez grandes, détachées du jeu
    bazar = np.zeros_like(obj)
    for k in range(n):
        z = lab == k + 1
        if k + 1 != 1 + int(np.argmax(tailles)) and tailles[k] > H * W * .002 and not (z & pres).any():
            bazar |= z
    # 2) poussières et miettes sur le fond : petits points ronds, très contrastés, isolés, hors du jeu.
    #    Le grain du bois, le tissu ou un tapis donnent beaucoup de traits allongés : c'est une texture,
    #    on n'y touche pas (sinon l'inpainting fait des pâtés flous).
    gris = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    fond = cv2.medianBlur(gris, 31)
    ecart = (np.abs(gris.astype(int) - fond.astype(int)) > 60) & ~pres
    lp, npt = ndimage.label(ecart)
    poussiere = np.zeros_like(obj)
    if npt:
        retenus = []
        for k, sl in enumerate(ndimage.find_objects(lp)):
            h_, w_ = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
            aire = int((lp[sl] == k + 1).sum())
            if aire < H * W * .0002 and max(h_, w_) <= 2.2 * min(h_, w_) and aire >= .45 * h_ * w_:
                retenus.append(k + 1)
        if 0 < len(retenus) <= 25:     # au-delà, c'est la texture du fond, pas de la poussière
            poussiere = np.isin(lp, retenus)
    if fiable and bazar.any() and bazar.mean() < .22:
        zone = cv2.dilate(bazar.astype(np.uint8) * 255, np.ones((3, 3), np.uint8), iterations=max(4, W // 160))
        img = cv2.inpaint(img, zone, 7, cv2.INPAINT_TELEA)
    if poussiere.any():
        zone = cv2.dilate(poussiere.astype(np.uint8) * 255, np.ones((3, 3), np.uint8), iterations=2)
        img = cv2.inpaint(img, zone, 3, cv2.INPAINT_TELEA)
    # 3) niveaux : on étire seulement (jamais moins de contraste ni moins de couleur que l'original),
    #    puis on calme les reflets blancs sur le jeu
    f = img.astype(np.float32)
    lum = f.mean(axis=2)
    lo, hi = np.percentile(lum, .5), np.percentile(lum, 99.6)
    g = 255 / max(hi - lo, 1)
    if g > 1:
        lo = min(lo, lo * g - lo)  # écart noir limité : on n'écrase pas les ombres
        f = np.clip((f - lo) * min(g, 1.25), 0, 255)
    gr = f.mean(axis=2, keepdims=True)
    f = gr + (f - gr) * 1.08          # couleurs un poil plus vives, jamais plus ternes
    L = f.mean(axis=2, keepdims=True); sat = f.max(axis=2, keepdims=True) - f.min(axis=2, keepdims=True)
    k = np.clip((L - 225) / 30, 0, 1) * np.clip(1 - sat / 40, 0, 1) * obj[..., None]
    k = cv2.GaussianBlur(k[..., 0], (0, 0), 3)[..., None]
    f = f - k * (L - 225) * .35
    img = np.clip(f, 0, 255).astype(np.uint8)
    # 4) redressement : quart de tour demandé + petit angle mesuré sur le jeu
    ys, xs = np.nonzero(obj)
    cx, cy = xs.mean(), ys.mean()
    w_, v = np.linalg.eigh(np.cov(np.vstack([xs - cx, ys - cy])))
    ang = np.degrees(np.arctan2(v[1, 1], v[0, 1]))
    d = ((ang + 45) % 90) - 45
    if abs(d) > 15 or not fiable:
        d = 0
    a = d - rot          # degrés, sens trigonométrique pour OpenCV
    M = cv2.getRotationMatrix2D((W / 2, H / 2), a, 1.0)
    c, s_ = abs(M[0, 0]), abs(M[0, 1]); NW, NH = int(H * s_ + W * c), int(H * c + W * s_)
    M[0, 2] += NW / 2 - W / 2; M[1, 2] += NH / 2 - H / 2
    img = cv2.warpAffine(img, M, (NW, NH), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    om = cv2.warpAffine(obj.astype(np.uint8) * 255, M, (NW, NH), flags=cv2.INTER_NEAREST) > 0
    ok = cv2.warpAffine(np.full((H, W), 255, np.uint8), M, (NW, NH), flags=cv2.INTER_NEAREST) > 0
    # 5) recadrage autour du jeu avec une marge, sans sortir de la vraie photo
    ys, xs = np.nonzero(om)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    marge = int(max(x1 - x0, y1 - y0) * .13)
    X0, X1, Y0, Y1 = max(0, x0 - marge), min(NW, x1 + marge), max(0, y0 - marge), min(NH, y1 + marge)
    if not fiable:        # photo entière (seulement le quart de tour demandé)
        X0, X1, Y0, Y1 = 0, NW, 0, NH
    for _ in range(40 if fiable else 0):   # rogne tant que les coins tombent hors de la photo d'origine
        if ok[Y0, X0] and ok[Y0, X1 - 1] and ok[Y1 - 1, X0] and ok[Y1 - 1, X1 - 1]:
            break
        X0 = min(x0, X0 + 4); X1 = max(x1 + 1, X1 - 4); Y0 = min(y0, Y0 + 4); Y1 = max(y1 + 1, Y1 - 4)
    if carre:   # format carré (vignettes) : on élargit le côté court avec la vraie photo, sans rien inventer
        c_ = max(X1 - X0, Y1 - Y0); c_ = min(c_, NW, NH)
        mx, my = (X0 + X1) / 2, (Y0 + Y1) / 2
        X0 = int(min(max(0, mx - c_ / 2), NW - c_)); Y0 = int(min(max(0, my - c_ / 2), NH - c_)); X1, Y1 = X0 + c_, Y0 + c_
    crop = img[Y0:Y1, X0:X1]
    flou = cv2.GaussianBlur(crop, (0, 0), 1.0)
    crop = cv2.addWeighted(crop, 1.35, flou, -.35, 0)   # netteté légère, compense la rotation
    out_im = Image.fromarray(crop)
    if max(out_im.size) > SORTIE:
        out_im.thumbnail((SORTIE, SORTIE), Image.LANCZOS)
    if pastille:   # formule gratuite : petite pastille RetroRevente, posée ici pour ne pas pouvoir y couper
        out_im = filigrane.poser(out_im)
    out = io.BytesIO()
    out_im.save(out, "JPEG", quality=90, optimize=True, progressive=True, subsampling=0)
    return out.getvalue()


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        self.send_response(200 if self.path == "/sante" else 404)
        self.end_headers()
        self.wfile.write(b"ok")

    def do_POST(self):
        chemin, _, q = self.path.partition("?")
        if chemin not in ("/detourer", "/retoucher"):
            self.send_response(404); self.end_headers(); return
        n = int(self.headers.get("Content-Length") or 0)
        if not 0 < n <= MAX:
            self.send_response(413); self.end_headers(); return
        try:
            corps = self.rfile.read(n)
            if chemin == "/retoucher":
                rot = int(dict(x.split("=", 1) for x in q.split("&") if "=" in x).get("rot", "0"))
                carre = "carre=1" in q
                png = retoucher(corps, rot if rot in (0, 90, 180, 270) else 0, carre, "filigrane=1" in q)
            else:
                png = detourer(corps)
        except Exception as e:  # image illisible
            print("détourage :", e, file=sys.stderr)
            self.send_response(422); self.end_headers(); return
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg" if chemin == "/retoucher" else "image/png")
        self.send_header("Content-Length", str(len(png)))
        self.end_headers()
        self.wfile.write(png)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "7001"))
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
