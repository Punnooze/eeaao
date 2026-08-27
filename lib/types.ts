export type SatGroup = 'ISS' | 'GPS' | 'GEO' | 'STL' | 'OWB';

export type SpaceWeather = {
  speed: number;      // km/s
  dens: number;       // protons/cm³
  temp: number;       // K
  src: string;        // spacecraft that produced the reading
  swt: string;        // plasma time tag
  bt: number;         // nT
  bz: number;         // nT, GSM
  mgt: string;        // magnetometer time tag
  kp: number;
  kpts: string;
  g: string;          // NOAA G-scale label
  xray: string;       // flare class, e.g. "B7.3"
  xrt: string;
  aurLat: number;     // peak aurora latitude, °N
  aurPow: number;
  kpSeries: number[];
  vSeries: number[];
};

/** A close approach whose orbit we can actually draw. */
export type Neo = {
  des: string;
  cd: string;         // JPL calendar date, "2026-Oct-31 02:35"
  cdMs: number;
  dist: number;       // nominal miss, AU
  v: number;          // relative velocity, km/s
  h: number;          // absolute magnitude
  cls: string;        // orbit class code
  a: number; e: number; i: number; om: number; w: number; ma: number;
  per: number;        // days
  epoch: number;      // JD
};

/** A close approach we list but cannot plot — no elements fetched. */
export type NeoApproach = Pick<Neo, 'des' | 'cd' | 'dist' | 'v' | 'h'>;

export type SatTle = {
  name: string;
  grp: SatGroup;
  epochMs: number;
  inc: number; raan: number; ecc: number; argp: number; ma: number;
  nrev: number;       // revolutions per day
};

export type Quake = {
  lat: number; lon: number;
  dep: number;        // km
  mag: number;
  place: string;
  time: number;       // ms
};

export type Flight = {
  lat: number; lon: number;
  trk: number;        // degrees
  alt: number;        // feet
  flight: string;
  type: string;
  gs: number;         // knots
  hex: string;
  /** Filled in from adsbdb once the callsign's route is known. */
  orig?: string;      // IATA
  dest?: string;
  origCountry?: string;
  destCountry?: string;
  origLat?: number; origLon?: number;
  destLat?: number; destLon?: number;
  airline?: string;
  /** true = route confirmed to cross a border. undefined = route unknown. */
  intl?: boolean;
};

/** A real trans-neptunian object, so the outer belt is clickable. */
export type Tno = {
  name: string;
  a: number; e: number; i: number; om: number; w: number; ma: number;
  epoch: number;      // JD
  h: number;
  cls: string;
};

export type SatTotals = Record<SatGroup, number>;

export type Snapshot = {
  t: number;                    // when this payload was assembled
  sw: SpaceWeather;
  neo: Neo[];
  neoTab: NeoApproach[];
  neoTotal: number;
  sat: SatTle[];
  satTotals: SatTotals;
  /** CelesTrak groups we could not refresh this cycle. */
  satMissing: string[];
  eq: Quake[];
  eqTotal: number;
  eqTitle: string;
  fl: Flight[];
  flTotal: number;
  /** How many of the plotted aircraft have a confirmed cross-border route. */
  flIntl: number;
  /** Aircraft seen across all sampled corridors, before the cruise filter. */
  flSeen: number;
  flHubs: number;
  tno: Tno[];
  sys: System[];
  /** Which feeds came back stale or failed, so the UI can say so. */
  degraded: string[];
};

/** A confirmed planet, as published. Absent fields are genuinely unknown. */
export type Exoplanet = {
  name: string;
  a: number | null;        // semi-major axis, AU
  period: number | null;   // days
  rade: number | null;     // Earth radii
  masse: number | null;    // Earth masses
  eqt: number | null;      // equilibrium temperature, K
  method: string;
  year: number | null;
};

/** A star with known planets, positioned from its own catalogue coordinates. */
export type System = {
  host: string;
  dist: number;            // parsecs
  ra: number; dec: number;
  x: number; y: number; z: number;   // equatorial cartesian, parsecs
  spect: string;
  teff: number | null;
  srad: number | null;     // solar radii
  smass: number | null;
  planets: Exoplanet[];
};
