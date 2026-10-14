# Invoice PDF otomatis ke Google Drive + catatan order di Google Sheet

Setelah dipasang, **setiap kali customer menekan "Kirim via WhatsApp"**:
1. Invoice + lembar MoU (berlogo) dibuat otomatis sebagai **PDF** di folder Drive **Invoice Generated**
   (`1mK3rR89YHAMnei2FQLDq9PjgLevZc57l`), nama file `INV-<No Order> - <Brand>.pdf`.
   Hanya file PDF tersebut yang bisa dibuka lewat link — folder tetap privat.
2. Order dicatat lengkap di spreadsheet
   [Tambahan Node dari AI_Asisten_Sainsgo](https://docs.google.com/spreadsheets/d/1JBD1A-D4J-HnfXA0z7VlePmOmP6ucgMAfExXRRURXv0/edit), tab **Invoice**:

   | A NoOrder | B Link | C Nama | D… |
   |---|---|---|---|
   | `MG-261014-XXXXX` | `https://drive.google.com/uc?export=download&id=…` | `Budi (GlowLab)` | Waktu, Brand, HP, Email, Kota, Jumlah SKU, Total pcs, Total invoice, Lihat PDF, Rincian SKU, Catatan Brand, Status, data mentah |

   Kolom A–C tetap mengikuti format lama (NoOrder, Link download, Nama), sehingga asisten WhatsApp yang
   membaca tab ini tetap bisa memakainya. Baris contoh berisi `GANTI_FILE_ID` dihapus otomatis.
3. Di dashboard admin, tombol **⟳ Sinkron Google Sheet** menarik semua order + link invoice PDF.

Harga tidak pernah dikirim ke browser customer: script membaca harga dari file privat
`MaklonGo - harga (RAHASIA).json` di My Drive Anda, yang diisi dari dashboard admin.

## Pemasangan (±10 menit, sekali saja)

1. Buka spreadsheet di atas → menu **Extensions → Apps Script**.
   - **Cek dulu file yang sudah ada di project itu.** Spreadsheet ini juga dipakai asisten WhatsApp (Zaskia).
     Jika di project tersebut sudah ada fungsi `doPost` / `doGet` (biasanya untuk webhook bot WA), **jangan**
     tempel kode ini di sana — dua `doPost` dalam satu project akan bentrok dan bisa mematikan bot.
     Sebagai gantinya buat project terpisah di **https://script.google.com → New project**. Kode ini tetap
     menulis ke tab *Invoice* spreadsheet yang sama (lewat ID), jadi hasilnya identik.
   - Jika project masih kosong / tidak ada `doPost`: klik **+ → Script**, beri nama file `MaklonGo`.
2. Tempel seluruh isi [`Code.gs`](Code.gs) → **Save**.
3. **Project Settings** (ikon gear) → **Script properties** → **Add script property**:
   `ADMIN_KEY` = kata sandi acak buatan Anda (contoh `mg-7f3k29xq`) → Save.
4. Di editor, pilih fungsi **`setup`** → **Run** → izinkan akses (pilih akun → *Advanced* → *Go to … (unsafe)* → **Allow**).
   Ini merapikan header tab *Invoice* dan menghapus baris contoh.
5. **Deploy → New deployment** → ikon gear → **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - **Deploy** → salin **Web app URL** (`https://script.google.com/macros/s/…/exec`).
6. Kirim **Web app URL** ke developer (atau isi sendiri di `assets/js/config.js` → `orderEndpoint`).
7. Buka dashboard admin → **Pengaturan → Google Drive**: isi URL & `ADMIN_KEY` → **Simpan** →
   **Sinkron harga ke Google Drive**. Ulangi klik "Sinkron harga" setiap kali harga / pengaturan invoice diubah.
8. (Opsional) Pilih fungsi `testInvoice` → **Run** untuk membuat PDF contoh di folder invoice.

Jika `Code.gs` diperbarui: tempel ulang → **Deploy → Manage deployments → Edit (pensil) → Version: New version → Deploy**
(URL tetap sama).

## Keamanan
- Folder **Invoice Generated** sebaiknya diubah ke **Restricted**. Script berjalan sebagai akun Anda dan
  membuka akses "lihat via link" hanya untuk tiap file invoice, jadi link di kolom B tetap bisa dikirim ke customer.
- Invoice dari web adalah **invoice awal** berdasarkan harga master. Penyesuaian (diskon, harga kemasan yang
  dicarikan admin, request bahan aktif) tetap dilakukan di dashboard, lalu kirim invoice final dari dashboard.
