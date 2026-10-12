import { secondsBetween, tempoAt } from '../../audio/tempoMap';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dices, Download, Gamepad2, ListPlus, Package, Trash2 } from 'lucide-react';
import { currentProject, songTempo, useTimelineStore } from '../../store/timelineStore';
import { getAudiblePositionBar } from '../../audio/transport';
import { STINGER_KINDS, stingerKind, stingerNotes } from '../../store/stingers';
import { detectKey, keyOf } from '../../store/songKey';
import { INSTRUMENTS, type InstrumentKey } from '../../audio/instrumentCatalog';
import { fireStinger, playNotesAt, renderStinger } from '../../audio/stingerPlayer';
import { ruleFor, transitionCue } from '../../store/transitions';
import { AuditionButton, TransitionMatrix } from './GameMatrix';
import { gameKitSong } from './gameKitSong';
import * as Tone from 'tone';
import { createZip } from '../../audio/zip';
import { buildGameKit } from '../../audio/gameKit';
import { buildRuntimeKit } from '../../audio/runtimeKit';
import { downloadBlob, encodeChannels, renderLoopTakes } from '../../audio/exportWav';
import { loopVariation, VARIATION_BLURBS, VARIATION_NAMES } from '../../store/loopVariations';
import { formatBarCount } from '../../store/timelineTypes';
import { showToast } from './toastStore';
import { IntensityPanel } from './IntensityPanel';
import { useUiStore } from '../../store/uiStore';

/**
 * Loop variations: 2 to 4 takes of the loop region for the game to rotate through, each with its
 * own feel and turnaround (see loopVariations.ts), all seamless and the same length.
 */
const LoopVariations: React.FC = () => {
  const loop = useTimelineStore((s) => s.loopRegion);
  const [count, setCount] = useState(3);
  const [humanize, setHumanize] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const run = async () => {
    const s = useTimelineStore.getState();
    const { inBar, outBar } = s.loopRegion;
    setProgress(0);
    try {
      const takes = Array.from({ length: count }, (_, k) => loopVariation(s.clips, s.tracks, inBar, outBar, k));
      const opts = {
        tracks: s.tracks,
        clips: s.clips,
        bpm: s.bpm,
        tempoPoints: s.tempoPoints,
        swing: s.swing,
        startBar: inBar,
        endBar: outBar,
        masterFx: { reverbDecay: s.masterReverbDecay, delayTime: s.masterDelayTime, delayFeedback: s.masterDelayFeedback },
        master: s.master,
      };
      const { takes: audio, sampleRate } = await renderLoopTakes(opts, takes, humanize, (f) => setProgress(f));
      const base = s.projectName || 'Untitled';
      const files = audio.map((channels, k) => ({
        name: `${base} loop ${VARIATION_NAMES[k]}.wav`,
        data: encodeChannels(channels, sampleRate, 16, [], { start: 0, end: channels[0].length }),
      }));
      downloadBlob(await createZip(files), `${base} loop variations.zip`);
    } catch (err) {
      showToast(`Couldn't export the variations: ${err instanceof Error ? err.message : String(err)}.`);
    } finally {
      setProgress(null);
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] font-mono text-forge-muted uppercase">Loop variations</div>
      <p className="text-forge-muted">
        Takes of the loop (bars {formatBarCount(loop.inBar)} to {formatBarCount(loop.outBar)}) for the game to rotate through, so it doesn't repeat exactly:{' '}
        {VARIATION_NAMES.slice(0, count).map((n, k) => `${n}: ${VARIATION_BLURBS[k]}`).join('; ')}.
      </p>
      <div className="flex items-center gap-2">
        <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="h-7 bg-forge-bg border border-forge-border rounded px-1 text-[11px] text-forge-text" aria-label="How many takes">
          {[2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n} takes
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-forge-text" title="Tracks without the Human insert get a light one, so each take's feel differs">
          <input type="checkbox" checked={humanize} onChange={(e) => setHumanize(e.target.checked)} className="accent-emerald-400" />
          Human feel
        </label>
        <button
          type="button"
          disabled={progress !== null}
          onClick={() => void run()}
          className="ml-auto h-7 px-2 flex items-center gap-1 rounded-md border border-forge-border text-forge-muted hover:text-forge-text disabled:opacity-60"
          title="Each take as a seamless WAV loop (with loop points), all the same length and level, in one .zip"
        >
          <Download className="w-3.5 h-3.5" /> {progress === null ? 'Export' : `${Math.round(progress * 100)}%`}
        </button>
      </div>
    </div>
  );
};

/** Everything the game needs, in one .zip: see gameKit.ts. */
const GameKitButton: React.FC = () => {
  const [progress, setProgress] = useState<string | null>(null);
  const run = async () => {
    const s = useTimelineStore.getState();
    setProgress('0%');
    try {
      const blob = await buildGameKit(gameKitSong(), (f) => setProgress(`${Math.round(f * 100)}%`));
      downloadBlob(blob, `${s.projectName || 'Untitled'} game kit.zip`);
    } catch (err) {
      showToast(`Couldn't build the game kit: ${err instanceof Error ? err.message : String(err)}.`);
    } finally {
      setProgress(null);
    }
  };
  return (
    <div className="flex flex-col gap-1.5 border-t border-forge-border pt-2">
      <button
        type="button"
        disabled={progress !== null}
        onClick={() => void run()}
        className="h-8 px-3 flex items-center justify-center gap-1.5 rounded-md border border-emerald-400/60 bg-emerald-500/15 text-emerald-100 font-semibold hover:bg-emerald-500/25 disabled:opacity-60"
        title="Every state as a seamless loop (and its stems), the stingers and transitions, audio_manifest.json, and players for the web, Godot and Unity"
      >
        <Package className="w-4 h-4" /> {progress === null ? 'Export game kit (.zip)' : `Building… ${progress}`}
      </button>
      <AuditionButton />
      <RuntimeKitButton />
      <button
        type="button"
        onClick={() => useUiStore.getState().setDialog('engines')}
        className="h-8 px-3 flex items-center justify-center gap-1.5 rounded-md border border-forge-border text-forge-text hover:border-emerald-400/60"
        title="The states, stems, stingers and cues laid out for FMOD Studio or Wwise, with scripts that build them there"
      >
        <Package className="w-4 h-4" /> FMOD / Wwise package…
      </button>
      <p className="text-[10px] text-forge-muted">Every state as a loop and stems by group, the stingers and transitions, an audio_manifest.json, and ready-made players for the web, Godot and Unity.</p>
    </div>
  );
};

/** The web runtime kit: the song file and bos-player.js instead of audio files (see runtimeKit.ts). */
const RuntimeKitButton: React.FC = () => {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const p = currentProject();
          downloadBlob(await buildRuntimeKit(p), `${p.name || 'Untitled'} web runtime kit.zip`);
        } catch (err) {
          showToast(`Couldn't build the web runtime kit: ${err instanceof Error ? err.message : String(err)}.`);
        } finally {
          setBusy(false);
        }
      }}
      className="h-7 px-2 flex items-center justify-center gap-1 rounded-md border border-forge-border text-forge-muted hover:text-forge-text disabled:opacity-50 text-[11px]"
      title="For web games: the song file (kilobytes) and bos-player.js, which synthesizes the music in the browser, instead of audio files"
    >
      <Download className="w-3.5 h-3.5" /> {busy ? 'Packing…' : 'Export web runtime kit (no audio files)'}
    </button>
  );
};

/** Instruments that suit a stinger (the stinger's own is offered too). */
const STINGER_INSTRUMENTS: InstrumentKey[] = ['brass', 'brassSection', 'chipLead', 'pluck', 'keys', 'lead', 'supersaw', 'glockenspiel', 'celesta', 'musicBox', 'marimba', 'xylophone', 'kalimba', 'steelDrums', 'chimes', 'slowStrings', 'choir', 'warmPad'];

/**
 * Stingers: short cues the game plays over the music (a win, an item found). Each fires on the
 * next bar or beat like the states do, can be put on the timeline, and exports as WAV files.
 */
const StingerList: React.FC<{ timing: Quantize }> = ({ timing }) => {
  const stingers = useTimelineStore((s) => s.stingers);
  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  const key = useMemo(() => detectKey(clips, tracks), [clips, tracks]);
  const [busy, setBusy] = useState(false);
  const [lit, setLit] = useState<string | null>(null);
  const st = useTimelineStore.getState;

  const fire = async (id: string) => {
    const stinger = st().stingers.find((x) => x.id === id);
    if (!stinger) return;
    try {
      const at = await fireStinger(stinger, timing);
      const wait = Math.max(0, (at - Tone.getContext().currentTime) * 1000);
      window.setTimeout(() => setLit(id), wait);
      window.setTimeout(() => setLit((cur) => (cur === id ? null : cur)), wait + 400);
    } catch {
      showToast(`Couldn't play "${stinger.name}" (its instrument didn't load).`);
    }
  };

  const exportAll = async () => {
    const s = st();
    setBusy(true);
    try {
      const song = { bpm: s.bpm, masterFx: { reverbDecay: s.masterReverbDecay, delayTime: s.masterDelayTime, delayFeedback: s.masterDelayFeedback }, master: s.master };
      const files = [];
      for (const x of s.stingers) files.push({ name: `${x.name.replace(/[\\/:*?"<>|]/g, '-')}.wav`, data: await renderStinger(x, song) });
      downloadBlob(await createZip(files), `${s.projectName || 'Untitled'} stingers.zip`);
    } catch {
      showToast("Couldn't export the stingers (an instrument didn't load).");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[10px] font-mono text-forge-muted uppercase">
        <span className="whitespace-nowrap" title={key ? `Written in ${key.name}, the key the song's notes are in` : undefined}>
          Stingers{key ? ` · ${key.name}` : ''}
        </span>
        <select
          className="h-6 flex-1 min-w-0 bg-forge-bg border border-forge-border rounded px-1 text-[10px] text-forge-text normal-case"
          value=""
          onChange={(e) => {
            const kind = e.target.value as (typeof STINGER_KINDS)[number]['kind'];
            if (kind) void fire(st().addStinger(kind).id);
          }}
          aria-label="Add a stinger"
        >
          <option value="">+ Add a stinger…</option>
          {STINGER_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}: {k.blurb.toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      {stingers.length === 0 ? (
        <p className="text-forge-muted">Short cues the game plays over the music when something happens: a win, a level up, an item found. They're written in the song's key{key ? ` (${key.name})` : ''}.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {stingers.map((x) => (
            <div key={x.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void fire(x.id)}
                className={`flex-1 min-w-0 h-8 rounded-md border px-2 text-left truncate font-semibold transition ${lit === x.id ? 'border-amber-300 bg-amber-500/30 text-amber-50' : 'border-forge-border text-forge-text hover:border-amber-400/60'}`}
                title={`Play over the music (${timing === 'now' ? 'at once' : `on the next ${timing}`})`}
              >
                {x.name}
              </button>
              <select
                value={x.instrumentKey}
                onChange={(e) => st().updateStinger(x.id, { instrumentKey: e.target.value as InstrumentKey })}
                className="h-8 w-20 bg-forge-bg border border-forge-border rounded px-1 text-[10px] text-forge-text"
                aria-label={`${x.name}: instrument`}
              >
                {[...new Set([x.instrumentKey, ...STINGER_INSTRUMENTS])].map((k) => (
                  <option key={k} value={k}>
                    {INSTRUMENTS[k].name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  const variation = x.variation + 1;
                  st().updateStinger(x.id, { variation, ...stingerNotes(x.kind, key ?? keyOf(0, 'major'), variation) });
                  void fire(x.id);
                }}
                className="h-8 w-7 flex items-center justify-center rounded border border-forge-border text-forge-muted hover:text-forge-text"
                title={`Another version (${stingerKind(x.kind).label.toLowerCase()}, re-written in the song's key)`}
                aria-label={`${x.name}: another version`}
              >
                <Dices className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const message = st().placeStinger(x.id, st().playheadPosition);
                  showToast(message ?? `"${x.name}" is on a new track at the playhead.`);
                }}
                className="h-8 w-7 flex items-center justify-center rounded border border-forge-border text-forge-muted hover:text-forge-text"
                title="Put it on the timeline at the playhead (a new track)"
                aria-label={`${x.name}: put on the timeline`}
              >
                <ListPlus className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => st().deleteStinger(x.id)}
                className="h-8 w-7 flex items-center justify-center rounded border border-forge-border text-forge-muted hover:text-red-300"
                title="Delete this stinger"
                aria-label={`${x.name}: delete`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportAll()}
            className="self-end h-7 px-2 flex items-center gap-1 rounded-md border border-forge-border text-forge-muted hover:text-forge-text disabled:opacity-50"
            title="Every stinger as a WAV file, through the song's master section, in one .zip"
          >
            <Download className="w-3.5 h-3.5" /> {busy ? 'Exporting…' : 'Export stingers (.zip)'}
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * Hear the music the way a game will play it: each section (between markers) is a state the game
 * can be in, and a button moves to it on the next bar (or beat), looping there, the way adaptive
 * music switches; layers (tracks) come and go with their switches, or crossfade with Intensity (see intensity.ts),
 * along their stem groups' curves. Nothing here is an undo step: it's a
 * rehearsal, though the mutes and the loop it leaves stay as they are.
 */

type Quantize = 'bar' | 'beat' | 'now';

export const GamePanel: React.FC = () => {
  const markers = useTimelineStore((s) => s.markers);
  const clips = useTimelineStore((s) => s.clips);
  const loop = useTimelineStore((s) => s.loopRegion);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const [quantize, setQuantize] = useState<Quantize>('bar');
  const [pending, setPending] = useState<string | null>(null);
  const timer = useRef<number>(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const songEnd = Math.max(2, ...clips.map((c) => c.startBar + c.lengthBars));
  const sorted = [...markers].sort((a, b) => a.bar - b.bar);
  const sections = sorted
    .map((m, i) => ({ id: m.id, name: m.name, from: m.bar, to: sorted[i + 1]?.bar ?? songEnd }))
    .filter((sec) => sec.to - sec.from > 1e-6);

  const goTo = (sec: (typeof sections)[number]) => {
    const s = useTimelineStore.getState();
    clearTimeout(timer.current);
    const playingNow = sections.find((x) => Math.abs(x.from - s.loopRegion.inBar) < 1e-6 && Math.abs(x.to - s.loopRegion.outBar) < 1e-6 && s.loopRegion.enabled);
    const rule = ruleFor(s.transitions, playingNow?.id ?? null, sec.id);
    const cue = transitionCue(rule.kind, s.tracks);
    // A stinger bridge: the stinger on the line, then the new state that many bars later
    const bridge = rule.kind === 'stinger' ? s.stingers.find((x) => x.id === rule.stingerId) : undefined;
    const bridgeBars = bridge ? Math.max(1, Math.ceil(bridge.lengthBars - 1e-6)) : 0;
    const when = rule.quantize ?? quantize;
    const jump = () => {
      const st = useTimelineStore.getState();
      st.setLoopRange(sec.from, sec.to);
      if (!st.loopRegion.enabled) st.toggleLoop();
      st.seek(sec.from);
      setPending(null);
    };
    if (!s.isPlaying || when === 'now') {
      jump();
      if (!s.isPlaying) void s.togglePlay();
      if (cue && cue.leadIn === 0) void playNotesAt(cue.instrumentKey, cue.notes, Tone.getContext().currentTime + 0.1);
      if (bridge && s.isPlaying) void fireStinger(bridge, 'now');
      return;
    }
    // On the next bar or beat line of the song, or a later one if the transition needs more room
    const at = getAudiblePositionBar();
    const unit = when === 'bar' ? 1 : 0.25;
    let next = Math.floor((at - 1) / unit + 1e-6) * unit + unit + 1;
    if (cue && next - at < cue.leadIn) next += Math.ceil((cue.leadIn - (next - at)) / unit - 1e-6) * unit;
    const ms = secondsBetween(at, next, songTempo(s)) * 1000;
    if (cue) void playNotesAt(cue.instrumentKey, cue.notes, Tone.getContext().currentTime + ms / 1000);
    setPending(sec.id);
    if (bridge) {
      // The song stops on the line while the stinger plays, then comes in on the new state
      void fireStinger(bridge, when === 'beat' ? 'beat' : 'bar');
      timer.current = window.setTimeout(() => {
        const st = useTimelineStore.getState();
        if (st.isPlaying) void st.togglePlay();
        timer.current = window.setTimeout(() => {
          jump();
          void useTimelineStore.getState().togglePlay();
        }, (bridgeBars * 240 * 1000) / tempoAt(next, songTempo(s)) - 40);
      }, Math.max(0, ms - 15));
      return;
    }
    // Make the jump land on the line: the loop wraps there if the line is the loop's end
    // (a crossfade can't be heard on one timeline: it cuts here; the audition pads play it)
    timer.current = window.setTimeout(jump, Math.max(0, ms - 15));
  };

  const current = sections.find((sec) => Math.abs(sec.from - loop.inBar) < 1e-6 && Math.abs(sec.to - loop.outBar) < 1e-6 && loop.enabled);

  return (
    <div className="grid gap-4 p-3 text-xs lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]" role="region" aria-label="Game preview">
      <section className="flex flex-col gap-3 min-w-0" data-game="states">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[10px] font-mono text-forge-muted uppercase">
            <span className="flex items-center gap-1.5">
              <Gamepad2 className="w-3.5 h-3.5 text-emerald-400" /> States (sections)
            </span>
            <select className="h-6 bg-forge-bg border border-forge-border rounded px-1 text-[10px] text-forge-text" value={quantize} onChange={(e) => setQuantize(e.target.value as Quantize)} aria-label="Switch timing">
              <option value="bar">on the next bar</option>
              <option value="beat">on the next beat</option>
              <option value="now">at once</option>
            </select>
          </div>
          {sections.length === 0 ? (
            <p className="text-forge-muted">Add markers (M) where your sections start: each section becomes a state to switch to.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {sections.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => goTo(sec)}
                  className={`h-9 rounded-md border px-2 text-left truncate font-semibold transition ${
                    pending === sec.id ? 'border-amber-400 bg-amber-500/20 text-amber-100 animate-pulse' : current?.id === sec.id ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100' : 'border-forge-border text-forge-text hover:border-emerald-400/60'
                  }`}
                  title={`Bars ${sec.from} to ${sec.to}: play and loop here`}
                >
                  {sec.name}
                </button>
              ))}
            </div>
          )}
          <p className="text-[10px] text-forge-muted">{isPlaying ? 'Switch states and fire stingers while it plays, the way the game will.' : 'Pick a state to start.'}</p>
        </div>
        {sections.length > 1 && (
          <div data-game="transitions">
            <TransitionMatrix states={sections} />
          </div>
        )}
      </section>
      <section className="flex flex-col gap-3 min-w-0" data-game="intensity">
        <IntensityPanel />
        <div data-game="variations">
          <LoopVariations />
        </div>
      </section>
      <section className="flex flex-col gap-3 min-w-0" data-game="stingers">
        <StingerList timing={quantize} />
        <div data-game="export">
          <GameKitButton />
        </div>
      </section>
    </div>
  );
};
