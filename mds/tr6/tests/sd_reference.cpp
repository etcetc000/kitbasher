// Pinned Simple606 DSP, without the JUCE host. Test-only state visibility.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iostream>
#define private public
#include "Snare.hpp"
#undef private

int main(int argc,char** argv) {
    if(argc!=9) return 2;
    float decay=std::max(.01f,std::atoi(argv[1])/127.f);
    float pitch=std::pow(2.f,(-12.f+24.f*std::atoi(argv[2])/127.f)/12.f);
    float snappy=std::atoi(argv[3])/127.f;
    float color=std::pow(2.f,(-12.f+24.f*std::atoi(argv[4])/127.f)/12.f);
    int samples=std::atoi(argv[5]),repeat=std::atoi(argv[6]),delay=std::atoi(argv[7]);
    SynthDrums606::SnareVoice voice;
    voice.init(44100,0x6063u);
    std::ofstream out(argv[8],std::ios::binary);
    if(!out) return 3;
    for(int i=0;i<samples;++i) {
        if(i==delay || (repeat>0 && i>delay && (i-delay)%repeat==0))
            voice.trigger(decay,pitch,snappy,color);
        float value=voice.process();
        if(!std::isfinite(value)) return 4;
        out.write(reinterpret_cast<char*>(&value),sizeof(value));
    }
    std::cout << "active=" << voice.isActive() << " rng=" << voice.random_.state_
              << " frame=" << voice.frameIndex_ << " duration=" << voice.naturalFrameCount_ << '\n';
}
