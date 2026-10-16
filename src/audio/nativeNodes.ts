/**
 * Plain Web Audio nodes alongside Tone's. Tone's nodes are standardized-audio-context's wrappers
 * around the browser's own; making nodes on the browser's context directly skips the wrapper's
 * work (on every connect it walks the graph downstream, and some wrappers add nodes of their own),
 * which matters for nodes made per note. These find the native context and nodes under Tone's, and
 * keep a Tone node playing when only native nodes feed it. Used by plugins (wamHost.ts) and the
 * recorded instruments (samplerManager.ts).
 */
import * as Tone from 'tone';

type WithNative = { _nativeAudioContext?: BaseAudioContext; _nativeOfflineAudioContext?: BaseAudioContext; _nativeContext?: BaseAudioContext };

/** The native context under a Tone context (live or offline). */
export function nativeContextOf(context: Tone.BaseContext): BaseAudioContext {
  const raw = context.rawContext as unknown as WithNative;
  return raw._nativeAudioContext ?? raw._nativeOfflineAudioContext ?? raw._nativeContext ?? (raw as unknown as BaseAudioContext);
}

/** The native node a Tone node (or wrapped node) takes its input at. */
export function nativeInputOf(node: Tone.InputNode): AudioNode {
  let n: unknown = node;
  while (n instanceof Tone.ToneAudioNode) n = n.input;
  return ((n as { _nativeAudioNode?: AudioNode })._nativeAudioNode ?? n) as AudioNode;
}

/** The native node a Tone node's sound comes out of. */
export function nativeOutputOf(node: Tone.ToneAudioNode): AudioNode {
  let n: unknown = node;
  while (n instanceof Tone.ToneAudioNode) n = n.output;
  return ((n as { _nativeAudioNode?: AudioNode })._nativeAudioNode ?? n) as AudioNode;
}

/**
 * Keep a node of Tone's graph sounding when only native nodes (a plugin) play into it. Tone's nodes
 * are standardized-audio-context's wrappers, which take a node with no input they know of out of
 * the native graph to save work ("passive"); a silent constant source playing into it, which they
 * do know of, keeps it in. Returns what undoes it.
 */
export function keepActive(node: Tone.ToneAudioNode): () => void {
  const source = node.context.createConstantSource();
  source.offset.value = 0;
  source.start();
  Tone.connect(source, node);
  return () => {
    try {
      source.stop();
      source.disconnect();
    } catch {
      // Already stopped
    }
  };
}

/**
 * Make `node` always pass two channels on (a one-channel sound on both), whatever plays into it. A
 * recorded instrument's notes come one channel or two (a recording whose sides are the same is kept
 * in one: recordingMaths.ts), and every filter, delay and shaper after it starts over, its memory
 * cleared, whenever the number of channels reaching it changes (Chromium re-creates its per-channel
 * kernels): a click each time a one-channel note started or stopped beside a two-channel one.
 */
export function alwaysStereo(node: Tone.ToneAudioNode): void {
  node.channelCount = 2;
  node.channelCountMode = 'explicit';
  node.channelInterpretation = 'speakers';
}
