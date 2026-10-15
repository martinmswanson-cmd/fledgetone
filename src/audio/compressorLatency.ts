/**
 * How long a browser compressor (DynamicsCompressorNode, which Tone.Compressor is) holds back the
 * sound passing through it: its fixed look-ahead, about 6 ms, but it differs between browsers and
 * sample rates, so it is measured rather than assumed. Once per sample rate, by sending a click
 * through one in a tiny offline render and finding where it comes out; the answer is kept.
 */

const measured = new Map<number, Promise<number>>();
const known = new Map<number, number>();

/** Frames a compressor delays the sound by at `sampleRate` (0 if it can't be measured here). */
export function measureCompressorLatency(sampleRate: number): Promise<number> {
  let latency = measured.get(sampleRate);
  if (!latency) {
    latency = (async () => {
      if (typeof OfflineAudioContext === 'undefined') return 0;
      const probe = new OfflineAudioContext(1, 4096, sampleRate);
      const click = probe.createBuffer(1, 1, sampleRate);
      click.getChannelData(0)[0] = 0.01; // well under the threshold, so the gain stays put
      const source = probe.createBufferSource();
      source.buffer = click;
      source.connect(probe.createDynamicsCompressor()).connect(probe.destination);
      source.start(0);
      const out = (await probe.startRendering()).getChannelData(0);
      let at = 0;
      for (let i = 1; i < out.length; i++) if (Math.abs(out[i]) > Math.abs(out[at])) at = i;
      return at;
    })().catch(() => 0);
    latency.then((frames) => known.set(sampleRate, frames));
    measured.set(sampleRate, latency);
  }
  return latency;
}

/** The measured delay at `sampleRate` if it's known yet (see measureCompressorLatency), else undefined. */
export function compressorLatencyNow(sampleRate: number): number | undefined {
  return known.get(sampleRate);
}
