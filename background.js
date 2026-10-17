/* Manifest V3 service worker. Keeps Chrome's blocking rules in sync with the
   list the user typed, and remembers which address a blocked tab was on. */
"use strict";
importScripts("shared.js");
const Rules = globalThis.BlockRules;

let queue = Promise.resolve();

function enqueue(task) {
  const next = queue.catch(() => {}).then(task);
  queue = next;
  return next;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/* Replaces Chrome's dynamic rules with the current list. Rule ids are simply
   the position in the list, so a changed list is always a fresh set. */
async function applyRules() {
  const state = await Rules.readState();
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map(rule => rule.id);
  const addRules = state.enabled
    ? state.rules.map((rule, index) => Rules.dnrRuleForRule(rule, index + 1))
    : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  return state;
}

/* Sends tabs that are already open on a blocked address to the blocked page.
   Chrome only hands over the address of sites the extension may access, and
   those are exactly the sites the user asked to block. */
async function blockOpenTabs() {
  const state = await Rules.readState();
  if (!state.enabled || !state.rules.length) return;
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map(async tab => {
    if (typeof tab.id !== "number" || !tab.url) return;
    const match = state.rules.find(rule => Rules.matchesRule(rule, tab.url));
    if (!match) return;
    await chrome.tabs.update(tab.id, { url: Rules.blockedPageUrl(tab.url) });
  }));
}

async function reconcile({ checkTabs = false } = {}) {
  const state = await applyRules();
  if (checkTabs) await blockOpenTabs();
  return state;
}

/* Chrome redirects a blocked address to blocked.html before it loads. The
   address is not part of that redirect, so remember it here instead. */
async function rememberBlocked(tabId, url, match) {
  try {
    await chrome.storage.session.set({ [Rules.blockedInfoKey(tabId)]: { url, rule: match.text } });
  } catch { /* Session storage is best effort. */ }
}

async function forgetBlocked(tabId) {
  try { await chrome.storage.session.remove(Rules.blockedInfoKey(tabId)); }
  catch { /* Session storage is best effort. */ }
}

/* Safety net. Chrome's own rule should stop the page before it loads, but if
   the address slipped through, send the tab to the blocked page by hand. */
async function catchSlippedThrough(tabId, url) {
  await sleep(300);
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return; }
  if (!tab || tab.url !== url) return; // Chrome already redirected the tab.
  try { await chrome.tabs.update(tabId, { url: Rules.blockedPageUrl(url) }); }
  catch { /* The tab may be gone. */ }
}

async function handleNavigation(tabId, url) {
  const state = await Rules.readState();
  if (!state.enabled || !state.rules.length) {
    await forgetBlocked(tabId);
    return;
  }
  const match = state.rules.find(rule => Rules.matchesRule(rule, url));
  if (!match) {
    await forgetBlocked(tabId);
    return;
  }
  await rememberBlocked(tabId, url, match);
  await catchSlippedThrough(tabId, url);
}

chrome.runtime.onInstalled.addListener(() => { enqueue(reconcile).catch(console.error); });
chrome.runtime.onStartup.addListener(() => { enqueue(reconcile).catch(console.error); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (!Rules.STORAGE_KEYS.some(key => key in changes)) return;
  enqueue(() => reconcile({ checkTabs: true })).catch(console.error);
});
chrome.permissions.onAdded.addListener(() => { enqueue(reconcile).catch(console.error); });
chrome.permissions.onRemoved.addListener(() => { enqueue(reconcile).catch(console.error); });

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const url = changeInfo.url;
  if (!url || !/^https?:/i.test(url)) return;
  handleNavigation(tabId, url).catch(console.error);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handle = async () => {
    switch (message?.type) {
      case "AW_STATE": {
        const state = await Rules.readState();
        return { ok: true, enabled: state.enabled, rules: state.rules.map(rule => rule.text) };
      }
      case "AW_RECONCILE": {
        const state = await enqueue(() => reconcile({ checkTabs: true }));
        return { ok: true, enabled: state.enabled, rules: state.rules.map(rule => rule.text) };
      }
      default:
        return null;
    }
  };
  if (!["AW_STATE", "AW_RECONCILE"].includes(message?.type)) return false;
  handle().then(sendResponse, error => sendResponse({ ok: false, error: error.message || String(error) }));
  return true; // Keep the response channel open across asynchronous API calls.
});

// Also apply the list after a worker wake, so a restarted browser keeps blocking.
enqueue(reconcile).catch(error => console.error("[Annoy] Could not apply the block list:", error));
