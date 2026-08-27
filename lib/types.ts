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
  /** Which feeds came back stale or failed, so the UI can say so. */
  degraded: string[];
};
