/**
 * Loading a sample pack: a folder of sound files, dropped or picked, sorted (see store/samplePack.ts)
 * into Drum Rack kits, Multi Sampler instruments, an Audio track of its loops and pads for its other
 * one-shots, each sound loaded into the library once. Says what it made, and what it left out and why.
 */
import { useTimelineStore } from '../../store/timelineStore';
import type { DrumRack, SoundMeta } from '../../store/timelineTypes';
import { defaultMulti, defaultRack, mapZones } from '../../store/sampleKits';
import { baseName, packName, planPack, type PackPlan } from '../../store/samplePack';
import { RACK_PADS } from '../../store/timelineTypes';
import { importSoundFile, MAX_SOUND_BYTES, SoundError } from '../../audio/soundLibrary';
import { showToast } from './toastStore';
import type { PathFile } from './audioFiles';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Load the plan's sounds into the library, one at a time (a long pack shows its progress). */
async function loadSounds(files: readonly PathFile[], wanted: readonly number[], failed: string[]): Promise<Map<number, SoundMeta>> {
  const loaded = new Map<number, SoundMeta>();
  let done = 0;
  for (const i of wanted) {
    if (wanted.length > 8 && done % 8 === 0) showToast(`Loading the sample pack… ${done} of ${wanted.length} sounds`);
    done++;
    try {
      loaded.set(i, await importSoundFile(files[i].file, baseName(files[i].path)));
    } catch (err) {
      failed.push(err instanceof SoundError ? baseName(files[i].path) : files[i].path);
    }
  }
  return loaded;
}

/** The files a plan loads, each once. */
function wantedFiles(plan: PackPlan): number[] {
  return [
    ...plan.kits.flatMap((k) => k.pads.flatMap((p) => (p ? [p.file] : []))),
    ...plan.instruments.flatMap((inst) => inst.files.map((f) => f.file)),
    ...plan.loops,
    ...plan.oneShots,
  ];
}

/** A kit's pads as a Drum Rack (its sounds as loaded; a sound that didn't load leaves its pad empty). */
function rackOf(kit: PackPlan['kits'][number], loaded: Map<number, SoundMeta>): DrumRack {
  const rack = defaultRack();
  return {
    pads: rack.pads.map((pad, i) => {
      const p = kit.pads[i];
      const sound = p ? loaded.get(p.file) : undefined;
      return sound && p ? { ...pad, soundId: sound.id, name: p.name } : pad;
    }),
  };
}

/** What was left out, for the message. */
function leftOut(plan: PackPlan, failed: readonly string[]): string {
  const big = plan.skipped.filter((s) => s.reason === 'too big').length;
  const many = plan.skipped.filter((s) => s.reason === 'too many').length;
  const parts = [
    ...(big ? [`${plural(big, 'file')} over ${MAX_SOUND_BYTES / 1048576} MB (sounds are kept in this browser and saved inside the project file, so each is limited: trim long ones or save them as MP3)`] : []),
    ...(many ? [`${plural(many, 'sound')} past the first ${wantedFiles(plan).length} (load a smaller folder for those)`] : []),
    ...(failed.length ? [`${plural(failed.length, 'file')} the browser couldn't read (${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''})`] : []),
  ];
  return parts.length ? ` Left out: ${parts.join('; ')}.` : '';
}

/**
 * Sort a pack and make its tracks: a Drum Rack per kit, a Multi Sampler per instrument, an Audio
 * track (muted) with the loops end to end to audition and drag where they belong, and Drum Racks
 * of the other one-shots. Each track is its own undo step.
 */
export async function importSamplePack(files: readonly PathFile[]): Promise<void> {
  if (!files.length) return;
  const plan = planPack(
    files.map((f) => ({ path: f.path, size: f.file.size })),
    { maxBytes: MAX_SOUND_BYTES }
  );
  const wanted = wantedFiles(plan);
  if (!wanted.length) {
    showToast(`No sounds to load in that folder.${leftOut(plan, [])}`);
    return;
  }
  const failed: string[] = [];
  const loaded = await loadSounds(files, wanted, failed);
  const s = useTimelineStore.getState();
  const name = packName(files.map((f) => ({ path: f.path, size: f.file.size })));
  let kits = 0;
  let instruments = 0;
  for (const kit of plan.kits) {
    const rack = rackOf(kit, loaded);
    if (!rack.pads.some((p) => p.soundId)) continue;
    const id = s.addTrack('drumRack', kit.name);
    useTimelineStore.getState().setTrackRack(id, rack, false);
    kits++;
  }
  for (const inst of plan.instruments) {
    const sounds = inst.files.flatMap((f) => {
      const meta = loaded.get(f.file);
      return meta ? [{ soundId: meta.id, name: baseName(files[f.file].path), root: f.root }] : [];
    });
    if (sounds.length < 2) continue;
    const id = s.addTrack('multiSampler', inst.name);
    useTimelineStore.getState().setTrackMulti(id, { ...defaultMulti(), zones: mapZones(sounds) }, false);
    instruments++;
  }
  // Other one-shots: pads of their own, 16 a rack
  const shots = plan.oneShots.filter((i) => loaded.has(i));
  for (let k = 0; k * RACK_PADS < shots.length; k++) {
    const part = shots.slice(k * RACK_PADS, (k + 1) * RACK_PADS);
    const rack = rackOf({ name: '', pads: part.map((file) => ({ file, name: baseName(files[file].path).slice(0, 40) })) }, loaded);
    const id = s.addTrack('drumRack', `${name} one-shots${k ? ` ${k + 1}` : ''}`.slice(0, 40));
    useTimelineStore.getState().setTrackRack(id, rack, false);
  }
  // Loops: end to end on an Audio track, muted so they don't play over the song
  const loops = plan.loops.flatMap((i) => (loaded.has(i) ? [loaded.get(i)!] : []));
  let loopCount = 0;
  if (loops.length) {
    const message = s.addAudioClips(null, 1, loops);
    const st = useTimelineStore.getState();
    const id = st.selectedTrackId;
    if (message) showToast(message);
    else if (id) {
      loopCount = st.clips.filter((c) => c.trackId === id).length;
      useTimelineStore.setState({ tracks: st.tracks.map((t) => (t.id === id ? { ...t, name: `${name} loops`.slice(0, 40), isMuted: true } : t)) });
    }
  }
  const made = [
    ...(kits ? [plural(kits, 'Drum Rack kit')] : []),
    ...(instruments ? [plural(instruments, 'Multi Sampler instrument')] : []),
    ...(shots.length ? [`${plural(shots.length, 'other one-shot')} on pads`] : []),
    ...(loopCount ? [`${plural(loopCount, 'loop')} on a muted Audio track (unmute to hear them, drag the ones you want onto your tracks)`] : []),
  ];
  showToast(`${made.length ? `Loaded ${made.join(', ')}.` : 'Nothing could be loaded.'}${leftOut(plan, failed)}`);
}

/**
 * A folder's drums onto one Drum Rack (the pads replaced from pad 1, in kit order: kick, snare,
 * clap...). Returns the rack, or null if the folder has no drum one-shots.
 */
export async function kitFromFolder(files: readonly PathFile[], current: DrumRack): Promise<DrumRack | null> {
  const plan = planPack(
    files.map((f) => ({ path: f.path, size: f.file.size })),
    { maxBytes: MAX_SOUND_BYTES, maxKits: 1 }
  );
  const kit = plan.kits[0];
  if (!kit) {
    showToast(`No drum one-shots found in that folder (kicks, snares, hats… named so, or in folders named so).${leftOut(plan, [])}`);
    return null;
  }
  const failed: string[] = [];
  const loaded = await loadSounds(files, kit.pads.flatMap((p) => (p ? [p.file] : [])), failed);
  const rack = rackOf(kit, loaded);
  // Pads the kit has no sound for keep what they had
  const merged = { pads: rack.pads.map((p, i) => (p.soundId ? { ...current.pads[i], soundId: p.soundId, name: p.name } : current.pads[i])) };
  const count = rack.pads.filter((p) => p.soundId).length;
  showToast(`Loaded ${plural(count, 'pad')} from the folder.${leftOut({ ...plan, kits: [kit], instruments: [], loops: [], oneShots: [] }, failed)}`);
  return merged;
}
