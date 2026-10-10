// Run the unmodified pinned Simple606 kick, with its plugin knob mappings.
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
    if (argc != 10) return 2;
    float trans=std::atoi(argv[1])/127.0f, decay=std::atoi(argv[2])/127.0f;
    float tune=-12+24*std::atoi(argv[3])/127.0f, heat=std::atoi(argv[4])/127.0f;
    bool xl=std::atoi(argv[5])!=0;
    int samples=std::atoi(argv[6]), repeat=std::atoi(argv[7]), delay=std::atoi(argv[8]);
    SynthDrums606::BassDrumVoice voice;
    voice.init(44100,0x606606u);
    std::ofstream out(argv[9],std::ios::binary);
    if (!out) return 3;
    for(int i=0;i<samples;++i) {
        if(i==delay || (repeat>0 && i>delay && (i-delay)%repeat==0))
            voice.trigger(std::pow(trans,.75f),xl?decay:decay*.45f,tune,0);
        float value=voice.process();
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
              << " amplitude=" << voice.bassDrum_.body_.amp_ << '\n';
}
