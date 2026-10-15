(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  var ready = false, needsCode = false;
  var pieces = [], pieceName = "", ctl = null, timer = null, last = null;
  var MAX_IMAGES = 5;
  var MAX_PAYLOAD = 3.6 * 1024 * 1024; // caracteres base64 enviados al servidor (Vercel limita el cuerpo a ~4.5 MB)
  var PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  var COLORS = { ok: "#30d158", warn: "#ffd60a", bad: "#ff453a" };
  var RGB = { ok: "48, 209, 88", warn: "255, 214, 10", bad: "255, 69, 58" };
  var ICON = { ok: "✓", warn: "!", bad: "✕" };

  /* ---------- Puntajes y estado (mismos umbrales del skill) ---------- */
  function normItems(items) {
    return (Array.isArray(items) ? items : []).filter(function (it) { return it && typeof it === "object"; }).slice(0, 14).map(function (it) {
      var max = Math.max(1, Math.min(3, Math.round(Number(it.max) || 1)));
      var pts = Number(it.pts);
      if (!isFinite(pts)) pts = 0;
      pts = Math.max(0, Math.min(max, Math.round(pts * 2) / 2));
      var r = pts / max;
      return {
        criterio: String(it.criterio || "Criterio"), explicacion: String(it.explicacion || ""),
        sugerencia: String(it.sugerencia || ""), max: max, pts: pts,
        st: r >= 0.99 ? "ok" : r >= 0.4 ? "warn" : "bad"
      };
    });
  }
  function secStats(items) {
    var got = 0, tot = 0;
    items.forEach(function (i) { got += i.pts; tot += i.max; });
    var pct = tot ? got / tot : null;
    return { got: got, tot: tot, pct: pct, st: pct == null ? "bad" : pct < 0.7 ? "bad" : pct < 0.8 ? "warn" : "ok" };
  }
  function fmt(n) { return (Math.round(n * 10) / 10).toString(); }

  function evaluate(raw) {
    if (!raw || typeof raw !== "object") throw { code: "invalid_json" };
    var ev = {
      pieza: raw.pieza && typeof raw.pieza === "object" ? raw.pieza : {},
      id: normItems(raw.identidad), cp: normItems(raw.copy), fo: normItems(raw.fotografia),
      sug: (Array.isArray(raw.sugerencias) ? raw.sugerencias : []).filter(function (s) { return s && typeof s === "object"; }).slice(0, 8),
      alt: (Array.isArray(raw.copy_alternativo) ? raw.copy_alternativo : []).filter(function (s) { return typeof s === "string" && s.trim(); }).slice(0, 3)
    };
    if (!ev.id.length && !ev.cp.length) throw { code: "invalid_json" };
    ev.sid = secStats(ev.id); ev.scp = secStats(ev.cp); ev.sfo = secStats(ev.fo);
    // Identidad visual 60% + copy y tono 40%. Si falta una dimensión, se reparte entre las que sí hay.
    var parts = [], w = 0;
    if (ev.sid.pct != null) { parts.push(ev.sid.pct * 0.6); w += 0.6; }
    if (ev.scp.pct != null) { parts.push(ev.scp.pct * 0.4); w += 0.4; }
    ev.score = Math.round(parts.reduce(function (a, b) { return a + b; }, 0) / w * 100) / 10;
    ev.st = ev.score < 7 ? "bad" : ev.score < 8 ? "warn" : "ok";
    ev.stText = ev.st === "bad" ? "No cumple los lineamientos de branding RIMAC" : ev.st === "warn" ? "Cumple parcialmente, con observaciones importantes" : "Cumple los lineamientos de branding RIMAC";
    ev.stSub = ev.st === "bad" ? "Debe corregirse antes de publicar" : ev.st === "warn" ? "Ajustar las observaciones antes de publicar" : "Lista para publicar";
    return ev;
  }

  /* ---------- Render del resultado (formato Clipart) ---------- */
  function itemHTML(i) {
    return '<div class="it"><div class="dot" style="background:' + COLORS[i.st] + '"><span>' + ICON[i.st] + '</span></div><div class="b">' +
      '<div class="m"><strong>' + esc(i.criterio) + '</strong>' + (i.explicacion ? " — " + esc(i.explicacion) : "") + '</div>' +
      (i.sugerencia ? '<div class="s">→ ' + esc(i.sugerencia) + '</div>' : "") + '</div></div>';
  }
  function sectionHTML(title, items, s) {
    if (!items.length) return "";
    var pct = Math.round((s.pct || 0) * 100);
    return '<div class="r-card"><div class="r-head"><div class="t">' + esc(title) + '</div><div class="pts">' + fmt(s.got) + " / " + fmt(s.tot) + ' pts</div></div>' +
      '<div class="bar"><i style="width:' + pct + '%;background:' + COLORS[s.st] + '"></i></div>' + items.map(itemHTML).join("") + "</div>";
  }
  function resultHTML(ev) {
    var h = '<div class="r-card r-score"><div class="ring" style="border-color:' + COLORS[ev.st] + '"><div class="n">' + fmt(ev.score) + '</div><div class="d">/10</div></div>' +
      '<div style="flex:1;min-width:0"><div class="tt">Puntaje general</div>' +
      '<div class="bd" style="background:rgba(' + RGB[ev.st] + ',0.15);color:' + COLORS[ev.st] + '"><span>' + ICON[ev.st] + '</span><span>' + esc(ev.stText) + '</span></div>' +
      '<div class="sub">' + esc(ev.stSub) + '</div></div></div>';
    h += sectionHTML("Identidad visual", ev.id, ev.sid);
    h += sectionHTML("Copy y tono de voz", ev.cp, ev.scp);
    h += sectionHTML("Fotografía y composición", ev.fo, ev.sfo);
    if (ev.sug.length) {
      h += '<div class="r-card"><div class="r-head" style="margin-bottom:16px"><div class="t">Sugerencias concretas para corregir la pieza</div></div>' +
        ev.sug.map(function (s, n) {
          return '<div class="sg"><div class="num">' + (n + 1) + '</div><div class="tx"><strong>' + esc(s.titulo || "Ajuste") + '</strong>' + (s.detalle ? " — " + esc(s.detalle) : "") + "</div></div>";
        }).join("") + "</div>";
    }
    if (ev.alt.length) {
      h += '<div class="r-card"><div class="r-head" style="margin-bottom:14px"><div class="t">Propuestas de copy</div></div>' +
        ev.alt.map(function (a) { return '<p class="alt">' + esc(a) + "</p>"; }).join("") + "</div>";
    }
    var txt = String(ev.pieza.texto_detectado || "").trim();
    if (txt) h += '<div class="r-card"><details class="raw"><summary>Texto detectado en la pieza</summary><p>' + esc(txt) + "</p></details></div>";
    h += '<div class="actions" style="margin-top:4px"><button type="button" class="btn small" id="copyBtn">Copiar resumen</button><button type="button" class="btn small ghost" id="againBtn">Volver a revisar</button></div><p class="note" id="copyNote" style="margin-top:10px" hidden></p>';
    return h;
  }
  function summaryText(ev) {
    var L = [];
    L.push("Auditoría RIMAC — puntaje general " + fmt(ev.score) + "/10 · " + ev.stText);
    L.push(ev.stSub);
    function sec(title, items, s) {
      if (!items.length) return;
      L.push("", title + " (" + fmt(s.got) + "/" + fmt(s.tot) + " pts)");
      items.forEach(function (i) {
        L.push((i.st === "ok" ? "[ok] " : i.st === "warn" ? "[ojo] " : "[no] ") + i.criterio + (i.explicacion ? ": " + i.explicacion : ""));
        if (i.sugerencia) L.push("   → " + i.sugerencia);
      });
    }
    sec("Identidad visual", ev.id, ev.sid); sec("Copy y tono de voz", ev.cp, ev.scp); sec("Fotografía y composición", ev.fo, ev.sfo);
    if (ev.sug.length) { L.push("", "Sugerencias concretas para corregir la pieza"); ev.sug.forEach(function (s, n) { L.push((n + 1) + ". " + (s.titulo || "") + (s.detalle ? " — " + s.detalle : "")); }); }
    if (ev.alt.length) { L.push("", "Propuestas de copy"); ev.alt.forEach(function (a) { L.push("- " + a); }); }
    return L.join("\n");
  }

  /* ---------- Estados del panel de resultado ---------- */
  function showEmpty() {
    $("res").innerHTML = '<div class="r-card empty"><div class="t">Aquí aparece la calificación</div><p>Vas a recibir el mismo resultado del skill /rimac-branding:</p><ul>' +
      "<li>Puntaje general sobre 10 con su estado</li><li>Identidad visual</li><li>Copy y tono de voz</li><li>Fotografía y composición, si la pieza la tiene</li><li>Sugerencias concretas para corregirla</li></ul></div>";
  }
  function showBusy(msg) {
    var t0 = Date.now();
    $("res").innerHTML = '<div class="r-card busy"><div class="t" id="bmsg">' + esc(msg) + '</div><p>Suele tardar entre 20 y 60 segundos. En modo a fondo puede tomar más.</p><div class="indet"><i></i></div>' +
      '<div class="actions"><button type="button" class="btn small ghost" id="stopBtn">Detener</button><span class="note" id="elapsed">0 s</span></div></div>';
    clearInterval(timer);
    timer = setInterval(function () { var e = $("elapsed"); if (e) e.textContent = Math.round((Date.now() - t0) / 1000) + " s"; }, 1000);
    $("stopBtn").onclick = function () { if (ctl) ctl.abort(); };
  }
  function showError(text, retry) {
    clearInterval(timer);
    $("res").innerHTML = '<p class="notice err">' + esc(text) + "</p>" + (retry ? '<div class="actions" style="margin-top:12px"><button type="button" class="btn small" id="retryBtn">Intentar de nuevo</button></div>' : "");
    if (retry) $("retryBtn").onclick = run;
  }
  function errCopy(e) {
    switch (e && e.code) {
      case "unauthorized": return ["El código de acceso no es correcto. Revísalo y vuelve a intentar.", false];
      case "not_configured": return ["El servidor todavía no tiene configurada la clave de Anthropic. Avisa a quien administra la página.", false];
      case "payload_too_large": return ["La pieza pesa demasiado. Prueba con una imagen más liviana o con menos páginas.", false];
      case "image_rejected": return ["No pude leer la imagen. Prueba con otro PNG o JPG, o exporta el PDF de nuevo.", false];
      case "rate_limited": return ["Se alcanzó el límite de uso por ahora. Espera un momento y vuelve a intentarlo.", true];
      case "timeout": return ["La revisión tardó demasiado. Prueba con el análisis estándar o con una pieza más liviana.", true];
      case "invalid_json": return ["No pude armar la calificación con el formato correcto. Vuelve a intentarlo.", true];
      case "network": return ["No pude conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.", true];
      default: return ["La revisión se interrumpió. Vuelve a intentarlo.", true];
    }
  }

  /* ---------- Carga de archivos ---------- */
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = function () { rej(new Error("script")); };
      document.head.appendChild(s);
    });
  }
  var pdfReady = null;
  function ensurePdf() {
    if (!pdfReady) {
      pdfReady = loadScript(PDFJS).then(function () { return loadScript(PDFJS_WORKER); }).then(function () {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      });
    }
    return pdfReady;
  }
  async function pdfPages(file, cap) {
    await ensurePdf();
    var buf = await file.arrayBuffer();
    var doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    var n = Math.min(doc.numPages, cap), blobs = [];
    for (var i = 1; i <= n; i++) {
      var page = await doc.getPage(i);
      var v1 = page.getViewport({ scale: 1 });
      var sc = Math.min(3, 1600 / Math.max(v1.width, v1.height));
      var vp = page.getViewport({ scale: sc });
      var c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      blobs.push(await new Promise(function (r) { c.toBlob(r, "image/jpeg", 0.9); }));
    }
    return { blobs: blobs, total: doc.numPages };
  }

  // Reduce cada imagen (lado mayor 1600 px, JPEG) para que el envío quepa en el límite de Vercel.
  function toJpeg(url, maxSide, q) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () {
        var sc = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
        var c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(im.naturalWidth * sc)); c.height = Math.max(1, Math.round(im.naturalHeight * sc));
        var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
        res(c.toDataURL("image/jpeg", q));
      };
      im.onerror = function () { rej({ code: "image_rejected" }); };
      im.src = url;
    });
  }
  async function prepare() {
    var maxSide = 1600, q = 0.85;
    for (var attempt = 0; attempt < 5; attempt++) {
      var out = [], total = 0;
      for (var i = 0; i < pieces.length; i++) {
        var d = await toJpeg(pieces[i].url, maxSide, q);
        total += d.length; out.push(d);
      }
      if (total <= MAX_PAYLOAD) return out;
      maxSide = Math.round(maxSide * 0.8); q = Math.max(0.6, q - 0.06);
    }
    throw { code: "payload_too_large" };
  }

  function setPieces(list, name, note) {
    pieces.forEach(function (p) { try { URL.revokeObjectURL(p.url); } catch (e) {} });
    pieces = list.map(function (b) { return { blob: b, url: URL.createObjectURL(b) }; });
    pieceName = name;
    $("picked").hidden = !pieces.length;
    $("pname").textContent = name + (pieces.length > 1 ? " · " + pieces.length + " imágenes" : "");
    var th = $("thumbs"); th.className = "thumbs" + (pieces.length === 1 ? " one" : "");
    th.innerHTML = pieces.map(function (p, i) { return '<img src="' + p.url + '" alt="Vista previa ' + (i + 1) + '">'; }).join("");
    var pn = $("pnote"); pn.hidden = !note; pn.textContent = note || "";
    $("detected").hidden = true;
    last = null;
    updateRun();
  }

  async function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var out = [], notes = [], names = [];
    $("run").disabled = true;
    $("res").innerHTML = '<div class="r-card busy"><div class="t">Preparando la pieza…</div><div class="indet"><i></i></div></div>';
    for (var k = 0; k < files.length; k++) {
      var f = files[k];
      var isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      var isImg = /^image\/(png|jpeg)$/.test(f.type) || /\.(png|jpe?g)$/i.test(f.name);
      if (out.length >= MAX_IMAGES) { notes.push("Solo se revisan las primeras " + MAX_IMAGES + " imágenes."); break; }
      if (isPdf) {
        try {
          var r = await pdfPages(f, MAX_IMAGES - out.length);
          out = out.concat(r.blobs); names.push(f.name);
          if (r.total > r.blobs.length) notes.push("Del PDF se revisan las primeras " + r.blobs.length + " de " + r.total + " páginas.");
        } catch (e) { notes.push("No pude abrir " + f.name + ". Exporta la pieza como PNG o JPG e inténtalo de nuevo."); }
      } else if (isImg) {
        out.push(f); names.push(f.name);
      } else {
        notes.push(f.name + " no es PNG, JPG ni PDF.");
      }
    }
    showEmpty();
    if (!out.length) {
      setPieces([], "", "");
      $("picked").hidden = false; $("pname").textContent = "No se pudo cargar el archivo"; $("thumbs").innerHTML = "";
      var pn = $("pnote"); pn.hidden = !notes.length; pn.textContent = notes.join(" ");
      return;
    }
    setPieces(out, names.join(", "), notes.join(" "));
  }

  function codeValue() { return ($("code").value || "").trim(); }
  function updateRun() {
    $("run").disabled = !(ready && pieces.length > 0 && (!needsCode || codeValue()));
  }

  /* ---------- Ejecutar la revisión ---------- */
  function radio(name) { var el = document.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : "auto"; }

  async function run() {
    if (!ready || !pieces.length) return;
    if (ctl) ctl.abort();
    ctl = new AbortController();
    var mine = ctl;
    $("run").disabled = true;
    showBusy("Preparando la pieza…");
    try {
      var images = await prepare();
      if (mine.signal.aborted) throw { code: "cancelled" };
      var m = $("bmsg"); if (m) m.textContent = "Revisando la pieza con los lineamientos RIDE…";
      var headers = { "content-type": "application/json" };
      if (needsCode) headers["x-access-code"] = codeValue();
      var r;
      try {
        r = await fetch("/api/audit", {
          method: "POST", headers: headers, signal: mine.signal,
          body: JSON.stringify({ images: images, tipo: radio("tipo"), medio: radio("medio"), ctx: $("ctx").value.trim().slice(0, 1500), depth: $("depth").value })
        });
      } catch (e) {
        if (e && e.name === "AbortError") throw { code: "cancelled" };
        throw { code: "network" };
      }
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) throw { code: r.status === 413 ? "payload_too_large" : (data && data.error) || "upstream_error" };
      var ev = evaluate(data.result);
      last = ev;
      clearInterval(timer);
      try { sessionStorage.setItem("auditor-code", codeValue()); } catch (e) {}
      $("res").innerHTML = resultHTML(ev);
      var p = ev.pieza, bits = [];
      if (p.formato) bits.push(esc(p.formato));
      bits.push(p.sistema === "interface" ? "RIDE Interface" : "RIDE Brand");
      if (p.medio) bits.push(esc(p.medio));
      var d = $("detected"); d.hidden = false;
      d.innerHTML = "<b>Detectado:</b> " + bits.join(" · ") + (p.descripcion ? "<br>" + esc(p.descripcion) : "");
      $("copyBtn").onclick = copySummary;
      $("againBtn").onclick = run;
      var sm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      $("out").scrollIntoView({ behavior: sm ? "auto" : "smooth", block: "start" });
    } catch (e) {
      if (mine !== ctl) return;
      if (e && e.code === "cancelled") { clearInterval(timer); showEmpty(); }
      else { var c = errCopy(e); showError(c[0], c[1]); }
    } finally {
      if (mine === ctl) { clearInterval(timer); updateRun(); }
    }
  }

  async function copySummary() {
    if (!last) return;
    var t = summaryText(last), note = $("copyNote");
    try { await navigator.clipboard.writeText(t); note.textContent = "Resumen copiado. Pégalo en un correo o mensaje para tu equipo o agencia."; }
    catch (e) {
      var ta = document.createElement("textarea"); ta.value = t; ta.style.cssText = "width:100%;min-height:160px;margin-top:8px";
      note.textContent = "Tu navegador no dejó copiar solo. Selecciona el texto y cópialo:"; note.after(ta); ta.focus(); ta.select();
    }
    note.hidden = false;
  }

  /* ---------- Eventos ---------- */
  var drop = $("drop");
  ["dragenter", "dragover"].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function (e) { addFiles(e.dataTransfer && e.dataTransfer.files); });
  $("file").addEventListener("change", function (e) { addFiles(e.target.files); e.target.value = ""; });
  document.addEventListener("paste", function (e) {
    var fs = e.clipboardData && e.clipboardData.files;
    if (fs && fs.length) { e.preventDefault(); addFiles(fs); }
  });
  $("clear").addEventListener("click", function () { if (ctl) ctl.abort(); setPieces([], "", ""); showEmpty(); });
  $("run").addEventListener("click", run);
  $("code").addEventListener("input", updateRun);

  /* ---------- Arranque ---------- */
  showEmpty();
  fetch("/api/audit").then(function (r) { if (!r.ok) throw new Error("status"); return r.json(); }).then(function (d) {
    ready = true;
    needsCode = !!d.needsCode;
    $("codeBox").hidden = !needsCode;
    if (needsCode) { try { $("code").value = sessionStorage.getItem("auditor-code") || ""; } catch (e) {} }
    if (!d.configured) {
      var av = $("avail"); av.hidden = false;
      av.textContent = "El servidor todavía no tiene configurada la clave de Anthropic (ANTHROPIC_API_KEY).";
      ready = false;
    }
    updateRun();
  }).catch(function () {
    var av = $("avail"); av.hidden = false;
    av.textContent = "No pude conectar con el servidor de revisión. Si abriste el archivo directamente desde tu computador, usa la dirección publicada en Vercel.";
  });
})();
