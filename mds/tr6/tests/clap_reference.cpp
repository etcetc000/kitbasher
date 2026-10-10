// Pinned Simple606 DSP, test-only state access. See LICENSE-Simple606.
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
#include "Clap.hpp"
#undef private
using namespace SynthDrums606;
using namespace SynthDrums606::ClapDetail;

static float ratio(int knob) { return std::pow(2.f,(-12.f+24.f*knob/127.f)/12.f); }
template<class A> static void array(const A& values) {
    std::cout << '['; bool first=true;
    for(auto value:values) { if(!first) std::cout << ','; first=false; std::cout << value; }
    std::cout << ']';
}
static void tables() {
    std::cout << std::setprecision(17) << "{\"colors\":[";
    const std::array<float,192>* colors[]={&kOpeningColor,&kHandoffColor,&kFastColor,&kLateColor};
    for(int i=0;i<4;++i) { if(i) std::cout << ','; array(*colors[i]); }
    std::cout << "],\"reconstruction\":[";
    for(int i=0;i<33;++i) { if(i) std::cout << ','; array(kReconstructionTable.coefficients[i]); }
    std::cout << "],\"pitch\":[";
    for(int i=0;i<128;++i) {
        if(i) std::cout << ',';
        ClapVoice v; v.init(44100); v.trigger(.8f,ratio(i),.5f);
        const float step=std::max(1.f,ratio(i));
        std::cout << "{\"ratio\":" << ratio(i) << ",\"core_step\":" << v.coreStep_
                  << ",\"core_rate\":" << v.core_.sampleRate_ << ",\"color_step\":" << step
                  << ",\"taps\":" << v.core_.colors_.tapCount_ << ",\"scale\":[";
        for(int c=0;c<4;++c) {
            if(c) std::cout << ',';
            double sourceEnergy=0,rawEnergy=0;
            for(float value:*colors[c]) sourceEnergy+=value*value;
            for(size_t tap=0;tap<v.core_.colors_.tapCount_;++tap) {
                const float value=CompressedSpectralCurve<192>::cubicSample(*colors[c],float(tap)*step);
                rawEnergy+=value*value;
            }
            std::cout << (step==1.f ? 1.f : float(std::sqrt(sourceEnergy/std::max(rawEnergy,1.e-20))));
        }
        std::cout << "],\"coefficients\":[";
        array(v.core_.colors_.opening_.coefficients_); std::cout << ',';
        array(v.core_.colors_.handoff_.coefficients_); std::cout << ',';
        array(v.core_.colors_.fast_.coefficients_); std::cout << ',';
        array(v.core_.colors_.late_.coefficients_); std::cout << "]}";
    }
    std::cout << "],\"decay\":[";
    for(int i=0;i<128;++i) { if(i) std::cout << ','; std::cout << std::max(.05f,i/127.f); }
    std::cout << "],\"noise\":[";
    for(int i=0;i<128;++i) {
        if(i) std::cout << ',';
        ClapVoice v; v.init(44100); v.trigger(.8f,1.f,i/127.f);
        std::cout << '[' << v.noiseLayerGain_ << ',' << v.airSpread_ << ']';
    }
    ClapVoice v; v.init(44100); v.trigger(.8f,1.f,.5f);
    std::cout << "],\"duration\":" << v.maximumSamples_
              << ",\"air_hp\":" << v.airHighpassCoefficient_ << "}\n";
}
int main(int argc,char** argv) {
    if(argc==2 && std::string(argv[1])=="--tables") { tables(); return 0; }
    if(argc==6 && std::string(argv[1])=="--probe") {
        ClapVoice v; v.init(44100); v.trigger(std::max(.05f,std::atoi(argv[2])/127.f),ratio(std::atoi(argv[3])),std::atoi(argv[4])/127.f);
        const int count=std::atoi(argv[5]);
        for(int i=0;i<count-1;++i) v.core_.process();
        auto copy=v.core_;
        const auto color=copy.colors_.process(copy.random_.gaussianish());
        const auto raw=v.core_.process();
        std::cout << std::setprecision(17) << "full=" << raw.full << " dry=" << raw.dryBody
                  << " opening=" << color.opening << " handoff=" << color.handoff
                  << " fast=" << color.fast << " late=" << color.late << '\n';
        return 0;
    }
    if(argc!=8) return 2;
    int decay=std::atoi(argv[1]),pitch=std::atoi(argv[2]),noise=std::atoi(argv[3]);
    int samples=std::atoi(argv[4]),repeat=std::atoi(argv[5]),delay=std::atoi(argv[6]);
    ClapVoice v; v.init(44100);
    std::ofstream out(argv[7],std::ios::binary); if(!out) return 3;
    for(int i=0;i<samples;++i) {
        if(i==delay || (repeat>0 && i>delay && (i-delay)%repeat==0))
            v.trigger(std::max(.05f,decay/127.f),ratio(pitch),noise/127.f);
        float value=v.process(); if(!std::isfinite(value)) return 4;
        out.write(reinterpret_cast<const char*>(&value),sizeof(value));
    }
    std::cout << "active=" << v.isActive() << " frame=" << v.sampleIndex_ << " duration=" << v.maximumSamples_
              << " core_frame=" << v.core_.sampleIndex_ << " generated=" << v.upsampler_.generatedSamples_
              << " noise_rng=" << v.core_.random_.state_ << " history_position=" << v.core_.colors_.position_ << '\n';
}
