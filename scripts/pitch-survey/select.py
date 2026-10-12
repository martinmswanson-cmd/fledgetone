import json, numpy as np
L=json.load(open('list.json')); A=json.load(open('all.json')); C=json.load(open('current.json'))
SH=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
def midi(n):
    i=2 if len(n)>1 and n[1] in '#b' else 1
    p=n[:i]; p={'Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#'}.get(p,p)
    return (int(n[i:])+1)*12+SH.index(p)
name=lambda m: f"{SH[m%12]}{m//12-1}"
def judge(m):
    if not m or m.get('yin') is None or m.get('harm') is None or m.get('spread') is None: return None
    if abs(m['yin']-m['harm'])>12 or m['spread']>25: return None
    return (m['yin']+m['harm'])/2
SKIP={'piano','chimes','glockenspiel','taiko','timpani','orchestraHit','celesta','musicBox','vibraphone','xylophone','marimba','kalimba','steelDrums','crystal'}
out={}; report=[]
for k,v in L.items():
    if k in SKIP: continue
    cur=[midi(n) for n in v['samples']]; lo,hi=min(cur),max(cur)
    if k in A:
        meas={midi(n):m for n,m in A[k].items()}
        chosen={}
        # one slot per current sample note: the best reliable recording within a semitone of it
        for t in sorted(cur):
            cands=[]
            for c in (t,t-1,t+1):
                if c<lo-1 or c>hi+1 or c not in meas: continue
                est=judge(meas[c])
                if est is None: continue
                m=meas[c]
                cands.append((abs(est)+0.3*m['spread']+0.2*abs(m['yin']-m['harm'])+(0 if c==t else 2), c, est))
            if cands:
                _,c,est=min(cands); chosen[c]=est
            else:
                chosen[t]=None
        notes=sorted(chosen)
        cents={name(c):round(-e) for c,e in chosen.items() if e is not None and abs(e)>=5}
        changed = notes!=sorted(cur)
        unr=sum(1 for e in chosen.values() if e is None)
        resid=[abs(e) if abs(e)<5 else 0 for e in chosen.values() if e is not None]
        out[k]={'notes':[name(c) for c in notes] if changed else None,'cents':cents}
        report.append((k,len(cur),sum(1 for c in notes if c not in cur),len(cents),unr))
    else:
        cents={}
        for n,m in C[k].items():
            est=judge(m)
            if est is not None and abs(est)>=5: cents[n]=round(-est)
        out[k]={'notes':None,'cents':cents}
        report.append((k,len(v['samples']),0,len(cents),sum(1 for n,m in C[k].items() if judge(m) is None)))
json.dump(out,open('tuning.json','w'),indent=1)
print(f"{'inst':16}{'slots':>6}{'swapped':>8}{'corrected':>10}{'unmeasurable':>13}")
for r in sorted(report,key=lambda r:-(r[2]+r[3])):
    if r[2] or r[3] or r[4]: print(f"{r[0]:16}{r[1]:6}{r[2]:8}{r[3]:10}{r[4]:13}")
print('pizzicato', out['pizzicato'])
