// The Plain chills output as one hash per progression: every key, both modes, several instrument
// ranges, velocities, clip lengths and meters (used by chills.test.mjs to check Plain never changes).
import { register } from 'node:module';
import { createHash } from 'node:crypto';
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
    throw err;
  }
}`)
);
const X = await import('../src/store/chills.ts');
const { keyOf } = await import('../src/store/songKey.ts');
const RANGES = [[36, 96], [48, 96], [24, 108], [36, 88], [21, 108], [24, 55], [24, 48], [52, 84], [40, 76], [48, 84], [55, 88], [0, 127]];
const METERS = [{ base: { num: 4, den: 4 }, points: [] }, { base: { num: 3, den: 4 }, points: [] }];
export function plainHashes(ids, opts = {}) {
  const out = {};
  for (const pid of ids) {
    const p = X.chillsById(pid);
    const h = createHash('sha256');
    for (const mode of ['major', 'minor'])
      for (let root = 0; root < 12; root++)
        for (const range of RANGES)
          for (const map of METERS)
            for (const [from, to] of [[1, 9], [1, 5], [3, 20], [1, 2]])
              for (const velocity of [undefined, 0.5]) {
                let n = 0;
                const notes = X.chillsFill(keyOf(root, mode), p, from, to, map, () => `n${++n}`, { range, ...(velocity ? { velocity } : {}), ...opts });
                h.update(JSON.stringify(notes));
              }
    out[pid] = h.digest('hex').slice(0, 16);
  }
  return out;
}
if (process.argv[1] && process.argv[1].endsWith('chills-plain-snapshot.mjs')) console.log(JSON.stringify(plainHashes(X.CHILLS.map((p) => p.id)), null, 1));
