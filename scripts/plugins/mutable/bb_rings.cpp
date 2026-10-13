/*
 * Mutable Instruments' Rings (Emilie Gillet, MIT): a resonator (modal bars and bells,
 * sympathetic strings, plucked strings, FM voice, string chords) played as an instrument, up to
 * four notes ringing at once, and as an effect excited by the track's own sound. Its two outputs
 * (odd and even strings) are the left and right. Rings runs at 48 kHz: other rates are corrected.
 */
#include "../bbplug_impl.h"
#include "blocker.h"
#include "rings/dsp/part.h"
#include "rings/dsp/string_synth_part.h"
#include "rings/dsp/strummer.h"
#include <math.h>

using namespace rings;

enum { STRUCTURE, BRIGHTNESS, DAMPING, POSITION, POLYPHONY, VOLUME, TUNE, MIX, NPARAMS };
static const char *names[NPARAMS] = {"Structure", "Brightness", "Damping", "Position", "Polyphony", "Volume", "Tune", "Dry / wet"};

struct Rings : BBPlugin
{
    Part *part;
    StringSynthPart *synth;
    Strummer strummer;
    uint16_t *reverb;
    Blocker<24> blocker;
    PerformanceState ps = {};
    int model;
    bool effect, ensemble, strum = false;
    float rateFix, bend = 0;

    /** Output trim: the models play at about the same loudness as the app's instruments */
    float trim;
    Rings(float sr, int m, bool fx, bool ens, float t) : model(m), effect(fx), ensemble(ens), trim(t)
    {
        reverb = new uint16_t[32768]();
        part = new Part();
        synth = new StringSynthPart();
        part->Init(reverb);
        synth->Init(reverb);
        part->set_model((ResonatorModel)model);
        strummer.Init(0.01f, 48000.f / 24.f);
        rateFix = 12.f * log2f(48000.f / sr);
        ps.internal_exciter = !effect;
        ps.internal_strum = effect;
        ps.internal_note = effect;
        ps.tonic = 0;
        ps.note = 48;
        float init[NPARAMS] = {0.4f, 0.5f, 0.6f, 0.3f, 0.6f, 0.8f, 0.5f, 0.5f};
        setAll(init);
    }
    ~Rings()
    {
        delete part;
        delete synth;
        delete[] reverb;
    }
    int params() override { return effect ? NPARAMS : NPARAMS - 2; }
    const char *paramName(int i) override { return names[i]; }
    int voices() { return values[POLYPHONY] < 0.33f ? 1 : values[POLYPHONY] < 0.66f ? 2 : 4; }
    void apply(int i, float) override
    {
        if (i == POLYPHONY)
        {
            part->set_polyphony(voices());
            synth->set_polyphony(voices());
        }
    }
    void display(int i, char *o, int n) override
    {
        if (i == POLYPHONY) snprintf(o, n, "%d", voices());
        else if (i == VOLUME) snprintf(o, n, "%.1f dB", 20.f * log10f(fmaxf(values[i] * values[i] * 1.6f, 1e-5f)));
        else if (i == MIX) snprintf(o, n, "%.0f%% wet", values[i] * 100);
        else if (i == TUNE) snprintf(o, n, "%+.0f st", bbLin(values[i], -24.f, 24.f));
        else snprintf(o, n, "%.0f%%", values[i] * 100);
    }
    void midi(int s, int d1, int d2) override
    {
        int type = s & 0xf0;
        if (type == 0x90 && d2 > 0)
        {
            ps.note = d1;
            strum = true;
        }
        else if (type == 0xe0) bend = ((d2 << 7 | d1) - 8192) / 8192.f * 2.f;
    }
    void process(const float *il, const float *ir, float *ol, float *orr, int n) override
    {
        blocker.run(il, ir, ol, orr, n, [this](float *inL, float *inR, float *outL, float *outR) {
            Patch patch = {values[STRUCTURE], values[BRIGHTNESS], values[DAMPING], values[POSITION]};
            float in[24], odd[24], even[24];
            for (int k = 0; k < 24; k++) in[k] = effect ? 0.5f * (inL[k] + inR[k]) : 0.f;
            ps.fm = 0;
            if (effect)
            {
                ps.note = 48 + bbLin(values[TUNE], -24.f, 24.f) + rateFix;
                strummer.Process(in, 24, &ps);
                part->Process(ps, patch, in, odd, even, 24);
            }
            else
            {
                float note = ps.note;
                ps.note = note + bend + rateFix;
                ps.strum = strum;
                strum = false;
                if (ensemble) synth->Process(ps, patch, in, odd, even, 24);
                else part->Process(ps, patch, in, odd, even, 24);
                ps.note = note;
            }
            // Its outputs are odd and even strings (or modes): mostly one each side, not hard apart
            float g = values[VOLUME] * values[VOLUME] * 1.6f * trim;
            float wet = effect ? values[MIX] : 1.f;
            for (int k = 0; k < 24; k++)
            {
                outL[k] = (0.7f * odd[k] + 0.3f * even[k]) * g * wet + (effect ? inL[k] * (1.f - wet) : 0.f);
                outR[k] = (0.3f * odd[k] + 0.7f * even[k]) * g * wet + (effect ? inR[k] * (1.f - wet) : 0.f);
            }
        });
    }
};

static BBPlugin *modal(float sr) { return new Rings(sr, RESONATOR_MODEL_MODAL, false, false, 3.0f); }
static BBPlugin *sympathetic(float sr) { return new Rings(sr, RESONATOR_MODEL_SYMPATHETIC_STRING, false, false, 4.0f); }
static BBPlugin *pluckedString(float sr) { return new Rings(sr, RESONATOR_MODEL_STRING, false, false, 4.5f); }
static BBPlugin *fm(float sr) { return new Rings(sr, RESONATOR_MODEL_FM_VOICE, false, false, 3.0f); }
static BBPlugin *chords(float sr) { return new Rings(sr, RESONATOR_MODEL_SYMPATHETIC_STRING_QUANTIZED, false, false, 4.5f); }
static BBPlugin *stringverb(float sr) { return new Rings(sr, RESONATOR_MODEL_STRING_AND_REVERB, false, false, 1.2f); }
static BBPlugin *ensemble(float sr) { return new Rings(sr, 0, false, true, 2.5f); }
static BBPlugin *fxModal(float sr) { return new Rings(sr, RESONATOR_MODEL_MODAL, true, false, 3.0f); }
static BBPlugin *fxString(float sr) { return new Rings(sr, RESONATOR_MODEL_SYMPATHETIC_STRING, true, false, 1.0f); }

extern const BBDef ringsDefs[] = {
    {"Resonator Bells", "Physical", "A modal resonator struck by each note: bars, bells, glass and wood (Structure sets the material).", 1, modal},
    {"Sympathetic Strings", "Physical", "Strings that ring along with each note, like a sitar's or a piano's with the pedal down.", 1, sympathetic},
    {"Resonant String", "Physical", "A plucked string model with body and decay.", 1, pluckedString},
    {"Resonator FM", "Physical", "An FM voice played like a resonator: metallic, gong-like tones.", 1, fm},
    {"String Chords", "Physical", "Sympathetic strings tuned to a chord (Structure picks it).", 1, chords},
    {"String and Reverb", "Physical", "A plucked string straight into a lush reverb.", 1, stringverb},
    {"Ensemble Chords", "Synth", "A string-ensemble chord synth with formant filter and reverb.", 1, ensemble},
    {"Resonator", "Effects", "The track's sound rings a tuned modal resonator, like hitting a bell with it.", 0, fxModal},
    {"Sympathetic Resonator", "Effects", "The track's sound makes a bank of tuned strings ring along.", 0, fxString},
};
extern const int ringsCount = sizeof(ringsDefs) / sizeof(ringsDefs[0]);
