"use strict";
(() => {
  const Config = globalThis.AnnoyConfig;
  const $ = id => document.getElementById(id);
  let settings = Config.normalizeSettings();
  let tabUrl = "";
  let granted = [];
  let missing = [];
  let updating = false;

  function notice(message) {
    $("popup-notice").hidden = !message;
    $("popup-notice").textContent = message;
  }
  function render() {
    $("popup-enabled").checked = settings.enabled;
    $("enabled-label").textContent = settings.enabled ? "on" : "off";
    $("enabled-help").textContent = settings.enabled ? "A pause before you continue." : "Browse without reminders.";
    $("interval-value").textContent = settings.intervalMinutes;
    $("wait-value").textContent = settings.waitSeconds;
    $("popup-site-count").textContent = `${settings.websites.length} website pattern${settings.websites.length === 1 ? "" : "s"}`;
    let hostname = "Not a website";
    try {
      const url = new URL(tabUrl);
      if (["http:", "https:"].includes(url.protocol)) hostname = url.hostname;
    } catch { /* Chrome hides URLs without the matching host permission. */ }
    $("current-host").textContent = hostname === "Not a website" && !tabUrl ? "Not covered / restricted tab" : hostname;
    const matched = Config.matchesAny(settings.websites, tabUrl);
    const permitted = Config.matchesAny(granted, tabUrl);
    let text = "No reminder on this page";
    let active = false;
    if (!settings.enabled) text = "All reminders are paused";
    else if (matched && !permitted) text = "Site access needed — open settings";
    else if (matched && permitted) { text = "Reminders active on this page"; active = true; }
    $("current-status").textContent = text;
    $("current-status").className = `site-status${active ? " is-active" : ""}`;
    notice(missing.length ? `${missing.length} website pattern${missing.length === 1 ? " needs" : "s need"} permission on this computer. Open settings and save to grant access.` : "");
  }
  async function load() {
    const [result, tabs] = await Promise.all([
      chrome.runtime.sendMessage({ type: "AW_STATUS" }),
      chrome.tabs.query({ active: true, currentWindow: true })
    ]);
    if (!result?.ok) throw new Error(result?.error || "Couldn't read settings.");
    settings = result.settings;
    granted = result.grantedWebsites;
    missing = result.missingWebsites;
    tabUrl = tabs[0]?.url || "";
    render();
    $("popup-enabled").disabled = false;
  }
  $("popup-enabled").addEventListener("change", async () => {
    if (updating) return;
    updating = true;
    $("popup-enabled").disabled = true;
    try {
      await chrome.storage.sync.set({ enabled: $("popup-enabled").checked });
      const result = await chrome.runtime.sendMessage({ type: "AW_RECONCILE" });
      if (!result?.ok) throw new Error(result?.error || "Couldn't apply this change.");
      await load();
    } catch (error) {
      notice(error.message);
      $("popup-enabled").disabled = false;
    } finally { updating = false; }
  });
  $("open-settings").addEventListener("click", () => {
    chrome.runtime.openOptionsPage().then(() => window.close()).catch(error => notice(error.message));
  });
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "sync" && !updating) load().catch(error => notice(error.message));
  });
  load().catch(error => notice(`Couldn't load settings. ${error.message}`));
})();
