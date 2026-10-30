/* Runs in Chrome's isolated world, once per top-level page. */
(() => {
  "use strict";
  if (window !== window.top) return;
  if (globalThis.__annoyingWebsitesController) {
    globalThis.__annoyingWebsitesController.refresh();
    return;
  }

  const Config = globalThis.AnnoyConfig;
  let settings = Config.normalizeSettings();
  let allowed = false;
  let phase = "off"; // off | waiting | ready | browsing
  let deadline = 0;
  let ticker = null;
  let host = null;
  let display = null;
  let actions = null;
  let closeButton = null;
  let continueButton = null;
  let previousFocus = null;
  let lockedElements = [];
  let lastSecond = null;
  let refreshVersion = 0;

  function clearTicker() {
    if (ticker !== null) clearInterval(ticker);
    ticker = null;
  }

  function lockScrolling() {
    lockedElements = [document.documentElement, document.body].filter(Boolean).map((element) => {
      const snapshot = {
        element,
        value: element.style.getPropertyValue("overflow"),
        priority: element.style.getPropertyPriority("overflow"),
      };
      element.style.setProperty("overflow", "hidden", "important");
      return snapshot;
    });
    // Also ensure body overflow hidden like the primitive userscript
    try {
      document.body.style.overflow = "hidden";
    } catch {}
  }

  function removeOverlay() {
    host?.remove();
    host = display = actions = closeButton = continueButton = null;
    for (const { element, value, priority } of lockedElements) {
      if (element.style.getPropertyValue("overflow") !== "hidden") continue;
      if (value) element.style.setProperty("overflow", value, priority);
      else element.style.removeProperty("overflow");
    }
    lockedElements = [];
    if (previousFocus?.isConnected && typeof previousFocus.focus === "function") {
      try {
        previousFocus.focus({ preventScroll: true });
      } catch {}
    }
    previousFocus = null;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function styleButton(btn, color) {
    btn.style.padding = "12px 20px";
    btn.style.fontSize = "16px";
    btn.style.fontWeight = "bold";
    btn.style.cursor = "pointer";
    btn.style.backgroundColor = color;
    btn.style.color = "white";
    btn.style.border = "none";
    btn.style.borderRadius = "8px";
    btn.style.width = "100%";
  }

  function showOverlay() {
    clearTicker();
    removeOverlay();
    phase = "waiting";
    deadline = Date.now() + settings.waitSeconds * 1000;
    lastSecond = null;
    previousFocus = document.activeElement;
    lockScrolling();

    host = document.createElement("div");
    host.id = "annoying-websites-overlay";
    host.style.position = "fixed";
    host.style.top = "0";
    host.style.left = "0";
    host.style.width = "100vw";
    host.style.height = "100vh";
    host.style.backgroundColor = "rgba(0, 0, 0, 0.95)";
    host.style.zIndex = "2147483647";
    host.style.display = "flex";
    host.style.flexDirection = "column";
    host.style.justifyContent = "center";
    host.style.alignItems = "center";
    host.style.color = "white";
    host.style.fontFamily = "Arial, sans-serif";
    host.style.textAlign = "center";

    const message = element("h1", "", "Hey, You Are Not Supposed to Do That!!! :( :( :( Do You Really Want to Continue?");
    message.style.marginBottom = "20px";
    message.style.marginTop = "0";
    message.style.fontSize = "22px";
    message.style.padding = "0 20px";
    message.style.lineHeight = "1.4";
    message.style.color = "white";
    message.style.fontWeight = "700";
    message.style.fontFamily = "Arial, sans-serif";

    const subtitle = element("p", "", "You should be working, or just go for a walk");
    subtitle.style.margin = "0 0 30px";
    subtitle.style.padding = "0 20px";
    subtitle.style.fontSize = "16px";
    subtitle.style.fontStyle = "italic";
    subtitle.style.lineHeight = "1.4";
    subtitle.style.color = "#bfbfbf";
    subtitle.style.fontFamily = "Arial, sans-serif";

    display = document.createElement("div");
    display.id = "prod-timer";
    display.style.fontSize = "48px";
    display.style.fontWeight = "bold";
    display.textContent = String(settings.waitSeconds);

    actions = document.createElement("div");
    actions.style.marginTop = "30px";
    actions.style.display = "none";
    actions.style.flexDirection = "column";
    actions.style.gap = "15px";
    actions.style.width = "80%";
    actions.style.maxWidth = "300px";

    closeButton = document.createElement("button");
    closeButton.textContent = "Close Tab";
    styleButton(closeButton, "#f44336");
    closeButton.type = "button";

    continueButton = document.createElement("button");
    continueButton.textContent = "Continue Browsing";
    styleButton(continueButton, "#4CAF50");
    continueButton.type = "button";

    const errorMessage = element("p", "", "");
    errorMessage.hidden = true;
    errorMessage.style.color = "#ffb7ad";
    errorMessage.style.fontSize = "13px";
    errorMessage.style.margin = "15px 0 0";
    errorMessage.style.padding = "0 20px";
    errorMessage.setAttribute("role", "alert");

    closeButton.addEventListener("click", async () => {
      if (phase !== "ready") return;
      const thisHost = host;
      closeButton.disabled = continueButton.disabled = true;
      try {
        const result = await chrome.runtime.sendMessage({ type: "AW_CLOSE_TAB" });
        if (!result?.ok) throw new Error(result?.error || "Chrome did not close the tab.");
      } catch {
        if (host !== thisHost || !host?.isConnected) return;
        closeButton.disabled = continueButton.disabled = false;
        errorMessage.textContent = "Chrome couldn't close this tab. Use Ctrl+W (⌘W on Mac), or continue browsing.";
        errorMessage.hidden = false;
      }
    });

    continueButton.addEventListener("click", () => {
      if (phase === "ready") startMainTimer();
    });

    actions.append(closeButton, continueButton);

    host.append(message, subtitle, display, actions, errorMessage);
    (document.body || document.documentElement).appendChild(host);

    tick();
    ticker = setInterval(tick, 250);
  }

  function finishPause() {
    clearTicker();
    phase = "ready";
    if (display) display.textContent = "Time's up.";
    if (actions) actions.style.display = "flex";
    if (closeButton && document.visibilityState === "visible") {
      try {
        closeButton.focus({ preventScroll: true });
      } catch {}
    }
  }

  function startMainTimer() {
    clearTicker();
    removeOverlay();
    phase = "browsing";
    deadline = Date.now() + settings.intervalMinutes * 60000;
    lastSecond = null;
    if (settings.showTimerInConsole) console.log(`[Annoy] Timer started. Next break in ${settings.intervalMinutes} minutes.`);
    tick();
    ticker = setInterval(tick, 250);
  }

  function tick() {
    if (!allowed) return;
    // Deadlines, rather than decrementing a counter, avoid drift in throttled
    // background tabs and catch up after sleep or back/forward-cache restores.
    const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (phase === "waiting") {
      if (seconds <= 0) finishPause();
      else if (seconds !== lastSecond && display) display.textContent = String(seconds);
    } else if (phase === "browsing") {
      if (seconds <= 0) {
        showOverlay();
        return;
      }
      if (settings.showTimerInConsole && seconds !== lastSecond) console.log(`[Annoy] Time remaining: ${seconds}s`);
    }
    lastSecond = seconds;
  }

  function applyContext(context) {
    const previous = settings;
    const previouslyAllowed = allowed;
    settings = Config.normalizeSettings(context.settings);
    allowed = Boolean(context.allowed) && settings.enabled && Config.matchesAny(settings.websites, location.href);
    if (!allowed) {
      clearTicker();
      removeOverlay();
      phase = "off";
      return;
    }
    if (!previouslyAllowed || phase === "off") showOverlay();
    else if (phase === "browsing" && previous.intervalMinutes !== settings.intervalMinutes) startMainTimer();
    else if ((phase === "waiting" || phase === "ready") && previous.waitSeconds !== settings.waitSeconds) showOverlay();
    else tick();
  }

  async function refresh() {
    const version = ++refreshVersion;
    try {
      const response = await chrome.runtime.sendMessage({ type: "AW_GET_CONTEXT" });
      if (version !== refreshVersion) return;
      if (!response?.ok) throw new Error(response?.error || "Extension unavailable.");
      applyContext(response);
    } catch (error) {
      if (version !== refreshVersion) return;
      // Never leave a page permanently blocked after extension reload/removal.
      allowed = false;
      clearTicker();
      removeOverlay();
      phase = "off";
      console.warn("[Annoy] Reminder stopped. Reload this page if the extension was updated.", error);
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "AW_REFRESH") return false;
    refresh();
    sendResponse({ ok: true });
    return false;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && Config.KEYS.some((key) => key in changes)) refresh();
  });
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("pageshow", tick);
  window.addEventListener("popstate", refresh);
  window.navigation?.addEventListener("navigatesuccess", refresh);
  globalThis.__annoyingWebsitesController = { refresh };
  refresh();
})();
