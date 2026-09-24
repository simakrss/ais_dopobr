"use strict";
// PDF.js 6.3.289 (legacy build), served locally. No document leaves the browser.
(() => {
  let libraryPromise;
  function preload(baseUrl = document.baseURI) {
    libraryPromise ||= import(new URL("pdfjs-core.js", baseUrl).href).catch(e => { libraryPromise = null; throw e; });
    return libraryPromise;
  }
  function mount(host, blob, {fileName = "Документ.pdf", baseUrl = document.baseURI, externalControls = false, onRender = () => {}, onError = () => {}} = {}) {
    let closed = false, loading = null, pdf = null, renderTask = null, sequence = 0, pageNumber = 1, zoom = 1;
    let rotation = 0;
    let running = false, rerender = false;
    host.dataset.pdfState = "loading";
    const url = URL.createObjectURL(new Blob([blob], {type: "application/pdf"}));
    host.innerHTML = `<div class="pdf-preview-toolbar" role="toolbar" aria-label="Просмотр PDF">
      <button type="button" data-pdf-prev aria-label="Предыдущая страница">‹</button>
      <span data-pdf-page aria-live="polite">Загрузка…</span>
      <button type="button" data-pdf-next aria-label="Следующая страница">›</button>
      <button type="button" data-pdf-minus aria-label="Уменьшить" ${externalControls ? "hidden" : ""}>−</button>
      <button type="button" data-pdf-plus aria-label="Увеличить" ${externalControls ? "hidden" : ""}>+</button>
      <a data-pdf-open target="_blank" rel="noopener" ${externalControls ? "hidden" : ""}>Открыть PDF ↗</a>
      <a data-pdf-download ${externalControls ? "hidden" : ""}>Скачать</a>
    </div><div class="pdf-preview-status" data-pdf-status role="status">Подготавливаем страницу…</div>
    <div class="pdf-preview-scroll" data-pdf-scroll><canvas data-pdf-canvas role="img" aria-label="Страница документа"></canvas></div>`;
    const canvas = host.querySelector("[data-pdf-canvas]"), scroll = host.querySelector("[data-pdf-scroll]");
    const status = host.querySelector("[data-pdf-status]"), label = host.querySelector("[data-pdf-page]");
    const prev = host.querySelector("[data-pdf-prev]"), next = host.querySelector("[data-pdf-next]");
    host.querySelector("[data-pdf-open]").href = url;
    const download = host.querySelector("[data-pdf-download]"); download.href = url; download.download = fileName.replace(/\.(?:docx|pdf)$/i, "") + ".pdf";
    function controls() { prev.disabled = !pdf || pageNumber <= 1; next.disabled = !pdf || pageNumber >= pdf.numPages; }
    controls();
    function error(message) {
      if (closed) return;
      host.dataset.pdfState = "error";
      status.hidden = false; status.textContent = message; label.textContent = "Ошибка";
      onError(message);
    }
    async function render() {
      if (closed || !pdf) return;
      if (running) { rerender = true; sequence++; renderTask?.cancel(); return; }
      running = true;
      do {
        rerender = false; const current = ++sequence, number = pageNumber;
        status.hidden = false; status.textContent = `Страница ${number}…`; controls();
        try {
          const page = await pdf.getPage(number);
          if (closed || current !== sequence) continue;
          const pageRotation = ((page.rotate + rotation) % 360 + 360) % 360;
          const original = page.getViewport({scale: 1, rotation: pageRotation});
          const scale = Math.max(160, scroll.clientWidth - 16) / original.width * zoom;
          const viewport = page.getViewport({scale, rotation: pageRotation});
          // One page only, capped canvas memory for mobile Safari/Android.
          const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4000000 / (viewport.width * viewport.height)));
          canvas.width = Math.max(1, Math.floor(viewport.width * ratio)); canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
          canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
          canvas.setAttribute("aria-label", `Страница ${number} из ${pdf.numPages}`);
          renderTask = page.render({canvasContext: canvas.getContext("2d"), viewport, transform: [ratio, 0, 0, ratio, 0, 0]});
          await renderTask.promise;
          if (!closed && current === sequence) {
            label.textContent = `${number} / ${pdf.numPages}`; status.hidden = true;
            host.dataset.pdfState = "ready";
            onRender();
          }
          page.cleanup();
        } catch (e) { if (e.name !== "RenderingCancelledException") error("Не удалось показать страницу. Можно открыть PDF или скачать файл."); }
        finally { renderTask = null; }
      } while (rerender && !closed);
      running = false;
    }
    prev.onclick = () => { if (pdf && pageNumber > 1) { pageNumber--; scroll.scrollTop = 0; render(); } };
    next.onclick = () => { if (pdf && pageNumber < pdf.numPages) { pageNumber++; scroll.scrollTop = 0; render(); } };
    host.querySelector("[data-pdf-minus]").onclick = () => { zoom = Math.max(0.75, zoom - 0.25); render(); };
    host.querySelector("[data-pdf-plus]").onclick = () => { zoom = Math.min(3, zoom + 0.25); render(); };
    let width = 0;
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
      if (Math.abs(scroll.clientWidth - width) > 3) { width = scroll.clientWidth; render(); }
    }) : null;
    observer?.observe(scroll);
    const ready = (async () => {
      const lib = await preload(baseUrl);
      if (closed) return;
      lib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-worker.js", baseUrl).href;
      const data = new Uint8Array(await blob.arrayBuffer());
      if (closed) return;
      loading = lib.getDocument({data, isEvalSupported: false, useWasm: false, useSystemFonts: true});
      pdf = await loading.promise;
      if (closed) { await pdf.destroy(); return; }
      await render();
    })().catch(() => error("Не удалось загрузить просмотр PDF. Откройте файл или скачайте его по ссылке выше."));
    return {ready, setView({zoom: nextZoom = zoom, rotation: nextRotation = rotation} = {}) {
      if (closed) return;
      nextZoom = Math.max(0.5, Math.min(3, Number(nextZoom) || 1));
      nextRotation = Math.round((Number(nextRotation) || 0) / 90) * 90;
      if (zoom === nextZoom && rotation === nextRotation) return;
      zoom = nextZoom; rotation = nextRotation;
      render();
    }, destroy() {
      if (closed) return; closed = true; sequence++; observer?.disconnect(); renderTask?.cancel();
      loading?.destroy().catch(() => {}); canvas.width = canvas.height = 0;
      // Let a user-initiated new tab/download consume its blob before releasing it.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }};
  }
  window.AisPdfPreview = {mount, preload};
})();
