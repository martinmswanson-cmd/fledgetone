import React, { useEffect, useRef, useState } from 'react';
import { liveContext } from '../../audio/liveContext';
import { Loader2, Play, Square, X } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { ANY_STATE, PHRASE_BARS, QUANTIZES, transitionKey, TRANSITIONS } from '../../store/transitions';
import type { TransitionKind, TransitionRule } from '../../store/timelineTypes';
import { buildGameKitParts, type AudioManifest } from '../../audio/gameKit';
import { gameKitSong } from './gameKitSong';
import { AdaptiveMusic } from '../../gameKit/adaptive-music.js';
import { initAudio, liveMix } from '../../audio/engine';
import { useExclusivePreview } from '../../audio/exclusivePreview';
import { PREVIEW_FADE_SECONDS } from '../../audio/previewFade';
import { showToast } from './toastStore';
import { useDialogFocus } from './useDialogFocus';

/**
 * The Game preview's transition matrix (how each state hands over to each other one) and its
 * audition pads (the states, rendered as the game will get them, played by the kit's own web
 * player, so every crossfade, stinger bridge and intensity change sounds exactly as it will in the
 * game).
 */

export interface StateRef {
  id: string;
  name: string;
}

const SHORT: Record<TransitionKind, string> = { cut: 'Cut', fill: 'Fill', riser: 'Riser', impact: 'Hit', crossfade: 'XF', stinger: '★', bridge: 'Bridge' };
const QUANT: Record<string, string> = { bar: '', beat: '·beat', phrase: '·phr', end: '·end', now: '·now' };

/** A cell's label: the kind, its option, and when (if not the bar). */
function label(rule: TransitionRule | undefined, stingerName: (id?: string) => string | undefined): string {
  if (!rule) return '–';
  const extra = rule.kind === 'crossfade' ? ` ${rule.beats ?? 4}` : rule.kind === 'stinger' ? ` ${stingerName(rule.stingerId) ?? '?'}` : rule.kind === 'bridge' && rule.bridgeBars === 2 ? ' 2' : '';
  return `${SHORT[rule.kind]}${extra}${QUANT[rule.quantize ?? 'bar']}${rule.quantize === 'phrase' ? rule.phraseBars ?? 4 : ''}`;
}

/**
 * The transition matrix: a row per state you come from (and "Any" for a rule that applies from
 * every state), a column per state you go to. Click a cell to set its rule below.
 */
export const TransitionMatrix: React.FC<{ states: StateRef[] }> = ({ states }) => {
  const rules = useTimelineStore((s) => s.transitions);
  const stingers = useTimelineStore((s) => s.stingers);
  const [cell, setCell] = useState<{ from: string; to: string } | null>(null);
  const stingerName = (id?: string) => stingers.find((s) => s.id === id)?.name;
  const rows: StateRef[] = [{ id: ANY_STATE, name: 'Any' }, ...states];
  const editing = cell ? rules[transitionKey(cell.from, cell.to)] : undefined;
  const set = (patch: Partial<TransitionRule> | null) => {
    if (!cell) return;
    const st = useTimelineStore.getState();
    if (!patch) return st.setTransitionRule(cell.from, cell.to, null);
    const next: TransitionRule = { ...(editing ?? { kind: 'cut' }), ...patch };
    if (next.kind !== 'crossfade') delete next.beats;
    if (next.kind !== 'stinger') delete next.stingerId;
    if (next.kind !== 'bridge') delete next.bridgeBars;
    if (next.quantize !== 'phrase') delete next.phraseBars;
    if (next.kind === 'stinger' && !next.stingerId) next.stingerId = stingers[0]?.id;
    st.setTransitionRule(cell.from, cell.to, next);
  };
  const count = Object.keys(rules).length;
  return (
    <details className="flex flex-col gap-1">
      <summary className="cursor-pointer text-[10px] font-mono text-forge-muted uppercase select-none">Transitions ({count} rule{count === 1 ? '' : 's'})</summary>
      <p className="text-forge-muted mt-1">From a state (row) to a state (column). A rule from <em>Any</em> applies unless the row has its own; with none, it cuts on the next bar.</p>
      <div className="overflow-x-auto mt-1">
        <table className="text-[10px] font-mono border-collapse">
          <thead>
            <tr>
              <th className="p-0.5 text-left text-forge-muted font-normal">from ↓ to →</th>
              {states.map((t) => (
                <th key={t.id} className="p-0.5 text-forge-text font-normal max-w-[4.5rem] truncate" title={t.name}>
                  {t.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id}>
                <th className={`p-0.5 text-left font-normal max-w-[4.5rem] truncate ${f.id === ANY_STATE ? 'text-emerald-300' : 'text-forge-text'}`} title={f.name}>
                  {f.name}
                </th>
                {states.map((t) => {
                  const same = f.id === t.id;
                  const active = cell?.from === f.id && cell?.to === t.id;
                  const rule = rules[transitionKey(f.id, t.id)];
                  return (
                    <td key={t.id} className="p-0.5">
                      <button
                        type="button"
                        disabled={same}
                        onClick={() => setCell(active ? null : { from: f.id, to: t.id })}
                        className={`w-[4.5rem] h-6 rounded border truncate px-1 ${
                          same ? 'border-transparent text-forge-muted/40' : active ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100' : rule ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-100' : 'border-forge-border text-forge-muted hover:text-forge-text'
                        }`}
                        aria-label={`Transition from ${f.name} to ${t.name}: ${label(rule, stingerName)}`}
                        title={same ? '' : `${f.name} → ${t.name}`}
                      >
                        {same ? '' : label(rule, stingerName)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cell && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/5 p-1.5 text-[10px]">
          <span className="text-forge-text w-full">
            {rows.find((r) => r.id === cell.from)?.name} → {states.find((r) => r.id === cell.to)?.name}
          </span>
          <select value={editing?.kind ?? ''} onChange={(e) => set(e.target.value ? { kind: e.target.value as TransitionKind } : null)} className="h-6 bg-forge-bg border border-forge-border rounded px-1" aria-label="Transition kind">
            <option value="">{cell.from === ANY_STATE ? 'No rule (cut)' : 'No rule (use Any)'}</option>
            {TRANSITIONS.map((t) => (
              <option key={t.kind} value={t.kind} disabled={t.kind === 'stinger' && !stingers.length} title={t.blurb}>
                {t.label}
                {t.kind === 'stinger' && !stingers.length ? ' (add a stinger first)' : ''}
              </option>
            ))}
          </select>
          {editing && (
            <select value={editing.quantize ?? 'bar'} onChange={(e) => set({ quantize: e.target.value as TransitionRule['quantize'] })} className="h-6 bg-forge-bg border border-forge-border rounded px-1" aria-label="When" title="Phrase: every few bars from the state's start, so the music turns where a phrase does. End of the loop: when the state's loop (or shuffled piece) comes round">
              {QUANTIZES.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.label}
                </option>
              ))}
            </select>
          )}
          {editing?.quantize === 'phrase' && (
            <select value={editing.phraseBars ?? 4} onChange={(e) => set({ phraseBars: Number(e.target.value) })} className="h-6 bg-forge-bg border border-forge-border rounded px-1" aria-label="Phrase length">
              {PHRASE_BARS.map((b) => (
                <option key={b} value={b}>
                  of {b} bars
                </option>
              ))}
            </select>
          )}
          {editing?.kind === 'bridge' && (
            <select value={editing.bridgeBars ?? 1} onChange={(e) => set({ bridgeBars: Number(e.target.value) === 2 ? 2 : 1 })} className="h-6 bg-forge-bg border border-forge-border rounded px-1" aria-label="Bridge length">
              <option value={1}>1 bar: the pull into it</option>
              <option value={2}>2 bars: a turn, then the pull</option>
            </select>
          )}
          {editing?.kind === 'crossfade' && (
            <select value={editing.beats ?? 4} onChange={(e) => set({ beats: Number(e.target.value) })} className="h-6 bg-forge-bg border border-forge-border rounded px-1" aria-label="Crossfade length">
              {[1, 2, 4, 8, 16].map((b) => (
                <option key={b} value={b}>
                  over {b} beat{b === 1 ? '' : 's'}
                </option>
              ))}
            </select>
          )}
          {editing?.kind === 'stinger' && (
            <select value={editing.stingerId ?? ''} onChange={(e) => set({ stingerId: e.target.value })} className="h-6 bg-forge-bg border border-forge-border rounded px-1" aria-label="Bridging stinger">
              {stingers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({Math.max(1, Math.ceil(s.lengthBars - 1e-6))} bar{Math.ceil(s.lengthBars - 1e-6) > 1 ? 's' : ''})
                </option>
              ))}
            </select>
          )}
          <span className="text-forge-muted w-full">{TRANSITIONS.find((t) => t.kind === editing?.kind)?.blurb ?? ''}</span>
        </div>
      )}
    </details>
  );
};

/** The player's effects, as the audition offers them. */
const AUDITION_EFFECTS = [
  { id: 'none', name: 'None', title: 'The music as it is' },
  { id: 'underwater', name: 'Underwater', title: 'A low-pass and a big room: swimming, a dream sequence' },
  { id: 'muffled', name: 'Muffled', title: 'Behind a wall, in another room, the pause menu' },
  { id: 'lowHealth', name: 'Low health', title: 'Duller and further away: in trouble' },
  { id: 'dream', name: 'Dream', title: 'Soft and washed in reverb' },
] as const;

/**
 * Audition like the game: the states (and their stems), stingers and transition sounds are
 * rendered the way the game kit exports them, then played by the kit's own web player, with pads
 * to switch states, fire stingers and turn the intensity, so what you hear is what the game will
 * do. The song stops while it's open.
 */
export const AuditionPads: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [progress, setProgress] = useState<string>('Rendering…');
  const [manifest, setManifest] = useState<AudioManifest | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [intensity, setIntensity] = useState(() => useTimelineStore.getState().intensity);
  const [costume, setCostume] = useState<string | null>(null);
  const [effect, setEffect] = useState<(typeof AUDITION_EFFECTS)[number]['id']>('none');
  const [params, setParams] = useState<Record<string, number>>({});
  const player = useRef<AdaptiveMusic | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // As every dialog: Esc closes it (unless another one is open over it) wherever focus is, Tab goes
  // round inside it, and focus goes back where it was when it closes
  useDialogFocus(box, onClose);
  // The pads are the one preview playing (a suggestion's before-and-after, say, stops; another stops them)
  const claim = useExclusivePreview('game-audition-pads', () => {
    player.current?.stop(PREVIEW_FADE_SECONDS);
    setCurrent(null);
    setPending(null);
  });

  useEffect(() => {
    let cancelled = false;
    const st = useTimelineStore.getState();
    // (A Play still waiting for sounds is called off too: it would start under the audition)
    if (st.isPlaying || st.loadingToPlay) st.pause();
    claim();
    (async () => {
      try {
        await initAudio();
        const { manifest, files } = await buildGameKitParts(gameKitSong(), (f, d) => !cancelled && setProgress(`Rendering ${d}… ${Math.round(f * 100)}%`));
        const ctx = liveContext.rawContext as AudioContext;
        const buffers = new Map<string, AudioBuffer>();
        for (const f of files) buffers.set(f.name, await ctx.decodeAudioData(await f.data.arrayBuffer()));
        if (cancelled) return;
        const music = new AdaptiveMusic(ctx, liveMix.auditionInput.input as unknown as AudioNode);
        music.loadFrom(manifest, buffers);
        player.current = music;
        setManifest(manifest);
      } catch (err) {
        if (!cancelled) showToast(`Couldn't render for the audition: ${err instanceof Error ? err.message : String(err)}.`);
        onClose();
      }
    })();
    return () => {
      cancelled = true;
      player.current?.stop(PREVIEW_FADE_SECONDS);
    };
  }, [onClose, claim]);

  // Show which state is playing, and which one is waiting for its line
  useEffect(() => {
    const id = window.setInterval(() => {
      const p = player.current;
      if (!p) return;
      const now = p.ctx.currentTime;
      const c = p.current;
      setCurrent(c && c.startTime <= now + 0.01 ? c.name : current);
      setPending(c && c.startTime > now + 0.01 ? c.name : null);
    }, 60);
    return () => clearInterval(id);
  }, [current]);

  const go = (name: string) => {
    const p = player.current;
    if (!p) return;
    claim();
    if (!p.current) {
      p.play(name);
      setCurrent(name);
    } else p.setState(name);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label="Audition like the game"
        tabIndex={-1}
        className="w-full max-w-xl rounded-xl border border-emerald-500/50 bg-forge-panel shadow-2xl p-4 flex flex-col gap-3 text-xs text-forge-muted focus:outline-none"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-forge-text">Audition like the game</span>
          <button type="button" onClick={onClose} className="ml-auto text-forge-muted hover:text-forge-text" aria-label="Close the audition">
            <X className="w-4 h-4" />
          </button>
        </div>
        {!manifest ? (
          <div className="flex items-center gap-2 text-forge-text">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> {progress}
          </div>
        ) : (
          <>
            <p>The states as the game gets them, played by the game kit's own player: switches follow your transition rules, on the beat.</p>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="States">
              {manifest.states.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => go(s.name)}
                  className={`h-16 rounded-lg border-2 font-bold text-sm transition ${
                    pending === s.name ? 'border-amber-400 bg-amber-500/20 text-amber-100 animate-pulse' : current === s.name ? 'border-emerald-400 bg-emerald-500/25 text-emerald-50' : 'border-forge-border text-forge-text hover:border-emerald-400/60'
                  }`}
                >
                  {s.name}
                  <span className="block text-[10px] font-normal opacity-70">
                    {s.bars} bars{s.stems.length ? ` · ${s.stems.length} stems` : ''}
                    {s.shuffleBars ? ' · shuffled' : ''}
                    {s.gap ? ' · silences' : ''}
                  </span>
                </button>
              ))}
            </div>
            {manifest.stingers.length > 0 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Stingers">
                {manifest.stingers.map((s) => (
                  <button key={s.name} type="button" onClick={() => (claim(), player.current?.stinger(s.name))} className="h-8 px-3 rounded-md border border-amber-400/50 text-amber-100 hover:bg-amber-500/15">
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            {(manifest.states[0]?.costumes?.length ?? 0) > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Costumes">
                <span className="font-mono text-[10px] uppercase mr-1">Costume</span>
                {[null, ...(manifest.states[0].costumes ?? []).map((c) => c.name)].map((name) => (
                  <button
                    key={name ?? 'none'}
                    type="button"
                    onClick={() => {
                      player.current?.setCostume(name, 1);
                      setCostume(name);
                    }}
                    className={`h-7 px-2.5 rounded-md border ${costume === name ? 'border-violet-400 bg-violet-500/20 text-violet-100' : 'border-forge-border text-forge-text hover:border-violet-400/60'}`}
                  >
                    {name ?? 'As written'}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Effects">
              <span className="font-mono text-[10px] uppercase mr-1">Effect</span>
              {AUDITION_EFFECTS.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  title={e.title}
                  onClick={() => {
                    player.current?.setEffect(e.id, 1);
                    setEffect(e.id);
                  }}
                  className={`h-7 px-2.5 rounded-md border ${effect === e.id ? 'border-sky-400 bg-sky-500/20 text-sky-100' : 'border-forge-border text-forge-text hover:border-sky-400/60'}`}
                >
                  {e.name}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 font-mono text-[10px] uppercase">
              Intensity
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={intensity}
                disabled={!manifest.intensity.groups.length}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setIntensity(v);
                  player.current?.setIntensity(v);
                }}
                className="flex-1 accent-emerald-400"
                aria-label="Audition intensity"
              />
              <span className="w-10 text-right text-forge-text">{manifest.intensity.groups.length ? `${Math.round(intensity * 100)}%` : 'no stems'}</span>
            </label>
            {(manifest.parameters ?? []).map((p) => (
              <label key={p.name} className="flex items-center gap-2 font-mono text-[10px]" title="One of the song's parameters, as the game would set it">
                <span className="w-20 truncate text-violet-200">{p.name}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={params[p.name] ?? p.default}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setParams((was) => ({ ...was, [p.name]: v }));
                    player.current?.setParameter(p.name, v, 0.2);
                  }}
                  className="flex-1 accent-violet-400"
                  aria-label={`Audition parameter ${p.name}`}
                />
                <span className="w-10 text-right text-forge-text">{Math.round((params[p.name] ?? p.default) * 100)}%</span>
              </label>
            ))}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  player.current?.stop(PREVIEW_FADE_SECONDS);
                  setCurrent(null);
                }}
                className="h-8 px-3 flex items-center gap-1.5 rounded-md border border-forge-border hover:text-forge-text"
              >
                <Square className="w-3.5 h-3.5" /> Stop
              </button>
              <span className="text-[10px]">{current ? `Playing ${current}${pending ? `, switching to ${pending}` : ''}` : 'Click a state to start.'}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/** The button that opens the audition. */
export const AuditionButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-8 px-3 flex items-center justify-center gap-1.5 rounded-md border border-emerald-400/60 text-emerald-100 hover:bg-emerald-500/15"
        title="Render the states and play them with the game kit's own player: pads for states and stingers, intensity, and your transition rules"
      >
        <Play className="w-4 h-4" /> Audition like the game
      </button>
      {open && <AuditionPads onClose={close} />}
    </>
  );
};
