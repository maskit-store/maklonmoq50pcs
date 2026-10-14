/* Helper bersama untuk halaman customer & admin */
(function () {
  const C = window.CATALOG;
  const CFG = window.MG_CONFIG;

  const byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
  const IDX = {};
  function reindex() {
    Object.assign(IDX, {
      bases: byId(C.bases),
      actives: byId(C.actives),
      activeCats: byId(C.activeCategories),
      packaging: byId(C.packaging),
      baseCats: byId(C.baseCategories),
      packTypes: byId(C.packagingTypes),
    });
  }

  /*
   * Perubahan katalog dari dashboard admin (tambah / edit / hapus) disimpan di Google Drive lewat Apps Script
   * dan diterapkan di atas katalog bawaan (catalog.js). Format: { bases: { id: item | {id, deleted:true} }, actives, packaging }.
   * Customer: item yang dihapus disembunyikan. Admin (keepDeleted): tetap ada dengan tanda deleted agar order lama terbaca.
   */
  const ORIG = { bases: C.bases.slice(), actives: C.actives.slice(), packaging: C.packaging.slice() };
  const CAT_SECS = ["bases", "actives", "packaging"];
  let catOvr = {};
  function applyCatalog(ovr, keepDeleted) {
    catOvr = ovr || {};
    CAT_SECS.forEach((sec) => {
      const o = catOvr[sec] || {};
      const out = ORIG[sec].map((x) => (o[x.id] ? { ...o[x.id], id: x.id } : x));
      Object.keys(o).forEach((id) => { if (!ORIG[sec].some((x) => x.id === id)) out.push({ ...o[id], id }); });
      C[sec].splice(0, C[sec].length, ...out.filter((x) => keepDeleted || !x.deleted));
    });
    reindex();
  }
  const isOriginal = (sec, id) => ORIG[sec].some((x) => x.id === id);
  const originalItem = (sec, id) => ORIG[sec].find((x) => x.id === id);

  // Ambil perubahan katalog terbaru (publik, tanpa harga). Salinan terakhir disimpan di browser agar langsung tampil.
  function fetchCatalog(endpoint = CFG.orderEndpoint) {
    if (!endpoint) return Promise.resolve(null);
    return fetch(`${endpoint}?action=catalog`).then((r) => r.json())
      .then((d) => (d && d.catalog !== undefined && !d.error ? d.catalog || {} : null)).catch(() => null);
  }
  const cachedCatalog = (() => { try { return JSON.parse(localStorage.getItem("mg_catalog") || "null"); } catch { return null; } })();
  applyCatalog(cachedCatalog, false);
  // Dipanggil customer app: resolve true jika katalog berubah dibanding salinan lokal
  function refreshCatalog() {
    return fetchCatalog().then((cat) => {
      if (!cat) return false;
      const s = JSON.stringify(cat);
      if (s === JSON.stringify(cachedCatalog || {})) return false;
      try { localStorage.setItem("mg_catalog", s); } catch {}
      applyCatalog(cat, false);
      return true;
    });
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rupiah = (n) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
  const fmtDate = (iso) => new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  function normalizePhone(p) {
    let d = String(p || "").replace(/\D/g, "");
    if (d.startsWith("0")) d = "62" + d.slice(1);
    else if (d.startsWith("8")) d = "62" + d;
    return d;
  }

  function newOrderId() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const ymd = String(now.getFullYear()).slice(2) + pad(now.getMonth() + 1) + pad(now.getDate());
    const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const rnd = new Uint32Array(5);
    crypto.getRandomValues(rnd);
    const tail = Array.from(rnd, (n) => abc[n % abc.length]).join("");
    return `MG-${ymd}-${tail}`;
  }

  // Bahan aktif bawaan base (memperhitungkan varian yang punya bahan aktif sendiri)
  function baseActives(base, variantName) {
    const v = (base.variants || []).find((x) => x.name === variantName);
    return [...(base.actives || []), ...((v && v.actives) || [])];
  }

  function packagingLabel(item) {
    if (item.noPackaging) return "Tidak ada pilihan kemasan — Admin bantu carikan yang lain";
    const p = IDX.packaging[item.packagingId];
    if (!p) return "-";
    const vol = p.vol ? ` ${p.volLabel || p.vol} ${p.unit}` : "";
    return `${p.code} · ${p.name}${vol}${p.variasi && p.variasi !== "-" ? " · " + p.variasi : ""}`;
  }

  /* Order ringkas untuk dikirim lewat link (tanpa harga) */
  function packOrder(order) {
    const compact = {
      i: order.id, t: order.createdAt, v: order.catalogVersion,
      c: [order.customer.name, order.customer.phone, order.customer.email, order.customer.city, order.customer.brand, order.customer.notes, order.customer.brandNote || ""],
      s: order.items.map((it) => [it.baseId, it.variant || "", it.vol, it.qty, it.actives, it.customActives || "",
        it.noPackaging ? "" : it.packagingId, it.packagingNote || "", it.productName || "", [it.sticker ? 1 : 0, it.bpom ? 1 : 0, it.halal ? 1 : 0, it.sample ? 1 : 0]]),
    };
    return LZString.compressToEncodedURIComponent(JSON.stringify(compact));
  }

  function unpackOrder(str) {
    const o = JSON.parse(LZString.decompressFromEncodedURIComponent(str));
    if (!o || !o.i) throw new Error("Data order tidak valid");
    const [name, phone, email, city, brand, notes, brandNote = ""] = o.c;
    return {
      id: o.i, createdAt: o.t, catalogVersion: o.v,
      customer: { name, phone, email, city, brand, brandNote, notes },
      items: o.s.map((s) => {
        const base = IDX.bases[s[0]];
        return {
          baseId: s[0], baseName: base ? base.name : s[0], variant: s[1], vol: s[2], qty: s[3], unit: base ? base.unit : "ml",
          actives: s[4], customActives: s[5], packagingId: s[6] || null, noPackaging: !s[6], packagingNote: s[7],
          productName: s[8], sticker: !!s[9][0], bpom: !!s[9][1], halal: !!s[9][2], sample: !!s[9][3],
        };
      }),
    };
  }

  function adminUrl() {
    const u = new URL("admin.html", location.href);
    return u.origin + u.pathname;
  }

  function orderMessage(order, withLink = true) {
    const L = [];
    L.push(`*ORDER MAKLON — ${CFG.appName}*`);
    L.push(`No. Order: *${order.id}*`);
    L.push(`Tanggal: ${fmtDate(order.createdAt)}`);
    L.push("");
    L.push("*Data Customer*");
    L.push(`Nama: ${order.customer.name}`);
    L.push(`HP/WA: ${order.customer.phone}`);
    L.push(`Email: ${order.customer.email}`);
    L.push(`Kota: ${order.customer.city}`);
    L.push(`Nama Brand: ${order.customer.brand}`);
    if (order.customer.brandNote) L.push(`Catatan Brand: ${order.customer.brandNote}`);
    if (order.customer.notes) L.push(`Catatan: ${order.customer.notes}`);
    let pcs = 0;
    order.items.forEach((it, i) => {
      const base = IDX.bases[it.baseId];
      pcs += Number(it.qty) || 0;
      L.push("");
      L.push(`*SKU ${i + 1}${it.productName ? ": " + it.productName : ""}*`);
      L.push(`• Base: ${base ? base.name : it.baseId}${it.variant ? " (" + it.variant + ")" : ""}`);
      const ba = base ? baseActives(base, it.variant) : [];
      if (ba.length) L.push(`  Sudah mengandung: ${ba.join(", ")}`);
      L.push(`• Volume: ${it.vol} ${base ? base.unit : "ml"} | Jumlah: ${it.qty} pcs`);
      const act = (it.actives || []).map((id) => (IDX.actives[id] || {}).name || id);
      L.push(`• Bahan aktif tambahan (±1%): ${act.length ? act.join(", ") : "-"}`);
      if (it.customActives) L.push(`• Request bahan aktif lain: ${it.customActives}`);
      L.push(`• Kemasan: ${packagingLabel(it)}`);
      if (it.packagingNote) L.push(`  Catatan kemasan: ${it.packagingNote}`);
      L.push(`• Sticker: ${it.sticker ? "Ya" : "Tidak"} | BPOM & Lab: ${it.bpom ? "Ya" : "Tidak"} | Halal: ${it.halal ? "Ya" : "Tidak"}`);
      L.push(`• Request sample: ${it.sample ? "Ya" : "Tidak"}`);
    });
    L.push("");
    L.push(`Total: ${order.items.length} SKU, ${pcs} pcs`);
    L.push("Saya sudah membaca info pembayaran (DP 50%, pelunasan + ongkir setelah NIE BPOM terbit). Mohon dibuatkan invoice & MoU. Terima kasih 🙏");
    if (withLink) {
      L.push("");
      L.push("_(Link khusus admin untuk rekam order:)_");
      L.push(`${adminUrl()}#import=${packOrder(order)}`);
    }
    return L.join("\n");
  }

  // Tambahkan nama-nama yang mudah dibaca (untuk invoice otomatis di Google Apps Script)
  function enrichOrder(order) {
    return { ...order, items: order.items.map((it) => {
      const b = IDX.bases[it.baseId];
      return { ...it, baseName: b ? b.name : it.baseId, unit: b ? b.unit : it.unit || "ml",
        baseActives: b ? baseActives(b, it.variant) : [],
        activeNames: (it.actives || []).map((id) => (IDX.actives[id] || {}).name || id),
        packagingLabel: packagingLabel(it) };
    }) };
  }

  const isMobile = () => /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(navigator.userAgent || "");

  // HP → api.whatsapp.com (membuka aplikasi WhatsApp). Komputer → langsung WhatsApp Web.
  // Sengaja tidak memakai wa.me: domain itu sering timeout di beberapa jaringan/ISP.
  function waLink(number, text) {
    const phone = normalizePhone(number);
    return isMobile()
      ? `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`
      : `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`;
  }

  function toast(msg, ms = 2600) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  window.MG = { isMobile, applyCatalog, fetchCatalog, refreshCatalog, isOriginal, originalItem, C, CFG, IDX, esc, rupiah, fmtDate, normalizePhone, newOrderId, baseActives, packagingLabel,
    packOrder, unpackOrder, enrichOrder, orderMessage, waLink, toast, store };
})();
