/* MaklonGo — aplikasi customer (tanpa harga) */
(function () {
  const { C, CFG, IDX, esc, store, toast } = window.MG;
  const MOQ = CFG.moq || 50;
  const STEPS = ["base", "size", "actives", "pack", "legal", "sample"];
  const STEP_TITLES = { base: "Base Produk", size: "Ukuran & Jumlah", actives: "Bahan Aktif", pack: "Kemasan", legal: "Legalitas", sample: "Sample" };
  const PAGE = 24;

  const app = document.getElementById("app");
  const bar = document.getElementById("actionbar");
  const btnBack = document.getElementById("btnBack");
  const btnNext = document.getElementById("btnNext");
  const barSummary = document.getElementById("barSummary");

  const emptyDraft = () => ({ baseId: null, variant: "", vol: null, qty: MOQ, actives: [], customActives: "", packagingId: null,
    noPackaging: false, packagingNote: "", productName: "", sticker: false, bpom: false, halal: false, sample: null, editIndex: null });

  const saved = store.get("mg_state", null);
  const S = Object.assign({ view: "home", draft: emptyDraft(), cart: [], customer: {}, lastOrder: null },
    saved && saved.catalogVersion === C.version ? saved : {});
  const ui = { baseCat: "all", baseQ: "", actCat: "all", actQ: "", packFilter: "match", packType: "all", packQ: "", packLimit: PAGE };

  const persist = () => store.set("mg_state", { ...S, catalogVersion: C.version });
  const icon = { check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' };

  const base = () => IDX.bases[S.draft.baseId];
  const unit = () => (base() ? base().unit : "ml");
  const norm = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ");

  function go(view) {
    S.view = view;
    persist();
    render();
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  /* ------------------------------------------------------------ views */
  function viewHome() {
    const hasCart = S.cart.length > 0;
    return `
    <section class="hero">
      <img class="hero-logo" src="assets/img/logo.png" alt="MaklonGo by SAINSGO" width="250" height="54">
      <span class="highlight">🚀 ${esc(CFG.tagline)}</span>
      <h1>Bikin produk <mark>brand kamu sendiri</mark> mulai ${MOQ} pcs</h1>
      <p class="lead">Pilih base produk, tambah bahan aktif, dan pilih kemasan. Kirim pesanan ke admin lewat WhatsApp — invoice dikirim menyusul.</p>
      <button class="btn btn-primary btn-lg" data-go="base">Mulai Buat Produk →</button>
      ${hasCart ? `<div style="margin-top:12px"><button class="link-btn" data-go="cart">Lanjutkan ${S.cart.length} SKU yang tersimpan</button></div>` : ""}
      <div class="hero-steps">
        <div class="hero-step"><span class="n">1</span><b>Pilih Base</b>${C.bases.length} base skincare & personal care siap pakai</div>
        <div class="hero-step"><span class="n">2</span><b>Bahan Aktif</b>Tambah ${C.actives.length}+ bahan aktif sesuai kebutuhan</div>
        <div class="hero-step"><span class="n">3</span><b>Kemasan</b>${C.packaging.length}+ pilihan botol, pump, spray & pot</div>
        <div class="hero-step"><span class="n">4</span><b>Kirim ke WA</b>Dapat nomor order, invoice menyusul</div>
      </div>
      <div class="trust"><span>MOQ ${MOQ} pcs / SKU</span><span>Bisa lebih dari 1 SKU</span><span>Termasuk BPOM & Halal</span></div>
    </section>
    <footer class="footer">© ${new Date().getFullYear()} ${esc(CFG.appName)} by SAINSGO · Maklon kosmetik qty kecil</footer>`;
  }

  function stepHead(view, sub) {
    const i = STEPS.indexOf(view);
    return `
    <div class="progress">
      <div class="progress-track"><div class="progress-bar" style="width:${((i + 1) / (STEPS.length + 1)) * 100}%"></div></div>
      <div class="progress-meta"><span>Langkah <b>${i + 1}</b> dari ${STEPS.length + 1}${S.cart.length ? ` · SKU ke-${(S.draft.editIndex ?? S.cart.length) + 1}` : ""}</span><span>${STEP_TITLES[view]}</span></div>
    </div>
    <div class="step-head"><h2>${STEP_TITLES[view]}</h2><p>${sub}</p></div>`;
  }

  function viewBase() {
    const q = norm(ui.baseQ);
    const list = C.bases.filter((b) => (ui.baseCat === "all" || b.cat === ui.baseCat) &&
      (!q || norm(`${b.name} ${b.form} ${b.desc} ${(b.actives || []).join(" ")}`).includes(q)));
    const chips = [{ id: "all", name: "Semua", icon: "" }, ...C.baseCategories].map((c) => {
      const n = c.id === "all" ? C.bases.length : C.bases.filter((b) => b.cat === c.id).length;
      return `<button class="chip ${ui.baseCat === c.id ? "active" : ""}" data-basecat="${c.id}">${c.icon ? c.icon + " " : ""}${esc(c.name)}<span class="c">${n}</span></button>`;
    }).join("");
    const items = list.map((b) => {
      const sel = S.draft.baseId === b.id;
      const variants = b.variants || [];
      const acts = IDX.bases[b.id].actives || [];
      return `
      <div class="option ${sel ? "selected" : ""}" data-base="${b.id}" role="button" tabindex="0">
        <span class="check">${sel ? icon.check : ""}</span>
        <div class="title">${esc(b.name)}</div>
        <div class="sub">${esc(b.form)} · ukuran asli ${b.vol} ${b.unit}${variants.length ? ` · ${variants.length} varian` : ""}</div>
        ${acts.length && !sel ? `<div class="tags">${acts.slice(0, 4).map((a) => `<span class="tag green">${esc(a)}</span>`).join("")}${acts.length > 4 ? `<span class="tag">+${acts.length - 4}</span>` : ""}</div>` : ""}
        ${sel ? `<div class="detail" data-stop>
          <p style="margin:0 0 10px">${esc(b.desc)}</p>
          ${acts.length ? `<h4>Base sudah mengandung bahan aktif</h4><div class="tags" style="margin-bottom:10px">${acts.map((a) => `<span class="tag green">${esc(a)}</span>`).join("")}</div>` : ""}
          ${b.aroma ? `<h4>Aroma</h4><p style="margin:0 0 10px">${esc(b.aroma)}</p>` : ""}
          ${variants.length ? `<h4>Pilih varian / aroma <span class="req" style="color:var(--danger)">*</span></h4>
            <div class="chips" style="flex-wrap:wrap">${variants.map((v) => `<button class="chip ${S.draft.variant === v.name ? "active" : ""}" data-variant="${esc(v.name)}">${esc(v.name)}</button>`).join("")}</div>
            ${(variants.find((v) => v.name === S.draft.variant) || {}).actives ? `<div class="small muted">Varian ini mengandung: ${esc(variants.find((v) => v.name === S.draft.variant).actives.join(", "))}</div>` : ""}` : ""}
        </div>` : ""}
      </div>`;
    }).join("");
    return `${stepHead("base", "Pilih produk dasar yang akan jadi produk brand kamu.")}
      <div class="chips">${chips}</div>
      <div class="search">${icon.search}<input type="search" id="baseQ" placeholder="Cari: serum, body wash, niacinamide…" value="${esc(ui.baseQ)}"></div>
      <div class="list">${items || '<p class="muted">Tidak ada base yang cocok.</p>'}</div>`;
  }

  // Hanya volume yang tersedia kemasannya
  const VOLS = [...new Set(C.packaging.filter((p) => p.vol && p.vol <= 1000).map((p) => p.vol))].sort((a, b) => a - b);
  function volumeOptions() { return VOLS; }
  // Volume kemasan terdekat dengan ukuran asli base (seri → pilih yang lebih besar)
  function defaultVol(b) {
    return VOLS.reduce((best, v) => (Math.abs(v - b.vol) < Math.abs(best - b.vol) || (Math.abs(v - b.vol) === Math.abs(best - b.vol) && v > best) ? v : best), VOLS[0]);
  }

  function viewSize() {
    const b = base();
    const vols = volumeOptions();
    const counts = {};
    C.packaging.forEach((p) => { if (p.vol) counts[p.vol] = (counts[p.vol] || 0) + 1; });
    return `${stepHead("size", `Pilih volume per produk dan jumlah yang dipesan (min. ${MOQ} pcs).`)}
      <div class="card" style="margin-bottom:14px">
        <div class="field" style="margin:0"><label>Volume per produk (${b.unit})</label>
          <div class="hint" style="margin:-2px 0 10px">Pilihan volume mengikuti ukuran kemasan yang tersedia.</div>
          <div class="vol-grid">${vols.map((v) => `<button class="vol-btn ${S.draft.vol === v ? "active" : ""}" data-vol="${v}">${v}<small>${(counts[v] || 0) + " kemasan"}${v === b.vol ? " · asli" : ""}</small></button>`).join("")}</div>
        </div>
      </div>
      <div class="card">
        <div class="field" style="margin:0"><label for="qty">Jumlah pesanan (pcs)</label>
          <div class="stepper"><button data-qty="-10" aria-label="Kurangi">−</button><input id="qty" type="number" inputmode="numeric" min="${MOQ}" step="1" value="${S.draft.qty}"><button data-qty="10" aria-label="Tambah">+</button></div>
          <div class="chips" style="margin-top:10px">${[50, 100, 200, 300, 500, 1000].map((n) => `<button class="chip ${Number(S.draft.qty) === n ? "active" : ""}" data-qtyset="${n}">${n} pcs</button>`).join("")}</div>
          <div class="err ${Number(S.draft.qty) >= MOQ ? "hidden" : ""}" id="qtyErr">Minimal order ${MOQ} pcs per SKU.</div>
        </div>
      </div>`;
  }

  function activeInBase(a) {
    const key = norm(a.name).split(" ").filter((w) => w.length > 3)[0] || norm(a.name);
    return base() && window.MG.baseActives(base(), S.draft.variant).some((x) => norm(x).includes(key));
  }

  function viewActives() {
    const b = base();
    const inBase = window.MG.baseActives(b, S.draft.variant);
    const q = norm(ui.actQ);
    const list = C.actives.filter((a) => (ui.actCat === "all" || ui.actCat === "selected" ? true : a.cats.includes(ui.actCat)) &&
      (ui.actCat !== "selected" || S.draft.actives.includes(a.id)) && (!q || norm(a.name).includes(q)));
    const chips = [{ id: "all", name: "Semua" }, ...(S.draft.actives.length ? [{ id: "selected", name: "Dipilih" }] : []), ...C.activeCategories].map((c) => {
      const n = c.id === "all" ? C.actives.length : c.id === "selected" ? S.draft.actives.length : C.actives.filter((a) => a.cats.includes(c.id)).length;
      return `<button class="chip ${ui.actCat === c.id ? "active" : ""}" data-actcat="${c.id}">${esc(c.name)}<span class="c">${n}</span></button>`;
    }).join("");
    const catDesc = IDX.activeCats[ui.actCat];
    return `${stepHead("actives", "Opsional — tambahkan bahan aktif di luar yang sudah ada di base.")}
      ${inBase.length ? `<div class="notice green" style="margin-bottom:12px"><b>${esc(b.name)}</b> sudah mengandung: ${esc(inBase.join(", "))}</div>` : ""}
      <div class="notice" style="margin-bottom:14px">Setiap bahan aktif tambahan diformulasikan sekitar <b>1%</b> dari volume produk. Boleh pilih lebih dari satu, atau lewati langkah ini.</div>
      <div class="chips">${chips}</div>
      ${catDesc ? `<p class="small muted" style="margin:-4px 0 10px">${esc(catDesc.desc)}</p>` : ""}
      <div class="search">${icon.search}<input type="search" id="actQ" placeholder="Cari bahan aktif…" value="${esc(ui.actQ)}"></div>
      <div class="list">${list.map((a) => {
        const sel = S.draft.actives.includes(a.id);
        const dup = activeInBase(a);
        return `<button class="option multi ${sel ? "selected" : ""}" data-active="${a.id}">
          <span class="check">${sel ? icon.check : ""}</span>
          <div class="title">${esc(a.name)} ${dup ? '<span class="badge">sudah ada di base</span>' : ""}</div>
          <div class="tags">${a.cats.map((c) => `<span class="tag">${esc(IDX.activeCats[c].name)}</span>`).join("")}</div>
        </button>`;
      }).join("") || '<p class="muted">Tidak ada bahan aktif yang cocok.</p>'}</div>
      <div class="card" style="margin-top:14px">
        <div class="field" style="margin:0"><label for="customActives">Request bahan aktif lain (opsional)</label>
          <textarea id="customActives" placeholder="Contoh: Retinol, Alpha Arbutin, Centella 2%…">${esc(S.draft.customActives)}</textarea>
          <div class="hint">Admin akan cek ketersediaan & menghubungi kamu.</div></div>
      </div>`;
  }

  function packList() {
    const q = norm(ui.packQ);
    return C.packaging.filter((p) => {
      if (ui.packFilter === "match" && p.vol !== S.draft.vol) return false;
      if (ui.packType === "new" ? !p.new : ui.packType !== "all" && p.type !== ui.packType) return false;
      if (q && !norm(`${p.code} ${p.name} ${p.variasi} ${p.vol || ""}`).includes(q)) return false;
      return true;
    });
  }

  function viewPack() {
    const matchCount = C.packaging.filter((p) => p.vol === S.draft.vol).length;
    if (ui.packFilter === "match" && !matchCount) ui.packFilter = "all";
    const list = packList();
    const typePool = C.packaging.filter((p) => ui.packFilter !== "match" || p.vol === S.draft.vol);
    const typeChips = [{ id: "all", name: "Semua jenis" }, { id: "new", name: "✨ Katalog baru" }, ...C.packagingTypes].map((t) => {
      const n = t.id === "all" ? typePool.length : t.id === "new" ? typePool.filter((p) => p.new).length : typePool.filter((p) => p.type === t.id).length;
      return n ? `<button class="chip ${ui.packType === t.id ? "active" : ""}" data-packtype="${t.id}">${esc(t.name)}<span class="c">${n}</span></button>` : "";
    }).join("");
    const shown = list.slice(0, ui.packLimit);
    const none = S.draft.noPackaging;
    return `${stepHead("pack", "Pilih kemasan untuk produkmu. Semua pilihan ditampilkan beserta gambarnya.")}
      <button class="option pack-none ${none ? "selected" : ""}" data-nopack style="margin-bottom:14px">
        <span class="check">${none ? icon.check : ""}</span>
        <div class="title">Tidak ada pilihan kemasan, Admin bantu carikan yang lain</div>
        <div class="sub">Pilih ini jika belum ada kemasan yang sesuai dengan produkmu.</div>
      </button>
      <div class="chips">
        <button class="chip ${ui.packFilter === "match" ? "active" : ""}" data-packfilter="match" ${matchCount ? "" : "disabled"}>Sesuai ${S.draft.vol} ${unit()}<span class="c">${matchCount}</span></button>
        <button class="chip ${ui.packFilter === "all" ? "active" : ""}" data-packfilter="all">Semua ukuran<span class="c">${C.packaging.length}</span></button>
      </div>
      ${!matchCount ? `<div class="notice" style="margin-bottom:10px">Belum ada kemasan berukuran persis ${S.draft.vol} ${unit()}. Pilih ukuran terdekat atau minta admin carikan.</div>` : ""}
      <div class="chips">${typeChips}</div>
      <div class="search">${icon.search}<input type="search" id="packQ" placeholder="Cari kode / warna / jenis: W512, amber, airless…" value="${esc(ui.packQ)}"></div>
      <p class="small muted" style="margin:0 0 10px">${list.length} kemasan</p>
      <div class="pack-grid">${shown.map((p) => {
        const sel = !none && S.draft.packagingId === p.id;
        return `<button class="pack ${sel ? "selected" : ""}" data-pack="${p.id}">
          <div class="img"><img loading="lazy" src="${p.img || "assets/img/logo-sm.png"}" alt="${esc(p.name)}" width="320" height="320"></div>
          ${p.vol ? `<span class="vol">${p.volLabel || p.vol} ${p.unit}</span>` : ""}
          ${p.new ? '<span class="new">Baru</span>' : ""}
          <span class="check">${sel ? icon.check : ""}</span>
          <div class="body"><div class="code">${esc(p.code)} · ${esc((IDX.packTypes[p.type] || {}).name || "")}</div>
            <div class="name">${esc(p.name)}</div>
            <div class="meta">${p.vol ? `Volume ${p.volLabel || p.vol} ${p.unit}` : "Aksesoris"}${p.variasi && p.variasi !== "-" ? ` · ${esc(p.variasi)}` : ""}</div></div>
        </button>`;
      }).join("")}</div>
      ${list.length > shown.length ? `<button class="btn btn-ghost load-more" data-more>Tampilkan lebih banyak (${list.length - shown.length} lagi)</button>` : ""}
      <div class="card" style="margin-top:16px">
        <div class="field" style="margin:0"><label for="packNote">Catatan kemasan (opsional)</label>
          <input id="packNote" placeholder="Contoh: warna tutup hitam, kemasan mirip brand X" value="${esc(S.draft.packagingNote)}"></div>
      </div>`;
  }

  function viewLegal() {
    const f = CFG.fees;
    const row = (key, title, desc) => `<label class="checkrow ${S.draft[key] ? "on" : ""}"><input type="checkbox" data-legal="${key}" ${S.draft[key] ? "checked" : ""}><span><b>${title}</b><span class="small muted">${desc}</span></span></label>`;
    const rp = (n) => "Rp " + Number(n).toLocaleString("id-ID");
    return `${stepHead("legal", "Wajib dicentang agar produk siap dijual secara resmi.")}
      ${row("sticker", "Sticker / label kemasan", "Label produk ditempel di setiap kemasan.")}
      ${row("bpom", `Biaya BPOM & Lab <span class="fee">(${rp(f.bpomLabPerSku)} / SKU)</span>`, "Pendaftaran notifikasi BPOM dan uji laboratorium.")}
      ${row("halal", `Sertifikasi Halal <span class="fee">(${rp(f.halalPerSku)} / SKU)</span>`, "Pengurusan sertifikat halal produk.")}
      <div class="card" style="margin-top:14px">
        <div class="field" style="margin:0"><label for="productName">Nama produk <span class="req" style="color:var(--danger)">*</span></label>
          <input id="productName" placeholder="Contoh: Glow Serum by NamaBrand" value="${esc(S.draft.productName)}">
          <div class="hint">Nama produk yang akan tertulis di label (wajib).</div></div>
      </div>`;
  }

  const rpx = (n) => "Rp " + Number(n).toLocaleString("id-ID");

  function viewSample() {
    const d = S.draft;
    const opt = (val, title, sub) => `<button class="option ${d.sample === val ? "selected" : ""}" data-sample="${val ? 1 : 0}" style="margin-bottom:10px">
      <span class="check">${d.sample === val ? icon.check : ""}</span><div class="title">${title}</div><div class="sub">${sub}</div></button>`;
    return `${stepHead("sample", "Mau coba sample produk dulu sebelum produksi massal?")}
      ${opt(true, `Ya, request sample <span class="badge">${rpx(CFG.fees.samplePerSku)} / SKU</span>`, "Harga sudah termasuk PPN. Sample dibuat sesuai pilihan base, bahan aktif & kemasan SKU ini.")}
      ${opt(false, "Tidak, langsung produksi", "Produksi dijalankan tanpa sample terlebih dahulu.")}`;
  }

  function skuCard(it, i) {
    const b = IDX.bases[it.baseId];
    const act = it.actives.map((id) => IDX.actives[id].name);
    return `<div class="sku">
      <div class="sku-head"><div><span class="badge">SKU ${i + 1}</span><h3 style="margin-top:6px">${esc(it.productName || b.name)}</h3></div></div>
      <dl class="kv">
        <dt>Base</dt><dd>${esc(b.name)}${it.variant ? ` (${esc(it.variant)})` : ""}</dd>
        <dt>Ukuran</dt><dd>${it.vol} ${b.unit} × ${it.qty} pcs</dd>
        <dt>Bahan aktif</dt><dd>${act.length ? esc(act.join(", ")) : "—"}${it.customActives ? `<br><span class="muted">Request: ${esc(it.customActives)}</span>` : ""}</dd>
        <dt>Kemasan</dt><dd>${esc(window.MG.packagingLabel(it))}</dd>
        <dt>Legalitas</dt><dd>Sticker ✓ · BPOM & Lab ✓ · Halal ✓</dd>
        <dt>Sample</dt><dd>${it.sample ? `Ya (${rpx(CFG.fees.samplePerSku)})` : "Tidak"}</dd>
      </dl>
      <div class="sku-actions"><button class="btn btn-ghost btn-sm" data-edit="${i}">Ubah</button><button class="btn btn-ghost btn-sm" data-dup="${i}">Duplikat</button><button class="btn btn-danger btn-sm" data-del="${i}">Hapus</button></div>
    </div>`;
  }

  function viewCart() {
    const pcs = S.cart.reduce((s, x) => s + Number(x.qty), 0);
    return `<div class="step-head" style="margin-top:20px"><h2>SKU Saya</h2><p>${S.cart.length} SKU · ${pcs} pcs. Mau buat produk lain? Tambah SKU baru.</p></div>
      ${S.cart.map(skuCard).join("") || '<p class="muted">Belum ada SKU.</p>'}
      <button class="btn btn-ghost btn-block" data-newsku style="border-style:dashed">+ Tambah SKU lain</button>`;
  }

  function viewCustomer() {
    const c = S.customer;
    const f = (id, label, type, ph, req = true, extra = "") => `<div class="field" id="f-${id}"><label for="c-${id}">${label} ${req ? '<span class="req">*</span>' : ""}</label>
      <input id="c-${id}" type="${type}" placeholder="${ph}" value="${esc(c[id] || "")}" ${extra}><div class="err hidden"></div></div>`;
    return `<div class="progress"><div class="progress-track"><div class="progress-bar" style="width:100%"></div></div>
      <div class="progress-meta"><span>Langkah <b>${STEPS.length + 1}</b> dari ${STEPS.length + 1}</span><span>Data Diri</span></div></div>
      <div class="step-head"><h2>Data Diri</h2><p>Isi data lengkap agar admin bisa mengirim invoice.</p></div>
      <div class="card">
        ${f("name", "Nama lengkap", "text", "Nama kamu", true, 'autocomplete="name"')}
        <div class="grid-2">
          ${f("phone", "No. HP / WhatsApp", "tel", "08xxxxxxxxxx", true, 'inputmode="tel" autocomplete="tel"')}
          ${f("email", "Email", "email", "nama@email.com", true, 'autocomplete="email"')}
          ${f("city", "Kota", "text", "Contoh: Bandung", true, 'autocomplete="address-level2"')}
          ${f("brand", "Nama brand", "text", "Nama brand kamu")}
        </div>
        <div class="field" id="f-brandNote"><label for="c-brandNote">Catatan Brand <span class="req">*</span></label>
          <textarea id="c-brandNote" placeholder="Contoh: Brand skincare lokal untuk remaja dengan kulit berminyak, konsep natural & minimalis, target harga jual Rp 50–80 ribu.">${esc(c.brandNote || "")}</textarea>
          <div class="hint">Jelaskan secara singkat konsep brand kamu: target pasar, positioning, karakter/nuansa brand, dan kisaran harga jual.</div><div class="err hidden"></div></div>
        <div class="field" id="f-notes" style="margin:0"><label for="c-notes">Catatan lain (opsional)</label><textarea id="c-notes" placeholder="Target launching, referensi produk, dll.">${esc(c.notes || "")}</textarea></div>
      </div>
      <div class="card" style="margin-top:14px;background:var(--accent-soft);border-color:#f3dc9a">
        <h3 style="margin:0 0 8px;font-size:16px">Informasi harga & pembayaran</h3>
        <ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.6">
          <li><b>Harga total akan diinformasikan oleh admin melalui invoice.</b></li>
          <li>Harga di invoice <b>belum termasuk ongkos kirim</b>. Ongkos kirim dibayarkan saat produk sudah ready.</li>
          <li>Pembayaran: <b>DP 50%</b> di awal. Setelah <b>nomor izin edar BPOM</b> terbit, dilakukan <b>pelunasan sisa 50% + ongkos kirim</b>.</li>
          <li>Invoice disertai <b>lembar MoU</b> yang wajib ditandatangani di atas <b>materai Rp 10.000</b> lalu dikirim kembali ke WhatsApp admin.</li>
        </ul>
      </div>
      <label class="checkrow ${c.agree ? "on" : ""}" id="f-agree" style="margin-top:12px"><input type="checkbox" id="c-agree" ${c.agree ? "checked" : ""}><span><b>Saya sudah membaca & menyetujui informasi di atas</b><span class="small muted err hidden" style="display:block;color:var(--danger)"></span></span></label>
      <p class="small muted" style="margin-top:4px">Dengan menekan "Kirim via WhatsApp", data pesanan dikirim ke admin ${esc(CFG.appName)} bersama nomor order.</p>`;
  }

  function viewSuccess() {
    const o = S.lastOrder;
    if (!o) return viewHome();
    return `<section class="success">
      <div class="icon">✓</div>
      <h2 style="margin:0">Order berhasil dibuat!</h2>
      <p class="muted">Simpan nomor order kamu:</p>
      <div class="order-no">${esc(o.id)}</div>
      <p class="muted" style="max-width:440px;margin:10px auto 20px">WhatsApp akan terbuka dengan pesan pesanan. <b>Tekan kirim</b> di WhatsApp agar admin menerima order kamu. Invoice akan dikirim admin setelah dicek.</p>
      <div class="row" style="justify-content:center">
        <a class="btn btn-wa" href="${o.wa}" target="_blank" rel="noopener">Buka WhatsApp</a>
        ${o.msg ? '<button class="btn btn-ghost" data-copymsg>Salin pesan order</button>' : ""}
        <button class="btn btn-ghost" data-restart>Buat order baru</button>
      </div>
      <p class="small muted" style="max-width:440px;margin:18px auto 0">WhatsApp tidak terbuka? Tekan <b>Salin pesan order</b>, lalu kirim (tempel) ke WhatsApp admin
        <a href="${esc(window.MG.waLink(CFG.adminWhatsApp, ""))}" target="_blank" rel="noopener">+${esc(window.MG.normalizePhone(CFG.adminWhatsApp))}</a>.</p>
    </section>`;
  }

  /* ------------------------------------------------------------ bar */
  function barState() {
    const d = S.draft, b = base();
    switch (S.view) {
      case "base": {
        const needVar = b && (b.variants || []).length && !d.variant;
        return { ok: !!b && !needVar, label: "Lanjut", sum: b ? `<b>${esc(b.name)}</b>${needVar ? "Pilih varian dulu" : esc(d.variant || b.form)}` : "Pilih 1 base produk" };
      }
      case "size": return { ok: d.vol > 0 && Number(d.qty) >= MOQ, label: "Lanjut", sum: `<b>${esc(b.name)}</b>${d.vol ? d.vol + " " + b.unit : "Pilih volume"} · ${d.qty} pcs` };
      case "actives": return { ok: true, label: d.actives.length ? "Lanjut" : "Lewati", sum: `<b>${d.actives.length} bahan aktif dipilih</b>${esc(b.name)} ${d.vol} ${b.unit}` };
      case "pack": return { ok: d.noPackaging || (!!d.packagingId && packVolOk(d)), label: "Lanjut", sum: d.noPackaging ? "<b>Admin bantu carikan</b>Kemasan" : d.packagingId ? `<b>${esc(IDX.packaging[d.packagingId].code)}</b>${esc(IDX.packaging[d.packagingId].name)}` : "Pilih 1 kemasan" };
      case "legal": {
        const okL = d.sticker && d.bpom && d.halal, okN = (d.productName || "").trim().length >= 2;
        return { ok: okL && okN, label: "Lanjut", sum: !okL ? "<b>Centang semua</b>Wajib untuk setiap SKU" : !okN ? "<b>Isi nama produk</b>Wajib diisi" : "<b>Legalitas lengkap</b>Lanjut ke sample" };
      }
      case "sample": return { ok: d.sample !== null, label: "Simpan SKU", sum: d.sample === null ? "<b>Pilih salah satu</b>Request sample?" : d.sample ? "<b>Dengan sample</b>" + rpx(CFG.fees.samplePerSku) + " / SKU" : "<b>Tanpa sample</b>Langsung produksi" };
      case "cart": return { ok: S.cart.length > 0, label: "Isi Data Diri", sum: `<b>${S.cart.length} SKU</b>${S.cart.reduce((s, x) => s + Number(x.qty), 0)} pcs` };
      case "customer": return { ok: true, label: "Kirim via WhatsApp", sum: `<b>${S.cart.length} SKU</b>Cek data lalu kirim` };
      default: return null;
    }
  }

  // Tombol WhatsApp melayang: chat langsung ke admin dari halaman mana pun
  const waFloat = document.getElementById("waFloat");
  waFloat.href = window.MG.waLink(CFG.adminWhatsApp, `Halo admin ${CFG.appName}, saya mau tanya tentang maklon produk MOQ ${MOQ} pcs.`);

  function updateBar() {
    const st = barState();
    bar.classList.toggle("hidden", !st);
    waFloat.classList.toggle("raised", !!st);
    document.body.style.paddingBottom = st ? "0" : "";
    if (!st) return;
    barSummary.innerHTML = st.sum;
    btnNext.textContent = st.label;
    btnNext.disabled = !st.ok;
    btnNext.className = "btn " + (S.view === "customer" ? "btn-wa" : "btn-primary");
  }

  function render() {
    const v = S.view;
    const views = { home: viewHome, base: viewBase, size: viewSize, actives: viewActives, pack: viewPack, legal: viewLegal, sample: viewSample, cart: viewCart, customer: viewCustomer, success: viewSuccess };
    if (STEPS.includes(v) && v !== "base" && !base()) S.view = "base";
    app.className = "container page";
    app.innerHTML = (views[S.view] || viewHome)();
    document.getElementById("cartPill").classList.toggle("hidden", !S.cart.length || S.view === "cart");
    document.getElementById("cartCount").textContent = S.cart.length;
    updateBar();
  }

  // Render ulang tanpa kehilangan fokus input pencarian
  function rerenderKeepFocus(id) {
    const el = document.getElementById(id);
    const pos = el ? el.selectionStart : null;
    render();
    const n = document.getElementById(id);
    if (n) { n.focus(); if (pos != null) n.setSelectionRange(pos, pos); }
  }

  /* ------------------------------------------------------------ actions */
  function next() {
    const v = S.view;
    if (v === "sample") return saveSku();
    if (v === "cart") return go("customer");
    if (v === "customer") return submit();
    const i = STEPS.indexOf(v);
    if (v === "base" && !VOLS.includes(S.draft.vol)) S.draft.vol = defaultVol(base());
    if (v === "size") { ui.packFilter = "match"; ui.packType = "all"; ui.packQ = ""; ui.packLimit = PAGE; }
    go(STEPS[i + 1]);
  }

  function back() {
    const v = S.view;
    if (v === "customer") return go("cart");
    if (v === "cart") return go(S.draft.baseId ? "sample" : "home");
    const i = STEPS.indexOf(v);
    if (i <= 0) return go(S.cart.length ? "cart" : "home");
    go(STEPS[i - 1]);
  }

  // Volume kemasan wajib sama dengan volume produk
  function packVolOk(d) {
    if (d.noPackaging || !d.packagingId) return true;
    const p = IDX.packaging[d.packagingId];
    return !!p && p.vol === d.vol;
  }

  // Dialog konfirmasi sederhana (Promise<boolean>)
  function askConfirm(title, body, yes, no) {
    return new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.className = "modal-bg";
      wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="max-width:440px">
        <h3 style="margin:0 0 8px">${title}</h3><p style="margin:0 0 16px" class="muted">${body}</p>
        <div class="row" style="justify-content:flex-end"><button class="btn btn-ghost" data-no>${no}</button><button class="btn btn-primary" data-yes>${yes}</button></div></div>`;
      const done = (v) => { wrap.remove(); resolve(v); };
      wrap.addEventListener("click", (e) => { if (e.target.closest("[data-yes]")) done(true); else if (e.target.closest("[data-no]") || e.target === wrap) done(false); });
      document.body.appendChild(wrap);
      wrap.querySelector("[data-yes]").focus();
    });
  }

  async function choosePack(id) {
    const d = S.draft, p = IDX.packaging[id];
    if (!p) return;
    const y = scrollY;
    if (!p.vol) {
      toast("Tutup / pump bukan kemasan utama. Pilih botol/pot, lalu tulis tutup yang diinginkan di catatan kemasan.", 4500);
      return;
    }
    if (p.vol !== d.vol) {
      const vLabel = `${p.volLabel || p.vol} ${p.unit || unit()}`;
      const ok = await askConfirm("Volume kemasan berbeda",
        `Volume produk yang kamu pilih <b>${d.vol} ${unit()}</b>, sedangkan kemasan <b>${esc(p.code)}</b> bervolume <b>${vLabel}</b>.<br><br>Ubah volume produk menjadi <b>${vLabel}</b> sesuai kemasan ini?`,
        `Ya, ubah ke ${vLabel}`, "Tidak");
      if (!ok) { toast(`Kemasan tidak dipilih. Pilih kemasan bervolume ${d.vol} ${unit()}, atau ubah volume produk.`, 4000); return; }
      d.vol = p.vol;
      ui.packFilter = "match";
      toast(`Volume produk diubah menjadi ${vLabel}`);
    }
    d.packagingId = id; d.noPackaging = false; persist(); render(); scrollTo(0, y);
  }

  function saveSku() {
    if (!packVolOk(S.draft)) { toast("Volume produk dan volume kemasan harus sama."); return go("pack"); }
    const d = { ...S.draft };
    const idx = d.editIndex;
    delete d.editIndex;
    d.unit = base().unit;
    d.baseName = base().name;
    if (d.noPackaging) d.packagingId = null;
    if (idx != null) S.cart[idx] = d; else S.cart.push(d);
    S.draft = emptyDraft();
    toast(idx != null ? "SKU diperbarui" : "SKU tersimpan");
    go("cart");
  }

  function validateCustomer() {
    const c = S.customer;
    const rules = {
      name: (v) => v.trim().length >= 2 || "Nama wajib diisi",
      phone: (v) => /^(\+?62|0|8)\d{8,13}$/.test(v.replace(/[\s-]/g, "")) || "Nomor HP tidak valid (contoh 081234567890)",
      email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) || "Email tidak valid",
      city: (v) => v.trim().length >= 2 || "Kota wajib diisi",
      brand: (v) => v.trim().length >= 1 || "Nama brand wajib diisi",
      brandNote: (v) => v.trim().length >= 10 || "Ceritakan singkat konsep brand kamu (min. 10 karakter)",
      agree: (v) => v === true || "Centang persetujuan untuk melanjutkan",
    };
    let first = null;
    for (const [k, fn] of Object.entries(rules)) {
      const r = fn(k === "agree" ? !!c.agree : c[k] || "");
      const box = document.getElementById("f-" + k);
      box.classList.toggle("invalid", r !== true);
      const err = box.querySelector(".err");
      err.textContent = r === true ? "" : r;
      err.classList.toggle("hidden", r === true);
      if (r !== true && !first) first = box;
    }
    if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
    return !first;
  }

  function submit() {
    if (!validateCustomer()) return;
    const c = S.customer;
    const order = {
      id: window.MG.newOrderId(),
      createdAt: new Date().toISOString(),
      catalogVersion: C.version,
      customer: { name: c.name.trim(), phone: c.phone.trim(), email: c.email.trim(), city: c.city.trim(), brand: c.brand.trim(), brandNote: (c.brandNote || "").trim(), notes: (c.notes || "").trim() },
      items: S.cart.map((x) => ({ ...x })),
    };
    // Link admin hanya perlu jika order tidak otomatis tercatat ke Google Sheet
    const msg = window.MG.orderMessage(order, !CFG.orderEndpoint);
    const wa = window.MG.waLink(CFG.adminWhatsApp, msg);
    // Simpan otomatis ke Google Sheet (opsional)
    if (CFG.orderEndpoint) {
      const body = JSON.stringify({ order: window.MG.enrichOrder(order), packed: window.MG.packOrder(order) });
      try {
        if (!(navigator.sendBeacon && navigator.sendBeacon(CFG.orderEndpoint, new Blob([body], { type: "text/plain" }))))
          fetch(CFG.orderEndpoint, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body, keepalive: true });
      } catch (e) { /* tetap lanjut ke WhatsApp */ }
    }
    const history = store.get("mg_history", []);
    history.unshift({ id: order.id, createdAt: order.createdAt, skus: order.items.length });
    store.set("mg_history", history.slice(0, 20));
    S.lastOrder = { id: order.id, wa, msg };
    S.cart = [];
    S.draft = emptyDraft();
    go("success");
    const w = window.open(wa, "_blank");
    if (!w) location.href = wa;
  }

  /* ------------------------------------------------------------ events */
  btnNext.addEventListener("click", () => !btnNext.disabled && next());
  btnBack.addEventListener("click", back);

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-go],[data-copymsg],[data-sample],[data-basecat],[data-base],[data-variant],[data-vol],[data-qty],[data-qtyset],[data-actcat],[data-active],[data-packfilter],[data-packtype],[data-pack],[data-nopack],[data-more],[data-edit],[data-dup],[data-del],[data-newsku],[data-restart]");
    if (!t) return;
    const d = S.draft, ds = t.dataset;
    if (ds.go) { e.preventDefault(); if (ds.go === "base" && S.view === "home") { if (d.editIndex == null && !d.baseId) S.draft = emptyDraft(); } return go(ds.go); }
    if (ds.copymsg !== undefined) {
      const msg = (S.lastOrder || {}).msg || "";
      (navigator.clipboard ? navigator.clipboard.writeText(msg) : Promise.reject()).then(() => toast("Pesan order disalin — tempel di WhatsApp admin"))
        .catch(() => { const ta = document.createElement("textarea"); ta.value = msg; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast("Pesan order disalin"); });
      return;
    }
    if (ds.sample !== undefined) { d.sample = ds.sample === "1"; persist(); return render(); }
    if (ds.basecat) { ui.baseCat = ds.basecat; return render(); }
    if (ds.base) {
      if (e.target.closest("[data-stop]")) return;
      if (d.baseId !== ds.base) {
        const b = IDX.bases[ds.base];
        Object.assign(d, { baseId: ds.base, variant: (b.variants || []).length === 1 ? b.variants[0].name : "", vol: b.vol, vol: defaultVol(b), actives: [], packagingId: null, noPackaging: false });
      }
      persist(); render();
      const el = document.querySelector(`[data-base="${ds.base}"]`);
      if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    if (ds.variant !== undefined) { d.variant = ds.variant; persist(); return render(); }
    if (ds.vol) { d.vol = Number(ds.vol); d.packagingId = null; persist(); return render(); }
    if (ds.qty) { d.qty = Math.max(MOQ, (Number(d.qty) || MOQ) + Number(ds.qty)); persist(); return render(); }
    if (ds.qtyset) { d.qty = Number(ds.qtyset); persist(); return render(); }
    if (ds.actcat) { ui.actCat = ds.actcat; return render(); }
    if (ds.active) { const i = d.actives.indexOf(ds.active); i >= 0 ? d.actives.splice(i, 1) : d.actives.push(ds.active); persist(); return render(); }
    if (ds.packfilter) { if (t.disabled) return; ui.packFilter = ds.packfilter; ui.packType = "all"; ui.packLimit = PAGE; return render(); }
    if (ds.packtype) { ui.packType = ds.packtype; ui.packLimit = PAGE; return render(); }
    if (ds.pack) { choosePack(ds.pack); return; }
    if (ds.nopack !== undefined) { d.noPackaging = !d.noPackaging; if (d.noPackaging) d.packagingId = null; persist(); const y = scrollY; render(); scrollTo(0, y); return; }
    if (ds.more !== undefined) { ui.packLimit += PAGE * 2; const y = scrollY; render(); scrollTo(0, y); return; }
    if (ds.edit) { S.draft = { ...emptyDraft(), ...S.cart[+ds.edit], editIndex: +ds.edit }; return go("base"); }
    if (ds.dup) { S.cart.splice(+ds.dup + 1, 0, { ...S.cart[+ds.dup], actives: [...S.cart[+ds.dup].actives] }); persist(); toast("SKU diduplikat"); return render(); }
    if (ds.del) { if (confirm("Hapus SKU ini?")) { S.cart.splice(+ds.del, 1); persist(); render(); } return; }
    if (ds.newsku !== undefined) { S.draft = emptyDraft(); ui.baseQ = ""; return go("base"); }
    if (ds.restart !== undefined) { S.lastOrder = null; S.draft = emptyDraft(); return go("home"); }
  });

  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches(".option[data-base]")) { e.preventDefault(); e.target.click(); }
  });

  document.addEventListener("input", (e) => {
    const t = e.target, d = S.draft;
    if (t.id === "baseQ") { ui.baseQ = t.value; return rerenderKeepFocus("baseQ"); }
    if (t.id === "actQ") { ui.actQ = t.value; return rerenderKeepFocus("actQ"); }
    if (t.id === "packQ") { ui.packQ = t.value; ui.packLimit = PAGE; return rerenderKeepFocus("packQ"); }
    if (t.id === "qty") { d.qty = Math.floor(Number(t.value) || 0); document.getElementById("qtyErr").classList.toggle("hidden", d.qty >= MOQ); persist(); return updateBar(); }
    if (t.id === "customActives") { d.customActives = t.value; return persist(); }
    if (t.id === "packNote") { d.packagingNote = t.value; return persist(); }
    if (t.id === "productName") { d.productName = t.value; persist(); return updateBar(); }
    if (t.dataset.legal) { d[t.dataset.legal] = t.checked; t.closest(".checkrow").classList.toggle("on", t.checked); persist(); return updateBar(); }
    if (t.id && t.id.startsWith("c-")) {
      const box = document.getElementById("f-" + t.id.slice(2));
      if (box) { box.classList.remove("invalid"); const er = box.querySelector(".err"); if (er) er.classList.add("hidden"); }
    }
    if (t.id === "c-agree") { S.customer.agree = t.checked; t.closest(".checkrow").classList.toggle("on", t.checked); return persist(); }
    if (t.id && t.id.startsWith("c-")) { S.customer[t.id.slice(2)] = t.value; persist(); }
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "qty" && S.draft.qty < MOQ) { S.draft.qty = MOQ; persist(); render(); }
  });

  render();
})();
