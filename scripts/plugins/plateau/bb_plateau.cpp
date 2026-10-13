/*
 * Plateau (Dale Johnson, Valley Audio; GPL-3.0) as a plugin family: the Dattorro plate reverb
 * from ValleyRackFree, with its module's knobs mapped to 0-1 the way Plateau.cpp scales them.
 */
#include "../bbplug_impl.h"
#include "Dattorro.hpp"
#include <math.h>

namespace {
const char *names[] = {"Dry",           "Wet",           "Pre-delay",      "Size",
                       "Decay",         "Diffusion",     "Input low cut",  "Input high cut",
                       "Reverb low cut", "Reverb high cut", "Mod rate",    "Mod depth",
                       "Mod shape",     "Diffuse input", "Hold"};
enum { DRY, WET, PRE, SIZE, DECAY, DIFF, IN_LO, IN_HI, REV_LO, REV_HI, MOD_RATE, MOD_DEPTH, MOD_SHAPE, DIFF_IN, HOLD, COUNT };
const float defaults[COUNT] = {1, 0.5f, 0, 0.5f, 0.5f, 1, 0, 1, 0, 1, 0, 0.5f / 16, 0.5f, 1, 0};

struct Preset { const char *name; float v[COUNT]; };
const Preset presets[] = {
    {"Plate", {1, 0.5f, 0, 0.5f, 0.5f, 1, 0, 1, 0, 1, 0, 0.5f / 16, 0.5f, 1, 0}},
    {"Small Room", {1, 0.35f, 0.02f, 0.18f, 0.3f, 0.8f, 0.25f, 0.85f, 0.2f, 0.8f, 0.1f, 0.03f, 0.5f, 1, 0}},
    {"Bright Plate", {1, 0.45f, 0.04f, 0.42f, 0.55f, 1, 0.35f, 1, 0.3f, 1, 0.2f, 0.05f, 0.5f, 1, 0}},
    {"Dark Hall", {1, 0.5f, 0.06f, 0.7f, 0.75f, 1, 0.1f, 0.7f, 0.05f, 0.62f, 0.15f, 0.1f, 0.5f, 1, 0}},
    {"Huge Space", {1, 0.55f, 0.1f, 0.9f, 0.88f, 1, 0.2f, 0.85f, 0.15f, 0.78f, 0.25f, 0.2f, 0.5f, 1, 0}},
    {"Shimmering Wash", {0.8f, 0.7f, 0.05f, 0.8f, 0.92f, 1, 0.3f, 1, 0.25f, 0.95f, 0.5f, 0.6f, 0.3f, 1, 0}},
    {"Endless Pad", {0.8f, 0.7f, 0, 0.85f, 1, 1, 0.25f, 0.8f, 0.2f, 0.72f, 0.3f, 0.3f, 0.5f, 1, 0}},
    {"Echoey Tank", {1, 0.45f, 0.15f, 0.6f, 0.65f, 0.25f, 0.2f, 0.9f, 0.1f, 0.85f, 0, 0.05f, 0.5f, 0, 0}},
    {"Wobbly Lo-Fi", {1, 0.5f, 0.03f, 0.45f, 0.7f, 1, 0.45f, 0.62f, 0.4f, 0.6f, 0.65f, 1, 0.9f, 1, 0}},
};
const int presetCount = sizeof(presets) / sizeof(presets[0]);

const float sizeMax = 4.f;
inline float cutHz(float v) { return 440.f * powf(2.f, v * 10.f - 5.f); }

struct Plateau : BBPlugin
{
    Dattorro reverb;
    float dry = 1, wet = 5;
    bool frozen = false;
    Plateau(float sr) : reverb(sr, 16, sizeMax)
    {
        reverb.setSampleRate(sr);
        setAll(defaults);
    }
    int params() override { return COUNT; }
    const char *paramName(int i) override { return names[i]; }
    float size(float v) { v *= v; return 0.01f + v * (sizeMax - 0.01f); }
    float decay(float v)
    {
        float d = bbLin(v, 0.1f, 0.9999f);
        d = 1.f - d;
        return 1.f - d * d;
    }
    void apply(int i, float v) override
    {
        switch (i)
        {
        case DRY: dry = v; break;
        case WET: wet = v * 10.f; break;
        case PRE: reverb.setPreDelay(v * 0.5f); break;
        case SIZE: reverb.setTimeScale(size(v)); break;
        case DECAY: reverb.setDecay(decay(v)); break;
        case DIFF: reverb.setTankDiffusion(v * 10.f); break;
        case IN_LO: reverb.setInputFilterLowCutoffPitch(v * 10.f); break;
        case IN_HI: reverb.setInputFilterHighCutoffPitch(v * 10.f); break;
        case REV_LO: reverb.setTankFilterLowCutFrequency(v * 10.f); break;
        case REV_HI: reverb.setTankFilterHighCutFrequency(v * 10.f); break;
        case MOD_RATE: reverb.setTankModSpeed(v * v * 99.f + 1.f); break;
        case MOD_DEPTH: reverb.setTankModDepth(v * 16.f); break;
        case MOD_SHAPE: reverb.setTankModShape(bbLin(v, 0.001f, 0.999f)); break;
        case DIFF_IN: reverb.enableInputDiffusion(v > 0.5f); break;
        case HOLD:
            if ((v > 0.5f) != frozen) { frozen = v > 0.5f; reverb.freeze(frozen); }
            break;
        }
    }
    void display(int i, char *out, int n) override
    {
        float v = values[i];
        switch (i)
        {
        case PRE: snprintf(out, n, "%.0f ms", v * 500.f); break;
        case SIZE: snprintf(out, n, "%.2fx", size(v)); break;
        case IN_LO: case IN_HI: case REV_LO: case REV_HI:
        {
            float hz = cutHz(v);
            if (hz >= 1000) snprintf(out, n, "%.1f kHz", hz / 1000.f);
            else snprintf(out, n, "%.0f Hz", hz);
            break;
        }
        case MOD_RATE: snprintf(out, n, "%.1fx", v * v * 99.f + 1.f); break;
        case MOD_SHAPE: snprintf(out, n, "%.0f%%", v * 200.f - 100.f); break;
        case DIFF_IN: case HOLD: snprintf(out, n, "%s", v > 0.5f ? "On" : "Off"); break;
        default: snprintf(out, n, "%.0f%%", v * 100.f);
        }
    }
    void process(const float *inL, const float *inR, float *outL, float *outR, int frames) override
    {
        for (int s = 0; s < frames; s++)
        {
            float l = inL[s], r = inR[s];
            reverb.process(l * 0.1, r * 0.1);
            outL[s] = l * dry + (float)reverb.getLeftOutput() * wet;
            outR[s] = r * dry + (float)reverb.getRightOutput() * wet;
        }
    }
    int programs() override { return presetCount; }
    const char *programName(int i) override { return i >= 0 && i < presetCount ? presets[i].name : ""; }
    void setProgram(int i) override
    {
        if (i < 0 || i >= presetCount) return;
        program = i;
        setAll(presets[i].v);
    }
};

BBPlugin *make(float sr) { return new Plateau(sr); }
const BBDef defs[] = {
    {"Plateau", "Reverb", "Huge, smooth plate reverb that can sustain forever: size, decay, damping, modulation and Hold to freeze the tail.", 0, make},
};
} // namespace
BB_FAMILY(defs)
