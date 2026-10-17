"use strict";
(() => {
  const Config = globalThis.AnnoyConfig;
  const $ = id => document.getElementById(id);
  const form = $("settings-form");
  let baseline = "";
  let saving = false;
  let loaded = false;
  let externalChange = false;

  function formValues() {
    return {
      enabled: $("enabled").checked,
      intervalMinutes: $("interval-minutes").value,
      waitSeconds: $("wait-seconds").value,
      showTimerInConsole: $("console-timer").checked,
      websitesText: $("websites").value
    };
  }

  function fingerprint() { return JSON.stringify(formValues()); }
  function isDirty() { return loaded && fingerprint() !== baseline; }
  function status(message, type = "") {
    $("save-status").textContent = message;
    $("save-status").className = `status-text ${type}`;
  }
  function countWebsites() {
    let count = $("websites").value.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith("#")).length;
    try { count = Config.parseWebsites($("websites").value).length; } catch { /* Validation happens on save. */ }
    $("site-count").textContent = `${count} pattern${count === 1 ? "" : "s"}`;
  }
  function render(settings) {
    $("enabled").checked = settings.enabled;
    $("interval-minutes").value = settings.intervalMinutes;
    $("wait-seconds").value = settings.waitSeconds;
    $("console-timer").checked = settings.showTimerInConsole;
    $("websites").value = settings.websites.join("\n");
    countWebsites();
  }
  function showPermissions(missing) {
    const note = $("permission-note");
    note.replaceChildren();
    note.hidden = !missing?.length;
    if (!missing?.length) return;
    const text = document.createElement("p");
    text.textContent = `${missing.length} website pattern${missing.length === 1 ? " needs" : "s need"} permission on this computer. Click “Save settings” to grant access. Until then, reminders won't run on those sites.`;
    const list = document.createElement("div");
    list.className = "permission-list";
    list.textContent = missing.join("\n");
    note.append(text, list);
  }
  function setBusy(busy) {
    saving = busy;
    $("settings-fields").disabled = busy;
    $("save-button").disabled = busy;
    $("restore-defaults").disabled = busy;
    $("save-button").textContent = busy ? "Saving…" : "Save settings ↗";
  }
  async function load() {
    const response = await chrome.runtime.sendMessage({ type: "AW_STATUS" });
    if (!response?.ok) throw new Error(response?.error || "Couldn't read settings.");
    render(response.settings);
    baseline = fingerprint();
    loaded = true;
    externalChange = false;
    showPermissions(response.missingWebsites);
    $("settings-fields").disabled = false;
    $("save-button").disabled = false;
    $("restore-defaults").disabled = false;
    status("Saved in Chrome Sync", "success");
  }

  form.addEventListener("input", () => {
    if (!loaded || saving) return;
    countWebsites();
    status(externalChange ? "Settings changed elsewhere. Saving will replace them with this form." : isDirty() ? "Unsaved changes" : "Saved in Chrome Sync", isDirty() ? "" : "success");
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!loaded || saving) return;
    let settings;
    try { settings = Config.validateForm(formValues()); }
    catch (error) {
      status(error.message, "error");
      return;
    }
    const origins = [...new Set(settings.websites.map(Config.originForPattern))];
    // Request directly in the submit gesture, before any asynchronous work.
    // Site access is device-local; only the settings themselves sync.
    let permissionRequest;
    try {
      permissionRequest = origins.length ? chrome.permissions.request({ origins }) : Promise.resolve(true);
    } catch (error) {
      status(error.message, "error");
      return;
    }
    setBusy(true);
    let stored = false;
    try {
      const granted = await permissionRequest;
      await chrome.storage.sync.set(settings);
      stored = true;
      render(settings);
      baseline = fingerprint();
      externalChange = false;
      const result = await chrome.runtime.sendMessage({ type: "AW_RECONCILE" });
      if (!result?.ok) throw new Error(result?.error || "Couldn't apply settings to tabs.");
      showPermissions(result.missingWebsites);
      status(!granted || result.missingWebsites.length
        ? "Saved. Some websites still need access on this computer."
        : "Saved and applied to open tabs.", !granted || result.missingWebsites.length ? "" : "success");
    } catch (error) {
      status(`${stored ? "Settings saved, but couldn't apply them. Reload this page or the matching tabs. " : "Not saved. "}${error.message}`, "error");
    } finally { setBusy(false); }
  });

  $("restore-defaults").addEventListener("click", () => {
    render(Config.DEFAULTS);
    status("Defaults restored in the form. Click Save settings to apply.");
  });

  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area !== "sync" || !loaded || saving) return;
    if (isDirty()) {
      externalChange = true;
      status("Settings changed elsewhere. Saving will replace them with this form.");
    } else {
      load().catch(error => status(error.message, "error"));
    }
  });
  const refreshPermissions = () => {
    chrome.runtime.sendMessage({ type: "AW_STATUS" }).then(result => {
      if (result?.ok) showPermissions(result.missingWebsites);
    }).catch(() => {});
  };
  chrome.permissions.onAdded.addListener(refreshPermissions);
  chrome.permissions.onRemoved.addListener(refreshPermissions);

  window.addEventListener("beforeunload", event => {
    if (!isDirty() || saving) return;
    event.preventDefault();
    event.returnValue = "";
  });
  load().catch(error => status(`Couldn't load settings. ${error.message} Reload this page to try again.`, "error"));
})();
