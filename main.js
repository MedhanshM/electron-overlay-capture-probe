// Transparent, click-through, always-on-top overlay window covering a display:
// measures its resulting bounds, whether screen capture includes it, and close-event order.
const { app, BrowserWindow, screen, desktopCapturer, session, systemPreferences } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const OUT = path.resolve(process.env.OUT_DIR || path.join(__dirname, "out"));
const TAG = process.env.RUN_TAG || "default";
fs.mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const results = { tag: TAG, startedAt: new Date().toISOString(), env: {}, variants: [], sourceDisplayMatch: null, capture: { start: null, shots: [] }, q6: [], errors: [], log: [] };
function log(...a) {
  const line = `[+${Date.now() - t0}ms] ` + a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
  console.log(line);
  results.log.push(line);
}
function save() {
  fs.writeFileSync(path.join(OUT, `results-${TAG}.json`), JSON.stringify(results, null, 2));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout: " + what)), ms))]);

setTimeout(() => {
  log("GLOBAL TIMEOUT");
  results.timedOut = true;
  save();
  app.exit(3);
}, Number(process.env.PROBE_TIMEOUT_MS || 150000));
process.on("uncaughtException", (e) => { results.errors.push("uncaught: " + (e && e.stack)); save(); });
process.on("unhandledRejection", (e) => { results.errors.push("unhandled: " + ((e && e.stack) || e)); save(); });
// Variants destroy every window between steps; keep the app alive.
app.on("window-all-closed", () => {});

const OVERLAY_HTML = `<!DOCTYPE html><html><head><style>
  html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
  body{box-sizing:border-box;border:4px solid rgba(139,92,246,0.9)}
</style></head><body></body></html>`;
const OVERLAY_URL = `data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_HTML)}`;

// Overlay window options. `ctor` overrides a key; undefined removes it.
function overlayOptions(rect, ctor = {}) {
  const o = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    fullscreenable: false,
    show: false,
    roundedCorners: false,
    type: "panel",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "overlay-preload.js"),
      backgroundThrottling: false,
    },
  };
  for (const [k, v] of Object.entries(ctor)) {
    if (v === undefined) delete o[k];
    else o[k] = v;
  }
  return o;
}

function snap(win, label, rec) {
  if (!win || win.isDestroyed()) return rec.snaps.push({ label, destroyed: true });
  rec.snaps.push({
    label,
    t: Date.now() - t0,
    bounds: win.getBounds(),
    content: win.getContentBounds(),
    normal: win.getNormalBounds(),
    isMaximized: win.isMaximized(),
    isFullScreen: win.isFullScreen(),
    isVisible: win.isVisible(),
  });
}

function inner(win) {
  return withTimeout(
    win.webContents.executeJavaScript(
      `({innerWidth, innerHeight, outerWidth, outerHeight, dpr: devicePixelRatio, screenX, screenY, screenW: screen.width, screenH: screen.height, availW: screen.availWidth, availH: screen.availHeight, availTop: screen.availTop, body: document.body.getBoundingClientRect().toJSON()})`
    ),
    5000,
    "inner"
  ).catch((e) => String(e));
}

// Create -> configure -> load -> showInactive, with switches for variants.
async function createOverlay(rect, v, rec) {
  const opts = v.minimal
    ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height, frame: false, show: false, ...(v.minimalExtra || {}) }
    : overlayOptions(rect, v.ctor);
  rec.options = JSON.parse(JSON.stringify({ ...opts, webPreferences: undefined }));
  const win = new BrowserWindow(opts);
  for (const ev of ["will-resize", "will-move", "resize", "move", "maximize", "unmaximize", "show", "hide", "enter-full-screen", "leave-full-screen", "always-on-top-changed", "moved", "resized"]) {
    win.on(ev, (_e, arg) => {
      rec.events.push({ ev, t: Date.now() - t0, arg: arg && typeof arg === "object" ? arg : arg, bounds: win.isDestroyed() ? null : win.getBounds() });
    });
  }
  snap(win, "after-construct", rec);
  if (v.setBoundsAfterConstruct) {
    win.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    snap(win, "after-setBounds-hidden", rec);
  }
  if (!v.minimal) {
    if (!v.skipVisibleOnAll) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    snap(win, "after-setVisibleOnAllWorkspaces", rec);
    if (!v.skipIgnoreMouse) win.setIgnoreMouseEvents(true);
    if (!v.skipAlwaysOnTop) win.setAlwaysOnTop(true, "screen-saver");
    snap(win, "after-setAlwaysOnTop", rec);
  }
  if (v.contentProtection) {
    win.setContentProtection(true);
    snap(win, "after-setContentProtection", rec);
  }
  await withTimeout(win.loadURL(OVERLAY_URL), 10000, "loadURL");
  snap(win, "after-loadURL", rec);
  if (v.showCall === "show") win.show();
  else if (v.showCall !== "none") win.showInactive();
  snap(win, "after-show", rec);
  if (v.setBoundsAfter) {
    win.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    snap(win, "after-setBounds", rec);
  }
  await sleep(300);
  snap(win, "+300ms", rec);
  await sleep(1200);
  snap(win, "+1500ms", rec);
  rec.inner = await inner(win);
  return win;
}

const VARIANTS = [
  { name: "baseline" },
  { name: "no-setAlwaysOnTop", skipAlwaysOnTop: true },
  { name: "no-type-panel", ctor: { type: undefined } },
  { name: "transparent-false", ctor: { transparent: false } },
  { name: "resizable-true", ctor: { resizable: true } },
  { name: "enableLargerThanScreen-true", ctor: { enableLargerThanScreen: true } },
  { name: "show()-instead-of-showInactive()", showCall: "show" },
  { name: "ctor-show-true", ctor: { show: true }, showCall: "none" },
  { name: "setBounds(display.bounds)-after-showInactive", setBoundsAfter: true },
  { name: "setBounds(display.bounds)-right-after-construct", setBoundsAfterConstruct: true },
  { name: "no-setVisibleOnAllWorkspaces", skipVisibleOnAll: true },
  { name: "no-setIgnoreMouseEvents", skipIgnoreMouse: true },
  { name: "focusable-true", ctor: { focusable: true } },
  { name: "thickFrame-false", ctor: { thickFrame: false } },
  { name: "maximizable-true", ctor: { maximizable: true } },
  { name: "movable-true", ctor: { movable: true } },
  { name: "bounds-height-minus-1", rectAdjust: { height: -1 } },
  { name: "minimal-frameless", minimal: true },
  { name: "minimal-frameless-transparent", minimal: true, minimalExtra: { transparent: true } },
];

function primary() {
  return screen.getPrimaryDisplay();
}

async function runVariants() {
  const filter = process.env.VARIANTS ? process.env.VARIANTS.split(",") : null;
  for (const v of VARIANTS) {
    if (filter && !filter.includes(v.name)) continue;
    const d = primary();
    const rect = { ...d.bounds };
    if (v.rectAdjust) for (const [k, dv] of Object.entries(v.rectAdjust)) rect[k] += dv;
    const rec = { name: v.name, requested: rect, display: { bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor }, snaps: [], events: [] };
    results.variants.push(rec);
    let win = null;
    try {
      win = await createOverlay(rect, v, rec);
    } catch (e) {
      rec.error = String((e && e.stack) || e);
    }
    const last = rec.snaps[rec.snaps.length - 1];
    log(`variant ${v.name}: requested`, rect, "final bounds", last && last.bounds, "content", last && last.content, "inner", rec.inner && { w: rec.inner.innerWidth, h: rec.inner.innerHeight, dpr: rec.inner.dpr });
    if (win && !win.isDestroyed()) win.destroy();
    save();
    await sleep(300);
  }
}

// Which display does the first screen source map to (source.display_id -> display)?
async function sourceDisplayMatch() {
  try {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } });
    const out = { sources: sources.map((s) => ({ id: s.id, name: s.name, display_id: s.display_id })) };
    const s = sources[0];
    const match = s && s.display_id && screen.getAllDisplays().find((d) => String(d.id) === s.display_id);
    out.matched = match ? { id: match.id, bounds: match.bounds, workArea: match.workArea } : null;
    out.fellBack = !match;
    results.sourceDisplayMatch = out;
    log("source display match", out);
  } catch (e) {
    results.sourceDisplayMatch = { error: String(e) };
  }
}

function strokesPayload() {
  const now = Date.now();
  const red = "#ff0000";
  const line = (y) => ({ points: [{ x: 5, y }, { x: 60, y }], color: red, width: 0.5, updatedAt: now });
  return {
    permanent: true,
    strokes: [
      line(25),
      line(50),
      line(75),
      { points: [{ x: 50, y: 35 }, { x: 50, y: 65 }], color: red, width: 0.5, updatedAt: now },
      { points: [{ x: 45, y: 50 }, { x: 55, y: 50 }], color: red, width: 0.5, updatedAt: now },
    ],
  };
}

function expectedRows(frameH, d, overlayContent) {
  const s = frameH / d.bounds.height;
  const out = { fullDisplay: {}, workArea: {}, actualOverlayContentBounds: {} };
  for (const p of [25, 50, 75]) {
    out.fullDisplay[p] = +((p / 100) * d.bounds.height * s).toFixed(1);
    out.workArea[p] = +((d.workArea.y - d.bounds.y + (p / 100) * d.workArea.height) * s).toFixed(1);
    if (overlayContent) out.actualOverlayContentBounds[p] = +((overlayContent.y - d.bounds.y + (p / 100) * overlayContent.height) * s).toFixed(1);
  }
  return out;
}

async function captureOnce(probe, label, overlay) {
  const d = primary();
  const shot = { label, overlayContent: overlay && !overlay.isDestroyed() ? overlay.getContentBounds() : null, overlayBounds: overlay && !overlay.isDestroyed() ? overlay.getBounds() : null };
  results.capture.shots.push(shot);
  try {
    const g = await withTimeout(probe.webContents.executeJavaScript("window.grab()", true), 10000, "grab");
    const file = path.join(OUT, `${TAG}-${label}-getDisplayMedia.png`);
    fs.writeFileSync(file, Buffer.from(g.dataUrl.split(",")[1], "base64"));
    shot.gdm = { file: path.basename(file), w: g.w, h: g.h, freshFrames: g.freshFrames };
    shot.gdm.analysis = await probe.webContents.executeJavaScript(`window.analyze(${JSON.stringify(g.dataUrl)})`);
    shot.gdm.expected = expectedRows(g.h, d, shot.overlayContent);
  } catch (e) {
    shot.gdmError = String((e && e.stack) || e);
  }
  try {
    const sz = { width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor) };
    const sources = await withTimeout(desktopCapturer.getSources({ types: ["screen"], thumbnailSize: sz }), 15000, "thumb");
    const src = sources[0];
    const png = src.thumbnail.toPNG();
    const file = path.join(OUT, `${TAG}-${label}-thumbnail.png`);
    fs.writeFileSync(file, png);
    const tsz = src.thumbnail.getSize();
    shot.thumb = { file: path.basename(file), w: tsz.width, h: tsz.height, requested: sz };
    shot.thumb.analysis = await probe.webContents.executeJavaScript(`window.analyze(${JSON.stringify(src.thumbnail.toDataURL())})`);
    shot.thumb.expected = expectedRows(tsz.height, d, shot.overlayContent);
  } catch (e) {
    shot.thumbError = String((e && e.stack) || e);
  }
  const brief = (a) => a && { W: a.W, H: a.H, redRowsAtX30: a.redRowsAtX30.map((r) => r.center), violetRowsAtX30: a.violetRowsAtX30.map((r) => `${r.start}-${r.end}`), violetColsAtY45: a.violetColsAtY45.map((r) => `${r.start}-${r.end}`) };
  log(`capture ${label}: overlayContent`, shot.overlayContent, "gdm", brief(shot.gdm && shot.gdm.analysis), shot.gdmError || "", "thumb", brief(shot.thumb && shot.thumb.analysis), shot.thumbError || "");
  save();
}

async function runCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_req, cb) => {
      desktopCapturer
        .getSources({ types: ["screen"] })
        .then((s) => {
          log("displayMedia handler sources", s.map((x) => ({ id: x.id, name: x.name, display_id: x.display_id })));
          cb({ video: s[0] });
        })
        .catch((e) => {
          log("displayMedia handler error", String(e));
          cb({});
        });
    },
    { useSystemPicker: false }
  );
  const d = primary();
  const probe = new BrowserWindow({
    x: d.bounds.x + d.bounds.width - 320,
    y: d.bounds.y + 20,
    width: 300,
    height: 200,
    show: true,
    webPreferences: { backgroundThrottling: false },
  });
  await probe.loadFile(path.join(__dirname, "probe.html"));
  try {
    results.capture.start = await withTimeout(probe.webContents.executeJavaScript("window.startCapture()", true), 20000, "startCapture");
    log("getDisplayMedia started", results.capture.start);
  } catch (e) {
    results.capture.startError = String((e && e.stack) || e);
    log("getDisplayMedia FAILED", results.capture.startError);
  }
  save();
  await sleep(500);
  await captureOnce(probe, "control-no-overlay", null);

  const capVariants = [
    { label: "product-baseline", v: {} },
    { label: "contentProtection-true", v: { contentProtection: true } },
    { label: "no-type-panel", v: { ctor: { type: undefined } } },
    { label: "setBounds-after-showInactive", v: { setBoundsAfter: true } },
  ];
  for (const { label, v } of capVariants) {
    const rec = { name: `capture:${label}`, requested: d.bounds, display: { bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor }, snaps: [], events: [] };
    results.variants.push(rec);
    let win = null;
    try {
      win = await createOverlay({ ...d.bounds }, v, rec);
      win.webContents.send("overlay-strokes", strokesPayload());
      await sleep(1000);
      await captureOnce(probe, label, win);
    } catch (e) {
      rec.error = String((e && e.stack) || e);
      log(`capture variant ${label} error`, rec.error);
    }
    if (win && !win.isDestroyed()) win.destroy();
    await sleep(400);
  }
  await probe.webContents.executeJavaScript("window.stopCapture()").catch(() => {});
  probe.destroy();
}

// Q6: destroy the old window, null the module ref, create the new one; does the old
// window's 'closed' handler run before or after the ref points at the new window?
async function q6(kind) {
  const L = [];
  const l = (m) => L.push(`[+${Date.now() - t0}ms] ${m}`);
  const d = primary();
  let overlayWindow = null;
  let A = null;
  let B = null;
  function who() {
    if (overlayWindow === null) return "null";
    if (overlayWindow === A) return "A";
    if (overlayWindow === B) return "B";
    return "other";
  }
  const mk = () => (kind === "overlay-options" ? new BrowserWindow(overlayOptions({ x: d.bounds.x, y: d.bounds.y, width: 400, height: 300 })) : new BrowserWindow({ show: false, width: 200, height: 200 }));
  try {
    A = mk();
    overlayWindow = A;
    A.on("closed", () => {
      l(`A 'closed' fired; overlayWindow was ${who()} -> setting null`);
      overlayWindow = null;
    });
    if (kind === "overlay-options") {
      await A.loadURL(OVERLAY_URL);
      A.showInactive();
      await sleep(300);
    }
    l("calling A.destroy()");
    A.destroy();
    l(`A.destroy() returned; overlayWindow=${who()}; A.isDestroyed()=${A.isDestroyed()}`);
    overlayWindow = null;
    B = mk();
    overlayWindow = B;
    l(`B constructed and assigned; overlayWindow=${who()}`);
    B.on("closed", () => {
      overlayWindow = null;
    });
    await overlayWindow.loadURL(OVERLAY_URL);
    l(`after await B.loadURL; overlayWindow=${who()} (product would ${overlayWindow && !overlayWindow.isDestroyed() ? "" : "NOT "}showInactive B)`);
    await sleep(500);
    l(`+500ms; overlayWindow=${who()}; B.isDestroyed()=${B.isDestroyed()}`);
  } catch (e) {
    l("error " + String((e && e.stack) || e));
  }
  if (B && !B.isDestroyed()) B.destroy();
  results.q6.push({ kind, lines: L });
  L.forEach((x) => log(`Q6[${kind}] ${x}`));
  save();
}

async function main() {
  results.env = {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    osVersion: os.version ? os.version() : null,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    argv: process.argv,
    primaryDisplayId: primary().id,
    displays: screen.getAllDisplays().map((d) => ({ id: d.id, label: d.label, bounds: d.bounds, workArea: d.workArea, size: d.size, workAreaSize: d.workAreaSize, scaleFactor: d.scaleFactor, rotation: d.rotation, internal: d.internal })),
    screenAccess: process.platform === "darwin" ? systemPreferences.getMediaAccessStatus("screen") : "n/a",
  };
  log("env", results.env);
  screen.on("display-metrics-changed", (_e, d, changed) => log("display-metrics-changed", { id: d.id, bounds: d.bounds, workArea: d.workArea, changed }));
  save();
  const steps = (process.env.STEPS || "variants,resolve,capture,q6").split(",");
  if (steps.includes("variants")) await runVariants();
  if (steps.includes("resolve")) await sourceDisplayMatch();
  if (steps.includes("capture")) await runCapture();
  if (steps.includes("q6")) {
    await q6("minimal");
    await q6("overlay-options");
  }
  results.finishedAt = new Date().toISOString();
  log("done");
  save();
  setTimeout(() => app.exit(0), 200);
}

app.whenReady().then(() =>
  main().catch((e) => {
    results.errors.push("main: " + ((e && e.stack) || e));
    save();
    app.exit(1);
  })
);
