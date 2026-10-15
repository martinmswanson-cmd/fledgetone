import guideMarkdown from '../../GUIDE.md?raw';
import { INSTRUMENTS, INSTRUMENT_KEYS, isAudioKind, isMixKind } from '../audio/instrumentCatalog';
import type { InstrumentKey } from '../audio/instrumentCatalog';
import { useAudioStore } from '../store/audioStore';
import { useTimelineStore } from '../store/timelineStore';
import { useUiStore } from '../store/uiStore';
import { STARTERS } from '../store/starters';
import { showSfxMode } from '../components/sfx/SfxMakerPanel';
import { splitSections } from '../components/guide/markdown';
import { instrumentFields } from './instrumentSearch';
import type { SearchFields } from './searchCore';
import { openAndReveal, press, reveal } from './reveal';
import { pickProjectFile } from '../components/timeline/projectFile';

/**
 * Everything the search palette (Ctrl+K) can find: the app's tools and settings, every
 * instrument, the genre starters and the guide's sections. Running an entry does the thing (opens
 * the Mixer, starts playback) or takes you to the control (scrolls to it, focuses it and rings it).
 * An entry that can't be reached right now says why instead.
 */

export type PaletteGroup = 'Tool' | 'Setting' | 'Instrument' | 'Starter' | 'Guide';

export interface PaletteEntry extends SearchFields {
  id: string;
  group: PaletteGroup;
  /** Do it. A message back means it couldn't, and why (the palette shows it and stays open). */
  run: (opts: { alt: boolean }) => string | void | Promise<string | void>;
  /** A dot of colour (instruments) */
  color?: string;
  /** What Shift+Enter does instead, if anything */
  altHint?: string;
}

const timeline = () => useTimelineStore.getState();
const ui = () => useUiStore.getState();

const NO_TRACKS = 'There are no tracks yet: add one first (Add Track, or search for an instrument).';

/** Show a panel in the Track tab of the Inspector, for the selected track (or the first). */
const trackPanel = (name: string) => () => {
  const s = timeline();
  if (!s.tracks.length) return NO_TRACKS;
  if (!s.tracks.some((t) => t.id === s.selectedTrackId)) s.selectTrack(s.tracks[0].id);
  s.toggleInspector(true);
  ui().setInspectorTab('track');
  void reveal(`[data-search="${name}"]`);
};

/** Show a panel in the Master tab of the Inspector. */
const masterPanel = (name: string) => () => {
  const s = timeline();
  if (!s.tracks.length) return NO_TRACKS;
  s.toggleInspector(true);
  ui().setInspectorTab('master');
  void reveal(`[data-search="${name}"]`);
};

/** A piano roll control: there only while a clip is open in it. */
const pianoRoll = (name: string) => () => {
  if (!document.querySelector('[aria-label="Piano roll"]')) return "That's in the piano roll: double-click a note clip to open it, then search again.";
  void reveal(`[data-search="${name}"]`);
};

const show = (selector: string, missing?: string) => async () => {
  if (!(await reveal(selector))) return missing ?? "That isn't showing right now.";
};

const RECORD_OPTIONS = 'button[title^="Recording settings"]';
const PERF_BUTTON = 'button[title="Performance and memory"], button[title^="Playback is lagging"]';
const AUDIO_FIRST = 'Start the audio first (the START AUDIO button at the top right).';

type Item = Omit<PaletteEntry, 'id' | 'group'> & { id?: string };

const TOOLS: Item[] = [
  { title: 'New arrangement', keywords: 'new project blank start over template starter demo', detail: 'Start again from a blank timeline, the demo song or a genre starter.', run: () => ui().setDialog('new') },
  { title: 'Open project', keywords: 'open load file json import project', detail: 'Open a .fledgetone.json project file.', run: () => pickProjectFile() },
  { title: 'Save project', keywords: 'save download keep backup file json', detail: 'Save this arrangement as a project file, with its sounds (the first time, choose where).', run: async () => void (await press('#btn-save-project')) },
  { title: 'Save as…', keywords: 'save as copy location folder where file name', detail: 'Choose the folder and file name to save the project to.', run: async () => void (await import('../components/timeline/projectFile')).saveProjectAs() },
  { title: 'Export', keywords: 'export render bounce mixdown download wav mp3 ogg mp4 video stems tracks intro loop game audio file', detail: 'Render the song or loop as WAV, MP3, OGG or MP4: the mix, one file per track, or an intro + loop.', run: () => ui().setDialog('export') },
  { title: 'Share', keywords: 'share link url send friend mp3', detail: 'A link that opens the song, an MP3, or the project file.', run: () => ui().setDialog('share') },
  { title: 'Mixer', keywords: 'mixer faders meters levels channels desk console balance', detail: "Every track's fader, meter, pan and sends side by side.", run: () => ui().setDialog('mixer') },
  { title: 'Game preview', keywords: 'game adaptive interactive layers sections intensity dynamic music', detail: 'Switch between sections and layers live, the way adaptive game music does.', run: () => ui().setDialog('game') },
  { title: "What's new", keywords: 'whats new changelog changes version release notes update', detail: 'What changed in each version, and which version this is.', run: () => ui().setDialog('changes') },
  { title: 'Report a problem', keywords: 'report problem bug broken crash error issue help contact support email feedback', detail: 'Tell Two Birds Workshop something went wrong.', run: () => ui().setDialog('report') },
  { title: 'Tour and tutorials', keywords: 'learn tutorial tour lesson help beginner intermediate expert getting started how to teach walkthrough onboarding', detail: 'A one-minute tour and hands-on tutorials for beginner, intermediate and expert users.', run: () => ui().setDialog('learn') },
  { title: 'Guide', keywords: 'guide help manual how docs documentation tutorial', detail: 'How everything works.', run: () => ui().openGuide() },
  { title: 'Play / pause', keywords: 'play pause start transport space k', run: () => void timeline().togglePlay() },
  { title: 'Stop', keywords: 'stop transport return', run: () => timeline().stop() },
  { title: 'Loop on / off', keywords: 'loop repeat cycle l', run: () => timeline().toggleLoop() },
  { title: 'Loop range', keywords: 'loop in out length points region', detail: 'Type exact loop In, Out and Length.', run: show('button[title^="Loop In, Out and Length"]') },
  { title: 'Add marker', keywords: 'marker section label flag m', detail: 'Drop a marker at the playhead.', run: () => timeline().addMarker() ?? undefined },
  { title: 'Stingers', keywords: 'stinger stingers cue victory level up item found checkpoint danger game over fanfare jingle', detail: 'Short cues over the music, in the song\'s key (Game preview).', run: () => ui().setDialog('game') },
  { title: 'Web runtime kit (no audio files)', keywords: 'web runtime player json synthesize browser small size bos-player game html5', detail: 'The song file and bos-player.js, which makes the music in the browser (Game preview).', run: () => ui().setDialog('game') },
  { title: 'Game kit export', keywords: 'game kit export godot unity web engine adaptive music json loops states player script', detail: 'Every state, stinger and transition, with players for web, Godot and Unity.', run: () => ui().setDialog('game') },
  { title: 'Loop variations', keywords: 'loop variations takes alternate versions fills repeat fatigue', detail: 'Takes of the loop for a game to rotate through (Game preview).', run: () => ui().setDialog('game') },
  { title: 'Generate variations (game sounds)', keywords: 'variations micro variation random footstep swing click sfx takes round robin pitch', detail: 'Right-click a short clip: Generate variations…', run: () => 'Right-click a short clip on the timeline and choose Generate variations…' },
  { title: 'Tune vocal', keywords: 'tune tuning autotune auto tune pitch correction vocal voice singing key scale in tune flat sharp robot', detail: 'Pull a recorded vocal onto the notes of a key (right-click an audio clip).', run: () => {
    const clip = timeline().clips.find((c) => c.isSelected && c.audio) ?? timeline().clips.find((c) => c.audio);
    if (!clip) return 'Record or drop a vocal onto the timeline first: then right-click it, Tune vocal…';
    ui().setTuneClip(clip.id);
  } },
  { title: 'FMOD / Wwise package', keywords: 'fmod wwise middleware audio engine export package studio waapi event switch container rtpc unreal', detail: 'The game music laid out for FMOD Studio or Wwise, with scripts that build it there.', run: () => ui().setDialog('engines') },
  { title: 'Transition matrix', keywords: 'transition transitions matrix fill riser impact crossfade stinger bridge state switch from to', detail: 'How each game state hands over to each other one (Game preview).', run: () => ui().setDialog('game') },
  { title: 'Audition like the game', keywords: 'audition pads trigger test game engine states preview crossfade', detail: 'Play the states with the game kit\'s own player (Game preview).', run: () => ui().setDialog('game') },
  { title: 'Intensity and stem groups', keywords: 'intensity stem group stems ambient percussion tension climax curve crossfade layers adaptive', detail: 'Crossfade stem groups along their curves (header, Game preview).', run: () => ui().setDialog('game') },
  { title: 'Find cuts in the video', keywords: 'scene cut cuts detection shots edit video hit points', detail: 'A hit point on every hard cut (the scissors on the video lane).', run: async () => void (await press('[aria-label="Find cuts in the video"]')) },
  { title: 'Duck others under this track (dialogue / SFX proxy)', keywords: 'duck ducking sidechain proxy dialogue voiceover vo sfx sound effects lower music bed', detail: 'Every other track dips wherever this one sounds.', run: trackPanel('Duck others under this') },
  { title: 'Dip under dialogue', keywords: 'dialogue dialog voice speech duck ducking dip lower music under talking video', detail: 'Turn the music down wherever people talk in the video.', run: async () => void (await press('[aria-label="Dip the music under the video\'s dialogue"]')) },
  { title: 'Export markers for Premiere, Resolve, Final Cut', keywords: 'export markers premiere resolve davinci final cut fcpxml edl xml csv editor', detail: 'In the Video tab (and the Markers list).', run: () => {
    ui().openDock('video');
    if (!timeline().markers.length) return 'Add markers (M) or hit points (Shift+M) first.';
    void reveal('[aria-label="Export the markers for video editing software"]');
  } },
  { title: 'Video tools', keywords: 'video tools panel scoring picture film edit editor cuts dialogue hit points', detail: 'The reference video, its cuts and dialogue, hit points, markers for editors (the Video tab).', run: () => ui().openDock('video') },
  { title: 'Menu bar', keywords: 'menu menus file edit song track tools view help', detail: 'Every tool, by where a DAW keeps it.', run: () => void reveal('#menu-file') },
  { title: 'Tempo change', keywords: 'tempo change map ritardando accelerando glide ramp speed up slow down bpm automation', detail: 'Double-click the ruler\'s top row, or right-click the ruler: Tempo change here / Tempo glide to here.', run: () => 'Double-click the top row of the ruler for a tempo change there, or right-click the ruler for a jump or a glide.' },
  { title: 'Time signature', keywords: 'time signature meter 3/4 6/8 7/8 5/4 odd measure waltz', detail: 'Right-click the ruler: Time signature change here (or click the one at the start of the ruler\'s top row).', run: () => 'Right-click the ruler and choose Time signature change here, or click the time signature at the start of the ruler\'s top row.' },
  { title: 'Return (effect return)', keywords: 'return aux fx effect send reverb delay shared parallel', detail: 'A track for a shared effect; send any track to it.', run: () => void useTimelineStore.getState().addReturn(useTimelineStore.getState().selectedTrackId ?? undefined) },
  { title: 'Bus (group channel)', keywords: 'bus group channel submix subgroup route routing output aux', detail: 'Tracks that play into one fader, inserts and sends.', run: () => void useTimelineStore.getState().addTrack('bus') },
  { title: 'Expression lanes (pitch bend, mod wheel, sustain)', keywords: 'pitch bend mod wheel modulation vibrato sustain pedal expression controller cc lane', detail: 'At the bottom of the piano roll.', run: () => 'Open a clip in the piano roll: the Pitch bend, Mod wheel and Sustain pedal lanes are at the bottom.' },
  { title: 'Punch in / out', keywords: 'punch in out record replace drop in overdub range', detail: 'Record only between two points (the Record button\'s settings).', run: async () => void (await press('button[title^="Recording settings"]')) },
  { title: 'Takes and comping', keywords: 'takes comp comping take folder loop record best bits playlist lanes', detail: 'Loop passes as takes, then pick the best parts (Recording settings: Loop passes are takes).', run: async () => void (await press('button[title^="Recording settings"]')) },
  { title: 'Plugin instrument (WAM)', keywords: 'plugin wam web audio module vst instrument third party external synth', detail: 'Load a Web Audio Module instrument by its address.', run: () => useUiStore.getState().setPluginDialog({ trackId: null }) },
  { title: 'Plugin effect (WAM)', keywords: 'plugin wam web audio module vst effect insert third party external fx', detail: 'Right-click a track: Add plugin effect (WAM)…', run: () => {
    const st = useTimelineStore.getState();
    const id = st.selectedTrackId;
    if (!id) return 'Select a track first (or right-click its name: Add plugin effect (WAM)…).';
    if (st.tracks.find((t) => t.id === id)?.instrumentKey === 'bus') return 'A bus takes no plugin effects: add them to the tracks that play into it.';
    useUiStore.getState().setPluginDialog({ trackId: id });
  } },
  { title: 'Spectrum', keywords: 'spectrum analyser analyzer visualizer visualiser frequency readout led neon cyberpunk city terrain radar hud data rain hologram pigeons', detail: 'The live spectrum, next to the master in the Mixer, as LED bars, a neon city, terrain, radar, data rain or holograms.', run: () => ui().setDialog('mixer') },
  { title: 'Bottom panel', keywords: 'dock bottom panel tabs mixer instruments game video sfx', detail: 'Show or hide the panel under the timeline.', run: () => ui().setDockOpen(!ui().dockOpen) },
  { title: 'Markers list', keywords: 'markers sections rename jump list', run: async () => void (await press('button[title^="Markers:"]')) },
  { title: 'Build-up & drop at the playhead', keywords: 'buildup build up drop riser transition edm snare roll impact', detail: 'Adds a build-up before the playhead and a drop on it (also on the ruler’s right-click menu).', run: () => {
    const s = timeline();
    return s.addBuildAndDrop(Math.max(2, Math.round(s.playheadPosition))) ?? undefined;
  } },
  { title: 'Key change', keywords: 'key change modulation transpose semitone whole step lift final chorus', detail: 'Right-click the ruler where the new key starts: up a semitone, up a whole step or down a semitone.', run: () => void ui().openGuide('the-timeline') },
  { title: 'Undo', keywords: 'undo back revert ctrl z', run: () => timeline().undo() },
  { title: 'Redo', keywords: 'redo again ctrl y', run: () => timeline().redo() },
  { title: 'Selection tool', keywords: 'select pointer arrow tool v', run: () => timeline().setTool('select') },
  { title: 'Razor tool', keywords: 'razor blade cut split scissors tool c', run: () => timeline().setTool('razor') },
  { title: 'Add track', keywords: 'add new track instrument channel', run: async () => void (await press('button[title="Add a new instrument track"]')) },
  { title: 'Record notes', keywords: 'record recording take arm midi capture', detail: 'Arm a track (R on its header), switch Record on and press Play.', run: show('button[title^="Record:"]') },
  { title: 'Count-in', keywords: 'count in recording bar before', run: () => void openAndReveal(RECORD_OPTIONS, '[data-search="count-in"]') },
  { title: 'Quantize recorded notes', keywords: 'quantize recording snap timing tighten', run: () => void openAndReveal(RECORD_OPTIONS, '[aria-label="Quantize recorded notes"]') },
  { title: 'Metronome', keywords: 'metronome click beat tick tempo', detail: 'A click on every beat while playing (never in exports).', run: show('button[title^="Metronome:"]') },
  { title: 'Metronome volume', keywords: 'metronome click level loudness', run: () => void openAndReveal(RECORD_OPTIONS, '[aria-label="Metronome volume"]') },
  { title: 'MIDI keyboard', keywords: 'midi keyboard controller input device computer keyboard piano typing', detail: 'Choose a MIDI keyboard, or play the computer keyboard.', run: async () => void (await press('button[title^="MIDI input"]')) },
  { title: 'Record from the microphone', keywords: 'mic microphone voice vocals singing audio record guitar', run: show('button[title^="Record from the microphone"], button[title^="Stop recording"]') },
  { title: 'Reference video', keywords: 'video movie film gameplay trailer cutscene score picture sync mp4', detail: 'Load a video to score to; it plays in sync with the playhead.', run: () => {
    ui().openDock('video');
    void reveal('button[title^="Load a video"], button[title^="Scoring to"]');
  } },
  { title: 'Freeze track', keywords: 'freeze bounce render cpu lag performance', detail: 'Render a track to audio to save processing (on each track header).', run: show('button[aria-label^="Freeze "], button[aria-label^="Unfreeze "]', NO_TRACKS) },
  { title: 'Clear memory', keywords: 'memory ram lag slow performance cpu clean free', detail: 'Free memory when playback lags.', run: async () => {
    if (useAudioStore.getState().audioState !== 'running') return AUDIO_FIRST;
    if (!document.querySelector('[aria-label="Performance"]')) await press(PERF_BUTTON);
    void reveal('[aria-label="Performance"]');
  } },
  { title: 'Track Inspector', keywords: 'inspector fx rack effects track settings panel', run: () => {
    const s = timeline();
    if (!s.tracks.length) return NO_TRACKS;
    s.toggleInspector(true);
    ui().setInspectorTab('track');
  } },
  { title: 'Instrument browser', keywords: 'browse try audition preview listen instruments', run: () => {
    ui().openDock('instruments');
    void reveal('section[aria-label="Instrument Browser"]');
  } },
  { title: 'Sound deck', keywords: 'pads audition deck trigger keys patterns', run: () => {
    ui().openDock('instruments');
    void reveal('section[aria-label="Soundbank Audition Panel"]');
  } },
  { title: 'Start audio', keywords: 'start audio sound on enable power', run: () => void useAudioStore.getState().initializeAudio() },
];

const SETTINGS: Item[] = [
  { title: 'Tempo', keywords: 'tempo bpm speed fast slow', run: show('[aria-label="Tempo (BPM)"]') },
  { title: 'Tap tempo', keywords: 'tap tempo bpm', run: show('button[title="Click repeatedly to tap tempo"]') },
  { title: 'Sound effects maker', keywords: 'sfx sound effects maker generator game jump coin laser hit hurt power up powerup explosion blip select 8 bit retro ui click menu sword footstep whoosh impact magic spell gem level up jingle loop ambience wind rain fire engine', detail: 'Make game sounds: UI, combat, pickups, magic, jingles, ambience loops; with variations.', run: () => { showSfxMode('sound'); void ui().setDialog('sfx'); } },
  { title: 'Try it in a game', keywords: 'game preview play test try robot guard demo adaptive music states intensity stingers walk', detail: 'A little 3D game that plays your song the way a real game would.', run: () => void ui().setDialog('tryOut') },
  { title: 'Sound effect set', keywords: 'sfx sound effects pack set kit ui menu sounds rpg platformer shooter casual ambience zip game', detail: 'Every sound a kind of game needs, in one style, as a zip.', run: () => { showSfxMode('set'); void ui().setDialog('sfx'); } },
  { title: 'Cut song to length', keywords: 'cut down cutdown edit shorten lengthen 15 30 60 seconds ad trailer spot social version duration trim song', detail: 'A 6, 15, 30, 60 or 90-second version, cut at the sections.', run: () => void ui().setDialog('cut') },
  { title: 'Tempo finder (hit points)', keywords: 'tempo finder hit points hits sync picture video cut slam land on beat film scoring calculator', detail: 'Find tempos that land your hit points (Shift+M) on the beat.', run: async () => {
    if (await press('button[title^="Fit to time"]')) await press('[aria-label="What to fit"] button:last-child');
  } },
  { title: 'Fit tempo to a time', keywords: 'fit duration seconds length video tempo', detail: 'Set the tempo so the loop, the song or some bars last a given time.', run: async () => void (await press('button[title^="Fit to time"]')) },
  { title: 'Swing', keywords: 'swing shuffle groove triplet feel', run: show('[aria-label="Swing"]') },
  { title: 'Master volume', keywords: 'master volume output level loud quiet', run: show('[aria-label="Master volume"]') },
  { title: 'Loudness meter', keywords: 'loudness lufs true peak meter level streaming', run: masterPanel('loudness') },
  { title: 'Snap', keywords: 'snap grid quantize magnet align', run: show('#snap-grid') },
  { title: 'Timecode frame rate', keywords: 'fps frame rate timecode video frames 24 25 30 60', run: show('[aria-label="Timecode frame rate"]') },
  { title: 'Timeline zoom', keywords: 'zoom in out timeline scale', run: show('#zoom-slider') },
  { title: 'Project name', keywords: 'project name title rename file', run: show('[aria-label="Project name"]') },
  { title: "Track's instrument", keywords: 'change instrument sound swap track', run: trackPanel('instrument') },
  { title: 'EQ', keywords: 'eq equalizer equaliser bass treble low mid high tone', run: trackPanel('eq') },
  { title: 'Pro EQ (parametric)', keywords: 'pro eq parametric equalizer equaliser bands bell shelf notch low cut high cut highpass lowpass spectrum analyser analyzer graph surgical', detail: 'Up to six bands of any shape, dragged on a graph over the track\'s live spectrum.', run: trackPanel('Pro EQ') },
  { title: 'Multiband compressor', keywords: 'multiband multi band compressor compression dynamics low mid high crossover glue tame', detail: 'Compress the lows, mids and highs separately.', run: trackPanel('Multiband') },
  { title: 'Human (feel)', keywords: 'human humanize humanise feel groove realistic real player natural authentic timing velocity variation imperfect sloppy live loose', detail: 'Each note played a little differently, like a real player.', run: trackPanel('Human') },
  { title: 'Distortion', keywords: 'distortion drive overdrive saturation crunch fuzz', run: trackPanel('Distortion') },
  { title: 'Compressor', keywords: 'compressor compression dynamics punch squash', run: trackPanel('Compressor') },
  { title: 'Chorus', keywords: 'chorus wide shimmer ensemble detune', run: trackPanel('Chorus') },
  { title: 'Filter', keywords: 'filter lowpass highpass bandpass cutoff resonance sweep', run: trackPanel('Filter') },
  { title: 'Lo-fi', keywords: 'lofi lo fi bitcrusher bit crush crusher 8 bit tape wow vinyl dusty grit', run: trackPanel('Lo-fi') },
  { title: 'Delay (insert)', keywords: 'delay echo ping pong pingpong repeat dotted eighth slapback tape echo insert', detail: "Echoes in time with the song, on the track itself (or on a return).", run: trackPanel('Delay') },
  { title: 'Reverb (insert)', keywords: 'reverb room hall plate space ambience tail decay predelay insert', detail: 'A room of the track’s own (or a return’s), apart from the shared master reverb.', run: trackPanel('Reverb') },
  { title: 'Gate (stutter)', keywords: 'gate trance gate stutter chop chopper tremolo rhythmic', run: trackPanel('Gate') },
  { title: 'Pump (sidechain)', keywords: 'pump sidechain ducking kick duck', run: trackPanel('Pump') },
  { title: 'Reverb and delay sends', keywords: 'reverb delay echo send space wet', run: trackPanel('sends') },
  { title: 'Track volume and pan', keywords: 'volume pan fader level balance left right', run: trackPanel('volume') },
  { title: 'Synth Designer', keywords: 'synth designer design oscillator envelope adsr lfo patch sound design wavetable', detail: 'Build your own synth: oscillators, filter, envelopes, LFO.', run: () => {
    const s = timeline();
    const current = s.tracks.find((t) => t.id === s.selectedTrackId);
    if (current?.instrumentKey !== 'synthDesigner') {
      const existing = s.tracks.find((t) => t.instrumentKey === 'synthDesigner');
      if (existing) s.selectTrack(existing.id);
      else s.addTrack('synthDesigner');
    }
    s.toggleInspector(true);
    ui().setInspectorTab('track');
    void reveal('[aria-label="Synth Designer"]');
  } },
  { title: 'Master reverb', keywords: 'reverb hall room space cathedral decay plate', run: masterPanel('master-reverb') },
  { title: 'Master delay', keywords: 'delay echo feedback time', run: masterPanel('master-delay') },
  { title: 'OTT', keywords: 'ott multiband compression loud edm upward', run: masterPanel('OTT') },
  { title: 'Stereo width', keywords: 'stereo width wide mono', run: masterPanel('Stereo Width') },
  { title: 'Stable playback', keywords: 'stable playback buffer latency glitch crackle stutter lag', detail: 'A bigger playback buffer, for fewer glitches on a busy computer.', run: masterPanel('playback') },
  { title: 'Auto-freeze', keywords: 'auto freeze automatic render cpu lag performance stutter big song', detail: 'Freeze the tracks you leave alone in a big song, by itself.', run: masterPanel('playback') },
  { title: 'Scale', keywords: 'scale key major minor mode piano roll', run: pianoRoll('scale') },
  { title: 'Chord stamps', keywords: 'chord chords stamp triad piano roll', run: pianoRoll('chord') },
  { title: 'Note tools', keywords: 'arpeggiate arpeggio strum humanize quantize legato transpose semitone ratchet roll fit scale tools notes piano roll', run: pianoRoll('tools') },
  { title: 'Step sequencer', keywords: 'steps step sequencer grid drum pattern piano roll', run: pianoRoll('steps') },
  { title: 'Ghost notes', keywords: 'ghost notes other tracks piano roll', run: pianoRoll('ghosts') },
  { title: 'Wobble rate', keywords: 'wobble dubstep lfo rate piano roll', run: pianoRoll('wobble') },
];

function instrumentEntry(key: InstrumentKey): PaletteEntry {
  const def = INSTRUMENTS[key];
  return {
    ...instrumentFields(def),
    id: `instrument-${key}`,
    group: 'Instrument',
    color: def.color,
    // (An Audio track, a bus or a return is a kind of track, not an instrument to put on one)
    altHint: isAudioKind(key) || isMixKind(key) ? undefined : 'Shift+Enter: use it on the selected track',
    run: ({ alt }) => {
      const s = timeline();
      const selected = s.tracks.find((t) => t.id === s.selectedTrackId);
      if (alt && !isAudioKind(key) && !isMixKind(key)) {
        if (!selected) return 'Select a track first (click its name), or press Enter to add a new track.';
        if (isAudioKind(selected.instrumentKey)) return 'An Audio track plays sound files, so it keeps its instrument.';
        s.setTrackInstrument(selected.id, key);
        return;
      }
      s.addTrack(key);
    },
  };
}

/** Markdown to plain words, for searching and snippets. */
const plain = (lines: string[]) =>
  lines
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_#|>]/g, ' ');

let cached: PaletteEntry[] | null = null;

export function paletteEntries(): PaletteEntry[] {
  if (cached) return cached;
  const tools = TOOLS.map((t, i): PaletteEntry => ({ ...t, id: t.id ?? `tool-${i}`, group: 'Tool' }));
  const settings = SETTINGS.map((t, i): PaletteEntry => ({ ...t, id: t.id ?? `setting-${i}`, group: 'Setting' }));
  const instruments = INSTRUMENT_KEYS.map(instrumentEntry);
  const starters = STARTERS.map(
    (st): PaletteEntry => ({
      id: `starter-${st.id}`,
      group: 'Starter',
      title: `${st.name} starter`,
      keywords: `${st.group} genre template new song`,
      detail: st.detail,
      run: () => {
        ui().setDialog('new');
        void reveal(`[data-search="starter-${st.id}"]`);
      },
    })
  );
  const guide = splitSections(guideMarkdown).map(
    (sec): PaletteEntry => ({
      id: `guide-${sec.id}`,
      group: 'Guide',
      title: sec.title,
      keywords: 'guide help',
      detail: plain(sec.body),
      run: () => ui().openGuide(sec.id),
    })
  );
  cached = [...tools, ...settings, ...instruments, ...starters, ...guide];
  return cached;
}

/** Shown before anything is typed. */
export const SUGGESTED = ['Export', 'Mixer', 'Add track', 'Tempo', 'Master reverb', 'Synth Designer', 'Reference video', 'Guide'];
