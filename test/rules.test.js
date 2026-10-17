/* Tests for the rule helpers in shared.js. Run with: node test/rules.test.js */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "shared.js"), "utf8");

function fakeChrome() {
  const store = {};
  return {
    store,
    storage: {
      sync: {
        async get(keys) {
          const out = {};
          for (const key of keys) if (store[key] !== undefined) out[key] = store[key];
          return out;
        },
        async set(values) { Object.assign(store, values); }
      }
    },
    permissions: {
      async contains() { return true; },
      async request() { return true; }
    },
    runtime: { getURL: file => `chrome-extension://fake/${file}` }
  };
}

const chrome = fakeChrome();
const sandbox = { chrome, console, TextEncoder, URL };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const Rules = sandbox.BlockRules;

let passed = 0;
const failures = [];
const pending = [];

// Values that come out of the sandbox have a different Array prototype, so
// copy them into this realm before comparing.
function list(value) { return Array.from(value, item => String(item)); }

function test(name, fn) {
  pending.push([name, fn]);
}

async function run() {
  for (const [name, fn] of pending) {
    try { await fn(); passed += 1; }
    catch (error) { failures.push(`${name}\n    ${error.message.split("\n").join("\n    ")}`); }
  }
  if (failures.length) {
    console.error(`\n${failures.length} failing:\n`);
    for (const failure of failures) console.error(`  ✗ ${failure}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n${passed} tests passed.`);
}

function rule(input) { return Rules.normalizeRule(input); }

/* --- normalizeRule ------------------------------------------------------ */

test("a bare domain becomes a prefix rule", () => {
  assert.deepEqual(list(Object.values({ ...rule("example.com") })), list(["*", "example.com", "", "*://example.com"]));
});

test("a domain with a path keeps the path", () => {
  assert.deepEqual(list(Object.values({ ...rule("example.com/1") })), list(["*", "example.com", "/1", "*://example.com/1"]));
});

test("the scheme is optional and defaults to both", () => {
  assert.equal(rule("https://example.com").scheme, "https");
  assert.equal(rule("http://example.com").scheme, "http");
  assert.equal(rule("*://example.com").scheme, "*");
  assert.equal(rule("example.com").scheme, "*");
});

test("input is trimmed and the host is lowercased", () => {
  assert.equal(rule("  Example.COM/News  ").text, "*://example.com/News");
});

test("a trailing slash or star means the whole domain", () => {
  assert.equal(rule("example.com/").text, "*://example.com");
  assert.equal(rule("example.com/*").text, "*://example.com");
  assert.equal(rule("example.com*").text, "*://example.com");
});

test("a trailing star on a path is the same as a prefix", () => {
  assert.equal(rule("example.com/1*").text, "*://example.com/1");
});

test("a leading star on the domain is dropped", () => {
  assert.equal(rule("*.example.com").text, "*://example.com");
});

test("localhost and plain hosts are allowed", () => {
  assert.equal(rule("localhost").text, "*://localhost");
  assert.equal(rule("127.0.0.1").text, "*://127.0.0.1");
});

test("nonsense is rejected", () => {
  for (const bad of ["", "   ", "exa mple.com", "example .com", "http://", "example.com#top", "a.*.com", "http://example.com:8080"]) {
    assert.throws(() => Rules.normalizeRule(bad), undefined, `expected "${bad}" to be rejected`);
  }
});

/* --- matchesRule -------------------------------------------------------- */

const prefix = rule("example.com/1");
const domain = rule("example.com");
const httpsOnly = rule("https://example.com");

test("a path prefix matches everything that starts with it", () => {
  assert.equal(Rules.matchesRule(prefix, "https://example.com/1"), true);
  assert.equal(Rules.matchesRule(prefix, "https://example.com/12"), true);
  assert.equal(Rules.matchesRule(prefix, "https://example.com/1/deeper"), true);
  assert.equal(Rules.matchesRule(prefix, "https://example.com/1?page=2"), true);
  assert.equal(Rules.matchesRule(prefix, "https://example.com/2"), false);
  assert.equal(Rules.matchesRule(prefix, "https://example.com/"), false);
});

test("a domain rule matches the domain and its subdomains", () => {
  assert.equal(Rules.matchesRule(domain, "https://example.com/"), true);
  assert.equal(Rules.matchesRule(domain, "https://example.com/news"), true);
  assert.equal(Rules.matchesRule(domain, "https://blog.example.com/"), true);
  assert.equal(Rules.matchesRule(domain, "https://notexample.com/"), false);
  assert.equal(Rules.matchesRule(domain, "https://example.com.evil.net/"), false);
});

test("a scheme rule only matches that scheme", () => {
  assert.equal(Rules.matchesRule(httpsOnly, "https://example.com/"), true);
  assert.equal(Rules.matchesRule(httpsOnly, "http://example.com/"), false);
  assert.equal(Rules.matchesRule(domain, "http://example.com/"), true);
});

test("other schemes and junk never match", () => {
  assert.equal(Rules.matchesRule(domain, "chrome-extension://abc/blocked.html"), false);
  assert.equal(Rules.matchesRule(domain, "ftp://example.com/"), false);
  assert.equal(Rules.matchesRule(domain, "not a url"), false);
});

test("a port does not change the match", () => {
  assert.equal(Rules.matchesRule(prefix, "https://example.com:8443/1"), true);
});

/* --- the Chrome filter agrees with the matcher -------------------------- */

const filterCases = [
  ["example.com", "https://example.com/", true],
  ["example.com", "https://example.com", true],
  ["example.com", "https://example.com/news", true],
  ["example.com", "https://blog.example.com/news", true],
  ["example.com", "https://example.com.evil.net/", false],
  ["example.com", "https://notexample.com/", false],
  ["example.com", "http://example.com/", true],
  ["example.com/1", "https://example.com/1", true],
  ["example.com/1", "https://example.com/12", true],
  ["example.com/1", "https://example.com/2", false],
  ["example.com/1", "https://www.example.com/1", true],
  ["example.com/1", "https://example.com:8443/1", true],
  ["https://example.com", "https://example.com/", true],
  ["https://example.com", "http://example.com/", false]
];

test("the Chrome filter matches exactly the same addresses", () => {
  for (const [input, url, expected] of filterCases) {
    const current = rule(input);
    const regex = new RegExp(Rules.regexForRule(current));
    assert.equal(Rules.matchesRule(current, url), expected, `matcher: ${input} vs ${url}`);
    assert.equal(regex.test(url), expected, `filter: ${input} vs ${url}`);
  }
});

test("the Chrome filter is a valid rule for Chrome", () => {
  const built = Rules.dnrRuleForRule(prefix, 1);
  assert.equal(built.id, 1);
  assert.equal(built.action.type, "redirect");
  assert.equal(built.action.redirect.extensionPath, "blocked.html");
  assert.deepEqual(list(built.condition.resourceTypes), list(["main_frame"]));
  assert.equal(new RegExp(built.condition.regexFilter).test("https://example.com/1"), true);
});

/* --- host permissions --------------------------------------------------- */

test("access is asked for on the domain and its subdomains", () => {
  const origins = Rules.originsForRule(rule("example.com/1"));
  assert.ok(origins.includes("https://example.com/*"));
  assert.ok(origins.includes("https://*.example.com/*"));
  assert.ok(origins.includes("http://example.com/*"));
  const httpsOrigins = Rules.originsForRule(rule("https://example.com"));
  assert.ok(httpsOrigins.every(origin => origin.startsWith("https://")));
  assert.equal(httpsOrigins.length, 2);
});

/* --- storage ------------------------------------------------------------ */

test("rules are stored, read back and cleaned up", async () => {
  await Rules.saveRules(["example.com/1", "news.site.com"]);
  const state = await Rules.readState();
  assert.deepEqual(list(state.rules.map(item => item.text)), list(["*://example.com/1", "*://news.site.com"]));
  assert.equal(state.enabled, true);

  await Rules.saveRules(["example.com/1", "example.com/1"]);
  assert.deepEqual(list((await Rules.readState()).rules.map(item => item.text)), list(["*://example.com/1"]));

  await Rules.saveEnabled(false);
  assert.equal((await Rules.readState()).enabled, false);
});

test("a broken stored rule is dropped instead of blocking something odd", () => {
  const rules = Rules.parseRules(["example.com/1", "not a rule", "https://a.com/x"]);
  assert.deepEqual(list(rules.map(item => item.text)), list(["*://example.com/1", "https://a.com/x"]));
});

test("saving an invalid rule fails loudly", async () => {
  await assert.rejects(() => Rules.saveRules(["example.com/1", "not a rule"]));
});

run();
