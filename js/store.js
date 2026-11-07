// Shared price data so Prices, Forecast and alerts don't each refetch.
import { dayKey, addDays, londonMidnight, DAY, SLOT, floorSlot } from "./core.js";
import * as api from "./api.js";
import { settings, regionInfo } from "./app.js";

const memo = new Map();
/** Prices for the last `range` days through tomorrow. */
export function loadPrices(range = settings.range, region = settings.region, force = false) {
  const key = `${region}|${range}`;
  const hit = memo.get(key);
  if (!force && hit && Date.now() - hit.t < 10 * 60e3) return hit.p;
  const p = (async () => {
    const today = dayKey(Date.now());
    const from = londonMidnight(addDays(today, -range + 1)), to = londonMidnight(addDays(today, 2));
    const jobs = {
      agile: api.agileRates(region, from, to),
      out: api.outgoingRates(region, from, to),
      flex: api.flexibleRates(region, from - 400 * DAY, to),
      mkt: api.marketIndex(from, Math.min(to, Date.now() + SLOT)),
      sA: api.standingCharge("agile", region),
      sF: api.standingCharge("flexible", region),
      ci: api.ciRegional48(regionInfo()[2]).catch(() => api.ciNational48())
    };
    const keys = Object.keys(jobs), res = await Promise.allSettled(Object.values(jobs));
    const S = { region, range, from, to, errors: {}, loadedAt: Date.now(), products: await api.products() };
    res.forEach((r, i) => { if (r.status === "fulfilled") S[keys[i]] = r.value; else S.errors[keys[i]] = r.reason?.message || "failed"; });
    S.agile ||= new Map(); S.out ||= new Map(); S.mkt ||= new Map(); S.flex ||= []; S.ci ||= new Map();
    S.lastAgile = Math.max(0, ...S.agile.keys());
    S.lastOut = Math.max(0, ...S.out.keys());
    return S;
  })();
  memo.set(key, { t: Date.now(), p });
  p.catch(() => memo.delete(key));
  return p;
}
export function invalidatePrices() { memo.clear(); }
export const flexAt = (S, t) => api.flexAt(S.flex, t);
export const nowSlot = () => floorSlot(Date.now());
