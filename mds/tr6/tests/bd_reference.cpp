// Run the pinned Simple606 kick, with explicit optional noise/control experiments.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <iomanip>
// Test-only visibility for comparing oscillator state; DSP code is unchanged.
#define private public
#include "BassDrum.hpp"
#undef private

int main(int argc, char** argv) {
    if (argc != 10 && argc != 12 && argc != 13) return 2;
    float trans=std::atoi(argv[1])/127.0f, decay=std::atoi(argv[2])/127.0f;
    float tune=-12+24*std::atoi(argv[3])/127.0f, heat=std::atoi(argv[4])/127.0f;
    bool xl=std::atoi(argv[5])!=0;
    int samples=std::atoi(argv[6]), repeat=std::atoi(argv[7]), delay=std::atoi(argv[8]);
    const bool lcgNoise=argc>=12 && std::atoi(argv[10])!=0;
    const uint32_t requestedSeed=argc>=12 ? static_cast<uint32_t>(std::strtoull(argv[11],nullptr,0)) : 0x606606u;
    const bool heatModulation=argc==13 && std::atoi(argv[12])!=0;
    const uint32_t seed=requestedSeed ? requestedSeed : 0x606606u;
    uint32_t noiseState=seed&0xffffffu;
    SynthDrums606::BassDrumVoice voice;
    voice.init(44100,seed);
    std::ofstream out(argv[9],std::ios::binary);
    if (!out) return 3;
    uint64_t noiseDraws=0;
    for(int i=0;i<samples;++i) {
        if(heatModulation) heat=((i/96*37)%128)/127.f;
        if(i==delay || (repeat>0 && i>delay && (i-delay)%repeat==0))
            voice.trigger(std::pow(trans,.75f),xl?decay:decay*.45f,tune,0);
        const bool wasActive=voice.isActive();
        if(wasActive) ++noiseDraws;
        float value=0;
        if(!lcgNoise) value=voice.process();
        else if(voice.active_) {
            noiseState=(1664525u*noiseState+1013904223u)&0xffffffu;
            const float x=static_cast<float>(noiseState)/8388608.f-1.f;
            const float noise=x-voice.noise_.lastIn_+.995f*voice.noise_.lastOut_;
            voice.noise_.lastIn_=x; voice.noise_.lastOut_=noise;
            value=voice.bassDrum_.process(noise)*SynthDrums606::kVoiceOutputTrim;
            // Preserve BassDrumVoice's activity/tail policy with the changed noise.
            if(voice.bassDrum_.isActive()) voice.silenceFrames_=0;
            else if(std::fabs(value)<1.e-5f) {
                if(++voice.silenceFrames_>=32) voice.active_=false;
            } else voice.silenceFrames_=0;
        }
        if(wasActive && !voice.isActive()) std::cout << "idle_at=" << i << ' ';
        if(heat>.001f) {
            float gain=1+heat*3.5f;
            value=std::tanh(value*gain)/std::sqrt(gain);
        }
        if(!std::isfinite(value)) return 4;
        out.write(reinterpret_cast<char*>(&value),sizeof(value));
    }
    std::cout << std::setprecision(10) << "active_at_end=" << voice.isActive()
              << " frequency=" << voice.bassDrum_.body_.currentHz_
              << " target=" << voice.bassDrum_.body_.targetHz_
              << " phase=" << voice.bassDrum_.body_.phase_
              << " amplitude=" << voice.bassDrum_.body_.amp_
              << " noise_draws=" << noiseDraws << '\n';
}
