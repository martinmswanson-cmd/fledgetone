/**
 * Pocket's Notes screen: melodies, chords and bass lines on a big grid that only has the notes of
 * the song's key (two octaves, moved up and down a whole octave at a time), so every tap is in
 * key. Tap an empty cell for a note as long as the length chosen, tap a note to take it away, tap
 * a row's name to hear it. The key is the song's (as detected from its notes) unless one is picked.
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Eraser, Plus } from 'lucide-react';
import { CHORD_STYLES, chordNotesFor, PROGRESSIONS, progressionChords, type ChordStyle, type Progression } from '../store/smartTools';
import { fitToInstrument } from '../store/smartActions';
import { paintHandlers } from './pocketPaint';
import { INSTRUMENTS } from '../audio/instrumentCatalog';
import { useTimelineStore } from '../store/timelineStore';
import { detectKey, keyOf, NOTE_NAMES, type SongKey } from '../store/songKey';
import { Card, pill, pillOn, Sheet, SheetItem } from './pocketUi';
import { clipsOf, editorOf, pickClip, pocketNoteId, usePlayPosition, usePocket } from './pocketStore';
import { noteSteps, noteToMidi, scaleRows, stepsPerBar, toggleCovering } from './pocketGrid';
import { BarPager, ClipPicker } from './PocketBeat';
import { audition } from './pocketSound';

const LENGTHS: Array<{ steps: number; label: string }> = [
  { steps: 1, label: '1/16' },
  { steps: 2, label: '1/8' },
  { steps: 4, label: '1/4' },
  { steps: 8, label: '1/2' },
  { steps: 16, label: 'Bar' },
];

export const PocketNotes: React.FC = () => {
  const tracks = useTimelineStore((s) => s.tracks);
  const allClips = useTimelineStore((s) => s.clips);
  const meter = useTimelineStore((s) => s.meter);
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const { noteTrackId, noteClipId, key: chosenKey } = usePocket();
  const [length, setLength] = useState(2);
  const [page, setPage] = useState(0);
  const [chordSheet, setChordSheet] = useState(false);
  const [chordStyle, setChordStyle] = useState<ChordStyle>('sustain');
  const [shift, setShift] = useState<Record<string, number>>({});
  const bar = usePlayPosition();

  const pitched = tracks.filter((t) => editorOf(t.instrumentKey) === 'notes');
  const track = pitched.find((t) => t.id === noteTrackId) ?? pitched[0] ?? null;
  const clips = clipsOf(allClips, track?.id ?? null);
  const clip = pickClip(clips, noteClipId, playhead);
  const perBar = stepsPerBar(meter);

  // The grid's middle: the clip's notes' middle, else the instrument's, moved by whole octaves
  const range = track ? INSTRUMENTS[track.instrumentKey].range : ([48, 72] as [number, number]);
  // The middle and the song's key are worked out when the clip opens, not on every note, so the
  // rows stay put while writing (a few notes can make the song's key read differently)
  const anchorKey = `${track?.id}|${clip?.id}`;
  const [anchor, setAnchor] = useState<{ key: string; midi: number; detected: SongKey | null } | null>(null);
  let base = anchor?.midi ?? 60;
  let detected = anchor?.detected ?? null;
  if (anchor?.key !== anchorKey) {
    const midis = (clip?.notes ?? []).map((n) => noteToMidi(n.note)).filter((m): m is number => m !== null);
    base = midis.length ? Math.round(midis.reduce((a, b) => a + b, 0) / midis.length) : Math.round((range[0] + range[1]) / 2);
    detected = detectKey(allClips, tracks);
    setAnchor({ key: anchorKey, midi: base, detected });
  }
  const key = chosenKey ?? detected ?? keyOf(9, 'minor');
  const centre = base + 12 * (shift[track?.id ?? ''] ?? 0);
  const rows = scaleRows(key, range, centre);
  const rowMidis = new Set(rows.map(noteToMidi));
  const offGrid = (clip?.notes ?? []).filter((n) => !rowMidis.has(noteToMidi(n.note))).length;

  const pages = clip ? Math.max(1, Math.ceil(clip.lengthBars - 1e-6)) : 1;
  const inClip = isPlaying && clip && bar >= clip.startBar && bar < clip.startBar + clip.lengthBars;
  const nowStep = inClip ? Math.floor((bar - clip.startBar) * perBar) : -1;
  const shownPage = isPlaying && inClip ? Math.floor(nowStep / perBar) : Math.min(page, pages - 1);
  const steps = Array.from({ length: perBar }, (_, i) => shownPage * perBar + i);
  const beatEvery = Math.max(1, Math.round(perBar / meter.num));

  if (!track) {
    return (
      <Card title="No instruments to write notes for">
        <p className="text-sm text-forge-muted">Add one on the Song screen (Instrument), then write its notes here.</p>
      </Card>
    );
  }

  const noteLength = LENGTHS.find((l) => l.steps === length)?.steps ?? 2;
  /** Whether a note on `row` sounds over `step` (one starting earlier and held through it counts). */
  const covered = (row: string, step: number) => {
    const m = noteToMidi(row);
    return (useTimelineStore.getState().clips.find((c) => c.id === clip?.id)?.notes ?? []).some((n) => {
      if (noteToMidi(n.note) !== m) return false;
      const from = Math.round(n.startOffset * perBar);
      return step >= from && step < from + noteSteps(n, perBar);
    });
  };
  const paint = paintHandlers(
    ({ row, step }) => covered(row, step),
    ({ row, step }, on) => {
      if (!clip) return;
      const s = useTimelineStore.getState();
      const before = s.clips.find((c) => c.id === clip.id)?.notes ?? [];
      s.setClipNotes(clip.id, toggleCovering(before, row, step, perBar, noteLength, 0.8, pocketNoteId));
      if (on) void audition(track.id, row, 0.8);
    }
  );

  /** A chord progression in the key, filling the clip, in place of what's there. */
  const writeChords = (prog: Progression) => {
    if (!clip) return;
    const chords = progressionChords(key, prog);
    // A chord a bar in a clip of 4 bars or more (two in one of 8 or more), else as many as fit
    const chordBars = clip.lengthBars >= 8 ? 2 : clip.lengthBars >= 4 ? 1 : clip.lengthBars / 4;
    const count = Math.max(1, Math.round(clip.lengthBars / chordBars));
    const all = Array.from({ length: count }, (_, i) => chords[i % chords.length]);
    const notes = fitToInstrument(chordNotesFor(all, chordBars, chordStyle, pocketNoteId), track.instrumentKey);
    const s = useTimelineStore.getState();
    s.checkpoint();
    s.setClipNotes(clip.id, notes);
    setChordSheet(false);
  };

  // Which cell each note covers, by row and step (start cells marked)
  const cells = new Map<string, 'start' | 'held'>();
  for (const n of clip?.notes ?? []) {
    const m = noteToMidi(n.note);
    const row = rows.find((r) => noteToMidi(r) === m);
    if (!row) continue;
    const from = Math.round(n.startOffset * perBar);
    for (let i = 0; i < noteSteps(n, perBar); i++) cells.set(`${row}|${from + i}`, i === 0 ? 'start' : 'held');
  }

  return (
    <>
      <Card title="Part">
        <ClipPicker
          tracks={pitched}
          track={track}
          clip={clip}
          clips={clips}
          newLength={2}
          onTrack={(id) => usePocket.getState().set({ noteTrackId: id, noteClipId: null })}
          onClip={(id) => usePocket.getState().set({ noteTrackId: track.id, noteClipId: id })}
        />
      </Card>
      <Card
        title={
          <span className="flex items-center gap-2">
            <select
              aria-label="Key"
              className="bg-forge-panel border border-forge-border rounded-lg h-9 px-2 text-sm"
              value={`${key.root}-${key.mode}`}
              onChange={(e) => {
                const [root, mode] = e.target.value.split('-');
                usePocket.getState().set({ key: keyOf(Number(root), mode as 'major' | 'minor') });
              }}
            >
              {(['minor', 'major'] as const).flatMap((mode) =>
                NOTE_NAMES.map((n, root) => (
                  <option key={`${root}-${mode}`} value={`${root}-${mode}`}>
                    {n} {mode}
                  </option>
                ))
              )}
            </select>
            {!chosenKey && detected && <span className="text-[11px] text-forge-muted font-normal">the song's key</span>}
          </span>
        }
        right={
          <span className="flex gap-1">
            <button type="button" aria-label="An octave down" className={`${pill} !h-9 !px-2`} onClick={() => setShift({ ...shift, [track.id]: (shift[track.id] ?? 0) - 1 })}>
              <ChevronDown className="w-4 h-4" />
            </button>
            <button type="button" aria-label="An octave up" className={`${pill} !h-9 !px-2`} onClick={() => setShift({ ...shift, [track.id]: (shift[track.id] ?? 0) + 1 })}>
              <ChevronUp className="w-4 h-4" />
            </button>
          </span>
        }
      >
        <div className="flex gap-1.5 mb-2">
          {LENGTHS.filter((l) => l.steps <= perBar).map((l) => (
            <button key={l.steps} type="button" className={`${pill} !h-9 !px-0 flex-1 text-xs ${length === l.steps ? pillOn : ''}`} onClick={() => setLength(l.steps)}>
              {l.label}
            </button>
          ))}
        </div>
        {clip ? (
          <>
            <BarPager bars={pages} page={shownPage} onPage={setPage} />
            <div className="space-y-[3px] touch-pan-y" {...paint}>
              {rows.map((row) => {
                const root = noteToMidi(row)! % 12 === key.root;
                return (
                  <div key={row} className="flex items-center gap-1">
                    <button
                      type="button"
                      onPointerDown={() => void audition(track.id, row, 0.8)}
                      className={`w-11 shrink-0 h-8 rounded-md text-[11px] font-mono ${root ? 'bg-cyan-500/20 text-cyan-200' : 'text-forge-muted'}`}
                    >
                      {row}
                    </button>
                    <div className="flex-1 grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${perBar}, minmax(0, 1fr))` }}>
                      {steps.map((step) => {
                        const cell = cells.get(`${row}|${step}`);
                        const beat = (step % perBar) % beatEvery === 0;
                        return (
                          <button
                            key={step}
                            type="button"
                            data-row={row}
                            data-step={step}
                            aria-label={`${row}, step ${step + 1}`}
                            aria-pressed={!!cell}
                            className={`h-8 ${cell === 'held' ? 'rounded-r-[4px] -ml-[2px]' : 'rounded-[4px]'} ${step === nowStep ? 'ring-2 ring-white/70' : ''}`}
                            style={{ background: cell ? (cell === 'start' ? track.color : `${track.color}aa`) : root ? (beat ? '#26303a' : '#1f262d') : beat ? '#2a2a31' : '#1d1d22' }}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button type="button" className={pill} onClick={() => setChordSheet(true)}>
                Chords
              </button>
              <button
                type="button"
                className={pill}
                onClick={() => {
                  const s = useTimelineStore.getState();
                  s.checkpoint();
                  s.setClipNotes(clip.id, []);
                }}
              >
                <Eraser className="w-4 h-4" /> Clear
              </button>
            </div>
            {offGrid > 0 && <p className="text-[11px] text-forge-muted mt-2">{offGrid} note{offGrid === 1 ? ' is' : 's are'} outside these rows (another octave, or out of the key). They still play.</p>}
          </>
        ) : (
          <button
            type="button"
            className={`${pill} w-full`}
            onClick={() => {
              const id = useTimelineStore.getState().createEmptyClip(track.id, useTimelineStore.getState().loopRegion.inBar, 2);
              usePocket.getState().set({ noteTrackId: track.id, noteClipId: id });
            }}
          >
            <Plus className="w-4 h-4" /> Start a part
          </button>
        )}
      </Card>
      {chordSheet && (
        <Sheet title={`Chords in ${key.name}`} onClose={() => setChordSheet(false)}>
          <div className="flex gap-1.5 flex-wrap mb-2 px-1">
            {CHORD_STYLES.map((st) => (
              <button key={st.id} type="button" className={`${pill} !h-9 !px-3 text-xs ${chordStyle === st.id ? pillOn : ''}`} onClick={() => setChordStyle(st.id)}>
                {st.name}
              </button>
            ))}
          </div>
          <p className="text-xs text-forge-muted px-2 mb-1">Fills this part with the progression (in place of what's there; Undo brings it back).</p>
          {PROGRESSIONS.filter((p) => p.mode === key.mode).map((p) => (
            <SheetItem key={p.id} title={p.name} onClick={() => writeChords(p)} />
          ))}
        </Sheet>
      )}
    </>
  );
};
