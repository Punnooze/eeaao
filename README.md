# Four Regimes

A log-scale descent from the heliosphere to the ground. One scalar
`L = log10(view half-width in km)` drives the whole view; four data regimes
crossfade as it moves.

| Regime | Half-width | Data |
|---|---|---|
| Heliosphere | 1.9 AU | NOAA SWPC solar wind, Kp, X-ray flux |
| Encounter radar | 0.025 AU | JPL SSD/CNEOS close approaches + SBDB elements |
| Geocentric map | 62,000 km | CelesTrak TLEs, propagated |
| Surface watch | 4,200 km | USGS seismic, adsb.lol traffic |

## Run

    npm install
    npm run dev

## Data

Every feed is public and keyless. Route handlers under `app/api/*` proxy and
cache them — CelesTrak in particular is not reliably CORS-open from a browser,
and caching keeps request volume polite. Cache windows live in `lib/sources.ts`.

Satellites and asteroids are **propagated** from their published epochs, so
they move correctly between refetches. Seismic, traffic and space-weather
readings are point-in-time and refresh on their own cadence.

Approximations, all deliberate: satellites use TLE mean elements plus J2 nodal
regression, not full SGP4 (good to tens of km, invisible at these scales);
planets use circular mean elements.
