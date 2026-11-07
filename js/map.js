import { $, hm, settlementPeriod, SLOT, sum, f0, gw, ok, segmented, css, esc, svgEl, legendHTML } from "./core.js";
import { settings, setSetting, setStatus } from "./app.js";
import * as api from "./api.js";

let root, MD = null, live = null, seq = 0, sel = null;
const hidden = new Set(JSON.parse(localStorage.getItem("mapHidden") || '["idle"]'));
const FUELS = [
  { k: "wind", label: "Wind", col: "--f-wind" }, { k: "gas", label: "Gas", col: "--f-gas" }, { k: "nuclear", label: "Nuclear", col: "--f-nuclear" },
  { k: "biomass", label: "Biomass", col: "--f-biomass" }, { k: "hydro", label: "Hydro", col: "--f-hydro" }, { k: "pumped", label: "Pumped storage", col: "--f-hydro" },
  { k: "battery", label: "Battery", col: "--f-battery" }, { k: "coal", label: "Coal", col: "--f-coal" }, { k: "other", label: "Other", col: "--f-other" }
];
const FUEL_OF = { WIND: "wind", CCGT: "gas", OCGT: "gas", RECIPROCATING: "gas", NUCLEAR: "nuclear", BIOMASS: "biomass", NPSHYD: "hydro", PS: "pumped", BATTERY: "battery", COAL: "coal", OIL: "other", OTHER: "other" };
const fuelCol = k => css((FUELS.find(f => f.k === k) || FUELS[8]).col);

/* zones for the schematic */
const ZONES = [
  { k: "NS", name: "North Scotland", x: 330, y: 64, dem: 0.03, sol: 0.01 },
  { k: "SS", name: "South Scotland", x: 330, y: 190, dem: 0.07, sol: 0.02 },
  { k: "NE", name: "North England", x: 330, y: 322, dem: 0.22, sol: 0.15 },
  { k: "WAL", name: "Wales", x: 92, y: 456, dem: 0.05, sol: 0.07 },
  { k: "MID", name: "Midlands", x: 330, y: 456, dem: 0.20, sol: 0.20 },
  { k: "EAST", name: "East Anglia", x: 568, y: 456, dem: 0.07, sol: 0.15 },
  { k: "SOU", name: "South & London", x: 330, y: 604, dem: 0.36, sol: 0.40 }
];
const EDGES = [["NS", "SS", "B4"], ["SS", "NE", "B6"], ["NE", "MID", "B8"], ["WAL", "MID", ""], ["MID", "SOU", "B9"], ["EAST", "SOU", ""]]; // child -> parent (tree rooted at SOU)
const LAYOUTS = {
  wide: { W: 660, H: 760, bw: { NS: 160, SS: 160, NE: 160, WAL: 150, MID: 160, EAST: 150, SOU: 160 }, BH: 96, hLblBelow: false,
    pos: { NS: [330, 62], SS: [330, 190], NE: [330, 322], WAL: [88, 460], MID: [330, 460], EAST: [572, 460], SOU: [330, 606] },
    pill: { "N. Ireland": [80, 190], Ireland: [70, 372], Norway: [575, 250], Denmark: [585, 362], Netherlands: [580, 560], Belgium: [580, 610], France: [330, 722] } },
  narrow: { W: 390, H: 800, bw: { NS: 150, SS: 150, NE: 150, WAL: 118, MID: 118, EAST: 118, SOU: 150 }, BH: 96, hLblBelow: true,
    pos: { NS: [195, 58], SS: [195, 188], NE: [195, 318], WAL: [62, 472], MID: [195, 472], EAST: [328, 472], SOU: [195, 646] },
    pill: { "N. Ireland": [52, 128], Ireland: [52, 398], Norway: [335, 252], Denmark: [335, 398], Netherlands: [332, 606], Belgium: [332, 654], France: [195, 774] } }
};
export function zoneOf(lat, lon) {
  const scot = lon <= -3.1 ? lat > 54.95 : lat > 54.95 + (lon + 3.1) * 0.727;
  if (scot) return lat >= 56.4 ? "NS" : "SS";
  if (lon < -2.7 && lat > 51.35 && lat < 53.45) return "WAL";
  if (lat >= 53.5 || (lat >= 53.3 && lon < -1.8)) return "NE";
  if (lon > 0.3 && lat >= 51.75) return "EAST";
  if (lat >= 52.0) return "MID";
  return "SOU";
}

export function init(el) {
  root = el;
  root.innerHTML = `
  <div class="row"><div class="sub" style="margin:0">Where Britain's power is coming from right now. Tap a dot for details.</div>
    <span class="seg" id="m-view"><button data-v="geo">Map</button><button data-v="sch">Schematic</button></span></div>
  <div class="card" id="m-geocard">
    <div class="geolayout"><div class="mapwrap" id="m-map"><div class="mapctl"><button id="m-zin" aria-label="Zoom in">+</button><button id="m-zout" aria-label="Zoom out">−</button><button id="m-zreset" aria-label="Reset" style="font-size:13px">⤢</button></div><div class="maptip" id="m-tip"></div></div>
    <div><div class="chips" id="m-chips"></div>
    <div id="m-info"></div>
    <div class="note">Dot size = output now (declared physical notifications from Elexon, interpolated to this minute). Dashed rings = consuming (pumping or charging). Pink lines = interconnectors, animated in the direction of flow. Pinch or use +/− to zoom; drag to pan when zoomed.</div>
    <details><summary>Not on the map</summary><div id="m-unmapped"></div></details></div></div>
  </div>
  <div class="card" id="m-schcard" style="display:none">
    <h2>Power flows between regions</h2>
    <div class="sub">Estimated: each region's generation minus an estimate of its demand. The arrows show where the surplus has to travel.</div>
    <div class="mapwrap" id="m-sch"></div>
    <div class="legend" id="m-schlegend" style="margin-top:8px"></div>
    <div class="note" style="display:none"></div>
    <div class="note">GB doesn't publish live flows across its internal boundaries. These are worked out from declared station output (plus PV_Live solar, shared out by region) and fixed regional shares of demand. Treat them as direction and rough size, not metered values. Labels B4, B6 etc. are the National Grid boundary names where these zones meet.</div>
  </div>
  <div class="tiles" id="m-tiles"></div>`;
  segmented($("#m-view", root), settings.mapView, v => { setSetting("mapView", v); layout(); });
  layout(); load();
}
function layout() { const g = settings.mapView !== "sch"; $("#m-geocard", root).style.display = g ? "" : "none"; $("#m-schcard", root).style.display = g ? "none" : ""; redraw(); }
export function show() { redraw(); }
export async function refresh() { await load(); }
export function tick(active) { if (active && live && Date.now() - live.at > 4 * 60e3) load(); }
export function redraw() { if (!live) return; renderTiles(); if (settings.mapView === "sch") renderSch(); else { renderMap(); renderChips(); renderInfo(); } }

async function load() {
  const my = ++seq;
  setStatus("map", "Loading live station output…");
  if (!MD) MD = await (await fetch("data/mapdata.json")).json().then(buildIndex);
  const now = Date.now(), { date, sp } = settlementPeriod(now);
  const [pn, ref, fi, so] = await Promise.allSettled([api.pnAll(date, sp), api.bmUnits(), api.fuelinstLatest(), api.solar(now - 3 * 3600e3, now)]);
  if (my !== seq) return;
  const errs = [];
  if (pn.status !== "fulfilled") { errs.push("station output: " + pn.reason?.message); }
  const refMap = new Map(); if (ref.status === "fulfilled") ref.value.forEach(u => { if (u.elexonBmUnit) refMap.set(u.elexonBmUnit, u); if (u.nationalGridBmUnit) refMap.set(u.nationalGridBmUnit, u); });
  const L = { at: now, units: [], st: MD.stations.map(s => ({ ...s, mw: 0, units: [], fuelLive: null })), unmapped: [], fi: fi.status === "fulfilled" ? fi.value : null, solar: 0 };
  if (so.status === "fulfilled") { let k = 0; so.value.forEach((v, t) => { if (t <= now && t > k) { k = t; L.solar = v; } }); }
  if (pn.status === "fulfilled") {
    const byUnit = new Map();
    pn.value.forEach(r => { const id = r.bmUnit || ""; if (!/^[TE]_/.test(id)) return; (byUnit.get(id) || byUnit.set(id, []).get(id)).push(r); });
    byUnit.forEach((rs, id) => {
      const mw = levelAt(rs, now); if (!ok(mw)) return;
      const ngc = rs[0].nationalGridBmUnit || id.slice(2);
      const info = refMap.get(id) || refMap.get(ngc) || {};
      const fuel = FUEL_OF[String(info.fuelType || "").toUpperCase()] || null;
      const si = matchStation(ngc);
      const u = { id, ngc, mw, fuel, party: info.leadPartyName || "", name: info.bmUnitName || "" };
      if (si != null) { const s = L.st[si]; s.mw += mw; s.units.push(u); if (!s.f && fuel) s.f = fuel; }
      else if (Math.abs(mw) >= 1) L.unmapped.push(u);
    });
    L.st.forEach(s => { s.f = s.f || s.units.find(u => u.fuel)?.fuel || "other"; });
    L.unmapped.sort((a, b) => Math.abs(b.mw) - Math.abs(a.mw));
  }
  L.errors = errs; live = L;
  setStatus("map", (pn.status === "fulfilled" ? `Station output for ${hm(now)} (settlement period ${sp})` : "") + (errs.length ? ` · <span class="err">Couldn't load ${esc(errs.join("; "))}</span>` : ""));
  redraw();
}
function levelAt(rs, t) {
  let best = null;
  for (const r of rs) {
    const a = Date.parse(r.timeFrom), b = Date.parse(r.timeTo), la = Number(r.levelFrom), lb = Number(r.levelTo);
    if (t >= a && t <= b) return b > a ? la + (lb - la) * (t - a) / (b - a) : lb;
    if (a <= t && (!best || a > best.a)) best = { a, v: lb };
  }
  return best ? best.v : (rs.length ? Number(rs[rs.length - 1].levelTo) : null);
}
function buildIndex(md) {
  md.exact = new Map(); md.prefix = new Map();
  md.stations.forEach((s, i) => {
    s.b.forEach(b => md.exact.set(b, i));
    s.p.forEach(p => { if (p.length >= 4 && !md.prefix.has(p)) md.prefix.set(p, i); });
    s.z = zoneOf(s.lat, s.lon);
  });
  md.interconnectors.forEach(ic => { ic.zone = zoneOf(...invProjGuess(md, ic.gb)); });
  return md;
}
// station dots carry lat/lon; for interconnector landing points use the nearest station's lat/lon as a stand-in
function invProjGuess(md, [x, y]) { let best = null, bd = 1e9; md.stations.forEach(s => { const d = (s.x - x) ** 2 + (s.y - y) ** 2; if (d < bd) { bd = d; best = s; } }); return [best.lat, best.lon]; }
function matchStation(ngc) {
  if (MD.exact.has(ngc)) return MD.exact.get(ngc);
  const cands = [ngc.replace(/-\d+$/, ""), ngc.replace(/-?[A-Z]?\d+[A-Z]?$/, ""), ngc.replace(/-\d+$/, "").replace(/\d+$/, "")];
  for (const c of cands) if (c.length >= 4 && MD.prefix.has(c)) return MD.prefix.get(c);
  return null;
}

/* ---------------- tiles ---------------- */
function totals() {
  const byFuel = {}; let pos = 0, neg = 0;
  live.st.forEach(s => { if (s.mw > 0) { byFuel[s.f] = (byFuel[s.f] || 0) + s.mw; pos += s.mw; } else neg += s.mw; });
  let un = 0; live.unmapped.forEach(u => { if (u.mw > 0) un += u.mw; else neg += u.mw; });
  return { byFuel, mapped: pos, unmapped: un, consuming: neg };
}
function icFlows() {
  const F = live.fi?.fuels || {}; return MD.interconnectors.map(ic => ({ ...ic, mw: F[ic.code] ?? null }));
}
function renderTiles() {
  const T = totals(), ics = icFlows().filter(i => ok(i.mw)), imp = sum(ics.map(i => i.mw));
  const all = T.mapped + T.unmapped;
  $("#m-tiles", root).innerHTML =
    `<div class="tile"><div class="k">On the map</div><div class="v">${gw(T.mapped)} <small>GW</small></div><div class="n">${all ? (T.mapped / all * 100).toFixed(0) : "—"}% of declared output · ${live.st.filter(s => s.mw > 1).length} sites</div></div>` +
    `<div class="tile"><div class="k">Not located</div><div class="v">${gw(T.unmapped)} <small>GW</small></div><div class="n">${live.unmapped.filter(u => u.mw > 0).length} units, mostly newer sites</div></div>` +
    `<div class="tile"><div class="k">Solar (embedded)</div><div class="v">${gw(live.solar)} <small>GW</small></div><div class="n">PV_Live estimate, not shown as dots</div></div>` +
    `<div class="tile"><div class="k">Interconnectors</div><div class="v">${imp >= 0 ? "+" : ""}${gw(imp)} <small>GW</small></div><div class="n">${imp >= 0 ? "net import" : "net export"}</div></div>` +
    `<div class="tile"><div class="k">Consuming</div><div class="v">${gw(-T.consuming)} <small>GW</small></div><div class="n">pumping and battery charging</div></div>`;
}

/* ---------------- geographic map ---------------- */
let vb = null, svg = null;
function renderMap() {
  const box = $("#m-map", root); box.querySelector("svg")?.remove();
  const W = MD.W, H = MD.H; vb = vb || { x: 0, y: 0, w: W, h: H };
  svg = svgEl("svg", { viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`, role: "img", "aria-label": "Map of GB generation" });
  box.prepend(svg);
  for (const [k, d] of Object.entries(MD.land)) if (d) svgEl("path", { d, class: "land" + (k === "UK" ? "" : " other") }, svg);
  // interconnectors
  const ics = icFlows(); const icG = svgEl("g", {}, svg);
  ics.forEach(ic => {
    if (!ok(ic.mw)) return;
    const w = 1.2 + Math.min(7, Math.abs(ic.mw) / 300);
    svgEl("path", { d: `M${ic.far[0]},${ic.far[1]}L${ic.gb[0]},${ic.gb[1]}`, class: "ic", "stroke-width": w, opacity: 0.35 }, icG);
    if (Math.abs(ic.mw) > 20) svgEl("path", { d: `M${ic.far[0]},${ic.far[1]}L${ic.gb[0]},${ic.gb[1]}`, class: "ic flow" + (ic.mw < 0 ? " rev" : ""), "stroke-width": w }, icG);
  });
  const k = vb.w / Math.max(200, box.clientWidth || 600);
  const byC = {}; ics.forEach(ic => { if (!ok(ic.mw)) return; const c = byC[ic.country] ||= { mw: 0, x: 0, y: 0, n: 0 };
    c.mw += ic.mw; c.x += ic.gb[0] + 0.78 * (ic.far[0] - ic.gb[0]); c.y += ic.gb[1] + 0.78 * (ic.far[1] - ic.gb[1]); c.n++; });
  Object.entries(byC).forEach(([c, v]) => {
    const label = `${c} ${v.mw >= 0 ? "+" : "−"}${(Math.abs(v.mw) / 1000).toFixed(1)} GW`, wU = label.length * 6.6 * k;
    let x = v.x / v.n, y = v.y / v.n - 7 * k, anchor = "start";
    if (x + wU > MD.W - 4) { anchor = "end"; x = Math.min(x, MD.W - 4); }
    if (anchor === "end" && x - wU < 4) x = wU + 4;
    if (y < 60 * k && x > MD.W - 60 * k - wU) y = 60 * k; // keep clear of the zoom buttons
    svgEl("text", { x, y, class: "iclbl", "text-anchor": anchor, style: `font-size:${12 * k}px;stroke-width:${3 * k}px` }, svg).textContent = label;
  });
  // dots, biggest first so small ones sit on top
  const dots = svgEl("g", {}, svg);
  const list = live.st.map((s, i) => ({ s, i })).filter(({ s, i }) => !hidden.has(s.f) && (!hidden.has("idle") || Math.abs(s.mw) >= 1 || sel === i)).sort((a, b) => Math.abs(b.s.mw) - Math.abs(a.s.mw));
  list.forEach(({ s, i }) => {
    const mag = Math.abs(s.mw), idle = mag < 1;
    const r = idle ? 1.6 : 1.8 + Math.sqrt(mag) * 0.3;
    const c = svgEl("circle", { cx: s.x, cy: s.y, r, class: "dot" + (idle ? " idle" : "") + (s.mw < -1 ? " neg" : "") + (sel === i ? " sel" : ""), fill: fuelCol(s.f), "fill-opacity": 0.82, "data-i": i }, dots);
    if (s.mw < -1) c.setAttribute("stroke", fuelCol(s.f));
  });
  wireMap(box);
}
function setVB() { svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`); $("#m-map", root).classList.toggle("zoomed", vb.w < MD.W - 1); }
function zoom(f, cx, cy) {
  const W = MD.W, H = MD.H, nw = Math.max(W / 8, Math.min(W, vb.w / f)), nh = nw * H / W;
  cx ??= vb.x + vb.w / 2; cy ??= vb.y + vb.h / 2;
  vb = { x: cx - (cx - vb.x) * nw / vb.w, y: cy - (cy - vb.y) * nh / vb.h, w: nw, h: nh }; clampVB(); setVB();
}
function clampVB() { vb.x = Math.max(0, Math.min(MD.W - vb.w, vb.x)); vb.y = Math.max(0, Math.min(MD.H - vb.h, vb.y)); }
function toSvg(ev) { const r = svg.getBoundingClientRect(); return [vb.x + (ev.clientX - r.left) / r.width * vb.w, vb.y + (ev.clientY - r.top) / r.height * vb.h, vb.w / r.width]; }
function nearestDot(px, py, perPx) {
  let best = null, bd = Infinity;
  live.st.forEach((s, i) => { if (hidden.has(s.f) || (hidden.has("idle") && Math.abs(s.mw) < 1)) return; const r = Math.abs(s.mw) < 1 ? 1.6 : 1.8 + Math.sqrt(Math.abs(s.mw)) * 0.3; const d = Math.hypot(s.x - px, s.y - py) - r; if (d < bd) { bd = d; best = i; } });
  return bd <= 14 * perPx ? best : null;
}
function wireMap(box) {
  $("#m-zin", root).onclick = () => zoom(1.6); $("#m-zout", root).onclick = () => zoom(1 / 1.6); $("#m-zreset", root).onclick = () => { vb = { x: 0, y: 0, w: MD.W, h: MD.H }; setVB(); };
  setVB();
  const ptrs = new Map(); let start = null, moved = false, pinch = null;
  svg.addEventListener("pointerdown", ev => {
    ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); moved = false;
    if (ptrs.size === 1) start = { x: ev.clientX, y: ev.clientY, vb: { ...vb } };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), w: vb.w }; }
    if (vb.w < MD.W - 1 || ptrs.size === 2) { try { svg.setPointerCapture(ev.pointerId); } catch (e) {} }
  });
  svg.addEventListener("pointermove", ev => {
    if (ev.pointerType === "mouse" && !ptrs.size) { hoverTip(ev); return; }
    if (!ptrs.has(ev.pointerId)) return;
    ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y); moved = true;
      const r = svg.getBoundingClientRect(), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const cx = vb.x + (mx - r.left) / r.width * vb.w, cy = vb.y + (my - r.top) / r.height * vb.h;
      zoom(vb.w / Math.max(MD.W / 8, Math.min(MD.W, pinch.w * pinch.d / d)), cx, cy); ev.preventDefault();
    } else if (ptrs.size === 1 && start && vb.w < MD.W - 1) {
      const r = svg.getBoundingClientRect(), dx = (ev.clientX - start.x) / r.width * vb.w, dy = (ev.clientY - start.y) / r.height * vb.h;
      if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 4) moved = true;
      vb.x = start.vb.x - dx; vb.y = start.vb.y - dy; clampVB(); setVB();
    } else if (Math.abs(ev.clientX - (start?.x ?? ev.clientX)) + Math.abs(ev.clientY - (start?.y ?? ev.clientY)) > 6) moved = true;
  });
  const up = ev => {
    const wasTap = ptrs.size === 1 && !moved; ptrs.delete(ev.pointerId); if (ptrs.size < 2) pinch = null;
    if (wasTap && ev.type === "pointerup") { const [x, y, pp] = toSvg(ev); const i = nearestDot(x, y, pp); sel = i; renderMap(); renderInfo(); }
  };
  svg.addEventListener("pointerup", up); svg.addEventListener("pointercancel", up);
  svg.addEventListener("pointerleave", ev => { if (ev.pointerType === "mouse") $("#m-tip", root).style.display = "none"; });
  svg.addEventListener("wheel", ev => { if (!ev.ctrlKey && !ev.metaKey && vb.w >= MD.W - 1 && ev.deltaY > 0) return; ev.preventDefault(); const [x, y] = toSvg(ev); zoom(ev.deltaY < 0 ? 1.25 : 0.8, x, y); }, { passive: false });
  svg.addEventListener("contextmenu", ev => ev.preventDefault());
}
function hoverTip(ev) {
  const [x, y, pp] = toSvg(ev), i = nearestDot(x, y, pp), tip = $("#m-tip", root);
  if (i == null) { tip.style.display = "none"; return; }
  const s = live.st[i], r = $("#m-map", root).getBoundingClientRect();
  tip.innerHTML = `<b>${esc(s.n)}</b> · ${f0(s.mw)} MW`; tip.style.display = "block";
  tip.style.left = Math.min(r.width - tip.offsetWidth - 4, ev.clientX - r.left + 12) + "px"; tip.style.top = (ev.clientY - r.top + 12) + "px";
}
function renderChips() {
  const T = totals();
  $("#m-chips", root).innerHTML = FUELS.filter(f => live.st.some(s => s.f === f.k)).map(f =>
    `<span class="chip${hidden.has(f.k) ? " off" : ""}" data-k="${f.k}"><i class="sw" style="background:${css(f.col)}"></i>${f.label} <b>${gw(T.byFuel[f.k] || 0)}</b></span>`).join("") +
    `<span class="chip${hidden.has("idle") ? " off" : ""}" data-k="idle"><i class="sw" style="border:1px solid var(--muted)"></i>Idle sites <b>${live.st.filter(s => Math.abs(s.mw) < 1).length}</b></span>`;
  $("#m-chips", root).querySelectorAll(".chip").forEach(c => c.onclick = () => {
    const k = c.dataset.k; hidden.has(k) ? hidden.delete(k) : hidden.add(k);
    try { localStorage.setItem("mapHidden", JSON.stringify([...hidden])); } catch (e) {}
    renderMap(); renderChips();
  });
  const un = live.unmapped;
  $("#m-unmapped", root).innerHTML = un.length ? `<div class="note">Units with output that aren't in the location list yet (largest first). Their power is real, just not drawn.</div><div class="tablewrap"><table><thead><tr><th>Unit</th><th>Fuel</th><th>Company</th><th>MW</th></tr></thead><tbody>` +
    un.slice(0, 80).map(u => `<tr><td>${esc(u.ngc)}</td><td>${esc(u.fuel || "?")}</td><td>${esc(u.party).slice(0, 28)}</td><td>${f0(u.mw)}</td></tr>`).join("") + `</tbody></table></div>` : `<div class="note">Everything with output is on the map.</div>`;
}
function renderInfo() {
  const el = $("#m-info", root);
  if (sel == null || !live.st[sel]) { el.innerHTML = `<div class="note">Tap a dot to see the station and its units.</div>`; return; }
  const s = live.st[sel], F = FUELS.find(f => f.k === s.f) || FUELS[8];
  el.innerHTML = `<div class="infocard"><div class="t"><i class="sw" style="background:${css(F.col)}"></i> ${esc(s.n)}</div>
    <div class="d sub" style="margin:2px 0 6px">${F.label} · ${s.lat.toFixed(2)}, ${s.lon.toFixed(2)} · ${ZONES.find(z => z.k === s.z)?.name}</div>
    <div style="font-size:22px;font-weight:600">${f0(s.mw)} <small style="font-size:13px;color:var(--fg2)">MW now</small></div>
    ${s.units.length ? `<table style="margin-top:6px"><thead><tr><th>Unit</th><th>MW</th></tr></thead><tbody>${s.units.sort((a, b) => b.mw - a.mw).map(u => `<tr><td>${esc(u.ngc)}</td><td>${f0(u.mw)}</td></tr>`).join("")}</tbody></table>` : `<div class="note">No units reporting this half-hour.</div>`}</div>`;
}

/* ---------------- schematic ---------------- */
function zoneBalance() {
  const Z = Object.fromEntries(ZONES.map(z => [z.k, { gen: 0, cons: 0, ic: 0, byFuel: {}, solar: 0 }]));
  live.st.forEach(s => { const z = Z[s.z]; if (s.mw > 0) { z.gen += s.mw; z.byFuel[s.f] = (z.byFuel[s.f] || 0) + s.mw; } else z.cons += s.mw; });
  // unmapped output: share out by where mapped plants of the same fuel are
  live.unmapped.forEach(u => {
    if (u.mw <= 0) { Z.MID.cons += u.mw; return; }
    const f = u.fuel || "other", tot = sum(ZONES.map(z => Z[z.k].byFuel[f] || 0));
    ZONES.forEach(z => { const w = tot ? (Z[z.k].byFuel[f] || 0) / tot : z.dem; Z[z.k].gen += u.mw * w; Z[z.k].byFuel[f] = (Z[z.k].byFuel[f] || 0) + u.mw * w; });
  });
  ZONES.forEach(z => { const s = live.solar * z.sol; Z[z.k].solar = s; Z[z.k].gen += s; Z[z.k].byFuel.solar = s; });
  icFlows().forEach(ic => { if (ok(ic.mw)) Z[ic.zone].ic += ic.mw; });
  const total = sum(ZONES.map(z => Z[z.k].gen + Z[z.k].cons + Z[z.k].ic));
  ZONES.forEach(z => { const o = Z[z.k]; o.dem = total * z.dem; o.net = o.gen + o.cons + o.ic - o.dem; });
  // tree flows: subtree sums toward the root (SOU)
  const children = {}; EDGES.forEach(([c, p]) => (children[p] ||= []).push(c));
  const sub = k => Z[k].net + (children[k] || []).reduce((s, c) => s + sub(c), 0);
  const flows = EDGES.map(([c, p, b]) => ({ c, p, b, mw: sub(c) }));
  return { Z, flows, total };
}
function renderSch() {
  const box = $("#m-sch", root); box.innerHTML = "";
  const { Z, flows } = zoneBalance();
  const Lw = (box.clientWidth || 660) < 560 ? LAYOUTS.narrow : LAYOUTS.wide, W = Lw.W, H = Lw.H, BH = Lw.BH;
  const s = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Schematic of GB power flows" }, box);
  const pos = Object.fromEntries(ZONES.map(z => [z.k, { x: Lw.pos[z.k][0], y: Lw.pos[z.k][1], bw: Lw.bw[z.k] }]));
  const PILL = Lw.pill;
  // interconnector links to country pills
  const byC = {}; icFlows().forEach(ic => { if (!ok(ic.mw)) return; const k = ic.country + "|" + ic.zone; (byC[k] ||= { c: ic.country, z: ic.zone, mw: 0 }).mw += ic.mw; });
  Object.values(byC).forEach(({ c, z, mw }) => {
    const [px, py] = PILL[c] || [W - 40, H / 2], zz = pos[z], w = 1.5 + Math.min(9, Math.abs(mw) / 250);
    const d = `M${px},${py}L${zz.x},${zz.y}`;
    svgEl("path", { d, class: "ic", "stroke-width": w, opacity: 0.3 }, s);
    if (Math.abs(mw) > 20) svgEl("path", { d, class: "ic flow" + (mw < 0 ? " rev" : ""), "stroke-width": w }, s);
  });
  // internal edges
  const lbls = [];
  flows.forEach(f => {
    const a = pos[f.c], b = pos[f.p], w = 2 + Math.min(14, Math.abs(f.mw) / 400);
    const [from, to] = f.mw >= 0 ? [a, b] : [b, a];
    svgEl("path", { d: `M${a.x},${a.y}L${b.x},${b.y}`, class: "edge", "stroke-width": w }, s);
    if (Math.abs(f.mw) > 50) svgEl("path", { d: `M${from.x},${from.y}L${to.x},${to.y}`, class: "edge flow", "stroke-width": w, style: "stroke-dasharray:6 8;animation:flow 1.2s linear infinite" }, s);
    const horiz = Math.abs(a.y - b.y) < 10, diag = !horiz && Math.abs(a.x - b.x) > 10;
    const arrow = horiz ? (to.x > from.x ? "→" : "←") : (to.y > from.y ? "↓" : "↑");
    let lx = (a.x + b.x) / 2, ly = (a.y + b.y) / 2, anchor = "middle";
    if (horiz) { if (Lw.hLblBelow) ly = a.y + BH / 2 + 16; else ly -= 10; }
    else if (diag) { lx += 8; anchor = "start"; } else { lx += 12; ly += 4; anchor = "start"; }
    lbls.push([lx, ly, anchor, `${arrow} ${gw(Math.abs(f.mw))} GW${f.b && !Lw.hLblBelow ? "  " + f.b : f.b ? " " + f.b : ""}`]);
  });
  // country pills
  const pillTotals = {}; Object.values(byC).forEach(v => pillTotals[v.c] = (pillTotals[v.c] || 0) + v.mw);
  Object.entries(pillTotals).forEach(([c, mw]) => {
    const [px, py] = PILL[c] || [W - 40, H / 2], g = svgEl("g", { class: "cpill" }, s), label = `${c} ${mw >= 0 ? "+" : ""}${gw(mw)}`;
    const w = 12 + label.length * 6.2;
    svgEl("rect", { x: px - w / 2, y: py - 11, width: w, height: 22, rx: 11 }, g);
    svgEl("text", { x: px, y: py + 4, "text-anchor": "middle" }, g).textContent = label;
  });
  // zones
  const fuelOrder = ["nuclear", "biomass", "gas", "coal", "other", "hydro", "pumped", "battery", "wind", "solar"];
  ZONES.forEach(z => {
    const o = Z[z.k], P = pos[z.k], BW = P.bw, g = svgEl("g", { class: "zone" }, s), x = P.x - BW / 2, y = P.y - BH / 2;
    svgEl("rect", { x, y, width: BW, height: BH, rx: 12, class: "box" }, g);
    svgEl("text", { x: x + 9, y: y + 18, class: "zn" }, g).textContent = BW < 130 ? z.name.replace(" & London", "") : z.name;
    svgEl("text", { x: x + 9, y: y + 35, class: "zv" }, g).textContent = `Gen ${gw(o.gen)} GW`;
    svgEl("text", { x: x + 9, y: y + 50, class: "zv" }, g).textContent = `Use ${gw(o.dem - o.cons)} GW`;
    svgEl("text", { x: x + 9, y: y + 66, class: "zs" }, g).textContent = o.net >= 0 ? `+${gw(o.net)} surplus` : `−${gw(-o.net)} short`;
    let bx = x + 9; const bw = BW - 18, tot = o.gen || 1;
    fuelOrder.forEach(f => { const v = o.byFuel[f] || 0; if (v <= 0) return; const w = v / tot * bw;
      svgEl("rect", { x: bx, y: y + 75, width: Math.max(0.5, w - 1), height: 11, rx: 2, fill: f === "solar" ? css("--f-solar") : fuelCol(f) }, g); bx += w; });
  });
  lbls.forEach(([x, y, a, t]) => { svgEl("text", { x, y, class: "elbl", "text-anchor": a }, s).textContent = t; });
  $("#m-schlegend", root).innerHTML = legendHTML([...FUELS.filter(f => ["wind", "gas", "nuclear", "biomass", "hydro", "battery", "other"].includes(f.k)).map(f => ({ label: f.label, color: css(f.col), box: true })), { label: "Solar", color: css("--f-solar"), box: true }, { label: "Interconnector", color: css("--f-imports") }, { label: "Internal flow (est.)", color: css("--fg2") }]);
}
