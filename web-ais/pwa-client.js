(() => {
  "use strict";
  // Installation only: do not cache HTML, API responses, documents or personal data.
  const standalone = window.matchMedia("(display-mode: standalone)");
  let installed = navigator.standalone === true || standalone.matches;
  let pendingPrompt = null;
  let prompting = false;
  let help = null;

  function updatePresentation() {
    document.documentElement.classList.toggle("ais-app-installed", installed);
    if (help?.open) {
      help.querySelector("[data-pwa-confirm]").hidden = !pendingPrompt || installed;
      if (installed) help.close();
    }
  }

  function instructions() {
    if (!window.isSecureContext) return [
      "Для установки откройте АИС по защищённому адресу HTTPS. На самом сервере также подходит http://127.0.0.1:8081/.",
      "Обычный HTTP-адрес компьютера в локальной сети не поддерживает установку приложения."
    ];
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return [
      "Откройте АИС в Safari. Нажмите «Поделиться».",
      "Выберите «На экран Домой», затем «Добавить». Если есть переключатель «Открывать как веб-приложение», включите его."
    ];
    if (/Android/i.test(ua)) return [
      "Откройте меню браузера ⋮.",
      "Выберите «Установить приложение» или «Добавить на главный экран» и подтвердите установку. Если этих пунктов нет, откройте сайт в Chrome."
    ];
    if (/Macintosh/i.test(ua) && /Safari/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua)) return [
      "В меню Safari выберите «Файл» → «Добавить в Dock».",
      "Подтвердите название «АИС Допобразование» и нажмите «Добавить». Если пункта нет, используйте Chrome или Edge."
    ];
    return [
      "В Chrome или Edge нажмите значок установки в адресной строке либо откройте меню браузера → «Установить приложение» (в Edge — «Приложения»).",
      "Подтвердите установку «АИС Допобразование». Если приложение уже установлено, выберите «Открыть в приложении»."
    ];
  }

  function showHelp(message = "") {
    if (installed) return;
    if (!help?.isConnected) {
      help = document.createElement("dialog");
      help.className = "pwa-install-dialog";
      help.setAttribute("aria-labelledby", "pwa-install-title");
      help.innerHTML = `
        <header><h2 id="pwa-install-title">АИС как приложение</h2>
          <button type="button" class="icon-button" data-pwa-close aria-label="Закрыть" title="Закрыть">×</button></header>
        <p>Значок АИС появится на устройстве. Система будет открываться в отдельном окне.</p>
        <ol data-pwa-steps></ol>
        <p class="pwa-install-note">Для работы нужен доступ к серверу и вход в систему. Установка не заменяет локальную службу АИС и не создаёт офлайн-копию базы.</p>
        <p data-pwa-status role="status" hidden></p>
        <footer><button type="button" class="primary-button" data-pwa-confirm hidden>Установить приложение</button>
          <button type="button" class="ghost-button" data-pwa-close>Понятно</button></footer>`;
      for (const text of instructions()) {
        const item = document.createElement("li");
        item.textContent = text;
        help.querySelector("[data-pwa-steps]").append(item);
      }
      help.addEventListener("click", event => {
        if (event.target.closest("[data-pwa-close]")) help.close();
        if (event.target.closest("[data-pwa-confirm]")) install();
      });
      // Escape closes just this dialog, not the profile/card behind it.
      help.addEventListener("keydown", event => event.stopPropagation());
      document.body.append(help);
    }
    const status = help.querySelector("[data-pwa-status]");
    status.textContent = message;
    status.hidden = !message;
    if (!help.open) help.showModal();
    updatePresentation();
  }

  async function install() {
    if (installed || prompting) return;
    if (!pendingPrompt) { showHelp(); return; }
    const prompt = pendingPrompt;
    pendingPrompt = null;
    prompting = true;
    try {
      // Keep this call inside the user's click; a prompt may only be used once.
      const result = prompt.prompt();
      await result;
      const choice = await prompt.userChoice;
      if (choice?.outcome === "accepted") help?.close();
    } catch {
      showHelp("Браузер не смог открыть окно установки. Используйте его меню по инструкции выше.");
    } finally {
      prompting = false;
      updatePresentation();
    }
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    pendingPrompt = event;
    updatePresentation();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    pendingPrompt = null;
    updatePresentation();
  });
  standalone.addEventListener("change", () => {
    installed = standalone.matches || navigator.standalone === true;
    updatePresentation();
  });
  // Delegation survives the authentication/app/partner DOM being re-rendered.
  document.addEventListener("click", event => {
    if (!event.target.closest?.("[data-pwa-install]")) return;
    event.preventDefault();
    event.stopPropagation();
    install();
  }, true);
  updatePresentation();
})();
