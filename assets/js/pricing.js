/* Enkripsi harga & kalkulasi HPP — dipakai dashboard admin */
(function () {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function deriveKey(password, salt, iter) {
    const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base,
      { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  async function decryptPrices(blob, password) {
    const key = await deriveKey(password, unb64(blob.salt), blob.iter);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, key, unb64(blob.ct));
    return JSON.parse(dec.decode(pt));
  }

  async function encryptPrices(obj, password, iter = 250000) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, iter);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
    return { v: 1, kdf: "PBKDF2-SHA256", iter, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  }

  /*
   * Harga bertingkat per jumlah order (Tabel_Aturan_Harga_Maklon_Order_50-25000pcs.xlsx).
   * base = pengali harga diskon base · actAdd = tambahan Rp per bahan aktif per pcs
   * pack = pengali harga supplier kemasan · sticker = Rp/pcs · bpom, halal = Rp/SKU. Di atas maxQty: hubungi admin.
   */
  const DEFAULT_TIERS = [
    { min: 50, base: 1.0, actAdd: 5500, pack: 1.35, sticker: 4500, bpom: 3500000, halal: 3500000 },
    { min: 500, base: 0.95, actAdd: 5000, pack: 1.35, sticker: 4000, bpom: 3500000, halal: 3500000 },
    { min: 1000, base: 0.85, actAdd: 4000, pack: 1.35, sticker: 3750, bpom: 0, halal: 3500000 },
    { min: 5000, base: 0.75, actAdd: 2000, pack: 1.2, sticker: 2500, bpom: 0, halal: 3500000 },
    { min: 10000, base: 0.5, actAdd: 1000, pack: 1.1, sticker: 1250, bpom: 0, halal: 3500000 },
    { min: 25000, base: 0.4, actAdd: 0, pack: 1.0, sticker: 990, bpom: 0, halal: 3500000 },
  ];
  const tiersOf = (st) => (st && Array.isArray(st.tiers) && st.tiers.length ? st.tiers : DEFAULT_TIERS);
  const tierOf = (st, q) => tiersOf(st).reduce((t, x) => (q >= x.min ? x : t), tiersOf(st)[0]);

  const num = (v, d = 0) => (v === "" || v == null || isNaN(Number(v)) ? d : Number(v));
  const ovr = (o, k) => (o && o[k] !== undefined && o[k] !== "" && o[k] !== null ? Number(o[k]) : undefined);

  /**
   * Hitung harga satu SKU (harga bertingkat sesuai jumlah).
   * item: data SKU dari customer; adj: penyesuaian admin untuk SKU tsb (opsional)
   * Hasil per pcs:
   *   base     = harga base / volume asli × volume akhir × pengali tier
   *   aktif    = harga per gram × (volume akhir × dosis%) × scrap factor + tambahan tier
   *   kemasan  = harga supplier × pengali tier (0 jika customer bawa kemasan sendiri)
   *   sticker  = harga sticker tier / pcs
   */
  function computeSku(item, prices, adj = {}) {
    const st = prices.settings;
    const qty = num(ovr(adj, "qty") ?? item.qty);
    const t = tierOf(st, qty);
    const vol = num(item.vol);
    const lines = [];
    const bp = prices.bases[item.baseId];
    const baseAuto = bp ? (bp.price / bp.vol) * vol * t.base : 0;
    lines.push({ key: "base", label: "Base", auto: baseAuto, value: ovr(adj, "base") ?? baseAuto, missing: !bp });
    const doseG = vol * (num(st.activeDosePct, 1) / 100);
    (item.actives || []).forEach((id) => {
      const ap = prices.actives[id];
      const auto = ap ? ap.pricePerGram * doseG * num(st.activeScrapFactor, 1.35) + num(t.actAdd) : 0;
      lines.push({ key: "act:" + id, activeId: id, label: "Bahan aktif", auto, value: ovr(adj.actives, id) ?? auto, missing: !ap });
    });
    if (item.customActives) lines.push({ key: "custom", label: "Request bahan aktif", auto: 0, value: ovr(adj, "custom") ?? 0, missing: ovr(adj, "custom") === undefined });
    const pp = item.noPackaging ? null : prices.packaging[item.packagingId];
    const packAuto = pp ? (pp.filePrice ? Math.round(pp.filePrice * num(t.pack, 1.35)) : num(pp.price)) : 0;
    lines.push({ key: "pack", label: item.ownPackaging ? "Kemasan (bawa sendiri)" : "Kemasan", auto: packAuto, value: ovr(adj, "pack") ?? packAuto,
      missing: !item.ownPackaging && !packAuto && ovr(adj, "pack") === undefined });
    if (item.sticker) lines.push({ key: "sticker", label: "Sticker", auto: num(t.sticker), value: ovr(adj, "sticker") ?? num(t.sticker), missing: false });
    const round = Math.max(1, num(st.roundPerPcs, 1));
    const rawUnit = lines.reduce((s, l) => s + num(l.value), 0);
    const unit = round > 1 ? Math.ceil(rawUnit / round) * round : Math.round(rawUnit);
    const bpom = item.bpom ? ovr(adj, "bpom") ?? num(t.bpom) : 0;
    const halal = item.halal ? ovr(adj, "halal") ?? num(t.halal) : 0;
    const sample = item.sample ? ovr(adj, "sample") ?? num(st.samplePerSku, 555000) : 0;
    return { lines, qty, tier: t, unit, rawUnit, production: unit * qty, bpom, halal, sample, total: unit * qty + bpom + halal + sample };
  }

  // Gambaran harga SKU kalau jumlah diperbesar: qty sekarang lalu setiap tier sampai qty maksimal (25.000 pcs)
  function ladder(item, prices, qty) {
    const q = num(qty ?? item.qty);
    const max = num(prices.settings.maxQty, 25000);
    const qs = [...new Set([q, ...tiersOf(prices.settings).map((t) => t.min)])].filter((x) => x >= q && x <= max).sort((a, b) => a - b);
    return qs.map((n) => {
      const s = computeSku({ ...item, qty: n, sample: false }, prices, {});
      return { qty: n, unit: s.unit, perPcs: (s.production + s.bpom + s.halal) / n, total: s.production + s.bpom + s.halal };
    });
  }

  function computeOrder(order, prices) {
    const adj = order.adj || {};
    const skus = order.items.map((it, i) => computeSku(it, prices, (adj.items || [])[i] || {}));
    const subtotal = skus.reduce((s, x) => s + x.total, 0);
    const discount = num(adj.discount);
    const shipping = num(adj.shipping);
    const total = Math.max(0, subtotal - discount + shipping);
    const dpPct = num(prices.settings.dpPercent, 0);
    // DP dihitung dari nilai order tanpa ongkir; ongkir ditagih saat pelunasan
    const dp = Math.round((Math.max(0, total - shipping) * dpPct) / 100);
    return { skus, subtotal, discount, shipping, total, dp, dpPct, balance: total - dp };
  }

  window.MGP = { decryptPrices, encryptPrices, computeSku, computeOrder, ladder, tierOf, tiersOf, DEFAULT_TIERS };
})();
