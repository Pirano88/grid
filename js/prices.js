import { $, dayKey, addDays, londonMidnight, hm, dayShort, dm, londonHour, isPeak, floorSlot, slotsBetween, SLOT, DAY,
  mean, f2, f0, ok, tile, legendHTML, segmented, drawChart, nearestSnap, timeTicks, css, isoWeekdayIdx } from "./core.js";
import { settings, setSetting, onSetting, setStatus, regionInfo } from "./app.js";
import { loadPrices, flexAt, invalidatePrices } from "./store.js";
import { tariffCode } from "./api.js";

let root, S = null, seq = 0;
const COL = { agile: "--s1", out: "--s2", flex: "--s3", mkt: "--s4", ci: "--f-biomass" };
const imp = v => v == null ? null : (settings.vat === "inc" ? v.inc : v.exc);
const vatL = () => settings.vat === "inc" ? "inc VAT" : "ex VAT";

export function init(el) {
  root = el;
  root.innerHTML = `
  <div class="row" style="margin-bottom:10px">
    <div class="sub" style="margin:0">Octopus Agile, Agile Outgoing and Flexible, set against the wholesale market.</div>
    <div class="row" style="margin:0;gap:10px">
      <label class="inline">History <select id="p-range"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">365 days</option></select></label>
      <span class="seg" id="p-vat"><button data-v="inc">inc VAT</button><button data-v="exc">ex VAT</button></span>
    </div>
  </div>
  <div class="tiles" id="p-now"></div>
  <div class="card">
    <div class="row"><div><h2>Today and tomorrow</h2><div class="sub" style="margin:0" id="p-ttsub"></div></div>
      <span class="seg" id="p-tt"><button data-v="today">Today</button><button data-v="both">Both</button><button data-v="tomorrow">Tomorrow</button></span></div>
    <div class="legend" id="p-ttlegend"></div>
    <div class="chart" id="p-ttchart"></div>
    <h3>Carbon intensity forecast, ${'<span id="p-ciregion"></span>'}</h3>
    <div class="chart" id="p-cichart"></div>
    <div class="note">Tomorrow's Agile prices usually appear around 16:00. Wholesale = Elexon market index (APX), ex VAT, up to the latest settled half-hour. Carbon = Carbon Intensity API regional forecast, g CO₂/kWh.</div>
  </div>
  <div class="grid2">
    <div class="card">
      <h2>Best time to run things</h2>
      <div class="sub">Continuous block from now to the last published price. Slide to trade price against carbon.</div>
      <div class="row" style="justify-content:flex-start;gap:14px">
        <label class="inline">Duration <select id="p-dur"><option value="1">30 min</option><option value="2">1 h</option><option value="3">1.5 h</option><option value="4">2 h</option><option value="6">3 h</option><option value="8">4 h</option><option value="10">5 h</option><option value="12">6 h</option></select></label>
        <label class="inline">Cheapest <input type="range" id="p-weight" min="0" max="100" step="10"> Greenest</label>
      </div>
      <div id="p-winimp"></div>
    </div>
    <div class="card">
      <h2>Best time to export</h2>
      <div class="sub">Highest-paying Agile Outgoing block of the same length (battery discharge, etc.).</div>
      <div id="p-winexp"></div>
    </div>
  </div>
  <div class="card">
    <h2>Spread: Octopus vs the wholesale market</h2>
    <div class="sub" id="p-spsub"></div>
    <div class="tiles" id="p-sptiles"></div>
    <div class="legend" id="p-splegend"></div>
    <div class="chart" id="p-spchart"></div>
    <div class="note">Agile is priced off the N2EX day-ahead auction; the Elexon market index is a close, free proxy. Simple per-slot means, not weighted by your usage.</div>
  </div>
  <div class="card">
    <h2>Agile vs Flexible</h2>
    <div class="sub" id="p-flexsub"></div>
    <div class="tiles" id="p-flextiles"></div>
    <div class="note">"Flat usage" assumes the same use every half-hour. Shifting load into cheap slots beats this; heavy 16:00–19:00 use does worse.</div>
  </div>
  <div class="card">
    <h2>Agile price history</h2>
    <div class="sub" id="p-hsub"></div>
    <div class="legend" id="p-hlegend"></div>
    <div class="chart" id="p-hchart"></div>
    <details><summary>Daily table</summary><div class="tablewrap"><table id="p-daytable"></table></div></details>
    <details><summary>Weekly summary</summary><div class="tablewrap"><table id="p-weektable"></table></div></details>
    <div class="note" id="p-tariffs"></div>
  </div>`;
  $("#p-range", root).value = String(settings.range);
  $("#p-dur", root).value = String(settings.dur);
  $("#p-weight", root).value = String(settings.weight);
  $("#p-range", root).onchange = e => { setSetting("range", +e.target.value); load(); };
  $("#p-dur", root).onchange = e => { setSetting("dur", +e.target.value); renderWindows(); };
  $("#p-weight", root).oninput = e => { setSetting("weight", +e.target.value); renderWindows(); };
  segmented($("#p-vat", root), settings.vat, v => { setSetting("vat", v); redraw(); });
  segmented($("#p-tt", root), settings.ttView, v => { setSetting("ttView", v); renderTT(); });
  onSetting(k => { if (k === "region") { invalidatePrices(); if (root.classList.contains("on")) load(); else S = null; } });
  load();
}
export function show() { if (!S || S.region !== settings.region) load(); else redraw(); }
export async function refresh() { invalidatePrices(); await load(true); }
export function tick(active) {
  if (!S) return;
  if (Date.now() - S.loadedAt > 30 * 60e3) { if (active) load(true); }
  else if (active) { renderNow(); renderTT(); renderWindows(); }
}
export function redraw() { if (S) render(); }

async function load(force) {
  const my = ++seq;
  setStatus("prices", "Loading prices…");
  S = await loadPrices(settings.range, settings.region, force);
  if (my !== seq) return;
  const errs = Object.keys(S.errors);
  const names = { agile: "Agile", out: "Outgoing", flex: "Flexible", mkt: "wholesale", sA: "standing charge", sF: "Flexible standing charge", ci: "carbon forecast" };
  setStatus("prices", `Updated ${hm(S.loadedAt)} · ${regionInfo()[1]} (region ${S.region})` +
    (errs.length ? ` · <span class="err" title="${errs.map(k => k + ": " + S.errors[k]).join("\n")}">Couldn't load: ${errs.map(k => names[k]).join(", ")}</span>` : ""));
  render();
}
function render() { renderNow(); renderTT(); renderWindows(); renderSpread(); renderFlex(); renderHistory(); }

function renderNow() {
  const t = floorSlot(Date.now()), nx = t + SLOT;
  const a = S.agile.get(t), an = S.agile.get(nx), o = S.out.get(t), f = flexAt(S, t), ci = S.ci.get(t);
  let mt = null; for (const k of S.mkt.keys()) if (k <= t && (mt == null || k > mt)) mt = k;
  const mv = mt != null ? S.mkt.get(mt) : null, am = mt != null ? S.agile.get(mt) : null;
  $("#p-now", root).innerHTML =
    tile("Agile now", f2(imp(a)), "p/kWh", `${hm(t)}–${hm(nx)} · ${vatL()}`, css(COL.agile), "hero") +
    tile("Agile next", f2(imp(an)), "p/kWh", an ? `${hm(nx)}–${hm(nx + SLOT)}` : "not published", css(COL.agile)) +
    tile("Outgoing now", f2(o), "p/kWh", "export, no VAT", css(COL.out)) +
    tile("Flexible", f2(f ? imp(f) : null), "p/kWh", vatL(), css(COL.flex)) +
    tile("Wholesale", f2(mv), "p/kWh", mt != null ? `${hm(mt)} · ex VAT` : (S.errors.mkt ? "couldn't load" : "no data"), css(COL.mkt)) +
    tile("Agile − wholesale", am && ok(mv) ? f2(am.exc - mv) : "—", "p/kWh", mt != null ? `at ${hm(mt)}, ex VAT` : "") +
    tile("Carbon now", f0(ci), "g/kWh", ok(ci) ? `${regionInfo()[1]} forecast` : "", css(COL.ci));
}

function ttRange() {
  const today = dayKey(Date.now());
  const d0 = londonMidnight(today), d1 = londonMidnight(addDays(today, 1)), d2 = londonMidnight(addDays(today, 2));
  return settings.ttView === "today" ? [d0, d1, d1] : settings.ttView === "tomorrow" ? [d1, d2, d1] : [d0, d2, d1];
}
function renderTT() {
  const [x0, x1, d1] = ttRange();
  const slots = slotsBetween(x0, x1);
  const flexEnd = Math.min(x1, Math.max(S.lastAgile + SLOT, floorSlot(Date.now()) + SLOT));
  const series = [
    { key: "mkt", pts: slots.map(t => ({ t, v: S.mkt.get(t) ?? null })) },
    { key: "flex", dash: true, pts: slots.filter(t => t < flexEnd).map(t => { const f = flexAt(S, t); return { t, v: f ? imp(f) : null }; }) },
    { key: "out", pts: slots.map(t => ({ t, v: S.out.get(t) ?? null })) },
    { key: "agile", pts: slots.map(t => ({ t, v: imp(S.agile.get(t)) })) }
  ].map(s => ({ ...s, color: css(COL[s.key]), step: true }));
  $("#p-ttlegend", root).innerHTML = legendHTML([{ label: `Agile import (${vatL()})`, color: css(COL.agile) }, { label: "Agile Outgoing", color: css(COL.out) }, { label: "Flexible", color: css(COL.flex), dash: true }, { label: "Wholesale (ex VAT)", color: css(COL.mkt) }]);
  const shade = []; let run = null;
  slots.forEach(t => { if (isPeak(t)) { if (!run) run = [t, t + SLOT]; else run[1] = t + SLOT; } else if (run) { shade.push(run); run = null; } }); if (run) shade.push(run);
  const hasTomorrow = S.agile.has(d1 + 17 * 3600e3);
  $("#p-ttsub", root).textContent = "Half-hourly unit rates, p/kWh. Shaded: 16:00–19:00 peak." + (settings.ttView !== "today" && !hasTomorrow ? " Tomorrow's prices aren't out yet." : "");
  const tk = timeTicks(x0, x1);
  drawChart($("#p-ttchart", root), {
    series, x0, x1, xTicks: tk.ticks, xFmt: tk.fmt, shade, nowT: Date.now(), height: 260,
    snap: t => floorSlot(t), tipOffset: SLOT / 2, step: SLOT,
    tip: t => {
      const a = S.agile.get(t), o = S.out.get(t), f = flexAt(S, t), mk = S.mkt.get(t), ci = S.ci.get(t);
      if (!a && o == null && mk == null) return null;
      const rows = [[css(COL.agile), "Agile", f2(imp(a))], [css(COL.out), "Outgoing", f2(o)], [css(COL.flex), "Flexible", f2(f ? imp(f) : null)], [css(COL.mkt), "Wholesale", f2(mk)]];
      if (a && ok(mk)) rows.push(["", "Agile − wholesale (ex VAT)", f2(a.exc - mk)]);
      if (ok(mk) && ok(o)) rows.push(["", "Wholesale − Outgoing", f2(mk - o)]);
      if (ok(ci)) rows.push([css(COL.ci), "Carbon", f0(ci) + " g"]);
      return { title: `${dayShort(t)} ${hm(t)}–${hm(t + SLOT)}`, rows };
    }
  });
  $("#p-ciregion", root).textContent = regionInfo()[1];
  drawChart($("#p-cichart", root), {
    series: [{ color: css(COL.ci), step: true, pts: slots.map(t => ({ t, v: S.ci.get(t) ?? null })) }],
    x0, x1, xTicks: tk.ticks, xFmt: tk.fmt, nowT: Date.now(), height: 120, yTicks: 3,
    snap: t => floorSlot(t), tipOffset: SLOT / 2, step: SLOT,
    tip: t => ok(S.ci.get(t)) ? { title: `${dayShort(t)} ${hm(t)}`, rows: [[css(COL.ci), "Carbon intensity", f0(S.ci.get(t)) + " g/kWh"]] } : null
  });
}

/* windows: cheapest / greenest / balanced */
function windows(n, src, dirMax) {
  const start = floorSlot(Date.now()), end = (dirMax ? S.lastOut : S.lastAgile) + SLOT;
  const slots = slotsBetween(start, end).map(t => ({ t, v: src(t) }));
  const out = [];
  for (let i = 0; i + n <= slots.length; i++) { const w = slots.slice(i, i + n); if (w.some(s => !ok(s.v))) continue; out.push({ i, t: w[0].t, avg: mean(w.map(s => s.v)) }); }
  return { list: out, horizon: end };
}
function pickTop(cands, n, key, k = 3) {
  const sorted = cands.slice().sort((a, b) => a[key] - b[key]); const picked = [];
  for (const c of sorted) { if (picked.every(p => Math.abs(p.i - c.i) >= n)) picked.push(c); if (picked.length === k) break; }
  return picked;
}
function renderWindows() {
  const n = settings.dur, w = settings.weight / 100;
  const label = t => `${dayShort(t)}, ${hm(t)}–${hm(t + n * SLOT)}`;
  const price = windows(n, t => imp(S.agile.get(t)));
  const carb = new Map(windows(n, t => S.ci.get(t) ?? null).list.map(c => [c.t, c.avg]));
  let cands = price.list.map(c => ({ ...c, ci: carb.get(c.t) ?? null }));
  const haveCI = cands.some(c => ok(c.ci));
  if (haveCI && w > 0) {
    cands = cands.filter(c => ok(c.ci));
    const pMin = Math.min(...cands.map(c => c.avg)), pMax = Math.max(...cands.map(c => c.avg));
    const cMin = Math.min(...cands.map(c => c.ci)), cMax = Math.max(...cands.map(c => c.ci));
    cands.forEach(c => c.score = (1 - w) * (c.avg - pMin) / ((pMax - pMin) || 1) + w * (c.ci - cMin) / ((cMax - cMin) || 1));
  } else cands.forEach(c => c.score = c.avg);
  const picked = pickTop(cands, n, "score");
  const mode = !haveCI || w === 0 ? "cheapest" : w === 1 ? "greenest" : w < 0.5 ? "mostly cheap" : w > 0.5 ? "mostly green" : "balanced";
  $("#p-winimp", root).innerHTML = picked.length ? picked.map((c, k) => {
    const f = flexAt(S, c.t), fv = f ? imp(f) : null, save = ok(fv) ? (fv - c.avg) / fv * 100 : null;
    return `<div class="win"><div class="t">${k === 0 ? `Best <span class="badge">${mode}</span> ` : `Option ${k + 1}: `}${label(c.t)}</div>` +
      `<div class="d">${f2(c.avg)} p/kWh${c.avg < 0 ? ' <span class="neg">(you get paid)</span>' : ""}` +
      (ok(c.ci) ? ` · ${f0(c.ci)} g CO₂/kWh` : "") + (ok(save) ? ` · ${save >= 0 ? `${save.toFixed(0)}% cheaper` : `${(-save).toFixed(0)}% dearer`} than Flexible` : "") + `</div></div>`;
  }).join("") + `<div class="note">Looking ahead to ${dayShort(price.horizon)} ${hm(price.horizon)}.${haveCI ? "" : " Carbon forecast unavailable, so ranking by price only."}</div>`
    : `<div class="note">Not enough published Agile slots ahead for a block this long.</div>`;
  const ex = windows(n, t => S.out.get(t) ?? null, true);
  const exP = pickTop(ex.list.map(c => ({ ...c, neg: -c.avg })), n, "neg");
  $("#p-winexp", root).innerHTML = exP.length ? exP.map((c, k) => `<div class="win"><div class="t">${k === 0 ? "Best: " : `Option ${k + 1}: `}${label(c.t)}</div><div class="d">${f2(c.avg)} p/kWh paid</div></div>`).join("")
    : `<div class="note">${S.errors.out ? "Outgoing prices couldn't be loaded." : "Not enough published Outgoing slots ahead."}</div>`;
}

/* daily stats */
function dailyStats() {
  const days = new Map();
  for (const [t, v] of S.agile) {
    if (t < S.from) continue;
    const k = dayKey(t);
    if (!days.has(k)) days.set(k, { key: k, imp: [], exc: [], out: [], mkt: [], fe: [], fi: [], neg: 0, peak: [] });
    const d = days.get(k); d.imp.push(imp(v)); d.exc.push(v.exc); if (v.inc < 0) d.neg++; if (isPeak(t)) d.peak.push(imp(v));
    const o = S.out.get(t); if (ok(o)) d.out.push(o);
    const m = S.mkt.get(t); if (ok(m)) d.mkt.push(m);
    const f = flexAt(S, t); if (f) { d.fe.push(f.exc); d.fi.push(f.inc); }
  }
  return [...days.values()].sort((a, b) => a.key.localeCompare(b.key)).map(d => ({
    key: d.key, t: londonMidnight(d.key) + 12 * 3600e3, avg: mean(d.imp), min: Math.min(...d.imp), max: Math.max(...d.imp), avgExc: mean(d.exc),
    out: mean(d.out), mkt: d.mkt.length >= 24 ? mean(d.mkt) : null, flexExc: mean(d.fe), flexInc: mean(d.fi), neg: d.neg, peak: mean(d.peak), complete: d.imp.length >= 46
  }));
}
function renderSpread() {
  const days = dailyStats().filter(d => d.complete || d.key === dayKey(Date.now()));
  const impM = [], expM = [], oct = [], mk = [], ag = [];
  for (const [t, v] of S.agile) {
    if (t < S.from) continue; const m = S.mkt.get(t), o = S.out.get(t);
    ag.push(v.exc); if (ok(m)) { mk.push(m); impM.push(v.exc - m); } if (ok(m) && ok(o)) expM.push(m - o); if (ok(o)) oct.push(v.exc - o);
  }
  $("#p-spsub", root).textContent = `Daily averages over the last ${S.range} days, p/kWh, all ex VAT so they compare like for like.`;
  $("#p-sptiles", root).innerHTML =
    tile("Agile import avg", f2(mean(ag)), "p/kWh", "ex VAT", css(COL.agile)) +
    tile("Wholesale avg", f2(mean(mk)), "p/kWh", S.errors.mkt ? "couldn't load" : `${mk.length} half-hours`, css(COL.mkt)) +
    tile("Import markup", f2(mean(impM)), "p/kWh", "Agile − wholesale: network, levies, margin") +
    tile("Export discount", f2(mean(expM)), "p/kWh", "wholesale − Outgoing") +
    tile("Buy/sell gap", f2(mean(oct)), "p/kWh", "Agile import − Outgoing");
  $("#p-splegend", root).innerHTML = legendHTML([{ label: "Agile import", color: css(COL.agile) }, { label: "Agile Outgoing", color: css(COL.out) }, { label: "Flexible", color: css(COL.flex), dash: true }, { label: "Wholesale", color: css(COL.mkt) }]);
  if (!days.length) { $("#p-spchart", root).innerHTML = '<div class="note empty">No data.</div>'; return; }
  const x0 = londonMidnight(days[0].key), x1 = londonMidnight(addDays(days[days.length - 1].key, 1)), tk = timeTicks(x0, x1);
  const pts = k => days.map(d => ({ t: d.t, v: d[k] }));
  drawChart($("#p-spchart", root), {
    series: [{ color: css(COL.mkt), pts: pts("mkt") }, { color: css(COL.flex), dash: true, pts: pts("flexExc") }, { color: css(COL.out), pts: pts("out") }, { color: css(COL.agile), pts: pts("avgExc") }],
    x0, x1, xTicks: tk.ticks, xFmt: tk.fmt, snap: nearestSnap(days.map(d => d.t)),
    tip: t => { const d = days.find(x => x.t === t); if (!d) return null;
      return { title: dayShort(t), rows: [[css(COL.agile), "Agile import", f2(d.avgExc)], [css(COL.out), "Outgoing", f2(d.out)], [css(COL.flex), "Flexible", f2(d.flexExc)], [css(COL.mkt), "Wholesale", f2(d.mkt)],
        ["", "Import markup", ok(d.mkt) ? f2(d.avgExc - d.mkt) : "—"], ["", "Export discount", ok(d.mkt) && ok(d.out) ? f2(d.mkt - d.out) : "—"]] }; }
  });
}
function renderFlex() {
  const ag = [], fl = [], cheaper = [], pa = [], pf = [];
  for (const [t, v] of S.agile) { if (t < S.from || t > Date.now()) continue; const f = flexAt(S, t); if (!f) continue;
    const a = imp(v), b = imp(f); ag.push(a); fl.push(b); cheaper.push(a < b ? 1 : 0); if (isPeak(t)) { pa.push(a); pf.push(b); } }
  const diff = ag.length ? mean(fl) - mean(ag) : null, sv = s => s ? imp(s) : null;
  $("#p-flexsub", root).textContent = `Last ${S.range} days up to now, ${vatL()}.`;
  $("#p-flextiles", root).innerHTML =
    tile("Agile avg (flat use)", f2(mean(ag)), "p/kWh", "", css(COL.agile)) + tile("Flexible avg", f2(mean(fl)), "p/kWh", "", css(COL.flex)) +
    tile(ok(diff) && diff >= 0 ? "Agile cheaper by" : "Agile dearer by", f2(ok(diff) ? Math.abs(diff) : null), "p/kWh", ok(diff) ? `${Math.abs(diff / mean(fl) * 100).toFixed(0)}% on unit rate` : "") +
    tile("Half-hours Agile cheaper", cheaper.length ? (mean(cheaper) * 100).toFixed(0) : "—", "%", `${cheaper.length} compared`) +
    tile("Peak 16–19 avg", f2(mean(pa)), "p/kWh", `Flexible ${f2(mean(pf))}`) +
    tile("Standing charge", f2(sv(S.sA)), "p/day", `Agile · Flexible ${f2(sv(S.sF))}`);
}
function renderHistory() {
  const days = dailyStats();
  $("#p-hsub", root).textContent = `Daily min–max range and average over the last ${S.range} days, p/kWh, ${vatL()}.`;
  $("#p-hlegend", root).innerHTML = legendHTML([{ label: "Daily min–max", color: css(COL.agile), box: true }, { label: "Daily average", color: css(COL.agile) }, { label: "Flexible", color: css(COL.flex), dash: true }]);
  if (!days.length) { $("#p-hchart", root).innerHTML = '<div class="note empty">No data.</div>'; return; }
  const x0 = londonMidnight(days[0].key), x1 = londonMidnight(addDays(days[days.length - 1].key, 1)), tk = timeTicks(x0, x1);
  drawChart($("#p-hchart", root), {
    band: { color: css(COL.agile), pts: days.map(d => ({ t: d.t, lo: d.min, hi: d.max })) },
    series: [{ color: css(COL.flex), dash: true, pts: days.map(d => ({ t: d.t, v: settings.vat === "inc" ? d.flexInc : d.flexExc })) }, { color: css(COL.agile), pts: days.map(d => ({ t: d.t, v: d.avg })) }],
    x0, x1, xTicks: tk.ticks, xFmt: tk.fmt, snap: nearestSnap(days.map(d => d.t)),
    tip: t => { const d = days.find(x => x.t === t); if (!d) return null;
      return { title: dayShort(t) + (d.complete ? "" : " (partial)"), rows: [[css(COL.agile), "Average", f2(d.avg)], ["", "Min", f2(d.min)], ["", "Max", f2(d.max)], ["", "Peak 16–19 avg", f2(d.peak)], ["", "Negative half-hours", String(d.neg)]] }; }
  });
  $("#p-daytable", root).innerHTML = `<thead><tr><th>Day</th><th>Avg</th><th>Min</th><th>Max</th><th>Peak</th><th>Neg.</th><th>Outgoing</th><th>Wholesale</th><th>Flexible</th></tr></thead><tbody>` +
    days.slice().reverse().map(d => `<tr><td>${dayShort(d.t)}${d.complete ? "" : " *"}</td><td>${f2(d.avg)}</td><td class="${d.min < 0 ? "neg" : ""}">${f2(d.min)}</td><td>${f2(d.max)}</td><td>${f2(d.peak)}</td><td>${d.neg || ""}</td><td>${f2(d.out)}</td><td>${f2(d.mkt)}</td><td>${f2(settings.vat === "inc" ? d.flexInc : d.flexExc)}</td></tr>`).join("") + `</tbody>`;
  const weeks = new Map();
  days.filter(d => d.complete).forEach(d => { const wk = addDays(d.key, -isoWeekdayIdx(d.key)); if (!weeks.has(wk)) weeks.set(wk, []); weeks.get(wk).push(d); });
  $("#p-weektable", root).innerHTML = `<thead><tr><th>Week of</th><th>Days</th><th>Avg</th><th>Lowest</th><th>Highest</th><th>Neg.</th><th>Wholesale</th><th>Markup</th></tr></thead><tbody>` +
    [...weeks.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([wk, ds]) => { const mk = ds.filter(d => ok(d.mkt));
      return `<tr><td>${dm(londonMidnight(wk) + 12 * 3600e3)}</td><td>${ds.length}</td><td>${f2(mean(ds.map(d => d.avg)))}</td><td>${f2(Math.min(...ds.map(d => d.min)))}</td><td>${f2(Math.max(...ds.map(d => d.max)))}</td><td>${ds.reduce((s, d) => s + d.neg, 0) || ""}</td><td>${f2(mean(mk.map(d => d.mkt)))}</td><td>${mk.length ? f2(mean(mk.map(d => d.avgExc - d.mkt))) : "—"}</td></tr>`; }).join("") + `</tbody>`;
  const P = S.products;
  $("#p-tariffs", root).textContent = `Tariffs: ${tariffCode(P.agile, S.region)}, ${tariffCode(P.outgoing, S.region)}, ${tariffCode(P.flexible, S.region)}.`;
}
