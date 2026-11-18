import { useAudioStore } from '../store/audioStore';
import { useTimelineStore } from '../store/timelineStore';
import { useUiStore } from '../store/uiStore';
import { PALETTE_SHORTCUT } from '../store/uiStore';
import { toolShortcutLabel } from '../store/toolShortcuts';
import { isAudioKind, isDrumKind } from '../audio/instrumentCatalog';
import { isMixTrack } from '../store/buses';
import { useMySounds } from '../store/mySounds';
import { useRenderBusy } from '../audio/renderBusy';

/**
 * The first-visit tour and the guided tutorials. A step points at a part of the screen (a CSS
 * selector) and explains it. A step with a `task` waits for the person to do something and moves on
 * by itself once they have, checked against the app's state. Each task can note how things stood when
 * the step began (`begin`), so "add a track" means one more than there were.
 */

export type Level = 'Tour' | 'Beginner' | 'Intermediate' | 'Expert';

export interface LessonStep {
  title: string;
  /** Plain text; **bold** is shown bold */
  body: string;
  /** What to point at: a selector, or one worked out at the time (null: nothing, the card is centred) */
  target?: string | (() => string | null);
  /** Set the scene before the step shows (open a panel, select a track) */
  before?: () => void;
  task?: {
    /** What to do, in a few words (shown as "Your turn") */
    hint: string;
    begin?: () => unknown;
    done: (start: unknown) => boolean;
  };
}

export interface Lesson {
  id: string;
  level: Level;
  title: string;
  /** One line for the menu */
  summary: string;
  minutes: number;
  steps: LessonStep[];
}

const tl = () => useTimelineStore.getState();
const ui = () => useUiStore.getState();
const selected = () => {
  const s = tl();
  return s.tracks.find((t) => t.id === s.selectedTrackId) ?? s.tracks[0];
};
const clipIds = () => new Set(tl().clips.map((c) => c.id));
const noteCount = () => tl().clips.reduce((n, c) => n + c.notes.length, 0);
const pointCount = () => tl().tracks.reduce((n, t) => n + (t.automation ?? []).reduce((m, l) => m + l.points.length, 0), 0);
/** A fingerprint of every note's pitch, so a key change shows as a change */
const pitches = () => tl().clips.map((c) => c.notes.map((n) => n.note).join(',')).join('|');
const ensureTrack = () => {
  let s = tl();
  if (!s.tracks.length) {
    s.addTrack('piano');
    s = tl();
  }
  if (!s.tracks.some((t) => t.id === s.selectedTrackId)) s.selectTrack(s.tracks[0].id);
};

const NEW_BUTTON = '#menu-file';
const EXPORT_BUTTON = 'button[title^="Render the song"]';
const RULER = '[data-tour="ruler"]';
const FIRST_HEADER = '[data-tour="track-header"]';
const dialogOr = (dialog: string, label: string, fallback: string) => () => (ui().dialog === dialog ? `[role="dialog"][aria-label="${label}"]` : fallback);
const EXPORT_DIALOG = '[role="dialog"][aria-label="Export audio / video"]';
/** The pressed button of one of the Export dialog's button rows (Shape, Frame rate), or '' */
const pressedIn = (group: string) => document.querySelector(`${EXPORT_DIALOG} [role="group"][aria-label="${group}"] button[aria-pressed="true"]`)?.textContent ?? '';
/** The Export dialog is open on a Showcase video */
const showcaseOpen = () =>
  ui().dialog === 'export' && [...document.querySelectorAll<HTMLSelectElement>(`${EXPORT_DIALOG} select`)].some((sel) => sel.value === 'showcase');
/** The selected track's instrument button in the Inspector, and the list it opens */
/** The instrument of a track, by id */
const instrumentOf = (id?: string) => tl().tracks.find((t) => t.id === id)?.instrumentKey;
const INSTRUMENT_BUTTON = 'button[aria-label^="Instrument: "]';
const instrumentListOpen = () => !!document.querySelector('[role="listbox"][aria-label="Instruments"]');
const instrumentTarget = () => (instrumentListOpen() ? '[role="listbox"][aria-label="Instruments"]' : INSTRUMENT_BUTTON);
const showTrackInspector = () => {
  ensureTrack();
  // A track with an instrument to pick (not a bus, a return or an audio track)
  const cur = selected();
  if (cur && (isMixTrack(cur) || isAudioKind(cur.instrumentKey))) {
    const t = tl().tracks.find((x) => !isMixTrack(x) && !isAudioKind(x.instrumentKey));
    if (t) tl().selectTrack(t.id);
  }
  tl().toggleInspector(true);
  ui().setInspectorTab('track');
};

const TOUR: Lesson = {
  id: 'tour',
  level: 'Tour',
  title: 'Quick tour',
  summary: "Where everything is, in about a minute. Nothing to do but read and click Next.",
  minutes: 1,
  steps: [
    {
      title: "Welcome to Fledgetone",
      body: 'A music studio that runs in your browser. You write every note, pick every sound and mix it yourself, then export it, post it as a video or put it in a game. Here is where everything lives.',
    },
    {
      title: 'Start the audio',
      body: 'Browsers only allow sound after you click something. **START AUDIO** turns it on (pressing Play does too). It glows red until audio is running.',
      target: '[data-tour="start-audio"]',
    },
    {
      title: 'The menus',
      body: 'Every tool lives in the menu bar: **File** (New, Open, Save, Export), **Edit**, **Song** (markers, tempo, build-ups, key changes), **Track**, **Plugins**, **Tools**, **Video**, **Game**, **View**, **Learn** and **Help**. **New** offers a blank timeline or one of the starters.',
      target: '[role="menubar"]',
    },
    {
      title: 'Your project',
      body: 'Name it, **Save** a project file, **Export** audio and video, or **Share** a link. It also autosaves in this browser.',
      target: '#btn-save-project',
    },
    {
      title: 'Play, stop and loop',
      body: '**Space** plays and pauses. Stop goes back to the loop start, and the loop button (**L**) repeats the In-to-Out range. Record, metronome and MIDI keyboard live here too.',
      target: '[role="group"][aria-label="Transport"]',
    },
    {
      title: 'The timeline',
      body: 'Each row is a **track** (one instrument) and the blocks of notes on it are **clips** (double-click an empty lane to make one). Drag clips to move them, double-click one to write its notes, and right-click the ruler for markers, build-ups and key changes.',
      target: '[data-timeline-scroll]',
    },
    {
      title: 'Track controls',
      body: 'Volume and pan, **M**ute, **S**olo and **R**ecord-arm, plus buttons for automation, freezing and the track’s effects.',
      target: FIRST_HEADER,
    },
    {
      title: 'Add a track',
      body: 'Pick from more than 200 instruments, and click ▶ on any of them to hear it first. Type to search: a name, or a style such as *8-bit*, *orchestral* or *jazz*.',
      target: 'button[title="Add a new instrument track"]',
    },
    {
      title: 'Effects and mixing',
      body: '**FX Rack** opens the Inspector: EQ, compressor, filter, pump, lo-fi, gate, reverb and more for the selected track, and the master effects.',
      target: '#btn-inspector-toggle',
    },
    {
      title: 'The bottom panel',
      body: 'Tabs under the timeline: the **Mixer** (every track side by side), the clip **Launcher**, **EQ & Dynamics** (the selected track’s EQ, big), **Game**, **Video** tools and the **Sound FX** maker. Drag its top edge to resize it.',
      target: '[role="tablist"][aria-label="Bottom panel tabs"]',
    },
    {
      title: 'Tempo and swing',
      body: 'Type a tempo or drag it, tap it in with **TAP**, or **FIT** the song to a length of time. Swing shuffles the off-beat 16ths.',
      target: '[aria-label="Tempo (BPM)"]',
    },
    {
      title: 'Find anything',
      body: `**SEARCH** (or ${PALETTE_SHORTCUT}) finds any tool, setting, instrument, starter or guide page and takes you there.`,
      target: 'button[title^="Search tools"]',
    },
    {
      title: 'Learn more',
      body: 'The **Learn** menu at the top (or the **LEARN** button here) has this tour and nine hands-on tutorials, from a first song and a showcase video to game music that reacts. **GUIDE** (or **?**) explains everything in detail.',
      target: 'button[title^="Tour and tutorials"]',
    },
  ],
};

interface ExportWatch {
  rendered: boolean;
}
/** Notes when a render starts (one can finish between two checks of the step), for "export the file" steps. */
function watchExport(): ExportWatch {
  const w: ExportWatch = { rendered: false };
  const stop = useRenderBusy.subscribe((s) => {
    // (one from the Export dialog: tracks frozen in the background render too)
    if (s.running > 0 && ui().dialog === 'export') {
      w.rendered = true;
      stop();
    }
  });
  return w;
}

const BEGINNER: Lesson = {
  id: 'beginner',
  level: 'Beginner',
  title: 'Your first song',
  summary: 'Open a starter, play it, swap a sound, write a few notes and export it.',
  minutes: 6,
  steps: [
    {
      title: 'Your first song',
      body: "No music experience needed. You'll open a ready-made song, play it, change it and write a few notes of your own. Each step says what to do and moves on by itself once you've done it.",
    },
    {
      title: 'Turn on the sound',
      body: 'Click **START AUDIO** in the top-right corner.',
      target: '[data-tour="start-audio"]',
      task: { hint: 'Click START AUDIO', done: () => useAudioStore.getState().audioState === 'running' },
    },
    {
      title: 'Open a starter',
      body: 'Open the **File** menu, click **New…**, then pick a starter. *Lo-Fi* is a gentle first one. (This replaces the current timeline.)',
      target: dialogOr('new', 'New arrangement', NEW_BUTTON),
      task: { hint: 'New, then a starter', begin: clipIds, done: (b) => tl().clips.length > 0 && !tl().clips.some((c) => (b as Set<string>).has(c.id)) },
    },
    {
      title: 'Play it',
      body: 'Press **Space**, or the green Play button.',
      target: '#btn-play',
      task: { hint: 'Press Space', done: () => tl().isPlaying },
    },
    {
      title: 'Mute a track',
      body: "While it plays, click a track's **M** button and hear that part drop out.",
      target: FIRST_HEADER,
      task: { hint: 'Click M on any track', done: () => tl().tracks.some((t) => t.isMuted) },
    },
    {
      title: 'Bring it back',
      body: 'Click **M** again to unmute it. **S** (solo) does the opposite: only soloed tracks play.',
      target: FIRST_HEADER,
      task: { hint: 'Unmute the track', done: () => !tl().tracks.some((t) => t.isMuted) },
    },
    {
      title: 'Swap a sound',
      body: 'Click the instrument name at the top of the panel on the right and pick another, or type to search: *piano*, *choir*, *guitar*, *808*. Click ▶ beside one to hear it first. The part plays the same notes on the new sound.',
      target: instrumentTarget,
      before: showTrackInspector,
      task: { hint: 'Pick a new instrument', begin: () => ({ id: selected()?.id, key: selected()?.instrumentKey }), done: (b) => instrumentOf((b as { id?: string }).id) !== (b as { key?: string }).key },
    },
    {
      title: 'Change the tempo',
      body: 'Drag the tempo slider, use **-** and **+**, or type a new number. The song speeds up or slows down as it plays.',
      target: '[aria-label="Tempo (BPM)"]',
      task: { hint: 'Change the tempo', begin: () => tl().bpm, done: (bpm) => tl().bpm !== bpm },
    },
    {
      title: 'Stop',
      body: 'Press **Space** again to pause.',
      target: '#btn-play',
      task: { hint: 'Press Space', done: () => !tl().isPlaying },
    },
    {
      title: 'Open a clip',
      body: 'Double-click any clip on the timeline. Its notes open in the **piano roll** below.',
      target: '[data-timeline-scroll]',
      task: { hint: 'Double-click a clip', done: () => tl().editingClipId !== null },
    },
    {
      title: 'Write a note',
      body: 'Click an empty spot in the grid to add a note there; it plays as you add it. Drag a note to move it, drag its end to make it longer, right-click it to delete it. (Later, **Type notes** at the top lets you type a whole melody in with your keyboard.)',
      target: '[aria-label="Piano roll"]',
      task: { hint: 'Click in the grid to add a note', begin: noteCount, done: (n) => noteCount() > (n as number) },
    },
    {
      title: 'Undo',
      body: 'Made a mistake? **Ctrl+Z** undoes (Cmd+Z on a Mac), **Ctrl+Shift+Z** redoes. Almost everything can be undone.',
      target: '#btn-undo',
      task: { hint: 'Press Ctrl+Z', begin: noteCount, done: (n) => noteCount() < (n as number) },
    },
    {
      title: 'Close the piano roll',
      body: 'Press **Esc**, or the X at its top right.',
      target: '[aria-label="Piano roll"]',
      task: { hint: 'Press Esc', done: () => tl().editingClipId === null },
    },
    {
      title: 'Export your song',
      body: 'Click **Export**. Under **Export**, pick **Mixdown**; then under **Format**, choose **MP3** for sharing or **WAV** for the best quality, then click **Export** at the bottom of the dialog to save the file.',
      target: dialogOr('export', 'Export audio / video', EXPORT_BUTTON),
      task: { hint: 'Export the file', begin: watchExport, done: (w) => (w as ExportWatch).rendered && useRenderBusy.getState().running === 0 && ui().dialog !== 'export' },
    },
    {
      title: "You've made it!",
      body: 'You can open, play, change, write and export a song. Your work saves itself in this browser; use **Save** to keep a file. Next, try **Make a showcase video** to post your song, or **Shape and mix a song** for effects and arranging.',
    },
  ],
};

const SHOWCASE: Lesson = {
  id: 'showcase',
  level: 'Beginner',
  title: 'Make a showcase video',
  summary: 'Turn your song into a video to post: its notes slide past the playhead, tall for phones, at 60 fps.',
  minutes: 3,
  steps: [
    {
      title: 'Make a showcase video',
      body: 'A showcase video shows how your song is made: every note slides past a red playhead in its track’s colour and lights up as it plays, with your title, the waveform and the time. Made for posting on your socials.',
    },
    {
      title: 'Have a song open',
      body: 'Use a song of your own, or open the **File** menu, click **New…** and pick a starter. Busy, colourful songs look best.',
      target: dialogOr('new', 'New arrangement', NEW_BUTTON),
      task: { hint: 'A song with clips', done: () => tl().clips.length > 0 },
    },
    {
      title: 'Open the showcase export',
      body: 'Open the **File** menu and click **Showcase video (for video sites)…**. Export opens set to a video of the notes playing.',
      target: () => (ui().dialog === 'export' ? EXPORT_DIALOG : '#menu-file'),
      task: { hint: 'File › Showcase video (for video sites)…', done: showcaseOpen },
    },
    {
      title: 'Make it tall',
      body: 'Under the export choices, click **Portrait 9:16** for a phone-shaped video. **Widescreen 16:9** is for video sites and websites.',
      target: `${EXPORT_DIALOG} [role="group"][aria-label="Shape"]`,
      task: { hint: 'Click Portrait 9:16', done: () => pressedIn('Shape').startsWith('Portrait') },
    },
    {
      title: 'Smooth 60 fps',
      body: 'Leave **Smooth 60 fps** on so the notes glide. **30 fps** makes a smaller file, faster.',
      target: `${EXPORT_DIALOG} [role="group"][aria-label="Frame rate"]`,
    },
    {
      title: 'Your title',
      body: 'Type the title people will see, and the line under it (left blank, it shows the tempo). Untick what you don’t want: the section names, the time or the waveform. What you hide gives its room to the notes.',
      target: `${EXPORT_DIALOG} [role="group"][aria-label="Title and marks"]`,
    },
    {
      title: 'Show only what you want',
      body: 'Muted tracks are left out of the picture, so mute a part to hide it. With many tracks, set **Tracks** to **A lane per track** so each part keeps its own band.',
      target: EXPORT_DIALOG,
    },
    {
      title: 'Export it',
      body: 'Click **Export** at the bottom. It’s made faster than real time, and the MP4 lands in your downloads, ready to post. Videos need Chrome or Edge.',
      target: EXPORT_DIALOG,
    },
  ],
};

const SOUNDS: Lesson = {
  id: 'sounds',
  level: 'Beginner',
  title: 'Find and keep your sounds',
  summary: 'Search the instruments, star your favourites, save a sound you made under My sounds and keep them in a file.',
  minutes: 4,
  steps: [
    {
      title: 'Find and keep your sounds',
      body: 'There are more than 200 instruments, from recorded pianos, horns and a choir to synths and 808s. Here’s how to find the right one fast, and keep the sounds you love.',
    },
    {
      title: 'Open the instrument list',
      body: 'Each track plays one instrument. Click the instrument name at the top of the panel on the right to open the list.',
      target: INSTRUMENT_BUTTON,
      before: showTrackInspector,
      task: { hint: 'Click the instrument name', done: instrumentListOpen },
    },
    {
      title: 'Search',
      body: 'Type what you’re after: a name (*sax*), a mood (*dark*, *angelic*) or a style (*8-bit*, *orchestral*). Click ▶ beside one to hear it, then click it to use it.',
      target: instrumentTarget,
      task: { hint: 'Pick an instrument', begin: () => ({ id: selected()?.id, key: selected()?.instrumentKey }), done: (b) => instrumentOf((b as { id?: string }).id) !== (b as { key?: string }).key },
    },
    {
      title: 'Star a favourite',
      body: 'Open the list again and point at an instrument you like: click its ☆ star. Starred instruments are listed first, in every song, in the studio and in Pocket.',
      target: instrumentTarget,
      task: { hint: 'Star an instrument', begin: () => useMySounds.getState().favourites.length, done: (n) => useMySounds.getState().favourites.length > (n as number) },
    },
    {
      title: 'Make it yours',
      body: 'Change the sound: an effect in the FX Rack, the EQ, a synth’s knobs or its reverb. Every setting on this track is part of the sound.',
      target: '#btn-inspector-toggle',
    },
    {
      title: 'Save it to My sounds',
      body: 'Click the bookmark beside the instrument name and give the sound a name. It saves the instrument with all its settings and effects.',
      target: '[aria-label="Save this sound to My sounds"]',
      before: showTrackInspector,
      task: { hint: 'Click the bookmark', begin: () => useMySounds.getState().sounds.length, done: (n) => useMySounds.getState().sounds.length !== (n as number) },
    },
    {
      title: 'Use it anywhere',
      body: 'Your saved sounds sit at the top of every instrument list, under **My sounds**, in any song. Pick one and a track takes the whole sound at once.',
      target: INSTRUMENT_BUTTON,
    },
    {
      title: 'Keep them safe',
      body: 'My sounds and your stars live in this browser. **File › Save my sounds to a file…** keeps them in one file, and **Open a my sounds file…** brings them into another browser or computer.',
      target: '#menu-file',
    },
  ],
};

const INTERMEDIATE: Lesson = {
  id: 'intermediate',
  level: 'Intermediate',
  title: 'Shape and mix a song',
  summary: 'Add instruments, effects, automation, the mixer, markers and a build-up and drop.',
  minutes: 8,
  steps: [
    {
      title: 'Shape and mix a song',
      body: 'This tutorial works on whatever is on your timeline (any starter is fine). You will add an instrument, shape its sound, automate it, mix and arrange.',
    },
    {
      title: 'Add a track',
      body: 'Click **Add Track** under the last track and search for an instrument: try *strings*, *8-bit* or *choir*. Enter picks it (▶ on a row lets you hear one first).',
      target: 'button[title="Add a new instrument track"]',
      task: { hint: 'Add any instrument track', begin: () => tl().tracks.length, done: (n) => tl().tracks.length > (n as number) },
    },
    {
      title: 'Open the FX Rack',
      body: "Click **FX Rack** (or the sliders icon on a track header). It shows the selected track's instrument and effects.",
      target: '#btn-inspector-toggle',
      before: ensureTrack,
      task: { hint: 'Open the FX Rack', done: () => tl().isInspectorOpen },
    },
    {
      title: 'Turn on the Filter',
      body: 'Switch the **Filter** ON, then drag **Cutoff** down to darken the sound and back up to open it.',
      target: '[data-search="Filter"]',
      before: () => {
        ensureTrack();
        tl().toggleInspector(true);
        ui().setInspectorTab('track');
      },
      task: { hint: 'Switch the Filter on', done: () => !!selected()?.fx.filter.on },
    },
    {
      title: 'Make it pump',
      body: 'Switch the **Pump** ON. With its **Trigger** on **Kick**, the track ducks under every kick: the classic sidechain feel of dance music.',
      target: '[data-search="Pump"]',
      task: { hint: 'Switch the Pump on', done: () => !!selected()?.fx.pump.on },
    },
    {
      title: 'Add some space',
      body: 'Raise the **Studio Reverb Send** (under the sends, not the Reverb effect above it). All tracks share one reverb, so a little on each glues the song together.',
      target: '[data-search="sends"]',
      task: { hint: 'Raise the reverb send', begin: () => selected()?.reverbSend ?? 0, done: (v) => (selected()?.reverbSend ?? 0) > (v as number) + 0.04 },
    },
    {
      title: 'Show an automation lane',
      body: "Automation changes a setting over time. Click the curve button on a track header to show that track's lane.",
      target: FIRST_HEADER,
      task: { hint: 'Click the curve button', done: () => Object.values(tl().automationView).some((v) => v?.open) },
    },
    {
      title: 'Draw automation',
      body: 'Pick a setting at the left of the lane (Volume, Filter Cutoff...), then click in the lane to add points. The line between them is how the setting moves while the song plays.',
      target: '[data-automation-lane]',
      task: { hint: 'Click in the lane to add a point', begin: pointCount, done: (n) => pointCount() > (n as number) },
    },
    {
      title: 'Open the Mixer',
      body: 'Click the **Mixer** tab under the timeline to see every track side by side with level meters. Balance them by ear.',
      target: () => (ui().dockOpen && ui().dockTab === 'mixer' ? '[role="region"][aria-label="Mixer"]' : '#btn-mixer'),
      task: { hint: 'Open the Mixer tab', done: () => ui().dockOpen && ui().dockTab === 'mixer' },
    },
    {
      title: 'Mark a section',
      body: 'Move the playhead (click the ruler) and press **M** to drop a marker there. Double-click a marker flag to rename it; **,** and **.** jump between markers.',
      target: RULER,
      task: { hint: 'Press M to add a marker', begin: () => tl().markers.length, done: (n) => tl().markers.length > (n as number) },
    },
    {
      title: 'Build-up and drop',
      body: 'Right-click the ruler on the bar where a drop should land and choose **Build-up & drop here**: a riser, a snare roll and a hit, in one step.',
      target: RULER,
      task: { hint: 'Right-click the ruler: Build-up & drop', begin: () => tl().clips.length, done: (n) => tl().clips.length >= (n as number) + 2 },
    },
    {
      title: 'Set the loop',
      body: 'Drag the **In** and **Out** brackets on the ruler (or press **I** and **O** at the playhead) and switch the loop on with **L**, to work on one part over and over.',
      target: RULER,
      task: {
        hint: 'Move the loop or turn it on',
        begin: () => JSON.stringify(tl().loopRegion),
        done: (l) => JSON.stringify(tl().loopRegion) !== l,
      },
    },
    {
      title: 'Save a copy',
      body: 'Your work autosaves in this browser, but a file is safer. **Save** writes a project file with its sounds (the first time, you choose where; in some browsers it goes to your downloads); **File › Open…** (or dropping the file on the page) loads it on any computer.',
      target: '#btn-save-project',
    },
    {
      title: 'Nicely done!',
      body: 'You can arrange, shape, automate and mix. The **Pro techniques** tutorial covers sound design, sidechains, key changes, freezing and game-ready exports.',
    },
  ],
};

const EXPERT: Lesson = {
  id: 'expert',
  level: 'Expert',
  title: 'Pro techniques',
  summary: 'Search, sound design, sidechains, the Gate, key changes, freezing and game-music exports.',
  minutes: 10,
  steps: [
    {
      title: 'Pro techniques',
      body: 'Faster ways to work and the deeper tools: designing sounds, sidechaining, rhythmic effects, key changes, freezing, and exporting music a game can loop.',
    },
    {
      title: 'Search everything',
      body: `Press **${PALETTE_SHORTCUT}** from anywhere. It finds tools, settings, instruments, starters and guide pages, and takes you straight there.`,
      target: 'button[title^="Search tools"]',
      task: { hint: `Press ${PALETTE_SHORTCUT}`, done: () => ui().paletteOpen },
    },
    {
      title: 'Design a synth',
      body: 'Type **synth designer** and press Enter. It adds a Synth Designer track and opens its panel.',
      target: '[role="dialog"][aria-label="Search"]',
      task: {
        hint: 'Search: synth designer',
        begin: () => tl().tracks.filter((t) => t.instrumentKey === 'synthDesigner').length,
        done: (n) => tl().tracks.filter((t) => t.instrumentKey === 'synthDesigner').length > (n as number) || selected()?.instrumentKey === 'synthDesigner',
      },
    },
    {
      title: 'Start from a preset',
      body: 'Choose a sound from **Load preset…**, then shape it: two oscillators with unison, a filter with its own envelope, an amp envelope and a tempo-synced LFO.',
      target: '[aria-label="Synth Designer"]',
      task: { hint: 'Load a preset or move a knob', begin: () => JSON.stringify(selected()?.synth ?? null), done: (s) => JSON.stringify(selected()?.synth ?? null) !== s },
    },
    {
      title: 'Sidechain from any track',
      body: 'On the **Pump**, set **Trigger** to **Track** and pick which track it **Follows**: the pad can duck under the bass, or the chords under a lead. The followed track can even be muted, as a silent trigger.',
      target: '[data-search="Pump"]',
      before: () => {
        ensureTrack();
        tl().toggleInspector(true);
        ui().setInspectorTab('track');
      },
      task: { hint: 'Pump: follow a track', done: () => tl().tracks.some((t) => t.fx.pump.on && t.fx.pump.trigger === 'track') },
    },
    {
      title: 'Chop it with the Gate',
      body: 'Switch the **Gate** ON on a held pad or chord: it chops the sound in time with the song. Try **1/16**, then **1/16T** for triplet stutters before a drop.',
      target: '[data-search="Gate"]',
      task: { hint: 'Switch the Gate on', done: () => tl().tracks.some((t) => t.fx.gate.on) },
    },
    {
      title: 'Key change',
      body: 'Right-click the ruler where the last chorus starts and choose **Key change here: up a whole step**. Pitched notes from there on move up; drums stay put.',
      target: RULER,
      task: { hint: 'Right-click the ruler: Key change', begin: pitches, done: (p) => pitches() !== p },
    },
    {
      title: 'Freeze a heavy track',
      body: "Click a track's snowflake to **freeze** it: it's rendered to audio so playback needs less of the computer. Change anything on it and it plays live again until you freeze it once more.",
      target: 'button[aria-label^="Freeze "]',
      task: { hint: 'Freeze any track', done: () => tl().tracks.some((t) => !!t.frozen) },
    },
    {
      title: 'Hear it like a game',
      body: 'The **Game** tab plays your marker sections as game states that switch on the next bar or beat, with layers you can bring in and an Intensity slider.',
      target: () => (ui().dockOpen && ui().dockTab === 'game' ? '[aria-label="Game preview"]' : '#btn-game'),
      task: { hint: 'Open the Game tab', done: () => ui().dockOpen && ui().dockTab === 'game' },
    },
    {
      title: 'Export for a game',
      body: 'In **Export**, the **Intro + loop** range renders an intro and a seamless loop with loop points a game engine reads, and **Layers** exports each track for adaptive music. (Move the loop’s In past bar 1 first: everything before it is the intro. With **Intro + loop** chosen, **Stems** becomes **Layers**.)',
      target: dialogOr('export', 'Export audio / video', EXPORT_BUTTON),
      task: { hint: 'Open Export', done: () => ui().dialog === 'export' },
    },
    {
      title: 'Work faster',
      body: '**J** / **K** / **Shift+L**: back a bar, play/pause, forward a bar. **V** and **C**: select and razor tools. **Ctrl+D** duplicates the selected clips; **Alt**-drag copies one. **+** / **-** zoom. **Shift+P** opens the plugin browser, **Shift+F** the FX Rack, **Shift+X** the Mixer, **Shift+A** the spectrum analyser and **Shift+T** the tuner. In the piano roll, **SCALE**, **CHORD** and **TOOLS** (arpeggiate, strum, ratchet, roll) do the busy work.',
    },
    {
      title: 'Score to picture, play live',
      body: 'The **Video** tab loads gameplay or a trailer that plays in sync with the playhead; video export can put your music on it. **Mic** records your voice or an instrument, and the MIDI button connects a keyboard or turns the computer keyboard into one.',
      target: '#btn-video-tools',
    },
    {
      title: "You're a pro",
      body: 'That is the whole toolbox. The **GUIDE** goes deeper on every part, and **SEARCH** takes you to anything in a couple of keystrokes. Have fun!',
    },
  ],
};


/** Clips on the timeline, by id (a variation, a chord clip and an accompaniment each add one). */
const newClip = (before: unknown) => tl().clips.some((c) => !(before as Set<string>).has(c.id));
/** A song with sections is open: at least two markers, so two states to switch between. */
const gameSongOpen = () => tl().markers.filter((m) => m.anchor !== 'time').length >= 2;
const inGameTab = () => ui().dockOpen && ui().dockTab === 'game';
const GAME_TAB = () => (inGameTab() ? '[aria-label="Game preview"]' : '#btn-game');
const gameTarget = (part: string) => () => (inGameTab() ? `[data-game="${part}"]` : '#btn-game');
const auditionOpen = () => !!document.querySelector('[role="dialog"][aria-label="Audition like the game"]');

const HELPERS: Lesson = {
  id: 'helpers',
  level: 'Intermediate',
  title: 'Write with the helpers',
  summary: 'Chords in a key, chords for frisson (the shiver you get from music), an accompaniment for them, a drummer, a melody turned another way, and a swing for one clip.',
  minutes: 7,
  steps: [
    {
      title: 'Write with the helpers',
      body: 'The app can write the busy parts for you: chords in a key, a part that follows them, a drum beat in any style, and new versions of a tune. You choose; it does the notes. Everything here is one undo step.',
    },
    {
      title: 'Chords in a key',
      body: 'Right-click an empty spot on a pitched track (a piano, strings, a pad) and choose **Chord progression…**. Pick one: *level clear*, *hero’s journey*, *wonder* and *castle* are game moods. Then **Make clip**.',
      target: '[data-timeline-scroll]',
      before: ensureTrack,
      task: { hint: 'Right-click a lane, Chord progression…', begin: clipIds, done: newClip },
    },
    {
      title: 'Chords for frisson',
      body: 'Right-click an empty spot on a synth or pad track and choose **Frisson tool…**: frisson is the shiver you get from music, and these chord moves give listeners that shiver at a peak, such as *the minor iv*, *almost home, then somewhere else* or *up a whole step for the last time through*, each with a line on why it works. Later, select the clips before your peak, right-click and choose **Build into a peak…**: the parts swell back to their level and a filter opens, in lanes you can change; a riser and a pad at the peak come on new tracks, set under the music by measuring it, and nothing already there is turned up past where it was.',
      target: '[data-timeline-scroll]',
      task: { hint: 'Right-click a lane, Frisson tool…', begin: clipIds, done: newClip },
    },
    {
      title: 'An accompaniment',
      body: 'Right-click the chord clip and choose **Accompaniment for these chords…**: a walking bass, an oom-pah-pah, an Alberti bass, a strummed guitar, a harp glissando, a string ostinato and more, each on its own new track, following every chord change.',
      target: '[data-timeline-scroll]',
      task: { hint: 'Right-click the chords, Accompaniment…', begin: () => tl().tracks.length, done: (n) => tl().tracks.length > (n as number) },
    },
    {
      title: 'A drummer',
      body: 'Add a drum kit track (**Add Track**, type *kit*), then right-click its lane and choose **Drummer…**: 22 styles from four-on-the-floor to a waltz, a march, a bossa nova or a blast beat, with fills every few bars. For a waltz, leave the time-signature box ticked to set 3/4 there.',
      target: '[data-timeline-scroll]',
      task: { hint: 'A kit track, then Drummer…', begin: clipIds, done: (b) => tl().clips.some((c) => !(b as Set<string>).has(c.id) && tl().tracks.find((t) => t.id === c.trackId && isDrumKind(t.instrumentKey))) },
    },
    {
      title: 'A melody, another way',
      body: 'Right-click a clip with a tune in it (the chords work too) and choose **Melody variations…**. Try **Answer phrase** (call and response), **Darker**, **Brighter** or **Harmony a third above**. Everything stays in the song’s key, which you can change there.',
      target: '[data-timeline-scroll]',
      task: { hint: 'Right-click a clip, Melody variations…', begin: () => ({ ids: clipIds(), notes: pitches() }), done: (b) => newClip((b as { ids: Set<string> }).ids) || pitches() !== (b as { notes: string }).notes },
    },
    {
      title: 'A swing of its own',
      body: 'Double-click a clip and set **FEEL** in the piano roll: light or hard swing, a triplet shuffle, in 8ths or 16ths. Only that clip swings, so a jazzy part can sit on a straight beat.',
      target: () => (tl().editingClipId ? '[data-search="swing feel groove shuffle"]' : '[data-timeline-scroll]'),
      task: { hint: 'Open a clip, set FEEL', done: () => tl().clips.some((c) => !!c.groove) },
    },
    {
      title: 'That is the toolbox',
      body: 'Right-click is where the helpers live: **Chords for this melody**, **Bass line from these chords**, **Fill** on a drum clip, and the ones you just used. The piano roll’s **SCALE** and **TOOLS** do the rest.',
    },
  ],
};

const GAME_MUSIC: Lesson = {
  id: 'game-music',
  level: 'Intermediate',
  title: 'Game music that reacts',
  summary: 'States a game switches between, how one hands over to the next, a bridge written into a state, and hearing it like the game.',
  minutes: 6,
  steps: [
    {
      title: 'Game music that reacts',
      body: 'Game music is made of **states** (explore, danger, boss...) that loop until the game switches, and **transitions** that hand one over to the next on the beat. Here you’ll set them up and hear them the way the game will.',
    },
    {
      title: 'A song with sections',
      body: 'Each section of a song (from one marker to the next) is a state. Use a song of your own with two or more markers (press **M** where a section starts), or open **File › New…** and pick a starter: *Celtic* has four sections (Intro, Reel, Whistle, Pipes). (A starter replaces the current timeline.)',
      target: () => (gameSongOpen() ? null : dialogOr('new', 'New arrangement', NEW_BUTTON)()),
      task: { hint: 'Two or more sections', done: gameSongOpen },
    },
    {
      title: 'The Game tab',
      body: 'Open the **Game** tab in the bottom panel.',
      target: GAME_TAB,
      task: { hint: 'Click Game', done: inGameTab },
    },
    {
      title: 'Switch states',
      body: 'Click a state’s pad. The music switches on the next bar (or as its transition says), the way the game will when the player walks into danger.',
      target: gameTarget('states'),
      task: { hint: 'Click a state', begin: () => JSON.stringify(tl().loopRegion), done: (l) => JSON.stringify(tl().loopRegion) !== l },
    },
    {
      title: 'The transition matrix',
      body: 'Open **Transitions**: a row for the state you come from, a column for the one you go to. Each cell is a rule: a cut, a fill, a riser, an impact (hit), a crossfade, a stinger or a bridge.',
      target: gameTarget('transitions'),
      task: { hint: 'Open Transitions', done: () => !!document.querySelector('[data-game="transitions"] details[open]') },
    },
    {
      title: 'Write a bridge',
      body: 'Click a cell and choose **Bridge**: a bar written from your song to lead into that state (the chord that pulls into its first chord, the bass stepping in, a drum fill). **2 bars** turns through one more chord first.',
      target: gameTarget('transitions'),
      task: { hint: 'A cell, then Bridge', done: () => Object.values(tl().transitions).some((r) => r.kind === 'bridge') },
    },
    {
      title: 'When it switches',
      body: 'Set **When** to **on the next phrase** (every 2, 4 or 8 bars from the state’s start) or **at the end of the loop**, so the music turns where a phrase does instead of mid-sentence.',
      target: gameTarget('transitions'),
      task: { hint: 'When: phrase or end of the loop', done: () => Object.values(tl().transitions).some((r) => r.quantize === 'phrase' || r.quantize === 'end') },
    },
    {
      title: 'Hear it like the game',
      body: '**Audition like the game** renders the states exactly as the game kit exports them and plays them with the kit’s own player: pads for the states and stingers, and every rule as you set it, bridges and crossfades included.',
      target: () => (auditionOpen() ? '[role="dialog"][aria-label="Audition like the game"]' : gameTarget('export')()),
      task: { hint: 'Click Audition like the game', done: auditionOpen },
    },
    {
      title: 'Switch and listen',
      body: 'Click a state pad to start, then the one your bridge goes to. It waits for its line (the pad pulses), plays the bridge and lands on the new state’s downbeat. Close the audition when you’re done.',
      target: () => (auditionOpen() ? '[role="dialog"][aria-label="Audition like the game"]' : null),
      task: { hint: 'Close the audition', done: () => !auditionOpen() },
    },
    {
      title: 'Ready for the game',
      body: '**Export game kit** (in this tab) exports it all for Godot, Unity or the web: every state as a seamless loop, the bridges and stingers, and a player that follows your rules. The **Make it react** tutorial makes the music react to what the player does.',
    },
  ],
};

const GAME_REACT: Lesson = {
  id: 'game-react',
  level: 'Expert',
  title: 'Make it react',
  summary: 'Parameters the game sets, costumes that dress the same music another way, shuffled pieces and silences, effects, and a little game to try it in.',
  minutes: 7,
  steps: [
    {
      title: 'Make it react',
      body: 'A game’s music follows more than its states: how close the enemy is, how much health is left, where the player is. Here you’ll set that up without the game needing to know how the music is mixed.',
    },
    {
      title: 'A song with sections',
      body: 'This uses a song with two or more sections, each a state. If yours has none, add markers (**M**) where sections start, or open **File › New…** and pick a starter: *Celtic* has four.',
      target: () => (gameSongOpen() ? null : dialogOr('new', 'New arrangement', NEW_BUTTON)()),
      task: { hint: 'Two or more sections', done: gameSongOpen },
    },
    {
      title: 'The Game tab',
      body: 'Open the **Game** tab in the bottom panel.',
      target: GAME_TAB,
      task: { hint: 'Click Game', done: inGameTab },
    },
    {
      title: 'A parameter',
      body: 'Under **Parameters**, pick **danger** and **Add parameter**: one number from the game (0 to 1) that raises the intensity and opens up the sound as enemies close in. The game calls `setParameter("danger", 0.7)`; the music does the rest.',
      target: gameTarget('parameters'),
      task: { hint: 'Add a parameter', begin: () => tl().gameParams.length, done: (n) => tl().gameParams.length > (n as number) },
    },
    {
      title: 'Shape what it moves',
      body: 'Each line is one thing it moves (the intensity, a filter, the reverb, the volume, one layer), from what to what, over which part of the parameter. Change a number, or add one with **move something else…**: health muffling the music below half is a classic.',
      target: gameTarget('parameters'),
      task: { hint: 'Change or add a line', begin: () => JSON.stringify(tl().gameParams.map((p) => p.targets)), done: (was) => JSON.stringify(tl().gameParams.map((p) => p.targets)) !== was },
    },
    {
      title: 'A costume',
      body: 'Under **Costumes**, add **8-bit** (or a music box, night, a hurry-up): the same music played another way, lined up so the game can swap it mid-loop and the tune carries on. Change any track’s instrument in it, or leave a track out.',
      target: gameTarget('costumes'),
      task: { hint: 'Add a costume', begin: () => tl().costumes.length, done: (n) => tl().costumes.length > (n as number) },
    },
    {
      title: 'How each state plays',
      body: 'Under **How each state plays**, shuffle a state’s 4-bar pieces (a long stay never sounds the same) or leave silences between plays (music that comes and goes, so it still means something when it returns).',
      target: gameTarget('state-options'),
      task: { hint: 'Shuffle or a silence', done: () => Object.keys(tl().stateOptions).length > 0 },
    },
    {
      title: 'Hear it all',
      body: 'Open **Audition like the game**. Under the state pads: **Costume** and **Effect** pads (underwater, muffled, low health, dream) and a slider for each parameter. Start a state and move them.',
      target: () => (auditionOpen() ? '[role="dialog"][aria-label="Audition like the game"]' : gameTarget('export')()),
      task: { hint: 'Open the audition', done: auditionOpen },
    },
    {
      title: 'Close it',
      body: 'Close the audition when you’ve heard enough.',
      target: () => (auditionOpen() ? '[role="dialog"][aria-label="Audition like the game"]' : null),
      task: { hint: 'Close the audition', done: () => !auditionOpen() },
    },
    {
      title: 'Try it in a game',
      body: '**Try it in a game** drops your song into a little game: in the **3D arena** or the **2D platformer**, get close to the guard (or a blob) and the music switches to the chase and builds; a parameter called **danger** follows it, one called **health** follows your hearts. The **Rhythm game** turns your song’s own notes into a chart to play. Esc closes it.',
      target: () => (ui().dialog === 'tryOut' ? null : gameTarget('export')()),
      task: { hint: 'Click Try it in a game (or Game › Try it in a game…)', done: () => ui().dialog === 'tryOut' },
    },
    {
      title: 'Ship it',
      body: 'The **Game kit** carries all of it: the parameters, the costumes, the shuffled pieces and silences, and players for Godot, Unity and the web that do the same sums you just heard. Its README lists each one with the line of code that calls it.',
      target: () => (ui().dialog === 'tryOut' ? null : gameTarget('export')()),
    },
  ],
};

/** Every clip's mod wheel lane, so a swell drawn over one already there shows as a change */
const modLanes = () => JSON.stringify(tl().clips.map((c) => c.expression?.mod ?? null));
const vibratoPoints = () => tl().clips.reduce((n, c) => n + (c.expression?.vibrato?.length ?? 0), 0);
const CONTROLLER_LANE = '[aria-label="Controller lane"]';
const inEditor = (selector: string) => () => (tl().editingClipId ? selector : '[data-timeline-scroll]');

const EXPRESSIVE: Lesson = {
  id: 'expressive',
  level: 'Intermediate',
  title: 'Make it expressive',
  summary: 'Swells and the mod wheel for dynamics, vibrato, a tempo that breathes, and a passage played backwards.',
  minutes: 5,
  steps: [
    {
      title: 'Make it expressive',
      body: 'Real players never hold a note flat: they swell into it, let it sing, and ease the tempo at the end of a phrase. These tools do that for you. Strings, a pad, a choir or brass show it best; every step is one undo.',
    },
    {
      title: 'Open a clip',
      body: 'Double-click a clip of held notes (strings or a pad are ideal) to open it in the piano roll.',
      target: '[data-timeline-scroll]',
      before: ensureTrack,
      task: { hint: 'Double-click a clip', done: () => !!tl().editingClipId },
    },
    {
      title: 'Swell',
      body: 'Open **TOOLS** and choose **Swell**: every phrase grows and fades again, the way a bow or a breath does. **Crescendo** only grows; **Diminuendo** only fades. Play it to hear the difference.',
      target: inEditor('[data-search="tools"]'),
      task: { hint: 'TOOLS › Swell', begin: modLanes, done: (m) => modLanes() !== m },
    },
    {
      title: 'The mod wheel is dynamics',
      body: 'The swell is drawn in the **Mod wheel (dynamics)** lane under the notes. Up is loud and bright, down is soft and dark, on every instrument (the strings, brass and winds change between their soft and loud recordings). Drag a point to reshape it, or click to add one. A MIDI keyboard’s wheel does the same live.',
      target: inEditor(CONTROLLER_LANE),
    },
    {
      title: 'Vibrato',
      body: 'Pick **Vibrato** in the lane’s menu and draw a few points rising toward the end of a long note: a singer’s or violinist’s vibrato usually blooms late, not from the start.',
      target: inEditor(CONTROLLER_LANE),
      task: { hint: 'Vibrato lane: draw a point', begin: vibratoPoints, done: (n) => vibratoPoints() > (n as number) },
    },
    {
      title: 'Let it breathe',
      body: 'Close the piano roll and open the **Song** menu: **Breathe** eases the tempo back into the end of every phrase and picks it up again after, and slows into the last phrase, as a pianist playing rubato does. With the loop on it breathes only the loop; press **L** to turn the loop off for the whole song.',
      target: '#menu-song',
      task: { hint: 'Song › Breathe', begin: () => tl().tempoPoints.length, done: (n) => tl().tempoPoints.length > (n as number) },
    },
    {
      title: 'Play it backwards',
      body: 'Right-click a clip and choose **Play backwards**: it turns into audio played in reverse, notes fading in with their reverb before them. **Song › Play bars … backwards** does a whole passage between the loop’s In and Out. Undo brings the music back.',
      target: '[data-timeline-scroll]',
      task: { hint: 'Right-click a clip, Play backwards', done: () => tl().clips.some((c) => !!c.audio?.reversedFrom) },
    },
    {
      title: 'Expressive!',
      body: 'Also worth a try: overlap two string notes a little and the second slides in without a new bow stroke (legato, with a small slide between the notes), and **Use a recorded room…** (the FX Rack’s **Master** tab) puts the whole song in a real hall.',
    },
  ],
};

// --- Fledgetone's own plugins ---

const PLUGIN_BROWSER = '[role="dialog"][aria-label="Plugins"]';
const PLUGIN_WINDOW = '[data-plugin-window]';
const PLUGINS_MENU = '#menu-plugins';
/** The built-in effects of a family (as in the catalog: 'fledge-carve') on any track */
const effectsOf = (family: string) => tl().tracks.flatMap((t) => (t.pluginFx ?? []).filter((p) => p.url.startsWith(`builtin:${family}/`)));
/** Their settings, as a fingerprint: a preset chosen or a slider moved shows as a change */
const settingsOf = (family: string) => JSON.stringify(effectsOf(family).map((p) => [p.state, p.sidechain ?? '']));
/** "Add this effect": done when there's one more of the family than when the step began */
const addEffect = (family: string, hint: string) => ({ hint, begin: () => effectsOf(family).length, done: (n: unknown) => effectsOf(family).length > (n as number) });
/** "Change it": done when the family's settings differ from when the step began */
const changeEffect = (family: string, hint: string) => ({ hint, begin: () => settingsOf(family), done: (was: unknown) => settingsOf(family) !== was });
/** The plugin browser if it's open, else the Plugins menu */
const browserOrMenu = () => (ui().pluginBrowser ? PLUGIN_BROWSER : PLUGINS_MENU);
/** A plugin's window if one is open, else the Plugins menu (which lists the selected track's plugins to open) */
const windowOrMenu = () => (document.querySelector(PLUGIN_WINDOW) ? PLUGIN_WINDOW : PLUGINS_MENU);
const SONG_STEP: LessonStep = {
  title: 'Have a song open',
  body: 'Use a song of your own, or open the **File** menu, click **New…** and pick a starter: one with drums, a bass and chords or a pad works best here. Then press **Space** to play it for a moment, so the sound is on: a plugin takes a preset only once the audio is running.',
  target: dialogOr('new', 'New arrangement', NEW_BUTTON),
  task: { hint: 'A song with three tracks, and the sound on', done: () => tl().clips.length > 0 && tl().tracks.length >= 3 && useAudioStore.getState().audioState === 'running' },
};
const BROWSE = toolShortcutLabel('plugins');

const MIX_ROOM: Lesson = {
  id: 'mix-room',
  level: 'Intermediate',
  title: 'Make room in a mix',
  summary: 'Fledge Carve gives a vocal or a kick room without the other parts pumping, and Fledge Smooth tames what rings out.',
  minutes: 6,
  steps: [
    {
      title: 'Make room in a mix',
      body: 'When two parts fight for the same frequencies, one hides the other. You could turn the pad down, or duck it with a sidechain, but both take away all of it. **Fledge Carve** takes away only the frequencies the other part is using, only while it plays. Then **Fledge Smooth** tames the frequencies that ring out over the rest.',
    },
    SONG_STEP,
    {
      title: 'Open the plugin browser',
      body: `Click the track that is **in the way** (a pad, chords, guitars: the part that should give way), then press **${BROWSE}**, or open **Plugins › Browse plugins…**.`,
      target: browserOrMenu,
      before: ensureTrack,
      task: { hint: `Press ${BROWSE}`, done: () => !!ui().pluginBrowser },
    },
    {
      title: 'Add Fledge Carve',
      body: 'Type **carve** in the search box. **Effects go on** shows the track it will be added to: change it there if you like. Click **Add**. Its window opens.',
      target: browserOrMenu,
      task: addEffect('fledge-carve', 'Add Fledge Carve to a track'),
    },
    {
      title: 'Tell it who needs the room',
      body: 'At the top of its window, beside **Sidechain from**, pick the track that should be heard: the lead, the vocal, or the kick. Until you pick one, Carve does nothing.',
      target: windowOrMenu,
      task: { hint: 'Pick a track beside Sidechain from', done: () => effectsOf('fledge-carve').some((p) => !!p.sidechain) },
    },
    {
      title: 'How much, and how to hear it',
      body: 'Press **Space** to play. **Amount** is the most any band is turned down: 6 to 9 dB is plenty in a mix. Switch **Removed only** on and you hear just what it takes out: it should sound like a faint shadow of the other track. Switch it off again. Try a **Preset** too: **Room for a vocal**, **Bass under the kick**.',
      target: windowOrMenu,
      task: changeEffect('fledge-carve', 'Move Amount, or choose a preset'),
    },
    {
      title: 'Add Fledge Smooth',
      body: `Now a part that sounds harsh, or a bass with one booming note. Click its track, press **${BROWSE}**, search **smooth** and click **Add**.`,
      target: browserOrMenu,
      task: addEffect('fledge-smooth', 'Add Fledge Smooth to a track'),
    },
    {
      title: 'Only what stands out',
      body: 'Smooth listens in 28 narrow bands and turns a band down only while it rings out over its neighbours. **Depth** is how much. **Stands out by** is how far over the others a band must be before it is touched: lower catches more. **From** and **To** keep it to a range. Use **Removed only** here too: turn the Depth up until you hear the music itself in what is removed, then back off.',
      target: windowOrMenu,
      task: changeEffect('fledge-smooth', 'Move Depth, or choose a preset'),
    },
    {
      title: 'See it',
      body: `Press **${toolShortcutLabel('analyser')}** for the **Spectrum analyser** (the audio has to be running: press Play once). Pick a track beside **Show**, and another beside **Against**: where the two lines are loud in the same place, they are fighting. That is where Carve works.`,
      target: () => (ui().analyserOpen ? '[data-floating-window][aria-label="Spectrum analyser"]' : '#menu-tools'),
      task: { hint: `Press ${toolShortcutLabel('analyser')}`, done: () => ui().analyserOpen },
    },
    {
      title: 'Room made',
      body: 'Neither plugin adds any delay, so the track stays in time. One thing to know: if you **solo** the track with Carve on it, solo the track it listens to as well, or there is nothing for it to follow. The **GUIDE** has more under Plugins.',
    },
  ],
};

const RHYTHM_FX: Lesson = {
  id: 'rhythm-fx',
  level: 'Intermediate',
  title: 'Pump, gate and stutter in time',
  summary: 'Fledge Shape moves the volume, a filter or the pan to a shape on the beat; Fledge Repeat stutters and rolls.',
  minutes: 6,
  steps: [
    {
      title: 'Pump, gate and stutter in time',
      body: 'Two plugins that follow the song. **Fledge Shape** repeats a shape on the beat and moves the volume, a filter or the pan with it: a pump with no kick needed, a trance gate, a sweep every bar. **Fledge Repeat** catches a slice of sound and plays it again and again: a stutter, a roll into the next bar.',
    },
    SONG_STEP,
    {
      title: 'Add Fledge Shape',
      body: `Click a track that holds long notes (a pad or chords). Press **${BROWSE}**, search **shape** and click **Add**.`,
      target: browserOrMenu,
      before: ensureTrack,
      task: addEffect('fledge-shape', 'Add Fledge Shape to a track'),
    },
    {
      title: 'A pump, then a gate',
      body: 'Press **Space**. It starts on a **Duck** every quarter note: the pump of a sidechained kick. Now open **Preset** and choose **Trance gate**: sixteen steps that chop the pad into a rhythm. **Chop in 16ths** is the plain version.',
      target: windowOrMenu,
      task: changeEffect('fledge-shape', 'Choose a preset'),
    },
    {
      title: 'Make it yours',
      body: '**Shape** is the curve, **Every** how often it repeats (4 bars down to a 32nd, with triplets), **Depth** how far it goes. **Smooth** rounds the corners. **Starts at** slides the shape along the beat: at 50 % a pump lands on the off-beat.',
      target: windowOrMenu,
      task: changeEffect('fledge-shape', 'Move Every, Depth or Starts at'),
    },
    {
      title: 'Not just volume',
      body: 'Set **Moves** to **Low-pass** and the Shape to **Fall**, every **1 bar**: a filter sweep on every bar. **Pan** with a **Triangle** swings the sound from side to side. It moves one thing at a time, so for a pump and a sweep together, add Shape twice.',
      target: windowOrMenu,
      task: changeEffect('fledge-shape', 'Set Moves to Low-pass or Pan'),
    },
    {
      title: 'Add Fledge Repeat',
      body: `Click the drums (or anything with a rhythm), press **${BROWSE}**, search **repeat** and click **Add**.`,
      target: browserOrMenu,
      task: addEffect('fledge-repeat', 'Add Fledge Repeat to a track'),
    },
    {
      title: 'A fill by itself',
      body: 'Choose the preset **Fill before every 4th bar** and play: the last beat of every fourth bar repeats in 16ths. **Every** and **For** set when and how long, **Slice** how short the repeated piece is, and **Pitch** makes each repeat climb or fall.',
      target: windowOrMenu,
      task: changeEffect('fledge-repeat', 'Choose a preset'),
    },
    {
      title: 'A stutter where you want it',
      body: 'For a stutter at one exact spot, give the **Repeat** switch an automation lane: click the curve button on the track header, pick **Repeat** from the lane list, and draw it on where the stutter should be. Both plugins land on the same beats every time, live and in an export.',
    },
    {
      title: 'In time',
      body: 'That is rhythm from effects alone. The older **Pump** and **Gate** in the FX Rack still do the simple jobs with one switch; Shape and Repeat are for when you want the shape, the rate and the place to be yours.',
    },
  ],
};

const PRO_MIX: Lesson = {
  id: 'pro-mix',
  level: 'Expert',
  title: 'Dynamic EQ, mid/side and saturation',
  summary: 'Bands that move with the sound, the centre and the sides treated apart, and distortion in three bands.',
  minutes: 9,
  steps: [
    {
      title: 'Dynamic EQ, mid/side and saturation',
      body: 'Three ideas from mastering studios. An EQ band that turns only **while** its range is loud. An EQ that treats the **middle** of the stereo picture and its **sides** apart. And distortion given to the lows, mids and highs **separately**, so warming the bass does not make the top crackle.',
    },
    SONG_STEP,
    {
      title: 'Add Fledge Dynamic EQ',
      body: `Click a vocal, a lead or a bright synth. Press **${BROWSE}**, search **dynamic** and click **Add**. Its window is long: four bands, six sliders each.`,
      target: browserOrMenu,
      before: ensureTrack,
      task: addEffect('fledge-eq', 'Add Fledge Dynamic EQ to a track'),
    },
    {
      title: 'A band that moves',
      body: 'Choose the preset **De-ess**. Band 4 sits at 6.5 kHz with a **gain** of 0: it does nothing until that range gets loud. Then **moves by** (-10 dB) turns it down, and it eases back as the "s" passes. **Threshold** is how loud the range must be to start. A band listens only to its own range, so a loud bass note never sets it off.',
      target: windowOrMenu,
      task: changeEffect('fledge-eq', 'Choose the De-ess preset'),
    },
    {
      title: 'The middle and the sides',
      body: 'Each band **works on** both sides (**Stereo**), the **Mid** (what the two speakers share: the centre) or the **Side** (where they differ: the width). Choose the preset **Bass in the middle**: a deep cut at 70 Hz on the Side only, so the low end sits in the centre where small speakers and vinyl want it. **Wider top** does the opposite at 10 kHz.',
      target: windowOrMenu,
      task: changeEffect('fledge-eq', 'Choose Bass in the middle, or change a band’s “works on”'),
    },
    {
      title: 'Up, not only down',
      body: 'A positive **moves by** opens a band as the part is played harder: try **The centre forward as it’s sung**. The drawn **Pro EQ** in the FX Rack is still the one for fixed curves; this is for what a fixed curve cannot do.',
      target: windowOrMenu,
    },
    {
      title: 'Add Fledge Heat',
      body: `Click the bass or the drums. Press **${BROWSE}**, search **heat** and click **Add**. A fresh one does nothing: every band starts **Clean**.`,
      target: browserOrMenu,
      task: addEffect('fledge-heat', 'Add Fledge Heat to a track'),
    },
    {
      title: 'A style for each band',
      body: 'Set **Low style** to **Tube** and bring up **Low drive**: the bass grows harmonics a phone speaker can play, and the top stays clean. The styles run from **Soft** and **Warm** through **Hard** and **Fold** (buzzy) to **Bias** and **Tube** (lopsided, like a valve). **Low / mid** and **Mid / high** set where the bands meet.',
      target: windowOrMenu,
      task: changeEffect('fledge-heat', 'Pick a style for a band, or a preset'),
    },
    {
      title: 'Drive is not volume',
      body: 'On a loud sound, more drive is more grit at the same level, so you can sweep it and judge the tone. A quiet sound comes up with the drive, as through any saturator: trim it with that band’s **level**, which works on a Clean band too. **Mix** blends the result with the clean sound.',
      target: windowOrMenu,
    },
    {
      title: 'Check your work',
      body: `Two windows help. **${toolShortcutLabel('analyser')}** opens the **Spectrum analyser** (with **Hold peaks** to keep the highest each frequency has reached). **${toolShortcutLabel('mixer')}** shows or hides the **Mixer**, and **${toolShortcutLabel('fxRack')}** the **FX Rack**. Each plugin window has **Bypass**: the honest test is whether it sounds better on than off at the same loudness.`,
      target: '#menu-tools',
    },
    {
      title: 'Mastering moves',
      body: 'All of these stay in time (no added delay), sound the same live and in an export, and can be automated like any slider. The **GUIDE** lists every setting under Plugins.',
    },
  ],
};

const SOUND_LAB: Lesson = {
  id: 'sound-lab',
  level: 'Expert',
  title: 'Sound design lab',
  summary: 'Draw a wave from sine waves, make a synth talk, add harmony voices, shift frequencies and freeze a sound.',
  minutes: 12,
  steps: [
    {
      title: 'Sound design lab',
      body: 'The deep end. You will draw a wave for **Fledge Synth** out of sine waves, then run sounds through four effects that change what they are: a **vocoder**, a **harmoniser**, a **frequency shifter** and a **spectral** freeze. Go slowly and listen at each step.',
    },
    {
      title: 'A Fledge Synth track',
      body: `Press **Space** once so the sound is on. Then press **${BROWSE}**, click **Instruments** at the side, find **Fledge Synth** and click **New track**. Its panel opens. (If the song is empty, draw a few long notes on it afterwards.)`,
      target: browserOrMenu,
      task: { hint: 'Add a Fledge Synth track', begin: () => tl().tracks.filter((t) => t.plugin?.url.startsWith('builtin:fledge/')).length, done: (n) => tl().tracks.filter((t) => t.plugin?.url.startsWith('builtin:fledge/')).length > (n as number) },
    },
    {
      title: 'Draw a wave',
      body: 'Every sound is a sum of sine waves: a fundamental and its **harmonics**. In oscillator **A**, open the **Table** list and choose **User table** (the last one); a row appears under it. Click **Draw harmonics**. Each bar is one harmonic’s level: drag them. Only the first is a pure sine; odd ones alone sound hollow, like a clarinet; many together sound bright. **Start from** gives you a saw, a square or an organ to bend.',
      target: () => (document.querySelector('button[title^="Build the table from sine waves"]') ? 'button[title^="Build the table from sine waves"]' : windowOrMenu()),
      task: {
        hint: 'Table: User table, then Draw harmonics, and drag a bar',
        done: () => tl().tracks.some((t) => !!(t.plugin?.state as { table?: { harmonics?: unknown } } | undefined)?.table?.harmonics),
      },
    },
    {
      title: 'A wave that moves',
      body: 'Click **+** to add a second drawing and change it. Now the oscillator’s **Position** morphs from the first drawing to the last (up to four): give Position an LFO or an envelope in the synth and the tone moves by itself. That is a wavetable, and you drew it.',
      target: windowOrMenu,
    },
    {
      title: 'Make it talk',
      body: `With the synth track selected, press **${BROWSE}**, search **vocoder** and **Add** it. Beside **Sidechain from** pick a track with words or rhythm on it (speech, singing, even the drums). The synth’s notes now come out shaped like that track. Bright, rich sounds work best; the voice track is usually turned right down.`,
      target: browserOrMenu,
      task: { hint: 'Add Fledge Vocoder and pick its Sidechain from', done: () => effectsOf('fledge-vocoder').some((p) => !!p.sidechain) },
    },
    {
      title: 'Harmony from one line',
      body: `On a track that plays **one note at a time** (a lead, a vocal), add **Fledge Harmony** (**${BROWSE}**, search **harmony**). Set **Key** and **Scale** to the song’s, and each **Voice** is so many steps of the scale above or below: +2 is a third above, +4 a fifth. Because the steps follow the scale, the harmony is always in key.`,
      target: browserOrMenu,
      task: addEffect('fledge-harmony', 'Add Fledge Harmony to a track'),
    },
    {
      title: 'Shift, do not transpose',
      body: 'Add **Fledge Shifter** to drums, a piano or a pad. A pitch shifter multiplies every frequency, so a note stays a note. This **adds** the same number of hertz to each, so the overtones stop lining up: bell-like and metallic at tens of hertz, a slow endless phasing under one hertz with **Mix** at half.',
      target: browserOrMenu,
      task: addEffect('fledge-shifter', 'Add Fledge Shifter to a track'),
    },
    {
      title: 'Freeze a moment',
      body: 'Add **Fledge Spectral** to any track and choose the preset **Freeze when switched on**. Give its **Freeze** switch an automation lane and draw it on for a bar: the sound of that instant holds, every frequency still turning. **Blur** makes a sound linger into a wash; **Smear** turns pitches to breath. It plays one frame late (about 43 ms), so use it for effect, not on a tight rhythm part.',
      target: browserOrMenu,
      task: addEffect('fledge-spectral', 'Add Fledge Spectral to a track'),
    },
    {
      title: 'In tune',
      body: `One more tool: **${toolShortcutLabel('tuner')}** opens the **Tuner** (the audio must be running). It listens to the microphone or to a track and shows the nearest note and how many cents off. Use it on a guitar before recording, or on a track after the Shifter to see what it did.`,
      target: () => (ui().tunerOpen ? '[data-floating-window][aria-label="Tuner"]' : '#menu-tools'),
    },
    {
      title: 'The lab is yours',
      body: 'Stack them: a drawn wave through the vocoder, harmonised, then frozen. Save a sound you like with **Save to My sounds** in the Inspector. Everything here plays the same live and in an export.',
    },
  ],
};

export const LESSONS: Lesson[] = [TOUR, BEGINNER, SHOWCASE, SOUNDS, INTERMEDIATE, HELPERS, EXPRESSIVE, MIX_ROOM, RHYTHM_FX, GAME_MUSIC, EXPERT, PRO_MIX, SOUND_LAB, GAME_REACT];

export const lessonById = (id: string): Lesson | undefined => LESSONS.find((l) => l.id === id);
