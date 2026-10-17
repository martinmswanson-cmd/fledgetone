import type { Scale } from '../../store/noteTools';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { useLivePlayhead } from '../../store/playheadClock';
import { useTimelineStore, songMeterOf } from '../../store/timelineStore';
import type { Clip, Track } from '../../store/timelineTypes';
import { DRUM_NOTES } from '../../audio/instruments';
import { isDrumKind, isRackKind, INSTRUMENTS } from '../../audio/instrumentCatalog';
import { detectKey, keyOf } from '../../store/songKey';
import { keySpec, musicXml, notate, spellPitch, type Clef, type Glyph, type Score } from '../../store/notation';
import { tempoAt } from '../../audio/tempoMap';
import { songTempo } from '../../store/timelineStore';
import { safeFileName } from '../../store/project';
import { showToast } from './toastStore';
import VexFlow from 'vexflow/bravura';

/**
 * A note clip as sheet music (drawn with VexFlow): a staff, or a grand staff when its notes span
 * both, in the song's key and meter, with ties, beams and rests; drum clips on a percussion staff.
 * The measure the playhead is in is lit. Export it as MusicXML for a notation program, or print it.
 */

/** Where each drum row sits on a percussion staff (as a treble staff's notes), and whether its head is an x. */
const DRUM_PLACES: Record<string, { key: string; x?: boolean }> = {
  [DRUM_NOTES.kick]: { key: 'f/4' },
  [DRUM_NOTES.snare]: { key: 'c/5' },
  [DRUM_NOTES.clap]: { key: 'c/5', x: true },
  [DRUM_NOTES.closedHat]: { key: 'g/5', x: true },
  [DRUM_NOTES.openHat]: { key: 'g/5', x: true },
  [DRUM_NOTES.tomLow]: { key: 'a/4' },
  [DRUM_NOTES.tomMid]: { key: 'd/5' },
  [DRUM_NOTES.tomHigh]: { key: 'e/5' },
  [DRUM_NOTES.crash]: { key: 'a/5', x: true },
  [DRUM_NOTES.ride]: { key: 'f/5', x: true },
  [DRUM_NOTES.cowbell]: { key: 'e/5', x: true },
};
/** A Drum Rack's pads up the staff, from the bottom space. */
const PAD_KEYS = ['f/4', 'a/4', 'c/5', 'e/5', 'g/5', 'b/5', 'd/4', 'e/4', 'g/4', 'b/4', 'd/5', 'f/5', 'a/5', 'c/6', 'd/6', 'e/6'];
const midiName = (m: number) => `${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

function drumKey(midi: number, rack: boolean): { key: string; x: boolean } {
  if (rack) return { key: PAD_KEYS[Math.max(0, Math.min(15, midi - 36))], x: midi - 36 >= 4 && midi - 36 < 6 };
  const place = DRUM_PLACES[midiName(midi)];
  return place ? { key: place.key, x: !!place.x } : { key: 'c/5', x: false };
}

const DURATIONS: Record<number, [string, number]> = { 16: ['w', 0], 12: ['h', 1], 8: ['h', 0], 6: ['q', 1], 4: ['q', 0], 3: ['8', 1], 2: ['8', 0], 1: ['16', 0] };

type VF = typeof VexFlow;
/** VexFlow, with its music font (bundled, so the one-file build has it too). */
const loadVexflow = () => Promise.resolve(VexFlow);

const STAFF_GAP = 100;
const SYSTEM_GAP = 50;

/** Draw `score` into `el`, `width` px wide. Returns each measure's box (for the playhead's light). */
function draw(VF: VF, el: HTMLDivElement, score: Score, width: number, drumsRack: boolean | null): Array<{ x: number; y: number; w: number; h: number }> {
  const { Renderer, Stave, StaveNote, Voice, Formatter, Beam, Accidental, StaveConnector, StaveTie, Dot } = VF;
  el.innerHTML = '';
  const perLine = Math.max(1, Math.min(4, Math.floor((width - 20) / 230)));
  const lines = Math.ceil(score.measures.length / perLine);
  const systemH = score.staves.length * STAFF_GAP + SYSTEM_GAP;
  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(width, Math.max(160, lines * systemH + 30));
  const ctx = renderer.getContext();
  const key = keySpec(score.key);
  const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
  /** A chord tied over the bar line: waits for the next measure's first note on its staff */
  const pending: Array<{ note: InstanceType<VF['StaveNote']>; count: number } | null> = score.staves.map(() => null);

  score.measures.forEach((m, mi) => {
    const line = Math.floor(mi / perLine);
    const col = mi % perLine;
    const lead = col === 0 ? 70 : 0;
    const usable = width - 20;
    const each = (usable - 70) / perLine;
    const x = 10 + (col === 0 ? 0 : 70 + col * each);
    const w = each + lead;
    const y = 10 + line * systemH;
    const staves = score.staves.map((clef, s) => {
      const st = new Stave(x, y + s * STAFF_GAP, w);
      if (col === 0) {
        st.addClef(clef);
        if (clef !== 'percussion') st.addKeySignature(key);
      }
      if (m.meterChange || col === 0) st.addTimeSignature(`${m.meter.num}/${m.meter.den}`);
      if (col === 0) st.setMeasure(m.number);
      st.setContext(ctx).draw();
      return st;
    });
    if (score.staves.length > 1) {
      if (col === 0) new StaveConnector(staves[0], staves[staves.length - 1]).setType('brace').setContext(ctx).draw();
      new StaveConnector(staves[0], staves[staves.length - 1]).setType('singleLeft').setContext(ctx).draw();
      new StaveConnector(staves[0], staves[staves.length - 1]).setType('singleRight').setContext(ctx).draw();
    }
    boxes.push({ x, y, w, h: score.staves.length * STAFF_GAP - 20 });

    const voices: InstanceType<VF['Voice']>[] = [];
    const allNotes: Array<Array<InstanceType<VF['StaveNote']>>> = [];
    score.staves.forEach((clef: Clef, s) => {
      const glyphs: Glyph[] = m.staves[s];
      const notes = glyphs.map((g) => {
        const [duration, dots] = DURATIONS[g.units] ?? ['16', 0];
        let note: InstanceType<VF['StaveNote']>;
        if (!g.keys.length) {
          note = new StaveNote({ keys: [clef === 'bass' ? 'd/3' : 'b/4'], duration: `${duration}r`, dots, clef: clef === 'bass' ? 'bass' : 'treble' });
        } else if (clef === 'percussion') {
          // Drums that share a place on the staff (closed and open hat) are one notehead: dedupe
          // by the key's text (drumKey makes a new object each time, so a Set of them keeps all)
          const keys = [...new Set(g.keys.map((k) => { const d = drumKey(k, !!drumsRack); return d.x ? `${d.key}/x2` : d.key; }))];
          note = new StaveNote({ keys, duration, dots, clef: 'percussion' });
        } else {
          const keys = g.keys.map((k) => {
            const p = spellPitch(k, score.key);
            return `${p.step.toLowerCase()}${p.alter === 1 ? '#' : p.alter === -1 ? 'b' : ''}/${p.octave}`;
          });
          note = new StaveNote({ keys, duration, dots, clef });
        }
        if (dots) Dot.buildAndAttach([note], { all: true });
        return note;
      });
      const voice = new Voice({ numBeats: m.meter.num, beatValue: m.meter.den }).setMode(Voice.Mode.SOFT);
      voice.addTickables(notes);
      if (clef !== 'percussion') Accidental.applyAccidentals([voice], key);
      voices.push(voice);
      allNotes.push(notes);
    });
    const formatter = new Formatter();
    voices.forEach((v) => formatter.joinVoices([v]));
    formatter.format(voices, Math.max(40, staves[0].getNoteEndX() - staves[0].getNoteStartX() - 10));
    voices.forEach((v, s) => {
      const notes = allNotes[s];
      const beams = Beam.generateBeams(notes.filter((n) => !n.isRest()));
      v.draw(ctx, staves[s]);
      beams.forEach((b) => b.setContext(ctx).draw());
      // Ties: over the bar line from the last measure, and inside this one
      const glyphs = m.staves[s];
      const prev = pending[s];
      if (prev && notes[0] && !notes[0].isRest()) {
        const idx = Array.from({ length: prev.count }, (_, i) => i);
        new StaveTie({ firstNote: col === 0 ? null : prev.note, lastNote: notes[0], firstIndexes: idx, lastIndexes: idx }).setContext(ctx).draw();
        if (col === 0) new StaveTie({ firstNote: prev.note, lastNote: null, firstIndexes: idx, lastIndexes: idx }).setContext(ctx).draw();
      }
      pending[s] = null;
      glyphs.forEach((g, gi) => {
        if (!g.tie) return;
        // (As many as the note has noteheads: drums that share a place are one)
        const count = notes[gi].getKeys().length;
        const idx = Array.from({ length: count }, (_, i) => i);
        if (gi + 1 < glyphs.length) new StaveTie({ firstNote: notes[gi], lastNote: notes[gi + 1], firstIndexes: idx, lastIndexes: idx }).setContext(ctx).draw();
        else pending[s] = { note: notes[gi], count };
      });
    });
  });
  return boxes;
}

export const NotationView: React.FC<{ clip: Clip; track: Track; scale?: Scale | null }> = ({ clip, track, scale }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [boxes, setBoxes] = useState<Array<{ x: number; y: number; w: number; h: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const meter = useTimelineStore((s) => songMeterOf(s));
  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  // The piano roll's SCALE when it's a major or minor one, else the key the song's notes are in
  const key = useMemo(() => {
    if (scale?.id === 'major' || scale?.id === 'minor') return keyOf(scale.root, scale.id);
    if (scale?.id === 'harmonicMinor') return keyOf(scale.root, 'minor');
    return detectKey(clips, tracks);
  }, [clips, tracks, scale]);
  const drums = isDrumKind(track.instrumentKey) || isRackKind(track.instrumentKey);
  const score = useMemo(() => notate(clip, meter, key, drums), [clip, meter, key, drums]);
  const playhead = useLivePlayhead();
  const lit = score.measures.findIndex((m, i) => playhead >= m.bar - 1e-9 && (i + 1 >= score.measures.length || playhead < score.measures[i + 1].bar - 1e-9) && playhead < clip.startBar + clip.lengthBars);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const watch = new ResizeObserver(() => setWidth(Math.max(320, Math.floor(el.clientWidth))));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  useEffect(() => {
    let live = true;
    void loadVexflow().then(
      (VF) => {
        if (!live || !ref.current) return;
        try {
          setBoxes(draw(VF, ref.current.querySelector('[data-score]') as HTMLDivElement, score, width, drums ? isRackKind(track.instrumentKey) : null));
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      },
      () => live && setError("Couldn't load the music font")
    );
    return () => {
      live = false;
    };
  }, [score, width, drums, track.instrumentKey]);

  const exportXml = () => {
    const s = useTimelineStore.getState();
    const xml = musicXml(score, {
      title: `${s.projectName || 'Untitled'}: ${clip.name}`,
      partName: track.name,
      bpm: tempoAt(clip.startBar, songTempo(s)),
      drumPlace: (midi) => {
        const k = drumKey(midi, isRackKind(track.instrumentKey)).key.split('/');
        return { step: k[0].toUpperCase(), octave: Number(k[1]) };
      },
    });
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFileName(`${s.projectName || 'Untitled'} ${clip.name}`)}.musicxml`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast('MusicXML saved: open it in a notation program (MuseScore, Sibelius, Dorico...)');
  };
  const print = () => {
    const svg = ref.current?.querySelector('[data-score] svg');
    if (!svg) return;
    const w = window.open('', '_blank');
    if (!w) {
      showToast('The browser blocked the print window: allow pop-ups for this page');
      return;
    }
    const title = `${useTimelineStore.getState().projectName || 'Untitled'}: ${clip.name}`;
    w.document.write(`<!doctype html><title>${title.replace(/</g, '&lt;')}</title><body style="margin:24px;font-family:serif"><h2>${title.replace(/</g, '&lt;')}</h2><div>${track.name.replace(/</g, '&lt;')} · ${INSTRUMENTS[track.instrumentKey].name}</div>${svg.outerHTML}</body>`);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="flex flex-col bg-[#f7f5ef] text-black" aria-label="Notation">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-black/10 text-[11px] font-mono text-black/70">
        <span>
          {score.staves.length > 1 ? 'Grand staff' : score.staves[0] === 'percussion' ? 'Percussion staff' : `${score.staves[0]} clef`}{drums ? '' : ` · ${key ? key.name : 'C major'}`} · notes on a 16th grid
        </span>
        <button type="button" onClick={exportXml} className="ml-auto flex items-center gap-1 h-6 px-2 rounded border border-black/20 hover:bg-black/5" title="Save as MusicXML, which notation programs open">
          <Download className="w-3.5 h-3.5" /> MusicXML
        </button>
        <button type="button" onClick={print} className="flex items-center gap-1 h-6 px-2 rounded border border-black/20 hover:bg-black/5" title="Print the sheet music (or save it as a PDF)">
          <Printer className="w-3.5 h-3.5" /> Print
        </button>
      </div>
      <div ref={ref} className="relative overflow-x-hidden overflow-y-auto" style={{ maxHeight: 520 }}>
        {lit >= 0 && boxes[lit] && <div className="absolute pointer-events-none bg-cyan-400/20 rounded" style={{ left: boxes[lit].x, top: boxes[lit].y + 25, width: boxes[lit].w, height: boxes[lit].h }} />}
        <div data-score />
        {error && <p className="p-3 text-sm text-red-700">Couldn't draw this clip as notation: {error}</p>}
      </div>
    </div>
  );
};
