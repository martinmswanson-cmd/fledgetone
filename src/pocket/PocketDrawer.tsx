/**
 * Pocket's drawer: the bottom of the screen, in the selected track's colour, as that track's
 * instrument for the selected section. Play (pads, the key's notes or chords), Draw (the drum
 * steps or the piano roll), Sound (another instrument of its kind) and Mix (its level, reverb,
 * mute, solo); a vocal track sings instead. Mix all makes it a mixer for every track. Its handle
 * makes it bigger or smaller (tap to step, or drag); the piano roll opens it full and puts it back.
 */
import React, { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Star, Trash2 } from 'lucide-react';
import { useTimelineStore } from '../store/timelineStore';
import { CATEGORIES, INSTRUMENTS, listedCategory } from '../audio/instrumentCatalog';
import { defaultClipper } from '../audio/effects/clipper';
import { LEVEL_MAX, LEVEL_MIN, REVERB_SEND_KNOB_MAX, REVERB_SEND_MAX, type InstrumentKey, type Track } from '../store/timelineTypes';
import { showToast } from '../components/timeline/toastStore';
import { useMySounds, type MySound } from '../store/mySounds';
import { gridTracks, type PocketSection } from './pocketSections';
import { useSelection, useSongKey } from './pocketCell';
import { editorOf, usePocket, type DrawerSize, type PocketTool } from './pocketStore';
import { ChordPads, DrumPads, DrumSteps, NotePads } from './PocketPads';
import { PocketRoll } from './PocketRoll';
import { PocketVocals } from './PocketVocals';

export const DRAWER_SIZES: Record<DrawerSize, number> = { low: 0.3, mid: 0.4, high: 0.74 };

/** Whether the landscape layout is on (the drawer beside the grid: its size doesn't change). */
const landscape = () => typeof document !== 'undefined' && !!document.querySelector('.pk-app.land');

/** The tools a track's drawer has. */
export const toolsOf = (track: Track): PocketTool[] => {
  const how = editorOf(track.instrumentKey);
  return how === 'vocals' ? ['sing', 'mix'] : how === null ? ['mix'] : ['play', 'draw', 'sound', 'mix'];
};

/** Select a track for the drawer, keeping the tool open when it has it too (drawing stays drawing), else its first. */
export function selectTrack(track: Track): void {
  const p = usePocket.getState();
  const tools = toolsOf(track);
  p.set({ trackId: track.id, mixAll: false });
  setTool(tools.includes(p.tool) ? p.tool : tools[0], track, landscape());
}

/** Change the drawer's tool. The piano roll wants room: it opens the drawer full, and leaving it puts the size back. */
export function setTool(tool: PocketTool, track: Track | null, land: boolean): void {
  const p = usePocket.getState();
  const roll = tool === 'draw' && !!track && editorOf(track.instrumentKey) === 'notes';
  if (!land && roll && p.drawer !== 'high') p.set({ tool, sizeBeforeRoll: p.drawer, drawer: 'high' });
  else if (!land && !roll && p.sizeBeforeRoll) p.set({ tool, drawer: p.sizeBeforeRoll, sizeBeforeRoll: null });
  else p.set({ tool });
}

/**
 * Instruments Pocket can play and edit, by category (the retro ones left out unless already in
 * use), the starred ones first under Favourites, as in the studio's lists (mySounds.ts).
 */
export function pocketInstruments(current?: InstrumentKey): Array<{ category: string; keys: InstrumentKey[] }> {
  const all = Object.values(INSTRUMENTS).filter((d) => {
    const how = editorOf(d.key);
    return (how === 'beat' || how === 'notes') && (!d.retro || d.key === current);
  });
  const favourites = useMySounds.getState().favourites.filter((k) => all.some((d) => d.key === k));
  return [
    { category: 'Favourites', keys: favourites },
    ...CATEGORIES.map((category) => ({ category, keys: all.filter((d) => listedCategory(d) === category).map((d) => d.key) })),
  ].filter((g) => g.keys.length > 0);
}

/** The sounds saved in the studio (My sounds) that Pocket can play: those of an instrument it edits. */
export function pocketSounds(sounds: MySound[]): MySound[] {
  return sounds.filter((s) => {
    const how = editorOf(s.settings.instrumentKey);
    return how === 'beat' || how === 'notes';
  });
}

/** The star beside an instrument: in Favourites, at the top of the lists here and in the studio. */
export const FavouriteStar: React.FC<{ instrument: InstrumentKey }> = ({ instrument }) => {
  const on = useMySounds((s) => s.favourites.includes(instrument));
  return (
    <button
      type="button"
      className={`shrink-0 w-11 h-11 flex items-center justify-center ${on ? 'text-amber-300' : 'text-forge-muted'}`}
      aria-label={`${on ? 'Unstar' : 'Star'} ${INSTRUMENTS[instrument].name}`}
      aria-pressed={on}
      onClick={() => useMySounds.getState().toggleFavourite(instrument)}
    >
      <Star className="w-4 h-4" fill={on ? 'currentColor' : 'none'} />
    </button>
  );
};

const Handle: React.FC<{ appRef: React.RefObject<HTMLDivElement | null> }> = ({ appRef }) => {
  const size = usePocket((p) => p.drawer);
  const grow = size !== 'high';
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const step = () => usePocket.getState().set({ drawer: size === 'mid' ? 'high' : size === 'high' ? 'low' : 'mid', sizeBeforeRoll: null });
  const Icon = grow ? ChevronUp : ChevronDown;
  return (
    <div
      className="pk-handle"
      role="button"
      tabIndex={0}
      aria-label={grow ? 'Make the instrument bigger' : 'Make the instrument smaller, to see more of the song'}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          step();
        }
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const drawer = e.currentTarget.parentElement!;
        drag.current = { y: e.clientY, h: drawer.getBoundingClientRect().height, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        const app = appRef.current;
        if (!d || !app) return;
        const dy = d.y - e.clientY;
        if (Math.abs(dy) > 6) d.moved = true;
        if (d.moved) app.style.setProperty('--dh', `${Math.max(20, Math.min(80, ((d.h + dy) / app.getBoundingClientRect().height) * 100))}%`);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        const app = appRef.current;
        if (!d || !app) return;
        if (!d.moved) return step();
        const f = e.currentTarget.parentElement!.getBoundingClientRect().height / app.getBoundingClientRect().height;
        const nearest = (Object.entries(DRAWER_SIZES) as Array<[DrawerSize, number]>).sort((a, b) => Math.abs(a[1] - f) - Math.abs(b[1] - f))[0][0];
        app.style.removeProperty('--dh');
        usePocket.getState().set({ drawer: nearest, sizeBeforeRoll: null });
      }}
    >
      <span>{grow ? 'Bigger' : 'Smaller'}</span>
      <Icon className="w-4 h-4" />
      <i />
      <Icon className="w-4 h-4" />
      <span>or drag</span>
    </div>
  );
};

const Slider: React.FC<{ label: string; value: number; min: number; max: number; step: number; show: string; onChange: (v: number) => void; color: string }> = ({ label, value, min, max, step, show, onChange, color }) => (
  <label className="grid grid-cols-[64px_minmax(0,1fr)_64px] items-center gap-2.5 text-[13px] text-forge-muted min-h-11">
    <span>{label}</span>
    <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onPointerDown={() => useTimelineStore.getState().beginEdit()} onChange={(e) => onChange(Number(e.target.value))} className="w-full h-8" style={{ accentColor: color }} />
    <span className="font-mono text-xs text-forge-text text-right">{show}</span>
  </label>
);

const TrackMix: React.FC<{ track: Track }> = ({ track }) => {
  const s = useTimelineStore.getState;
  const btn = 'h-11 px-4 rounded-xl border text-sm font-medium';
  return (
    <div className="pk-scroll flex flex-col gap-1">
      <Slider label="Level" color={track.color} value={track.volume} min={-60} max={6} step={0.5} show={track.volume <= -59.9 ? '−∞' : `${track.volume.toFixed(1)} dB`} onChange={(v) => s().setTrackVolume(track.id, v)} />
      <Slider
        label="Reverb"
        color={track.color}
        value={track.reverbSend}
        min={0}
        max={track.reverbSend > REVERB_SEND_KNOB_MAX ? REVERB_SEND_MAX : REVERB_SEND_KNOB_MAX}
        step={0.01}
        show={`${Math.round(track.reverbSend * 100)}%`}
        onChange={(v) => s().setTrackReverbSend(track.id, v)}
      />
      <div className="flex items-center gap-2 mt-1">
        <button type="button" aria-pressed={track.isMuted} className={`${btn} ${track.isMuted ? 'border-amber-400 bg-amber-500/25 text-amber-100' : 'border-forge-border bg-forge-panelLight'}`} onClick={() => s().toggleMute(track.id)}>
          Mute
        </button>
        <button type="button" aria-pressed={track.isSoloed} className={`${btn} ${track.isSoloed ? 'border-cyan-400 bg-cyan-500/25 text-cyan-100' : 'border-forge-border bg-forge-panelLight'}`} onClick={() => s().toggleSolo(track.id)}>
          Solo
        </button>
        <button
          type="button"
          className={`${btn} ml-auto border-forge-border bg-forge-panelLight text-red-300 flex items-center gap-1.5`}
          onClick={() => {
            s().deleteTrack(track.id);
            usePocket.getState().set({ trackId: null });
            showToast(`Deleted ${track.name} (Undo brings it back)`);
          }}
        >
          <Trash2 className="w-4 h-4" /> Delete track
        </button>
      </div>
      <p className="text-[11px] text-forge-muted mt-2">Its effects, sends and automation stay as they are, and open on a computer.</p>
    </div>
  );
};

const SoundList: React.FC<{ track: Track }> = ({ track }) => {
  const favourites = useMySounds((s) => s.favourites);
  const saved = useMySounds((s) => s.sounds);
  const kind = editorOf(track.instrumentKey);
  const groups = useMemo(
    () =>
      pocketInstruments(track.instrumentKey)
        .map((g) => ({ ...g, keys: g.keys.filter((k) => editorOf(k) === kind) }))
        .filter((g) => g.keys.length),
    // (favourites: the Favourites group follows the stars)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [track.instrumentKey, kind, favourites]
  );
  const mine = pocketSounds(saved).filter((s) => editorOf(s.settings.instrumentKey) === kind);
  const [open, setOpen] = useState<string | null>(listedCategory(INSTRUMENTS[track.instrumentKey]) ?? groups[0]?.category ?? null);
  return (
    <div className="pk-scroll">
      {mine.length > 0 && (
        <div>
          <button type="button" className="w-full flex items-center gap-2 h-11 text-sm font-semibold" onClick={() => setOpen(open === 'My sounds' ? null : 'My sounds')}>
            {open === 'My sounds' ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4 rotate-90" />}
            My sounds
            <span className="ml-auto text-xs text-forge-muted font-normal">{mine.length}</span>
          </button>
          {open === 'My sounds' &&
            mine.map((s) => (
              <button
                key={s.id}
                type="button"
                className="w-full text-left px-3 py-2.5 rounded-xl flex items-start gap-3 active:bg-white/5"
                onClick={() => useTimelineStore.getState().setTrackSound(track.id, s)}
              >
                <span className="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0" style={{ background: INSTRUMENTS[s.settings.instrumentKey].color }} />
                <span className="min-w-0">
                  <span className="block text-sm">{s.name}</span>
                  <span className="block text-xs text-forge-muted line-clamp-1">{INSTRUMENTS[s.settings.instrumentKey].name}, with your settings</span>
                </span>
              </button>
            ))}
        </div>
      )}
      {groups.map(({ category, keys }) => (
        <div key={category}>
          <button type="button" className="w-full flex items-center gap-2 h-11 text-sm font-semibold" onClick={() => setOpen(open === category ? null : category)}>
            {open === category ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4 rotate-90" />}
            {category}
            <span className="ml-auto text-xs text-forge-muted font-normal">{keys.length}</span>
          </button>
          {open === category &&
            keys.map((key) => (
              <div key={key} className="flex items-center">
                <button
                  type="button"
                  className={`flex-1 min-w-0 text-left px-3 py-2.5 rounded-xl flex items-start gap-3 ${key === track.instrumentKey ? 'bg-white/5 ring-1 ring-inset' : 'active:bg-white/5'}`}
                  style={key === track.instrumentKey ? { ['--tw-ring-color' as string]: track.color } : undefined}
                  onClick={() => useTimelineStore.getState().setTrackInstrument(track.id, key)}
                >
                  <span className="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0" style={{ background: INSTRUMENTS[key].color }} />
                  <span className="min-w-0">
                    <span className="block text-sm">
                      {INSTRUMENTS[key].name}
                      {key === track.instrumentKey ? ' (now)' : ''}
                    </span>
                    <span className="block text-xs text-forge-muted line-clamp-1">{INSTRUMENTS[key].blurb}</span>
                  </span>
                </button>
                <FavouriteStar instrument={key} />
              </div>
            ))}
        </div>
      ))}
    </div>
  );
};

const MixAll: React.FC = () => {
  const tracks = useTimelineStore((s) => s.tracks);
  const master = useTimelineStore((s) => s.master);
  const s = useTimelineStore.getState;
  const clipper = master.clipper ?? defaultClipper();
  const db = (v: number) => (v <= -59.9 ? '−∞' : v.toFixed(1));
  const ms = 'flex-1 h-8 rounded-lg border text-[13px] font-mono font-semibold';
  return (
    <div className="pk-strips">
      {gridTracks(tracks).map((t) => (
        <div key={t.id} className={`pk-strip ${t.isMuted ? 'opacity-50' : ''}`} style={{ ['--c' as string]: t.color }}>
          <button type="button" className="text-xs font-semibold max-w-full truncate min-h-6" onClick={() => usePocket.getState().set({ trackId: t.id, mixAll: false })}>
            {t.name}
          </button>
          <input type="range" className="pk-vfader" aria-label={`${t.name} level`} min={-60} max={6} step={0.5} value={t.volume} onPointerDown={() => s().beginEdit()} onChange={(e) => s().setTrackVolume(t.id, Number(e.target.value))} />
          <span className="font-mono text-[10.5px] text-forge-muted">{db(t.volume)}</span>
          <div className="flex gap-1 w-full">
            <button type="button" aria-pressed={t.isMuted} aria-label={`Mute ${t.name}`} className={`${ms} ${t.isMuted ? 'bg-amber-500 text-black border-transparent' : 'border-forge-border bg-forge-panelLight'}`} onClick={() => s().toggleMute(t.id)}>
              M
            </button>
            <button type="button" aria-pressed={t.isSoloed} aria-label={`Solo ${t.name}`} className={`${ms} ${t.isSoloed ? 'bg-cyan-500 text-black border-transparent' : 'border-forge-border bg-forge-panelLight'}`} onClick={() => s().toggleSolo(t.id)}>
              S
            </button>
          </div>
        </div>
      ))}
      <div className="pk-strip !basis-[96px]" style={{ ['--c' as string]: '#e4e4e7' }}>
        <span className="text-xs font-semibold min-h-6">Master</span>
        <input type="range" className="pk-vfader" aria-label="Master level" min={LEVEL_MIN} max={LEVEL_MAX} step={0.5} value={master.level} onPointerDown={() => s().beginEdit()} onChange={(e) => s().setMasterLevel(Number(e.target.value), false)} />
        <span className="font-mono text-[10.5px] text-forge-muted">{db(master.level)}</span>
        <button type="button" aria-pressed={clipper.on} className={`w-full h-8 rounded-lg border text-xs font-semibold ${clipper.on ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100' : 'border-forge-border bg-forge-panelLight'}`} onClick={() => s().setMasterClipper({ on: !clipper.on }, true)}>
          Loud
        </button>
      </div>
    </div>
  );
};

const Body: React.FC<{ track: Track; sec: PocketSection; tool: PocketTool }> = ({ track, sec, tool }) => {
  const songKey = useSongKey();
  const [keysMode, setKeysMode] = useState<'notes' | 'chords'>('notes');
  const [shift, setShift] = useState(0);
  const how = editorOf(track.instrumentKey);
  if (tool === 'mix') return <TrackMix track={track} />;
  if (how === 'vocals') return <div className="pk-scroll"><PocketVocals trackId={track.id} /></div>;
  if (how === null)
    return (
      <p className="text-sm text-forge-muted">
        {INSTRUMENTS[track.instrumentKey]?.name ?? 'This track'} is edited in the studio on a computer. Its level, mute and solo are under Mix.
      </p>
    );
  if (tool === 'sound') return <SoundList track={track} />;
  if (how === 'beat') return tool === 'draw' ? <DrumSteps key={`${track.id}:${sec.from}`} track={track} sec={sec} /> : <DrumPads track={track} sec={sec} />;
  if (tool === 'draw') return <PocketRoll key={`${track.id}:${sec.from}:${sec.to}`} track={track} sec={sec} songKey={songKey} />;
  const seg = 'h-8 px-3 rounded-lg text-[12.5px] font-medium';
  return (
    <>
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex p-[3px] rounded-xl bg-forge-bg border border-forge-border">
          {(['notes', 'chords'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={keysMode === k} className={`${seg} ${keysMode === k ? 'bg-forge-panelLight shadow-[inset_0_0_0_1px_#3a3a44]' : 'text-forge-muted'}`} onClick={() => setKeysMode(k)}>
              {k === 'notes' ? 'Notes' : 'Chords'}
            </button>
          ))}
        </div>
        <span className="flex-1 text-center font-mono text-[11px] text-forge-muted truncate">{songKey.name} · in key</span>
        {keysMode === 'notes' && (
          <div className="flex p-[3px] rounded-xl bg-forge-bg border border-forge-border">
            <button type="button" aria-label="An octave down" className={seg} onClick={() => setShift(Math.max(-2, shift - 1))}>
              −
            </button>
            <button type="button" aria-label="An octave up" className={seg} onClick={() => setShift(Math.min(2, shift + 1))}>
              +
            </button>
          </div>
        )}
      </div>
      {keysMode === 'notes' ? <NotePads key={`${track.id}:${shift}`} track={track} sec={sec} songKey={songKey} shift={shift} /> : <ChordPads track={track} sec={sec} songKey={songKey} />}
    </>
  );
};

export const PocketDrawer: React.FC<{ land: boolean; appRef: React.RefObject<HTMLDivElement | null> }> = ({ land, appRef }) => {
  const { track, sec } = useSelection();
  const tool = usePocket((p) => p.tool);
  const mixAll = usePocket((p) => p.mixAll);
  const NAMES: Record<PocketTool, string> = { play: 'Play', draw: 'Draw', sound: 'Sound', mix: 'Mix', sing: 'Sing' };
  const tools: Array<[PocketTool, string]> = track ? toolsOf(track).map((k) => [k, NAMES[k]]) : [['mix', 'Mix']];
  const shownTool = tools.some(([k]) => k === tool) ? tool : tools[0][0];
  const color = mixAll || !track ? '#9ca3af' : track.color;
  return (
    <section className="pk-drawer" style={{ ['--c' as string]: color }} aria-label={mixAll ? 'The mixer' : `${track?.name ?? 'No track'}: its instrument`}>
      {!land && <Handle appRef={appRef} />}
      <div className="flex items-center gap-2 px-[var(--gx)] pb-2 shrink-0 min-w-0">
        <span className="flex items-center gap-2 font-semibold text-[15px] flex-1 min-w-0 truncate">
          <i className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
          {mixAll ? 'Mixer' : track?.name ?? 'No tracks'}
          <small className="text-forge-muted font-mono text-xs font-normal">· {mixAll ? 'every track' : sec?.letter}</small>
        </span>
        {mixAll ? (
          <button type="button" className="h-9 px-3 rounded-xl border border-forge-border bg-forge-panelLight text-[12.5px] font-medium" onClick={() => usePocket.getState().set({ mixAll: false })}>
            Done
          </button>
        ) : (
          track && (
            <div className="flex p-[3px] rounded-xl bg-forge-bg border border-forge-border shrink-0">
              {tools.map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={shownTool === k}
                  className={`h-[34px] px-2.5 rounded-lg text-[12.5px] font-medium ${shownTool === k ? 'bg-forge-panelLight text-forge-text' : 'text-forge-muted'}`}
                  style={shownTool === k ? { boxShadow: `inset 0 0 0 1px ${color}` } : undefined}
                  onClick={() => setTool(k, track, land)}
                >
                  {l}
                </button>
              ))}
            </div>
          )
        )}
      </div>
      <div className="pk-dbody">{mixAll ? <MixAll /> : track && sec ? <Body track={track} sec={sec} tool={shownTool} /> : <p className="text-sm text-forge-muted">Add an instrument with + Track.</p>}</div>
    </section>
  );
};
