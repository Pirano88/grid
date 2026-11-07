# GB Grid & Agile

One place for Octopus Agile prices and the live state of Great Britain's electricity grid.

**Live:** https://pirano88.github.io/grid/

| Page | What's on it |
|---|---|
| **Prices** | Agile import, Agile Outgoing and Flexible for your region, against the wholesale market; cheapest *and* greenest time to run things; export windows; spread analysis; history |
| **Grid now** | Live price, carbon intensity, demand, generation and interconnector flows; mix by fuel; day/week/month/year charts; records and facts |
| **Map** | Every located power station sized by live output, interconnector flows, and a schematic of estimated flows between regions |
| **Forecast** | Agile price forecast beyond the published prices (with its own accuracy check), wind/demand/carbon outlook, and price alerts |

It's a static site: everything is fetched live in the browser from public APIs, no keys or server.

## Data
- [Octopus Energy API](https://developer.octopus.energy/rest/): Agile, Agile Outgoing, Flexible
- [Elexon Insights](https://bmrs.elexon.co.uk/): generation by fuel, interconnectors, market index price, physical notifications per unit, wind and demand forecasts. Contains BMRS data © Elexon Limited copyright and database right.
- [Carbon Intensity API](https://carbonintensity.org.uk/) (NESO / University of Oxford): national and regional intensity and forecasts
- [Sheffield Solar PV_Live](https://www.solar.sheffield.ac.uk/pvlive/): national solar estimate
- Station locations: [Power Station Dictionary](https://github.com/OSUKED/Power-Station-Dictionary) plus a few newer sites added by hand; coastlines: [Natural Earth](https://www.naturalearthdata.com/)

Inspired by [grid.iamkate.com](https://grid.iamkate.com/).

## Caveats
- Map dot sizes use *declared* output (physical notifications), not metered output.
- Regional flows in the schematic are estimates; GB doesn't publish live internal boundary flows.
- The Agile forecast is a simple statistical model; the Forecast page shows how well it did over the last week.
- Alerts only run while the app is open (there is no server).
