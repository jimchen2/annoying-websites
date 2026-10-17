# Annoying Websites

A small Chrome extension that blocks the sites that pull you in. There is one
list, one rule per site, and every rule is a plain prefix.

## The rules

Type a prefix, and everything that starts with it is blocked.

| You type | What is blocked |
| --- | --- |
| `example.com/1` | `https://example.com/1`, `https://example.com/12`, `https://example.com/1/news`, `http://example.com/1`, and the same paths on `blog.example.com` |
| `example.com` | the whole domain and its subdomains, on http and https |
| `https://example.com` | only the https version of the domain |

The scheme is optional. Rules are kept in the `*://example.com/1` form, where
`*` means "http and https". A trailing `*` is the same as a prefix, so
`example.com/*` and `example.com` mean the same thing.

## Using it

- Click the extension icon to see the list, add a prefix, or switch blocking
  off. Changes save as you make them.
- The full list lives on the options page, which you can open from the popup
  or from `chrome://extensions`.
- A blocked page shows up instead of the site, with a button to go back and
  one to drop the rule that got in the way.
- The list syncs with Chrome, so it follows you to your other computer. Site
  access is per computer: Chrome asks for it the first time you add a site,
  because an extension is only allowed to touch a site you have given it
  access to.

## Installing it

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and pick this folder.
3. Click the extension icon and add the sites you want to block.

## Working on it

```
node test/rules.test.js     # tests for the rule helpers
node dev/preview-server.js  # preview the pages at http://localhost:8123
```

The preview server is a development helper only. It serves the pages with a
stand-in for the `chrome.*` APIs so the look of the pages can be checked in a
normal browser.

## How it blocks

The service worker keeps a `declarativeNetRequest` rule for every entry in the
list. Chrome stops those addresses before the page loads and shows
`blocked.html` instead. If an address ever slips through, the service worker
sends the tab to the blocked page by hand.
