/* MaklonGo — versi harga transparan + rekomendasi dari budget */
(function () {
  const { C, CFG, IDX, esc, store, toast } = window.MG;
  const PP = window.MG_PUBLIC_PRICES;
  const ROOT = window.MG_ROOT || "";
  const MOQ = CFG.moq || 50, MAXQ = PP.maxQty || 25000, WEBQ = 500; // di atas WEBQ ditangani CS Business Development
  const TIERS = PP.tiers;
  const tierOf = (q) => TIERS.reduce((t, x) => (q >= x.min ? x : t), TIERS[0]);
  const feesOf = (q) => { const t = tierOf(q); return t.bpom + t.halal; };
  const DOSE = (PP.activeDosePct || 1) / 100;
  const FIXED_VOL = { B20: true, B24: true }; // Sheet mask & lip balm: hanya ukuran asli
  const BD_WA = "6285183889341";

  const app = document.getElementById("app");
  const bar = document.getElementById("tpBar");
  const rp = (n) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
  const img = (u) => (!u ? ROOT + "assets/img/logo-sm.png" : /^https?:/.test(u) ? u : ROOT + u);
  const vlabel = (v) => String(v).replace(".", ",");

  /* ------------------------------------------------------------ data & harga */
  const VOLS = [...new Set(C.packaging.filter((p) => p.vol && p.vol <= 1000).map((p) => p.vol))].sort((a, b) => a - b);
  const basesPriced = () => C.bases.filter((b) => PP.bases[b.id]);
  const volsFor = (b) => (FIXED_VOL[b.id] ? [b.vol] : VOLS);

  // Jenis kemasan yang cocok per bentuk sediaan
  const FORM_PACK = [
    [/sheet mask/i, []], [/cushion/i, ["makeup"]], [/lip balm/i, ["makeup", "pot", "tube"]],
    [/mist|spray/i, ["spray"]], [/foam/i, ["pump"]], [/deodorant/i, ["rollon"]],
    [/serum sunscreen/i, ["pump", "tube"]], [/oil serum|body oil/i, ["pipet", "botol", "rollon", "spray"]],
    [/lotion serum/i, ["pump", "tube"]], [/serum/i, ["pipet", "pump", "botol"]], [/toner|micellar/i, ["botol", "fliptop", "pump", "spray"]],
    [/hair tonic/i, ["spray", "pipet", "botol"]], [/scrub|pomade|hair mask/i, ["pot", "tube"]], [/cream/i, ["pot", "tube"]],
    [/wash|shampoo/i, ["pump", "fliptop", "botol", "jerigen"]], [/bedak/i, ["botol", "fliptop", "pump"]],
    [/lotion|moisturizer/i, ["pump", "tube", "fliptop", "botol"]],
  ];
  const packTypesFor = (b) => { const m = FORM_PACK.find(([re]) => re.test(b.form || "")); return m ? m[1] : null; };
  const packSup = (id) => PP.packaging[id];
  const packPrice = (id, q = MOQ) => Math.round(PP.packaging[id] * tierOf(q).pack);
  function packsFor(b, v, allTypes) {
    const types = packTypesFor(b);
    return C.packaging.filter((p) => p.vol === v && packPrice(p.id) && (allTypes || !types || types.includes(p.type)))
      .sort((x, y) => packSup(x.id) - packSup(y.id));
  }
  const baseP = (b, v, q = MOQ) => PP.bases[b.id] * v * tierOf(q).base;
  const actP = (id, v, q = MOQ) => (PP.actives[id] || 0) * v * DOSE + tierOf(q).actAdd;
  const stickerP = (q = MOQ) => tierOf(q).sticker;

  // Harga satu SKU pada qty tertentu (default: qty di draft) — harga bertingkat
  function priceOf(d, qOverride) {
    const b = IDX.bases[d.baseId];
    const v = Number(d.vol) || 0;
    const qty = Math.max(0, Number(qOverride ?? d.qty) || 0);
    const t = tierOf(qty);
    const base = b ? baseP(b, v, qty) : 0;
    const acts = (d.actives || []).map((id) => ({ id, name: (IDX.actives[id] || {}).name || id, v: actP(id, v, qty) }));
    const pack = d.pack && d.pack !== "own" && d.pack !== "admin" && packSup(d.pack) ? packPrice(d.pack, qty) : 0;
    const sticker = d.sticker === "own" ? 0 : t.sticker;
    const unit = Math.round(base + acts.reduce((s, a) => s + a.v, 0) + pack + sticker);
    const fees = t.bpom + t.halal;
    const sample = d.sample ? PP.fees.sample : 0;
    const total = unit * qty + fees + sample;
    return { base, acts, pack, sticker, unit, qty, bpom: t.bpom, halal: t.halal, fees, sample, total, allIn: qty ? (unit * qty + fees) / qty : 0, tier: t };
  }
  // Daftar qty yang dicoba saat mencari jumlah order yang pas
  const QLIST = (() => { const a = []; for (let q = 50; q < 500; q += 10) a.push(q); for (let q = 500; q < 1000; q += 50) a.push(q);
    for (let q = 1000; q < 5000; q += 250) a.push(q); for (let q = 5000; q <= 25000; q += 500) a.push(q); return a; })();
  // Qty pembanding untuk gambaran "kalau pesan lebih banyak"
  const ladder = (q) => [...new Set([q, ...TIERS.map((t) => t.min)])].filter((x) => x >= q && x <= MAXQ).sort((a, b) => a - b);

  /* ------------------------------------------------------------ rekomendasi */
  function recommend(q) {
    const X = Number(q.perPcs) || 0, T = Number(q.total) || 0;
    const inBase = (b, a) => (b.actives || []).some((x) => x.toLowerCase().includes(a.name.toLowerCase().split(" ")[0]));
    const pool = q.concern ? C.actives.filter((a) => a.cats.includes(q.concern) && PP.actives[a.id]) : [];
    const sticker = q.ownSticker ? "own" : "ours";
    // qty paling kecil yang total per pcs-nya ≤ budget (atau qty terbesar yang muat di total budget)
    const bestQty = (d) => {
      if (T) { let best = null; QLIST.forEach((n) => { if (priceOf(d, n).total <= T) best = n; }); return best && (!X || priceOf(d, best).allIn <= X) ? best : null; }
      return QLIST.find((n) => priceOf(d, n).allIn <= X) || null;
    };
    const out = [];
    basesPriced().filter((b) => b.cat === q.cat).forEach((b) => {
      const vols = volsFor(b).filter((v) => FIXED_VOL[b.id] || (v >= b.vol * 0.5 && v <= b.vol * 2));
      const cands = [];
      vols.forEach((v) => {
        let pack = null;
        if (!q.ownPack) { pack = packsFor(b, v)[0]; if (!pack) return; }
        const d = { baseId: b.id, vol: v, actives: [], pack: pack ? pack.id : "own", sticker, sample: false };
        let qty = bestQty(d);
        if (qty) {
          // Tambah bahan aktif (maks. 2) selama qty tetap di tier harga yang sama
          pool.filter((a) => !inBase(b, a)).sort((x, y) => actP(x.id, v) - actP(y.id, v)).forEach((a) => {
            if (d.actives.length >= 2) return;
            const n = bestQty({ ...d, actives: [...d.actives, a.id] });
            if (n && tierOf(n) === tierOf(qty)) { d.actives.push(a.id); qty = n; }
          });
        }
        const fit = !!qty;
        const pq = qty || MAXQ;
        const pr = priceOf(d, pq);
        cands.push({ b, v, pack, d, qty: pq, pr, fit, dist: Math.abs(Math.log(v / b.vol)) });
      });
      if (!cands.length) return;
      cands.sort((x, y) => (y.fit - x.fit) || (x.dist - y.dist) || (x.qty - y.qty) || (x.pr.unit - y.pr.unit));
      out.push(cands[0]);
    });
    out.sort((x, y) => (y.fit - x.fit) || (x.fit ? (x.qty - y.qty) || (y.d.actives.length - x.d.actives.length) : x.pr.allIn - y.pr.allIn));
    return out;
  }

  /* ------------------------------------------------------------ state */
  const emptyDraft = () => ({ baseId: null, variant: "", vol: null, qty: MOQ, actives: [], pack: null, sticker: "ours", sample: false, productName: "", editIndex: null });
  const S = Object.assign({ view: "home", q: { cat: "face", perPcs: "", total: "", concern: "", ownPack: false, ownSticker: false }, d: emptyDraft(), cart: [], customer: {}, ui: {} },
    store.get("mgt_state", {}));
  S.ui = { actCat: "all", packAll: false, packLimit: 12, showAll: false };
  const persist = () => store.set("mgt_state", { view: S.view, q: S.q, d: S.d, cart: S.cart, customer: S.customer });
  const go = (v) => { S.view = v; persist(); render(); scrollTo({ top: 0 }); };

  /* ------------------------------------------------------------ views */
  const nego = () => `<div class="tp-nego">💬 <b>Harga bisa nego</b> langsung ke admin atau disesuaikan kembali dengan kebutuhanmu.
    <a href="${window.MG.waLink(CFG.adminWhatsApp, "Halo admin MaklonGo, saya mau nego / konsultasi harga maklon.")}" target="_blank" rel="noopener">Chat admin →</a></div>`;
  const tierLabel = (t, i) => { const nx = TIERS[i + 1]; return nx ? `${t.min.toLocaleString("id-ID")}–${(nx.min - 1).toLocaleString("id-ID")} pcs` : `${t.min.toLocaleString("id-ID")} pcs`; };

  function viewHome() {
    return `<section class="hero tp-hero">
      <img class="hero-logo" src="${ROOT}assets/img/logo.png" alt="MaklonGo by SAINSGO" width="250" height="54">
      <span class="highlight">💰 Harga transparan · mulai ${MOQ} pcs</span>
      <h1>Rancang produk <mark>sesuai budget</mark> kamu</h1>
      <p class="lead">Lihat harga setiap komponen secara langsung: base, bahan aktif, kemasan & sticker. Atur komposisinya sampai pas dengan budget. Makin banyak pesan, makin murah.</p>
      <div class="tp-entry">
        <button class="tp-entry-card" data-go="budget"><span class="ico">🎯</span><b>Saya punya budget</b><span>Masukkan budget per pcs, kami rekomendasikan base, bahan aktif, kemasan & jumlah order.</span></button>
        <button class="tp-entry-card" data-start-build><span class="ico">🧪</span><b>Rakit sendiri</b><span>Pilih sendiri base, bahan aktif dan kemasan. Harga dihitung otomatis setiap kali kamu memilih.</span></button>
      </div>
    </section>
    <section class="card tp-tiers">
      <h3 style="margin-top:0">Harga bertingkat: makin banyak, makin murah</h3>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Jumlah order</th><th class="num">Harga base</th><th class="num">Sticker / pcs</th><th class="num">BPOM & Lab</th><th class="num">Halal</th></tr></thead>
        <tbody>${TIERS.map((t, i) => `<tr><td><b>${tierLabel(t, i)}</b></td><td class="num">${t.base < 1 ? `hemat ${Math.round((1 - t.base) * 100)}%` : "normal"}</td>
          <td class="num">${rp(t.sticker)}</td><td class="num">${t.bpom ? rp(t.bpom) : '<b class="ok">GRATIS</b>'}</td><td class="num">${rp(t.halal)}</td></tr>`).join("")}
          <tr><td><b>&gt; ${MAXQ.toLocaleString("id-ID")} pcs</b></td><td class="num" colspan="4">Hubungi admin</td></tr></tbody>
      </table></div>
      <p class="small muted" style="margin:8px 0 0">Harga bahan aktif & kemasan juga turun di jumlah order yang lebih besar. Sample ${rp(PP.fees.sample)} / SKU (incl. PPN).</p>
      ${nego()}
    </section>`;
  }

  function viewBudget() {
    const q = S.q;
    const cats = C.baseCategories.map((c) => `<button class="chip ${q.cat === c.id ? "active" : ""}" data-qcat="${c.id}">${c.icon || ""} ${esc(c.name)}</button>`).join("");
    const concerns = [{ id: "", name: "Tanpa bahan aktif tambahan" }, ...C.activeCategories].map((c) =>
      `<button class="chip ${q.concern === c.id ? "active" : ""}" data-qconcern="${c.id}">${esc(c.name)}</button>`).join("");
    return `<div class="tp-narrow">
      <h2 class="tp-h">Cari produk dari budget</h2>
      <p class="muted">Isi budget per pcs (sudah termasuk biaya BPOM & Halal yang dibagi ke semua pcs). Kami hitung kombinasi dan jumlah order yang paling pas.</p>
      <div class="card">
        <div class="field"><label>1. Kategori produk</label><div class="chips" style="margin:0">${cats}</div></div>
        <div class="field"><label for="qPer">2. Budget per pcs (Rp) <span class="req">*</span></label>
          <input id="qPer" type="number" inputmode="numeric" min="0" step="1000" placeholder="Contoh: 75000" value="${esc(q.perPcs)}">
          <div class="hint">Harga modal per pcs yang kamu inginkan, termasuk BPOM & Halal.</div></div>
        <div class="field"><label for="qTot">Total budget (Rp, opsional)</label>
          <input id="qTot" type="number" inputmode="numeric" min="0" step="100000" placeholder="Contoh: 15000000" value="${esc(q.total)}">
          <div class="hint">Jika diisi, jumlah pcs dihitung agar muat di total budget ini.</div></div>
        <div class="field"><label>3. Fokus manfaat (opsional)</label><div class="chips" style="margin:0">${concerns}</div></div>
        <div class="field" style="margin-bottom:6px"><label>4. Mau lebih hemat?</label>
          <label class="checkrow ${q.ownPack ? "on" : ""}"><input type="checkbox" data-qopt="ownPack" ${q.ownPack ? "checked" : ""}><span><b>Saya bawa kemasan sendiri</b><span class="small muted">Biaya kemasan tidak dihitung.</span></span></label>
          <label class="checkrow ${q.ownSticker ? "on" : ""}" style="margin-top:8px"><input type="checkbox" data-qopt="ownSticker" ${q.ownSticker ? "checked" : ""}><span><b>Saya bawa sticker / label sendiri</b><span class="small muted">Hemat ${rp(stickerP(MOQ))} / pcs (order ${MOQ}–499 pcs).</span></span></label>
        </div>
        <button class="btn btn-primary btn-block btn-lg" data-act="recommend" style="margin-top:12px">Lihat rekomendasi →</button>
      </div></div>`;
  }

  // Tabel "kalau pesan lebih banyak"
  function ladderHtml(d, compact) {
    const base = priceOf(d);
    const rows = ladder(Number(d.qty) || MOQ).map((n) => ({ n, p: priceOf(d, n) }));
    if (compact) return `<div class="tp-ladder-mini">${rows.slice(1, 4).map(({ n, p }) => `<span><b>${n.toLocaleString("id-ID")} pcs</b> ${rp(p.allIn)}/pcs <em>−${Math.max(0, Math.round((1 - p.allIn / base.allIn) * 100))}%</em></span>`).join("")}</div>`;
    return `<div class="tp-ladder"><h4>📉 Gambaran harga kalau pesan lebih banyak</h4>
      <table class="tp-lines"><tr class="hd"><td>Jumlah</td><td>Produksi/pcs</td><td>Total/pcs*</td><td>Hemat</td></tr>
      ${rows.map(({ n, p }) => `<tr class="${n === base.qty ? "cur" : ""}" data-ladq="${n}" title="Total ${rp(p.total)}"><td><b>${n.toLocaleString("id-ID")}</b></td><td>${rp(p.unit)}</td><td><b>${rp(p.allIn)}</b></td><td>${n !== base.qty ? `<em>−${Math.max(0, Math.round((1 - p.allIn / base.allIn) * 100))}%</em>` : "<em>pilihanmu</em>"}</td></tr>`).join("")}
      </table><div class="small muted">*incl. BPOM & Halal. Klik baris untuk memakai jumlah tersebut. Di atas ${MAXQ.toLocaleString("id-ID")} pcs hubungi admin.</div></div>`;
  }

  function recCard(r, i) {
    const q = S.q, p = r.pr, d = { ...r.d, qty: r.qty };
    const lines = [
      [`Base · ${esc(r.b.name)} ${vlabel(r.v)} ${r.b.unit}`, p.base],
      ...p.acts.map((a) => [`+ ${esc(a.name)} (1%)`, a.v]),
      [r.pack ? `Kemasan · ${esc(r.pack.code)} ${esc(r.pack.name)}` : "Kemasan · bawa sendiri", p.pack],
      [q.ownSticker ? "Sticker · bawa sendiri" : "Sticker / label", p.sticker],
    ];
    return `<div class="tp-rec ${r.fit ? "" : "nofit"}">
      <div class="tp-rec-head">
        <img src="${img(r.pack ? r.pack.img : null)}" alt="" loading="lazy">
        <div><span class="badge">${i === 0 && r.fit ? "⭐ Paling pas" : esc((IDX.baseCats[r.b.cat] || {}).name || "")}</span>
          <h3>${esc(r.b.name)}</h3><div class="small muted">${esc(r.b.form)} · ${vlabel(r.v)} ${r.b.unit}${r.b.actives && r.b.actives.length ? " · sudah mengandung " + esc(r.b.actives.slice(0, 3).join(", ")) : ""}</div></div>
      </div>
      <table class="tp-lines">${lines.map(([n, v]) => `<tr><td>${n}</td><td>${rp(v)}</td></tr>`).join("")}
        <tr class="sub"><td>Harga produksi / pcs</td><td>${rp(p.unit)}</td></tr>
        <tr><td>BPOM ${p.bpom ? "" : "(gratis) "}& Halal ÷ ${r.qty.toLocaleString("id-ID")} pcs</td><td>${rp(p.fees / r.qty)}</td></tr>
        <tr class="tot"><td>Total per pcs</td><td>${rp(p.allIn)}</td></tr>
      </table>
      <div class="tp-rec-foot">
        ${r.fit ? `<div><b>Order ${r.qty.toLocaleString("id-ID")} pcs</b> · total ${rp(p.total)}</div>`
          : `<div class="flag small">Belum masuk budget, bahkan di ${MAXQ.toLocaleString("id-ID")} pcs</div>`}
        <button class="btn btn-primary btn-sm" data-userec="${i}">Pakai & atur sendiri →</button>
      </div>
      ${r.fit ? ladderHtml(d, true) : ""}</div>`;
  }

  let lastRecs = [];
  function viewResults() {
    const q = S.q, X = Number(q.perPcs) || 0;
    lastRecs = recommend(q);
    const fit = lastRecs.filter((r) => r.fit);
    const shown = S.ui.showAll ? lastRecs : lastRecs.slice(0, 6);
    const best = fit[0] || lastRecs[0];
    const tips = [];
    if (best) {
      if (!q.ownPack && best.pack) tips.push(`📦 <b>Bawa kemasan sendiri</b> → hemat ${rp(best.pr.pack)}/pcs untuk ${esc(best.b.name)}.`);
      if (!q.ownSticker) tips.push(`🏷️ <b>Bawa sticker sendiri</b> → hemat ${rp(best.pr.sticker)}/pcs.`);
      tips.push(`📈 BPOM & Halal dibagi ke semua pcs, dan mulai 1.000 pcs <b>BPOM gratis</b>: ${[50, 100, 500, 1000].map((n) => `${n.toLocaleString("id-ID")} pcs = <b>${rp(feesOf(n) / n)}</b>/pcs`).join(" · ")}.`);
      if (fit.length && fit[0].qty > WEBQ) tips.push(`🤝 Jumlah di atas ${WEBQ} pcs akan dibantu langsung oleh CS Business Development MaklonGo.`);
      if (!fit.length) tips.unshift(`⚠️ Budget ${rp(X)}/pcs belum cukup, bahkan untuk ${MAXQ.toLocaleString("id-ID")} pcs. Coba naikkan budget, pilih volume lebih kecil, atau bawa kemasan/sticker sendiri.`);
    }
    return `<div class="row between" style="margin:18px 0 6px"><h2 class="tp-h" style="margin:0">Rekomendasi untuk budget ${rp(X)}/pcs</h2><button class="btn btn-ghost btn-sm" data-go="budget">← Ubah budget</button></div>
      <p class="muted small">${esc((IDX.baseCats[q.cat] || {}).name || "")}${q.concern ? " · fokus " + esc((IDX.activeCats[q.concern] || {}).name) : ""}${q.total ? ` · total budget ${rp(q.total)}` : ""}${q.ownPack ? " · bawa kemasan sendiri" : ""}${q.ownSticker ? " · bawa sticker sendiri" : ""}. ${fit.length} dari ${lastRecs.length} base sesuai budget.</p>
      ${tips.length ? `<div class="card tp-tips">${tips.map((t) => `<p>${t}</p>`).join("")}${nego()}</div>` : ""}
      <div class="tp-recs">${shown.map(recCard).join("") || '<div class="card muted">Belum ada base di kategori ini.</div>'}</div>
      ${lastRecs.length > shown.length ? `<button class="btn btn-ghost load-more" data-act="showall">Tampilkan semua (${lastRecs.length})</button>` : ""}
      <p class="small muted" style="margin-top:14px">Harga sudah termasuk bahan aktif dosis 1% per bahan. Belum termasuk ongkos kirim & sample. Harga final mengikuti invoice resmi setelah dicek admin.</p>`;
  }

  /* ---------- perakit (builder) */
  function viewBuild() {
    const d = S.d, b = IDX.bases[d.baseId];
    if (!b) return viewPickBase();
    const v = d.vol, q = Number(d.qty) || MOQ;
    const variants = b.variants || [];
    const volChips = volsFor(b).map((x) => `<button class="vol-btn ${v === x ? "active" : ""}" data-bvol="${x}">${vlabel(x)} ${b.unit}<small>${rp(baseP(b, x, q))}</small></button>`).join("");
    const actCats = [{ id: "all", name: "Semua" }, { id: "selected", name: `Dipilih (${d.actives.length})` }, ...C.activeCategories];
    const acts = C.actives.filter((a) => PP.actives[a.id] && (S.ui.actCat === "all" || (S.ui.actCat === "selected" ? d.actives.includes(a.id) : a.cats.includes(S.ui.actCat))))
      .sort((x, y) => actP(x.id, v, q) - actP(y.id, v, q));
    const packs = packsFor(b, v, S.ui.packAll);
    const typesNote = packTypesFor(b);
    const t = tierOf(q), ti = TIERS.indexOf(t);
    return `<div class="tp-build">
      <div class="tp-main">
        <div class="row between" style="margin:16px 0 4px"><h2 class="tp-h" style="margin:0">Rakit produk</h2><button class="btn btn-ghost btn-sm" data-act="changebase">Ganti base</button></div>
        <section class="card tp-sec"><h3>1. Base</h3>
          <div class="tp-basehead"><div><b>${esc(b.name)}</b><div class="small muted">${esc(b.desc || "")}</div>
          ${(b.actives || []).length ? `<div class="small" style="margin-top:4px">Sudah mengandung: ${esc(window.MG.baseActives(b, d.variant).join(", "))}</div>` : ""}</div>
          <div class="tp-price">${rp(PP.bases[b.id] * t.base)}<small>/ ${b.unit}</small></div></div>
          ${variants.length ? `<div class="chips" style="margin:10px 0 0">${variants.map((x) => `<button class="chip ${d.variant === x.name ? "active" : ""}" data-bvar="${esc(x.name)}">${esc(x.name)}</button>`).join("")}</div>` : ""}
        </section>
        <section class="card tp-sec"><h3>2. Jumlah & volume</h3>
          <div class="field" style="margin:0 0 14px"><label for="bQty">Jumlah (pcs) · min. ${MOQ}</label>
            <div class="stepper"><button data-bqty="-10">−</button><input id="bQty" type="number" min="${MOQ}" max="${MAXQ}" step="10" value="${d.qty}"><button data-bqty="10">+</button></div>
            <div class="chips" style="margin-top:8px">${[50, 100, 300, 500, 1000, 5000, 10000, 25000].map((n) => `<button class="chip ${q === n ? "active" : ""}" data-bqtyset="${n}">${n.toLocaleString("id-ID")}</button>`).join("")}</div>
            <div class="tp-tierbadge">Harga tier <b>${tierLabel(t, ti)}</b>${TIERS[ti + 1] ? ` · pesan ${TIERS[ti + 1].min.toLocaleString("id-ID")}+ pcs untuk harga lebih murah` : ""}${q > WEBQ ? ` · order di atas ${WEBQ} pcs dibantu CS Business Development` : ""}</div></div>
          <label style="font-weight:700;font-size:13.5px">Volume per produk</label>
          <div class="vol-grid" style="margin-top:6px">${volChips}</div>
        </section>
        <section class="card tp-sec"><h3>3. Bahan aktif tambahan <span class="muted small">(dosis 1%, harga per pcs untuk ${vlabel(v)} ${b.unit} @ ${q.toLocaleString("id-ID")} pcs)</span></h3>
          <div class="chips">${actCats.map((c) => `<button class="chip ${S.ui.actCat === c.id ? "active" : ""}" data-bactcat="${c.id}">${esc(c.name)}</button>`).join("")}</div>
          <div class="tp-acts">${acts.map((a) => { const on = d.actives.includes(a.id); return `<button class="tp-act ${on ? "on" : ""}" data-bact="${a.id}"><span class="check">${on ? "✓" : ""}</span><span class="n">${esc(a.name)}</span><span class="p">+${rp(actP(a.id, v, q))}</span></button>`; }).join("")}</div>
        </section>
        <section class="card tp-sec"><h3>4. Kemasan ${vlabel(v)} ${b.unit}</h3>
          <div class="tp-packopts">
            <button class="tp-act ${d.pack === "own" ? "on" : ""}" data-bpack="own"><span class="check">${d.pack === "own" ? "✓" : ""}</span><span class="n"><b>Bawa kemasan sendiri</b></span><span class="p">Rp 0</span></button>
            <button class="tp-act ${d.pack === "admin" ? "on" : ""}" data-bpack="admin"><span class="check">${d.pack === "admin" ? "✓" : ""}</span><span class="n"><b>Admin bantu carikan</b></span><span class="p">menyusul</span></button>
          </div>
          ${typesNote && typesNote.length ? `<label class="small" style="display:inline-flex;gap:6px;align-items:center;margin:10px 0"><input type="checkbox" data-packall ${S.ui.packAll ? "checked" : ""}> Tampilkan semua jenis kemasan (default: yang cocok untuk ${esc(b.form)})</label>` : ""}
          <div class="pack-grid">${packs.slice(0, S.ui.packLimit).map((p) => { const sel = d.pack === p.id; return `<button class="pack ${sel ? "selected" : ""}" data-bpack="${p.id}">
            <div class="img"><img loading="lazy" src="${img(p.img)}" alt="" width="320" height="320"></div>
            <span class="vol">${rp(packPrice(p.id, q))}</span><span class="check">${sel ? "✓" : ""}</span>
            <div class="body"><div class="code">${esc(p.code)}</div><div class="name">${esc(p.name)}</div><div class="meta">${esc(p.variasi && p.variasi !== "-" ? p.variasi : "")}</div></div></button>`; }).join("") || `<p class="muted small">Belum ada kemasan ${vlabel(v)} ${b.unit} yang cocok. Pilih "bawa sendiri" / "admin carikan", atau centang tampilkan semua jenis.</p>`}</div>
          ${packs.length > S.ui.packLimit ? `<button class="btn btn-ghost load-more" data-act="morepack">Tampilkan lebih banyak (${packs.length - S.ui.packLimit})</button>` : ""}
        </section>
        <section class="card tp-sec"><h3>5. Sticker, legalitas & sample</h3>
          <div class="tp-packopts">
            <button class="tp-act ${d.sticker !== "own" ? "on" : ""}" data-bstick="ours"><span class="check">${d.sticker !== "own" ? "✓" : ""}</span><span class="n"><b>Sticker dari MaklonGo</b></span><span class="p">${rp(t.sticker)}/pcs</span></button>
            <button class="tp-act ${d.sticker === "own" ? "on" : ""}" data-bstick="own"><span class="check">${d.sticker === "own" ? "✓" : ""}</span><span class="n"><b>Bawa sticker sendiri</b></span><span class="p">Rp 0</span></button>
          </div>
          <div class="tp-fixed"><span>BPOM & Lab (wajib)</span><b>${t.bpom ? rp(t.bpom) + " / SKU" : "GRATIS (≥ 1.000 pcs)"}</b></div>
          <div class="tp-fixed"><span>Sertifikasi Halal (wajib)</span><b>${rp(t.halal)} / SKU</b></div>
          <label class="checkrow ${d.sample ? "on" : ""}" style="margin-top:10px"><input type="checkbox" data-bsample ${d.sample ? "checked" : ""}><span><b>Request sample dulu</b><span class="small muted">${rp(PP.fees.sample)} / SKU, sudah termasuk PPN</span></span></label>
          <div class="field" style="margin:14px 0 0"><label for="bName">Nama produk</label><input id="bName" placeholder="Contoh: Glow Serum by NamaBrand" value="${esc(d.productName)}"></div>
        </section>
      </div>
      <aside class="tp-side">${summaryHtml()}</aside>
    </div>`;
  }

  const canSave = (d) => d.pack && Number(d.qty) >= MOQ && Number(d.qty) <= MAXQ;
  function summaryHtml() {
    const d = S.d, b = IDX.bases[d.baseId], c = priceOf(d), X = Number(S.q.perPcs) || 0;
    const pk = d.pack && d.pack !== "own" && d.pack !== "admin" ? IDX.packaging[d.pack] : null;
    const pct = X ? Math.min(100, (c.allIn / X) * 100) : 0;
    return `<div class="card tp-sum">
      <h3 style="margin-top:0">Rincian harga <span class="small muted">@ ${c.qty.toLocaleString("id-ID")} pcs</span></h3>
      <table class="tp-lines">
        <tr><td>Base ${vlabel(d.vol)} ${b.unit}</td><td>${rp(c.base)}</td></tr>
        ${c.acts.map((a) => `<tr><td>+ ${esc(a.name)}</td><td>${rp(a.v)}</td></tr>`).join("")}
        <tr><td>Kemasan ${pk ? esc(pk.code) : d.pack === "own" ? "(bawa sendiri)" : d.pack === "admin" ? "(dicarikan admin)" : "(belum dipilih)"}</td><td>${d.pack === "admin" ? "menyusul" : rp(c.pack)}</td></tr>
        <tr><td>Sticker ${d.sticker === "own" ? "(bawa sendiri)" : ""}</td><td>${rp(c.sticker)}</td></tr>
        <tr class="sub"><td>Harga produksi / pcs</td><td>${rp(c.unit)}</td></tr>
        <tr><td>× ${c.qty.toLocaleString("id-ID")} pcs</td><td>${rp(c.unit * c.qty)}</td></tr>
        <tr><td>BPOM & Lab</td><td>${c.bpom ? rp(c.bpom) : "GRATIS"}</td></tr>
        <tr><td>Halal</td><td>${rp(c.halal)}</td></tr>
        ${c.sample ? `<tr><td>Sample</td><td>${rp(c.sample)}</td></tr>` : ""}
        <tr class="tot"><td>Total SKU</td><td>${rp(c.total)}</td></tr>
        <tr class="sub"><td>Total per pcs (incl. BPOM & Halal)</td><td>${rp(c.allIn)}</td></tr>
      </table>
      ${X ? `<div class="tp-meter ${c.allIn > X ? "over" : ""}"><div style="width:${pct}%"></div></div>
        <div class="small ${c.allIn > X ? "flag" : "muted"}">${c.allIn > X ? `Lebih ${rp(c.allIn - X)}/pcs dari budget ${rp(X)}` : `Masih di bawah budget ${rp(X)}/pcs (sisa ${rp(X - c.allIn)})`}</div>` : ""}
      ${ladderHtml(d)}
      ${nego()}
      <p class="small muted" style="margin:10px 0 0">DP 50% ${rp(c.total / 2)} · pelunasan + ongkir setelah NIE BPOM terbit. Belum termasuk ongkir.</p>
      <button class="btn btn-primary btn-block" data-act="savesku" style="margin-top:12px" ${canSave(d) ? "" : "disabled"}>${d.editIndex != null ? "Simpan perubahan SKU" : "Simpan SKU ini →"}</button>
      ${!d.pack ? '<p class="small muted" style="margin:6px 0 0">Pilih kemasan dulu (atau bawa sendiri).</p>' : ""}
    </div>`;
  }

  function viewPickBase() {
    const cat = S.ui.pickCat || S.q.cat || "face";
    const list = basesPriced().filter((b) => b.cat === cat);
    return `<h2 class="tp-h" style="margin-top:18px">Pilih base produk</h2>
      <div class="chips">${C.baseCategories.map((c) => `<button class="chip ${cat === c.id ? "active" : ""}" data-pickcat="${c.id}">${c.icon || ""} ${esc(c.name)}</button>`).join("")}</div>
      <div class="tp-bases">${list.map((b) => `<button class="option" data-pickbase="${b.id}"><div class="row between" style="align-items:flex-start;flex-wrap:nowrap"><div><div class="title">${esc(b.name)}</div><div class="sub">${esc(b.form)} · ${esc(b.desc || "")}</div></div>
        <div class="tp-price">${rp(baseP(b, b.vol))}<small>${vlabel(b.vol)} ${b.unit}</small></div></div></button>`).join("")}</div>`;
  }

  function viewCart() {
    const sum = S.cart.reduce((s, d) => s + priceOf(d).total, 0);
    return `<div class="tp-narrow"><h2 class="tp-h" style="margin-top:18px">SKU saya</h2>
      ${S.cart.map((d, i) => { const b = IDX.bases[d.baseId] || {}, c = priceOf(d); return `<div class="card" style="margin-bottom:10px">
        <div class="row between"><b>SKU ${i + 1}: ${esc(d.productName || b.name)}</b><b>${rp(c.total)}</b></div>
        <div class="small muted">${esc(b.name)}${d.variant ? " (" + esc(d.variant) + ")" : ""} · ${vlabel(d.vol)} ${b.unit} × ${Number(d.qty).toLocaleString("id-ID")} pcs · ${rp(c.unit)}/pcs · total per pcs ${rp(c.allIn)}</div>
        ${ladderHtml(d, true)}
        <div class="row" style="margin-top:8px"><button class="btn btn-ghost btn-sm" data-editsku="${i}">Edit</button><button class="btn btn-ghost btn-sm" data-delsku="${i}">Hapus</button></div></div>`; }).join("") || '<div class="card muted">Belum ada SKU.</div>'}
      <div class="card row between"><b>Total semua SKU</b><b>${rp(sum)}</b></div>
      ${nego()}
      <div class="row" style="margin-top:12px"><button class="btn btn-ghost" data-start-build>+ Tambah SKU</button><button class="btn btn-primary" data-go="customer" ${S.cart.length ? "" : "disabled"}>Lanjut isi data →</button></div></div>`;
  }

  function viewCustomer() {
    const c = S.customer;
    const big = S.cart.some((d) => Number(d.qty) > WEBQ);
    const f = (k, label, type = "text", ph = "") => `<div class="field"><label for="c-${k}">${label} <span class="req">*</span></label><input id="c-${k}" type="${type}" value="${esc(c[k] || "")}" placeholder="${ph}"></div>`;
    return `<div class="tp-narrow"><h2 class="tp-h" style="margin-top:18px">Data pemesan</h2><div class="card">
      ${f("name", "Nama")}${f("phone", "No. WhatsApp", "tel", "08…")}${f("email", "Email", "email")}${f("city", "Kota")}${f("brand", "Nama brand")}
      <div class="field"><label for="c-brandNote">Konsep brand <span class="req">*</span></label><textarea id="c-brandNote" placeholder="Target pasar, konsep, kisaran harga jual…">${esc(c.brandNote || "")}</textarea></div>
      <div class="notice small">Harga di web adalah estimasi berdasarkan harga katalog dan <b>bisa nego / disesuaikan kembali</b> bersama admin. Invoice & MoU resmi dikirim via WhatsApp. DP 50%, pelunasan + ongkir setelah NIE BPOM terbit.${big ? ` Pesanan di atas ${WEBQ} pcs dikirim ke <b>CS Business Development MaklonGo</b>.` : ""}</div>
      <button class="btn btn-primary btn-block btn-lg" data-act="send" style="margin-top:14px">Kirim pesanan via WhatsApp</button></div></div>`;
  }

  function viewSent() {
    return `<div class="tp-narrow card" style="margin-top:24px;text-align:center"><h2>Pesanan terkirim 🎉</h2><p class="muted">No. order <b>${esc(S.lastId || "")}</b>. Admin akan mengirim invoice & MoU melalui WhatsApp.</p>
      <button class="btn btn-ghost" data-go="home">Kembali ke awal</button></div>`;
  }

  function render() {
    const views = { home: viewHome, budget: viewBudget, results: viewResults, build: viewBuild, cart: viewCart, customer: viewCustomer, sent: viewSent };
    app.innerHTML = (views[S.view] || viewHome)();
    document.getElementById("cartPill").classList.toggle("hidden", !S.cart.length);
    document.getElementById("cartCount").textContent = S.cart.length;
    renderBar();
  }
  // Ringkasan mengambang saat merakit
  function renderBar() {
    const show = S.view === "build" && IDX.bases[S.d.baseId];
    bar.classList.toggle("hidden", !show);
    document.body.classList.toggle("has-tpbar", !!show);
    if (!show) return;
    const c = priceOf(S.d), X = Number(S.q.perPcs) || 0;
    bar.innerHTML = `<div class="container wide"><div><div class="small muted">Per pcs (incl. BPOM & Halal)</div><b class="${X && c.allIn > X ? "flag" : ""}">${rp(c.allIn)}</b>${X ? `<span class="small muted"> / budget ${rp(X)}</span>` : ""}</div>
      <div style="text-align:right"><div class="small muted">Total ${c.qty.toLocaleString("id-ID")} pcs</div><b>${rp(c.total)}</b></div>
      <button class="btn btn-primary btn-sm" data-act="savesku" ${canSave(S.d) ? "" : "disabled"}>Simpan</button></div>`;
  }
  function rerenderBuild() { const y = scrollY; render(); scrollTo(0, y); }

  /* ------------------------------------------------------------ aksi */
  function useRec(r) {
    S.d = { ...emptyDraft(), baseId: r.b.id, vol: r.v, qty: r.qty, actives: [...r.d.actives],
      pack: r.pack ? r.pack.id : "own", sticker: S.q.ownSticker ? "own" : "ours", variant: ((r.b.variants || [])[0] || {}).name || "" };
    go("build");
  }
  function pickBase(id) {
    const b = IDX.bases[id];
    const keep = S.d.baseId && S.d.editIndex != null;
    S.d = { ...(keep ? S.d : emptyDraft()), baseId: id, variant: ((b.variants || [])[0] || {}).name || "", pack: null, actives: keep ? S.d.actives : [] };
    S.d.vol = FIXED_VOL[id] ? b.vol : VOLS.reduce((best, v) => (Math.abs(v - b.vol) < Math.abs(best - b.vol) ? v : best), VOLS[0]);
    S.ui.packLimit = 12; go("build");
  }
  function saveSku() {
    const d = { ...S.d };
    if (!d.productName) d.productName = (IDX.bases[d.baseId] || {}).name;
    if (d.editIndex != null) S.cart[d.editIndex] = { ...d, editIndex: null }; else S.cart.push({ ...d, editIndex: null });
    S.d = emptyDraft(); toast("SKU tersimpan"); go("cart");
  }
  function send() {
    const c = S.customer;
    const need = ["name", "phone", "email", "city", "brand", "brandNote"].filter((k) => !String(c[k] || "").trim());
    if (need.length) { toast("Lengkapi: " + need.join(", ")); return; }
    const id = window.MG.newOrderId();
    const big = S.cart.some((d) => Number(d.qty) > WEBQ);
    const L = [`*ORDER MAKLON (HARGA TRANSPARAN) — ${CFG.appName}*`, `No. Order: *${id}*`, "", "*Data Customer*", `Nama: ${c.name}`, `HP/WA: ${c.phone}`, `Email: ${c.email}`, `Kota: ${c.city}`, `Nama Brand: ${c.brand}`, `Catatan Brand: ${c.brandNote}`];
    let grand = 0;
    S.cart.forEach((d, i) => {
      const b = IDX.bases[d.baseId] || {}, p = priceOf(d), pk = IDX.packaging[d.pack];
      grand += p.total;
      L.push("", `*SKU ${i + 1}: ${d.productName}*`, `• Base: ${b.name}${d.variant ? " (" + d.variant + ")" : ""} — ${rp(p.base)}/pcs`, `• Volume: ${d.vol} ${b.unit} | Jumlah: ${d.qty} pcs`);
      L.push(`• Bahan aktif tambahan (±1%): ${p.acts.length ? p.acts.map((a) => `${a.name} (${rp(a.v)})`).join(", ") : "-"}`);
      L.push(`• Kemasan: ${pk ? `${pk.code} · ${pk.name} — ${rp(p.pack)}` : d.pack === "own" ? "Bawa kemasan sendiri" : "Tidak ada pilihan kemasan — Admin bantu carikan yang lain"}`);
      L.push(`• Sticker: ${d.sticker === "own" ? "Bawa sendiri" : "Dari MaklonGo — " + rp(p.sticker)} | BPOM & Lab: ${p.bpom ? "Ya" : "Gratis"} | Halal: Ya`, `• Request sample: ${d.sample ? "Ya" : "Tidak"}`);
      L.push(`• Harga produksi: ${rp(p.unit)}/pcs × ${d.qty} = ${rp(p.unit * d.qty)}`, `• Total SKU (incl. BPOM & Halal${d.sample ? " & sample" : ""}): ${rp(p.total)}`);
    });
    L.push("", `*Estimasi total: ${rp(grand)}* (belum termasuk ongkir)`, "Saya ingin diskusi / nego harga dan dibuatkan invoice & MoU. Terima kasih 🙏");
    const wa = window.MG.waLink(big ? BD_WA : CFG.adminWhatsApp, L.join("\n"));
    S.lastId = id; S.cart = []; go("sent");
    const w = window.open(wa, "_blank"); if (!w) location.href = wa;
  }

  document.getElementById("waFloat").href = window.MG.waLink(CFG.adminWhatsApp, "Halo admin MaklonGo, saya ingin tanya tentang maklon (web harga transparan).");
  document.addEventListener("click", (e) => {
    const lq = e.target.closest("[data-ladq]");
    if (lq && S.view === "build") { S.d.qty = Number(lq.dataset.ladq); persist(); return rerenderBuild(); }
    const t = e.target.closest("button, [data-go]");
    if (!t || t.disabled) return;
    const ds = t.dataset, d = S.d;
    if (ds.go) { e.preventDefault(); return go(ds.go); }
    if (ds.startBuild !== undefined) { S.d = emptyDraft(); S.ui.pickCat = S.q.cat; return go("build"); }
    if (ds.qcat) { S.q.cat = ds.qcat; persist(); return rerenderBuild(); }
    if (ds.qconcern !== undefined) { S.q.concern = ds.qconcern; persist(); return rerenderBuild(); }
    if (ds.userec) return useRec(lastRecs[+ds.userec]);
    if (ds.pickcat) { S.ui.pickCat = ds.pickcat; return rerenderBuild(); }
    if (ds.pickbase) return pickBase(ds.pickbase);
    if (ds.bvar) { d.variant = ds.bvar; persist(); return rerenderBuild(); }
    if (ds.bvol) { d.vol = Number(ds.bvol); if (d.pack && d.pack !== "own" && d.pack !== "admin") d.pack = null; S.ui.packLimit = 12; persist(); return rerenderBuild(); }
    if (ds.bqty) { d.qty = Math.min(MAXQ, Math.max(MOQ, (Number(d.qty) || 0) + Number(ds.bqty))); persist(); return rerenderBuild(); }
    if (ds.bqtyset) { d.qty = Number(ds.bqtyset); persist(); return rerenderBuild(); }
    if (ds.bactcat) { S.ui.actCat = ds.bactcat; return rerenderBuild(); }
    if (ds.bact) { const i = d.actives.indexOf(ds.bact); i >= 0 ? d.actives.splice(i, 1) : d.actives.push(ds.bact); persist(); return rerenderBuild(); }
    if (ds.bpack) { d.pack = d.pack === ds.bpack ? null : ds.bpack; persist(); return rerenderBuild(); }
    if (ds.bstick) { d.sticker = ds.bstick; persist(); return rerenderBuild(); }
    if (ds.editsku) { S.d = { ...S.cart[+ds.editsku], editIndex: +ds.editsku }; return go("build"); }
    if (ds.delsku) { S.cart.splice(+ds.delsku, 1); persist(); return render(); }
    switch (ds.act) {
      case "recommend": {
        S.q.perPcs = document.getElementById("qPer").value; S.q.total = document.getElementById("qTot").value;
        if (!(Number(S.q.perPcs) > 0)) { toast("Isi budget per pcs dulu"); return; }
        S.ui.showAll = false; return go("results");
      }
      case "showall": S.ui.showAll = true; return rerenderBuild();
      case "changebase": S.ui.pickCat = (IDX.bases[d.baseId] || {}).cat; d.baseId = null; return go("build");
      case "morepack": S.ui.packLimit += 24; return rerenderBuild();
      case "savesku": return saveSku();
      case "send": return send();
    }
  });
  document.addEventListener("change", (e) => {
    const t = e.target, d = S.d;
    if (t.dataset.qopt) { S.q[t.dataset.qopt] = t.checked; t.closest(".checkrow").classList.toggle("on", t.checked); return persist(); }
    if (t.dataset.packall !== undefined) { S.ui.packAll = t.checked; S.ui.packLimit = 12; return rerenderBuild(); }
    if (t.dataset.bsample !== undefined) { d.sample = t.checked; persist(); return rerenderBuild(); }
    if (t.id === "bQty") { d.qty = Math.min(MAXQ, Math.max(MOQ, Math.round(Number(t.value) || 0) || MOQ)); persist(); return rerenderBuild(); }
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "bName") { S.d.productName = t.value; persist(); }
    if (t.id === "qPer") S.q.perPcs = t.value;
    if (t.id === "qTot") S.q.total = t.value;
    if (t.id && t.id.startsWith("c-")) { S.customer[t.id.slice(2)] = t.value; persist(); }
  });

  if (!["home", "budget", "results", "build", "cart", "customer"].includes(S.view)) S.view = "home";
  render();
})();
