// Share / export the 7-day outlook for a spot: link, PNG card, CSV.

import { CONFIG } from '../../../shared/river/config.js';
import { riskInfo } from '../../../shared/river/model/risk.js';

const fmtT = (t) => new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** A link that reopens the map on this spot and stretch. */
export function spotUrl(spot, radiusKm) {
  const u = new URL(location.href.split(/[?#]/)[0]);
  u.searchParams.set('lon', spot.position[0].toFixed(4));
  u.searchParams.set('lat', spot.position[1].toFixed(4));
  u.searchParams.set('r', String(radiusKm));
  if (spot.name) u.searchParams.set('name', spot.name);
  return u.toString();
}

export function shareText(spot, radiusKm, now, days) {
  const n = riskInfo(now.risk);
  return `Thames sewage outlook — ${spot.name ?? spot.place} (±${radiusKm} km)\n` +
    `Now: ${n.label}\n` +
    `Next 7 days: ${days.map((d) => `${d.day} ${riskInfo(d.risk).emoji} ${riskInfo(d.risk).short}`).join(' · ')}\n` +
    `Model estimate, not a water test.`;
}

/** Hour-by-hour CSV (open in Excel / Sheets). */
export function outlookCsv(spot, radiusKm, hours) {
  const head = ['time_uk', 'status', 'certainty', 'central_SH_per_km', 'likely_low_SH_per_km', 'likely_high_SH_per_km',
    'chance_moderate_or_worse', 'chance_high', 'observed_part', 'forecast_part'];
  const rows = hours.map((h) => [
    new Date(h.t).toLocaleString('en-GB', { timeZone: 'Europe/London' }), riskInfo(h.risk).label, h.confidence.word,
    h.central.toFixed(4), h.p10.toFixed(4), h.p90.toFixed(4), h.pMod.toFixed(2), h.pHigh.toFixed(2), h.obs.toFixed(4), h.fcst.toFixed(4),
  ]);
  const meta = [`# ${CONFIG.brand.name} outlook for ${spot.name ?? spot.place} (±${radiusKm} km), ${spot.position[1].toFixed(4)}, ${spot.position[0].toFixed(4)}`,
    `# Generated ${fmtT(Date.now())}. Units and method: ${new URL('method.html#live-map', location.href)}`,
    '# Model estimate with uncertainty, not a water test.'];
  return [...meta, head.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
}

export function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** 1080×1080 image card: status now + 7 day lights. Returns a PNG Blob. */
export async function outlookCard(spot, radiusKm, now, days, nextLine) {
  const W = 1080, Hh = 1080;
  const cv = Object.assign(document.createElement('canvas'), { width: W, height: Hh });
  const g = cv.getContext('2d');
  const font = (w, s) => `${w} ${s}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  const info = riskInfo(now.risk);

  g.fillStyle = '#f6f8f9'; g.fillRect(0, 0, W, Hh);
  g.fillStyle = '#0f6b8f'; g.fillRect(0, 0, W, 150);
  g.fillStyle = '#fff'; g.font = font(700, 54); g.fillText(CONFIG.brand.name, 60, 92);
  g.font = font(400, 22); g.fillText(trim(g, CONFIG.brand.slogan, W - 120), 60, 130);

  g.fillStyle = '#14212b'; g.font = font(700, 46);
  g.fillText(trim(g, spot.name ?? spot.place, W - 120), 60, 230);
  g.font = font(400, 28); g.fillStyle = '#5b6b77';
  g.fillText(`Stretch ± ${radiusKm} km · ${fmtT(Date.now())}`, 60, 275);

  // big status block
  g.fillStyle = info.colour; roundRect(g, 60, 315, W - 120, 220, 28); g.fill();
  g.fillStyle = info.text; g.font = font(700, 120); g.fillText(info.icon, 100, 470);
  // shrink the label until it fits ("MODERATE SEWAGE RISK" is long)
  let fs = 76; g.font = font(800, fs);
  while (g.measureText(info.label.toUpperCase()).width > W - 120 - 200 && fs > 40) g.font = font(800, (fs -= 2));
  g.fillText(info.label.toUpperCase(), 230, 440);
  g.font = font(500, 34); g.fillText(`Right now · ${CONFIG.risk.certaintyLabel.toLowerCase()}: ${now.confidence.word}`, 232, 495);

  g.fillStyle = '#14212b'; g.font = font(400, 30);
  wrap(g, info.advice, 60, 600, W - 120, 40);
  if (nextLine) { g.font = font(600, 30); g.fillText(trim(g, nextLine, W - 120), 60, 700); }

  // 7-day lights
  g.font = font(700, 30); g.fillStyle = '#14212b'; g.fillText('Next 7 days · Highest sewage risk each day', 60, 775);
  const n = Math.min(8, days.length), cw = (W - 120) / n;
  days.slice(0, n).forEach((d, i) => {
    const x = 60 + i * cw, c = riskInfo(d.risk);
    g.fillStyle = c.colour; roundRect(g, x + 6, 800, cw - 12, 150, 18); g.fill();
    g.fillStyle = c.text; g.textAlign = 'center';
    g.font = font(700, 30); g.fillText(d.day, x + cw / 2, 845);
    g.font = font(800, 46); g.fillText(c.icon, x + cw / 2, 900);
    g.font = font(600, 22); g.fillText(c.short, x + cw / 2, 935);
    g.textAlign = 'left';
  });

  g.fillStyle = '#5b6b77'; g.font = font(400, 22);
  g.fillText('Model estimate with uncertainty, not a water test. Check official bathing-water advice.', 60, 1000);
  g.fillText(trim(g, `Method: ${new URL('method.html#live-map', location.href)}`, W - 120), 60, 1034);
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function trim(g, s, max) {
  if (g.measureText(s).width <= max) return s;
  while (s.length > 1 && g.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}
function wrap(g, text, x, y, max, lh) {
  let line = '';
  for (const w of text.split(' ')) {
    if (g.measureText(line + w).width > max && line) { g.fillText(line.trim(), x, y); y += lh; line = ''; }
    line += w + ' ';
  }
  g.fillText(line.trim(), x, y);
}

/** Use the phone's share sheet when available (with the image), else copy the link. */
export async function shareOutlook({ url, text, png }) {
  const file = png ? new File([png], 'thames-outlook.png', { type: 'image/png' }) : null;
  try {
    if (file && navigator.canShare?.({ files: [file] })) { await navigator.share({ title: 'Thames sewage outlook', text, url, files: [file] }); return 'shared'; }
    if (navigator.share) { await navigator.share({ title: 'Thames sewage outlook', text, url }); return 'shared'; }
  } catch (e) {
    if (e.name === 'AbortError') return 'cancelled';
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); return 'copied'; } catch { return 'failed'; }
}
export { CONFIG };
