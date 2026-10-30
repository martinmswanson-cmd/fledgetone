/*
 * Surge XT (the Surge Synth Team, GPL-3.0) as a Fledgetone instrument: the whole synth engine,
 * with its factory patches as presets (the host fetches a patch file when one is chosen: see
 * bb_load). Its panel shows the patch's eight macros, the filter and envelope settings and the
 * volume; editing one moves both scenes by the same amount, so layered and split patches follow
 * and a scene set apart from the other in the patch stays set apart. A setting at the patch's own
 * value leaves the patch untouched, so a restored sound plays exactly as the fresh patch does.
 */
#include "../bbplug_impl.h"
#include "SurgeSynthesizer.h"
#include "PatchFileHeaderStructs.h"
#include "sst/basic-blocks/mechanics/endian-ops.h"
namespace mech = sst::basic_blocks::mechanics;
#include <stdlib.h>
#include <memory>
#include <string>

struct Layer : SurgeSynthesizer::PluginLayer
{
    void surgeParameterUpdated(const SurgeSynthesizer::ID &, float) override {}
    void surgeMacroUpdated(long, float) override {}
};

struct SurgeBB : BBPlugin
{
    Layer layer;
    std::unique_ptr<SurgeSynthesizer> synth;
    /** Parameters after the macros: one per scene (both set together) */
    std::vector<std::pair<Parameter *, Parameter *>> params_;
    /** Each one's values (0 to 1) in the patch as loaded: scene A's is the panel's, scene B keeps its offset */
    std::vector<std::pair<float, float>> base_;
    std::vector<std::string> names;
    float outL[BLOCK_SIZE] = {}, outR[BLOCK_SIZE] = {};
    int pos = BLOCK_SIZE;

    SurgeBB(float sr)
    {
        // Surge looks for its user folder under HOME: there is none here (it finds nothing, and
        // plays from its built-in defaults and the patches the host loads)
        setenv("HOME", "/home/surge", 0);
        synth = std::make_unique<SurgeSynthesizer>(&layer, "");
        synth->setSamplerate(sr);
        synth->time_data.tempo = 120;
        synth->time_data.ppqPos = 0;
        build();
    }

    void build()
    {
        auto &patch = synth->storage.getPatch();
        params_.clear();
        base_.clear();
        names.clear();
        for (int i = 0; i < n_customcontrollers; i++)
        {
            std::string label = patch.CustomControllerLabel[i];
            names.push_back(label.empty() || label == "-" ? "Macro " + std::to_string(i + 1) : label);
        }
        auto add = [&](const char *name, Parameter SurgeSceneStorage::*member) {
            names.push_back(name);
            params_.push_back({&(patch.scene[0].*member), &(patch.scene[1].*member)});
        };
        auto addF = [&](const char *name, int unit, Parameter FilterStorage::*member) {
            names.push_back(name);
            params_.push_back({&(patch.scene[0].filterunit[unit].*member), &(patch.scene[1].filterunit[unit].*member)});
        };
        auto addE = [&](const char *name, int env, Parameter ADSRStorage::*member) {
            names.push_back(name);
            params_.push_back({&(patch.scene[0].adsr[env].*member), &(patch.scene[1].adsr[env].*member)});
        };
        addF("Filter 1 cutoff", 0, &FilterStorage::cutoff);
        addF("Filter 1 resonance", 0, &FilterStorage::resonance);
        addF("Filter 1 envelope", 0, &FilterStorage::envmod);
        addF("Filter 2 cutoff", 1, &FilterStorage::cutoff);
        addF("Filter 2 resonance", 1, &FilterStorage::resonance);
        addE("Amp attack", 0, &ADSRStorage::a);
        addE("Amp decay", 0, &ADSRStorage::d);
        addE("Amp sustain", 0, &ADSRStorage::s);
        addE("Amp release", 0, &ADSRStorage::r);
        addE("Filter attack", 1, &ADSRStorage::a);
        addE("Filter decay", 1, &ADSRStorage::d);
        addE("Filter sustain", 1, &ADSRStorage::s);
        addE("Filter release", 1, &ADSRStorage::r);
        add("Portamento", &SurgeSceneStorage::portamento);
        add("Drift", &SurgeSceneStorage::drift);
        names.push_back("Volume");
        params_.push_back({&patch.volume, nullptr});
        for (auto &pp : params_) base_.push_back({pp.first->get_value_f01(), pp.second ? pp.second->get_value_f01() : 0.f});
        readValues();
    }

    /** Macro i's setting (0 to 1): where it's going, not where its smoothing has got to */
    float macro(int i)
    {
        return ((ControllerModulationSource *)synth->storage.getPatch().scene[0].modsources[ms_ctrl1 + i])->get_target01(0);
    }

    void readValues()
    {
        for (int i = 0; i < n_customcontrollers; i++) values[i] = macro(i);
        for (size_t k = 0; k < params_.size(); k++) values[n_customcontrollers + k] = params_[k].first->get_value_f01();
    }

    int params() override { return (int)names.size(); }
    const char *paramName(int i) override { return names[i].c_str(); }
    void apply(int i, float v) override
    {
        // Only what changes is written: writing a setting's own value back can still move the sound
        if (i < n_customcontrollers)
        {
            if (macro(i) != v) synth->setMacroParameter01(i, v);
            return;
        }
        size_t k = i - n_customcontrollers;
        auto &pp = params_[k];
        if (pp.first->get_value_f01() != v) synth->setParameter01(synth->idForParameter(pp.first), v, false, false);
        if (pp.second)
        {
            // Scene B: its own patch value moved as far as scene A was (the same value when they match)
            float b = base_[k].second + (v - base_[k].first);
            b = v == base_[k].first ? base_[k].second : b < 0 ? 0 : b > 1 ? 1 : b;
            if (pp.second->get_value_f01() != b) synth->setParameter01(synth->idForParameter(pp.second), b, false, false);
        }
    }
    void display(int i, char *o, int n) override
    {
        if (i < n_customcontrollers)
        {
            snprintf(o, n, "%.0f%%", values[i] * 100);
            return;
        }
        char txt[TXT_SIZE] = {0};
        synth->getParameterDisplay(synth->idForParameter(params_[i - n_customcontrollers].first), txt);
        snprintf(o, n, "%s", txt);
    }
    void midi(int s, int d1, int d2) override
    {
        int type = s & 0xf0, ch = s & 0x0f;
        if (type == 0x90 && d2 > 0) synth->playNote(ch, d1, d2, 0);
        else if (type == 0x80 || type == 0x90) synth->releaseNote(ch, d1, d2);
        else if (type == 0xe0) synth->pitchBend(ch, (d2 << 7 | d1) - 8192);
        else if (type == 0xb0 && (d1 == 123 || d1 == 120)) synth->allNotesOff();
        else if (type == 0xb0 && d1 == 121)
        {
            // Reset All Controllers: the wheels, pedals and pressure back as a fresh synth has them,
            // and the macros (CC 41 to 48 move them) at their own settings
            synth->pitchBend(ch, 0);
            synth->channelAftertouch(ch, 0);
            for (int cc : {1, 2, 11, 64, 66}) synth->channelController(ch, cc, 0);
            for (int i = 0; i < n_customcontrollers; i++) synth->setMacroParameter01(i, values[i]);
        }
        else if (type == 0xb0) synth->channelController(ch, d1, d2);
        else if (type == 0xd0) synth->channelAftertouch(ch, d1);
    }
    bool loadData(const void *data, int size) override
    {
        // An .fxp file: its header, then the patch
        sst::io::fxChunkSetCustom fxp;
        if (size < (int)sizeof(fxp)) return false;
        memcpy(&fxp, data, sizeof(fxp));
        if (mech::endian_read_int32BE(fxp.chunkMagic) != 'CcnK' || mech::endian_read_int32BE(fxp.fxMagic) != 'FPCh' ||
            mech::endian_read_int32BE(fxp.fxID) != 'cjs3')
            return false;
        int chunk = mech::endian_read_int32BE(fxp.chunkSize);
        if (chunk <= 0 || chunk > size - (int)sizeof(fxp)) return false;
        synth->loadRaw((const char *)data + sizeof(fxp), chunk, true);
        // A patch loads at the next block: run one so its macros and settings can be read
        synth->process();
        build();
        return true;
    }
    void process(const float *, const float *, float *l, float *r, int frames) override
    {
        for (int i = 0; i < frames; i++)
        {
            if (pos >= BLOCK_SIZE)
            {
                synth->process();
                memcpy(outL, synth->output[0], sizeof(outL));
                memcpy(outR, synth->output[1], sizeof(outR));
                pos = 0;
            }
            l[i] = outL[pos];
            r[i] = outR[pos];
            pos++;
        }
    }
};

static BBPlugin *makeSurge(float sr)
{
    try
    {
        return new SurgeBB(sr);
    }
    catch (const std::exception &e)
    {
        fprintf(stderr, "Surge XT couldn't start: %s\n", e.what());
        return nullptr;
    }
}
static const BBDef defs[] = {
    {"Surge XT", "Synth", "A full hybrid synthesizer: wavetable, FM, analog and more, two scenes, deep modulation and effects. Pick one of its 600-odd factory patches from Preset.", 1, makeSurge},
};
BB_FAMILY(defs)
