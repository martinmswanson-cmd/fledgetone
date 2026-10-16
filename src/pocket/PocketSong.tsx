/**
 * Pocket's Song screen: carry on with the last song, start one from a starter or empty, the name
 * and tempo, and the whole song at a glance: each track a row of its clips across the song. Tap a
 * clip to edit it (drums in Beat, the rest in Notes), tap the bar numbers to move the playhead,
 * and add an instrument from the catalog. Arrange: repeat the loop, a build-up and drop, and a
 * speed-up into the drop.
 */
import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, History, Minus, Plus } from 'lucide-react';
import { CATEGORIES, INSTRUMENTS } from '../audio/instrumentCatalog';
import { STARTER_GROUPS, STARTERS } from '../store/starters';
import { retryAutosave, useLastSession, useTimelineStore } from '../store/timelineStore';
import { clearPreviousSession } from '../store/project';
import type { InstrumentKey } from '../store/timelineTypes';
import { Card, pill, Sheet, SheetItem } from './pocketUi';
import { clipsOf, editorOf, usePlayPosition, usePocket } from './pocketStore';
import { buildAndDrop, repeatLoop, speedUpLoop } from './pocketArrange';
import { showToast } from '../components/timeline/toastStore';

/** Instruments Pocket can play and edit, by category (the ones that need a computer left out). */
function pocketInstruments(): Array<{ category: string; keys: InstrumentKey[] }> {
  const all = Object.values(INSTRUMENTS).filter((d) => editorOf(d.key) !== null && d.category !== 'Retro (GM)');
  return CATEGORIES.map((category) => ({ category, keys: all.filter((d) => d.category === category).map((d) => d.key) })).filter((g) => g.keys.length > 0);
}

/** Pick an instrument from the ones Pocket can edit, by category. */
export const InstrumentSheet: React.FC<{ title: string; current?: InstrumentKey; onPick: (key: InstrumentKey) => void; onClose: () => void }> = ({ title, current, onPick, onClose }) => {
  const groups = useMemo(() => pocketInstruments(), []);
  const kind = current ? editorOf(current) : null;
  // Swapping keeps a drum track's notes on drums and a pitched track's on pitched instruments
  const shown = kind ? groups.map((g) => ({ ...g, keys: g.keys.filter((k) => editorOf(k) === kind) })).filter((g) => g.keys.length) : groups;
  const [open, setOpen] = useState<string | null>((current && INSTRUMENTS[current]?.category) ?? shown[0]?.category ?? null);
  return (
    <Sheet title={title} onClose={onClose}>
      {shown.map(({ category, keys }) => (
        <div key={category} className="mb-1">
          <button type="button" className="w-full flex items-center gap-2 px-2 h-11 text-sm font-semibold" onClick={() => setOpen(open === category ? null : category)}>
            {open === category ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            {category}
            <span className="ml-auto text-xs text-forge-muted font-normal">{keys.length}</span>
          </button>
          {open === category &&
            keys.map((key) => (
              <SheetItem
                key={key}
                title={`${INSTRUMENTS[key].name}${key === current ? ' (now)' : ''}`}
                detail={INSTRUMENTS[key].blurb}
                color={INSTRUMENTS[key].color}
                onClick={() => {
                  onClose();
                  onPick(key);
                }}
              />
            ))}
        </div>
      ))}
    </Sheet>
  );
};

/** Pick an instrument for a new track, with an empty clip to write into. */
const AddTrackSheet: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <InstrumentSheet
    title="Add an instrument"
    onClose={onClose}
    onPick={(key) => {
      const s = useTimelineStore.getState();
      const trackId = s.addTrack(key);
      // A first clip to write into, where the loop is (or at the start)
      const at = s.loopRegion.enabled ? s.loopRegion.inBar : 1;
      const clipId = useTimelineStore.getState().createEmptyClip(trackId, at, editorOf(key) === 'beat' ? 1 : 2);
      const st = useTimelineStore.getState();
      const track = st.tracks.find((t) => t.id === trackId);
      const clip = st.clips.find((c) => c.id === clipId);
      if (track && clip) usePocket.getState().openClip(clip, track);
    }}
  />
);

/** Start a song: from a starter (by group) or empty. */
const NewSongSheet: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [group, setGroup] = useState<string | null>(null);
  const start = (template: Parameters<ReturnType<typeof useTimelineStore.getState>['newProject']>[0]) => {
    const s = useTimelineStore.getState();
    s.stop();
    s.newProject(template);
    usePocket.getState().set({ beatClipId: null, noteClipId: null, beatTrackId: null, noteTrackId: null, key: null });
    onClose();
  };
  return (
    <Sheet title="New song" onClose={onClose}>
      <p className="text-xs text-forge-muted px-2 mb-2">The song you have now is kept: Restore brings it back.</p>
      <SheetItem title="Empty song" detail="Drums, bass, keys and brass, with nothing written yet." onClick={() => start('blank')} />
      {STARTER_GROUPS.map((g) => (
        <div key={g}>
          <button type="button" className="w-full flex items-center gap-2 px-2 h-11 text-sm font-semibold" onClick={() => setGroup(group === g ? null : g)}>
            {group === g ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            {g}
          </button>
          {group === g &&
            STARTERS.filter((st) => st.group === g).map((st) => <SheetItem key={st.id} title={st.name} detail={st.detail} onClick={() => start(st.id)} />)}
        </div>
      ))}
    </Sheet>
  );
};

/** The last session, offered back (as the studio's Restore banner does). */
const RestoreCard: React.FC = () => {
  const session = useLastSession((s) => s.session);
  if (!session) return null;
  const close = (dismissed: boolean) => {
    clearPreviousSession(dismissed);
    retryAutosave();
    useLastSession.setState({ session: null });
  };
  return (
    <Card title={<span className="flex items-center gap-2"><History className="w-4 h-4 text-cyan-300" />{session.replaced ? 'The song you replaced' : 'Your last song'}</span>}>
      <p className="text-sm mb-3">
        <b>{session.project.name}</b>, {session.project.clips.length} clips
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className={`${pill} flex-1 !border-cyan-400 text-cyan-200`}
          onClick={() => {
            close(false);
            useTimelineStore.getState().loadProject(session.project);
          }}
        >
          Restore
        </button>
        <button type="button" className={pill} onClick={() => close(true)}>
          Dismiss
        </button>
      </div>
    </Card>
  );
};

/** Each track a row of its clips across the song; the bar numbers move the playhead. */
const Overview: React.FC = () => {
  const tracks = useTimelineStore((s) => s.tracks);
  const clips = useTimelineStore((s) => s.clips);
  const loop = useTimelineStore((s) => s.loopRegion);
  const bar = usePlayPosition();
  const end = Math.max(9, loop.outBar, ...clips.map((c) => c.startBar + c.lengthBars));
  const bars = Math.ceil(end - 1);
  const pct = (b: number) => `${((b - 1) / bars) * 100}%`;
  const marks = Array.from({ length: Math.floor(bars / 4) + 1 }, (_, i) => 1 + i * 4).filter((b) => b < end);
  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const at = 1 + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * bars;
    useTimelineStore.getState().seek(Math.floor(at));
  };
  const shown = tracks.filter((t) => editorOf(t.instrumentKey) !== null || clips.some((c) => c.trackId === t.id));
  return (
    <div>
      <div className="flex">
        <div className="w-20 shrink-0" />
        <div className="relative flex-1 h-7 border-b border-forge-border" onPointerDown={seek} role="slider" aria-label="Song position" aria-valuenow={Math.floor(bar)}>
          {marks.map((b) => (
            <span key={b} className="absolute top-1 text-[10px] font-mono text-forge-muted -translate-x-1/2 first:translate-x-0" style={{ left: pct(b) }}>
              {b}
            </span>
          ))}
          {loop.enabled && <span className="absolute bottom-0 h-1 bg-amber-400/70 rounded" style={{ left: pct(loop.inBar), width: `${((loop.outBar - loop.inBar) / bars) * 100}%` }} />}
        </div>
      </div>
      <div className="relative">
        {shown.map((t) => (
          <div key={t.id} className="flex items-center h-11 border-b border-forge-border/50">
            <div className="w-20 shrink-0 pr-2 text-xs truncate flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.color }} />
              <span className={t.isMuted ? 'text-forge-muted line-through' : ''}>{t.name}</span>
            </div>
            <div className="relative flex-1 h-8">
              {clipsOf(clips, t.id).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-label={`${t.name}: ${c.name || 'clip'}, bar ${c.startBar}`}
                  onClick={() => usePocket.getState().openClip(c, t)}
                  className="absolute top-0 bottom-0 rounded-md border border-black/30"
                  style={{ left: pct(c.startBar), width: `max(6px, calc(${(c.lengthBars / bars) * 100}% - 1px))`, background: `${t.color}cc` }}
                />
              ))}
            </div>
          </div>
        ))}
        <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-red-500" style={{ left: `calc(5rem + (100% - 5rem) * ${(bar - 1) / bars})` }} />
      </div>
    </div>
  );
};

/** Arranging tools, on the loop (or the bars around the playhead when it's off). */
const ArrangeCard: React.FC = () => {
  const loop = useTimelineStore((s) => s.loopRegion);
  const where = loop.enabled ? `bars ${loop.inBar} to ${loop.outBar}` : 'the bars around the playhead';
  const tools: Array<{ title: string; detail: string; run: () => string; needsLoop?: boolean }> = [
    { title: 'Repeat the loop', detail: 'Copies everything in the loop to right after it, and moves the loop onto the copy.', run: repeatLoop, needsLoop: true },
    { title: 'Build-up and drop', detail: `A riser and snare roll into a drop at ${loop.enabled ? `bar ${loop.outBar}` : 'the next bar'}, with an impact on it.`, run: buildAndDrop },
    { title: 'Speed up into the drop', detail: `The last quarter of ${where} gets 25% faster, then snaps back.`, run: () => speedUpLoop(false) },
    { title: 'Speed up + drum roll', detail: 'The same, 50% faster, with the snare rolling into the drop.', run: () => speedUpLoop(true) },
  ];
  return (
    <Card title="Arrange">
      <div className="space-y-1">
        {tools.map((t) => (
          <SheetItem key={t.title} title={t.title} detail={t.needsLoop && !loop.enabled ? 'Turn the loop on first (the loop button at the top).' : t.detail} onClick={() => (t.needsLoop && !loop.enabled ? undefined : showToast(t.run()))} />
        ))}
      </div>
    </Card>
  );
};

export const PocketSong: React.FC = () => {
  const name = useTimelineStore((s) => s.projectName);
  const bpm = useTimelineStore((s) => s.bpm);
  const [sheet, setSheet] = useState<'new' | 'add' | null>(null);
  const s = useTimelineStore.getState;
  return (
    <>
      <RestoreCard />
      <Card
        title={
          <input
            aria-label="Song name"
            className="w-full bg-transparent text-base font-semibold outline-none"
            value={name}
            onChange={(e) => s().setProjectName(e.target.value)}
          />
        }
        right={
          <button type="button" className={pill} onClick={() => setSheet('new')}>
            <Plus className="w-4 h-4" /> New
          </button>
        }
      >
        <div className="flex items-center gap-2">
          <span className="text-sm text-forge-muted w-14">Tempo</span>
          <button type="button" aria-label="Slower" className={pill} onClick={() => s().setBpm(Math.max(40, Math.round(bpm) - 1))}>
            <Minus className="w-4 h-4" />
          </button>
          <span className="w-16 text-center font-mono text-lg tabular-nums">{Math.round(bpm)}</span>
          <button type="button" aria-label="Faster" className={pill} onClick={() => s().setBpm(Math.min(300, Math.round(bpm) + 1))}>
            <Plus className="w-4 h-4" />
          </button>
          <button type="button" className={`${pill} ml-auto`} onClick={() => s().tapTempo()}>
            Tap
          </button>
        </div>
      </Card>
      <Card
        title="Tracks"
        right={
          <button type="button" className={pill} onClick={() => setSheet('add')}>
            <Plus className="w-4 h-4" /> Instrument
          </button>
        }
      >
        <Overview />
        <p className="text-[11px] text-forge-muted mt-2">Tap a clip to edit it. Tap the bar numbers to move to that bar.</p>
      </Card>
      <ArrangeCard />
      {sheet === 'new' && <NewSongSheet onClose={() => setSheet(null)} />}
      {sheet === 'add' && <AddTrackSheet onClose={() => setSheet(null)} />}
    </>
  );
};
