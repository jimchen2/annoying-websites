/* Manifest V3 service worker. Timers live in the page, not in this worker. */
"use strict";
importScripts("shared.js");
const Config = globalThis.AnnoyConfig;
const SCRIPT_ID = "annoying-websites-content-v2";
const MIGRATION_KEY = "migration_removed_llm_random";
let workQueue = Promise.resolve();

// One-time cleanup: llm.jimchen.me/random is no longer a default website. Strip
// it from synced settings so the removal applies to existing installs too.
// Guarded by a flag so the user can re-add it later on purpose.
async function migrateSettings() {
  const { [MIGRATION_KEY]: done } = await chrome.storage.local.get(MIGRATION_KEY);
  if (done) return;
  const stored = await chrome.storage.sync.get(Config.KEYS);
  if (Array.isArray(stored.websites)) {
    const filtered = stored.websites.filter(pattern => !/^\*:\/\/llm\.jimchen\.me\/random/.test(String(pattern)));
    if (filtered.length !== stored.websites.length) {
      await chrome.storage.sync.set({ websites: filtered });
    }
  }
  await chrome.storage.local.set({ [MIGRATION_KEY]: true });
}

async function ensureDefaults() {
  const stored = await chrome.storage.sync.get(Config.KEYS);
  if (!Array.isArray(stored.websites)) {
    await chrome.storage.sync.set({ websites: Config.DEFAULTS.websites });
    return;
  }
  const normalized = Config.normalizeSettings(stored).websites;
  if (JSON.stringify(normalized) !== JSON.stringify(stored.websites)) {
    await chrome.storage.sync.set({ websites: normalized });
  }
}

async function websiteAccess(settings) {
  const result = await Promise.all(settings.websites.map(async pattern => ({
    pattern,
    granted: await chrome.permissions.contains({ origins: Config.permissionOriginsForPattern(pattern) })
  })));
  return {
    grantedWebsites: result.filter(item => item.granted).map(item => item.pattern),
    missingWebsites: result.filter(item => !item.granted).map(item => item.pattern)
  };
}

async function getStatus() {
  const settings = await Config.readSettings();
  return { settings, ...await websiteAccess(settings) };
}

async function reconcile() {
  const status = await getStatus();
  const matches = [...new Set(status.grantedWebsites.flatMap(Config.permissionOriginsForPattern))];
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });

  if (!matches.length) {
    if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } else {
    const script = {
      id: SCRIPT_ID,
      matches,
      js: ["shared.js", "content.js"],
      allFrames: false,
      runAt: "document_end",
      persistAcrossSessions: true,
      world: "ISOLATED"
    };
    if (!registered.length) {
      await chrome.scripting.registerContentScripts([script]);
    } else {
      const current = registered[0];
      const changed = JSON.stringify([...current.matches].sort()) !== JSON.stringify([...matches].sort()) ||
        JSON.stringify(current.js) !== JSON.stringify(script.js) ||
        ["allFrames", "runAt", "persistAcrossSessions", "world"].some(key => current[key] !== script[key]);
      if (changed) await chrome.scripting.updateContentScripts([script]);
    }
  }

  // Apply changes to already-open tabs as well.
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map(async tab => {
    if (typeof tab.id !== "number") return;
    const eligible = tab.url && Config.matchesAny(status.grantedWebsites, tab.url);
    let notified = false;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "AW_REFRESH" }, { frameId: 0 });
      notified = true;
    } catch { /* No content script in this tab yet. */ }
    if (eligible && !notified) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: false },
          files: ["shared.js", "content.js"],
          world: "ISOLATED"
        });
      } catch {
        // Restricted pages, navigations, discarded tabs, and closing tabs.
      }
    }
  }));
  return status;
}

function scheduleReconcile() {
  const next = workQueue.catch(() => {}).then(reconcile);
  workQueue = next;
  next.catch(error => console.error("[Annoy] Could not apply settings:", error));
  return next;
}

async function initialize() {
  await migrateSettings().catch(error => console.error("[Annoy] Migration failed:", error));
  await ensureDefaults();
  await scheduleReconcile();
}

chrome.runtime.onInstalled.addListener(() => { initialize().catch(console.error); });
chrome.runtime.onStartup.addListener(() => { initialize().catch(console.error); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && Config.KEYS.some(key => key in changes)) scheduleReconcile();
});
chrome.permissions.onAdded.addListener(() => { scheduleReconcile(); });
chrome.permissions.onRemoved.addListener(() => { scheduleReconcile(); });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handle = async () => {
    switch (message?.type) {
      case "AW_GET_CONTEXT": {
        if (typeof sender.tab?.id !== "number" || sender.frameId !== 0) throw new Error("Not a top-level website tab.");
        const status = await getStatus();
        const url = sender.url || "";
        return {
          ok: true,
          settings: status.settings,
          allowed: Config.matchesAny(status.grantedWebsites, url)
        };
      }
      case "AW_CLOSE_TAB": {
        if (typeof sender.tab?.id !== "number" || sender.frameId !== 0) throw new Error("Not a top-level website tab.");
        await chrome.tabs.remove(sender.tab.id);
        return { ok: true };
      }
      case "AW_STATUS":
        if (!sender.url?.startsWith(chrome.runtime.getURL(""))) throw new Error("Only the extension UI can request this action.");
        return { ok: true, ...await getStatus() };
      case "AW_RECONCILE":
        if (!sender.url?.startsWith(chrome.runtime.getURL(""))) throw new Error("Only the extension UI can request this action.");
        return { ok: true, ...await scheduleReconcile() };
      default:
        return null;
    }
  };
  if (!["AW_GET_CONTEXT", "AW_CLOSE_TAB", "AW_STATUS", "AW_RECONCILE"].includes(message?.type)) return false;
  handle().then(sendResponse, error => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

initialize().catch(error => console.error("[Annoy] Initialization failed:", error));
