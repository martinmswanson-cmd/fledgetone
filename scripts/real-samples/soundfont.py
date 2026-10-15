# The recordings in a SoundFont 2 file (.sf2), for a set whose library ships its recordings that way
# (sets.py `sf2`): fetch.py unpacks each into a WAV file of its own.
import os, re, struct, wave
import numpy as np


def _chunks(b, off, end):
    while off < end - 8:
        cid = b[off:off + 4]
        n = struct.unpack('<I', b[off + 4:off + 8])[0]
        yield cid, off + 8, n
        off += 8 + n + (n & 1)


def recordings(path):
    """
    Each recording in the SoundFont as (name, rate, channels): a stereo recording is stored as a
    left and a right one linked to each other (named "<name>L" and "<name>R"), and is given as one,
    its name without the L and R; the channels are lists of 16-bit samples as bytes.
    """
    b = open(path, 'rb').read()
    if b[:4] != b'RIFF' or b[8:12] != b'sfbk':
        raise ValueError(f'{path} is not a SoundFont')
    found = {}
    for cid, off, n in _chunks(b, 12, len(b)):
        if cid == b'LIST':
            kind = b[off:off + 4]
            for c2, o2, n2 in _chunks(b, off + 4, off + n):
                found[(kind, c2)] = (o2, n2)
    data, _ = found[(b'sdta', b'smpl')]
    o, n = found[(b'pdta', b'shdr')]
    headers = []
    for i in range(n // 46 - 1):  # (the last is the end marker)
        r = b[o + 46 * i: o + 46 * (i + 1)]
        start, end, _, _, rate = struct.unpack('<5I', r[20:40])
        link, kind = struct.unpack('<HH', r[42:46])
        headers.append({'name': r[:20].split(b'\0')[0].decode('latin1').strip(), 'rate': rate, 'link': link, 'kind': kind & 0x7fff,
                        'pcm': b[data + 2 * start: data + 2 * end]})
    out = []
    for h in headers:
        if h['kind'] == 2 or h['kind'] == 8:  # a right channel (given with its left) or a linked one
            continue
        if h['kind'] == 4 and h['link'] < len(headers):  # a left channel: with its right
            right = headers[h['link']]
            n = min(len(h['pcm']), len(right['pcm']))
            out.append((re.sub(r'\s*L$', '', h['name']), h['rate'], [h['pcm'][:n], right['pcm'][:n]]))
        else:
            out.append((h['name'], h['rate'], [h['pcm']]))
    return out


def unpack(path, folder, wanted):
    """Every recording whose name `wanted(name)` accepts written to <folder>/<name>.wav; their names and files."""
    os.makedirs(folder, exist_ok=True)
    done = []
    for name, rate, chans in recordings(path):
        if not wanted(name):
            continue
        file = re.sub(r'[^A-Za-z0-9#_.-]+', '_', name) + '.wav'
        w = wave.open(os.path.join(folder, file), 'wb')
        w.setnchannels(len(chans))
        w.setsampwidth(2)
        w.setframerate(rate)
        # (interleaved: left, right, left, ...)
        w.writeframes(np.stack([np.frombuffer(c, '<i2') for c in chans], axis=1).tobytes())
        w.close()
        done.append((name, file))
    return done
