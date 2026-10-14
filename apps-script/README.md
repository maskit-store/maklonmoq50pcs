# Invoice PDF otomatis ke Google Drive + rekap order (Google Apps Script)

Setelah dipasang, **setiap kali customer menekan "Kirim via WhatsApp"**:
1. Invoice + lembar MoU dibuat otomatis dalam bentuk **PDF** dan disimpan ke folder Drive **Invoice Generated**
   (`1mK3rR89YHAMnei2FQLDq9PjgLevZc57l`), nama file `INV-<No Order> - <Brand>.pdf`.
2. Order dicatat di Google Sheet **MaklonGo Orders** (dibuat otomatis), lengkap dengan link PDF-nya.
3. Di dashboard admin, tombol **⟳ Sinkron Google Sheet** menarik semua order + link invoice PDF.

Harga tidak pernah dikirim ke browser customer: script membaca harga dari file privat
`MaklonGo - harga (RAHASIA).json` di My Drive Anda, yang diisi dari dashboard admin.

## Pemasangan (±10 menit, sekali saja)

1. Buka **https://script.google.com** (login sebagai maskitt.store@gmail.com) → **New project**. Beri nama `MaklonGo`.
2. Hapus isi `Code.gs`, lalu tempel seluruh isi file [`Code.gs`](Code.gs) dari folder ini → **Save**.
3. **Project Settings** (ikon gear) → **Script properties** → **Add script property**:
   `ADMIN_KEY` = kata sandi acak buatan Anda (contoh `mg-7f3k29xq`) → Save.
4. **Deploy → New deployment** → ikon gear → **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - **Deploy** → **Authorize access** → pilih akun → *Advanced* → *Go to MaklonGo (unsafe)* → **Allow**
   - Salin **Web app URL** (`https://script.google.com/macros/s/…/exec`).
5. Kirim **Web app URL** tersebut ke developer (atau isi sendiri di `assets/js/config.js` → `orderEndpoint`).
6. Buka dashboard admin → **Pengaturan → Google Drive**: isi URL & `ADMIN_KEY` → **Simpan** →
   **Sinkron harga ke Google Drive**. (Ulangi klik "Sinkron harga" setiap kali harga / pengaturan invoice diubah.)
7. (Opsional) Di editor Apps Script, pilih fungsi `testInvoice` → **Run** untuk membuat PDF contoh di folder invoice.

Jika `Code.gs` diperbarui: tempel ulang → **Deploy → Manage deployments → Edit (pensil) → Version: New version → Deploy**
(URL tetap sama).

## Keamanan
- Folder **Invoice Generated** sebaiknya **tidak** dibagikan "Anyone with the link". Script berjalan sebagai akun
  Anda, jadi folder cukup *Restricted* (hanya Anda / tim admin).
- Invoice dari web adalah **invoice awal** berdasarkan harga master. Penyesuaian (diskon, harga kemasan yang
  dicarikan admin, request bahan aktif) tetap dilakukan di dashboard, lalu kirim invoice final dari dashboard.
