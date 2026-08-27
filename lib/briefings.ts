/**
 * One plain-language brief per rung. The telemetry panels answer "how far" and
 * "how many"; nothing answered "what am I looking at". Kept short on purpose —
 * this is a console, not an article — and every claim here is either measured
 * or explicitly flagged as inferred.
 *
 * `seeing` maps what is literally on screen to what it means, because a field
 * of coloured dots is not self-explanatory no matter how good the legend is.
 */
export type Brief = {
  what: string;
  body: string;
  seeing: [mark: string, meaning: string][];
};

export const BRIEFS: Brief[] = [
  {
    what: 'The Milky Way, from outside',
    body: 'A barred spiral galaxy roughly 100,000 light years across, holding somewhere '
      + 'between 100 and 400 billion stars. The bright core is Sagittarius A*, a black hole '
      + 'of 4.15 million solar masses. You sit 26,700 light years out in the Orion Spur, a '
      + 'minor arm between two major ones. Everything else on this site happens inside that '
      + 'small green crosshair.',
    seeing: [
      ['Dust of white points', 'modelled stellar density, four arms at a 12° pitch'],
      ['Orange core', 'the galactic bulge and Sgr A* — click it'],
      ['Dotted circles', 'galactocentric radius, 10 to 30 thousand light years'],
    ],
  },
  {
    what: 'The Local Bubble — our hole in the interstellar medium',
    body: 'A cavity about 300 light years across, blown clear by supernovae 10 to 20 million '
      + 'years ago. The gas inside is hot and extremely thin, near 0.05 atoms per cubic '
      + 'centimetre — around a hundredth of normal interstellar density. The Sun drifted into '
      + 'it and happens to be near the middle. Every dot here is a real star at its measured '
      + 'parallax distance, so this is a volume rather than a sky map: drag, and the near '
      + 'stars slide against the far ones.',
    seeing: [
      ['Blue-white dots', 'hot stars — O, B and A types'],
      ['Orange dots', 'cool giants and red dwarfs; size is apparent brightness'],
      ['Dashed circle', 'the bubble wall, ≈150 ly out'],
      ['Yellow stars', 'hosts with known planets; an orbit ring marks the nearest — click, then Fly to system'],
    ],
  },
  {
    what: 'The Oort shell — inferred, never seen',
    body: 'A spherical cloud of icy bodies wrapped around the entire solar system, from '
      + 'roughly 2,000 out to 100,000 AU. Not one of its members has ever been observed '
      + 'directly. We know it is there because long-period comets keep arriving from every '
      + 'direction with orbits that trace back to this range. Its outer edge is about a '
      + 'quarter of the way to the nearest star.',
    seeing: [
      ['Faint point cloud', 'a uniform sample for scale — NOT a catalogue of real bodies'],
      ['Dashed rings', 'shell boundaries and distance markers in AU'],
      ['Cyan dashed line', 'bearing and true distance to the nearest star'],
      ['Background stars', 'the real HYG catalogue at infinity — orbit and the sky turns'],
    ],
  },
  {
    what: 'Beyond Neptune',
    body: 'The outer solar system, where orbits take centuries. The band from 30 to 50 AU is '
      + 'the Kuiper Belt, a ring of ice and rock left over from planet formation. Two of the '
      + 'boundaries drawn here are measured rather than modelled: Voyager 1 flew through the '
      + 'termination shock at 94 AU in 2004 and out through the heliopause at 123 AU in 2012, '
      + 'and its instruments recorded both crossings.',
    seeing: [
      ['Cyan irregular shapes', 'real trans-Neptunian objects with published orbits — click any'],
      ['Faint orange band', 'Kuiper Belt density, 30–50 AU'],
      ['Dashed circles', 'termination shock and heliopause, both spacecraft-verified'],
      ['Background stars', 'real catalogued stars, 200,000 AU and beyond'],
    ],
  },
  {
    what: 'The inner system, with the wind blowing through it',
    body: 'Four rocky planets, and the Sun’s atmosphere streaming past all of them. The '
      + 'solar wind leaves the Sun radially but the Sun rotates, so the stream winds into a '
      + 'spiral — the same shape as water from a turning sprinkler. Speed and magnetic field '
      + 'direction here are the live reading from NOAA’s spacecraft at L1, about 1.5 million '
      + 'km sunward of Earth. The view centre has just handed over from the Sun to Earth.',
    seeing: [
      ['Streaking particles', 'live solar wind — cyan when the field points north, red when south'],
      ['Red ellipses', 'real near-Earth asteroid orbits from published elements'],
      ['Bright bloom', 'the Sun, sized by the current X-ray flare class'],
      ['Background stars', 'real catalogued stars, effectively at infinity from here'],
    ],
  },
  {
    what: 'What is coming near Earth',
    body: 'Earth at the centre, and the asteroids JPL is currently tracking past it. Rings are '
      + 'lunar distances — the Moon orbits on the first one. Most of these approaches are still '
      + 'weeks or months away, which is why the rocks are scattered rather than clustered: they '
      + 'are drawn where they actually are right now. Select one and use "Go to encounter" to '
      + 'move mission time to the real moment of closest approach.',
    seeing: [
      ['Red diamonds', 'passing inside 0.01 AU — the close ones'],
      ['Yellow diamonds', 'tracked, passing further out'],
      ['Faded edge diamonds', 'currently off screen; the label carries its live distance'],
      ['Background stars', 'the real sky behind the encounter, fixed at infinity'],
    ],
  },
  {
    what: 'Earth orbit, low to geostationary',
    body: 'Every square is a real satellite, propagated forward from its published orbital '
      + 'elements — so they are where they are now, not where the data was downloaded. The '
      + 'dashed ring at 42,164 km is the one altitude where an orbital period matches a single '
      + 'Earth rotation, which is why that band is crowded. The arc on the sunward side is the '
      + 'magnetopause, where Earth’s magnetic field stops the solar wind; it compresses and '
      + 'relaxes with the live wind pressure.',
    seeing: [
      ['Module and trusses', 'the ISS — crewed, the only station drawn here'],
      ['Flat bar', 'Starlink — one panel, seen edge on'],
      ['Hexagon', 'GPS / GNSS bus'],
      ['Box with a dish', 'geostationary relay, on the 42,164 km ring'],
      ['Green rings on the globe', 'the auroral oval at its current latitude'],
    ],
  },
  {
    what: 'The ground, and the traffic above it',
    body: 'The planet, turning under a fixed view. Earthquakes are the last seven days at '
      + 'magnitude 4.5 and above; the arc running through Japan, the Philippines and Indonesia '
      + 'is the Ring of Fire, where the Pacific plate dives beneath its neighbours. Aircraft are '
      + 'sampled from fifteen major international corridors — no free feed carries every flight '
      + 'on Earth — with confirmed border crossings shown first.',
    seeing: [
      ['Expanding red rings', 'earthquakes, sized by magnitude, shallower than 70 km'],
      ['Yellow dots', 'deep-focus earthquakes, below 70 km'],
      ['Cyan aircraft', 'at cruise, silhouette aligned to its real track'],
      ['Thin arcs', 'the great-circle route each one is actually flying'],
      ['Bars and hexagons', 'satellites overhead — LEO passes 550 km up, inside this view'],
    ],
  },
];

/** Shown in place of the rung brief while a foreign system is focused. */
export function systemBrief(host: string, ly: number, spect: string, n: number): Brief {
  return {
    what: `${host} — a system we have never visited`,
    body: `${host} lies ${ly.toFixed(2)} light years away, spectral type ${spect}, with `
      + `${n} confirmed planet${n === 1 ? '' : 's'}. Everything drawn here comes from the NASA `
      + 'Exoplanet Archive: semi-major axes and periods are published measurements, but orbital '
      + 'orientation almost never is, so the orbits are drawn face on and coplanar. No one has '
      + 'imaged these worlds — they were inferred from the star wobbling or dimming.',
    seeing: [
      ['Central bloom', 'the host star, sized by its published radius, coloured by temperature'],
      ['Cyan dots', 'confirmed planets, sized by radius, moving at their real period'],
      ['Wide green band', 'approximate habitable zone from the star\u2019s luminosity'],
      ['Dotted rings', 'distance markers in AU, scaled to the outermost known orbit'],
    ],
  };
}
