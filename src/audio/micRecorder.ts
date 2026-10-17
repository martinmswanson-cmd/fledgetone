import { liveMix } from './engine';
import { mixDelaySeconds, outputLatencySeconds } from './latency';
import { transportBarAt } from './recorder';

/**
 * Recording from a microphone (or any audio input) into the live context. The input is captured
 * in blocks that carry their context time, so the first sample's place in the song is known
 * exactly: the performer played along with music they heard an output latency after it was
 * rendered, and their sound reached the graph an input latency after that, so both are taken off.
 * The input isn't sent to the speakers (no feedback through the mic).
 */

function nativeContext(): AudioContext {
  const raw = liveMix.bus.context.rawContext as unknown as { _nativeAudioContext?: AudioContext };
  return raw._nativeAudioContext ?? (raw as unknown as AudioContext);
}

export interface MicTake {
  channels: Float32Array[];
  sampleRate: number;
  /** Where the first sample belongs in the song (1-based bar). */
  startBar: number;
  /** The audio time the first sample belongs at (as the music was heard) */
  heardAt: number;
}

export interface MicSession {
  /** Peak of the last block, 0..1, for a level meter. */
  level: () => number;
  /** Stop, and give back what was recorded (null if nothing was), once the last of it has arrived. */
  stop: () => Promise<MicTake | null>;
  /** Stop and throw it away. */
  cancel: () => void;
}

/**
 * The capture processor: the input in blocks, each with the frame (context time) its first sample
 * was captured at, sent on every BATCH frames. A ScriptProcessor's playbackTime is when its
 * output plays, a buffer or two after the input it hands over was captured, so it put takes late
 * by about that much (by up to a buffer at 4096 frames); a worklet's currentFrame is exact.
 */
const CAPTURE_PROCESSOR = 'bb-mic-capture';
const CAPTURE_SOURCE = `
const BATCH = 512;
class Capture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channels = options.processorOptions.channels;
    this.buf = Array.from({ length: this.channels }, () => new Float32Array(BATCH));
    this.fill = 0;
    this.start = -1;
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') {
        this.flush();
        this.port.postMessage({ done: true });
        this.alive = false;
      }
    };
  }
  flush() {
    if (!this.fill) return;
    this.port.postMessage({ frame: this.start, data: this.buf.map((b) => b.slice(0, this.fill)) });
    this.fill = 0;
    this.start = -1;
  }
  process(inputs) {
    if (!this.alive) return false;
    const input = inputs[0];
    const n = input && input[0] ? input[0].length : 0;
    if (!n) return true;
    if (this.start < 0) this.start = currentFrame;
    for (let c = 0; c < this.channels; c++) this.buf[c].set(input[c] || input[0], this.fill);
    this.fill += n;
    if (this.fill + 128 > BATCH) this.flush();
    return true;
  }
}
registerProcessor('${CAPTURE_PROCESSOR}', Capture);
`;
const captureLoaded = new WeakMap<BaseAudioContext, Promise<void>>();
let captureUrl: string | null = null;
function loadCapture(ctx: AudioContext): Promise<void> {
  let loading = captureLoaded.get(ctx);
  if (!loading) {
    captureUrl ??= URL.createObjectURL(new Blob([CAPTURE_SOURCE], { type: 'text/javascript' }));
    loading = ctx.audioWorklet.addModule(captureUrl);
    captureLoaded.set(ctx, loading);
    loading.catch(() => captureLoaded.delete(ctx));
  }
  return loading;
}

/** Ask for the mic and start capturing. Rejects if the browser or the person says no. */
export async function startMic(): Promise<MicSession> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('this browser has no microphone access (it needs a secure https page)');
  const stream = await navigator.mediaDevices.getUserMedia({
    // A music take, not a call: no processing that would change the sound or its level
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } },
  });
  const ctx = nativeContext();
  const source = ctx.createMediaStreamSource(stream);
  const channelCount = Math.min(2, Math.max(1, source.channelCount));
  const silent = ctx.createGain();
  silent.gain.value = 0;
  const chunks: Float32Array[][] = Array.from({ length: channelCount }, () => []);
  let firstTime: number | null = null;
  let peak = 0;
  const take = (data: Float32Array[], time: number) => {
    if (firstTime === null) firstTime = time;
    let p = 0;
    for (let c = 0; c < channelCount; c++) {
      const ch = data[c] ?? data[0];
      chunks[c].push(ch);
      for (let i = 0; i < ch.length; i += 8) p = Math.max(p, Math.abs(ch[i]));
    }
    peak = p;
  };
  // An AudioWorklet where there is one (exact capture times), else a ScriptProcessor
  let worklet: AudioWorkletNode | null = null;
  if (ctx.audioWorklet) {
    try {
      await loadCapture(ctx);
      worklet = new AudioWorkletNode(ctx, CAPTURE_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount, channelCountMode: 'explicit', processorOptions: { channels: channelCount } });
      worklet.port.onmessage = (e) => {
        if (e.data?.data) take(e.data.data, e.data.frame / ctx.sampleRate);
      };
    } catch {
      worklet = null;
    }
  }
  let proc: ScriptProcessorNode | null = null;
  if (!worklet) {
    const BUFFER = 4096;
    proc = ctx.createScriptProcessor(BUFFER, channelCount, channelCount);
    proc.onaudioprocess = (e) => {
      take(
        Array.from({ length: channelCount }, (_, c) => new Float32Array(e.inputBuffer.getChannelData(c))),
        e.playbackTime
      );
    };
  }
  const node: AudioNode = worklet ?? proc!;
  source.connect(node);
  // A script processor only runs while connected onward: through a silent gain
  node.connect(silent);
  silent.connect(ctx.destination);
  const settings = stream.getAudioTracks()[0]?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined;
  const inputLatency = settings?.latency ?? 0;

  const close = () => {
    if (proc) proc.onaudioprocess = null;
    if (worklet) {
      worklet.port.onmessage = null;
      worklet.port.postMessage('stop');
    }
    source.disconnect();
    node.disconnect();
    silent.disconnect();
    stream.getTracks().forEach((t) => t.stop());
  };
  let stopping: Promise<MicTake | null> | null = null;
  return {
    level: () => peak,
    cancel: close,
    // (Once: a second press while it finishes gets the same take)
    stop: () => (stopping ??= finish()),
  };
  async function finish(): Promise<MicTake | null> {
    if (worklet) {
      // Everything the worklet has captured, up to its last part-filled batch, before letting go
      const w = worklet;
      await new Promise<void>((done) => {
        const timeout = setTimeout(done, 500);
        w.port.onmessage = (e) => {
          if (e.data?.data) take(e.data.data, e.data.frame / ctx.sampleRate);
          if (e.data?.done) {
            clearTimeout(timeout);
            done();
          }
        };
        w.port.postMessage('stop');
      });
    }
    close();
    if (firstTime === null || !chunks[0].length) return null;
    const length = chunks[0].reduce((n, c) => n + c.length, 0);
    const channels = chunks.map((list) => {
      const out = new Float32Array(length);
      let at = 0;
      for (const c of list) {
        out.set(c, at);
        at += c.length;
      }
      return out;
    });
    // (The music heard then was scheduled the mix's delay compensation earlier)
    const heardAt = firstTime - outputLatencySeconds() - mixDelaySeconds() - inputLatency;
    return { channels, sampleRate: ctx.sampleRate, startBar: transportBarAt(heardAt), heardAt };
  }
}
