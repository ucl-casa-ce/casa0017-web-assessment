#!/usr/bin/env node
// Build Website/shared/river/data/thames-centreline.geojson from OS Open Rivers (WatercourseLink).
// Run from Website/backend:  npm run river:centreline -- <path to WatercourseLink.shp>
//
// Usage:
//   node scripts/build-thames-centreline.mjs path/to/WatercourseLink.shp [--tolerance=5] [--name="River Thames"]
//   (WatercourseLink.dbf and .shx must sit next to the .shp)
//
// Method
//  1. Read the DBF; keep links whose name1 or name2 equals --name.
//  2. Read only those links' polylines from the SHP (offsets from the SHX).
//  3. Build an UNDIRECTED graph of the links. OS Open Rivers inland links are
//     digitised with the flow, but some tidal links are not, so direction is
//     only used afterwards to orient the result (source first). [ASSUMPTION]
//  4. Ends = dead-end nodes (degree 1). The main channel is the longest of
//     the shortest paths between any two ends (the network's "diameter"):
//     shortest, so side channels, mill streams and lock cuts that share the
//     name don't lengthen it; longest over ends, so it runs source → estuary.
//  5. Orientation: the end with no upstream link in the digitised direction
//     is the source; if ambiguous, the western end is. [ASSUMPTION]
//  6. The named Thames is split into pieces (unnamed links at weirs/locks,
//     sparse estuary channels). Each dead end is bridged to the nearest node
//     of a DIFFERENT piece within --gap metres, so a backwater's dead end
//     can't create a shortcut inside its own piece. [ASSUMPTION]
//  7. Douglas–Peucker simplify in metres, convert OSGB36 → WGS84, write GeoJSON.
//
// No dependencies beyond proj4 (already in package.json). No Python.

import { openSync, readSync, closeSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import proj4 from 'proj4';

// ------------------------------------------------------------ arguments
const args = process.argv.slice(2);
const shpPath = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d);
const TOLERANCE_M = Number(opt('tolerance', 5)); // simplification tolerance
const GAP_M = Number(opt('gap', 2000));          // max bridge between separate named pieces
const NAME = opt('name', 'River Thames');
const OUT = opt('out', new URL('../../../shared/river/data/thames-centreline.geojson', import.meta.url).pathname);
if (!shpPath) {
  console.error('Usage: node scripts/build-thames-centreline.mjs WatercourseLink.shp [--tolerance=5] [--gap=250]');
  process.exit(1);
}
const base = shpPath.replace(/\.shp$/i, '');

proj4.defs('EPSG:27700',
  '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 ' +
  '+ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');
const toWgs = proj4('EPSG:27700', 'EPSG:4326').forward;

// ---------------------------------------------------- 1. DBF attributes
// Streamed record by record: the national DBF is ~140 MB.
function readDbf(path, keep) {
  const fd = openSync(path, 'r');
  const head = Buffer.alloc(32);
  readSync(fd, head, 0, 32, 0);
  const n = head.readUInt32LE(4), headerLen = head.readUInt16LE(8), recLen = head.readUInt16LE(10);
  const hdr = Buffer.alloc(headerLen);
  readSync(fd, hdr, 0, headerLen, 0);
  const fields = [];
  for (let o = 32, off = 1; hdr[o] !== 0x0d; o += 32) {
    const len = hdr[o + 16];
    fields.push({ name: hdr.toString('latin1', o, o + 11).replace(/\0.*/, ''), off, len });
    off += len;
  }
  const out = [];
  const CHUNK = 5000;
  const buf = Buffer.alloc(recLen * CHUNK);
  for (let r0 = 0; r0 < n; r0 += CHUNK) {
    const count = Math.min(CHUNK, n - r0);
    readSync(fd, buf, 0, recLen * count, headerLen + r0 * recLen);
    for (let j = 0; j < count; j++) {
      const rec = {};
      for (const f of fields) rec[f.name] = buf.toString('utf8', j * recLen + f.off, j * recLen + f.off + f.len).trim();
      if (keep(rec)) out.push({ index: r0 + j, ...rec });
    }
  }
  closeSync(fd);
  return out;
}

// ---------------------------------------------- 2. SHP polylines by index
function readPolylines(shp, shx, indices) {
  const fdShx = openSync(shx, 'r'), fdShp = openSync(shp, 'r');
  const geoms = new Map();
  const b8 = Buffer.alloc(8);
  for (const i of indices) {
    readSync(fdShx, b8, 0, 8, 100 + i * 8);
    const offset = b8.readInt32BE(0) * 2, contentLen = b8.readInt32BE(4) * 2;
    const rec = Buffer.alloc(contentLen);
    readSync(fdShp, rec, 0, contentLen, offset + 8);
    const type = rec.readInt32LE(0);
    if (type !== 3 && type !== 13 && type !== 23) continue; // PolyLine, PolyLineZ, PolyLineM
    const numParts = rec.readInt32LE(36), numPoints = rec.readInt32LE(40);
    const pts = [];
    const p0 = 44 + numParts * 4;
    for (let k = 0; k < numPoints; k++) pts.push([rec.readDoubleLE(p0 + k * 16), rec.readDoubleLE(p0 + k * 16 + 8)]);
    geoms.set(i, pts); // OS Open Rivers links are single-part
  }
  closeSync(fdShx); closeSync(fdShp);
  return geoms;
}

const lenM = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

// ------------------------------------------------------------------ run
console.time('total');
const shpSize = statSync(shpPath).size;
console.log(`Reading ${base}.dbf …`);
const re = new RegExp(`^${NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const links = readDbf(`${base}.dbf`, (r) => re.test(r.name1) || re.test(r.name2));
console.log(`${links.length} links named "${NAME}"`);
const geoms = readPolylines(shpPath, `${base}.shx`, links.map((l) => l.index));
console.log(`Read ${geoms.size} geometries from ${(shpSize / 1e6).toFixed(0)} MB SHP`);

// ------------------------------------------------ 3. undirected graph
const edges = links.filter((l) => geoms.has(l.index)).map((l) => ({
  id: l.identifier, a: l.startNode, b: l.endNode, form: l.form,
  pts: geoms.get(l.index), len: lenM(geoms.get(l.index)),
}));
const adj = new Map(), nodeXY = new Map(), inDir = new Map();
const link = (e) => {
  for (const [u, v] of [[e.a, e.b], [e.b, e.a]]) {
    if (!adj.has(u)) adj.set(u, []);
    adj.get(u).push({ to: v, e });
  }
};
for (const e of edges) {
  link(e);
  nodeXY.set(e.a, e.pts[0]);
  nodeXY.set(e.b, e.pts[e.pts.length - 1]);
  inDir.set(e.b, (inDir.get(e.b) ?? 0) + 1);
}
const nodes = [...nodeXY.keys()];

// 6. bridge gaps between separate pieces (union–find over the named links)
const parent = new Map(nodes.map((n) => [n, n]));
const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
for (const e of edges) parent.set(find(e.a), find(e.b));
const pieces = new Set(nodes.map(find)).size;
let bridges = 0;
const deadEnds = () => nodes.filter((n) => adj.get(n).length === 1);
// Repeat until one piece remains or no bridge ≤ GAP_M exists; always add the
// globally shortest bridge first so pieces join in geographic order.
for (;;) {
  let bestB = null;
  for (const n of deadEnds()) {
    const p = nodeXY.get(n);
    for (const m of nodes) {
      if (find(m) === find(n)) continue;
      const q = nodeXY.get(m);
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d <= GAP_M && d < (bestB?.d ?? Infinity)) bestB = { n, m, d };
    }
  }
  if (!bestB) break;
  link({ id: `bridge-${bridges}`, a: bestB.n, b: bestB.m, form: 'bridge', pts: [nodeXY.get(bestB.n), nodeXY.get(bestB.m)], len: bestB.d });
  parent.set(find(bestB.n), find(bestB.m));
  bridges++;
}
const remaining = new Set(nodes.map(find)).size;
console.log(`${nodes.length} nodes, ${edges.length} links in ${pieces} separate pieces; ${bridges} gap bridges ≤ ${GAP_M} m` +
  (remaining > 1 ? ` — ${remaining} pieces still unconnected (raise --gap?)` : ' — fully connected'));

// --------------------------------- 4. longest shortest path between ends
function dijkstra(src) {
  const dist = new Map([[src, 0]]), prev = new Map();
  const queue = [[0, src]];
  while (queue.length) {
    queue.sort((x, y) => x[0] - y[0]); // <1k nodes: a sorted array is fine
    const [d, u] = queue.shift();
    if (d > dist.get(u)) continue;
    for (const { to, e } of adj.get(u) ?? []) {
      const nd = d + e.len;
      if (nd < (dist.get(to) ?? Infinity)) { dist.set(to, nd); prev.set(to, { from: u, e }); queue.push([nd, to]); }
    }
  }
  return { dist, prev };
}
const ends = deadEnds();
let best = null;
for (const s0 of ends) {
  const { dist, prev } = dijkstra(s0);
  for (const t of ends) {
    const d = dist.get(t);
    if (d !== undefined && d > (best?.far ?? -1)) best = { source: s0, mouth: t, far: d, prev };
  }
}
if (!best) throw new Error('No path found — check --name / --gap');

// ---------------------------------------- 5. walk back + orient source first
let path = []; // list of { e, forward } from best.source to best.mouth
for (let n = best.mouth; n !== best.source; ) {
  const { from, e } = best.prev.get(n);
  path.unshift({ e, forward: e.a === from });
  n = from;
}
const isDirSource = (n) => !(inDir.get(n) > 0);
const flip = isDirSource(best.mouth) && !isDirSource(best.source)
  ? true
  : !isDirSource(best.mouth) && isDirSource(best.source)
    ? false
    : nodeXY.get(best.mouth)[0] < nodeXY.get(best.source)[0]; // fall back: start in the west
if (flip) path = path.reverse().map(({ e, forward }) => ({ e, forward: !forward }));
const chain = path.map((p) => p.e);
const forms = chain.reduce((m, e) => ((m[e.form] = (m[e.form] ?? 0) + e.len / 1000), m), {});
console.log(`Main channel: ${chain.length} links, ${(best.far / 1000).toFixed(1)} km`,
  Object.fromEntries(Object.entries(forms).map(([k, v]) => [k, `${v.toFixed(1)} km`])));

const coords = [];
for (const { e, forward } of path) {
  const pts = forward ? e.pts : [...e.pts].reverse();
  for (const p of coords.length ? pts.slice(1) : pts) coords.push(p);
}
// --------------------------------- 7. simplify (Douglas–Peucker, metres)
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    let idx = -1, max = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L;
      if (d > max) { max = d; idx = i; }
    }
    if (idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const simple = simplify(coords, TOLERANCE_M);
const wgs = simple.map((p) => toWgs(p).map((v) => Math.round(v * 1e5) / 1e5)); // 1e-5° ≈ 1 m

const geojson = {
  type: 'Feature',
  properties: {
    name: NAME,
    source: 'Contains OS data © Crown copyright and database right. OS Open Rivers (Open Government Licence v3.0)',
    lengthKm: Math.round(best.far / 100) / 10,
    simplifiedLengthKm: Math.round(lenM(simple) / 100) / 10,
    toleranceM: TOLERANCE_M,
    vertices: wgs.length,
    links: chain.length,
    bridges: chain.filter((e) => e.form === 'bridge').length,
    built: new Date().toISOString(),
  },
  geometry: { type: 'LineString', coordinates: wgs },
};

writeFileSync(OUT, JSON.stringify(geojson));
console.log(`Wrote ${OUT}: ${wgs.length} vertices (from ${coords.length}), ` +
  `${geojson.properties.simplifiedLengthKm} km after simplification, ` +
  `start ${wgs[0]}, end ${wgs[wgs.length - 1]}, ${(readFileSync(OUT).length / 1024).toFixed(0)} KB`);
console.timeEnd('total');
