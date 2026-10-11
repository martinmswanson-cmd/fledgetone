# Per-note level, spectral centroid and brightness of WAVs rendered by phrases.js.
# python3 scripts/audio-check/phrases.py <dir of wavs>   (needs ffmpeg and numpy)
import subprocess, numpy as np, sys, os, json
sr=44100
def decode(p):
    r=subprocess.run(['ffmpeg','-v','quiet','-i',p,'-f','f32le','-ac','1','-ar','44100','-'],capture_output=True)
    return np.frombuffer(r.stdout,dtype=np.float32)
def note_stats(x, start, length):
    seg=x[start:start+length]; e=np.convolve(np.abs(seg),np.ones(441)/441,mode='same'); pk=e.max()+1e-9
    i=int(np.argmax(e)); w=seg[max(0,i-2205):i+4410]; w=w*np.hanning(len(w))
    S=np.abs(np.fft.rfft(w))**2; f=np.fft.rfftfreq(len(w),1/sr); tot=S.sum()+1e-12
    cent=(S*f).sum()/tot; hf=S[f>2500].sum()/tot; vhf=S[f>6000].sum()/tot
    rms=20*np.log10(np.sqrt((seg**2).mean())+1e-9)
    below=np.where(e[i:]<pk*0.03)[0]; sustain=(below[0]+i)/sr if len(below) else length/sr
    return dict(rms=round(float(rms),1),cent=int(cent),hf=round(float(hf),2),vhf=round(float(vhf),3),sus=round(float(sustain),2))
d=sys.argv[1]; beat=int(0.6*sr)
for f in sorted(os.listdir(d)):
    x=decode(os.path.join(d,f)); out=[]
    for i in range(8): out.append(note_stats(x,i*beat,beat))
    out.append(note_stats(x,8*beat,4*beat))
    print('== %-15s'%f[:-4], ' '.join(f"{n['rms']:.0f}dB/c{n['cent']}/h{n['hf']:.2f}" for n in out[:8]), ' HELD', f"{out[8]['rms']:.0f}dB c{out[8]['cent']} h{out[8]['hf']:.2f} sus{out[8]['sus']}")
