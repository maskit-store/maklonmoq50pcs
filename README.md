# MaklonGo — Maklon Kosmetik MOQ 50 pcs

> **Early Stage Brand Owner, Starts Here**

Web app statis (HTML/CSS/JS, tanpa server) untuk order maklon skincare & personal care dengan MOQ 50 pcs/SKU.

- **`index.html`** — web customer (mobile-first, **tanpa harga**)
- **`admin.html`** — dashboard admin: rekap order, kalkulasi harga, edit harga, **PDF invoice**

## Alur customer

1. **Base produk** — 60 base dari produk Maskit kategori kosmetik & personal care, dengan nama baru yang sederhana (tanpa kata bayi/anak/kids/mama). Aroma/varian sesuai aslinya, dan bahan aktif yang sudah terkandung ditampilkan.
2. **Ukuran & jumlah** — volume akhir per produk + jumlah (min. 50 pcs).
3. **Bahan aktif tambahan** — 52 bahan aktif dengan kategori (Brightening, Calming, Hydrating, Anti-Acne, dll.; satu bahan bisa di beberapa kategori) + kolom request bahan aktif lain.
4. **Kemasan** — 1.024 pilihan kemasan beserta gambar: 900 dari folder Drive lama (kode W…) + **katalog baru 124 varian / 98 produk** (kode MP…, badge "Baru", filter "Katalog baru"), filter "sesuai volume", jenis, dan pencarian. Ada opsi **"Tidak ada pilihan kemasan, Admin bantu carikan yang lain"**.
5. **Legalitas (wajib dicentang)** — Sticker, Biaya BPOM & Lab (Rp 3.500.000/SKU), Halal (Rp 3.500.000/SKU) + nama produk (wajib).
6. **Request sample?** — Ya (Rp 555.000/SKU, incl. PPN) / Tidak.
7. Simpan SKU → bisa **tambah SKU lain** (kembali ke langkah 1) → **Data diri** (Nama, HP, Email, Kota, Nama Brand, **Catatan Brand** — wajib, Catatan lain) → info pembayaran (harga via invoice, belum termasuk ongkir, DP 50%, pelunasan + ongkir setelah NIE BPOM terbit, MoU bermeterai) yang wajib disetujui → **Kirim via WhatsApp** dengan **nomor order** otomatis (`MG-YYMMDD-XXXXX`).

Pilihan volume hanya volume yang tersedia kemasannya (10–1000 ml/g).

## Rumus harga (hanya di dashboard admin)

| Komponen | Rumus per pcs |
|---|---|
| Base | harga (kolom *Harga diskon* di `discount_nominate`) ÷ volume asli × volume pesanan |
| Bahan aktif | harga master ÷ per_qty (= harga/gram, berat = volume) × (volume × **1%**) × **1,35** (scrap factor) |
| Kemasan | W…: harga di nama file gambar × **1,35**; MP…: kolom **Diskon** (harga diskon supplier) di Excel katalog baru × **1,35** (kolom Harga ditampilkan sebagai referensi di admin) |
| Sticker | diatur di Pengaturan (default Rp 0) |
| Per SKU | harga/pcs × qty + BPOM & Lab + Halal + sample (jika dipilih) |
| DP | 50% dari total (tanpa ongkir); pelunasan = sisa + ongkir setelah NIE BPOM terbit |

PDF invoice otomatis berisi **lembar MoU** (10 pasal, termasuk sanksi Rp 1 miliar + proses hukum untuk penyalahgunaan izin edar / pemalsuan produk), kolom tanda tangan kedua pihak dengan kotak meterai Rp 10.000, dan instruksi mengirim kembali MoU bertanda tangan ke WA admin. Isi nama penandatangan, jabatan & kota pengadilan di **Pengaturan**.

Semua angka bisa diubah di dashboard (master harga & per order), plus diskon, ongkir, DP%.

## Invoice PDF otomatis ke Google Drive

Setiap order otomatis dibuatkan invoice + MoU (PDF, dengan logo) di folder Drive **Invoice Generated** dan dicatat di Google Sheet, lewat Google Apps Script milik Anda. Panduan pasang: [`apps-script/README.md`](apps-script/README.md).

## Cara order masuk ke dashboard admin

Pesan WhatsApp dari customer berisi **link khusus admin** (`admin.html#import=…`). Admin cukup klik link itu → login → order tersimpan & terbuka. Alternatif:
- Tombol **Import dari WA**: tempel isi pesan WA.
- **Google Sheet (opsional)**: order tersimpan otomatis — lihat [`apps-script/README.md`](apps-script/README.md).

Order tersimpan di browser perangkat admin (localStorage). Gunakan **Backup semua order** di Pengaturan secara berkala.

## Keamanan harga

Repo GitHub Pages bersifat publik, jadi:
- File sumber (xlsx/csv berisi harga modal & supplier) **tidak di-commit** (`source/` di `.gitignore`).
- Katalog publik `assets/js/catalog.js` **tidak berisi harga**.
- Harga disimpan di `data/prices.enc.json`, terenkripsi AES-256-GCM (kunci dari password admin, PBKDF2 250k iterasi). Tanpa password, harga tidak bisa dibaca.

Setelah mengubah harga atau password di dashboard: **Download prices.enc.json** → upload ke folder `data/` di GitHub (replace).

## Konfigurasi

Edit [`assets/js/config.js`](assets/js/config.js):
- `adminWhatsApp` — **nomor WA admin** (format `628xxxxxxxxxx`)
- `fees` — biaya BPOM/Halal yang tampil di web customer
- `orderEndpoint` — URL Google Apps Script (opsional)

## Preview di GitHub Pages

Preview: **https://maskit-store.github.io/maklonmoq50pcs/** (admin: `/admin.html`).

GitHub Pages menyajikan branch `gh-pages`. Workflow `.github/workflows/pages.yml` menyalin `main` ke `gh-pages` setiap ada push ke `main`, jadi cukup update `main` — preview ikut berubah dalam ±1 menit.

## Update data (base, bahan aktif, kemasan)

```bash
pip install openpyxl cryptography pillow
# taruh file sumber di folder source/ (lihat docstring tools/build_data.py)
MAKLONGO_ADMIN_PASSWORD='password-admin' python3 tools/build_data.py --images
```
- Base produk & nama baru: `data/bases.json`
- Bahan aktif & kategori: `data/actives.json`
- Kemasan: daftar file dari folder Google Drive (`source/kemasan_drive.json`) + gambar di `source/thumbs/`

> Catatan: membangun ulang `prices.enc.json` dari sumber akan menimpa perubahan harga yang dibuat di dashboard.
