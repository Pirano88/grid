import { $, esc, clearCache } from "./core.js";
import { REGIONS } from "./api.js";

const PAGES = { prices: () => import("./prices.js"), grid: () => import("./grid.js"), map: () => import("./map.js"), forecast: () => import("./forecast.js") };
const DEFAULTS = { region: "C", vat: "inc", range: 30, ttView: "both", dur: 4, weight: 50, gridRange: "day", mapView: "geo", alerts: { on: false, below: 0, publish: true } };

export const settings = (() => {
  let s = { ...DEFAULTS };
  try { const saved = JSON.parse(localStorage.getItem("gridAgile") || "{}"); s = { ...s, ...saved, alerts: { ...DEFAULTS.alerts, ...(saved.alerts || {}) } }; } catch (e) {}
  return s;
})();
const listeners = new Set();
export function setSetting(k, v) {
  settings[k] = v;
  try { localStorage.setItem("gridAgile", JSON.stringify(settings)); } catch (e) {}
  listeners.forEach(fn => fn(k, v));
}
export const onSetting = fn => listeners.add(fn);
export const regionInfo = () => REGIONS.find(r => r[0] === settings.region) || REGIONS[2];

const statusByPage = {};
export function setStatus(page, html) { statusByPage[page] = html; if (current === page) $("#status").innerHTML = html || ""; }

const loaded = {}; let current = null;
async function show(page) {
  if (!PAGES[page]) page = "prices";
  current = page;
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("on", p.id === "page-" + page));
  document.querySelectorAll("#tabs a").forEach(a => a.classList.toggle("on", a.dataset.page === page));
  $("#status").innerHTML = statusByPage[page] || "";
  try {
    if (!loaded[page]) { loaded[page] = await PAGES[page](); loaded[page].init($("#page-" + page)); }
    else loaded[page].show?.();
  } catch (e) {
    console.error(e);
    $("#page-" + page).innerHTML = `<div class="card"><div class="err">This page failed to start: ${esc(e.message)}</div></div>`;
  }
  window.scrollTo({ top: 0 });
}

$("#region").innerHTML = REGIONS.map(([c, n]) => `<option value="${c}">${c} · ${n}</option>`).join("");
$("#region").value = settings.region;
$("#region").addEventListener("change", e => setSetting("region", e.target.value));
$("#refresh").addEventListener("click", async () => {
  const b = $("#refresh"); b.classList.add("spin"); clearCache();
  try { await loaded[current]?.refresh?.(); } finally { b.classList.remove("spin"); }
});
window.addEventListener("hashchange", () => show(location.hash.slice(1)));
let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => loaded[current]?.redraw?.(), 150); });
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => loaded[current]?.redraw?.());
document.addEventListener("visibilitychange", () => { if (!document.hidden) loaded[current]?.tick?.(true); });
setInterval(() => { if (!document.hidden) Object.entries(loaded).forEach(([k, m]) => m.tick?.(k === current)); }, 60e3);

show(location.hash.slice(1) || "prices");

// alerts run in the background of whichever page is open
import("./alerts.js").then(m => m.start()).catch(e => console.warn("alerts", e));
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
