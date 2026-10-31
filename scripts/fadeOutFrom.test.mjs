// Unit tests for fadeOutFrom (src/audio/effects/smoothParam.ts), the cut a Drum Rack choke and Stop
// use: a pad cut during its fade-in or fade-out fades from the level it has reached, never from
// full level or from silence. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { fadeOutFrom } = await import('../src/audio/effects/smoothParam.ts');

/** A small model of an AudioParam's timeline: set values, linear ramps, targets, cancel and cancel-and-hold. */
const fakeParam = (hold = true) => {
  let events = [];
  const valueAt = (t) => {
    // v: the value at t0, where the segment under way began (a target glides from it)
    let v = 0;
    let t0 = 0;
    let tgt = null;
    const along = (x) => (tgt ? tgt.v + (v - tgt.v) * Math.exp(-(x - t0) / tgt.tc) : v);
    for (const e of events) {
      if (e.t > t) {
        if (e.kind === 'ramp' && !tgt) return v + ((e.v - v) * (t - t0)) / (e.t - t0);
        break;
      }
      if (e.kind === 'target') {
        v = along(e.t);
        tgt = e;
      } else {
        v = e.v;
        tgt = null;
      }
      t0 = e.t;
    }
    return along(t);
  };
  const add = (e) => {
    events.push(e);
    events.sort((a, b) => a.t - b.t);
  };
  const p = {
    get value() {
      return 0;
    },
    valueAt,
    setValueAtTime: (v, t) => add({ kind: 'set', v, t }),
    linearRampToValueAtTime: (v, t) => add({ kind: 'ramp', v, t }),
    setTargetAtTime: (v, t, tc) => add({ kind: 'target', v, t, tc }),
    cancelScheduledValues: (t) => {
      events = events.filter((e) => e.t < t);
    },
  };
  if (hold)
    p.cancelAndHoldAtTime = (t) => {
      const v = valueAt(t);
      events = events.filter((e) => e.t < t);
      add({ kind: 'set', v, t });
    };
  return p;
};

/** A pad's envelope as the Drum Rack schedules it: in over 0.25 s to 1, held, out over its last 0.25 s. */
const pad = (p) => {
  p.setValueAtTime(0, 0);
  p.linearRampToValueAtTime(1, 0.25);
  p.setValueAtTime(1, 0.75);
  p.linearRampToValueAtTime(0, 1);
  return p;
};

test('a cut in the fade-out fades from the level reached, not from full level', () => {
  const p = pad(fakeParam());
  assert.ok(Math.abs(p.valueAt(0.9) - 0.4) < 1e-9);
  fadeOutFrom(p, 0.9, 0.002);
  assert.ok(Math.abs(p.valueAt(0.9) - 0.4) < 1e-9);
  assert.ok(p.valueAt(0.9005) < 0.4 && p.valueAt(0.9005) > 0.3);
  assert.ok(p.valueAt(0.92) < 1e-3);
});

test('a cut in the fade-in fades from the level reached, not from silence', () => {
  const p = pad(fakeParam());
  fadeOutFrom(p, 0.1, 0.002);
  assert.ok(Math.abs(p.valueAt(0.1) - 0.4) < 1e-9);
  assert.ok(p.valueAt(0.12) < 1e-3);
});

test('without cancelAndHoldAtTime what was scheduled from then is dropped and it still fades to 0', () => {
  const p = pad(fakeParam(false));
  fadeOutFrom(p, 0.9, 0.002);
  assert.ok(p.valueAt(0.95) < 1e-3);
});
