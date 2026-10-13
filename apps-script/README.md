# Sinkron order ke Google Sheet (opsional)

Tanpa langkah ini, order tetap masuk ke dashboard admin saat admin membuka **link admin** di pesan WhatsApp customer.
Dengan Google Sheet, setiap order otomatis tersimpan (walau customer lupa menekan "kirim" di WhatsApp) dan bisa ditarik ke dashboard dengan tombol **Sinkron Google Sheet**.

1. Buat Google Sheet baru → menu **Ekstensi → Apps Script**.
2. Hapus isi `Code.gs`, tempel isi file [`Code.gs`](Code.gs) dari folder ini, simpan.
3. **Project Settings (ikon gear) → Script properties → Add property**: `ADMIN_KEY` = kata sandi acak (contoh `mg-7f3k29xq`).
4. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Klik Deploy, izinkan akses, salin **Web app URL** (`https://script.google.com/macros/s/…/exec`).
5. Tempel URL tersebut ke `orderEndpoint` di `assets/js/config.js`, commit.
6. Di dashboard admin → **Pengaturan → Sinkron Google Sheet**, isi URL yang sama dan `ADMIN_KEY`, klik Simpan.

Catatan: data order (nama, HP, email customer) tersimpan di Sheet milik Anda. `ADMIN_KEY` mencegah orang lain membaca daftar order lewat URL.
