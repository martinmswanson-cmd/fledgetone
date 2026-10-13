/*
 * Open303 (Robin Schmidt, MIT) as a Bo's Beatbox instrument: an acid bass line synth (one voice,
 * a saw/square oscillator into a resonant diode-ladder-style filter). Overlapping notes slide;
 * notes at velocity 100 or more (about 0.79) are accented.
 */
#include "../bbplug_impl.h"
#include "rosic_Open303.h"

using namespace rosic;

enum { WAVE, CUTOFF, RESO, ENVMOD, DECAY, ACCENT, SLIDE, DRIVE, VOLUME, NPARAMS };
static const char *names[NPARAMS] = {"Saw / square", "Cutoff", "Resonance", "Env mod", "Decay", "Accent", "Slide time", "Drive", "Volume"};

struct Preset
{
    const char *name;
    float v[NPARAMS];
};
static const Preset presets[] = {
    {"Classic acid", {0.0f, 0.35f, 0.75f, 0.55f, 0.35f, 0.6f, 0.4f, 0.25f, 0.65f}},
    {"Squelch", {0.0f, 0.2f, 0.92f, 0.85f, 0.3f, 0.8f, 0.4f, 0.4f, 0.65f}},
    {"Deep bass", {0.0f, 0.15f, 0.35f, 0.25f, 0.6f, 0.3f, 0.4f, 0.1f, 0.7f}},
    {"Square bite", {1.0f, 0.4f, 0.7f, 0.6f, 0.25f, 0.7f, 0.35f, 0.3f, 0.65f}},
    {"Rubber", {0.5f, 0.3f, 0.6f, 0.4f, 0.55f, 0.5f, 0.6f, 0.2f, 0.65f}},
    {"Screamer", {0.0f, 0.5f, 0.97f, 0.9f, 0.2f, 0.9f, 0.3f, 0.75f, 0.55f}},
};
static const int npresets = sizeof(presets) / sizeof(presets[0]);

struct Acid : BBPlugin
{
    Open303 core;
    Acid(float sr)
    {
        core.setSampleRate(sr);
        core.setTuning(440.0);
        core.filter.setMode(TeeBeeFilter::TB_303);
        setProgram(0);
    }
    int params() override { return NPARAMS; }
    const char *paramName(int i) override { return names[i]; }
    void apply(int i, float v) override
    {
        switch (i)
        {
        case WAVE: core.setWaveform(v); break;
        case CUTOFF: core.setCutoff(bbExp(v, 314.f, 2394.f)); break;
        case RESO: core.setResonance(v * 100.0); break;
        case ENVMOD: core.setEnvMod(v * 100.0); break;
        case DECAY: core.setDecay(bbExp(v, 200.f, 2000.f)); break;
        case ACCENT: core.setAccent(v * 100.0); break;
        case SLIDE: core.setSlideTime(bbLin(v, 20.f, 120.f)); break;
        case DRIVE: core.setTanhShaperDrive(bbLin(v, 0.f, 36.f)); break;
        case VOLUME: core.setVolume(bbLin(v, -40.f, 0.f)); break;
        }
    }
    void display(int i, char *o, int n) override
    {
        float v = values[i];
        switch (i)
        {
        case WAVE: snprintf(o, n, v < 0.05f ? "saw" : v > 0.95f ? "square" : "%.0f%% square", v * 100); break;
        case CUTOFF: snprintf(o, n, "%.0f Hz", bbExp(v, 314.f, 2394.f)); break;
        case DECAY: snprintf(o, n, "%.0f ms", bbExp(v, 200.f, 2000.f)); break;
        case SLIDE: snprintf(o, n, "%.0f ms", bbLin(v, 20.f, 120.f)); break;
        case DRIVE: snprintf(o, n, "%.0f dB", bbLin(v, 0.f, 36.f)); break;
        case VOLUME: snprintf(o, n, "%.1f dB", bbLin(v, -40.f, 0.f)); break;
        default: snprintf(o, n, "%.0f%%", v * 100);
        }
    }
    void process(const float *, const float *, float *l, float *r, int frames) override
    {
        for (int i = 0; i < frames; i++) l[i] = r[i] = (float)core.getSample();
    }
    void midi(int s, int d1, int d2) override
    {
        int type = s & 0xf0;
        if (type == 0x90 && d2 > 0) core.noteOn(d1, d2, 0.0);
        else if (type == 0x80 || type == 0x90) core.noteOn(d1, 0, 0.0);
        else if (type == 0xe0) core.setPitchBend(((d2 << 7 | d1) - 8192) / 8192.0 * 2.0);
        else if (type == 0xb0 && (d1 == 123 || d1 == 120)) core.allNotesOff();
    }
    int programs() override { return npresets; }
    const char *programName(int i) override { return presets[i].name; }
    void setProgram(int i) override { setAll(presets[i].v); }
};

static BBPlugin *makeAcid(float sr) { return new Acid(sr); }
static const BBDef defs[] = {
    {"Acid Bass", "Instrument", "Acid bass line synth: a squelchy resonant filter, accents on loud notes and slides on overlapping ones.", 1, makeAcid},
};
BB_FAMILY(defs)
