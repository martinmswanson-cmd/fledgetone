# What each hosted recording set is made from: the source library, which of its files to use,
# how their names say the note, loudness and take, and how long to keep each note.
#
# fetch.py, measure.py and convert.py read this list. Each set becomes a folder in
# public/fledgetone-samples/ holding <note>_<layer>_<take>.mp3 (see README.md).
import re

# The libraries, all public domain (CC0) or free to redistribute; see src/credits.ts
REPOS = {
    'vsco': 'sgossner/VSCO-2-CE',
    'guitars': 'sfzinstruments/karoryfer.black-and-green-guitars',
    'weresax': 'sfzinstruments/karoryfer.weresax',
    'bearsax': 'sfzinstruments/karoryfer.bear-sax',
    'meatbass': 'sfzinstruments/karoryfer.meatbass',
    'growlybass': 'sfzinstruments/karoryfer.growlybass',
    'emily': 'sfzinstruments/karoryfer.emilyguitar',
    'splendid': 'sfzinstruments/SplendidGrandPiano',
    'vcsl': 'sgossner/VCSL',
    'steeldrum': 'sfzinstruments/jlearman.SteelDrum',
    'epianos': 'sfzinstruments/GregSullivan.E-Pianos',  # CC BY 3.0: credit Greg Sullivan
    'ganjo': 'sfzinstruments/ganjo',
    'rustydrums': 'sfzinstruments/karoryfer.big-rusty-drums',
    'virtuosity': 'sfzinstruments/virtuosity_drums',  # CC0
    'unruly': 'sfzinstruments/karoryfer.unruly-drums',  # CC0
    'voice': 'sfzinstruments/legato_vocal_tutorial',
    # A repository on GitLab rather than GitHub is written 'gitlab:<owner>/<name>'
    'celesta': 'gitlab:echoparallax/a-sampled-celesta',  # audio CC0 (its LICENSE), by Neil Bickford
}

# How each kind of note is measured and cut:
#   tune    seconds after the note starts where its pitch is steady (for the tuning check)
#   level   seconds whose loudness is matched between a note's softer and louder recordings
#   cap     longest a note is kept (a fade ends it), seconds
KINDS = {
    # Loudness is matched over a note's first 0.8 s, about as long as most notes play: a soft bowed
    # note swells in slowly, and matched later it sounds far too quiet when played short
    'sustain': {'tune': (0.6, 1.6), 'level': (0.05, 0.8), 'cap': 9.5},
    'short': {'tune': (0.04, 0.2), 'level': (0.0, 0.25), 'cap': 2.0},
    # A hard-plucked low string starts sharp and settles: measured once it has
    'plucked': {'tune': (0.25, 0.8), 'level': (0.0, 0.5), 'cap': 4.0},
    'ringing': {'tune': (0.1, 0.5), 'level': (0.0, 0.5), 'cap': 8.0},
    'mallet': {'tune': (0.03, 0.15), 'level': (0.0, 0.3), 'cap': 4.0},
}

PITCH = {'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11}


def note_midi(name):
    """'F#3', 'Fs3', 'eb4', 'A#-1' -> MIDI, with octave 4 holding middle C (60)."""
    m = re.fullmatch(r'([a-gA-G])(#|s|b)?(-?\d)', name)
    if not m:
        raise ValueError(name)
    pc = PITCH[m.group(1).lower()] + {'#': 1, 's': 1, 'b': -1, None: 0}[m.group(2)]
    return pc + 12 * (int(m.group(3)) + 1)


def S(folder, repo, sources, layers, kind, takes=None, every=1, cap=None, lo=None, hi=None, retune=True, bend=True,
      pitched=True, even=True, kit=None, tail=False, sparse=False, sf2=None, iowa=None, xloop=False, steady=False):
    """
    One set. `sources` is a list of (regex, octave[, midi function[, (lo, hi)]]): the regex matches a file's path in
    the repo, with the named groups `note` (or `index` plus a `midi` function), `layer` and,
    optionally, `take`; `octave` is how many octaves the library's note names sit below standard
    names (its "C3" is our C4: 1). Measuring confirms it (measure.py). A source can be limited to
    the notes lo..hi (MIDI). `layers` names the
    loudnesses softest first; `takes` names the takes kept (or a dict of them per layer), all of
    them when None, at most two. `every` keeps a note only every that many semitones (chromatic
    libraries); `lo`..`hi` limits the notes (MIDI). `retune` False leaves the tuning as recorded
    (a piano's upper notes are tuned sharp on purpose, as on every real piano). `bend` False leaves
    a held note's start as recorded (convert.py bends notes that scoop up into pitch; organ pipes
    don't, and their deep stops confuse the pitch tracking).
    A source's third item can also be a fixed MIDI note, for a sound with no note in its name (a
    drum). `pitched` False skips measuring: each file is the note its name or source says, as
    recorded (drums). `even` False leaves every note at its recorded level instead of evening it
    toward its neighbours (a drum kit's kick and hi-hat must keep their own levels). `kit` names
    the pieces of a drum kit that kit.py mixes from several microphones (see KITS); fetch.py
    leaves such a set to kit.py. `tail` True gives a ringing note recorded shorter than it rings
    (cut off while still sounding) the rest of its decay, at the rate it was dying away, up to the
    set's `cap` (see natural_tail in convert.py); `tail='faded'` does the same for notes the
    library faded out early, first taking its fade off (see unfade). `sparse` True keeps a library's gaps: a note
    recorded at fewer loudnesses than the set has gets no copies of its other recordings where the
    same loudness was recorded within a few semitones (the app stretches that one instead), and
    shares a file rather than duplicating it elsewhere. `sf2` names a SoundFont file in the repo
    that holds the recordings instead of separate files: fetch.py downloads it and unpacks each of
    its recordings (a left and right pair as one stereo file), and `sources` then match the
    recordings' names in it. `iowa` names a zip of the University of Iowa's recordings (scales of
    single notes) that iowa.py fetches and splits instead of fetch.py. `xloop` True loops a held
    note inside its own steady part (a long loop whose end is crossfaded into its start) instead of
    repeating a short stretch of it to the cap, and keeps the file only a little past the loop.
    `steady` True holds a note recorded without vibrato on its pitch all through (a bow's slow
    drift taken out), as the app gives it its vibrato.
    """
    return {'folder': folder, 'repo': repo, 'sources': sources, 'layers': layers, 'kind': kind,
            'takes': takes, 'every': every, 'cap': cap or KINDS[kind]['cap'], 'lo': lo, 'hi': hi, 'retune': retune, 'bend': bend,
            'pitched': pitched, 'even': even, 'kit': kit, 'tail': tail, 'sparse': sparse, 'sf2': sf2,
            'iowa': iowa, 'xloop': xloop, 'steady': steady}


NOTE = r'(?P<note>[A-Ga-g][#sb]?-?\d)'
V = 'Strings/Violin Section'
VA = 'Strings/Viola Section'
C = 'Strings/Cello Section'
AE = 'Aerophones/Edge-blown Aerophones'

# How many octaves a few libraries' note names sit below standard names (measure.py confirms: the
# solo voice is a bass singing an octave under its files' names, as is the banjo)
OCT_HARMONICA = 1
OCT_OCARINA = 1
OCT_ZITHER = 1
OCT_EPIANO = 0
OCT_BANJO = -1
OCT_VOICE = -1

# Drum kits kit.py mixes: each piece's General MIDI note, its files' path ({mic}, {layer} and {take}
# standing for the microphone, loudness and take) and the microphones mixed: each close one at that
# many dB against the overheads ('oh', which set the pieces' levels against each other). The drums
# sound mostly from their close microphones, the overheads 3 dB under (the snare has one on each
# head), the cymbals mostly from the overheads, as their close microphones sit right on them.
RUSTY = 'Samples/{folder}/{{mic}}/{prefix}_vl{{layer}}_rr{{take}}.flac'
VIRT = 'Samples/{{mic}}/{piece}/{{mic}}_{piece}_{art}_vl{{layer}}'
UNRULY = 'Samples/{piece}/{{mic}}/rr{{take}}/{name}_vl{{layer}}_rr{{take}}.flac'
KITS = {
    'studio-kit': {'repo': 'rustydrums', 'layers': 4, 'takes': 2, 'pieces': [
        (36, RUSTY.format(folder='kick_24/kick', prefix='k'), {'kick': 3, 'oh': 0}),
        (38, RUSTY.format(folder='snare_14/center', prefix='sn_center'), {'top': 3, 'btm': 0, 'oh': 0}),
        (41, RUSTY.format(folder='tom_22/center', prefix='t22'), {'cl': 3, 'oh': 0}),
        (42, RUSTY.format(folder='hihat_14/tc', prefix='ht_tc'), {'cl': 3, 'oh': 0}),
        (45, RUSTY.format(folder='tom_15/center', prefix='t15'), {'cl': 3, 'oh': 0}),
        (46, RUSTY.format(folder='hihat_14/open', prefix='ht_open'), {'cl': 3, 'oh': 0}),
        (48, RUSTY.format(folder='tom_14/center', prefix='t14'), {'cl': 3, 'oh': 0}),
        (49, RUSTY.format(folder='crash_17/cr', prefix='cr'), {'cl': -3, 'oh': 0}),
        (51, RUSTY.format(folder='ride_22/rd', prefix='rd'), {'cl': -3, 'oh': 0}),
    ]},
    # Virtuosity Drums: a kick and a snare microphone (each hears the whole kit), the overheads
    # and a room pair. Two toms: the low tom on the low row, the high tom's centre and off-centre
    # hits on the middle and high rows. Pieces recorded once a loudness (the snare, the toms) take
    # their next softer loudness as the second take. The clap row is the snare's rimshot, the
    # cowbell's the percussion's own cowbell (its middle microphone). The trims (last) balance the
    # pieces as the studio kit's are: the overheads hear the ride far under the snare (and the kick,
    # so its own microphone is far over them).
    'session-kit': {'repo': 'virtuosity', 'layers': 4, 'takes': 2, 'stereo': ('oh', 'room', 'mid'), 'pieces': [
        (36, VIRT.format(piece='kick', art='snon') + '_rr{take}.flac', {'kickmic': 20, 'oh': 0, 'room': -6}),
        (38, VIRT.format(piece='snare', art='center') + '.flac', {'snaremic': 3, 'oh': 0, 'room': -6}),
        (39, VIRT.format(piece='snare', art='rimshot') + '.flac', {'snaremic': 3, 'oh': 0, 'room': -6}, 1.5),
        (41, VIRT.format(piece='ltom', art='center') + '.flac', {'room': -3, 'oh': 0}),
        (42, VIRT.format(piece='hh', art='closed') + '_rr{take}.flac', {'room': -6, 'oh': 0}, 7),
        (45, VIRT.format(piece='htom', art='offcenter') + '.flac', {'room': -3, 'oh': 0}, 3.5),
        (46, VIRT.format(piece='hh', art='open') + '_rr{take}.flac', {'room': -6, 'oh': 0}, -1),
        (48, VIRT.format(piece='htom', art='center') + '.flac', {'room': -3, 'oh': 0}, -3),
        (49, VIRT.format(piece='crash', art='crash') + '_rr{take}.flac', {'room': -6, 'oh': 0}),
        (51, VIRT.format(piece='ride', art='ride') + '_rr{take}.flac', {'room': -6, 'oh': 0}, 9),
        (56, 'Samples/perc/{mic}/cowbell/Cowbell1_Normal_v{layer}_rr{take}_{Mic}.wav', {'mid': -14}, 9.5),
    ]},
    # Unruly Drums played with brushes: a 20-inch kick, the 14-inch snare, the three snares with
    # their snares off as toms (22, 14 and 13 inches), hi-hat, crash and ride swept with brushes
    # (close microphones and overheads; the snares' overheads two mono files). The clap row is the
    # snare's brushed rimshot, the cowbell's a woodblock. The trims lift the swept cymbals, which
    # are near silent against a brushed snare, and bring down the 14 and 13-inch toms.
    'brush-kit': {'repo': 'unruly', 'layers': 4, 'takes': 2, 'pieces': [
        (36, UNRULY.format(piece='k20', name='kick_clean'), {'in': 3, 'out': 0, 'oh': 0}, -1.5),
        (38, UNRULY.format(piece='s14', name='s14_b_center'), {'top': 3, 'btm': 0, 'oh': 0}),
        (39, UNRULY.format(piece='s14', name='s14_b_rimshot'), {'top': 3, 'btm': 0, 'oh': 0}, -2.5),
        (41, UNRULY.format(piece='s22', name='s22_tom_clean'), {'top': 3, 'oh': 0}, -2.5),
        (42, UNRULY.format(piece='h14', name='hh_closed_brush'), {'cl': 0, 'oh': 0}),
        (45, UNRULY.format(piece='s14', name='s14_tom_clean'), {'top': 3, 'oh': 0}, -9),
        (46, UNRULY.format(piece='h14', name='hh_open_brush'), {'cl': 0, 'oh': 0}, 8),
        (48, UNRULY.format(piece='s13', name='s13_tom_clean'), {'top': 3, 'oh': 0}, -6),
        (49, UNRULY.format(piece='c16', name='cr_brush'), {'cl': -3, 'oh': 0}, 12),
        (51, UNRULY.format(piece='r20', name='ride_brush'), {'cl': -3, 'oh': 0}, 14),
        (56, UNRULY.format(piece='wb', name='woodblock_hi'), {'cl': 0, 'oh': 0}, -1),
    ]},
    # The same library's hand percussion (its middle microphone, a stereo pair; the timbale only
    # has the overheads) on a kit's rows: tumba and conga for kick and snare, claves for clap,
    # shaker and tambourine for the hats, low and high bongo and a timbale for the toms, cowbell,
    # triangle for crash and agogo bell for ride. The trims bring the loud timbale and cowbell down
    # to the drums and lift the ringing triangle.
    'latin-percussion': {'repo': 'virtuosity', 'layers': 4, 'takes': 2, 'stereo': ('mid', 'oh'), 'pieces': [
        (36, 'Samples/perc/{mic}/tumba/Tumba_24_HitN_{layer}_rr{take}_{Mic}.wav', {'mid': 0}),
        (38, 'Samples/perc/{mic}/conga/Conga_22_HitN_{layer}_rr{take}_{Mic}.wav', {'mid': 0}),
        (39, 'Samples/perc/{mic}/claves/Claves1_Hit_v{layer}_rr{take}_{Mic}.wav', {'mid': 0}, 2),
        (41, 'Samples/perc/{mic}/bongol/BongoL_Hit1_v{layer}_rr{take}_{Mic}.wav', {'mid': 0}),
        (42, 'Samples/perc/{mic}/shaker/LShaker_Shake1D_rr{take}_{Mic}.wav', {'mid': 0}),
        (45, 'Samples/perc/{mic}/bongoh/BongoH_Hit1_v{layer}_rr{take}_{Mic}.wav', {'mid': 0}),
        (46, 'Samples/perc/{mic}/tambourine/Tamb1_Shake_rr{take}_{Mic}.wav', {'mid': 0}, 3),
        (48, 'Samples/perc/{mic}/timbales/timb13_vl{layer}_rr{take}.wav', {'oh': 0}, -6),
        (49, 'Samples/perc/{mic}/triangle/Triangle1_Hit_v{layer}_rr{take}_{Mic}.wav', {'mid': 0}, 8),
        (51, 'Samples/perc/{mic}/agogo/Agogo_High_v{layer}_rr{take}_{Mic}.wav', {'mid': 0}, 3),
        (56, 'Samples/perc/{mic}/cowbell/Cowbell1_Normal_v{layer}_rr{take}_{Mic}.wav', {'mid': 0}, -6),
    ]},
}

SETS = [
    # ---- strings (VSCO 2 CE) ----
    S('cello-sustain', 'vsco', [(rf'{C}/susvib/susvib_{NOTE}_(?P<layer>v[13])_1\.wav', 1)], ['v1', 'v3'], 'sustain', xloop=True),
    S('cello-spiccato', 'vsco', [(rf'{C}/spic/spic_{NOTE}_(?P<layer>v[12])_(?P<take>RR[12])\.wav', 1)], ['v1', 'v2'], 'short'),
    S('violins-sustain', 'vsco', [(rf'{V}/susVib/VlnEns_susVib_{NOTE}_(?P<layer>v[12])\.wav', 1)], ['v1', 'v2'], 'sustain', xloop=True),
    S('violins-spiccato', 'vsco', [(rf'{V}/Spic/VlnEns_Spic_{NOTE}_(?P<layer>v[12])_(?P<take>rr[12])\.wav', 1)], ['v1', 'v2'], 'short'),
    S('violas-sustain', 'vsco', [(rf'{VA}/susvib/ViolaEns_susvib_{NOTE}_(?P<layer>v[12])_1\.wav', 1)], ['v1', 'v2'], 'sustain', xloop=True),
    S('violas-spiccato', 'vsco', [(rf'{VA}/spic/Violas_spic_{NOTE}_(?P<layer>v[12])_(?P<take>rr[12])\.wav', 1)], ['v1', 'v2'], 'short'),
    # The three sections' pizzicato and tremolo as one string section, low to high
    S('strings-pizzicato', 'vsco', [
        (rf'{C}/pizzT/pizzT_{NOTE}_(?P<layer>v[12])_(?P<take>RR[12])\.wav', 1),
        (rf'{VA}/pizz/(?:[A-Za-z]+_)?pizz_{NOTE}_(?P<layer>v[12])_(?P<take>rr[12])\.wav', 1),
        (rf'{V}/Pizz/VlnEns_Pizz_{NOTE}_(?P<layer>v[12])_(?P<take>rr[12])\.wav', 1),
    ], ['v1', 'v2'], 'plucked', cap=2.5),
    S('strings-tremolo', 'vsco', [
        (rf'{C}/trem/(?:[A-Za-z]+_)?trem_{NOTE}_(?P<layer>v[12])[_0-9]*\.wav', 1),
        (rf'{VA}/trem/(?:[A-Za-z]+_)?trem_{NOTE}_(?P<layer>v[12])[_0-9]*\.wav', 1),
        (rf'{V}/Trem/VlnEns_Trem_{NOTE}_(?P<layer>v[12])\.wav', 1),
    ], ['v1', 'v2'], 'sustain'),
    S('solo-violin', 'vsco', [(rf'Strings/Solo Violin/Arco Vib/LLVln_ArcoVib_{NOTE}_(?P<layer>[pf])\.wav', 0)], ['p', 'f'], 'sustain', xloop=True),
    S('harp', 'vsco', [(rf'Strings/Harp/KSHarp_{NOTE}_(?P<layer>mp|mf|f)\.wav', 0)], ['mp|mf|f'], 'ringing'),
    # ---- woodwinds (VSCO 2 CE) ----
    S('flute', 'vsco', [(rf'Woodwinds/Flute/susvib/LDFlute_susvib_{NOTE}_(?P<layer>v1)_(?P<take>1)\.wav', 1)], ['v1'], 'sustain'),
    S('flute-staccato', 'vsco', [(rf'Woodwinds/Flute/stac/LDFlute_stac_{NOTE}_(?P<layer>v[123])_(?P<take>rr[12])\.wav', 1)], ['v1', 'v2', 'v3'], 'short'),
    S('oboe', 'vsco', [(rf'Woodwinds/Oboe/Vib/Oboe_Vib_{NOTE}_(?P<layer>v[13])_Main\.wav', 1)], ['v1', 'v3'], 'sustain'),
    S('clarinet', 'vsco', [(rf'Woodwinds/Clarinet/susLong/DCClar_susLong_{NOTE}_(?P<layer>v[123])_rr1_sum\.wav', 1)], ['v1', 'v2', 'v3'], 'sustain'),
    S('bassoon', 'vsco', [(rf'Woodwinds/Bassoon/vib/PSBassoon_{NOTE}_(?P<layer>v[12])_(?P<take>1)\.wav', 1)], ['v1', 'v2'], 'sustain'),
    # ---- brass (VSCO 2 CE) ----
    S('horn', 'vsco', [(rf'Brass/F Horn/sus/MOHorn_sus_{NOTE}_(?P<layer>v[123])_1\.wav', 1)], ['v1', 'v2', 'v3'], 'sustain'),
    S('horn-staccato', 'vsco', [(rf'Brass/F Horn/stac/MOHorn_stac_{NOTE}_(?P<layer>v[123])_(?P<take>rr[12])\.wav', 1)], ['v1', 'v2', 'v3'], 'short'),
    S('trumpet', 'vsco', [(rf'Brass/Trumpet/susvib/Sum_SHTrumpet_susvib_{NOTE}_(?P<layer>v[12])_rr1\.wav', 1)], ['v1', 'v2'], 'sustain'),
    S('trumpet-staccato', 'vsco', [(rf'Brass/Trumpet/stac/Sum_SHTrumpet_stac_{NOTE}_(?P<layer>v[123])_(?P<take>rr[12])\.wav', 1)], ['v1', 'v2', 'v3'], 'short'),
    S('trombone', 'vsco', [(rf'Brass/Tenor Trombone/sus/tenortbn_sus_{NOTE}_(?P<layer>v[123])_1\.wav', 1)], ['v1', 'v2', 'v3'], 'sustain'),
    S('trombone-staccato', 'vsco', [(rf'Brass/Tenor Trombone/stac/tenortbn_stac_{NOTE}_(?P<layer>v[1234])_(?P<take>rr[12])\.wav', 1)], ['v1', 'v2', 'v3', 'v4'], 'short'),
    S('tuba', 'vsco', [(rf'Brass/Tuba/sus/Tuba3_sus_{NOTE}_(?P<layer>v[123])_rr1_Mid\.wav', 1)], ['v1', 'v2', 'v3'], 'sustain'),
    # ---- mallets and keys (VSCO 2 CE) ----
    S('marimba', 'vsco', [(rf'Percussion/Marimba/Marimba_hit_Outrigger_{NOTE}_(?P<layer>loud)_01\.wav', 1)], ['loud'], 'ringing', cap=4.0),
    S('xylophone', 'vsco', [(rf'Percussion/Xylo/Xylo_Medium_{NOTE}_(?P<layer>ff)_01_far\.wav', 1)], ['ff'], 'mallet', cap=2.5),
    S('glockenspiel', 'vsco', [(rf'Percussion/Glock/glock_medium_{NOTE}(?P<layer>)\.wav', 1)], [''], 'ringing', cap=5.0),
    S('upright-piano', 'vsco', [(r'Keys/Upright Piano/Player_(?P<layer>dyn[123])_rr1_(?P<index>\d{3})\.wav', 0, lambda i: 21 + 2 * i)],
      ['dyn1', 'dyn2', 'dyn3'], 'ringing', retune=False),
    # The organ's files are numbered by key; its stops sound an octave under the key too, which is
    # why measuring can't name them. The pedal fills in below the manual's lowest note.
    S('pipe-organ', 'vsco', [(r'Keys/Organ/Loud/Rode_Man3Open_(?P<index>\d{2})(?P<layer>)\.wav', 0, lambda i: 35 + i),
                             (r'Keys/Organ/Loud/Rode_Pedal_(?P<index>\d{2})(?P<layer>)\.wav', 0, lambda i: 23 + i, (0, 35))], [''], 'sustain', bend=False),
    S('chapel-organ', 'vsco', [(r'Keys/Organ/Quiet/NT5_Man3Quiet_(?P<index>\d{3})_rr1(?P<layer>)\.wav', 0, lambda i: i - 86)], [''], 'sustain', bend=False),
    # ---- band (Karoryfer Lecolds, Splendid Grand Piano) ----
    # (The library faded its softer notes out from 40 dB down, 1.5 to 4 s in, and the amps lift a
    # note's tail, so a held note stopped short: `tail='faded'` takes the fade off and gives each
    # the rest of its decay at the rate it was dying away, to 5 and 6 s, as long as a hard-picked
    # note rings)
    S('guitar-black', 'guitars', [(rf'Samples/black/ord/twang_{NOTE}_(?P<layer>p|mf|f)_(?P<take>rr[123])\.wav', -1)], ['p', 'mf', 'f'], 'plucked',
      takes={'p': ['rr1', 'rr2'], 'mf': ['rr1', 'rr3'], 'f': ['rr1', 'rr3']}, every=3, cap=5.0, tail='faded'),
    S('guitar-green', 'guitars', [(rf'Samples/green/ord/twang_{NOTE}_(?P<layer>p|mf|f)_(?P<take>rr[123])\.wav', -1)], ['p', 'mf', 'f'], 'plucked',
      takes={'p': ['rr1', 'rr2'], 'mf': ['rr1', 'rr3'], 'f': ['rr1', 'rr3']}, every=3, cap=6.0, tail='faded'),
    S('guitar-flatwound', 'emily', [(rf'notes/{NOTE}_(?P<layer>p|mp|mf|f)_(?P<take>rr[12])\.wav', 0)], ['p', 'mp', 'mf', 'f'], 'plucked'),
    S('alto-sax', 'weresax', [(rf'Samples/alto/{NOTE}_(?P<layer>[pf])_(?P<take>rr[12])_cnd\.wav', 1)], ['p', 'f'], 'sustain', every=2),
    S('baritone-sax', 'bearsax', [(rf'Samples/{NOTE}_looped_(?P<layer>[pf])\.wav', 1)], ['p', 'f'], 'sustain', every=3),
    S('double-bass', 'meatbass', [(rf'Samples/arco/{NOTE}_(?P<layer>vl[123])_(?P<take>down|up)\.wav', 0)], ['vl1', 'vl2', 'vl3'], 'sustain'),
    S('upright-bass', 'meatbass', [(rf'Samples/pizz/{NOTE}_(?P<layer>vl[1234])_(?P<take>rr[12])\.wav', 0)], ['vl1', 'vl2', 'vl3', 'vl4'], 'plucked'),
    S('electric-bass', 'growlybass', [(rf'sustain/{NOTE}_(?P<layer>pp|p|f|ff)_(?P<take>rr[12])\.wav', -1)], ['pp', 'p', 'f', 'ff'], 'plucked'),
    S('grand-piano', 'splendid', [(rf'Samples/(?P<layer>PP|Mp|MF|FF) {NOTE}\.flac', 1)], ['PP', 'Mp', 'MF', 'FF'], 'ringing', cap=9.0, retune=False),
    # ---- more orchestra and colour (Versilian Community Sample Library, CC0) ----
    # The timpani's five drums are named by number, not note: measuring names them
    S('timpani', 'vcsl', [(r'Membranophones/Struck Membranophones/Timpani 1/Hit/Timpani(?P<index>\d)_Hit_(?P<layer>v[234])_(?P<take>rr\d)_Sum\.wav', 0, lambda i: None)],
      ['v2', 'v3', 'v4'], 'ringing', cap=5.0),
    S('tubular-bells', 'vcsl', [(rf'Idiophones/Struck Idiophones/Tubular Bells 1/chimes_{NOTE}_(?P<layer>pp|p|f|ff|fff)_(?P<take>rr\d)\.wav', 1)],
      ['pp|p', 'f|ff|fff'], 'ringing', cap=8.0),
    S('vibraphone', 'vcsl', [(rf'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_{NOTE}_(?P<layer>v[12])_(?P<take>rr1)_Main\.wav', 1)],
      ['v1', 'v2'], 'ringing', cap=6.0),
    S('harpsichord', 'vcsl', [(rf'Chordophones/Zithers/Harpsichord, Flemish/Sustains/(?:High|Low)/HarpsiRH_(?:High|Low)_Far_{NOTE}_(?P<take>rr\d)(?P<layer>)\.wav', 1)],
      [''], 'plucked', cap=4.0),
    S('kalimba', 'vcsl', [(rf'Idiophones/Plucked Idiophones/Kalimba, Kenya/Mbira6_Normal_MainSpirit_{NOTE}_k\d+_(?P<layer>vl3)_(?P<take>rr\d)\.wav', 1)],
      ['vl3'], 'ringing', cap=4.0),
    S('tenor-sax', 'vcsl', [(rf'Aerophones/Reed Aerophones/Tenor Saxophone/Non-Vibrato/BrettTenor_NV_Main_{NOTE}_(?P<layer>vl[23])_(?P<take>rr1)\.wav', 1)],
      ['vl2', 'vl3'], 'sustain', every=2),
    S('harmonica', 'vcsl', [(rf'Aerophones/Free Aerophones/Harmonica-Hohner-Special20-C/Sustains/Normal/Hohner-Special20_Normal_{NOTE}(?P<layer>)\.wav', OCT_HARMONICA)],
      [''], 'sustain'),
    S('ocarina', 'vcsl', [(rf'Aerophones/Edge-blown Aerophones/Ocarina, Typical/Sustains/Sus/StdOcarina_Sus_{NOTE}(?P<layer>)\.wav', OCT_OCARINA)],
      [''], 'sustain'),
    S('zither', 'vcsl', [(rf'Chordophones/Zithers/Dan Tranh/Normal/{NOTE}_(?P<layer>mf|f|ff)_(?P<take>1)\.wav', OCT_ZITHER)],
      ['mf', 'f', 'ff'], 'plucked'),
    # A concert bass drum, struck at five loudnesses: one note (a drum), as recorded
    S('concert-bass-drum', 'vcsl', [(r'Membranophones/Struck Membranophones/Bass Drum 2/bassdrum_hit_(?P<layer>pp|mp|mf|f|ff)(?P<take>[12]?)\.wav', 0, 36)],
      ['pp', 'mp', 'mf', 'f', 'ff'], 'ringing', cap=5.0, retune=False, pitched=False, even=False),
    # ---- more colour (jSteelDrum, Greg Sullivan's electric pianos, ganjo, Karoryfer's solo voice) ----
    # The steel drum's lower octave was re-recorded (jsdb_*) for its three softer loudnesses; its
    # loudest are the first recordings (SteelDrum_*), as its own mapping uses them. Of its five
    # loudnesses: the softest, the middle and the loudest. Measured as ringing, not struck: a hard
    # stroke starts sharp and settles
    S('steel-drums', 'steeldrum', [(rf'flac/jsdb_\d{{3}}_+{NOTE}_(?P<layer>[13])(?P<take>(?:-\d)?)\.flac', 0),
                                   (rf'flac/SteelDrum_\d{{3}}_+{NOTE}_(?P<layer>[134])(?P<take>(?:-\d)?)\.flac', 0)],
      ['1', '3', '4'], 'ringing', cap=4.0),
    # Sampled every few notes, not every loudness on every note (each loudness is stretched from
    # its own nearest recording, as the library's own mapping does), and cut off a few seconds in
    # while still ringing: each note is given the rest of its decay
    S('electric-piano', 'epianos', [(rf'Wurlitzer EP200/Samples/{NOTE}(?P<layer>pp|mp|f|ff)\.flac', OCT_EPIANO)],
      ['pp', 'mp', 'f', 'ff'], 'ringing', cap=8.0, tail=True, sparse=True),
    # A six-string banjo; its only articulation, with a second take where there is one
    S('banjo', 'ganjo', [(rf'Common/Banjo_Common - {NOTE}(?P<take>(?:_2)?)(?P<layer>)\.wav', OCT_BANJO)],
      [''], 'plucked', takes=['', '_2']),
    S('solo-voice', 'voice', [(rf'Samples/vowel_sustain/a/vowel_a_{NOTE}(?P<layer>)\.wav', OCT_VOICE)],
      [''], 'sustain', every=2, lo=38),  # (his lowest note, C2, wavers in vocal fry)
    # ---- a celesta, recorders and a muted trumpet ----
    # A celesta recorded key by key in stereo (A Sampled Celesta, CC0): its recordings come in a
    # SoundFont, one stroke a note
    S('celesta', 'celesta', [(rf'{NOTE} (?P<take>rr1)(?P<layer>)', 0)], [''], 'ringing', cap=6.0,
      sf2='Samples/Celesta Tuned Denoised Mix.sf2'),
    # Baroque recorders played straight (no vibrato), as one instrument: the alto, with the tenor
    # under it (below the alto's lowest F) and the soprano over it (above its highest E).
    S('recorder', 'vcsl', [(rf'{AE}/Baroque Alto Recorder/Sustain/AltRecorder_Sus_{NOTE}_(?P<take>rr1)_Main(?P<layer>)\.wav', 1),
                           (rf'{AE}/Baroque Tenor Recorder/Sustain/TenRecorder_Sus_{NOTE}_(?P<take>rr1)_Main(?P<layer>)\.wav', 1, None, (0, 64)),
                           (rf'{AE}/Baroque Soprano Recorder/Sustain/SopRecorder_Sus_{NOTE}_(?P<take>rr1)_Main(?P<layer>)\.wav', 1, None, (89, 127))],
      [''], 'sustain'),
    # The trumpet with a harmon mute, held, soft and loud
    S('muted-trumpet', 'vsco', [(rf'Brass/Trumpet/harmonM-sus/Sum_SHTrumpet_harmonM-sus_{NOTE}_(?P<layer>v[13])_rr1\.wav', 1)], ['v1', 'v3'], 'sustain'),
    # Solo strings by the University of Iowa (iowa.py): every semitone, pp, mf and ff, played
    # without vibrato in an anechoic room (the app adds the vibrato and the room), kept 4.5 s (a
    # long loop holds them on)
    S('violin', 'iowa', [], ['pp', 'mf', 'ff'], 'sustain', cap=4.5, iowa='Strings/violin2012/Violin.arco.mono.1644.1.zip', xloop=True, steady=True),
    S('viola', 'iowa', [], ['pp', 'mf', 'ff'], 'sustain', cap=4.5, iowa='Strings/viola2012/Viola.arco.mono.1644.1.zip', xloop=True, steady=True),
    S('cello', 'iowa', [], ['pp', 'mf', 'ff'], 'sustain', cap=4.5, iowa='Strings/cello2012/Cello.arco.mono.1644.1.zip', xloop=True, steady=True),
    S('contrabass', 'iowa', [], ['pp', 'mf', 'ff'], 'sustain', cap=4.5, iowa='Strings/doublebass2012/Bass.arco.mono.1644.1.zip', xloop=True, steady=True),
    # A nylon-string classical guitar by the University of Iowa (iowa.py): every semitone from the
    # low E to the high B, pp, mf and ff, plucked in an anechoic room (the app adds the room)
    S('nylon-guitar', 'iowa', [], ['pp', 'mf', 'ff'], 'plucked', cap=5.0, iowa='Piano_Other/guitar/Guitar.mono.1644.1.zip'),
    # A studio drum kit: each hit mixed from its close microphones and the overheads by kit.py
    S('studio-kit', 'rustydrums', [], ['1', '2', '3', '4'], 'ringing', cap=3.0, retune=False, pitched=False, even=False, kit='studio-kit'),
    S('session-kit', 'virtuosity', [], ['1', '2', '3', '4'], 'ringing', cap=3.0, retune=False, pitched=False, even=False, kit='session-kit'),
    S('latin-percussion', 'virtuosity', [], ['1', '2', '3', '4'], 'ringing', cap=3.0, retune=False, pitched=False, even=False, kit='latin-percussion'),
    S('brush-kit', 'unruly', [], ['1', '2', '3', '4'], 'ringing', cap=3.0, retune=False, pitched=False, even=False, kit='brush-kit'),
]


def layer_index(st, token):
    """Which of the set's loudnesses a file's layer token is (alternatives are written 'a|b')."""
    for i, name in enumerate(st['layers'] or []):
        if token in name.split('|'):
            return i
    return None


def match(st, path):
    """(nominal MIDI or None when measured, layer token, take token, source index) for a file of the set, or None."""
    for i, src in enumerate(st['sources']):
        rx, octave = src[0], src[1]
        m = re.fullmatch(rx, path)
        if not m:
            continue
        g = m.groupdict()
        if 'index' in g and g['index'] is not None:
            midi = src[2](int(g['index'])) if src[2] else None
        elif g.get('note') is None and len(src) > 2 and isinstance(src[2], int):
            midi = src[2]  # one fixed note (a drum)
        else:
            midi = note_midi(g['note']) + 12 * octave
        if len(src) > 3 and midi is not None and not src[3][0] <= midi <= src[3][1]:
            return None
        return midi, g.get('layer') or '', g.get('take') or '', i
    return None

# Release sounds: what a key makes as it's let go (a harpsichord's jack falling back, a piano's
# damper settling on the string). The app plays them when a note is released early (see
# SampleSource.releases); measure.py can't read a pitch from them, so release.py gives them their
# main set's octave.
RELEASES = [
    S('harpsichord-release', 'vcsl', [(rf'Chordophones/Zithers/Harpsichord, Flemish/Releases/(?:High|Low)/HarpsiRH_(?:High|Low)Rel_Far_{NOTE}_(?P<take>rr\d)(?P<layer>)\.wav', 1)], [''], 'short', cap=1.5, retune=False),
    # The two electric guitars' strings damped by the fretting hand as a note is let go (the
    # library's own release sounds, every third note from the low E as the guitars' notes are)
    S('guitar-black-release', 'guitars', [(rf'Samples/black/rel/release_{NOTE}_(?P<take>rr[12])(?P<layer>)\.wav', -1)], [''], 'short', every=3, cap=1.0, retune=False, pitched=False),
    S('guitar-green-release', 'guitars', [(rf'Samples/green/rel/release_{NOTE}_(?P<take>rr[12])(?P<layer>)\.wav', -1)], [''], 'short', every=3, cap=1.0, retune=False, pitched=False),
    S('piano-release', 'vcsl',[(rf'Chordophones/Zithers/Grand Piano, Kawai/Releases/GPiano_rel_{NOTE}_(?P<layer>v3)_(?P<take>rr1)_Player\.wav', 1)], ['v3'], 'short', cap=2.0, retune=False),
]
SETS += RELEASES
