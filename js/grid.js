import { $, hm, dayShort, dm, dayKey, londonMidnight, floorSlot, SLOT, HOUR, DAY, mean, sum, f0, f1, f2, gw, ok, tile, legendHTML, segmented, drawChart, nearestSnap, timeTicks, css, esc } from "./core.js";
import { settings, setSetting, setStatus } from "./app.js";
import * as api from "./api.js";

let root, live = null, hist = null, seq = 0, yearNeg = null;
const RANGES = { day: { span: DAY, bin: SLOT, label: "past day" }, week: { span: 7 * DAY, bin: HOUR, label: "past week" }, month: { span: 30 * DAY, bin: 3 * HOUR, label: "past 30 days" }, year: { span: 365 * DAY, bin: DAY, label: "past year" } };
const WIND_RECORD = { gw: 23.94, date: "5 December 2025", src: "https://grid.iamkate.com/" };
const COAL_END = Date.UTC(2024, 8, 30, 12); // Ratcliffe-on-Soar, Britain's last coal power station, closed 30 Sep 2024
const G = k => api.FUEL_GROUPS.find(g => g.k === k);

export function init(el) {
  root = el;
  root.innerHTML = `
  <div class="sub">Great Britain's electricity system right now: what's generating, what it costs, how clean it is, and what's flowing in and out.</div>
  <div class="tiles" id="g-now"></div>
  <div class="grid2">
    <div class="card"><h2>Generation mix now</h2><div class="sub" id="g-mixsub"></div><div class="mixstrip" id="g-strip"></div><div class="mix" id="g-mix"></div></div>
    <div class="card"><h2>Interconnectors &amp; storage</h2><div class="sub">Positive = importing into GB, negative = exporting.</div><div class="mix" id="g-ic"></div>
      <div class="note">Interconnector flows and pumped storage from Elexon FUELINST (5-minutely). Grid batteries aren't reported in this feed.</div></div>
  </div>
  <div class="card">
    <div class="row"><div><h2>Over time</h2><div class="sub" style="margin:0" id="g-rsub"></div></div>
      <span class="seg" id="g-range"><button data-v="day">Day</button><button data-v="week">Week</button><button data-v="month">Month</button><button data-v="year">Year</button></span></div>
    <div class="tiles" id="g-avg"></div>
    <h3>Generation by source (GW)</h3><div class="legend" id="g-genlegend"></div><div class="chart" id="g-gen"></div>
    <h3>Wholesale price (£/MWh)</h3><div class="chart" id="g-price"></div>
    <h3>Carbon intensity (g CO₂/kWh)</h3><div class="chart" id="g-ci"></div>
    <h3>Demand (GW)</h3><div class="chart" id="g-dem"></div>
    <div class="note">Demand here = generation + net imports (transmission-metered plus PV_Live solar). Small embedded wind isn't included, so it reads a little below NESO's national demand.</div>
  </div>
  <div class="card"><h2>Records &amp; facts</h2><div class="sub" id="g-factsub"></div><div class="facts" id="g-facts"></div></div>`;
  segmented($("#g-range", root), settings.gridRange, v => { setSetting("gridRange", v); loadHist(); });
  loadLive(); loadHist();
}
export function show() { redraw(); }
export async function refresh() { await Promise.all([loadLive(), loadHist()]); }
export function tick(active) { if (active) loadLive(); }
export function redraw() { if (live) renderLive(); if (hist) renderHist(); }

async function loadLive() {
  const now = Date.now();
  const [fi, so, mk, ci] = await Promise.allSettled([api.fuelinstLatest(), api.solar(now - 3 * HOUR, now), api.marketIndex(now - 6 * HOUR, now + SLOT), api.ciNational(now - 2 * HOUR, now + HOUR)]);
  const L = { errors: [] };
  if (fi.status === "fulfilled") L.fi = fi.value; else L.errors.push("generation mix: " + fi.reason?.message);
  L.solar = so.status === "fulfilled" ? latest(so.value) : (L.errors.push("solar"), null);
  L.price = mk.status === "fulfilled" ? latest(mk.value) : (L.errors.push("price"), null);
  L.ci = ci.status === "fulfilled" ? latestCI(ci.value) : (L.errors.push("carbon"), null);
  live = L; renderLive(); status();
}
const latest = m => { let k = null; for (const t of m.keys()) if (t <= Date.now() && (k == null || t > k)) k = t; return k == null ? null : { t: k, v: m.get(k) }; };
function latestCI(m) { const t = floorSlot(Date.now()); for (let k = t; k > t - 3 * HOUR; k -= SLOT) { const r = m.get(k); if (r && ok(r.actual ?? r.forecast)) return { t: k, v: r.actual ?? r.forecast, index: r.index, est: r.actual == null }; } return null; }
function status() {
  const errs = [...(live?.errors || []), ...(hist?.errors || [])];
  setStatus("grid", (live?.fi ? `Live as of ${hm(live.fi.t)}` : "Loading…") + (errs.length ? ` · <span class="err">Couldn't load ${esc(errs.map(e => e.split(":")[0]).join(", "))}</span>` : ""));
}

function liveNumbers() {
  const F = live.fi?.fuels || {};
  const solar = live.solar?.v || 0;
  const g = api.groupFuels(F, solar);
  const gen = sum(Object.entries(g).filter(([k]) => k !== "imports").map(([, v]) => v));
  const imports = g.imports, demand = gen + imports;
  const renew = g.wind + g.solar + g.hydro - (F.PS || 0);
  return { F, g, gen, imports, demand, solar, renew, lowc: renew + g.nuclear };
}
function renderLive() {
  if (!live.fi) { $("#g-now", root).innerHTML = `<div class="note err">Live generation data couldn't be loaded. ${esc(live.errors.join("; "))}</div>`; return; }
  const N = liveNumbers();
  $("#g-now", root).innerHTML =
    tile("Price", live.price ? f2(live.price.v * 10) : "—", "£/MWh", live.price ? `${f2(live.price.v)} p/kWh · ${hm(live.price.t)}` : "", null, "hero") +
    tile("Carbon intensity", live.ci ? f0(live.ci.v) : "—", "g/kWh", live.ci ? `${live.ci.index || ""}${live.ci.est ? " · forecast" : ""}` : "") +
    tile("Demand", gw(N.demand), "GW", "generation + net imports") +
    tile("Generation", gw(N.gen), "GW", `${(N.gen / N.demand * 100).toFixed(0)}% of demand`) +
    tile("Transfers", (N.imports >= 0 ? "+" : "") + gw(N.imports), "GW", N.imports >= 0 ? "net importing" : "net exporting") +
    tile("Renewable share", (N.renew / N.demand * 100).toFixed(0), "%", `low-carbon incl. nuclear ${(N.lowc / N.demand * 100).toFixed(0)}%`);
  $("#g-mixsub", root).textContent = `Share of demand at ${hm(live.fi.t)}. Solar is the PV_Live estimate${live.solar ? " for " + hm(live.solar.t) : ""}.`;
  const order = ["wind", "solar", "hydro", "nuclear", "biomass", "gas", "other", "imports"];
  $("#g-strip", root).innerHTML = order.filter(k => N.g[k] > 0).map(k => `<i style="flex:${N.g[k]};background:${css(G(k).col)}" title="${G(k).label}"></i>`).join("");
  const F = N.F, row = (label, mw, col) => `<div class="mixrow"><span class="nm"><i class="sw" style="background:${col}"></i>${label}</span><span class="bar"><i style="width:${Math.max(0, mw / N.demand * 100)}%;background:${col}"></i></span><span class="val">${gw(mw)} GW <small>${(mw / N.demand * 100).toFixed(1)}%</small></span></div>`;
  const grp = (t, rows) => `<div class="mixgroup">${t}</div>` + rows.join("");
  $("#g-mix", root).innerHTML =
    grp("Renewables", [row("Wind", F.WIND || 0, css(G("wind").col)), row("Solar", N.solar, css(G("solar").col)), row("Hydro", F.NPSHYD || 0, css(G("hydro").col))]) +
    grp("Other sources", [row("Nuclear", F.NUCLEAR || 0, css(G("nuclear").col)), row("Biomass", F.BIOMASS || 0, css(G("biomass").col))]) +
    grp("Fossil fuels", [row("Gas (CCGT)", F.CCGT || 0, css(G("gas").col)), row("Gas (OCGT)", F.OCGT || 0, css(G("gas").col)), row("Coal", F.COAL || 0, css("--f-coal")), row("Oil & other", (F.OIL || 0) + (F.OTHER || 0), css(G("other").col))]);
  const ics = {}; Object.entries(F).filter(([k]) => k.startsWith("INT")).forEach(([k, v]) => { const c = api.IC_COUNTRY[k] || k; ics[c] = (ics[c] || 0) + v; });
  const maxIc = Math.max(1000, ...Object.values(ics).map(Math.abs), F.PS || 0);
  const dv = (label, mw, col) => { const w = Math.abs(mw) / maxIc * 50; return `<div class="icrow"><span>${label}</span><span class="dv"><i style="${mw >= 0 ? `left:50%` : `left:${50 - w}%`};width:${w}%;${col ? `background:${col}` : ""}"></i></span><span class="val">${mw >= 0 ? "+" : ""}${gw(mw)} GW</span></div>`; };
  $("#g-ic", root).innerHTML = Object.entries(ics).sort((a, b) => b[1] - a[1]).map(([c, v]) => dv(c, v)).join("") +
    `<div class="mixgroup">Storage</div>` + dv("Pumped hydro", F.PS || 0, css(G("hydro").col));
  renderFacts();
}

async function loadHist() {
  const my = ++seq, R = RANGES[settings.gridRange], end = Date.now(), start = end - R.span;
  $("#g-rsub", root).textContent = `Loading the ${R.label}…`;
  const [os, so, mk, ci] = await Promise.allSettled([api.outturnSummary(start, end), api.solar(start, end), api.marketIndex(start, end), api.ciNational(start, end)]);
  if (my !== seq) return;
  const H = { R, start, end, errors: [] };
  const bins = new Map(), bin = t => Math.floor(t / R.bin) * R.bin;
  const acc = (t, k, v) => { const b = bin(t); if (!bins.has(b)) bins.set(b, {}); const o = bins.get(b); (o[k] ||= []).push(v); };
  if (os.status === "fulfilled") os.value.forEach(r => { const g = api.groupFuels(r.fuels, 0); for (const k in g) if (k !== "solar") acc(r.t, k, g[k]); });
  else H.errors.push("history: " + os.reason?.message);
  if (so.status === "fulfilled") so.value.forEach((v, t) => { if (t >= start) acc(t, "solar", v); }); else H.errors.push("solar");
  if (mk.status === "fulfilled") mk.value.forEach((v, t) => acc(t, "price", v * 10)); else H.errors.push("price");
  if (ci.status === "fulfilled") ci.value.forEach((v, t) => { if (t >= start && t <= end) acc(t, "ci", v.actual ?? v.forecast); }); else H.errors.push("carbon");
  H.pts = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([t, o]) => { const p = { t }; for (const k in o) p[k] = mean(o[k]); return p; });
  H.pts.forEach(p => { if (ok(p.gas) || ok(p.wind)) { p.gen = sum(["nuclear", "biomass", "gas", "other", "hydro", "wind", "solar"].map(k => p[k])); p.demand = p.gen + (p.imports || 0); } });
  hist = H; renderHist(); renderFacts(); status();
  if (yearNeg == null) loadYearNeg();
}
function renderHist() {
  const H = hist, R = H.R, P = H.pts.filter(p => p.t >= H.start - R.bin);
  $("#g-rsub", root).textContent = `Averages over the ${R.label}${R.bin >= DAY ? ", daily" : R.bin > SLOT ? `, ${R.bin / HOUR}-hourly` : ", half-hourly"}.`;
  const gen = P.filter(p => ok(p.gen));
  const tot = k => sum(gen.map(p => p[k] || 0));
  const totGen = tot("gen"), ren = tot("wind") + tot("solar") + tot("hydro");
  $("#g-avg", root).innerHTML =
    tile("Avg price", f2(mean(P.map(p => p.price))), "£/MWh") + tile("Avg carbon", f0(mean(P.map(p => p.ci))), "g/kWh") +
    tile("Avg demand", gw(mean(gen.map(p => p.demand))), "GW") + tile("Avg generation", gw(mean(gen.map(p => p.gen))), "GW") +
    tile("Net transfers", gw(mean(gen.map(p => p.imports))), "GW") + tile("Wind + solar + hydro", totGen ? (ren / totGen * 100).toFixed(0) : "—", "%", "of GB generation");
  const x0 = H.start, x1 = H.end, tk = timeTicks(x0, x1), snap = nearestSnap(P.map(p => p.t));
  const keys = api.FUEL_GROUPS.map(g => g.k), colors = Object.fromEntries(api.FUEL_GROUPS.map(g => [g.k, css(g.col)]));
  $("#g-genlegend", root).innerHTML = legendHTML(api.FUEL_GROUPS.slice().reverse().map(g => ({ label: g.label, color: css(g.col), box: true })));
  const when = t => R.bin >= DAY ? dayShort(t) : `${dayShort(t)} ${hm(t)}`;
  drawChart($("#g-gen", root), {
    stack: { keys, colors, stepW: R.bin, pts: gen.map(p => ({ t: p.t, v: Object.fromEntries(keys.map(k => [k, (p[k] || 0) / 1000])) })) },
    x0, x1, xTicks: tk.ticks, xFmt: tk.fmt, height: 280, snap, tipOffset: R.bin / 2,
    tip: t => { const p = P.find(q => q.t === t); if (!p || !ok(p.gen)) return null;
      return { title: when(t), rows: api.FUEL_GROUPS.slice().reverse().filter(g => Math.abs(p[g.k] || 0) > 1).map(g => [css(g.col), g.label, gw(p[g.k]) + " GW"]).concat([["", "Demand", gw(p.demand) + " GW"]]) }; }
  });
  const line = (id, k, col, unit, fmt, h = 150) => drawChart($(id, root), {
    series: [{ color: css(col), pts: P.map(p => ({ t: p.t, v: p[k] ?? null })), step: R.bin <= SLOT, stepW: R.bin }], x0, x1, xTicks: tk.ticks, xFmt: tk.fmt, height: h, yTicks: 4, snap, tipOffset: R.bin <= SLOT ? R.bin / 2 : 0,
    tip: t => { const p = P.find(q => q.t === t); return p && ok(p[k]) ? { title: when(t), rows: [[css(col), unit, fmt(p[k])]] } : null; } });
  line("#g-price", "price", "--s4", "£/MWh", f2);
  line("#g-ci", "ci", "--f-biomass", "g/kWh", f0);
  drawChart($("#g-dem", root), {
    series: [{ color: css("--fg2"), pts: gen.map(p => ({ t: p.t, v: p.demand / 1000 })) }, { color: css("--s1"), dash: true, pts: gen.map(p => ({ t: p.t, v: p.gen / 1000 })) }],
    x0, x1, xTicks: tk.ticks, xFmt: tk.fmt, height: 170, yTicks: 4, snap,
    tip: t => { const p = P.find(q => q.t === t); return p && ok(p.demand) ? { title: when(t), rows: [[css("--fg2"), "Demand", gw(p.demand) + " GW"], [css("--s1"), "Generation", gw(p.gen) + " GW"], ["", "Net transfers", gw(p.imports) + " GW"]] } : null; }
  });
}

async function loadYearNeg() {
  try {
    const y = dayKey(Date.now()).slice(0, 4), from = londonMidnight(`${y}-01-01`);
    const m = await api.agileRates(settings.region, from, Date.now() + 2 * DAY);
    let n = 0, min = Infinity, minT = 0; m.forEach((v, t) => { if (v.inc < 0) n++; if (v.inc < min) { min = v.inc; minT = t; } });
    yearNeg = { n, min, minT, y }; renderFacts();
  } catch (e) { yearNeg = false; }
}
function renderFacts() {
  if (!live?.fi) return;
  const N = liveNumbers(), P = hist?.pts || [], R = hist?.R;
  const maxBy = k => P.filter(p => ok(p[k])).reduce((a, p) => !a || p[k] > a[k] ? p : a, null);
  const minBy = k => P.filter(p => ok(p[k])).reduce((a, p) => !a || p[k] < a[k] ? p : a, null);
  const when = p => p ? (R.bin >= DAY ? dayShort(p.t) : `${dayShort(p.t)} ${hm(p.t)}`) : "";
  const windNow = (N.F.WIND || 0) / 1000, pk = maxBy("wind"), sk = maxBy("solar"), lo = minBy("ci"), hi = maxBy("ci"), imx = maxBy("imports"), dmx = maxBy("demand"), pneg = P.filter(p => ok(p.price) && p.price < 0).length;
  const fact = (big, title, d, meter) => `<div class="fact"><div class="d">${title}</div><div class="big">${big}</div><div class="d">${d}</div>${meter != null ? `<div class="meter"><i style="width:${Math.min(100, meter * 100)}%"></i></div>` : ""}</div>`;
  $("#g-factsub", root).textContent = R ? `Live figures plus highlights from the ${R.label}.` : "";
  $("#g-facts", root).innerHTML = [
    fact(`${windNow.toFixed(1)} GW`, "Wind right now", `${(windNow / WIND_RECORD.gw * 100).toFixed(0)}% of the GB record, ${WIND_RECORD.gw} GW on ${WIND_RECORD.date} (<a href="${WIND_RECORD.src}" target="_blank" rel="noopener">source</a>)${windNow > WIND_RECORD.gw ? " · <b>above the record!</b>" : ""}`, windNow / WIND_RECORD.gw),
    fact(`${(N.renew / N.demand * 100).toFixed(0)}%`, "Renewables now", `wind, solar and hydro; ${(N.lowc / N.demand * 100).toFixed(0)}% with nuclear`, N.renew / N.demand),
    pk ? fact(`${gw(pk.wind)} GW`, `Peak wind, ${R.label}`, when(pk)) : "",
    sk ? fact(`${gw(sk.solar)} GW`, `Peak solar, ${R.label}`, when(sk)) : "",
    lo ? fact(`${f0(lo.ci)} g`, `Cleanest, ${R.label}`, `${when(lo)} · dirtiest ${f0(hi.ci)} g (${when(hi)})`) : "",
    dmx ? fact(`${gw(dmx.demand)} GW`, `Peak demand, ${R.label}`, when(dmx)) : "",
    imx ? fact(`${gw(imx.imports)} GW`, `Most imported, ${R.label}`, when(imx)) : "",
    hist ? fact(String(pneg), `Negative wholesale periods, ${R.label}`, R.bin > SLOT ? "averaged periods below £0/MWh" : "half-hours below £0/MWh") : "",
    yearNeg ? fact(String(yearNeg.n), `Negative Agile half-hours in ${yearNeg.y}`, `region ${settings.region}; lowest ${f2(yearNeg.min)}p on ${dm(yearNeg.minT)}`) : "",
    fact(`${Math.floor((Date.now() - COAL_END) / DAY)} days`, "Coal-free", "since Ratcliffe-on-Soar, Britain's last coal power station, closed on 30 Sep 2024")
  ].join("");
}
