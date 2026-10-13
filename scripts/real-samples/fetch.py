# Download the chosen CC0 recordings (raw WAV) into dl/<set>/
import os, sys, urllib.request, urllib.parse, concurrent.futures as cf
SP=os.path.dirname(os.path.abspath(__file__)); DL=os.path.join(SP,'dl')
R='https://raw.githubusercontent.com/'
NAMES=['c','db','d','eb','e','f','gb','g','ab','a','bb','b']
jobs=[]
# Karoryfer guitars: file octave = standard octave + 1; every 3 semitones from E2 (40) to C#6 (85)
for body in ['black','green']:
    for m in range(40,86,3):
        n=f"{NAMES[m%12]}{m//12}"  # karoryfer octave (one higher than standard: m//12 -1 +1)
        for dyn,rrs in (('p',(1,2)),('mf',(1,3)),('f',(1,3))):
            for rr in rrs:
                f=f"twang_{n}_{dyn}_rr{rr}.wav"
                jobs.append((f"guitar-{body}", f"{m}_{dyn}_{rr}.wav", R+f"sfzinstruments/karoryfer.black-and-green-guitars/master/Samples/{body}/ord/{f}"))
# VSCO cello section: file octave = standard octave - 1 (C1 = MIDI 36)
VS={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}
for nm in ['C1','E1','G1','B1','D2','F2','A2','C3','E3','G3','B3','D4','F4']:
    m=VS[nm[0]]+12*(int(nm[1])+2)
    for v in ('v1','v3'):
        jobs.append(('cello-sustain', f"{m}_{v}_1.wav", R+"sgossner/VSCO-2-CE/master/"+urllib.parse.quote(f"Strings/Cello Section/susvib/susvib_{nm}_{v}_1.wav")))
    for v in ('v1','v2'):
        for rr in (1,2):
            jobs.append(('cello-spiccato', f"{m}_{v}_{rr}.wav", R+"sgossner/VSCO-2-CE/master/"+urllib.parse.quote(f"Strings/Cello Section/spic/spic_{nm}_{v}_RR{rr}.wav")))
def get(j):
    d,name,url=j; os.makedirs(os.path.join(DL,d),exist_ok=True); p=os.path.join(DL,d,name)
    if os.path.exists(p) and os.path.getsize(p)>1000: return None
    for a in range(4):
        try:
            urllib.request.urlretrieve(url,p); return None
        except Exception as e: err=e
    return f"{url}: {err}"
with cf.ThreadPoolExecutor(12) as ex:
    errs=[e for e in ex.map(get,jobs) if e]
print(len(jobs),'files,',len(errs),'errors'); print('\n'.join(errs[:20]))
