import { BUS_PRESETS } from '../../store/busPresets';
import { isBus } from '../../store/buses';
import { addBuiltinPlugin, allBuiltinPlugins, FAVOURITES_KEY, readList, type BuiltinEntry } from '../../store/builtinPlugins';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { usePianoPanel } from '../../store/pianoPanel';
import { MOD_KEY, PALETTE_SHORTCUT, useUiStore, type DockTab } from '../../store/uiStore';
import { useVideoStore } from '../../store/videoStore';
import { useAudioStore } from '../../store/audioStore';
import { bounceTrack, canFreeze, freezeTrack, notFrozenMessage, unfreezeTrack } from '../../store/freezeActions';
import { canChooseSaveLocation, pickProjectFile, saveProjectAs, saveProjectFile } from '../timeline/projectFile';
import { exportMySounds, pickMySoundsFile, pickSoundFile, shareTrackSound } from '../mySoundsFile';
import { showToast } from '../timeline/toastStore';
import { reverseBlock } from '../../store/reverseActions';
import { openArrange } from '../timeline/arrangeDialogStore';
import { formatBarCount } from '../../store/timelineTypes';
import { press, reveal } from '../../search/reveal';
import { shouldIgnoreShortcut } from '../keyboard';
import { APP_VERSION } from '../../version';
import { LESSONS } from '../../tour/lessons';
import { useTourStore } from '../../tour/tourStore';
import { installApp, usePwa } from '../../pwa/pwa';
import { chooseInterface } from '../../pocket/pocketMode';

/**
 * The menu bar: every tool in the app, in the place a DAW keeps it (File, Edit, Song, Track,
 * Plugins, Tools, Video, Game, View, Learn, Help), so the toolbar only has to carry what's used all the time.
 * Hovering across the bar while a menu is open moves to the next menu, as desktop menus do.
 */

export interface MenuAction {
  label: string;
  shortcut?: string;
  /** Do it; a message back is shown in a toast (why it couldn't). */
  run: () => unknown;
  disabled?: boolean;
  checked?: boolean;
  divider?: boolean;
  /** Hover text */
  title?: string;
}

export interface MenuDef {
  id: string;
  label: string;
  items: () => MenuAction[];
}

const tl = () => useTimelineStore.getState();
const ui = () => useUiStore.getState();
const say = (message: unknown) => {
  if (typeof message === 'string' && message) showToast(message);
};

const selectedTrack = () => {
  const s = tl();
  return s.tracks.find((t) => t.id === s.selectedTrackId) ?? null;
};
const selectedClips = () => tl().clips.filter((c) => c.isSelected);
const NEED_TRACK = 'Select a track first (click its name).';
const NEED_VIDEO = 'Load a video first (Video › Load reference video).';

/** Open a dock tab, then do something in it once it's showing. */
const inDock = (tab: DockTab, then?: () => unknown) => async () => {
  ui().openDock(tab);
  if (then) return then();
};

const showTrackPanel = (name: string) => () => {
  const s = tl();
  if (!s.tracks.length) return 'Add a track first.';
  if (!selectedTrack()) s.selectTrack(s.tracks[0].id);
  s.toggleInspector(true);
  ui().setInspectorTab('track');
  void reveal(`[data-search="${name}"]`);
};

/** Quick ways into the plugin browser, on a category. */
const PLUGIN_SHORTCUTS = [
  { label: 'Instruments', category: 'Instruments' },
  { label: 'Reverbs', category: 'Reverb' },
  { label: 'Delays and ambience', category: 'Ambience' },
  { label: 'Saturation and warmth', category: 'Saturation' },
  { label: 'Tape', category: 'Tape' },
  { label: 'Dynamics', category: 'Dynamics' },
  { label: 'Filters', category: 'Filter' },
  { label: 'Lo-fi', category: 'Lo-Fi' },
  { label: 'Amps and distortion', category: 'Amp Sims' },
  { label: 'Stereo', category: 'Stereo' },
  { label: 'Console and mix bus', category: 'Consoles' },
  { label: 'Recommended', category: 'Recommended' },
];

const MENUS: MenuDef[] = [
  {
    id: 'file',
    label: 'File',
    items: () => [
      { label: 'New…', run: () => ui().setDialog('new'), title: 'Start again from a blank timeline, a demo song or a starter' },
      { label: 'Open…', shortcut: `${MOD_KEY}O`, run: pickProjectFile },
      { label: 'Save', shortcut: `${MOD_KEY}S`, run: () => void saveProjectFile(), title: 'Save to the project’s file (the first time, choose where)' },
      { label: 'Save As…', shortcut: `${MOD_KEY}⇧S`, run: () => void saveProjectAs(), title: canChooseSaveLocation() ? 'Choose the folder and name to save to' : 'This browser saves to its downloads folder (Chrome or Edge on a computer can choose where)' },
      { label: 'Save my sounds to a file…', run: () => void exportMySounds(), title: 'Your saved sounds (My sounds) and starred instruments in one file, to keep safe or open in another browser', divider: true },
      { label: 'Open a My sounds file…', run: pickMySoundsFile, title: 'Add the sounds and stars from a My sounds file to the ones in this browser' },
      {
        label: 'Share this track’s sound…',
        run: () => {
          const id = tl().selectedTrackId;
          if (id) void shareTrackSound(id);
          else showToast('Select a track first: its sound goes in the file.');
        },
        title: 'The selected track’s sound (its instrument with every setting and plugin knob) as a small file, to send to anyone',
      },
      { label: 'Open a sound file…', run: () => pickSoundFile(tl().selectedTrackId ?? undefined), title: 'Put a shared sound on the selected track (it goes into My sounds too)' },
      { label: 'Export audio / video…', shortcut: `${MOD_KEY}E`, run: () => ui().setDialog('export'), divider: true },
      {
        label: 'Showcase video (YouTube, TikTok)…',
        run: () => void import('../timeline/ExportDialog').then(({ presetShowcaseExport }) => {
          presetShowcaseExport('wide');
          ui().setDialog('export');
        }),
        divider: true,
      },
      { label: 'Channel kit (streams, videos)…', run: () => ui().setDialog('channelKit'), title: 'An intro, an outro, loops for your stream’s screens, alerts and a transition whoosh, all from this song, in one .zip' },
      { label: 'Beat store package…', run: () => ui().setDialog('beatStore'), title: 'A tagged MP3 preview, the WAV, the stems and a cover in one .zip, named with the tempo and key' },
      { label: 'Share…', run: () => ui().setDialog('share') },
      { label: 'Cut song to length…', run: () => ui().setDialog('cut'), divider: true },
      { label: 'Export markers for video editors…', run: inDock('video', () => reveal('[aria-label="Export the markers for video editing software"]')) },
      { label: 'Game kit (Godot, Unity, web)…', run: inDock('game', () => reveal('[data-game="export"]')) },
      { label: 'FMOD / Wwise package…', run: () => ui().setDialog('engines') },
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    items: () => {
      const s = tl();
      const any = s.clips.some((c) => c.isSelected);
      return [
        { label: 'Undo', shortcut: `${MOD_KEY}Z`, run: s.undo, disabled: !s.past.length },
        { label: 'Redo', shortcut: `${MOD_KEY}Y`, run: s.redo, disabled: !s.future.length },
        { label: 'Cut', shortcut: `${MOD_KEY}X`, run: s.cutSelectedClips, disabled: !any, divider: true },
        { label: 'Copy', shortcut: `${MOD_KEY}C`, run: s.copySelectedClips, disabled: !any },
        { label: 'Paste at the playhead', shortcut: `${MOD_KEY}V`, title: 'On the selected track, when what you copied came from one track', run: () => say(s.pasteClips(undefined, new Set(s.clipboard.map((c) => c.trackId)).size === 1 && s.selectedTrackId ? s.selectedTrackId : undefined)) },
        { label: 'Duplicate', shortcut: `${MOD_KEY}D`, run: () => say(s.duplicateSelection()), disabled: !any },
        { label: 'Delete', shortcut: 'Del', run: s.deleteSelectedClips, disabled: !any },
        { label: 'Select all', shortcut: `${MOD_KEY}A`, run: s.selectAll, divider: true },
        { label: 'Select nothing', shortcut: 'Esc', run: s.clearSelection },
        { label: 'Selection tool', shortcut: 'V', run: () => s.setTool('select'), checked: s.activeTool === 'select', divider: true },
        { label: 'Razor tool', shortcut: 'C', run: () => s.setTool('razor'), checked: s.activeTool === 'razor' },
      ];
    },
  },
  {
    id: 'song',
    label: 'Song',
    items: () => {
      const s = tl();
      const at = Math.max(1, Math.round(s.playheadPosition));
      return [
        { label: 'Add marker at the playhead', shortcut: 'M', run: () => say(s.addMarker()) },
        { label: 'Add hit point (locked to time)', shortcut: 'Shift+M', run: () => say(s.addHit()) },
        { label: 'Markers list…', run: () => press('button[title^="Markers:"]') },
        { label: 'Fit tempo / tempo finder…', run: () => press('button[title^="Fit to time"]'), divider: true },
        { label: 'Tap tempo', run: s.tapTempo },
        {
          label: `Breathe: ease into every 4-bar phrase end (${s.loopRegion.enabled ? 'the loop' : 'the whole song'})`,
          run: () => say(s.breatheTempo(4, 0.08) ?? 'The tempo now eases into each phrase end, and slows into the last. Undo takes it out.'),
        },
        { label: 'Breathe: every 8-bar phrase, deeper', run: () => say(s.breatheTempo(8, 0.14) ?? 'The tempo now eases into each 8-bar phrase end. Undo takes it out.') },
        { label: `Insert 1 bar at bar ${at}`, run: () => say(s.insertBars(at, 1)), divider: true },
        { label: `Insert 4 bars at bar ${at}`, run: () => say(s.insertBars(at, 4)) },
        { label: 'Delete bars In → Out', run: () => say(s.removeBars(s.loopRegion.inBar, s.loopRegion.outBar)) },
        { label: `Build-up & drop at bar ${Math.max(2, at)}`, run: () => say(s.addBuildAndDrop(Math.max(2, at))), divider: true },
        { label: 'Arrange a beat: drops, beat switch, song form, tag…', run: () => openArrange('drops', Math.max(2, at)) },
        { label: 'Dark melody…', run: () => openArrange('melody', at) },
        { label: `Key change up a semitone from bar ${at}`, run: () => say(s.keyChangeFrom(at, 1)) },
        { label: `Key change up a whole step from bar ${at}`, run: () => say(s.keyChangeFrom(at, 2)) },
        { label: `Key change down a semitone from bar ${at}`, run: () => say(s.keyChangeFrom(at, -1)) },
        {
          label: `Play bars ${formatBarCount(s.loopRegion.inBar)}–${formatBarCount(s.loopRegion.outBar)} backwards (In → Out)`,
          run: () => {
            showToast('Reversing…');
            void reverseBlock(s.loopRegion.inBar, s.loopRegion.outBar).then(showToast, (err) => showToast(`Couldn't reverse it: ${err instanceof Error ? err.message : String(err)}`));
          },
          divider: true,
        },
        { label: 'Cut song to length…', run: () => ui().setDialog('cut') },
      ];
    },
  },
  {
    id: 'track',
    label: 'Track',
    items: () => {
      const t = selectedTrack();
      const frozen = !!t?.frozen;
      return [
        { label: 'Add track…', run: () => press('button[title="Add a new instrument track"]') },
        { label: t ? `Delete “${t.name}”` : 'Delete track', run: () => (t ? tl().deleteTrack(t.id) : NEED_TRACK), disabled: !t },
        { label: t ? (frozen ? `Unfreeze “${t.name}”` : `Freeze “${t.name}”`) : 'Freeze track', disabled: !t, run: () => {
          if (!t) return NEED_TRACK;
          if (frozen) return unfreezeTrack(t.id);
          if (!canFreeze(t.id)) return 'This track has nothing to freeze.';
          return freezeTrack(t.id).then((r) => (r === 'done' ? undefined : notFrozenMessage(t.name, r)));
        } },
        { label: t ? `Bounce “${t.name}” in place` : 'Bounce in place', disabled: !t, run: () => {
          if (!t) return NEED_TRACK;
          if (!canFreeze(t.id)) return 'This track has nothing to bounce.';
          return bounceTrack(t.id).then((id) => (id ? `Bounced ${t.name} to audio: the original is muted, under it` : undefined));
        } },
        { label: 'Move up', run: () => (t ? tl().moveTrackRow(t.id, -1) : NEED_TRACK), disabled: !t, divider: true },
        { label: 'Move down', run: () => (t ? tl().moveTrackRow(t.id, 1) : NEED_TRACK), disabled: !t },
        t?.folder
          ? { label: `Take out of “${t.folder.name}”`, run: () => tl().setTrackFolder(t.id, null) }
          : { label: 'New folder with this track', run: () => (t ? void tl().groupIntoFolder([t.id]) : NEED_TRACK), disabled: !t, title: 'Right-click other tracks to move them into it' },
        ...BUS_PRESETS.map((p, i) => ({
          label: `Bus preset: ${p.name}`,
          divider: i === 0,
          title: `${p.about} On a selected bus, sets it up; otherwise groups the ${p.role === 'music' ? 'music' : p.role} tracks into a new bus.`,
          run: () => {
            const onBus = t && isBus(t) ? t.id : undefined;
            const id = tl().applyBusPreset(p.id, onBus);
            if (!id) return `No ${p.role === 'music' ? 'music' : p.role} tracks playing straight to the master to put on a ${p.name.toLowerCase()}.`;
            return onBus ? `${t!.name} is set up as a ${p.name.toLowerCase()}` : undefined;
          },
        })),
        { label: 'Colour, folders and more: right-click a track’s name', run: () => undefined, disabled: true },
        { label: 'Mute', shortcut: '', run: () => (t ? tl().toggleMute(t.id) : NEED_TRACK), checked: !!t?.isMuted, disabled: !t, divider: true },
        { label: 'Solo', run: () => (t ? tl().toggleSolo(t.id) : NEED_TRACK), checked: !!t?.isSoloed, disabled: !t },
        { label: 'Arm for recording', run: () => (t ? tl().toggleArm(t.id) : NEED_TRACK), checked: !!t?.isArmed, disabled: !t },
        { label: 'Inspector & FX rack', run: () => tl().toggleInspector(), checked: tl().isInspectorOpen, divider: true },
        { label: 'EQ', run: showTrackPanel('eq') },
        { label: 'Pro EQ (big)', run: () => (t ? ui().openDock('eq') : NEED_TRACK) },
        { label: 'Multiband compressor', run: showTrackPanel('Multiband') },
        { label: 'Human feel', run: showTrackPanel('Human') },
        { label: 'Duck others under this track', run: showTrackPanel('Duck others under this') },
        { label: 'Automation', run: () => (t ? tl().showAutomation(t.id, true) : NEED_TRACK), disabled: !t },
      ];
    },
  },
  {
    id: 'plugins',
    label: 'Plugins',
    items: () => {
      const t = selectedTrack();
      const fxTrack = t && !isBus(t) ? t : null;
      const browse = (category?: string) => () => ui().setPluginBrowser({ trackId: fxTrack?.id ?? null, category });
      const favourites = readList(FAVOURITES_KEY)
        .map((key) => allBuiltinPlugins().find((e) => e.key === key))
        .filter((e): e is BuiltinEntry => !!e)
        .slice(0, 8);
      const open = t ? [t.plugin, ...(t.pluginFx ?? [])].filter((p) => !!p) : [];
      return [
        { label: 'Browse plugins…', run: browse(), title: `${allBuiltinPlugins().length} built-in effects and instruments` },
        { label: fxTrack ? `Add effect to “${fxTrack.name}”…` : 'Add effect to a track…', run: browse(), disabled: !fxTrack },
        ...PLUGIN_SHORTCUTS.map((c, i) => ({ label: `${c.label}…`, run: c.category === 'Instruments' ? () => ui().setPluginBrowser({ trackId: null, category: c.category }) : browse(c.category), divider: i === 0 })),
        ...favourites.map((e, i) => ({
          label: `★ ${e.info.name}${e.info.instrument ? ' (new track)' : fxTrack ? ` on “${fxTrack.name}”` : ''}`,
          run: () => (e.info.instrument || fxTrack ? void addBuiltinPlugin(e, fxTrack?.id ?? null) : NEED_TRACK),
          divider: i === 0,
        })),
        ...open.map((p, i) => ({ label: `Open ${p.name}`, run: () => ui().setPluginWindow({ trackId: t!.id, pluginId: p.id }), divider: i === 0 })),
        { label: 'Instrument from a web address (WAM)…', run: () => ui().setPluginDialog({ trackId: null }), divider: true },
        { label: 'Effect from a web address (WAM)…', run: () => (fxTrack ? ui().setPluginDialog({ trackId: fxTrack.id }) : NEED_TRACK), disabled: !fxTrack },
      ];
    },
  },
  {
    id: 'tools',
    label: 'Tools',
    items: () => {
      const clip = selectedClips()[0];
      return [
        { label: 'Mixer', run: inDock('mixer') },
        { label: 'Sound effects maker', run: inDock('sfx') },
        { label: 'Generate variations of the selected clip…', run: () => (clip ? ui().setVariationsClip(clip.id) : 'Select a short clip first.'), disabled: !clip, divider: true },
        { label: 'Tune vocal (selected audio clip)…', run: () => (clip?.audio ? ui().setTuneClip(clip.id) : 'Select an audio clip (a recorded vocal) first.'), disabled: !clip?.audio },
        { label: 'Synth Designer', run: () => {
          const s = tl();
          const existing = s.tracks.find((t) => t.instrumentKey === 'synthDesigner');
          if (existing) s.selectTrack(existing.id);
          else s.addTrack('synthDesigner');
          s.toggleInspector(true);
          ui().setInspectorTab('track');
          void reveal('[aria-label="Synth Designer"]');
        } },
        { label: 'Drum Designer', run: () => {
          const s = tl();
          const existing = s.tracks.find((t) => t.instrumentKey === 'designedKit');
          if (existing) s.selectTrack(existing.id);
          else s.addTrack('designedKit');
          s.toggleInspector(true);
          ui().setInspectorTab('track');
          void reveal('[aria-label="Drum Designer"]');
        } },
        { label: 'Record from the microphone', run: () => press('button[title^="Record from the microphone"], button[title^="Stop recording"]'), divider: true },
        { label: 'Piano (play and type notes with the keyboard)', run: () => usePianoPanel.getState().setOpen(!usePianoPanel.getState().open) },
        { label: 'MIDI keyboard…', run: () => press('button[title^="MIDI input"]') },
        { label: 'Metronome', run: () => press('button[title^="Metronome:"]') },
        { label: 'Performance & memory', run: () => {
          if (useAudioStore.getState().audioState !== 'running') return 'Start the audio first.';
          return press('button[title="Performance and memory"], button[title^="Playback is lagging"]');
        }, divider: true },
      ];
    },
  },
  {
    id: 'video',
    label: 'Video',
    items: () => {
      const v = useVideoStore.getState();
      return [
        { label: v.video ? 'Load a different video…' : 'Load reference video…', run: inDock('video', () => press('button[title^="Load a video"], button[title^="Scoring to"]')) },
        { label: 'Show preview window', run: () => v.setPreviewOpen(!v.previewOpen), checked: v.previewOpen, disabled: !v.video },
        { label: 'Find cuts (hit points)', run: v.video ? inDock('video', () => press('[aria-label="Find cuts in the video"]')) : () => NEED_VIDEO, disabled: !v.video, divider: true },
        { label: 'Dip music under dialogue…', run: v.video ? inDock('video', () => press("[aria-label=\"Dip the music under the video's dialogue\"]")) : () => NEED_VIDEO, disabled: !v.video },
        { label: 'Tempo finder for hit points…', run: async () => {
          if (await press('button[title^="Fit to time"]')) await press('[aria-label="What to fit"] button:last-child');
        } },
        { label: 'Cut song to length…', run: () => ui().setDialog('cut') },
        { label: 'Export markers for video editors…', run: inDock('video', () => reveal('[aria-label="Export the markers for video editing software"]')), divider: true },
        { label: 'Export music onto the video…', run: () => ui().setDialog('export') },
        { label: 'Remove the video', run: v.remove, disabled: !v.video, divider: true },
      ];
    },
  },
  {
    id: 'game',
    label: 'Game',
    items: () => [
      { label: 'Game panel (states, intensity, stingers)', run: inDock('game') },
      { label: 'Try it in a game…', run: () => ui().setDialog('tryOut') },
      { label: 'Transition matrix', run: inDock('game', () => reveal('[data-game="transitions"]')) },
      { label: 'Intensity & stem groups', run: inDock('game', () => reveal('[data-game="intensity"]')) },
      { label: 'Stingers', run: inDock('game', () => reveal('[data-game="stingers"]')) },
      { label: 'Loop variations', run: inDock('game', () => reveal('[data-game="variations"]')) },
      { label: 'Sound effects maker', run: inDock('sfx'), divider: true },
      { label: 'Generate variations of the selected clip…', run: () => {
        const clip = selectedClips()[0];
        return clip ? ui().setVariationsClip(clip.id) : 'Select a short clip first.';
      } },
      { label: 'Export game kit (Godot, Unity, web)…', run: inDock('game', () => reveal('[data-game="export"]')), divider: true },
      { label: 'Export web runtime kit…', run: inDock('game', () => reveal('button[title^="For web games"]')) },
      { label: 'Export FMOD / Wwise package…', run: () => ui().setDialog('engines') },
    ],
  },
  {
    id: 'view',
    label: 'View',
    items: () => {
      const u = ui();
      const s = tl();
      const tab = (t: DockTab, label: string, divider = false): MenuAction => ({ label, run: () => u.openDock(t), checked: u.dockOpen && u.dockTab === t, divider });
      return [
        tab('mixer', 'Mixer'),
        tab('launcher', 'Launcher'),
        tab('eq', 'EQ & Dynamics'),
        tab('game', 'Game'),
        tab('video', 'Video'),
        tab('sfx', 'Sound effects'),
        { label: u.dockOpen ? 'Hide the bottom panel' : 'Show the bottom panel', run: () => u.setDockOpen(!u.dockOpen), divider: true },
        { label: 'Inspector & FX rack', run: () => s.toggleInspector(), checked: s.isInspectorOpen },
        { label: 'Zoom in', shortcut: '+', run: () => s.setZoom(s.zoom * 1.25), divider: true },
        { label: 'Zoom out', shortcut: '-', run: () => s.setZoom(s.zoom / 1.25) },
        { label: 'Ruler in bars', run: () => s.setRulerUnits('bars'), checked: s.rulerUnits === 'bars', divider: true },
        { label: 'Ruler in timecode', run: () => s.setRulerUnits('timecode'), checked: s.rulerUnits === 'timecode' },
      ];
    },
  },
  {
    id: 'learn',
    label: 'Learn',
    // The tour and every tutorial, one click each (a tutorial left part-way picks up where it stopped)
    items: () => {
      const progress = useTourStore.getState().progress;
      return [
        { label: 'Tour & tutorials…', run: () => ui().setDialog('learn') },
        ...LESSONS.map((l, i) => {
          const p = progress[l.id];
          const resume = !p?.done && p?.step !== undefined && p.step > 0;
          return {
            label: `${l.title}${resume ? ' (resume)' : ''}`,
            checked: !!p?.done,
            divider: i === 0,
            run: () => useTourStore.getState().start(l.id, resume ? p.step : 0),
          };
        }),
        { label: 'Guide', shortcut: '?', run: () => ui().openGuide(), divider: true },
      ];
    },
  },
  {
    id: 'help',
    label: 'Help',
    items: () => [
      { label: 'Guide', shortcut: '?', run: () => ui().openGuide() },
      { label: 'Tour & tutorials…', run: () => ui().setDialog('learn') },
      { label: 'Search everything', shortcut: PALETTE_SHORTCUT, run: () => ui().setPaletteOpen(true) },
      { label: 'Keyboard shortcuts', run: () => ui().openGuide('keyboard-shortcuts'), divider: true },
      ...(usePwa.getState().installed ? [] : [{ label: 'Install Fledgetone…', run: installApp, divider: true, title: 'Install Fledgetone as an app: its own window, and it opens offline' }]),
      { label: 'Pocket, the phone version', run: () => chooseInterface('pocket'), title: 'Switch to Fledgetone Pocket: the whole song on one screen, with pads, steps and a piano roll made for a phone. The same song opens in both' },
      { label: 'Report a problem…', run: () => ui().setDialog('report'), divider: true },
      { label: 'Source code', run: () => window.open('https://github.com/martinmswanson-cmd/fledgetone', '_blank', 'noopener'), title: "Fledgetone is free software under the GNU GPL, version 3: its code on GitHub" },
      { label: `What's new (version ${APP_VERSION})`, run: () => ui().setDialog('changes') },
      { label: 'Terms of use', run: () => ui().setDialog('terms') },
    ],
  },
];

const MenuList: React.FC<{ menu: MenuDef; onClose: () => void; left: number; top: number }> = ({ menu, onClose, left, top }) => {
  const ref = useRef<HTMLDivElement>(null);
  const items = menu.items();
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus({ preventScroll: true });
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={menu.label}
      onKeyDown={onKeyDown}
      className="fixed z-[60] min-w-64 py-1 rounded-md border border-forge-borderLight bg-forge-panelLight shadow-2xl text-xs"
      style={{ left, top }}
    >
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {item.divider && i > 0 && <div className="my-1 border-t border-forge-border" role="separator" />}
          <button
            type="button"
            role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={item.checked}
            disabled={item.disabled}
            title={item.title}
            onClick={async () => {
              onClose();
              try {
                say(await item.run());
              } catch (err) {
                showToast(err instanceof Error ? err.message : String(err));
              }
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-forge-text hover:bg-cyan-500/20 focus:bg-cyan-500/20 focus:outline-none disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default"
          >
            <span className="w-3.5 shrink-0">{item.checked && <Check className="w-3.5 h-3.5 text-cyan-300" />}</span>
            <span className="flex-1">{item.label}</span>
            {item.shortcut && <span className="text-forge-muted text-[10px] font-mono">{item.shortcut}</span>}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
};

export const MenuBar: React.FC = () => {
  const [where, setWhere] = useState<{ id: string; left: number; top: number } | null>(null);
  const open = where?.id ?? null;
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const bar = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setWhere(null), []);
  const place = useCallback((id: string | null) => {
    const r = id ? buttons.current[id]?.getBoundingClientRect() : undefined;
    setWhere(id && r ? { id, left: Math.max(0, Math.min(r.left, window.innerWidth - 280)), top: r.bottom + 2 } : null);
  }, []);
  const setOpen = place;
  // A click outside, Esc or a resize closes the menu; scrolling the page carries it along with its button
  useEffect(() => {
    if (!where) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!bar.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onScroll = () => place(where.id);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [where, close, place]);

  // File shortcuts: Ctrl+S save, Ctrl+Shift+S save as, Ctrl+O open, Ctrl+E export
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      // (Shift only with S: Save As)
      if (e.shiftKey && key !== 's') return;
      if (key !== 's' && key !== 'o' && key !== 'e') return;
      if (shouldIgnoreShortcut(e) && key !== 's') return;
      e.preventDefault();
      // (A held key repeats: one save, one picker)
      if (e.repeat) return;
      if (key === 's') void (e.shiftKey ? saveProjectAs() : saveProjectFile());
      else if (key === 'o') pickProjectFile();
      else ui().setDialog('export');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const menu = MENUS.find((m) => m.id === open);
  return (
    <div ref={bar} className="flex items-center" role="menubar" aria-label="Menu bar">
      {MENUS.map((m) => (
        <button
          key={m.id}
          id={`menu-${m.id}`}
          ref={(el) => {
            buttons.current[m.id] = el;
          }}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={open === m.id}
          title={`${m.label} menu`}
          onClick={() => setOpen(open === m.id ? null : m.id)}
          onPointerEnter={() => open && open !== m.id && setOpen(m.id)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            const i = MENUS.findIndex((x) => x.id === m.id);
            const next = MENUS[(i + (e.key === 'ArrowRight' ? 1 : -1) + MENUS.length) % MENUS.length];
            buttons.current[next.id]?.focus();
            if (open) setOpen(next.id);
          }}
          className={`h-7 px-2.5 rounded text-[13px] transition-colors ${open === m.id ? 'bg-cyan-500/20 text-cyan-100' : 'text-forge-text/90 hover:bg-white/10'}`}
        >
          {m.label}
        </button>
      ))}
      {menu && where && <MenuList key={menu.id} menu={menu} onClose={close} left={where.left} top={where.top} />}
    </div>
  );
};
