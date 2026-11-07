// Shared helpers: time (UK local), fetch, formatting, SVG charts with touch-friendly tooltips.

export const TZ = "Europe/London";
export const SLOT = 30 * 60 * 1000;
export const HOUR = 3600e3;
export const DAY = 24 * HOUR;

/* ---------- time ---------- */
const fDayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const fHM = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fDayShort = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const fDM = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" });
const fMY = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, month: "short", year: "2-digit" });
const fWd = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" });
export const dayKey = t => fDayKey.format(new Date(t));
export const hm = t => fHM.format(new Date(t)).replace(/^24/, "00");
export const dayShort = t => fDayShort.format(new Date(t));
export const dm = t => fDM.format(new Date(t));
export const monthYear = t => fMY.format(new Date(t));
export const weekday = t => fWd.format(new Date(t));
export const londonHour = t => { const [h, m] = hm(t).split(":").map(Number); return h + m / 60; };
export function londonMidnight(key) {
  const [y, m, d] = key.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  for (const off of [0, -HOUR, HOUR]) { const t = base + off; if (dayKey(t) === key && hm(t) === "00:00") return t; }
  return base;
}
export function addDays(key, n) { const [y, m, d] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
export const floorSlot = t => Math.floor(t / SLOT) * SLOT;
export const isPeak = t => { const h = londonHour(t); return h >= 16 && h < 19; };
export function settlementPeriod(t) { // UK settlement date + period (1..50) for instant t
  const key = dayKey(t); return { date: key, sp: Math.floor((t - londonMidnight(key)) / SLOT) + 1 };
}
export const iso = t => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
export function slotsBetween(a, b, step = SLOT) { const out = []; for (let t = a; t < b; t += step) out.push(t); return out; }
export function isoWeekdayIdx(key) { const [y, m, d] = key.split("-").map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; }

/* ---------- fetch with short-lived cache ---------- */
const cache = new Map();
export async function getJSON(url, { ttl = 120e3, retries = 1 } = {}) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < ttl) return hit.p;
  const p = (async () => {
    let err;
    for (let i = 0; i <= retries; i++) {
      try {
        const r = await fetch(url, { headers: { Accept: "application/json" } });
        if (!r.ok) throw new Error(`${r.status} ${r.statusText || ""} — ${url.split("?")[0]}`);
        return await r.json();
      } catch (e) { err = e; if (i < retries) await new Promise(r => setTimeout(r, 700)); }
    }
    throw err;
  })();
  cache.set(url, { t: Date.now(), p });
  p.catch(() => cache.delete(url));
  return p;
}
export function clearCache() { cache.clear(); }
export async function pool(tasks, n = 4) {
  const res = new Array(tasks.length); let i = 0;
  async function w() { while (i < tasks.length) { const k = i++; res[k] = await tasks[k](); } }
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, w));
  return res;
}

/* ---------- formatting ---------- */
export const ok = v => v != null && Number.isFinite(v);
export const f0 = v => ok(v) ? Math.round(v).toLocaleString("en-GB") : "—";
export const f1 = v => ok(v) ? v.toFixed(1) : "—";
export const f2 = v => ok(v) ? v.toFixed(2) : "—";
export const gw = mw => ok(mw) ? (mw / 1000).toFixed(Math.abs(mw) >= 10000 ? 1 : 2) : "—";
export const pct = v => ok(v) ? (v * 100).toFixed(v >= 0.1 ? 0 : 1) + "%" : "—";
export const mean = a => { const b = a.filter(ok); return b.length ? b.reduce((s, x) => s + x, 0) / b.length : null; };
export const sum = a => a.filter(ok).reduce((s, x) => s + x, 0);
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------- shared UI bits ---------- */
export function tile(k, v, unit, n, color, extra = "") {
  return `<div class="tile ${extra}"><div class="k">${color ? `<i class="sw" style="background:${color}"></i>` : ""}${k}</div>` +
    `<div class="v">${v}${v !== "—" && unit ? ` <small>${unit}</small>` : ""}</div><div class="n">${n || "&nbsp;"}</div></div>`;
}
export function legendHTML(items) { // [{label, color, dash, box}]
  return items.map(i => `<span>${i.box ? `<i class="sw" style="background:${i.color}"></i>` : `<i class="ln${i.dash ? " dash" : ""}" style="border-color:${i.color}"></i>`}${esc(i.label)}</span>`).join("");
}
export function segmented(el, value, onChange) {
  el.querySelectorAll("button").forEach(b => {
    b.classList.toggle("on", b.dataset.v === String(value));
    b.onclick = () => { el.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); onChange(b.dataset.v); };
  });
}
export function errorNote(msg) { return `<div class="note err">${esc(msg)}</div>`; }

/* ---------- chart engine (SVG, no libraries) ---------- */
const NS = "http://www.w3.org/2000/svg";
export function svgEl(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
export function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) hi = lo + 1;
  const span = hi - lo, mag = Math.pow(10, Math.floor(Math.log10(span / n)));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => span / s <= n) || 10 * mag;
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, t = [];
  for (let v = a; v <= b + 1e-9; v += step) t.push(+v.toFixed(6));
  return t;
}

// global: tap outside any chart hides its tooltip
const charts = new Set();
document.addEventListener("pointerdown", ev => { charts.forEach(c => { if (!c.isConnected) charts.delete(c); else if (c._hideTip && !c.contains(ev.target)) c._hideTip(); }); });

/*
 drawChart(box, {
   series: [{color, dash, step, stepW, pts:[{t,v}], width}],
   band: {color, pts:[{t,lo,hi}]},
   stack: {keys:[...], colors:{k:color}, pts:[{t, v:{k:val}}], stepW},   // stacked areas (neg values stack below 0)
   bars: {color, negColor, pts:[{t,v}], w}                                // column bars
   x0, x1, xTicks:[t], xFmt, yFmt, yMin, yMax, height, shade:[[a,b]], nowT,
   snap:(t)=>t, step: (step to search back for data), tip:(t)=>{title, rows:[[color,name,val]]}, tipOffset
 })
*/
export function drawChart(box, o) {
  box.innerHTML = "";
  charts.add(box);
  const W = Math.max(280, box.clientWidth || 600), H = o.height || 260;
  const m = { l: o.ml || 40, r: 10, t: 10, b: 24 };
  const vals = [];
  (o.series || []).forEach(s => s.pts.forEach(p => ok(p.v) && vals.push(p.v)));
  if (o.band) o.band.pts.forEach(p => { if (ok(p.lo)) vals.push(p.lo); if (ok(p.hi)) vals.push(p.hi); });
  if (o.bars) o.bars.pts.forEach(p => ok(p.v) && vals.push(p.v));
  if (o.stack) o.stack.pts.forEach(p => { let pos = 0, neg = 0; o.stack.keys.forEach(k => { const v = p.v[k] || 0; if (v >= 0) pos += v; else neg += v; }); vals.push(pos, neg); });
  if (!vals.length) { box.innerHTML = `<div class="note empty">No data for this view yet.</div>`; return; }
  let lo = Math.min(o.yMin ?? 0, ...vals), hi = Math.max(...vals, o.yMax ?? -Infinity);
  const ticks = niceTicks(lo, hi, o.yTicks || 5); lo = ticks[0]; hi = ticks[ticks.length - 1];
  const x = t => m.l + (t - o.x0) / (o.x1 - o.x0) * (W - m.l - m.r);
  const y = v => m.t + (hi - v) / (hi - lo) * (H - m.t - m.b);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, role: "img" }, box);
  (o.shade || []).forEach(([a, b]) => {
    const xa = x(Math.max(a, o.x0)), xb = x(Math.min(b, o.x1));
    if (xb > xa) svgEl("rect", { x: xa, y: m.t, width: xb - xa, height: H - m.t - m.b, fill: css("--peak") }, svg);
  });
  const yFmt = o.yFmt || (v => Math.abs(v) < 1e-9 ? "0" : String(v));
  ticks.forEach(v => {
    svgEl("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: Math.abs(v) < 1e-9 ? css("--muted") : css("--grid") }, svg);
    svgEl("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end" }, svg).textContent = yFmt(v);
  });
  let lastX = -1e9;
  (o.xTicks || []).filter(t => t >= o.x0 && t <= o.x1).forEach(t => {
    const xx = x(t); if (xx - lastX < 44) return; lastX = xx;
    svgEl("line", { x1: xx, x2: xx, y1: H - m.b, y2: H - m.b + 4, stroke: css("--line") }, svg);
    svgEl("text", { x: xx, y: H - 7, "text-anchor": "middle" }, svg).textContent = o.xFmt(t);
  });
  if (o.stack && o.stack.pts.length) {
    const P = o.stack.pts, sw = o.stack.stepW;
    const base = P.map(() => ({ pos: 0, neg: 0 }));
    o.stack.keys.forEach(k => {
      const top = [], bot = [];
      P.forEach((p, i) => {
        const v = p.v[k] || 0; const b = base[i];
        if (v >= 0) { bot.push(b.pos); top.push(b.pos + v); b.pos += v; } else { top.push(b.neg); bot.push(b.neg + v); b.neg += v; }
      });
      if (top.every((t, i) => Math.abs(t - bot[i]) < 1e-9)) return;
      let d = "";
      P.forEach((p, i) => { const X0 = x(p.t), X1 = sw ? x(p.t + sw) : X0; d += `${i ? "L" : "M"}${X0},${y(top[i])}` + (sw ? `L${X1},${y(top[i])}` : ""); });
      for (let i = P.length - 1; i >= 0; i--) { const X0 = x(P[i].t), X1 = sw ? x(P[i].t + sw) : X0; d += (sw ? `L${X1},${y(bot[i])}` : "") + `L${X0},${y(bot[i])}`; }
      svgEl("path", { d: d + "Z", fill: o.stack.colors[k], "fill-opacity": 0.9, stroke: css("--panel"), "stroke-width": 0.5 }, svg);
    });
  }
  if (o.bars) {
    const bw = Math.max(1, x(o.x0 + o.bars.w) - x(o.x0) - 1);
    o.bars.pts.forEach(p => { if (!ok(p.v)) return; const y0 = y(0), y1 = y(p.v);
      svgEl("rect", { x: x(p.t), y: Math.min(y0, y1), width: bw, height: Math.max(1, Math.abs(y1 - y0)), rx: 1.5, fill: p.v < 0 && o.bars.negColor ? o.bars.negColor : o.bars.color }, svg); });
  }
  if (o.band && o.band.pts.length) {
    const bp = o.band.pts.filter(p => ok(p.lo) && ok(p.hi));
    if (bp.length) {
      let d = bp.map((p, i) => `${i ? "L" : "M"}${x(p.t)},${y(p.hi)}`).join("");
      d += bp.slice().reverse().map(p => `L${x(p.t)},${y(p.lo)}`).join("") + "Z";
      svgEl("path", { d, fill: o.band.color, "fill-opacity": o.band.opacity ?? 0.18, stroke: "none" }, svg);
    }
  }
  (o.series || []).forEach(s => {
    let d = "", pen = false;
    s.pts.forEach((p, i) => {
      if (!ok(p.v)) { pen = false; return; }
      const X = x(p.t), Y = y(p.v);
      if (!pen) { d += `M${X},${Y}`; pen = true; } else d += s.step ? `H${X}V${Y}` : `L${X},${Y}`;
      if (s.step) { const nx = s.pts[i + 1]; if (!(nx && ok(nx.v))) d += `H${x(p.t + (s.stepW || SLOT))}`; }
    });
    if (d) svgEl("path", { d, fill: "none", stroke: s.color, "stroke-width": s.width || 2, "stroke-linejoin": "round", "stroke-linecap": "round", "stroke-dasharray": s.dash ? "5 4" : "none", opacity: s.opacity ?? 1 }, svg);
  });
  if (o.nowT && o.nowT > o.x0 && o.nowT < o.x1) {
    svgEl("line", { x1: x(o.nowT), x2: x(o.nowT), y1: m.t, y2: H - m.b, stroke: css("--fg2"), "stroke-dasharray": "2 3" }, svg);
    svgEl("text", { x: x(o.nowT) + 4, y: m.t + 10 }, svg).textContent = "now";
  }
  if (!o.tip) return;
  // hover / touch scrub layer
  const cross = svgEl("line", { y1: m.t, y2: H - m.b, stroke: css("--fg2"), visibility: "hidden" }, svg);
  const tip = document.createElement("div"); tip.className = "tip"; box.appendChild(tip);
  const hit = svgEl("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent" }, svg);
  const hide = () => { tip.style.display = "none"; cross.setAttribute("visibility", "hidden"); };
  const move = ev => {
    const r = svg.getBoundingClientRect(); const sx = (ev.clientX - r.left) * (W / r.width);
    let t = o.snap(Math.max(o.x0, Math.min(o.x1 - 1, o.x0 + (sx - m.l) / (W - m.l - m.r) * (o.x1 - o.x0))));
    let info = o.tip(t);
    for (let k = 0; !info && o.step && k < 400 && t - o.step >= o.x0; k++) { t -= o.step; info = o.tip(t); }
    if (!info) { hide(); return; }
    const cx = x(t + (o.tipOffset || 0));
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
    tip.innerHTML = `<b>${info.title}</b>` + info.rows.map(([c, n, v]) =>
      `<div class="r"><span>${c ? `<i class="sw" style="background:${c}"></i>` : ""}${n}</span><span>${v}</span></div>`).join("");
    tip.style.display = "block";
    const px = cx * (r.width / W), bw = box.clientWidth, tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(bw - tw, px + 12 > bw - tw ? px - tw - 12 : px + 12)) + "px";
    tip.style.top = ev.pointerType && ev.pointerType !== "mouse" ? (-tip.offsetHeight - 6) + "px" : "8px";
  };
  hit.addEventListener("pointerdown", ev => { if (ev.pointerType !== "mouse") { try { hit.setPointerCapture(ev.pointerId); } catch (e) {} } move(ev); });
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerleave", ev => { if (ev.pointerType === "mouse") hide(); });
  hit.addEventListener("contextmenu", ev => ev.preventDefault());
  box._hideTip = hide;
}
export function nearestSnap(ts) { // snap to nearest of a sorted list of times
  return t => { let lo = 0, hi = ts.length - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ts[mid] <= t) lo = mid; else hi = mid; } return Math.abs(ts[lo] - t) <= Math.abs(ts[hi] - t) ? ts[lo] : ts[hi]; };
}
export function timeTicks(x0, x1) { // sensible ticks for a time span
  const span = x1 - x0, out = [];
  if (span <= 2.1 * DAY) { const step = span <= 1.1 * DAY ? 3 : 6; for (let t = floorSlot(x0); t <= x1; t += SLOT) { const h = londonHour(t); if (h % step === 0) out.push(t); } return { ticks: out, fmt: t => hm(t) === "00:00" ? dm(t) : hm(t) }; }
  if (span <= 15 * DAY) { for (let k = dayKey(x0); londonMidnight(k) <= x1; k = addDays(k, 1)) out.push(londonMidnight(k)); return { ticks: out, fmt: t => span <= 8 * DAY ? weekday(t) : dm(t) }; }
  if (span <= 120 * DAY) { for (let k = dayKey(x0); londonMidnight(k) <= x1; k = addDays(k, 7)) out.push(londonMidnight(k)); return { ticks: out, fmt: dm }; }
  for (let k = dayKey(x0).slice(0, 8) + "01"; londonMidnight(k) <= x1; ) { const t = londonMidnight(k); if (t >= x0) out.push(t); const [y, mo] = k.split("-").map(Number); k = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`; }
  return { ticks: out, fmt: monthYear };
}
