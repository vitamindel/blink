export type BandKey = "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "all";

export interface Target {
  slug: string;
  name: string;
  ra: number;
  dec: number;
  pmra: number;
  pmdec: number;
  ref_epoch: number;
  kind: string;
  blurb: string;
  ra_now: number;
  dec_now: number;
}

export interface BandFrame {
  n: number;
  wave_min_um: number;
  wave_max_um: number;
  contamination?: Record<string, number>;
  data?: string; // base64 little-endian float32
  noise?: number;
  unit?: string;
}

export interface EpochFrame {
  index: number;
  mjd_start: number;
  mjd_end: number;
  mjd_mid: number;
  date_start: string;
  date_end: string;
  date_mid: string;
  year_mid: number;
  n_exposures: number;
  collections: string[];
  detectors: Record<string, number>;
  bands: Partial<Record<BandKey, BandFrame>>;
}

export interface ExposureMeta {
  uid: string;
  obs_id: string;
  detector: number;
  mjd: number;
  date: string;
  collection: string;
  wave_um: number | null;
  exptime_s: number;
  qa: Record<string, string | number | boolean>;
}

export interface Flipbook {
  release: string;
  ra: number;
  dec: number;
  fov_deg: number;
  width: number;
  height: number;
  pixel_scale_arcsec: number;
  unit: string;
  wcs: { crval: [number, number]; crpix: [number, number]; cdelt: [number, number]; ctype: string[] };
  n_exposures: number;
  versions: string[];
  epochs: EpochFrame[];
  exposures: ExposureMeta[];
  target: Target;
}

export interface Job {
  id: string;
  status: "running" | "done" | "error";
  stage: string;
  i: number;
  n: number;
  error?: string;
  target: Target;
}

export interface TrackPoint {
  year: number;
  x: number;
  y: number;
  ex: number;
  ey: number;
}

export interface Source {
  id: number;
  x: number;
  y: number;
  ra: number;
  dec: number;
  snr: number;
  saturated: boolean;
  n_epochs: number;
  detectors?: string;
  t_ref?: number;
  pmra?: number;
  pmdec?: number;
  epmra?: number;
  epmdec?: number;
  pm?: number;
  epm?: number;
  pm_sig?: number;
  chi2nu?: number;
  track?: TrackPoint[];
  replaced?: string;
  gaia_veto?: boolean;
  gaia?: { source_id: string; g: number; pmra: number | null; pmdec: number | null; pm: number | null; sep_arcsec: number };
}

export interface Analysis {
  t_ref: number;
  epochs: { index: number; year: number; n_exposures: number; offset_px: [number, number]; date: string }[];
  sources: Source[];
  movers: number[];
  rejected_by_gaia?: number[];
  n_measured?: number;
  gaia_comparison: {
    n: number;
    median_dpmra?: number;
    median_dpmdec?: number;
    robust_scatter_mas_yr?: number;
    scatter?: { pm: number; gaia_pm: number; epm: number }[];
  };
  n_gaia: number;
  sys_px: number;
}

export interface PhotPoint {
  i: number;
  mjd: number;
  year: number;
  detector: number;
  wave_um: number;
  flux_ujy: number;
  eflux_ujy: number;
  chi2nu: number;
  contaminated: boolean;
  masked: boolean;
}

export interface LcPoint {
  epoch: number;
  year: number;
  detector: number;
  n: number;
  flux_ujy: number;
  eflux_ujy: number;
  wave_min_um: number | null;
  wave_max_um: number | null;
  method?: "psf" | "wing";
  full_coverage?: boolean;
}

export interface Photometry {
  ra: number;
  dec: number;
  exposures: PhotPoint[];
  lightcurve: LcPoint[];
  unit: string;
  saturated?: boolean;
}

export interface Candidate {
  rank: number;
  kind: "source" | "dipole";
  source_id?: number;
  x: number;
  y: number;
  ra: number;
  dec: number;
  score: number; // server (onnxruntime) score
  snr?: number;
  pm?: number;
  epm?: number;
  pm_sig?: number;
  gaia_pm?: number | null;
  sep_px?: number;
  stamp?: string; // base64 float32 [6,21,21]
  browserScore?: number; // re-scored in the browser (onnxruntime-web)
}

export interface Candidates {
  pair: { a_year: number; b_year: number } | null;
  candidates: Candidate[];
  model: boolean;
  stamp_shape: [number, number, number];
  threshold: number;
}

export interface AsteroidVisit {
  mjd: number;
  n_exposures: number;
  detectors: number[];
  objects: { name: string; number?: number; cls?: string; vmag?: number; ra: number; dec: number }[];
}
export interface Asteroids {
  n_visits: number;
  n_objects: number;
  visits: AsteroidVisit[];
  vmax: number;
}
