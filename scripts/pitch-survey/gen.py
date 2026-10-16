import json, os
HERE=os.path.dirname(os.path.abspath(__file__))
T=json.load(open(os.path.join(HERE,'tuning.json')))
lines=["/**",
" * Tuning corrections for the recorded instruments, measured. Each recording's pitch was read two",
" * ways (by its period, YIN, and from its harmonics; voices by their period only) over the loud part",
" * of the note, then refined from chromatic scales rendered through the app: the keys that play from",
" * one recording give its remaining error, and their median sets its correction.",
" * - `cents`: how far to re-pitch a recording when it loads (positive raises it).",
" * - `notes`: for soundfont instruments, which recordings to use (the soundfonts have every",
" *   semitone; a steadier one a semitone away replaces a wobbly or badly tuned one).",
" * Bells, drums and the piano (whose stretched tuning is deliberate) aren't corrected.",
" */",
"export const SAMPLE_TUNING: Record<string, { notes?: string[]; cents: Record<string, number> }> = {"]
for k in sorted(T):
    v=T[k]
    if not v['cents'] and not v.get('notes'): continue
    parts=[]
    if v.get('notes'): parts.append("notes: ["+", ".join(f"'{n}'" for n in v['notes'])+"]")
    parts.append("cents: { "+", ".join(f"'{n}': {c}" for n,c in sorted(v['cents'].items()))+" }")
    lines.append(f"  {k}: {{ {', '.join(parts)} }},")
lines.append("};")
open(os.path.join(HERE,'..','..','src','audio','sampleTuning.ts'),'w').write('\n'.join(lines)+'\n')
print(sum(len(T[k]['cents']) for k in T),'corrections')
