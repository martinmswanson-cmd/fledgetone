/*
 * Mutable Instruments' Clouds (Emilie Gillet, MIT): a texture synthesizer for the track's
 * sound. Four modes: granular, pitch-shifting time stretch, looping delay and spectral. It was
 * made for 32 kHz: at higher rates its buffer is shorter and its grains quicker.
 */
#include "../bbplug_impl.h"
#include "blocker.h"
#include "clouds/dsp/granular_processor.h"
#include <math.h>

using namespace clouds;

enum { POSITION, SIZE, PITCH, DENSITY, TEXTURE, MIX, SPREAD, FEEDBACK, REVERB, FREEZE, NPARAMS };
static const char *names[NPARAMS] = {"Position", "Size", "Pitch", "Density", "Texture", "Dry / wet", "Stereo spread", "Feedback", "Reverb", "Freeze"};

struct Clouds : BBPlugin
{
    GranularProcessor *proc;
    uint8_t *mem, *ccm;
    Blocker<32> blocker;
    int mode;
    Clouds(float, int m) : mode(m)
    {
        mem = new uint8_t[118784]();
        ccm = new uint8_t[65536 - 128]();
        proc = new GranularProcessor();
        proc->Init(mem, 118784, ccm, 65536 - 128);
        proc->set_playback_mode((PlaybackMode)mode);
        proc->set_quality(0);
        float init[NPARAMS] = {0.3f, 0.5f, 0.5f, 0.6f, 0.5f, 0.5f, 0.5f, 0.2f, 0.4f, 0.f};
        setAll(init);
        proc->Prepare();
    }
    ~Clouds()
    {
        delete proc;
        delete[] mem;
        delete[] ccm;
    }
    int params() override { return NPARAMS; }
    const char *paramName(int i) override { return names[i]; }
    void apply(int, float) override {}
    void display(int i, char *o, int n) override
    {
        if (i == PITCH) snprintf(o, n, "%+.0f st", bbLin(values[i], -24.f, 24.f));
        else if (i == FREEZE) snprintf(o, n, "%s", values[i] >= 0.5f ? "frozen" : "off");
        else snprintf(o, n, "%.0f%%", values[i] * 100);
    }
    void process(const float *il, const float *ir, float *ol, float *orr, int n) override
    {
        blocker.run(il, ir, ol, orr, n, [this](float *inL, float *inR, float *outL, float *outR) {
            Parameters *p = proc->mutable_parameters();
            p->position = values[POSITION];
            p->size = values[SIZE];
            p->pitch = bbLin(values[PITCH], -24.f, 24.f);
            p->density = values[DENSITY];
            p->texture = values[TEXTURE];
            p->dry_wet = values[MIX];
            p->stereo_spread = values[SPREAD];
            p->feedback = values[FEEDBACK];
            p->reverb = values[REVERB];
            p->freeze = values[FREEZE] >= 0.5f;
            p->trigger = false;
            p->gate = false;
            ShortFrame in[32], out[32];
            for (int k = 0; k < 32; k++)
            {
                in[k].l = (short)fmaxf(-32767.f, fminf(32767.f, inL[k] * 32767.f));
                in[k].r = (short)fmaxf(-32767.f, fminf(32767.f, inR[k] * 32767.f));
            }
            proc->Process(in, out, 32);
            proc->Prepare();
            // (Its levels sit about 6 dB under what goes in)
            for (int k = 0; k < 32; k++) outL[k] = out[k].l / 16384.f, outR[k] = out[k].r / 16384.f;
        });
    }
};

static BBPlugin *granular(float sr) { return new Clouds(sr, PLAYBACK_MODE_GRANULAR); }
static BBPlugin *stretch(float sr) { return new Clouds(sr, PLAYBACK_MODE_STRETCH); }
static BBPlugin *looping(float sr) { return new Clouds(sr, PLAYBACK_MODE_LOOPING_DELAY); }
static BBPlugin *spectral(float sr) { return new Clouds(sr, PLAYBACK_MODE_SPECTRAL); }

extern const BBDef cloudsDefs[] = {
    {"Granular Cloud", "Effects", "Granular texture: scatters tiny grains of the sound into clouds, shimmer and smears. Freeze holds it.", 0, granular},
    {"Grain Stretch", "Effects", "Time-stretching pitch shifter: smooth, ghostly re-pitched copies of the sound.", 0, stretch},
    {"Looping Delay", "Effects", "A pitch-shifting looping delay: stutters, tape loops and repeats.", 0, looping},
    {"Spectral Cloud", "Effects", "Spectral processing: blurs, freezes and warps the sound's frequencies into pads.", 0, spectral},
};
extern const int cloudsCount = sizeof(cloudsDefs) / sizeof(cloudsDefs[0]);
