/*
 * One Dragonfly reverb as a Fledgetone plugin (included by bb_dragonfly_<kind>.cpp, inside a
 * namespace of its own, with that reverb's DistrhoPluginInfo.h and DSP.cpp). DF_PRESETS says how
 * its presets are kept: 1 banks of presets, 2 one list, 0 none (the early reflections choose a
 * room with their Program parameter).
 */
#if DF_PRESETS == 0
// (The room list, by a name the plugin's own programs() doesn't hide)
static const Program *const earlyPrograms = programs;
#endif

struct Plugin : BBPlugin
{
    DragonflyReverbDSP dsp;
    Plugin(float sr) : dsp(sr)
    {
#if DF_PRESETS == 1
        program = DEFAULT_BANK * PRESETS_PER_BANK + DEFAULT_PRESET;
        setProgram(program);
#elif DF_PRESETS == 2
        program = DEFAULT_PRESET;
        setProgram(program);
#else
        setActual(DEFAULTS);
#endif
    }
    void setActual(const float *v)
    {
        for (int i = 0; i < paramCount; i++)
        {
            float lo = PARAMS[i].range_min, hi = PARAMS[i].range_max;
            set(i, hi > lo ? (v[i] - lo) / (hi - lo) : 0.f);
        }
    }
    bool whole(int i) { return !strcmp(PARAMS[i].symbol, "program") || !strcmp(PARAMS[i].symbol, "algorithm"); }
    float actual(int i)
    {
        float lo = PARAMS[i].range_min, hi = PARAMS[i].range_max, x = lo + (hi - lo) * values[i];
        return whole(i) ? roundf(x) : x;
    }
    int params() override { return paramCount; }
    const char *paramName(int i) override { return PARAMS[i].name; }
    void apply(int i, float) override { dsp.setParameterValue(i, actual(i)); }
    void display(int i, char *o, int n) override
    {
        float x = actual(i);
#if DF_PRESETS == 0
        if (!strcmp(PARAMS[i].symbol, "program"))
        {
            snprintf(o, n, "%s", earlyPrograms[(int)x].name);
            return;
        }
#endif
        if (!strcmp(PARAMS[i].symbol, "algorithm"))
        {
            static const char *kinds[] = {"Plate A", "Plate B", "Tank"};
            snprintf(o, n, "%s", kinds[(int)x < 3 ? (int)x : 2]);
            return;
        }
        snprintf(o, n, fabsf(x) >= 100 || whole(i) ? "%.0f %s" : fabsf(x) >= 10 ? "%.1f %s" : "%.2f %s", x, PARAMS[i].unit);
    }
#if DF_PRESETS == 1
    int programs() override { return NUM_BANKS * PRESETS_PER_BANK; }
    std::string nameBuf;
    const char *programName(int i) override
    {
        nameBuf = std::string(banks[i / PRESETS_PER_BANK].name) + "/" + banks[i / PRESETS_PER_BANK].presets[i % PRESETS_PER_BANK].name;
        return nameBuf.c_str();
    }
    void setProgram(int i) override { setActual(banks[i / PRESETS_PER_BANK].presets[i % PRESETS_PER_BANK].params); }
#elif DF_PRESETS == 2
    int programs() override { return NUM_PRESETS; }
    const char *programName(int i) override { return presets[i].name; }
    void setProgram(int i) override { setActual(presets[i].params); }
#endif
    void process(const float *il, const float *ir, float *ol, float *orr, int n) override
    {
        const float *ins[2] = {il, ir};
        float *outs[2] = {ol, orr};
        dsp.run(ins, outs, n);
    }
};
