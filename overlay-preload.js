// Draws line segments given in percent of the window onto a canvas that fills it.
const { ipcRenderer } = require("electron");

let segments = [];
ipcRenderer.on("overlay-strokes", (_event, next) => {
  segments = next.strokes || [];
});

window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  function frame() {
    requestAnimationFrame(frame);
    const scale = window.devicePixelRatio || 1;
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const pxW = Math.round(cssW * scale);
    const pxH = Math.round(cssH * scale);
    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    for (const seg of segments) {
      ctx.strokeStyle = seg.color;
      ctx.lineWidth = Math.max(1.5, (seg.width / 100) * cssH);
      ctx.lineCap = "round";
      ctx.beginPath();
      seg.points.forEach(({ x, y }, i) => {
        const X = (x / 100) * cssW;
        const Y = (y / 100) * cssH;
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      });
      ctx.stroke();
    }
  }
  requestAnimationFrame(frame);
});
