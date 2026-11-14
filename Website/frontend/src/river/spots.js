// Finding a spot: predictive search over river clubs (public/clubs.json,
// built from OpenStreetMap by scripts/build-clubs.mjs), riverside places,
// your saved spots, UK postcodes (postcodes.io) and "lat, lon".
// Favourites live only in this browser's localStorage.

import { CONFIG } from '../../../shared/river/config.js';
import { THAMES_WAYPOINTS } from '../../../shared/river/data/thamesCentreline.js';
import { distKm } from '../../../shared/river/model/river.js';

const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const POSTCODE_START = /^[A-Z]{1,2}\d/i;
const LATLON = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

// Words people type for a kind of club -> category id
const CATEGORY_WORDS = {
  rowing: ['row', 'rowing', 'scull', 'sculling', 'boat club', 'regatta', 'skiff', 'gig'],
  paddle: ['canoe', 'kayak', 'paddle', 'sup', 'paddleboard', 'dragon boat', 'outrigger'],
  sailing: ['sail', 'sailing', 'yacht', 'dinghy', 'windsurf', 'cruising'],
  cadets: ['cadet', 'sea cadet', 'scout', 'sea scout', 'explorer'],
  swimming: ['swim', 'swimming', 'open water', 'wild swim', 'lido'],
  other: ['watersport', 'water sport', 'activity centre', 'outdoor centre'],
};

let clubs = [];
let clubsMeta = null;
export async function loadClubs() {
  try {
    const res = await fetch(CONFIG.spots.clubsUrl);
    const j = await res.json();
    clubs = (j.clubs ?? []).map((c) => ({ ...c, _n: c.name.toLowerCase(), _w: c.name.toLowerCase().split(/[^a-z0-9]+/) }));
    clubsMeta = { count: clubs.length, generated: j.generated, attribution: j.attribution, attributionUrl: j.attributionUrl };
  } catch { clubs = []; clubsMeta = { count: 0 }; }
  return clubsMeta;
}
export const clubsInfo = () => clubsMeta;

/** 0 = no match; higher = better. Prefix of the name > prefix of a word > anywhere. */
function textScore(q, name, words) {
  if (name.startsWith(q)) return 100 - name.length / 100;
  if (words.some((w) => w.startsWith(q))) return 70 - name.length / 100;
  if (q.length >= 4 && name.includes(q)) return 40 - name.length / 100;
  // all typed words present ("thames row" -> Thames Rowing Club)
  const parts = q.split(/\s+/).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => words.some((w) => w.startsWith(p)))) return 60;
  return 0;
}
function categoryHits(q) {
  return Object.entries(CATEGORY_WORDS).filter(([, ws]) => ws.some((w) => w.startsWith(q) || q.startsWith(w) || q.includes(w))).map(([id]) => id);
}

/**
 * Suggestions for what the user typed, grouped and ranked:
 *   [{ group, label, sub, position:[lon,lat], kind, club? }]
 * Groups: Saved spots, Clubs, Places, Postcode, Coordinates.
 */
export async function searchSpots(query, favourites = []) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const ll = LATLON.exec(q);
  if (ll) {
    const a = Number(ll[1]), b = Number(ll[2]);
    const [lat, lon] = a > 40 ? [a, b] : [b, a]; // accept "lat, lon" or "lon, lat"
    return [{ group: 'Coordinates', label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, position: [lon, lat], kind: 'coordinates' }];
  }
  const out = [];
  for (const f of favourites) {
    const s = textScore(q, f.name.toLowerCase(), f.name.toLowerCase().split(/[^a-z0-9]+/));
    if (s) out.push({ group: 'Saved spots', label: f.name, sub: 'saved', position: f.position, kind: 'favourite', fav: f, score: s + 50 });
  }
  // clubs: by name, or by kind ("rowing", "sea cadets") when the query names a category
  const cats = q.length >= 3 ? categoryHits(q) : [];
  for (const c of clubs) {
    let s = textScore(q, c._n, c._w);
    if (!s && cats.includes(c.category)) s = 20;
    else if (s && cats.includes(c.category)) s += 5;
    if (s) out.push({ group: 'Clubs', label: c.name, sub: `${c.categoryLabel} · ${c.place}`, position: c.position, kind: 'club', club: c, score: s });
  }
  for (const w of THAMES_WAYPOINTS) {
    const n = w.name.toLowerCase();
    const s = textScore(q, n, n.split(/[^a-z0-9]+/));
    if (s) out.push({ group: 'Places', label: w.name, sub: 'riverside place', position: w.c, kind: 'place', score: s - 5 });
  }
  if (POSTCODE.test(q)) {
    try {
      const res = await fetch(CONFIG.spots.postcodeLookup + encodeURIComponent(q.replace(/\s+/g, '')));
      const j = await res.json();
      if (j.status === 200 && Number.isFinite(j.result?.longitude)) {
        out.push({ group: 'Postcode', label: j.result.postcode, sub: j.result.admin_district ?? 'postcode', position: [j.result.longitude, j.result.latitude], kind: 'postcode', score: 200 });
      } else out.push({ group: 'Postcode', label: 'Postcode not found', position: null, kind: 'error', score: 200 });
    } catch {
      out.push({ group: 'Postcode', label: 'Postcode lookup unavailable — try a place or club name', position: null, kind: 'error', score: 200 });
    }
  } else if (POSTCODE_START.test(q) && q.length <= 4 && !out.length) {
    out.push({ group: 'Postcode', label: 'Keep typing the full postcode…', position: null, kind: 'error', score: 0 });
  }
  const order = { 'Saved spots': 0, Postcode: 1, Clubs: 2, Places: 3 };
  const per = { 'Saved spots': 4, Clubs: cats.length && !out.some((o) => o.group === 'Clubs' && o.score > 20) ? 12 : 6, Places: 4, Postcode: 1 };
  const grouped = {};
  for (const o of out.sort((a, b) => b.score - a.score)) (grouped[o.group] ??= []).length < (per[o.group] ?? 4) && grouped[o.group].push(o);
  return Object.keys(grouped).sort((a, b) => order[a] - order[b]).flatMap((g) => grouped[g]);
}

// ------------------------------------------------------------- favourites
export function loadFavourites() {
  try {
    const raw = localStorage.getItem(CONFIG.spots.storageKey);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((f) => Array.isArray(f.position)) : [];
  } catch {
    return [];
  }
}
function persist(list) {
  try { localStorage.setItem(CONFIG.spots.storageKey, JSON.stringify(list)); return true; } catch { return false; }
}
export function addFavourite(list, fav) {
  const next = [{ id: Date.now().toString(36), ...fav }, ...list.filter((f) => f.name !== fav.name)].slice(0, CONFIG.spots.maxFavourites);
  return { list: next, saved: persist(next) };
}
export function removeFavourite(list, id) {
  const next = list.filter((f) => f.id !== id);
  persist(next);
  return next;
}
export const getClubs = () => clubs;

// ------------------------------------------------- live place/club search
// The river is passed in from main.js so results can be filtered and labelled by
// distance to the Thames: setRiverSnap((pos) => ({ offKm, pos, chainage })).
let riverSnap = null;
export const setRiverSnap = (fn) => { riverSnap = fn; };

const CLUB_NAME = /row|scull|boat club|sailing|yacht|canoe|kayak|paddle|cadet|sea scout|swim|regatta|watersport|water sport|dragon boat|skiff|cruising club/i;
const CLUB_TAG = new Set(['sports_club', 'sports_centre', 'club', 'water_sports', 'marina', 'slipway']);
const PLACE_WORD = { suburb: 'Neighbourhood', neighbourhood: 'Neighbourhood', quarter: 'Neighbourhood', village: 'Village', town: 'Town',
  city: 'City', hamlet: 'Hamlet', locality: 'Place', island: 'Island', bridge: 'Bridge', pier: 'Pier', park: 'Park', station: 'Station' };
const nrm = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|club)\b/g, '').trim();
const offText = (km) => (km < 0.15 ? 'on the river' : `${km < 1 ? Math.round(km * 1000 / 50) * 50 + ' m' : km.toFixed(1) + ' km'} from the river`);

/**
 * Ask the online gazetteers. Returns suggestions in the same shape as searchSpots(),
 * already filtered to places near the Thames and labelled with their distance to it.
 * [ASSUMPTIONS] both services allow cross-origin requests from the browser; results
 * outside CONFIG.spots.searchBbox are ignored; clubs are recognised by name or OSM tag.
 */
export async function searchRemote(query, signal) {
  const S = CONFIG.spots, q = query.trim();
  if (q.length < S.remoteMinChars || LATLON.test(q) || POSTCODE.test(q)) return [];
  const enc = encodeURIComponent(q);
  const jobs = [];
  if (S.placesUrl) {
    jobs.push(fetch(`${S.placesUrl}?q=${enc}&limit=10`, { signal }).then((r) => r.json()).then((j) => (j.result ?? []).map((p) => ({
      label: p.name_1, kind: 'place', position: [p.longitude, p.latitude], src: 'OS Open Names',
      type: p.local_type, area: p.district_borough ?? p.county_unitary ?? '' }))));
  }
  if (S.photonUrl) {
    const [lon, lat] = S.searchFocus;
    jobs.push(fetch(`${S.photonUrl}?q=${enc}&limit=12&lang=en&bbox=${S.searchBbox.join(',')}&lat=${lat}&lon=${lon}`, { signal })
      .then((r) => r.json()).then((j) => (j.features ?? []).filter((f) => f.properties?.name).map((f) => {
        const p = f.properties;
        const club = CLUB_NAME.test(p.name) || CLUB_TAG.has(p.osm_value) || p.osm_key === 'club';
        return { label: p.name, kind: club ? 'club' : 'place', position: f.geometry.coordinates, src: 'OpenStreetMap',
          type: club ? 'Club' : PLACE_WORD[p.osm_value] ?? (p.osm_value ?? '').replace(/_/g, ' '), area: p.district ?? p.city ?? p.county ?? '' };
      })));
  }
  const settled = await Promise.allSettled(jobs);
  if (signal?.aborted) return [];
  if (jobs.length && settled.every((x) => x.status === 'rejected')) {
    return [{ group: 'Places', label: 'Place search is unavailable right now — try a postcode or tap the river', position: null, kind: 'error', score: 0 }];
  }
  const [b0, b1, b2, b3] = S.searchBbox;
  const out = [];
  const ql = q.toLowerCase();
  for (const r of settled.flatMap((x) => (x.status === 'fulfilled' ? x.value : []))) {
    const [lon, lat] = r.position;
    if (!(lon >= b0 && lon <= b2 && lat >= b1 && lat <= b3)) continue;
    const sn = riverSnap ? riverSnap(r.position) : { offKm: 0 };
    const maxOff = r.kind === 'club' ? S.clubMaxOffKm : S.searchSnapKm;
    if (sn.offKm > maxOff) continue;
    // de-duplicate the same name from both services (or a club already in clubs.json)
    if (out.some((o) => nrm(o.label) === nrm(r.label) && distKm(o.position, r.position) < 0.6)) continue;
    if (r.kind === 'club' && clubs.some((c) => nrm(c.name) === nrm(r.label) && distKm(c.position, r.position) < 0.6)) continue;
    const n = r.label.toLowerCase();
    // exact name first, then how well the name matches, then closeness to the river; fuzzy-only matches last
    const s = (n === ql ? 150 : textScore(ql, n, n.split(/[^a-z0-9]+/)) || 10) - Math.min(sn.offKm, 8) * 2;
    out.push({ group: r.kind === 'club' ? 'Clubs' : 'Places', label: r.label, kind: r.kind, position: r.position,
      sub: [r.type === 'Other' ? '' : r.type, r.area, offText(sn.offKm)].filter(Boolean).join(' · '), offKm: sn.offKm, src: r.src, score: s });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Merge local suggestions with remote ones (local first, duplicates dropped), keep group order. */
export function mergeSuggestions(local, remote) {
  const all = [...local];
  for (const r of remote) {
    if (!r.position) { all.push(r); continue; }
    if (all.some((l) => l.position && nrm(l.label) === nrm(r.label) && distKm(l.position, r.position) < 0.8)) continue;
    all.push(r);
  }
  const order = { 'Saved spots': 0, Postcode: 1, Clubs: 2, Places: 3, Coordinates: 4 };
  const per = { 'Saved spots': 4, Postcode: 1, Clubs: 6, Places: 6, Coordinates: 1 };
  const grouped = {};
  for (const o of all) { const g = (grouped[o.group] ??= []); if (g.length < (per[o.group] ?? 6)) g.push(o); }
  return Object.keys(grouped).sort((a, b) => order[a] - order[b]).flatMap((g) => grouped[g]);
}
