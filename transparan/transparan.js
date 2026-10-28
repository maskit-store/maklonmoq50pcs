/* MaklonGo — versi harga transparan + rekomendasi dari budget */
(function () {
  const { C, CFG, IDX, esc, store, toast } = window.MG;
  const ROOT = window.MG_ROOT || "";
  const MOQ = CFG.moq || 50, WEBQ = 500; // di atas WEBQ ditangani CS Business Development
  // Harga jual diambil dari Apps Script setelah verifikasi OTP (tidak disimpan di file publik)
  let PP = null, TIERS = [], MAXQ = 25000, DOSE = 0.01;
  function setPrices(pp) { PP = pp; TIERS = pp.tiers; MAXQ = pp.maxQty || 25000; DOSE = (pp.activeDosePct || 1) / 100; }
  const tierOf = (q) => TIERS.reduce((t, x) => (q >= x.min ? x : t), TIERS[0]);
  const feesOf = (q) => { const t = tierOf(q); return t.bpom + t.halal; };
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
  // Budget klien termasuk BPOM & Halal? (ya → biaya dibagi ke semua pcs; belum → dibandingkan dengan harga produksi saja)
  const inclFees = (q = S.q) => q.feesIncl !== false;
  const per = (pr, q) => (inclFees(q) ? pr.allIn : pr.unit);
  const totOf = (pr, q) => (inclFees(q) ? pr.total : pr.unit * pr.qty);
  const perLabel = (q) => (inclFees(q) ? "Total per pcs (incl. BPOM & Halal)" : "Harga per pcs (di luar BPOM & Halal)");

  // Daftar qty yang dicoba saat mencari jumlah order yang pas
  const QLIST = (() => { const a = []; for (let q = 50; q < 500; q += 10) a.push(q); for (let q = 500; q < 1000; q += 50) a.push(q);
    for (let q = 1000; q < 5000; q += 250) a.push(q); for (let q = 5000; q <= 25000; q += 500) a.push(q); return a; })();
  // Qty pembanding untuk gambaran "kalau pesan lebih banyak"
  const ladder = (q) => [...new Set([q, ...TIERS.map((t) => t.min)])].filter((x) => x >= q && x <= MAXQ).sort((a, b) => a - b);

  /* ------------------------------------------------------------ penasihat budget */
  // Manfaat bahan yang umum ada di formula base (untuk alasan rekomendasi)
  const ING = [
    [/niacinamide/i, "mencerahkan & menyamarkan noda"], [/licorice/i, "mencerahkan & menenangkan"], [/kojic|arbutin|mulberry|albae|glutathione|vitamin c/i, "mencerahkan"],
    [/hyaluronic/i, "menghidrasi intens"], [/sodium lactate|glycerin/i, "menjaga kelembapan"], [/asam amino|amino/i, "menjaga kelembapan & skin barrier"],
    [/panthenol|vit\.? ?b5/i, "menenangkan & memperbaiki skin barrier"], [/ceramide/i, "memperkuat skin barrier"], [/aloe/i, "menenangkan & melembapkan"],
    [/centella|cica|mugwort|calamine|chamomile/i, "menenangkan kulit"], [/collagen/i, "menjaga kekenyalan kulit"], [/tea tree|salicylic|sulfur|zinc/i, "membantu mengatasi jerawat & minyak"],
    [/ginseng/i, "menutrisi & anti-aging"], [/vitamin e|tocopher/i, "antioksidan"], [/honey|madu/i, "melembapkan & menutrisi"], [/moringa|pomegranate|rosella|green tea/i, "antioksidan alami"],
    [/urang|aring|biotin|keratin/i, "menutrisi & menguatkan rambut"], [/essential oil|lavender|eucalyptus|cajuput|sereh|citronella/i, "aromaterapi & menyegarkan"],
    [/xylitol|goat milk/i, "merawat kesehatan gigi & mulut"], [/spf|uv|zinc oxide|titanium/i, "melindungi dari sinar UV"],
  ];
  const ingWhy = (name) => { const m = ING.find(([re]) => re.test(name)); return m ? m[1] : ""; };
  // Kata kunci per kategori manfaat → dicocokkan dengan kandungan base
  const CONCERN_KW = {
    brightening: /niacinamide|licorice|kojic|arbutin|mulberry|albae|vitamin c|lemon|pomegranate|glutathione|tone up/i,
    hydrating: /hyaluronic|sodium lactate|aloe|glycerin|amino|panthenol/i, moisturizing: /ceramide|shea|oil|amino|hyaluronic|panthenol|butter/i,
    calming: /centella|aloe|panthenol|mugwort|calamine|chamomile|licorice/i, barrier: /ceramide|panthenol|amino|niacinamide/i,
    acne: /tea tree|salicylic|sulfur|zinc|niacinamide|centella/i, oil: /niacinamide|tea tree|zinc|clay/i, exfoliating: /aha|bha|glycolic|lactic|salicylic|scrub/i,
    antiaging: /collagen|ginseng|retinol|peptide|niacinamide/i, antioxidant: /vitamin e|green tea|pomegranate|moringa|rosella|ginseng/i,
    uv: /spf|uv|sun/i, hair: /keratin|aloe|urang|ginseng|almond|moringa/i, hairgrowth: /urang|ginseng|biotin|rosemary/i,
    deodorizing: /zinc|enzyme|deodor/i, aroma: /oil|lavender|aroma/i, warming: /warming|ginger|cajuput|eucalyptus|menthol/i, repellent: /citronella|sereh|lavender|repel/i, oral: /xylitol|goat milk|tooth/i,
  };
  function baseSupports(b, concern) {
    const acts = b.actives || [];
    const kw = CONCERN_KW[concern];
    const hit = kw ? acts.filter((x) => kw.test(x)) : [];
    return { hit, all: acts };
  }

  // Pilih opsi yang beragam: maksimal 1 per jenis perlakuan bahan aktif dulu (tanpa / 1 aktif / formula tetap), lalu sisanya
  function diverse(list, k = 3) {
    const sorted = list.slice().sort((x, y) => (x.qty - y.qty) || (per(x.pr) - per(y.pr)));
    const grp = (c) => (c.sig.includes("a0") ? "a0" : c.sig.includes("a1") ? "a1" : "a");
    const out = [], seen = new Set();
    sorted.forEach((c) => { if (out.length < k && !seen.has(grp(c))) { seen.add(grp(c)); out.push(c); } });
    sorted.forEach((c) => { if (out.length < k && !out.includes(c)) out.push(c); });
    return out.sort((x, y) => (x.qty - y.qty) || (per(x.pr) - per(y.pr)));
  }

  // Cari rencana produksi termurah-kompromi yang masuk budget untuk 1 base
  function planFor(b, q, opts = {}) {
    const X = Number(q.perPcs) || 0, T = Number(q.total) || 0;
    const inBase = (a) => (b.actives || []).some((x) => x.toLowerCase().includes(a.name.toLowerCase().split(" ")[0]));
    const pool = q.concern ? C.actives.filter((a) => a.cats.includes(q.concern) && PP.actives[a.id] && !inBase(a)) : [];
    const reqN = Math.min(2, pool.length);
    const fits = (d, n) => { const p = priceOf(d, n); return (!X || per(p, q) <= X) && (!T || totOf(p, q) <= T); };
    const bestQty = (d) => {
      if (T) { let best = null; QLIST.forEach((n) => { if (fits(d, n)) best = n; }); return best; }
      return QLIST.find((n) => fits(d, n)) || null;
    };
    const near = FIXED_VOL[b.id] ? b.vol : VOLS.reduce((m, v) => (Math.abs(v - b.vol) < Math.abs(m - b.vol) ? v : m), VOLS[0]);
    const volsDown = FIXED_VOL[b.id] ? [b.vol] : [near, ...VOLS.filter((v) => v < near && v >= b.vol * 0.25).sort((x, y) => y - x).slice(0, 3)];
    const levers = { acts: [], sticker: q.ownSticker ? [true] : [false, true], pack: q.ownPack ? [true] : [false, true] };
    for (let n = reqN; n >= 0; n--) levers.acts.push(n);
    const all = [];
    volsDown.forEach((v, vi) => levers.pack.forEach((ownPack) => {
      const pack = ownPack ? null : packsFor(b, v)[0];
      if (!ownPack && !pack) return;
      levers.sticker.forEach((ownSticker) => levers.acts.forEach((n) => {
        if (opts.noCompromise && (vi || n < reqN || (ownPack && !q.ownPack) || (ownSticker && !q.ownSticker))) return;
        const acts = pool.slice().sort((x, y) => actP(x.id, v) - actP(y.id, v)).slice(0, n).map((a) => a.id);
        const d = { baseId: b.id, vol: v, actives: acts, pack: ownPack ? "own" : pack.id, sticker: ownSticker ? "own" : "ours", sample: false };
        const qty = bestQty(d);
        if (!qty) return;
        const tierIdx = TIERS.indexOf(tierOf(qty));
        const score = (reqN - n) * 1 + (n === 0 && reqN ? 0.5 : 0) + (ownSticker && !q.ownSticker ? 2 : 0) + (ownPack && !q.ownPack ? 3 : 0) + vi * 1.5 + tierIdx * 1.2;
        all.push({ b, v, near, pack, d, qty, pr: priceOf(d, qty), fit: true, score, n, reqN, ownPack, ownSticker, vi,
          sig: [n < reqN ? (n ? "a1" : "a0") : "", vi ? "v" : "", ownSticker && !q.ownSticker ? "s" : "", ownPack && !q.ownPack ? "p" : ""].join("") });
      }));
    }));
    if (!all.length) return null;
    all.sort((x, y) => (x.score - y.score) || (x.qty - y.qty));
    const best = all[0];
    // Opsi lain: strategi berbeda (mis. tanpa bahan aktif, kemasan sendiri) — yang terbaik per strategi, utamakan qty lebih kecil
    const bySig = {};
    all.forEach((c) => { if (c.sig !== best.sig && (!bySig[c.sig] || c.qty < bySig[c.sig].qty || (c.qty === bySig[c.sig].qty && per(c.pr) < per(bySig[c.sig].pr)))) bySig[c.sig] = c; });
    best.allAlts = Object.values(bySig);
    best.alts = diverse(best.allAlts);
    return best;
  }

  // Alasan & strategi yang dipakai sebuah rencana (dibanding permintaan awal)
  function explain(r, q) {
    const out = [];
    const concernName = q.concern ? (IDX.activeCats[q.concern] || {}).name : "";
    if (r.vi) out.push({ tag: `📏 Ukuran ${vlabel(r.v)} ${r.b.unit}`, why: `Turun dari ${vlabel(r.near)} ${r.b.unit} — ukuran trial/travel size, modal per pcs lebih ringan & pas untuk launching atau tes pasar.` });
    if (r.reqN && r.n < r.reqN) {
      if (r.n === 0) {
        const { hit, all } = baseSupports(r.b, q.concern);
        const list = (hit.length ? hit : all).slice(0, 4);
        out.push({ tag: "🧪 Tanpa bahan aktif tambahan", why: list.length
          ? `Formula base sudah mengandung ${list.map((x) => `<b>${esc(x)}</b>${ingWhy(x) ? ` (${ingWhy(x)})` : ""}`).join(", ")}${hit.length && concernName ? ` — sudah mendukung klaim <b>${esc(concernName)}</b>` : ""}. Tanpa tambahan pun produk sudah bekerja.`
          : "Formula base sudah lengkap untuk fungsinya; bahan aktif bisa ditambahkan di produksi berikutnya." });
      } else {
        const a = IDX.actives[r.d.actives[0]];
        out.push({ tag: "🧪 Cukup 1 bahan aktif", why: `Fokus satu klaim utama dengan <b>${esc(a.name)}</b>${ingWhy(a.name) ? ` (${ingWhy(a.name)})` : ""}${concernName ? ` untuk ${esc(concernName)}` : ""}. Satu klaim yang jelas justru lebih mudah dipasarkan.` });
      }
    }
    if (r.ownSticker && !q.ownSticker) out.push({ tag: "🏷️ Sticker sendiri", why: `Cetak label di percetakan langganan — hemat ${rp(tierOf(r.qty).sticker)}/pcs.` });
    if (r.ownPack && !q.ownPack) { const p0 = packsFor(r.b, r.v)[0]; out.push({ tag: "📦 Kemasan dari kamu", why: `Kirim kemasan ke pabrik — hemat ${p0 ? rp(packPrice(p0.id, r.qty)) : "biaya kemasan"}/pcs. Bisa beli grosir di supplier kemasan.` }); }
    const t = tierOf(r.qty), ti = TIERS.indexOf(t);
    if (ti > 0) out.push({ tag: `📈 Produksi ${r.qty.toLocaleString("id-ID")} pcs`, why: `Masuk harga tier ${tierLabel(t, ti)}${t.bpom ? "" : " — BPOM gratis"}. Makin banyak, makin murah per pcs.` });
    return out;
  }

  /* ------------------------------------------------------------ state */
  const emptyDraft = () => ({ baseId: null, variant: "", vol: null, qty: MOQ, actives: [], pack: null, sticker: "ours", sample: false, productName: "", editIndex: null });
  const S = Object.assign({ view: "home", q: { cat: "face", perPcs: "", total: "", concern: "", ownPack: false, ownSticker: false }, d: emptyDraft(), cart: [], customer: {}, profile: null, ui: {} },
    store.get("mgt_state", {}));
  S.ui = { actCat: "all", packAll: false, packLimit: 12, showAll: false, showAllOwn: false };
  const persist = () => store.set("mgt_state", { view: S.view, q: S.q, d: S.d, cart: S.cart, customer: S.customer, profile: S.profile });
  S.reg = { step: "form", busy: false, err: "", info: "" };
  const registered = () => !!(S.profile && S.profile.done && S.profile.token && PP);
  const go = (v) => { S.view = v; persist(); render(); scrollTo({ top: 0 }); };

  /* ------------------------------------------------------------ views */
  const nego = () => `<div class="tp-nego">💬 <b>Harga belum final — bisa nego & didiskusikan lagi</b> dengan tim <b>Business Development MaklonGo</b>, termasuk penyesuaian formula, kemasan, jumlah produksi dan skema pembayaran.
    <a href="${window.MG.waLink(BD_WA, "Halo tim Business Development MaklonGo, saya ingin diskusi / nego harga maklon.")}" target="_blank" rel="noopener">Chat Business Development →</a> ·
    <a href="${window.MG.waLink(CFG.adminWhatsApp, "Halo admin MaklonGo, saya mau nego / konsultasi harga maklon.")}" target="_blank" rel="noopener">Chat admin →</a></div>`;
  const tierLabel = (t, i) => { const nx = TIERS[i + 1]; return nx ? `${t.min.toLocaleString("id-ID")}–${(nx.min - 1).toLocaleString("id-ID")} pcs` : `${t.min.toLocaleString("id-ID")} pcs`; };

  /* ---------- data diri wajib + verifikasi WhatsApp (OTP) */
  async function api(body) {
    const res = await fetch(CFG.orderEndpoint, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) });
    return res.json();
  }
  const PF = [["name", "Nama lengkap", "text", "Nama sesuai KTP"], ["phone", "No. WhatsApp aktif", "tel", "08…"], ["email", "Email", "email", "nama@email.com"],
    ["ig", "Instagram", "text", "@akunkamu"], ["brand", "Nama brand", "text", "Nama brand yang akan dibuat"]];
  function viewRegister() {
    const p = S.profile || {}, r = S.reg;
    const otp = r.step === "otp";
    return `<div class="tp-reg">
      <div class="reg-intro"><span class="fx-tag">● AREA PRODUKSI · AKSES TERBATAS</span>
        <h1>Masuk ke <span>pabrik</span> MaklonGo</h1>
        <p>Isi kartu akses pengunjung untuk membuka harga transparan, rekomendasi dari budget, dan simulasi harga sampai 25.000 pcs.</p>
        <ul class="reg-perks"><li>🔓 Harga setiap komponen terbuka</li><li>🎯 Rekomendasi sesuai budget</li><li>📉 Simulasi harga 50–25.000 pcs</li></ul></div>
      <div class="card pass">
        <div class="pass-top"><span class="pass-slot"></span><div><small>VISITOR PASS</small><b>MAKLONGO FACTORY</b></div><span class="pass-badge">${otp ? "AKTIVASI" : "TAMU"}</span></div>
        <div class="pass-body">
        ${otp ? `<h3 style="margin-top:0">Aktivasi kartu akses</h3>
          <p class="small muted">Kode 6 digit sudah dikirim ke WhatsApp <b>+${esc(window.MG.normalizePhone(p.phone))}</b>. Kode berlaku 5 menit.</p>
          <div class="field"><label for="otpCode">Kode OTP</label><input id="otpCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" class="tp-otp"></div>
          ${r.err ? `<div class="err" style="margin-bottom:10px">${esc(r.err)}</div>` : ""}
          <button class="btn btn-primary btn-block btn-lg" data-act="otpverify" ${r.busy ? "disabled" : ""}>${r.busy ? "Memeriksa…" : "Verifikasi & masuk pabrik"}</button>
          <div class="row between small" style="margin-top:12px"><button class="link-btn" data-act="otpback">← Ubah data / nomor</button><button class="link-btn" data-act="otpresend" ${r.busy ? "disabled" : ""}>Kirim ulang kode</button></div>`
        : `${PF.map(([k, label, type, ph]) => `<div class="field ${r.bad && r.bad.includes(k) ? "invalid" : ""}"><label for="p-${k}">${label} <span class="req">*</span></label>
            <input id="p-${k}" type="${type}" value="${esc(p[k] || "")}" placeholder="${ph}" autocomplete="${{ name: "name", phone: "tel", email: "email" }[k] || "off"}">
            ${k === "phone" ? '<div class="hint">Kami kirim kode verifikasi ke WhatsApp nomor ini.</div>' : ""}</div>`).join("")}
          ${r.err ? `<div class="err" style="margin-bottom:10px">${esc(r.err)}</div>` : ""}
          <label class="checkrow" style="margin-bottom:12px"><input type="checkbox" id="p-agree" ${p.agree ? "checked" : ""}><span><b>Saya setuju dihubungi tim MaklonGo</b><span class="small muted">melalui WhatsApp / email terkait penawaran maklon.</span></span></label>
          <button class="btn btn-primary btn-block btn-lg" data-act="regsubmit" ${r.busy ? "disabled" : ""}>${r.busy ? "Mengirim kode…" : "Aktifkan kartu via WhatsApp →"}</button>`}
        ${r.info ? `<div class="notice small" style="margin-top:12px">${r.info}</div>` : ""}
      </div></div></div>`;
  }
  function readProfile() {
    const p = { ...(S.profile || {}) };
    PF.forEach(([k]) => { p[k] = document.getElementById("p-" + k).value.trim(); });
    p.agree = document.getElementById("p-agree").checked;
    p.ig = p.ig && !p.ig.startsWith("@") ? "@" + p.ig : p.ig;
    const bad = PF.map(([k]) => k).filter((k) => !p[k]);
    if (p.phone && !/^628\d{7,12}$/.test(window.MG.normalizePhone(p.phone))) bad.push("phone");
    if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) bad.push("email");
    if (p.ig && !/^@[A-Za-z0-9._]{1,30}$/.test(p.ig)) bad.push("ig");
    return { p, bad };
  }
  async function regSubmit() {
    const { p, bad } = readProfile();
    S.profile = { ...p, done: false, verified: false }; persist();
    if (bad.length) { S.reg = { ...S.reg, err: "Lengkapi / perbaiki: " + bad.map((k) => PF.find((x) => x[0] === k)[1]).join(", "), bad }; return render(); }
    if (!p.agree) { S.reg = { ...S.reg, err: "Centang persetujuan untuk dihubungi tim MaklonGo.", bad: [] }; return render(); }
    S.reg = { step: "form", busy: true, err: "", info: "", bad: [] }; render();
    try {
      const d = await api({ action: "otpSend", phone: p.phone });
      if (d.ok) { S.reg = { step: "otp", busy: false, err: "", info: "" }; render(); const el = document.getElementById("otpCode"); if (el) el.focus(); return; }
      const msg = d.error === "otp_not_configured" || d.error === "invalid order" ? "Verifikasi WhatsApp sedang tidak tersedia. Silakan hubungi admin." : d.error;
      S.reg = { step: "form", busy: false, err: msg || "Gagal mengirim kode", info: "" }; return render();
    } catch (e) { S.reg = { step: "form", busy: false, err: "Koneksi gagal, coba lagi.", info: "" }; render(); }
  }
  async function otpVerify() {
    const code = (document.getElementById("otpCode").value || "").replace(/\D/g, "");
    if (code.length !== 6) { S.reg = { ...S.reg, err: "Masukkan 6 digit kode" }; return render(); }
    S.reg = { ...S.reg, busy: true, err: "" }; render();
    try {
      const d = await api({ action: "otpVerify", phone: S.profile.phone, code });
      if (d.ok && d.token) return finishReg(d.token);
      S.reg = { ...S.reg, busy: false, err: d.error || "Kode salah" }; render();
    } catch (e) { S.reg = { ...S.reg, busy: false, err: "Koneksi gagal, coba lagi." }; render(); }
  }
  async function otpResend() {
    S.reg = { ...S.reg, busy: true, err: "" }; render();
    try { const d = await api({ action: "otpSend", phone: S.profile.phone }); S.reg = { ...S.reg, busy: false, err: d.ok ? "" : d.error, info: d.ok ? "Kode baru sudah dikirim." : "" }; }
    catch (e) { S.reg = { ...S.reg, busy: false, err: "Koneksi gagal, coba lagi." }; }
    render();
  }
  async function finishReg(token) {
    S.profile = { ...S.profile, phone: window.MG.normalizePhone(S.profile.phone), verified: true, done: true, token, at: new Date().toISOString() };
    const pr = S.profile;
    S.customer = { ...S.customer, name: pr.name, phone: pr.phone, email: pr.email, brand: pr.brand, ig: pr.ig };
    persist();
    api({ action: "lead", lead: { name: pr.name, phone: pr.phone, email: pr.email, ig: pr.ig, brand: pr.brand } }).catch(() => {});
    S.reg = { ...S.reg, busy: true, err: "", info: "Memuat daftar harga…" }; render();
    if (await loadPrices()) { S.reg = { step: "form", busy: false, err: "", info: "" }; toast("Nomor WhatsApp terverifikasi ✓"); go("home"); }
  }
  // Ambil harga dengan token akses; token tidak sah / kedaluwarsa → kembali ke verifikasi
  async function loadPrices() {
    try {
      const d = await api({ action: "pricelist", token: S.profile && S.profile.token });
      if (d.ok && d.prices) { setPrices(d.prices); return true; }
      S.profile = { ...(S.profile || {}), done: false, token: null, verified: false }; persist();
      S.reg = { step: "form", busy: false, err: d.error === "unauthorized" ? "Sesi verifikasi berakhir, silakan verifikasi ulang nomor WhatsApp." : (d.error || "Gagal memuat harga"), info: "" };
    } catch (e) { S.reg = { step: "form", busy: false, err: "Gagal memuat harga. Periksa koneksi lalu muat ulang halaman.", info: "" }; }
    render(); return false;
  }

  // Ilustrasi lini produksi (SVG animasi ringan; diam jika pengguna memilih kurangi animasi)
  function factoryScene() {
    const bottle = (x, c) => `<g transform="translate(${x} 0)"><rect x="-9" y="214" width="18" height="34" rx="5" fill="#f4f8f9"/><rect x="-9" y="226" width="18" height="12" fill="${c}"/>
      <rect x="-4" y="205" width="8" height="10" rx="2" fill="#cfd8dc"/><rect x="-2" y="199" width="4" height="7" fill="#90a4ae"/></g>`;
    const tank = (x, c, d) => `<g transform="translate(${x} 0)">
      <rect x="-52" y="40" width="104" height="128" rx="14" fill="url(#steel)" stroke="#9fb3ba" stroke-width="1.5"/>
      <ellipse cx="0" cy="40" rx="52" ry="10" fill="#dfe8eb" stroke="#9fb3ba"/>
      <rect x="-30" y="70" width="60" height="70" rx="8" fill="#0d2a30" stroke="#6f8a91" stroke-width="2"/>
      <clipPath id="win${x}"><rect x="-28" y="72" width="56" height="66" rx="6"/></clipPath>
      <g clip-path="url(#win${x})"><g class="fx-wave" style="animation-delay:${d}s"><path d="M-90 98 q15 -8 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 v60 h-180z" fill="${c}" opacity=".95"/></g>
        <circle class="fx-bubble" cx="-10" cy="130" r="3" fill="#fff" opacity=".6"/><circle class="fx-bubble b2" cx="12" cy="132" r="2" fill="#fff" opacity=".5"/></g>
      <line x1="0" y1="20" x2="0" y2="110" stroke="#78909c" stroke-width="3"/><rect x="-14" y="10" width="28" height="14" rx="3" fill="#455a64"/>
      <g class="fx-spin" style="transform-origin:0px 110px"><rect x="-16" y="108" width="32" height="4" rx="2" fill="#b0bec5"/></g>
      <circle cx="38" cy="56" r="9" fill="#fff" stroke="#9fb3ba"/><line class="fx-needle" x1="38" y1="56" x2="38" y2="49" stroke="#e53935" stroke-width="2" style="transform-origin:38px 56px"/>
      <rect x="-40" y="168" width="10" height="26" fill="#90a4ae"/><rect x="30" y="168" width="10" height="26" fill="#90a4ae"/>
      <circle class="fx-led" cx="-38" cy="52" r="3.5" fill="#4ade80"/></g>`;
    const bottles = [0, 70, 140, 210, 280, 350, 420, 490, 560, 630, 700].map((x, i) => bottle(x, ["#11bab5", "#f4c24f", "#ff8a80", "#9575cd"][i % 4])).join("");
    return `<svg class="fx" viewBox="0 0 800 270" role="img" aria-label="Ilustrasi lini produksi pabrik skincare">
      <defs><linearGradient id="steel" x1="0" x2="1"><stop offset="0" stop-color="#b8c7cc"/><stop offset=".35" stop-color="#f4f8f9"/><stop offset=".6" stop-color="#cfdade"/><stop offset="1" stop-color="#9fb1b7"/></linearGradient>
        <linearGradient id="belt" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#37474f"/><stop offset="1" stop-color="#1c262b"/></linearGradient></defs>
      ${tank(110, "#11bab5", 0)}${tank(250, "#f4c24f", -1.2)}${tank(390, "#ff8a80", -2.1)}
      <path d="M110 194 V200 H560 V176" fill="none" stroke="#90a4ae" stroke-width="7" stroke-linejoin="round"/><path d="M250 194 V200 M390 194 V200" stroke="#90a4ae" stroke-width="7"/>
      <rect x="520" y="120" width="90" height="56" rx="8" fill="#263238" stroke="#4f646c"/><rect x="532" y="132" width="40" height="18" rx="3" fill="#0f3d3a"/>
      <text x="552" y="145" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="10" fill="#4ade80" class="fx-count">FILL</text>
      <circle class="fx-led" cx="590" cy="140" r="4" fill="#f4c24f"/><rect x="556" y="176" width="10" height="20" fill="#78909c"/>
      <circle class="fx-drop" cx="561" cy="200" r="3" fill="#11bab5"/>
      <rect x="660" y="96" width="110" height="70" rx="8" fill="#263238" stroke="#4f646c"/><text x="715" y="118" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="9" fill="#90a4ae">QC · LABEL</text>
      <rect x="676" y="128" width="78" height="8" rx="4" fill="#37474f"/><rect class="fx-prog" x="676" y="128" width="78" height="8" rx="4" fill="#11bab5"/>
      <rect x="676" y="144" width="30" height="10" rx="3" fill="#4ade80" opacity=".8"/>
      <g class="fx-belt-wrap"><rect x="0" y="246" width="800" height="16" rx="8" fill="url(#belt)"/>
        ${Array.from({ length: 21 }, (_, i) => `<circle cx="${i * 40 + 10}" cy="254" r="5" fill="#546e7a"/>`).join("")}
        <g class="fx-belt"><g>${bottles}</g><g transform="translate(-770 0)">${bottles}</g></g></g>
    </svg>`;
  }

  function viewHome() {
    return `<section class="fx-hero">
      <div class="fx-copy">
        <span class="fx-tag">● LINI PRODUKSI AKTIF · harga transparan</span>
        <h1>Selamat datang di <span>pabrik</span> brand kamu</h1>
        <p>Rancang produk skincare & personal care mulai ${MOQ} pcs. Pilih formula, bahan aktif dan kemasan — harga setiap komponen langsung terlihat. Makin banyak produksi, makin murah.</p>
        <div class="tp-entry">
          <button class="tp-entry-card" data-go="budget"><span class="ico">🎯</span><b>Saya punya budget</b><span>Masukkan budget per pcs, kami siapkan rekomendasi formula, kemasan & jumlah produksi.</span><em>Mulai →</em></button>
          <button class="tp-entry-card" data-start-build><span class="ico">🧪</span><b>Rakit sendiri</b><span>Masuk ke lini produksi: pilih base, bahan aktif dan kemasan sendiri.</span><em>Masuk lini →</em></button>
        </div>
      </div>
      <div class="fx-stage">${factoryScene()}</div>
    </section>
    <section class="card tp-tiers">
      <div class="st-head"><span class="st-no">📊</span><div><small>PAPAN KAPASITAS PRODUKSI</small><h3>Harga bertingkat: makin banyak, makin murah</h3></div></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Jumlah produksi</th><th class="num">Harga base</th><th class="num">Sticker / pcs</th><th class="num">BPOM & Lab</th><th class="num">Halal</th></tr></thead>
        <tbody>${TIERS.map((t, i) => `<tr><td><b>${tierLabel(t, i)}</b></td><td class="num">${t.base < 1 ? `hemat ${Math.round((1 - t.base) * 100)}%` : "normal"}</td>
          <td class="num">${rp(t.sticker)}</td><td class="num">${t.bpom ? rp(t.bpom) : '<b class="ok">GRATIS</b>'}</td><td class="num">${rp(t.halal)}</td></tr>`).join("")}
          <tr><td><b>&gt; ${MAXQ.toLocaleString("id-ID")} pcs</b></td><td class="num" colspan="4">Hubungi admin</td></tr></tbody>
      </table></div>
      <p class="small muted" style="margin:8px 0 0">Harga bahan aktif & kemasan juga turun di jumlah produksi yang lebih besar. Sample ${rp(PP.fees.sample)} / SKU (incl. PPN).</p>
      ${nego()}
    </section>`;
  }

  function viewBudget() {
    const q = S.q;
    const cats = C.baseCategories.map((c) => `<button class="chip ${q.cat === c.id ? "active" : ""}" data-qcat="${c.id}">${c.icon || ""} ${esc(c.name)}</button>`).join("");
    const concerns = [{ id: "", name: "Tanpa bahan aktif tambahan" }, ...C.activeCategories].map((c) =>
      `<button class="chip ${q.concern === c.id ? "active" : ""}" data-qconcern="${c.id}">${esc(c.name)}</button>`).join("");
    return `<div class="tp-narrow">
      <h2 class="tp-h"><small>RUANG PERENCANAAN</small>Cari produk dari budget</h2>
      <p class="muted">Isi budget per pcs (sudah termasuk biaya BPOM & Halal yang dibagi ke semua pcs). Kami hitung kombinasi dan jumlah order yang paling pas.</p>
      <div class="card">
        <div class="field"><label>1. Kategori produk</label><div class="chips" style="margin:0">${cats}</div></div>
        <div class="field"><label for="qPer">2. Budget per pcs (Rp) <span class="req">*</span></label>
          <input id="qPer" type="number" inputmode="numeric" min="0" step="1000" placeholder="Contoh: 75000" value="${esc(q.perPcs)}">
          <div class="hint">Harga modal per pcs yang kamu inginkan.</div></div>
        <div class="field ${S.ui.needFees ? "invalid" : ""}" id="f-fees"><label>Apakah budget per pcs itu <u>sudah termasuk</u> biaya BPOM & Halal? <span class="req">*</span></label>
          <div class="tp-packopts">
            <label class="tp-act ${q.feesIncl === true ? "on" : ""}"><input type="radio" name="qFees" value="1" data-qfees="1" ${q.feesIncl === true ? "checked" : ""} hidden><span class="check">${q.feesIncl === true ? "✓" : ""}</span><span class="n"><b>Sudah termasuk</b><br><span class="small muted">BPOM & Halal dibagi ke semua pcs</span></span></label>
            <label class="tp-act ${q.feesIncl === false ? "on" : ""}"><input type="radio" name="qFees" value="0" data-qfees="0" ${q.feesIncl === false ? "checked" : ""} hidden><span class="check">${q.feesIncl === false ? "✓" : ""}</span><span class="n"><b>Belum termasuk</b><br><span class="small muted">BPOM & Halal dibayar terpisah per SKU</span></span></label>
          </div>
          <div class="hint">BPOM & Lab ${rp(TIERS[0].bpom)} (gratis mulai 1.000 pcs) + Halal ${rp(TIERS[0].halal)} per SKU.</div>
          ${S.ui.needFees ? '<div class="err">Pilih salah satu dulu.</div>' : ""}</div>
        <div class="field"><label for="qTot">Total budget (Rp, opsional)</label>
          <input id="qTot" type="number" inputmode="numeric" min="0" step="100000" placeholder="Contoh: 15000000" value="${esc(q.total)}">
          <div class="hint">Jika diisi, jumlah pcs dihitung agar muat di total budget ini (mengikuti pilihan termasuk / belum termasuk BPOM & Halal di atas).</div></div>
        <div class="field"><label>3. Fokus manfaat (opsional)</label><div class="chips" style="margin:0">${concerns}</div></div>
        <div class="field" style="margin-bottom:6px"><label>4. Mau lebih hemat?</label>
          <label class="checkrow ${q.ownPack ? "on" : ""}"><input type="checkbox" data-qopt="ownPack" ${q.ownPack ? "checked" : ""}><span><b>Saya bawa kemasan sendiri</b><span class="small muted">Biaya kemasan tidak dihitung.</span></span></label>
          <label class="checkrow ${q.ownSticker ? "on" : ""}" style="margin-top:8px"><input type="checkbox" data-qopt="ownSticker" ${q.ownSticker ? "checked" : ""}><span><b>Saya bawa sticker / label sendiri</b><span class="small muted">Hemat ${rp(stickerP(MOQ))} / pcs (order ${MOQ}–499 pcs).</span></span></label>
        </div>
        <button class="btn btn-primary btn-block btn-lg" data-act="recommend" style="margin-top:12px">Lihat rekomendasi →</button>
        ${nego()}
      </div></div>`;
  }

  // Gambaran harga bertingkat: dari qty pilihan sampai 25.000 pcs, dengan batang perbandingan
  function ladderHtml(d, compact) {
    const cur = priceOf(d);
    const rows = ladder(Number(d.qty) || MOQ).map((n) => ({ n, p: priceOf(d, n) }));
    const max = Math.max(...rows.map((r) => per(r.p)));
    const last = rows[rows.length - 1];
    const gap = per(cur) - per(last.p);
    const pct = (p) => Math.max(0, Math.round((1 - per(p) / per(cur)) * 100));
    const head = rows.length > 1
      ? `<div class="tp-gap">Pesan <b>${last.n.toLocaleString("id-ID")} pcs</b> = <b>${rp(per(last.p))}/pcs</b>, <b class="ok">${pct(last.p)}% lebih murah</b> dari ${cur.qty.toLocaleString("id-ID")} pcs (selisih ${rp(gap)}/pcs)</div>` : "";
    return `<div class="tp-ladder ${compact ? "compact" : ""}">
      ${compact ? "" : "<h4>📉 Harga bertingkat: makin banyak, makin murah</h4>"}${head}
      <div class="tp-ladrows">${rows.map(({ n, p }) => `<div class="tp-ladrow ${n === cur.qty ? "cur" : ""}" ${compact ? "" : `data-ladq="${n}"`} title="Total ${rp(p.total)}">
        <span class="q">${n.toLocaleString("id-ID")} pcs</span>
        <span class="bar"><i style="width:${Math.max(4, (per(p) / max) * 100)}%"></i></span>
        <span class="v">${rp(per(p))}</span>
        <span class="h">${n === cur.qty ? (compact ? "" : "pilihanmu") : `−${pct(p)}%`}</span></div>`).join("")}</div>
      ${compact ? "" : `<div class="small muted">Harga per pcs ${inclFees() ? "sudah termasuk BPOM & Halal" : "di luar BPOM & Halal (dibayar terpisah per SKU)"}. Klik baris untuk memakai jumlah tersebut. Di atas ${MAXQ.toLocaleString("id-ID")} pcs hubungi admin.</div>`}</div>`;
  }

  function recCard(r, i) {
    const p = r.pr, d = { ...r.d, qty: r.qty };
    const lines = [
      [`Base · ${esc(r.b.name)} ${vlabel(r.v)} ${r.b.unit}`, p.base],
      ...p.acts.map((a) => [`+ ${esc(a.name)} (1%)`, a.v]),
      [r.pack ? `Kemasan · ${esc(r.pack.code)} ${esc(r.pack.name)}` : "Kemasan · bawa sendiri", p.pack],
      [r.ownSticker ? "Sticker · bawa sendiri" : "Sticker / label", p.sticker],
    ];
    return `<div class="tp-rec ${r.fit ? "" : "nofit"}">
      <div class="tp-rec-head">
        ${r.pack ? `<img src="${img(r.pack.img)}" alt="" loading="lazy">` : '<span class="tp-ownpack">📦<small>kemasan<br>kamu</small></span>'}
        <div><span class="badge ${r.badgeCls || ""}">${r.badge || (i === 0 && r.fit ? "⭐ Paling pas" : esc((IDX.baseCats[r.b.cat] || {}).name || ""))}</span>
          <h3>${esc(r.b.name)}</h3><div class="small muted">${esc(r.b.form)} · ${vlabel(r.v)} ${r.b.unit}${r.b.actives && r.b.actives.length ? " · sudah mengandung " + esc(r.b.actives.slice(0, 3).join(", ")) : ""}</div></div>
      </div>
      <table class="tp-lines">${lines.map(([n, v]) => `<tr><td>${n}</td><td>${rp(v)}</td></tr>`).join("")}
        <tr class="sub"><td>Harga produksi / pcs</td><td>${rp(p.unit)}</td></tr>
        ${inclFees() ? `<tr><td>BPOM ${p.bpom ? "" : "(gratis) "}& Halal ÷ ${r.qty.toLocaleString("id-ID")} pcs</td><td>${rp(p.fees / r.qty)}</td></tr>
        <tr class="tot"><td>Total per pcs</td><td>${rp(p.allIn)}</td></tr>` : `<tr class="tot"><td>Harga per pcs</td><td>${rp(p.unit)}</td></tr>
        <tr><td class="small muted">+ BPOM ${p.bpom ? "" : "(gratis) "}& Halal, dibayar terpisah</td><td class="small muted">${rp(p.fees)}/SKU</td></tr>`}
      </table>
      ${r.why && r.why.length ? `<div class="tp-why"><div class="tp-why-tags">${r.why.map((w) => `<span>${w.tag}</span>`).join("")}</div><ul>${r.why.map((w) => `<li>${w.why}</li>`).join("")}</ul></div>` : ""}
      ${r.note ? `<div class="tp-rec-note">${r.note}</div>` : ""}
      ${r.alts && r.alts.length ? `<div class="tp-alts"><div class="small"><b>Opsi lain untuk produk ini</b></div>${r.alts.map((a, j) => `<button class="tp-alt" data-usealt="${i}:${j}">
        <span class="t">${(() => { const w = explain(a, S.q); const act = w.find((x) => /^🧪/.test(x.tag)); return `${w.map((x) => x.tag).join(" · ") || "Sesuai pilihan"}${act ? `<small class="r">${act.why}</small>` : ""}`; })()}</span><span class="v">${rp(per(a.pr))}/pcs<small>${a.qty.toLocaleString("id-ID")} pcs · ${rp(totOf(a.pr))}</small></span></button>`).join("")}</div>` : ""}
      <div class="tp-rec-foot">
        ${r.fit ? `<div><b>Order ${r.qty.toLocaleString("id-ID")} pcs</b> · total ${rp(p.total)}${inclFees() ? "" : " <span class='small muted'>(incl. BPOM & Halal)</span>"}</div>`
          : `<div class="flag small">Belum masuk budget, bahkan di ${MAXQ.toLocaleString("id-ID")} pcs</div>`}
        <button class="btn btn-primary btn-sm" data-userec="${i}">Pakai & atur sendiri →</button>
      </div>
      ${r.fit ? ladderHtml(d, true) : ""}</div>`;
  }

  let lastRecs = [];
  function viewResults() {
    const q = S.q, X = Number(q.perPcs) || 0;
    const bases = basesPriced().filter((b) => b.cat === q.cat);
    const plans = [];
    const misses = [];
    bases.forEach((b) => {
      const exact = planFor(b, q, { noCompromise: true });
      const flex = planFor(b, q);
      // Yang sudah masuk budget tetap diberi opsi lain yang lebih hemat / cukup produksi lebih sedikit
      if (exact && flex) exact.alts = diverse([flex, ...(flex.allAlts || [])].filter((c) => c.sig && (c.qty < exact.qty || per(c.pr) < per(exact.pr) - 500)));
      const p = exact ? { ...exact, compromise: false } : flex;
      if (p) { p.why = explain(p, q); p.compromise = !!(exact ? false : p.why.some((w) => !/^📈/.test(w.tag))); plans.push(p); }
      else misses.push(b);
    });
    const direct = plans.filter((p) => !p.compromise).sort((x, y) => (x.qty - y.qty) || (y.d.actives.length - x.d.actives.length) || (per(x.pr) - per(y.pr)));
    const adjusted = plans.filter((p) => p.compromise).sort((x, y) => (x.score - y.score) || (x.qty - y.qty));
    direct.forEach((p, i) => { if (i === 0) p.badge = "⭐ Paling pas"; });
    adjusted.forEach((p) => { p.badge = "🧠 Dengan penyesuaian"; p.badgeCls = "ok"; });
    lastRecs = [...direct, ...adjusted];
    // Jalan keluar jika ada base yang tetap belum masuk budget
    const minFor = (b) => {
      let m = null;
      volsFor(b).filter((v) => FIXED_VOL[b.id] || v >= b.vol * 0.25).forEach((v) => {
        const pr = priceOf({ baseId: b.id, vol: v, actives: [], pack: "own", sticker: "own" }, MAXQ);
        if (!m || per(pr) < m.allIn) m = { b, v, allIn: per(pr) };
      });
      return m;
    };
    const cheapest = bases.map(minFor).filter(Boolean).sort((x, y) => x.allIn - y.allIn)[0];
    const count = direct.length + adjusted.length;
    const T = Number(q.total) || 0;
    const notes = [];
    const allPlans = [...direct, ...adjusted];
    const smallest = allPlans.slice().sort((x, y) => x.qty - y.qty)[0];
    if (count && !T && smallest && smallest.qty >= 5000) notes.push(`📦 Dengan ${rp(X)}/pcs, produksi paling sedikit <b>${smallest.qty.toLocaleString("id-ID")} pcs</b> (${esc(smallest.b.name)}, total ${rp(smallest.pr.total)}). Biaya BPOM & Halal per SKU jadi ringan jika dibagi ke banyak pcs. Isi <b>total budget</b> agar kami carikan jumlah yang realistis.`);
    // Per pcs & total bertabrakan → tunjukkan apa yang bisa dengan total budget, dan total yang dibutuhkan untuk harga per pcs target
    // Bukti formula: base yang sudah mengandung bahan untuk fokus manfaat klien
    if (q.concern) {
      const ok = bases.map((b) => ({ b, hit: baseSupports(b, q.concern).hit })).filter((x) => x.hit.length).sort((x, y) => y.hit.length - x.hit.length).slice(0, 3);
      if (ok.length) notes.push(`🧪 <b>Tidak wajib tambah bahan aktif</b> — ${ok.map((x) => `${esc(x.b.name)} sudah mengandung ${x.hit.slice(0, 3).map((h) => `<b>${esc(h)}</b>`).join(", ")}`).join("; ")} untuk ${esc((IDX.activeCats[q.concern] || {}).name)}. Tanpa tambahan aktif, harga per pcs lebih ringan.`);
    }
    let byTotal = [];
    if (!count && T) {
      if (inclFees() && T < feesOf(MOQ) + 1) notes.push(`⚠️ Total ${rp(T)} belum menutup biaya wajib BPOM & Lab + Halal (${rp(feesOf(MOQ))} per SKU)${inclFees() ? "" : " yang dibayar terpisah"}. Mulai dari <b>sample (${rp(PP.fees.sample)})</b> dulu sambil menyiapkan modal produksi.`);
      byTotal = bases.map((b) => planFor(b, { ...q, perPcs: 1e9 })).filter(Boolean).sort((x, y) => per(x.pr) - per(y.pr)).slice(0, 3);
      byTotal.forEach((p) => { p.why = explain(p, q); p.badge = "💡 Sesuai total budget"; p.badgeCls = "ok"; p.compromise = true; });
      const need = bases.map((b) => planFor(b, { ...q, total: "" })).filter(Boolean).sort((x, y) => x.pr.total - y.pr.total)[0];
      if (byTotal.length) notes.push(`🧮 Dengan total ${rp(T)}, BPOM & Halal (${rp(feesOf(MOQ))}/SKU) masih terasa besar per pcs. Yang bisa kamu buat: <b>${esc(byTotal[0].b.name)}</b> ${byTotal[0].qty.toLocaleString("id-ID")} pcs seharga ${rp(per(byTotal[0].pr))}/pcs — lihat di bawah.`);
      if (need) notes.push(`🎯 Untuk mencapai ${rp(X)}/pcs, total budget yang dibutuhkan mulai <b>${rp(need.pr.total)}</b> (${esc(need.b.name)}, ${need.qty.toLocaleString("id-ID")} pcs).`);
    }
    const sh = (list, key) => (S.ui[key] ? list : list.slice(0, 6));
    const wa = (t) => window.MG.waLink(CFG.adminWhatsApp, t);
    const ideas = [
      `💬 <b>Harga bisa nego</b> — diskusikan budget & rencana bisnismu dengan tim Business Development MaklonGo. <a href="${window.MG.waLink(BD_WA, `Halo tim Business Development MaklonGo, budget saya ${rp(X)}/pcs (${inclFees() ? "sudah" : "belum"} termasuk BPOM & Halal) untuk ${(IDX.baseCats[q.cat] || {}).name || "produk"}. Mohon dibantu opsi terbaiknya.`)}" target="_blank" rel="noopener">Chat Business Development →</a>`,
      `🧴 <b>Mulai dari sample</b> (${rp(PP.fees.sample)} / SKU) untuk tes formula & pasar sebelum produksi massal.`,
      `🎯 <b>Mulai 1 SKU dulu</b>: biaya BPOM & Halal per SKU jadi tidak berlipat. Tambah varian setelah produk pertama laku.`,
      `🤝 <b>Patungan / pre-order</b>: kumpulkan pesanan reseller dulu agar jumlah produksi naik ke tier harga lebih murah.`,
    ];
    let html = `<div class="row between" style="margin:18px 0 6px"><h2 class="tp-h" style="margin:0"><small>PENASIHAT BUDGET MAKLONGO</small>Budget ${rp(X)}/pcs${q.total ? ` · total ${rp(q.total)}` : ""} <span class="tp-feetag">${inclFees() ? "termasuk BPOM & Halal" : "di luar BPOM & Halal"}</span></h2><button class="btn btn-ghost btn-sm" data-go="budget">← Ubah budget</button></div>
      <div class="card tp-advisor">
        <div class="adv-head"><span class="adv-ico">🧠</span><div>
          <b>${count ? `Kabar baik! Ada ${count} produk ${esc(((IDX.baseCats[q.cat] || {}).name || "").toLowerCase())} yang bisa kamu buat dengan budget ini.` : `Budget ${rp(X)}/pcs masih bisa diwujudkan — ini caranya.`}</b>
          <div class="small muted">${direct.length} langsung masuk budget${adjusted.length ? ` · ${adjusted.length} masuk budget dengan sedikit penyesuaian (kami jelaskan alasannya)` : ""}${q.concern ? ` · fokus ${esc((IDX.activeCats[q.concern] || {}).name)}` : ""}.</div></div></div>
        ${notes.map((n) => `<div class="tp-rec-note">${n}</div>`).join("")}
        ${!count && !T && cheapest ? `<div class="tp-rec-note">Budget minimal di kategori ini mulai <b>${rp(Math.ceil(cheapest.allIn / 100) * 100)}/pcs</b> (${esc(cheapest.b.name)} ${vlabel(cheapest.v)} ${cheapest.b.unit}, kemasan & sticker dari kamu, ${MAXQ.toLocaleString("id-ID")} pcs). Naikkan sedikit budget atau diskusikan dengan admin.</div>` : ""}
        <div class="adv-ideas">${ideas.map((t) => `<p>${t}</p>`).join("")}</div>
      </div>`;
    html += `<div class="tp-sim-head"><h2 class="tp-h" style="margin:0"><small>LANGSUNG MASUK BUDGET</small>Sesuai pilihanmu${q.concern ? ` (2 bahan aktif ${esc((IDX.activeCats[q.concern] || {}).name)})` : ""}${q.ownPack ? " · kemasan sendiri" : ""}${q.ownSticker ? " · sticker sendiri" : ""}</h2></div>
      <div class="tp-recs">${sh(direct, "showAll").map((r, i) => recCard(r, i)).join("") || `<div class="card muted">Belum ada yang masuk tanpa penyesuaian${count ? " — lihat rekomendasi dengan penyesuaian di bawah 👇" : "."}</div>`}</div>
      ${direct.length > 6 && !S.ui.showAll ? `<button class="btn btn-ghost load-more" data-act="showall">Tampilkan semua (${direct.length})</button>` : ""}`;
    if (byTotal.length) {
      const off = lastRecs.length; lastRecs.push(...byTotal);
      html += `<div class="tp-sim-head"><h2 class="tp-h" style="margin:0"><small>SESUAI TOTAL BUDGET ${rp(T)}</small>Yang bisa kamu produksi sekarang</h2></div>
        <div class="tp-recs">${byTotal.map((r, i) => recCard(r, off + i)).join("")}</div>`;
    }
    if (adjusted.length) html += `<div class="tp-sim-head"><h2 class="tp-h" style="margin:0"><small>MASUK BUDGET DENGAN PENYESUAIAN</small>Rekomendasi pintar untuk produk lainnya</h2>
        <p class="muted small" style="margin:4px 0 0">Kami cari kombinasi dengan kompromi paling kecil: mengurangi bahan aktif yang fungsinya sudah ada di base, ukuran trial size, sticker atau kemasan dari kamu, atau jumlah produksi yang lebih hemat.</p></div>
      <div class="tp-recs">${sh(adjusted, "showAllOwn").map((r, i) => recCard(r, direct.length + i)).join("")}</div>
      ${adjusted.length > 6 && !S.ui.showAllOwn ? `<button class="btn btn-ghost load-more" data-act="showallown">Tampilkan semua (${adjusted.length})</button>` : ""}`;
    if (misses.length && count) html += `<p class="small muted" style="margin-top:12px">Belum masuk budget walau sudah disesuaikan: ${misses.map((b) => esc(b.name)).join(", ")}. Untuk produk ini, diskusikan dengan admin.</p>`;
    html += `${nego()}<p class="small muted" style="margin-top:14px">Harga sudah termasuk bahan aktif dosis 1% per bahan, BPOM & Halal. Belum termasuk ongkos kirim & sample. Harga final mengikuti invoice resmi setelah dicek admin.</p>`;
    return html;
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
        <div class="row between" style="margin:16px 0 4px"><h2 class="tp-h" style="margin:0">Lini produksi</h2><button class="btn btn-ghost btn-sm" data-act="changebase">Ganti base</button></div>
        ${stationRail()}
        <section class="card tp-sec" id="st1">${stHead(1, "Tangki formulasi", "Base produk", true)}
          <div class="tp-basehead"><div><b>${esc(b.name)}</b><div class="small muted">${esc(b.desc || "")}</div>
          ${(b.actives || []).length ? `<div class="small" style="margin-top:4px">Sudah mengandung: ${esc(window.MG.baseActives(b, d.variant).join(", "))}</div>` : ""}</div>
          <div class="tp-price">${rp(PP.bases[b.id] * t.base)}<small>/ ${b.unit}</small></div></div>
          ${variants.length ? `<div class="chips" style="margin:10px 0 0">${variants.map((x) => `<button class="chip ${d.variant === x.name ? "active" : ""}" data-bvar="${esc(x.name)}">${esc(x.name)}</button>`).join("")}</div>` : ""}
        </section>
        <section class="card tp-sec" id="st2">${stHead(2, "Perencanaan batch", "Jumlah & volume", true)}
          <div class="field" style="margin:0 0 14px"><label for="bQty">Jumlah (pcs) · min. ${MOQ}</label>
            <div class="stepper"><button data-bqty="-10">−</button><input id="bQty" type="number" min="${MOQ}" max="${MAXQ}" step="10" value="${d.qty}"><button data-bqty="10">+</button></div>
            <div class="chips" style="margin-top:8px">${[50, 100, 300, 500, 1000, 5000, 10000, 25000].map((n) => `<button class="chip ${q === n ? "active" : ""}" data-bqtyset="${n}">${n.toLocaleString("id-ID")}</button>`).join("")}</div>
            <div class="tp-tierbadge">Harga tier <b>${tierLabel(t, ti)}</b>${TIERS[ti + 1] ? ` · pesan ${TIERS[ti + 1].min.toLocaleString("id-ID")}+ pcs untuk harga lebih murah` : ""}${q > WEBQ ? ` · order di atas ${WEBQ} pcs dibantu CS Business Development` : ""}</div></div>
          <label style="font-weight:700;font-size:13.5px">Volume per produk</label>
          <div class="vol-grid" style="margin-top:6px">${volChips}</div>
        </section>
        <section class="card tp-sec" id="st3">${stHead(3, "Lab bahan aktif", "Bahan aktif tambahan", d.actives.length ? true : "opsional")}
          <p class="small muted" style="margin:-4px 0 10px">Dosis 1% per bahan · harga per pcs untuk ${vlabel(v)} ${b.unit} @ ${q.toLocaleString("id-ID")} pcs</p>
          <div class="chips">${actCats.map((c) => `<button class="chip ${S.ui.actCat === c.id ? "active" : ""}" data-bactcat="${c.id}">${esc(c.name)}</button>`).join("")}</div>
          <div class="tp-acts">${acts.map((a) => { const on = d.actives.includes(a.id); return `<button class="tp-act ${on ? "on" : ""}" data-bact="${a.id}"><span class="check">${on ? "✓" : ""}</span><span class="n">${esc(a.name)}</span><span class="p">+${rp(actP(a.id, v, q))}</span></button>`; }).join("")}</div>
        </section>
        <section class="card tp-sec" id="st4">${stHead(4, "Filling & kemasan", `Kemasan ${vlabel(v)} ${b.unit}`, !!d.pack)}
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
        <section class="card tp-sec" id="st5">${stHead(5, "Labeling, legal & QC", "Sticker, legalitas & sample", true)}
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

  const stHead = (n, station, title, ok) => `<div class="st-head"><span class="st-no">0${n}</span><div><small>STASIUN ${station.toUpperCase()}</small><h3>${title}</h3></div>
    <span class="st-ok ${ok === true ? "on" : ""}">${ok === true ? "✓ siap" : ok === "opsional" ? "opsional" : "belum"}</span></div>`;
  function stationRail() {
    const d = S.d;
    const st = [["Formulasi", true], ["Batch", true], ["Lab aktif", d.actives.length ? true : "opt"], ["Filling", !!d.pack], ["Label/QC", true]];
    return `<nav class="st-rail">${st.map(([n, ok], i) => `<a href="#st${i + 1}" class="${ok === true ? "on" : ok === "opt" ? "opt" : ""}"><i>0${i + 1}</i><span>${n}</span></a>`).join('<b class="st-pipe"></b>')}</nav>`;
  }
  const canSave = (d) => d.pack && Number(d.qty) >= MOQ && Number(d.qty) <= MAXQ;
  function summaryHtml() {
    const d = S.d, b = IDX.bases[d.baseId], c = priceOf(d), X = Number(S.q.perPcs) || 0;
    const pk = d.pack && d.pack !== "own" && d.pack !== "admin" ? IDX.packaging[d.pack] : null;
    const cv = per(c);
    const pct = X ? Math.min(100, (cv / X) * 100) : 0;
    return `<div class="card tp-sum wo">
      <div class="wo-head"><div><small>WORK ORDER · ESTIMASI</small><b>WO-${esc(d.baseId)}-${vlabel(d.vol)}${b.unit.toUpperCase()}-${String(c.qty).padStart(5, "0")}</b></div><span class="wo-stamp">${c.qty.toLocaleString("id-ID")} pcs</span></div>
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
      ${X ? `<div class="tp-meter ${cv > X ? "over" : ""}"><div style="width:${pct}%"></div></div>
        <div class="small ${cv > X ? "flag" : "muted"}">${cv > X ? `Lebih ${rp(cv - X)}/pcs dari budget ${rp(X)}` : `Masih di bawah budget ${rp(X)}/pcs (sisa ${rp(X - cv)})`} · budget ${inclFees() ? "termasuk" : "di luar"} BPOM & Halal</div>` : ""}
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
    return `<h2 class="tp-h" style="margin-top:18px"><small>STASIUN 01 · TANGKI FORMULASI</small>Pilih base produk</h2>
      <div class="chips">${C.baseCategories.map((c) => `<button class="chip ${cat === c.id ? "active" : ""}" data-pickcat="${c.id}">${c.icon || ""} ${esc(c.name)}</button>`).join("")}</div>
      <div class="tp-bases">${list.map((b) => `<button class="option" data-pickbase="${b.id}"><div class="row between" style="align-items:flex-start;flex-wrap:nowrap"><div><div class="title">${esc(b.name)}</div><div class="sub">${esc(b.form)} · ${esc(b.desc || "")}</div></div>
        <div class="tp-price">${rp(baseP(b, b.vol))}<small>${vlabel(b.vol)} ${b.unit}</small></div></div></button>`).join("")}</div>`;
  }

  function viewCart() {
    const sum = S.cart.reduce((s, d) => s + priceOf(d).total, 0);
    return `<div class="tp-narrow"><h2 class="tp-h" style="margin-top:18px"><small>ANTREAN PRODUKSI</small>SKU saya</h2>
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
    const pr = S.profile;
    return `<div class="tp-narrow"><h2 class="tp-h" style="margin-top:18px"><small>KIRIM PERMINTAAN PENAWARAN</small>Data pemesan</h2><div class="card">
      <dl class="kv" style="margin:0 0 14px"><dt>Nama</dt><dd>${esc(pr.name)}</dd><dt>WhatsApp</dt><dd>+${esc(pr.phone)} ${pr.verified ? '<span class="tag green">terverifikasi</span>' : ""}</dd>
        <dt>Email</dt><dd>${esc(pr.email)}</dd><dt>Instagram</dt><dd>${esc(pr.ig)}</dd><dt>Brand</dt><dd>${esc(pr.brand)}</dd></dl>
      ${f("city", "Kota")}
      <div class="field"><label for="c-brandNote">Konsep brand <span class="req">*</span></label><textarea id="c-brandNote" placeholder="Target pasar, konsep, kisaran harga jual…">${esc(c.brandNote || "")}</textarea></div>
      <div class="notice small">Harga di web adalah estimasi berdasarkan harga katalog dan <b>bisa nego / disesuaikan kembali</b> bersama admin. Invoice & MoU resmi dikirim via WhatsApp. DP 50%, pelunasan + ongkir setelah NIE BPOM terbit.${big ? ` Pesanan di atas ${WEBQ} pcs dikirim ke <b>CS Business Development MaklonGo</b>.` : ""}</div>
      <button class="btn btn-primary btn-block btn-lg" data-act="send" style="margin-top:14px">Kirim permintaan penawaran via WhatsApp</button></div></div>`;
  }

  function viewSent() {
    return `<div class="tp-narrow card" style="margin-top:24px;text-align:center"><h2>Permintaan penawaran terkirim 🎉</h2><p class="muted">No. order <b>${esc(S.lastId || "")}</b>. Admin akan mengirim invoice & MoU melalui WhatsApp.</p>
      <button class="btn btn-ghost" data-go="home">Kembali ke awal</button></div>`;
  }

  function render() {
    const views = { home: viewHome, budget: viewBudget, results: viewResults, build: viewBuild, cart: viewCart, customer: viewCustomer, sent: viewSent };
    app.innerHTML = registered() ? (views[S.view] || viewHome)() : viewRegister();
    const who = document.getElementById("who");
    who.classList.toggle("hidden", !registered());
    if (registered()) who.innerHTML = `✅ ${esc(S.profile.name.split(" ")[0])} · <u>ubah</u>`;
    document.getElementById("btnBudget").classList.toggle("hidden", !registered());
    document.getElementById("cartPill").classList.toggle("hidden", !S.cart.length || !registered());
    document.getElementById("cartCount").textContent = S.cart.length;
    renderBar();
  }
  // Ringkasan mengambang saat merakit
  function renderBar() {
    const show = registered() && S.view === "build" && IDX.bases[S.d.baseId];
    bar.classList.toggle("hidden", !show);
    document.body.classList.toggle("has-tpbar", !!show);
    if (!show) return;
    const c = priceOf(S.d), X = Number(S.q.perPcs) || 0;
    bar.innerHTML = `<div class="container wide"><div><div class="small muted">${inclFees() ? "Per pcs (incl. BPOM & Halal)" : "Per pcs (di luar BPOM & Halal)"}</div><b class="${X && per(c) > X ? "flag" : ""}">${rp(per(c))}</b>${X ? `<span class="small muted"> / budget ${rp(X)}</span>` : ""}</div>
      <div style="text-align:right"><div class="small muted">Total ${c.qty.toLocaleString("id-ID")} pcs</div><b>${rp(c.total)}</b></div>
      <button class="btn btn-primary btn-sm" data-act="savesku" ${canSave(S.d) ? "" : "disabled"}>Simpan</button></div>`;
  }
  function rerenderBuild() { const y = scrollY; render(); scrollTo(0, y); }

  /* ------------------------------------------------------------ aksi */
  function useRec(r) {
    S.d = { ...emptyDraft(), baseId: r.b.id, vol: r.v, qty: r.qty, actives: [...r.d.actives],
      pack: r.pack ? r.pack.id : "own", sticker: r.ownSticker ? "own" : "ours", variant: ((r.b.variants || [])[0] || {}).name || "" };
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
  // Catat pesanan ke Google Sheet + invoice PDF otomatis (antre di browser, dikirim ulang bila gagal)
  function toOrderItem(d) {
    const b = IDX.bases[d.baseId] || {}, pk = d.pack && IDX.packaging[d.pack] ? d.pack : null;
    return { baseId: d.baseId, variant: d.variant || "", vol: d.vol, qty: Number(d.qty), unit: b.unit || "ml", actives: [...(d.actives || [])], customActives: "",
      packagingId: pk, noPackaging: !pk, ownPackaging: d.pack === "own", packagingNote: d.pack === "own" ? "Customer bawa kemasan sendiri" : "",
      productName: d.productName || b.name, sticker: d.sticker !== "own", ownSticker: d.sticker === "own", bpom: true, halal: true, sample: !!d.sample };
  }
  let flushing = false;
  async function flushPending() {
    if (flushing || !CFG.orderEndpoint) return;
    flushing = true;
    try {
      for (const p of store.get("mgt_pending", [])) {
        let ok = false;
        try { const d = await api(p.body); ok = !!(d && d.ok); } catch (e) { ok = false; }
        const q = store.get("mgt_pending", []);
        store.set("mgt_pending", ok ? q.filter((x) => x.id !== p.id) : q.map((x) => (x.id === p.id ? { ...x, tries: x.tries + 1 } : x)).filter((x) => x.tries < 30));
      }
    } finally { flushing = false; }
  }
  function recordOrder(id, c) {
    const order = { id, createdAt: new Date().toISOString(), catalogVersion: C.version, source: "pricelist",
      customer: { name: c.name, phone: c.phone, email: c.email, ig: c.ig, city: c.city, brand: c.brand, brandNote: c.brandNote, notes: "Order dari web pricelist (harga transparan)" },
      items: S.cart.map(toOrderItem) };
    const body = { order: window.MG.enrichOrder(order), packed: window.MG.packOrder(order), token: S.profile.token };
    const q = store.get("mgt_pending", []); q.push({ id, body, tries: 0 }); store.set("mgt_pending", q);
    flushPending();
  }

  function send() {
    const c = S.customer;
    Object.assign(c, { name: S.profile.name, phone: S.profile.phone, email: S.profile.email, brand: S.profile.brand, ig: S.profile.ig });
    const need = ["city", "brandNote"].filter((k) => !String(c[k] || "").trim());
    if (need.length) { toast("Lengkapi: " + need.join(", ")); return; }
    const id = window.MG.newOrderId();
    const big = S.cart.some((d) => Number(d.qty) > WEBQ);
    const L = [`*ORDER MAKLON (HARGA TRANSPARAN) — ${CFG.appName}*`, `No. Order: *${id}*`, "", "*Data Customer*", `Nama: ${c.name}`, `HP/WA: ${c.phone}${S.profile.verified ? " (terverifikasi OTP)" : ""}`, `Email: ${c.email}`, `Instagram: ${c.ig || "-"}`, `Kota: ${c.city}`, `Nama Brand: ${c.brand}`, `Catatan Brand: ${c.brandNote}`];
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
    recordOrder(id, c);
    S.lastId = id; S.cart = []; go("sent");
    const w = window.open(wa, "_blank"); if (!w) location.href = wa;
  }

  document.getElementById("waFloat").href = window.MG.waLink(CFG.adminWhatsApp, "Halo admin MaklonGo, saya ingin tanya tentang maklon (web harga transparan).");
  document.addEventListener("click", (e) => {
    const lq = e.target.closest("[data-ladq]");
    if (lq && S.view === "build") { S.d.qty = Number(lq.dataset.ladq); persist(); return rerenderBuild(); }
    if (e.target.closest("#who")) {
      if (!confirm("Ubah data diri? Nomor WhatsApp perlu diverifikasi ulang.")) return;
      S.reg = { step: "form", busy: false, err: "", info: "" }; S.profile = { ...S.profile, done: false, token: null }; persist(); return render();
    }
    const t = e.target.closest("button, [data-go]");
    if (!t || t.disabled) return;
    const ds = t.dataset, d = S.d;
    if (!registered() && !["regsubmit", "otpverify", "otpresend", "otpback"].includes(ds.act)) { e.preventDefault(); return; }
    if (ds.go) { e.preventDefault(); return go(ds.go); }
    if (ds.startBuild !== undefined) { S.d = emptyDraft(); S.ui.pickCat = S.q.cat; return go("build"); }
    if (ds.qcat) { S.q.cat = ds.qcat; persist(); return rerenderBuild(); }
    if (ds.qconcern !== undefined) { S.q.concern = ds.qconcern; persist(); return rerenderBuild(); }
    if (ds.userec) return useRec(lastRecs[+ds.userec]);
    if (ds.usealt) { const [i, j] = ds.usealt.split(":").map(Number); return useRec(lastRecs[i].alts[j]); }
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
        if (S.q.feesIncl !== true && S.q.feesIncl !== false) { S.ui.needFees = true; rerenderBuild(); document.getElementById("f-fees").scrollIntoView({ block: "center" }); return; }
        S.ui.needFees = false;
        S.ui.showAll = false; S.ui.showAllOwn = false; return go("results");
      }
      case "showall": S.ui.showAll = true; return rerenderBuild();
      case "showallown": S.ui.showAllOwn = true; return rerenderBuild();
      case "changebase": S.ui.pickCat = (IDX.bases[d.baseId] || {}).cat; d.baseId = null; return go("build");
      case "morepack": S.ui.packLimit += 24; return rerenderBuild();
      case "savesku": return saveSku();
      case "send": return send();
      case "regsubmit": return regSubmit();
      case "otpverify": return otpVerify();
      case "otpresend": return otpResend();
      case "otpback": S.reg = { step: "form", busy: false, err: "", info: "" }; return render();
    }
  });
  document.addEventListener("change", (e) => {
    const t = e.target, d = S.d;
    if (t.dataset.qfees) { S.q.feesIncl = t.dataset.qfees === "1"; S.ui.needFees = false; S.q.perPcs = document.getElementById("qPer").value; S.q.total = document.getElementById("qTot").value; persist(); return rerenderBuild(); }
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
    if (t.id === "otpCode" && t.value.replace(/\D/g, "").length === 6 && !S.reg.busy) otpVerify();
  });

  if (!["home", "budget", "results", "build", "cart", "customer"].includes(S.view)) S.view = "home";
  flushPending();
  addEventListener("online", flushPending);
  if (S.profile && S.profile.done && S.profile.token) {
    app.innerHTML = '<div class="tp-narrow card" style="margin-top:30px;text-align:center">Memuat daftar harga…</div>';
    loadPrices().then((ok) => { if (ok) render(); });
  } else render();
})();
