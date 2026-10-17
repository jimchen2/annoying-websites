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
  let dialog = null;
  let display = null;
  let actions = null;
  let readyStatus = null;
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
    lockedElements = [document.documentElement, document.body].filter(Boolean).map(element => {
      const snapshot = {
        element,
        properties: ["overflow-x", "overflow-y"].map(property => ({
          property,
          value: element.style.getPropertyValue(property),
          priority: element.style.getPropertyPriority(property)
        }))
      };
      element.style.setProperty("overflow", "hidden", "important");
      return snapshot;
    });
  }

  function removeOverlay() {
    if (dialog?.open) {
      try { dialog.close(); } catch { /* The document may be navigating away. */ }
    }
    host?.remove();
    host = dialog = display = actions = readyStatus = closeButton = continueButton = null;
    for (const { element, properties } of lockedElements) {
      // Restore each longhand independently, including an original overflow-x
      // without overflow-y. Don't overwrite unrelated website style changes.
      for (const { property, value, priority } of properties) {
        if (element.style.getPropertyValue(property) !== "hidden" || element.style.getPropertyPriority(property) !== "important") continue;
        if (value) element.style.setProperty(property, value, priority);
        else element.style.removeProperty(property);
      }
    }
    lockedElements = [];
    if (previousFocus?.isConnected && typeof previousFocus.focus === "function") {
      try { previousFocus.focus({ preventScroll: true }); } catch { /* Ignore a stale focus target. */ }
    }
    previousFocus = null;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
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
    host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important;";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { color-scheme: dark; }
      *, *::before, *::after { box-sizing: border-box; }
      dialog { position:fixed; inset:0; margin:0; border:0; padding:28px; width:100vw; height:100vh; height:100dvh; max-width:none; max-height:none; background:rgba(9,16,25,.97); color:#f5f8fb; display:grid; place-items:center; overflow:auto; font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; text-align:center; }
      dialog:not([open]) { display:none; }
      dialog::backdrop { background:rgba(9,16,25,.94); }
      .panel { width:min(100%,580px); margin:auto; padding:30px 0; }
      .mark { width:54px; height:54px; margin:0 auto 24px; border:1px solid #33534e; border-radius:18px; background:#15312c; display:flex; align-items:center; justify-content:center; gap:6px; }
      .mark span { display:block; height:22px; width:6px; border-radius:2px; background:#9de7c2; }
      .eyebrow { color:#9de7c2; font-size:11px; font-weight:700; letter-spacing:2px; margin:0 0 18px; }
      h1 { color:#f5f8fb; font-size:clamp(20px,3vw,27px); font-weight:650; line-height:1.45; letter-spacing:-.5px; margin:0 auto 20px; outline:none; }
      .hint { margin:0; color:#a6b6c7; font-size:14px; }
      .timer { margin:22px 0 0; font-size:80px; line-height:1.2; font-weight:600; letter-spacing:-4px; font-variant-numeric:tabular-nums; color:#d6f6e4; }
      .timer.ready { font-size:35px; letter-spacing:-1px; padding:18px 0 14px; }
      .unit { color:#8296a8; text-transform:uppercase; letter-spacing:2px; font-size:10px; margin:6px 0 0; }
      .actions { width:min(100%,310px); display:flex; flex-direction:column; gap:12px; margin:24px auto 0; }
      [hidden] { display:none!important; }
      button { appearance:none; cursor:pointer; border-radius:12px; border:1px solid transparent; font:600 15px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; width:100%; min-height:48px; padding:13px 20px; transition:background .15s; }
      .close { color:#0f2521; background:#a3e5bf; }
      .close:hover { background:#c5f4d7; }
      .continue { color:#dce5ed; background:#1e2a36; border-color:#374654; }
      .continue:hover { background:#2a3948; }
      button:focus-visible { outline:3px solid #f2d68b; outline-offset:4px; }
      button:disabled { cursor:wait; opacity:.6; }
      .footer { font-size:11px; color:#718697; margin:30px 0 0; }
      .error { color:#ffb7ad; font-size:13px; margin:15px 0 0; }
      .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
      @media(prefers-reduced-motion:reduce) { button { transition:none; } }
    `;
    shadow.appendChild(style);
    dialog = element("dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "aw-heading");
    dialog.addEventListener("cancel", event => event.preventDefault());
    dialog.addEventListener("keydown", event => {
      if (event.key === "Escape") event.preventDefault();
    });
    const panel = element("section", "panel");
    const mark = element("div", "mark");
    mark.setAttribute("aria-hidden", "true");
    mark.append(element("span"), element("span"));
    const heading = element("h1", "", "Hey, You Are Not Supposed to Do That!!! :( :( :( Do You Really Want to Continue?");
    heading.id = "aw-heading";
    heading.tabIndex = -1;
    display = element("div", "timer", String(settings.waitSeconds));
    display.setAttribute("aria-label", "Pause countdown");
    display.setAttribute("aria-live", "off");
    const unit = element("p", "unit", "seconds to reconsider");
    actions = element("div", "actions");
    actions.hidden = true;
    closeButton = element("button", "close", "Close Tab");
    closeButton.type = "button";
    continueButton = element("button", "continue", "Continue Browsing");
    continueButton.type = "button";
    const errorMessage = element("p", "error");
    errorMessage.setAttribute("role", "alert");
    errorMessage.hidden = true;
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
    readyStatus = element("p", "sr-only");
    readyStatus.setAttribute("role", "status");
    readyStatus.setAttribute("aria-live", "polite");
    panel.append(mark, element("p", "eyebrow", "ANNOYING WEBSITES"), heading,
      element("p", "hint", "A small pause. An intentional choice."), display, unit,
      actions, errorMessage, readyStatus,
      element("p", "footer", "Your next reminder starts only after you continue."));
    dialog.appendChild(panel);
    shadow.appendChild(dialog);
    document.documentElement.appendChild(host);
    try { dialog.showModal(); } catch { dialog.setAttribute("open", ""); }
    heading.focus({ preventScroll: true });
    tick();
    ticker = setInterval(tick, 250);
  }

  function finishPause() {
    clearTicker();
    phase = "ready";
    display.textContent = "Time's up.";
    display.classList.add("ready");
    const unit = dialog.querySelector(".unit");
    if (unit) unit.textContent = "what would you like to do?";
    actions.hidden = false;
    readyStatus.textContent = "Pause complete. Choose Close Tab or Continue Browsing.";
    if (document.visibilityState === "visible") closeButton.focus({ preventScroll: true });
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
    if (area === "sync" && Config.KEYS.some(key => key in changes)) refresh();
  });
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("pageshow", tick);
  window.addEventListener("popstate", refresh);
  window.navigation?.addEventListener("navigatesuccess", refresh);
  globalThis.__annoyingWebsitesController = { refresh };
  refresh();
})();
