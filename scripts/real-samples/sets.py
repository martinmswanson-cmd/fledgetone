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


def S(folder, repo, sources, layers, kind, takes=None, every=1, cap=None, lo=None, hi=None, retune=True, bend=True):
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
    """
    return {'folder': folder, 'repo': repo, 'sources': sources, 'layers': layers, 'kind': kind,
            'takes': takes, 'every': every, 'cap': cap or KINDS[kind]['cap'], 'lo': lo, 'hi': hi, 'retune': retune, 'bend': bend}


NOTE = r'(?P<note>[A-Ga-g][#sb]?-?\d)'
V = 'Strings/Violin Section'
VA = 'Strings/Viola Section'
C = 'Strings/Cello Section'

SETS = [
    # ---- strings (VSCO 2 CE) ----
    S('cello-sustain', 'vsco', [(rf'{C}/susvib/susvib_{NOTE}_(?P<layer>v[13])_1\.wav', 1)], ['v1', 'v3'], 'sustain'),
    S('cello-spiccato', 'vsco', [(rf'{C}/spic/spic_{NOTE}_(?P<layer>v[12])_(?P<take>RR[12])\.wav', 1)], ['v1', 'v2'], 'short'),
    S('violins-sustain', 'vsco', [(rf'{V}/susVib/VlnEns_susVib_{NOTE}_(?P<layer>v[12])\.wav', 1)], ['v1', 'v2'], 'sustain'),
    S('violins-spiccato', 'vsco', [(rf'{V}/Spic/VlnEns_Spic_{NOTE}_(?P<layer>v[12])_(?P<take>rr[12])\.wav', 1)], ['v1', 'v2'], 'short'),
    S('violas-sustain', 'vsco', [(rf'{VA}/susvib/ViolaEns_susvib_{NOTE}_(?P<layer>v[12])_1\.wav', 1)], ['v1', 'v2'], 'sustain'),
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
    S('solo-violin', 'vsco', [(rf'Strings/Solo Violin/Arco Vib/LLVln_ArcoVib_{NOTE}_(?P<layer>[pf])\.wav', 0)], ['p', 'f'], 'sustain'),
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
    S('guitar-black', 'guitars', [(rf'Samples/black/ord/twang_{NOTE}_(?P<layer>p|mf|f)_(?P<take>rr[123])\.wav', -1)], ['p', 'mf', 'f'], 'plucked',
      takes={'p': ['rr1', 'rr2'], 'mf': ['rr1', 'rr3'], 'f': ['rr1', 'rr3']}, every=3),
    S('guitar-green', 'guitars', [(rf'Samples/green/ord/twang_{NOTE}_(?P<layer>p|mf|f)_(?P<take>rr[123])\.wav', -1)], ['p', 'mf', 'f'], 'plucked',
      takes={'p': ['rr1', 'rr2'], 'mf': ['rr1', 'rr3'], 'f': ['rr1', 'rr3']}, every=3),
    S('guitar-flatwound', 'emily', [(rf'notes/{NOTE}_(?P<layer>p|mp|mf|f)_(?P<take>rr[12])\.wav', 0)], ['p', 'mp', 'mf', 'f'], 'plucked'),
    S('alto-sax', 'weresax', [(rf'Samples/alto/{NOTE}_(?P<layer>[pf])_(?P<take>rr[12])_cnd\.wav', 1)], ['p', 'f'], 'sustain', every=2),
    S('baritone-sax', 'bearsax', [(rf'Samples/{NOTE}_looped_(?P<layer>[pf])\.wav', 1)], ['p', 'f'], 'sustain', every=3),
    S('double-bass', 'meatbass', [(rf'Samples/arco/{NOTE}_(?P<layer>vl[123])_(?P<take>down|up)\.wav', 0)], ['vl1', 'vl2', 'vl3'], 'sustain'),
    S('upright-bass', 'meatbass', [(rf'Samples/pizz/{NOTE}_(?P<layer>vl[1234])_(?P<take>rr[12])\.wav', 0)], ['vl1', 'vl2', 'vl3', 'vl4'], 'plucked'),
    S('electric-bass', 'growlybass', [(rf'sustain/{NOTE}_(?P<layer>pp|p|f|ff)_(?P<take>rr[12])\.wav', -1)], ['pp', 'p', 'f', 'ff'], 'plucked'),
    S('grand-piano', 'splendid', [(rf'Samples/(?P<layer>PP|Mp|MF|FF) {NOTE}\.flac', 1)], ['PP', 'Mp', 'MF', 'FF'], 'ringing', cap=9.0, retune=False),
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
        else:
            midi = note_midi(g['note']) + 12 * octave
        if len(src) > 3 and midi is not None and not src[3][0] <= midi <= src[3][1]:
            return None
        return midi, g.get('layer') or '', g.get('take') or '', i
    return None
