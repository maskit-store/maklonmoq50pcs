/**
 * MaklonGo — backend Google Apps Script
 *
 * Setiap order dari web customer:
 *   1) dibuatkan invoice + MoU dalam bentuk PDF → disimpan ke folder Drive INVOICE_FOLDER_ID
 *      (file PDF dibagikan "siapa saja yang punya link: lihat" agar link bisa dikirim ke customer)
 *   2) dicatat ke spreadsheet SPREADSHEET_ID, tab "Invoice":
 *      A NoOrder | B Link (download PDF) | C Nama (Brand) | D… detail order lengkap
 *
 * Harga diambil dari file JSON privat "MaklonGo - harga (RAHASIA).json" di My Drive Anda.
 * File ini dibuat/diperbarui otomatis saat admin menekan "Sinkron harga ke Google Drive" di dashboard.
 *
 * Deploy: Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 * Script property wajib: ADMIN_KEY (kata sandi untuk baca order & sinkron harga).
 */
const INVOICE_FOLDER_ID = "1mK3rR89YHAMnei2FQLDq9PjgLevZc57l";
const SPREADSHEET_ID = "1JBD1A-D4J-HnfXA0z7VlePmOmP6ucgMAfExXRRURXv0";
const INVOICE_TAB = "Invoice";
const LOGO_URL = "https://maskit-store.github.io/maklonmoq50pcs/assets/img/logo-pdf.jpg";
const APP_NAME = "MaklonGo";
const TAGLINE = "Early Stage Brand Owner, Starts Here";

// Kolom tab "Invoice". A–C mengikuti format yang sudah ada (NoOrder, Link, Nama).
const INVOICE_HEADERS = ["NoOrder", "Link", "Nama", "Waktu Order", "Brand", "No HP", "Email", "Kota", "Jumlah SKU",
  "Total pcs", "Total Invoice (Rp)", "Lihat PDF", "Rincian SKU", "Catatan Brand", "Status", "Packed", "JSON"];
const COL = { id: 1, link: 2, status: 15, packed: 16, json: 17, view: 12 };
const STATUS_NAMES = { baru: "Baru", invoice: "Invoice terkirim", dp: "DP diterima", produksi: "Produksi", selesai: "Selesai", batal: "Batal" };

// Harga bertingkat per jumlah order (sama dengan assets/js/pricing.js). Bisa diubah di dashboard → Pengaturan.
const DEFAULT_TIERS = [
  { min: 50, base: 1.0, actAdd: 5500, pack: 1.35, sticker: 4500, bpom: 3500000, halal: 3500000 },
  { min: 500, base: 0.95, actAdd: 5000, pack: 1.35, sticker: 4000, bpom: 3500000, halal: 3500000 },
  { min: 1000, base: 0.85, actAdd: 4000, pack: 1.35, sticker: 3750, bpom: 0, halal: 3500000 },
  { min: 5000, base: 0.75, actAdd: 2000, pack: 1.2, sticker: 2500, bpom: 0, halal: 3500000 },
  { min: 10000, base: 0.5, actAdd: 1000, pack: 1.1, sticker: 1250, bpom: 0, halal: 3500000 },
  { min: 25000, base: 0.4, actAdd: 0, pack: 1.0, sticker: 990, bpom: 0, halal: 3500000 },
];

const DEFAULT_SETTINGS = {
  tiers: DEFAULT_TIERS, maxQty: 25000,
  activeDosePct: 1, activeScrapFactor: 1.35, packagingMarkup: 1.35,
  bpomLabPerSku: 3500000, halalPerSku: 3500000, samplePerSku: 555000, stickerPerPcs: 0,
  roundPerPcs: 1, dpPercent: 50, invoiceDueDays: 7,
  companyName: APP_NAME, companyAddress: "", companyPhone: "6285645024291", companyEmail: "",
  bankInfo: "", signerName: "", signerTitle: "Direktur", courtCity: "",
  invoiceNotes: "Harga belum termasuk ongkos kirim. Ongkos kirim dibayarkan saat produk sudah ready.\n" +
    "Pembayaran: DP 50% untuk memulai proses. Pelunasan sisa 50% + ongkos kirim dilakukan setelah nomor izin edar BPOM terbit.\n" +
    "MoU terlampir wajib ditandatangani kedua pihak di atas meterai Rp 10.000 dan dikirim kembali ke WhatsApp admin.",
};

/* ============================================================ HTTP (web app) */
function doPost(e) {
  let data;
  try { data = JSON.parse(e.postData.contents); } catch (err) { return json_({ error: "invalid json" }); }

  // Web harga transparan: verifikasi nomor WhatsApp (OTP) & data calon klien
  if (data.action === "otpSend") return json_(otpSend_(data));
  if (data.action === "otpVerify") return json_(otpVerify_(data));
  if (data.action === "lead") return json_(saveLead_(data.lead || {}));
  if (data.action === "pricelist") {
    const phone = checkToken_(data.token);
    if (!phone) return json_({ error: "unauthorized" });
    return json_({ ok: true, prices: publicPrices_() });
  }

  if (data.action === "syncPrices") {
    if (!checkKey_(data.key)) return json_({ error: "unauthorized" });
    const savedAt = saveJsonFile_("PRICES", "MaklonGo - harga (RAHASIA).json", data.prices);
    return json_({ ok: true, synced: savedAt });
  }

  // Tambah / edit / hapus base, bahan aktif & kemasan dari dashboard (tanpa harga — dibaca publik oleh web customer)
  if (data.action === "saveCatalog") {
    if (!checkKey_(data.key)) return json_({ error: "unauthorized" });
    const savedAt = saveJsonFile_("CATALOG", "MaklonGo - katalog (perubahan admin).json", data.catalog || {});
    return json_({ ok: true, saved: savedAt });
  }

  // Upload foto kemasan baru → folder Drive "MaklonGo - foto kemasan" (dibagikan: siapa saja yang punya link boleh lihat)
  if (data.action === "uploadImage") {
    if (!checkKey_(data.key)) return json_({ error: "unauthorized" });
    const m = String(data.dataUrl || "").match(/^data:(image\/[a-z+]+);base64,(.+)$/);
    if (!m) return json_({ error: "gambar tidak valid" });
    const props = PropertiesService.getScriptProperties();
    let folder = null;
    const fid = props.getProperty("IMAGE_FOLDER_ID");
    if (fid) { try { folder = DriveApp.getFolderById(fid); } catch (err) { folder = null; } }
    if (!folder) { folder = DriveApp.createFolder("MaklonGo - foto kemasan"); props.setProperty("IMAGE_FOLDER_ID", folder.getId()); }
    const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], data.name || "kemasan.jpg"));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return json_({ ok: true, id: file.getId(), url: "https://lh3.googleusercontent.com/d/" + file.getId() + "=w600" });
  }

  // Simpan perubahan order dari dashboard (status & penyesuaian harga) agar sama di semua perangkat
  if (data.action === "saveOrder") {
    if (!checkKey_(data.key)) return json_({ error: "unauthorized" });
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const sh = invoiceSheet_();
      const last = sh.getLastRow();
      if (last < 2) return json_({ error: "not found" });
      const ids = sh.getRange(2, COL.id, last - 1, 1).getValues().flat();
      const i = ids.indexOf(data.id);
      if (i < 0) return json_({ error: "not found" });
      const row = i + 2;
      const cell = sh.getRange(row, COL.json);
      const o = JSON.parse(cell.getValue() || "{}");
      o.adj = data.adj || {};
      o.status = data.status || o.status;
      o.updatedAt = data.updatedAt || new Date().toISOString();
      cell.setValue(JSON.stringify(o));
      sh.getRange(row, COL.status).setValue(STATUS_NAMES[o.status] || o.status);
      return json_({ ok: true });
    } finally {
      lock.releaseLock();
    }
  }

  const o = data.order;
  if (!o || !o.id || !o.items || !o.customer) return json_({ error: "invalid order" });
  if (o.source === "pricelist") {
    const vphone = checkToken_(data.token);
    o.customer.verified = !!vphone && vphone === normPhone_(o.customer.phone);
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = invoiceSheet_();
    const last = sh.getLastRow();
    const ids = last > 1 ? sh.getRange(2, COL.id, last - 1, 1).getValues().flat() : [];
    const existing = ids.indexOf(o.id);
    // Order dengan nomor sama: abaikan, kecuali admin meminta perbarui (import ulang dari dashboard)
    const replace = existing >= 0 && data.replace && checkKey_(data.key);
    if (existing >= 0 && !replace) return json_({ ok: true, duplicate: true });
    let download = "", view = "", total = "";
    try {
      const res = createInvoicePdf_(o);
      download = res.download; view = res.view; total = res.total;
    } catch (err) {
      download = "GAGAL: " + err.message;
    }
    const c = o.customer;
    const pcs = o.items.reduce((s, x) => s + Number(x.qty || 0), 0);
    const rincian = o.items.map((x, i) => `SKU${i + 1}: ${x.productName || x.baseName} (${x.baseName}${x.variant ? ", " + x.variant : ""}) ${x.vol}${x.unit || ""} x${x.qty} pcs` +
      ` | aktif: ${(x.activeNames || []).join(", ") || "-"}${x.customActives ? " + request: " + x.customActives : ""}` +
      ` | kemasan: ${x.packagingLabel || "-"} | sample: ${x.sample ? "Ya" : "Tidak"}`).join("\n");
    const row = [o.id, download, `${c.name} (${c.brand})`, new Date(o.createdAt), c.brand, "'" + c.phone, c.email, c.city,
      o.items.length, pcs, total, view, rincian, c.brandNote || "", "Baru", data.packed || "", JSON.stringify(o)];
    if (replace) {
      const r = existing + 2;
      const old = sh.getRange(r, 1, 1, INVOICE_HEADERS.length).getValues()[0];
      row[COL.status - 1] = old[COL.status - 1] || "Baru";
      // Invoice PDF lama dipindah ke sampah
      const m = String(old[COL.link - 1]).match(/id=([\w-]+)/);
      if (m) { try { DriveApp.getFileById(m[1]).setTrashed(true); } catch (err) {} }
      sh.getRange(r, 1, 1, row.length).setValues([row]);
      return json_({ ok: true, pdf: download, replaced: true });
    }
    sh.appendRow(row);
    return json_({ ok: true, pdf: download });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  // Publik: perubahan katalog (tanpa harga) untuk web customer
  if (e.parameter.action === "catalog") {
    const cat = readJsonFile_("CATALOG");
    return json_({ catalog: cat.data, savedAt: cat.savedAt });
  }
  if (!checkKey_(e.parameter.key)) return json_({ error: "unauthorized" });
  if (e.parameter.action === "prices") {
    const p = readJsonFile_("PRICES");
    return json_({ prices: p.data, savedAt: p.savedAt });
  }
  const sh = invoiceSheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return json_({ orders: [] });
  const rows = sh.getRange(2, 1, n, INVOICE_HEADERS.length).getValues();
  return json_({ orders: rows.filter((r) => r[COL.json - 1]).map((r) => ({
    packed: r[COL.packed - 1] || null, order: JSON.parse(r[COL.json - 1]), pdf: r[COL.view - 1] || r[COL.link - 1] })) });
}

/* ============================================================ OTP WhatsApp (Fonnte) & leads
 * Script property FONNTE_TOKEN = token device dari https://fonnte.com (menu Device → token).
 * Tanpa token: otpSend membalas "otp_not_configured" dan web melewati verifikasi.
 */
const LEADS_TAB = "Leads Web";
const LEADS_HEADERS = ["Waktu", "Nama", "No WhatsApp", "WA Terverifikasi", "Email", "Instagram", "Nama Brand", "Sumber"];

function normPhone_(p) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.indexOf("0") === 0) d = "62" + d.slice(1); else if (d.indexOf("8") === 0) d = "62" + d;
  return d;
}
function otpHash_(phone, code) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, phone + ":" + code + ":" + (PropertiesService.getScriptProperties().getProperty("ADMIN_KEY") || "")));
}

function otpSend_(d) {
  const phone = normPhone_(d.phone);
  if (!/^628\d{7,12}$/.test(phone)) return { error: "Nomor WhatsApp tidak valid" };
  const token = PropertiesService.getScriptProperties().getProperty("FONNTE_TOKEN");
  if (!token) return { error: "otp_not_configured" };
  const cache = CacheService.getScriptCache();
  if (cache.get("otpwait:" + phone)) return { error: "Tunggu 60 detik sebelum meminta kode baru" };
  const count = Number(cache.get("otpcnt:" + phone) || 0);
  if (count >= 5) return { error: "Terlalu banyak permintaan kode. Coba lagi 1 jam lagi." };
  const global = Number(cache.get("otpglobal") || 0);
  if (global >= 300) return { error: "Layanan verifikasi sedang sibuk, coba lagi nanti" };
  const code = String(100000 + (parseInt(Utilities.getUuid().replace(/-/g, "").slice(0, 8), 16) % 900000));
  const res = UrlFetchApp.fetch("https://api.fonnte.com/send", {
    method: "post", headers: { Authorization: token }, muteHttpExceptions: true,
    payload: { target: phone, message: "Kode verifikasi MaklonGo: *" + code + "*\nBerlaku 5 menit. Jangan berikan kode ini kepada siapa pun." },
  });
  let body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) {}
  if (!body.status) return { error: "Gagal mengirim WhatsApp" + (body.reason ? ": " + body.reason : "") };
  cache.put("otp:" + phone, otpHash_(phone, code), 300);
  cache.put("otptry:" + phone, "0", 300);
  cache.put("otpwait:" + phone, "1", 60);
  cache.put("otpcnt:" + phone, String(count + 1), 3600);
  cache.put("otpglobal", String(global + 1), 3600);
  return { ok: true };
}

function otpVerify_(d) {
  const phone = normPhone_(d.phone);
  const cache = CacheService.getScriptCache();
  const h = cache.get("otp:" + phone);
  if (!h) return { error: "Kode sudah kedaluwarsa, minta kode baru" };
  const tries = Number(cache.get("otptry:" + phone) || 0);
  if (tries >= 5) { cache.remove("otp:" + phone); return { error: "Terlalu banyak percobaan, minta kode baru" }; }
  if (otpHash_(phone, String(d.code || "").trim()) !== h) { cache.put("otptry:" + phone, String(tries + 1), 300); return { error: "Kode salah" }; }
  cache.remove("otp:" + phone);
  cache.put("otpok:" + phone, "1", 21600);
  return { ok: true, token: makeToken_(phone) };
}

/* Token akses web pricelist: "<nomor>.<kedaluwarsa>.<tanda tangan HMAC>", berlaku 30 hari */
function tokenSecret_() {
  const props = PropertiesService.getScriptProperties();
  let k = props.getProperty("TOKEN_SECRET");
  if (!k) { k = Utilities.getUuid() + Utilities.getUuid(); props.setProperty("TOKEN_SECRET", k); }
  return k;
}
function sign_(payload) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, tokenSecret_())).replace(/=+$/, "");
}
function makeToken_(phone) {
  const payload = phone + "." + (Date.now() + 30 * 864e5);
  return payload + "." + sign_(payload);
}
function checkToken_(tok) {
  const m = String(tok || "").match(/^(\d{8,15})\.(\d+)\.([\w-]+)$/);
  if (!m || Number(m[2]) < Date.now() || sign_(m[1] + "." + m[2]) !== m[3]) return null;
  return m[1];
}

// Harga jual untuk web pricelist (hanya untuk pengunjung yang sudah verifikasi OTP)
function publicPrices_() {
  const P = loadPrices_(), st = P.settings;
  const out = { bases: {}, actives: {}, packaging: {}, tiers: tiersOf_(st), maxQty: num_(st.maxQty, 25000),
    activeDosePct: num_(st.activeDosePct, 1), fees: { sample: num_(st.samplePerSku, 555000) } };
  Object.keys(P.bases).forEach((k) => { const v = P.bases[k]; if (v.price && v.vol) out.bases[k] = v.price / v.vol; });
  Object.keys(P.actives).forEach((k) => { const v = P.actives[k]; if (v.pricePerGram) out.actives[k] = v.pricePerGram * num_(st.activeScrapFactor, 1.35); });
  Object.keys(P.packaging).forEach((k) => { const v = P.packaging[k]; if (v.filePrice && v.filePrice * 1.35 < 150000) out.packaging[k] = v.filePrice; });
  return out;
}

function saveLead_(l) {
  const phone = normPhone_(l.phone);
  if (!l.name || !phone) return { error: "data tidak lengkap" };
  const verified = CacheService.getScriptCache().get("otpok:" + phone) === "1";
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sh = ss.getSheetByName(LEADS_TAB);
    if (!sh) { sh = ss.insertSheet(LEADS_TAB); sh.getRange(1, 1, 1, LEADS_HEADERS.length).setValues([LEADS_HEADERS]).setFontWeight("bold"); sh.setFrozenRows(1); }
    const clip = (x) => String(x || "").slice(0, 200);
    sh.appendRow([new Date(), clip(l.name), "'" + phone, verified ? "Ya" : "Tidak", clip(l.email), clip(l.ig), clip(l.brand), clip(l.source || "web harga transparan")]);
  } finally { lock.releaseLock(); }
  return { ok: true, verified: verified };
}

/* File JSON di My Drive; ID disimpan di Script Properties <NAME>_FILE_ID */
function saveJsonFile_(name, title, obj) {
  const props = PropertiesService.getScriptProperties();
  const content = JSON.stringify(obj);
  let file = null;
  const id = props.getProperty(name + "_FILE_ID");
  if (id) { try { file = DriveApp.getFileById(id); } catch (err) { file = null; } }
  if (file) file.setContent(content);
  else { file = DriveApp.createFile(title, content, MimeType.PLAIN_TEXT); props.setProperty(name + "_FILE_ID", file.getId()); }
  const savedAt = new Date().toISOString();
  props.setProperty(name + "_SAVED_AT", savedAt);
  return savedAt;
}
function readJsonFile_(name) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(name + "_FILE_ID");
  if (!id) return { data: null, savedAt: null };
  return { data: JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString()), savedAt: props.getProperty(name + "_SAVED_AT") };
}

function checkKey_(k) {
  const key = PropertiesService.getScriptProperties().getProperty("ADMIN_KEY");
  return !!key && k === key;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* Tab "Invoice": pastikan header lengkap & hapus baris contoh (link GANTI_FILE_ID) */
function invoiceSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(INVOICE_TAB);
  if (!sh) sh = ss.insertSheet(INVOICE_TAB);
  const head = sh.getRange(1, 1, 1, INVOICE_HEADERS.length).getValues()[0];
  if (head.join("|") !== INVOICE_HEADERS.join("|")) {
    sh.getRange(1, 1, 1, INVOICE_HEADERS.length).setValues([INVOICE_HEADERS]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  const last = sh.getLastRow();
  if (last > 1) {
    const links = sh.getRange(2, COL.link, last - 1, 1).getValues().flat();
    for (let i = links.length - 1; i >= 0; i--) {
      if (String(links[i]).indexOf("GANTI_FILE_ID") >= 0) sh.deleteRow(i + 2);
    }
  }
  return sh;
}

/* Jalankan sekali dari editor (pilih "setup" → Run): memberi izin, merapikan tab Invoice & menghapus baris contoh. */
function setup() {
  invoiceSheet_();
  DriveApp.getFolderById(INVOICE_FOLDER_ID).getName();
  Logger.log("OK — tab Invoice siap.");
}

/* ============================================================ harga (sama dengan assets/js/pricing.js) */
function loadPrices_() {
  const id = PropertiesService.getScriptProperties().getProperty("PRICES_FILE_ID");
  if (!id) throw new Error("Harga belum disinkron. Buka dashboard admin → Pengaturan → Sinkron harga ke Google Drive.");
  const p = JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString());
  p.settings = Object.assign({}, DEFAULT_SETTINGS, p.settings || {});
  if (!p.settings.companyPhone || p.settings.companyPhone === "6281234567890") p.settings.companyPhone = DEFAULT_SETTINGS.companyPhone;
  return p;
}
const num_ = (v, d) => (v === "" || v == null || isNaN(Number(v)) ? (d || 0) : Number(v));

function tiersOf_(st) { return st.tiers && st.tiers.length ? st.tiers : DEFAULT_TIERS; }
function tierOf_(st, q) { return tiersOf_(st).reduce((t, x) => (q >= x.min ? x : t), tiersOf_(st)[0]); }

function computeSku_(item, prices) {
  const st = prices.settings;
  const qty = num_(item.qty);
  const t = tierOf_(st, qty);
  const vol = num_(item.vol);
  const lines = [];
  const bp = prices.bases[item.baseId];
  lines.push({ label: "Base", value: bp ? (bp.price / bp.vol) * vol * t.base : 0 });
  const doseG = vol * (num_(st.activeDosePct, 1) / 100);
  (item.actives || []).forEach((id, i) => {
    const ap = prices.actives[id];
    lines.push({ label: (item.activeNames || [])[i] || id, value: ap ? ap.pricePerGram * doseG * num_(st.activeScrapFactor, 1.35) + num_(t.actAdd) : 0 });
  });
  const pp = item.noPackaging ? null : prices.packaging[item.packagingId];
  const pack = pp ? (pp.filePrice ? Math.round(pp.filePrice * num_(t.pack, 1.35)) : num_(pp.price)) : 0;
  lines.push({ label: "Kemasan", value: pack });
  if (item.sticker) lines.push({ label: "Sticker", value: num_(t.sticker) });
  const round = Math.max(1, num_(st.roundPerPcs, 1));
  const rawUnit = lines.reduce((s, l) => s + num_(l.value), 0);
  const unit = round > 1 ? Math.ceil(rawUnit / round) * round : Math.round(rawUnit);
  const bpom = item.bpom ? num_(t.bpom) : 0;
  const halal = item.halal ? num_(t.halal) : 0;
  const sample = item.sample ? num_(st.samplePerSku, 555000) : 0;
  return { lines, qty, unit, production: unit * qty, bpom, halal, sample, total: unit * qty + bpom + halal + sample,
    needsReview: !bp || (!item.noPackaging && !pack) || (!!item.noPackaging && !item.ownPackaging) || !!item.customActives };
}

// Gambaran harga jika jumlah diperbesar (qty sekarang lalu tiap tier sampai maxQty)
function ladder_(item, prices) {
  const q = num_(item.qty), max = num_(prices.settings.maxQty, 25000);
  const qs = [q].concat(tiersOf_(prices.settings).map((t) => t.min)).filter((x, i, a) => a.indexOf(x) === i && x >= q && x <= max).sort((a, b) => a - b);
  return qs.map((n) => {
    const s = computeSku_(Object.assign({}, item, { qty: n, sample: false }), prices);
    return { qty: n, unit: s.unit, perPcs: (s.production + s.bpom + s.halal) / n, total: s.production + s.bpom + s.halal };
  });
}

function computeOrder_(order, prices) {
  const skus = order.items.map((it) => computeSku_(it, prices));
  const total = skus.reduce((s, x) => s + x.total, 0);
  const dpPct = num_(prices.settings.dpPercent, 0);
  const dp = Math.round((total * dpPct) / 100);
  return { skus, subtotal: total, total, dp, dpPct, balance: total - dp };
}

/* ============================================================ PDF */
function createInvoicePdf_(o) {
  const prices = loadPrices_();
  const calc = computeOrder_(o, prices);
  const html = invoiceHtml_(o, calc, prices.settings, prices);
  const name = `INV-${o.id} - ${o.customer.brand || o.customer.name}.pdf`;
  const pdf = Utilities.newBlob(html, MimeType.HTML, "invoice.html").getAs(MimeType.PDF).setName(name);
  const file = DriveApp.getFolderById(INVOICE_FOLDER_ID).createFile(pdf);
  // Hanya file ini yang bisa dibuka lewat link (folder tetap privat)
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return { download: "https://drive.google.com/uc?export=download&id=" + file.getId(), view: file.getUrl(), total: calc.total };
}

function esc_(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function n_(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
function rp_(n) {
  return "Rp " + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
function tgl_(d, withDay) {
  const bulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  const hari = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  return (withDay ? hari[d.getDay()] + ", " : "") + d.getDate() + " " + bulan[d.getMonth()] + " " + d.getFullYear();
}
function logoDataUri_() {
  try {
    const bytes = UrlFetchApp.fetch(LOGO_URL).getBlob().getBytes();
    return bytes && bytes.length ? "data:image/jpeg;base64," + Utilities.base64Encode(bytes) : "";
  } catch (e) { return ""; }
}

function invoiceHtml_(o, calc, st, prices) {
  const c = o.customer;
  const logo = logoDataUri_();
  const now = new Date();
  const due = new Date(now.getTime() + (Number(st.invoiceDueDays) || 7) * 864e5);
  const company = st.companyName || APP_NAME;
  const adminWa = st.companyPhone || "";
  let no = 0;
  const rows = [];
  o.items.forEach((it, i) => {
    const s = calc.skus[i];
    const desc = [
      `<b>SKU ${i + 1} — ${esc_(it.productName || it.baseName)} (${esc_(it.vol)} ${esc_(it.unit || "ml")})</b>`,
      `Base: ${esc_(it.baseName)}${it.variant ? " (" + esc_(it.variant) + ")" : ""}`,
      `Bahan aktif tambahan: ${esc_((it.activeNames || []).join(", ") || "-")}${it.customActives ? "; request: " + esc_(it.customActives) : ""}`,
      `Kemasan: ${esc_(it.packagingLabel || "-")}`,
      it.sticker ? "Termasuk sticker label" : "",
    ].filter(Boolean).join("<br>");
    rows.push([++no, desc, s.qty + " pcs", rp_(s.unit), rp_(s.production)]);
    if (it.bpom) rows.push([++no, `Biaya BPOM &amp; Lab — SKU ${i + 1}${s.bpom ? "" : " (gratis untuk order ≥ 1.000 pcs)"}`, "1 SKU", s.bpom ? rp_(s.bpom) : "GRATIS", s.bpom ? rp_(s.bpom) : "GRATIS"]);
    if (it.halal) rows.push([++no, `Sertifikasi Halal — SKU ${i + 1}`, "1 SKU", rp_(s.halal), rp_(s.halal)]);
    if (it.sample) rows.push([++no, `Sample produk (termasuk PPN) — SKU ${i + 1}`, "1 SKU", rp_(s.sample), rp_(s.sample)]);
  });
  const review = calc.skus.some((s) => s.needsReview);
  const tot = [["Subtotal", rp_(calc.subtotal)], ["<b style='color:#0a8a86;font-size:12pt'>TOTAL</b>", `<b style='color:#0a8a86;font-size:12pt'>${rp_(calc.total)}</b>`],
    ["Ongkos kirim", "ditagih saat produk ready"]];
  if (calc.dpPct) { tot.push([`DP ${calc.dpPct}% (di awal)`, rp_(calc.dp)]); tot.push(["Pelunasan setelah NIE BPOM terbit (+ ongkir)", rp_(calc.balance)]); }

  const pasal = (n, title, items) => `<h4>Pasal ${n}<br>${title}</h4>` +
    (items.length > 1 ? `<ol>${items.map((t) => `<li>${t}</li>`).join("")}</ol>` : `<p>${items[0]}</p>`);
  const skuList = o.items.map((it, i) => `SKU ${i + 1} "${esc_(it.productName || it.baseName)}" ${esc_(it.vol)} ${esc_(it.unit || "ml")} sebanyak ${calc.skus[i].qty} pcs`).join("; ");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 16mm 15mm; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; color: #262626; }
    .bar { height: 5px; background: #11bab5; margin-bottom: 14px; }
    table { border-collapse: collapse; width: 100%; }
    .head td { vertical-align: top; }
    .muted { color: #666; }
    h1 { color: #0a8a86; font-size: 22pt; margin: 0; text-align: right; }
    .items th { background: #0a8a86; color: #fff; padding: 6px; font-size: 9pt; text-align: left; }
    .items td { border-bottom: 1px solid #e8e4dc; padding: 6px; vertical-align: top; font-size: 8.8pt; }
    .r { text-align: right; white-space: nowrap; } .c { text-align: center; }
    .tot td { padding: 3px 6px; }
    .note { background: #fff4d6; border: 1px solid #f3dc9a; padding: 8px 10px; color: #6b4c00; margin-top: 10px; }
    .mou { page-break-before: always; font-size: 9.3pt; line-height: 1.45; }
    .mou h2 { text-align: center; margin: 0; font-size: 13pt; } .mou h3 { text-align: center; margin: 2px 0; font-size: 11pt; }
    .mou h4 { text-align: center; margin: 12px 0 4px; font-size: 10pt; }
    .mou ol { margin: 0; padding-left: 20px; } .mou p { margin: 4px 0; text-align: justify; } .mou li { text-align: justify; margin-bottom: 2px; }
    .sig td { width: 50%; text-align: center; vertical-align: top; padding-top: 18px; }
    .meterai { width: 110px; height: 70px; border: 1px dashed #999; margin: 10px auto; color: #999; font-size: 8pt; padding-top: 22px; box-sizing: border-box; }
    .line { border-top: 1px solid #444; width: 75%; margin: 30px auto 4px; }
  </style></head><body>
  <div class="bar"></div>
  <table class="head"><tr>
    <td>${logo ? `<img src="${logo}" style="height:46px">` : `<b style="font-size:20pt">${APP_NAME}</b>`}<br>
      <span class="muted">${[company !== APP_NAME ? esc_(company) : "", esc_(st.companyAddress), adminWa ? "WA: " + esc_(adminWa) : "", esc_(st.companyEmail)].filter(Boolean).join("<br>") || TAGLINE}</span></td>
    <td style="text-align:right"><h1>INVOICE</h1><span class="muted">No. Invoice: INV/${esc_(o.id)}<br>No. Order: ${esc_(o.id)}<br>Tanggal: ${tgl_(now)}<br>Jatuh tempo: ${tgl_(due)}</span></td>
  </tr></table>
  <hr style="border:0;border-top:1px solid #e5e5e5;margin:12px 0">
  <b>Ditagihkan kepada:</b><br><span class="muted">${esc_(c.name)}<br>Brand: ${esc_(c.brand)}<br>${esc_(c.phone)} · ${esc_(c.email)}${c.ig ? " · IG " + esc_(c.ig) : ""}<br>${esc_(c.city)}</span>
  <table class="items" style="margin-top:14px"><tr><th class="c" style="width:22px">No</th><th>Deskripsi</th><th class="r">Qty</th><th class="r">Harga</th><th class="r">Jumlah</th></tr>
    ${rows.map((r) => `<tr><td class="c">${r[0]}</td><td>${r[1]}</td><td class="r">${r[2]}</td><td class="r">${r[3]}</td><td class="r">${r[4]}</td></tr>`).join("")}
  </table>
  <table class="tot" style="width:62%;margin:10px 0 0 auto">${tot.map((t) => `<tr><td>${t[0]}</td><td class="r">${t[1]}</td></tr>`).join("")}</table>
  ${o.items.map((it, i) => { const L = ladder_(it, prices); if (L.length < 2) return "";
    return `<p style="margin:14px 0 4px"><b>Gambaran harga jika jumlah diperbesar — SKU ${i + 1}${it.productName ? ": " + esc_(it.productName) : ""}</b></p>
    <table class="items"><tr><th>Jumlah</th><th class="r">Harga / pcs</th><th class="r">Per pcs incl. BPOM &amp; Halal</th><th class="r">Total</th><th class="r">Hemat</th></tr>
    ${L.map((r) => `<tr><td>${n_(r.qty)} pcs</td><td class="r">${rp_(r.unit)}</td><td class="r">${rp_(r.perPcs)}</td><td class="r">${rp_(r.total)}</td><td class="r">${r.qty === L[0].qty ? "pesanan ini" : "-" + Math.round((1 - r.perPcs / L[0].perPcs) * 100) + "%"}</td></tr>`).join("")}</table>`; }).join("")}
  <p class="muted" style="font-size:8.5pt"><i>Harga bisa dinegosiasikan atau disesuaikan kembali bersama admin. Order di atas ${n_(num_(st.maxQty, 25000))} pcs: hubungi admin.</i></p>
  ${review ? `<div class="note">Sebagian komponen (kemasan dicarikan admin / request bahan aktif) akan dikonfirmasi admin. Invoice final dapat berubah setelah dicek admin.</div>` : ""}
  ${st.bankInfo ? `<p><b>Informasi Pembayaran</b><br>${esc_(st.bankInfo).replace(/\n/g, "<br>")}</p>` : ""}
  <p><b>Catatan</b><br>${esc_(st.invoiceNotes).replace(/\n/g, "<br>")}</p>

  <div class="mou">
    ${logo ? `<div style="text-align:center"><img src="${logo}" style="height:34px"></div>` : ""}
    <h2>MEMORANDUM OF UNDERSTANDING (MoU)</h2><h3>PERJANJIAN KERJA SAMA MAKLON PRODUK KOSMETIK</h3>
    <div style="text-align:center" class="muted">Nomor: MOU/${esc_(o.id)}</div>
    <p>Pada hari ini, ${tgl_(now, true)}, yang bertanda tangan di bawah ini:</p>
    <p>1. ${esc_(company)}${st.signerName ? `, dalam hal ini diwakili oleh ${esc_(st.signerName)} selaku ${esc_(st.signerTitle || "Direktur")}` : ""}${st.companyAddress ? `, beralamat di ${esc_(st.companyAddress)}` : ""}, selanjutnya disebut "PIHAK PERTAMA" atau "Pemaklon".</p>
    <p>2. ${esc_(c.name)}, pemilik merek "${esc_(c.brand)}", berdomisili di ${esc_(c.city)}, No. HP ${esc_(c.phone)}, email ${esc_(c.email)}, selanjutnya disebut "PIHAK KEDUA" atau "Pemilik Merek".</p>
    <p>PIHAK PERTAMA dan PIHAK KEDUA (selanjutnya bersama-sama disebut "PARA PIHAK") sepakat untuk mengikatkan diri dalam kerja sama maklon produk kosmetik dengan ketentuan sebagai berikut:</p>
    ${pasal(1, "RUANG LINGKUP", [
      `PIHAK PERTAMA memproduksi produk kosmetik untuk merek milik PIHAK KEDUA sesuai rincian pesanan No. ${esc_(o.id)} dan invoice No. INV/${esc_(o.id)} yang merupakan bagian tidak terpisahkan dari MoU ini, yaitu: ${skuList}.`,
      "Pekerjaan meliputi produksi, pengisian ke dalam kemasan, pemasangan sticker/label, serta pengurusan notifikasi BPOM dan sertifikasi halal sesuai pilihan PIHAK KEDUA."])}
    ${pasal(2, "HARGA DAN PEMBAYARAN", [
      `Nilai pekerjaan sesuai invoice sebesar ${rp_(calc.total)} dan belum termasuk ongkos kirim. Ongkos kirim dibayarkan oleh PIHAK KEDUA pada saat produk sudah siap (ready).`,
      `PIHAK KEDUA membayar uang muka (DP) sebesar ${calc.dpPct || 50}% (${rp_(calc.dp)}) sebelum proses pendaftaran, pengujian dan produksi dimulai.`,
      "Pelunasan sisa pembayaran beserta ongkos kirim wajib dibayarkan oleh PIHAK KEDUA setelah nomor izin edar (notifikasi) BPOM terbit, sebelum produk dikirim.",
      `Biaya request sample (apabila dipilih) sebesar ${rp_(st.samplePerSku || 555000)} per SKU sudah termasuk PPN dan dibayarkan bersama DP.`,
      "Uang muka yang telah dibayarkan tidak dapat dikembalikan apabila PIHAK KEDUA membatalkan pesanan secara sepihak setelah proses pendaftaran, pengujian, pembelian bahan atau produksi dimulai."])}
    ${pasal(3, "HAK DAN KEWAJIBAN PIHAK PERTAMA", [
      "Memproduksi produk sesuai spesifikasi yang disepakati dengan memperhatikan Cara Pembuatan Kosmetika yang Baik (CPKB) dan standar mutu yang berlaku.",
      "Mengurus pendaftaran notifikasi BPOM, pengujian laboratorium dan sertifikasi halal sesuai pilihan PIHAK KEDUA, dengan data yang benar dari PIHAK KEDUA.",
      "Menginformasikan perkembangan proses kepada PIHAK KEDUA dan menjaga kerahasiaan data serta konsep merek PIHAK KEDUA.",
      "Berhak menunda atau menghentikan proses apabila PIHAK KEDUA belum memenuhi kewajiban pembayaran atau melanggar ketentuan MoU ini."])}
    ${pasal(4, "HAK DAN KEWAJIBAN PIHAK KEDUA", [
      "Memberikan data, dokumen dan desain label yang benar dan lengkap, serta bertanggung jawab penuh atas keabsahan merek, logo dan desain (tidak melanggar hak kekayaan intelektual pihak lain).",
      "Menyetujui desain sticker/label dan spesifikasi produk sebelum produksi dimulai; perubahan setelah persetujuan dapat menimbulkan biaya tambahan.",
      "Melakukan pembayaran sesuai jadwal pada Pasal 2.",
      "Memasarkan produk sesuai klaim, kegunaan dan informasi yang telah disetujui BPOM, serta mematuhi peraturan perundang-undangan yang berlaku."])}
    ${pasal(5, "IZIN EDAR, FORMULA DAN MEREK", [
      "Nomor izin edar (notifikasi BPOM) hanya berlaku untuk produk yang diproduksi oleh PIHAK PERTAMA dan tidak boleh digunakan untuk produk lain dalam bentuk apa pun.",
      "Formula produk merupakan milik dan rahasia PIHAK PERTAMA. Merek dan desain kemasan merupakan milik PIHAK KEDUA.",
      "Pemindahan atau penggunaan nomor izin edar oleh pihak lain hanya dapat dilakukan dengan persetujuan tertulis PIHAK PERTAMA dan sesuai ketentuan BPOM."])}
    ${pasal(6, "LARANGAN DAN SANKSI", [
      "PIHAK KEDUA dilarang: (a) menyalahgunakan nomor izin edar, termasuk mencantumkannya pada produk yang tidak diproduksi oleh PIHAK PERTAMA; (b) memalsukan produk, mengubah isi/komposisi, mengemas ulang (repacking) atau mencampur produk; (c) memalsukan label, dokumen, sertifikat BPOM maupun sertifikat halal; (d) melakukan tindakan pidana lainnya yang berkaitan dengan produk.",
      `Apabila PIHAK KEDUA melakukan pelanggaran sebagaimana dimaksud pada ayat (1), PIHAK KEDUA wajib membayar ganti rugi kepada PIHAK PERTAMA (${esc_(company)}) sebesar Rp 1.000.000.000,- (satu miliar rupiah), di samping akan diproses secara hukum melalui pengadilan di Indonesia sesuai peraturan perundang-undangan yang berlaku.`,
      "PIHAK PERTAMA berhak menghentikan kerja sama secara sepihak, menarik produk, serta melaporkan pelanggaran kepada BPOM dan aparat penegak hukum."])}
    ${pasal(7, "KERAHASIAAN", ["PARA PIHAK wajib menjaga kerahasiaan seluruh informasi yang diperoleh dalam kerja sama ini, termasuk formula, harga dan data bisnis, dan tidak mengungkapkannya kepada pihak ketiga tanpa persetujuan tertulis pihak lainnya."])}
    ${pasal(8, "KEADAAN KAHAR (FORCE MAJEURE)", ["Keterlambatan atau kegagalan pelaksanaan kewajiban akibat keadaan di luar kemampuan PARA PIHAK (bencana alam, kebakaran, wabah, kebijakan pemerintah, gangguan pasokan dan sejenisnya) tidak dianggap sebagai pelanggaran. Pihak yang mengalami wajib memberitahukan pihak lainnya selambat-lambatnya 7 (tujuh) hari."])}
    ${pasal(9, "PENYELESAIAN PERSELISIHAN", [
      "Perselisihan yang timbul diselesaikan terlebih dahulu secara musyawarah untuk mufakat.",
      `Apabila musyawarah tidak mencapai mufakat, PARA PIHAK sepakat menyelesaikannya melalui Pengadilan Negeri ${st.courtCity ? esc_(st.courtCity) : "di wilayah hukum Republik Indonesia sesuai domisili PIHAK PERTAMA"}.`])}
    ${pasal(10, "PENUTUP", [
      "MoU ini berlaku sejak ditandatangani oleh PARA PIHAK sampai seluruh kewajiban PARA PIHAK selesai dilaksanakan.",
      "MoU ini wajib ditandatangani oleh PIHAK PERTAMA dan PIHAK KEDUA di atas meterai Rp 10.000,- dan mempunyai kekuatan hukum yang sama.",
      `PIHAK KEDUA wajib mengirimkan kembali lembar MoU yang telah ditandatangani di atas meterai (foto/scan) ke WhatsApp admin ${esc_(adminWa)}. Proses pekerjaan dimulai setelah MoU yang telah ditandatangani dan DP diterima oleh PIHAK PERTAMA.`])}
    <table class="sig" style="page-break-inside:avoid"><tr>
      <td><b>PIHAK PERTAMA</b><br>${esc_(company)}${st.signerTitle ? " — " + esc_(st.signerTitle) : ""}<div class="meterai">Meterai<br>Rp 10.000</div><div class="line"></div>${st.signerName ? esc_(st.signerName) : "(...........................................)"}</td>
      <td><b>PIHAK KEDUA</b><br>Pemilik Merek "${esc_(c.brand)}"<div class="meterai">Meterai<br>Rp 10.000</div><div class="line"></div>${esc_(c.name)}</td>
    </tr></table>
    <div class="note" style="text-align:center;font-weight:bold">Kirim kembali MoU yang sudah ditandatangani di atas meterai Rp 10.000 ke WhatsApp admin${adminWa ? ": " + esc_(adminWa) : ""}</div>
  </div>
  </body></html>`;
}

/* Jalankan sekali dari editor (pilih fungsi testInvoice → Run) untuk memberi izin & mencoba membuat PDF contoh. */
function testInvoice() {
  const prices = loadPrices_();
  const baseId = Object.keys(prices.bases)[0];
  const packId = Object.keys(prices.packaging)[0];
  const res = createInvoicePdf_({
    id: "MG-TEST-" + Date.now(), createdAt: new Date().toISOString(),
    customer: { name: "Contoh Customer", phone: "081234567890", email: "contoh@email.com", city: "Bandung", brand: "Brand Contoh" },
    items: [{ baseId, baseName: "Contoh Base", vol: prices.bases[baseId].vol, unit: prices.bases[baseId].unit, qty: 50, actives: [], activeNames: [],
      packagingId: packId, packagingLabel: packId, sticker: true, bpom: true, halal: true, sample: true }],
  });
  Logger.log(res.view);
}
