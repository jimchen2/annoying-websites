# Publishing "Annoying Websites"

Everything needed to get this extension from this repo onto the Chrome Web Store.

---

## TL;DR

```bash
./scripts/package.sh                  # validate + build dist/annoying-websites-2.0.0.zip
./scripts/package.sh --bump patch     # bump the version, then build
```

Then upload the zip at <https://chrome.google.com/webstore/devconsole>.

The full walkthrough is below.

---

## 1. How the package is built

Chrome Web Store accepts exactly one thing: a `.zip` file whose **root** contains
`manifest.json`. Not a folder containing a zip, not a zip with `annoying-websites/`
at the top.

`scripts/package.sh` handles this. It:

1. Parses `manifest.json` and fails on invalid JSON or a non-MV3 manifest.
2. Checks that every file the manifest references actually exists.
3. Scans the JS for remote-code patterns (`eval`, `new Function`, remote
   `importScripts`, remote `fetch`, remote `<script src="https://...">`) — MV3
   forbids downloading executable code, and this is the fastest way to get an
   extension rejected.
4. Warns you if the version has already been released (a git tag `vX.Y.Z` exists).
5. Stages only the runtime files and zips them with `manifest.json` at the root.
6. Re-opens the finished archive and verifies the layout before declaring success.

```bash
./scripts/package.sh --check         # validate only, build nothing
./scripts/package.sh --bump patch    # 2.0.0 -> 2.0.1, then build
./scripts/package.sh --bump minor    # 2.0.0 -> 2.1.0
./scripts/package.sh --bump major    # 2.0.0 -> 3.0.0
./scripts/package.sh --out /tmp/x    # build somewhere else
```

Output lands in `dist/`, which is gitignored.

### What is *not* in the package

`README.md`, `scripts/`, `PUBLISHING.md`, `PRIVACY.md`, `.git/` and `icons/icon.svg`
are all excluded. The store listing assets (screenshots, promo tiles) are uploaded
through the dashboard, not through the zip, and the store's own icon upload does
not need the SVG.

---

## 2. One-time setup in the Developer Dashboard

1. Sign in at <https://chrome.google.com/webstore/devconsole> with a Google account.
   Registering a developer account costs **$5 once** (paid per developer, not per
   extension).
2. **Add new item** → upload `dist/annoying-websites-<version>.zip`.
   This first upload creates the item and assigns its extension ID. Copy the ID
   from the item's URL: `chrome.google.com/webstore/detail/<THIS_IS_THE_ITEM_ID>`.
3. Fill in the **Store listing** tab. Required fields:
   - **Description** (up to 10,000 characters) and a short description (132 chars).
   - **Category** — "Productivity" fits.
   - **Language**, **Support email**, and optionally a homepage URL.
   - **Icon** — upload `icons/icon128.png` (128×128 PNG).
   - **Screenshots** — at least one is required. 1280×800 or 640×400. Capture the
     popup with a few sites in the list, and the pause overlay mid-countdown.
     You can crop the overlay out if you don't want the site name visible.
4. Fill in the **Privacy practices** tab (see §5).
5. Set **Distribution → Visibility** to who you want it published for.
   Keep it as "Public" only when you're ready; "Unlisted" still gives you a
   shareable link.

> **Important for the API path:** the API cannot create items and cannot change
> visibility. Once you change visibility in the dashboard, publish by hand once
> with the new visibility before trying to publish via the API.

---

## 3. Uploading an update (the normal path)

The store rejects a package whose `version` is not strictly higher than the last
published one. So every release needs a version bump:

```bash
./scripts/package.sh --bump patch
git add -A && git commit -m "Release 2.0.1"
git tag v2.0.1 && git push origin v2.0.1
```

Then in the dashboard: your item → **Package** → **Upload** → pick the zip →
**Submit for review**.

Review typically takes a few hours to a few days.

---

## 4. Publishing automatically (API v2)

For repeated releases, the Chrome Web Store API is faster than clicking through
the dashboard.

> **The v1.1 API is dead.** Google retired
> `https://www.googleapis.com/chromewebstore/v1.1/...` on **15 October 2026**.
> Every endpoint in `scripts/publish.sh` uses the v2 form:
>
> | Action | Endpoint |
> |---|---|
> | Upload | `POST https://chromewebstore.googleapis.com/upload/v2/publishers/{publisherId}/items/{itemId}:upload` |
> | Publish | `POST https://chromewebstore.googleapis.com/v2/publishers/{publisherId}/items/{itemId}:publish` |
> | Status | `GET https://chromewebstore.googleapis.com/v2/publishers/{publisherId}/items/{itemId}:fetchStatus` |

### Getting the credentials

1. In the [Google Cloud console](https://console.cloud.google.com/), create a
   project and enable the **Chrome Web Store API**.
2. Create an **OAuth client ID** (type "Desktop app" or "Web application") and
   download the client secret.
3. Authorize your Google account once with the scope
   `https://www.googleapis.com/auth/chromewebstore` to obtain a refresh token.
   A quick way is the
   [OAuth 2.0 Playground](https://developers.google.com/oauthplayground):
   - Gear icon → *Use your own OAuth credentials* → enter the client ID/secret.
   - Scope: `https://www.googleapis.com/auth/chromewebstore`.
   - Authorize, then *Exchange authorization code for tokens* → copy the
     **Refresh token**.
4. **Publisher ID**: Developer Dashboard → *Account* tab → it's the UUID in the
   dashboard URL, e.g. `1441ca88-135b-4f7f-8ea0-a310657241d9`.
5. **Item ID**: the extension ID from the item's detail page.

### Using it

```bash
export CWS_CLIENT_ID='...'
export CWS_CLIENT_SECRET='...'
export CWS_REFRESH_TOKEN='...'
export CWS_PUBLISHER_ID='...'
export CWS_ITEM_ID='...'

./scripts/package.sh --bump patch
./scripts/publish.sh                  # upload + submit for review
./scripts/publish.sh --no-publish     # upload as a draft, skip the review submission
```

`publish.sh` exchanges the refresh token for an access token, prints the current
store state, uploads the newest zip in `dist/`, polls until the upload finishes,
then submits for review. It exits non-zero if the store rejects anything, so it
drops straight into CI.

> Keep the refresh token in a secret store (or `~/.config/` with `chmod 600`).
> That token can publish *every* extension on the publisher account, so treat it
> like a password. The `chromewebstore` scope also covers all of your items, not
> just this one.

---

## 5. What the reviewer will look at in *this* extension

The store review is mostly about permissions and honesty. The things that will
come up for this specific extension:

**Single purpose.** Be able to state it in one sentence: *"Pause the user on
self-selected distracting websites with a countdown timer."* Put that wording in
the dashboard's single-purpose field.

**Host permissions.** The manifest requests two kinds:

- `host_permissions` — the seven default sites (1point3acres, huaren.us, baidu,
  bilibili, zombsroyale.io, llm.jimchen.me, aistudio.google.com). Justification:
  *"These are the default blocked websites; the extension needs access to show
  the countdown overlay on them."*
- `optional_host_permissions` — `http://*/*` and `https://*/*`. Justification:
  *"The user adds their own website prefixes at runtime; the extension requests
  access to each specific origin only when the user adds it, via
  `chrome.permissions.request`."*

**Do not add the `tabs` permission.** `background.js` calls `chrome.tabs.query({})`
and reads `tab.url`, but it does **not** need the `tabs` permission: `tab.url` is
only populated for tabs the extension already has host access to, which is
exactly the set the code cares about. Adding `tabs` would put a
*"Read your browsing history"* warning on the install prompt and would almost
certainly draw extra scrutiny for no functional gain. If you ever add it, raise
`minimum_chrome_version` deliberately at the same time.

**No remote code.** The extension ships all of its logic and loads nothing from
the network. `scripts/package.sh` greps for the usual violations on every build.
Keep it that way — an MV3 extension that fetches a script at runtime is
rejected outright.

**The `key` field in `manifest.json`.** This pins the extension ID for local
development and self-distribution. The Chrome Web Store assigns its own ID and
ignores this field, so it is harmless to leave in — but it is also not doing
anything for you on the store. Keeping it means your unpacked dev install and a
self-hosted build keep the same ID.

**`minimum_chrome_version: "109"`.** Verified against the API docs: the newest
thing this extension uses is `scripting.RegisteredContentScript.world`, which
landed in **Chrome 102**. 109 has comfortable headroom. If you ever use a newer
API, bump this number in the same commit.

**Behaviours reviewers look for that this extension does *not* have**: no
deceptive prompts, no forced reinstalls, no data exfiltration, no affiliate
links, no monetisation. The overlay is transparent about what it is and always
offers a *Continue Browsing* button, which is the right posture.

---

## 6. Privacy practices tab

Because the extension stores a list of the websites you block in
`chrome.storage.sync` (your own Google account, or local storage if sync is
off), declare it honestly on the dashboard's **Privacy** tab:

- **Data collection**: select the categories that apply, and for each, choose
  "not used for selling or sharing" and give the justification
  *"The list is stored only in the user's own browser profile and synced to the
  user's own Google account; the developer never receives it."*
- **Privacy policy URL**: the store wants a public URL. The cleanest option is
  to publish [`PRIVACY.md`](PRIVACY.md) with GitHub Pages
  (repo → *Settings* → *Pages* → deploy from `main` / `/docs` or `/root`), then
  use `https://<user>.github.io/annoying-websites/` as the URL. Any public page
  works — a personal site, a GitHub Gist, a Notion page.

---

## 7. Other browsers

**Edge** (Chromium-based) — the same zip works:
<https://partner.microsoft.com/dashboard/microsoftedge> → *Package management* →
*Submit a new package*. Edge uses its own dashboard and review queue.

**Firefox** — not a straight upload. Firefox's `addons.mozilla.org` needs its
own manifest adjustments, and the parts of this extension that lean on Chromium
behaviour need checking:

- `world: "ISOLATED"` in `chrome.scripting.registerContentScripts` — Firefox
  supports the API but the `world` property is not universal there.
- `chrome.tabs.sendMessage` / `chrome.scripting.executeScript` with `world` —
  Firefox's MV3 implementation is Chromium-shaped but not identical.
- Firefox requires `browser_specific_settings.gecko.id` in the manifest and a
  signed build, and it validates host permissions differently.

Because of those, treat Firefox as a separate porting task rather than a
zip upload. If you want it, open an issue and I'll do the port.

---

## 8. Troubleshooting

| Symptom | Cause |
|---|---|
| *"Manifest file is missing or unreadable"* | The zip has a folder at the top instead of `manifest.json` at the root. Rebuild with `scripts/package.sh`. |
| *"Version has already been used"* | The `version` in `manifest.json` is not higher than the published one. Run `--bump patch`. |
| *"The extension is invalid: Could not load javascript"* | A file referenced by the manifest isn't in the zip. `package.sh` checks this before building. |
| Upload succeeds, publish returns `ITEM_NOT_UPDATABLE` | A submission is already in review. Cancel it in the dashboard, or use `:cancelSubmission`. |
| API returns 401 | Expired or wrong refresh token. Regenerate it in the OAuth Playground. |
| API returns 403 on publish | You changed visibility in the dashboard and haven't published by hand once since. |
| Review rejected over permissions | Re-read §5 — the justification wording in the dashboard is what the reviewer reads, not your code comments. |

---

## 9. Local development

No build step, no bundler. Load the repo folder directly:

- **Chrome / Edge**: `chrome://extensions` → enable *Developer mode* → *Load
  unpacked* → select the repo root.
- **Firefox**: `about:debugging#/runtime/this-firefox` → *Load Temporary
  Add-on* → pick `manifest.json`.

After changing a file, hit reload on the extension card. The service worker logs
under `chrome://extensions` → the extension → *service worker* link. Console
output from the content script is prefixed `[Annoy]`.
