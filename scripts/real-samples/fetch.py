# Download the recordings each set uses (sets.py) into dl/<set>/, with dl/<set>/plan.json saying
# which note, loudness and take each file is. Run from an empty working folder:
#   python3 fetch.py                 every set
#   python3 fetch.py harp flute      just these
#   python3 fetch.py --list harp     only show what would be fetched
import os, sys, json, subprocess, urllib.request, urllib.parse, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sets import SETS, REPOS, layer_index, match

RAW = 'https://raw.githubusercontent.com/'


def listing(key):
    """Every file path in a library's repository (from a clone without the files' contents)."""
    path = os.path.join('repos', key)
    if not os.path.isdir(path):
        subprocess.run(['git', 'clone', '-q', '--filter=blob:none', '--no-checkout', f'https://github.com/{REPOS[key]}', path], check=True)
    head = subprocess.run(['git', '-C', path, 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
    files = subprocess.run(['git', '-C', path, 'ls-tree', '-r', '--name-only', 'HEAD'], capture_output=True, text=True, check=True).stdout.splitlines()
    return head, files


def plan(st):
    """The files a set uses: [{path, nominal, layer, take}], at most two takes per note and loudness."""
    head, files = listing(st['repo'])
    found = {}
    for path in files:
        m = match(st, path)
        if not m:
            continue
        nominal, ltok, ttok, src = m
        layer = layer_index(st, ltok)
        if layer is None:
            continue
        keep = st['takes'][st['layers'][layer]] if isinstance(st['takes'], dict) else st['takes']
        if keep is not None and ttok not in keep:
            continue
        if nominal is not None and (st['lo'] is not None and nominal < st['lo'] or st['hi'] is not None and nominal > st['hi']):
            continue
        # Sources are in priority order: a note an earlier source has keeps that source's files
        found.setdefault((nominal if nominal is not None else path, layer), []).append({'path': path, 'nominal': nominal, 'layer': layer, 'take': ttok, 'src': src})
    # Chromatic libraries: every few semitones is plenty (the sampler shifts the rest)
    notes = sorted({k[0] for k in found if isinstance(k[0], int)})
    if st['every'] > 1 and notes:
        keep_notes = {n for n in notes if (n - notes[0]) % st['every'] == 0}
        found = {k: v for k, v in found.items() if not isinstance(k[0], int) or k[0] in keep_notes}
    out = []
    for _, entries in sorted(found.items(), key=lambda kv: (str(kv[0][0]), kv[0][1])):
        first = min(e['src'] for e in entries)
        out += sorted((e for e in entries if e['src'] == first), key=lambda e: e['take'])[:2]
    return head, out


def get(job):
    url, dest = job
    if os.path.exists(dest) and os.path.getsize(dest) > 1000:
        return None
    for _ in range(4):
        try:
            urllib.request.urlretrieve(url, dest)
            return None
        except Exception as e:  # retry: the connection drops now and then
            err = e
    return f'{url}: {err}'


def main(args):
    only = [a for a in args if not a.startswith('--')]
    for st in SETS:
        if only and st['folder'] not in only:
            continue
        head, files = plan(st)
        print(f"{st['folder']:20s} {len(files):4d} files, {len({f['nominal'] for f in files})} notes")
        if '--list' in args:
            for f in files:
                print('   ', f['nominal'], f['layer'], f['take'], f['path'])
            continue
        d = os.path.join('dl', st['folder'])
        os.makedirs(d, exist_ok=True)
        jobs = []
        for f in files:
            f['file'] = f['path'].replace('/', '__')
            jobs.append((RAW + REPOS[st['repo']] + '/' + head + '/' + urllib.parse.quote(f['path']), os.path.join(d, f['file'])))
        with cf.ThreadPoolExecutor(12) as ex:
            errs = [e for e in ex.map(get, jobs) if e]
        json.dump({'repo': REPOS[st['repo']], 'commit': head, 'files': files}, open(os.path.join(d, 'plan.json'), 'w'), indent=1)
        if errs:
            print('  errors:', *errs[:10], sep='\n   ')


if __name__ == '__main__':
    main(sys.argv[1:])
