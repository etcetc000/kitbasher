// Pinned Simple606 DSP; test-only state visibility. See LICENSE-Simple606.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <string>
#define private public
#include "Toms.hpp"
#undef private

using namespace SynthDrums606;

static void tables(bool high) {
    const auto& spec = high ? kHighTomSpec : kLowTomSpec;
    TomVoice v; v.init(44100, high ? 0x6062u : 0x6061u);
    std::cout << std::setprecision(17) << "{\"decay\":[";
    for (int i=0; i<128; ++i) {
        v.trigger(spec, std::max(.05f, i/127.f), 1.f);
        // Reproduce the source's float32 lifetime, including weighted modes.
        float main=1.f, lower=1.f; std::array<float,4> upper{{1,1,1,1}};
        int duration=0; bool alive=true;
        while (alive && duration<1000000) {
            main=flushDenormal(main*v.mainPole_);
            lower=flushDenormal(lower*v.lowerModePole_);
            alive=main>kTomSilenceThreshold || spec.lowerModeLevel*lower>kTomSilenceThreshold;
            for (int j=0;j<4;++j) {
                upper[j]=flushDenormal(upper[j]*v.upperModePole_[j]);
                alive=alive || spec.upperModes[j].level*upper[j]>kTomSilenceThreshold;
            }
            ++duration;
        }
        if(alive) std::exit(5);
        if(i) std::cout << ',';
        std::cout << "{\"duration\":" << duration << ",\"main\":" << v.mainPole_
                  << ",\"strike\":" << v.strikePole_ << ",\"lower\":" << v.lowerModePole_
                  << ",\"snap\":" << v.snapPole_ << ",\"burst\":" << v.burstPole_
                  << ",\"tail\":" << v.tailNoisePole_;
        for(int j=0;j<4;++j) std::cout << ",\"upper" << j << "\":" << v.upperModePole_[j];
        std::cout << '}';
    }
    std::cout << "],\"pitch\":[";
    for(int i=0;i<128;++i) {
        float ratio=std::pow(2.f,(-12.f+24.f*i/127.f)/12.f);
        v.trigger(spec,.8f,ratio);
        if(i) std::cout << ',';
        std::cout << "{\"main\":" << v.mainHz_ << ",\"glide\":" << v.mainGlideHz_
                  << ",\"strike\":" << v.strikeHz_ << ",\"lower\":" << v.lowerModeHz_;
        for(int j=0;j<4;++j) std::cout << ",\"upper" << j << "\":" << v.upperModeHz_[j];
        const Biquad* filters[]={&v.lowNoiseHighPass_,&v.lowNoiseLowPass_,
            &v.highNoiseHighPass_,&v.highNoiseLowPass_,&v.tailNoiseHighPass_,&v.tailNoiseLowPass_,
            &v.focusedStrikeHighPass_,&v.focusedStrikeLowPass_};
        std::cout << ",\"filters\":[";
        for(int j=0;j<(high?6:8);++j) {
            if(j) std::cout << ',';
            auto& b=*filters[j];
            std::cout << '[' << b.b0_ << ',' << b.a1_ << ',' << b.a2_ << ']';
        }
        std::cout << "]}";
    }
    std::cout << "],\"rise_poles\":[" << 1.f-v.bodyRiseCoefficient_ << ','
              << 1.f-v.strikeRiseCoefficient_ << ',' << 1.f-v.snapRiseCoefficient_ << ','
              << 1.f-v.noiseRiseCoefficient_ << "],\"glide_pole\":" << v.mainGlidePole_ << "}\n";
}

int main(int argc,char** argv) {
    if(argc==3 && std::string(argv[1])=="--tables") { tables(std::string(argv[2])=="ht"); return 0; }
    if(argc!=8) return 2;
    bool high=std::string(argv[1])=="ht";
    float decay=std::max(.05f,std::atoi(argv[2])/127.f);
    float pitch=std::pow(2.f,(-12.f+24.f*std::atoi(argv[3])/127.f)/12.f);
    int samples=std::atoi(argv[4]),repeat=std::atoi(argv[5]),delay=std::atoi(argv[6]);
    TomVoice voice; voice.init(44100,high?0x6062u:0x6061u);
    std::ofstream out(argv[7],std::ios::binary); if(!out) return 3;
    int frame=0;
    for(int i=0;i<samples;++i) {
        if(i==delay || (repeat>0 && i>delay && (i-delay)%repeat==0)) {
            voice.trigger(high?kHighTomSpec:kLowTomSpec,decay,pitch); frame=0;
        }
        if(voice.isActive()) ++frame;
        float value=voice.process(); if(!std::isfinite(value)) return 4;
        out.write(reinterpret_cast<char*>(&value),sizeof(value));
    }
    std::cout << "active=" << voice.isActive() << " frame=" << frame
              << " low_rng=" << voice.lowNoiseRandom_.state_ << " high_rng=" << voice.highNoiseRandom_.state_
              << " tail_rng=" << voice.tailNoiseRandom_.state_ << '\n';
}
