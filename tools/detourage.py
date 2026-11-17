"""Service de détourage de RetroRevente (127.0.0.1:7001), sans dépendance à un service payant.

POST /detourer avec l'image en corps de requête (JPEG, PNG ou WebP) → PNG avec transparence.
Ne garde que le plus grand objet (le jeu), pour ignorer un bout de cartouche ou de boîte qui dépasse.
"""
import io, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import numpy as np
from PIL import Image, ImageOps
from rembg import new_session, remove
from scipy import ndimage

MODELE = os.environ.get("REMBG_MODEL", "isnet-general-use")
SESSION = new_session(MODELE)
MAX = 12_000_000


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


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        self.send_response(200 if self.path == "/sante" else 404)
        self.end_headers()
        self.wfile.write(b"ok")

    def do_POST(self):
        if self.path.split("?")[0] != "/detourer":
            self.send_response(404); self.end_headers(); return
        n = int(self.headers.get("Content-Length") or 0)
        if not 0 < n <= MAX:
            self.send_response(413); self.end_headers(); return
        try:
            png = detourer(self.rfile.read(n))
        except Exception as e:  # image illisible
            print("détourage :", e, file=sys.stderr)
            self.send_response(422); self.end_headers(); return
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(png)))
        self.end_headers()
        self.wfile.write(png)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "7001"))
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
