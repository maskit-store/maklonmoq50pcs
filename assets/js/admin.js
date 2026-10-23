/* MaklonGo — dashboard admin */
(function () {
  const { C, CFG, IDX, esc, rupiah, fmtDate, store, toast } = window.MG;
  const { decryptPrices, encryptPrices, computeOrder } = window.MGP;

  const DEFAULT_SETTINGS = {
    moq: 50, activeDosePct: 1, activeScrapFactor: 1.35, packagingMarkup: 1.35,
    bpomLabPerSku: CFG.fees.bpomLabPerSku, halalPerSku: CFG.fees.halalPerSku, stickerPerPcs: 0,
    samplePerSku: CFG.fees.samplePerSku || 555000,
    roundPerPcs: 1, dpPercent: 50, invoiceDueDays: 7, invoiceBreakdown: false,
    signerName: "", signerTitle: "Direktur", courtCity: "",
    companyName: CFG.appName, companyAddress: "", companyPhone: CFG.adminWhatsApp, companyEmail: "",
    bankInfo: "Bank BCA 1234567890 a.n. Nama Perusahaan",
    invoiceNotes: "Harga belum termasuk ongkos kirim. Ongkos kirim dibayarkan saat produk sudah ready.\nPembayaran: DP 50% untuk memulai proses. Pelunasan sisa 50% + ongkos kirim dilakukan setelah nomor izin edar BPOM terbit.\nMoU terlampir wajib ditandatangani kedua pihak di atas meterai Rp 10.000 dan dikirim kembali ke WhatsApp admin.",
  };
  const STATUSES = [["baru", "Baru"], ["invoice", "Invoice terkirim"], ["dp", "DP diterima"], ["produksi", "Produksi"], ["selesai", "Selesai"], ["batal", "Batal"]];
  const STATUS_NAME = Object.fromEntries(STATUSES);

  const root = document.getElementById("admin");
  const modalRoot = document.getElementById("modalRoot");
  const A = { pw: null, prices: null, filePrices: null, cat: { bases: {}, actives: {}, packaging: {} }, dirty: false, sync: { state: "off" }, tab: "orders", q: "", status: "all", priceQ: "", openId: null, packLimit: 60 };

  // Logo untuk PDF (dimuat sekali sebagai data URL)
  let LOGO = null;
  fetch("assets/img/logo-pdf.jpg").then((r) => r.blob()).then((b) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }))
    .then((d) => { LOGO = d; }).catch(() => {});

  const getOrders = () => store.get("mg_orders", []);
  const setOrders = (o) => store.set("mg_orders", o);
  // Kunci admin Apps Script: yang disimpan di perangkat ini, atau password dashboard (jika ADMIN_KEY dibuat sama)
  const sheetCfg = () => { const s = store.get("mg_sheet", {}); return { endpoint: s.endpoint || CFG.orderEndpoint || "", key: s.key || A.pw || "" }; };

  /* ------------------------------------------------------------ login */
  function viewLogin(err) {
    root.innerHTML = `<div class="login card">
      <h2 style="margin-top:0">Masuk Admin</h2>
      <p class="muted small">Password dipakai untuk membuka data harga terenkripsi.</p>
      <form id="loginForm">
        <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required autofocus></div>
        ${err ? `<div class="notice" style="margin-bottom:12px;background:var(--danger-soft);border-color:#f6cdb8;color:var(--danger)">${esc(err)}</div>` : ""}
        <button class="btn btn-primary btn-block" id="btnLogin">Masuk</button>
      </form>
      ${location.hash.startsWith("#import=") ? '<p class="small notice green" style="margin-top:12px">Ada order baru dari link WhatsApp — masuk untuk menyimpannya.</p>' : ""}
    </div>`;
    document.getElementById("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("btnLogin");
      btn.disabled = true; btn.textContent = "Membuka…";
      try { await login(document.getElementById("pw").value); } catch (er) { viewLogin("Password salah atau file harga tidak bisa dibuka."); }
    });
  }

  async function login(pw) {
    const res = await fetch("data/prices.enc.json", { cache: "no-store" });
    const blob = await res.json();
    const filePrices = await decryptPrices(blob, pw);
    A.pw = pw;
    A.filePrices = filePrices;
    const local = store.get("mg_admin_prices", null);
    A.prices = local && local.version === filePrices.version ? local : structuredClone(filePrices);
    A.dirty = !!(local && local.version === filePrices.version);
    A.prices.settings = { ...DEFAULT_SETTINGS, ...A.prices.settings };
    fixPhone(A.prices.settings);
    try { sessionStorage.setItem("mg_pw", pw); } catch {}
    document.getElementById("btnLogout").classList.remove("hidden");
    await Promise.all([loadRemotePrices(), loadCatalog()]);
    handleImportHash();
    render();
    if (A.sync.state === "ok") syncSheet(true);
  }

  /* ------------------------------------------------------------ penyimpanan otomatis (Google Apps Script) */
  // Gabungkan harga dari Drive (terbaru) ke data file: item baru di file tetap ada, nilai dari Drive menang.
  function mergePrices(file, remote) {
    const out = structuredClone(file);
    ["bases", "actives", "packaging"].forEach((sec) => {
      out[sec] = out[sec] || {};
      Object.entries((remote && remote[sec]) || {}).forEach(([k, v]) => { out[sec][k] = out[sec][k] ? { ...out[sec][k], ...v } : v; });
    });
    out.settings = { ...DEFAULT_SETTINGS, ...file.settings, ...((remote && remote.settings) || {}) };
    fixPhone(out.settings);
    return out;
  }
  // Ganti nomor WA contoh lama dengan nomor admin dari config
  function fixPhone(st) {
    if (!st.companyPhone || st.companyPhone === "6281234567890") st.companyPhone = CFG.adminWhatsApp;
  }

  async function loadRemotePrices() {
    const { endpoint, key } = sheetCfg();
    if (!endpoint || !key) { A.sync = { state: "off" }; return; }
    try {
      const res = await fetch(`${endpoint}?action=prices&key=${encodeURIComponent(key)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error === "unauthorized" ? "ADMIN_KEY salah / belum diisi" : data.error);
      if (data.prices) {
        A.prices = mergePrices(A.filePrices, data.prices);
        store.set("mg_admin_prices", A.prices);
        A.dirty = false;
      } else {
        await pushPrices(); // belum pernah disimpan di Drive → simpan sekarang
      }
      A.sync = { state: "ok", at: data.savedAt || new Date().toISOString() };
    } catch (e) {
      A.sync = { state: "error", msg: e.message };
    }
  }

  async function post(body) {
    const { endpoint, key } = sheetCfg();
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ ...body, key }) });
    const data = await res.json();
    if (data.error) throw new Error(data.error === "unauthorized" ? "ADMIN_KEY salah / belum diisi"
      : data.error === "invalid order" ? "Apps Script belum versi terbaru — tempel ulang Code.gs lalu Deploy → New version" : data.error);
    return data;
  }

  /* ------------------------------------------------------------ katalog: tambah / edit / hapus (disimpan ke Google Drive) */
  async function loadCatalog() {
    const local = store.get("mg_admin_catalog", null);
    const { endpoint } = sheetCfg();
    const remote = endpoint ? await window.MG.fetchCatalog(endpoint) : null;
    A.catLoadFailed = !!endpoint && !remote;
    const size = (c) => (c ? ["bases", "actives", "packaging"].reduce((n, k) => n + Object.keys(c[k] || {}).length, 0) : 0);
    // Belum ada di Drive tapi ada perubahan lokal → pakai lokal lalu simpan ke Drive
    const useLocal = !remote || (!size(remote) && size(local));
    A.cat = { bases: {}, actives: {}, packaging: {}, ...((useLocal ? local : remote) || {}) };
    window.MG.applyCatalog(A.cat, true);
    if (remote && useLocal && size(local)) pushCatalog();
  }

  async function pushCatalog() {
    const { endpoint, key } = sheetCfg();
    if (!endpoint || !key) { A.dirty = true; A.sync = { state: "off" }; return renderSync(); }
    A.sync = { state: "saving" }; renderSync();
    try {
      if (A.catLoadFailed) {
        // Katalog di Drive belum terbaca → ambil dulu agar perubahan lain tidak tertimpa
        const remote = await window.MG.fetchCatalog(endpoint);
        if (!remote) throw new Error("katalog di Google Drive belum bisa dibaca (Apps Script versi lama?)");
        ["bases", "actives", "packaging"].forEach((k) => { A.cat[k] = { ...(remote[k] || {}), ...(A.cat[k] || {}) }; });
        A.catLoadFailed = false;
        store.set("mg_admin_catalog", A.cat); window.MG.applyCatalog(A.cat, true);
      }
      const d = await post({ action: "saveCatalog", catalog: A.cat });
      A.sync = { state: "ok", at: d.saved };
    } catch (e) { A.sync = { state: "error", msg: e.message }; }
    renderSync();
  }
  let catTimer;
  function saveCatalog() {
    store.set("mg_admin_catalog", A.cat);
    window.MG.applyCatalog(A.cat, true);
    clearTimeout(catTimer); catTimer = setTimeout(pushCatalog, 600);
  }

  const SEC_NAME = { bases: "base", actives: "bahan aktif", packaging: "kemasan" };
  function putItem(sec, item) {
    const orig = window.MG.originalItem(sec, item.id);
    if (orig && JSON.stringify(orig) === JSON.stringify(item)) delete A.cat[sec][item.id];
    else A.cat[sec][item.id] = item;
    saveCatalog();
  }
  function deleteItem(sec, id) {
    const it = IDX[sec][id];
    if (!it || !confirm(`Hapus ${SEC_NAME[sec]} "${it.name}"?\nItem tidak tampil lagi di web customer. Order lama tetap terbaca & item bisa dipulihkan.`)) return;
    A.cat[sec][id] = { ...it, deleted: true };
    saveCatalog(); render(); toast(`${it.name} dihapus`);
  }
  function restoreItem(sec, id) {
    const it = { ...IDX[sec][id] };
    delete it.deleted;
    putItem(sec, it); render(); toast(`${it.name} dipulihkan`);
  }
  // Tanda kecil di daftar: ditambah admin / diedit / dihapus
  function itemTags(sec, x) {
    if (x.deleted) return '<span class="tag red">Dihapus</span>';
    if (!window.MG.isOriginal(sec, x.id)) return '<span class="tag yellow">Ditambah admin</span>';
    if (A.cat[sec][x.id]) return '<span class="tag green">Diedit</span>';
    return "";
  }
  function itemActions(sec, x) {
    return x.deleted ? `<button class="btn btn-ghost btn-sm" data-restore="${sec}:${esc(x.id)}">Pulihkan</button>`
      : `<div class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn btn-ghost btn-sm" data-edititem="${sec}:${esc(x.id)}">Edit</button><button class="btn btn-ghost btn-sm danger" data-delitem="${sec}:${esc(x.id)}">Hapus</button></div>`;
  }
  function nextId(prefix, list) {
    const n = list.reduce((m, x) => { const k = String(x.id).match(new RegExp("^" + prefix + "(\\d+)$")); return k ? Math.max(m, +k[1]) : m; }, 0);
    return prefix + String(n + 1).padStart(2, "0");
  }

  // Form modal sederhana. fields: [{k, label, type, opts, req, hint, ph}]
  function formModal(title, fields, vals, onSave, extraHtml = "") {
    const f = (x) => {
      const v = vals[x.k] ?? "";
      const lab = `<label for="ff-${x.k}">${x.label}${x.req ? ' <span class="req">*</span>' : ""}</label>`;
      const hint = x.hint ? `<div class="hint">${x.hint}</div>` : "";
      if (x.type === "select") return `<div class="field">${lab}<select id="ff-${x.k}">${x.opts.map(([o, n]) => `<option value="${esc(o)}" ${String(v) === String(o) ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>${hint}</div>`;
      if (x.type === "textarea") return `<div class="field">${lab}<textarea id="ff-${x.k}" placeholder="${esc(x.ph || "")}">${esc(v)}</textarea>${hint}</div>`;
      if (x.type === "checks") return `<div class="field"><label>${x.label}${x.req ? ' <span class="req">*</span>' : ""}</label><div class="chips" style="margin:0">${x.opts.map(([o, n]) => `<label class="chip ${(v || []).includes(o) ? "active" : ""}"><input type="checkbox" data-ffcheck="${x.k}" value="${esc(o)}" ${(v || []).includes(o) ? "checked" : ""} hidden>${esc(n)}</label>`).join("")}</div>${hint}</div>`;
      if (x.type === "checkbox") return `<label class="checkrow" style="margin-bottom:14px"><input type="checkbox" id="ff-${x.k}" ${v ? "checked" : ""}><span><b>${x.label}</b>${x.hint ? `<span class="small muted">${x.hint}</span>` : ""}</span></label>`;
      return `<div class="field">${lab}<input id="ff-${x.k}" type="${x.type || "text"}" ${x.type === "number" ? 'step="any" inputmode="decimal"' : ""} value="${esc(v)}" placeholder="${esc(x.ph || "")}">${hint}</div>`;
    };
    modalRoot.innerHTML = `<div class="modal-bg" data-close><div class="modal" style="max-width:640px">
      <h3 style="margin-top:0">${esc(title)}</h3>
      <form id="itemForm" novalidate>
        ${extraHtml}
        <div class="grid-2 form-2">${fields.map(f).join("")}</div>
        <div class="err small hidden" id="ffErr" style="color:var(--danger);margin-bottom:10px"></div>
        <div class="row"><button class="btn btn-primary" id="ffSave">Simpan</button><button type="button" class="btn btn-ghost" data-close>Batal</button></div>
      </form></div></div>`;
    document.getElementById("itemForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const out = {};
      fields.forEach((x) => {
        if (x.type === "checks") out[x.k] = [...modalRoot.querySelectorAll(`[data-ffcheck="${x.k}"]:checked`)].map((c) => c.value);
        else if (x.type === "checkbox") out[x.k] = document.getElementById("ff-" + x.k).checked;
        else { const el = document.getElementById("ff-" + x.k); out[x.k] = x.type === "number" ? (el.value === "" ? null : Number(el.value)) : el.value.trim(); }
      });
      const miss = fields.filter((x) => x.req && (out[x.k] === null || out[x.k] === "" || (Array.isArray(out[x.k]) && !out[x.k].length)));
      const errEl = document.getElementById("ffErr");
      const showErr = (m) => { errEl.textContent = m; errEl.classList.remove("hidden"); };
      if (miss.length) return showErr("Wajib diisi: " + miss.map((x) => x.label.replace(/<[^>]+>/g, "").replace(/\s*\(.*$/, "")).join(", "));
      const btn = document.getElementById("ffSave");
      btn.disabled = true; btn.textContent = "Menyimpan…";
      try {
        const err = await onSave(out);
        if (err) { btn.disabled = false; btn.textContent = "Simpan"; return showErr(err); }
        modalRoot.innerHTML = ""; render();
      } catch (er) { btn.disabled = false; btn.textContent = "Simpan"; showErr(er.message); }
    });
  }

  const splitList = (s) => String(s || "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  const unitOpts = [["ml", "ml"], ["g", "g"]];

  function editBase(id) {
    const b = id ? IDX.bases[id] : null;
    const p = (id && A.prices.bases[id]) || {};
    const vals = b ? { ...b, actives: (b.actives || []).join(", "), variants: (b.variants || []).map((v) => v.name + (v.actives && v.actives.length ? ": " + v.actives.join(", ") : "")).join("\n"),
      price: p.price, priceAwal: p.priceAwal, vol: p.vol ?? b.vol, unit: p.unit || b.unit, shopee: p.shopee || "" } : { cat: "face", unit: "ml" };
    formModal(b ? `Edit base · ${b.id}` : "Tambah base baru", [
      { k: "name", label: "Nama base", req: true, ph: "Contoh: Brightening Face Serum" },
      { k: "cat", label: "Kategori", type: "select", opts: C.baseCategories.map((c) => [c.id, c.name]) },
      { k: "form", label: "Bentuk sediaan", ph: "Serum / Toner / Cream / Body Wash…" },
      { k: "aroma", label: "Aroma", ph: "Tanpa parfum / Floral…" },
      { k: "vol", label: "Volume asli (sesuai harga)", type: "number", req: true },
      { k: "unit", label: "Satuan", type: "select", opts: unitOpts },
      { k: "price", label: "Harga diskon (Rp) untuk volume asli", type: "number", req: true, hint: "Harga per pcs = harga ÷ volume asli × volume pesanan" },
      { k: "priceAwal", label: "Harga awal (Rp, opsional)", type: "number" },
      { k: "desc", label: "Deskripsi untuk customer", type: "textarea" },
      { k: "actives", label: "Sudah mengandung (pisahkan koma)", type: "textarea", ph: "Niacinamide, Panthenol, Aloe Vera" },
      { k: "variants", label: "Varian (opsional, satu per baris)", type: "textarea", ph: "Brightening\nCalming: Centella, Mugwort", hint: "Format: Nama varian atau Nama varian: bahan aktif tambahan varian" },
      { k: "shopee", label: "Kode / catatan supplier (opsional, hanya admin)" },
    ], vals, (v) => {
      if (!(v.vol > 0)) return "Volume asli harus lebih dari 0";
      const nid = id || nextId("B", C.bases);
      const variants = v.variants.split("\n").map((x) => x.trim()).filter(Boolean).map((line) => {
        const i = line.indexOf(":");
        const name = (i >= 0 ? line.slice(0, i) : line).trim();
        const a = i >= 0 ? splitList(line.slice(i + 1)) : [];
        return a.length ? { name, actives: a } : { name };
      });
      const item = { id: nid, name: v.name, cat: v.cat, form: v.form, unit: v.unit, vol: v.vol, desc: v.desc, actives: splitList(v.actives) };
      if (variants.length) item.variants = variants;
      if (v.aroma) item.aroma = v.aroma;
      A.prices.bases[nid] = { ...(A.prices.bases[nid] || {}), price: v.price, priceAwal: v.priceAwal ?? v.price, vol: v.vol, unit: v.unit, shopee: v.shopee };
      putItem("bases", item); savePrices();
      toast(id ? "Base diperbarui ✓" : `Base ${nid} ditambahkan ✓`);
    });
  }

  function editActive(id) {
    const a = id ? IDX.actives[id] : null;
    const p = (id && A.prices.actives[id]) || {};
    const vals = a ? { name: a.name, cats: a.cats, pricekg: p.pricePerGram != null ? Math.round(p.pricePerGram * 1000) : null,
      kode: (p.source || {}).kode, supplier: (p.source || {}).supplier } : { cats: [] };
    formModal(a ? `Edit bahan aktif · ${a.id}` : "Tambah bahan aktif baru", [
      { k: "name", label: "Nama bahan aktif", req: true, ph: "Contoh: Alpha Arbutin" },
      { k: "pricekg", label: "Harga per kg (Rp)", type: "number", req: true, hint: "Per pcs = harga/gram × (volume × dosis%) × scrap factor" },
      { k: "kode", label: "Kode bahan (opsional)" },
      { k: "supplier", label: "Supplier (opsional)" },
      { k: "cats", label: "Kategori manfaat (bisa lebih dari satu)", type: "checks", req: true, opts: C.activeCategories.map((c) => [c.id, c.name]) },
    ], vals, (v) => {
      const nid = id || nextId("A", C.actives);
      const ppg = v.pricekg / 1000;
      const old = A.prices.actives[nid];
      const src = { kode: v.kode || "MANUAL", nama: v.name, supplier: v.supplier || "", pricePerGram: ppg };
      if (old && old.source && old.source.kode === src.kode) {
        // Sumber sama → perbarui harga & data sumber yang dipilih
        const alts = (old.alternatives || []).map((x) => (x.kode === src.kode ? { ...x, ...src } : x));
        A.prices.actives[nid] = { ...old, pricePerGram: ppg, source: { ...old.source, ...src }, alternatives: alts };
      } else {
        const alts = [...((old && old.alternatives) || []).filter((x) => x.kode !== src.kode), src];
        A.prices.actives[nid] = { ...(old || {}), pricePerGram: ppg, source: src, alternatives: alts };
      }
      putItem("actives", { id: nid, name: v.name, cats: v.cats }); savePrices();
      toast(id ? "Bahan aktif diperbarui ✓" : `Bahan aktif ${nid} ditambahkan ✓`);
    });
  }

  // Perkecil foto sebelum upload (maks 800 px, JPEG)
  function resizeImage(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 800 / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
        cx.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(img.src);
        res(cv.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => rej(new Error("File gambar tidak bisa dibaca"));
      img.src = URL.createObjectURL(file);
    });
  }

  function editPack(id) {
    const p = id ? IDX.packaging[id] : null;
    const pp = (id && A.prices.packaging[id]) || {};
    const vals = p ? { ...p, vol: p.vol ?? null, filePrice: pp.filePrice ?? null, img: p.img || "" } : { type: "botol", unit: "ml", new: true };
    let upload = null;
    const imgBox = `<div class="field"><label>Foto kemasan</label>
      <div class="row" style="align-items:center;flex-wrap:nowrap">
        <img id="ffPreview" class="thumb" style="width:84px;height:84px" src="${esc(vals.img || "assets/img/logo-sm.png")}" alt="">
        <div style="flex:1"><label class="btn btn-ghost btn-sm">Pilih foto…<input type="file" accept="image/*" id="ffFile" hidden></label>
        <div class="hint">Foto disimpan ke Google Drive (folder "MaklonGo - foto kemasan"). Atau isi URL gambar di bawah.</div></div>
      </div></div>`;
    formModal(p ? `Edit kemasan · ${p.code}` : "Tambah kemasan baru", [
      { k: "code", label: "Kode kemasan", req: true, ph: "Contoh: MP0200" },
      { k: "name", label: "Nama kemasan", req: true, ph: "Botol Pump Amber" },
      { k: "type", label: "Jenis", type: "select", opts: C.packagingTypes.map((t) => [t.id, t.name]) },
      { k: "variasi", label: "Variasi / warna", ph: "Tutup hitam, doff…" },
      { k: "vol", label: "Volume", type: "number", hint: "Kosongkan untuk aksesoris (tutup, pump). Customer hanya bisa memilih kemasan yang volumenya sama dengan volume produk." },
      { k: "unit", label: "Satuan", type: "select", opts: unitOpts },
      { k: "volLabel", label: "Label volume (opsional)", ph: "Contoh: 8-10" },
      { k: "filePrice", label: "Harga supplier / diskon (Rp)", type: "number", req: true, hint: `Harga jual otomatis = harga supplier × ${A.prices.settings.packagingMarkup}` },
      { k: "img", label: "URL gambar (opsional)", ph: "https://…" },
      { k: "new", label: "Tandai sebagai kemasan baru", type: "checkbox", hint: "Muncul di filter ✨ Katalog baru" },
    ], vals, async (v) => {
      const code = v.code.toUpperCase();
      if (C.packaging.some((x) => x.code.toUpperCase() === code && x.id !== id)) return `Kode ${code} sudah dipakai`;
      if (v.vol !== null && !(v.vol > 0)) return "Volume harus lebih dari 0 (atau kosongkan untuk aksesoris)";
      let img = v.img;
      if (upload) {
        const { endpoint, key } = sheetCfg();
        if (!endpoint || !key) return "Upload foto butuh koneksi Google Drive (Pengaturan → Google Drive). Atau isi URL gambar.";
        const d = await post({ action: "uploadImage", name: `${code}.jpg`, dataUrl: upload });
        img = d.url;
      }
      let nid = id || code;
      if (!id) { let k = 2; while (IDX.packaging[nid]) nid = `${code}-${k++}`; }
      const item = { ...(p || {}), id: nid, code, name: v.name, variasi: v.variasi || "-", vol: v.vol, unit: v.vol ? v.unit : null, type: v.type, img: img || "" };
      if (v.volLabel) item.volLabel = v.volLabel; else delete item.volLabel;
      if (v.new) item.new = true; else delete item.new;
      delete item.deleted;
      A.prices.packaging[nid] = { ...(A.prices.packaging[nid] || {}), filePrice: v.filePrice, price: Math.round(v.filePrice * A.prices.settings.packagingMarkup) };
      putItem("packaging", item); savePrices();
      toast(id ? "Kemasan diperbarui ✓" : `Kemasan ${code} ditambahkan ✓`);
    }, imgBox);
    document.getElementById("ffFile").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { upload = await resizeImage(f); document.getElementById("ffPreview").src = upload; } catch (er) { toast(er.message); }
    });
  }

  async function pushPrices() {
    const { endpoint, key } = sheetCfg();
    if (!endpoint || !key) { A.sync = { state: "off" }; return renderSync(); }
    A.sync = { state: "saving" }; renderSync();
    try {
      const d = await post({ action: "syncPrices", prices: A.prices });
      A.dirty = false;
      A.sync = { state: "ok", at: d.synced };
    } catch (e) { A.sync = { state: "error", msg: e.message }; }
    renderSync();
  }

  let pricesTimer;
  function schedulePushPrices() { clearTimeout(pricesTimer); pricesTimer = setTimeout(pushPrices, 800); }

  const orderTimers = {};
  function schedulePushOrder(id) {
    clearTimeout(orderTimers[id]);
    orderTimers[id] = setTimeout(async () => {
      const { endpoint, key } = sheetCfg();
      const o = getOrders().find((x) => x.id === id);
      if (!o || !endpoint || !key) return;
      try { await post({ action: "saveOrder", id, adj: o.adj || {}, status: o.status, updatedAt: o.updatedAt }); }
      catch (e) { if (!/not found/.test(e.message)) toast("Perubahan order belum tersimpan ke Google Sheet: " + e.message, 4000); }
    }, 900);
  }

  function syncStatusHtml() {
    const t = (iso) => { try { return new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
    switch (A.sync.state) {
      case "ok": return `<span class="small muted">☁ Harga, katalog & pengaturan tersimpan otomatis ke Google Drive${A.sync.at ? " · " + t(A.sync.at) : ""}</span>`;
      case "saving": return `<span class="small muted">☁ Menyimpan…</span>`;
      case "error": return `<div class="notice" style="background:var(--danger-soft);border-color:#f6cdb8;color:var(--danger)">Gagal menyimpan otomatis: ${esc(A.sync.msg)}.
        <button class="link-btn" data-act="retrySync">Coba lagi</button> · cek URL & ADMIN_KEY di tab Pengaturan.</div>`;
      default: return A.dirty ? `<div class="notice">Perubahan baru tersimpan di browser ini. Isi URL & ADMIN_KEY di <b>Pengaturan → Google Drive</b> agar tersimpan otomatis untuk semua perangkat.</div>` : "";
    }
  }
  function renderSync() { const el = document.getElementById("syncStatus"); if (el) el.innerHTML = syncStatusHtml(); }

  function logout() {
    try { sessionStorage.removeItem("mg_pw"); } catch {}
    location.reload();
  }

  /* ------------------------------------------------------------ orders store */
  function upsertOrders(list, silent) {
    const orders = getOrders();
    let added = 0;
    list.forEach((o) => {
      if (!o || !o.id) return;
      if (orders.some((x) => x.id === o.id)) return;
      orders.unshift({ ...o, status: o.status || "baru", adj: o.adj || {}, importedAt: new Date().toISOString() });
      added++;
    });
    orders.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    setOrders(orders);
    if (!silent) toast(added ? `${added} order baru tersimpan` : "Order sudah ada di dashboard");
    return added;
  }

  function handleImportHash() {
    const m = location.hash.match(/#import=(.+)$/);
    if (!m) return;
    try {
      const o = window.MG.unpackOrder(m[1]);
      upsertOrders([o]);
      A.openId = o.id;
    } catch (e) { toast("Link order tidak valid"); }
    history.replaceState(null, "", location.pathname);
  }

  /* Baca pesan WhatsApp order biasa (tanpa link admin) → data order. Cocokkan nama base / bahan aktif / kode kemasan ke katalog. */
  const BULAN = { jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5, jul: 6, agu: 7, agt: 7, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11 };
  function parseOrderText(txt) {
    // Bersihkan karakter tak terlihat dari WhatsApp, lalu pastikan tiap label ada di baris sendiri (jika baris tergabung saat disalin)
    const LABELS = "No\\. Order|Tanggal|Nama Brand|Catatan Brand|Nama|HP\\/WA|Email|Kota|Catatan kemasan|Catatan|SKU\\s*\\d+|Base|Sudah mengandung|Volume|Bahan aktif tambahan|Request bahan aktif lain|Kemasan|Sticker|Request sample|Total";
    const clean = txt.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, "").replace(/\u00A0/g, " ")
      .replace(new RegExp("([^\\n])\\s*(?:[*•·◦‣▪●\\-–]\\s*)?(?=(?:" + LABELS + ")\\s*(?:\\([^)]*\\))?\\s*:)", "g"), "$1\n");
    const lines = clean.split(/\r?\n|\r/).map((l) => l.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[*_\s]+$/, "").trim()).filter(Boolean);
    const val = (re) => { const l = lines.find((x) => re.test(x)); return l ? l.replace(re, "").trim() : ""; };
    const id = (txt.match(/MG-\d{6}-[A-Z0-9]{5}/) || [])[0];
    if (!id) return null;
    let createdAt = new Date().toISOString();
    const dm = val(/^Tanggal\s*:/i).match(/(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})(?:[,\s]+(\d{1,2})[.:](\d{2}))?/);
    if (dm && BULAN[dm[2].toLowerCase()] !== undefined) createdAt = new Date(+dm[3], BULAN[dm[2].toLowerCase()], +dm[1], +(dm[4] || 0), +(dm[5] || 0)).toISOString();
    const customer = { name: val(/^Nama\s*:/i), phone: val(/^HP\/WA\s*:/i), email: val(/^Email\s*:/i), city: val(/^Kota\s*:/i),
      brand: val(/^Nama Brand\s*:/i), brandNote: val(/^Catatan Brand\s*:/i), notes: val(/^Catatan\s*:/i) };
    const norm = (x) => String(x || "").toLowerCase().replace(/\s+/g, " ").trim();
    const items = [];
    let it = null;
    lines.forEach((l) => {
      let m;
      if ((m = l.match(/^SKU\s*\d+\s*:?\s*(.*)$/i))) {
        it = { baseId: "", variant: "", vol: 0, qty: 0, unit: "ml", actives: [], customActives: "", packagingId: null, noPackaging: true, packagingNote: "",
          productName: m[1].trim(), sticker: false, bpom: false, halal: false, sample: false };
        items.push(it); return;
      }
      if (!it) return;
      if ((m = l.match(/^Base\s*:\s*(.+)$/i))) {
        const s = norm(m[1]);
        const b = [...C.bases].sort((x, y) => y.name.length - x.name.length).find((x) => s === norm(x.name) || s.startsWith(norm(x.name) + " ("));
        if (b) {
          it.baseId = b.id; it.unit = b.unit;
          const rest = m[1].trim().slice(b.name.length).trim();
          it.variant = rest.replace(/^\(/, "").replace(/\)$/, "").trim();
        } else { it.baseId = m[1].trim(); it.baseName = m[1].trim(); }
      } else if ((m = l.match(/^Volume\s*:\s*([\d.,]+)\s*(\w+)?.*Jumlah\s*:\s*(\d+)/i))) {
        it.vol = Number(m[1].replace(",", ".")); if (m[2]) it.unit = m[2]; it.qty = Number(m[3]);
      } else if ((m = l.match(/^Bahan aktif tambahan[^:]*:\s*(.*)$/i))) {
        const unknown = [];
        m[1].split(",").map((x) => x.trim()).filter((x) => x && x !== "-").forEach((n) => {
          const a = C.actives.find((x) => norm(x.name) === norm(n));
          if (a) it.actives.push(a.id); else unknown.push(n);
        });
        if (unknown.length) it.customActives = [it.customActives, unknown.join(", ")].filter(Boolean).join("; ");
      } else if ((m = l.match(/^Request bahan aktif lain\s*:\s*(.*)$/i))) {
        it.customActives = [it.customActives, m[1].trim()].filter(Boolean).join("; ");
      } else if ((m = l.match(/^Kemasan\s*:\s*(.*)$/i))) {
        if (!/^Tidak ada pilihan kemasan/i.test(m[1])) {
          const code = m[1].split("·")[0].trim();
          const p = IDX.packaging[code] || C.packaging.find((x) => norm(x.code) === norm(code));
          if (p) { it.packagingId = p.id; it.noPackaging = false; } else it.packagingNote = "Kemasan dari pesan: " + m[1].trim();
        }
      } else if ((m = l.match(/^Catatan kemasan\s*:\s*(.*)$/i))) {
        it.packagingNote = [it.packagingNote, m[1].trim()].filter(Boolean).join(" — ");
      } else if (/^Sticker\s*:/i.test(l)) {
        const yes = (k) => new RegExp(k + "[^:|]*:\\s*(Ya|✓|✅)", "i").test(l);
        it.sticker = yes("Sticker"); it.bpom = yes("BPOM"); it.halal = yes("Halal");
      } else if ((m = l.match(/^Request sample\s*:\s*(\S+)/i))) {
        it.sample = /^(Ya|✓|✅)/i.test(m[1]);
      }
    });
    if (!items.length) return null;
    return { id, createdAt, catalogVersion: C.version, customer, items, source: "wa-text" };
  }

  // Catat order hasil import ke Google Sheet (+ invoice PDF otomatis). Duplikat diabaikan oleh Apps Script.
  async function recordToSheet(o) {
    const { endpoint, key } = sheetCfg();
    if (!endpoint) return;
    try {
      // replace: baris & invoice PDF di Sheet diperbarui jika nomor order sudah ada (butuh ADMIN_KEY)
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ order: window.MG.enrichOrder(o), packed: window.MG.packOrder(o), replace: true, key }) });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      if (d.duplicate) return toast(`${o.id} sudah ada di Google Sheet dengan data lama. Perbarui Apps Script (Deploy → New version) lalu import lagi agar baris & PDF ikut diperbarui.`, 7000);
      if (d.pdf) { setOrders(getOrders().map((x) => (x.id === o.id ? { ...x, pdfUrl: d.pdf } : x))); if (A.openId === o.id) openOrder(o.id); }
      toast(d.replaced ? `${o.id} diperbarui di Google Sheet + invoice PDF baru dibuat ✓` : `${o.id} dicatat ke Google Sheet + invoice PDF dibuat ✓`, 4000);
    } catch (e) { toast(`${o.id} belum tercatat ke Google Sheet: ${e.message}`, 4500); }
  }

  function importText(text) {
    const found = [...String(text).matchAll(/#import=([A-Za-z0-9+\-$]+)/g)].map((m) => m[1]);
    const list = [];
    found.forEach((s) => { try { list.push(window.MG.unpackOrder(s)); } catch {} });
    // Pesan WA biasa (tanpa link admin): bisa beberapa pesan sekaligus
    const parsed = [];
    if (!list.length) String(text).split(/(?=ORDER MAKLON)/i).forEach((chunk) => { const o = parseOrderText(chunk); if (o) parsed.push(o); });
    if (!list.length && !parsed.length) return toast("Tidak ada order yang bisa dibaca. Pastikan menempel seluruh pesan, termasuk No. Order.");
    upsertOrders(list);
    // Pesan WA: order dengan nomor sama ditimpa (mis. hasil import sebelumnya keliru); status & penyesuaian harga tetap
    if (parsed.length) {
      const orders = getOrders();
      parsed.forEach((o) => {
        const i = orders.findIndex((x) => x.id === o.id);
        if (i < 0) orders.unshift({ ...o, status: "baru", adj: {}, importedAt: new Date().toISOString() });
        else orders[i] = { ...orders[i], customer: o.customer, items: o.items, createdAt: o.createdAt, source: o.source, pdfUrl: undefined, updatedAt: new Date().toISOString() };
      });
      orders.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      setOrders(orders);
      toast(`${parsed.length} order dari pesan WA tersimpan`);
    }
    const bad = parsed.filter((o) => o.items.some((x) => !IDX.bases[x.baseId]));
    if (bad.length) toast("Perhatian: ada base yang tidak dikenali — cek detail order.", 4500);
    render();
    parsed.forEach((o) => recordToSheet(getOrders().find((x) => x.id === o.id) || o));
    if (parsed.length === 1) openOrder(parsed[0].id);
  }

  async function syncSheet(silent) {
    const { endpoint, key } = sheetCfg();
    if (!endpoint) return toast("Isi URL Google Apps Script di tab Pengaturan");
    try {
      const res = await fetch(`${endpoint}?key=${encodeURIComponent(key)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const remote = (data.orders || []).map((r) => { try { const o = r.order || window.MG.unpackOrder(r.packed); if (o && r.pdf) o.pdfUrl = r.pdf; return o; } catch { return null; } }).filter(Boolean);
      const added = upsertOrders(remote, true);
      // Order yang sudah ada: ambil link PDF, status & penyesuaian harga terbaru dari Sheet
      const byId = Object.fromEntries(remote.map((o) => [o.id, o]));
      setOrders(getOrders().map((o) => {
        const r = byId[o.id];
        if (!r) return o;
        const n = { ...o, pdfUrl: o.pdfUrl || r.pdfUrl };
        if (r.updatedAt && (!o.updatedAt || r.updatedAt > o.updatedAt)) Object.assign(n, { adj: r.adj || {}, status: r.status || o.status, updatedAt: r.updatedAt });
        return n;
      }));
      if (!silent) toast(added ? `${added} order baru dari Google Sheet` : "Data order sudah terbaru");
      render();
    } catch (e) { if (!silent) toast("Gagal sinkron: " + e.message); }
  }

  async function syncPricesToDrive() {
    const { endpoint, key } = sheetCfg();
    if (!endpoint || !key) return toast("Isi URL Apps Script & ADMIN_KEY lalu klik Simpan dulu");
    await pushPrices();
    toast(A.sync.state === "ok" ? "Harga & pengaturan tersimpan ke Google Drive ✓" : "Gagal: " + (A.sync.msg || ""), 4000);
  }

  /* ------------------------------------------------------------ prices store */
  function savePrices() {
    A.dirty = true;
    store.set("mg_admin_prices", A.prices);
    schedulePushPrices();
  }

  async function exportEncrypted(pw) {
    const blob = await encryptPrices(A.prices, pw || A.pw);
    download("prices.enc.json", JSON.stringify(blob), "application/json");
  }

  function download(name, content, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ------------------------------------------------------------ render */
  function render() {
    if (!A.prices) return viewLogin();
    const tabs = [["orders", "Pesanan"], ["bases", "Harga Base"], ["actives", "Bahan Aktif"], ["packaging", "Kemasan"], ["settings", "Pengaturan"]];
    root.innerHTML = `
      <div id="syncStatus" style="margin-top:10px">${syncStatusHtml()}</div>
      <div class="tabs">${tabs.map(([id, n]) => `<button class="tab ${A.tab === id ? "active" : ""}" data-tab="${id}">${n}</button>`).join("")}</div>
      <div id="tabBody">${({ orders: viewOrders, bases: viewBases, actives: viewActives, packaging: viewPackaging, settings: viewSettings })[A.tab]()}</div>`;
    if (A.openId) openOrder(A.openId);
  }

  function orderTotal(o) { try { return computeOrder(o, A.prices).total; } catch { return 0; } }

  function viewOrders() {
    const orders = getOrders();
    const q = A.q.toLowerCase();
    const list = orders.filter((o) => (A.status === "all" || o.status === A.status) &&
      (!q || `${o.id} ${o.customer.name} ${o.customer.brand} ${o.customer.city} ${o.customer.phone}`.toLowerCase().includes(q)));
    const sum = orders.filter((o) => o.status !== "batal").reduce((s, o) => s + orderTotal(o), 0);
    const { endpoint } = sheetCfg();
    return `
      <div class="stats">
        <div class="stat"><div class="v">${orders.length}</div><div class="l">Total order</div></div>
        <div class="stat"><div class="v">${orders.filter((o) => o.status === "baru").length}</div><div class="l">Order baru</div></div>
        <div class="stat"><div class="v">${orders.reduce((s, o) => s + o.items.length, 0)}</div><div class="l">Total SKU</div></div>
        <div class="stat"><div class="v" style="font-size:17px">${rupiah(sum)}</div><div class="l">Nilai order (non-batal)</div></div>
      </div>
      <div class="row between" style="margin-bottom:10px">
        <div class="row" style="flex:1;min-width:240px">
          <input class="input" id="orderQ" placeholder="Cari no. order, nama, brand, kota…" value="${esc(A.q)}" style="flex:1;min-width:180px">
          <select class="input" id="orderStatus" style="width:auto">${[["all", "Semua status"], ...STATUSES].map(([v, n]) => `<option value="${v}" ${A.status === v ? "selected" : ""}>${n}</option>`).join("")}</select>
        </div>
        <div class="row">
          ${endpoint ? '<button class="btn btn-primary btn-sm" data-act="sync">⟳ Sinkron Google Sheet</button>' : ""}
          <button class="btn btn-ghost btn-sm" data-act="import">+ Import dari WA</button>
          <button class="btn btn-ghost btn-sm" data-act="csv">Export CSV</button>
        </div>
      </div>
      <div class="list">${list.map((o) => `
        <div class="order-row" data-open="${esc(o.id)}">
          <div><div class="id">${esc(o.id)} <span class="status ${o.status}">${STATUS_NAME[o.status] || o.status}</span></div>
            <div class="meta">${esc(o.customer.name)} · ${esc(o.customer.brand)} · ${esc(o.customer.city)}</div>
            <div class="meta">${fmtDate(o.createdAt)} · ${o.items.length} SKU · ${o.items.reduce((s, x) => s + Number(x.qty), 0)} pcs</div></div>
          <div class="amt">${rupiah(orderTotal(o))}</div>
        </div>`).join("") || `<div class="card muted">Belum ada order. Order masuk otomatis saat admin membuka link di pesan WhatsApp customer${endpoint ? " atau saat sinkron Google Sheet" : ""}. Bisa juga tempel pesan WA lewat tombol <b>Import dari WA</b>.</div>`}</div>`;
  }

  /* ------------------------------------------------------------ order detail */
  function openOrder(id) {
    A.openId = id;
    const orders = getOrders();
    const o = orders.find((x) => x.id === id);
    if (!o) { A.openId = null; return; }
    const calc = computeOrder(o, A.prices);
    const adj = o.adj || {};
    const c = o.customer;
    const skuHtml = o.items.map((it, i) => {
      const b = IDX.bases[it.baseId];
      const s = calc.skus[i];
      const ia = (adj.items || [])[i] || {};
      const lineLabel = (l) => {
        if (l.key === "base") return `<b>Base</b><br><span class="muted small">${esc(b ? b.name : it.baseId)}${it.variant ? " (" + esc(it.variant) + ")" : ""} · ${A.prices.bases[it.baseId] ? `${rupiah(A.prices.bases[it.baseId].price)} / ${A.prices.bases[it.baseId].vol} ${A.prices.bases[it.baseId].unit}` : "harga belum ada"}</span>`;
        if (l.activeId) return `<b>${esc((IDX.actives[l.activeId] || {}).name || l.activeId)}</b><br><span class="muted small">${A.prices.settings.activeDosePct}% × ${it.vol} ${it.unit || "ml"} × ${A.prices.settings.activeScrapFactor}</span>`;
        if (l.key === "custom") return `<b>Request bahan aktif</b><br><span class="muted small">${esc(it.customActives)} — isi harga manual</span>`;
        if (l.key === "pack") return `<b>Kemasan</b><br><span class="muted small">${esc(window.MG.packagingLabel(it))}${it.packagingNote ? " — " + esc(it.packagingNote) : ""}</span>`;
        if (l.key === "sticker") return `<b>Sticker</b>`;
        return esc(l.label);
      };
      return `<div class="card" style="margin-bottom:12px">
        <div class="row between"><h3 style="margin:0">SKU ${i + 1}: ${esc(it.productName || (b ? b.name : it.baseId))}</h3><span class="muted small">${it.vol} ${it.unit || (b && b.unit) || "ml"}</span></div>
        ${b ? `<p class="small muted" style="margin:6px 0 10px">Base sudah mengandung: ${esc(window.MG.baseActives(b, it.variant).join(", ") || "-")}</p>` : ""}
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Komponen</th><th class="num">Otomatis / pcs</th><th class="num">Harga / pcs</th></tr></thead>
          <tbody>${s.lines.map((l) => `<tr><td>${lineLabel(l)} ${l.missing ? '<span class="flag">• cek harga</span>' : ""}</td>
            <td class="num">${rupiah(l.auto)}</td>
            <td class="num"><input class="inp ${Math.round(l.value) !== Math.round(l.auto) ? "changed" : ""}" type="number" inputmode="decimal" data-adj="${i}" data-key="${l.key}" value="${Math.round(l.value * 100) / 100}"></td></tr>`).join("")}
          </tbody>
          <tfoot>
            <tr><td>Harga per pcs ${s.unit !== Math.round(s.rawUnit) ? `<span class="muted small">(dibulatkan dari ${rupiah(s.rawUnit)})</span>` : ""}</td><td></td><td class="num">${rupiah(s.unit)}</td></tr>
            <tr><td>Jumlah (pcs)</td><td></td><td class="num"><input class="inp" type="number" data-adj="${i}" data-key="qty" value="${s.qty}"></td></tr>
            <tr><td>Biaya produksi</td><td></td><td class="num">${rupiah(s.production)}</td></tr>
            ${it.bpom ? `<tr><td>BPOM & Lab</td><td></td><td class="num"><input class="inp" type="number" data-adj="${i}" data-key="bpom" value="${s.bpom}"></td></tr>` : ""}
            ${it.halal ? `<tr><td>Halal</td><td></td><td class="num"><input class="inp" type="number" data-adj="${i}" data-key="halal" value="${s.halal}"></td></tr>` : ""}
            ${it.sample ? `<tr><td>Sample (incl. PPN)</td><td></td><td class="num"><input class="inp" type="number" data-adj="${i}" data-key="sample" value="${s.sample}"></td></tr>` : ""}
            <tr><td>Total SKU ${i + 1}</td><td></td><td class="num">${rupiah(s.total)}</td></tr>
          </tfoot>
        </table></div>
        ${ia && Object.keys(ia).length ? `<button class="link-btn small" data-resetadj="${i}">Reset ke harga otomatis</button>` : ""}
      </div>`;
    }).join("");

    modalRoot.innerHTML = `<div class="modal-bg" data-close><div class="modal" role="dialog" aria-modal="true">
      <div class="row between" style="margin-bottom:8px">
        <div><div class="muted small">${fmtDate(o.createdAt)}</div><h2 style="margin:2px 0">${esc(o.id)}</h2></div>
        <button class="btn btn-ghost btn-sm" data-close>✕ Tutup</button>
      </div>
      <div class="row" style="margin-bottom:14px">
        <select class="input" id="ordStatus" style="width:auto">${STATUSES.map(([v, n]) => `<option value="${v}" ${o.status === v ? "selected" : ""}>${n}</option>`).join("")}</select>
        <button class="btn btn-primary btn-sm" data-pdf="${esc(o.id)}">⬇ Invoice PDF</button>
        ${o.pdfUrl && o.pdfUrl.startsWith("http") ? `<a class="btn btn-ghost btn-sm" href="${esc(o.pdfUrl)}" target="_blank" rel="noopener">Invoice otomatis di Drive ↗</a>` : ""}
        <button class="btn btn-wa btn-sm" data-sendwa="${esc(o.id)}">Kirim invoice ke WA customer</button>
        <button class="btn btn-ghost btn-sm" data-copy="${esc(o.id)}">Salin ringkasan</button>
        <button class="btn btn-danger btn-sm" data-delorder="${esc(o.id)}">Hapus</button>
      </div>
      <div class="card" style="margin-bottom:12px">
        <dl class="kv" style="margin:0">
          <dt>Nama</dt><dd>${esc(c.name)}</dd>
          <dt>HP / WA</dt><dd><a href="${esc(window.MG.waLink(c.phone, ""))}" target="_blank" rel="noopener">${esc(c.phone)}</a></dd>
          <dt>Email</dt><dd><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd>
          <dt>Kota</dt><dd>${esc(c.city)}</dd>
          <dt>Brand</dt><dd>${esc(c.brand)}</dd>
          ${c.brandNote ? `<dt>Catatan Brand</dt><dd>${esc(c.brandNote)}</dd>` : ""}
          ${c.notes ? `<dt>Catatan</dt><dd>${esc(c.notes)}</dd>` : ""}
        </dl>
      </div>
      ${skuHtml}
      <div class="card">
        <div class="table-wrap" style="border:0"><table class="tbl">
          <tr><td>Subtotal</td><td class="num">${rupiah(calc.subtotal)}</td></tr>
          <tr><td>Diskon</td><td class="num"><input class="inp" type="number" data-orderadj="discount" value="${adj.discount || 0}"></td></tr>
          <tr><td>Ongkos kirim <span class="muted small">(ditagih saat pelunasan; isi jika sudah diketahui)</span></td><td class="num"><input class="inp" type="number" data-orderadj="shipping" value="${adj.shipping || 0}"></td></tr>
          <tr><td><b>Total</b></td><td class="num"><b>${rupiah(calc.total)}</b></td></tr>
          ${calc.dpPct ? `<tr><td>DP ${calc.dpPct}% (di awal)</td><td class="num">${rupiah(calc.dp)}</td></tr>
          <tr><td>Pelunasan (setelah NIE BPOM terbit)${calc.shipping ? "" : " + ongkir"}</td><td class="num">${rupiah(calc.balance)}</td></tr>` : ""}
        </table></div>
      </div>
    </div></div>`;
  }

  function closeOrder() { A.openId = null; modalRoot.innerHTML = ""; render(); }

  function updateOrder(id, fn) {
    const orders = getOrders();
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    o.adj = o.adj || {};
    fn(o);
    o.updatedAt = new Date().toISOString();
    setOrders(orders);
    schedulePushOrder(id);
  }

  function orderSummaryText(o) {
    const calc = computeOrder(o, A.prices);
    const L = [`Halo Kak ${o.customer.name}, terima kasih sudah order di ${A.prices.settings.companyName || CFG.appName} 🙏`, "",
      `Berikut invoice untuk order *${o.id}* (brand ${o.customer.brand}):`];
    o.items.forEach((it, i) => {
      const b = IDX.bases[it.baseId];
      L.push(`• SKU ${i + 1}: ${it.productName || (b ? b.name : it.baseId)} ${it.vol} ${it.unit || "ml"} × ${calc.skus[i].qty} pcs = ${rupiah(calc.skus[i].total)}`);
    });
    L.push("", `*Total: ${rupiah(calc.total)}*`);
    L.push("_Harga belum termasuk ongkos kirim (dibayarkan saat produk ready)._");
    if (calc.dpPct) L.push(`DP ${calc.dpPct}% (di awal): ${rupiah(calc.dp)}`, `Pelunasan setelah nomor izin edar BPOM terbit: ${rupiah(calc.balance)}${calc.shipping ? "" : " + ongkos kirim"}`);
    if (A.prices.settings.bankInfo) L.push("", "Pembayaran ke:", A.prices.settings.bankInfo);
    L.push("", "File invoice PDF terlampir, berisi juga *lembar MoU*. Mohon MoU ditandatangani di atas *meterai Rp 10.000*, lalu kirim kembali foto/scan MoU yang sudah ditandatangani ke WhatsApp ini. 🙏");
    return L.join("\n");
  }

  /* ------------------------------------------------------------ invoice PDF */
  function buildInvoice(o) {
    const { jsPDF } = window.jspdf;
    const st = A.prices.settings;
    const calc = computeOrder(o, A.prices);
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const M = 16;
    const green = [10, 138, 134];
    const rp = (n) => "Rp " + Math.round(n).toLocaleString("id-ID");
    const created = new Date();
    const due = new Date(created.getTime() + (Number(st.invoiceDueDays) || 7) * 864e5);
    const d = (x) => x.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

    doc.setFillColor(...green); doc.rect(0, 0, W, 4, "F");
    if (LOGO) doc.addImage(LOGO, "JPEG", M, 10, 62, 62 * 427 / 1973);
    else { doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(29, 29, 31); doc.text(st.companyName || CFG.appName, M, 20); }
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(100);
    const comp = [st.companyName && st.companyName !== CFG.appName ? st.companyName : "", st.companyAddress, st.companyPhone && "WA: " + st.companyPhone, st.companyEmail].filter(Boolean);
    doc.text(comp.length ? comp : [CFG.tagline], M, 28);
    doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(...green);
    doc.text("INVOICE", W - M, 20, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(60);
    doc.text([`No. Invoice: INV/${o.id}`, `No. Order: ${o.id}`, `Tanggal: ${d(created)}`, `Jatuh tempo: ${d(due)}`], W - M, 27, { align: "right" });

    let y = 50;
    doc.setDrawColor(230); doc.line(M, y - 6, W - M, y - 6);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(29, 29, 31);
    doc.text("Ditagihkan kepada:", M, y);
    doc.setFont("helvetica", "normal"); doc.setTextColor(60);
    const c = o.customer;
    doc.text([c.name, `Brand: ${c.brand}`, `${c.phone} · ${c.email}`, c.city], M, y + 5);

    const body = [];
    o.items.forEach((it, i) => {
      const b = IDX.bases[it.baseId];
      const s = calc.skus[i];
      const act = (it.actives || []).map((id) => (IDX.actives[id] || {}).name || id);
      const desc = [
        `SKU ${i + 1} — ${it.productName || (b ? b.name : it.baseId)} (${it.vol} ${it.unit || "ml"})`,
        `Base: ${b ? b.name : it.baseId}${it.variant ? " (" + it.variant + ")" : ""}`,
        `Bahan aktif tambahan: ${act.length ? act.join(", ") : "-"}${it.customActives ? "; request: " + it.customActives : ""}`,
        `Kemasan: ${window.MG.packagingLabel(it)}`,
        it.sticker ? "Termasuk sticker label" : "",
      ].filter(Boolean).join("\n");
      body.push([String(body.length + 1), desc, `${s.qty} pcs`, rp(s.unit), rp(s.production)]);
      if (st.invoiceBreakdown) {
        s.lines.forEach((l) => {
          const name = l.key === "base" ? "Base" : l.activeId ? (IDX.actives[l.activeId] || {}).name : l.key === "pack" ? "Kemasan" : l.key === "sticker" ? "Sticker" : l.label;
          body.push(["", `   • ${name} / pcs`, "", rp(l.value), ""]);
        });
      }
      if (it.bpom) body.push([String(body.filter((r) => r[0]).length + 1), `Biaya BPOM & Lab — SKU ${i + 1}`, "1 SKU", rp(s.bpom), rp(s.bpom)]);
      if (it.halal) body.push([String(body.filter((r) => r[0]).length + 1), `Sertifikasi Halal — SKU ${i + 1}`, "1 SKU", rp(s.halal), rp(s.halal)]);
      if (it.sample) body.push([String(body.filter((r) => r[0]).length + 1), `Sample produk (termasuk PPN) — SKU ${i + 1}`, "1 SKU", rp(s.sample), rp(s.sample)]);
    });

    doc.autoTable({
      startY: y + 26, margin: { left: M, right: M },
      head: [["No", "Deskripsi", "Qty", "Harga", "Jumlah"]], body,
      styles: { font: "helvetica", fontSize: 8.8, cellPadding: 2.6, textColor: [40, 40, 40], lineColor: [232, 228, 220], lineWidth: 0.1 },
      headStyles: { fillColor: green, textColor: 255, fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 9, halign: "center" }, 2: { cellWidth: 20, halign: "right" }, 3: { cellWidth: 28, halign: "right" }, 4: { cellWidth: 32, halign: "right" } },
      didParseCell: (h) => { if (h.section === "head" && h.column.index >= 2) h.cell.styles.halign = "right"; if (h.section === "head" && h.column.index === 0) h.cell.styles.halign = "center"; },
    });

    y = doc.lastAutoTable.finalY + 6;
    const tot = [["Subtotal", rp(calc.subtotal)]];
    if (calc.discount) tot.push(["Diskon", "- " + rp(calc.discount)]);
    if (calc.shipping) tot.push(["Ongkos kirim", rp(calc.shipping)]);
    tot.push(["TOTAL", rp(calc.total)]);
    if (!calc.shipping) tot.push(["Ongkos kirim", "ditagih saat produk ready"]);
    if (calc.dpPct) {
      tot.push([`DP ${calc.dpPct}% (di awal)`, rp(calc.dp)]);
      tot.push([`Pelunasan setelah NIE BPOM terbit${calc.shipping ? "" : " (+ ongkir)"}`, rp(calc.balance)]);
    }
    doc.autoTable({
      startY: y, margin: { left: W - M - 110, right: M }, body: tot, theme: "plain",
      styles: { fontSize: 9.5, cellPadding: 1.8 }, columnStyles: { 1: { halign: "right" } },
      didParseCell: (h) => { if (h.row.raw[0] === "TOTAL") { h.cell.styles.fontStyle = "bold"; h.cell.styles.fontSize = 11; h.cell.styles.textColor = green; } },
    });

    y = doc.lastAutoTable.finalY + 10;
    const block = (title, text) => {
      if (!text) return;
      const lines = doc.splitTextToSize(text, W - 2 * M);
      if (y + 8 + lines.length * 4.4 > doc.internal.pageSize.getHeight() - 16) { doc.addPage(); y = 20; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(29, 29, 31); doc.text(title, M, y);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(80); doc.text(lines, M, y + 5);
      y += 9 + lines.length * 4.4;
    };
    block("Informasi Pembayaran", st.bankInfo);
    block("Catatan", st.invoiceNotes);

    addMou(doc, o, calc);

    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFontSize(8); doc.setTextColor(150);
      doc.text(`${st.companyName || CFG.appName} · ${CFG.tagline}`, M, doc.internal.pageSize.getHeight() - 8);
      doc.text(`Hal ${p}/${pages}`, W - M, doc.internal.pageSize.getHeight() - 8, { align: "right" });
    }
    return doc;
  }

  /* ------------------------------------------------------------ lembar MoU */
  function addMou(doc, o, calc) {
    const st = A.prices.settings;
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 18, TW = W - 2 * M;
    const rp = (n) => "Rp " + Math.round(n).toLocaleString("id-ID");
    const company = st.companyName || CFG.appName;
    const c = o.customer;
    const today = new Date().toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    const adminWa = st.companyPhone || CFG.adminWhatsApp;
    let y = 0;
    const page = () => { doc.addPage(); y = 20; };
    const ensure = (h) => { if (y + h > H - 18) page(); };
    const para = (text, opt = {}) => {
      doc.setFont("helvetica", opt.bold ? "bold" : "normal"); doc.setFontSize(opt.size || 9.4); doc.setTextColor(35);
      const indent = opt.indent || 0;
      const lines = doc.splitTextToSize(text, TW - indent);
      lines.forEach((ln) => { ensure(4.6); doc.text(ln, M + indent, y, opt.center ? { align: "center" } : undefined); y += 4.6; });
      y += opt.after ?? 1.6;
    };
    const center = (text, size, bold) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(29, 29, 31); doc.text(text, W / 2, y, { align: "center" }); y += size * 0.5; };
    const pasal = (no, title, items) => {
      ensure(16); y += 2;
      center(`Pasal ${no}`, 10, true); center(title, 10, true); y += 1;
      items.forEach((t, i) => para(items.length > 1 ? `(${i + 1}) ${t}` : t, { indent: 0 }));
    };

    page();
    if (LOGO) { doc.addImage(LOGO, "JPEG", W / 2 - 22, 10, 44, 44 * 427 / 1973); y = 30; }
    center("MEMORANDUM OF UNDERSTANDING (MoU)", 13, true);
    center("PERJANJIAN KERJA SAMA MAKLON PRODUK KOSMETIK", 11, true);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(90);
    doc.text(`Nomor: MOU/${o.id}`, W / 2, y + 1, { align: "center" }); y += 9;

    para(`Pada hari ini, ${today}, yang bertanda tangan di bawah ini:`);
    para(`1. ${company}${st.signerName ? `, dalam hal ini diwakili oleh ${st.signerName} selaku ${st.signerTitle || "Direktur"}` : ""}${st.companyAddress ? `, beralamat di ${st.companyAddress}` : ""}, selanjutnya disebut "PIHAK PERTAMA" atau "Pemaklon".`, { indent: 2 });
    para(`2. ${c.name}, pemilik merek "${c.brand}", berdomisili di ${c.city}, No. HP ${c.phone}, email ${c.email}, selanjutnya disebut "PIHAK KEDUA" atau "Pemilik Merek".`, { indent: 2 });
    para(`PIHAK PERTAMA dan PIHAK KEDUA (selanjutnya bersama-sama disebut "PARA PIHAK") sepakat untuk mengikatkan diri dalam kerja sama maklon produk kosmetik dengan ketentuan sebagai berikut:`, { after: 3 });

    pasal(1, "RUANG LINGKUP", [
      `PIHAK PERTAMA memproduksi produk kosmetik untuk merek milik PIHAK KEDUA sesuai rincian pesanan No. ${o.id} dan invoice No. INV/${o.id} yang merupakan bagian tidak terpisahkan dari MoU ini, yaitu: ` +
        o.items.map((it, i) => `SKU ${i + 1} "${it.productName || it.baseName || it.baseId}" ${it.vol} ${it.unit || "ml"} sebanyak ${calc.skus[i].qty} pcs`).join("; ") + ".",
      "Pekerjaan meliputi produksi, pengisian ke dalam kemasan, pemasangan sticker/label, serta pengurusan notifikasi BPOM dan sertifikasi halal sesuai pilihan PIHAK KEDUA.",
    ]);
    pasal(2, "HARGA DAN PEMBAYARAN", [
      `Nilai pekerjaan sesuai invoice sebesar ${rp(calc.total - calc.shipping)} dan belum termasuk ongkos kirim. Ongkos kirim dibayarkan oleh PIHAK KEDUA pada saat produk sudah siap (ready).`,
      `PIHAK KEDUA membayar uang muka (DP) sebesar ${calc.dpPct || 50}% (${rp(calc.dp)}) sebelum proses pendaftaran, pengujian dan produksi dimulai.`,
      "Pelunasan sisa pembayaran beserta ongkos kirim wajib dibayarkan oleh PIHAK KEDUA setelah nomor izin edar (notifikasi) BPOM terbit, sebelum produk dikirim.",
      `Biaya request sample (apabila dipilih) sebesar ${rp(st.samplePerSku || 555000)} per SKU sudah termasuk PPN dan dibayarkan bersama DP.`,
      "Uang muka yang telah dibayarkan tidak dapat dikembalikan apabila PIHAK KEDUA membatalkan pesanan secara sepihak setelah proses pendaftaran, pengujian, pembelian bahan atau produksi dimulai.",
    ]);
    pasal(3, "HAK DAN KEWAJIBAN PIHAK PERTAMA", [
      "Memproduksi produk sesuai spesifikasi yang disepakati dengan memperhatikan Cara Pembuatan Kosmetika yang Baik (CPKB) dan standar mutu yang berlaku.",
      "Mengurus pendaftaran notifikasi BPOM, pengujian laboratorium dan sertifikasi halal sesuai pilihan PIHAK KEDUA, dengan data yang benar dari PIHAK KEDUA.",
      "Menginformasikan perkembangan proses kepada PIHAK KEDUA dan menjaga kerahasiaan data serta konsep merek PIHAK KEDUA.",
      "Berhak menunda atau menghentikan proses apabila PIHAK KEDUA belum memenuhi kewajiban pembayaran atau melanggar ketentuan MoU ini.",
    ]);
    pasal(4, "HAK DAN KEWAJIBAN PIHAK KEDUA", [
      "Memberikan data, dokumen dan desain label yang benar dan lengkap, serta bertanggung jawab penuh atas keabsahan merek, logo dan desain (tidak melanggar hak kekayaan intelektual pihak lain).",
      "Menyetujui desain sticker/label dan spesifikasi produk sebelum produksi dimulai; perubahan setelah persetujuan dapat menimbulkan biaya tambahan.",
      "Melakukan pembayaran sesuai jadwal pada Pasal 2.",
      "Memasarkan produk sesuai klaim, kegunaan dan informasi yang telah disetujui BPOM, serta mematuhi peraturan perundang-undangan yang berlaku.",
    ]);
    pasal(5, "IZIN EDAR, FORMULA DAN MEREK", [
      "Nomor izin edar (notifikasi BPOM) hanya berlaku untuk produk yang diproduksi oleh PIHAK PERTAMA dan tidak boleh digunakan untuk produk lain dalam bentuk apa pun.",
      "Formula produk merupakan milik dan rahasia PIHAK PERTAMA. Merek dan desain kemasan merupakan milik PIHAK KEDUA.",
      "Pemindahan atau penggunaan nomor izin edar oleh pihak lain hanya dapat dilakukan dengan persetujuan tertulis PIHAK PERTAMA dan sesuai ketentuan BPOM.",
    ]);
    pasal(6, "LARANGAN DAN SANKSI", [
      "PIHAK KEDUA dilarang: (a) menyalahgunakan nomor izin edar, termasuk mencantumkannya pada produk yang tidak diproduksi oleh PIHAK PERTAMA; (b) memalsukan produk, mengubah isi/komposisi, mengemas ulang (repacking) atau mencampur produk; (c) memalsukan label, dokumen, sertifikat BPOM maupun sertifikat halal; (d) melakukan tindakan pidana lainnya yang berkaitan dengan produk.",
      `Apabila PIHAK KEDUA melakukan pelanggaran sebagaimana dimaksud pada ayat (1), PIHAK KEDUA wajib membayar ganti rugi kepada PIHAK PERTAMA (${company}) sebesar Rp 1.000.000.000,- (satu miliar rupiah), di samping akan diproses secara hukum melalui pengadilan di Indonesia sesuai peraturan perundang-undangan yang berlaku.`,
      "PIHAK PERTAMA berhak menghentikan kerja sama secara sepihak, menarik produk, serta melaporkan pelanggaran kepada BPOM dan aparat penegak hukum.",
    ]);
    pasal(7, "KERAHASIAAN", ["PARA PIHAK wajib menjaga kerahasiaan seluruh informasi yang diperoleh dalam kerja sama ini, termasuk formula, harga dan data bisnis, dan tidak mengungkapkannya kepada pihak ketiga tanpa persetujuan tertulis pihak lainnya."]);
    pasal(8, "KEADAAN KAHAR (FORCE MAJEURE)", ["Keterlambatan atau kegagalan pelaksanaan kewajiban akibat keadaan di luar kemampuan PARA PIHAK (bencana alam, kebakaran, wabah, kebijakan pemerintah, gangguan pasokan dan sejenisnya) tidak dianggap sebagai pelanggaran. Pihak yang mengalami wajib memberitahukan pihak lainnya selambat-lambatnya 7 (tujuh) hari."]);
    pasal(9, "PENYELESAIAN PERSELISIHAN", [
      "Perselisihan yang timbul diselesaikan terlebih dahulu secara musyawarah untuk mufakat.",
      `Apabila musyawarah tidak mencapai mufakat, PARA PIHAK sepakat menyelesaikannya melalui Pengadilan Negeri ${st.courtCity ? st.courtCity : "di wilayah hukum Republik Indonesia sesuai domisili PIHAK PERTAMA"}.`,
    ]);
    pasal(10, "PENUTUP", [
      "MoU ini berlaku sejak ditandatangani oleh PARA PIHAK sampai seluruh kewajiban PARA PIHAK selesai dilaksanakan.",
      "MoU ini wajib ditandatangani oleh PIHAK PERTAMA dan PIHAK KEDUA di atas meterai Rp 10.000,- dan mempunyai kekuatan hukum yang sama.",
      `PIHAK KEDUA wajib mengirimkan kembali lembar MoU yang telah ditandatangani di atas meterai (foto/scan) ke WhatsApp admin ${adminWa}. Proses pekerjaan dimulai setelah MoU yang telah ditandatangani dan DP diterima oleh PIHAK PERTAMA.`,
    ]);

    // tanda tangan
    ensure(62); y += 6;
    const colW = (TW - 14) / 2, x1 = M, x2 = M + colW + 14;
    const sig = (x, role, name, sub) => {
      doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(29, 29, 31);
      doc.text(role, x + colW / 2, y, { align: "center" });
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(sub, x + colW / 2, y + 4.6, { align: "center" });
      doc.setDrawColor(170); doc.setLineDashPattern([1.2, 1], 0); doc.rect(x + colW / 2 - 16, y + 10, 32, 20);
      doc.setLineDashPattern([], 0); doc.setFontSize(7.5); doc.setTextColor(140);
      doc.text(["Meterai", "Rp 10.000"], x + colW / 2, y + 19, { align: "center" });
      doc.setDrawColor(60); doc.line(x + 8, y + 42, x + colW - 8, y + 42);
      doc.setFontSize(9); doc.setTextColor(29, 29, 31); doc.text(name || "(............................................)", x + colW / 2, y + 47, { align: "center" });
    };
    sig(x1, "PIHAK PERTAMA", st.signerName ? `${st.signerName}` : "", `${company}${st.signerTitle ? " — " + st.signerTitle : ""}`);
    sig(x2, "PIHAK KEDUA", c.name, `Pemilik Merek "${c.brand}"`);
    y += 56;
    ensure(12);
    doc.setFillColor(255, 244, 214); doc.roundedRect(M, y, TW, 11, 2, 2, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.6); doc.setTextColor(107, 76, 0);
    doc.text(`Kirim kembali MoU yang sudah ditandatangani di atas meterai Rp 10.000 ke WhatsApp admin: ${adminWa}`, W / 2, y + 6.8, { align: "center" });
  }

  async function sendInvoiceWa(o) {
    const doc = buildInvoice(o);
    const name = `Invoice-${o.id}.pdf`;
    const text = orderSummaryText(o);
    const file = new File([doc.output("blob")], name, { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text }); markInvoiced(o.id); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    doc.save(name);
    window.open(window.MG.waLink(o.customer.phone, text), "_blank");
    toast("PDF terunduh — lampirkan file tersebut di chat WhatsApp", 4500);
    markInvoiced(o.id);
  }

  function markInvoiced(id) {
    updateOrder(id, (o) => { if (o.status === "baru") o.status = "invoice"; });
    openOrder(id);
  }

  /* ------------------------------------------------------------ prices tabs */
  function priceSearch(ph, sec) {
    return `<div class="row between" style="margin-bottom:10px"><input class="input" id="priceQ" placeholder="${ph}" value="${esc(A.priceQ)}" style="max-width:420px;flex:1;min-width:200px">
      <button class="btn btn-primary btn-sm" data-additem="${sec}">+ Tambah ${SEC_NAME[sec]}</button></div>`;
  }
  // Item yang dihapus ditaruh paling bawah
  const liveFirst = (list) => [...list.filter((x) => !x.deleted), ...list.filter((x) => x.deleted)];

  function viewBases() {
    const q = A.priceQ.toLowerCase();
    const rows = liveFirst(C.bases.filter((b) => !q || `${b.id} ${b.name} ${b.form}`.toLowerCase().includes(q))).map((b) => {
      const p = A.prices.bases[b.id] || {};
      const fp = (A.filePrices.bases[b.id] || {}).price;
      return `<tr class="${b.deleted ? "deleted" : ""}"><td>${b.id}</td><td><b>${esc(b.name)}</b> ${itemTags("bases", b)}<br><span class="small muted">${esc(b.form || "")} · ${esc((IDX.baseCats[b.cat] || {}).name || "")}${p.shopee ? " · " + esc(p.shopee) : ""}</span></td>
        <td class="num">${p.vol ?? "-"} ${p.unit || ""}</td>
        <td class="num">${b.deleted ? rupiah(p.price) : `<input class="inp ${fp !== undefined && p.price !== fp ? "changed" : ""}" type="number" data-baseprice="${b.id}" value="${p.price ?? ""}" placeholder="isi">`}</td>
        <td class="num muted">${p.priceAwal ? rupiah(p.priceAwal) : "-"}</td>
        <td class="num">${p.price && p.vol ? rupiah(p.price / p.vol) : '<span class="flag">• isi harga</span>'}</td>
        <td>${itemActions("bases", b)}</td></tr>`;
    }).join("");
    return `<p class="muted small">Harga base dari file <i>discount_nominate</i> (kolom Harga diskon). Harga per pcs = harga ÷ volume asli × volume pesanan. Tambah / edit / hapus langsung di sini — perubahan otomatis tampil di web customer.</p>
      ${priceSearch("Cari base…", "bases")}
      <div class="table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Base</th><th class="num">Vol. asli</th><th class="num">Harga</th><th class="num">Harga awal</th><th class="num">Per ml/g</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function viewActives() {
    const q = A.priceQ.toLowerCase();
    const st = A.prices.settings;
    const rows = liveFirst(C.actives.filter((a) => !q || a.name.toLowerCase().includes(q))).map((a) => {
      const p = A.prices.actives[a.id] || { pricePerGram: 0, alternatives: [], source: {} };
      const per100 = p.pricePerGram * 100 * (st.activeDosePct / 100) * st.activeScrapFactor;
      const fpp = (A.filePrices.actives[a.id] || {}).pricePerGram;
      const alts = p.alternatives || [];
      return `<tr class="${a.deleted ? "deleted" : ""}"><td><b>${esc(a.name)}</b> ${itemTags("actives", a)}<br><span class="small muted">${a.cats.map((c) => (IDX.activeCats[c] || {}).name || c).join(", ")}</span></td>
        <td>${alts.length > 1 && !a.deleted ? `<select class="input" style="padding:6px 8px;font-size:12.5px;min-width:200px" data-actsrc="${a.id}">${alts.map((x, i) => `<option value="${i}" ${x.kode === (p.source || {}).kode ? "selected" : ""}>${esc(x.kode)} · ${esc(x.nama)} · ${esc(x.supplier || "-")} · ${rupiah(x.pricePerGram * 1000)}/kg</option>`).join("")}</select>`
          : `<span class="small">${esc([(p.source || {}).kode, (p.source || {}).supplier].filter(Boolean).join(" · ") || "-")}</span>`}</td>
        <td class="num">${a.deleted ? rupiah(p.pricePerGram * 1000) : `<input class="inp ${fpp !== undefined && p.pricePerGram !== fpp ? "changed" : ""}" type="number" data-actprice="${a.id}" value="${Math.round(p.pricePerGram * 1000)}">`}</td>
        <td class="num">${rupiah(per100)}</td>
        <td>${itemActions("actives", a)}</td></tr>`;
    }).join("");
    return `<p class="muted small">Harga dari <i>master bahan</i>, dihitung per kg (berat = volume). Per pcs = harga/gram × (volume × ${st.activeDosePct}%) × ${st.activeScrapFactor} (scrap factor).</p>
      ${priceSearch("Cari bahan aktif…", "actives")}
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Bahan aktif</th><th>Sumber harga</th><th class="num">Harga / kg</th><th class="num">Per pcs @100 ml</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function viewPackaging() {
    const q = A.priceQ.toLowerCase();
    const st = A.prices.settings;
    const pp = (id) => A.prices.packaging[id] || {};
    const list = liveFirst(C.packaging.filter((p) => !q || `${p.code} ${p.name} ${p.variasi} ${p.vol}`.toLowerCase().includes(q) ||
      (q === "cek" && (!pp(p.id).filePrice || pp(p.id).filePrice > 100000)) ||
      (q === "baru" && (p.new || !window.MG.isOriginal("packaging", p.id)))));
    const rows = list.slice(0, A.packLimit).map((p) => {
      const pr = pp(p.id);
      const flag = !pr.filePrice || pr.filePrice > 100000;
      return `<tr class="${p.deleted ? "deleted" : ""}"><td><img class="thumb" loading="lazy" src="${esc(p.img || "assets/img/logo-sm.png")}" alt=""></td><td><b>${esc(p.code)}</b> ${p.new ? '<span class="tag new">Baru</span>' : ""} ${itemTags("packaging", p)} ${flag && !p.deleted ? '<span class="flag">• cek harga</span>' : ""}<br><span class="small">${esc(p.name)}</span><br><span class="small muted">${esc(p.variasi)}</span></td>
        <td class="num">${p.vol ? (p.volLabel || p.vol) + " " + p.unit : "-"}</td>
        <td class="num">${p.deleted ? (pr.filePrice ? rupiah(pr.filePrice) : "-") : `<input class="inp" type="number" data-packprice="${p.id}" value="${pr.filePrice ?? ""}" placeholder="isi">`}</td>
        <td class="num">${pr.price ? rupiah(pr.price) : "-"}${pr.supplierListPrice ? `<br><span class="small muted">Harga normal supplier: ${rupiah(pr.supplierListPrice)}</span>` : ""}</td>
        <td>${itemActions("packaging", p)}</td></tr>`;
    }).join("");
    return `<p class="muted small">Harga dari nama file gambar kemasan (kode W…) dan dari Excel katalog baru (kode MP…, kolom "Diskon" = harga diskon supplier) × ${st.packagingMarkup} (${Math.round((st.packagingMarkup - 1) * 100)}%). Ketik <b>cek</b> di pencarian untuk melihat kemasan yang harganya kosong / tidak wajar, atau <b>baru</b> untuk kemasan baru.</p>
      ${priceSearch("Cari kode / nama kemasan… (ketik: cek / baru)", "packaging")}
      <div class="table-wrap"><table class="tbl"><thead><tr><th></th><th>Kemasan</th><th class="num">Volume</th><th class="num">Harga supplier</th><th class="num">Harga jual</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      ${list.length > A.packLimit ? `<button class="btn btn-ghost load-more" data-act="morepack">Tampilkan lebih banyak (${list.length - A.packLimit})</button>` : ""}`;
  }

  function viewSettings() {
    const s = A.prices.settings;
    const sh = { endpoint: sheetCfg().endpoint, key: store.get("mg_sheet", {}).key || "" };
    const n = (k, label, hint = "") => `<div class="field"><label>${label}</label><input type="number" step="any" data-set="${k}" value="${s[k]}">${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
    const t = (k, label, area) => `<div class="field"><label>${label}</label>${area ? `<textarea data-set="${k}">${esc(s[k])}</textarea>` : `<input data-set="${k}" value="${esc(s[k])}">`}</div>`;
    return `<div class="grid-2" style="gap:14px">
      <div class="card"><h3 style="margin-top:0">Rumus harga</h3>
        ${n("bpomLabPerSku", "Biaya BPOM & Lab / SKU (Rp)", "Samakan juga dengan assets/js/config.js agar teks di web customer sama.")}
        ${n("halalPerSku", "Biaya Halal / SKU (Rp)")}
        ${n("samplePerSku", "Harga sample / SKU (Rp, incl. PPN)")}
        ${n("stickerPerPcs", "Harga sticker / pcs (Rp)")}
        ${n("activeDosePct", "Dosis bahan aktif (%)")}
        ${n("activeScrapFactor", "Scrap factor bahan aktif (×)", "1.35 = +35%")}
        ${n("packagingMarkup", "Pengali harga kemasan (×)", "Mengubah ini menghitung ulang semua harga kemasan.")}
        ${n("roundPerPcs", "Pembulatan harga per pcs ke atas (Rp)", "1 = tanpa pembulatan, 100 = dibulatkan ke Rp100 terdekat ke atas")}
        ${n("dpPercent", "DP (%)", "0 = tidak ditampilkan")}
      </div>
      <div class="card"><h3 style="margin-top:0">Invoice</h3>
        ${t("companyName", "Nama perusahaan")}
        ${t("companyAddress", "Alamat")}
        ${t("companyPhone", "No. WA / telepon")}
        ${t("companyEmail", "Email")}
        ${t("bankInfo", "Informasi rekening", true)}
        ${t("invoiceNotes", "Catatan invoice", true)}
        ${n("invoiceDueDays", "Jatuh tempo (hari)")}
        ${t("signerName", "Nama penandatangan MoU (Pihak Pertama)")}
        ${t("signerTitle", "Jabatan penandatangan")}
        ${t("courtCity", "Kota Pengadilan Negeri untuk sengketa (mis. Bandung)")}
        <label class="checkrow" style="margin:0"><input type="checkbox" data-set="invoiceBreakdown" ${s.invoiceBreakdown ? "checked" : ""}><span><b>Tampilkan rincian komponen per pcs di invoice</b><span class="small muted">Base, bahan aktif, kemasan, sticker</span></span></label>
      </div>
      <div class="card"><h3 style="margin-top:0">Google Drive: invoice otomatis & rekap order</h3>
        <p class="small muted">Setiap order otomatis dibuatkan invoice PDF di folder Drive "Invoice Generated" dan dicatat di Google Sheet. Panduan pemasangan: <code>apps-script/README.md</code>.</p>
        <div class="field"><label>URL Web App Apps Script</label><input id="sheetEndpoint" value="${esc(sh.endpoint)}" placeholder="https://script.google.com/macros/s/…/exec"></div>
        <div class="field"><label>Kunci admin (ADMIN_KEY)</label><input id="sheetKey" type="password" value="${esc(sh.key)}" placeholder="kosongkan jika ADMIN_KEY = password dashboard">
          <div class="hint">Tips: buat ADMIN_KEY di Apps Script sama dengan password dashboard, maka kolom ini boleh dikosongkan dan semua perangkat langsung tersambung setelah login.</div></div>
        <div class="row"><button class="btn btn-ghost btn-sm" data-act="saveSheet">Simpan</button>
        <button class="btn btn-primary btn-sm" data-act="syncPrices">Sinkron harga ke Google Drive</button></div>
        <p class="small muted" style="margin-bottom:0">Setelah terhubung, setiap perubahan harga, pengaturan, status & penyesuaian order <b>tersimpan otomatis</b> ke Google Drive / Sheet dan langsung dipakai di semua perangkat serta invoice PDF otomatis. Tidak perlu upload file lagi.</p>
      </div>
      <div class="card"><h3 style="margin-top:0">Keamanan & data</h3>
        <p class="small muted">Password dashboard membuka file harga awal <code>data/prices.enc.json</code>. Perubahan harga sehari-hari tersimpan otomatis ke Google Drive. Ganti password hanya perlu file baru (download → kirim ke developer / upload ke hosting).</p>
        <div class="field"><label>Password baru</label><input id="newPw" type="password" autocomplete="new-password" placeholder="min. 8 karakter"></div>
        <div class="row">
          <button class="btn btn-ghost btn-sm" data-act="changePw">Ganti password & download</button>
          <button class="btn btn-ghost btn-sm" data-act="export">Download prices.enc.json</button>
        </div>
        <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
        <div class="row">
          <button class="btn btn-ghost btn-sm" data-act="backup">Backup semua order (JSON)</button>
          <label class="btn btn-ghost btn-sm">Restore backup<input type="file" accept="application/json" id="restoreFile" hidden></label>
        </div>
      </div>
    </div>`;
  }

  function exportCsv() {
    const rows = [["No Order", "Tanggal", "Status", "Nama", "HP", "Email", "Kota", "Brand", "SKU", "Produk", "Base", "Varian", "Volume", "Qty", "Bahan aktif", "Request aktif", "Kemasan", "Harga/pcs", "Total SKU", "Total order"]];
    getOrders().forEach((o) => {
      const calc = computeOrder(o, A.prices);
      o.items.forEach((it, i) => rows.push([o.id, o.createdAt, STATUS_NAME[o.status], o.customer.name, o.customer.phone, o.customer.email, o.customer.city, o.customer.brand,
        i + 1, it.productName, (IDX.bases[it.baseId] || {}).name, it.variant, `${it.vol} ${it.unit || ""}`, calc.skus[i].qty,
        (it.actives || []).map((id) => (IDX.actives[id] || {}).name).join("; "), it.customActives, window.MG.packagingLabel(it),
        Math.round(calc.skus[i].unit), Math.round(calc.skus[i].total), Math.round(calc.total)]));
    });
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    download(`maklongo-orders-${new Date().toISOString().slice(0, 10)}.csv`, "﻿" + csv, "text/csv");
  }

  function importDialog() {
    modalRoot.innerHTML = `<div class="modal-bg" data-close><div class="modal" style="max-width:560px">
      <h3 style="margin-top:0">Import order dari WhatsApp</h3>
      <p class="small muted">Tempel seluruh isi pesan WhatsApp order dari customer (mulai dari "ORDER MAKLON" sampai akhir). Bisa beberapa pesan sekaligus. Order otomatis masuk dashboard dan dicatat ke Google Sheet + invoice PDF.</p>
      <textarea class="input" id="importText" style="min-height:160px" placeholder="*ORDER MAKLON — MaklonGo* …"></textarea>
      <div class="row" style="margin-top:12px"><button class="btn btn-primary" data-act="doImport">Import</button><button class="btn btn-ghost" data-close>Batal</button></div>
    </div></div>`;
  }

  /* ------------------------------------------------------------ events */
  document.getElementById("btnLogout").addEventListener("click", logout);

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-tab],[data-open],[data-close],[data-act],[data-pdf],[data-sendwa],[data-copy],[data-delorder],[data-resetadj],[data-additem],[data-edititem],[data-delitem],[data-restore]");
    if (!t) return;
    const ds = t.dataset;
    if (ds.close !== undefined) { if (e.target === t || t.tagName === "BUTTON") closeOrder(); return; }
    if (ds.tab) { A.tab = ds.tab; A.priceQ = ""; A.packLimit = 60; return render(); }
    if (ds.open) return openOrder(ds.open);
    const EDIT = { bases: editBase, actives: editActive, packaging: editPack };
    if (ds.additem) return EDIT[ds.additem]();
    if (ds.edititem) { const [sec, id] = ds.edititem.split(/:(.*)/); return EDIT[sec](id); }
    if (ds.delitem) { const [sec, id] = ds.delitem.split(/:(.*)/); return deleteItem(sec, id); }
    if (ds.restore) { const [sec, id] = ds.restore.split(/:(.*)/); return restoreItem(sec, id); }
    if (ds.pdf) { const o = getOrders().find((x) => x.id === ds.pdf); buildInvoice(o).save(`Invoice-${o.id}.pdf`); return; }
    if (ds.sendwa) return sendInvoiceWa(getOrders().find((x) => x.id === ds.sendwa));
    if (ds.copy) { const o = getOrders().find((x) => x.id === ds.copy); await navigator.clipboard.writeText(orderSummaryText(o)); return toast("Ringkasan disalin"); }
    if (ds.delorder) { if (confirm(`Hapus order ${ds.delorder}?`)) { setOrders(getOrders().filter((x) => x.id !== ds.delorder)); closeOrder(); } return; }
    if (ds.resetadj) { updateOrder(A.openId, (o) => { (o.adj.items = o.adj.items || [])[+ds.resetadj] = {}; }); return openOrder(A.openId); }
    switch (ds.act) {
      case "export": return exportEncrypted();
      case "resetLocal": if (confirm("Buang semua perubahan harga lokal?")) { store.del("mg_admin_prices"); A.prices = structuredClone(A.filePrices); A.prices.settings = { ...DEFAULT_SETTINGS, ...A.prices.settings }; A.dirty = false; render(); } return;
      case "sync": return syncSheet();
      case "import": return importDialog();
      case "doImport": { const v = document.getElementById("importText").value; modalRoot.innerHTML = ""; return importText(v); }
      case "csv": return exportCsv();
      case "morepack": A.packLimit += 120; return render();
      case "syncPrices": return syncPricesToDrive();
      case "retrySync": return pushPrices();
      case "saveSheet": {
        store.set("mg_sheet", { endpoint: document.getElementById("sheetEndpoint").value.trim(), key: document.getElementById("sheetKey").value });
        await Promise.all([loadRemotePrices(), loadCatalog()]);
        render();
        return toast(A.sync.state === "ok" ? "Terhubung ✓ — perubahan kini tersimpan otomatis" : "Gagal terhubung: " + (A.sync.msg || ""), 4000);
      }
      case "changePw": {
        const pw = document.getElementById("newPw").value;
        if (pw.length < 8) return toast("Password minimal 8 karakter");
        await exportEncrypted(pw);
        A.pw = pw; try { sessionStorage.setItem("mg_pw", pw); } catch {}
        return toast("File terenkripsi dengan password baru terunduh — upload ke GitHub", 4500);
      }
      case "backup": return download(`maklongo-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(getOrders(), null, 1), "application/json");
    }
  });

  document.addEventListener("change", (e) => {
    const t = e.target, ds = t.dataset;
    if (ds.ffcheck) { t.closest(".chip").classList.toggle("active", t.checked); return; }
    if (t.id === "ordStatus") { updateOrder(A.openId, (o) => { o.status = t.value; }); return; }
    if (ds.adj !== undefined) {
      const i = +ds.adj, k = ds.key, v = t.value === "" ? undefined : Number(t.value);
      updateOrder(A.openId, (o) => {
        const items = (o.adj.items = o.adj.items || []);
        const a = (items[i] = items[i] || {});
        if (k.startsWith("act:")) { a.actives = a.actives || {}; a.actives[k.slice(4)] = v; } else a[k] = v;
      });
      return openOrder(A.openId);
    }
    if (ds.orderadj) { updateOrder(A.openId, (o) => { o.adj[ds.orderadj] = Number(t.value) || 0; }); return openOrder(A.openId); }
    if (ds.baseprice) { (A.prices.bases[ds.baseprice] = A.prices.bases[ds.baseprice] || { vol: IDX.bases[ds.baseprice].vol, unit: IDX.bases[ds.baseprice].unit }).price = Number(t.value) || 0; savePrices(); return render(); }
    if (ds.actprice) { (A.prices.actives[ds.actprice] = A.prices.actives[ds.actprice] || { alternatives: [], source: {} }).pricePerGram = (Number(t.value) || 0) / 1000; savePrices(); return render(); }
    if (ds.actsrc) { const p = A.prices.actives[ds.actsrc]; p.source = p.alternatives[+t.value]; p.pricePerGram = p.source.pricePerGram; savePrices(); return render(); }
    if (ds.packprice) {
      const p = (A.prices.packaging[ds.packprice] = A.prices.packaging[ds.packprice] || {});
      p.filePrice = t.value === "" ? null : Number(t.value);
      p.price = p.filePrice ? Math.round(p.filePrice * A.prices.settings.packagingMarkup) : null;
      savePrices(); return render();
    }
    if (ds.set) {
      const s = A.prices.settings;
      s[ds.set] = t.type === "checkbox" ? t.checked : t.type === "number" ? Number(t.value) : t.value;
      if (ds.set === "packagingMarkup") Object.values(A.prices.packaging).forEach((p) => { p.price = p.filePrice ? Math.round(p.filePrice * s.packagingMarkup) : null; });
      savePrices(); return render();
    }
    if (t.id === "restoreFile" && t.files[0]) {
      t.files[0].text().then((txt) => { try { const n = upsertOrders(JSON.parse(txt), true); toast(`${n} order dipulihkan`); render(); } catch { toast("File backup tidak valid"); } });
    }
  });

  let qTimer;
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "orderQ" || t.id === "priceQ") {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        if (t.id === "orderQ") A.q = t.value; else A.priceQ = t.value;
        const pos = t.selectionStart; render();
        const n = document.getElementById(t.id); n.focus(); n.setSelectionRange(pos, pos);
      }, 200);
    }
  });
  document.addEventListener("change", (e) => { if (e.target.id === "orderStatus") { A.status = e.target.value; render(); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && A.openId) closeOrder(); });

  /* ------------------------------------------------------------ start */
  const pw = (() => { try { return sessionStorage.getItem("mg_pw"); } catch { return null; } })();
  if (pw) login(pw).catch(() => viewLogin()); else viewLogin();
})();
