/*
 * The Airwindows effects (via the Airwin Consolidated library, MIT) as a Bo's Beatbox plugin
 * family. Every effect is stereo in, stereo out, with parameters 0 to 1.
 */
#include "../bbplug.h"
#include "AirwinRegistry.h"
#include <string>
#include <vector>

std::vector<AirwinRegistry::awReg> AirwinRegistry::registry;
std::set<std::string> AirwinRegistry::categories;
std::vector<int> AirwinRegistry::fxAlphaOrdering;
std::vector<int> AirwinRegistry::fxChrisOrdering;
std::map<std::string, std::vector<std::string>> AirwinRegistry::fxByCategory;
std::map<std::string, std::vector<std::string>> AirwinRegistry::fxByCategoryChrisOrder;
std::unordered_map<std::string, int> AirwinRegistry::nameToIndex;
std::map<std::string, std::unordered_set<std::string>> AirwinRegistry::namesByCollection;

#include "ModuleAdd.h"

struct Inst
{
    std::unique_ptr<AirwinConsolidatedBase> fx;
    float buf[4][BB_BLOCK];
    char text[kVstMaxParamStrLen * 4];
    int params;
};

static std::string json;
static std::string esc(const std::string &s)
{
    std::string o;
    for (char c : s)
    {
        if (c == '"' || c == '\\') o += '\\';
        if ((unsigned char)c >= 32) o += c;
    }
    return o;
}

BB_EXPORT int bb_count() { return (int)AirwinRegistry::registry.size(); }

BB_EXPORT const char *bb_info(int index)
{
    if (index < 0 || index >= bb_count()) return "";
    auto &r = AirwinRegistry::registry[index];
    std::string tags;
    for (auto &c : r.collections) tags += (tags.empty() ? "\"" : ",\"") + esc(c) + "\"";
    json = "{\"name\":\"" + esc(r.name) + "\",\"category\":\"" + esc(r.category) + "\",\"about\":\"" + esc(r.whatText) +
           "\",\"instrument\":0,\"params\":" + std::to_string(r.nParams) + ",\"order\":" + std::to_string(r.catChrisOrdering) +
           ",\"tags\":[" + tags + "]}";
    return json.c_str();
}

BB_EXPORT int bb_create(int index, float sampleRate)
{
    if (index < 0 || index >= bb_count()) return 0;
    AirwinConsolidatedBase::defaultSampleRate = sampleRate;
    auto *in = new Inst();
    in->fx = AirwinRegistry::registry[index].generator();
    in->fx->setSampleRate(sampleRate);
    in->params = AirwinRegistry::registry[index].nParams;
    memset(in->buf, 0, sizeof(in->buf));
    return (int)(intptr_t)in;
}

BB_EXPORT void bb_destroy(int h) { delete (Inst *)(intptr_t)h; }
BB_EXPORT int bb_params(int h) { return ((Inst *)(intptr_t)h)->params; }
BB_EXPORT float bb_get(int h, int i) { return ((Inst *)(intptr_t)h)->fx->getParameter(i); }
BB_EXPORT void bb_set(int h, int i, float v) { ((Inst *)(intptr_t)h)->fx->setParameter(i, v); }

BB_EXPORT const char *bb_param_name(int h, int i)
{
    auto *in = (Inst *)(intptr_t)h;
    in->text[0] = 0;
    in->fx->getParameterName(i, in->text);
    return in->text;
}

BB_EXPORT const char *bb_param_display(int h, int i)
{
    auto *in = (Inst *)(intptr_t)h;
    char value[kVstMaxParamStrLen * 2] = {0}, label[kVstMaxParamStrLen * 2] = {0};
    in->fx->getParameterDisplay(i, value);
    in->fx->getParameterLabel(i, label);
    std::string v(value);
    while (!v.empty() && v.front() == ' ') v.erase(v.begin());
    if (label[0]) v += std::string(" ") + label;
    strncpy(in->text, v.c_str(), sizeof(in->text) - 1);
    in->text[sizeof(in->text) - 1] = 0;
    return in->text;
}

BB_EXPORT float *bb_buffer(int h, int which) { return ((Inst *)(intptr_t)h)->buf[which & 3]; }

BB_EXPORT void bb_process(int h, int frames)
{
    auto *in = (Inst *)(intptr_t)h;
    float *ins[2] = {in->buf[0], in->buf[1]};
    float *outs[2] = {in->buf[2], in->buf[3]};
    in->fx->processReplacing(ins, outs, frames);
}

BB_EXPORT void bb_midi(int, int, int, int) {}
BB_EXPORT int bb_programs(int) { return 0; }
BB_EXPORT const char *bb_program_name(int, int) { return ""; }
BB_EXPORT void bb_set_program(int, int) {}
BB_EXPORT int bb_get_program(int) { return 0; }
