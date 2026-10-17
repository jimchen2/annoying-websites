/* Stand-in for the chrome.* APIs, used only by the preview server in
   dev/preview-server.js. It keeps the list in memory so the pages can be
   clicked through in a normal browser. Not part of the extension. */
(() => {
  "use strict";
  // blocked.html?noaddress=1 pretends the address could not be worked out.
  globalThis.__mockNoAddress = location.search.includes("noaddress");
  const store = {
    rules: ["*://example.com/1", "*://news.ycombinator.com", "https://twitter.com"],
    enabled: true
  };
  const listeners = [];

  function notify(changes) {
    for (const listener of listeners) listener(changes, "sync");
  }

  globalThis.chrome = {
    runtime: {
      getURL: file => `/${file}`,
      openOptionsPage: () => { window.location.href = "/options.html"; },
      sendMessage: async message => (message?.type === "AW_RECONCILE" ? { ok: true } : { ok: true })
    },
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
          notify(changes);
        }
      },
      session: {
        async get(key) {
          return globalThis.__mockNoAddress ? {} : { [key]: { url: "https://example.com/1", rule: "*://example.com/1" } };
        },
        async set() {},
        async remove() {}
      },
      onChanged: { addListener: listener => listeners.push(listener) }
    },
    permissions: {
      async contains() { return true; },
      async request() { return true; },
      onAdded: { addListener: () => {} },
      onRemoved: { addListener: () => {} }
    },
    tabs: {
      async getCurrent() { return { id: 1 }; },
      async get() { return { id: 1, url: "https://example.com/1" }; },
      async query() { return [{ id: 1, url: "https://example.com/1" }]; },
      async update() {}
    },
    declarativeNetRequest: {
      async getDynamicRules() { return []; },
      async updateDynamicRules() {}
    }
  };
})();
