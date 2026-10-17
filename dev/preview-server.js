/* Dev-only preview server. Serves the extension's pages in a normal browser
   with a stand-in for the chrome.* APIs, so the look of the pages can be
   checked without installing the extension.

   node dev/preview-server.js   ->  http://localhost:8123
   Not part of the extension. */
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const port = Number(process.env.PORT || 8123);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { response.writeHead(403); response.end("forbidden"); return; }
  if (url.pathname === "/") file = path.join(root, "options.html");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); response.end("not found"); return; }

  const type = types[path.extname(file)] || "application/octet-stream";
  if (path.extname(file) === ".html") {
    const html = fs.readFileSync(file, "utf8").replace(
      "</head>",
      '  <script src="/dev/mock-chrome.js"></script>\n</head>'
    );
    response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    response.end(html);
    return;
  }
  response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  fs.createReadStream(file).pipe(response);
}).listen(port, "0.0.0.0", () => console.log(`Preview on http://localhost:${port}`));
