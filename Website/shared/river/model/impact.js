// Ensemble "parcel" model of sewage-overflow impact along the Thames.
// Full write-up with equations: methodology.html (src/methodology.js).
//
// 1. EMISSION  Each overflow releases a parcel every 15 min while it is (or is
//    forecast to be) discharging. Weight = spill-hours × strength factor.
// 2. TRANSPORT Parcels move down the OS centreline at v = a·Q^b from EA flow;
//    below Teddington they slosh with the tide (phased by predicted high
//    waters) plus a slow seaward drift.
// 3. DECAY     Bacterial die-off: × 10^(−age / T90).
// 4. SPREAD    Gaussian dispersion, σ² = σ0² + 2·D·age.
// 5. INDEX     I(x,t) = Σ parcels weight·decay·N(x; position, σ²)  [SH/km]
//
// UNCERTAINTY: run 0 uses central values ("central estimate") with forecast
// spills weighted by their probability. Runs 1..M draw every uncertain input
// at random (seeded, so browser and alert server agree) and forecast spills
// happen or not. Across runs 1..M we report mean, SD, 10th/90th percentiles
// and the share of runs reaching each level (= its probability).
//
// EDM says *that* an overflow operated, not how much. Spill strength is
// therefore an uncertain multiplier (volumeSigma), not a measured volume.

import { CONFIG } from '../config.js';
import { snapToRiver } from './river.js';
import { rainFor } from '../data/util.js';

const H = 3600e3;
const SQRT2PI = Math.sqrt(2 * Math.PI);

// ------------------------------------------------- seeded random numbers
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(rand) { // Box–Muller
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export const LEVELS = ['clear', 'low', 'moderate', 'high'];
export function levelOf(v) {
  const T = CONFIG.impact.thresholds;
  return v >= T.high ? 'high' : v >= T.moderate ? 'moderate' : v >= T.low ? 'low' : 'clear';
}

export class ImpactModel {
  constructor(river, waypoints) {
    this.river = river;
    const tl = waypoints.find((w) => w.name === CONFIG.river.tidalLimitWaypoint);
    this.tidalLimitKm = tl ? snapToRiver(river, tl.c).chainage : Infinity;
  }

  /**
   * @param inp { now, overflows, gauges, highWaters, rain, propensity, thresholds?, members?, trackSourcesHours? }
   */
  run(inp) {
    const C = CONFIG, U = C.uncertainty;
    const { now } = inp;
    const dtH = C.sim.stepMinutes / 60;
    const stepsPerFrame = Math.round(C.sim.frameMinutes / C.sim.stepMinutes);
    const simStart = now - C.thamesWater.recentWindowHours * H;
    const frameStart = now - C.sim.pastHours * H;
    const F = Math.round((C.sim.pastHours + C.sim.horizonHours) * 60 / C.sim.frameMinutes) + 1;
    const frameStartStep = Math.round((frameStart - simStart) / (dtH * H));
    const Nsteps = frameStartStep + (F - 1) * stepsPerFrame + 1;
    const S = this.river.samples.length;
    const sp = this.river.spacingKm;
    const M = inp.members ?? U.members;

    Object.assign(this, { now, dtH, simStart, frameStart, F, S, sp, M, stepsPerFrame, frameStartStep, Nsteps });
    this.frameTime = (f) => frameStart + f * C.sim.frameMinutes * 60e3;
    this.frameAt = (t) => Math.max(0, Math.min(F - 1, Math.round((t - frameStart) / (C.sim.frameMinutes * 60e3))));
    this.kAt = (t) => Math.round((t - simStart) / (dtH * H));

    this.velocity = this.#velocityField(inp.gauges ?? []);
    this.hw = (inp.highWaters?.times ?? []).filter(Number.isFinite).sort((a, b) => a - b);
    this.tideQuality = inp.highWaters?.quality ?? 'fallback';
    this.#prepareSites(inp);

    // seed from the hour so map and alert server draw the same ensemble
    const rand = mulberry32(Math.floor(now / H) * 2654435761);
    const memberParams = [this.#centralParams()];
    for (let m = 1; m <= M; m++) memberParams.push(this.#drawParams(rand));

    const FS = F * S;
    this.central = { obs: new Float32Array(FS), fcst: new Float32Array(FS) };
    const totals = []; // per random member: Float32Array(FS)
    this.sources = inp.trackSourcesHours ? new Map() : null;
    const spillCounts = this.sites.map(() => ({ d1: 0, d7: 0 }));

    memberParams.forEach((P, m) => {
      const parcels = this.#emit(P, m, spillCounts);
      const fields = this.#transport(parcels, P, m === 0 && inp.trackSourcesHours);
      if (m === 0) this.central = fields;
      else {
        const tot = fields.obs;
        for (let i = 0; i < FS; i++) tot[i] += fields.fcst[i];
        totals.push(tot);
      }
    });

    this.sites.forEach((s, i) => {
      s.pSpill24h = M ? spillCounts[i].d1 / M : 0;
      s.pSpill7d = M ? spillCounts[i].d7 / M : 0;
    });
    this.summary = this.#summarise(totals);
    return this;
  }

  // ------------------------------------------------------------ params
  #centralParams() {
    const C = CONFIG;
    return {
      central: true, vf: 1, t90: C.decay.t90Hours, D: C.decay.dispersionKm2PerHour,
      E: C.tide.excursionKm, net: C.tide.netSeawardKmPerDay, phaseH: 0,
      ongoingH: C.thamesWater.assumedOngoingHours, rainDay: () => 1,
      volume: () => 1, u: () => 0,
    };
  }
  #drawParams(rand) {
    const C = CONFIG, U = C.uncertainty;
    const ln = (sigma) => Math.exp(sigma * normal(rand));
    const rainDays = Array.from({ length: 10 }, (_, d) => ln(U.rainSigmaDay0 + U.rainSigmaPerDay * d));
    const vol = this.sites.map(() => ln(U.volumeSigma));
    const u = this.sites.map(() => rand());
    return {
      central: false,
      vf: ln(U.velocitySigma),
      t90: C.decay.t90Hours * ln(U.t90Sigma),
      D: C.decay.dispersionKm2PerHour * ln(U.dispersionSigma),
      E: Math.max(0, C.tide.excursionKm * (1 + U.excursionSd * normal(rand))),
      net: C.tide.netSeawardKmPerDay * ln(U.netDriftSigma),
      phaseH: (U.phaseSdHours[this.tideQuality] ?? U.phaseSdHours.fallback) * normal(rand),
      ongoingH: C.thamesWater.assumedOngoingHours * ln(U.ongoingSigma),
      rainDay: (t) => rainDays[Math.max(0, Math.min(9, Math.floor((t - this.now) / (24 * H))))],
      volume: (i) => vol[i],
      u: (i) => u[i],
    };
  }

  // -------------------------------------------------------------- sites
  #prepareSites({ overflows, rain, propensity = {}, thresholds = {} }) {
    const C = CONFIG, F = C.forecast;
    const filt = C.river.receivingWaterFilter.map((s) => s.toLowerCase());
    const hyd = C.hydraulics;
    this.sites = overflows
      .map((o) => ({ ...o, snap: snapToRiver(this.river, o.position) }))
      .filter((o) => o.snap.offKm <= C.river.snapMaxKm)
      .filter((o) => !filt.length || filt.some((f) => (o.receivingWater ?? '').toLowerCase().includes(f)));

    for (const s of this.sites) {
      s.delayH = (s.snap.offKm * hyd.tributarySinuosity * 1000) / hyd.tributaryVelocity / 3600;
      // base spill probability (propensity from EA annual returns, if available)
      let base = F.siteBase;
      const q = propensity[s.normName ?? ''] ?? propensity[s.id];
      if (Number.isFinite(q)) base = Math.min(1, F.siteBase * (0.5 + q));
      if (s.past48h || s.status === 'discharging') base = Math.min(1, base * F.recentBoost);
      s.base = base;
      // spill trigger: this overflow's own rainfall threshold (team analysis) or the shared curve
      s.trigger = this.#triggerFor(thresholds[s.normName ?? ''] ?? thresholds[s.id]);
      // rolling rainfall totals for each forecast hour
      const series = rainFor(rain, s.position);
      s.rainHours = [];
      if (series) {
        const { times, rain: r } = series;
        for (let i = 0; i < times.length; i++) {
          if (times[i] <= this.now || times[i] > this.now + C.sim.horizonHours * H) continue;
          let acc = 0;
          for (let j = Math.max(0, i - s.trigger.windowH + 1); j <= i; j++) acc += r[j] ?? 0;
          s.rainHours.push({ t: times[i], acc });
        }
      }
      s.forecast = s.rainHours.map(({ t, acc }) => ({ t, p: this.#pSpill(s, acc), rainMm: acc })).filter((f) => f.p > 0);
    }
  }
  /**
   * The rain → spill-chance curve for one overflow.
   * th = { min, avg, n } from the team's rainfall-threshold analysis (24-h rain
   * before this overflow's past spills), or undefined.
   *   team:   onset = lowest trigger rain (not below minRainMm), r50 = average trigger rain,
   *           slope chosen so the chance is onsetShare of the site's maximum at the onset
   *   shared: CONFIG.forecast.accumHours / r50mm / slopeMm
   */
  #triggerFor(th) {
    const F = CONFIG.forecast, T = F.thresholds;
    const shared = { source: 'shared', windowH: F.accumHours, r50: F.r50mm, slope: F.slopeMm };
    if (!T?.enabled || !th) return shared;
    const min = Number(th.min), avg = Number(th.avg), n = Number(th.n);
    if (!(n >= T.minSpills) || !Number.isFinite(min) || !Number.isFinite(avg) || !(avg > 0)) return shared;
    const onset = Math.max(min, F.minRainMm);
    const r50 = Math.max(avg, onset);
    const odds = Math.log((1 - T.onsetShare) / T.onsetShare); // logistic = onsetShare this many slopes below r50
    const slope = Math.min(T.maxSlopeMm, Math.max(T.minSlopeMm, (r50 - onset) / odds));
    return { source: 'team', windowH: T.windowHours, r50, slope, minMm: min, avgMm: avg, spills: n };
  }
  #pSpill(site, acc) {
    const F = CONFIG.forecast, g = site.trigger;
    if (acc < F.minRainMm) return 0;
    const p = site.base / (1 + Math.exp(-(acc - g.r50) / g.slope));
    return p >= F.minProbability ? p : 0;
  }

  // ----------------------------------------------------------- emission
  #emit(P, m, spillCounts) {
    const C = CONFIG, dtH = this.dtH, N = this.Nsteps;
    const parcels = [];
    this.sites.forEach((s, si) => {
      const delaySteps = Math.round(s.delayH / dtH);
      const vol = P.volume(si);
      const add = (k, w, kind) => {
        if (w > 0 && k < N) parcels.push({ si, kRel: k, kEnter: k + delaySteps, w: w * vol, kind, entry: s.snap.chainage });
      };
      // observed (EDM)
      let obsEndK = -1;
      const ow = s.status === 'offline' ? C.thamesWater.offlineWeight : 1;
      if (ow > 0 && s.start) {
        const ongoing = s.status === 'discharging' || !s.stop || s.stop < s.start;
        const end = ongoing ? this.now + P.ongoingH * H : s.stop;
        if (end >= this.simStart) {
          const k0 = Math.max(0, this.kAt(s.start)), k1 = Math.min(N - 1, this.kAt(end));
          for (let k = k0; k <= k1; k++) add(k, ow * dtH, 'obs');
          obsEndK = k1;
        }
      }
      // forecast (rain-driven), released hourly
      let spilled24 = false, spilled7 = false;
      for (const { t, acc } of s.rainHours) {
        const k = this.kAt(t);
        if (k <= obsEndK) continue;
        const p = this.#pSpill(s, acc * P.rainDay(t));
        if (!p) continue;
        if (P.central) add(k, p * 1, 'fcst'); // expected value
        else if (P.u(si) < p) {             // this run: spill happens
          add(k, 1, 'fcst');
          spilled7 = true;
          if (t <= this.now + 24 * H) spilled24 = true;
        }
      }
      if (!P.central) {
        if (spilled24) spillCounts[si].d1++;
        if (spilled7) spillCounts[si].d7++;
      }
    });
    return parcels;
  }

  // ---------------------------------------------------------------- tide
  /** seaward displacement (km) relative to the parcel's mean position */
  #tideDisp(t, P) {
    const per = CONFIG.tide.periodHours * H;
    const tt = t + P.phaseH * H;
    const hw = this.hw;
    let phase;
    if (hw.length >= 2 && tt >= hw[0] && tt < hw[hw.length - 1]) {
      let i = 1;
      while (hw[i] <= tt) i++;
      const a = hw[i - 1], b = hw[i];
      const gap = b - a;
      // consecutive predicted HWs (≈12.4 h apart): interpolate phase between them
      phase = gap > 0.6 * per && gap < 1.5 * per ? (2 * Math.PI * (tt - a)) / gap
        : (2 * Math.PI * (tt - a)) / per;
    } else {
      const ref = hw.length ? (tt < hw[0] ? hw[0] : hw[hw.length - 1]) : this.now;
      phase = (2 * Math.PI * (tt - ref)) / per;
    }
    return -(P.E / 2) * Math.cos(phase); // most upstream at high water
  }

  // ------------------------------------------- transport + accumulation
  #transport(parcels, P, trackSources) {
    const C = CONFIG, U = C.uncertainty;
    const { river, velocity, dtH, tidalLimitKm, F, S, sp, stepsPerFrame, frameStartStep, Nsteps } = this;
    const L = river.lengthKm;
    const net = P.net / 24; // km/h
    const classes = U.ageClassesH;
    const nC = classes.length;
    const cls = (age) => { let c = nC - 1; while (c > 0 && age < classes[c]) c--; return c; };
    const maxAgeH = P.t90 * Math.log10(1 / U.decayCutoff);
    const maxAgeSteps = Math.ceil(maxAgeH / dtH);

    // histograms: [kind][frame][class] -> Map(bin -> load)
    const hist = { obs: new Map(), fcst: new Map() };
    const deposit = (kind, f, c, bin, v) => {
      const key = f * nC + c;
      let h = hist[kind].get(key);
      if (!h) hist[kind].set(key, (h = new Map()));
      h.set(bin, (h.get(bin) ?? 0) + v);
    };
    const trackUntil = trackSources ? this.frameAt(this.now + trackSources * H) : -1;
    const fNow = this.frameAt(this.now);

    for (const p of parcels) {
      let c = p.entry, tidal = c >= tidalLimitKm, mean = NaN;
      const kEnd = Math.min(Nsteps - 1, p.kRel + maxAgeSteps);
      for (let k = Math.max(0, p.kEnter); k <= kEnd; k++) {
        const t = this.simStart + k * dtH * H;
        if (tidal) {
          if (Number.isNaN(mean)) mean = c - this.#tideDisp(t, P);
          else mean += net * dtH;
          c = Math.max(tidalLimitKm, mean + this.#tideDisp(t, P)); // weir blocks upstream travel
        } else if (k > p.kEnter) {
          const vi = Math.max(0, Math.min(velocity.length - 1, Math.round(c / sp)));
          c += velocity[vi] * P.vf * 3.6 * dtH; // m/s -> km/h
          if (c >= tidalLimitKm) tidal = true;
        }
        if (c > L) break; // left the modelled estuary
        const rel = k - frameStartStep;
        if (rel < 0 || rel % stepsPerFrame) continue;
        const f = rel / stepsPerFrame;
        const age = (k - p.kRel) * dtH;
        const load = p.w * Math.pow(10, -age / P.t90);
        const bin = Math.round(c / sp);
        deposit(p.kind, f, cls(age), bin, load);
        if (trackSources && f >= fNow && f <= trackUntil) {
          if (!this.sources.has(f)) this.sources.set(f, []);
          this.sources.get(f).push([p.si, bin, load]);
        }
      }
    }

    // convolve each (frame, age class) histogram with its Gaussian kernel
    const sig0 = C.decay.minSigmaKm;
    const kernels = classes.map((lo, i) => {
      const hi = classes[i + 1] ?? lo * 2 + 24;
      const sigma = Math.sqrt(sig0 * sig0 + 2 * P.D * ((lo + hi) / 2));
      const half = Math.ceil((3 * sigma) / sp);
      const k = new Float32Array(2 * half + 1);
      for (let j = -half; j <= half; j++) k[j + half] = Math.exp(-0.5 * ((j * sp) / sigma) ** 2) / (SQRT2PI * sigma);
      return { half, k };
    });
    const out = {};
    for (const kind of ['obs', 'fcst']) {
      const field = new Float32Array(F * S);
      for (const [key, h] of hist[kind]) {
        const f = Math.floor(key / nC), { half, k } = kernels[key % nC];
        const row = f * S;
        for (const [bin, load] of h) {
          const i0 = Math.max(0, bin - half), i1 = Math.min(S - 1, bin + half);
          for (let i = i0; i <= i1; i++) field[row + i] += load * k[i - bin + half];
        }
      }
      out[kind] = field;
    }
    return out;
  }

  // ---------------------------------------------------- ensemble summary
  #summarise(totals) {
    const { F, S } = this, M = totals.length, FS = F * S;
    const T = CONFIG.impact.thresholds;
    const mk = () => new Float32Array(FS);
    const s = { mean: mk(), sd: mk(), p10: mk(), p90: mk(), pLow: mk(), pMod: mk(), pHigh: mk() };
    if (!M) return s;
    const vals = new Float32Array(M);
    const i10 = Math.max(0, Math.round(0.1 * (M - 1))), i90 = Math.min(M - 1, Math.round(0.9 * (M - 1)));
    for (let i = 0; i < FS; i++) {
      let sum = 0, sum2 = 0, nl = 0, nm = 0, nh = 0, any = false;
      for (let m = 0; m < M; m++) {
        const v = totals[m][i];
        vals[m] = v;
        if (v) any = true;
        sum += v; sum2 += v * v;
        if (v >= T.low) nl++;
        if (v >= T.moderate) nm++;
        if (v >= T.high) nh++;
      }
      if (!any) continue;
      const mean = sum / M;
      s.mean[i] = mean;
      s.sd[i] = Math.sqrt(Math.max(0, sum2 / M - mean * mean));
      vals.sort();
      s.p10[i] = vals[i10];
      s.p90[i] = vals[i90];
      s.pLow[i] = nl / M; s.pMod[i] = nm / M; s.pHigh[i] = nh / M;
    }
    return s;
  }

  // --------------------------------------------------------- read-outs
  /** Everything at one river bin and frame. */
  at(f, i) {
    const j = f * this.S + i, s = this.summary;
    const obs = this.central.obs[j], fcst = this.central.fcst[j];
    return {
      t: this.frameTime(f), central: obs + fcst, obs, fcst,
      mean: s.mean[j], sd: s.sd[j], p10: s.p10[j], p90: s.p90[j],
      pLow: s.pLow[j], pMod: s.pMod[j], pHigh: s.pHigh[j],
    };
  }
  /** Time series at one bin. */
  seriesAt(i) {
    return Array.from({ length: this.F }, (_, f) => this.at(f, i));
  }
  #velocityField(gauges) {
    const { a, b, vMin, vMax, defaultFlowM3s } = CONFIG.hydraulics;
    const g = gauges
      .map((x) => ({ ...x, chainage: snapToRiver(this.river, x.position).chainage }))
      .sort((p, q) => p.chainage - q.chainage);
    this.gauges = g;
    return this.river.samples.map(({ chainage }) => {
      let Q = defaultFlowM3s;
      const up = g.filter((x) => x.chainage <= chainage).pop();
      if (up) Q = up.flow; else if (g.length) Q = g[0].flow;
      return Math.min(vMax, Math.max(vMin, a * Math.pow(Math.max(Q, 0.01), b)));
    });
  }

  /** Plain, transferable snapshot for posting from a Web Worker. */
  toTransferable() {
    const sites = this.sites.map(({ rainHours, ...rest }) => rest);
    return {
      meta: {
        now: this.now, frameStart: this.frameStart, F: this.F, S: this.S, sp: this.sp, M: this.M,
        frameMinutes: CONFIG.sim.frameMinutes, tidalLimitKm: this.tidalLimitKm, tideQuality: this.tideQuality,
      },
      velocity: Float32Array.from(this.velocity),
      central: this.central, summary: this.summary, sites,
    };
  }
}

/** Main-thread view over a toTransferable() snapshot (same read-out API). */
export class ModelView {
  constructor(snap) {
    Object.assign(this, snap.meta);
    this.velocity = snap.velocity; this.central = snap.central; this.summary = snap.summary; this.sites = snap.sites;
    this.frameTime = (f) => this.frameStart + f * this.frameMinutes * 60e3;
    this.frameAt = (t) => Math.max(0, Math.min(this.F - 1, Math.round((t - this.frameStart) / (this.frameMinutes * 60e3))));
  }
}
ModelView.prototype.at = ImpactModel.prototype.at;
ModelView.prototype.seriesAt = ImpactModel.prototype.seriesAt;
