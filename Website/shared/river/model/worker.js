// Runs the ensemble off the main thread so the map stays responsive.
// Main thread posts { coords, waypoints, inputs }; gets back a transferable snapshot.
import { buildRiver } from './river.js';
import { ImpactModel } from './impact.js';
import { CONFIG } from '../config.js';

let river = null, riverKey = null;

self.onmessage = ({ data }) => {
  const { id, coords, waypoints, inputs } = data;
  try {
    const key = coords.length + ':' + coords[0] + ':' + coords[coords.length - 1];
    if (key !== riverKey) { river = buildRiver(coords, CONFIG.river.sampleSpacingKm); riverKey = key; }
    const t0 = performance.now();
    const snap = new ImpactModel(river, waypoints).run(inputs).toTransferable();
    snap.meta.runMs = Math.round(performance.now() - t0);
    const buffers = [snap.velocity.buffer,
      ...Object.values(snap.central).map((a) => a.buffer),
      ...Object.values(snap.summary).map((a) => a.buffer)];
    self.postMessage({ id, snap }, buffers);
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
