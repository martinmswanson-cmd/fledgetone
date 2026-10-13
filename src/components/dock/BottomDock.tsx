import React from 'react';
import { AudioLines, AudioWaveform, ChevronDown, ChevronUp, Clapperboard, Gamepad2, Grid3x3, Piano, SlidersVertical } from 'lucide-react';
import { LauncherPanel } from '../timeline/LauncherPanel';
import { useUiStore, type DockTab } from '../../store/uiStore';
import { MixerPanel } from '../timeline/MixerPanel';
import { useTimelineStore } from '../../store/timelineStore';
import { PeqEditor } from '../inspector/PeqEditor';
import { MbcControls } from '../inspector/MbcPanel';
import { GamePanel } from '../timeline/GamePreview';
import { SfxMakerPanel } from '../sfx/SfxMakerPanel';
import { VideoPanel } from '../video/VideoPanel';
import { InstrumentBrowser } from '../InstrumentBrowser';
import { SoundAuditionPanel } from '../SoundAuditionPanel';

/**
 * The dock under the timeline: the Mixer, the instruments and sound deck, the Game tools, the
 * Video tools and the sound effects maker as tabs, like the bottom panel of a desktop DAW. Drag
 * its top edge to make it taller or shorter; the tab and height are remembered in this browser.
 */

const TABS: ReadonlyArray<{ id: DockTab; label: string; icon: React.ReactNode; title: string; buttonId: string }> = [
  { id: 'mixer', label: 'Mixer', icon: <SlidersVertical className="w-3.5 h-3.5" />, title: "Mixer: every track's fader, meter, pan and sends side by side", buttonId: 'btn-mixer' },
  { id: 'launcher', label: 'Launcher', icon: <Grid3x3 className="w-3.5 h-3.5" />, title: 'Clip launcher: loops in a grid of tracks and scenes, launched live on the bar to jam out an arrangement', buttonId: 'btn-launcher' },
  { id: 'eq', label: 'EQ & Dynamics', icon: <AudioLines className="w-3.5 h-3.5" />, title: "The selected track's Pro EQ and multiband compressor, big", buttonId: 'btn-eq' },
  { id: 'instruments', label: 'Instruments', icon: <Piano className="w-3.5 h-3.5" />, title: 'Try any instrument, play the sound deck pads and drag patterns onto tracks', buttonId: 'btn-instruments' },
  { id: 'game', label: 'Game', icon: <Gamepad2 className="w-3.5 h-3.5" />, title: 'Game preview: switch between sections and layers live, the way adaptive game music does', buttonId: 'btn-game' },
  { id: 'video', label: 'Video', icon: <Clapperboard className="w-3.5 h-3.5" />, title: 'Video tools: the reference video, its cuts and dialogue, hit points, and markers for editors', buttonId: 'btn-video-tools' },
  { id: 'sfx', label: 'Sound FX', icon: <AudioWaveform className="w-3.5 h-3.5" />, title: 'Sound effects maker: UI, combat, pickup, magic and retro sounds, jingles and ambience loops for games, alone or as a matching set', buttonId: 'btn-sfx' },
];

const Content: React.FC<{ tab: DockTab }> = ({ tab }) => {
  switch (tab) {
    case 'mixer':
      return <MixerPanel />;
    case 'launcher':
      return <LauncherPanel />;
    case 'eq':
      return <TrackEqDock />;
    case 'game':
      return <GamePanel />;
    case 'video':
      return <VideoPanel />;
    case 'sfx':
      return <SfxMakerPanel />;
    case 'instruments':
      return (
        <div className="flex flex-col gap-4 p-3">
          <section aria-label="Instrument Browser">
            <InstrumentBrowser />
          </section>
          <section aria-label="Soundbank Audition Panel">
            <p className="mb-2 px-1 text-[11px] font-mono text-forge-muted">Sound deck: click or use keys (Q-T, 1-4, A-D, Z-X) to play • drag pads onto the timeline</p>
            <SoundAuditionPanel />
          </section>
        </div>
      );
  }
};

/** The selected track's Pro EQ and multiband compressor, with room to work. */
const TrackEqDock: React.FC = () => {
  const track = useTimelineStore((s) => s.tracks.find((t) => t.id === s.selectedTrackId) ?? s.tracks[0]);
  if (!track) return <p className="p-3 text-xs text-forge-muted">Add a track first.</p>;
  const set = useTimelineStore.getState().setTrackFx;
  const toggle = (effect: 'peq' | 'mbc', on: boolean) => {
    useTimelineStore.getState().checkpoint();
    set(track.id, effect, { on });
  };
  const sw = (on: boolean, effect: 'peq' | 'mbc', label: string) => (
    <button type="button" role="switch" aria-checked={on} aria-label={`${label} ${on ? 'on' : 'off'}`} onClick={() => toggle(effect, !on)} className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${on ? 'bg-cyan-400 border-cyan-400 text-black' : 'border-forge-border text-forge-muted hover:text-forge-text'}`}>
      {on ? 'ON' : 'OFF'}
    </button>
  );
  return (
    <div className="grid gap-4 p-3 2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <section className="flex flex-col gap-2 min-w-0" aria-label="Pro EQ">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase text-forge-muted">
          <span className="w-2 h-2 rounded-full" style={{ background: track.color }} />
          <span className="text-forge-text font-bold normal-case">{track.name}</span> Pro EQ {sw(!!track.fx.peq?.on, 'peq', 'Pro EQ')}
          <span className="normal-case">· select another track to edit its EQ</span>
        </div>
        <PeqEditor track={track} height={230} big />
      </section>
      <section className="flex flex-col gap-2 min-w-0" aria-label="Multiband compressor">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase text-forge-muted">Multiband compressor {sw(!!track.fx.mbc?.on, 'mbc', 'Multiband')}</div>
        <MbcControls track={track} wide />
      </section>
    </div>
  );
};

export const BottomDock: React.FC = () => {
  const tab = useUiStore((s) => s.dockTab);
  const open = useUiStore((s) => s.dockOpen);
  const height = useUiStore((s) => s.dockHeight);
  const { openDock, setDockOpen, setDockHeight } = useUiStore.getState();

  const startResize = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = height;
    const move = (ev: PointerEvent) => setDockHeight(h0 - (ev.clientY - y0));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('cursor-ns-resize');
    };
    document.body.classList.add('cursor-ns-resize');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <section data-dock="" aria-label="Bottom panel" className="bg-forge-panel border border-forge-border rounded-xl shadow-lg overflow-hidden flex flex-col">
      {open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the bottom panel"
          title="Drag to resize"
          onPointerDown={startResize}
          onDoubleClick={() => setDockHeight(400)}
          className="h-1.5 cursor-ns-resize bg-forge-border/40 hover:bg-cyan-500/50 transition-colors"
        />
      )}
      <div className="flex items-center gap-1 px-2 border-b border-forge-border" role="tablist" aria-label="Bottom panel tabs">
        {TABS.map((t) => {
          const active = open && tab === t.id;
          return (
            <button
              key={t.id}
              id={t.buttonId}
              type="button"
              role="tab"
              aria-selected={active}
              title={t.title}
              onClick={() => (active ? setDockOpen(false) : openDock(t.id))}
              className={`h-9 px-3 flex items-center gap-1.5 text-xs font-mono border-b-2 -mb-px transition-colors ${
                active ? 'border-cyan-400 text-cyan-100' : 'border-transparent text-forge-muted hover:text-forge-text'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setDockOpen(!open)}
          className="ml-auto h-7 w-7 flex items-center justify-center rounded text-forge-muted hover:text-forge-text hover:bg-white/10"
          title={open ? 'Hide the bottom panel' : 'Show the bottom panel'}
          aria-label={open ? 'Hide the bottom panel' : 'Show the bottom panel'}
        >
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      </div>
      {open && (
        <div className="overflow-auto" style={{ height }} role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
          <Content tab={tab} />
        </div>
      )}
    </section>
  );
};
