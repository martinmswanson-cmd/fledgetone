# Mono MP3s for the app: start at the note, cap the length with a fade, one gain per set (layers keep their natural level difference)
import numpy as np, subprocess, os, sys
OUT=sys.argv[1]
CAP={'guitar-black':4.0,'guitar-green':4.0,'cello-sustain':9.5,'cello-spiccato':2.0}
NAMES=['C','Cs','D','Ds','E','F','Fs','G','Gs','A','As','B']
LAYER={'p':0,'mf':1,'f':2,'v1':0,'v3':1,'v2':1}
import json
TUNE=json.load(open('tune.json'))
# Level of each loudness against the same note's loudest recording (dB): the velocity sets the
# level, the recording sets the tone, so the switch from one recording to the next is smooth
OFFSET={'p':-4,'mf':-2,'f':0,'v1':-3,'v3':0,'v2':0}
LEVEL_WIN={'guitar-black':(0,0.5),'guitar-green':(0,0.5),'cello-sustain':(0.5,2.0),'cello-spiccato':(0,0.3)}
def level(x,d):
    a,b=LEVEL_WIN[d]; seg=x[int(a*44100):int(b*44100)]; return 10*np.log10(np.mean(seg**2)+1e-20)
def retune(x,c):
    # c cents sharp: read it slower by that much (cubic would be finer; linear is inaudible at a few cents)
    r=2**(-c/1200); n=int((len(x)-2)/r); t=np.arange(n)*r; k=t.astype(int); f=t-k
    return x[k]*(1-f)+x[k+1]*f
def load(p):
    raw=subprocess.run(['ffmpeg','-v','quiet','-i',p,'-ac','1','-ar','44100','-f','f32le','-'],capture_output=True).stdout
    return np.frombuffer(raw,np.float32).astype(np.float64)
for d,cap in CAP.items():
    files=sorted(os.listdir('dl/'+d)); xs={f:retune(load(f'dl/{d}/{f}'),max(-25,min(25,TUNE[f'{d}/{f}']))) for f in files}
    # start each at its note, then match layers per note
    def trim(x):
        a=np.abs(x); start=max(0,int(np.argmax(a>a.max()*10**(-40/20)))-int(0.004*44100)); return x[start:]
    xs={f:trim(x) for f,x in xs.items()}
    loud=[l for l in OFFSET if l in ('f','v3') or (d=='cello-spiccato' and l=='v2')]
    for f in files:
        m,lay,_=f[:-4].split('_')
        if lay in ('f','v3') or (d=='cello-spiccato' and lay=='v2'): continue
        refs=[level(xs[g],d) for g in files if g.split('_')[0]==m and g.split('_')[1] in ('f','v3','v2')]
        xs[f]=xs[f]*10**((np.mean(refs)+OFFSET[lay]-level(xs[f],d))/20)
    peak=max(np.abs(x).max() for x in xs.values()); gain=0.89/peak
    os.makedirs(f'{OUT}/{d}',exist_ok=True)
    for f,x in xs.items():
        m,lay,rr=f[:-4].split('_'); m=int(m)
        y=x[:int(cap*44100)]*gain
        fade=int(0.25*44100) if len(y)>=int(cap*44100)-1 else int(0.03*44100)
        y[-fade:]*=np.linspace(1,0,fade)**2
        y[:int(0.002*44100)]*=np.linspace(0,1,int(0.002*44100))
        name=f"{NAMES[m%12]}{m//12-1}_{LAYER[lay]}_{int(rr) if d!='cello-sustain' else 1}"
        # guitars: rr 1/3 -> 0/1; cello spiccato rr1/2 -> 0/1
        r=int(rr); r={1:0,2:1,3:1}[r] if d.startswith('guitar') or d=='cello-spiccato' else 0
        name=f"{NAMES[m%12]}{m//12-1}_{LAYER[lay]}_{r}"
        subprocess.run(['ffmpeg','-v','error','-y','-f','f64le','-ar','44100','-ac','1','-i','-','-codec:a','libmp3lame','-q:a','4',f'{OUT}/{d}/{name}.mp3'],input=y.astype('<f8').tobytes(),check=True)
    print(d,len(files),'gain dB',round(20*np.log10(gain),1))
