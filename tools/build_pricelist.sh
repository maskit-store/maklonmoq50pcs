#!/usr/bin/env bash
# Paket upload web pricelist (harga transparan) untuk hosting terpisah, mis. pricelist.maklonindonesia.id
# Hasil: MaklonGo-pricelist-<tanggal>.zip berisi index.html di root (tanpa harga — harga diambil dari Apps Script setelah OTP).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=$(mktemp -d)
mkdir -p "$OUT/assets/css" "$OUT/assets/js" "$OUT/assets/vendor" "$OUT/assets/img"
sed -e 's#window.MG_ROOT = "../"#window.MG_ROOT = ""#' -e 's#"\.\./assets/#"assets/#g' transparan/index.html > "$OUT/index.html"
cp transparan/transparan.js transparan/transparan.css "$OUT/"
cp assets/css/style.css "$OUT/assets/css/"
cp assets/js/config.js assets/js/catalog.js assets/js/common.js "$OUT/assets/js/"
cp assets/vendor/lz-string.min.js "$OUT/assets/vendor/"
cp assets/img/logo.png assets/img/logo-sm.png "$OUT/assets/img/"
cp -r assets/img/kemasan "$OUT/assets/img/"
cp .htaccess "$OUT/"
ZIP="$PWD/MaklonGo-pricelist-$(date +%d%b | tr A-Z a-z).zip"
rm -f "$ZIP"; (cd "$OUT" && zip -qr "$ZIP" .)
rm -rf "$OUT"
echo "$ZIP"
