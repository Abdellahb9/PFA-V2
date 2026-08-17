// Render every .mmd source to SVG + PNG with Playwright (system Edge) and the
// locally installed mermaid bundle. Mermaid lazy-loads its diagram definitions,
// and file:// blocks those dynamic ESM imports (CORS), so the script serves the
// folder over a throwaway localhost server for the duration of the render.
const { chromium } = require("playwright-core");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SRC = String.raw`C:\Users\RAZER\Music\PFA\docs\uml\mermaid`;
const OUT = String.raw`C:\Users\RAZER\Music\PFA\docs\uml\img`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json",
  ".css": "text/css",
};

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
  });
}

(async () => {
  const { srv, port } = await serve();
  const base = `http://127.0.0.1:${port}`;
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".mmd")).sort();

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await (
    await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 })
  ).newPage();
  page.on("pageerror", (e) => console.log("  pageerror:", String(e).slice(0, 160)));

  let ok = 0;
  for (const f of files) {
    const code = fs.readFileSync(path.join(SRC, f), "utf8");
    const html = `<!doctype html><html><head><meta charset="utf-8">
      <style>
        body{margin:0;background:#fff;font-family:Inter,system-ui,sans-serif}
        #box{display:inline-block;padding:20px}
      </style></head>
      <body><div id="box"></div>
      <script type="module">
        import mermaid from "/node_modules/mermaid/dist/mermaid.esm.min.mjs";
        mermaid.initialize({
          startOnLoad:false, theme:"base", securityLevel:"loose",
          fontFamily:"Inter, system-ui, sans-serif",
          themeVariables:{
            primaryColor:"#f6fbe9", primaryBorderColor:"#76B900", primaryTextColor:"#111",
            lineColor:"#555", fontSize:"15px", noteBkgColor:"#fff8e1", noteBorderColor:"#C98300"
          }
        });
        const src = ${JSON.stringify(code)};
        try {
          const { svg } = await mermaid.render("g", src);
          document.getElementById("box").innerHTML = svg;
          // Mermaid ships the SVG with max-width:100%, which collapses it inside
          // an inline-block. Pin the intrinsic size from the viewBox instead.
          const el = document.querySelector("#box svg");
          const vb = (el.getAttribute("viewBox") || "").split(/[\\s,]+/).map(Number);
          if (vb.length === 4) {
            const scale = 1.5;
            el.style.maxWidth = "none";
            el.setAttribute("width", Math.round(vb[2] * scale));
            el.setAttribute("height", Math.round(vb[3] * scale));
          }
          window.__ok = true;
        } catch (e) { window.__err = String((e && e.message) || e); }
      </script></body></html>`;

    fs.writeFileSync(path.join(ROOT, "_render.html"), html, "utf8");
    await page.goto(`${base}/_render.html`, { waitUntil: "load" });
    await page
      .waitForFunction("window.__ok === true || window.__err", { timeout: 40000 })
      .catch(() => {});

    const err = await page.evaluate(() => window.__err || null);
    const name = f.replace(/\.mmd$/, "");
    if (err) {
      console.log(`FAIL  ${name}: ${err.slice(0, 180)}`);
      continue;
    }

    const svg = await page.evaluate(() => document.querySelector("#box svg").outerHTML);
    fs.writeFileSync(path.join(OUT, name + ".svg"), svg, "utf8");
    await (await page.$("#box")).screenshot({ path: path.join(OUT, name + ".png") });
    const dim = await page.evaluate(() => {
      const r = document.querySelector("#box svg").getBoundingClientRect();
      return `${Math.round(r.width)}x${Math.round(r.height)}`;
    });
    console.log(`OK    ${name}  ${dim}`);
    ok++;
  }

  console.log(`\n${ok}/${files.length} diagrammes rendus`);
  await browser.close();
  srv.close();
})();
