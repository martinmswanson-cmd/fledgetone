/*
 * Faust programs (physical-model instruments and effects, see plugins.json) as a Fledgetone
 * plugin family. Each program's controls become the plugin's parameters, except an instrument's
 * "freq", "gain" and "gate" (and "bend"), which its notes play: eight copies of the program are
 * the instrument's voices. Generated code for each program is in gen/ (build.py).
 */
#include "../bbplug_impl.h"
#include "faustbase.h"
#include <math.h>
#include <stdlib.h>
#include <string>
#include <vector>

struct FaustDef
{
    FaustDSP *(*make)();
    /** Output trim, measured so they play about as loud as the app's instruments */
    float trim;
    /** Starting values that differ from the program's: "Label=value;Prefix *=value" */
    const char *defaults;
};
#include "gen/registry.h"

struct Param
{
    std::string label, unit;
    FAUSTFLOAT *zone;
    float init, min, max, step;
    int kind; // 0 slider / entry, 1 button, 2 checkbox
    bool log;
};

struct Collector : UI
{
    std::vector<Param> params;
    std::string unit;
    bool log = false;
    FAUSTFLOAT *metaZone = nullptr;
    void add(const char *label, FAUSTFLOAT *zone, float init, float min, float max, float step, int kind)
    {
        std::string l(label);
        auto b = l.find('[');
        if (b != std::string::npos) l = l.substr(0, b);
        while (!l.empty() && l.back() == ' ') l.pop_back();
        Param p{l, metaZone == zone ? unit : "", zone, init, min, max, step, kind, metaZone == zone && log};
        params.push_back(p);
        unit.clear();
        log = false;
        metaZone = nullptr;
    }
    void addButton(const char *l, FAUSTFLOAT *z) override { add(l, z, 0, 0, 1, 1, 1); }
    void addCheckButton(const char *l, FAUSTFLOAT *z) override { add(l, z, 0, 0, 1, 1, 2); }
    void addVerticalSlider(const char *l, FAUSTFLOAT *z, FAUSTFLOAT i, FAUSTFLOAT mn, FAUSTFLOAT mx, FAUSTFLOAT s) override { add(l, z, i, mn, mx, s, 0); }
    void addHorizontalSlider(const char *l, FAUSTFLOAT *z, FAUSTFLOAT i, FAUSTFLOAT mn, FAUSTFLOAT mx, FAUSTFLOAT s) override { add(l, z, i, mn, mx, s, 0); }
    void addNumEntry(const char *l, FAUSTFLOAT *z, FAUSTFLOAT i, FAUSTFLOAT mn, FAUSTFLOAT mx, FAUSTFLOAT s) override { add(l, z, i, mn, mx, s, 0); }
    void declare(FAUSTFLOAT *zone, const char *key, const char *value) override
    {
        if (!zone) return;
        if (metaZone != zone) unit.clear(), log = false;
        metaZone = zone;
        if (!strcmp(key, "unit")) unit = value;
        if (!strcmp(key, "scale") && !strcmp(value, "log")) log = true;
    }
};

static bool isVoiceParam(const std::string &l) { return l == "freq" || l == "gain" || l == "gate" || l == "bend"; }

/** "strikePosition" and "Envelope_Attack" read as "Strike position" and "Envelope attack" */
static std::string tidyLabel(const std::string &l)
{
    std::string o;
    for (size_t i = 0; i < l.size(); i++)
    {
        char c = l[i];
        if (c == '_') c = ' ';
        if (c >= 'A' && c <= 'Z' && i > 0 && l[i - 1] >= 'a' && l[i - 1] <= 'z')
        {
            o += ' ';
            c = c - 'A' + 'a';
        }
        else if (c >= 'A' && c <= 'Z' && i > 0 && o.size() && o.back() == ' ' && i + 1 < l.size() && l[i + 1] >= 'a' && l[i + 1] <= 'z')
            c = c - 'A' + 'a';
        o += c;
    }
    if (!o.empty() && o[0] >= 'a' && o[0] <= 'z') o[0] = o[0] - 'a' + 'A';
    return o;
}

struct Voice
{
    FaustDSP *dsp;
    std::vector<Param> params;
    FAUSTFLOAT *freq = nullptr, *gain = nullptr, *gate = nullptr, *bendZone = nullptr;
    int note = 60, age = 0, silent = 1 << 20;
    bool on = false, held = false;
};

static const int VOICES = 8;

struct FaustPlugin : BBPlugin
{
    std::vector<Voice> voices;
    std::vector<int> userIndex; // parameter i is params[userIndex[i]] of every voice
    bool instrument;
    float trim, sr, bend = 0;
    bool sustain = false;
    float tmpL[BB_BLOCK], tmpR[BB_BLOCK];

    FaustPlugin(float sampleRate, const FaustDef &def, bool inst) : instrument(inst), trim(def.trim), sr(sampleRate)
    {
        int n = inst ? VOICES : 1;
        for (int i = 0; i < n; i++)
        {
            Voice v;
            v.dsp = def.make();
            v.dsp->init((int)sampleRate);
            Collector c;
            v.dsp->buildUserInterface(&c);
            v.params = c.params;
            for (auto &p : v.params)
            {
                if (!inst) continue;
                if (p.label == "freq") v.freq = p.zone;
                else if (p.label == "gain") v.gain = p.zone;
                else if (p.label == "gate") v.gate = p.zone;
                else if (p.label == "bend") v.bendZone = p.zone;
            }
            voices.push_back(v);
        }
        // Starting values that differ from the program's own
        for (auto &v : voices)
            for (auto &p : v.params)
            {
                std::string spec = def.defaults;
                size_t at = 0;
                while (at < spec.size())
                {
                    size_t end = spec.find(';', at);
                    std::string item = spec.substr(at, end == std::string::npos ? std::string::npos : end - at);
                    at = end == std::string::npos ? spec.size() : end + 1;
                    size_t eq = item.find('=');
                    if (eq == std::string::npos) continue;
                    std::string key = item.substr(0, eq);
                    bool prefix = key.size() > 2 && key.substr(key.size() - 2) == " *";
                    if (prefix ? p.label.rfind(key.substr(0, key.size() - 2), 0) == 0 : p.label == key)
                    {
                        p.init = (float)atof(item.c_str() + eq + 1);
                        *p.zone = p.init;
                    }
                }
            }
        for (int i = 0; i < (int)voices[0].params.size() && (int)userIndex.size() < BB_MAX_PARAMS; i++)
        {
            const std::string &l = voices[0].params[i].label;
            // (The plugin window has its own bypass)
            if ((!inst || !isVoiceParam(l)) && l != "Bypass") userIndex.push_back(i);
        }
        for (auto &v : voices)
            for (auto &p : v.params) p.label = tidyLabel(p.label);
        for (int i = 0; i < (int)userIndex.size(); i++)
        {
            const Param &p = voices[0].params[userIndex[i]];
            values[i] = p.max > p.min ? (p.log && p.min > 0 ? logf(p.init / p.min) / logf(p.max / p.min) : (p.init - p.min) / (p.max - p.min)) : 0;
        }
    }
    ~FaustPlugin()
    {
        for (auto &v : voices) delete v.dsp;
    }
    int params() override { return (int)userIndex.size(); }
    const char *paramName(int i) override { return voices[0].params[userIndex[i]].label.c_str(); }
    float valueOf(int i)
    {
        const Param &p = voices[0].params[userIndex[i]];
        if (p.kind) return values[i] >= 0.5f ? 1.f : 0.f;
        float x = p.log && p.min > 0 ? p.min * powf(p.max / p.min, values[i]) : p.min + (p.max - p.min) * values[i];
        if (p.step > 0) x = p.min + roundf((x - p.min) / p.step) * p.step;
        return fminf(p.max, fmaxf(p.min, x));
    }
    void apply(int i, float) override
    {
        float x = valueOf(i);
        for (auto &v : voices) *v.params[userIndex[i]].zone = x;
    }
    void display(int i, char *o, int n) override
    {
        const Param &p = voices[0].params[userIndex[i]];
        float x = valueOf(i);
        if (p.kind) snprintf(o, n, "%s", x >= 0.5f ? "on" : "off");
        else if (p.step >= 1 || fabsf(x) >= 100) snprintf(o, n, "%.0f%s%s", x, p.unit.empty() ? "" : " ", p.unit.c_str());
        else snprintf(o, n, "%.2f%s%s", x, p.unit.empty() ? "" : " ", p.unit.c_str());
    }
    void setFreq(Voice &v)
    {
        if (v.freq) *v.freq = 440.f * powf(2.f, (v.note + (v.bendZone ? 0.f : bend) - 69.f) / 12.f);
        if (v.bendZone) *v.bendZone = bend;
    }
    void midi(int s, int d1, int d2) override
    {
        if (!instrument) return;
        int type = s & 0xf0;
        if (type == 0x90 && d2 > 0)
        {
            int pick = 0, best = -1;
            for (int i = 0; i < (int)voices.size(); i++)
            {
                int score = (!voices[i].on ? 1 << 30 : 0) + voices[i].age;
                if (score > best) best = score, pick = i;
            }
            Voice &v = voices[pick];
            v.note = d1;
            v.age = 0;
            v.on = v.held = true;
            v.silent = 0;
            setFreq(v);
            if (v.gain) *v.gain = 0.25f + 0.75f * d2 / 127.f;
            // The DSP starts a note when it sees the gate go up between two renders. A voice whose
            // gate the last render saw up is restruck: one render with it down, then up again.
            // Otherwise it goes up now.
            releaseAfter[pick] = false;
            if (lastGate[pick] > 0)
            {
                if (v.gate) *v.gate = 0;
                raiseAfter[pick] = true;
            }
            else
            {
                if (v.gate) *v.gate = 1;
                raiseAfter[pick] = false;
            }
        }
        else if (type == 0x80 || type == 0x90)
        {
            for (auto &v : voices)
                if (v.on && v.held && v.note == d1)
                {
                    v.held = false;
                    if (!sustain) release(v);
                }
        }
        else if (type == 0xe0)
        {
            bend = ((d2 << 7 | d1) - 8192) / 8192.f * 2.f;
            for (auto &v : voices) setFreq(v);
        }
        else if (type == 0xb0 && d1 == 64)
        {
            sustain = d2 >= 64;
            if (!sustain)
                for (auto &v : voices)
                    if (v.on && !v.held) release(v);
        }
        else if (type == 0xb0 && (d1 == 123 || d1 == 120))
            for (auto &v : voices) v.held = false, release(v);
    }
    /** Raise the gate after the next render (a restruck voice's render with it down) */
    bool raiseAfter[VOICES] = {};
    /** Lower the gate after the next render (a note that ended before any render saw it up) */
    bool releaseAfter[VOICES] = {};
    /** The gate the last render saw */
    float lastGate[VOICES] = {};
    void release(Voice &v)
    {
        v.on = false;
        if (!v.gate) return;
        int vi = (int)(&v - voices.data());
        // A note no render has heard yet (its start and end arrived together, or it is shorter
        // than a render) still gets one render with the gate up, so it sounds and ends
        if (instrument && vi < VOICES && (raiseAfter[vi] || (lastGate[vi] <= 0 && *v.gate > 0))) releaseAfter[vi] = true;
        else *v.gate = 0;
    }
    void process(const float *il, const float *ir, float *ol, float *orr, int n) override
    {
        for (int k = 0; k < n; k++) ol[k] = orr[k] = 0;
        for (int vi = 0; vi < (int)voices.size(); vi++)
        {
            Voice &v = voices[vi];
            v.age++;
            bool pending = instrument && vi < VOICES && (raiseAfter[vi] || releaseAfter[vi]);
            if (instrument && !v.on && !pending && v.silent > (int)(sr * 3)) continue;
            int nin = v.dsp->getNumInputs(), nout = v.dsp->getNumOutputs();
            float zero[BB_BLOCK] = {};
            float *ins[8] = {(float *)(il ? il : zero), (float *)(ir ? ir : zero), zero, zero, zero, zero, zero, zero};
            if (nin == 1)
            {
                // A mono effect hears both sides
                for (int k = 0; k < n; k++) tmpL[k] = 0.5f * (ins[0][k] + ins[1][k]);
                ins[0] = tmpL;
            }
            float o0[BB_BLOCK], o1[BB_BLOCK], spare[6][BB_BLOCK];
            float *outs[8] = {o0, o1, spare[0], spare[1], spare[2], spare[3], spare[4], spare[5]};
            v.dsp->compute(n, ins, outs);
            if (instrument && vi < VOICES && v.gate)
            {
                lastGate[vi] = *v.gate;
                if (raiseAfter[vi]) *v.gate = 1, raiseAfter[vi] = false;
                else if (releaseAfter[vi]) *v.gate = 0, releaseAfter[vi] = false;
            }
            float *right = nout > 1 ? o1 : o0;
            float peak = 0;
            for (int k = 0; k < n; k++)
            {
                float l = o0[k] * trim, r = right[k] * trim;
                if (!std::isfinite(l) || !std::isfinite(r)) l = r = 0;
                ol[k] += l;
                orr[k] += r;
                peak = fmaxf(peak, fabsf(l) + fabsf(r));
            }
            v.silent = peak < 1e-5f ? v.silent + n : 0;
        }
    }
};

#define BB_FAUST_FACTORY(id, inst) \
    static BBPlugin *make_##id(float sr) { return new FaustPlugin(sr, faust_##id, inst); }
BB_FAUST_FACTORIES

static const BBDef defs[] = {BB_FAUST_DEFS};
BB_FAMILY(defs)
