/**
 * MaklonGo — penyimpan order ke Google Sheet (opsional).
 * Deploy sebagai Web App: Execute as "Me", Who has access "Anyone".
 * Set Script Property ADMIN_KEY (Project Settings → Script properties).
 */
const SHEET_NAME = "Orders";

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(["Waktu", "No Order", "Nama", "HP", "Email", "Kota", "Brand", "Jumlah SKU", "Total pcs", "Ringkasan", "Packed", "JSON"]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const data = JSON.parse(e.postData.contents);
    const o = data.order;
    if (!o || !o.id) return json_({ error: "invalid" });
    const sh = sheet_();
    const ids = sh.getRange(2, 2, Math.max(sh.getLastRow() - 1, 1), 1).getValues().flat();
    if (ids.indexOf(o.id) >= 0) return json_({ ok: true, duplicate: true });
    const pcs = o.items.reduce((s, x) => s + Number(x.qty || 0), 0);
    const ringkas = o.items.map((x, i) => `SKU${i + 1}: ${x.baseName || x.baseId} ${x.vol}${x.unit || ""} x${x.qty}`).join(" | ");
    sh.appendRow([new Date(o.createdAt), o.id, o.customer.name, "'" + o.customer.phone, o.customer.email, o.customer.city,
      o.customer.brand, o.items.length, pcs, ringkas, data.packed || "", JSON.stringify(o)]);
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  const key = PropertiesService.getScriptProperties().getProperty("ADMIN_KEY");
  if (!key || (e.parameter.key || "") !== key) return json_({ error: "unauthorized" });
  const sh = sheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return json_({ orders: [] });
  const rows = sh.getRange(2, 1, n, 12).getValues();
  const orders = rows.map((r) => ({ packed: r[10] || null, order: r[11] ? JSON.parse(r[11]) : null }));
  return json_({ orders });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
