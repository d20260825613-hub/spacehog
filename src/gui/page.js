/**
 * The GUI is a small local web app: the binary serves one page on 127.0.0.1 and
 * opens it in the default browser. Rendering text in a real browser keeps the
 * GUI dependency-free, and the page is just a thin shell around the same CLI.
 */

export const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>spacehog</title>
<style>
  :root { --bg:#14161a; --panel:#1c1f26; --line:#2b3038; --ink:#e6e8ec; --dim:#98a0ad; --accent:#5ec27d; --warn:#d9a13b; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.5 "Segoe UI",system-ui,sans-serif; }
  header { padding:18px 24px; border-bottom:1px solid var(--line); display:flex; align-items:baseline; gap:12px; }
  header h1 { font-size:19px; margin:0; }
  header .v { color:var(--dim); font-size:13px; }
  header .grow { flex:1; }
  main { display:grid; grid-template-columns:340px 1fr; min-height:calc(100vh - 61px); }
  aside { border-right:1px solid var(--line); padding:20px 22px; }
  section { padding:20px 24px; min-width:0; }
  label { display:block; font-size:12px; text-transform:uppercase; letter-spacing:.5px; color:var(--dim); margin:14px 0 6px; }
  label:first-child { margin-top:0; }
  input[type=text], select { width:100%; background:#101216; color:var(--ink); border:1px solid var(--line); border-radius:7px; padding:8px 10px; font:13px "Cascadia Mono",Consolas,monospace; }
  .row { display:flex; gap:8px; }
  .row > * { flex:1; }
  button { background:var(--accent); color:#10130f; border:0; border-radius:7px; padding:9px 14px; font-weight:650; font-size:14px; cursor:pointer; }
  button.ghost { background:transparent; color:var(--ink); border:1px solid var(--line); font-weight:500; }
  button:disabled { opacity:.55; cursor:default; }
  .go { width:100%; margin-top:18px; padding:11px; }
  .hint { color:var(--dim); font-size:12px; margin-top:8px; }
  pre { margin:0; background:#101216; border:1px solid var(--line); border-radius:8px; padding:14px; overflow:auto; font:13px/1.45 "Cascadia Mono",Consolas,monospace; white-space:pre; height:calc(100vh - 170px); }
  .bar { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
  .dot { width:8px; height:8px; border-radius:50%; background:var(--dim); }
  .dot.run { background:var(--warn); }
  .dot.ok { background:var(--accent); }
  .dot.bad { background:#e06c75; }
  .status { color:var(--dim); font-size:13px; }
  .checks { display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:10px; }
  .checks label { display:flex; align-items:center; gap:6px; text-transform:none; letter-spacing:0; font-size:13px; color:var(--ink); margin:0; }
</style>
</head>
<body>
<header>
  <h1>spacehog</h1><span class="v" id="ver"></span>
  <span class="grow"></span>
  <span class="status" id="exe"></span>
</header>
<main>
  <aside>
    <label for="path">Folder to scan</label>
    <div class="row">
      <input type="text" id="path" spellcheck="false" placeholder="C:\\Users\\you">
      <button class="ghost" id="browse" style="flex:0 0 auto">Browse</button>
    </div>
    <p class="hint">Read-only. Nothing is deleted or moved.</p>

    <label for="keep">Duplicate handling</label>
    <select id="keep">
      <option value="newest">Keep the newest copy</option>
      <option value="oldest">Keep the oldest copy</option>
      <option value="shortest-path">Keep the shallowest path</option>
      <option value="first">Keep the first in path order</option>
    </select>

    <label for="top">Rows per section</label>
    <input type="text" id="top" value="15">

    <label for="minsize">Ignore files under</label>
    <input type="text" id="minsize" value="0" placeholder="10mb">

    <label>Extras</label>
    <div class="checks">
      <label><input type="checkbox" id="json"> JSON output</label>
      <label><input type="checkbox" id="nocache"> No hash cache</label>
      <label><input type="checkbox" id="hidden"> Include hidden</label>
    </div>

    <button class="go" id="run">Scan</button>
    <button class="go ghost" id="stop" disabled>Stop</button>
    <p class="hint" id="note"></p>
  </aside>
  <section>
    <div class="bar">
      <span class="dot" id="dot"></span>
      <span class="status" id="state">Idle</span>
      <span class="grow" style="flex:1"></span>
      <button class="ghost" id="copy" style="padding:5px 10px;font-size:13px">Copy output</button>
    </div>
    <pre id="out">Pick a folder and press Scan.</pre>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
let job = null;

fetch("api/version").then((r) => r.json()).then((v) => {
  $("ver").textContent = "v" + v.version;
  $("exe").textContent = v.exe;
  if (v.cwd) $("path").value = v.cwd;
});

function setState(kind, text) {
  $("dot").className = "dot" + (kind ? " " + kind : "");
  $("state").textContent = text;
}

$("browse").addEventListener("click", async () => {
  const r = await fetch("api/browse", { method: "POST" });
  const data = await r.json();
  if (data.path) $("path").value = data.path;
  if (data.error) $("note").textContent = data.error;
});

$("run").addEventListener("click", async () => {
  const args = [$("path").value.trim() || "."];
  if (!$("json").checked) args.push("--keep", $("keep").value);
  args.push("--top", $("top").value || "15");
  if ($("minsize").value && $("minsize").value !== "0") args.push("--min-size", $("minsize").value);
  if ($("json").checked) args.push("--json", "--pretty");
  if ($("nocache").checked) args.push("--no-cache");
  if (!$("hidden").checked) args.push("--no-hidden");

  $("out").textContent = "";
  $("run").disabled = true;
  $("stop").disabled = false;
  setState("run", "Scanning");

  const started = Date.now();
  const response = await fetch("api/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args }),
  });
  job = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await job.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.chunk) $("out").textContent += message.chunk;
      if (message.exit !== undefined) {
        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        setState(message.exit === 0 ? "ok" : message.exit === 2 ? "bad" : "bad",
          "Finished in " + seconds + "s, exit code " + message.exit);
        $("note").textContent = message.exit === 2
          ? "Exit 2: the --fail-on-dupes threshold was reached."
          : message.exit === 1 ? "Exit 1: bad arguments or the path could not be read." : "";
      }
    }
    $("out").scrollTop = $("out").scrollHeight;
  }
  job = null;
  $("run").disabled = false;
  $("stop").disabled = true;
});

$("stop").addEventListener("click", () => {
  if (job) {
    job.cancel().catch(() => {});
    setState("bad", "Stopped");
    $("run").disabled = false;
    $("stop").disabled = true;
  }
});

$("copy").addEventListener("click", () => {
  navigator.clipboard.writeText($("out").textContent).then(() => {
    $("copy").textContent = "Copied";
    setTimeout(() => { $("copy").textContent = "Copy output"; }, 1200);
  });
});
</script>
</body>
</html>
`;
