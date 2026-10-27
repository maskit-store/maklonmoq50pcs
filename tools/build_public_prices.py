"""
Buat transparan/harga-publik.js: HARGA JUAL (sudah termasuk uplift) untuk web versi transparan.
Tidak berisi harga modal / supplier.

  MAKLONGO_ADMIN_PASSWORD=... python3 tools/build_public_prices.py
"""
import base64, json, os, sys
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pw = os.environ.get("MAKLONGO_ADMIN_PASSWORD") or sys.exit("Set MAKLONGO_ADMIN_PASSWORD")
blob = json.load(open(os.path.join(ROOT, "data/prices.enc.json")))
key = PBKDF2HMAC(hashes.SHA256(), 32, base64.b64decode(blob["salt"]), blob["iter"]).derive(pw.encode())
P = json.loads(AESGCM(key).decrypt(base64.b64decode(blob["iv"]), base64.b64decode(blob["ct"]), None))
st = P["settings"]

out = {
    "version": P.get("version"),
    "fees": {"bpomLab": st.get("bpomLabPerSku", 3500000), "halal": st.get("halalPerSku", 3500000),
             "sample": st.get("samplePerSku", 555000), "stickerPerPcs": st.get("stickerPerPcs") or 0},
    "activeDosePct": st.get("activeDosePct", 1),
    # harga base per ml/g (harga diskon ÷ volume asli)
    "bases": {k: round(v["price"] / v["vol"], 4) for k, v in P["bases"].items() if v.get("price") and v.get("vol")},
    # harga jual bahan aktif per gram (sudah × scrap factor / uplift)
    "actives": {k: round(v["pricePerGram"] * st.get("activeScrapFactor", 1.35), 4) for k, v in P["actives"].items() if v.get("pricePerGram")},
    # harga supplier kemasan per pcs; harga jual = harga supplier × pengali tier
    "packaging": {k: v["filePrice"] for k, v in P["packaging"].items() if v.get("filePrice") and v["filePrice"] * 1.35 < 150000},
    # Harga bertingkat (Tabel_Aturan_Harga_Maklon_Order_50-25000pcs.xlsx). min = qty minimal tier.
    # base = pengali harga diskon base; actAdd = tambahan Rp per bahan aktif per pcs; pack = pengali harga supplier kemasan
    "tiers": [
        {"min": 50,    "base": 1.00, "actAdd": 5500, "pack": 1.35, "sticker": 4500, "bpom": 3500000, "halal": 3500000},
        {"min": 500,   "base": 0.95, "actAdd": 5000, "pack": 1.35, "sticker": 4000, "bpom": 3500000, "halal": 3500000},
        {"min": 1000,  "base": 0.85, "actAdd": 4000, "pack": 1.35, "sticker": 3750, "bpom": 0,       "halal": 3500000},
        {"min": 5000,  "base": 0.75, "actAdd": 2000, "pack": 1.20, "sticker": 2500, "bpom": 0,       "halal": 3500000},
        {"min": 10000, "base": 0.50, "actAdd": 1000, "pack": 1.10, "sticker": 1250, "bpom": 0,       "halal": 3500000},
        {"min": 25000, "base": 0.40, "actAdd": 0,    "pack": 1.00, "sticker": 990,  "bpom": 0,       "halal": 3500000},
    ],
    "maxQty": 25000,  # di atas ini: hubungi admin
}
path = os.path.join(ROOT, "transparan/harga-publik.js")
open(path, "w").write("/* Harga jual MaklonGo (otomatis dari tools/build_public_prices.py) */\nwindow.MG_PUBLIC_PRICES = " + json.dumps(out, separators=(",", ":")) + ";\n")
print(path, len(out["bases"]), "base,", len(out["actives"]), "aktif,", len(out["packaging"]), "kemasan")
