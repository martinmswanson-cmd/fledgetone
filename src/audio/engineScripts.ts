import type { AudioManifest } from './gameKit';

/**
 * The FMOD and Wwise scripts and README for the engine package (see enginePackage.ts). No audio
 * here, so Node can test them.
 */

export type EngineTarget = 'fmod' | 'wwise' | 'both';

/** Where each state sits on one timeline (seconds), states end to end with a bar's gap. */
export function stateLayout(m: AudioManifest): Array<{ name: string; start: number; length: number; bpm: number; num: number; den: number }> {
  const gap = (240 / m.bpm) * 1;
  let at = 0;
  return m.states.map((s) => {
    // Each state at its own tempo and time signature (older manifests: the song's)
    const [num, den] = s.timeSignature ?? m.timeSignature ?? [4, 4];
    const entry = { name: s.name, start: +at.toFixed(6), length: s.seconds, bpm: s.bpm ?? m.bpm, num, den };
    at += s.seconds + gap;
    return entry;
  });
}

/** The stem tracks every state has: its stems by group, or the whole mix as one. */
function tracksOf(m: AudioManifest): Array<{ name: string; fileOf: (state: AudioManifest['states'][number]) => string }> {
  const groups = m.intensity.groups.map((g) => g.name);
  if (!groups.length) return [{ name: 'Music', fileOf: (s) => s.file }];
  return groups.map((name) => ({ name, fileOf: (s) => s.stems.find((x) => x.group === name)?.file ?? s.file }));
}

const js = (v: unknown) => JSON.stringify(v);
const levelDb = (level: number) => (level <= 0.0001 ? -80 : Math.max(-80, 20 * Math.log10(level)));

/** The FMOD Studio script (ES5, for Studio's script engine). */
export function fmodScript(m: AudioManifest): string {
  const layout = stateLayout(m);
  const tracks = tracksOf(m).map((t) => ({ name: t.name, sounds: m.states.map((s, i) => ({ file: t.fileOf(s), start: layout[i].start, length: layout[i].length })) }));
  const curves = m.intensity.groups.map((g) => ({ name: g.name, points: g.curve.map(([x, y]) => [x, +levelDb(y).toFixed(2)]) }));
  const data = { name: m.name, bpm: m.bpm, layout, tracks, curves, stingers: m.stingers.map((s) => ({ name: s.name, file: s.file })), transitions: m.transitions };
  return `// ${m.name}: FMOD Studio import script, made by Bo's Beatbox.
//
// 1. Copy this file into your FMOD Studio project's Scripts folder (next to the .fspro), or your
//    user Scripts folder, and choose Scripts > Reload in FMOD Studio.
// 2. Choose Scripts > Bo's Beatbox > Import "${m.name}" and give it the full path of this package's
//    Audio folder when asked (or set AUDIO_FOLDER below first).
// It builds the event Music/${m.name} and an event per stinger, and reports what it did in the console.
// See README.md for what to finish by hand.

var AUDIO_FOLDER = ''; // e.g. 'C:/Games/MyGame/Music/${m.name} FMOD-Wwise/Audio'
var DATA = ${js(data)};

function bbLog(text) {
  try { console.log(text); } catch (e) {}
}

function bbTry(what, fn) {
  try {
    var result = fn();
    bbLog('OK    ' + what);
    return result;
  } catch (e) {
    bbLog('SKIP  ' + what + ' (' + e + ')');
    return null;
  }
}

function bbFolder() {
  if (AUDIO_FOLDER) return AUDIO_FOLDER.replace(/[\\\\/]+$/, '');
  var asked = null;
  try { asked = studio.system.getText('Full path of the Audio folder from the Bo\\'s Beatbox package', ''); } catch (e) {}
  return asked ? String(asked).replace(/[\\\\/]+$/, '') : null;
}

function bbEvent(name, folderName) {
  var event = null;
  try { event = studio.project.workspace.addEvent(name, false); } catch (e) {}
  if (!event) {
    event = studio.project.create('Event');
    event.name = name;
    try { event.folder = studio.project.workspace.masterEventFolder; } catch (e) {}
  }
  if (folderName) {
    bbTry('put ' + name + ' in the folder ' + folderName, function () {
      var folder = studio.project.create('EventFolder');
      folder.name = folderName;
      folder.folder = studio.project.workspace.masterEventFolder;
      event.folder = folder;
    });
  }
  return event;
}

function bbImport() {
  var folder = bbFolder();
  if (!folder) { bbLog('No Audio folder given: nothing done.'); return; }
  var audio = {};
  function file(path) {
    if (!audio[path]) audio[path] = studio.project.importAudioFile(folder + '/' + path);
    return audio[path];
  }

  var event = bbEvent(DATA.name, 'Music');
  bbLog('Event: Music/' + DATA.name);

  // A track per stem group, every state laid out along the timeline
  var groupTracks = {};
  DATA.tracks.forEach(function (t) {
    var track = event.addGroupTrack(t.name);
    groupTracks[t.name] = track;
    t.sounds.forEach(function (s) {
      bbTry('track ' + t.name + ': ' + s.file, function () {
        var sound = track.addSound(event.timeline, 'SingleSound', s.start, s.length);
        sound.audioFile = file(s.file);
        return sound;
      });
    });
  });

  // Tempo, a marker and a loop region per state
  // A tempo marker where each state starts, at its tempo and time signature
  DATA.layout.forEach(function (s) {
    bbTry('tempo ' + s.bpm + ' BPM, ' + s.num + '/' + s.den + ' at ' + s.name, function () {
      var tempo = studio.project.create('TempoMarker');
      tempo.timeline = event.timeline;
      tempo.position = s.start;
      tempo.tempo = s.bpm;
      tempo.timeSignatureNumerator = s.num;
      tempo.timeSignatureDenominator = s.den;
    });
  });
  var markerTrack = bbTry('a marker track', function () { return event.addMarkerTrack(); });
  DATA.layout.forEach(function (s) {
    bbTry('marker ' + s.name, function () {
      var marker = studio.project.create('NamedMarker');
      marker.timeline = event.timeline;
      if (markerTrack) marker.markerTrack = markerTrack;
      marker.position = s.start;
      marker.name = s.name;
    });
    bbTry('loop region ' + s.name, function () {
      var loop = studio.project.create('LoopRegion');
      loop.timeline = event.timeline;
      if (markerTrack) loop.markerTrack = markerTrack;
      loop.position = s.start;
      loop.length = s.length;
      try { loop.name = s.name; } catch (e) {}
    });
  });

  // Intensity: a parameter, and each group's volume following its curve
  if (DATA.curves.length) {
    var intensity = bbTry('the Intensity parameter (0 to 1)', function () {
      return event.addGameParameter({ name: 'Intensity', type: studio.project.parameterType.User, min: 0, max: 1 });
    });
    DATA.curves.forEach(function (c) {
      var track = groupTracks[c.name];
      if (!track || !intensity) return;
      bbTry('volume of ' + c.name + ' follows Intensity', function () {
        var automator = track.mixerGroup.addAutomator('volume');
        var curve = automator.addAutomationCurve(intensity.preset ? intensity.preset : intensity);
        c.points.forEach(function (p) { curve.addAutomationPoint(p[0], p[1]); });
      });
    });
  }

  // Stingers: an event each
  DATA.stingers.forEach(function (s) {
    bbTry('stinger event ' + s.name, function () {
      var e = bbEvent(s.name, 'Stingers');
      var track = e.addGroupTrack('Stinger');
      var sound = track.addSound(e.timeline, 'SingleSound', 0, 1);
      sound.audioFile = file(s.file);
      try { sound.length = sound.audioFile.length; } catch (x) {}
    });
  });

  bbLog('Done. Transitions to set up by hand: see README.md.');
  try { studio.system.message('Imported "' + DATA.name + '". The console lists every step; README.md lists what to finish by hand.'); } catch (e) {}
}

studio.menu.addMenuItem({
  name: "Bo's Beatbox\\\\Import \\"" + DATA.name + "\\"",
  execute: bbImport,
});
`;
}

/** The Wwise Authoring API script (Python 3, with the waapi-client package). */
export function wwiseScript(m: AudioManifest): string {
  const tracks = tracksOf(m);
  const data = {
    name: m.name,
    bpm: m.bpm,
    states: m.states.map((s) => ({ name: s.name, bars: s.bars, tracks: tracks.map((t) => ({ name: t.name, file: t.fileOf(s) })) })),
    stingers: m.stingers.map((s) => ({ name: s.name, file: s.file })),
    intensity: m.intensity.groups.length > 0,
    layout: stateLayout(m),
  };
  return `#!/usr/bin/env python3
"""${m.name}: Wwise import script, made by Bo's Beatbox.

1. Open your Wwise project, and turn on the Wwise Authoring API
   (Project > User Preferences > Enable Wwise Authoring API).
2. pip install waapi-client
3. python ${'import_'}${m.name.replace(/[^A-Za-z0-9]+/g, '_')}.py   (from this folder, while Wwise is open)

It builds, in the Interactive Music Hierarchy: a Music Switch Container "${m.name}", in it a
Music Playlist Container per state holding a Music Segment with a Music Track per stem group;
a State Group "${m.name} State" with a state per section; an Intensity game parameter
(0 to 100); and the stingers as Sound SFX. It prints each step, OK or SKIP.
See README.md for what to finish by hand.
"""
import json
import os

from waapi import WaapiClient

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIO = os.path.normpath(os.path.join(HERE, '..', 'Audio'))
DATA = json.loads(${js(JSON.stringify(data))})
NAME = DATA['name']
MUSIC = '\\\\Interactive Music Hierarchy\\\\Default Work Unit\\\\<Music Switch Container>' + NAME
STATES = '\\\\States\\\\Default Work Unit\\\\<State Group>' + NAME + ' State'


def step(client, what, uri, args):
    try:
        result = client.call(uri, args)
        print('OK    ' + what)
        return result
    except Exception as e:  # noqa: BLE001 - report and carry on
        print('SKIP  ' + what + ' (' + str(e) + ')')
        return None


with WaapiClient() as client:
    imports = []
    for state in DATA['states']:
        segment = MUSIC + '\\\\<Music Playlist Container>' + state['name'] + '\\\\<Music Segment>' + state['name']
        for track in state['tracks']:
            imports.append({
                'audioFile': os.path.join(AUDIO, *track['file'].split('/')),
                'objectPath': segment + '\\\\<Music Track>' + track['name'],
            })
    for stinger in DATA['stingers']:
        imports.append({
            'audioFile': os.path.join(AUDIO, *stinger['file'].split('/')),
            'objectPath': '\\\\Actor-Mixer Hierarchy\\\\Default Work Unit\\\\<Actor-Mixer>' + NAME + ' Stingers\\\\<Sound SFX>' + stinger['name'],
        })
    step(client, 'import %d files' % len(imports), 'ak.wwise.core.audio.import', {
        'importOperation': 'replaceExisting',
        'default': {'importLanguage': 'SFX'},
        'imports': imports,
    })

    step(client, 'tempo %s BPM' % DATA['bpm'], 'ak.wwise.core.object.setProperty', {'object': MUSIC, 'property': 'Tempo', 'value': DATA['bpm']})
    for state in DATA['layout']:
        playlist = MUSIC + '\\\\<Music Playlist Container>' + state['name']
        # Each state at its own tempo and time signature
        step(client, state['name'] + ': own tempo and time signature', 'ak.wwise.core.object.setProperty', {'object': playlist, 'property': 'OverrideClockSettings', 'value': True})
        step(client, state['name'] + ': %s BPM' % state['bpm'], 'ak.wwise.core.object.setProperty', {'object': playlist, 'property': 'Tempo', 'value': state['bpm']})
        step(client, state['name'] + ': %d/%d' % (state['num'], state['den']), 'ak.wwise.core.object.setProperty', {'object': playlist, 'property': 'TimeSignatureUpper', 'value': state['num']})
        step(client, state['name'] + ': beat value', 'ak.wwise.core.object.setProperty', {'object': playlist, 'property': 'TimeSignatureLower', 'value': state['den']})
    for state in DATA['states']:
        playlist = MUSIC + '\\\\<Music Playlist Container>' + state['name']
        step(client, 'playlist ' + state['name'] + ' loops', 'ak.wwise.core.object.setProperty', {'object': playlist, 'property': 'LoopCount', 'value': 0})

    step(client, 'state group', 'ak.wwise.core.object.create', {
        'parent': '\\\\States\\\\Default Work Unit', 'type': 'StateGroup', 'name': NAME + ' State', 'onNameConflict': 'merge',
        'children': [{'type': 'State', 'name': s['name']} for s in DATA['states']],
    })
    step(client, 'switch container follows the state group', 'ak.wwise.core.object.setReference', {'object': MUSIC, 'reference': 'SwitchGroupOrStateGroup', 'value': STATES})

    if DATA['intensity']:
        step(client, 'Intensity game parameter', 'ak.wwise.core.object.create', {
            'parent': '\\\\Game Parameters\\\\Default Work Unit', 'type': 'GameParameter', 'name': 'Intensity', 'onNameConflict': 'merge',
            '@Min': 0, '@Max': 100,
        })

    print('Done. To finish by hand: see README.md.')
`;
}

/** The README: what's in the package and the manual steps. */
export function engineReadme(m: AudioManifest, target: EngineTarget): string {
  const layout = stateLayout(m);
  const bar = 240 / m.bpm;
  const curves = m.intensity.groups;
  const fmod = target !== 'wwise';
  const wwise = target !== 'fmod';
  const slug = m.name.replace(/[^A-Za-z0-9]+/g, '_');
  return `# ${m.name}: FMOD / Wwise package

Made with Bo's Beatbox. ${m.bpm} BPM, ${(m.timeSignature ?? [4, 4]).join('/')} at the start (a bar is ${bar.toFixed(4)} s there; each state keeps its own tempo and time signature, see the table)${m.key ? `, in ${m.key}` : ''}.

## What's here

- \`Audio/states/\`: every state (section) as an exact, seamless loop of whole bars, with loop points.
- \`Audio/stems/<state>/\`: the same loops split by stem group (all the same length).
- \`Audio/stingers/\`: short cues to play over the music on the next beat.
- \`Audio/transitions/\`: fill, riser and impact sounds for switches (a fill or riser starts its lead-in before the switch).
- \`cues.json\`: tempo, every state (bars, seconds, samples, its stems, where it sits on one timeline), the transition rules, the stingers and the intensity curves.
${fmod ? `- \`fmod/BosBeatbox_${slug}.js\`: builds the music in FMOD Studio.\n` : ''}${wwise ? `- \`wwise/import_${slug}.py\`: builds the music in Wwise.\n` : ''}
## States

| State | Bars | Seconds | Tempo | Time signature | Timeline start (FMOD) |
| --- | --- | --- | --- | --- | --- |
${m.states.map((s, i) => `| ${s.name} | ${s.bars} | ${s.seconds.toFixed(3)} | ${layout[i].bpm} BPM | ${layout[i].num}/${layout[i].den} | ${layout[i].start.toFixed(3)} s |`).join('\n')}

## Transitions

${m.transitions.length ? m.transitions.map((t) => `- ${t.from === '*' ? 'Any state' : t.from} → ${t.to}: ${t.kind}${t.kind === 'crossfade' ? ` over ${t.beats} beats` : ''}${t.stinger ? ` (stinger ${t.stinger})` : ''}, ${t.quantize === 'now' ? 'at once' : t.quantize === 'end' ? 'at the end of the loop' : t.quantize === 'phrase' ? `on the next ${t.phraseBars ?? 4}-bar phrase` : `on the next ${t.quantize}`}${t.file ? ` (sound: ${t.file}${t.leadInSeconds ? `, starting ${t.leadInSeconds.toFixed(3)} s early` : ''}${t.bridgeSeconds ? `, the state coming in ${t.bridgeSeconds.toFixed(3)} s after it starts` : ''})` : ''}`).join('\n') : '- None set: switch on the next bar line.'}

${curves.length ? `## Intensity

Each stem group's level (0 to 1) at each intensity (0 to 1). In dB: 0 = 0 dB; below about 0.001 is silent.

${curves.map((g) => `- **${g.name}**: ${g.curve.map(([x, y]) => `${Math.round(x * 100)}% → ${y <= 0.0001 ? 'silent' : `${levelDb(y).toFixed(1)} dB`}`).join(', ')}`).join('\n')}
` : ''}${fmod ? `
## FMOD Studio

1. Copy \`fmod/BosBeatbox_${slug}.js\` into your project's \`Scripts\` folder (next to the .fspro) and choose **Scripts > Reload**.
2. Choose **Scripts > Bo's Beatbox > Import "${m.name}"**, and paste the full path of this package's \`Audio\` folder.
3. It makes the event **Music/${m.name}**: ${tracksOf(m).length > 1 ? `a track per stem group (${tracksOf(m).map((t) => t.name).join(', ')})` : 'one track'}, every state laid end to end with a **loop region** and a **marker** named after it, the tempo marker, an **Intensity** parameter (0 to 1) automating each group's volume, and an event per stinger under **Stingers/**. The console lists each step as OK or SKIP: a SKIP is something your version of Studio's scripting doesn't allow, to do by hand below.
4. By hand: add a **State** parameter (labelled, one label per state) and **transition regions** (or transition markers) to each state's marker with that label as the condition, quantized to the bar (or as the transitions above say). Set loop regions to loop while their state is set.
5. In the game: start the event, set **State** and **Intensity**; play the stinger events on the next beat.
` : ''}${wwise ? `
## Wwise

1. In Wwise, turn on **Project > User Preferences > Enable Wwise Authoring API**.
2. \`pip install waapi-client\`, then from the \`wwise\` folder: \`python import_${slug}.py\` while the project is open.
3. It makes, in the Interactive Music Hierarchy, a **Music Switch Container "${m.name}"** with a **Music Playlist Container** per state, each holding a **Music Segment** with a **Music Track** per stem group; a **State Group "${m.name} State"** with a state per section; an **Intensity** game parameter (0 to 100); and the stingers as **Sound SFX** under the Actor-Mixer **${m.name} Stingers**. It prints each step as OK or SKIP.
4. By hand: in each playlist, make sure the segment is in the playlist and set to loop (infinite). In the switch container, assign each state of **${m.name} State** to its playlist. Each segment's exit cue goes at its end (they're exact loops). Add transitions by the rules above (Sync to: Next Bar; a stinger as a transition segment). For Intensity, add an RTPC on each stem track's Voice Volume with the points above (intensity × 100).
5. In the game: post an event that plays the switch container, set the state, and set the **Intensity** RTPC.
` : ''}
The scripts were written against the FMOD Studio scripting API and the Wwise Authoring API; versions differ, so each step reports whether it worked rather than stopping the rest.
`;
}

