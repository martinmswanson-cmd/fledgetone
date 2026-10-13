/*
 * Mutable Instruments' Braids (Emilie Gillet, MIT): a macro oscillator with 47 shapes, from
 * analog waves through FM, vowels, physical models and noise, played as an eight-voice instrument
 * with an envelope of ours. Its presets are its shapes. Braids runs at 96 kHz: other rates are
 * corrected in pitch.
 */
#include "../bbplug_impl.h"
#include "braids/macro_oscillator.h"
#include <math.h>

using namespace braids;

static const char *shapes[] = {
    "Saw (detuned)", "Morph", "Saw / square", "Sine / triangle", "Buzz", "Square sub", "Saw sub", "Square sync", "Saw sync",
    "Triple saw", "Triple square", "Triple triangle", "Triple sine", "Triple ring mod", "Saw swarm", "Saw comb", "Toy",
    "Digital filter LP", "Digital filter peak", "Digital filter BP", "Digital filter HP", "Vosim", "Vowel", "Vowel FOF",
    "Harmonics", "FM", "Feedback FM", "Chaotic FM", "Plucked", "Bowed", "Blown", "Fluted", "Struck bell", "Struck drum",
    "Kick", "Cymbal", "Snare", "Wavetables", "Wave map", "Wave line", "Wave chords", "Filtered noise", "Twin peaks noise",
    "Clocked noise", "Granular cloud", "Particle noise", "Digital modulation"};
static const int NSHAPES = sizeof(shapes) / sizeof(shapes[0]);
/** Level trims for the quiet shapes (measured), so they all play at about the same loudness */
static float shapeTrim(int s)
{
    switch (s)
    {
    case 13: case 23: return 1.8f;
    case 29: return 2.f;
    case 30: case 41: return 3.f;
    case 32: case 35: case 45: return 2.5f;
    case 33: case 40: return 1.5f;
    default: return 1.f;
    }
}

enum { SHAPE, TIMBRE, COLOR, ATTACK, DECAY, SUSTAIN, RELEASE, VOLUME, NPARAMS };
static const char *names[NPARAMS] = {"Shape", "Timbre", "Color", "Attack", "Decay", "Sustain", "Release", "Volume"};
static const int VOICES = 8, BLOCK = 24;

struct BraidsVoice
{
    MacroOscillator osc;
    int16_t buf[BLOCK];
    float env = 0, velocity = 0;
    int note = 60, age = 0, stage = 0; // 0 off, 1 attack, 2 decay/sustain, 3 release
    bool held = false;
};

struct Braids : BBPlugin
{
    BraidsVoice v[VOICES];
    float out[BLOCK];
    int pos = BLOCK;
    float sr, rateFix, bend = 0;
    bool sustainPedal = false;
    Braids(float sampleRate) : sr(sampleRate)
    {
        for (auto &x : v) x.osc.Init();
        rateFix = 12.f * log2f(96000.f / sampleRate);
        float init[NPARAMS] = {0, 0.4f, 0.4f, 0.02f, 0.4f, 0.8f, 0.3f, 0.7f};
        setAll(init);
    }
    int shape() { return bbIndex(values[SHAPE], NSHAPES); }
    int params() override { return NPARAMS; }
    const char *paramName(int i) override { return names[i]; }
    void apply(int i, float) override
    {
        if (i == SHAPE)
            for (auto &x : v) x.osc.set_shape((MacroOscillatorShape)shape());
    }
    float seconds(int i) { return bbExp(values[i], 0.002f, 8.f); }
    void display(int i, char *o, int n) override
    {
        if (i == SHAPE) snprintf(o, n, "%s", shapes[shape()]);
        else if (i == ATTACK || i == DECAY || i == RELEASE) snprintf(o, n, seconds(i) < 1 ? "%.0f ms" : "%.2f s", seconds(i) < 1 ? seconds(i) * 1000 : seconds(i));
        else if (i == VOLUME) snprintf(o, n, "%.1f dB", 20.f * log10f(fmaxf(values[i] * values[i] * 1.6f, 1e-5f)));
        else snprintf(o, n, "%.0f%%", values[i] * 100);
    }
    int programs() override { return NSHAPES; }
    const char *programName(int i) override { return shapes[i]; }
    void setProgram(int i) override { set(SHAPE, (i + 0.5f) / NSHAPES); }
    void midi(int s, int d1, int d2) override
    {
        int type = s & 0xf0;
        if (type == 0x90 && d2 > 0)
        {
            int pick = 0, best = -1;
            for (int i = 0; i < VOICES; i++)
            {
                int score = (v[i].stage == 0 ? 1 << 30 : v[i].stage == 3 ? 1 << 29 : 0) + v[i].age;
                if (score > best) best = score, pick = i;
            }
            BraidsVoice &x = v[pick];
            x.note = d1;
            x.velocity = d2 / 127.f;
            x.stage = 1;
            x.held = true;
            x.age = 0;
            x.osc.Strike();
        }
        else if (type == 0x80 || type == 0x90)
        {
            for (auto &x : v)
                if (x.held && x.note == d1)
                {
                    x.held = false;
                    if (!sustainPedal && x.stage) x.stage = 3;
                }
        }
        else if (type == 0xe0) bend = ((d2 << 7 | d1) - 8192) / 8192.f * 2.f;
        else if (type == 0xb0 && d1 == 64)
        {
            sustainPedal = d2 >= 64;
            if (!sustainPedal)
                for (auto &x : v)
                    if (!x.held && x.stage && x.stage != 3) x.stage = 3;
        }
        else if (type == 0xb0 && (d1 == 123 || d1 == 120))
            for (auto &x : v) x.held = false, x.stage = x.stage ? 3 : 0;
    }
    void renderBlock()
    {
        for (int k = 0; k < BLOCK; k++) out[k] = 0;
        float dt = BLOCK / sr;
        float att = dt / seconds(ATTACK), dec = expf(-dt / (seconds(DECAY) / 4)), rel = expf(-dt / (seconds(RELEASE) / 4));
        float sus = values[SUSTAIN];
        float gain = values[VOLUME] * values[VOLUME] * 1.6f / 32768.f * 0.35f * shapeTrim(shape());
        uint8_t sync[BLOCK] = {};
        int16_t timbre = (int16_t)(values[TIMBRE] * 32767), color = (int16_t)(values[COLOR] * 32767);
        for (auto &x : v)
        {
            x.age++;
            if (!x.stage) continue;
            if (x.stage == 1)
            {
                x.env += att;
                if (x.env >= 1) x.env = 1, x.stage = 2;
            }
            else if (x.stage == 2) x.env = sus + (x.env - sus) * dec;
            else
            {
                x.env *= rel;
                if (x.env < 1e-4f) { x.env = 0; x.stage = 0; continue; }
            }
            x.osc.set_pitch((int16_t)fmaxf(0, fminf(16383, (x.note + bend + rateFix) * 128.f)));
            x.osc.set_parameters(timbre, color);
            x.osc.Render(sync, x.buf, BLOCK);
            float g = gain * x.env * (0.3f + 0.7f * x.velocity);
            for (int k = 0; k < BLOCK; k++) out[k] += x.buf[k] * g;
        }
        pos = 0;
    }
    void process(const float *, const float *, float *l, float *r, int n) override
    {
        for (int i = 0; i < n; i++)
        {
            if (pos >= BLOCK) renderBlock();
            l[i] = r[i] = out[pos++];
        }
    }
};

static BBPlugin *makeBraids(float sr) { return new Braids(sr); }
extern const BBDef braidsDefs[] = {
    {"Macro Oscillator", "Synth", "47 oscillator shapes in one: analog waves, sync, FM, vowels, plucked and bowed models, drums and noise. Pick a shape from Preset.", 1, makeBraids},
};
extern const int braidsCount = 1;
