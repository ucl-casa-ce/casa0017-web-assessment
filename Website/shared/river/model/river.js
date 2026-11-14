// River geometry helpers: chainage (distance along river), resampling and
// snapping points (overflows, gauges, users) onto the centreline.
// Distances use an equirectangular approximation — accurate to <0.5% over
// the Thames' latitude range, and far cheaper than haversine in loops.

const R_KM = 6371.0088;
const DEG = Math.PI / 180;

export function distKm([lon1, lat1], [lon2, lat2]) {
  const x = (lon2 - lon1) * DEG * Math.cos(((lat1 + lat2) / 2) * DEG);
  const y = (lat2 - lat1) * DEG;
  return Math.hypot(x, y) * R_KM;
}

/**
 * Build a river model from an ordered list of [lon,lat] (source -> sea).
 * Returns resampled points every `spacingKm` with their chainage.
 */
export function buildRiver(coords, spacingKm) {
  // cumulative chainage of the input vertices
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distKm(coords[i - 1], coords[i]));
  const lengthKm = cum[cum.length - 1];

  const samples = [];
  let seg = 0;
  for (let s = 0; s <= lengthKm; s += spacingKm) {
    while (seg < coords.length - 2 && cum[seg + 1] < s) seg++;
    const t = (s - cum[seg]) / Math.max(1e-9, cum[seg + 1] - cum[seg]);
    const [a, b] = [coords[seg], coords[seg + 1]];
    samples.push({ chainage: s, pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] });
  }
  return { coords, vertexChainage: cum, lengthKm, spacingKm, samples };
}

/** Nearest point on the centreline: { chainage, offKm, pos } */
export function snapToRiver(river, p) {
  const { coords, vertexChainage } = river;
  let best = { offKm: Infinity };
  // local planar projection around p (km)
  const kx = DEG * Math.cos(p[1] * DEG) * R_KM;
  const ky = DEG * R_KM;
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = (coords[i][0] - p[0]) * kx, ay = (coords[i][1] - p[1]) * ky;
    const bx = (coords[i + 1][0] - p[0]) * kx, by = (coords[i + 1][1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2));
    const cx = ax + t * dx, cy = ay + t * dy;
    const d = Math.hypot(cx, cy);
    if (d < best.offKm) {
      const segLen = vertexChainage[i + 1] - vertexChainage[i];
      best = {
        offKm: d,
        chainage: vertexChainage[i] + t * segLen,
        pos: [p[0] + cx / kx, p[1] + cy / ky],
      };
    }
  }
  return best;
}

export function sampleIndexAt(river, chainage) {
  return Math.max(0, Math.min(river.samples.length - 1, Math.round(chainage / river.spacingKm)));
}
