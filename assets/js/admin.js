/* MaklonGo — dashboard admin */
(function () {
  const { C, CFG, IDX, esc, rupiah, fmtDate, store, toast } = window.MG;
  const { decryptPrices, encryptPrices, computeOrder } = window.MGP;

  const DEFAULT_SETTINGS = {
    moq: 50, activeDosePct: 1, activeScrapFactor: 1.35, packagingMarkup: 1.35,
    bpomLabPerSku: CFG.fees.bpomLabPerSku, halalPerSku: CFG.fees.halalPerSku, stickerPerPcs: 0,
    roundPerPcs: 1, dpPercent: 50, invoiceDueDays: 7, invoiceBreakdown: false,
    companyName: CFG.appName, companyAddress: "", companyPhone: CFG.adminWhatsApp, companyEmail: "",
    bankInfo: "Bank BCA 1234567890 a.n. Nama Perusahaan",
    invoiceNotes: "Pembayaran DP 50% untuk memulai produksi. Pelunasan sebelum barang dikirim.\nEstimasi produksi 3–4 minggu setelah desain sticker & legalitas disetujui.",
  };
  const STATUSES = [["baru", "Baru"], ["invoice", "Invoice terkirim"], ["dp", "DP diterima"], ["produksi", "Produksi"], ["selesai", "Selesai"], ["batal", "Batal"]];
  const STATUS_NAME = Object.fromEntries(STATUSES);

  const root = document.getElementById("admin");
  const modalRoot = document.getElementById("modalRoot");
  const A = { pw: null, prices: null, filePrices: null, dirty: false, tab: "orders", q: "", status: "all", priceQ: "", openId: null, packLimit: 60 };

  const getOrders = () => store.get("mg_orders", []);
  const setOrders = (o) => store.set("mg_orders", o);
  const sheetCfg = () => store.get("mg_sheet", { endpoint: CFG.orderEndpoint || "", key: "" });

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
    try { sessionStorage.setItem("mg_pw", pw); } catch {}
    document.getElementById("btnLogout").classList.remove("hidden");
    handleImportHash();
    render();
  }

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

  function importText(text) {
    const found = [...String(text).matchAll(/#import=([A-Za-z0-9+\-$]+)/g)].map((m) => m[1]);
    const list = [];
    found.forEach((s) => { try { list.push(window.MG.unpackOrder(s)); } catch {} });
    if (!list.length) return toast("Tidak ada link order yang valid");
    upsertOrders(list);
    render();
  }

  async function syncSheet() {
    const { endpoint, key } = sheetCfg();
    if (!endpoint) return toast("Isi URL Google Apps Script di tab Pengaturan");
    try {
      const res = await fetch(`${endpoint}?key=${encodeURIComponent(key)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const list = (data.orders || []).map((r) => { try { return r.packed ? window.MG.unpackOrder(r.packed) : r.order; } catch { return null; } });
      upsertOrders(list);
      render();
    } catch (e) { toast("Gagal sinkron: " + e.message); }
  }

  /* ------------------------------------------------------------ prices store */
  function savePrices() {
    A.dirty = true;
    store.set("mg_admin_prices", A.prices);
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
      ${A.dirty ? `<div class="notice" style="margin-top:12px">Ada perubahan harga/pengaturan yang tersimpan di browser ini saja.
        <button class="link-btn" data-act="export">Download prices.enc.json</button> lalu upload ke folder <code>data/</code> di GitHub agar berlaku di perangkat lain.
        <button class="link-btn" data-act="resetLocal" style="color:var(--danger)">Buang perubahan</button></div>` : ""}
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
        <button class="btn btn-wa btn-sm" data-sendwa="${esc(o.id)}">Kirim invoice ke WA customer</button>
        <button class="btn btn-ghost btn-sm" data-copy="${esc(o.id)}">Salin ringkasan</button>
        <button class="btn btn-danger btn-sm" data-delorder="${esc(o.id)}">Hapus</button>
      </div>
      <div class="card" style="margin-bottom:12px">
        <dl class="kv" style="margin:0">
          <dt>Nama</dt><dd>${esc(c.name)}</dd>
          <dt>HP / WA</dt><dd><a href="https://wa.me/${window.MG.normalizePhone(c.phone)}" target="_blank" rel="noopener">${esc(c.phone)}</a></dd>
          <dt>Email</dt><dd><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd>
          <dt>Kota</dt><dd>${esc(c.city)}</dd>
          <dt>Brand</dt><dd>${esc(c.brand)}</dd>
          ${c.notes ? `<dt>Catatan</dt><dd>${esc(c.notes)}</dd>` : ""}
        </dl>
      </div>
      ${skuHtml}
      <div class="card">
        <div class="table-wrap" style="border:0"><table class="tbl">
          <tr><td>Subtotal</td><td class="num">${rupiah(calc.subtotal)}</td></tr>
          <tr><td>Diskon</td><td class="num"><input class="inp" type="number" data-orderadj="discount" value="${adj.discount || 0}"></td></tr>
          <tr><td>Ongkos kirim</td><td class="num"><input class="inp" type="number" data-orderadj="shipping" value="${adj.shipping || 0}"></td></tr>
          <tr><td><b>Total</b></td><td class="num"><b>${rupiah(calc.total)}</b></td></tr>
          ${calc.dpPct ? `<tr><td>DP ${calc.dpPct}%</td><td class="num">${rupiah(calc.dp)}</td></tr>` : ""}
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
    setOrders(orders);
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
    if (calc.dpPct) L.push(`DP ${calc.dpPct}%: ${rupiah(calc.dp)}`);
    if (A.prices.settings.bankInfo) L.push("", "Pembayaran ke:", A.prices.settings.bankInfo);
    L.push("", "File invoice PDF terlampir. Silakan hubungi kami jika ada pertanyaan.");
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
    const green = [31, 111, 92];
    const rp = (n) => "Rp " + Math.round(n).toLocaleString("id-ID");
    const created = new Date();
    const due = new Date(created.getTime() + (Number(st.invoiceDueDays) || 7) * 864e5);
    const d = (x) => x.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

    doc.setFillColor(...green); doc.rect(0, 0, W, 4, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(29, 29, 31);
    doc.text(st.companyName || CFG.appName, M, 20);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(100);
    const comp = [st.companyAddress, st.companyPhone && "WA: " + st.companyPhone, st.companyEmail].filter(Boolean);
    doc.text(comp.length ? comp : [CFG.tagline], M, 26);
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
    if (calc.dpPct) tot.push([`DP ${calc.dpPct}%`, rp(calc.dp)]);
    doc.autoTable({
      startY: y, margin: { left: W - M - 86, right: M }, body: tot, theme: "plain",
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

    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFontSize(8); doc.setTextColor(150);
      doc.text(`${st.companyName || CFG.appName} · ${CFG.tagline}`, M, doc.internal.pageSize.getHeight() - 8);
      doc.text(`Hal ${p}/${pages}`, W - M, doc.internal.pageSize.getHeight() - 8, { align: "right" });
    }
    return doc;
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
  function priceSearch(ph) {
    return `<div class="row" style="margin-bottom:10px"><input class="input" id="priceQ" placeholder="${ph}" value="${esc(A.priceQ)}" style="max-width:420px"></div>`;
  }

  function viewBases() {
    const q = A.priceQ.toLowerCase();
    const rows = C.bases.filter((b) => !q || b.name.toLowerCase().includes(q)).map((b) => {
      const p = A.prices.bases[b.id] || {};
      const fp = (A.filePrices.bases[b.id] || {}).price;
      return `<tr><td>${b.id}</td><td><b>${esc(b.name)}</b><br><span class="small muted">${esc(b.form)} · Shopee ${esc(p.shopee || "")}</span></td>
        <td class="num">${p.vol} ${p.unit}</td>
        <td class="num"><input class="inp ${p.price !== fp ? "changed" : ""}" type="number" data-baseprice="${b.id}" value="${p.price}"></td>
        <td class="num muted">${rupiah(p.priceAwal)}</td>
        <td class="num">${rupiah(p.price / p.vol)}</td></tr>`;
    }).join("");
    return `<p class="muted small">Harga base dari file <i>discount_nominate</i> (kolom Harga diskon). Harga per pcs = harga ÷ volume asli × volume pesanan.</p>
      ${priceSearch("Cari base…")}
      <div class="table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Base</th><th class="num">Vol. asli</th><th class="num">Harga</th><th class="num">Harga awal</th><th class="num">Per ml/g</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function viewActives() {
    const q = A.priceQ.toLowerCase();
    const st = A.prices.settings;
    const rows = C.actives.filter((a) => !q || a.name.toLowerCase().includes(q)).map((a) => {
      const p = A.prices.actives[a.id];
      const per100 = p.pricePerGram * 100 * (st.activeDosePct / 100) * st.activeScrapFactor;
      const fpp = (A.filePrices.actives[a.id] || {}).pricePerGram;
      return `<tr><td><b>${esc(a.name)}</b><br><span class="small muted">${a.cats.map((c) => IDX.activeCats[c].name).join(", ")}</span></td>
        <td><select class="input" style="padding:6px 8px;font-size:12.5px;min-width:200px" data-actsrc="${a.id}">${p.alternatives.map((x, i) => `<option value="${i}" ${x.kode === p.source.kode ? "selected" : ""}>${esc(x.kode)} · ${esc(x.nama)} · ${esc(x.supplier || "-")} · ${rupiah(x.pricePerGram * 1000)}/kg</option>`).join("")}</select></td>
        <td class="num"><input class="inp ${p.pricePerGram !== fpp ? "changed" : ""}" type="number" data-actprice="${a.id}" value="${Math.round(p.pricePerGram * 1000)}"></td>
        <td class="num">${rupiah(per100)}</td></tr>`;
    }).join("");
    return `<p class="muted small">Harga dari <i>master bahan</i>, dihitung per kg (berat = volume). Per pcs = harga/gram × (volume × ${st.activeDosePct}%) × ${st.activeScrapFactor} (scrap factor).</p>
      ${priceSearch("Cari bahan aktif…")}
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Bahan aktif</th><th>Sumber harga</th><th class="num">Harga / kg</th><th class="num">Per pcs @100 ml</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function viewPackaging() {
    const q = A.priceQ.toLowerCase();
    const st = A.prices.settings;
    const list = C.packaging.filter((p) => !q || `${p.code} ${p.name} ${p.variasi} ${p.vol}`.toLowerCase().includes(q) ||
      (q === "cek" && (!A.prices.packaging[p.id].filePrice || A.prices.packaging[p.id].filePrice > 100000)));
    const rows = list.slice(0, A.packLimit).map((p) => {
      const pp = A.prices.packaging[p.id];
      const flag = !pp.filePrice || pp.filePrice > 100000;
      return `<tr><td><img class="thumb" loading="lazy" src="${p.img}" alt=""></td><td><b>${esc(p.code)}</b> ${flag ? '<span class="flag">• cek harga</span>' : ""}<br><span class="small">${esc(p.name)}</span><br><span class="small muted">${esc(p.variasi)}</span></td>
        <td class="num">${p.vol ? p.vol + " " + p.unit : "-"}</td>
        <td class="num"><input class="inp" type="number" data-packprice="${p.id}" value="${pp.filePrice ?? ""}" placeholder="isi"></td>
        <td class="num">${pp.price ? rupiah(pp.price) : "-"}</td></tr>`;
    }).join("");
    return `<p class="muted small">Harga dari nama file gambar kemasan × ${st.packagingMarkup} (${Math.round((st.packagingMarkup - 1) * 100)}%). Ketik <b>cek</b> di pencarian untuk melihat kemasan yang harganya kosong / tidak wajar.</p>
      ${priceSearch("Cari kode / nama kemasan… (ketik: cek)")}
      <div class="table-wrap"><table class="tbl"><thead><tr><th></th><th>Kemasan</th><th class="num">Volume</th><th class="num">Harga file</th><th class="num">Harga jual</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${list.length > A.packLimit ? `<button class="btn btn-ghost load-more" data-act="morepack">Tampilkan lebih banyak (${list.length - A.packLimit})</button>` : ""}`;
  }

  function viewSettings() {
    const s = A.prices.settings;
    const sh = sheetCfg();
    const n = (k, label, hint = "") => `<div class="field"><label>${label}</label><input type="number" step="any" data-set="${k}" value="${s[k]}">${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
    const t = (k, label, area) => `<div class="field"><label>${label}</label>${area ? `<textarea data-set="${k}">${esc(s[k])}</textarea>` : `<input data-set="${k}" value="${esc(s[k])}">`}</div>`;
    return `<div class="grid-2" style="gap:14px">
      <div class="card"><h3 style="margin-top:0">Rumus harga</h3>
        ${n("bpomLabPerSku", "Biaya BPOM & Lab / SKU (Rp)", "Samakan juga dengan assets/js/config.js agar teks di web customer sama.")}
        ${n("halalPerSku", "Biaya Halal / SKU (Rp)")}
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
        <label class="checkrow" style="margin:0"><input type="checkbox" data-set="invoiceBreakdown" ${s.invoiceBreakdown ? "checked" : ""}><span><b>Tampilkan rincian komponen per pcs di invoice</b><span class="small muted">Base, bahan aktif, kemasan, sticker</span></span></label>
      </div>
      <div class="card"><h3 style="margin-top:0">Sinkron Google Sheet (opsional)</h3>
        <p class="small muted">Agar order otomatis tersimpan tanpa membuka link WA. Lihat <code>apps-script/README.md</code>.</p>
        <div class="field"><label>URL Web App Apps Script</label><input id="sheetEndpoint" value="${esc(sh.endpoint)}" placeholder="https://script.google.com/macros/s/…/exec"></div>
        <div class="field"><label>Kunci admin (ADMIN_KEY)</label><input id="sheetKey" type="password" value="${esc(sh.key)}"></div>
        <button class="btn btn-ghost btn-sm" data-act="saveSheet">Simpan</button>
      </div>
      <div class="card"><h3 style="margin-top:0">Keamanan & data</h3>
        <p class="small muted">Harga disimpan terenkripsi di <code>data/prices.enc.json</code>. Setelah mengubah harga / password, download file baru lalu upload ke GitHub (replace file lama).</p>
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
      <p class="small muted">Tempel isi pesan WhatsApp dari customer (atau link admin di dalamnya). Bisa beberapa pesan sekaligus.</p>
      <textarea class="input" id="importText" style="min-height:160px" placeholder="*ORDER MAKLON — MaklonGo* …"></textarea>
      <div class="row" style="margin-top:12px"><button class="btn btn-primary" data-act="doImport">Import</button><button class="btn btn-ghost" data-close>Batal</button></div>
    </div></div>`;
  }

  /* ------------------------------------------------------------ events */
  document.getElementById("btnLogout").addEventListener("click", logout);

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-tab],[data-open],[data-close],[data-act],[data-pdf],[data-sendwa],[data-copy],[data-delorder],[data-resetadj]");
    if (!t) return;
    const ds = t.dataset;
    if (ds.close !== undefined) { if (e.target === t || t.tagName === "BUTTON") closeOrder(); return; }
    if (ds.tab) { A.tab = ds.tab; A.priceQ = ""; A.packLimit = 60; return render(); }
    if (ds.open) return openOrder(ds.open);
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
      case "saveSheet": store.set("mg_sheet", { endpoint: document.getElementById("sheetEndpoint").value.trim(), key: document.getElementById("sheetKey").value }); return toast("Tersimpan");
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
    if (ds.baseprice) { A.prices.bases[ds.baseprice].price = Number(t.value) || 0; savePrices(); return render(); }
    if (ds.actprice) { A.prices.actives[ds.actprice].pricePerGram = (Number(t.value) || 0) / 1000; savePrices(); return render(); }
    if (ds.actsrc) { const p = A.prices.actives[ds.actsrc]; p.source = p.alternatives[+t.value]; p.pricePerGram = p.source.pricePerGram; savePrices(); return render(); }
    if (ds.packprice) {
      const p = A.prices.packaging[ds.packprice];
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
