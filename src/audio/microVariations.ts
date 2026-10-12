import { renderArrangement, channelsOf } from './exportWav';
import type { Clip, MasterFx, MasterSettings, Track } from '../store/timelineTypes';
import { takeNotes, trimmedLength, type VariationTake } from '../store/microVariations';
import { hasRecordings, loadSamples } from './samplers/samplerManager';

/**
 * Render a clip's micro-variations (see microVariations.ts): each take through the clip's track
 * (instrument, inserts and EQ, but not the master), with its note lengths and velocities, its
 * brightness (the Filter's cutoff, or a gentle low-pass when the Filter is off), and its pitch (the
 * render resampled, as a sampler does: a higher take is a little shorter). Silence at the end is
 * trimmed, and every take shares one gain, so they keep their differences in level, peaking at -1 dBFS.
 */
export async function renderVariations(
  clip: Clip,
  track: Track,
  song: { bpm: number; masterFx: MasterFx; master: MasterSettings },
  takes: VariationTake[],
  keepSends: boolean,
  onProgress?: (fraction: number) => void
): Promise<{ takes: Float32Array[][]; sampleRate: number }> {
  if (hasRecordings(track.instrumentKey)) await loadSamples(track.instrumentKey);
  const sampleRate = 44100;
  const out: Float32Array[][] = [];
  for (const [i, take] of takes.entries()) {
    const filter = track.fx.filter.on
      ? { ...track.fx.filter, cutoff: Math.max(20, Math.min(20000, track.fx.filter.cutoff * take.cutoff)) }
      : take.cutoff !== 1
        ? { on: true, type: 'lowpass' as const, cutoff: Math.min(20000, 12000 * take.cutoff), resonance: Math.SQRT1_2, slope: 12 as const }
        : track.fx.filter;
    const t: Track = {
      ...track,
      isMuted: false,
      isSoloed: false,
      automation: undefined,
      fx: { ...track.fx, filter },
      ...(keepSends ? {} : { reverbSend: 0, delaySend: 0 }),
    };
    const c: Clip = { ...clip, startBar: 1, isSelected: false, notes: clip.audio ? clip.notes : takeNotes(clip.notes, take, song.bpm) };
    const audio = await renderArrangement({
      tracks: [t],
      clips: [c],
      bpm: song.bpm,
      swing: 0,
      masterFx: song.masterFx,
      master: song.master,
      startBar: 1,
      endBar: 1 + clip.lengthBars,
      ending: 'ringOut',
      sampleRate,
      bypassMaster: true,
    });
    let channels: Float32Array[] = channelsOf(audio).map((ch) => ch.slice());
    if (take.rate !== 1) channels = await resample(channels, sampleRate, take.rate);
    const keep = trimmedLength(channels, sampleRate);
    out.push(channels.map((ch) => ch.slice(0, Math.max(1, keep))));
    onProgress?.((i + 1) / takes.length);
  }
  // One gain for all: the loudest take peaks at -1 dBFS
  let peak = 0;
  for (const take of out) for (const ch of take) for (const v of ch) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? 0.891 / peak : 1;
  for (const take of out) for (const ch of take) for (let i = 0; i < ch.length; i++) ch[i] *= gain;
  return { takes: out, sampleRate };
}

/** Play the sound back `rate` times faster (higher and shorter), the way a sampler repitches. */
async function resample(channels: Float32Array[], sampleRate: number, rate: number): Promise<Float32Array[]> {
  const length = Math.max(1, Math.ceil(channels[0].length / rate));
  const ctx = new OfflineAudioContext(channels.length, length, sampleRate);
  const buffer = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
  channels.forEach((ch, i) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return Array.from({ length: rendered.numberOfChannels }, (_, i) => rendered.getChannelData(i).slice());
}
