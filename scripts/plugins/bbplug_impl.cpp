/* The bb_* exports (bbplug.h) over a family's BBPlugin list (bbplug_impl.h). */
#include "bbplug_impl.h"
#include <stdlib.h>
#include <string>

struct BBInst
{
    BBPlugin *p;
    float buf[4][BB_BLOCK];
    char text[160];
};

static std::string json;
static std::string esc(const char *s)
{
    std::string o;
    for (; *s; s++)
    {
        if (*s == '"' || *s == '\\') o += '\\';
        o += *s;
    }
    return o;
}

BB_EXPORT int bb_count() { return bbFamilyCount(); }
BB_EXPORT const char *bb_info(int i)
{
    if (i < 0 || i >= bbFamilyCount()) return "";
    const BBDef &d = bbFamilyDef(i);
    json = std::string("{\"name\":\"") + esc(d.name) + "\",\"category\":\"" + esc(d.category) + "\",\"about\":\"" + esc(d.about) +
           "\",\"instrument\":" + std::to_string(d.instrument) + "}";
    return json.c_str();
}
BB_EXPORT int bb_create(int i, float sr)
{
    if (i < 0 || i >= bbFamilyCount()) return 0;
    BBInst *in = new BBInst();
    memset(in->buf, 0, sizeof(in->buf));
    in->p = bbFamilyDef(i).make(sr);
    if (!in->p)
    {
        delete in;
        return 0;
    }
    return (int)(intptr_t)in;
}
#define IN ((BBInst *)(intptr_t)h)
BB_EXPORT void bb_destroy(int h)
{
    delete IN->p;
    delete IN;
}
BB_EXPORT int bb_params(int h) { return IN->p->params(); }
BB_EXPORT float bb_get(int h, int i) { return i >= 0 && i < BB_MAX_PARAMS ? IN->p->values[i] : 0; }
BB_EXPORT void bb_set(int h, int i, float v) { IN->p->set(i, v); }
BB_EXPORT const char *bb_param_name(int h, int i)
{
    snprintf(IN->text, sizeof(IN->text), "%s", IN->p->paramName(i));
    return IN->text;
}
BB_EXPORT const char *bb_param_display(int h, int i)
{
    IN->text[0] = 0;
    IN->p->display(i, IN->text, sizeof(IN->text));
    return IN->text;
}
BB_EXPORT float *bb_buffer(int h, int w) { return IN->buf[w & 3]; }
BB_EXPORT void bb_process(int h, int frames) { IN->p->process(IN->buf[0], IN->buf[1], IN->buf[2], IN->buf[3], frames); }
BB_EXPORT void bb_midi(int h, int s, int d1, int d2) { IN->p->midi(s, d1, d2); }
BB_EXPORT int bb_programs(int h) { return IN->p->programs(); }
BB_EXPORT const char *bb_program_name(int h, int i)
{
    snprintf(IN->text, sizeof(IN->text), "%s", IN->p->programName(i));
    return IN->text;
}
BB_EXPORT void bb_set_program(int h, int i)
{
    if (i < 0 || i >= IN->p->programs()) return;
    IN->p->program = i;
    IN->p->setProgram(i);
}
BB_EXPORT int bb_get_program(int h) { return IN->p->program; }
BB_EXPORT int bb_alloc(int bytes) { return (int)(intptr_t)malloc(bytes > 0 ? bytes : 1); }
BB_EXPORT void bb_free(int ptr) { free((void *)(intptr_t)ptr); }
BB_EXPORT int bb_load(int h, int ptr, int bytes) { return IN->p->loadData((const void *)(intptr_t)ptr, bytes) ? 1 : 0; }
