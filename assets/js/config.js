/*
 * Konfigurasi MaklonGo — ubah nilai di sini lalu commit.
 * File ini publik (dibaca browser customer). JANGAN taruh harga / password di sini.
 */
window.MG_CONFIG = {
  appName: "MaklonGo",
  tagline: "Early Stage Brand Owner, Starts Here",

  // Nomor WhatsApp admin penerima order. Format internasional tanpa "+" / spasi.
  // Contoh: 6281234567890
  adminWhatsApp: "6285645024291",

  moq: 50,

  // Biaya wajib per SKU yang ditampilkan ke customer (harus sama dengan Pengaturan di dashboard admin)
  fees: {
    bpomLabPerSku: 3500000,
    halalPerSku: 3500000,
    samplePerSku: 555000, // request sample, sudah termasuk PPN
  },

  // (Opsional) URL Web App Google Apps Script untuk menyimpan order otomatis ke Google Sheet.
  // Lihat apps-script/README.md. Kosongkan jika tidak dipakai.
  orderEndpoint: "https://script.google.com/macros/s/AKfycbx3y2tmxlZeRcnqfNVDys0v0ljZoTWNWuTGFZpSEUVDJCLKjP22g9p5ovFCCSS44FVT/exec",
};
