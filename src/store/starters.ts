import type { ProjectSnapshot } from './project';
import { BUILD_UP, DROP_HIT, everyBar, PLUCK_ARP } from './demoSong';
import { clip, D, hats8, master, progression, project, snareRoll, track } from './starterKit';
import { PLAYLIST_BUILDERS } from './startersPlaylist';
import { GAME_BUILDERS } from './startersGame';
import { MORE_GAME_BUILDERS } from './startersGameMore';
import { STORY_BUILDERS } from './startersStory';
import { SHOWCASE_BUILDERS } from './startersShowcase';
import { CLASSICS_BUILDERS } from './startersClassics';
import { starterTrimDb, trimMix } from './startersLoudness';
import { FX_NOTES, INSTRUMENTS, seatOf } from '../audio/instrumentCatalog';
import type { RoomStyle } from '../audio/effects/roomIR';
import type { InstrumentKey } from '../audio/instrumentCatalog';
import { swellLane } from './swell';
import { midiOf, nameOf } from './noteTools';
import { defaultSynthPatch, presetPatch, withPatch } from './synthPatch';
import { barsToDuration, DEFAULT_MASTER_FX, durationToBars, uid, withStableIds } from './timelineTypes';
import { breathe } from './breathe';
import { FOUR_FOUR } from '../audio/tempoMap';
import type { Clip, ClipExpression, MasterFx, MasterSettings, MbcBand, PeqBand, Track } from './timelineTypes';
import type { Step } from './demoSong';

/**
 * Genre starters for the New dialog: a 16-bar arrangement in each style, with its tempo, a
 * mixed set of tracks, sections marked (intro, build, drop...), the loop on the main section and
 * the master set up for the style. Built from data like the demo song, so they are ordinary
 * projects once opened. Steps are 16th notes: offset = step / 16 bars. A starter may name a `sub`
 * group, shown as a heading inside its group in the New dialog.
 */
export const STARTERS = [
  { id: 'overworld', group: 'Game Worlds', name: 'Overworld Adventure', detail: '116 BPM, C major. Game-ready: Explore (harp, flute theme, strings) and Danger (horn hero theme, march, timpani), with layers for Intensity, a fill into Danger and stingers.' },
  { id: 'dungeon', group: 'Game Worlds', name: 'Dungeon Crawl', detail: '84 BPM, D minor. Game-ready: Explore (drone and a music-box lullaby) and Ambush (taiko, cellos, tremolo strings, choir), an impact into the ambush.' },
  { id: 'village', group: 'Game Worlds', name: 'Cozy Village', detail: '100 BPM, F major, swung. Game-ready: Day (guitar, accordion tune, hand drum) and Evening (an ocarina lullaby), crossfading between them.' },
  { id: 'spacestation', group: 'Game Worlds', name: 'Space Station', detail: '105 BPM, E minor. Game-ready: Explore (pluck arp, pad, 80s drum machine) and Alert (Phrygian brass stabs, driving drums), a riser into the alert.' },
  { id: 'racing', group: 'Game Worlds', name: 'Racing', detail: '150 BPM, E minor. Game-ready: Race (rock drums, Reese bass, guitars, supersaws, a hook) and Final Lap, a semitone up and harder.' },
  { id: 'platformer', group: 'Game Worlds', name: 'Platformer', detail: '140 BPM, C major. Game-ready: a bouncy chip Level theme and an echoing Underground in A minor, with item, level-up and game-over stingers.' },
  { id: 'boss', group: 'Game Moments', name: 'Boss Fight', detail: '150 BPM, C minor. Game-ready: Phase 1 (brass riff, guitars, drums), Phase 2 (choir, organ, double-time drums) and Defeated in E flat, a victory stinger into it.' },
  { id: 'stealth', group: 'Game Moments', name: 'Stealth', detail: '96 BPM, B minor. Game-ready: Sneak (a ticking clock, creeping pizzicato, a pulse) and Spotted (drums, brass, strings). Turn Intensity down to sneak.' },
  { id: 'title', group: 'Game Moments', name: 'Title Screen', detail: '76 BPM, D major. Game-ready: a broad horn theme over piano and strings that loops for the title, and a quieter Menu loop.' },
  { id: 'puzzle', group: 'Game Moments', name: 'Puzzle', detail: '100 BPM, F major, swung. Game-ready: Thinking (marimba, pizzicato, bassoon) and Almost There (clarinet, kalimba, hand drum), with a level-up stinger.' },
  { id: 'shop', group: 'Game Moments', name: 'Shop', detail: '112 BPM, G major shuffle. Game-ready: Browse (vibes, electric piano, walking bass, ride) and Bargain (steel drums), with an item stinger.' },
  { id: 'openField', group: 'Game Worlds', name: 'Open Field', detail: '132 BPM, B flat. Game-ready: Explore (horn theme with triplet pickups, harp, march snare, the bVI - bVII - I landing), Idle (strings and harp) and Battle in G minor at the same tempo.' },
  { id: 'cosmicWaltz', group: 'Game Worlds', name: 'Cosmic Waltz', detail: '100 BPM, E flat Lydian, 3/4. Game-ready: Observatory (harp, celesta, oom-pah-pah), Restored (violins, voices, horn layers in) and Flight in 4/4, a step up.' },
  { id: 'bigBandCity', group: 'Game Worlds', name: 'Big Band City', detail: '145 BPM, C, swung 8ths. Game-ready: the Head (saxes in thirds, walking bass, ride) and the Festival a step up with shout brass.' },
  { id: 'quietWorld', group: 'Game Worlds', name: 'Quiet World', detail: '76 BPM, C major. Game-ready: two calm piano cues over maj7 chords with long rests, and a Rest state of near silence between them.' },
  { id: 'wildField', group: 'Game Worlds', name: 'Wild Field', detail: '72 BPM, D pentatonic. Game-ready: Day (piano dabs and whole bars of air), Night (slower, celesta and violins) and Riding (faster, galloping piano).' },
  { id: 'underwaterWaltz', group: 'Game Worlds', name: 'Underwater Waltz', detail: '84 BPM, F Lydian, 3/4. Game-ready: Shore, then Deep: the same music through a low-pass and more reverb (automation on a bus).' },
  { id: 'desertBazaar', group: 'Game Worlds', name: 'Desert Bazaar', detail: '116 BPM, E Phrygian dominant. Game-ready: Market (drone, dulcimer, shehnai, desert hand drums), Ruins at night, and Danger with battle drums.' },
  { id: 'fogTown', group: 'Game Worlds', name: 'Fog Town', detail: '88 BPM, E Phrygian. Game-ready: Fog (drone, static, a warped mandolin, a sparse swung break), Otherworld (a noise wall) and Lament on clean guitar.' },
  { id: 'countdownTown', group: 'Game Moments', name: 'Countdown Town', detail: '112, 124, 140 BPM. Game-ready: one tune over three days, faster each day and darker (major, Dorian, Phrygian), a danger stinger between.' },
  { id: 'saveRoom', group: 'Game Moments', name: 'Save Room', detail: '66 BPM, A minor. Game-ready: Safe (two chords on electric piano and glass pad, a soft piano tune, never quite home) and Uneasy (a low tremolo, a faint heartbeat).' },
  { id: 'cathedralBoss', group: 'Game Moments', name: 'Cathedral Boss', detail: '150 BPM, D harmonic minor, 3/4. Game-ready: Phase 1 (organ, cello ostinato), Phase 2 a half step up with choir and a sudden chord, Phase 3 broken down, and a piano Lament.' },
  { id: 'arenaMetal', group: 'Game Moments', name: 'Arena Metal', detail: '130 BPM, D Phrygian. Game-ready: four combat levels: Exploration, Incidental bursts, Combat riffs and High combat with blast beats and a 7/8 lurch.' },
  { id: 'starlitCity', group: 'Anime & Cartoon', name: 'Starlit City', detail: '84 BPM, D major, breathing tempo. Game-ready: the Theme on grand piano over maj7 and m9 chords (a borrowed iv6 for the bittersweet turn), then a Second Pass re-voiced bigger with a violin answer, strings and brushes.' },
  { id: 'farewellPiano', group: 'Anime & Cartoon', name: 'Farewell Piano', detail: '68 BPM, A minor to C, no drums. Game-ready: Memory (a felt piano, rolling left hand, a 4-3 suspension) and Farewell (the tune on solo violin, cello, strings swelling into bar 8).' },
  { id: 'sunsetDrive', group: 'Anime & Cartoon', name: 'Sunset Drive', detail: '112 BPM, F major. Game-ready: Cruise on the Royal Road (FM piano, chorus guitar chops, slap bass, drum machine) and Dusk, IVmaj7 - III7 - vi7 - I7, softer for a shop.' },
  { id: 'midnightCaper', group: 'Anime & Cartoon', name: 'Midnight Caper', detail: '160 BPM, D Dorian, swung. Game-ready: Prowl (trumpet over a Dm7 - G7 vamp, walking bass, organ) and Chase (minor turnarounds, brass on the and of four, a stop-time break).' },
  { id: 'velvetInfiltration', group: 'Anime & Cartoon', name: 'Velvet Infiltration', detail: '126 BPM, A Dorian, acid jazz. Game-ready: Lobby (an Am9 - D9 vamp, octave slap bass, wah guitar scratches) and Vault (the lead, a bVII - bVI lift, synth strings).' },
  { id: 'wanderersRoad', group: 'Anime & Cartoon', name: "Wanderer's Road", detail: '88 BPM, F major, swung 16ths. Game-ready: Rest (dusty piano on ii9 - V13sus - Imaj9, warm pad, upright bass) and Road (a shakuhachi tune over a lazy boom bap).' },
  { id: 'meadowWaltz', group: 'Anime & Cartoon', name: 'Meadow Waltz', detail: '152 BPM, G major with a Lydian II, 3/4. Game-ready: Meadow (flute, pizzicato oom-pah-pah, a harp glissando into each phrase) and Sky, a step up, with accordion and timpani.' },
  { id: 'championShowdown', group: 'Anime & Cartoon', name: "Champion's Showdown", detail: '150 BPM half time, E minor. Game-ready: Standoff (a 16th string ostinato over a tonic pedal, taiko) and Clash (choir anthem, power chords, choir hits on every bar, rock kit).' },
  { id: 'ruinRequiem', group: 'Anime & Cartoon', name: 'Ruin Requiem', detail: '84 BPM, D minor, i - v - bVI - bIII. Game-ready: Ruins (a piano ostinato, cellos, a low drum on one) and Requiem (wordless voices and strings layered in).' },
  { id: 'neonRitual', group: 'Anime & Cartoon', name: 'Neon Ritual', detail: '98 BPM, E Phrygian. Game-ready: Trance (a drone, a gated glitch arp, a synth choir chant, a silent bar with a stutter) and Drop (bII stabs, processed kick, taiko).' },
  { id: 'dubstep', group: 'Electronic', name: 'Dubstep', detail: '140 BPM, F minor. Half-time drums on a techno kit, a gritty wobble and growl call-and-response over a clean sub, dark pad chords.' },
  { id: 'house', group: 'Electronic', name: 'House', detail: '126 BPM, A minor. Four-on-the-floor on a techno kit, off-beat bass, electric piano ninth stabs, a warm pad and a dark pluck in the peak.' },
  { id: 'trance', group: 'Electronic', name: 'Trance', detail: '138 BPM, A minor, dark. A broken pluck arp, a snare-roll build with a riser, then gated supersaws over a rolling bass.' },
  { id: 'dnb', group: 'Electronic', name: 'Drum & Bass', detail: '174 BPM, F minor. A two-step breakbeat, a gliding Reese over a clean sub, dark ninth pads and a low pluck arp.' },
  { id: 'synthwave', group: 'Electronic', name: 'Synthwave', detail: '100 BPM, A minor. An 80s drum machine with a big room snare, pulsing analog bass, chorused poly pads, a dark pluck arp and a saw lead: night drives.' },
  { id: 'chiptune', group: 'Electronic', name: 'Chiptune', detail: '150 BPM, A minor. 8-bit pulse lead and arpeggios, a bouncing triangle bass and a noise kit in mono, with a sub and a crushed pad behind: retro games.' },
  { id: 'classical', group: 'Orchestral & Choir', name: 'Classical', detail: '92 BPM, D major. A string quartet over a Baroque ground bass, harpsichord continuo, a theme and its variation.' },
  { id: 'angelic', group: 'Orchestral & Choir', name: 'Angelic', detail: '66 BPM, C Lydian. Choir and soft voices, a halo pad, harp and celesta: heaven, healing, sacred places.' },
  { id: 'cinematic', group: 'Orchestral & Choir', name: 'Cinematic', detail: '100 BPM, D minor. Harp and strings, a cello ostinato with taiko building, then French horns and cellos on the theme: title screens.' },
  { id: 'epic', group: 'Orchestral & Choir', name: 'Epic Orchestral', detail: '130 BPM, C minor. Driving cellos, timpani, tremolo strings and choir, then a horn battle theme over low brass and taiko: boss fights.' },
  { id: 'cathedral', group: 'Orchestral & Choir', name: 'Cathedral', detail: '72 BPM, D minor. Organ and a choir on "ooh", a harp rising, then the full choir sings a hymn over strings, timpani and tubular bells.' },
  { id: 'horror', group: 'Orchestral & Choir', name: 'Horror', detail: '72 BPM. An eerie drone, low string clusters, a warped music-box lullaby and timpani, a bar of silence, then a chase.' },
  { id: 'rock', group: 'Band', name: 'Rock', detail: '124 BPM, E minor. A real drum kit through a drum bus with fills, double-tracked power chords, pick bass and organ.' },
  { id: 'metal', group: 'Band', name: 'Metal', detail: '170 BPM, E Phrygian. Double-kick blast beat, twin chugging guitars, then a breakdown with choir.' },
  { id: 'pop', group: 'Band', name: 'Pop', detail: '112 BPM, C major. Piano 8ths, a real drum kit, finger bass, a chorused guitar hook and strings in the chorus.' },
  { id: 'funk', group: 'Band', name: 'Funk', detail: '104 BPM, E9. Ghost-note groove, recorded slap bass, scratchy muted guitar, clavinet, organ and horn hits.' },
  { id: 'jazz', group: 'Band', name: 'Jazz', detail: '132 BPM, swing. Ride cymbal, walking upright bass, piano comping, alto sax and vibes on a ii-V-I.' },
  { id: 'hiphop', group: 'Band', name: 'Hip-Hop', detail: '90 BPM, D minor, boom bap. A swung, dusty breakbeat, electric piano chords, upright bass and a trumpet in the hook.' },
  { id: 'trap', group: 'Band', name: 'Trap', detail: '140 BPM, C minor. Half-time drums with claps, hat rolls and a drop-out, a sliding 808, a low dusty piano over a choir pad.' },
  { id: 'lofi', group: 'Chill & World', name: 'Lo-Fi', detail: '82 BPM, D minor, swung. Electric piano ninths through tape, a dusty breakbeat, upright bass, a flute line and rain: calm levels and menus.' },
  { id: 'ambient', group: 'Chill & World', name: 'Ambient', detail: '70 BPM, D major. Warm and glass pads, a kalimba melody and crystal sparkles: exploring, resting.' },
  { id: 'celtic', group: 'Chill & World', name: 'Celtic', detail: '112 BPM, D major. A fiddle reel over strummed guitar and bodhrán, a tin whistle, then the pipes.' },
  { id: 'tavern', group: 'Chill & World', name: 'Fantasy Tavern', detail: '110 BPM, D minor jig. Hammered dulcimer, lute, hand drum, accordion and recorder: inns and villages.' },
  { id: 'latin', group: 'Chill & World', name: 'Latin', detail: '130 BPM, bossa nova. Nylon guitar comping, upright bass, bongos, shaker and agogô bells, a flute melody.' },
  { id: 'plaza', group: 'Chill & World', name: 'Plaza', detail: '104 BPM, A minor. Congas, bongos, claves and shaker in son clave, a nylon guitar montuno, an upright bass tumbao and a trumpet theme.' },
  { id: 'mbiraMorning', group: 'Chill & World', name: 'Mbira Morning', detail: '96 BPM, D major pentatonic. Two interlocking mbira lines over a didgeridoo drone, folk harp, a balafon answering and hand chimes.' },
  { id: 'eastern', group: 'Chill & World', name: 'Eastern', detail: '84 BPM, D in-scale. Koto, shakuhachi, taiko and shamisen over a glass drone: temples and gardens.' },
  { id: 'artcore', group: 'Artcore & Rhythm Games', name: 'Final Boss Artcore', detail: '174 BPM, D minor. Piano octave lead and violin over chopped jungle breaks, cello and contrabass, choir, taiko; the last drop a semitone up.' },
  { id: 'hardcore', group: 'Artcore & Rhythm Games', name: 'Melodic Hardcore', detail: '180 BPM, E minor. Rhythm-game piano: 16th arpeggios, a stuttered build, then a four-on-the-floor bittersweet Royal Road drop.' },
  { id: 'breakcore', group: 'Artcore & Rhythm Games', name: 'Breakcore', detail: '172 BPM, C# minor. A piano hook over a hardcore beat, then chopped, crushed breakbeats with rolls and a stop-time under electric piano.' },
  { id: 'rpg', group: 'Game Moments', name: 'RPG Battle', detail: '140 BPM, D minor. A hero motif in town on marimba, then a battle on horn and trumpet over strings, rock guitar and taiko, then stacked on brass.' },
  { id: 'metaldub', group: 'Bass Music', name: 'Metal Dubstep', detail: '150 BPM, E Phrygian. Twin guitar riff, then a half-time drop: guitars, driven growl and taiko chugging on every kick, low trombones.' },
  { id: 'melodicdub', group: 'Bass Music', name: 'Melodic Dubstep', detail: '150 BPM, D minor. Piano intro, a quiet build, a wobble drop with off-beat supersaws and a violin and voice hook.' },
  { id: 'riddim', group: 'Bass Music', name: 'Riddim', detail: '140 BPM, G. An organ drone, then a call-and-response of triplet growls and wobbles on two notes, G and Ab.' },
  { id: 'futurebass', group: 'Bass Music', name: 'Kawaii Future Bass', detail: '150 BPM half time, D major. Blooming, pumping add9 chords, a celesta sparkle, a chopped vocal topline doubled on marimba.' },
  { id: 'phonk', group: 'Hip-Hop & Phonk', name: 'Drift Phonk', detail: '130 BPM, D Phrygian. A cowbell riff, 808 on every kick (sliding up at the turn), house drums, a switch a fourth up.' },
  { id: 'drill', group: 'Hip-Hop & Phonk', name: 'UK Drill', detail: '142 BPM, G minor. A dark piano motif over strings and choir, the drill bounce with triplet hats, sliding 808s.' },
  { id: 'rage', group: 'Hip-Hop & Phonk', name: 'Hyper Trap', detail: '160 BPM, F# Phrygian. A wide, blown-out lead, an 808 with grit an octave up, hat rolls and empty space.' },
  { id: 'neosoul', group: 'Hip-Hop & Phonk', name: 'Neo-Soul', detail: '80 BPM, F, swung. Electric piano maj7 chords opening up, alto sax, drums that drag, then a beat switch up a minor third.' },
  { id: 'bedroom', group: 'Pop & Jazz', name: 'Bedroom Pop', detail: '90 BPM, E minor, swung. Chorused clean guitar, a busy bass, lazy drums and a sax line behind the beat.' },
  { id: 'bossa', group: 'Pop & Jazz', name: 'Bossa Jazz-Pop', detail: '82 BPM, Db major. Nylon guitar bossa comping, upright bass, brushes, a flute melody and strings in the chorus.' },
  { id: 'citypop', group: 'Pop & Jazz', name: 'City Pop', detail: '113 BPM, E major. Slap bass, FM piano, cutting guitar, horn hits and a sax theme on the Royal Road.' },
  { id: 'afterHours', group: 'Pop & Jazz', name: 'After Hours', detail: '84 BPM, F major. A late-night ballad: grand piano and upright bass on brushes, then an alto sax theme.' },
  { id: 'theatrical', group: 'Pop & Jazz', name: 'Theatrical Pop', detail: '132 BPM, D minor to F. A line-cliche verse with pizzicato and a music-box motif, then a disco chorus with brass fanfares.' },
  { id: 'raprock', group: 'Band', name: 'Rap-Rock', detail: '154 BPM, G minor. A Phrygian riff over half-time drums, a dead stop, then a double-time chant chorus with low brass.' },
  { id: 'mathrock', group: 'Band', name: 'Math Rock', detail: '150 BPM, E major. Twinkly guitar, tapping in triplets, 3+3+3+3+2+2 accents, then an easycore breakdown.' },
  { id: 'canon', group: 'Classics', name: 'Canon in D (Pachelbel)', detail: '58 BPM, D major, complete (about 4 minutes). The three violins in strict canon over the ground bass: solo Violin, Violin and Viola (Real), the ground on Cello and Contrabass (Real), the sections joining as it grows; legato, a slowing at the end.' },
  { id: 'moonlight', group: 'Classics', name: 'Moonlight Sonata, 1st mvt (Beethoven)', detail: '54 BPM, C sharp minor, complete first movement (about 5 minutes). The concert grand, pianissimo throughout, pedalled with each harmony, the tempo breathing.' },
  { id: 'prelude', group: 'Classics', name: 'Cello Suite No. 1: Prelude (Bach)', detail: '66 BPM, G major, complete (about 2.5 minutes). Solo Cello (Real), the dynamics rising into the held D and through the last climb, rubato and fermatas.' },
  { id: 'mountainKing', group: 'Classics', name: 'In the Hall of the Mountain King (Grieg)', detail: '116 to 240 BPM, B minor, complete (about 2 minutes). For orchestra from Grieg\'s piano version: bassoon and pizzicato, then strings, winds, brass, timpani, gathering speed to the end.' },
  { id: 'clairDeLune', group: 'Classics', name: 'Clair de lune (Debussy)', detail: '58 BPM, D flat major, 9/8, complete (about 5 minutes). The concert grand: hushed thirds, the rubato section warming, rippling arpeggios to the one forte, dying away.' },
] as const;
export type StarterId = (typeof STARTERS)[number]['id'];
export const STARTER_GROUPS = ['Game Worlds', 'Game Moments', 'Anime & Cartoon', 'Electronic', 'Artcore & Rhythm Games', 'Bass Music', 'Orchestral & Choir', 'Hip-Hop & Phonk', 'Pop & Jazz', 'Band', 'Chill & World', 'Classics'] as const;

export const isStarterId = (v: unknown): v is StarterId => STARTERS.some((s) => s.id === v);


// ---------- Mix helpers (the starter manual's toolkit, Part 2) ----------

const lowCut = (freq: number): PeqBand => ({ on: true, type: 'lowcut', freq, gain: 0, q: Math.SQRT1_2 });
const highCut = (freq: number): PeqBand => ({ on: true, type: 'highcut', freq, gain: 0, q: Math.SQRT1_2 });
const bell = (freq: number, gain: number, q = 1): PeqBand => ({ on: true, type: 'bell', freq, gain, q });
const highShelf = (freq: number, gain: number): PeqBand => ({ on: true, type: 'highshelf', freq, gain, q: 0.7 });
/** A Pro EQ with these bands (a fresh copy each call, so no two tracks share one). */
const peq = (...bands: PeqBand[]) => ({ on: true, bands });

/** Pro EQ moves by role (2.7). */
const EQ = {
  /** Sub and 808: the rumble below 25 Hz out, and (on a pure sub) nothing above `top` */
  sub: (top?: number) => peq(lowCut(25), ...(top ? [highCut(top)] : [])),
  /** The anti-chiptune EQ: the beep out of a lead, body in */
  lead: (top = 8000) => peq(lowCut(200), bell(400, 2), bell(3000, -4, 1.5), highCut(top)),
  pad: (top = 8000) => peq(lowCut(180), bell(400, -3), highCut(top)),
  darkPiano: () => peq(lowCut(80), highShelf(6000, -3)),
  guitar: () => peq(lowCut(90), bell(400, -4), bell(3500, -3), highCut(9000)),
  choir: () => peq(lowCut(150), bell(2500, -2)),
  brass: () => peq(lowCut(100), bell(300, 2), highCut(8000)),
  /** Mid bass with grit: kept out of the sub, heard on phones */
  grit: () => peq(lowCut(120), bell(900, 3), highCut(9000)),
  /** A whole kit: no rumble, less cardboard */
  kit: (mud = 400) => peq(lowCut(30), bell(mud, -3)),
};

/** HUMAN (2.4): timing and dynamics `amount` (0 to 1), pitch only where it suits (never piano). */
const human = (amount: number, pitch = 0) => ({ on: true, timing: amount, dynamics: amount, pitch });
/** Dynamics only, on the grid: electronic kits keep their kick and hats in time. */
const humanVel = (amount: number) => ({ on: true, timing: 0, dynamics: amount, pitch: 0 });
/** The drum-bus / kit compressor (2.9). */
const GLUE = { on: true, threshold: -18, ratio: 4, makeup: 2 };
/** Multiband for growls and wobbles (2.5): the fizz held down, the low end evened out. */
const TAME_FIZZ = {
  on: true,
  bands: [{ threshold: -24, ratio: 2, gain: 1 }, { threshold: -20, ratio: 2.5, gain: 1 }, { threshold: -24, ratio: 4, gain: 0 }] as [MbcBand, MbcBand, MbcBand],
};
/** LO-FI crush in bits (16 clean, 3 gritty). */
const bits = (n: number) => (16 - n) / 13;

/** A shared "dark room" return (2.9): one dark reverb that leads, pads and snares send to. */
const darkRoom = () => track('Dark room', 'return', { fx: { reverb: { on: true, decay: 1.6, preDelay: 30, tone: 4000, mix: 1 } } });
/** A drum bus (2.9): glue, a little grit, less boxiness. Drum tracks play into it with `output`. */
const drumBus = () => track('Drum bus', 'bus', { fx: { compressor: GLUE, distortion: { on: true, amount: 0.12 }, peq: peq(bell(400, -2)) } });
const sendTo = (ret: Track, level: number) => [{ to: ret.id, level }];

/** Master reverb lengths (the Master tab's spaces) and the project's shared reverb / delay. */
const ROOM = 1, STUDIO = 1.8, HALL = 3.2, CATHEDRAL = 7, HEAVEN = 11;
const inSpace = (p: ProjectSnapshot, reverbDecay: number, delay?: Pick<MasterFx, 'delayTime' | 'delayFeedback'>): ProjectSnapshot => ({ ...p, masterFx: { ...DEFAULT_MASTER_FX, ...p.masterFx, ...delay, reverbDecay } });
/** OTT "Time fast" (2.10). */
const FAST = 0.15;

/** The drop hit without its sub drop (2.8): only the impact and the downlifter. */
const IMPACT: Step[] = DROP_HIT.filter(([, n]) => n !== FX_NOTES.subDrop);

// ---------- Note helpers ----------

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** A note moved by `semis` semitones ("A#2" + 7 = "F3"). */
function transpose(note: string, semis: number): string {
  const m = /^([A-G]#?)(-?\d)$/.exec(note);
  if (!m) return note;
  const i = NOTE_NAMES.indexOf(m[1]) + Number(m[2]) * 12 + semis;
  return `${NOTE_NAMES[((i % 12) + 12) % 12]}${Math.floor(i / 12)}`;
}
/** Every note of a melodic part `n` octaves up (or down). */
const octave = (steps: Step[], n: number): Step[] => steps.map(([s, notes, v, d]): Step => [s, Array.isArray(notes) ? notes.map((x) => transpose(x, 12 * n)) : transpose(notes, 12 * n), v, d]);
/** A power chord: root, fifth and octave. */
const power = (root: string) => [root, transpose(root, 7), transpose(root, 12)];
/** A chord strummed (TOOLS -> Strum): each string `gap` 16ths after the last; upstrokes start at the top. */
const strum = (at: number, notes: string[], vel: number, dur: string, gap = 0.06, up = false): Step[] => (up ? [...notes].reverse() : notes).map((n, i): Step => [at + i * gap, n, vel, dur]);
/** Notes held a 16th past their length (TOOLS -> Legato): lines connect, mono synths slide. */
const legato = (steps: Step[]): Step[] => steps.map(([s, n, v, d = '16n']): Step => [s, n, v, `0:0:${durationToBars(d) * 16 + 1}`]);
/** A clip with controller lanes: mod wheel vibrato, pitch bend, the sustain pedal. */
const withLanes = (c: Clip, expression: ClipExpression): Clip => ({ ...c, expression });
/** Light mod-wheel vibrato for the whole clip. */
const VIBRATO: ClipExpression = { vibrato: [{ at: 0, value: 0.3 }] };

// ---------- Synth Designer patches (2.6) ----------

const designer = (edit: Parameters<typeof withPatch>[1]) => withPatch(defaultSynthPatch(), edit);
/** A. Night Reese: two detuned saws, a driven low-pass, mono with glide. */
const NIGHT_REESE = () => designer({
  osc2: { on: true, wave: 'sawtooth', fine: 10, level: 0.8 },
  unison: { voices: 3, spread: 20, width: 0.5 },
  filter: { cutoff: 500, resonance: 1, envAmount: 1, keyTrack: 0.5 },
  filterEnv: { attack: 0.001, decay: 0.4, sustain: 0.4, release: 0.2 },
  amp: { attack: 0.005, decay: 0.3, sustain: 1, release: 0.15 },
  drive: 0.15, mono: true, glide: 0.06, level: 0,
});
/** B. Dark Pluck: replaces the bright Pluck. Play it between C3 and C5. */
const DARK_PLUCK = () => designer({
  osc2: { on: true, wave: 'square', semi: -12, level: 0.4 },
  unison: { voices: 3, spread: 10, width: 0.6 },
  filter: { cutoff: 600, resonance: 2, envAmount: 2.5, keyTrack: 0.5 },
  filterEnv: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.2 },
  amp: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.3 },
  drive: 0.2, level: -3,
});
/** D. Dark Supersaw: chords that swell instead of buzzing. */
const DARK_SUPERSAW = () => withPatch(presetPatch('Supersaw lead'), {
  osc2: { on: true, wave: 'sawtooth', octave: 0, fine: -12, level: 0.6 },
  unison: { voices: 5, spread: 18, width: 0.8 },
  filter: { cutoff: 2000, envAmount: 1, resonance: 0.8 },
  filterEnv: { attack: 0.15, decay: 1, sustain: 0.5, release: 0.5 },
  amp: { attack: 0.02, decay: 0.3, sustain: 0.9, release: 0.5 },
  level: -2,
});
/** G. Dark Pad: slow, wide and low-passed, breathing on a slow LFO. */
const DARK_PAD = () => designer({
  osc2: { on: true, wave: 'triangle', semi: 12, level: 0.5 },
  unison: { voices: 3, spread: 18, width: 0.9 },
  filter: { cutoff: 900, envAmount: 0.5, resonance: 0.8 },
  filterEnv: { attack: 1.5, decay: 1.5, sustain: 0.7, release: 2 },
  amp: { attack: 0.8, decay: 1, sustain: 0.9, release: 2.5 },
  lfo: { target: 'filter', shape: 'sine', sync: 'free', rate: 0.15, depth: 0.2 },
  level: -6,
});
/** Trance's rolling bass: a saw plucked shut by its filter, one note at a time. */
const ROLLING_BASS = () => designer({
  filter: { cutoff: 400, envAmount: 2, resonance: 1.5, keyTrack: 0.3 },
  filterEnv: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.1 },
  amp: { attack: 0.003, decay: 0.2, sustain: 0.6, release: 0.06 },
  mono: true, glide: 0, level: 0,
});

// ---------- Dubstep ----------

function dubstep(): ProjectSnapshot {
  const room = darkRoom();
  // (4 dB under where they were: they stood 6 dB over the wobble and growl, their peaks 10 dB over)
  const drums = track('Drums', 'technoKit', { volume: -8, reverbSend: 0.08, fx: { peq: EQ.kit(350), compressor: GLUE, distortion: { on: true, amount: 0.12 } } });
  const sub = track('Sub', 'subBass', { volume: -10, fx: { peq: EQ.sub(150), pump: { on: true, depth: 0.6, release: 150, trigger: 'kick' } } });
  const wobble = track('Wobble', 'wobbleBass', { volume: -6, fx: { peq: peq(lowCut(120), bell(900, 3), highCut(10000)), distortion: { on: true, amount: 0.1 }, mbc: TAME_FIZZ } });
  const growl = track('Growl', 'growlBass', { volume: -7, fx: { peq: peq(lowCut(120), highCut(9000)), distortion: { on: true, amount: 0.1 } } });
  // The Dark Pad, gated to 16ths in the last bar before the drop only
  const pad = track('Pad', 'synthDesigner', {
    volume: -14,
    synth: DARK_PAD(),
    sends: sendTo(room, 0.3),
    fx: { peq: peq(lowCut(200), highCut(6000)), pump: { on: true, depth: 0.5, release: 220, trigger: 'kick' }, gate: { on: true, rate: '1/16', depth: 0, length: 0.5 } },
    automation: [{ param: 'fx:gate.depth', points: [{ bar: 8, value: 0 }, { bar: 8, value: 1 }, { bar: 9, value: 1 }, { bar: 9, value: 0 }] }],
  });
  const atmos = track('Atmos', 'goblins', { volume: -22, sends: sendTo(room, 0.4), fx: { peq: peq(lowCut(300)) } });
  const sfx = track('FX', 'fx', { volume: -16, reverbSend: 0.2 });
  // Fm(add9) - Db(maj7, no 3rd) - Bbm - Csus4, two bars each: no major thirds, no major V
  const chords: Step[] = [
    [0, ['F3', 'C4', 'G4', 'G#4'], 0.6, '2m'], [32, ['C#3', 'G#3', 'C4'], 0.6, '2m'],
    [64, ['A#2', 'F3', 'C#4'], 0.6, '2m'], [96, ['C3', 'F3', 'G3'], 0.6, '2m'],
  ];
  // The drop, a two-bar half-time pattern with a clap on the snare and a ghost before the turn
  const dropBeat: Step[] = [
    [0, D.kick, 0.85], [10, D.kick, 0.7], [8, D.snare, 0.9], [8, D.clap, 0.6],
    [2, D.closedHat, 0.55], [6, D.closedHat, 0.4], [10, D.closedHat, 0.5], [14, D.openHat, 0.45],
    [16, D.kick, 0.85], [23, D.kick, 0.65], [26, D.kick, 0.7], [24, D.snare, 0.9], [24, D.clap, 0.6], [31, D.snare, 0.3],
    [18, D.closedHat, 0.55], [22, D.closedHat, 0.4], [26, D.closedHat, 0.5], [30, D.closedHat, 0.4],
  ];
  // Call on the wobble (sliding up a half step, then down from C2), answered by the growl with the tritone (B)
  const wobbleA: Step[] = [[0, 'F1', 0.85, '0:0:6'], [5, 'F#1', 0.8, '0:0:3']];
  const wobbleB: Step[] = [[0, 'C2', 0.85, '0:0:4'], [3, 'B1', 0.8, '0:0:5']];
  const growlA: Step[] = [[12, 'F1', 0.85], [13, 'F1', 0.7], [14, 'B1', 0.8, '8n']];
  const growlB: Step[] = [[12, 'F1', 0.85], [13, 'F#1', 0.7], [14, 'F1', 0.75], [15, 'D#1', 0.8]];
  // Every other pair of bars the WOBBLE rates change, so the drop keeps moving
  const drop = [9, 11, 13, 15].flatMap((bar, i) => [
    clip(wobble, 'Wobble', bar, 1, wobbleA, 1, i % 2 ? '1/16T' : '1/8'),
    clip(wobble, 'Wobble', bar + 1, 1, wobbleB, 1, i % 2 ? '1/2' : '1/4'),
    clip(growl, 'Growl', bar, 1, growlA, 1, '1/16'),
    clip(growl, 'Growl', bar + 1, 1, growlB, 1, '1/16T'),
  ]);
  return inSpace(project(
    'Dubstep starter',
    140,
    0,
    [9, 17],
    [drums, sub, wobble, growl, pad, atmos, sfx, room],
    [
      clip(drums, 'Hats', 1, 4, hats8(4, 0.45)),
      clip(drums, 'Snare roll', 5, 4, snareRoll),
      clip(drums, 'Half-time', 9, 2, dropBeat, 4),
      clip(sub, 'Sub', 9, 1, [[0, 'F1', 0.7, '1n']], 8),
      ...drop,
      clip(pad, 'Chords', 1, 8, chords, 2),
      clip(atmos, 'Atmos', 1, 4, [[0, ['F2', 'C3'], 0.5, '4m']], 2),
      clip(sfx, 'Build-up', 5, 4, BUILD_UP),
      clip(sfx, 'Drop hit', 9, 2, IMPACT),
    ],
    [[1, 'Intro'], [5, 'Build'], [9, 'Drop']],
    master({ on: true, depth: 0.3, time: FAST }, { on: true, amount: 1.25 })
  ), STUDIO);
}

// ---------- House ----------

function house(): ProjectSnapshot {
  const room = darkRoom();
  const drums = track('Drums', 'technoKit', { volume: -4, reverbSend: 0.05, fx: { peq: peq(lowCut(30)), compressor: GLUE, human: humanVel(0.15) } });
  const bass = track('Bass', 'synthBass2', { volume: -6, fx: { peq: peq(lowCut(35)), pump: { on: true, depth: 0.4, release: 200, trigger: 'kick' } } });
  const stabs = track('Stabs', 'rhodes', {
    volume: -11.5, delaySend: 0.1, sends: sendTo(room, 0.2),
    fx: { peq: peq(lowCut(150), highCut(9000)), pump: { on: true, depth: 0.5, release: 220, trigger: 'kick' }, chorus: { on: true, rate: 0.8, depth: 0.5, mix: 0.2 }, human: human(0.2) },
  });
  const pad = track('Pad', 'warmPad', { volume: -18, reverbSend: 0.3, fx: { peq: peq(lowCut(200)), pump: { on: true, depth: 0.6, release: 260, trigger: 'kick' } } });
  const arp = track('Arp', 'synthDesigner', { volume: -14, synth: DARK_PLUCK(), delaySend: 0.2, pan: 0.15, sends: sendTo(room, 0.15), fx: { peq: EQ.lead(7000), human: human(0.15) } });
  const fourOnFloor = (clap: boolean) =>
    everyBar(1, (): Step[] => [
      ...[0, 4, 8, 12].map((s): Step => [s, D.kick, s === 0 ? 0.85 : 0.75]),
      ...[2, 6, 10, 14].map((s): Step => [s, D.openHat, 0.45]),
      ...[1, 3, 5, 7, 9, 11, 13, 15].map((s, i): Step => [s, D.closedHat, i % 2 ? 0.3 : 0.4]),
      ...(clap ? [[4, D.clap, 0.8] as Step, [12, D.clap, 0.85] as Step] : []),
    ]);
  // Am9 - Dm9 - Fmaj9 - Em7, a bar each, rootless (the bass has the root): stabs on steps 3, 8 and 11
  const roots = ['A1', 'D2', 'F1', 'E1'];
  const chords = [['G3', 'B3', 'C4', 'E4'], ['F3', 'A3', 'C4', 'E4'], ['E3', 'G3', 'A3', 'C4'], ['G3', 'B3', 'D4']];
  const bassLine = everyBar(4, (b) => [2, 6, 10, 14].map((s): Step => [s, roots[b], s === 2 ? 0.85 : 0.7, '8n']));
  const stabLine = everyBar(4, (b) => [[2, chords[b], 0.75, '8n'] as Step, [7, chords[b], 0.55, '8n'] as Step, [10, chords[b], 0.65, '8n'] as Step]);
  const padLine = progression(chords, 16, '1n', 0.5);
  // A broken arp: every 4th note left out so it breathes, accents on the beat
  const arpLine = everyBar(4, (b) => Array.from({ length: 16 }, (_, i): Step => [i, chords[b][(i * 3) % chords[b].length], i % 4 === 0 ? 0.75 : 0.5]).filter(([s]) => s % 4 !== 3));
  return inSpace(project(
    'House starter',
    126,
    0.1,
    [5, 17],
    [drums, bass, stabs, pad, arp, room],
    [
      clip(drums, 'Kick & hats', 1, 1, fourOnFloor(false), 4),
      clip(drums, 'Groove', 5, 1, fourOnFloor(true), 12),
      clip(bass, 'Bass', 5, 4, bassLine, 3),
      clip(stabs, 'Stabs', 1, 4, stabLine, 4),
      clip(pad, 'Pad', 5, 4, padLine, 3),
      clip(arp, 'Arp', 13, 4, arpLine),
    ],
    [[1, 'Intro'], [5, 'Groove'], [13, 'Peak']],
    master({ on: true, depth: 0.2 }, { on: true, amount: 1.2 })
  ), STUDIO);
}

// ---------- Drum & Bass ----------

function dnb(): ProjectSnapshot {
  const room = darkRoom();
  const drums = track('Breaks', 'breakbeatKit', { volume: -3, reverbSend: 0.08, fx: { peq: EQ.kit(), compressor: GLUE, distortion: { on: true, amount: 0.12 }, human: human(0.1) } });
  // The Night Reese, its insert filter opening over each four bars
  const reese = track('Reese', 'synthDesigner', {
    volume: -8,
    synth: NIGHT_REESE(),
    fx: { peq: peq(lowCut(100)), distortion: { on: true, amount: 0.3 }, chorus: { on: true, rate: 0.5, depth: 0.5, mix: 0.2 }, filter: { on: true, type: 'lowpass', cutoff: 1500 } },
    automation: [{ param: 'filterCutoff', points: [{ bar: 9, value: 0.45 }, { bar: 13, value: 0.75 }, { bar: 13, value: 0.45 }, { bar: 17, value: 0.75 }] }],
  });
  const sub = track('Sub', 'subBass', { volume: -10, fx: { peq: EQ.sub(100) } });
  const pad = track('Pad', 'soundtrackPad', { volume: -16, sends: sendTo(room, 0.35), fx: { peq: EQ.pad(7000) } });
  const atmos = track('Atmos', 'sciFi', { volume: -22, reverbSend: 0.4, fx: { peq: peq(lowCut(300)) } });
  const arp = track('Arp', 'synthDesigner', { volume: -14, synth: DARK_PLUCK(), delaySend: 0.3, pan: -0.15, sends: sendTo(room, 0.2), fx: { peq: EQ.lead(7000), human: human(0.15) } });
  const sfx = track('FX', 'fx', { volume: -16, reverbSend: 0.2 });
  // Two-step: kick on 1 and the "and" of 3, snares on 2 and 4 with ghosts, hats that vary
  const twoStep = everyBar(1, (): Step[] => [
    [0, D.kick, 0.85], [10, D.kick, 0.7], [4, D.snare, 0.9], [12, D.snare, 0.9], [7, D.snare, 0.3], [15, D.snare, 0.28],
    ...[0.6, 0.35, 0.5, 0.4, 0.55, 0.35, 0.5, 0.45].map((v, i): Step => [i * 2, D.closedHat, v]),
  ]);
  // F (two bars) - Ab - G - Eb: long notes that overlap slide; the sub copies the roots
  const reeseLine: Step[] = [[0, 'F1', 0.85, '2:0:1'], [32, 'G#1', 0.8, '0:2:1'], [40, 'G1', 0.8, '0:2:1'], [48, 'D#1', 0.85, '1n']];
  const subLine: Step[] = [[0, 'F1', 0.7, '2m'], [32, 'G#1', 0.65, '2n'], [40, 'G1', 0.65, '2n'], [48, 'D#1', 0.7, '1n']];
  // Fm9 - Dbmaj7(#11) - Bbm9 - Csus4: no bright major triads
  const chords = progression([['F3', 'G#3', 'D#4', 'G4'], ['C#3', 'G#3', 'C4', 'G4'], ['A#2', 'C#3', 'G#3', 'C4'], ['C3', 'F3', 'G3']], 16, '1n', 0.6);
  // The pluck arp an octave down, every 4th note left out
  const arpLine = octave(PLUCK_ARP, -1).filter((_, i) => i % 4 !== 3).map(([s, n, v, d], i): Step => [s, n, i % 3 ? v * 0.7 : v * 0.85, d]);
  return inSpace(project(
    'Drum & Bass starter',
    174,
    0,
    [9, 17],
    [drums, reese, sub, pad, atmos, arp, sfx, room],
    [
      clip(drums, 'Hats', 1, 4, hats8(4, 0.4)),
      clip(drums, 'Snare roll', 5, 4, snareRoll),
      clip(drums, 'Two-step', 9, 1, twoStep, 8),
      clip(reese, 'Reese', 9, 4, reeseLine, 2),
      clip(sub, 'Sub', 9, 4, subLine, 2),
      clip(pad, 'Pad', 1, 4, chords, 4),
      clip(atmos, 'Atmos', 1, 8, [[0, ['F3', 'C4'], 0.5, '8m']]),
      clip(arp, 'Arp', 5, 2, arpLine, 2),
      clip(arp, 'Arp', 13, 2, arpLine, 2),
      clip(sfx, 'Build-up', 5, 4, BUILD_UP),
      clip(sfx, 'Drop hit', 9, 2, IMPACT),
    ],
    [[1, 'Intro'], [5, 'Build'], [9, 'Drop']],
    master({ on: true, depth: 0.3, time: FAST }, { on: true, amount: 1.25 })
  ), STUDIO);
}

// ---------- Trap ----------

function trap(): ProjectSnapshot {
  const room = darkRoom();
  // The 808 kit is right for trap; HUMAN stays off (hats are programmed, not played)
  // The drums 6 dB under where they were: they stood 15 dB over the 808, the piano and the pad
  const drums = track('Drums', 'drumMachine', { volume: -10, reverbSend: 0.05, fx: { peq: peq(lowCut(30), highCut(13000)), compressor: GLUE } });
  const bass = track('808', 'bass808', { volume: -8, fx: { peq: peq(lowCut(28)), mbc: { on: true, bands: [{ threshold: -20, ratio: 2, gain: 0 }, { threshold: -20, ratio: 1.5, gain: 0 }, { threshold: -20, ratio: 1.5, gain: 0 }] } } });
  // A quiet, low, dusty piano instead of a bright pluck with delay (a ringtone)
  const melody = track('Melody', 'piano', {
    volume: -8, sends: sendTo(room, 0.3),
    fx: { peq: peq(lowCut(150), highShelf(5000, -4)), lofi: { on: true, crush: bits(12), tone: 5000, wow: 0.15, mix: 0.35 }, human: human(0.2) },
  });
  const pad = track('Pad', 'choirPad', { volume: -18, reverbSend: 0.35, fx: { peq: peq(lowCut(200), highCut(6000)) } });
  // Bar A: 8th hats with a 1/32 roll into beat 4's "and"; bar B: a 1/16T triplet burst and an open hat
  const hatA: Step[] = [...[0, 2, 4, 6, 8, 10, 12].map((s, i): Step => [s, D.closedHat, i % 2 ? 0.4 : 0.6]), ...[14, 14.5, 15, 15.5].map((s, i): Step => [s, D.closedHat, 0.4 + i * 0.07, '32n'])];
  const hatB: Step[] = [...[0, 2, 4, 6, 8, 10].map((s, i): Step => [s, D.closedHat, i % 2 ? 0.4 : 0.6]), ...[12, 12 + 4 / 3, 12 + 8 / 3].map((s, i): Step => [s, D.closedHat, 0.45 + i * 0.07, '16t']), [15, D.openHat, 0.45]];
  const kickA: Step[] = [[0, D.kick, 0.85], [7, D.kick, 0.7], [10, D.kick, 0.7]];
  const kickB: Step[] = [[0, D.kick, 0.85], [2, D.kick, 0.7], [10, D.kick, 0.75], [13, D.kick, 0.65]];
  const backbeat: Step[] = [[8, D.snare, 0.9], [8, D.clap, 0.75]];
  const hats = everyBar(4, (b) => (b % 2 ? hatB : hatA));
  const beat = everyBar(4, (b) => [...(b % 2 ? kickB : kickA), ...backbeat, ...(b % 2 ? hatB : hatA)]);
  // The 808 follows the kick on the chord roots (C, Ab, F, Db); the C2 at the end slides down into the loop
  const roots = ['C1', 'G#1', 'F1', 'C#1'];
  const slide = everyBar(4, (b): Step[] => {
    const r = roots[b];
    return b % 2 === 0
      ? [[0, r, 0.8, '4n.'], [7, r, 0.65, '8n.'], [10, r, 0.7, '4n.']]
      : [[0, r, 0.8, '8n'], [2, r, 0.65, '2n'], [10, r, 0.7, '8n.'], [13, r, 0.6, '16n'], ...(b === 3 ? [[14, 'C2', 0.6, '8n.'] as Step] : [])];
  });
  // Low and sparse (A#3 to G#4), ending on the b2 over Db
  const tune: Step[] = [
    [0, 'G4', 0.75, '8n'], [3, 'D#4', 0.6, '8n'], [6, 'D4', 0.55, '8n'], [8, 'C4', 0.7, '4n.'],
    [24, 'D#4', 0.65, '8n'], [26, 'D4', 0.55, '8n'], [28, 'A#3', 0.6, '4n'],
    [32, 'G4', 0.8, '8n'], [35, 'G#4', 0.65, '8n'], [38, 'G4', 0.6, '8n'], [40, 'D#4', 0.7, '2n'],
    [48, 'C#4', 0.7, '4n'], [52, 'C4', 0.6, '2n.'],
  ];
  // Cm(add9) - Abmaj7 - Fm9 - Dbmaj7 (the bII instead of a happy G major), a bar each
  const padChords = progression([['C3', 'G3', 'D4', 'D#4'], ['G#2', 'D#3', 'G3', 'C4'], ['F2', 'G#3', 'D#4', 'G4'], ['C#3', 'G#3', 'C4', 'F4']], 16, '1n', 0.6);
  // Bar 12 is empty (only the melody and pad): the drop-out before the switch-up
  const firstThree = (steps: Step[]) => steps.filter(([s]) => s < 48);
  return inSpace(project(
    'Trap starter',
    140,
    0,
    [5, 17],
    [drums, bass, melody, pad, room],
    [
      clip(drums, 'Hats', 1, 4, hats),
      clip(drums, 'Beat', 5, 4, beat),
      clip(drums, 'Beat', 9, 3, firstThree(beat)),
      clip(drums, 'Beat', 13, 4, beat),
      clip(bass, '808', 5, 4, slide),
      clip(bass, '808', 9, 3, firstThree(slide)),
      clip(bass, '808', 13, 4, slide),
      clip(melody, 'Melody', 1, 4, tune, 4),
      clip(pad, 'Pad', 1, 4, padChords, 4),
    ],
    [[1, 'Intro'], [5, 'Hook'], [13, 'Switch-up']],
    master({ on: true, depth: 0.15 }, { on: true, amount: 1.15 })
  ), ROOM);
}

// ---------- Cinematic ----------

function cinematic(): ProjectSnapshot {
  const harp = track('Harp', 'harp', { volume: -8, reverbSend: 0.45, pan: -0.2, fx: { human: human(0.3) } });
  const strings = track('Strings', 'strings', { volume: -15, reverbSend: 0.55, pan: -0.3, fx: { peq: EQ.pad(), human: human(0.35, 0.3) } });
  const pad = track('Soundtrack', 'soundtrackPad', { volume: -18, reverbSend: 0.4, fx: { peq: EQ.pad(7000) } });
  const cello = track('Cello', 'cello', { volume: -6, reverbSend: 0.45, pan: 0.2, fx: { peq: peq(lowCut(40)), human: human(0.3, 0.3) } });
  const celloTheme = track('Cello theme', 'cello', { volume: -8, reverbSend: 0.45, pan: 0.25, fx: { peq: peq(lowCut(40)), human: human(0.35, 0.3) } });
  const horns = track('Horns', 'frenchHorn', { volume: -4, reverbSend: 0.5, pan: -0.25, fx: { peq: EQ.brass(), human: human(0.3, 0.25) } });
  const taiko = track('Taiko', 'taiko', { volume: -5, reverbSend: 0.4, fx: { human: human(0.15) } });
  const sfx = track('FX', 'fx', { volume: -16, reverbSend: 0.3 });
  // Dm - Bb - Gm - Asus4 -> Am, a bar each: the phrase ends darkly, not on a major V
  const chords: Step[] = [
    [0, ['D3', 'F3', 'A3', 'D4'], 0.7, '1n'],
    [16, ['A#2', 'D3', 'F3', 'A#3'], 0.7, '1n'],
    [32, ['G2', 'A#2', 'D3', 'G3'], 0.7, '1n'],
    [48, ['A2', 'D3', 'E3', 'A3'], 0.75, '2n'], [56, ['A2', 'C3', 'E3', 'A3'], 0.7, '2n'],
  ];
  const roots = ['D', 'A#', 'G', 'A'];
  const thirds = ['F', 'D', 'A#', 'C'];
  const fifths = ['A', 'F', 'D', 'E'];
  const arp = everyBar(4, (b) => [0, 2, 4, 6, 8, 10, 12, 14].map((s, i): Step => [s, `${[roots, fifths, thirds, fifths][i % 4][b]}${i < 4 ? 4 : 5}`, i % 4 === 0 ? 0.7 : 0.5, '8n']));
  const drone = progression([['D3', 'A3'], ['A#2', 'F3'], ['G2', 'D3'], ['A2', 'E3']], 16, '1n', 0.5);
  // Driving 8ths on the root, accented, an octave jump on the last two
  const ostinato = everyBar(4, (b) => Array.from({ length: 8 }, (_, i): Step => [i * 2, `${roots[b]}${i >= 6 ? 3 : 2}`, i % 2 ? 0.55 : 0.85, '8n']));
  const theme: Step[] = [
    [0, 'D4', 0.85, '4n.'], [6, 'E4', 0.75, '8n'], [8, 'F4', 0.8, '2n'],
    [16, 'F4', 0.85, '4n.'], [22, 'G4', 0.75, '8n'], [24, 'A4', 0.9, '2n'],
    [32, 'A#4', 0.9, '4n.'], [38, 'A4', 0.75, '8n'], [40, 'G4', 0.8, '2n'],
    [48, 'A4', 0.85, '2n.'], [60, 'E4', 0.7, '4n'],
  ];
  // The taiko builds from 8ths to 16ths, getting louder, then the war drums (low: D2 and A2, G1)
  const build = [
    ...Array.from({ length: 16 }, (_, i): Step => [i * 2, 'D2', 0.4 + i * 0.012, '8n']),
    ...Array.from({ length: 32 }, (_, i): Step => [32 + i, 'D2', 0.45 + i * 0.012, '16n']),
  ];
  const war = everyBar(1, (): Step[] => [[0, 'D2', 0.85, '4n'], [6, 'A2', 0.6, '8n'], [8, 'G1', 0.75, '4n'], [12, 'D2', 0.65, '8n'], [14, 'D2', 0.75, '8n']]);
  return inSpace(project(
    'Cinematic starter',
    100,
    0,
    [9, 17],
    [harp, strings, pad, cello, celloTheme, horns, taiko, sfx],
    [
      clip(harp, 'Arpeggio', 1, 4, arp, 2),
      clip(strings, 'Chords', 1, 4, legato(chords), 4),
      clip(pad, 'Soundtrack', 1, 4, drone, 4),
      clip(cello, 'Ostinato', 5, 4, ostinato, 3),
      clip(taiko, 'Build', 5, 4, build),
      clip(taiko, 'War drums', 9, 1, war, 8),
      withLanes(clip(horns, 'Theme', 9, 4, legato(theme), 2), VIBRATO),
      withLanes(clip(celloTheme, 'Theme', 9, 4, legato(octave(theme, -1)), 2), VIBRATO),
      clip(sfx, 'Riser', 5, 4, BUILD_UP),
      clip(sfx, 'Impact', 9, 2, IMPACT),
    ],
    [[1, 'Intro'], [5, 'Build'], [9, 'Climax']],
    master({ on: false }, { on: true, amount: 1.25 })
  ), HALL);
}

// ---------- Lo-Fi ----------

function lofi(): ProjectSnapshot {
  const tape = { crush: bits(12), tone: 5000, wow: 0.25, mix: 0.5 };
  const keys = track('Keys', 'rhodes', {
    volume: -11.5, reverbSend: 0.3,
    fx: { lofi: { on: true, ...tape }, chorus: { on: true, rate: 0.8, depth: 0.5, mix: 0.3 }, filter: { on: true, type: 'lowpass', cutoff: 3000 }, human: human(0.4) },
  });
  const drums = track('Drums', 'breakbeatKit', {
    volume: -4,
    fx: { lofi: { on: true, crush: bits(10), tone: 7000, wow: 0, mix: 0.4 }, filter: { on: true, type: 'lowpass', cutoff: 5000 }, compressor: { on: true, threshold: -20, ratio: 3, makeup: 2 }, human: human(0.5) },
  });
  const bass = track('Bass', 'uprightBass', { volume: -4, fx: { peq: peq(lowCut(35)), filter: { on: true, type: 'lowpass', cutoff: 2000 }, human: human(0.3) } });
  const melody = track('Flute', 'flute', { volume: -14, reverbSend: 0.4, delaySend: 0.15, pan: 0.2, fx: { lofi: { on: true, ...tape, wow: 0.15, mix: 0.4 }, peq: peq(lowCut(200)), human: human(0.3, 0.2) } });
  const rain = track('Rain', 'rainPad', { volume: -26, reverbSend: 0.3, fx: { filter: { on: true, type: 'lowpass', cutoff: 4000 } } });
  // Dm9 - G13 - Cmaj9 - A7(b9), a bar each, played lazily (a little after the beat), the pedal held
  const chords: Step[] = [
    [1, ['D3', 'C4', 'E4', 'F4'], 0.6, '2n.'],
    [17, ['G2', 'F3', 'B3', 'E4'], 0.6, '2n.'],
    [33, ['C3', 'E3', 'G3', 'B3', 'D4'], 0.6, '2n.'],
    [49, ['A2', 'G3', 'C#4', 'A#4'], 0.6, '2n.'],
  ];
  // Snares about 20 ms late, ghost notes, a kick that skips
  const late = 0.11;
  const beat = everyBar(2, (b): Step[] => [
    [0, D.kick, 0.8], [7, D.kick, 0.5], [10, D.kick, 0.7], ...(b ? [[13, D.kick, 0.45] as Step] : []),
    [4 + late, D.snare, 0.75], [12 + late, D.snare, 0.78], [9, D.snare, 0.25], ...(b ? [[15, D.snare, 0.3] as Step] : []),
    ...[0, 2, 4, 6, 8, 10, 12, 14].map((s): Step => [s, D.closedHat, s % 4 === 0 ? 0.45 : 0.28]),
  ]);
  const bassLine: Step[] = [
    [0, 'D2', 0.8, '4n.'], [10, 'A1', 0.6, '8n'], [16, 'G1', 0.8, '4n.'], [26, 'D2', 0.6, '8n'],
    [32, 'C2', 0.8, '4n.'], [42, 'G1', 0.6, '8n'], [48, 'A1', 0.8, '4n.'], [58, 'E2', 0.6, '8n'],
  ];
  const tune: Step[] = [
    [4, 'F5', 0.7, '8n'], [6, 'E5', 0.6, '8n'], [8, 'C5', 0.7, '4n.'],
    [22, 'B4', 0.6, '8n'], [24, 'D5', 0.7, '4n'], [28, 'E5', 0.6, '4n'],
    [36, 'E5', 0.7, '8n'], [38, 'D5', 0.6, '8n'], [40, 'B4', 0.65, '2n'],
    [56, 'A#4', 0.55, '8n'], [58, 'C#5', 0.6, '8n'],
  ];
  return inSpace(project(
    'Lo-Fi starter',
    82,
    0.3,
    [5, 17],
    [keys, drums, bass, melody, rain],
    [
      withLanes(clip(keys, 'Chords', 1, 4, chords, 4), { sustain: [0, 1, 2, 3].flatMap((b) => [{ at: b, value: 0 }, { at: b + 0.08, value: 1 }]) }),
      clip(drums, 'Dusty beat', 5, 2, beat, 6),
      clip(bass, 'Bass', 5, 4, bassLine, 3),
      withLanes(clip(melody, 'Flute', 9, 4, tune, 2), VIBRATO),
      clip(rain, 'Rain', 1, 16, [[0, ['D3', 'A3'], 0.5, '16m']]),
    ],
    [[1, 'Intro'], [5, 'Groove'], [9, 'Melody']],
    master({ on: false }, { on: true, amount: 1.05 })
  ), ROOM);
}

// ---------- Chiptune ----------

function chiptune(): ProjectSnapshot {
  // Retro is the point: chip lead, chip bass and chip drums, in mono, with a modern floor under them
  const lead = track('Lead', 'chipLead', { volume: 1 });
  const arp = track('Arp', 'chipLead', { volume: -5, pan: 0.25, delaySend: 0.15 });
  const bass = track('Bass', 'chipBass', { volume: -9 });
  const sub = track('Sub', 'subBass', { volume: -12, fx: { peq: EQ.sub(150) } });
  const drums = track('Drums', 'chipDrums', { volume: -3 });
  const kick = track('Kick layer', 'technoKit', { volume: -8, fx: { peq: peq(lowCut(30), bell(300, -3)) } });
  // A crushed Dark Supersaw pad behind the chip parts
  const pad = track('Pad', 'synthDesigner', { volume: -16, synth: DARK_SUPERSAW(), reverbSend: 0.2, fx: { peq: EQ.pad(9000) } });
  // Am - F - C - G, a bar each
  const triads = [['A4', 'C5', 'E5'], ['F4', 'A4', 'C5'], ['C5', 'E5', 'G5'], ['G4', 'B4', 'D5']];
  const roots = ['A1', 'F1', 'C2', 'G1'];
  const arps = everyBar(4, (b) => Array.from({ length: 16 }, (_, i): Step => [i, triads[b][i % 3], i % 4 === 0 ? 0.8 : 0.55, '16n']));
  const bounce = everyBar(4, (b) => Array.from({ length: 8 }, (_, i): Step => [i * 2, i % 2 ? roots[b].replace(/\d/, (o) => String(Number(o) + 1)) : roots[b], i % 4 === 0 ? 0.9 : 0.75, '8n']));
  const kicks: Step[] = [[0, D.kick, 0.85], [6, D.kick, 0.6], [8, D.kick, 0.75]];
  const beat = everyBar(1, (): Step[] => [
    ...kicks, [4, D.snare, 0.9], [12, D.snare, 0.9],
    ...[0, 2, 4, 6, 8, 10, 12, 14].map((s): Step => [s, D.closedHat, s % 4 === 0 ? 0.6 : 0.45]),
  ]);
  const theme: Step[] = [
    [0, 'E5', 0.9, '8n'], [2, 'A5', 0.9, '8n'], [4, 'B5', 0.9, '8n'], [6, 'C6', 0.9, '4n'], [10, 'B5', 0.8, '8n'], [12, 'A5', 0.85, '4n'],
    [16, 'F5', 0.9, '4n'], [20, 'A5', 0.85, '8n'], [22, 'C6', 0.9, '4n.'], [28, 'A5', 0.8, '8n'], [30, 'C6', 0.8, '8n'],
    [32, 'G5', 0.9, '4n'], [36, 'E5', 0.85, '8n'], [38, 'G5', 0.85, '8n'], [40, 'C6', 0.9, '4n.'], [46, 'E6', 0.85, '8n'],
    [48, 'D6', 0.9, '4n.'], [54, 'B5', 0.85, '8n'], [56, 'G5', 0.85, '4n'], [60, 'B5', 0.8, '8n'], [62, 'D6', 0.8, '8n'],
  ];
  return project(
    'Chiptune starter',
    150,
    0,
    [5, 17],
    [lead, arp, bass, sub, drums, kick, pad],
    [
      clip(arp, 'Arpeggios', 1, 4, arps, 4),
      clip(bass, 'Bounce', 1, 4, bounce, 4),
      clip(sub, 'Sub', 5, 4, progression(roots, 16, '1n', 0.65), 3),
      clip(drums, 'Beat', 5, 1, beat, 12),
      clip(kick, 'Kick', 5, 1, kicks, 12),
      clip(pad, 'Pad', 5, 4, progression([['A3', 'C4', 'E4'], ['A3', 'C4', 'F4'], ['G3', 'C4', 'E4'], ['G3', 'B3', 'D4']], 16, '1n', 0.55), 3),
      clip(lead, 'Theme', 5, 4, theme, 3),
    ],
    [[1, 'Intro'], [5, 'Theme'], [13, 'Repeat']],
    // Stereo width at 0%: the authentic mono sound
    master({ on: false }, { on: true, amount: 0 })
  );
}

// ---------- Hip-Hop ----------

function hiphop(): ProjectSnapshot {
  const room = darkRoom();
  const drums = track('Drums', 'breakbeatKit', {
    volume: -3, reverbSend: 0.08,
    fx: {
      peq: peq(lowCut(35), bell(450, -3), highCut(10000)), compressor: { on: true, threshold: -20, ratio: 4, makeup: 3 },
      lofi: { on: true, crush: bits(12), tone: 7000, wow: 0, mix: 0.4 }, human: human(0.35),
    },
  });
  const keys = track('Keys', 'rhodes', {
    volume: -11, sends: sendTo(room, 0.2),
    fx: { peq: peq(lowCut(120), highCut(6000)), lofi: { on: true, crush: bits(14), tone: 6000, wow: 0.2, mix: 0.4 }, filter: { on: true, type: 'lowpass', cutoff: 3000 }, human: human(0.3) },
  });
  const bass = track('Bass', 'uprightBass', { volume: -6, fx: { peq: peq(lowCut(40), highCut(3000)), compressor: { on: true, threshold: -18, ratio: 4, makeup: 2 }, human: human(0.25) } });
  const horn = track('Trumpet', 'mutedTrumpet', {
    volume: -8.5, delaySend: 0.1, sends: sendTo(room, 0.3), pan: 0.15,
    fx: { peq: peq(lowCut(250), highCut(6000)), lofi: { on: true, crush: bits(12), tone: 5000, wow: 0.1, mix: 0.5 }, human: human(0.3, 0.2) },
  });
  // Dm9 - Bbmaj7 - Gm9 - A7(b9), a bar each: dusty minor jazz, strummed on 1 and the "and" of 2
  const chords = [['D3', 'C4', 'E4', 'F4'], ['A#2', 'A3', 'D4', 'F4'], ['G2', 'F3', 'A3', 'A#3'], ['A2', 'G3', 'C#4', 'A#4']];
  const loop = everyBar(4, (b) => [...strum(0, chords[b], 0.62, '4n.'), ...strum(6, chords[b], 0.45, '8n')]);
  // Snares pushed a hair late (about 10 ms), ghost snares, the first hat of each beat accented
  const late = 0.06;
  const boomBap = everyBar(2, (b): Step[] => [
    [0, D.kick, 0.85], [7, D.kick, 0.6], [10, D.kick, 0.8], ...(b ? [[15, D.kick, 0.5] as Step] : []),
    [4 + late, D.snare, 0.9], [12 + late, D.snare, 0.92], [7, D.snare, 0.3], [14, D.snare, 0.28],
    ...[0, 2, 4, 6, 8, 10, 12, 14].map((s): Step => [s, b && s === 14 ? D.openHat : D.closedHat, s % 4 === 0 ? 0.55 : 0.35]),
  ]);
  // The root on 1, its octave on step 8, the root again on the "and" of 3, and an approach note into the next chord
  const roots = ['D2', 'A#1', 'G1', 'A1'];
  const bassLine = everyBar(4, (b): Step[] => [[0, roots[b], 0.85, '4n.'], [7, transpose(roots[b], 12), 0.6, '8n'], [10, roots[b], 0.7, '8n'], [14, transpose(roots[(b + 1) % 4], 1), 0.55, '8n']]);
  // Short sampled-sounding phrases in the hook
  const phrase: Step[] = [
    [0, 'A4', 0.7, '8n'], [3, 'F4', 0.55, '16n'], [6, 'G4', 0.6, '8n'],
    [32, 'A#4', 0.7, '8n'], [35, 'A4', 0.55, '16n'], [38, 'G4', 0.6, '4n'],
    [48, 'E4', 0.65, '8n'], [50, 'C#4', 0.55, '8n'], [52, 'D4', 0.7, '4n'],
  ];
  return inSpace(project(
    'Hip-Hop starter',
    90,
    0.28,
    [5, 17],
    [drums, keys, bass, horn, room],
    [
      clip(keys, 'Keys loop', 1, 4, loop, 4),
      clip(drums, 'Boom bap', 5, 2, boomBap, 6),
      clip(bass, 'Bass', 5, 4, bassLine, 3),
      clip(horn, 'Hook phrase', 13, 4, phrase),
    ],
    [[1, 'Intro'], [5, 'Verse'], [13, 'Hook']],
    master({ on: false }, { on: true, amount: 1.05 })
  ), ROOM);
}

// ---------- Helpers for the starters below ----------

/** A rock/pop beat: kick on 1 and 3 (and the "and" of 3), snare on 2 and 4 with a ghost, 8th hats. */
const rockBeat = (bars: number, hat: string = D.closedHat): Step[] =>
  everyBar(bars, (): Step[] => [
    [0, D.kick, 0.85], [8, D.kick, 0.8], [10, D.kick, 0.7],
    [4, D.snare, 0.92], [12, D.snare, 0.95], [7, D.snare, 0.25],
    ...[0, 2, 4, 6, 8, 10, 12, 14].map((i): Step => [i, hat, i % 4 === 0 ? 0.7 : 0.5]),
  ]);

/** A tom fill over the last beat or two of a bar, ending on a crash next bar's downbeat (with `crashAt`). */
const tomFill = (from: number): Step[] => [
  [from, D.tomHigh, 0.8], [from + 1, D.tomHigh, 0.65], [from + 2, D.tomMid, 0.8], [from + 3, D.tomMid, 0.65],
  [from + 4, D.tomLow, 0.85], [from + 5, D.tomLow, 0.7], [from + 6, D.snare, 0.85], [from + 7, D.snare, 0.95],
];

// ---------- Classical ----------

function classical(): ProjectSnapshot {
  // A string quartet of single players (each note recorded, the app's vibrato on the held notes)
  // played, not sequenced: HUMAN on every part, notes that overlap
  const strings = (amount = 0.4) => human(amount, 0.3);
  const vln1 = track('Violin I', 'realViolin', { volume: -6, pan: -0.4, reverbSend: 0.5, fx: { human: strings() } });
  const vln2 = track('Violin II', 'realViolin', { volume: -12, pan: -0.15, reverbSend: 0.5, fx: { human: strings() } });
  const viola = track('Viola', 'realViola', { volume: -6, pan: 0.15, reverbSend: 0.5, fx: { human: strings() } });
  const cello = track('Cello', 'realSoloCello', { volume: -10.5, pan: 0.3, reverbSend: 0.5, fx: { peq: peq(lowCut(40)), human: strings() } });
  const harpsi = track('Harpsichord', 'harpsichord', { volume: -10, reverbSend: 0.25, fx: { peq: peq(lowCut(150)), human: human(0.3) } });
  // D - A - Bm - F#m - G - D - G - A, two beats each (the Canon's ground)
  const roots = ['D3', 'A2', 'B2', 'F#2', 'G2', 'D2', 'G2', 'A2'];
  const triads = [['D4', 'F#4', 'A4'], ['C#4', 'E4', 'A4'], ['D4', 'F#4', 'B4'], ['C#4', 'F#4', 'A4'], ['D4', 'G4', 'B4'], ['D4', 'F#4', 'A4'], ['D4', 'G4', 'B4'], ['C#4', 'E4', 'A4']];
  const ground = legato(progression(roots, 8, '2n', 0.75));
  const violaPart = triads.flatMap((t, i): Step[] => [[i * 8, t[1], 0.6, '4n'], [i * 8 + 4, t[2], 0.5, '4n']]);
  const broken = triads.flatMap((t, i): Step[] => [t[0], t[1], t[2], t[1]].map((n, j): Step => [i * 8 + j * 2, n.replace('4', '5'), j === 0 ? 0.6 : 0.45 + 0.05 * (j % 2), '8n']));
  const theme = legato(progression(['F#5', 'E5', 'D5', 'C#5', 'B4', 'A4', 'B4', 'C#5'], 8, '2n', 0.8));
  const variation: Step[] = [['D5', 'F#5'], ['E5', 'C#5'], ['D5', 'B4'], ['C#5', 'A4'], ['B4', 'D5'], ['A4', 'F#4'], ['G4', 'B4'], ['A4', 'C#5']].flatMap(([a, b], i): Step[] => [[i * 8, a, 0.8, '4n'], [i * 8 + 4, b, 0.7, '4n']]);
  const continuo = triads.map((t, i): Step => [i * 8, t, 0.6, '2n']);
  return inSpace(project(
    'Classical starter',
    92,
    0,
    [9, 17],
    [vln1, vln2, viola, cello, harpsi],
    [
      clip(cello, 'Ground bass', 1, 4, ground, 4),
      clip(viola, 'Inner voice', 1, 4, violaPart, 4),
      clip(vln2, 'Arpeggios', 5, 4, broken, 3),
      clip(vln1, 'Theme', 9, 4, theme),
      clip(vln1, 'Variation', 13, 4, legato(variation)),
      clip(harpsi, 'Continuo', 9, 4, continuo, 2),
    ],
    [[1, 'Ground'], [5, 'Second violins'], [9, 'Theme'], [13, 'Variation']],
    master({ on: false }, { on: true, amount: 1.15 })
  ), HALL);
}

// ---------- Angelic ----------

function angelic(): ProjectSnapshot {
  const choir = track('Choir', 'realChoir', { volume: -4, reverbSend: 0.5, fx: { peq: EQ.choir(), human: human(0.3, 0.3) } });
  const voices = track('Voices', 'realChoirOoh', { volume: -1, reverbSend: 0.55, delaySend: 0.15, fx: { peq: EQ.choir(), human: human(0.3, 0.3) } });
  const halo = track('Halo', 'haloPad', { volume: -16, reverbSend: 0.45 });
  const harp = track('Harp', 'harp', { volume: -6, pan: -0.25, reverbSend: 0.45, fx: { human: human(0.3) } });
  const celesta = track('Celesta', 'celesta', { volume: -4, pan: 0.3, reverbSend: 0.5, delaySend: 0.25 });
  // Cmaj7 - D/C - Em7 - Am7: the raised fourth of D/C gives the floating, heavenly sound
  const chords = [['C4', 'E4', 'G4', 'B4'], ['C4', 'D4', 'F#4', 'A4'], ['B3', 'E4', 'G4', 'D5'], ['A3', 'C4', 'E4', 'G4']];
  const pad = progression([['C3', 'G3', 'E4'], ['C3', 'A3', 'F#4'], ['E3', 'B3', 'G4'], ['A2', 'E3', 'C4']], 16, '1n', 0.6);
  // The choir's chords overlap into the next (legato), so the voices never stop together
  const choirPart = legato(progression(chords, 16, '1n', 0.7));
  const arp = everyBar(4, (b) => [0, 1, 2, 3, 2, 1, 2, 3].map((k, i): Step => [i * 2, chords[b][k].replace(/\d/, (o) => String(Number(o) + (i >= 4 ? 1 : 0))), i === 0 ? 0.7 : 0.45 + 0.05 * (i % 2), '4n']));
  const melody: Step[] = [
    [0, 'E5', 0.7, '2n'], [8, 'D5', 0.65, '2n'], [16, 'F#5', 0.7, '2n.'], [28, 'E5', 0.6, '4n'],
    [32, 'D5', 0.7, '2n'], [40, 'B4', 0.65, '2n'], [48, 'C5', 0.7, '1n'],
  ];
  // Celesta only where a phrase begins: one bell, not a twinkle on every beat
  const sparkle: Step[] = [[0, 'G5', 0.5, '4n'], [32, 'B5', 0.45, '4n']];
  return inSpace(project(
    'Angelic starter',
    66,
    0,
    [9, 17],
    [choir, voices, halo, harp, celesta],
    [
      clip(halo, 'Halo', 1, 4, pad, 4),
      clip(harp, 'Harp', 1, 4, arp, 4),
      clip(choir, 'Choir', 5, 4, choirPart, 3),
      withLanes(clip(voices, 'Melody', 9, 4, legato(melody), 2), VIBRATO),
      clip(celesta, 'Sparkle', 9, 4, sparkle, 2),
    ],
    [[1, 'Light'], [5, 'Choir'], [9, 'Heaven']],
    master({ on: false }, { on: true, amount: 1.3 })
  ), HEAVEN);
}

// ---------- Epic Orchestral ----------

function epic(): ProjectSnapshot {
  // Seated as an orchestra, each part played (HUMAN), all in one hall
  const lows = track('Low strings', 'contrabass', { volume: -4, pan: 0.35, reverbSend: 0.3, fx: { peq: peq(lowCut(35)), human: human(0.3, 0.2) } });
  const celli = track('Cellos', 'cello', { volume: -6, pan: 0.2, reverbSend: 0.3, fx: { peq: peq(lowCut(40)), human: human(0.3, 0.2) } });
  const trem = track('Tremolo', 'tremolo', { volume: -10, pan: -0.3, reverbSend: 0.45, fx: { peq: EQ.pad(), human: human(0.35, 0.3) } });
  const horns = track('Horns', 'frenchHorn', { volume: -3, pan: -0.25, reverbSend: 0.45, fx: { peq: EQ.brass(), human: human(0.3, 0.25) } });
  const brass = track('Low brass', 'brassSection', { volume: -6, pan: 0.3, reverbSend: 0.5, fx: { peq: EQ.brass(), human: human(0.3, 0.2) } });
  const choir = track('Choir', 'realChoir', { volume: -6, reverbSend: 0.55, fx: { peq: EQ.choir(), human: human(0.3, 0.3) } });
  const timp = track('Timpani', 'timpani', { volume: -3, reverbSend: 0.4, fx: { human: human(0.2) } });
  const taiko = track('Taiko', 'taiko', { volume: -5, reverbSend: 0.45, fx: { human: human(0.2) } });
  const perc = track('Percussion', 'acousticKit', { volume: -3, reverbSend: 0.35, fx: { human: human(0.2) } });
  // Cm - Ab - Fm - Gsus4 -> Gm, a bar each: dark all the way, never a big G major
  const roots = ['C', 'G#', 'F', 'G'];
  const ostinato = everyBar(4, (b) => Array.from({ length: 8 }, (_, i): Step => [i * 2, `${roots[b]}${i % 4 === 3 ? 3 : 2}`, i % 2 ? 0.55 : 0.85, '8n']));
  const lowNotes = legato(progression(['C2', 'G#1', 'F1', 'G1'], 16, '1n', 0.75));
  const chordsOf = (sus: string[], minor: string[], rest: string[][]): Step[] => [
    ...rest.map((c, i): Step => [i * 16, c, 0.7, '0:4:1']), [48, sus, 0.7, '0:2:1'], [56, minor, 0.7, '2n'],
  ];
  const tremChords = chordsOf(['G3', 'C4', 'D4'], ['G3', 'A#3', 'D4'], [['G3', 'C4', 'D#4'], ['G#3', 'C4', 'D#4'], ['G#3', 'C4', 'F4']]);
  const choirPart = chordsOf(['G2', 'D3', 'C4'], ['G2', 'D3', 'A#3'], [['C3', 'G3', 'D#4'], ['G#2', 'D#3', 'C4'], ['F3', 'G#3', 'C4']]);
  // Power-chord stabs on the downbeats, low (octave 2 to 3)
  const stabs = everyBar(4, (b): Step[] => { const c = power(['C3', 'G#2', 'F2', 'G2'][b]); return [[0, c, 0.85, '4n'], [10, c, 0.6, '8n'], [12, c, 0.7, '8n']]; });
  const theme: Step[] = [
    [0, 'C4', 0.9, '4n.'], [6, 'D4', 0.75, '8n'], [8, 'D#4', 0.9, '2n'],
    [16, 'G#4', 0.9, '4n.'], [22, 'G4', 0.75, '8n'], [24, 'D#4', 0.85, '2n'],
    [32, 'G4', 0.9, '4n.'], [38, 'F4', 0.75, '8n'], [40, 'D#4', 0.85, '4n'], [44, 'D4', 0.8, '4n'],
    [48, 'D4', 0.9, '2n.'], [60, 'G3', 0.8, '4n'],
  ];
  const rolls = everyBar(1, (): Step[] => [[0, 'C2', 0.85, '4n'], [8, 'G2', 0.75, '4n'], [12, 'C2', 0.55, '16n'], [13, 'C2', 0.6, '16n'], [14, 'C2', 0.68, '16n'], [15, 'C2', 0.75, '16n']]);
  const taikoPart = everyBar(1, (): Step[] => [[0, 'C2', 0.85, '4n'], [6, 'G1', 0.6, '8n'], [8, 'G1', 0.75, '4n'], [14, 'C2', 0.65, '8n']]);
  const battle = everyBar(2, (b): Step[] => [
    [0, D.kick, 0.85], ...(b === 0 ? [[0, D.crash, 0.75] as Step] : []), [4, D.tomLow, 0.8], [6, D.tomLow, 0.6], [8, D.kick, 0.8], [8, D.snare, 0.8], [12, D.tomMid, 0.8], [14, D.tomHigh, 0.7],
  ]);
  return inSpace(project(
    'Epic Orchestral starter',
    130,
    0,
    [9, 17],
    [lows, celli, trem, horns, brass, choir, timp, taiko, perc],
    [
      clip(celli, 'Ostinato', 1, 4, ostinato, 4),
      clip(lows, 'Basses', 5, 4, lowNotes, 3),
      clip(timp, 'Timpani', 1, 1, rolls, 16),
      clip(trem, 'Tremolo', 5, 4, tremChords, 3),
      clip(choir, 'Choir', 5, 4, choirPart, 3),
      withLanes(clip(horns, 'Battle theme', 9, 4, legato(theme), 2), VIBRATO),
      clip(brass, 'Stabs', 9, 4, stabs, 2),
      clip(taiko, 'Taiko', 9, 1, taikoPart, 8),
      clip(perc, 'Battle drums', 9, 2, battle, 4),
    ],
    [[1, 'Tension'], [5, 'Rise'], [9, 'Battle']],
    master({ on: false }, { on: true, amount: 1.2 })
  ), HALL);
}

// ---------- Ambient ----------

function ambient(): ProjectSnapshot {
  // Pads well under the melody (-16 to -18), sparse kalimba and crystal, a long, endless space
  const warm = track('Warm pad', 'warmPad', { volume: -16, reverbSend: 0.5, fx: { peq: peq(lowCut(120)) } });
  const glass = track('Glass', 'glassPad', { volume: -18, reverbSend: 0.6, pan: 0.2, fx: { peq: peq(lowCut(200)) } });
  const kalimba = track('Kalimba', 'kalimba', { volume: -6, reverbSend: 0.5, delaySend: 0.35, pan: -0.2, fx: { human: human(0.3) } });
  const crystal = track('Crystal', 'crystal', { volume: -12, reverbSend: 0.7, delaySend: 0.3, pan: 0.3, fx: { peq: peq(lowCut(500), highCut(8000)) } });
  // Dmaj9 - Bm11 - Gmaj9 - A6sus, two bars each
  const pad = progression([['D3', 'A3', 'C#4', 'E4'], ['B2', 'F#3', 'A3', 'E4'], ['G2', 'D3', 'F#3', 'A3'], ['A2', 'E3', 'F#3', 'B3']], 32, '2m', 0.6);
  const air = progression([['F#5', 'A5'], ['D5', 'F#5'], ['B4', 'D5'], ['C#5', 'E5']], 32, '2m', 0.5);
  const tune: Step[] = [
    [0, 'F#5', 0.7, '4n'], [3, 'A5', 0.55, '4n'], [6, 'E5', 0.6, '4n'], [12, 'D5', 0.5, '4n'],
    [20, 'C#5', 0.6, '4n'], [24, 'E5', 0.65, '4n'], [28, 'F#5', 0.5, '4n'],
    [36, 'D5', 0.65, '4n'], [40, 'B4', 0.55, '4n'], [46, 'A4', 0.6, '4n'], [52, 'B4', 0.5, '4n'], [56, 'D5', 0.6, '2n'],
  ];
  const shimmer: Step[] = [[0, 'A6', 0.5, '2n'], [22, 'E6', 0.45, '2n'], [40, 'F#6', 0.5, '2n'], [58, 'C#6', 0.4, '2n']];
  return inSpace(project(
    'Ambient starter',
    70,
    0,
    [1, 17],
    [warm, glass, kalimba, crystal],
    [
      clip(warm, 'Pad', 1, 8, pad, 2),
      clip(glass, 'Air', 5, 8, air, 1),
      clip(glass, 'Air', 13, 4, air.slice(0, 2)),
      clip(kalimba, 'Kalimba', 5, 4, tune, 3),
      clip(crystal, 'Shimmer', 9, 4, shimmer, 2),
    ],
    [[1, 'Drift'], [5, 'Kalimba'], [9, 'Shimmer']],
    master({ on: false }, { on: true, amount: 1.4 })
  ), HEAVEN, { delayTime: '8n', delayFeedback: 0.4 });
}

// ---------- Rock ----------

function rock(): ProjectSnapshot {
  const bus = drumBus();
  const drums = track('Drums', 'acousticKit', { volume: -2, reverbSend: 0.12, output: bus.id, fx: { human: human(0.25) } });
  // Double-tracked: overdrive left, distortion right, each with its own feel
  const gtr = track('Guitar L', 'overdriveGuitar', { volume: -7, pan: -0.6, fx: { peq: EQ.guitar(), human: human(0.15, 0.2) } });
  const gtr2 = track('Guitar R', 'distortionGuitar', { volume: -7, pan: 0.6, fx: { peq: EQ.guitar(), human: human(0.2, 0.25) } });
  const bass = track('Bass', 'pickBass', { volume: -5, fx: { peq: peq(lowCut(35)), compressor: { on: true, threshold: -18, ratio: 4, makeup: 2 }, distortion: { on: true, amount: 0.15 }, human: human(0.25) } });
  const organ = track('Organ', 'rockOrgan', { volume: -16, reverbSend: 0.2, fx: { peq: peq(lowCut(200)), distortion: { on: true, amount: 0.2 }, human: human(0.2) } });
  // E5 - C5 - A5 - B5, a bar each: power chords, so no bright B major
  const roots = ['E2', 'C3', 'A2', 'B2'];
  const chug = (scale: number) => everyBar(4, (b) => Array.from({ length: 8 }, (_, i): Step => [i * 2, power(roots[b]), (i % 4 === 0 ? 0.95 : 0.72) * scale, '8n']));
  const ring = everyBar(4, (b): Step[] => [[0, power(roots[b]), 0.95, '2n.'], [12, power(roots[b]), 0.8, '4n']]);
  const bassLine = everyBar(4, (b) => Array.from({ length: 8 }, (_, i): Step => [i * 2, transpose(roots[b], -12), i % 4 === 0 ? 0.85 : 0.7, '8n']));
  // Em - C - Am - Bsus4 on the organ
  const organChords = progression([['G3', 'B3', 'E4'], ['G3', 'C4', 'E4'], ['A3', 'C4', 'E4'], ['F#3', 'B3', 'E4']], 16, '1n', 0.6);
  const beat = rockBeat(4);
  const fill = [...rockBeat(1).filter(([st]) => st < 8), ...tomFill(8)];
  const verse: Step[] = [[0, D.crash, 0.75, '1n'], ...beat.filter(([st]) => st < 48), ...fill.map(([st, n, v, d]): Step => [st + 48, n, v, d])];
  const chorus: Step[] = [[0, D.crash, 0.85, '1n'], ...rockBeat(4, D.ride).filter(([st]) => st < 48), ...fill.map(([st, n, v, d]): Step => [st + 48, n, v, d])];
  return inSpace(project(
    'Rock starter',
    124,
    0,
    [9, 17],
    [drums, bus, gtr, gtr2, bass, organ],
    [
      clip(gtr, 'Riff', 1, 4, chug(1), 2),
      clip(gtr2, 'Riff', 5, 4, chug(0.9)),
      clip(drums, 'Verse beat', 5, 4, verse),
      clip(bass, 'Bass', 5, 4, bassLine, 3),
      clip(drums, 'Chorus beat', 9, 4, chorus, 2),
      clip(gtr, 'Chorus', 9, 4, ring, 2),
      clip(gtr2, 'Chugs', 9, 4, chug(0.9), 2),
      clip(organ, 'Organ', 9, 4, organChords, 2),
    ],
    [[1, 'Intro'], [5, 'Verse'], [9, 'Chorus']],
    master({ on: true, depth: 0.1 }, { on: true, amount: 1.2 })
  ), ROOM);
}

// ---------- Metal ----------

function metal(): ProjectSnapshot {
  const drums = track('Drums', 'acousticKit', { volume: -4, fx: { compressor: { on: true, threshold: -16, ratio: 4, makeup: 2 }, peq: EQ.kit(), human: human(0.15) } });
  const left = track('Guitar L', 'distortionGuitar', { volume: -6, pan: -0.6, fx: { peq: EQ.guitar(), compressor: { on: true, threshold: -16, ratio: 3, makeup: 1 }, human: human(0.15, 0.2) } });
  const right = track('Guitar R', 'distortionGuitar', { volume: -6, pan: 0.6, fx: { peq: EQ.guitar(), compressor: { on: true, threshold: -16, ratio: 3, makeup: 1 }, human: human(0.2, 0.25) } });
  const bass = track('Bass', 'pickBass', { volume: -2, fx: { peq: peq(lowCut(35)), distortion: { on: true, amount: 0.25 }, human: human(0.15) } });
  // Low and wide, in its own hall (the master stays a tight room)
  const choir = track('Choir', 'realChoir', { volume: -12, reverbSend: 0.2, fx: { peq: EQ.choir(), reverb: { on: true, decay: 3.2, preDelay: 25, tone: 6000, mix: 0.4 }, human: human(0.3, 0.3) } });
  // E Phrygian: chugs on low E with stabs up to F, G and A#; accents 0.95, chugs 0.7
  const riff = everyBar(2, (b): Step[] => [
    ...[0, 1, 2, 4, 5, 6, 8, 9].map((i): Step => [i, ['E2', 'B2'], i % 4 === 0 ? 0.95 : 0.7, '16n']),
    [3, ['F2', 'C3'], 0.95, '16n'], [7, ['G2', 'D3'], 0.95, '16n'], [10, ['E2', 'B2'], 0.85, '8n'],
    [12, b ? ['A#2', 'F3'] : ['G2', 'D3'], 0.95, '8n'], [14, b ? ['A2', 'E3'] : ['F2', 'C3'], 0.95, '8n'],
  ]);
  // The second guitar a touch different, as a real double-track is
  const varied = (steps: Step[]) => steps.map(([s, n, v, d], i): Step => [s, n, Math.max(0.5, v - (i % 3 === 1 ? 0.06 : 0.02)), d]);
  const bassRiff = riff.map(([st, n, v, d]): Step => [st, (n as string[])[0].replace('2', '1'), v, d]);
  // Double kick at 0.75 to 0.85: tiring at full force
  const blast = everyBar(1, (): Step[] => [
    ...Array.from({ length: 16 }, (_, i): Step => [i, D.kick, i % 4 === 0 ? 0.85 : 0.75]),
    [4, D.snare, 0.95], [12, D.snare, 0.95], [0, D.crash, 0.75], [8, D.crash, 0.55],
  ]);
  const breakdown = everyBar(2, (b): Step[] => [
    [0, D.kick, 0.85], [0, D.crash, 0.85], [3, D.kick, 0.8], [6, D.kick, 0.8], [8, D.snare, 0.95], [10, D.kick, 0.8], [11, D.kick, 0.75], ...(b ? [[14, D.tomLow, 0.85] as Step, [15, D.tomLow, 0.9] as Step] : []),
    ...[0, 4, 8, 12].map((i): Step => [i, D.ride, 0.55]),
  ]);
  const chug = everyBar(2, (b): Step[] => [[0, ['E2', 'B2'], 0.95, '8n'], [3, ['E2', 'B2'], 0.9, '16n'], [6, ['E2', 'B2'], 0.9, '16n'], [10, ['E2', 'B2'], 0.85, '16n'], [11, ['E2', 'B2'], 0.8, '16n'], ...(b ? [[14, ['A#2', 'F3'], 0.95, '8n'] as Step] : [])]);
  // E5 - F5 - E5 - Bb5 sung low
  const choirPart = legato(progression([['E3', 'B3'], ['F3', 'C4'], ['E3', 'B3'], ['A#2', 'F3']], 16, '1n', 0.7));
  return inSpace(project(
    'Metal starter',
    170,
    0,
    [9, 17],
    [drums, left, right, bass, choir],
    [
      clip(left, 'Riff', 1, 2, riff, 4),
      clip(right, 'Riff', 1, 2, varied(riff), 4),
      clip(bass, 'Riff', 1, 2, bassRiff, 4),
      clip(drums, 'Blast', 1, 1, blast, 8),
      clip(drums, 'Breakdown', 9, 2, breakdown, 4),
      clip(left, 'Breakdown', 9, 2, chug, 4),
      clip(right, 'Breakdown', 9, 2, varied(chug), 4),
      clip(bass, 'Breakdown', 9, 2, chug.map(([st, n, v, d]): Step => [st, (n as string[])[0].replace('2', '1'), v, d]), 4),
      clip(choir, 'Choir', 9, 4, choirPart, 2),
    ],
    [[1, 'Riff'], [9, 'Breakdown']],
    master({ on: true, depth: 0.15 }, { on: true, amount: 1.2 })
  ), ROOM);
}

// ---------- Jazz ----------

function jazz(): ProjectSnapshot {
  const drums = track('Drums', 'acousticKit', { volume: 2, reverbSend: 0.2, fx: { human: human(0.45) } });
  const bass = track('Upright bass', 'uprightBass', { volume: -1.5, fx: { peq: peq(lowCut(35)), human: human(0.35, 0.15) } });
  const piano = track('Piano', 'piano', { volume: 3, reverbSend: 0.25, pan: -0.15, fx: { human: human(0.45) } });
  const sax = track('Sax', 'saxophone', { volume: -2, reverbSend: 0.3, pan: 0.15, fx: { human: human(0.45, 0.3) } });
  const vibes = track('Vibes', 'vibraphone', { volume: -12, reverbSend: 0.35, pan: 0.3, fx: { human: human(0.4) } });
  // ii - V - I - VI in C (Dm7 G7 Cmaj7 A7), a bar each. Swung 8ths are written as triplets: the off-beat two triplet 8ths (2.67 steps) after the beat
  const tri = 4 / 3;
  // Ride with a brushes feel: a soft snare (0.2 to 0.35), a feathered kick
  const ride = everyBar(4, (b): Step[] => [
    [0, D.ride, 0.7], [4, D.ride, 0.75], [4 + 2 * tri, D.ride, 0.5], [8, D.ride, 0.68], [12, D.ride, 0.75], [12 + 2 * tri, D.ride, 0.52],
    [4, D.closedHat, 0.5], [12, D.closedHat, 0.5], [0, D.kick, 0.35], [8, D.kick, 0.3], [10 + tri, D.snare, 0.25], ...(b % 2 ? [[14 + tri, D.snare, 0.2] as Step] : []),
  ]);
  const walk: Step[] = ['D2', 'F2', 'A2', 'C3', 'G2', 'B1', 'D2', 'F2', 'C2', 'E2', 'G2', 'B2', 'A1', 'C#2', 'E2', 'G2'].map((n, i): Step => [i * 4, n, i % 4 === 0 ? 0.85 : 0.7, '4n']);
  const voicings = [['F3', 'A3', 'C4', 'E4'], ['F3', 'B3', 'E4'], ['E3', 'G3', 'B3', 'D4'], ['C#4', 'G4', 'B4']];
  // Comping on the off-beats, lightly strummed
  const comp = everyBar(4, (b): Step[] => [...strum(4 + 2 * tri, voicings[b], 0.6, '8n', 0.05), ...strum(12, voicings[b], 0.48, '4n', 0.05)]);
  const head: Step[] = [
    [0, 'A4', 0.8, '4n'], [4 + 2 * tri, 'C5', 0.7, '8n'], [8, 'E5', 0.85, '4n'], [12, 'D5', 0.7, '4n'],
    [16, 'B4', 0.8, '4n.'], [24, 'G4', 0.65, '8n'], [24 + 2 * tri, 'A4', 0.7, '8n'], [28, 'B4', 0.75, '4n'],
    [32, 'C5', 0.85, '2n'], [40 + 2 * tri, 'E5', 0.65, '8n'], [44, 'D5', 0.7, '4n'],
    [48, 'C#5', 0.8, '4n'], [52, 'A4', 0.65, '4n'], [56, 'G4', 0.7, '4n'], [60, 'E4', 0.65, '4n'],
  ];
  const vibeLine = progression([['F4', 'A4', 'E5'], ['F4', 'B4', 'E5'], ['E4', 'G4', 'D5'], ['C#5', 'G5']], 16, '2n', 0.5);
  return inSpace(project(
    'Jazz starter',
    132,
    0,
    [5, 17],
    [drums, bass, piano, sax, vibes],
    [
      clip(drums, 'Ride', 1, 4, ride, 4),
      clip(bass, 'Walking bass', 1, 4, walk, 4),
      clip(piano, 'Comping', 1, 4, comp, 4),
      withLanes(clip(sax, 'Head', 5, 4, head, 2), VIBRATO),
      clip(vibes, 'Vibes', 13, 4, vibeLine),
      withLanes(clip(sax, 'Head', 13, 4, head), VIBRATO),
    ],
    [[1, 'Intro'], [5, 'Head'], [13, 'Out chorus']],
    master({ on: false }, { on: true, amount: 1.05 })
  ), ROOM);
}

// ---------- Synthwave ----------

function synthwave(): ProjectSnapshot {
  // A 1984 film soundtrack, not a game cartridge: a big gated-room snare, chorused pads, a dark pluck
  const drums = track('Drums', 'linnDrum', { volume: -4, reverbSend: 0.1, fx: { reverb: { on: true, decay: 1.2, preDelay: 10, tone: 7000, mix: 0.3 } } });
  const bass = track('Bass', 'synthBass1', { volume: -6, fx: { peq: peq(lowCut(35)) } });
  const pads = track('Poly pad', 'polysynthPad', { volume: -14, reverbSend: 0.4, fx: { chorus: { on: true, rate: 0.6, depth: 0.6, mix: 0.3 }, peq: peq(lowCut(200)) } });
  const strings = track('Strings', 'synthStrings2', { volume: -16, reverbSend: 0.4, pan: -0.2, fx: { chorus: { on: true, rate: 0.5, depth: 0.6, mix: 0.3 }, peq: peq(lowCut(200)) } });
  const arp = track('Arp', 'synthDesigner', { volume: -12, synth: DARK_PLUCK(), pan: 0.2, fx: { echo: { on: true, time: '1/8d', feedback: 0.35, tone: 4000, pingPong: true, mix: 0.25 }, peq: EQ.lead(7000), human: human(0.12) } });
  const lead = track('Lead', 'sawLead', { volume: -8, reverbSend: 0.35, fx: { chorus: { on: true, rate: 0.7, depth: 0.5, mix: 0.3 }, echo: { on: true, time: '1/8d', feedback: 0.3, tone: 5000, pingPong: true, mix: 0.2 }, peq: EQ.lead(8000) } });
  // Am - F - C - G, a bar each (classic synthwave keeps it)
  const roots = ['A1', 'F1', 'C2', 'G1'];
  const triads = [['A3', 'C4', 'E4'], ['A3', 'C4', 'F4'], ['G3', 'C4', 'E4'], ['G3', 'B3', 'D4']];
  const pulse = everyBar(4, (b) => Array.from({ length: 8 }, (_, i): Step => [i * 2, i % 2 ? transpose(roots[b], 12) : roots[b], i % 2 ? 0.65 : 0.8, '8n']));
  const pad = progression(triads, 16, '1n', 0.6);
  // A broken arp in octave 3 to 4: every 4th 16th left out, accents on the beat
  const arps = everyBar(4, (b) => Array.from({ length: 16 }, (_, i): Step => [i, triads[b][i % 3], i % 4 === 0 ? 0.75 : 0.5, '16n']).filter(([s]) => s % 4 !== 3));
  const beat = everyBar(1, (): Step[] => [
    [0, D.kick, 0.85], [8, D.kick, 0.8], [4, D.snare, 0.9], [12, D.snare, 0.95], [4, D.clap, 0.6], [12, D.clap, 0.6],
    ...Array.from({ length: 16 }, (_, i): Step => [i, D.closedHat, i % 4 === 0 ? 0.5 : i % 2 ? 0.3 : 0.42]),
  ]);
  // The lead an octave down (C4 to G4), held notes with vibrato
  const melody: Step[] = [
    [0, 'E4', 0.85, '4n.'], [6, 'D4', 0.7, '8n'], [8, 'C4', 0.75, '4n'], [12, 'A3', 0.7, '4n'],
    [16, 'C4', 0.85, '2n'], [24, 'F4', 0.75, '4n'], [28, 'E4', 0.7, '4n'],
    [32, 'G4', 0.85, '4n.'], [38, 'E4', 0.7, '8n'], [40, 'C4', 0.75, '2n'],
    [48, 'D4', 0.85, '2n.'], [60, 'B3', 0.65, '4n'],
  ];
  return inSpace(project(
    'Synthwave starter',
    100,
    0,
    [9, 17],
    [drums, bass, pads, strings, arp, lead],
    [
      clip(pads, 'Pad', 1, 4, pad, 4),
      clip(strings, 'Strings', 9, 4, pad, 2),
      clip(arp, 'Arp', 1, 4, arps, 4),
      clip(bass, 'Pulse', 5, 4, pulse, 3),
      clip(drums, 'Beat', 5, 1, beat, 12),
      withLanes(clip(lead, 'Lead', 9, 4, melody, 2), { vibrato: [{ at: 0, value: 0.2 }] }),
    ],
    [[1, 'Night drive'], [5, 'Groove'], [9, 'Lead']],
    master({ on: true, depth: 0.15 }, { on: true, amount: 1.3 })
  ), HALL);
}

// ---------- Pop ----------

function pop(): ProjectSnapshot {
  // Bright by design (C major): a real kit and played parts are what keep it from sounding canned
  const drums = track('Drums', 'acousticKit', { volume: -3, reverbSend: 0.1, fx: { compressor: GLUE, human: human(0.3) } });
  const piano = track('Piano', 'piano', { volume: 0, reverbSend: 0.25, fx: { peq: peq(lowCut(60)), human: human(0.35) } });
  const bass = track('Bass', 'fingerBass', { volume: -2, fx: { peq: peq(lowCut(35)), compressor: { on: true, threshold: -18, ratio: 4, makeup: 2 }, human: human(0.3) } });
  const hook = track('Hook', 'cleanGuitar', { volume: -3, delaySend: 0.15, reverbSend: 0.25, pan: 0.2, fx: { chorus: { on: true, rate: 0.8, depth: 0.6, mix: 0.4 }, human: human(0.3, 0.2) } });
  const strings = track('Strings', 'slowStrings', { volume: -8, reverbSend: 0.4, pan: -0.25, fx: { peq: EQ.pad(10000), human: human(0.35, 0.3) } });
  // C - G - Am - F, a bar each
  const triads = [['C4', 'E4', 'G4'], ['B3', 'D4', 'G4'], ['C4', 'E4', 'A4'], ['C4', 'F4', 'A4']];
  const roots = ['C2', 'G1', 'A1', 'F1'];
  const keys = everyBar(4, (b) => Array.from({ length: 8 }, (_, i): Step => [i * 2, triads[b], i % 4 === 0 ? 0.68 : i % 2 ? 0.45 : 0.55, '8n']));
  const bassLine = everyBar(4, (b): Step[] => [[0, roots[b], 0.85, '4n.'], [6, roots[b], 0.65, '8n'], [10, roots[b], 0.7, '8n'], [12, transpose(roots[b], 12), 0.65, '8n']]);
  const beat = everyBar(1, (): Step[] => [
    [0, D.kick, 0.85], [6, D.kick, 0.65], [8, D.kick, 0.8], [4, D.snare, 0.9], [12, D.snare, 0.92], [4, D.clap, 0.45], [12, D.clap, 0.45], [14, D.snare, 0.25],
    ...[0, 2, 4, 6, 8, 10, 12, 14].map((i): Step => [i, D.closedHat, i % 4 === 2 ? 0.55 : 0.4]),
  ]);
  // The hook an octave down, where a singer would sing it
  const tune = octave([
    [0, 'G5', 0.85, '8n'], [2, 'E5', 0.75, '8n'], [4, 'G5', 0.8, '8n'], [6, 'A5', 0.85, '4n'], [10, 'G5', 0.7, '8n'],
    [16, 'D5', 0.75, '8n'], [18, 'G5', 0.85, '4n'], [22, 'F5', 0.7, '8n'], [24, 'E5', 0.8, '4n'],
    [32, 'E5', 0.8, '8n'], [34, 'C5', 0.7, '8n'], [36, 'E5', 0.75, '8n'], [38, 'A5', 0.85, '4n'], [42, 'G5', 0.7, '8n'],
    [48, 'F5', 0.8, '4n'], [52, 'E5', 0.7, '4n'], [56, 'D5', 0.75, '4n'], [60, 'C5', 0.7, '4n'],
  ], -1);
  const pad = legato(progression([['E4', 'G4'], ['D4', 'G4'], ['E4', 'A4'], ['F4', 'A4']], 16, '1n', 0.6));
  return inSpace(project(
    'Pop starter',
    112,
    0,
    [9, 17],
    [drums, piano, bass, hook, strings],
    [
      clip(piano, 'Piano', 1, 4, keys, 4),
      clip(drums, 'Beat', 5, 1, beat, 12),
      clip(bass, 'Bass', 5, 4, bassLine, 3),
      clip(hook, 'Hook', 9, 4, tune, 2),
      clip(strings, 'Strings', 9, 4, pad, 2),
    ],
    [[1, 'Intro'], [5, 'Verse'], [9, 'Chorus']],
    master({ on: true, depth: 0.1 }, { on: true, amount: 1.2 })
  ), STUDIO);
}

// ---------- Trance ----------

function trance(): ProjectSnapshot {
  const drums = track('Drums', 'technoKit', { volume: -4, fx: { peq: peq(lowCut(30)), compressor: GLUE } });
  const bass = track('Rolling bass', 'synthDesigner', { volume: -8, synth: ROLLING_BASS(), fx: { peq: peq(lowCut(35)) } });
  // Dark Supersaw, gated in 16ths and pumping; its filter opens over the build
  const chords = track('Supersaw', 'synthDesigner', {
    volume: -8, synth: DARK_SUPERSAW(), reverbSend: 0.25,
    fx: { peq: EQ.pad(9000), gate: { on: true, rate: '1/16', depth: 0.7, length: 0.5 }, pump: { on: true, depth: 0.6, release: 240, trigger: 'kick' }, filter: { on: true, type: 'lowpass', cutoff: 8000 } },
    automation: [{ param: 'filterCutoff', points: [{ bar: 5, value: 0.3, curve: 0.5 }, { bar: 9, value: 0.9 }] }],
  });
  const arp = track('Pluck arp', 'synthDesigner', { volume: -10, synth: DARK_PLUCK(), pan: -0.2, fx: { peq: EQ.lead(7000), echo: { on: true, time: '1/16d', feedback: 0.3, tone: 4000, pingPong: true, mix: 0.2 }, human: human(0.12) } });
  const pad = track('Pad', 'sweepPad', { volume: -18, reverbSend: 0.4, fx: { peq: peq(lowCut(200)) } });
  const sfx = track('FX', 'fx', { volume: -16, reverbSend: 0.3 });
  const kit = everyBar(1, (): Step[] => [...[0, 4, 8, 12].map((i): Step => [i, D.kick, i === 0 ? 0.85 : 0.78]), ...[2, 6, 10, 14].map((i): Step => [i, D.openHat, 0.5]), [4, D.clap, 0.75], [12, D.clap, 0.8]]);
  // Am - F5 - Dm - Em, a bar each: no G major, so it stays dark
  const roots = ['A1', 'F1', 'D2', 'E1'];
  const voicings = [['A3', 'C4', 'E4'], ['F3', 'C4'], ['D3', 'F3', 'A3'], ['E3', 'G3', 'B3']];
  // Rolling bass: the root on three of every four 16ths, leaving the kick its own
  const rolling = everyBar(4, (b) => [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15].map((s): Step => [s, roots[b], s % 4 === 1 ? 0.8 : 0.65, '16n']));
  // Root - 5th - octave - 5th in 16ths, every 4th note left out so it breathes
  const shapes = [['A3', 'E4', 'A4', 'E4'], ['F3', 'C4', 'F4', 'C4'], ['D3', 'A3', 'D4', 'A3'], ['E3', 'B3', 'E4', 'B3']];
  const arps = everyBar(4, (b) => Array.from({ length: 16 }, (_, i): Step => [i, shapes[b][i % 4], i % 4 === 0 ? 0.7 : 0.45, '16n']).filter(([s]) => s % 4 !== 3));
  const saws = progression(voicings, 16, '1n', 0.7);
  return inSpace(project(
    'Trance starter',
    138,
    0,
    [9, 17],
    [drums, bass, chords, arp, pad, sfx],
    [
      clip(drums, 'Four to the floor', 1, 1, kit, 4),
      clip(drums, 'Snare roll', 5, 4, snareRoll),
      clip(drums, 'Four to the floor', 9, 1, kit, 8),
      clip(arp, 'Arp', 1, 4, arps, 4),
      clip(pad, 'Pad', 1, 4, progression(voicings, 16, '1n', 0.5), 2),
      clip(bass, 'Rolling bass', 1, 4, rolling),
      clip(bass, 'Rolling bass', 9, 4, rolling, 2),
      clip(chords, 'Supersaws', 5, 4, saws, 3),
      clip(sfx, 'Build-up', 5, 4, BUILD_UP),
      clip(sfx, 'Drop hit', 9, 2, IMPACT),
    ],
    [[1, 'Intro'], [5, 'Build'], [9, 'Drop']],
    master({ on: true, depth: 0.3, time: FAST }, { on: true, amount: 1.25 })
  ), STUDIO);
}

// ---------- Horror ----------

function horror(): ProjectSnapshot {
  const drone = track('Drone', 'goblins', { volume: -6, reverbSend: 0.5 });
  const trem = track('Tremolo', 'tremolo', { volume: -10, reverbSend: 0.5, fx: { human: human(0.35, 0.5) } });
  // A warped tape music box: slow wow and notes drifting out of tune
  const box = track('Music box', 'musicBox', { volume: -4, reverbSend: 0.6, delaySend: 0.3, fx: { lofi: { on: true, crush: bits(14), tone: 6000, wow: 0.4, mix: 0.6 }, human: human(0.3, 0.9) } });
  const timp = track('Timpani', 'timpani', { volume: -3, reverbSend: 0.5, fx: { human: human(0.2) } });
  const space = track('Swells', 'sciFi', { volume: -6, reverbSend: 0.6, pan: 0.3 });
  const taiko = track('Taiko', 'taiko', { volume: -5, reverbSend: 0.4, fx: { human: human(0.15) } });
  const brass = track('Brass', 'brassSection', { volume: -8, reverbSend: 0.45, pan: 0.2, fx: { peq: EQ.brass() } });
  // Bar 12 is silent: a full bar of nothing before the chase
  const dread: Step[] = [[0, ['C2', 'C3'], 0.7, '4m']];
  // Clusters low in the strings: notes a half step apart, together
  const cluster = progression([['C3', 'C#3', 'D3'], ['C3', 'D3', 'D#3'], ['B2', 'C3', 'C#3'], ['C3', 'F#3', 'G3']], 16, '1n', 0.55);
  // A lullaby in C minor, a little wrong
  const lullaby: Step[] = [
    [0, 'G5', 0.6, '4n'], [4, 'D#5', 0.5, '4n'], [8, 'C5', 0.6, '4n'], [12, 'D#5', 0.45, '4n'],
    [16, 'D5', 0.6, '4n'], [20, 'B4', 0.5, '4n'], [24, 'G4', 0.6, '2n'],
    [32, 'G#4', 0.6, '4n'], [36, 'C5', 0.5, '4n'], [40, 'D#5', 0.6, '4n'], [44, 'F#5', 0.45, '4n'],
    [48, 'G5', 0.6, '2n'], [56, 'C#5', 0.4, '2n'],
  ];
  const hits: Step[] = [[0, 'C2', 0.85, '2n'], [26, 'C2', 0.65, '4n'], [40, 'F#2', 0.8, '2n'], [58, 'C2', 0.55, '8n'], [60, 'C2', 0.65, '8n'], [62, 'C2', 0.75, '8n']];
  // The chase: tremolo 8ths, taiko, timpani and brass stabs on the b2 (C to C#)
  const chase = everyBar(1, (): Step[] => Array.from({ length: 8 }, (_, i): Step => [i * 2, i % 4 === 3 ? 'C#2' : 'C2', 0.55 + i * 0.035, '8n']));
  const chaseStrings = everyBar(1, (): Step[] => Array.from({ length: 8 }, (_, i): Step => [i * 2, ['C3', 'C4'], i % 2 ? 0.5 : 0.7, '8n']));
  const drums = everyBar(1, (): Step[] => [[0, 'C2', 0.85, '4n'], [6, 'G1', 0.6, '8n'], [8, 'C2', 0.75, '4n'], [12, 'G1', 0.6, '8n'], [14, 'G1', 0.7, '8n']]);
  const stabs = everyBar(1, (): Step[] => [[0, ['C2', 'C3'], 0.8, '8n'], [10, ['C#2', 'C#3'], 0.85, '8n']]);
  const swell: Step[] = [[0, ['C3', 'F#3'], 0.6, '2m'], [32, ['D#3', 'A3'], 0.6, '1m']];
  return inSpace(project(
    'Horror starter',
    72,
    0,
    [5, 13],
    [drone, trem, box, timp, space, taiko, brass],
    [
      clip(drone, 'Dread', 1, 4, dread, 2),
      clip(drone, 'Dread', 9, 3, [[0, ['C2', 'C3'], 0.7, '3m']]),
      clip(drone, 'Dread', 13, 4, dread),
      clip(trem, 'Cluster', 1, 4, cluster, 2),
      clip(trem, 'Cluster', 9, 3, cluster.slice(0, 3)),
      clip(box, 'Lullaby', 5, 4, lullaby),
      clip(box, 'Lullaby', 9, 3, lullaby.filter(([s]) => s < 48)),
      clip(timp, 'Hits', 5, 4, hits),
      clip(timp, 'Hits', 9, 3, hits.filter(([s]) => s < 48)),
      clip(space, 'Swells', 9, 3, swell),
      clip(timp, 'Chase', 13, 1, chase, 4),
      clip(trem, 'Chase', 13, 1, chaseStrings, 4),
      clip(taiko, 'Chase', 13, 1, drums, 4),
      clip(brass, 'Stabs', 13, 1, stabs, 4),
    ],
    [[1, 'Dread'], [5, 'Lullaby'], [12, 'Silence'], [13, 'Chase']],
    master({ on: false }, { on: true, amount: 1.3 })
  ), CATHEDRAL);
}

// ---------- Celtic ----------

function celtic(): ProjectSnapshot {
  const fiddle = track('Fiddle', 'fiddle', { volume: -2, pan: -0.2, reverbSend: 0.3, fx: { human: human(0.35, 0.3) } });
  const whistle = track('Whistle', 'recorder', { volume: -3, pan: 0.25, reverbSend: 0.3, fx: { human: human(0.35, 0.3) } });
  const guitar = track('Guitar', 'steelGuitar', { volume: -8, reverbSend: 0.2, fx: { human: human(0.3) } });
  // The bodhrán on the acoustic kit's toms
  const bodhran = track('Bodhrán', 'acousticKit', { volume: -4, reverbSend: 0.2, fx: { human: human(0.4) } });
  const pipes = track('Pipes', 'bagpipe', { volume: -8, reverbSend: 0.4, pan: 0.1, fx: { peq: peq(lowCut(200)) } });
  // A reel in D: D - G - D - A, a bar each, strummed down (0.8) and up (0.55)
  const shapes = [['D3', 'A3', 'D4', 'F#4'], ['G2', 'D3', 'G3', 'B3', 'D4'], ['D3', 'A3', 'D4', 'F#4'], ['A2', 'E3', 'A3', 'C#4', 'E4']];
  const strumming = everyBar(4, (b) => [0, 3, 4, 6, 8, 11, 12, 14].flatMap((i, k) => (k % 2 ? strum(i, shapes[b].slice(-3), 0.55, '8n', 0.05, true) : strum(i, shapes[b], 0.8, '8n', 0.06))));
  const reel: Step[] = [
    'F#5', 'A5', 'A5', 'F#5', 'D5', 'F#5', 'A5', 'F#5', 'G5', 'B5', 'B5', 'A5', 'G5', 'F#5', 'E5', 'D5',
    'F#5', 'A5', 'A5', 'F#5', 'D5', 'F#5', 'A5', 'D6', 'C#6', 'A5', 'E5', 'F#5', 'G5', 'E5', 'C#5', 'E5',
  ].map((n, i): Step => [i * 2, n, i % 4 === 0 ? 0.85 : i % 2 ? 0.6 : 0.7, '8n']);
  const harmony = reel.map(([st, n, v, d]): Step => [st, n, v * 0.85, d]).filter((_, i) => i % 2 === 0);
  const drum = everyBar(1, (): Step[] => [[0, D.tomLow, 0.85], [3, D.tomMid, 0.45], [4, D.tomLow, 0.65], [6, D.tomHigh, 0.5], [8, D.tomLow, 0.8], [11, D.tomMid, 0.45], [12, D.tomLow, 0.65], [14, D.snare, 0.45]]);
  const drone: Step[] = [[0, ['D4', 'A4'], 0.6, '4m']];
  return inSpace(project(
    'Celtic starter',
    112,
    0,
    [5, 17],
    [fiddle, whistle, guitar, bodhran, pipes],
    [
      clip(guitar, 'Strum', 1, 4, strumming, 4),
      clip(bodhran, 'Bodhrán', 1, 1, drum, 16),
      withLanes(clip(fiddle, 'Reel', 5, 4, reel, 3), { vibrato: [{ at: 0, value: 0.2 }] }),
      withLanes(clip(whistle, 'Whistle', 9, 4, harmony, 2), { vibrato: [{ at: 0, value: 0.2 }] }),
      clip(pipes, 'Drone', 13, 4, drone),
    ],
    [[1, 'Intro'], [5, 'Reel'], [9, 'Whistle'], [13, 'Pipes']],
    master({ on: false }, { on: true, amount: 1.15 })
  ), STUDIO);
}

// ---------- Latin (bossa nova) ----------

function latin(): ProjectSnapshot {
  const guitar = track('Guitar', 'nylonGuitar', { volume: -3, reverbSend: 0.2, fx: { human: human(0.35) } });
  const bass = track('Bass', 'uprightBass', { volume: 0, fx: { peq: peq(lowCut(35)), human: human(0.35, 0.15) } });
  const perc = track('Percussion', 'bongos', { volume: -1, fx: { human: human(0.4) } });
  const kit = track('Kit', 'acousticKit', { volume: -2, fx: { human: human(0.35) } });
  const agogo = track('Agogô', 'agogo', { volume: -16, pan: 0.35, reverbSend: 0.2, fx: { human: human(0.4) } });
  const flute = track('Flute', 'flute', { volume: -4, reverbSend: 0.35, delaySend: 0.15, fx: { peq: peq(lowCut(200)), human: human(0.35, 0.3) } });
  // Dm9 - G13 - Cmaj9 - A7, a bar each
  const voicings = [['D3', 'F3', 'C4', 'E4'], ['G2', 'F3', 'B3', 'E4'], ['C3', 'E3', 'B3', 'D4'], ['A2', 'G3', 'C#4', 'F4']];
  const comp = everyBar(4, (b) => [0, 3, 6, 10, 12].flatMap((i, k) => strum(i, voicings[b], k === 0 ? 0.7 : 0.52 + 0.04 * (k % 2), '8n', 0.05)));
  const bassLine = everyBar(4, (b): Step[] => { const r = ['D2', 'G1', 'C2', 'A1'][b]; const f = ['A2', 'D2', 'G2', 'E2'][b]; return [[0, r, 0.85, '4n.'], [6, f, 0.65, '8n'], [8, f, 0.75, '4n.'], [14, r, 0.6, '8n']]; });
  const shaker = everyBar(1, (): Step[] => [...Array.from({ length: 8 }, (_, i): Step => [i * 2, D.closedHat, i % 2 ? 0.32 : 0.5]), [0, D.tomHigh, 0.6], [6, D.tomHigh, 0.45], [10, D.tomMid, 0.55], [14, D.tomLow, 0.6]]);
  const rim: Step[] = [...[0, 6, 8, 14, 16, 22, 24, 30].map((i): Step => [i, D.kick, i % 8 === 0 ? 0.6 : 0.45]), ...[0, 3, 6, 10, 12, 19, 22, 26, 28].map((i): Step => [i, D.snare, 0.3])];
  // Two bells, low and high
  const bells = everyBar(2, (b): Step[] => [[0, 'C5', 0.6], [3, 'G4', 0.45], [6, 'G4', 0.5], [10, 'C5', 0.55], ...(b ? [[12, 'G4', 0.45] as Step] : [[13, 'C5', 0.45] as Step])]);
  const tune: Step[] = [
    [0, 'A5', 0.75, '4n.'], [6, 'G5', 0.65, '8n'], [8, 'F5', 0.7, '4n'], [12, 'E5', 0.65, '4n'],
    [16, 'F5', 0.75, '2n'], [24, 'D5', 0.65, '4n'], [28, 'E5', 0.65, '4n'],
    [32, 'E5', 0.75, '4n.'], [38, 'D5', 0.65, '8n'], [40, 'B4', 0.7, '2n'],
    [48, 'C#5', 0.75, '2n'], [56, 'E5', 0.65, '4n'], [60, 'G5', 0.65, '4n'],
  ];
  return inSpace(project(
    'Latin starter',
    130,
    0,
    [5, 17],
    [guitar, bass, perc, kit, agogo, flute],
    [
      clip(guitar, 'Bossa comping', 1, 4, comp, 4),
      clip(perc, 'Shaker & bongos', 1, 1, shaker, 16),
      clip(bass, 'Bass', 5, 4, bassLine, 3),
      clip(kit, 'Rim & kick', 5, 2, rim, 6),
      clip(agogo, 'Agogô', 9, 2, bells, 4),
      withLanes(clip(flute, 'Melody', 9, 4, legato(tune), 2), VIBRATO),
    ],
    [[1, 'Intro'], [5, 'Groove'], [9, 'Melody']],
    master({ on: false }, { on: true, amount: 1.1 })
  ), ROOM);
}

// ---------- Fantasy Tavern ----------

function tavern(): ProjectSnapshot {
  const dulcimer = track('Dulcimer', 'dulcimer', { volume: -2, reverbSend: 0.25, pan: -0.2, fx: { human: human(0.35) } });
  const lute = track('Lute', 'nylonGuitar', { volume: -3, reverbSend: 0.2, pan: 0.2, fx: { human: human(0.35) } });
  const recorder = track('Recorder', 'recorder', { volume: -3, reverbSend: 0.3, fx: { human: human(0.35, 0.3) } });
  const drum = track('Hand drum', 'bongos', { volume: 4, reverbSend: 0.15, fx: { human: human(0.45) } });
  const accordion = track('Accordion', 'accordion', { volume: -8, reverbSend: 0.25, fx: { human: human(0.3) } });
  // D minor jig feel (triplet 8ths): Dm - C - Bb - A, a bar each
  const t = 16 / 6;
  const triads = [['D4', 'F4', 'A4'], ['C4', 'E4', 'G4'], ['A#3', 'D4', 'F4'], ['A3', 'C#4', 'E4']];
  const lutePart = everyBar(4, (b) => [0, 1, 2, 3, 4, 5].map((k): Step => [k * t, k === 0 ? triads[b][0].replace(/\d/, (o) => String(Number(o) - 1)) : triads[b][k % 2 ? 1 : 2], k % 3 === 0 ? 0.75 : 0.5, '8n']));
  const tune: Step[] = [
    ...['A4', 'D5', 'D5', 'E5', 'F5', 'E5'], ...['G5', 'E5', 'C5', 'E5', 'G5', 'E5'],
    ...['F5', 'D5', 'A#4', 'D5', 'F5', 'A5'], ...['E5', 'C#5', 'A4', 'C#5', 'E5', 'A4'],
  ].map((n, i): Step => [i * t, n, i % 3 === 0 ? 0.85 : 0.6 + 0.05 * (i % 2), '8n']);
  const drumPart = everyBar(1, (): Step[] => [[0, D.tomLow, 0.85], [2 * t, D.tomHigh, 0.5], [3 * t, D.tomLow, 0.7], [5 * t, D.tomHigh, 0.55]]);
  const harmony = tune.filter((_, i) => i % 3 === 0).map(([st, n, v]): Step => [st, n, v * 0.8, '4n.']);
  const squeeze = legato(progression(triads, 16, '1n', 0.55));
  return inSpace(project(
    'Fantasy Tavern starter',
    110,
    0,
    [5, 17],
    [dulcimer, lute, recorder, drum, accordion],
    [
      clip(lute, 'Lute', 1, 4, lutePart, 4),
      clip(drum, 'Hand drum', 1, 1, drumPart, 16),
      clip(dulcimer, 'Tune', 5, 4, tune, 3),
      clip(accordion, 'Accordion', 9, 4, squeeze, 2),
      withLanes(clip(recorder, 'Recorder', 13, 4, harmony), { vibrato: [{ at: 0, value: 0.2 }] }),
    ],
    [[1, 'Intro'], [5, 'Tune'], [9, 'Full tavern']],
    master({ on: false }, { on: true, amount: 1.1 })
  ), ROOM);
}

// ---------- Eastern ----------

function eastern(): ProjectSnapshot {
  const koto = track('Koto', 'koto', { volume: -3, reverbSend: 0.4, pan: -0.2, fx: { human: human(0.35) } });
  const flute = track('Shakuhachi', 'shakuhachi', { volume: -4, reverbSend: 0.5, delaySend: 0.15, fx: { human: human(0.3, 0.3) } });
  const taiko = track('Taiko', 'taiko', { volume: -5, reverbSend: 0.35, fx: { human: human(0.15) } });
  const pad = track('Pad', 'glassPad', { volume: -20, reverbSend: 0.5 });
  const shamisen = track('Shamisen', 'shamisen', { volume: -1, pan: 0.25, reverbSend: 0.3, fx: { human: human(0.35) } });
  // The in scale on D: D, Eb, G, A, Bb
  const pattern = ['D4', 'A4', 'D5', 'D#5', 'A4', 'D5', 'A#4', 'G4'];
  const kotoPart = everyBar(2, (b) => pattern.map((n, i): Step => [i * 2, b && i === 7 ? 'A4' : n, i % 4 === 0 ? 0.8 : 0.55 + 0.05 * (i % 2), '4n']));
  const tune: Step[] = [
    [0, 'A5', 0.75, '2n'], [8, 'A#5', 0.6, '8n'], [10, 'A5', 0.7, '4n.'],
    [16, 'G5', 0.7, '4n'], [20, 'D#5', 0.6, '4n'], [24, 'D5', 0.75, '2n'],
    [32, 'D#5', 0.7, '4n.'], [38, 'G5', 0.6, '8n'], [40, 'A5', 0.75, '2n'],
    [48, 'D6', 0.7, '4n'], [52, 'A#5', 0.6, '4n'], [56, 'A5', 0.7, '2n'],
  ];
  // Each phrase's long last note falls away (a bend of about -70 cents), as a shakuhachi player lets it go
  const fall = (end: number) => [{ at: end - 0.1, value: 0 }, { at: end - 0.01, value: -0.7 }, { at: end, value: 0 }];
  const lanes: ClipExpression = { vibrato: [{ at: 0, value: 0.25 }], bend: [{ at: 0, value: 0 }, ...fall(0.5), ...fall(2), ...fall(3), ...fall(4)] };
  // Low taiko: D2, A2 and G1
  const drums = everyBar(2, (b): Step[] => [[0, 'D2', 0.85, '4n'], [6, 'D2', 0.55, '8n'], [8, 'A2', 0.75, '4n'], ...(b ? [[12, 'G1', 0.65, '8n'] as Step, [13, 'G1', 0.7, '8n'] as Step, [14, 'D2', 0.8, '8n'] as Step] : [[12, 'D2', 0.65, '4n'] as Step])]);
  const drone: Step[] = [[0, ['D3', 'A3', 'D4'], 0.6, '4m']];
  const pluck = everyBar(1, (): Step[] => [[0, 'D4', 0.8, '8n'], [3, 'D4', 0.55, '16n'], [6, 'A4', 0.7, '8n'], [10, 'G4', 0.65, '8n'], [12, 'D#4', 0.6, '8n']]);
  return inSpace(project(
    'Eastern starter',
    84,
    0,
    [5, 17],
    [koto, flute, taiko, pad, shamisen],
    [
      clip(pad, 'Drone', 1, 4, drone, 4),
      clip(koto, 'Koto', 1, 2, kotoPart, 8),
      withLanes(clip(flute, 'Shakuhachi', 5, 4, tune), lanes),
      withLanes(clip(flute, 'Shakuhachi', 9, 4, tune), lanes),
      withLanes(clip(flute, 'Shakuhachi', 13, 4, tune), lanes),
      clip(taiko, 'Taiko', 9, 2, drums, 4),
      clip(shamisen, 'Shamisen', 13, 1, pluck, 4),
    ],
    [[1, 'Garden'], [5, 'Flute'], [9, 'Drums'], [13, 'Shamisen']],
    master({ on: false }, { on: true, amount: 1.2 })
  ), HALL);
}

// ---------- Funk ----------

function funk(): ProjectSnapshot {
  const drums = track('Drums', 'acousticKit', { volume: -2, fx: { compressor: GLUE, human: human(0.4) } });
  // The recorded slapped bass, not the synthesized one
  const bass = track('Bass', 'slappedBass', { volume: -1, fx: { peq: peq(lowCut(35)), compressor: { on: true, threshold: -18, ratio: 4, makeup: 2 }, human: human(0.35) } });
  const gtr = track('Guitar', 'mutedGuitar', { volume: -5, pan: -0.3, fx: { human: human(0.25) } });
  const clav = track('Clavinet', 'clavinet', { volume: -9, pan: 0.3, fx: { human: human(0.25) } });
  const brass = track('Horns', 'brassSection', { volume: -3, reverbSend: 0.25, pan: 0.2, fx: { peq: peq(lowCut(100)), human: human(0.3, 0.2) } });
  const organ = track('Organ', 'drawbarOrgan', { volume: -11, reverbSend: 0.2, fx: { human: human(0.3) } });
  // An E9 vamp, ghost snares at 0.25
  const beat = everyBar(1, (): Step[] => [
    [0, D.kick, 0.85], [3, D.kick, 0.65], [10, D.kick, 0.78], [4, D.snare, 0.92], [12, D.snare, 0.95], [7, D.snare, 0.25], [9, D.snare, 0.22], [15, D.snare, 0.28],
    ...Array.from({ length: 16 }, (_, i): Step => [i, D.closedHat, i % 4 === 0 ? 0.55 : i % 2 ? 0.28 : 0.42]),
  ]);
  const bassLine: Step[] = [[0, 'E1', 0.9, '8n'], [3, 'E2', 0.65, '16n'], [6, 'E1', 0.75, '16n'], [7, 'G1', 0.7, '16n'], [8, 'A1', 0.85, '8n'], [11, 'A#1', 0.65, '16n'], [12, 'B1', 0.8, '8n'], [14, 'D2', 0.65, '16n'], [15, 'E2', 0.7, '16n']];
  // 16ths: accents on the "e"s, ghosts between (0.3 to 0.8)
  const scratch = everyBar(1, (): Step[] => Array.from({ length: 16 }, (_, i): Step => [i, ['G#3', 'D4', 'F#4'], i % 4 === 2 ? 0.8 : i % 4 === 0 ? 0.45 : 0.3, '16n']));
  const clavRiff = everyBar(1, (): Step[] => [[0, ['E3', 'G#3', 'D4'], 0.8, '16n'], [2, ['E3', 'G#3', 'D4'], 0.45, '16n'], [3, ['E3', 'G#3', 'D4'], 0.65, '16n'], [6, ['G3', 'B3', 'E4'], 0.75, '16n'], [8, ['E3', 'G#3', 'D4'], 0.7, '16n'], [11, ['E3', 'G#3', 'D4'], 0.5, '16n'], [14, ['D3', 'F#3', 'B3'], 0.7, '16n']]);
  // Horn hits on the "and" of 2 and on 4
  const hits: Step[] = [[6, ['G#4', 'D5', 'F#5'], 0.9, '16n'], [12, ['G#4', 'D5', 'F#5'], 0.8, '8n'], [22, ['A4', 'C#5', 'E5'], 0.9, '16n'], [28, ['B4', 'D5', 'F#5'], 0.95, '4n']];
  const pad = progression([['E3', 'G#3', 'D4', 'F#4']], 16, '1n', 0.6);
  return inSpace(project(
    'Funk starter',
    104,
    0.12,
    [5, 17],
    [drums, bass, gtr, clav, brass, organ],
    [
      clip(drums, 'Groove', 1, 1, beat, 16),
      clip(bass, 'Bass', 1, 1, bassLine, 16),
      clip(gtr, 'Scratch', 5, 1, scratch, 12),
      clip(organ, 'Organ', 5, 1, pad, 12),
      clip(clav, 'Clav riff', 9, 1, clavRiff, 8),
      clip(brass, 'Horn hits', 9, 2, hits, 4),
    ],
    [[1, 'Groove'], [5, 'Band'], [9, 'Horns']],
    master({ on: true, depth: 0.1 }, { on: true, amount: 1.1 })
  ), ROOM);
}

const BUILDERS: Record<StarterId, () => ProjectSnapshot> = {
  dubstep, house, dnb, trap, cinematic, lofi, chiptune, hiphop,
  classical, angelic, epic, ambient, rock, metal, jazz, synthwave, pop, trance, horror, celtic, latin, tavern, eastern, funk,
  ...PLAYLIST_BUILDERS,
  ...GAME_BUILDERS,
  ...MORE_GAME_BUILDERS,
  ...STORY_BUILDERS,
  ...SHOWCASE_BUILDERS,
  ...CLASSICS_BUILDERS,
};

/**
 * A fresh copy of a starter. Its ids are the same every time (withStableIds), so every copy plays
 * and exports exactly alike: the Human insert's drift, and the recordings it picks, follow them.
 */
export function createStarter(id: StarterId): ProjectSnapshot {
  return withStableIds(`starter_${id}`, () => {
    const p = withRoom(id, withGlue(id, wholeSong(withSwells(inRange(withSeats(recorded(BUILDERS[id]())))))));
    // Last, the level: each starter brought to its group's loudness (see startersLoudness.ts)
    return trimMix(withBreathing(id, withVibrato(id, withLegato(id, ownVibrato(p)))), starterTrimDb(id));
  });
}

/**
 * The recorded instrument (or Synth Designer pad) each older General MIDI sound in the starters
 * becomes, with `db` added to the track's volume so its level in the mix stays where it was
 * (measured: the same notes through both, A-weighted). `short` plays parts of short notes (under an
 * eighth on average) with the short-stroke recordings, and `high` takes parts too high for the
 * recording (the horn's top, which the section's trumpet plays). `anyNote`: a note out of the
 * recording's range moves by octaves into it (a timpani hit stays a hit). Taiko, music box and the rest
 * have no free recording yet and stay as they are.
 */
const RECORDED: Record<string, { to: InstrumentKey; db: number; short?: InstrumentKey; shortDb?: number; high?: InstrumentKey; highDb?: number; preset?: string; anyNote?: boolean }> = {
  cello: { to: 'realCello', db: -4, short: 'realCelloShort', shortDb: -2.5 },
  brassSection: { to: 'realBrass', db: -3 },
  distortionGuitar: { to: 'realLeadGuitar', db: 1.5 },
  timpani: { to: 'realTimpani', db: 1.0, anyNote: true },
  slowStrings: { to: 'realStrings', db: -15 },
  strings: { to: 'realStrings', db: 0 },
  tremolo: { to: 'realTremolo', db: 2 },
  uprightBass: { to: 'realUprightBass', db: 1.5 },
  cleanGuitar: { to: 'realGuitar', db: -1.0 },
  harp: { to: 'realHarp', db: -2 },
  flute: { to: 'realFlute', db: 0.0, short: 'realFluteShort', shortDb: -3.0 },
  frenchHorn: { to: 'realHorn', db: 3.0, short: 'realHornShort', shortDb: -2.5, high: 'realBrass', highDb: -4 },
  pizzicato: { to: 'realPizzicato', db: -3.5 },
  // (Matched A-weighted, which hardly hears a double bass's low notes: at -3.5 it played 3 to 10 dB
  // over every other part in all five starters that have one; now it sits a little under the cellos)
  contrabass: { to: 'realDoubleBass', db: -12 },
  marimba: { to: 'realMarimba', db: 0.5 },
  violin: { to: 'realViolin', db: -3, short: 'realViolinsShort', shortDb: -2.5 },
  viola: { to: 'realViolas', db: -1.0, short: 'realViolasShort', shortDb: -3.5 },
  trombone: { to: 'realTrombone', db: -0.5, short: 'realTromboneShort', shortDb: 2.0 },
  pickBass: { to: 'realElectricBass', db: 1 },
  fingerBass: { to: 'realElectricBass', db: -0.5 },
  vibraphone: { to: 'realVibraphone', db: -5.0 },
  // (the tenor's parts play the alto with vibrato, which is 2.8 dB quieter: they all fit its range)
  tenorSax: { to: 'realAltoSax', db: 3.3 },
  saxophone: { to: 'realAltoSax', db: 1.5 },
  glockenspiel: { to: 'realGlockenspiel', db: 4.0 },
  overdriveGuitar: { to: 'realCrunchGuitar', db: 5 },
  pipeOrgan: { to: 'realPipeOrgan', db: -3.5 },
  kalimba: { to: 'realKalimba', db: -3.5 },
  chimes: { to: 'realTubularBells', db: -1.0 },
  trumpet: { to: 'realTrumpet', db: 3.0, short: 'realTrumpetShort', shortDb: -0.5 },
  bassoon: { to: 'realBassoon', db: -0.5 },
  clarinet: { to: 'realClarinet', db: -0.5 },
  harpsichord: { to: 'realHarpsichord', db: -0.5 },
  tuba: { to: 'realTuba', db: 1.5 },
  glassPad: { to: 'synthDesigner', preset: 'Glass pad', db: -8 },
  warmPad: { to: 'synthDesigner', preset: 'Warm pad', db: -5 },
  haloPad: { to: 'synthDesigner', preset: 'Halo pad', db: -4.0 },
  sweepPad: { to: 'synthDesigner', preset: 'Sweep pad', db: 1.5 },
  polysynthPad: { to: 'synthDesigner', preset: 'Polysynth', db: 0.0 },
  soundtrackPad: { to: 'synthDesigner', preset: 'Soundtrack pad', db: 0.5 },
  // The electric piano rings on for a held chord (up to 8 s), so every part moves to it. Matched
  // part by part rather than here (A-weighted, each starter's part through both): against the old
  // sound they ranged from -0.5 to +3.5 dB, so each starter's electric piano fader is set for it
  rhodes: { to: 'realElectricPiano', db: 0 },
  acousticKit: { to: 'studioKit', db: 0, anyNote: true },
  banjo: { to: 'realBanjo', db: 0 },
  harmonica: { to: 'realHarmonica', db: 0 },
  ocarina: { to: 'realOcarina', db: 0 },
  steelDrums: { to: 'realSteelDrums', db: 0 },
  // (Matched part by part, A-weighted, each starter's part through both: the celesta's parts
  // ranged from +0.3 to +2.4 dB, the recorder's +1.3 to +2.7, the muted trumpet's +1.7 to +7.5,
  // its highest parts most; the farthest parts' faders are set for it)
  celesta: { to: 'realCelesta', db: -1.0 },
  recorder: { to: 'realRecorder', db: -2.0 },
  // (the muted trumpet's parts now play the open trumpet with vibrato, 0.8 dB under the muted one)
  mutedTrumpet: { to: 'realTrumpet', db: -4.2 },
  // (Matched part by part, by loudness, each starter's part through both: the classical guitar's
  // four parts came out 0.5 to 1.2 dB louder)
  nylonGuitar: { to: 'realNylonGuitar', db: -0.8 },
};

/**
 * Starters play the recorded instruments: each track on an older General MIDI sound moves to its
 * recording (see RECORDED) when its notes fit the recording's range, at a level that keeps the mix.
 */
function recorded(p: ProjectSnapshot): ProjectSnapshot {
  const tracks = p.tracks.map((t) => {
    const swap = RECORDED[t.instrumentKey];
    if (!swap) return t;
    const notes = p.clips.filter((c) => c.trackId === t.id).flatMap((c) => c.notes);
    const average = notes.length ? notes.reduce((a, n) => a + durationToBars(n.duration), 0) / notes.length : 1;
    const fits = (key: InstrumentKey) => {
      const [lo, hi] = INSTRUMENTS[key].range;
      return key === 'synthDesigner' || swap.anyNote || notes.filter((n) => midiOf(n.note) >= lo && midiOf(n.note) <= hi).length >= notes.length * 0.9;
    };
    const choices: Array<[InstrumentKey | undefined, number | undefined]> = [
      ...(average < 0.125 - 1e-6 ? [[swap.short, swap.shortDb] as [InstrumentKey | undefined, number | undefined]] : []),
      [swap.to, swap.db],
      [swap.high, swap.highDb],
    ];
    const [to, db] = choices.find(([key]) => key && fits(key)) ?? [];
    if (!to) return t;
    return { ...t, instrumentKey: to, volume: t.volume + db!, ...(swap.preset ? { synth: presetPatch(swap.preset) } : {}) };
  });
  const stingers = p.stingers?.map((st) => {
    const to = RECORDED[st.instrumentKey]?.to;
    if (!to || to === 'synthDesigner') return st;
    const [lo, hi] = INSTRUMENTS[to].range;
    return st.notes.every((n) => midiOf(n.note) >= lo && midiOf(n.note) <= hi) ? { ...st, instrumentKey: to } : st;
  });
  return { ...p, tracks, ...(stingers ? { stingers } : {}) };
}

/** The master compressor's style each group of starters suits (see GLUE_STYLES). */
const GROUP_GLUE: Partial<Record<(typeof STARTER_GROUPS)[number], MasterSettings['glue']>> = {
  'Bass Music': 'tight',
  Electronic: 'tight',
  'Orchestral & Choir': 'gentle',
  'Chill & World': 'gentle',
  'Hip-Hop & Phonk': 'punchy',
  Band: 'punchy',
  'Pop & Jazz': 'punchy',
  // (the Classical Flips choose punchy glue themselves)
  Classics: 'gentle',
};

/** The reverb's room for each group of starters (see roomIR.ts; the rest play in the hall). */
const GROUP_ROOM: Partial<Record<(typeof STARTER_GROUPS)[number], RoomStyle>> = {
  Band: 'studio',
  'Hip-Hop & Phonk': 'studio',
  'Pop & Jazz': 'chamber',
  Electronic: 'plate',
  'Bass Music': 'plate',
  'Artcore & Rhythm Games': 'plate',
};

/** A starter's reverb room from its group, unless its builder recorded one. */
function withRoom(id: StarterId, p: ProjectSnapshot): ProjectSnapshot {
  const group = STARTERS.find((s) => s.id === id)?.group;
  const roomStyle = group && GROUP_ROOM[group];
  if (!roomStyle || p.masterFx?.room || p.masterFx?.roomStyle) return p;
  return { ...p, masterFx: { ...DEFAULT_MASTER_FX, ...p.masterFx, roomStyle } };
}

/**
 * Orchestral instruments take their seats on the stage (seatOf): their usual distance, and their
 * usual side where the starter left them in the middle.
 */
function withSeats(p: ProjectSnapshot): ProjectSnapshot {
  return {
    ...p,
    tracks: p.tracks.map((t) => {
      const seat = seatOf(t.instrumentKey);
      if (!seat || t.distance !== undefined) return t;
      return { ...t, distance: seat.distance, pan: t.pan === 0 ? seat.pan : t.pan };
    }),
  };
}

/** A starter's master glue from its group, unless its builder chose one. */
function withGlue(id: StarterId, p: ProjectSnapshot): ProjectSnapshot {
  const group = STARTERS.find((s) => s.id === id)?.group;
  const glue = group && GROUP_GLUE[group];
  if (!glue || !p.master || p.master.glue !== 'standard') return p;
  return { ...p, master: { ...p.master, glue } };
}

/** The starters whose solo string melodies play legato, sliding between notes (see withLegato). */
const LEGATO_STARTERS = new Set<string>(['starlitCity', 'farewellPiano', 'cathedralBoss', 'classical', 'cinematic', 'title', 'melodicdub']);
/** The starters whose long held melodies get a singer's vibrato (see withVibrato). */
const VIBRATO_STARTERS = new Set<string>(['classical', 'title', 'wildField', 'starlitCity', 'farewellPiano', 'puzzle', 'shop', 'midnightCaper', 'ruinRequiem', 'angelic', 'neosoul']);
/** The (non-game, unhurried) starters whose tempo breathes at phrase ends (see withBreathing). */
const BREATHING_STARTERS = new Set<string>(['classical', 'angelic', 'cinematic']);
/** The held melody voices vibrato suits */
const SINGING = /violin|viola|cello|flute|oboe|clarinet|horn|voice|choir|sax|trumpet/i;

/** A track's notes are a single line (a melody) when hardly any start together. */
function isLine(notes: readonly { startOffset: number }[]): boolean {
  const starts = new Map<number, number>();
  for (const n of notes) starts.set(n.startOffset, (starts.get(n.startOffset) ?? 0) + 1);
  return [...starts.values()].filter((v) => v > 1).length < notes.length * 0.15;
}

/**
 * Solo string melodies played legato: a note that ends at (or just before) the next one's start
 * runs a little into it, so the bowed instrument changes note without a new bow stroke and slides
 * between the two (its portamento), as a string player connects a phrase. Leaps over an octave,
 * repeated notes and chords are left as they are.
 */
function withLegato(id: StarterId, p: ProjectSnapshot): ProjectSnapshot {
  if (!LEGATO_STARTERS.has(id)) return p;
  const overlap = (0.06 * p.bpm) / 240; // 60 ms, in bars
  const lines = new Set(
    p.tracks.filter((t) => INSTRUMENTS[t.instrumentKey]?.bowed && isLine(p.clips.filter((c) => c.trackId === t.id).flatMap((c) => c.notes))).map((t) => t.id)
  );
  const clips = p.clips.map((c) => {
    if (!lines.has(c.trackId) || c.audio || c.notes.length < 2) return c;
    const sorted = [...c.notes].sort((a, b) => a.startOffset - b.startOffset);
    const together = (n: (typeof sorted)[number]) => sorted.filter((m) => Math.abs(m.startOffset - n.startOffset) < 1e-6).length > 1;
    const longer = new Map<string, string>();
    sorted.forEach((n, i) => {
      const next = sorted[i + 1];
      if (!next || together(n) || together(next) || next.note === n.note) return;
      const gap = next.startOffset - (n.startOffset + durationToBars(n.duration));
      if (gap < -1e-6 || gap > 1 / 16 + 1e-6 || Math.abs(midiOf(next.note) - midiOf(n.note)) > 12) return;
      longer.set(n.id, barsToDuration(next.startOffset - n.startOffset + overlap));
    });
    return longer.size ? { ...c, notes: c.notes.map((n) => (longer.has(n.id) ? { ...n, duration: longer.get(n.id)! } : n)) } : c;
  });
  return { ...p, clips };
}

/**
 * The bowed strings that already play with a vibrato: recorded with one (the sections and the
 * solo violin of VSCO), or given one note by note (InstrumentDef.vibrato).
 */
const OWN_VIBRATO = new Set<string>(['realSoloViolin', 'realViolins', 'realViolas', 'realCello', 'realStrings']);
const hasOwnVibrato = (key: InstrumentKey) => OWN_VIBRATO.has(key) || !!INSTRUMENTS[key]?.vibrato;

/**
 * A string part that plays its own vibrato loses the vibrato lane its starter drew for the older
 * sound: the lane's even wobble on top of a player's vibrato is two vibratos at once, a seasick,
 * synthetic sound.
 */
function ownVibrato(p: ProjectSnapshot): ProjectSnapshot {
  const own = new Set(p.tracks.filter((t) => hasOwnVibrato(t.instrumentKey)).map((t) => t.id));
  if (!own.size) return p;
  const clips = p.clips.map((c) => {
    if (!own.has(c.trackId) || !c.expression?.vibrato) return c;
    const { vibrato: _, ...rest } = c.expression;
    return { ...c, expression: rest };
  });
  return { ...p, clips };
}

/** How deep the vibrato grows (of the lane's 0..1, VIBRATO_CENTS at 1): about ±20 cents */
const VIBRATO_DEPTH = 0.4;

/**
 * Long held melody notes (strings, winds, voices, horns) get vibrato as a player gives it: none as
 * the note starts, blooming over its middle and held to near its end. Notes shorter than a beat
 * (or half a second) stay plain. A clip with its own vibrato lane is left as it is.
 */
function withVibrato(id: StarterId, p: ProjectSnapshot): ProjectSnapshot {
  if (!VIBRATO_STARTERS.has(id)) return p;
  const barSeconds = 240 / p.bpm;
  const singing = new Set(
    p.tracks
      .filter((t) => SINGING.test(t.instrumentKey) && !hasOwnVibrato(t.instrumentKey))
      .filter((t) => {
        const notes = p.clips.filter((c) => c.trackId === t.id).flatMap((c) => c.notes);
        return notes.length > 0 && isLine(notes) && notes.reduce((a, n) => a + durationToBars(n.duration), 0) / notes.length >= 0.5 - 1e-6;
      })
      .map((t) => t.id)
  );
  const clips = p.clips.map((c) => {
    if (!singing.has(c.trackId) || c.audio || !c.notes.length || c.expression?.vibrato) return c;
    const points: Array<{ at: number; value: number }> = [];
    for (const n of [...c.notes].sort((a, b) => a.startOffset - b.startOffset)) {
      const d = Math.min(durationToBars(n.duration), c.lengthBars - n.startOffset);
      if (d < 0.25 - 1e-6 || d * barSeconds < 0.5) continue;
      const at = (f: number) => Math.round((n.startOffset + d * f) * 10000) / 10000;
      points.push({ at: at(0.3), value: 0 }, { at: at(0.7), value: VIBRATO_DEPTH }, { at: at(0.92), value: VIBRATO_DEPTH }, { at: at(1), value: 0 });
    }
    if (!points.length) return c;
    // In order, and one point per place (a later one wins)
    const lane = [...new Map(points.sort((a, b) => a.at - b.at).map((pt) => [pt.at, pt])).values()];
    return { ...c, expression: { ...(c.expression ?? {}), vibrato: lane } };
  });
  return { ...p, clips };
}

/**
 * The unhurried pieces breathe: the tempo eases into each 4-bar phrase end and slows into the
 * last (the Song menu's Breathe). Not the game starters, whose beat-synced transitions and loops
 * need a steady tempo, nor the dance tracks.
 */
function withBreathing(id: StarterId, p: ProjectSnapshot): ProjectSnapshot {
  if (!BREATHING_STARTERS.has(id) || p.tempoPoints?.length) return p;
  const tempoPoints = breathe([], { bpm: p.bpm, points: [] }, { base: p.meter ?? FOUR_FOUR, points: p.meterPoints ?? [] }, { from: 1, to: p.loopRegion.outBar, phrase: 4, amount: 0.06 }, () => uid('tempo'));
  return typeof tempoPoints === 'string' ? p : { ...p, tempoPoints };
}

/**
 * Play loops the whole starter, its first bar to its last: someone new presses Play and hears all
 * of it, rather than the first section over and over until they find the loop's Out point. (The
 * song may not loop seamlessly end to start; that's for its writer to shape.)
 */
function wholeSong(p: ProjectSnapshot): ProjectSnapshot {
  const end = Math.ceil(Math.max(2, ...p.clips.map((c) => c.startBar + c.lengthBars)) - 1e-6);
  return { ...p, loopRegion: { inBar: 1, outBar: end, enabled: true } };
}

/** The held, bowed, blown and sung instruments a player shapes as they sustain (see withSwells). */
const SWELLED = new Set<string>([
  'strings', 'slowStrings', 'synthStrings', 'synthStrings2', 'violin', 'viola', 'cello', 'contrabass', 'tremolo',
  'realViolins', 'realViolas', 'realCello', 'realSoloViolin', 'realDoubleBass', 'realTremolo',
  'realViolin', 'realViola', 'realSoloCello', 'realContrabass',
  'realStrings', 'realBrass', 'realTenorSax',
  'realChoir', 'realChoirOoh', 'choir', 'voiceOohs', 'synthChoir', 'choirPad', 'haloPad', 'warmPad', 'newAgePad', 'glassPad', 'sweepPad', 'polysynthPad', 'soundtrackPad', 'atmosphere',
  'frenchHorn', 'realHorn', 'tuba', 'realTuba', 'trombone', 'realTrombone', 'oboe', 'realOboe', 'clarinet', 'realClarinet', 'bassoon', 'realBassoon', 'englishHorn',
]);

/**
 * Every starter's held parts breathe: a clip of strings, pads, voices, horns or woodwinds whose
 * notes last a beat or more on average gets a gentle swell on the mod wheel (dynamics), each
 * phrase growing to its middle and easing off, half as deep as the Swell tool's, so the part
 * moves without falling back. A clip with its own mod wheel lane is left as it is.
 */
function withSwells(p: ProjectSnapshot): ProjectSnapshot {
  // and the Synth Designer's slow-starting pads
  const pad = (t: Track) => t.instrumentKey === 'synthDesigner' && (t.synth?.amp.attack ?? 0) >= 0.3;
  const swelled = new Set(p.tracks.filter((t) => SWELLED.has(t.instrumentKey) || pad(t)).map((t) => t.id));
  const shaped = new Set<string>();
  const clips = p.clips.map((c) => {
    if (!swelled.has(c.trackId) || !c.notes.length || c.audio || c.expression?.mod) return c;
    const average = c.notes.reduce((sum, n) => sum + durationToBars(n.duration), 0) / c.notes.length;
    if (average < 0.25 - 1e-6) return c;
    shaped.add(c.trackId);
    return { ...c, expression: { ...c.expression, mod: swellLane(undefined, c.notes, 'swell', SWELL_DEPTH) } };
  });
  // The swells' dips would leave the part quieter on the whole: its level made up, so the tops of
  // the swells sit a little over where it was and the dips a little under
  return { ...p, clips, tracks: p.tracks.map((t) => (shaped.has(t.id) ? { ...t, volume: t.volume + SWELL_MAKEUP_DB } : t)) };
}
/** The level the starters' swells cost a part, made up (dB). */
const SWELL_MAKEUP_DB = 2.5;
/** How deep the starters' swells are (the Swell tool's is 1). */
const SWELL_DEPTH = 0.5;

/**
 * Each pitched part's notes within what its instrument really plays: a note past the end moves an
 * octave (or more) in. A recording stretched far below its lowest note or above its highest sounds
 * thin or muddy, and a bassoon can't play a G1 at all. Drum kits' notes are drum names, left alone.
 */
function inRange(p: ProjectSnapshot): ProjectSnapshot {
  const ranges = new Map(p.tracks.map((t) => [t.id, INSTRUMENTS[t.instrumentKey]?.kind === 'drums' ? undefined : INSTRUMENTS[t.instrumentKey]?.range]));
  let moved = false;
  const clips = p.clips.map((c) => {
    const range = ranges.get(c.trackId);
    if (!range || !c.notes.length) return c;
    const [lo, hi] = range;
    let changed = false;
    const notes = c.notes.map((n) => {
      let m = midiOf(n.note);
      if (!Number.isFinite(m) || (m >= lo && m <= hi)) return n;
      while (m < lo && m + 12 <= hi) m += 12;
      while (m > hi && m - 12 >= lo) m -= 12;
      changed = true;
      return { ...n, note: nameOf(m) };
    });
    if (!changed) return c;
    moved = true;
    return { ...c, notes };
  });
  return moved ? { ...p, clips } : p;
}
