/**
 * The home page's song player (site/main.js, the "made in Fledgetone" song): a saved project file
 * rendered in the visitor's browser exactly as Export makes it (renderMixdown, matched to the
 * Streaming target), so the page plays the song with no audio file on the site. Built separately
 * (vite.site.config.ts) into dist-runtime/fledgetone-site-player.js; the site build copies it to
 * /player/. The page loads it only when Play is pressed.
 *
 *   const song = await renderForPage('/video/song.fledgetone.json', { samples: '/app/', onProgress });
 *   // song.audio: an AudioBuffer to play; song.lufs: its loudness (the Streaming target)
 *
 * No store here, as in the other runtimes (player.ts, render.ts).
 */
import { exportCeilingDbtp } from '../audio/effects/limiter';
import { renderMixdown } from '../audio/exportMix';
import { INSTRUMENTS } from '../audio/instrumentCatalog';
import { targetById } from '../audio/loudnessTarget';
import { exportRenderOptions, prepare, songEnd } from './render';

export interface PageRender {
  audio: AudioBuffer;
  /** Its integrated loudness, LUFS (as the export's). */
  lufs: number;
}

/**
 * The app's recordings are addressed from the page they play in (fledgetone-samples/...), which is
 * the studio's folder. On the home page they're one folder down: every relative address is made to
 * start at `base` (such as '/app/'), so they come from the site's own copy, with no failed requests.
 */
function samplesFrom(base: string): void {
  const fix = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k === 'baseUrl' && typeof v === 'string' && v.startsWith('fledgetone-')) (o as Record<string, unknown>)[k] = base + v;
      else fix(v);
    }
  };
  for (const d of Object.values(INSTRUMENTS)) fix(d);
}

let based = '';

/** Load a project file and render the whole song as Export does (WAV's ceiling, the Streaming target). */
export async function renderForPage(url: string, opts: { samples: string; onProgress?: (fraction: number) => void }): Promise<PageRender> {
  if (based !== opts.samples) {
    if (based) throw new Error('The recordings already come from another folder');
    samplesFrom(opts.samples);
    based = opts.samples;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url}: ${res.status} ${res.statusText}`);
  const p = await prepare(await res.json());
  const ceilingDbtp = exportCeilingDbtp('wav');
  const render = exportRenderOptions(p, { fromBar: 1, toBar: songEnd(p), ending: 'ringOut', sampleRate: 44100, ceilingDbtp });
  const loudOn = !!p.master?.loud?.on;
  const target = targetById(loudOn ? p.master!.loud!.target : 'streaming');
  const { audio, reading } = await renderMixdown(render, { normalize: true, target, loudMaster: loudOn, ceilingDbtp }, (f) => opts.onProgress?.(Math.min(0.97, f)));
  opts.onProgress?.(1);
  return { audio, lufs: reading.integrated };
}
