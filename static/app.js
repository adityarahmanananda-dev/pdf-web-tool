(() => {
  const state = { sid: null, rows: [] }; // rows: {id, name, kind, pages, size, resultName?, resultStatus?}

  const $ = (sel) => document.querySelector(sel);
  const dz = $("#upload-zone");
  const fileInput = $("#file-input");
  const rowsEl = $("#rows");
  const toolbar = $("#toolbar");
  const toast = $("#toast");

  const IMG_ICON = "🖼";
  const PDF_ICON = "📄";

  // ── helpers ──
  const fmtSize = (b) => {
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
    return (b / 1024 / 1024).toFixed(2) + " MB";
  };

  let toastTimer = null;
  const showToast = (msg, isErr = false) => {
    toast.textContent = msg;
    toast.classList.toggle("err", isErr);
    toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add("hidden"), 4000);
  };

  const busy = (msg) => {
    let el = $("#busy");
    if (!el) {
      el = document.createElement("div");
      el.id = "busy";
      el.innerHTML = '<div class="spinner"></div><div class="bmsg"></div>';
      document.body.appendChild(el);
    }
    el.querySelector(".bmsg").textContent = msg || "Proses…";
  };
  const idle = () => { const el = $("#busy"); if (el) el.remove(); };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

  const genId = () => "f" + Math.random().toString(36).slice(2) + Date.now().toString(36).slice(-4);

  // ── persist state agar tetap ada setelah refresh ──
  const STORE_KEY = "pdf_studio_state";
  const saveState = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ sid: state.sid, rows: state.rows }));
    } catch (e) {}
  };
  const clearState = () => { try { localStorage.removeItem(STORE_KEY); } catch (e) {} };

  async function restoreState() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) {}
    if (!saved || !saved.sid || !Array.isArray(saved.rows)) return;

    try {
      const res = await fetch(`/api/session/${saved.sid}`);
      if (!res.ok) { clearState(); return; }
      const data = await res.json();
      const serverNames = new Set(data.items.map((i) => i.name));
      state.sid = saved.sid;
      state.rows = saved.rows.filter((r) => serverNames.has(r.name));
      if (state.rows.length) render();
      if (!state.rows.length) clearState();
    } catch (e) {
      clearState();
    }
  }

  // ── upload ──
  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    if (state.sid) fd.append("sid", state.sid);
    busy("Upload file…");
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload gagal");
      state.sid = data.sid;
      for (const it of data.items) {
        if (state.rows.some((r) => r.name === it.name && r.sid === it.sid)) continue;
        state.rows.push({ ...it, sid: it.sid, id: genId() });
      }
      saveState();
      render();
    } catch (e) {
      showToast(e.message, true);
    } finally {
      idle();
    }
  }

  // ── render ──
  function render() {
    toolbar.classList.toggle("hidden", state.rows.length === 0);
    rowsEl.innerHTML = "";
    for (const row of state.rows) rowsEl.appendChild(rowCard(row));
  }

  function rowCard(row) {
    const card = document.createElement("div");
    card.className = "row";
    card.dataset.id = row.id;

    const meta = row.kind === "pdf"
      ? `${row.pages} halaman · ${fmtSize(row.size)}`
      : fmtSize(row.size);

    card.innerHTML = `
      <div class="row-head">
        <span class="drag-handle" title="Tahan &amp; seret untuk mengubah urutan">⠿</span>
        <span class="f-icon">${row.kind === "pdf" ? PDF_ICON : IMG_ICON}</span>
        <div class="f-info">
          <div class="f-name">${esc(row.name)}</div>
          <div class="f-meta">${meta} <span class="badge ${row.kind === "image" ? "image" : ""}">${row.kind}</span></div>
        </div>
        <div class="row-actions">
          ${row.kind === "pdf" ? pdfActions(row) : imageActions(row)}
        </div>
        <button class="btn small danger rm-btn" type="button">✕ Hapus</button>
      </div>
      <div class="row-result" id="res-${row.id}"></div>`;

    card.querySelector(".rm-btn").addEventListener("click", () => {
      state.rows = state.rows.filter((r) => r.id !== row.id);
      saveState();
      render();
    });

    enableDrag(card);

    // toggle enable/disable input saat checkbox action di klik
    card.querySelectorAll(".act input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const act = cb.closest(".act");
        act.querySelectorAll("input, select").forEach((el) => {
          if (el !== cb) el.disabled = !cb.checked;
        });
      });
    });

    return card;
  }

  // ── drag & drop reorder ──
  function enableDrag(card) {
    const handle = card.querySelector(".drag-handle");
    if (!handle) return;

    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      card.classList.add("dragging");
      card.style.pointerEvents = "none";

      const onMove = (ev) => {
        const below = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".row");
        if (below && below !== card) {
          const rect = below.getBoundingClientRect();
          const after = ev.clientY > rect.top + rect.height / 2;
          rowsEl.insertBefore(card, after ? below.nextSibling : below);
        }
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        card.classList.remove("dragging");
        card.style.pointerEvents = "";
        // sinkronkan state.rows dengan urutan DOM
        const ids = [...rowsEl.querySelectorAll(".row")].map((el) => el.dataset.id);
        state.rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        saveState();
        render();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  function arrangeByName(dir) {
    if (!state.rows.length) return;
    state.rows.sort((a, b) => {
      const r = a.name.toLowerCase().localeCompare(b.name.toLowerCase(), undefined, { numeric: true });
      return dir === "desc" ? -r : r;
    });
    saveState();
    render();
  }

  function pdfActions(row) {
    return `
      <div class="act" title="Rotate halaman tertentu">
        <label class="cb"><input type="checkbox" name="rotate"><span>🔃</span></label>
        <input type="text" name="rotate_pages" placeholder="1,3-5" title="Halaman rotate (kosong = semua)" disabled>
        <select name="rotate_angle" title="Sudut" disabled>
          <option value="90">90°</option>
          <option value="180">180°</option>
          <option value="270">270°</option>
        </select>
        <select name="rotate_dir" title="Arah" disabled>
          <option value="kanan">CW</option>
          <option value="kiri">CCW</option>
        </select>
      </div>

      <div class="act" title="Extract halaman tertentu">
        <label class="cb"><input type="checkbox" name="extract"><span>✂</span></label>
        <input type="text" name="extract_pages" placeholder="1-3,5" title="Halaman yang diambil" disabled>
      </div>

      <div class="act" title="Compress PDF (perlu Ghostscript)">
        <label class="cb"><input type="checkbox" name="compress"><span>🗜</span></label>
        <select name="compress_level" title="Kualitas compress" disabled>
          <option value="screen">Screen</option>
          <option value="ebook" selected>eBook</option>
          <option value="printer">Printer</option>
          <option value="prepress">Prepress</option>
        </select>
      </div>

      <div class="act" title="Convert tiap halaman ke JPG (hasil di-zip)">
        <label class="cb"><input type="checkbox" name="pdf2jpg"><span>🖼</span></label>
        <input type="number" name="pdf2jpg_dpi" value="150" min="72" max="600" title="DPI" disabled>
      </div>`;
  }

  function imageActions(row) {
    const isPng = row.name.toLowerCase().endsWith(".png");
    return `
      <div class="act" title="Konversi gambar jadi PDF (bisa ikut di-merge)">
        <label class="cb"><input type="checkbox" name="to_pdf" checked><span>📄→PDF</span></label>
      </div>
      ${isPng ? `
      <div class="act" title="Konversi PNG jadi JPG (transparan jadi putih)">
        <label class="cb"><input type="checkbox" name="png2jpg"><span>🖼→JPG</span></label>
      </div>` : ""}`;
  }

  // ── collect payload ──
  function buildPayload() {
    const rows = [];
    for (const row of state.rows) {
      const card = document.querySelector(`.row[data-id="${row.id}"]`);
      if (!card) continue;
      const get = (n) => card.querySelector(`[name="${n}"]`);
      const checked = (n) => card.querySelector(`[name="${n}"]`)?.checked || false;
      const val = (n) => (get(n) ? get(n).value.trim() : "");

      const payload = { id: row.id, name: row.name, kind: row.kind };
      if (row.kind === "pdf") {
        payload.rotate = {
          enabled: checked("rotate"),
          pages: val("rotate_pages"),
          angle: val("rotate_angle") || 90,
          dir: val("rotate_dir") || "kanan",
        };
        payload.extract = { enabled: checked("extract"), pages: val("extract_pages") };
        payload.compress = { enabled: checked("compress"), quality: val("compress_level") || "ebook" };
        payload.pdf2jpg = { enabled: checked("pdf2jpg"), dpi: val("pdf2jpg_dpi") || 150 };
        if (!payload.rotate.enabled && !payload.extract.enabled &&
            !payload.compress.enabled && !payload.pdf2jpg.enabled) continue;
      } else {
        payload.to_pdf = { enabled: checked("to_pdf") };
        payload.png2jpg = { enabled: checked("png2jpg") };
        if (!payload.to_pdf.enabled && !payload.png2jpg.enabled) continue;
      }
      rows.push(payload);
    }
    return rows;
  }

  // ── process ──
  async function processAll() {
    if (!state.sid) return showToast("Upload file dulu", true);
    const payloadRows = buildPayload();
    if (!payloadRows.length) return showToast("Tidak ada action yang dipilih", true);

    busy("Memproses file…");
    try {
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid: state.sid, rows: payloadRows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Proses gagal");

      rowsEl.querySelectorAll(".row-result").forEach((el) => {
        el.innerHTML = "";
        el.classList.remove("show");
      });

      let okCount = 0, errCount = 0;
      const results = data.results;
      for (const r of results) {
        const row = state.rows.find((x) => x.id === r.id);
        if (!row) continue;
        const el = document.querySelector(`#res-${row.id}`);
        if (el) {
          const line = document.createElement("div");
          if (r.ok) {
            line.className = "res-line ok";
            if (r.name && r.name.toLowerCase().endsWith(".pdf")) row.resultName = r.name;
            line.textContent = `✓ ${r.message} — ${r.name}`;
          } else {
            line.className = "res-line err";
            line.textContent = `✖ ${r.message}`;
          }
          el.appendChild(line);
          el.classList.add("show");
        }
        r.ok ? okCount++ : errCount++;
      }
      saveState();
      showReview(results);
      showToast(`Selesai: ${okCount} sukses, ${errCount} gagal`);
    } catch (e) {
      showToast(e.message, true);
    } finally {
      idle();
    }
  }

  // ── merge ──
  async function mergeAll() {
    if (!state.sid) return showToast("Upload file dulu", true);
    const items = [];
    for (const row of state.rows) {
      if (row.resultName && row.resultName.toLowerCase().endsWith(".pdf")) {
        items.push({ name: row.resultName, kind: "pdf" });
      } else if (row.kind === "pdf") {
        items.push({ name: row.name, kind: "pdf" });
      } else {
        const card = document.querySelector(`.row[data-id="${row.id}"]`);
        const toPdf = card ? card.querySelector('[name="to_pdf"]')?.checked : false;
        if (toPdf) items.push({ name: row.name, kind: "image" });
      }
    }
    if (!items.length) return showToast("Tidak ada file PDF untuk di-merge", true);

    busy("Menggabungkan PDF…");
    try {
      const res = await fetch("/api/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid: state.sid, items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Merge gagal");
      const a = document.createElement("a");
      a.href = data.download;
      a.download = data.name;
      a.click();
      const skipMsg = data.skipped && data.skipped.length
        ? ` (di-skip: ${data.skipped.join(", ")})` : "";
      showToast(`Merge sukses: ${data.name}${skipMsg}`);
    } catch (e) {
      showToast(e.message, true);
    } finally {
      idle();
    }
  }

  // ── zip all ──
  async function zipAll(files) {
    if (!state.sid) return showToast("Upload file dulu", true);
    files = files || state.rows.map((r) => r.resultName).filter(Boolean);
    if (!files.length) return showToast("Belum ada hasil untuk di-download", true);

    busy("Membuat ZIP…");
    try {
      const res = await fetch("/api/zip-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid: state.sid, files }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal");
      const a = document.createElement("a");
      a.href = data.download;
      a.download = "semua_hasil.zip";
      a.click();
    } catch (e) {
      showToast(e.message, true);
    } finally {
      idle();
    }
  }

  // ── review modal ──
  const reviewModal = $("#review-modal");
  const reviewBody = $("#review-body");
  const reviewDownload = $("#review-download");

  function showReview(results) {
    reviewBody.innerHTML = "";
    const okNames = [];
    for (const r of results) {
      const row = state.rows.find((x) => x.id === r.id);
      const fname = row ? row.name : r.id;
      const item = document.createElement("div");
      item.className = "review-item";
      if (r.ok) {
        okNames.push(r.name);
        item.innerHTML = `
          <span class="f">${esc(fname)}</span>
          <span class="s">✓ ${esc(r.name)}</span>
          <a class="btn small primary" href="${r.download}" download>⬇</a>`;
      } else {
        item.innerHTML = `<span class="f">${esc(fname)}</span>
          <span class="s err">✖ ${esc(r.message)}</span>`;
      }
      reviewBody.appendChild(item);
    }
    reviewDownload.style.display = okNames.length ? "" : "none";
    reviewDownload.dataset.files = JSON.stringify(okNames);
    reviewModal.classList.remove("hidden");
  }

  function closeReview() {
    reviewModal.classList.add("hidden");
  }

  async function clearAll() {
    if (!state.rows.length) return;
    if (!confirm("Hapus semua file & hasil?")) return;
    if (state.sid) {
      try { await fetch(`/api/clear/${state.sid}`, { method: "POST" }); } catch (e) {}
    }
    state.sid = null;
    state.rows = [];
    clearState();
    render();
  }

  // ── wire up ──
  $("#btn-process").addEventListener("click", processAll);
  $("#btn-merge").addEventListener("click", mergeAll);
  $("#btn-arrange-az").addEventListener("click", () => arrangeByName("asc"));
  $("#btn-arrange-za").addEventListener("click", () => arrangeByName("desc"));
  $("#btn-zip").addEventListener("click", () => zipAll());
  $("#btn-clear").addEventListener("click", clearAll);

  $("#review-close").addEventListener("click", closeReview);
  $("#review-ok").addEventListener("click", closeReview);
  reviewModal.addEventListener("click", (e) => { if (e.target === reviewModal) closeReview(); });
  reviewDownload.addEventListener("click", () => {
    let files = [];
    try { files = JSON.parse(reviewDownload.dataset.files || "[]"); } catch (e) {}
    zipAll(files);
  });

  fileInput.addEventListener("change", () => { uploadFiles(fileInput.files); fileInput.value = ""; });

  ["dragover", "dragenter"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => uploadFiles(e.dataTransfer.files));
  dz.addEventListener("click", (e) => {
    if (e.target.closest("label, input")) return; // biar tidak buka dialog 2x
    fileInput.click();
  });
  dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });

  restoreState();
})();
