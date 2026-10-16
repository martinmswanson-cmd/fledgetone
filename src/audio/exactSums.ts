import { SUM_TARGET, SumChain, type SumOp } from './sumChain';

/**
 * Exact sums in an export: every input (of a node or a parameter) of an OfflineAudioContext
 * marked with `exactSumsIn` adds up its connections in an order that never changes, so the same
 * song renders to the same samples every time (see sumChain.ts for why Chromium's own order
 * varies, and how the links fix it). AudioNode's connect and disconnect are wrapped: in a marked
 * context, the first connection into an input goes straight in as before, and each further one
 * through a pass-through gain (see SumChain). Live playback and other contexts are untouched, as
 * the order only changes the last bit of a sample.
 *
 * `settleSums` takes out the links of connections let go (SumChain.compact). The export calls it
 * while its render is suspended, where rewiring can't land between two render blocks.
 */

type Target = AudioNode | AudioParam;
/** One connection: which output of which node. */
interface Source {
  node: AudioNode;
  output: number;
}
interface Junction {
  target: Target;
  input: number;
  chain: SumChain<Source, GainNode>;
}
interface Marked {
  /** Every junction in this context, by its target and input */
  junctions: Map<Target, Map<number, Junction>>;
  /** Each node's connections, by output, as it made them */
  sources: Map<AudioNode, Map<number, { source: Source; junctions: Set<Junction> }>>;
  /** Junctions with connections let go since the last settle */
  idle: Set<Junction>;
}

const marked = new WeakMap<BaseAudioContext, Marked>();
/** The pass-through gains the junctions add */
const links = new WeakSet<AudioNode>();
const isLink = (node: AudioNode) => links.has(node);

const proto = typeof AudioNode === 'undefined' ? null : AudioNode.prototype;
const nativeConnect = proto?.connect as unknown as (this: AudioNode, to: Target, output?: number, input?: number) => AudioNode | undefined;
const nativeDisconnect = proto?.disconnect as unknown as (this: AudioNode, ...args: unknown[]) => void;

/** Carry out a junction's ops with the browser's own connect and disconnect. */
function run(j: Junction, ops: SumOp<Source, GainNode>[]): void {
  for (const op of ops) {
    // A link is a node; a source is a node's output
    const node = op.from instanceof AudioNode ? op.from : op.from.node;
    const output = op.from instanceof AudioNode ? 0 : op.from.output;
    const toTarget = op.to === SUM_TARGET;
    const to = toTarget ? j.target : (op.to as GainNode);
    const isParam = to instanceof AudioParam;
    if (op.kind === 'connect') {
      if (isParam) nativeConnect.call(node, to, output);
      else nativeConnect.call(node, to, output, toTarget ? j.input : 0);
    } else if (isParam) nativeDisconnect.call(node, to, output);
    else nativeDisconnect.call(node, to, output, toTarget ? j.input : 0);
  }
}

function junctionOf(m: Marked, context: BaseAudioContext, target: Target, input: number): Junction {
  let byInput = m.junctions.get(target);
  if (!byInput) m.junctions.set(target, (byInput = new Map()));
  let j = byInput.get(input);
  if (!j) {
    const makeLink = () => {
      // Mixes its inputs as the target would (a parameter hears the mono mix of its inputs)
      const link = context.createGain();
      if (target instanceof AudioParam) {
        link.channelCount = 1;
        link.channelCountMode = 'explicit';
        link.channelInterpretation = 'speakers';
      } else {
        link.channelCount = target.channelCount;
        link.channelCountMode = target.channelCountMode;
        link.channelInterpretation = target.channelInterpretation;
      }
      links.add(link);
      return link;
    };
    j = { target, input, chain: new SumChain<Source, GainNode>(makeLink) };
    byInput.set(input, j);
  }
  return j;
}

function sourceOf(m: Marked, node: AudioNode, output: number) {
  let byOutput = m.sources.get(node);
  if (!byOutput) m.sources.set(node, (byOutput = new Map()));
  let s = byOutput.get(output);
  if (!s) byOutput.set(output, (s = { source: { node, output }, junctions: new Set() }));
  return s;
}

/** Let one connection go (the source's output from the junction). */
function letGo(m: Marked, s: { source: Source; junctions: Set<Junction> }, j: Junction): void {
  run(j, j.chain.remove(s.source));
  s.junctions.delete(j);
  m.idle.add(j);
}

if (proto) {
  proto.connect = function (this: AudioNode, ...args: unknown[]) {
    const m = marked.get(this.context);
    const [to, output = 0, input = 0] = args as [Target, number | undefined, number | undefined];
    // Unmarked contexts, links, and anything the browser would refuse: the browser's own way
    // (with the arguments as given: connect(param, output, input) is an error, say)
    const refused = !(to instanceof AudioNode || to instanceof AudioParam) || (to instanceof AudioNode && (to.context !== this.context || input >= to.numberOfInputs)) || (to instanceof AudioParam && args.length > 2) || output >= this.numberOfOutputs;
    if (!m || isLink(this) || refused) return (nativeConnect as (...a: unknown[]) => AudioNode).apply(this, args);
    const j = junctionOf(m, this.context, to, to instanceof AudioParam ? 0 : input);
    const s = sourceOf(m, this, output);
    if (!j.chain.has(s.source)) {
      run(j, j.chain.add(s.source));
      s.junctions.add(j);
    }
    return (to instanceof AudioNode ? to : undefined) as AudioNode;
  } as unknown as typeof proto.connect;

  proto.disconnect = function (this: AudioNode, ...args: unknown[]) {
    const m = marked.get(this.context);
    const byOutput = m?.sources.get(this);
    if (!m || !byOutput || isLink(this)) return nativeDisconnect.apply(this, args);
    const [to, output, input] = args as [Target | number | undefined, number | undefined, number | undefined];
    // disconnect() and disconnect(output): every connection (of that output)
    if (to === undefined || typeof to === 'number') {
      if (typeof to === 'number' && (to < 0 || to >= this.numberOfOutputs)) return nativeDisconnect.apply(this, args);
      for (const [o, s] of byOutput) if (to === undefined || o === to) for (const j of [...s.junctions]) letGo(m, s, j);
      // (Connections made before the context was marked, the browser's own way)
      try {
        nativeDisconnect.apply(this, args);
      } catch {
        // (none left)
      }
      return;
    }
    // disconnect(target[, output[, input]])
    let found = false;
    for (const [o, s] of byOutput) {
      if (output !== undefined && o !== output) continue;
      for (const j of [...s.junctions]) {
        if (j.target !== to || (input !== undefined && j.input !== input)) continue;
        letGo(m, s, j);
        found = true;
      }
    }
    if (!found) return nativeDisconnect.apply(this, args);
  } as typeof proto.disconnect;
}

/** Make every sum in `context` exact from now on (call before building anything in it). */
export function exactSumsIn(context: BaseAudioContext): void {
  if (proto && !marked.has(context)) marked.set(context, { junctions: new Map(), sources: new Map(), idle: new Set() });
}

/** Take out the links of connections let go in `context` (only while its render is suspended or not started). */
export function settleSums(context: BaseAudioContext): void {
  const m = marked.get(context);
  if (!m) return;
  for (const j of m.idle) {
    run(j, j.chain.compact());
    if (!j.chain.entries.length) {
      const byInput = m.junctions.get(j.target);
      byInput?.delete(j.input);
      if (byInput && !byInput.size) m.junctions.delete(j.target);
    }
  }
  m.idle.clear();
  // Nodes with no connections left are forgotten
  for (const [node, byOutput] of m.sources) {
    for (const [o, s] of byOutput) if (!s.junctions.size) byOutput.delete(o);
    if (!byOutput.size) m.sources.delete(node);
  }
}
