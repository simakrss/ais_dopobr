(() => {
  const AUTH_BUILD = "20260831-unified-column-drag-v1";
  const DISMISSIBLE_MODAL_BACKDROP_SELECTOR = ".modal-backdrop, .partner-modal-backdrop, [data-documents-backdrop]";
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
  let startupFailureRendered = false;
  let modalBackdropPointerCandidate = null;
  let confirmedModalBackdropClick = null;

  function getDismissibleModalBackdrop(target) {
    return target instanceof Element && target.matches(DISMISSIBLE_MODAL_BACKDROP_SELECTOR)
      ? target
      : null;
  }

  function resetModalBackdropPointerIntent() {
    modalBackdropPointerCandidate = null;
    confirmedModalBackdropClick = null;
  }

  function installModalBackdropCloseGuard() {
    document.addEventListener("pointerdown", (event) => {
      resetModalBackdropPointerIntent();
      const backdrop = getDismissibleModalBackdrop(event.target);
      if (!backdrop || event.button !== 0 || event.isPrimary === false) return;
      modalBackdropPointerCandidate = {
        backdrop,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY
      };
    }, { capture: true });

    document.addEventListener("pointerup", (event) => {
      const candidate = modalBackdropPointerCandidate;
      modalBackdropPointerCandidate = null;
      confirmedModalBackdropClick = null;
      if (
        !candidate
        || event.pointerId !== candidate.pointerId
        || event.target !== candidate.backdrop
        || Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY) > 4
      ) return;
      confirmedModalBackdropClick = candidate.backdrop;
    }, { capture: true });

    document.addEventListener("pointercancel", resetModalBackdropPointerIntent, { capture: true });
    window.addEventListener("blur", resetModalBackdropPointerIntent);
    document.addEventListener("click", (event) => {
      const backdrop = getDismissibleModalBackdrop(event.target);
      if (!backdrop) {
        confirmedModalBackdropClick = null;
        return;
      }
      const isExplicitBackdropClick = confirmedModalBackdropClick === backdrop;
      resetModalBackdropPointerIntent();
      if (isExplicitBackdropClick || event.detail === 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true });
  }

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

  function redirectToLogin() {
    setAuthenticatedSession(null, 0);
    closeSessionExpiredDialog();
    const target = new URL(appUrl(""));
    target.hash = "";
    target.searchParams.set("signed-out", String(Date.now()));
    window.location.replace(target.toString());
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
      error.payload = payload;
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

  function renderStartupFailure(error) {
    if (startupFailureRendered) return;
    startupFailureRendered = true;
    window.clearTimeout(sessionExpiryTimer);
    const message = String(error?.message || error || "Неизвестная ошибка запуска.").trim();
    app.innerHTML = `
      <main class="auth-screen">
        <section class="auth-card auth-public-result-card is-error" role="alert">
          <div class="auth-public-result-icon" aria-hidden="true">!</div>
          <p class="auth-eyebrow">Локальная АИС</p>
          <h1>Не удалось запустить интерфейс</h1>
          <p>${escapeHtml(message)}</p>
          <p class="auth-public-result-hint">Локальный сервер работает, но браузер не завершил загрузку приложения.</p>
          <button class="primary-button" data-retry-startup type="button">Загрузить заново</button>
        </section>
      </main>
    `;
    app.querySelector("[data-retry-startup]")?.addEventListener("click", () => {
      const target = new URL(window.location.href);
      target.searchParams.set("startup-retry", String(Date.now()));
      window.location.replace(target.toString());
    });
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
            <div class="auth-partner-invite">
              <span>Хотите сотрудничать с учебным центром?</span>
              <button data-open-partner-registration type="button">Стать партнёром</button>
            </div>
            <footer class="auth-card-footer">ООО «Цифровизация Плюс»</footer>
          </div>
        </section>
      </main>
    `;
    const form = app.querySelector("[data-auth-login-form]");
    const passwordInput = form?.elements?.password;
    const passwordToggle = form?.querySelector("[data-auth-password-toggle]");
    const capsWarning = form?.querySelector("[data-auth-caps-warning]");
    app.querySelector("[data-open-partner-registration]")?.addEventListener("click", () => {
      const url = new URL(appUrl(""));
      url.searchParams.set("partner-registration", "1");
      window.history.pushState({}, "", `${url.pathname}${url.search}`);
      renderPartnerRegistration();
    });
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

  function showLoginWithoutPublicRoute() {
    const target = new URL(appUrl(""));
    window.history.pushState({}, "", target.pathname);
    renderLogin();
  }

  async function loadPartnerRegistrationSpamChallenge(form, options = {}) {
    const challengeId = form?.elements?.antiSpamChallengeId;
    const answer = form?.elements?.antiSpamAnswer;
    const question = form?.querySelector?.("[data-partner-spam-question]");
    const refreshButton = form?.querySelector?.("[data-action='refresh-partner-spam-challenge']");
    const errorElement = form?.querySelector?.("[data-partner-registration-error]");
    if (!challengeId || !answer || !question) return false;
    challengeId.value = "";
    answer.value = "";
    answer.disabled = true;
    answer.placeholder = "Загрузка проверки...";
    question.textContent = "Получаем новый пример...";
    if (refreshButton) refreshButton.disabled = true;
    try {
      const payload = await request("api/auth/partner-registration/challenge");
      if (!form.isConnected) return false;
      challengeId.value = String(payload.challengeId || "");
      question.textContent = String(payload.question || "Решите пример");
      answer.disabled = false;
      answer.placeholder = "Ответ";
      if (refreshButton) refreshButton.disabled = false;
      if (options.focus === true) answer.focus({ preventScroll: true });
      return Boolean(challengeId.value);
    } catch (error) {
      if (!form.isConnected) return false;
      question.textContent = "Не удалось загрузить проверку";
      answer.placeholder = "Обновите пример";
      if (refreshButton) refreshButton.disabled = false;
      if (options.showError !== false && errorElement) {
        errorElement.textContent = error.message;
        errorElement.hidden = false;
      }
      return false;
    }
  }

  function renderPartnerRegistration() {
    app.innerHTML = `
      <main class="auth-screen partner-registration-screen">
        <div class="auth-screen-decoration auth-screen-decoration-one" aria-hidden="true"></div>
        <div class="auth-screen-decoration auth-screen-decoration-two" aria-hidden="true"></div>
        <section class="partner-registration-card" aria-labelledby="partnerRegistrationTitle">
          <header class="partner-registration-hero">
            <div>
              <button class="partner-registration-back" data-auth-return-login type="button" aria-label="Вернуться ко входу">← Войти в систему</button>
              <p class="auth-eyebrow">Цифровизация Плюс</p>
              <h1 id="partnerRegistrationTitle">Партнёрская программа учебного центра</h1>
              <p>Заполните анкету, подтвердите email и получите доступ к личному кабинету партнёра.</p>
            </div>
            <div class="partner-registration-benefits">
              <span><strong>15%</strong> партнёрская скидка на обучение</span>
              <span><strong>10–25%</strong> кэшбэк и доход за рекомендации</span>
              <span><strong>50%</strong> вознаграждение авторам курсов и вебинаров</span>
              <span><strong>24/7</strong> материалы и начисления в личном кабинете</span>
            </div>
          </header>
          <form class="partner-registration-form" data-partner-registration-form novalidate>
            <section class="partner-registration-section">
              <div class="partner-registration-section-head"><span>1</span><div><h2>Контактные данные</h2><p>Эти данные нужны для связи и создания кабинета.</p></div></div>
              <div class="partner-registration-grid">
                <label class="is-wide"><span>Ваше ФИО <b>*</b></span><input name="name" type="text" maxlength="240" autocomplete="name" required placeholder="Иванов Иван Иванович"></label>
                <label><span>Email <b>*</b></span><input name="email" type="email" maxlength="160" autocomplete="email" required placeholder="name@example.ru"></label>
                <label><span>Мобильный телефон <b>*</b></span><input name="phone" type="tel" maxlength="40" autocomplete="tel" required placeholder="Желательно с WhatsApp"></label>
                <label class="is-wide"><span>Место проживания <b>*</b></span><input name="residence" type="text" maxlength="300" autocomplete="address-level2" required placeholder="Город, регион"></label>
              </div>
            </section>
            <section class="partner-registration-section">
              <div class="partner-registration-section-head"><span>2</span><div><h2>Направления сотрудничества <b>*</b></h2><p>Выберите хотя бы один вариант.</p></div></div>
              <div class="partner-registration-options" data-partner-directions role="group" aria-required="true" aria-describedby="partnerDirectionsError">
                <label><input name="directions" type="checkbox" value="Привлечение слушателей на курсы через социальные сети, знакомых, коллег"><span><strong>Рекомендация программ</strong>Привлечение слушателей через социальные сети, знакомых и коллег.</span></label>
                <label><input name="directions" type="checkbox" value="Разработка авторских курсов повышения квалификации/профессиональной переподготовки"><span><strong>Авторские курсы</strong>Разработка программ повышения квалификации и профессиональной переподготовки.</span></label>
                <label><input name="directions" type="checkbox" value="Проведение вебинаров и других мероприятий на актуальные темы"><span><strong>Вебинары и мероприятия</strong>Проведение мероприятий на актуальные профессиональные темы.</span></label>
              </div>
              <p class="partner-registration-field-error" id="partnerDirectionsError" data-partner-directions-error hidden>Выберите хотя бы одно направление сотрудничества.</p>
              <label class="partner-registration-other"><span>Дополнительно: другое направление</span><input name="otherDirection" type="text" maxlength="500" placeholder="Опишите свой вариант"></label>
            </section>
            <section class="partner-registration-section">
              <div class="partner-registration-section-head"><span>3</span><div><h2>О себе <b>*</b></h2><p>Расскажите об опыте и интересующих форматах сотрудничества.</p></div></div>
              <label class="partner-registration-textarea"><span>Дополнительные сведения <b>*</b></span><textarea name="additionalInfo" rows="5" maxlength="5000" required placeholder="Должность, учёная степень и звание, достижения, научные интересы, преподаваемые дисциплины"></textarea></label>
            </section>
            <div class="partner-registration-antispam" data-partner-spam-challenge>
              <div class="partner-registration-antispam-copy">
                <strong>Защита от спама</strong>
                <span>Решите одноразовое задание перед отправкой анкеты.</span>
              </div>
              <label>
                <span data-partner-spam-question aria-live="polite">Получаем новый пример...</span>
                <input name="antiSpamAnswer" type="text" inputmode="numeric" pattern="[0-9]{1,3}" maxlength="3" autocomplete="off" required disabled placeholder="Загрузка проверки...">
              </label>
              <input name="antiSpamChallengeId" type="hidden">
              <button class="ghost-button" data-action="refresh-partner-spam-challenge" type="button">Другой пример</button>
            </div>
            <label class="partner-registration-consent">
              <input name="personalDataConsent" type="checkbox" required>
              <span>Даю согласие на обработку персональных данных в соответствии с <a href="https://edu-plus.ru/wp-content/uploads/policy_pers_signed.pdf" target="_blank" rel="noopener noreferrer">политикой обработки персональных данных</a>.</span>
            </label>
            <label class="auth-honeypot" aria-hidden="true">Сайт<input name="website" type="text" tabindex="-1" autocomplete="off"></label>
            <p class="auth-error" data-partner-registration-error role="alert" aria-live="assertive" hidden></p>
            <div class="partner-registration-actions">
              <button class="primary-button auth-submit" type="submit"><span>Отправить анкету</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5"/></svg></button>
              <button class="icon-button form-cancel-button" data-auth-return-login type="button" title="Отмена" aria-label="Отмена">×</button>
            </div>
          </form>
        </section>
      </main>
    `;
    app.querySelectorAll("[data-auth-return-login]").forEach((button) => {
      button.addEventListener("click", showLoginWithoutPublicRoute);
    });
    const form = app.querySelector("[data-partner-registration-form]");
    const directionGroup = form?.querySelector("[data-partner-directions]");
    const directionInputs = [...(directionGroup?.querySelectorAll("input[name='directions']") || [])];
    const directionError = form?.querySelector("[data-partner-directions-error]");
    const updateDirectionRequirement = (showError = false) => {
      const isValid = directionInputs.some((input) => input.checked);
      directionInputs[0]?.setCustomValidity(isValid ? "" : "Выберите хотя бы одно направление сотрудничества.");
      directionGroup?.classList.toggle("is-invalid", showError && !isValid);
      directionGroup?.setAttribute("aria-invalid", showError && !isValid ? "true" : "false");
      if (directionError) directionError.hidden = !showError || isValid;
      return isValid;
    };
    directionInputs.forEach((input) => input.addEventListener("change", () => {
      updateDirectionRequirement(true);
    }));
    updateDirectionRequirement();
    form?.querySelector("[data-action='refresh-partner-spam-challenge']")?.addEventListener("click", () => {
      loadPartnerRegistrationSpamChallenge(form, { focus: true });
    });
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const directionsValid = updateDirectionRequirement(true);
      if (!form.reportValidity()) {
        if (!directionsValid) directionInputs[0]?.focus({ preventScroll: true });
        return;
      }
      const selectedDirections = [...form.querySelectorAll("input[name='directions']:checked")]
        .map((input) => input.value);
      const otherDirection = String(form.elements.otherDirection.value || "").trim();
      const errorElement = form.querySelector("[data-partner-registration-error]");
      if (!selectedDirections.length) {
        errorElement.textContent = "Выберите хотя бы одно направление сотрудничества.";
        errorElement.hidden = false;
        form.querySelector("[data-partner-directions] input")?.focus({ preventScroll: true });
        return;
      }
      if (!String(form.elements.antiSpamChallengeId.value || "").trim()) {
        errorElement.textContent = "Дождитесь загрузки проверки защиты от спама.";
        errorElement.hidden = false;
        await loadPartnerRegistrationSpamChallenge(form, { focus: true, showError: false });
        return;
      }
      const submitButton = form.querySelector("button[type='submit']");
      const submitLabel = submitButton.querySelector("span");
      submitButton.disabled = true;
      submitLabel.textContent = "Отправка...";
      errorElement.hidden = true;
      const data = new FormData(form);
      try {
        const payload = await request("api/auth/partner-registration", {
          method: "POST",
          body: JSON.stringify({
            name: data.get("name"),
            email: data.get("email"),
            phone: data.get("phone"),
            residence: data.get("residence"),
            directions: selectedDirections,
            otherDirection,
            additionalInfo: data.get("additionalInfo"),
            antiSpamChallengeId: data.get("antiSpamChallengeId"),
            antiSpamAnswer: data.get("antiSpamAnswer"),
            personalDataConsent: data.get("personalDataConsent") === "on",
            website: data.get("website")
          })
        });
        renderPartnerRegistrationSent(payload.email, payload.message);
      } catch (error) {
        errorElement.textContent = error.message;
        errorElement.hidden = false;
        submitButton.disabled = false;
        submitLabel.textContent = "Отправить анкету";
        loadPartnerRegistrationSpamChallenge(form, { showError: false });
        errorElement.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    loadPartnerRegistrationSpamChallenge(form);
    window.requestAnimationFrame(() => form?.elements?.name?.focus({ preventScroll: true }));
  }

  function renderPartnerRegistrationSent(email, message) {
    app.innerHTML = `
      <main class="auth-screen">
        <section class="auth-card auth-public-result-card">
          <div class="auth-public-result-icon" aria-hidden="true">✓</div>
          <p class="auth-eyebrow">Анкета отправлена</p>
          <h1>Подтвердите email</h1>
          <p>${escapeHtml(message || "Анкета принята. Откройте письмо и подтвердите адрес электронной почты.")}</p>
          <strong>${escapeHtml(email || "")}</strong>
          <p class="auth-public-result-hint">После подтверждения придёт второе письмо со ссылкой на кабинет, логином и паролем.</p>
          <button class="primary-button" data-auth-return-login type="button">Вернуться ко входу</button>
        </section>
      </main>
    `;
    app.querySelector("[data-auth-return-login]")?.addEventListener("click", showLoginWithoutPublicRoute);
  }

  function renderPartnerConfirmationResult({ ok, confirmed = false, message = "" }) {
    app.innerHTML = `
      <main class="auth-screen">
        <section class="auth-card auth-public-result-card ${ok ? "is-success" : "is-error"}">
          <div class="auth-public-result-icon" aria-hidden="true">${ok || confirmed ? "✓" : "!"}</div>
          <p class="auth-eyebrow">Партнёрская программа</p>
          <h1>${ok || confirmed ? "Email подтверждён" : "Не удалось подтвердить email"}</h1>
          <p>${escapeHtml(message)}</p>
          ${ok || confirmed ? '<p class="auth-public-result-hint">Проверьте входящие письма и папку «Спам»: реквизиты кабинета отправляются отдельным сообщением.</p>' : ""}
          <div class="auth-public-result-actions">
            ${!ok && !confirmed ? '<button class="ghost-button" data-open-partner-registration type="button">Заполнить анкету снова</button>' : ""}
            <button class="primary-button" data-auth-return-login type="button">Перейти ко входу</button>
          </div>
        </section>
      </main>
    `;
    app.querySelector("[data-auth-return-login]")?.addEventListener("click", showLoginWithoutPublicRoute);
    app.querySelector("[data-open-partner-registration]")?.addEventListener("click", () => {
      const url = new URL(appUrl(""));
      url.searchParams.set("partner-registration", "1");
      window.history.pushState({}, "", `${url.pathname}${url.search}`);
      renderPartnerRegistration();
    });
  }

  async function confirmPartnerRegistration(token) {
    renderLoading("Подтверждение электронной почты...");
    try {
      const payload = await request("api/auth/partner-registration/confirm", {
        method: "POST",
        body: JSON.stringify({ token })
      });
      renderPartnerConfirmationResult({ ok: true, confirmed: true, message: payload.message });
    } catch (error) {
      renderPartnerConfirmationResult({
        ok: false,
        confirmed: error.payload?.confirmed === true,
        message: error.message
      });
    }
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
        redirectToLogin();
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
        const previousRole = String(authenticatedUser?.role || "").trim();
        const nextRole = String(payload.user?.role || "").trim();
        setAuthenticatedSession(payload.user, payload.sessionExpiresAt);
        if ((previousLogin && nextLogin !== previousLogin) || (previousRole && nextRole !== previousRole)) {
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
    window.AIS_AUTH_API = Object.freeze({ request, appUrl, redirectToLogin, renderStartupFailure });
    installAuthenticatedFetch();
    renderLoading(user?.role === "partner" ? "Загрузка кабинета партнёра..." : "Загрузка системы...");
    try {
      if (user?.role === "partner") {
        await loadScript("partner-app.js");
      } else {
        await loadScript("data/program-registry.js");
        await loadScript("data/program-payment-registry.js");
        await loadScript("data/seed.js");
        await loadScript("app.js");
      }
      applicationStarted = true;
    } catch (error) {
      window.clearTimeout(sessionExpiryTimer);
      renderLogin(error.message);
    }
  }

  async function initialize() {
    renderLoading("Проверка доступа...");
    const navigationUrl = new URL(window.location.href);
    const partnerConfirmationToken = String(navigationUrl.searchParams.get("partner-confirm") || "").trim();
    if (partnerConfirmationToken) {
      navigationUrl.searchParams.delete("partner-confirm");
      window.history.replaceState({}, "", `${navigationUrl.pathname}${navigationUrl.search}`);
      await confirmPartnerRegistration(partnerConfirmationToken);
      return;
    }
    if (navigationUrl.searchParams.has("partner-registration")) {
      renderPartnerRegistration();
      return;
    }
    if (navigationUrl.searchParams.has("signed-out") || navigationUrl.searchParams.has("switch-account")) {
      try {
        await nativeFetch(appUrl("api/auth/logout"), {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json", "X-Requested-With": "AIS-Web" },
          body: "{}"
        });
      } catch (error) {
        console.warn("Не удалось подтвердить завершение предыдущей сессии", error);
      }
      setAuthenticatedSession(null, 0);
      navigationUrl.searchParams.delete("signed-out");
      navigationUrl.searchParams.delete("switch-account");
      window.history.replaceState({}, "", `${navigationUrl.pathname}${navigationUrl.search}${navigationUrl.hash}`);
      renderLogin();
      return;
    }
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

  window.addEventListener("popstate", () => {
    if (applicationStarted) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("partner-registration")) renderPartnerRegistration();
    else renderLogin();
  });

  window.addEventListener("error", (event) => {
    if (!applicationStarted) renderStartupFailure(event.error || event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (!applicationStarted) renderStartupFailure(event.reason);
  });

  installModalBackdropCloseGuard();
  initialize().catch(renderStartupFailure);
})();
