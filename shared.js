/* Shared rule helpers: turn what the user types into a rule, match URLs
   against rules, and describe the same rules to Chrome.

   Loaded by the service worker (importScripts) and by the extension pages.
   No DOM here, and chrome.* is only touched inside functions. */
(() => {
  "use strict";

  const STORAGE_KEYS = ["rules", "enabled"];
  const MAX_RULES = 100;
  const MAX_RULE_BYTES = 4000; // Chrome Sync allows 8 KiB per item.
  const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function isValidHost(host) {
    if (!host || host.length > 253) return false;
    return host.split(".").every(label => label.length <= 63 && HOST_LABEL.test(label));
  }

  // Rules are always shown as *://example.com/1 (or https://… for one scheme).
  function formatRule(rule) {
    return `${rule.scheme}://${rule.host}${rule.path}`;
  }

  /* Turns user input into a rule.
     "example.com/1"  -> { scheme: "*", host: "example.com", path: "/1" }
     "https://a.com"  -> { scheme: "https", host: "a.com", path: "" }
     Rules match a domain, its subdomains, and a path prefix. */
  function normalizeRule(input) {
    let value = String(input ?? "").trim();
    if (!value) throw new Error("Enter a prefix, for example example.com/1.");
    if (/\s/.test(value)) throw new Error("Spaces are not allowed in a prefix.");

    let scheme = "*";
    const schemeMatch = /^(\*|https?):\/\//i.exec(value);
    if (schemeMatch) {
      scheme = schemeMatch[1].toLowerCase();
      value = value.slice(schemeMatch[0].length);
    }

    // A trailing * means the same thing as a prefix, so drop it.
    value = value.replace(/\*+$/, "");
    if (!value) throw new Error("Enter a prefix, for example example.com/1.");

    const slash = value.indexOf("/");
    let host = (slash === -1 ? value : value.slice(0, slash)).toLowerCase();
    let path = slash === -1 ? "" : value.slice(slash);

    if (host.startsWith("*.")) host = host.slice(2);
    if (host.includes("*")) throw new Error("A * is only allowed at the start of the domain.");
    if (!isValidHost(host)) throw new Error(`"${host}" is not a valid domain name.`);
    if (path.includes("#")) throw new Error("A # fragment is not part of a page address.");
    path = path.replace(/\*+$/, "");
    if (path === "/") path = "";
    if (path && !path.startsWith("/")) throw new Error("A path has to start with /.");

    return { scheme, host, path, text: formatRule({ scheme, host, path }) };
  }

  // Reads stored rules and quietly drops anything that is no longer valid.
  function parseRules(list) {
    const rules = [];
    for (const value of Array.isArray(list) ? list : []) {
      try {
        const rule = normalizeRule(value);
        if (!rules.some(item => item.text === rule.text)) rules.push(rule);
      } catch { /* Ignore invalid entries rather than blocking an unintended site. */ }
    }
    return rules.slice(0, MAX_RULES);
  }

  /* Does a URL match a rule? The domain must be the rule's domain or one of
     its subdomains, and the path has to start with the rule's path. */
  function matchesRule(rule, url) {
    let target;
    try { target = new URL(url); } catch { return false; }
    if (target.protocol !== "http:" && target.protocol !== "https:") return false;
    if (rule.scheme === "http" && target.protocol !== "http:") return false;
    if (rule.scheme === "https" && target.protocol !== "https:") return false;
    const host = target.hostname.toLowerCase();
    if (host !== rule.host && !host.endsWith(`.${rule.host}`)) return false;
    if (rule.path && !`${target.pathname}${target.search}`.startsWith(rule.path)) return false;
    return true;
  }

  function matchesAny(rules, url) {
    return rules.some(rule => matchesRule(rule, url));
  }

  /* The same rule as a Chrome filter: the scheme, the domain with optional
     subdomains, an optional port, and the path prefix. */
  function regexForRule(rule) {
    const scheme = rule.scheme === "*" ? "https?" : rule.scheme;
    const host = `(?:[^/?#]+\\.)?${escapeRegExp(rule.host)}`;
    const port = "(?::\\d+)?";
    const path = rule.path ? escapeRegExp(rule.path) : "(?:/|$)";
    return `^${scheme}://${host}${port}${path}`;
  }

  function dnrRuleForRule(rule, id) {
    return {
      id,
      priority: 1,
      action: { type: "redirect", redirect: { extensionPath: "blocked.html" } },
      condition: {
        regexFilter: regexForRule(rule),
        resourceTypes: ["main_frame"]
      }
    };
  }

  // Host permissions Chrome needs before it can block a rule.
  function originsForRule(rule) {
    const schemes = rule.scheme === "*" ? ["http", "https"] : [rule.scheme];
    const origins = [];
    for (const scheme of schemes) {
      origins.push(`${scheme}://${rule.host}/*`);
      origins.push(`${scheme}://*.${rule.host}/*`);
    }
    return origins;
  }

  async function hasAccess(rule) {
    return chrome.permissions.contains({ origins: originsForRule(rule) });
  }

  async function readState() {
    const stored = await chrome.storage.sync.get(STORAGE_KEYS);
    return {
      enabled: stored.enabled !== false,
      rules: parseRules(stored.rules)
    };
  }

  async function saveRules(texts) {
    const rules = [];
    for (const text of texts) {
      let rule;
      try { rule = normalizeRule(text); } catch { throw new Error(`"${text}" is not a valid rule.`); }
      if (!rules.some(item => item.text === rule.text)) rules.push(rule);
    }
    if (rules.length > MAX_RULES) throw new Error(`Keep the list to ${MAX_RULES} rules.`);
    const bytes = new TextEncoder().encode(JSON.stringify(rules.map(rule => rule.text))).length;
    if (bytes > MAX_RULE_BYTES) throw new Error("The list is too long for Chrome Sync. Remove a rule or two.");
    await chrome.storage.sync.set({ rules: rules.map(rule => rule.text) });
    return rules;
  }

  async function saveEnabled(enabled) {
    await chrome.storage.sync.set({ enabled: Boolean(enabled) });
  }

  function blockedPageUrl(url) {
    const base = chrome.runtime.getURL("blocked.html");
    return url ? `${base}?u=${encodeURIComponent(url)}` : base;
  }

  function blockedInfoKey(tabId) {
    return `blocked:${tabId}`;
  }

  globalThis.BlockRules = Object.freeze({
    STORAGE_KEYS, MAX_RULES, MAX_RULE_BYTES,
    escapeRegExp, isValidHost, formatRule, normalizeRule, parseRules,
    matchesRule, matchesAny, regexForRule, dnrRuleForRule, originsForRule, hasAccess,
    readState, saveRules, saveEnabled, blockedPageUrl, blockedInfoKey
  });
})();
