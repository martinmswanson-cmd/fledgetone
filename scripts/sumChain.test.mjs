// Exact sums (src/audio/sumChain.ts): the wiring that adds up three or more connections into one input in an order that never changes, whenever connections come and go. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

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

const { SumChain, SUM_TARGET } = await import('../src/audio/sumChain.ts');

/** A chain with a wiring it keeps by carrying out the ops, checking each one makes sense. */
function wired() {
  let n = 0;
  const chain = new SumChain(() => `link${n++}`);
  /** Edges, as "from>to" */
  const edges = new Set();
  const apply = (ops) => {
    for (const op of ops) {
      const edge = `${op.from}>${op.to}`;
      if (op.kind === 'connect') {
        assert.ok(!edges.has(edge), `connects ${edge} twice`);
        edges.add(edge);
      } else {
        assert.ok(edges.has(edge), `disconnects ${edge}, which isn't connected`);
        edges.delete(edge);
      }
    }
  };
  const inputsOf = (node) => [...edges].filter((e) => e.endsWith(`>${node}`)).map((e) => e.slice(0, e.indexOf('>')));
  /** What `node` adds up, as an expression: (a+b) for two inputs (in either order, as a + b is b + a), x + 0 as x */
  const sumOf = (node) => {
    if (!node.startsWith('link') && node !== SUM_TARGET) return node;
    const parts = inputsOf(node).map(sumOf).filter((s) => s !== '0').sort();
    return parts.length === 0 ? '0' : parts.length === 1 ? parts[0] : `(${parts.join('+')})`;
  };
  const check = () => {
    for (const node of new Set([...edges].map((e) => e.slice(e.indexOf('>') + 1)))) assert.ok(inputsOf(node).length <= 2, `${node} has ${inputsOf(node).length} inputs`);
  };
  return { chain, edges, apply, sumOf: () => sumOf(SUM_TARGET), check };
}

/** The sum of `live` (in the order they were connected): first + (second + (third + ...)) */
const nested = (live) => (live.length === 0 ? '0' : live.length === 1 ? live[0] : `(${[live[0], nested(live.slice(1))].sort().join('+')})`);

test('the first connection goes straight in, each later one through a link of its own', () => {
  const w = wired();
  w.apply(w.chain.add('a'));
  assert.deepEqual([...w.edges], ['a>target']);
  w.apply(w.chain.add('b'));
  w.apply(w.chain.add('c'));
  w.check();
  assert.equal(w.sumOf(), nested(['a', 'b', 'c']));
  assert.equal(w.edges.size, 5);
  // The same connection again changes nothing, as in Web Audio
  assert.deepEqual(w.chain.add('b'), []);
});

test('letting connections go and taking out their links keeps the sum of the rest, in its order', () => {
  const w = wired();
  for (const s of ['a', 'b', 'c', 'd', 'e']) w.apply(w.chain.add(s));
  w.apply(w.chain.remove('b'));
  w.apply(w.chain.remove('a'));
  assert.equal(w.sumOf(), nested(['c', 'd', 'e']));
  const before = w.edges.size;
  w.apply(w.chain.compact());
  w.check();
  assert.equal(w.sumOf(), nested(['c', 'd', 'e']));
  assert.ok(w.edges.size < before);
  // New ones go at the end
  w.apply(w.chain.add('f'));
  assert.equal(w.sumOf(), nested(['c', 'd', 'e', 'f']));
  // With none left, the next starts afresh, straight in
  for (const s of ['c', 'd', 'e', 'f']) w.apply(w.chain.remove(s));
  w.apply(w.chain.compact());
  assert.equal(w.edges.size, 0);
  w.apply(w.chain.add('g'));
  assert.deepEqual([...w.edges], ['g>target']);
});

test('the sum never depends on when connections were let go or links taken out', () => {
  // The same connections in the same order, with lets-go and compactions at random moments:
  // whatever is live is always added up as first + (second + ...)
  for (let seed = 1; seed <= 300; seed++) {
    let s = seed;
    const random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const w = wired();
    const live = [];
    let next = 0;
    for (let step = 0; step < 60; step++) {
      const r = random();
      if (r < 0.45 || !live.length) {
        const name = `s${next++}`;
        w.apply(w.chain.add(name));
        live.push(name);
      } else if (r < 0.85) {
        const [gone] = live.splice(Math.floor(random() * live.length), 1);
        w.apply(w.chain.remove(gone));
      } else {
        w.apply(w.chain.compact());
      }
      w.check();
      assert.equal(w.sumOf(), nested(live), `seed ${seed}, step ${step}`);
      assert.equal(w.chain.live, live.length);
    }
    w.apply(w.chain.compact());
    // Compacted, only live connections keep a link
    assert.ok(w.chain.entries.every((e) => e.source !== null));
  }
});
