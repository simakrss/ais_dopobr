(() => {
  const AUTH_BUILD = "20260812-audit-event-values-v1";
  const baseUrl = new URL(".", document.currentScript?.src || window.location.href);
  const app = document.getElementById("app");
  const nativeFetch = window.fetch.bind(window);
  const MAX_TIMER_DELAY = 2147483647;
  let authenticatedUser = null;
  let applicationStarted = false;
  let authenticatedFetchInstalled = false;
  let sessionExpiresAt = 0;
  let sessionExpiryTimer = 0;
  let sessionExpiredDialog = null;

  function appUrl(pathname) {
    return new URL(String(pathname || "").replace(/^\/+/, ""), baseUrl).toString();
  }

  function isAuthenticationRequest(input) {
    try {
      const target = typeof input === "string" ? input : String(input?.url || "");
      return new URL(target, baseUrl).pathname.includes("/api/auth/");
    } catch {
      return false;
    }
  }

  function scheduleSessionExpiration(expiresAt) {
    window.clearTimeout(sessionExpiryTimer);
    sessionExpiresAt = Math.max(0, Number(expiresAt) || 0);
    if (!sessionExpiresAt) return;
    const delay = sessionExpiresAt - Date.now();
    if (delay <= 0) {
      handleSessionExpired();
      return;
    }
    sessionExpiryTimer = window.setTimeout(() => {
      if (Date.now() >= sessionExpiresAt) handleSessionExpired();
      else scheduleSessionExpiration(sessionExpiresAt);
    }, Math.min(delay + 50, MAX_TIMER_DELAY));
  }

  function setAuthenticatedSession(user, expiresAt) {
    authenticatedUser = user && typeof user === "object" ? { ...user } : null;
    window.AIS_AUTH_USER = authenticatedUser;
    scheduleSessionExpiration(expiresAt);
  }

  async function request(pathname, options = {}) {
    const response = await nativeFetch(appUrl(pathname), {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        "X-Requested-With": "AIS-Web",
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && !isAuthenticationRequest(pathname)) {
        handleSessionExpired();
      }
      const error = new Error(payload.error || `Ошибка сервера: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function installAuthenticatedFetch() {
    if (authenticatedFetchInstalled) return;
    authenticatedFetchInstalled = true;
    window.fetch = async (input, init = {}) => {
      const response = await nativeFetch(input, {
        credentials: "same-origin",
        ...init
      });
      if (response.status === 401 && !isAuthenticationRequest(input)) {
        handleSessionExpired();
      }
      return response;
    };
  }

  function loadScript(pathname) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${appUrl(pathname)}?v=${encodeURIComponent(AUTH_BUILD)}`;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Не удалось загрузить ${pathname}.`));
      document.body.append(script);
    });
  }

  function renderLoading(message = "Загрузка системы...") {
    app.innerHTML = `
      <main class="auth-screen" aria-live="polite">
        <section class="auth-card auth-loading-card">
          <div class="auth-brand-mark">АИС</div>
          <strong>${message}</strong>
          <span class="auth-spinner" aria-hidden="true"></span>
        </section>
      </main>
    `;
  }

  function renderLogin(errorMessage = "") {
    app.innerHTML = `
      <main class="auth-screen">
        <div class="auth-screen-decoration auth-screen-decoration-one" aria-hidden="true"></div>
        <div class="auth-screen-decoration auth-screen-decoration-two" aria-hidden="true"></div>
        <section class="auth-card auth-login-card" aria-labelledby="authTitle">
          <aside class="auth-brand-panel">
            <div class="auth-brand-mark auth-brand-mark-large">АИС</div>
            <p class="auth-eyebrow">Учебный центр</p>
            <h1>Допобразование</h1>
            <p class="auth-brand-description">
              Единая система работы со слушателями, программами и документами.
            </p>
            <div class="auth-brand-points" aria-hidden="true">
              <span>
                <svg viewBox="0 0 24 24"><path d="M4 19.5V5.8c0-.7.6-1.3 1.3-1.3H18a2 2 0 0 1 2 2v13H6a2 2 0 0 0-2 2m0-2a2 2 0 0 1 2-2h14M8 8h8M8 11h6"/></svg>
                Карточки и программы
              </span>
              <span>
                <svg viewBox="0 0 24 24"><path d="M12 3 4 7v5c0 4.6 3.2 7.7 8 9 4.8-1.3 8-4.4 8-9V7l-8-4Zm-3 9 2 2 4-4"/></svg>
                Защищённые данные
              </span>
            </div>
          </aside>
          <div class="auth-form-panel">
            <header class="auth-card-head">
              <p class="auth-eyebrow">Защищённый доступ</p>
              <h2 id="authTitle">Вход в систему</h2>
              <p>Введите логин и пароль своей учётной записи.</p>
            </header>
            <form class="auth-login-form" data-auth-login-form novalidate>
              <label>
                <span>Логин</span>
                <div class="auth-input-shell">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"/></svg>
                  <input name="login" type="text" autocomplete="username" placeholder="Введите логин" required autofocus>
                </div>
              </label>
              <label>
                <span>Пароль</span>
                <div class="auth-input-shell">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5V10Zm7 4v3"/></svg>
                  <input name="password" type="password" autocomplete="current-password" placeholder="Введите пароль" required>
                  <button class="auth-password-toggle" data-auth-password-toggle type="button" aria-label="Показать пароль" aria-pressed="false" title="Показать пароль">
                    <svg class="auth-eye-open" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/></svg>
                    <svg class="auth-eye-closed" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M10.6 6.1A9.9 9.9 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.3 3M6.2 6.2A16.3 16.3 0 0 0 2.5 12s3.5 6 9.5 6a9.7 9.7 0 0 0 3.2-.5M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>
                  </button>
                </div>
              </label>
              <p class="auth-caps-warning" data-auth-caps-warning hidden>Включён Caps Lock</p>
              <p class="auth-error" data-auth-error role="alert" aria-live="assertive" ${errorMessage ? "" : "hidden"}>${escapeHtml(errorMessage)}</p>
              <button class="primary-button auth-submit" type="submit">
                <span>Войти</span>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5"/></svg>
              </button>
            </form>
            <footer class="auth-card-footer">ООО «Цифровизация Плюс»</footer>
          </div>
        </section>
      </main>
    `;
    const form = app.querySelector("[data-auth-login-form]");
    const passwordInput = form?.elements?.password;
    const passwordToggle = form?.querySelector("[data-auth-password-toggle]");
    const capsWarning = form?.querySelector("[data-auth-caps-warning]");
    passwordToggle?.addEventListener("click", () => {
      const showPassword = passwordInput.type === "password";
      passwordInput.type = showPassword ? "text" : "password";
      passwordToggle.classList.toggle("is-visible", showPassword);
      passwordToggle.setAttribute("aria-pressed", showPassword ? "true" : "false");
      passwordToggle.setAttribute("aria-label", showPassword ? "Скрыть пароль" : "Показать пароль");
      passwordToggle.title = showPassword ? "Скрыть пароль" : "Показать пароль";
      passwordInput.focus({ preventScroll: true });
    });
    const updateCapsLockWarning = (event) => {
      if (!capsWarning || typeof event.getModifierState !== "function") return;
      capsWarning.hidden = !event.getModifierState("CapsLock");
    };
    passwordInput?.addEventListener("keydown", updateCapsLockWarning);
    passwordInput?.addEventListener("keyup", updateCapsLockWarning);
    passwordInput?.addEventListener("blur", () => {
      if (capsWarning) capsWarning.hidden = true;
    });
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const button = form.querySelector("button[type='submit']");
      const buttonLabel = button.querySelector("span");
      const error = form.querySelector("[data-auth-error]");
      const data = new FormData(form);
      button.disabled = true;
      if (buttonLabel) buttonLabel.textContent = "Вход...";
      error.hidden = true;
      try {
        const payload = await request("api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            login: String(data.get("login") || "").trim(),
            password: String(data.get("password") || "")
          })
        });
        await startApplication(payload.user, payload.sessionExpiresAt);
      } catch (requestError) {
        error.textContent = requestError.message;
        error.hidden = false;
        form.elements.password.value = "";
        form.elements.password.focus();
        button.disabled = false;
        if (buttonLabel) buttonLabel.textContent = "Войти";
      }
    });
  }

  function closeSessionExpiredDialog() {
    sessionExpiredDialog?.remove();
    sessionExpiredDialog = null;
    document.body.classList.remove("is-session-expired");
  }

  function handleSessionExpired() {
    window.clearTimeout(sessionExpiryTimer);
    sessionExpiryTimer = 0;
    if (!applicationStarted || sessionExpiredDialog) return;
    const previousLogin = String(authenticatedUser?.login || "").trim();
    const overlay = document.createElement("div");
    overlay.className = "session-expired-backdrop";
    overlay.setAttribute("role", "presentation");
    overlay.innerHTML = `
      <section class="session-expired-dialog" role="dialog" aria-modal="true" aria-labelledby="sessionExpiredTitle" aria-describedby="sessionExpiredDescription">
        <div class="session-expired-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false"><path d="M7 10V7a5 5 0 0 1 10 0v3"></path><rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M12 14v3"></path></svg>
        </div>
        <header class="session-expired-head">
          <p class="auth-eyebrow">Сеанс завершён</p>
          <h2 id="sessionExpiredTitle">Требуется повторный вход</h2>
          <p id="sessionExpiredDescription">Срок действия сессии истёк. Войдите снова, чтобы продолжить работу с системой.</p>
        </header>
        <form class="session-expired-form" data-session-expired-form novalidate>
          <label>
            <span>Логин</span>
            <div class="auth-input-shell">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"></path></svg>
              <input name="login" type="text" autocomplete="username" value="${escapeHtml(previousLogin)}" placeholder="Введите логин" required>
            </div>
          </label>
          <label>
            <span>Пароль</span>
            <div class="auth-input-shell">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5V10Zm7 4v3"></path></svg>
              <input name="password" type="password" autocomplete="current-password" placeholder="Введите пароль" required>
              <button class="auth-password-toggle" data-session-password-toggle type="button" aria-label="Показать пароль" aria-pressed="false" title="Показать пароль">
                <svg class="auth-eye-open" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"></path></svg>
                <svg class="auth-eye-closed" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M10.6 6.1A9.9 9.9 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.3 3M6.2 6.2A16.3 16.3 0 0 0 2.5 12s3.5 6 9.5 6a9.7 9.7 0 0 0 3.2-.5M9.9 9.9a3 3 0 0 0 4.2 4.2"></path></svg>
              </button>
            </div>
          </label>
          <p class="auth-error" data-session-expired-error role="alert" aria-live="assertive" hidden></p>
          <p class="session-expired-hint">После входа повторите последнее действие.</p>
          <div class="session-expired-actions">
            <button class="ghost-button" data-session-expired-logout type="button">Выйти</button>
            <button class="primary-button auth-submit" type="submit">
              <span>Войти снова</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5"></path></svg>
            </button>
          </div>
        </form>
      </section>
    `;
    document.body.append(overlay);
    document.body.classList.add("is-session-expired");
    sessionExpiredDialog = overlay;

    const form = overlay.querySelector("[data-session-expired-form]");
    const passwordInput = form.elements.password;
    const passwordToggle = overlay.querySelector("[data-session-password-toggle]");
    passwordToggle.addEventListener("click", () => {
      const showPassword = passwordInput.type === "password";
      passwordInput.type = showPassword ? "text" : "password";
      passwordToggle.classList.toggle("is-visible", showPassword);
      passwordToggle.setAttribute("aria-pressed", showPassword ? "true" : "false");
      passwordToggle.setAttribute("aria-label", showPassword ? "Скрыть пароль" : "Показать пароль");
      passwordToggle.title = showPassword ? "Скрыть пароль" : "Показать пароль";
      passwordInput.focus({ preventScroll: true });
    });
    overlay.querySelector("[data-session-expired-logout]").addEventListener("click", async () => {
      try {
        await nativeFetch(appUrl("api/auth/logout"), {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-Requested-With": "AIS-Web" },
          body: "{}"
        });
      } finally {
        window.location.reload();
      }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const submitButton = form.querySelector("button[type='submit']");
      const submitLabel = submitButton.querySelector("span");
      const errorElement = form.querySelector("[data-session-expired-error]");
      const data = new FormData(form);
      submitButton.disabled = true;
      submitLabel.textContent = "Вход...";
      errorElement.hidden = true;
      try {
        const payload = await request("api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            login: String(data.get("login") || "").trim(),
            password: String(data.get("password") || "")
          })
        });
        const nextLogin = String(payload.user?.login || "").trim();
        setAuthenticatedSession(payload.user, payload.sessionExpiresAt);
        if (previousLogin && nextLogin !== previousLogin) {
          window.location.reload();
          return;
        }
        closeSessionExpiredDialog();
        window.dispatchEvent(new CustomEvent("ais:auth-refreshed", {
          detail: { user: payload.user }
        }));
      } catch (error) {
        errorElement.textContent = error.message;
        errorElement.hidden = false;
        passwordInput.value = "";
        passwordInput.focus();
        submitButton.disabled = false;
        submitLabel.textContent = "Войти снова";
      }
    });
    window.requestAnimationFrame(() => passwordInput.focus({ preventScroll: true }));
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function startApplication(user, expiresAt) {
    setAuthenticatedSession(user, expiresAt);
    window.AIS_AUTH_API = Object.freeze({ request, appUrl });
    installAuthenticatedFetch();
    renderLoading();
    try {
      await loadScript("data/program-registry.js");
      await loadScript("data/program-payment-registry.js");
      await loadScript("data/seed.js");
      await loadScript("app.js");
      applicationStarted = true;
    } catch (error) {
      window.clearTimeout(sessionExpiryTimer);
      renderLogin(error.message);
    }
  }

  async function initialize() {
    renderLoading("Проверка доступа...");
    try {
      const payload = await request("api/auth/me");
      await startApplication(payload.user, payload.sessionExpiresAt);
    } catch (error) {
      if (error.status !== 401) console.warn("Служба авторизации недоступна", error);
      renderLogin(error.status === 401 ? "" : error.message);
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && sessionExpiresAt && Date.now() >= sessionExpiresAt) {
      handleSessionExpired();
    }
  });

  initialize();
})();
