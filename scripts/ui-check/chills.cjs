// Chills progressions and the build into a peak, in a real browser, in the studio and in Pocket:
// each progression is inserted from the studio's Chills progression dialog (the first through the
// lane's right-click menu), one through the piano roll's CHILLS, each in Pocket's Chords sheet
// (the clip named after the progression), "New empty clip" from the lane's menu (made where the
// dialogs make theirs), and a build from the clips' right-click menu and from Pocket's section
// sheet, both ways it can start (dip, then swell; from the music's level). Each is checked to
// be one exact undo step (Undo gives the song back as it was, Redo as it was after), then the song
// is exported through the app's own render (the master and its limiter, as Export plays it) and
// measured: no sample at or over full scale, and no rise in level beyond the cap (6 dB) anywhere
// against the 3 seconds before it, nor at the peak against the section before the build.
//
//   npx vite --port 5200                 (in another terminal; restart it after editing src/)
//   node scripts/ui-check/chills.cjs
//
// Plain or rich chords: the choice in the dialog, the piano roll and Pocket (each starting on the
// progression's own, the notes written as chosen, the names shown matching them, one exact undo).
// PART=rich runs only those checks. RENDER=<folder> also exports the soul turnaround in F major at
// 60 BPM, half a bar a chord, on a Wavetable pad over a Sub-Bass playing the roots, through the
// Export dialog as MP3s at the Streaming target (new-plain.mp3, new-rich.mp3), and measures each
// chord's loudness in them and on the pad alone (plain against rich).
//
// APP_URL overrides http://localhost:5200/; SHOTS=<folder> saves screenshots of the dialogs, the
// piano roll's chords row, the lanes the build writes and Pocket's sheets there. Needs Playwright
// with Chromium. Exit code 0 when every step passes.
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}

const APP = process.env.APP_URL || 'http://localhost:5200/';
const SHOTS = process.env.SHOTS || '';
const ONLY_RICH = process.env.PART === 'rich';
const RENDER = process.env.RENDER || '';
/** The most a build may raise the level, dB (chillsBuild.ts BUILD_MOST_RISE_DB) */
const CAP_DB = 6;
let failures = 0;
const step = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
};

// A held I–V–vi–IV pad, a beat and a bass in four 4-bar sections (markers), and an empty synth track
const CHORDS = [['C4', 'E4', 'G4'], ['B3', 'D4', 'G4'], ['C4', 'E4', 'A4'], ['C4', 'F4', 'A4']];
const ROOTS = ['C2', 'G2', 'A2', 'F2'];
const section = (k) => {
  const pad = CHORDS.flatMap((c, i) => c.map((note, j) => ({ id: `p${k}${i}${j}`, note, startOffset: i, duration: '1m', velocity: 0.7 })));
  const beat = [];
  for (let b = 0; b < 4; b++)
    for (let e = 0; e < 8; e++) {
      const at = b + e / 8;
      beat.push({ id: `h${k}${b}${e}`, note: 'F#1', startOffset: at, duration: '16n', velocity: 0.5 });
      if (e % 2 === 0) beat.push({ id: `k${k}${b}${e}`, note: e % 4 === 0 ? 'C1' : 'D1', startOffset: at, duration: '16n', velocity: 0.85 });
    }
  const bass = ROOTS.flatMap((note, i) => [0, 0.25, 0.5, 0.75].map((q) => ({ id: `b${k}${i}${q}`, note, startOffset: i + q, duration: '8n', velocity: 0.8 })));
  return [
    { id: `cp${k}`, trackId: 't1', name: 'Pad', startBar: 1 + 4 * k, lengthBars: 4, isSelected: false, notes: pad },
    { id: `cd${k}`, trackId: 't2', name: 'Beat', startBar: 1 + 4 * k, lengthBars: 4, isSelected: false, notes: beat },
    { id: `cb${k}`, trackId: 't3', name: 'Bass', startBar: 1 + 4 * k, lengthBars: 4, isSelected: false, notes: bass },
  ];
};
const SONG = {
  format: 'fledgetone-project',
  version: 1,
  name: 'Chills check',
  bpm: 120,
  swing: 0,
  loopRegion: { inBar: 1, outBar: 17, enabled: false },
  markers: [
    { id: 'm1', bar: 1, name: 'Verse' },
    { id: 'm2', bar: 5, name: 'Build' },
    { id: 'm3', bar: 9, name: 'Peak' },
    { id: 'm4', bar: 13, name: 'Out' },
  ],
  tracks: [
    { id: 't1', name: 'Pad', instrumentKey: 'supersaw', volume: -12, pan: 0, reverbSend: 0.1, delaySend: 0 },
    { id: 't2', name: 'Drums', instrumentKey: 'drums', volume: -9, pan: 0, reverbSend: 0, delaySend: 0 },
    { id: 't3', name: 'Bass', instrumentKey: 'bass', volume: -12, pan: 0, reverbSend: 0, delaySend: 0 },
    { id: 't4', name: 'Keys', instrumentKey: 'wavetable', volume: -12, pan: 0, reverbSend: 0.1, delaySend: 0 },
  ],
  clips: [0, 1, 2, 3].flatMap(section),
};

/** In the page: the song's tracks and clips as text (what Undo must give back exactly) */
const SNAP = async () => {
  const s = (await import('/src/store/timelineStore.ts')).useTimelineStore.getState();
  const strip = (c) => ({ ...c, isSelected: undefined });
  return JSON.stringify({ tracks: s.tracks, clips: s.clips.map(strip), master: s.master, tempo: s.tempoPoints });
};

/**
 * In the page: export bars [from, to) of the song as it is (the master and its limiter, as Export
 * renders it) and measure it: the highest sample, the true peak, the level of each 100 ms (RMS dB
 * of both channels), and the integrated loudness of each 4-bar section.
 */
const MEASURE = async ([from, to]) => {
  const ex = await import('/src/audio/exportWav.ts');
  const { measureLoudness } = await import('/src/audio/loudness.ts');
  const s = (await import('/src/store/timelineStore.ts')).useTimelineStore.getState();
  const sr = 44100;
  const audio = await ex.renderArrangement({
    tracks: s.tracks,
    clips: s.clips,
    bpm: s.bpm,
    tempoPoints: s.tempoPoints,
    swing: s.swing,
    startBar: from,
    endBar: to,
    masterFx: { reverbDecay: s.masterReverbDecay, delayTime: s.masterDelayTime, delayFeedback: s.masterDelayFeedback },
    master: s.master,
    ending: 'exact',
    sampleRate: sr,
    markers: s.markers,
    intensity: { value: s.intensity, curves: s.intensityCurves },
    peakCeilingDbtp: -1,
  });
  const ch = ex.channelsOf(audio);
  let peak = 0;
  for (const c of ch) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  const hop = Math.round(sr * 0.1);
  const levels = [];
  for (let i = 0; i + hop <= ch[0].length; i += hop) {
    let sum = 0;
    for (const c of ch) for (let j = i; j < i + hop; j++) sum += c[j] * c[j];
    levels.push(10 * Math.log10(sum / (hop * ch.length) + 1e-12));
  }
  // (2 s a bar at 120 BPM)
  const secs = (bar) => (bar - from) * 2;
  const loud = [];
  for (let b = from; b + 4 <= to; b += 4) {
    const a = Math.round(secs(b) * sr);
    const z = Math.round(secs(b + 4) * sr);
    loud.push((await measureLoudness(ch.map((c) => c.slice(a, z)), sr)).integrated);
  }
  const whole = await measureLoudness(ch, sr);
  return { peak, truePeak: whole.truePeakMax, levels, loud };
};

/** The biggest rise of a 100 ms level over the loudest of the 3 seconds before it (quiet starts under -50 dB ignored), dB */
const jumpOf = (levels) => {
  let most = -Infinity;
  for (let i = 30; i < levels.length; i++) {
    const before = Math.max(...levels.slice(i - 30, i));
    if (levels[i] > -50) most = Math.max(most, levels[i] - Math.max(before, -50));
  }
  return most;
};

/** Export checks of a song (bars from–to) */
const exported = (name, m) => {
  step(`${name}: no clipping in the export`, m.peak < 1 && m.truePeak <= 0, `peak ${m.peak.toFixed(3)}, true peak ${m.truePeak.toFixed(1)} dBTP`);
  const j = jumpOf(m.levels);
  step(`${name}: no level jump over ${CAP_DB} dB`, j <= CAP_DB, `largest rise over the 3 s before: ${j.toFixed(1)} dB`);
};

/** In the page: what the chills tools should write, to compare with what they did */
const EXPECT = async ({ id, voicing, from, to, chordBars, root, mode, range, repeats }) => {
  const X = await import('/src/store/chills.ts');
  const T = await import('/src/store/timelineStore.ts');
  const K = await import('/src/store/songKey.ts');
  const ST = await import('/src/store/smartTools.ts');
  const s = T.useTimelineStore.getState();
  const key = root === undefined ? (K.detectKey(s.clips.filter((c) => c.trackId !== 't4'), s.tracks) ?? K.keyOf(0, 'major')) : K.keyOf(root, mode);
  const prog = X.chillsById(id);
  let n = 0;
  const notes = chordBars
    ? X.chillsNotes(key, prog, ST.chordSpans(from, X.chillsChords(key, prog).length * (X.playsOnce(prog) ? 1 : repeats ?? 1), chordBars, T.songMeterOf(s)).spans, () => `x${n++}`, { range, voicing })
    : X.chillsFill(key, prog, from, to, T.songMeterOf(s), () => `x${n++}`, { range, voicing });
  return { notes: notes.map((x) => `${x.note}@${x.startOffset}/${x.duration}/${x.velocity}`).sort(), names: X.chillsNames(key, prog, voicing, range).join(' – ') };
};
const notesOf = (p, trackId) =>
  p.evaluate(async (t) => {
    const s = (await import('/src/store/timelineStore.ts')).useTimelineStore.getState();
    const c = s.clips.find((x) => x.trackId === t);
    return c ? { name: c.name, notes: c.notes.map((x) => `${x.note}@${x.startOffset}/${x.duration}/${x.velocity}`).sort() } : null;
  }, trackId);
const toastText = (p) => p.evaluate(async () => (await import('/src/components/timeline/toastStore.ts')).useToast.getState().text ?? '');

/** Plain or rich chords, in the studio's dialog, the piano roll and Pocket */
async function richChecks({ browser, page, store, load, shot, oneStep }) {
  const WT = [36, 96];
  // ---- the dialog ----
  for (const [id, pick] of [['soulTurn', null], ['soulTurn', 'plain'], ['mediant', 'rich'], ['minorHome', null]]) {
    await load(page);
    await page.waitForTimeout(300);
    const before = await page.evaluate(SNAP);
    await page.evaluate(async () => (await import('/src/store/smartActions.ts')).useSmartDialog.setState({ open: { mode: 'chills', trackId: 't4', bar: 9 } }));
    await page.waitForTimeout(250);
    const dialog = page.getByRole('dialog');
    const name = await page.evaluate(async (i) => (await import('/src/store/chills.ts')).chillsById(i).name, id);
    // (another progression first: picking this one goes back to its own way of being voiced)
    await dialog.locator('label', { hasText: id === 'mediant' ? 'The minor iv' : 'A major chord a third away' }).first().click();
    await dialog.getByLabel('Plain or rich chords').selectOption(id === 'mediant' ? 'rich' : 'plain');
    await dialog.locator('label', { hasText: name }).first().click();
    const own = await dialog.getByLabel('Plain or rich chords').inputValue();
    step(`dialog ${id}: starts on its own way (${id === 'mediant' ? 'plain' : 'rich'})`, own === (id === 'mediant' ? 'plain' : 'rich'), own);
    if (pick) await dialog.getByLabel('Plain or rich chords').selectOption(pick);
    const voicing = pick ?? own;
    const shown = await dialog.locator('p', { hasText: ' chords, ' }).last().innerText();
    if (id === 'soulTurn' && !pick) await shot(page, 'studio-chills-rich-dialog');
    const chordBars = id === 'soulTurn' ? 0.5 : 1;
    await dialog.locator('select').filter({ has: page.locator('option[value="0.5"]') }).selectOption(String(chordBars));
    // (the key the dialog shows: the song's)
    const key = await page.evaluate(async () => {
      const K = await import('/src/store/songKey.ts');
      const T = await import('/src/store/timelineStore.ts');
      const s = T.useTimelineStore.getState();
      const k = K.detectKey(s.clips, s.tracks) ?? K.keyOf(0, 'major');
      return { root: k.root, mode: k.mode };
    });
    const want = await page.evaluate(EXPECT, { id, voicing, from: 9, chordBars, ...key, range: WT });
    step(`dialog ${id} ${voicing}: the names shown are the chords written`, shown.startsWith(want.names), `${shown} | ${want.names}`);
    await dialog.getByRole('button', { name: /Make clip at bar/ }).click();
    await page.waitForTimeout(300);
    const got = await notesOf(page, 't4');
    step(`dialog ${id} ${voicing}: the notes as chosen`, !!got && JSON.stringify(got.notes) === JSON.stringify(want.notes) && got.name === name, `${got?.notes.length} notes vs ${want.notes.length}`);
    const t = await toastText(page);
    step(`dialog ${id} ${voicing}: the message names them`, t.includes(want.names), t);
    if (voicing === 'rich') step(`dialog ${id}: rich names`, /maj9|m9|13|m11|7♭9/.test(want.names), want.names);
    await oneStep(page, `dialog ${id} ${voicing}`, before);
  }
  // ---- the piano roll ----
  await load(page);
  await page.waitForTimeout(300);
  for (const [id, pick] of [['soulTurn', null], ['soulTurn', 'plain'], ['pedal', 'rich']]) {
    const clipId = await store((S) => S.getState().createEmptyClip('t4', 9, 8));
    const before = await page.evaluate(SNAP);
    await store((S, i) => S.getState().openEditor(i), clipId);
    await page.waitForSelector('select[aria-label="Chills progression"]', { timeout: 20000 });
    await page.selectOption('select[aria-label="Chills progression"]', 'widening');
    await page.selectOption('select[aria-label="Plain or rich chords"]', id === 'pedal' ? 'rich' : 'plain');
    await page.selectOption('select[aria-label="Chills progression"]', id);
    const own = await page.locator('select[aria-label="Plain or rich chords"]').inputValue();
    step(`piano roll ${id}: starts on its own way`, own === (id === 'pedal' ? 'plain' : 'rich'), own);
    if (pick) await page.selectOption('select[aria-label="Plain or rich chords"]', pick);
    const voicing = pick ?? own;
    if (id === 'soulTurn' && !pick) await shot(page, 'studio-piano-roll-rich');
    await page.locator('[data-search="chills progression peak shiver"] button', { hasText: 'Write' }).click();
    await page.waitForTimeout(300);
    const got = await store((S, i) => S.getState().clips.find((c) => c.id === i).notes.map((x) => `${x.note}@${x.startOffset}/${x.duration}/${x.velocity}`).sort(), clipId);
    // (the piano roll's key: the clip's scale, else the song's; its velocity the roll's)
    const want = await page.evaluate(async ([i, v]) => {
      const X = await import('/src/store/chills.ts');
      const t = (await import('/src/components/timeline/toastStore.ts')).useToast.getState().text ?? '';
      return { t, prog: X.chillsById(i).name, v };
    }, [id, voicing]);
    const names = (want.t.split(': ')[1] ?? '').replace(/\.( Undo| These).*$/, '');
    const keyName = want.t.slice(want.prog.length + 4).split(':')[0];
    const k = await page.evaluate(async (kn) => {
      const names = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
      const minor = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
      const [n, mode] = kn.split(' ');
      return { root: (mode === 'minor' ? minor : names).indexOf(n), mode };
    }, keyName);
    const exp = await page.evaluate(EXPECT, { id, voicing, from: 9, to: 17, ...k, range: WT });
    step(`piano roll ${id} ${voicing}: names in the message match the notes`, names === exp.names, `${names} | ${exp.names}`);
    const pitches = (a) => JSON.stringify(a.map((x) => x.split('/').slice(0, 2).join('/')));
    step(`piano roll ${id} ${voicing}: the notes as chosen`, pitches(got) === pitches(exp.notes), `${got.length} vs ${exp.notes.length}`);
    await oneStep(page, `piano roll ${id} ${voicing}`, before);
    await store((S) => S.getState().closeEditor?.());
    await page.keyboard.press('Escape');
    await store((S) => {
      S.getState().undo();
      S.getState().undo();
    });
  }
  // ---- Pocket ----
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await pctx.addInitScript(() => {
    try {
      localStorage.setItem('bosBeatbox.welcomeSeen', 'true');
    } catch {}
  });
  const pk = await pctx.newPage();
  pk.on('pageerror', (e) => step('Pocket: no page error', false, e.message));
  await pk.goto(APP + '?pocket');
  await pk.waitForTimeout(3000);
  const cont = pk.getByRole('button', { name: 'Continue' });
  if (await cont.count()) await cont.first().click();
  await load(pk);
  await pk.waitForTimeout(800);
  if (await cont.count()) await cont.first().click();
  const pocket = (patch) => pk.evaluate(async (p) => (await import('/src/pocket/pocketStore.ts')).usePocket.getState().set(p), patch);
  for (const [id, chip] of [['soulTurn', null], ['mediant', 'Rich chords'], ['soulTurn', 'Plain chords']]) {
    const before = await pk.evaluate(SNAP);
    await pocket({ trackId: 't4', section: 2, sheet: 'chords' });
    await pk.waitForTimeout(300);
    const d = pk.getByRole('dialog');
    if (chip) await d.getByRole('button', { name: chip, exact: true }).click();
    const name = await pk.evaluate(async (i) => (await import('/src/store/chills.ts')).chillsById(i).name, id);
    const voicing = chip === 'Rich chords' ? 'rich' : chip === 'Plain chords' ? 'plain' : id === 'mediant' ? 'plain' : 'rich';
    const want = await pk.evaluate(EXPECT, { id, voicing, from: 9, to: 13, range: WT });
    const item = d.getByText(name, { exact: true });
    await item.scrollIntoViewIfNeeded();
    const detail = await d.locator('button', { hasText: name }).first().innerText();
    step(`Pocket ${id} ${voicing}: the item names the chords written`, detail.includes(want.names), `${detail.slice(0, 160)} | ${want.names}`);
    if (id === 'mediant') await shot(pk, 'pocket-chills-rich');
    await item.click();
    await pk.waitForTimeout(300);
    const got = await notesOf(pk, 't4');
    step(`Pocket ${id} ${voicing}: the notes as chosen, the same the studio writes`, !!got && JSON.stringify(got.notes) === JSON.stringify(want.notes) && got.name === name, `${got?.notes.length} vs ${want.notes.length}`);
    await oneStep(pk, `Pocket ${id} ${voicing}`, before);
    await pk.evaluate(async () => (await import('/src/store/timelineStore.ts')).useTimelineStore.getState().undo());
  }
  await pctx.close();
}

/** The soul turnaround in F major at 60 BPM, plain and rich, exported as MP3s at the Streaming target, measured */
async function renderNew({ browser }) {
  const fs = require('fs');
  const rows = {};
  for (const voicing of ['plain', 'rich']) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('bosBeatbox.welcomeSeen', 'true');
        localStorage.setItem('bos-beat-box.export-settings', JSON.stringify({ range: 'song', what: 'mixdown', ending: 'ringOut', sampleRate: 44100, format: 'mp3', normalize: true, target: 'streaming', bypassMaster: true }));
      } catch {}
    });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => step('render: no page error', false, e.message));
    await p.goto(APP + '?studio');
    await p.waitForFunction(() => !!document.querySelector('#menu-file'), null, { timeout: 90000 });
    const song = {
      format: 'fledgetone-project', version: 1, name: `Soul turnaround ${voicing}`, bpm: 60, swing: 0,
      loopRegion: { inBar: 1, outBar: 9, enabled: false }, markers: [],
      tracks: [
        { id: 'pad', name: 'Pad', instrumentKey: 'wavetable', volume: -10, pan: 0, reverbSend: 0.15, delaySend: 0 },
        { id: 'sub', name: 'Bass', instrumentKey: 'subBass', volume: -8, pan: 0, reverbSend: 0, delaySend: 0 },
      ],
      clips: [],
    };
    await p.evaluate(async ([sg, v]) => {
      const T = await import('/src/store/timelineStore.ts');
      const P = await import('/src/store/project.ts');
      const A = await import('/src/store/chillsActions.ts');
      const K = await import('/src/store/songKey.ts');
      T.useTimelineStore.getState().loadProject(P.parseProject(sg));
      for (const t of ['pad', 'sub']) A.makeChillsClip(t, 1, 'soulTurn', K.keyOf(5, 'major'), 0.5, 1, v);
    }, [song, voicing]);
    await p.waitForTimeout(500);
    // The pad alone, plain against rich: each chord's loudness (no target), from the app's render
    rows[voicing] = await p.evaluate(async () => {
      const ex = await import('/src/audio/exportWav.ts');
      const { measureLoudness } = await import('/src/audio/loudness.ts');
      const s = (await import('/src/store/timelineStore.ts')).useTimelineStore.getState();
      const sr = 44100;
      const render = async (tracks) => ex.channelsOf(await ex.renderArrangement({ tracks, clips: s.clips, bpm: s.bpm, tempoPoints: s.tempoPoints, swing: s.swing, startBar: 1, endBar: 9, masterFx: { reverbDecay: s.masterReverbDecay, delayTime: s.masterDelayTime, delayFeedback: s.masterDelayFeedback }, master: s.master, ending: 'exact', sampleRate: sr, markers: s.markers, intensity: { value: s.intensity, curves: s.intensityCurves }, peakCeilingDbtp: -1 }));
      const perChord = async (ch) => {
        const out = [];
        for (let k = 0; k < 16; k++) {
          // (2 s a chord; its last 1.5 s, past the attack, and the 3 s up to its end: short-term)
          const a = Math.round((k * 2 + 0.5) * sr);
          const z = Math.round((k + 1) * 2 * sr);
          const st = Math.max(0, z - 3 * sr);
          out.push({ chord: (await measureLoudness(ch.map((c) => c.slice(a, z)), sr)).integrated, shortTerm: (await measureLoudness(ch.map((c) => c.slice(st, z)), sr)).integrated });
        }
        return out;
      };
      const pad = await render(s.tracks.filter((t) => t.id === 'pad'));
      return { pad: await perChord(pad) };
    });
    // The export, through the dialog: MP3 at the Streaming target
    await p.getByRole('button', { name: /Export/ }).filter({ hasText: 'Export' }).first().click();
    await p.waitForTimeout(500);
    const d = p.getByRole('dialog');
    const dl = p.waitForEvent('download', { timeout: 300000 });
    await d.getByRole('button', { name: 'Export', exact: true }).click();
    const file = await dl;
    const out = `${RENDER}/new-${voicing}.mp3`;
    await file.saveAs(out);
    const b64 = fs.readFileSync(out).toString('base64');
    rows[voicing].file = await p.evaluate(async (data) => {
      const { measureLoudness } = await import('/src/audio/loudness.ts');
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const ac = new OfflineAudioContext(2, 44100, 44100);
      const buf = await ac.decodeAudioData(bytes.buffer);
      const sr = buf.sampleRate;
      const ch = [buf.getChannelData(0), buf.getChannelData(1)];
      let peak = 0;
      for (const c of ch) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
      const whole = await measureLoudness(ch, sr);
      const chords = [];
      for (let k = 0; k < 16; k++) {
        const a = Math.round((k * 2 + 0.5) * sr);
        const z = Math.round((k + 1) * 2 * sr);
        const st = Math.max(0, z - 3 * sr);
        chords.push({ chord: (await measureLoudness(ch.map((c) => c.slice(a, z)), sr)).integrated, shortTerm: (await measureLoudness(ch.map((c) => c.slice(st, z)), sr)).integrated });
      }
      return { seconds: buf.duration, integrated: whole.integrated, truePeak: whole.truePeakMax, peak, chords };
    }, b64);
    rows[voicing].toast = await toastText(p);
    await ctx.close();
  }
  const f = (v) => v.toFixed(1);
  for (const v of ['plain', 'rich']) {
    const r = rows[v].file;
    console.log(`${v}: ${RENDER}/new-${v}.mp3 ${r.seconds.toFixed(1)} s, ${f(r.integrated)} LUFS, true peak ${f(r.truePeak)} dBTP, sample peak ${r.peak.toFixed(3)}`);
    console.log(`  per chord (LUFS over each chord): ${r.chords.map((c) => f(c.chord)).join(' ')}`);
    console.log(`  short-term (3 s to each chord's end): ${r.chords.map((c) => f(c.shortTerm)).join(' ')}`);
    console.log(`  pad alone per chord: ${rows[v].pad.map((c) => f(c.chord)).join(' ')}`);
    step(`render ${v}: no clipping`, r.peak < 1 && r.truePeak <= -0.9, `${r.peak.toFixed(3)}, ${f(r.truePeak)} dBTP`);
    // (short-term loudness, 3 s, at each chord's end: no chord more than 1.5 dB over the one before)
    const rise = Math.max(...r.chords.slice(1).map((c, k) => c.shortTerm - r.chords[k].shortTerm));
    step(`render ${v}: no chord more than 1.5 dB over the one before (short-term)`, rise <= 1.5, `${f(rise)} dB`);
    step(`render ${v}: at the Streaming target`, Math.abs(r.integrated + 14) <= 1, `${f(r.integrated)} LUFS`);
  }
  const diffs = rows.rich.pad.map((c, k) => c.chord - rows.plain.pad[k].chord);
  console.log(`  pad alone, rich minus plain per chord, dB: ${diffs.map(f).join(' ')}`);
  step('render: on the pad, no rich chord more than 1.5 dB over the plain one', Math.max(...diffs) <= 1.5, `${f(Math.max(...diffs))} dB most`);
}

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('bosBeatbox.welcomeSeen', 'true');
    } catch {}
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => step('no page error', false, e.message));
  await page.goto(APP + '?studio');
  await page.waitForFunction(() => !!document.querySelector('#menu-file'), null, { timeout: 90000 });
  const load = (p) =>
    p.evaluate(async (song) => {
      const T = await import('/src/store/timelineStore.ts');
      const P = await import('/src/store/project.ts');
      T.useTimelineStore.getState().loadProject(P.parseProject(song));
    }, SONG);
  await load(page);
  await page.waitForTimeout(800);
  const store = (fn, arg) => page.evaluate(async ([f, a]) => new Function('S', 'a', `return (${f})(S, a)`)((await import('/src/store/timelineStore.ts')).useTimelineStore, a), [fn.toString(), arg]);
  const shot = async (p, name, opts = {}) => {
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png`, ...opts });
  };
  /** One user action as one undo step: Undo gives `before` back exactly, Redo `after` */
  const oneStep = async (p, name, before) => {
    const after = await p.evaluate(SNAP);
    step(`${name}: it changed the song`, after !== before);
    await p.evaluate(async () => (await import('/src/store/timelineStore.ts')).useTimelineStore.getState().undo());
    step(`${name}: one Undo gives the song back exactly`, (await p.evaluate(SNAP)) === before);
    await p.evaluate(async () => (await import('/src/store/timelineStore.ts')).useTimelineStore.getState().redo());
    step(`${name}: Redo gives it again`, (await p.evaluate(SNAP)) === after);
  };
  const ids = await page.evaluate(async () => (await import('/src/store/chills.ts')).CHILLS.map((p) => ({ id: p.id, name: p.name })));

  if (!process.env.SKIP_RICH_UI) await richChecks({ browser, page, store, load, shot, oneStep });
  if (RENDER) await renderNew({ browser, store, load });
  if (ONLY_RICH) {
    await browser.close();
    console.log(failures ? `${failures} failed` : 'all passed');
    process.exit(failures ? 1 : 0);
  }

  // ---------- Studio: each chills progression from the dialog ----------
  for (const [i, prog] of ids.entries()) {
    const before = await page.evaluate(SNAP);
    if (i === 0) {
      // Through the lane's right-click menu, on the empty Keys track
      const lane = page.locator('[data-lane="t4"]');
      const box = await lane.boundingBox();
      await page.mouse.click(box.x + 40, box.y + box.height / 2, { button: 'right' });
      await page.waitForTimeout(300);
      await shot(page, 'studio-lane-menu');
      await page.getByRole('menuitem', { name: /Chills progression/ }).click();
    } else {
      // (the dialog at bar 9 on Keys, as the lane's right-click menu opens it there)
      await page.evaluate(async () => (await import('/src/store/smartActions.ts')).useSmartDialog.setState({ open: { mode: 'chills', trackId: 't4', bar: 9 } }));
    }
    await page.waitForTimeout(250);
    const dialog = page.getByRole('dialog');
    await dialog.locator('label', { hasText: prog.name }).first().click();
    if (i === 0) await shot(page, 'studio-chills-dialog');
    await dialog.getByRole('button', { name: /Make clip at bar/ }).click();
    await page.waitForTimeout(250);
    const made = await store((S) => S.getState().clips.filter((c) => c.trackId === 't4').map((c) => ({ start: c.startBar, len: c.lengthBars, notes: c.notes.length, name: c.name })));
    step(`studio ${prog.id}: a clip on Keys`, made.length === 1 && made[0].notes >= 12 && made[0].name === prog.name, JSON.stringify(made));
    await oneStep(page, `studio ${prog.id}`, before);
    const [{ start, len }] = made;
    const m = await page.evaluate(MEASURE, [Math.max(1, start - 2), Math.min(17, start + len)]);
    exported(`studio ${prog.id}`, m);
    await store((S) => S.getState().undo());
  }

  // ---------- Studio: New empty clip from the lane's menu, where the dialogs make theirs ----------
  {
    await store((S) => S.setState({ zoom: 48, snapGrid: '1/16' }));
    await page.waitForTimeout(300);
    const before = await page.evaluate(SNAP);
    const lane = page.locator('[data-lane="t4"]');
    const at = async () => {
      const box = await lane.boundingBox();
      // (14 px into bar 9 at 48 px a bar: 9.25 on the 16th grid)
      await page.mouse.click(box.x + 8 * 48 + 14, box.y + box.height / 2, { button: 'right' });
      await page.waitForTimeout(300);
    };
    await at();
    await page.getByRole('menuitem', { name: /Chills progression/ }).click();
    await page.waitForTimeout(250);
    const says = await page.getByRole('dialog').getByRole('button', { name: /Make clip at bar/ }).innerText();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await at();
    await page.getByRole('menuitem', { name: /New empty clip \(4 bars\)/ }).click();
    await page.waitForTimeout(300);
    const made = await store((S) => S.getState().clips.filter((c) => c.trackId === 't4').map((c) => [c.startBar, c.lengthBars]));
    step('New empty clip starts where the dialogs from the same spot make theirs', says === 'Make clip at bar 9' && made.length === 1 && made[0][0] === 9 && made[0][1] === 4, `${says}; ${JSON.stringify(made)}`);
    await store((S) => S.getState().closeEditor?.());
    await page.keyboard.press('Escape');
    await store((S) => S.getState().undo());
    step('New empty clip: one Undo takes it out exactly', (await page.evaluate(SNAP)) === before);
  }

  // ---------- Studio: the piano roll's CHILLS over a clip ----------
  {
    const clipId = await store((S) => S.getState().createEmptyClip('t4', 9, 4));
    const before = await page.evaluate(SNAP);
    await store((S, id) => S.getState().openEditor(id), clipId);
    await page.waitForSelector('select[aria-label="Chills progression"]', { timeout: 20000 });
    await page.selectOption('select[aria-label="Chills progression"]', 'liftStep');
    await page.locator('[data-search="chills progression peak shiver"] button', { hasText: 'Write' }).click();
    await page.waitForTimeout(300);
    const notes = await store((S, id) => S.getState().clips.find((c) => c.id === id).notes.length, clipId);
    step('piano roll CHILLS: the clip is filled', notes >= 32, `${notes} notes`);
    const named = await store((S, id) => S.getState().clips.find((c) => c.id === id).name, clipId);
    step('piano roll CHILLS: the clip (its name the app\'s) is named after the progression', named === ids.find((p) => p.id === 'liftStep').name, named);
    await shot(page, 'studio-piano-roll-chills');
    await oneStep(page, 'piano roll CHILLS', before);
    exported('piano roll CHILLS', await page.evaluate(MEASURE, [7, 13]));
    await store((S) => S.getState().closeEditor?.());
    await page.keyboard.press('Escape');
    await store((S) => {
      S.getState().undo();
      S.getState().undo();
    });
  }

  // ---------- Studio: a build into a peak from the clips' menu ----------
  {
    const plain = await page.evaluate(MEASURE, [1, 17]);
    exported('studio song before the build', plain);
    const before = await page.evaluate(SNAP);
    await store((S) => {
      const s = S.getState();
      s.selectClip('cp1', false);
      s.selectClip('cd1', true);
      s.selectClip('cb1', true);
    });
    await page.waitForTimeout(200);
    const clip = page.locator('[data-clip-id="cp1"]');
    const box = await clip.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await page.waitForTimeout(300);
    await page.getByRole('menuitem', { name: /Build into a peak/ }).click();
    await page.waitForTimeout(300);
    await shot(page, 'studio-build-dialog');
    // With nothing chosen the button is off
    const boxes = page.getByRole('dialog').locator('input[type="checkbox"]');
    const n = await boxes.count();
    for (let i = 0; i < Math.min(5, n); i++) await boxes.nth(i).uncheck();
    step('studio build: nothing chosen, nothing to make', await page.getByRole('dialog').getByRole('button', { name: 'Make the build' }).isDisabled());
    for (let i = 0; i < Math.min(5, n); i++) await boxes.nth(i).check();
    await page.getByRole('dialog').getByRole('button', { name: 'Make the build' }).click();
    // (the music is measured first, then the build measured again)
    await page.waitForFunction(() => /A build for chills/.test(document.body.innerText), null, { timeout: 180000 });
    const toast = await page.evaluate(() => document.body.innerText.match(/A build for chills[^\n]*/)?.[0] ?? '');
    step('studio build: says what it did, and what the peak measures', /swell/.test(toast) && /Measured, the peak comes out/.test(toast) && /Undo takes it out/.test(toast), toast);
    const lanes = await store((S) => S.getState().tracks.map((t) => ({ id: t.id, name: t.name, lanes: (t.automation ?? []).map((l) => `${l.param}:${l.points.length}`) })));
    const lane = (id, p) => lanes.find((t) => t.id === id)?.lanes.some((l) => l.startsWith(`${p}:`));
    step('studio build: volume lanes on the three tracks', ['t1', 't2', 't3'].every((id) => lane(id, 'volume')), JSON.stringify(lanes));
    step('studio build: filter lanes on the pitched tracks only', lane('t1', 'filterCutoff') && lane('t3', 'filterCutoff') && !lane('t2', 'filterCutoff'));
    step('studio build: a riser and a pad at the peak', lanes.some((t) => t.name === 'Riser') && lanes.some((t) => t.name === 'Peak pad'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await shot(page, 'studio-build-lanes');
    await oneStep(page, 'studio build', before);
    const built = await page.evaluate(MEASURE, [1, 17]);
    exported('studio build', built);
    const [verse, build, peak] = built.loud;
    step(`studio build: the peak no more than ${CAP_DB} dB over the section before the build`, peak - verse <= CAP_DB, `verse ${verse.toFixed(1)}, build ${build.toFixed(1)}, peak ${peak.toFixed(1)} LUFS (before the build: ${plain.loud.map((v) => v.toFixed(1)).join(', ')})`);
    step(`studio build: the peak no more than ${CAP_DB} dB over what it was`, peak - plain.loud[2] <= CAP_DB, `${(peak - plain.loud[2]).toFixed(1)} dB`);
    step('studio build: the build starts quieter than it was', build < plain.loud[1], `${build.toFixed(1)} vs ${plain.loud[1].toFixed(1)} LUFS`);
  }

  // ---------- Pocket ----------
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await pctx.addInitScript(() => {
    try {
      localStorage.setItem('bosBeatbox.welcomeSeen', 'true');
    } catch {}
  });
  const pk = await pctx.newPage();
  pk.on('pageerror', (e) => step('Pocket: no page error', false, e.message));
  await pk.goto(APP + '?pocket');
  await pk.waitForTimeout(3000);
  const cont = pk.getByRole('button', { name: 'Continue' });
  if (await cont.count()) await cont.first().click();
  await load(pk);
  await pk.waitForTimeout(800);
  if (await cont.count()) await cont.first().click();
  const pocket = (patch) => pk.evaluate(async (p) => (await import('/src/pocket/pocketStore.ts')).usePocket.getState().set(p), patch);
  for (const [i, prog] of ids.entries()) {
    const before = await pk.evaluate(SNAP);
    await pocket({ trackId: 't4', section: 2, sheet: 'chords' });
    await pk.waitForTimeout(300);
    const item = pk.getByRole('dialog').getByText(prog.name, { exact: true });
    await item.scrollIntoViewIfNeeded();
    if (i === 0) await shot(pk, 'pocket-chords-sheet');
    await item.click();
    await pk.waitForTimeout(300);
    const made = await pk.evaluate(async () => (await import('/src/store/timelineStore.ts')).useTimelineStore.getState().clips.filter((c) => c.trackId === 't4').map((c) => ({ start: c.startBar, len: c.lengthBars, notes: c.notes.length })));
    step(`Pocket ${prog.id}: the cell is filled`, made.length === 1 && made[0].start === 9 && made[0].len === 4 && made[0].notes >= 12, JSON.stringify(made));
    const named = await pk.evaluate(async () => (await import('/src/store/timelineStore.ts')).useTimelineStore.getState().clips.find((c) => c.trackId === 't4').name);
    step(`Pocket ${prog.id}: the new cell is named after the progression`, named === prog.name, named);
    // The studio's piano roll fills a clip the same way: the same notes
    const same = await pk.evaluate(async (id) => {
      const X = await import('/src/store/chills.ts');
      const T = await import('/src/store/timelineStore.ts');
      const K = await import('/src/store/songKey.ts');
      const C = await import('/src/audio/instrumentCatalog.ts');
      const s = T.useTimelineStore.getState();
      const key = K.detectKey(s.clips.filter((c) => c.trackId !== 't4'), s.tracks) ?? K.keyOf(0, 'major');
      let n = 0;
      const want = X.chillsFill(key, X.chillsById(id), 9, 13, T.songMeterOf(s), () => `x${n++}`, { range: C.INSTRUMENTS.wavetable.range }).map((x) => `${x.note}@${x.startOffset}/${x.duration}`).sort();
      const got = s.clips.find((c) => c.trackId === 't4').notes.map((x) => `${x.note}@${x.startOffset}/${x.duration}`).sort();
      return JSON.stringify(want) === JSON.stringify(got);
    }, prog.id);
    step(`Pocket ${prog.id}: the same notes the studio writes`, same);
    await oneStep(pk, `Pocket ${prog.id}`, before);
    exported(`Pocket ${prog.id}`, await pk.evaluate(MEASURE, [7, 13]));
    await pk.evaluate(async () => (await import('/src/store/timelineStore.ts')).useTimelineStore.getState().undo());
  }
  {
    const before = await pk.evaluate(SNAP);
    await pocket({ sheet: 'section', sheetSection: 2, section: 2 });
    await pk.waitForTimeout(300);
    await shot(pk, 'pocket-section-sheet');
    await pk.getByRole('dialog').getByText('Build for chills into it', { exact: true }).click();
    await pk.waitForFunction(() => /A build for chills/.test(document.body.innerText), null, { timeout: 180000 });
    await shot(pk, 'pocket-after-build');
    const lanes = await pk.evaluate(async () => (await import('/src/store/timelineStore.ts')).useTimelineStore.getState().tracks.map((t) => ({ id: t.id, name: t.name, lanes: (t.automation ?? []).map((l) => l.param) })));
    step('Pocket build: volume lanes, a riser and a pad', ['t1', 't2', 't3'].every((id) => lanes.find((t) => t.id === id).lanes.includes('volume')) && lanes.some((t) => t.name === 'Peak pad'), JSON.stringify(lanes));
    // The same edit as the studio's: the same lanes over the same bars
    const studioLanes = await store((S) => JSON.stringify(S.getState().tracks.filter((t) => ['t1', 't2', 't3'].includes(t.id)).map((t) => t.automation)));
    const pocketLanes = await pk.evaluate(async () => JSON.stringify((await import('/src/store/timelineStore.ts')).useTimelineStore.getState().tracks.filter((t) => ['t1', 't2', 't3'].includes(t.id)).map((t) => t.automation)));
    step('Pocket build: the same lanes as the studio build over the same bars', studioLanes === pocketLanes);
    await oneStep(pk, 'Pocket build', before);
    const m = await pk.evaluate(MEASURE, [1, 17]);
    exported('Pocket build', m);
    const [verse, , peak] = m.loud;
    step(`Pocket build: the peak no more than ${CAP_DB} dB over the section before the build`, peak - verse <= CAP_DB, `${(peak - verse).toFixed(1)} dB`);
  }
  // ---------- Both: a build from the music's level ----------
  {
    // (the studio's build above taken out first: the song as it was)
    await store((S) => S.getState().undo());
    const plain = await page.evaluate(MEASURE, [1, 17]);
    const before = await page.evaluate(SNAP);
    // (back to the studio page: its piano roll and any menu closed, the clip in view)
    await page.bringToFront();
    await store((S) => S.getState().closeEditor?.());
    // (the volume lanes the first build put in view are hidden, a view setting: a right-click reaches the clip)
    await store((S) => S.getState().tracks.forEach((t) => S.getState().showAutomation(t.id, false)));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await store((S) => {
      const s = S.getState();
      s.selectClip('cp1', false);
      s.selectClip('cd1', true);
      s.selectClip('cb1', true);
    });
    const clip = page.locator('[data-clip-id="cp1"]');
    await clip.scrollIntoViewIfNeeded();
    const box = await clip.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await page.waitForTimeout(300);
    await shot(page, 'studio-level-menu');
    await page.getByRole('menuitem', { name: /Build into a peak/ }).click();
    await page.waitForTimeout(300);
    const d = page.getByRole('dialog');
    await d.getByRole('radio', { name: /Start from the music’s level/ }).check();
    await page.waitForTimeout(150);
    await shot(page, 'studio-build-dialog-level');
    const boxes = d.locator('input[type="checkbox"]');
    step('studio level build: Swell and Filter opens are off for it', (await boxes.nth(0).isDisabled()) && (await boxes.nth(1).isDisabled()));
    await d.getByRole('button', { name: 'Make the build' }).click();
    await page.waitForFunction(() => /A build for chills/.test(document.body.innerText), null, { timeout: 180000 });
    const toast = await page.evaluate(() => document.body.innerText.match(/A build for chills[^\n]*/)?.[0] ?? '');
    step('studio level build: says nothing dips first, and what the peak measures', /nothing dips first/.test(toast) && !/swell/.test(toast) && /Measured, the peak comes out/.test(toast), toast);
    const lanes = await store((S) => S.getState().tracks.map((t) => ({ id: t.id, name: t.name, lanes: (t.automation ?? []).map((l) => l.param) })));
    step('studio level build: only volume lanes for the breath, no filter lanes', ['t1', 't2', 't3'].every((id) => { const l = lanes.find((t) => t.id === id).lanes; return l.includes('volume') && !l.includes('filterCutoff'); }), JSON.stringify(lanes));
    await page.keyboard.press('Escape');
    await oneStep(page, 'studio level build', before);
    const built = await page.evaluate(MEASURE, [1, 17]);
    exported('studio level build', built);
    const [verse, build, peak] = built.loud;
    step('studio level build: the bars before the build and the build itself no quieter than they were', verse >= plain.loud[0] - 0.05 && build >= plain.loud[1] - 0.05, `verse ${verse.toFixed(2)} (was ${plain.loud[0].toFixed(2)}), build ${build.toFixed(2)} (was ${plain.loud[1].toFixed(2)}) LUFS`);
    step(`studio level build: the peak no more than ${CAP_DB} dB over the section before the build`, peak - verse <= CAP_DB, `${(peak - verse).toFixed(1)} dB`);
    // Pocket: its own item, the same lanes as the studio's
    await pk.evaluate(async () => (await import('/src/store/timelineStore.ts')).useTimelineStore.getState().undo());
    const pbefore = await pk.evaluate(SNAP);
    await pocket({ sheet: 'section', sheetSection: 2, section: 2 });
    await pk.waitForTimeout(300);
    await shot(pk, 'pocket-section-sheet-level');
    await pk.getByRole('dialog').getByText('Build for chills from the music’s level', { exact: true }).click();
    await pk.waitForFunction(() => /A build for chills/.test(document.body.innerText), null, { timeout: 180000 });
    const studioLanes = await store((S) => JSON.stringify(S.getState().tracks.filter((t) => ['t1', 't2', 't3'].includes(t.id)).map((t) => t.automation)));
    const pocketLanes = await pk.evaluate(async () => JSON.stringify((await import('/src/store/timelineStore.ts')).useTimelineStore.getState().tracks.filter((t) => ['t1', 't2', 't3'].includes(t.id)).map((t) => t.automation)));
    step('Pocket level build: the same lanes as the studio\'s', studioLanes === pocketLanes);
    await oneStep(pk, 'Pocket level build', pbefore);
    exported('Pocket level build', await pk.evaluate(MEASURE, [1, 17]));
  }
  await browser.close();
  console.log(failures ? `${failures} failed` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
