// Data clients: Octopus, Elexon Insights (BMRS), Carbon Intensity API, Sheffield Solar PV_Live.
import { getJSON, pool, iso, DAY, SLOT, HOUR, floorSlot, dayKey, addDays } from "./core.js";

export const OCT = "https://api.octopus.energy/v1";
export const ELX = "https://data.elexon.co.uk/bmrs/api/v1";
export const CI = "https://api.carbonintensity.org.uk";
export const PVL = "https://api.pvlive.uk/pvlive/api/v4";

export const REGIONS = [
  ["A", "Eastern England", 10], ["B", "East Midlands", 9], ["C", "London", 13], ["D", "Merseyside & N Wales", 6],
  ["E", "West Midlands", 8], ["F", "North East", 4], ["G", "North West", 3], ["H", "Southern", 12], ["J", "South East", 14],
  ["K", "South Wales", 7], ["L", "South West", 11], ["M", "Yorkshire", 5], ["N", "South Scotland", 2], ["P", "North Scotland", 1]
];
const rows = j => Array.isArray(j) ? j : (j && Array.isArray(j.data) ? j.data : (j && Array.isArray(j.results) ? j.results : []));

/* ---------------- Octopus ---------------- */
const FALLBACK = { agile: "AGILE-24-10-01", outgoing: "AGILE-OUTGOING-19-05-13", flexible: "VAR-22-11-01" };
let productsP = null;
export function products() {
  if (productsP) return productsP;
  productsP = (async () => {
    try {
      const list = await allPages(`${OCT}/products/?brand=OCTOPUS_ENERGY&is_variable=true&page_size=100`, 3600e3);
      const okP = p => !p.is_business && !p.is_prepay && !/BB|PREPAY|-B-/.test(p.code);
      const newest = arr => arr.sort((a, b) => (b.available_from || "").localeCompare(a.available_from || ""))[0];
      const agile = newest(list.filter(p => okP(p) && p.code.startsWith("AGILE-") && !p.code.includes("OUTGOING") && p.direction !== "EXPORT"));
      const outgoing = newest(list.filter(p => okP(p) && p.code.includes("AGILE") && (p.code.includes("OUTGOING") || p.direction === "EXPORT")));
      const flexible = newest(list.filter(p => okP(p) && p.code.startsWith("VAR-") && /flexible/i.test(p.display_name || "") && p.direction !== "EXPORT"));
      return { agile: agile?.code || FALLBACK.agile, outgoing: outgoing?.code || FALLBACK.outgoing, flexible: flexible?.code || FALLBACK.flexible };
    } catch (e) { return { ...FALLBACK }; }
  })();
  return productsP;
}
async function allPages(url, ttl = 300e3) {
  const out = []; let next = url, guard = 0;
  while (next && guard++ < 60) { const j = await getJSON(next, { ttl }); out.push(...(j.results || [])); next = j.next; }
  return out;
}
export const tariffCode = (product, reg) => `E-1R-${product}-${reg}`;
const ratesURL = (product, reg, kind, from, to) =>
  `${OCT}/products/${product}/electricity-tariffs/${tariffCode(product, reg)}/${kind}/?page_size=1500` +
  (from ? `&period_from=${iso(from)}` : "") + (to ? `&period_to=${iso(to)}` : "");

/** Agile import: Map(t -> {inc, exc}) */
export async function agileRates(reg, from, to) {
  const P = await products();
  const m = new Map();
  (await allPages(ratesURL(P.agile, reg, "standard-unit-rates", from, to))).forEach(r => m.set(Date.parse(r.valid_from), { inc: r.value_inc_vat, exc: r.value_exc_vat }));
  return m;
}
/** Agile Outgoing: Map(t -> p/kWh) */
export async function outgoingRates(reg, from, to) {
  const P = await products();
  const m = new Map();
  (await allPages(ratesURL(P.outgoing, reg, "standard-unit-rates", from, to))).forEach(r => m.set(Date.parse(r.valid_from), r.value_exc_vat ?? r.value_inc_vat));
  return m;
}
/** Flexible: [{from,to,inc,exc}] (direct debit) */
export async function flexibleRates(reg, from, to) {
  const P = await products();
  return (await allPages(ratesURL(P.flexible, reg, "standard-unit-rates", from, to)))
    .filter(r => !r.payment_method || r.payment_method === "DIRECT_DEBIT")
    .map(r => ({ from: Date.parse(r.valid_from), to: r.valid_to ? Date.parse(r.valid_to) : Infinity, inc: r.value_inc_vat, exc: r.value_exc_vat }))
    .sort((a, b) => a.from - b.from);
}
export async function standingCharge(which, reg) {
  const P = await products();
  const rs = (await allPages(ratesURL(P[which], reg, "standing-charges", Date.now() - 2 * DAY, Date.now() + DAY)))
    .filter(r => !r.payment_method || r.payment_method === "DIRECT_DEBIT")
    .sort((a, b) => Date.parse(b.valid_from) - Date.parse(a.valid_from));
  return rs[0] ? { inc: rs[0].value_inc_vat, exc: rs[0].value_exc_vat } : null;
}
export function flexAt(list, t) { for (let i = list.length - 1; i >= 0; i--) { const r = list[i]; if (t >= r.from && t < r.to) return r; } return null; }

/* ---------------- Elexon ---------------- */
/** Market index price (APX), Map(t -> p/kWh). Elexon rejects very long ranges, so 7-day chunks. */
export async function marketIndex(from, to) {
  const chunks = []; for (let s = from; s < to; s += 7 * DAY) chunks.push([s, Math.min(s + 7 * DAY, to)]);
  const res = await pool(chunks.map(([a, b]) => () => getJSON(`${ELX}/balancing/pricing/market-index?from=${iso(a)}&to=${iso(b)}&dataProviders=APXMIDP&format=json`, { ttl: 300e3 })), 4);
  const m = new Map();
  res.forEach(j => rows(j).forEach(r => {
    if (r.dataProvider && r.dataProvider !== "APXMIDP") return;
    if (!(Number(r.volume) > 0)) return; // zero-volume periods report 0: missing
    const t = Date.parse(r.startTime); if (Number.isFinite(t)) m.set(t, Number(r.price) / 10);
  }));
  return m;
}
/** Latest instantaneous generation by fuel type (FUELINST, 5-minutely). Returns {t, fuels:{CCGT: MW, ...}} */
export async function fuelinstLatest() {
  const now = Date.now();
  const j = await getJSON(`${ELX}/datasets/FUELINST?publishDateTimeFrom=${iso(now - 40 * 60e3)}&publishDateTimeTo=${iso(now + 5 * 60e3)}&format=json`, { ttl: 60e3 });
  const rs = rows(j); if (!rs.length) throw new Error("FUELINST returned no rows");
  let latest = 0; rs.forEach(r => { const t = Date.parse(r.startTime || r.publishTime); if (t > latest) latest = t; });
  const fuels = {};
  rs.forEach(r => { if (Date.parse(r.startTime || r.publishTime) === latest) fuels[r.fuelType] = Number(r.generation); });
  return { t: latest, fuels };
}
/** Generation outturn summary (auto down-sampled by Elexon). [{t, fuels:{...}}] */
export async function outturnSummary(start, end) {
  const j = await getJSON(`${ELX}/generation/outturn/summary?startTime=${iso(start)}&endTime=${iso(end)}&includeNegativeGeneration=true&format=json`, { ttl: 300e3 });
  return rows(j).map(r => { const fuels = {}; (r.data || []).forEach(d => fuels[d.fuelType] = Number(d.generation)); return { t: Date.parse(r.startTime), fuels }; })
    .filter(r => Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
}
/** Half-hourly generation by fuel (FUELHH). Map(t -> {fuel: MW}) */
export async function fuelHH(dateFrom, dateTo, fuelType) {
  const j = await getJSON(`${ELX}/datasets/FUELHH?settlementDateFrom=${dateFrom}&settlementDateTo=${dateTo}${fuelType ? `&fuelType=${fuelType}` : ""}&format=json`, { ttl: 600e3 });
  const m = new Map();
  rows(j).forEach(r => { const t = Date.parse(r.startTime); if (!m.has(t)) m.set(t, {}); m.get(t)[r.fuelType] = Number(r.generation); });
  return m;
}
/** Wind forecast (WINDFOR, latest). Map(t -> MW) half-hourly (hourly values are spread over both halves) */
export async function windForecast(from, to) {
  const j = await getJSON(`${ELX}/forecast/generation/wind/latest?from=${iso(from)}&to=${iso(to)}&format=json`, { ttl: 600e3 });
  const pts = rows(j).map(r => ({ t: Date.parse(r.startTime), v: Number(r.generation) })).filter(p => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
  const m = new Map();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    m.set(floorSlot(a.t), a.v);
    if (b && b.t - a.t > SLOT && b.t - a.t <= 3 * HOUR) for (let t = floorSlot(a.t) + SLOT; t < b.t; t += SLOT) m.set(t, a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t));
  }
  return m;
}
/** Day-ahead national demand forecast (NDF). Map(t -> MW) */
export async function demandForecast(from, to) {
  const j = await getJSON(`${ELX}/forecast/demand/day-ahead/latest?from=${iso(from)}&to=${iso(to)}&format=json`, { ttl: 600e3 });
  const m = new Map(); rows(j).forEach(r => { const t = Date.parse(r.startTime); if (Number.isFinite(t)) m.set(t, Number(r.nationalDemand ?? r.transmissionSystemDemand)); });
  return m;
}
/** Demand outturn (INDO). Map(t -> MW national) */
export async function demandOutturn(dateFrom, dateTo) {
  const j = await getJSON(`${ELX}/demand/outturn?settlementDateFrom=${dateFrom}&settlementDateTo=${dateTo}&format=json`, { ttl: 600e3 });
  const m = new Map(); rows(j).forEach(r => { const t = Date.parse(r.startTime); if (Number.isFinite(t)) m.set(t, Number(r.initialDemandOutturn)); });
  return m;
}
export async function bmUnits() { return rows(await getJSON(`${ELX}/reference/bmunits/all`, { ttl: 24 * 3600e3 })); }
/** Physical notifications for every BMU for one settlement period */
export async function pnAll(date, sp) {
  return rows(await getJSON(`${ELX}/balancing/physical/all?dataset=PN&settlementDate=${date}&settlementPeriod=${sp}&format=json`, { ttl: 120e3 }));
}

/* ---------------- Carbon Intensity ---------------- */
const ciT = t => new Date(t).toISOString().slice(0, 16) + "Z";
/** National intensity, Map(t -> {forecast, actual}) */
export async function ciNational(from, to) {
  const chunks = []; for (let s = from; s < to; s += 13 * DAY) chunks.push([s, Math.min(s + 13 * DAY, to)]);
  const res = await pool(chunks.map(([a, b]) => () => getJSON(`${CI}/intensity/${ciT(a)}/${ciT(b)}`, { ttl: 300e3 })), 3);
  const m = new Map();
  res.forEach(j => rows(j).forEach(r => { const t = Date.parse(r.from); if (Number.isFinite(t)) m.set(t, { forecast: r.intensity?.forecast, actual: r.intensity?.actual, index: r.intensity?.index }); }));
  return m;
}
/** Regional 48h forecast for a CI region id. Map(t -> g/kWh) */
export async function ciRegional48(regionId) {
  const j = await getJSON(`${CI}/regional/intensity/${ciT(floorSlot(Date.now()))}/fw48h/regionid/${regionId}`, { ttl: 600e3 });
  const d = j && j.data && !Array.isArray(j.data) ? j.data : rows(j)[0];
  const m = new Map(); (d?.data || []).forEach(r => m.set(Date.parse(r.from), r.intensity?.forecast));
  return m;
}
export async function ciNational48() {
  const j = await getJSON(`${CI}/intensity/${ciT(floorSlot(Date.now()))}/fw48h`, { ttl: 600e3 });
  const m = new Map(); rows(j).forEach(r => m.set(Date.parse(r.from), r.intensity?.forecast)); return m;
}
export async function ciRegionalNow() { const j = await getJSON(`${CI}/regional`, { ttl: 300e3 }); return rows(j)[0]?.regions || []; }

/* ---------------- Solar (PV_Live, with Elexon fallback) ---------------- */
/** Map(t -> MW) half-hourly national solar estimate */
export async function solar(from, to) {
  try {
    const chunks = []; for (let s = from; s < to; s += 60 * DAY) chunks.push([s, Math.min(s + 60 * DAY, to)]);
    const res = await pool(chunks.map(([a, b]) => () => getJSON(`${PVL}/gsp/0?start=${iso(a)}&end=${iso(b + SLOT)}`, { ttl: 300e3 })), 3);
    const m = new Map();
    res.forEach(j => {
      const meta = j.meta || ["gsp_id", "datetime_gmt", "generation_mw"];
      const it = meta.indexOf("datetime_gmt"), ig = meta.indexOf("generation_mw");
      (j.data || []).forEach(r => { const end = Date.parse(r[it]); if (Number.isFinite(end) && r[ig] != null) m.set(end - SLOT, Number(r[ig])); });
    });
    if (!m.size) throw new Error("PV_Live empty");
    return m;
  } catch (e) {
    const j = await getJSON(`${ELX}/generation/actual/per-type/wind-and-solar?from=${iso(from)}&to=${iso(to)}&format=json`, { ttl: 300e3 });
    const m = new Map(); rows(j).forEach(r => { if (/solar/i.test(r.psrType || "")) m.set(Date.parse(r.startTime), Number(r.quantity)); });
    return m;
  }
}

/* ---------------- fuel groupings ---------------- */
export const FUEL_GROUPS = [ // stack order bottom -> top
  { k: "nuclear", label: "Nuclear", col: "--f-nuclear" },
  { k: "biomass", label: "Biomass", col: "--f-biomass" },
  { k: "gas", label: "Gas", col: "--f-gas" },
  { k: "other", label: "Coal, oil & other", col: "--f-other" },
  { k: "hydro", label: "Hydro & pumped", col: "--f-hydro" },
  { k: "wind", label: "Wind", col: "--f-wind" },
  { k: "solar", label: "Solar", col: "--f-solar" },
  { k: "imports", label: "Interconnectors", col: "--f-imports" }
];
export const IC_COUNTRY = { INTFR: "France", INTIFA2: "France", INTELEC: "France", INTNED: "Netherlands", INTNEM: "Belgium", INTNSL: "Norway", INTVKL: "Denmark", INTIRL: "N. Ireland", INTEW: "Ireland", INTGRNL: "Ireland" };
export const IC_NAME = { INTFR: "IFA", INTIFA2: "IFA2", INTELEC: "ElecLink", INTNED: "BritNed", INTNEM: "Nemo Link", INTNSL: "North Sea Link", INTVKL: "Viking Link", INTIRL: "Moyle", INTEW: "East–West", INTGRNL: "Greenlink" };
export function groupOf(fuelType) {
  const f = String(fuelType || "").toUpperCase();
  if (f.startsWith("INT")) return "imports";
  return { CCGT: "gas", OCGT: "gas", NUCLEAR: "nuclear", WIND: "wind", NPSHYD: "hydro", PS: "hydro", BIOMASS: "biomass", COAL: "other", OIL: "other", OTHER: "other", SOLAR: "solar" }[f] || "other";
}
/** Split a {fuel: MW} record into groups. Pumped storage generation counts in hydro; imports net. */
export function groupFuels(fuels, solarMW) {
  const g = { nuclear: 0, biomass: 0, gas: 0, other: 0, hydro: 0, wind: 0, solar: solarMW || 0, imports: 0 };
  for (const [k, v] of Object.entries(fuels || {})) if (Number.isFinite(v)) g[groupOf(k)] += v;
  return g;
}
