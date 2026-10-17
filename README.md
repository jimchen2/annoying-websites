# Annoying Websites

A Manifest V3 Chrome extension that pauses you on the distracting sites you
choose, with a countdown timer, a *Continue Browsing* button, and a *Close Tab*
button if you meant it.

- No build step, no bundler, no dependencies. Plain files in, plain files out.
- The website list lives in `chrome.storage.sync`, so it follows you between
  your own machines and nowhere else.
- Sites you add are requested per-origin at runtime, so the extension only
  touches the sites you actually pick.

## Build a package

```bash
./scripts/package.sh                  # validate + build dist/annoying-websites-<version>.zip
./scripts/package.sh --check          # validate only
./scripts/package.sh --bump patch     # bump the version first, then build
```

Requires `zip`, `unzip` and `python3` (`sudo dnf install zip unzip` on Fedora).

## Publish it

See **[PUBLISHING.md](PUBLISHING.md)** for the full walkthrough: creating the
store item, filling in the listing and privacy tabs, uploading updates, and
publishing automatically through the Chrome Web Store API v2
(`./scripts/publish.sh`).

## Layout

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest: permissions, icons, service worker, CSP. |
| `background.js` | Service worker. Registers the content script dynamically for exactly the sites you've granted access to, and keeps open tabs in sync. |
| `content.js` | The overlay: countdown, scrolling lock, Continue / Close Tab. |
| `shared.js` | Shared config and prefix → match-pattern helpers. |
| `popup.html` / `popup.js` / `popup.css` | The popup: add and remove blocked sites, grant site access. |
| `icons/` | 16/32/48/128 px PNGs plus the source SVG. |
| `scripts/package.sh` | Validates and builds the store package. |
| `scripts/publish.sh` | Uploads and publishes via the Chrome Web Store API v2. |
| `PRIVACY.md` | Privacy policy for the store's privacy tab. |

## Local development

`chrome://extensions` → enable *Developer mode* → *Load unpacked* → pick this
folder. Then reload the extension card after each change. See
[PUBLISHING.md §9](PUBLISHING.md) for Firefox and more detail.
