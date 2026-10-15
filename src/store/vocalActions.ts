/**
 * The rap vocal tools' store actions: put a vocal chain preset on a track, make an Ad-lib track
 * ready to record, and double a take (rendered by vocalDouble.ts onto a new track under the
 * take's, panned left and right and lower). Each is one undo step. The maths is in
 * vocalChains.ts and vocalDouble.ts; this file only applies it.
 */
import { useTimelineStore } from './timelineStore';
import { withVocalChain, vocalChain, type VocalChainId } from './vocalChains';
import { uid, type Clip, type Track } from './timelineTypes';
import { decodeSound, importSoundFile, useSoundLibrary } from '../audio/soundLibrary';
import { encodeChannels } from '../audio/exportWav';
import { doubleSeed, doubleTake } from '../audio/vocalDouble';

const RATE = 44100;
/** How much lower a double plays than the take, dB (the track's fader). */
export const DOUBLE_LEVEL_DB = -7;

/** Put vocal chain `id` on a track: one undo step that replaces only its built-in inserts (and, for Ad-lib, its pan). */
export function applyVocalChain(trackId: string, id: VocalChainId): void {
  const s = useTimelineStore.getState();
  if (!s.tracks.some((t) => t.id === trackId)) return;
  s.checkpoint();
  useTimelineStore.setState((st) => ({ tracks: st.tracks.map((t) => (t.id === trackId ? withVocalChain(t, id) : t)) }));
}

/**
 * A new Audio track named Ad-libs with the Ad-lib chain on, under `afterTrackId` (or at the end),
 * selected so the mic records onto it. One undo step. Returns its id.
 */
export function addAdlibTrack(afterTrackId?: string): string {
  const s = useTimelineStore.getState();
  const count = s.tracks.filter((t) => /^Ad-libs\b/.test(t.name)).length;
  // (addTrack is the undo step; the chain and the move go in with it)
  const id = s.addTrack('audio', count ? `Ad-libs ${count + 1}` : 'Ad-libs');
  useTimelineStore.setState((st) => {
    const made = st.tracks.find((t) => t.id === id);
    if (!made) return st;
    const track = { ...withVocalChain(made, 'adlib'), color: '#f472b6', reverbSend: 0 };
    const rest = st.tracks.filter((t) => t.id !== id);
    const after = afterTrackId ? rest.findIndex((t) => t.id === afterTrackId) : -1;
    const at = after >= 0 ? after + 1 : rest.length;
    return { tracks: [...rest.slice(0, at), track, ...rest.slice(at)], selectedTrackId: id };
  });
  return id;
}

/**
 * Double a take: render two new performances of the clip's sound (seeded from the clip, so it
 * doubles the same way every time), put them on a new track under the take's as one stereo
 * sound (one per side), with the take's chain, DOUBLE_LEVEL_DB lower. Returns a message for the
 * person.
 */
export async function doubleClip(clipId: string): Promise<string> {
  const s = useTimelineStore.getState();
  const clip = s.clips.find((c) => c.id === clipId);
  if (!clip?.audio) return 'Pick a recorded take (an audio clip) to double.';
  if ((clip.takes?.length ?? 0) > 1) return 'This clip is a take folder: flatten it first (Takes…), then double it.';
  const source = s.tracks.find((t) => t.id === clip.trackId);
  if (!source) return 'That clip has no track.';
  const buffer = await decodeSound(clip.audio.soundId, RATE);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  // (The whole recording, so the double keeps the clip's place, trim and fades in it)
  const doubled = doubleTake(channels, RATE, { seed: doubleSeed(clip.id) });
  const name = useSoundLibrary.getState().metas[clip.audio.soundId]?.name ?? clip.name;
  const sound = await importSoundFile(new Blob([encodeChannels(doubled.channels, RATE, 24)], { type: 'audio/wav' }), `${name.replace(/\.[a-z0-9]+$/i, '')} (double).wav`);

  const now = useTimelineStore.getState();
  const still = now.clips.find((c) => c.id === clipId);
  const from = now.tracks.find((t) => t.id === source.id);
  if (!still?.audio || !from) return 'The take was removed while it was being doubled.';
  now.checkpoint();
  // The take's sound (its chain, sends, routing and folder), lower; not its automation, plugins or dialogue dip
  const track: Track = {
    id: uid('track'),
    name: `${from.name} double`,
    color: from.color,
    instrumentKey: 'audio',
    isMuted: from.isMuted,
    isSoloed: from.isSoloed,
    isArmed: false,
    volume: Math.max(-60, from.volume + DOUBLE_LEVEL_DB),
    // The double is stereo already (one performance per side): centred, it stays wide
    pan: 0,
    eq: { ...from.eq },
    fx: structuredClone(from.fx),
    reverbSend: from.reverbSend,
    delaySend: from.delaySend,
    ...(from.distance !== undefined ? { distance: from.distance } : {}),
    ...(from.sends ? { sends: from.sends.map((x) => ({ ...x })) } : {}),
    ...(from.output ? { output: from.output } : {}),
    ...(from.folder ? { folder: from.folder } : {}),
    ...(from.stemGroup ? { stemGroup: from.stemGroup } : {}),
  };
  const audio = { ...still.audio, soundId: sound.id };
  delete audio.tunedFrom;
  delete audio.reversedFrom;
  const copy: Clip = { ...still, id: uid('clip'), trackId: track.id, name: `${still.name} double`, isSelected: false, audio };
  delete copy.takes;
  delete copy.comp;
  useTimelineStore.setState((st) => {
    const at = st.tracks.findIndex((t) => t.id === from.id) + 1;
    return { tracks: [...st.tracks.slice(0, at), track, ...st.tracks.slice(at)], clips: [...st.clips, copy] };
  });
  return `Doubled "${still.name}" onto "${track.name}": left and right, ${-DOUBLE_LEVEL_DB} dB lower. Undo takes it away.`;
}

/** The chain's name, for messages. */
export const chainName = (id: VocalChainId): string => vocalChain(id).name;
