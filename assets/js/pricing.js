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

  const num = (v, d = 0) => (v === "" || v == null || isNaN(Number(v)) ? d : Number(v));
  const ovr = (o, k) => (o && o[k] !== undefined && o[k] !== "" && o[k] !== null ? Number(o[k]) : undefined);

  /**
   * Hitung harga satu SKU.
   * item: data SKU dari customer; adj: penyesuaian admin untuk SKU tsb (opsional)
   * Hasil per pcs:
   *   base     = harga base / volume asli × volume akhir
   *   aktif    = harga per gram × (volume akhir × dosis%) × scrap factor
   *   kemasan  = harga kemasan (sudah ×135%)
   *   sticker  = setting sticker / pcs
   */
  function computeSku(item, prices, adj = {}) {
    const st = prices.settings;
    const qty = num(ovr(adj, "qty") ?? item.qty);
    const vol = num(item.vol);
    const lines = [];
    const bp = prices.bases[item.baseId];
    const baseAuto = bp ? (bp.price / bp.vol) * vol : 0;
    lines.push({ key: "base", label: "Base", auto: baseAuto, value: ovr(adj, "base") ?? baseAuto, missing: !bp });
    const doseG = vol * (num(st.activeDosePct, 1) / 100);
    (item.actives || []).forEach((id) => {
      const ap = prices.actives[id];
      const auto = ap ? ap.pricePerGram * doseG * num(st.activeScrapFactor, 1.35) : 0;
      lines.push({ key: "act:" + id, activeId: id, label: "Bahan aktif", auto, value: ovr(adj.actives, id) ?? auto, missing: !ap });
    });
    if (item.customActives) lines.push({ key: "custom", label: "Request bahan aktif", auto: 0, value: ovr(adj, "custom") ?? 0, missing: ovr(adj, "custom") === undefined });
    const pp = item.noPackaging ? null : prices.packaging[item.packagingId];
    const packAuto = pp && pp.price ? pp.price : 0;
    lines.push({ key: "pack", label: "Kemasan", auto: packAuto, value: ovr(adj, "pack") ?? packAuto, missing: !packAuto && ovr(adj, "pack") === undefined });
    if (item.sticker) lines.push({ key: "sticker", label: "Sticker", auto: num(st.stickerPerPcs), value: ovr(adj, "sticker") ?? num(st.stickerPerPcs), missing: false });
    const round = Math.max(1, num(st.roundPerPcs, 1));
    const rawUnit = lines.reduce((s, l) => s + num(l.value), 0);
    const unit = round > 1 ? Math.ceil(rawUnit / round) * round : Math.round(rawUnit);
    const bpom = item.bpom ? ovr(adj, "bpom") ?? num(st.bpomLabPerSku) : 0;
    const halal = item.halal ? ovr(adj, "halal") ?? num(st.halalPerSku) : 0;
    return { lines, qty, unit, rawUnit, production: unit * qty, bpom, halal, total: unit * qty + bpom + halal };
  }

  function computeOrder(order, prices) {
    const adj = order.adj || {};
    const skus = order.items.map((it, i) => computeSku(it, prices, (adj.items || [])[i] || {}));
    const subtotal = skus.reduce((s, x) => s + x.total, 0);
    const discount = num(adj.discount);
    const shipping = num(adj.shipping);
    const total = Math.max(0, subtotal - discount + shipping);
    const dpPct = num(prices.settings.dpPercent, 0);
    return { skus, subtotal, discount, shipping, total, dp: Math.round((total * dpPct) / 100), dpPct };
  }

  window.MGP = { decryptPrices, encryptPrices, computeSku, computeOrder };
})();
