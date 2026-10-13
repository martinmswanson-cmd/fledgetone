// Runs a module's fixed-size blocks under the host's any-size blocks: input is gathered into a
// block, processed, and played back one block later (24 to 32 samples: well under a millisecond).
#pragma once
template <int B>
struct Blocker
{
    float inL[B] = {}, inR[B] = {}, outL[B] = {}, outR[B] = {};
    int pos = 0;
    template <class Render>
    void run(const float *il, const float *ir, float *ol, float *orr, int n, Render render)
    {
        for (int i = 0; i < n; i++)
        {
            inL[pos] = il ? il[i] : 0.f;
            inR[pos] = ir ? ir[i] : 0.f;
            ol[i] = outL[pos];
            orr[i] = outR[pos];
            if (++pos == B)
            {
                render(inL, inR, outL, outR);
                pos = 0;
            }
        }
    }
};
