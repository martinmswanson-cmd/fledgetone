/* The Mutable Instruments family: every module's plugins, in one list. */
#include "../bbplug_impl.h"

extern const BBDef plaitsDefs[], ringsDefs[], elementsDefs[], cloudsDefs[], braidsDefs[];
extern const int plaitsCount, ringsCount, elementsCount, cloudsCount, braidsCount;

struct List
{
    const BBDef *defs;
    const int *count;
};
static const List lists[] = {{plaitsDefs, &plaitsCount}, {ringsDefs, &ringsCount}, {elementsDefs, &elementsCount}, {cloudsDefs, &cloudsCount}, {braidsDefs, &braidsCount}};

int bbFamilyCount()
{
    int n = 0;
    for (const List &l : lists) n += *l.count;
    return n;
}
const BBDef &bbFamilyDef(int i)
{
    for (const List &l : lists)
    {
        if (i < *l.count) return l.defs[i];
        i -= *l.count;
    }
    return lists[0].defs[0];
}
