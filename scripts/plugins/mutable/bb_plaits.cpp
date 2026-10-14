/*
 * The synthesis engines of Mutable Instruments' Plaits (Emilie Gillet, MIT) as Fledgetone
 * instruments: each engine is its own instrument, eight voices deep. A note triggers a voice;
 * "Hold" keeps it sounding while the note is held (a gate into the low-pass gate), "Pluck" lets
 * it ring out on its own decay. Plaits runs at 48 kHz: at other rates the note is corrected.
 */
#include "../bbplug_impl.h"
#include "plaits/dsp/voice.h"
#include "stmlib/utils/buffer_allocator.h"
#include <math.h>

using namespace plaits;

static const int VOICES = 8;
enum { HARMONICS, TIMBRE, MORPH, DECAY, COLOUR, ENVELOPE, RELEASE, AUX, VOLUME, BANK, NPARAMS };
static const char *names[NPARAMS] = {"Harmonics", "Timbre", "Morph", "Decay", "Colour", "Pluck / hold", "Release", "Aux blend", "Volume", "Bank"};

struct EngineDef
{
    int engine;
    bool hold;
    float harmonics, timbre, morph, decay, colour;
    /** Level trim (dB), measured so the engines play at about the same loudness */
    float trimDb;
};

struct PlaitsVoice
{
    Voice voice;
    char ram[16384];
    float note = 60, velocity = 0, level = 0;
    bool gate = false, triggered = false;
    int age = 0, silentBlocks = 1000;
    Voice::Frame frames[kBlockSize];
};

struct Macro : BBPlugin
{
    const EngineDef def;
    PlaitsVoice *v;
    float rateFix, sr, bend = 0;
    float fifoL[kBlockSize], fifoR[kBlockSize];
    int fifoPos = kBlockSize;
    bool sustain = false;
    bool held[VOICES] = {};

    Macro(float sampleRate, EngineDef d) : def(d), sr(sampleRate)
    {
        v = new PlaitsVoice[VOICES];
        for (int i = 0; i < VOICES; i++)
        {
            stmlib::BufferAllocator alloc(v[i].ram, sizeof(v[i].ram));
            v[i].voice.Init(&alloc);
        }
        rateFix = 12.f * log2f(48000.f / sampleRate);
        float init[NPARAMS] = {d.harmonics, d.timbre, d.morph, d.decay, d.colour, d.hold ? 1.f : 0.f, 0.25f, 0.f, 0.8f, 0.f};
        setAll(init);
    }
    ~Macro() { delete[] v; }
    int params() override { return def.engine == 2 ? NPARAMS : NPARAMS - 1; }
    const char *paramName(int i) override { return names[i]; }
    void apply(int, float) override {}
    void display(int i, char *o, int n) override
    {
        float x = values[i];
        if (i == ENVELOPE) snprintf(o, n, "%s", x < 0.5f ? "pluck" : "hold");
        else if (i == RELEASE) snprintf(o, n, "%.0f ms", bbExp(x, 5.f, 4000.f));
        else if (i == VOLUME) snprintf(o, n, "%.1f dB", 20.f * log10f(fmaxf(x * x * 1.6f, 1e-5f)));
        else if (i == BANK) snprintf(o, n, "%d", bbIndex(x, 3) + 1);
        else snprintf(o, n, "%.0f%%", x * 100);
    }

    void midi(int s, int d1, int d2) override
    {
        int type = s & 0xf0;
        if (type == 0x90 && d2 > 0)
        {
            // The free voice that has been free longest, else the oldest
            int pick = 0, best = -1;
            for (int i = 0; i < VOICES; i++)
            {
                int score = (!v[i].gate ? 1 << 30 : 0) + v[i].age;
                if (score > best) best = score, pick = i;
            }
            PlaitsVoice &p = v[pick];
            p.note = d1;
            p.velocity = d2 / 127.f;
            p.gate = true;
            p.triggered = true;
            p.age = 0;
            p.silentBlocks = 0;
            held[pick] = true;
        }
        else if (type == 0x80 || type == 0x90)
        {
            for (int i = 0; i < VOICES; i++)
                if (v[i].gate && (int)v[i].note == d1 && held[i])
                {
                    held[i] = false;
                    if (!sustain) v[i].gate = false;
                }
        }
        else if (type == 0xe0) bend = ((d2 << 7 | d1) - 8192) / 8192.f * 2.f;
        else if (type == 0xb0 && d1 == 64)
        {
            sustain = d2 >= 64;
            if (!sustain)
                for (int i = 0; i < VOICES; i++)
                    if (!held[i]) v[i].gate = false;
        }
        else if (type == 0xb0 && (d1 == 123 || d1 == 120))
            for (int i = 0; i < VOICES; i++) v[i].gate = held[i] = false;
    }

    void renderBlock()
    {
        for (int k = 0; k < (int)kBlockSize; k++) fifoL[k] = fifoR[k] = 0;
        bool hold = values[ENVELOPE] >= 0.5f;
        // Level smoothing per 12-sample block: a quick attack, the release time to fall away
        float blockSec = kBlockSize / sr;
        float release = expf(-blockSec / (bbExp(values[RELEASE], 5.f, 4000.f) * 0.001f / 5.f));
        float attack = expf(-blockSec / 0.002f);
        float gain = values[VOLUME] * values[VOLUME] * 1.6f / 32768.f * powf(10.f, def.trimDb / 20.f);
        float aux = values[AUX];
        for (int i = 0; i < VOICES; i++)
        {
            PlaitsVoice &p = v[i];
            p.age++;
            float target = p.gate ? 1.f : 0.f;
            p.level = target + (p.level - target) * (p.gate ? attack : release);
            if (!p.gate && p.silentBlocks > (int)(sr / kBlockSize) * 2) continue;
            Patch patch = {};
            patch.note = p.note + bend + rateFix;
            patch.harmonics = values[HARMONICS];
            patch.timbre = values[TIMBRE];
            patch.morph = values[MORPH];
            patch.engine = def.engine == 2 ? 2 + bbIndex(values[BANK], 3) : def.engine;
            patch.decay = values[DECAY];
            patch.lpg_colour = values[COLOUR];
            Modulations m = {};
            m.trigger = p.triggered ? 1.f : 0.f;
            m.trigger_patched = true;
            m.level_patched = hold;
            m.level = p.level;
            p.voice.Render(patch, m, p.frames, kBlockSize);
            // Keep the trigger up for a few blocks (the engine delays it by 1 ms)
            if (p.triggered && p.age > 8) p.triggered = false;
            float g = gain * (0.35f + 0.65f * p.velocity);
            float peak = 0;
            for (int k = 0; k < (int)kBlockSize; k++)
            {
                float s = ((1.f - aux) * p.frames[k].out + aux * p.frames[k].aux) * g;
                fifoL[k] += s;
                peak = fmaxf(peak, fabsf(s));
            }
            p.silentBlocks = peak < 1e-4f ? p.silentBlocks + 1 : 0;
        }
        for (int k = 0; k < (int)kBlockSize; k++) fifoR[k] = fifoL[k];
        fifoPos = 0;
    }

    void process(const float *, const float *, float *l, float *r, int frames) override
    {
        for (int i = 0; i < frames; i++)
        {
            if (fifoPos >= (int)kBlockSize) renderBlock();
            l[i] = fifoL[fifoPos];
            r[i] = fifoR[fifoPos];
            fifoPos++;
        }
    }
};

#define ENGINE(fn, eng, hold, h, t, m, d, c) \
    static BBPlugin *fn(float sr) { return new Macro(sr, EngineDef{eng, hold, h, t, m, d, c, trim_##fn}); }
static const float trim_vcf = -11.6f;
static const float trim_pd = -18.1f;
static const float trim_sixop = -6.7f;
static const float trim_terrain = -17.2f;
static const float trim_strings = -7.9f;
static const float trim_chip = -17.3f;
static const float trim_va = -14.7f;
static const float trim_shaper = -14.4f;
static const float trim_fm2 = -16.3f;
static const float trim_formant = -13.9f;
static const float trim_additive = -11.8f;
static const float trim_wavetable = -8.8f;
static const float trim_chords = -15.2f;
static const float trim_speech = -6.3f;
static const float trim_swarm = -11.8f;
static const float trim_noise = -12.6f;
static const float trim_particle = -8.2f;
static const float trim_string = 3.1f;
static const float trim_modal = -14.5f;
static const float trim_kick = 3.6f;
static const float trim_snare = 5.3f;
static const float trim_hat = 3.6f;
ENGINE(vcf, 0, true, 0.5f, 0.5f, 0.3f, 0.5f, 0.5f)
ENGINE(pd, 1, true, 0.4f, 0.5f, 0.5f, 0.5f, 0.5f)
ENGINE(sixop, 2, true, 0.0f, 0.5f, 0.5f, 0.5f, 0.5f)
ENGINE(terrain, 5, true, 0.3f, 0.5f, 0.5f, 0.5f, 0.5f)
ENGINE(strings, 6, true, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f)
ENGINE(chip, 7, true, 0.3f, 0.5f, 0.5f, 0.5f, 0.5f)
ENGINE(va, 8, true, 0.25f, 0.5f, 0.5f, 0.5f, 0.5f)
ENGINE(shaper, 9, true, 0.5f, 0.4f, 0.5f, 0.5f, 0.5f)
ENGINE(fm2, 10, true, 0.5f, 0.3f, 0.4f, 0.5f, 0.5f)
ENGINE(formant, 11, true, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f)
ENGINE(additive, 12, true, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f)
ENGINE(wavetable, 13, true, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f)
ENGINE(chords, 14, true, 0.3f, 0.5f, 0.5f, 0.5f, 0.5f)
ENGINE(speech, 15, true, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f)
ENGINE(swarm, 16, true, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f)
ENGINE(noise, 17, true, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f)
ENGINE(particle, 18, false, 0.5f, 0.5f, 0.5f, 0.6f, 0.5f)
ENGINE(string, 19, false, 0.5f, 0.5f, 0.5f, 0.6f, 0.5f)
ENGINE(modal, 20, false, 0.5f, 0.5f, 0.5f, 0.6f, 0.5f)
ENGINE(kick, 21, false, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f)
ENGINE(snare, 22, false, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f)
ENGINE(hat, 23, false, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f)

extern const BBDef plaitsDefs[] = {
    {"Filter Synth", "Synth", "Classic analog voice: two oscillators into a resonant filter. Harmonics sets the filter character.", 1, vcf},
    {"Phase Distortion", "Synth", "Phase distortion and phase modulation: brassy, hollow and vocal tones.", 1, pd},
    {"Six-Op FM", "Synth", "Six-operator FM with three banks of 32 patches (Harmonics picks the patch): electric pianos, bells, basses.", 1, sixop},
    {"Wave Terrain", "Synth", "A path across a 2D wave terrain: evolving, glassy and metallic tones.", 1, terrain},
    {"String Machine", "Synth", "Vintage string ensemble with chord memory and chorus.", 1, strings},
    {"Chip Synth", "Synth", "Video-game console voice: square waves, arpeggiated chords, sweeps.", 1, chip},
    {"Twin Analog", "Synth", "Two detunable analog waveforms, from saw to pulse to sync.", 1, va},
    {"Waveshaper", "Synth", "A triangle through a waveshaper and wavefolder: soft to buzzy.", 1, shaper},
    {"Two-Op FM", "Synth", "Two-operator FM with feedback: bells, plucks and growls.", 1, fm2},
    {"Formant", "Synth", "Formant and granular oscillator: vowels, voices and resonant tones.", 1, formant},
    {"Harmonic Organ", "Synth", "Additive synthesis of 24 harmonics: organs and bright drawbar tones.", 1, additive},
    {"Wavetable", "Synth", "Four banks of 8x8 wavetables, smoothly morphing.", 1, wavetable},
    {"Chord Synth", "Synth", "Plays a whole chord (Harmonics picks which) from one note: stabs and pads.", 1, chords},
    {"Speech", "Synth", "A talking synth: vowels, formant speech and sung words.", 1, speech},
    {"Swarm", "Synth", "A swarm of eight detuned sawtooth waves: huge, shimmering.", 1, swarm},
    {"Filtered Noise", "Synth", "Noise through a resonant filter: wind, breath and whistles.", 1, noise},
    {"Particles", "Physical", "Dust and crackles ringing through resonators: rain, glass and textures.", 1, particle},
    {"Plucked String", "Physical", "A plucked or bowed string model.", 1, string},
    {"Modal Bells", "Physical", "A struck modal resonator: bells, bars, plates and tubes.", 1, modal},
    {"Analog Kick", "Drums", "Analog bass drum: from tight kicks to booming 808-style tones.", 1, kick},
    {"Analog Snare", "Drums", "Analog snare drum: body and noise, tight to splashy.", 1, snare},
    {"Analog Hi-Hat", "Drums", "Analog hi-hat: metallic noise, closed to open.", 1, hat},
};
extern const int plaitsCount = sizeof(plaitsDefs) / sizeof(plaitsDefs[0]);
