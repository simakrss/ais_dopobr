(() => {
  "use strict";

  if (window.AISFieldHtmlLinks) {
    window.AISFieldHtmlLinks.bind(document);
    return;
  }

  const fieldOverlays = new WeakMap();
  const editableLinkRanges = new Map();
  const editableHighlightName = "ais-editable-html-links";
  let editablePointer = null;
  let eventsBound = false;
  let resizeObserver = null;
  let mutationObserver = null;
  let layoutSyncFrame = 0;
  let linkModifierActive = false;

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function trimHtmlLinkCandidate(value) {
    let url = String(value || "");
    const delimiterPairs = {
      ")": "(",
      "]": "[",
      "}": "{"
    };
    while (url) {
      const lastCharacter = url.at(-1);
      if (/[.,;:!?…»“”’›]/u.test(lastCharacter)) {
        url = url.slice(0, -1);
        continue;
      }
      const openingCharacter = delimiterPairs[lastCharacter];
      if (!openingCharacter) break;
      const openingCount = Array.from(url).filter((character) => character === openingCharacter).length;
      const closingCount = Array.from(url).filter((character) => character === lastCharacter).length;
      if (closingCount <= openingCount) break;
      url = url.slice(0, -1);
    }
    return url;
  }

  function getMatches(value) {
    const source = String(value || "");
    const urlPattern = /https?:\/\/[^\s<>"']+/giu;
    const matches = [];
    for (const match of source.matchAll(urlPattern)) {
      const start = Number(match.index);
      if (start > 0 && /[\p{L}\p{N}_]/u.test(source[start - 1])) continue;
      const url = trimHtmlLinkCandidate(match[0]);
      if (!url || !normalizeHttpUrl(url)) continue;
      matches.push({
        url,
        start,
        end: start + url.length
      });
    }
    return matches;
  }

  function getAtPosition(value, position) {
    const offset = Number(position);
    if (!Number.isFinite(offset)) return null;
    return getMatches(value).find((item) => (
      offset >= item.start && offset <= item.end
    )) || null;
  }

  function renderLinks(value) {
    const source = String(value || "");
    let result = "";
    let offset = 0;
    getMatches(source).forEach((item) => {
      result += escapeHtml(source.slice(offset, item.start));
      result += `<span class="communication-template-html-link" data-template-external-url="${escapeHtml(item.url)}" title="${escapeHtml(`Ctrl + щелчок: открыть ${item.url}`)}">${escapeHtml(item.url)}</span>`;
      offset = item.end;
    });
    return `${result}${escapeHtml(source.slice(offset))}`;
  }

  function normalizeHttpUrl(value) {
    const text = String(value || "").trim();
    if (!/^https?:\/\//iu.test(text)) return "";
    try {
      const url = new URL(text);
      return ["http:", "https:"].includes(url.protocol.toLowerCase()) ? url.href : "";
    } catch (error) {
      return "";
    }
  }

  function openExternalHttpUrl(url) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function isNativeField(element) {
    if (element instanceof window.HTMLTextAreaElement) return true;
    if (!(element instanceof window.HTMLInputElement)) return false;
    return ["text", "search", "email", "url", "tel"].includes(
      String(element.type || "text").toLowerCase()
    );
  }

  function getEditableRoot(node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    const editor = element?.closest?.("[contenteditable]");
    return editor?.isContentEditable ? editor : null;
  }

  function supportsEditableHighlights() {
    return Boolean(window.CSS?.highlights && typeof window.Highlight === "function");
  }

  function getEditableFields(root) {
    if (!supportsEditableHighlights()) return [];
    const editors = new Set([getEditableRoot(root)]);
    root?.querySelectorAll?.('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]')
      .forEach((editor) => editors.add(editor));
    return Array.from(editors).filter(Boolean);
  }

  function publishEditableHighlights() {
    if (!supportsEditableHighlights()) return;
    const highlight = new window.Highlight();
    for (const [editor, links] of editableLinkRanges) {
      if (!editor.isConnected) { editableLinkRanges.delete(editor); continue; }
      links.forEach((link) => highlight.add(link.range));
    }
    if (highlight.size) window.CSS.highlights.set(editableHighlightName, highlight);
    else window.CSS.highlights.delete(editableHighlightName);
  }

  function syncEditableHighlight(editor, publish = true) {
    if (!editor || !supportsEditableHighlights()) return;
    const nodes = [];
    let text = "";
    const visit = (node) => {
      if (node.nodeType === 3) {
        const value = node.nodeValue || "";
        if (value) nodes.push({ node, start: text.length, end: text.length + value.length });
        text += value;
        return;
      }
      if (node.nodeType !== 1) return;
      if (node !== editor && node.matches('[contenteditable="false"], [data-template-token], script, style, input, textarea')) {
        text += "\n";
        return;
      }
      // URLs may span adjacent inline nodes, but not tokens or separate blocks.
      const boundary = /^(BR|DIV|P|LI|PRE|H[1-6])$/u.test(node.tagName);
      if (boundary) text += "\n";
      Array.from(node.childNodes).forEach(visit);
      if (boundary) text += "\n";
    };
    visit(editor);
    const links = getMatches(text).map((link) => {
      const first = nodes.find((item) => item.end > link.start);
      const last = nodes.find((item) => item.end >= link.end);
      if (!first || !last) return null;
      const range = document.createRange();
      range.setStart(first.node, link.start - first.start);
      range.setEnd(last.node, link.end - last.start);
      return { ...link, range };
    }).filter(Boolean);
    if (links.length) editableLinkRanges.set(editor, links);
    else editableLinkRanges.delete(editor);
    if (editablePointer?.editor === editor) updateEditableLinkPointer();
    if (publish) publishEditableHighlights();
  }

  function getEditableLinkAtPoint(editor, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return (editableLinkRanges.get(editor) || []).find((link) => (
      Array.from(link.range.getClientRects()).some((rect) => (
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      ))
    )) || null;
  }

  function updateEditableLinkPointer() {
    if (!editablePointer) return;
    const { editor, x, y } = editablePointer;
    editor.classList.toggle("editable-html-link-modifier-hover", Boolean(
      linkModifierActive && editor.isConnected && getEditableLinkAtPoint(editor, x, y)
    ));
  }

  function handleDocumentPointerMove(event) {
    syncLinkModifierState(event);
    const editor = getEditableRoot(event.target);
    if (editablePointer?.editor !== editor) {
      editablePointer?.editor.classList.remove("editable-html-link-modifier-hover");
    }
    editablePointer = editor ? { editor, x: event.clientX, y: event.clientY } : null;
    updateEditableLinkPointer();
  }

  function handleEditableFieldClick(event) {
    const editor = getEditableRoot(event.target);
    if (!editor) return;
    syncEditableHighlight(editor);
    const link = getEditableLinkAtPoint(editor, event.clientX, event.clientY);
    const url = normalizeHttpUrl(link?.url || "");
    if (!url) return;
    event.preventDefault();
    event.stopImmediatePropagation?.();
    event.stopPropagation();
    openExternalHttpUrl(url);
  }

  function removeFieldHighlight(field) {
    const overlay = fieldOverlays.get(field);
    if (!overlay) {
      field?.classList?.remove("has-native-html-links");
      field?.removeAttribute?.("data-native-html-link-field");
      return;
    }
    const host = overlay.parentElement;
    resizeObserver?.unobserve(field);
    overlay.remove();
    fieldOverlays.delete(field);
    field.classList.remove("has-native-html-links");
    field.removeAttribute("data-native-html-link-field");
    if (host && !host.querySelector("[data-native-html-link-highlight]")) {
      host.classList.remove("native-html-link-field-host");
    }
  }

  function ensureResizeObserver() {
    if (resizeObserver || typeof window.ResizeObserver !== "function") return resizeObserver;
    resizeObserver = new window.ResizeObserver((entries) => {
      entries.forEach((entry) => syncFieldHighlight(entry.target));
    });
    return resizeObserver;
  }

  function getFieldHighlightHost(field) {
    let host = field?.parentElement || null;
    // Chromium positions absolute fieldset children below the legend's anonymous box.
    // Use the nearest ordinary ancestor so the overlay and the native field share one origin.
    while (
      host
      && (
        String(host.tagName || "").toUpperCase() === "FIELDSET"
        || window.getComputedStyle(host).display === "contents"
      )
    ) {
      host = host.parentElement;
    }
    return host;
  }

  function createFieldHighlight(field) {
    const host = getFieldHighlightHost(field);
    if (!host) return null;
    if (window.getComputedStyle(host).position === "static") {
      host.classList.add("native-html-link-field-host");
    }
    const overlay = document.createElement("div");
    overlay.className = "native-html-link-highlight";
    overlay.dataset.nativeHtmlLinkHighlight = "";
    overlay.setAttribute("aria-hidden", "true");
    host.appendChild(overlay);
    fieldOverlays.set(field, overlay);
    ensureResizeObserver()?.observe(field);
    return overlay;
  }

  function positionFieldHighlight(field, overlay) {
    const host = overlay?.parentElement;
    if (!host || !field?.isConnected) return;
    const fieldRect = field.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    if (!(fieldRect.width > 0 && fieldRect.height > 0)) {
      overlay.hidden = true;
      return;
    }
    overlay.hidden = false;
    const computedFieldStyle = window.getComputedStyle(field);
    const fieldStyle = {
      boxSizing: computedFieldStyle.boxSizing,
      paddingTop: computedFieldStyle.paddingTop,
      paddingRight: computedFieldStyle.paddingRight,
      paddingBottom: computedFieldStyle.paddingBottom,
      paddingLeft: computedFieldStyle.paddingLeft,
      borderTopWidth: computedFieldStyle.borderTopWidth,
      borderRightWidth: computedFieldStyle.borderRightWidth,
      borderBottomWidth: computedFieldStyle.borderBottomWidth,
      borderLeftWidth: computedFieldStyle.borderLeftWidth,
      borderTopStyle: computedFieldStyle.borderTopStyle,
      borderRightStyle: computedFieldStyle.borderRightStyle,
      borderBottomStyle: computedFieldStyle.borderBottomStyle,
      borderLeftStyle: computedFieldStyle.borderLeftStyle,
      borderRadius: computedFieldStyle.borderRadius,
      fontFamily: computedFieldStyle.fontFamily,
      fontSize: computedFieldStyle.fontSize,
      fontStyle: computedFieldStyle.fontStyle,
      fontWeight: computedFieldStyle.fontWeight,
      fontStretch: computedFieldStyle.fontStretch,
      fontVariant: computedFieldStyle.fontVariant,
      fontKerning: computedFieldStyle.fontKerning,
      fontFeatureSettings: computedFieldStyle.fontFeatureSettings,
      fontVariationSettings: computedFieldStyle.fontVariationSettings,
      lineHeight: computedFieldStyle.lineHeight,
      letterSpacing: computedFieldStyle.letterSpacing,
      wordSpacing: computedFieldStyle.wordSpacing,
      // The native control owns all glyphs, selection and caret, even at rest.
      // The mirror only paints link backgrounds/underlines, never a second text.
      color: "transparent",
      webkitTextFillColor: "transparent",
      opacity: computedFieldStyle.opacity,
      textAlign: computedFieldStyle.textAlign,
      textIndent: computedFieldStyle.textIndent,
      textShadow: "none",
      textRendering: computedFieldStyle.textRendering,
      textTransform: computedFieldStyle.textTransform,
      direction: computedFieldStyle.direction,
      tabSize: computedFieldStyle.tabSize
    };
    const left = fieldRect.left - hostRect.left - host.clientLeft + host.scrollLeft;
    const top = fieldRect.top - hostRect.top - host.clientTop + host.scrollTop;
    Object.assign(overlay.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${fieldRect.width}px`,
      height: `${fieldRect.height}px`,
      ...fieldStyle
    });
    const borderLeft = Number.parseFloat(fieldStyle.borderLeftWidth) || 0;
    const borderTop = Number.parseFloat(fieldStyle.borderTopWidth) || 0;
    const rightInset = Math.max(Number.parseFloat(fieldStyle.borderRightWidth) || 0,
      fieldRect.width - Number(field.clientWidth || fieldRect.width) - borderLeft);
    const bottomInset = Math.max(Number.parseFloat(fieldStyle.borderBottomWidth) || 0,
      fieldRect.height - Number(field.clientHeight || fieldRect.height) - borderTop);
    // Clip decorations to the text viewport, including native scrollbar gutters.
    overlay.style.clipPath = `inset(${borderTop + (Number.parseFloat(fieldStyle.paddingTop) || 0)}px ${rightInset + (Number.parseFloat(fieldStyle.paddingRight) || 0)}px ${bottomInset + (Number.parseFloat(fieldStyle.paddingBottom) || 0)}px ${borderLeft + (Number.parseFloat(fieldStyle.paddingLeft) || 0)}px)`;
    const content = overlay.querySelector(".native-html-link-highlight-content");
    if (!content) return;
    const isTextarea = String(field.tagName || "").toUpperCase() === "TEXTAREA";
    overlay.classList.toggle("is-textarea", isTextarea);
    overlay.classList.toggle("is-single-line", !isTextarea);
    if (isTextarea) {
      Object.assign(content.style, {
        minWidth: "0px",
        whiteSpace: computedFieldStyle.whiteSpace || "pre-wrap",
        overflowWrap: computedFieldStyle.overflowWrap || "break-word",
        wordBreak: computedFieldStyle.wordBreak || "break-word"
      });
      const contentWidth = field.clientWidth
        - (Number.parseFloat(fieldStyle.paddingLeft) || 0)
        - (Number.parseFloat(fieldStyle.paddingRight) || 0);
      content.style.width = `${Math.max(0, contentWidth)}px`;
    } else {
      // Single-line inputs center their text vertically inside the content box.
      // Match that box instead of assuming that padding alone sets the baseline.
      const contentHeight = field.clientHeight
        - (Number.parseFloat(fieldStyle.paddingTop) || 0)
        - (Number.parseFloat(fieldStyle.paddingBottom) || 0);
      if (contentHeight > 0) overlay.style.lineHeight = `${contentHeight}px`;
      Object.assign(content.style, {
        minWidth: "100%",
        whiteSpace: "pre",
        overflowWrap: "normal",
        wordBreak: "normal"
      });
      content.style.width = "max-content";
    }
    content.style.transform = `translate(${-Number(field.scrollLeft || 0)}px, ${-Number(field.scrollTop || 0)}px)`;
  }

  function syncFieldHighlight(field) {
    if (!isNativeField(field)) return;
    const links = getMatches(field.value);
    if (!links.length) {
      removeFieldHighlight(field);
      return;
    }
    const overlay = fieldOverlays.get(field) || createFieldHighlight(field);
    if (!overlay) return;
    if (overlay.dataset.highlightValue !== String(field.value || "")) {
      overlay.dataset.highlightValue = String(field.value || "");
      overlay.innerHTML = `<span class="native-html-link-highlight-content">${renderLinks(field.value)}</span>`;
    }
    field.classList.add("has-native-html-links");
    field.dataset.nativeHtmlLinkField = "";
    positionFieldHighlight(field, overlay);
  }

  function handleNativeFieldClick(event) {
    if (
      event.defaultPrevented
      || !(event.ctrlKey || event.metaKey)
      || Number(event.button || 0) !== 0
      || !isNativeField(event.target)
    ) return false;
    const field = event.target;
    syncFieldHighlight(field);
    let position = null;
    try {
      position = field.selectionStart;
    } catch (error) {
      position = null;
    }
    let link = getAtPosition(field.value, position);
    if (!link && !Number.isFinite(Number(position))) {
      const links = getMatches(field.value);
      if (links.length === 1 && String(field.value || "").trim() === links[0].url) {
        [link] = links;
      }
    }
    const url = normalizeHttpUrl(link?.url || "");
    if (!url) return false;
    event.preventDefault();
    event.stopImmediatePropagation?.();
    event.stopPropagation();
    openExternalHttpUrl(url);
    return true;
  }

  function handleDocumentClick(event) {
    if (
      event.defaultPrevented
      || !(event.ctrlKey || event.metaKey)
      || Number(event.button || 0) !== 0
    ) return;
    const renderedLink = event.target.closest?.("[data-template-external-url]");
    if (!renderedLink) {
      if (!handleNativeFieldClick(event)) handleEditableFieldClick(event);
      return;
    }
    const visibleValue = String(renderedLink.textContent || "").trim();
    const candidate = visibleValue
      ? trimHtmlLinkCandidate(visibleValue)
      : renderedLink.dataset.templateExternalUrl || "";
    const url = normalizeHttpUrl(candidate);
    event.preventDefault();
    event.stopImmediatePropagation?.();
    event.stopPropagation();
    if (url) openExternalHttpUrl(url);
  }

  function setLinkModifierActive(active) {
    const nextActive = Boolean(active);
    if (linkModifierActive === nextActive) return;
    linkModifierActive = nextActive;
    document.documentElement?.classList?.toggle(
      "native-html-link-modifier-active",
      linkModifierActive
    );
    updateEditableLinkPointer();
  }

  function syncLinkModifierState(event) {
    setLinkModifierActive(Boolean(event?.ctrlKey || event?.metaKey));
  }

  function getNativeFieldFromSelectionEvent(event) {
    if (isNativeField(event?.target)) return event.target;
    return isNativeField(document.activeElement) ? document.activeElement : null;
  }

  function syncNativeFieldSelectionFromEvent(event) {
    const field = getNativeFieldFromSelectionEvent(event);
    if (!field) return;
    syncFieldHighlight(field);
  }

  function handleDocumentKeyUp(event) {
    syncLinkModifierState(event);
    syncNativeFieldSelectionFromEvent(event);
  }

  function getFields(root = document) {
    const fields = [];
    if (isNativeField(root)) fields.push(root);
    root.querySelectorAll?.("input, textarea").forEach((field) => {
      if (isNativeField(field)) fields.push(field);
    });
    return fields;
  }

  function cleanupFields(root) {
    const fields = [];
    if (root?.matches?.("[data-native-html-link-field]")) fields.push(root);
    root?.querySelectorAll?.("[data-native-html-link-field]").forEach((field) => fields.push(field));
    fields.forEach(removeFieldHighlight);
    for (const editor of editableLinkRanges.keys()) {
      if (root === editor || root?.contains?.(editor)) editableLinkRanges.delete(editor);
    }
    if (editablePointer && !editablePointer.editor.isConnected) {
      editablePointer.editor.classList.remove("editable-html-link-modifier-hover");
      editablePointer = null;
    }
  }

  function scheduleFieldLayoutSync() {
    if (layoutSyncFrame) return;
    const schedule = window.requestAnimationFrame?.bind(window)
      || ((callback) => window.setTimeout(callback, 0));
    layoutSyncFrame = schedule(() => {
      layoutSyncFrame = 0;
      document.querySelectorAll("[data-native-html-link-field]").forEach(syncFieldHighlight);
    });
  }

  function bind(root = document) {
    getFields(root).forEach(syncFieldHighlight);
    getEditableFields(root).forEach((editor) => syncEditableHighlight(editor, false));
    publishEditableHighlights();
    if (eventsBound) return;
    eventsBound = true;
    document.addEventListener("input", (event) => {
      if (isNativeField(event.target)) syncFieldHighlight(event.target);
      else syncEditableHighlight(getEditableRoot(event.target));
    }, true);
    document.addEventListener("change", (event) => {
      if (isNativeField(event.target)) syncFieldHighlight(event.target);
    }, true);
    document.addEventListener("scroll", (event) => {
      const overlay = fieldOverlays.get(event.target);
      if (overlay) positionFieldHighlight(event.target, overlay);
    }, true);
    document.addEventListener("keydown", syncLinkModifierState, true);
    document.addEventListener("keyup", handleDocumentKeyUp, true);
    document.addEventListener("pointermove", handleDocumentPointerMove, true);
    document.addEventListener("pointerup", syncNativeFieldSelectionFromEvent, true);
    document.addEventListener("select", syncNativeFieldSelectionFromEvent, true);
    document.addEventListener("selectionchange", syncNativeFieldSelectionFromEvent, true);
    document.addEventListener("focusin", syncNativeFieldSelectionFromEvent, true);
    document.addEventListener("focusout", syncNativeFieldSelectionFromEvent, true);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        setLinkModifierActive(false);
        return;
      }
      syncNativeFieldSelectionFromEvent({ target: document.activeElement });
    });
    document.addEventListener("click", handleDocumentClick, true);
    window.addEventListener("blur", () => {
      setLinkModifierActive(false);
    });
    window.addEventListener("focus", () => {
      syncNativeFieldSelectionFromEvent({ target: document.activeElement });
    });
    window.addEventListener("resize", () => {
      document.querySelectorAll("[data-native-html-link-field]").forEach(syncFieldHighlight);
    });
    if (typeof window.MutationObserver === "function" && document.body) {
      mutationObserver = new window.MutationObserver((entries) => {
        const changedEditors = new Set();
        entries.forEach((entry) => {
          changedEditors.add(getEditableRoot(entry.target));
          entry.removedNodes.forEach(cleanupFields);
          entry.addedNodes.forEach((node) => {
            if (node?.nodeType !== 1) return;
            getFields(node).forEach(syncFieldHighlight);
            getEditableFields(node).forEach((editor) => changedEditors.add(editor));
          });
        });
        changedEditors.forEach((editor) => syncEditableHighlight(editor, false));
        publishEditableHighlights();
        scheduleFieldLayoutSync();
      });
      mutationObserver.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }
  }

  window.AISFieldHtmlLinks = Object.freeze({
    bind,
    getAtPosition,
    getMatches,
    renderLinks
  });
  bind(document);
})();
