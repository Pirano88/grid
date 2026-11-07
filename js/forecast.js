import { $, dayKey, addDays, londonMidnight, hm, dayShort, londonHour, isPeak, floorSlot, slotsBetween, SLOT, HOUR, DAY, isoWeekdayIdx,
  mean, f1, f2, f0, gw, ok, tile, legendHTML, drawChart, timeTicks, css, esc } from "./core.js";
import { settings, setStatus, regionInfo, onSetting } from "./app.js";
import { loadPrices, invalidatePrices } from "./store.js";
import * as api from "./api.js";
import { renderAlertSettings } from "./alerts.js";

let root, F = null, seq = 0;
const vat = v => settings.vat === "inc" ? v * 1.05 : v;
const vatL = () => settings.vat === "inc" ? "inc VAT" : "ex VAT";

export function init(el) {
  root = el;
  root.innerHTML = `
  <div class="sub">Where Agile is likely heading once today's and tomorrow's published prices run out, and what's driving it.</div>
  <div class="tiles" id="f-tiles"></div>
  <div class="card">
    <h2>Agile price: published and forecast</h2>
    <div class="sub" id="f-sub"></div>
    <div class="legend" id="f-legend"></div>
    <div class="chart" id="f-chart"></div>
    <div class="note">The forecast is a simple statistical model fitted to the last four weeks: Agile vs residual demand (demand minus wind and solar), time of day and the 16:00–19:00 peak. It runs as far as the Elexon wind forecast goes (usually 2–3 days). The shaded band is ± its typical error from the accuracy check below.</div>
  </div>
  <div class="card">
    <h2>Daily outlook</h2>
    <div class="tablewrap"><table id="f-days"></table></div>
  </div>
  <div class="card">
    <h2>What's driving it</h2>
    <div class="sub">Forecast national demand vs wind and solar, GW. The gap between them has to come from gas, nuclear, imports and storage, and that gap sets the price.</div>
    <div class="legend" id="f-dlegend"></div>
    <div class="chart" id="f-drivers"></div>
    <h3>Carbon intensity forecast (national, g/kWh)</h3>
    <div class="chart" id="f-ci"></div>
  </div>
  <div class="card">
    <h2>How good is the forecast?</h2>
    <div class="sub" id="f-btsub"></div>
    <div class="tiles" id="f-bttiles"></div>
    <div class="legend" id="f-btlegend"></div>
    <div class="chart" id="f-bt"></div>
  </div>
  <div class="card" id="f-alerts"></div>`;
  onSetting(k => { if (k === "region") { F = null; if (root.classList.contains("on")) load(); } });
  renderAlertSettings($("#f-alerts", root));
  load();
}
export function show() { if (!F) load(); else redraw(); }
export async function refresh() { invalidatePrices(); await load(true); }
export function tick(active) { if (active && F && Date.now() - F.at > 30 * 60e3) load(true); }
export function redraw() { if (F) render(); }

async function load(force) {
  const my = ++seq; setStatus("forecast", "Fitting the forecast…");
  const now = Date.now(), today = dayKey(now);
  const trainFrom = londonMidnight(addDays(today, -28)), dFrom = addDays(today, -29), dTo = today;
  const [P, wind, dem, sol, wf, df, ci] = await Promise.allSettled([
    loadPrices(30, settings.region, force), api.fuelHH(dFrom, dTo, "WIND"), api.demandOutturn(dFrom, dTo), api.solar(trainFrom, now),
    api.windForecast(floorSlot(now), now + 5 * DAY), api.demandForecast(floorSlot(now), now + 4 * DAY), api.ciNational48()]);
  if (my !== seq) return;
  const errs = [];
  const val = (r, name, dflt) => r.status === "fulfilled" ? r.value : (errs.push(`${name}: ${r.reason?.message}`), dflt);
  const S = val(P, "prices", null), W = val(wind, "wind history", new Map()), D = val(dem, "demand history", new Map()), SO = val(sol, "solar", new Map());
  const WF = val(wf, "wind forecast", new Map()), DF = val(df, "demand forecast", new Map()), CI = val(ci, "carbon forecast", new Map());
  F = { at: now, S, errs, CI };
  if (!S) { setStatus("forecast", `<span class="err">Couldn't load prices: ${esc(errs.join("; "))}</span>`); return; }
  const windAt = t => { const r = W.get(t); return r ? r.WIND : null; };
  // expected solar per slot-of-day: mean of the last 7 days
  const solProf = new Map(); for (const [t, v] of SO) if (t > now - 7 * DAY) { const k = hm(t); (solProf.get(k) || solProf.set(k, []).get(k)).push(v); }
  const solarExp = t => mean(solProf.get(hm(t)) || []) ?? 0;
  // demand profile fallback beyond the day-ahead forecast: same slot, weekday vs weekend, last 14 days
  const demProf = new Map(); for (const [t, v] of D) if (t > now - 15 * DAY) { const k = (isoWeekdayIdx(dayKey(t)) >= 5 ? "we" : "wd") + hm(t); (demProf.get(k) || demProf.set(k, []).get(k)).push(v); }
  const demandExp = t => DF.get(t) ?? mean(demProf.get((isoWeekdayIdx(dayKey(t)) >= 5 ? "we" : "wd") + hm(t)) || []);
  // training rows
  const rows = [];
  for (const [t, v] of S.agile) {
    if (t < trainFrom || t > now) continue;
    const w = windAt(t), d = D.get(t), s = SO.get(t) ?? 0;
    if (!ok(w) || !ok(d)) continue;
    rows.push({ t, y: v.exc, x: feats(t, d, w, s) });
  }
  F.nTrain = rows.length;
  if (rows.length < 200) { errs.push(`only ${rows.length} training half-hours`); }
  // backtest: train on older days, test on the last 7
  const cut = londonMidnight(addDays(today, -7));
  const btTrain = rows.filter(r => r.t < cut), btTest = rows.filter(r => r.t >= cut);
  let bt = null;
  if (btTrain.length > 150 && btTest.length > 24) {
    const b = fit(btTrain); const res = btTest.map(r => ({ t: r.t, y: r.y, p: clampP(dot(b, r.x)) }));
    const e = res.map(r => r.p - r.y);
    bt = { res, mae: mean(e.map(Math.abs)), bias: mean(e), rmse: Math.sqrt(mean(e.map(x => x * x))) };
  }
  const beta = rows.length > 100 ? fit(rows) : null;
  F.bt = bt; F.beta = beta;
  // predictions: from start of today until the wind forecast runs out
  const lastWind = Math.max(0, ...WF.keys());
  const pf = londonMidnight(today), pt = Math.min(lastWind + SLOT, now + 4 * DAY);
  F.pred = [];
  if (beta) for (const t of slotsBetween(pf, pt)) {
    const w = WF.get(t) ?? (t <= now ? windAt(t) : null), d = t <= now ? (D.get(t) ?? demandExp(t)) : demandExp(t), s = t <= now ? (SO.get(t) ?? solarExp(t)) : solarExp(t);
    if (!ok(w) || !ok(d)) continue;
    F.pred.push({ t, p: clampP(dot(beta, feats(t, d, w, s))), w, d, s });
  }
  F.lastAgile = S.lastAgile; F.WF = WF; F.lastWind = lastWind;
  setStatus("forecast", `Model fitted ${hm(now)} on ${rows.length} half-hours` + (errs.length ? ` · <span class="err" title="${esc(errs.join("\n"))}">some inputs missing</span>` : ""));
  render();
}
function feats(t, dMW, wMW, sMW) {
  const R = (dMW - wMW - sMW) / 10000; // tens of GW
  const h = londonHour(t) / 24 * 2 * Math.PI, we = isoWeekdayIdx(dayKey(t)) >= 5 ? 1 : 0;
  return [1, R, R * R, isPeak(t) ? 1 : 0, Math.sin(h), Math.cos(h), Math.sin(2 * h), Math.cos(2 * h), we, isPeak(t) ? R : 0];
}
const dot = (b, x) => b.reduce((s, v, i) => s + v * x[i], 0);
const clampP = p => Math.max(-20, Math.min(95.24, p));
function fit(rows) { // ridge least squares via normal equations
  const k = rows[0].x.length, A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0);
  rows.forEach(r => { for (let i = 0; i < k; i++) { b[i] += r.x[i] * r.y; for (let j = 0; j < k; j++) A[i][j] += r.x[i] * r.x[j]; } });
  for (let i = 1; i < k; i++) A[i][i] += 0.5;
  // Gaussian elimination
  for (let i = 0; i < k; i++) {
    let p = i; for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c < k; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
  }
  return b.map((v, i) => v / A[i][i]);
}

function render() {
  const S = F.S, now = Date.now(), today = dayKey(now);
  const fut = F.pred.filter(p => p.t > F.lastAgile);
  const err = F.bt ? F.bt.mae : 4;
  const horizon = fut.length ? fut[fut.length - 1].t + SLOT : null;
  $("#f-tiles", root).innerHTML =
    tile("Published until", F.lastAgile ? `${dayShort(F.lastAgile + SLOT).split(" ")[0]} ${hm(F.lastAgile + SLOT)}` : "—", "", "official Agile prices") +
    tile("Forecast until", horizon ? `${dayShort(horizon).split(" ")[0]} ${hm(horizon)}` : "—", "", "limited by the wind forecast") +
    tile("Forecast avg", f2(fut.length ? vat(mean(fut.map(p => p.p))) : null), "p/kWh", vatL()) +
    tile("Typical error", f1(F.bt ? vat(F.bt.mae) : null), "p/kWh", "mean absolute, last 7 days");
  $("#f-sub", root).textContent = `p/kWh, ${vatL()}, ${regionInfo()[1]}. Solid = published by Octopus, dashed = forecast.`;
  const x0 = londonMidnight(addDays(today, -1)), x1 = Math.max(horizon || 0, F.lastAgile + SLOT, londonMidnight(addDays(today, 2)));
  const slots = slotsBetween(x0, x1), predMap = new Map(F.pred.map(p => [p.t, p.p]));
  $("#f-legend", root).innerHTML = legendHTML([{ label: "Agile (published)", color: css("--s1") }, { label: "Forecast", color: css("--s2"), dash: true }, { label: "Model on published days", color: css("--muted"), dash: true }]);
  const shade = []; let run = null; slots.forEach(t => { if (isPeak(t)) { if (!run) run = [t, t + SLOT]; else run[1] = t + SLOT; } else if (run) { shade.push(run); run = null; } }); if (run) shade.push(run);
  const tk = timeTicks(x0, x1);
  drawChart($("#f-chart", root), {
    band: { color: css("--s2"), pts: fut.map(p => ({ t: p.t + SLOT / 2, lo: vat(p.p - err), hi: vat(p.p + err) })) },
    series: [
      { color: css("--muted"), dash: true, width: 1.2, step: true, pts: slots.filter(t => t <= F.lastAgile).map(t => ({ t, v: predMap.has(t) ? vat(predMap.get(t)) : null })) },
      { color: css("--s1"), step: true, pts: slots.map(t => { const a = S.agile.get(t); return { t, v: a ? (settings.vat === "inc" ? a.inc : a.exc) : null }; }) },
      { color: css("--s2"), dash: true, step: true, pts: slots.filter(t => t > F.lastAgile).map(t => ({ t, v: predMap.has(t) ? vat(predMap.get(t)) : null })) }
    ],
    x0, x1, xTicks: tk.ticks, xFmt: tk.fmt, shade, nowT: now, height: 280, snap: t => floorSlot(t), tipOffset: SLOT / 2, step: SLOT,
    tip: t => { const a = S.agile.get(t), p = predMap.get(t); if (!a && !ok(p)) return null;
      const rows = []; if (a) rows.push([css("--s1"), "Published", f2(settings.vat === "inc" ? a.inc : a.exc)]);
      if (ok(p)) rows.push([css(a ? "--muted" : "--s2"), a ? "Model" : "Forecast", f2(vat(p)) + (a ? "" : ` ±${f1(vat(err))}`)]);
      const pr = F.pred.find(q => q.t === t); if (pr) rows.push(["", "Wind / demand", `${gw(pr.w)} / ${gw(pr.d)} GW`]);
      return { title: `${dayShort(t)} ${hm(t)}`, rows }; }
  });
  // daily outlook
  const days = new Map();
  slots.filter(t => t >= londonMidnight(today)).forEach(t => {
    const a = S.agile.get(t), p = predMap.get(t), v = a ? a.exc : (t > F.lastAgile ? p : null); if (!ok(v)) return;
    const k = dayKey(t); if (!days.has(k)) days.set(k, []); days.get(k).push({ t, v, src: a ? "pub" : "fc", w: F.pred.find(q => q.t === t)?.w });
  });
  $("#f-days", root).innerHTML = `<thead><tr><th>Day</th><th>Source</th><th>Avg</th><th>Min</th><th>Peak 16–19</th><th>Cheapest 2 h</th><th>Avg wind</th></tr></thead><tbody>` +
    [...days.entries()].map(([k, arr]) => {
      const src = arr.every(x => x.src === "pub") ? "Published" : arr.every(x => x.src === "fc") ? "Forecast" : "Mixed";
      let best = null; for (let i = 0; i + 4 <= arr.length; i++) { const w = arr.slice(i, i + 4); if (w[3].t - w[0].t !== 3 * SLOT) continue; const m = mean(w.map(x => x.v)); if (!best || m < best.m) best = { m, t: w[0].t }; }
      return `<tr><td>${dayShort(londonMidnight(k) + 12 * HOUR)}${arr.length < 46 ? " *" : ""}</td><td>${src}</td><td>${f2(vat(mean(arr.map(x => x.v))))}</td><td>${f2(vat(Math.min(...arr.map(x => x.v))))}</td><td>${f2(vat(mean(arr.filter(x => isPeak(x.t)).map(x => x.v))))}</td><td>${best ? `${hm(best.t)} · ${f2(vat(best.m))}` : "—"}</td><td>${gw(mean(arr.map(x => x.w)))} GW</td></tr>`;
    }).join("") + `</tbody>`;
  // drivers
  const dx0 = floorSlot(now) - 12 * HOUR, dx1 = Math.max(x1, dx0 + DAY), dt = timeTicks(dx0, dx1);
  const P = F.pred.filter(p => p.t >= dx0);
  $("#f-dlegend", root).innerHTML = legendHTML([{ label: "Demand", color: css("--fg2") }, { label: "Wind", color: css("--f-wind") }, { label: "Solar (typical)", color: css("--f-solar") }, { label: "Demand − wind − solar", color: css("--f-gas"), dash: true }]);
  drawChart($("#f-drivers", root), {
    series: [{ color: css("--fg2"), pts: P.map(p => ({ t: p.t, v: p.d / 1000 })) }, { color: css("--f-wind"), pts: P.map(p => ({ t: p.t, v: p.w / 1000 })) },
      { color: css("--f-solar"), pts: P.map(p => ({ t: p.t, v: p.s / 1000 })) }, { color: css("--f-gas"), dash: true, pts: P.map(p => ({ t: p.t, v: (p.d - p.w - p.s) / 1000 })) }],
    x0: dx0, x1: dx1, xTicks: dt.ticks, xFmt: dt.fmt, nowT: now, height: 220, snap: t => floorSlot(t), step: SLOT,
    tip: t => { const p = P.find(q => q.t === t); return p ? { title: `${dayShort(t)} ${hm(t)}`, rows: [[css("--fg2"), "Demand", gw(p.d) + " GW"], [css("--f-wind"), "Wind", gw(p.w) + " GW"], [css("--f-solar"), "Solar", gw(p.s) + " GW"], [css("--f-gas"), "Residual", gw(p.d - p.w - p.s) + " GW"]] } : null; }
  });
  const ciPts = [...F.CI.entries()].sort((a, b) => a[0] - b[0]);
  drawChart($("#f-ci", root), {
    series: [{ color: css("--f-biomass"), step: true, pts: ciPts.map(([t, v]) => ({ t, v })) }], x0: dx0, x1: dx1, xTicks: dt.ticks, xFmt: dt.fmt, nowT: now, height: 130, yTicks: 3,
    snap: t => floorSlot(t), step: SLOT, tipOffset: SLOT / 2, tip: t => ok(F.CI.get(t)) ? { title: `${dayShort(t)} ${hm(t)}`, rows: [[css("--f-biomass"), "Carbon", f0(F.CI.get(t)) + " g/kWh"]] } : null
  });
  // backtest
  const bt = F.bt;
  $("#f-btsub", root).textContent = bt ? "The model trained on the three weeks before, then asked to predict the last seven days. It's given the actual wind and demand, so real forecasts (which also carry wind-forecast error) will be a bit worse." : "Not enough history to run the accuracy check.";
  $("#f-bttiles", root).innerHTML = bt ? tile("Mean abs. error", f1(vat(bt.mae)), "p/kWh", vatL()) + tile("Bias", (bt.bias >= 0 ? "+" : "") + f1(vat(bt.bias)), "p/kWh", bt.bias >= 0 ? "tends to over-forecast" : "tends to under-forecast") + tile("RMSE", f1(vat(bt.rmse)), "p/kWh", "punishes big misses") : "";
  $("#f-btlegend", root).innerHTML = bt ? legendHTML([{ label: "Actual Agile", color: css("--s1") }, { label: "Model", color: css("--s2"), dash: true }]) : "";
  if (bt) { const bx0 = bt.res[0].t, bx1 = bt.res[bt.res.length - 1].t + SLOT, bk = timeTicks(bx0, bx1);
    drawChart($("#f-bt", root), {
      series: [{ color: css("--s1"), step: true, pts: bt.res.map(r => ({ t: r.t, v: vat(r.y) })) }, { color: css("--s2"), dash: true, step: true, pts: bt.res.map(r => ({ t: r.t, v: vat(r.p) })) }],
      x0: bx0, x1: bx1, xTicks: bk.ticks, xFmt: bk.fmt, height: 220, snap: t => floorSlot(t), step: SLOT, tipOffset: SLOT / 2,
      tip: t => { const r = bt.res.find(q => q.t === t); return r ? { title: `${dayShort(t)} ${hm(t)}`, rows: [[css("--s1"), "Actual", f2(vat(r.y))], [css("--s2"), "Model", f2(vat(r.p))], ["", "Error", f2(vat(r.p - r.y))]] } : null; } });
  } else $("#f-bt", root).innerHTML = "";
}
