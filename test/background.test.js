/* Tests for the service worker in background.js, run against a stand-in for
   the chrome.* APIs. Run with: node test/background.test.js */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const sharedSource = fs.readFileSync(path.join(root, "shared.js"), "utf8");
const backgroundSource = fs.readFileSync(path.join(root, "background.js"), "utf8");

function fakeChrome() {
  const store = { rules: [], enabled: true };
  const session = {};
  const listeners = { installed: [], startup: [], storage: [], permissions: [], tabs: [], message: [] };
  const dnr = { rules: [] };
  const tabs = [{ id: 7, url: "https://example.com/1", updates: [] }];

  const chrome = {
    store, session, listeners, dnr, openTabs: tabs,
    storage: {
      sync: {
        async get(keys) {
          const out = {};
          for (const key of keys) if (store[key] !== undefined) out[key] = store[key];
          return out;
        },
        async set(values) {
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: store[key], newValue: value };
            store[key] = value;
          }
          for (const listener of listeners.storage) listener(changes, "sync");
        }
      },
      session: {
        async get(key) { return { [key]: session[key] }; },
        async set(values) { Object.assign(session, values); },
        async remove(key) { delete session[key]; }
      },
      onChanged: { addListener: listener => listeners.storage.push(listener) }
    },
    declarativeNetRequest: {
      async getDynamicRules() { return dnr.rules; },
      async updateDynamicRules({ removeRuleIds, addRules }) {
        dnr.rules = dnr.rules.filter(rule => !removeRuleIds.includes(rule.id)).concat(addRules);
      }
    },
    tabs: {
      onUpdated: { addListener: listener => listeners.tabs.push(listener) },
      async query() { return tabs; },
      async get(id) { return tabs.find(tab => tab.id === id); },
      async update(id, { url }) {
        const tab = tabs.find(tab => tab.id === id);
        if (!tab) throw new Error("no such tab");
        tab.updates.push(url);
        tab.url = url;
      }
    },
    permissions: {
      onAdded: { addListener: listener => listeners.permissions.push(listener) },
      onRemoved: { addListener: listener => listeners.permissions.push(listener) },
      async contains() { return true; },
      async request() { return true; },
      async remove() { return true; }
    },
    runtime: {
      onInstalled: { addListener: listener => listeners.installed.push(listener) },
      onStartup: { addListener: listener => listeners.startup.push(listener) },
      onMessage: { addListener: listener => listeners.message.push(listener) },
      getURL: file => `chrome-extension://fake/${file}`
    }
  };
  return chrome;
}

const chrome = fakeChrome();
const sandbox = {
  chrome, console, setTimeout, clearTimeout, TextEncoder, URL,
  importScripts: (...files) => {
    for (const file of files) {
      vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox, { filename: file });
    }
  }
};
vm.createContext(sandbox);
vm.runInContext(backgroundSource, sandbox, { filename: "background.js" });

let passed = 0;
const failures = [];

async function test(name, fn) {
  try { await fn(); passed += 1; }
  catch (error) { failures.push(`${name}\n    ${error.message}`); }
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function main() {
  /* --- the list becomes Chrome rules -------------------------------------- */

  await test("an empty list leaves no rules behind", async () => {
    await wait(50);
    assert.equal(chrome.dnr.rules.length, 0);
  });

  await test("a saved list becomes one Chrome rule per entry", async () => {
    await chrome.storage.sync.set({ rules: ["example.com/1", "https://twitter.com"] });
    await wait(100);
    assert.equal(chrome.dnr.rules.length, 2);
    const first = chrome.dnr.rules.find(rule => rule.id === 1);
    assert.equal(first.action.type, "redirect");
    assert.equal(first.action.redirect.extensionPath, "blocked.html");
    assert.deepEqual(Array.from(first.condition.resourceTypes), ["main_frame"]);
    assert.equal(new RegExp(first.condition.regexFilter).test("https://example.com/1"), true);
    assert.equal(new RegExp(first.condition.regexFilter).test("https://example.com/2"), false);
    const second = chrome.dnr.rules.find(rule => rule.id === 2);
    assert.equal(new RegExp(second.condition.regexFilter).test("http://twitter.com/"), false);
    assert.equal(new RegExp(second.condition.regexFilter).test("https://twitter.com/"), true);
  });

  await test("turning blocking off removes the rules", async () => {
    await chrome.storage.sync.set({ enabled: false });
    await wait(100);
    assert.equal(chrome.dnr.rules.length, 0);
    await chrome.storage.sync.set({ enabled: true });
    await wait(100);
    assert.equal(chrome.dnr.rules.length, 2);
  });

  await test("an old rule set is replaced, not added to", async () => {
    await chrome.storage.sync.set({ rules: ["example.com"] });
    await wait(100);
    assert.equal(chrome.dnr.rules.length, 1);
    assert.equal(chrome.dnr.rules[0].id, 1);
  });

  /* --- a navigation that matches ------------------------------------------ */

  await test("a blocked address is sent to the blocked page", async () => {
    await chrome.storage.sync.set({ rules: ["*://example.com/1"] });
    await wait(100);
    chrome.openTabs[0].url = "https://example.com/1";
    chrome.openTabs[0].updates.length = 0;
    chrome.listeners.tabs.forEach(listener => listener(7, { url: "https://example.com/1" }));
    await wait(500);
    assert.equal(chrome.openTabs[0].updates.length, 1, "the tab should be moved to the blocked page");
    assert.match(chrome.openTabs[0].updates[0], /^chrome-extension:\/\/fake\/blocked\.html\?u=/);
    const record = chrome.session["blocked:7"];
    assert.equal(record.url, "https://example.com/1");
    assert.equal(record.rule, "*://example.com/1");
  });

  await test("an address that does not match is left alone", async () => {
    chrome.openTabs[0].url = "https://example.com/2";
    chrome.openTabs[0].updates.length = 0;
    chrome.listeners.tabs.forEach(listener => listener(7, { url: "https://example.com/2" }));
    await wait(500);
    assert.equal(chrome.openTabs[0].updates.length, 0);
    assert.equal(chrome.session["blocked:7"], undefined);
  });

  /* --- the open tabs check ------------------------------------------------ */

  await test("a tab that is already open on a blocked site gets blocked", async () => {
    chrome.openTabs[0].url = "https://example.com/1";
    chrome.openTabs[0].updates.length = 0;
    await chrome.storage.sync.set({ rules: ["*://example.com"] });
    await wait(300);
    assert.equal(chrome.openTabs[0].updates.length, 1);
    assert.match(chrome.openTabs[0].updates[0], /blocked\.html\?u=/);
  });

  /* --- report ------------------------------------------------------------- */

  if (failures.length) {
    console.error(`\n${failures.length} failing:\n`);
    for (const failure of failures) console.error(`  ✗ ${failure}\n`);
    process.exitCode = 1;
  } else {
    console.log(`\n${passed} tests passed.`);
  }

}

main().catch(error => { console.error(error); process.exitCode = 1; });
