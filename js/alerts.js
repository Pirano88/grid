// Price alerts: checked every few minutes while the app is open (no server, so nothing fires when it's closed).
import { $, dayKey, addDays, londonMidnight, hm, dayShort, floorSlot, SLOT, f2, mean, esc } from "./core.js";
import { settings, setSetting } from "./app.js";
import { loadPrices } from "./store.js";

const SENT_KEY = "gridAgileSent";
let sent = {}; try { sent = JSON.parse(localStorage.getItem(SENT_KEY) || "{}"); } catch (e) {}
const markSent = k => { sent[k] = Date.now(); for (const [kk, t] of Object.entries(sent)) if (Date.now() - t > 3 * 864e5) delete sent[kk]; try { localStorage.setItem(SENT_KEY, JSON.stringify(sent)); } catch (e) {} };
const supported = () => "Notification" in window;

async function notify(title, body, tag) {
  if (!supported() || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg) { await reg.showNotification(title, { body, tag, icon: "icons/icon-192.png", badge: "icons/icon-192.png" }); return true; }
    new Notification(title, { body, tag, icon: "icons/icon-192.png" }); return true;
  } catch (e) { console.warn("notify", e); return false; }
}

export function start() { check(); setInterval(check, 5 * 60e3); }
async function check() {
  const A = settings.alerts; if (!A.on || !supported() || Notification.permission !== "granted") return;
  let S; try { S = await loadPrices(7, settings.region); } catch (e) { return; }
  const now = Date.now(), price = t => S.agile.get(t)?.inc;
  // 1) a run of slots below the threshold starting within the next 20 minutes (or now)
  for (let t = floorSlot(now); t <= now + 20 * 60e3; t += SLOT) {
    const v = price(t); if (v == null || v >= A.below) continue;
    if (price(t - SLOT) != null && price(t - SLOT) < A.below && t > floorSlot(now)) continue; // only the start of a run
    let end = t; while (price(end + SLOT) != null && price(end + SLOT) < A.below) end += SLOT;
    const key = `run|${settings.region}|${t}`;
    if (sent[key]) break;
    const vals = []; for (let k = t; k <= end; k += SLOT) vals.push(price(k));
    if (await notify(`Agile ${t <= now ? "is" : "drops to"} ${f2(v)}p ${t <= now ? "now" : "at " + hm(t)}`, `Below ${A.below}p from ${hm(t)} to ${hm(end + SLOT)} (avg ${f2(mean(vals))}p/kWh, lowest ${f2(Math.min(...vals))}p).`, key)) markSent(key);
    break;
  }
  // 2) tomorrow's prices published
  if (A.publish) {
    const tk = addDays(dayKey(now), 1), t0 = londonMidnight(tk), t1 = londonMidnight(addDays(tk, 1));
    const key = `pub|${settings.region}|${tk}`;
    if (!sent[key] && S.agile.has(t1 - SLOT)) {
      const slots = []; for (let t = t0; t < t1; t += SLOT) if (price(t) != null) slots.push({ t, v: price(t) });
      let best = null; for (let i = 0; i + 4 <= slots.length; i++) { const m = mean(slots.slice(i, i + 4).map(s => s.v)); if (!best || m < best.m) best = { m, t: slots[i].t }; }
      const below = slots.filter(s => s.v < A.below).length;
      if (await notify(`Tomorrow's Agile prices are out`, `Avg ${f2(mean(slots.map(s => s.v)))}p · cheapest 2 h from ${hm(best.t)} (${f2(best.m)}p)` + (below ? ` · ${below} half-hours below ${A.below}p` : ""), key)) markSent(key);
    }
  }
}

export function renderAlertSettings(el) {
  const A = settings.alerts;
  const perm = supported() ? Notification.permission : "unsupported";
  el.innerHTML = `
    <h2>Price alerts</h2>
    <div class="sub">A phone notification when Agile drops below your threshold, and when tomorrow's prices come out. Inc VAT, your region.</div>
    <div class="row" style="justify-content:flex-start;gap:16px">
      <label class="inline"><input type="checkbox" id="a-on" ${A.on ? "checked" : ""}> Alerts on</label>
      <label class="inline">Below <input type="number" id="a-below" step="0.5" value="${A.below}"> p/kWh</label>
      <label class="inline"><input type="checkbox" id="a-pub" ${A.publish ? "checked" : ""}> Tomorrow's prices published</label>
      <button id="a-test">Send a test</button>
    </div>
    <div class="note" id="a-state"></div>
    <div class="note">How it works: there's no server, so alerts are checked by this page every 5 minutes while it's open (a background tab counts, but Android may pause it after a while). For the best results, add the app to your home screen and leave it open.</div>`;
  const state = () => {
    const p = supported() ? Notification.permission : "unsupported";
    $("#a-state", el).innerHTML = p === "unsupported" ? `<span class="err">This browser doesn't support notifications.</span>` : p === "denied" ? `<span class="err">Notifications are blocked for this site. Allow them in your browser's site settings.</span>` : p === "granted" ? (settings.alerts.on ? "Alerts are on." : "Notifications allowed; alerts are off.") : "Turning alerts on will ask for permission to send notifications.";
  };
  const save = patch => setSetting("alerts", { ...settings.alerts, ...patch });
  $("#a-on", el).onchange = async e => {
    if (e.target.checked && supported() && Notification.permission !== "granted") { const r = await Notification.requestPermission(); if (r !== "granted") e.target.checked = false; }
    save({ on: e.target.checked }); state(); if (e.target.checked) check();
  };
  $("#a-below", el).onchange = e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) save({ below: v }); };
  $("#a-pub", el).onchange = e => save({ publish: e.target.checked });
  $("#a-test", el).onclick = async () => {
    if (supported() && Notification.permission !== "granted") await Notification.requestPermission();
    const okSent = await notify("Test alert", `Alerts work. You'll hear from this when Agile drops below ${settings.alerts.below}p.`, "test");
    $("#a-state", el).innerHTML = okSent ? "Test sent." : `<span class="err">Couldn't send a notification here.</span>`;
  };
  state(); void perm; void esc; void dayShort;
}
