/**
 * The piano roll's second toolbar for pitched clips: chords by scale degree (click I, V, vi, IV
 * and the progression builds from the playhead, voiced smoothly), the arpeggiator (pattern,
 * octaves, speed, note length) and the riff generator (a riff, lead line or bass line in the key
 * that follows the chords on the other tracks; New riff gives another). The maths is in
 * store/chordTools.ts; linked clips follow every change (see store/patterns.ts).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dices, Link2, Unlink } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import type { Clip, InstrumentKey, NoteEvent } from '../../store/timelineTypes';
import { uid } from '../../store/timelineTypes';
import { SCALES, type Scale } from '../../store/noteTools';
import { detectKey, keyOf, NOTE_NAMES, type SongKey } from '../../store/songKey';
import { chordChanges } from '../../store/smartTools';
import { ARP_STYLES, arpeggiateChords, degreeChordName, degreeLabels, riff, RIFF_STYLES, stampDegree, type ArpStyle, type RiffStyle } from '../../store/chordTools';
import { INSTRUMENTS, isDrumKind, isFxKind, isMixKind, isRackKind, isSlicerKind } from '../../audio/instrumentCatalog';
import { patternLabelOf, patternSize } from '../../store/patterns';
import { showToast } from './toastStore';

const select = 'bg-forge-bg border border-forge-border rounded px-1.5 py-0.5 text-forge-text';
const button = 'h-6 px-2 rounded border border-forge-border text-forge-text hover:border-cyan-400 hover:text-cyan-200 disabled:opacity-40';

/** The clip's key: the piano roll's scale when it has seven notes (major or minor by its third), else the song's. */
export function keyFor(scale: Scale | null, clips: readonly Clip[], tracks: Parameters<typeof detectKey>[1]): SongKey {
  const steps = scale ? (SCALES[scale.id].steps as readonly number[]) : null;
  if (scale && steps && steps.length === 7) return { ...keyOf(scale.root, steps[2] === 3 ? 'minor' : 'major'), steps, name: `${NOTE_NAMES[scale.root]} ${SCALES[scale.id].name.toLowerCase()}` };
  return detectKey(clips, tracks) ?? keyOf(0, 'major');
}

/**
 * The chords under `clip` on another track: of the pitched tracks with notes over its bars, the
 * one that plays the most chords (three notes or more at once), as chord changes from the clip's start.
 */
function chordsUnder(clip: Clip): Array<{ at: number; end: number; pcs: number[] }> {
  const s = useTimelineStore.getState();
  const from = clip.startBar;
  const to = clip.startBar + clip.lengthBars;
  let best: NoteEvent[] = [];
  let bestChords = 0;
  for (const t of s.tracks) {
    const k = t.instrumentKey;
    if (t.id === clip.trackId || isDrumKind(k) || isFxKind(k) || isRackKind(k) || isSlicerKind(k) || isMixKind(k)) continue;
    const notes = s.clips
      .filter((c) => c.trackId === t.id && !c.audio && c.startBar < to && c.startBar + c.lengthBars > from)
      .flatMap((c) => c.notes.map((n) => ({ ...n, startOffset: c.startBar + n.startOffset - from })));
    const starts = new Map<number, number>();
    for (const n of notes) starts.set(Math.round(n.startOffset * 192), (starts.get(Math.round(n.startOffset * 192)) ?? 0) + 1);
    const chords = [...starts.values()].filter((v) => v >= 3).length;
    if (chords > bestChords) {
      best = notes;
      bestChords = chords;
    }
  }
  return bestChords ? chordChanges(best, clip.lengthBars) : [];
}

interface Props {
  clip: Clip;
  instrument: InstrumentKey;
  scale: Scale | null;
  /** The grid and the note length, in bars */
  gridBars: number;
  noteBars: number;
  velocity: number;
  selected: ReadonlySet<string>;
  /** A pitched clip: the chord, arpeggio and riff tools (a drum clip only shows its links) */
  pitched: boolean;
  /** Write the clip's notes (one undo step), selecting `select` if given */
  apply: (notes: NoteEvent[], select?: string[]) => void;
}

/** The New riff button's next seed, per clip, so each press gives another and they come back the same */
const riffSeeds = new Map<string, number>();

export const ChordRiffBar: React.FC<Props> = ({ clip, instrument, scale, gridBars, noteBars, velocity, selected, pitched, apply }) => {
  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  // (Worked out when the notes or the scale change, not on every render)
  const key = useMemo(() => keyFor(scale, clips, tracks), [scale, clips, tracks]);
  const labels = degreeLabels(key);
  const [sevenths, setSevenths] = useState(false);
  const [arp, setArp] = useState<{ style: ArpStyle; octaves: number; rate: number; gate: number }>({ style: 'up', octaves: 1, rate: 0, gate: 0.8 });
  // (A bass instrument starts on bass lines)
  const [riffStyle, setRiffStyle] = useState<RiffStyle>(INSTRUMENTS[instrument].range[1] <= 64 ? 'bass' : 'pluck');
  // The last chord stamped (for smooth voicing), per clip
  const last = useRef<{ clipId: string; voiced: number[] } | null>(null);
  useEffect(() => {
    if (last.current?.clipId !== clip.id) last.current = null;
  }, [clip.id]);
  const [lo, hi] = INSTRUMENTS[instrument].range;
  const center = Math.max(lo + 7, Math.min(hi - 7, 62));
  const notes = () => useTimelineStore.getState().clips.find((c) => c.id === clip.id)?.notes ?? [];
  const links = patternSize(clips, clip.pattern);
  const linkLabel = patternLabelOf(clips, clip.pattern);

  /** A chord of the key at the playhead (in the clip) or the clip's start; then the playhead moves on by its length. */
  const stamp = (degree: number) => {
    // (Read now, not subscribed to: the playhead moves every frame while the song plays)
    const playhead = useTimelineStore.getState().playheadPosition;
    const inClip = playhead >= clip.startBar - 1e-6 && playhead < clip.startBar + clip.lengthBars - 1e-6;
    const at = inClip ? Math.round((playhead - clip.startBar) / gridBars) * gridBars : 0;
    const length = Math.max(gridBars, Math.min(noteBars, clip.lengthBars - at));
    const { notes: added, voiced } = stampDegree(key, degree, { seventh: sevenths, at, lengthBars: length, prev: last.current?.clipId === clip.id ? last.current.voiced : null, center, velocity }, () => uid('note'));
    last.current = { clipId: clip.id, voiced };
    apply([...notes(), ...added]);
    const next = clip.startBar + at + length;
    if (next < clip.startBar + clip.lengthBars - 1e-6) useTimelineStore.getState().seek(next);
  };

  const arpeggiate = () => {
    const all = notes();
    const target = selected.size ? all.filter((n) => selected.has(n.id)) : all;
    const out = arpeggiateChords(target, { style: arp.style, octaves: arp.octaves, rateBars: arp.rate || gridBars, gate: arp.gate, seed: all.length + 1 }, () => uid('note'));
    if (out.length === target.length && out.every((n, i) => n === target[i])) {
      showToast('No chords to arpeggiate: notes that start together make a chord.');
      return;
    }
    apply([...all.filter((n) => !target.includes(n)), ...out], selected.size ? out.map((n) => n.id) : undefined);
  };

  const newRiff = () => {
    const seed = riffSeeds.get(clip.id) ?? 1;
    riffSeeds.set(clip.id, seed + 1);
    const chords = chordsUnder(clip);
    const out = riff(key, { style: riffStyle, lengthBars: clip.lengthBars, seed, chords, range: [lo, hi] }, () => uid('note'));
    if (!out.length) {
      showToast("This instrument's range has no room for a riff in the key.");
      return;
    }
    apply(out.map((n) => ({ ...n, velocity: Math.min(1, n.velocity * (velocity / 0.8)) })));
    showToast(`Riff ${seed} in ${key.name}${chords.length ? ', over the chords on the other tracks' : ''}. New riff again for another; Undo for the last.`);
  };

  if (!pitched && links < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-1.5 border-b border-forge-border text-xs font-mono text-forge-muted">
      {links > 1 && (
        <span className="flex items-center gap-1.5 text-cyan-200" title="Linked clips play the same notes: this edit changes all of them">
          <Link2 className="w-3.5 h-3.5" />
          {linkLabel}: {links} linked clips
          <button type="button" className={button} onClick={() => useTimelineStore.getState().makeClipsUnique([clip.id])} title="Make this clip its own: it keeps its notes, and edits stop reaching the others">
            <Unlink className="w-3 h-3 inline mr-1" />
            Make unique
          </button>
        </span>
      )}
      {pitched && (
      <>
      <span data-search="chords by degree progression roman" className="flex items-center gap-1" title={`Chords of ${key.name} (the SCALE, else the song's key). Click one to add it at the playhead, the note length long; the playhead moves on, so clicking I V vi IV builds a progression.`}>
        IN {key.name.toUpperCase()}
        {labels.map((l, d) => (
          <button key={l} type="button" className={`${button} min-w-[2.2rem]`} onClick={() => stamp(d)} title={degreeChordName(key, d, sevenths)}>
            {l}
            {sevenths ? '7' : ''}
          </button>
        ))}
        <label className="flex items-center gap-1 ml-1 cursor-pointer" title="Four-note 7th chords instead of triads">
          <input type="checkbox" checked={sevenths} onChange={(e) => setSevenths(e.target.checked)} className="accent-cyan-500" />
          7THS
        </label>
      </span>
      <span data-search="arpeggiator arp" className="flex items-center gap-1.5" title={selected.size ? 'Arpeggiate the selected chords' : 'Arpeggiate every chord in the clip (select some to change only those)'}>
        ARP
        <select className={select} value={arp.style} onChange={(e) => setArp({ ...arp, style: e.target.value as ArpStyle })} aria-label="Arpeggio pattern">
          {ARP_STYLES.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <select className={select} value={arp.octaves} onChange={(e) => setArp({ ...arp, octaves: Number(e.target.value) })} aria-label="Octaves">
          {[1, 2, 3].map((o) => (
            <option key={o} value={o}>{o} oct</option>
          ))}
        </select>
        <select className={select} value={arp.rate} onChange={(e) => setArp({ ...arp, rate: Number(e.target.value) })} aria-label="Speed">
          <option value={0}>grid</option>
          <option value={1 / 8}>1/8</option>
          <option value={1 / 12}>1/8T</option>
          <option value={1 / 16}>1/16</option>
          <option value={1 / 24}>1/16T</option>
          <option value={1 / 32}>1/32</option>
        </select>
        <select className={select} value={arp.gate} onChange={(e) => setArp({ ...arp, gate: Number(e.target.value) })} aria-label="Note length">
          <option value={0.3}>staccato</option>
          <option value={0.5}>short</option>
          <option value={0.8}>normal</option>
          <option value={1}>legato</option>
        </select>
        <button type="button" className={button} onClick={arpeggiate}>
          Apply
        </button>
      </span>
      <span data-search="riff generator melody hook bassline" className="flex items-center gap-1.5" title="A new riff in the key over the whole clip (replacing its notes), following the chords on your other tracks">
        RIFF
        <select className={select} value={riffStyle} onChange={(e) => setRiffStyle(e.target.value as RiffStyle)} aria-label="Riff style">
          {RIFF_STYLES.map((r) => (
            <option key={r.id} value={r.id} title={r.detail}>{r.name}</option>
          ))}
        </select>
        <button type="button" className={button} onClick={newRiff}>
          <Dices className="w-3 h-3 inline mr-1" />
          New riff
        </button>
      </span>
      </>
      )}
    </div>
  );
};
