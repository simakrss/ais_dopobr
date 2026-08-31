(() => {
  "use strict";

  if (window.AISFieldHtmlLinks) {
    window.AISFieldHtmlLinks.bind(document);
    return;
  }

  const fieldOverlays = new WeakMap();
  let eventsBound = false;
  let resizeObserver = null;
  let mutationObserver = null;
  let layoutSyncFrame = 0;

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
    while (host && window.getComputedStyle(host).display === "contents") {
      host = host.parentElement;
    }
    return host;
  }

  function isTransparentCssColor(value) {
    const color = String(value || "").trim().toLowerCase();
    if (!color || color === "transparent") return true;
    if (!/^rgba?\(/u.test(color)) return false;
    const body = color.slice(color.indexOf("(") + 1, color.lastIndexOf(")"));
    const slashIndex = body.lastIndexOf("/");
    if (slashIndex >= 0) return Number.parseFloat(body.slice(slashIndex + 1)) === 0;
    if (!color.startsWith("rgba(")) return false;
    const parts = body.split(",");
    return parts.length === 4 && Number.parseFloat(parts[3]) === 0;
  }

  function getVisibleTextColor(computedFieldStyle, host) {
    const fieldColor = String(computedFieldStyle?.color || "").trim();
    if (!isTransparentCssColor(fieldColor)) return fieldColor;
    const hostColor = String(window.getComputedStyle(host)?.color || "").trim();
    return isTransparentCssColor(hostColor) ? "#1f2926" : hostColor;
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
    const wasHighlighted = field.classList.contains("has-native-html-links");
    if (wasHighlighted) field.classList.remove("has-native-html-links");
    const computedFieldStyle = window.getComputedStyle(field);
    const visibleTextColor = getVisibleTextColor(computedFieldStyle, host);
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
      lineHeight: computedFieldStyle.lineHeight,
      letterSpacing: computedFieldStyle.letterSpacing,
      color: visibleTextColor,
      webkitTextFillColor: visibleTextColor,
      opacity: computedFieldStyle.opacity,
      textAlign: computedFieldStyle.textAlign,
      textIndent: computedFieldStyle.textIndent,
      textShadow: computedFieldStyle.textShadow,
      textTransform: computedFieldStyle.textTransform,
      direction: computedFieldStyle.direction,
      tabSize: computedFieldStyle.tabSize
    };
    if (wasHighlighted) field.classList.add("has-native-html-links");
    const left = fieldRect.left - hostRect.left - host.clientLeft + host.scrollLeft;
    const top = fieldRect.top - hostRect.top - host.clientTop + host.scrollTop;
    Object.assign(overlay.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${fieldRect.width}px`,
      height: `${fieldRect.height}px`,
      ...fieldStyle
    });
    const content = overlay.querySelector(".native-html-link-highlight-content");
    if (!content) return;
    const isTextarea = String(field.tagName || "").toUpperCase() === "TEXTAREA";
    overlay.classList.toggle("is-textarea", isTextarea);
    overlay.classList.toggle("is-single-line", !isTextarea);
    if (isTextarea) {
      const contentWidth = field.clientWidth
        - (Number.parseFloat(fieldStyle.paddingLeft) || 0)
        - (Number.parseFloat(fieldStyle.paddingRight) || 0);
      content.style.width = `${Math.max(0, contentWidth)}px`;
    } else {
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
      handleNativeFieldClick(event);
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
    if (eventsBound) return;
    eventsBound = true;
    document.addEventListener("input", (event) => {
      if (isNativeField(event.target)) syncFieldHighlight(event.target);
    }, true);
    document.addEventListener("change", (event) => {
      if (isNativeField(event.target)) syncFieldHighlight(event.target);
    }, true);
    document.addEventListener("scroll", (event) => {
      const overlay = fieldOverlays.get(event.target);
      if (overlay) positionFieldHighlight(event.target, overlay);
    }, true);
    document.addEventListener("click", handleDocumentClick, true);
    window.addEventListener("resize", () => {
      document.querySelectorAll("[data-native-html-link-field]").forEach(syncFieldHighlight);
    });
    if (typeof window.MutationObserver === "function" && document.body) {
      mutationObserver = new window.MutationObserver((entries) => {
        entries.forEach((entry) => {
          entry.removedNodes.forEach(cleanupFields);
          entry.addedNodes.forEach((node) => {
            if (node?.nodeType === 1) bind(node);
          });
        });
        scheduleFieldLayoutSync();
      });
      mutationObserver.observe(document.body, {
        childList: true,
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
