/**
 * Try it in a game, the rhythm game: the whole song is rendered as it exports, its notes become the
 * chart (store/rhythmChart.ts) and they fall down four lanes to be hit in time (rhythmGame.ts). The
 * difficulty thins or thickens the chart; the timing offset lines the notes up with what's heard on
 * this computer (Bluetooth headphones, for one, play late). Both are remembered in this browser.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { afterMaster, liveContext } from '../../audio/liveContext';
import { Gamepad2, Loader2, RotateCcw, X } from 'lucide-react';
import { masterFxOf, useTimelineStore } from '../../store/timelineStore';
import { audibleTracks, renderArrangement } from '../../audio/exportWav';
import { initAudio } from '../../audio/engine';
import { barToSeconds } from '../../audio/tempoMap';
import { showcaseData } from '../../store/showcase';
import { buildChart, type RhythmDifficulty } from '../../store/rhythmChart';
import { showToast } from '../timeline/toastStore';
import { RHYTHM_KEYS, RhythmGame, type RhythmResult } from './rhythmGame';

const DIFFICULTY_KEY = 'fledgetone.rhythmDifficulty';
const OFFSET_KEY = 'fledgetone.rhythmOffset';
/** How long a note takes to fall, per difficulty (seconds) */
const FALL: Record<RhythmDifficulty, number> = { easy: 2, normal: 1.6, hard: 1.25 };
const OFFSETS = [-150, -120, -90, -60, -40, -20, 0, 20, 40, 60, 90, 120, 150, 200, 250];

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // (a private window: kept for now only)
  }
};

/** The last song rendered for the game, so opening it again on an unchanged song is instant. */
let cache: { key: string; buffer: AudioBuffer } | null = null;

export const RhythmTryOut: React.FC<{ picker: React.ReactNode; onClose: () => void }> = ({ picker, onClose }) => {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<RhythmGame | null>(null);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [progress, setProgress] = useState('Rendering the song.');
  const [difficulty, setDifficulty] = useState<RhythmDifficulty>(() => {
    const d = read(DIFFICULTY_KEY);
    return d === 'easy' || d === 'hard' ? d : 'normal';
  });
  const [offset, setOffset] = useState(() => {
    const o = Number(read(OFFSET_KEY));
    return OFFSETS.includes(o) ? o : 0;
  });
  const [result, setResult] = useState<RhythmResult | null>(null);

  // The song's notes, from the store as it is now (the chart is remade per difficulty)
  const notes = useMemo(() => {
    const s = useTimelineStore.getState();
    const heard = new Set(audibleTracks(s.tracks).map((t) => t.id));
    const end = Math.max(1, ...s.clips.filter((c) => heard.has(c.trackId)).map((c) => c.startBar + c.lengthBars));
    const tempo = { bpm: s.bpm, points: s.tempoPoints };
    return { end, data: showcaseData(s.tracks, s.clips, 1, end, (bar) => barToSeconds(bar, tempo)) };
  }, []);
  const chart = useMemo(() => buildChart(notes.data, difficulty), [notes, difficulty]);

  // Render the song (as an export would, with the master section)
  useEffect(() => {
    let cancelled = false;
    // Closing the game or picking another stops the render (it would carry on unseen)
    const stop = new AbortController();
    const st = useTimelineStore.getState();
    if (st.isPlaying || st.loadingToPlay) st.pause();
    (async () => {
      try {
        await initAudio();
        const s = useTimelineStore.getState();
        const opts = { tracks: s.tracks, clips: s.clips, bpm: s.bpm, tempoPoints: s.tempoPoints, swing: 0, startBar: 1, endBar: notes.end, masterFx: masterFxOf(s), master: s.master, ending: 'ringOut' as const, sampleRate: 44100 as const };
        const key = JSON.stringify(opts);
        if (cache?.key !== key) {
          const b = await renderArrangement({ ...opts, signal: stop.signal }, (f) => !cancelled && setProgress(`Rendering the song (${Math.round(f * 100)}%).`));
          cache = { key, buffer: b };
        }
        if (!cancelled) setBuffer(cache.buffer);
      } catch (err) {
        if (cancelled) return;
        showToast(`Couldn't make the rhythm game: ${err instanceof Error ? err.message : String(err)}.`);
        onClose();
      }
    })();
    return () => {
      cancelled = true;
      stop.abort();
    };
  }, [notes, onClose]);

  // The game: made again when the chart or the offset changes
  useEffect(() => {
    if (!buffer || !host.current || !chart.length) return;
    const ctx = liveContext.rawContext as AudioContext;
    const g = new RhythmGame(host.current, {
      ctx,
      buffer,
      chart,
      out: afterMaster(),
      offsetMs: offset,
      fallSeconds: FALL[difficulty],
      events: { judge: () => {}, finish: (r) => setResult(r) },
    });
    game.current = g;
    setResult(null);
    g.start();
    return () => {
      g.dispose();
      game.current = null;
    };
  }, [buffer, chart, offset, difficulty]);

  // The game takes its keys while it's open; R restarts, Esc closes
  useEffect(() => {
    const keyed = (down: boolean) => (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('select, input')) return;
      if (down && e.key === 'Escape') {
        onClose();
        return;
      }
      if ((!RHYTHM_KEYS.has(e.code) && e.code !== 'KeyR') || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (down && e.code === 'KeyR' && !e.repeat) {
        setResult(null);
        game.current?.start();
        return;
      }
      if (!e.repeat || !down) game.current?.key(e.code, down);
    };
    const onDown = keyed(true);
    const onUp = keyed(false);
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
    };
  }, [onClose]);

  const restart = () => {
    setResult(null);
    game.current?.start();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" role="dialog" aria-label="Try it in a game">
      <div className="w-full max-w-6xl h-[88vh] rounded-xl border border-emerald-500/50 bg-forge-panel shadow-2xl flex flex-col overflow-hidden text-xs text-forge-muted">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-forge-border">
          <Gamepad2 className="w-4 h-4 text-emerald-300" />
          <span className="text-sm font-semibold text-forge-text">Try it in a game</span>
          {picker}
          <span className="hidden xl:inline">D F J K or the arrows hit the lanes · hold long notes · R restarts · Esc closes</span>
          <label className="ml-auto flex items-center gap-1" title="How many of the song's notes fall: Easy keeps its beat, Hard adds its quick notes and pairs">
            Difficulty
            <select
              value={difficulty}
              onChange={(e) => {
                const d = e.target.value as RhythmDifficulty;
                setDifficulty(d);
                write(DIFFICULTY_KEY, d);
                e.target.blur();
              }}
              className="h-7 bg-forge-bg border border-forge-border rounded px-1 text-forge-text"
            >
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="hard">Hard</option>
            </select>
          </label>
          <label className="flex items-center gap-1" title="If every hit comes out late (or early), move the notes to match what you hear: Bluetooth headphones usually need +150 ms or more">
            Timing
            <select
              value={offset}
              onChange={(e) => {
                const o = Number(e.target.value);
                setOffset(o);
                write(OFFSET_KEY, String(o));
                e.target.blur();
              }}
              className="h-7 bg-forge-bg border border-forge-border rounded px-1 text-forge-text"
            >
              {OFFSETS.map((o) => (
                <option key={o} value={o}>
                  {o > 0 ? `+${o}` : o} ms
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={restart} className="h-7 px-2 flex items-center gap-1 rounded-md border border-forge-border hover:text-forge-text">
            <RotateCcw className="w-3.5 h-3.5" /> Restart
          </button>
          <button type="button" onClick={onClose} className="text-forge-muted hover:text-forge-text" aria-label="Close the game">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="relative flex-1 min-h-0 bg-[#0d0b1a]">
          <div ref={host} className="absolute inset-0" />
          {!buffer && (
            <div className="absolute left-1/2 -translate-x-1/2 top-1/3 flex items-center gap-2 rounded-lg bg-black/65 px-3 py-2 text-white text-[11px] pointer-events-none">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> {progress}
            </div>
          )}
          {buffer && !chart.length && (
            <div className="absolute inset-x-0 top-1/3 text-center text-white text-sm">This song has no notes to play yet: add some drums or a melody.</div>
          )}
          {buffer && chart.length > 0 && (
            <div className="absolute left-3 bottom-3 rounded-lg bg-black/45 px-3 py-2 text-white/80 text-[11px] pointer-events-none">
              {chart.length} notes on {difficulty === 'easy' ? 'Easy' : difficulty === 'hard' ? 'Hard' : 'Normal'}, from your song{result ? ` · last run: ${result.grade}, ${(result.accuracy * 100).toFixed(1)}%` : ''}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
