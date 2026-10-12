import { liveMix } from './engine';
import { outputLatencySeconds } from './latency';
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
}

export interface MicSession {
  /** Peak of the last block, 0..1, for a level meter. */
  level: () => number;
  /** Stop, and give back what was recorded (null if nothing was). */
  stop: () => MicTake | null;
  /** Stop and throw it away. */
  cancel: () => void;
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
  const proc = ctx.createScriptProcessor(4096, channelCount, channelCount);
  const silent = ctx.createGain();
  silent.gain.value = 0;
  const chunks: Float32Array[][] = Array.from({ length: channelCount }, () => []);
  let firstTime: number | null = null;
  let peak = 0;
  proc.onaudioprocess = (e) => {
    if (firstTime === null) firstTime = e.playbackTime;
    let p = 0;
    for (let c = 0; c < channelCount; c++) {
      const data = e.inputBuffer.getChannelData(c);
      chunks[c].push(new Float32Array(data));
      for (let i = 0; i < data.length; i += 8) p = Math.max(p, Math.abs(data[i]));
    }
    peak = p;
  };
  source.connect(proc);
  // A script processor only runs while connected onward: through a silent gain
  proc.connect(silent);
  silent.connect(ctx.destination);
  const inputLatency = (stream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number }).latency ?? 0;

  const close = () => {
    proc.onaudioprocess = null;
    source.disconnect();
    proc.disconnect();
    silent.disconnect();
    stream.getTracks().forEach((t) => t.stop());
  };
  return {
    level: () => peak,
    cancel: close,
    stop: () => {
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
      const heardAt = firstTime - outputLatencySeconds() - inputLatency;
      return { channels, sampleRate: ctx.sampleRate, startBar: transportBarAt(heardAt) };
    },
  };
}
