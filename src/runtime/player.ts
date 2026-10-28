/**
 * Fledgetone runtime for web games: load a project file (.json, as Save makes it) and play its
 * music with no audio files at all. The song's states, stems, stingers and transitions are
 * synthesized in the browser when it loads, by the same engine the app uses, then played by the
 * game kit's adaptive player (see src/gameKit/adaptive-music.js), so it behaves exactly as the
 * Game preview's audition and the exported kit do.
 *
 *   import { loadSong } from './bos-player.js';
 *   const music = await loadSong('music/my-song.json', { onProgress: (f) => bar.value = f });
 *   music.play('Explore');      // after a click or key press
 *   music.setState('Combat');   // by the song's transition rules
 *   music.setIntensity(0.8);    // crossfades the stem groups
 *   music.stinger('Victory');
 *
 * Recorded instruments download their samples from the same public sound libraries as the app
 * (so they need a connection); the built-in synths need nothing, and plugins (Fledge Synth...) load
 * from fledgetone-plugins/ next to this file (the runtime kit puts them there), else fledgetone.com.
 * A plugin that can't be loaded makes loadSong reject, rather than play its part silent. Audio clips
 * and the Sampler play from the sounds a saved project file carries inside it.
 */
import { parseProject, type ProjectSnapshot } from '../store/project';
import { buildGameKitParts, type GameKitSong } from '../audio/gameKit';
import { importEmbeddedSounds } from '../audio/soundLibrary';
import { normalizeTrackFx, DEFAULT_MASTER_FX, defaultMasterSettings } from '../store/timelineTypes';
import { AdaptiveMusic } from '../gameKit/adaptive-music.js';
import { pluginFamilies } from '../audio/plugins/pluginSources';
import { preloadFamily } from '../audio/plugins/builtinHost';
import { songPlugins } from '../audio/runtimePlugins';

export { AdaptiveMusic };

export interface LoadOptions {
  /** The game's AudioContext (one is made if not given) */
  context?: AudioContext;
  /** Where the music plays into (the context's destination if not given) */
  destination?: AudioNode;
  /** Hears 0 to 1 as the music is synthesized, and what's being made */
  onProgress?: (fraction: number, detail: string) => void;
}

/** The song as the game kit builder needs it. */
function songOf(p: ProjectSnapshot): GameKitSong {
  return {
    name: p.name,
    bpm: p.bpm,
    tempoPoints: p.tempoPoints ?? [],
    meter: p.meter,
    meterPoints: p.meterPoints ?? [],
    swing: p.swing,
    tracks: p.tracks.map((t) => ({ ...t, fx: normalizeTrackFx(t.fx) })),
    clips: p.clips,
    markers: p.markers ?? [],
    masterFx: p.masterFx ?? DEFAULT_MASTER_FX,
    master: p.master ?? defaultMasterSettings(),
    stingers: p.stingers ?? [],
    transitions: p.transitions ?? {},
    intensity: p.intensity?.value ?? 1,
    intensityCurves: p.intensity?.curves ?? {},
    sfx: p.sfx ?? [],
    costumes: p.costumes ?? [],
    gameParams: p.gameParams ?? [],
    stateOptions: p.stateOptions ?? {},
  };
}

/**
 * Load a project (a URL to its .json, or the parsed JSON itself), synthesize its music, and return
 * an AdaptiveMusic player ready to play it.
 */
export async function loadSong(source: string | object, opts: LoadOptions = {}): Promise<AdaptiveMusic> {
  let raw: unknown = source;
  if (typeof source === 'string') {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Couldn't load ${source}: ${res.status} ${res.statusText}`);
    raw = await res.json();
  }
  const project = parseProject(raw);
  // The plugins it plays, loaded first: one that can't be would leave its part silent
  const plugins = songPlugins(project.tracks, pluginFamilies());
  if (plugins.missing.length) throw new Error(`This player can't play ${plugins.missing.join(', ')} (not in the runtime)`);
  for (const f of plugins.families) {
    await preloadFamily(f).catch((err: unknown) => {
      throw new Error(`Couldn't load the ${f.label} plugins (fledgetone-plugins/${f.file}, next to bos-player.js): ${err instanceof Error ? err.message : String(err)}`);
    });
  }
  if (project.sounds?.length) await importEmbeddedSounds(project.sounds);
  // With stem groups the player mixes the stems, so each state's whole mix isn't made
  const { manifest, files } = await buildGameKitParts(songOf(project), opts.onProgress, 44100, true, undefined, 'playback');
  const ctx = opts.context ?? new AudioContext();
  const buffers = new Map<string, AudioBuffer>();
  for (const f of files) buffers.set(f.name, await ctx.decodeAudioData(await f.data.arrayBuffer()));
  const music = new AdaptiveMusic(ctx, opts.destination);
  music.loadFrom(manifest, buffers);
  return music;
}
