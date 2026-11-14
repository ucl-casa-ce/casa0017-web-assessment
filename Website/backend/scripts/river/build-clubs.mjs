#!/usr/bin/env node
// Build Website/frontend/public/clubs.json — river clubs along the Thames — for the spot search.
// Run from Website/backend:  npm run river:clubs
//
//   npm run clubs                       # query OpenStreetMap (Overpass API), needs internet
//   npm run clubs -- --fixture=f.json   # use a saved Overpass JSON response (offline / testing)
//   options: --radius=600 (m from the river line)  --max-off=1.0 (km kept after snapping)
//
// Sources, merged and de-duplicated:
//   1. OpenStreetMap via Overpass: features within --radius of the OS Open Rivers
//      centreline that are tagged with a water sport, or whose name says rowing,
//      sculling, boat club, canoe, kayak, sailing, yacht, sea cadets/scouts, swimming,
//      paddle, dragon boat or watersports.
//   2. scripts/river/clubs-extra.csv: your own additions/corrections (name,category,lat,lon,website).
//      Manual rows win over OSM rows with the same name.
//
// Licence: OSM data is © OpenStreetMap contributors, ODbL. The app shows the credit.
// [ASSUMPTIONS] OSM coverage of clubs is good on the Thames but not complete; tags vary,
// so categories are inferred from tags first, then the name. Indoor pools are excluded.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { THAMES_WAYPOINTS } from '../../../shared/river/data/thamesCentreline.js';
import { buildRiver, snapToRiver, distKm } from '../../../shared/river/model/river.js';

const HERE = import.meta.dirname;
const SHARED = path.resolve(HERE, '../../../shared/river/data');
const PUBLIC = path.resolve(HERE, '../../../frontend/public');

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const RADIUS_M = Number(opt('radius', 600));
const MAX_OFF_KM = Number(opt('max-off', 1.0));
const FIXTURE = opt('fixture', null);
// Public Overpass servers, tried in turn when one is busy (HTTP 429/504) or unreachable.
const ENDPOINTS = opt('endpoint', null) ? [opt('endpoint')] : [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const OUT = opt('out', path.join(PUBLIC, 'clubs.json'));

// ------------------------------------------------------------ river line
const gj = JSON.parse(readFileSync(path.join(SHARED, 'thames-centreline.geojson'), 'utf8'));
const coords = gj.geometry?.coordinates ?? gj.features[0].geometry.coordinates;
const river = buildRiver(coords, 0.5);

/** Thin the line to vertices ≥ stepKm apart (Overpass "around" takes lat,lon pairs). */
function thin(line, stepKm) {
  const out = [line[0]];
  for (const p of line) if (distKm(out[out.length - 1], p) >= stepKm) out.push(p);
  out.push(line[line.length - 1]);
  return out;
}
const thinLine = thin(coords, 0.4);

// --------------------------------------------------------------- query
const SPORTS = 'rowing|canoe|kayak|swimming|sailing|dragon_boat|paddle|surfski|outrigger|stand_up_paddleboarding|sup|water_polo|windsurfing';
const NAMES = 'rowing|sculling|boat club|canoe|kayak|sailing|yacht|sea cadet|sea scout|swimming club|swim club|open water|paddle|dragon boat|watersport|water sport|outdoor activit|cruising club|motor yacht';
function query(chunk) {
  const line = chunk.map(([lon, lat]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join(',');
  return `[out:json][timeout:180];
(
  nwr["sport"~"${SPORTS}"](around:${RADIUS_M},${line});
  nwr["name"~"${NAMES}",i](around:${RADIUS_M},${line});
);
out center tags;`;
}

async function overpass(q) {
  let last;
  for (let attempt = 0; attempt < ENDPOINTS.length * 2; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'ThamesSpillMap/1.0 (club directory build script)' },
        body: new URLSearchParams({ data: q }),
        signal: AbortSignal.timeout(200e3),
      });
      if (res.ok) return await res.json();
      last = new Error(`${new URL(url).host} HTTP ${res.status}`);
    } catch (e) { last = new Error(`${new URL(url).host}: ${e.cause?.code ?? e.message}`); }
    process.stdout.write(`(${last.message}, retrying) `);
    await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
  }
  throw new Error(`All Overpass servers failed. Last error: ${last.message}.
If you are behind a firewall/proxy, allow overpass-api.de, or save a response from
https://overpass-turbo.eu and run: npm run clubs -- --fixture=saved.json`);
}

async function fetchOverpass() {
  const elements = [];
  const CHUNK = 60; // vertices per request keeps queries a manageable size
  for (let i = 0; i < thinLine.length - 1; i += CHUNK - 1) {
    const chunk = thinLine.slice(i, i + CHUNK);
    process.stdout.write(`Overpass ${Math.floor(i / (CHUNK - 1)) + 1}/${Math.ceil((thinLine.length - 1) / (CHUNK - 1))}… `);
    const json = await overpass(query(chunk));
    elements.push(...json.elements);
    console.log(`${json.elements.length} features`);
    await new Promise((r) => setTimeout(r, 1500)); // be polite to the shared server
  }
  return elements;
}

// ------------------------------------------------------------ classify
const CATS = [
  ['cadets', 'Sea cadets & scouts', /sea cadet|sea scout|scouts?\b|cadet|explorer|sea ranger/i, null],
  ['rowing', 'Rowing & sculling', /rowing|sculling|\bboat club\b|\brc\b|row club|regatta/i, /rowing/],
  ['paddle', 'Canoe, kayak & paddle', /canoe|kayak|paddle|\bsup\b|dragon ?boat|outrigger|surfski/i, /canoe|kayak|dragon_boat|paddle|surfski|outrigger|stand_up|sup/],
  ['sailing', 'Sailing & yacht', /sailing|yacht|cruising club|windsurf/i, /sailing|windsurfing/],
  ['swimming', 'Open-water swimming', /swim|open water|lido/i, /swimming/],
  ['other', 'Watersports & activity centres', /watersport|water sport|outdoor activit|activity centre|boat/i, null],
];
export function classify(tags) {
  const name = tags.name ?? '', sport = tags.sport ?? '';
  for (const [id, label, nameRe, sportRe] of CATS) if (nameRe.test(name)) return { id, label };
  for (const [id, label, , sportRe] of CATS) if (sportRe && sportRe.test(sport)) return { id, label };
  return { id: 'other', label: CATS[CATS.length - 1][1] };
}
function excluded(t) {
  if (!t.name) return 'no name';
  if (t.amenity && /pub|bar|restaurant|cafe|fast_food|parking|toilets|bench/.test(t.amenity)) return 'hospitality/amenity';
  if (t.shop || t.tourism === 'hotel' || t.highway || t.railway) return 'shop/hotel/road';
  if (t.leisure === 'swimming_pool' || (t.sport === 'swimming' && t.leisure === 'sports_centre' && !/open water|river|lido|outdoor/i.test(t.name))) return 'indoor pool';
  if (t.waterway || t.bridge) return 'waterway/bridge';
  return null;
}
const norm = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|club|ltd|limited)\b/g, '').trim();
const nearestPlace = (pos) => THAMES_WAYPOINTS.reduce((a, w) => (distKm(w.c, pos) < distKm(a.c, pos) ? w : a)).name;

// ----------------------------------------------------------- CSV extras
function readExtras(file = path.join(HERE, 'clubs-extra.csv')) {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const head = lines.shift().split(',').map((h) => h.trim().toLowerCase());
  return lines.map((l) => {
    const cells = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim());
    const r = Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']));
    return { name: r.name, category: r.category, lat: Number(r.lat), lon: Number(r.lon), website: r.website || null };
  }).filter((r) => r.name && Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

// ------------------------------------------------------------------ run
const elements = FIXTURE ? JSON.parse(readFileSync(FIXTURE, 'utf8')).elements : await fetchOverpass();
const reasons = {};
const found = [];
for (const e of elements) {
  const t = e.tags ?? {};
  const why = excluded(t);
  if (why) { reasons[why] = (reasons[why] ?? 0) + 1; continue; }
  const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
  if (!Number.isFinite(lat)) continue;
  found.push({ osm: `${e.type}/${e.id}`, name: t.name.trim(), tags: t, position: [lon, lat], richness: Object.keys(t).length, source: 'osm' });
}
for (const x of readExtras()) {
  const cat = CATS.find(([id, label]) => id === x.category || label.toLowerCase() === String(x.category).toLowerCase());
  found.push({ name: x.name, tags: { name: x.name }, forced: cat ? { id: cat[0], label: cat[1] } : null, position: [x.lon, x.lat], website: x.website, richness: 999, source: 'manual' });
}

// de-duplicate: same normalised name within 500 m -> keep the richest (manual wins)
found.sort((a, b) => b.richness - a.richness);
const kept = [];
for (const c of found) {
  const dup = kept.find((k) => norm(k.name) === norm(c.name) && distKm(k.position, c.position) < 0.5);
  if (dup) { reasons.duplicate = (reasons.duplicate ?? 0) + 1; continue; }
  kept.push(c);
}

const clubs = [];
for (const c of kept) {
  const sn = snapToRiver(river, c.position);
  if (sn.offKm > MAX_OFF_KM) { reasons['too far from river'] = (reasons['too far from river'] ?? 0) + 1; continue; }
  const cat = c.forced ?? classify(c.tags);
  clubs.push({
    id: c.osm ?? `manual/${norm(c.name).replace(/ /g, '-')}`,
    name: c.name,
    category: cat.id,
    categoryLabel: cat.label,
    position: c.position.map((v) => Math.round(v * 1e5) / 1e5),
    chainageKm: Math.round(sn.chainage * 10) / 10,
    place: nearestPlace(c.position),
    website: c.website ?? c.tags.website ?? c.tags['contact:website'] ?? null,
    source: c.source,
  });
}
clubs.sort((a, b) => a.chainageKm - b.chainageKm);

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString(),
  attribution: '© OpenStreetMap contributors (ODbL), plus manual additions',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
  radiusM: RADIUS_M,
  clubs,
}, null, 1));
const byCat = clubs.reduce((m, c) => ((m[c.categoryLabel] = (m[c.categoryLabel] ?? 0) + 1), m), {});
console.log(`\nWrote ${OUT}: ${clubs.length} clubs`, byCat, '\nSkipped:', reasons);
