# Steady-state pitch (cents off) of every recording, by autocorrelation near the expected period
import numpy as np, subprocess, os, json
WIN={'guitar-black':(0.35,0.75),'guitar-green':(0.35,0.75),'cello-sustain':(1.0,2.5),'cello-spiccato':(0.06,0.3)}
def load(p):
    raw=subprocess.run(['ffmpeg','-v','quiet','-i',p,'-ac','1','-ar','44100','-f','f32le','-'],capture_output=True).stdout
    return np.frombuffer(raw,np.float32).astype(np.float64)
def cents(x,m,a,b):
    a=np.abs(x); start=int(np.argmax(a>a.max()*0.01))
    seg=x[start+int(WA*44100):start+int(WB*44100)]
    hz=440*2**((m-69)/12); P=44100/hz
    def ac(l): return np.dot(seg[:-l],seg[l:])/ (len(seg)-l)
    lags=range(int(P*0.95),int(P*1.05)+2); v=[ac(l) for l in lags]; k=int(np.argmax(v)); bl=lags[k]
    if 0<k<len(v)-1:
        y0,y1,y2=v[k-1],v[k],v[k+1]; off=(y0-y2)/(2*(y0-2*y1+y2))
    else: off=0
    return 1200*np.log2(hz/(44100/(bl+off)))
out={}
for d,(WA,WB) in WIN.items():
    for f in sorted(os.listdir('dl/'+d)):
        x=load(f'dl/{d}/{f}'); m=int(f.split('_')[0])
        out[f'{d}/{f}']=round(float(-cents(x,m,WA,WB)),1)  # + = sharp
json.dump(out,open('tune.json','w'))
import collections
by=collections.defaultdict(list)
for k,v in out.items(): by[k.split('/')[0]].append(v)
for d,v in by.items(): print(d,'median',np.median(v),'min',min(v),'max',max(v))
print(sorted(out.items(), key=lambda t:-abs(t[1]))[:12])
