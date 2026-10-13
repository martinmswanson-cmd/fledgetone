/*
 * Mutable Instruments' Elements (Emilie Gillet, MIT): a modal synthesis voice. An exciter (a bow,
 * a breath and a mallet, in any mix) drives a resonator of 64 modes (or strings), into a
 * reverb. One voice: the newest held note plays. Elements runs at 32 kHz: other rates are
 * corrected in pitch.
 */
#include "../bbplug_impl.h"
#include "blocker.h"
#include "elements/dsp/part.h"
#include <math.h>

using namespace elements;

enum
{
    CONTOUR, BOW, BOW_TIMBRE, BLOW, FLOW, BLOW_TIMBRE, STRIKE, MALLET, STRIKE_TIMBRE,
    GEOMETRY, BRIGHTNESS, DAMPING, POSITION, SPACE, RESONATOR, VOLUME, NPARAMS
};
static const char *names[NPARAMS] = {"Contour", "Bow", "Bow timbre", "Blow", "Flow", "Blow timbre", "Strike", "Mallet", "Strike timbre",
                                     "Geometry", "Brightness", "Damping", "Position", "Space", "Resonator", "Volume"};

struct Preset
{
    const char *name;
    float v[NPARAMS];
};
//                               cont  bow   bowT  blow  flow  blowT strk  mall  strkT geom  brig  damp  pos   space res   vol
static const Preset presets[] = {
    {"Struck bell", {0.0f, 0.0f, 0.5f, 0.0f, 0.5f, 0.5f, 0.8f, 0.5f, 0.6f, 0.7f, 0.6f, 0.4f, 0.3f, 0.5f, 0.0f, 0.8f}},
    {"Bowed string", {0.6f, 0.8f, 0.5f, 0.0f, 0.5f, 0.5f, 0.0f, 0.5f, 0.5f, 0.25f, 0.5f, 0.6f, 0.3f, 0.4f, 0.0f, 0.8f}},
    {"Blown pipe", {0.5f, 0.0f, 0.5f, 0.8f, 0.6f, 0.4f, 0.0f, 0.5f, 0.5f, 0.3f, 0.45f, 0.6f, 0.5f, 0.4f, 0.0f, 0.8f}},
    {"Marimba", {0.0f, 0.0f, 0.5f, 0.0f, 0.5f, 0.5f, 0.9f, 0.3f, 0.3f, 0.2f, 0.4f, 0.35f, 0.2f, 0.3f, 0.0f, 0.8f}},
    {"Plucked string", {0.0f, 0.0f, 0.5f, 0.0f, 0.5f, 0.5f, 0.8f, 0.8f, 0.5f, 0.4f, 0.6f, 0.5f, 0.2f, 0.3f, 0.5f, 0.8f}},
    {"Glass harmonica", {0.7f, 0.6f, 0.8f, 0.0f, 0.5f, 0.5f, 0.0f, 0.5f, 0.5f, 0.8f, 0.8f, 0.7f, 0.4f, 0.6f, 0.0f, 0.8f}},
    {"Breathy drone", {0.9f, 0.3f, 0.4f, 0.6f, 0.8f, 0.6f, 0.0f, 0.5f, 0.5f, 0.5f, 0.35f, 0.8f, 0.6f, 0.9f, 1.0f, 0.8f}},
    {"Gong", {0.0f, 0.0f, 0.5f, 0.0f, 0.5f, 0.5f, 0.9f, 0.6f, 0.8f, 0.9f, 0.5f, 0.75f, 0.6f, 0.7f, 0.0f, 0.8f}},
};

struct Elements : BBPlugin
{
    Part *part;
    uint16_t *reverb;
    Blocker<16> blocker;
    PerformanceState ps = {};
    int stack[16];
    int depth = 0;
    float rateFix, bend = 0, velocity = 0.8f;
    bool ominous;
    float trim;
    Elements(float sr, bool om) : ominous(om), trim(om ? 10.f : 1.2f)
    {
        reverb = new uint16_t[32768]();
        part = new Part();
        part->Init(reverb);
        uint32_t seed[3] = {0x1234567u, 0x89abcdefu, 0x2468aceu};
        part->Seed(seed, 3);
        part->set_easter_egg(ominous);
        rateFix = 12.f * log2f(32000.f / sr);
        ps.note = 60;
        ps.strength = 0.8f;
        setProgram(ominous ? 6 : 0);
    }
    ~Elements()
    {
        delete part;
        delete[] reverb;
    }
    int params() override { return NPARAMS; }
    const char *paramName(int i) override { return names[i]; }
    void apply(int i, float v) override
    {
        if (i == RESONATOR) part->set_resonator_model((ResonatorModel)bbIndex(v, 3));
    }
    void display(int i, char *o, int n) override
    {
        static const char *res[] = {"modal", "string", "strings"};
        if (i == RESONATOR) snprintf(o, n, "%s", res[bbIndex(values[i], 3)]);
        else if (i == VOLUME) snprintf(o, n, "%.1f dB", 20.f * log10f(fmaxf(values[i] * values[i] * 1.6f, 1e-5f)));
        else snprintf(o, n, "%.0f%%", values[i] * 100);
    }
    void midi(int s, int d1, int d2) override
    {
        int type = s & 0xf0;
        if (type == 0x90 && d2 > 0)
        {
            if (depth < 16) stack[depth++] = d1;
            ps.note = d1;
            velocity = d2 / 127.f;
            // A new note restarts the exciter: the gate drops for one block first
            retrigger = true;
        }
        else if (type == 0x80 || type == 0x90)
        {
            for (int i = 0; i < depth; i++)
                if (stack[i] == d1)
                {
                    for (int j = i; j < depth - 1; j++) stack[j] = stack[j + 1];
                    depth--;
                    break;
                }
            if (depth) ps.note = stack[depth - 1];
        }
        else if (type == 0xe0) bend = ((d2 << 7 | d1) - 8192) / 8192.f * 2.f;
        else if (type == 0xb0 && (d1 == 123 || d1 == 120)) depth = 0;
    }
    bool retrigger = false;
    int programs() override { return sizeof(presets) / sizeof(presets[0]); }
    const char *programName(int i) override { return presets[i].name; }
    void setProgram(int i) override { setAll(presets[i].v); }
    void process(const float *il, const float *ir, float *ol, float *orr, int n) override
    {
        blocker.run(nullptr, nullptr, ol, orr, n, [this](float *, float *, float *outL, float *outR) {
            Patch *p = part->mutable_patch();
            p->exciter_envelope_shape = values[CONTOUR];
            p->exciter_bow_level = values[BOW];
            p->exciter_bow_timbre = fminf(values[BOW_TIMBRE], 0.9995f);
            p->exciter_blow_level = values[BLOW];
            p->exciter_blow_meta = fminf(values[FLOW], 0.9995f);
            p->exciter_blow_timbre = fminf(values[BLOW_TIMBRE], 0.9995f);
            p->exciter_strike_level = values[STRIKE];
            p->exciter_strike_meta = fminf(values[MALLET], 0.9995f);
            p->exciter_strike_timbre = fminf(values[STRIKE_TIMBRE], 0.995f);
            p->resonator_geometry = fminf(values[GEOMETRY], 0.9995f);
            p->resonator_brightness = fminf(values[BRIGHTNESS], 0.9995f);
            p->resonator_damping = fminf(values[DAMPING], 0.9995f);
            p->resonator_position = fminf(values[POSITION], 0.9995f);
            p->space = values[SPACE] * 2.f;
            PerformanceState s = ps;
            s.note = ps.note + bend + rateFix;
            s.gate = depth > 0 && !retrigger;
            s.strength = 0.4f + 0.6f * velocity;
            s.modulation = 0;
            retrigger = false;
            static float silence[16];
            part->Process(s, silence, silence, outL, outR, 16);
            float g = values[VOLUME] * values[VOLUME] * 1.6f * trim;
            for (int k = 0; k < 16; k++) outL[k] *= g, outR[k] *= g;
        });
        (void)il;
        (void)ir;
    }
};

static BBPlugin *modalVoice(float sr) { return new Elements(sr, false); }
static BBPlugin *ominousVoice(float sr) { return new Elements(sr, true); }

extern const BBDef elementsDefs[] = {
    {"Modal Voice", "Physical", "Modal synthesis: a bow, a breath and a mallet exciting bells, strings, pipes and plates. One voice, with reverb.", 1, modalVoice},
    {"Ominous Drone", "Physical", "A dark, detuned drone voice made of coupled resonators.", 1, ominousVoice},
};
extern const int elementsCount = sizeof(elementsDefs) / sizeof(elementsDefs[0]);
