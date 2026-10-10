// Pinned Simple606 DSP, test-only state access. See LICENSE-Simple606.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <string>
#include <vector>
#define private public
#include "HiHats.hpp"
#undef private
#include "cymbal_spec.hpp"
using namespace SynthDrums606;

static const HiHatSpec& spec(const std::string& kind,int count=47,bool noWobble=false) {
    static HiHatSpec selected;
    static std::vector<Partial> partials;
    selected=kind=="ch" ? kClosedHatSpec : kind=="oh" ? kOpenHatSpec : kCymbalSpec;
    std::vector<int> indices;
    for(int i=0;i<selected.partialCount;++i) indices.push_back(i);
    std::stable_sort(indices.begin(),indices.end(),[](int a,int b){
        return selected.partials[a].amplitude>selected.partials[b].amplitude;
    });
    indices.resize(count); std::sort(indices.begin(),indices.end());
    partials.clear();
    for(int i:indices) partials.push_back(selected.partials[i]);
    selected.partials=partials.data(); selected.partialCount=count;
    if(noWobble) selected.lineWobbleDepth=0;
    return selected;
}
static uint32_t seed(const std::string& kind) {
    return kind=="ch" ? 0x606606u : kind=="oh" ? 0x606607u : 0x606608u;
}
static float ratio(int knob) { return std::pow(2.f,(-12.f+24.f*knob/127.f)/12.f); }

static void tables(const std::string& kind,int count=47,bool noWobble=false) {
    const auto& s=spec(kind,count,noWobble); MetalHiHatVoice v; v.init(44100,seed(kind));
    std::cout << std::setprecision(17) << "{\"decay\":[";
    for(int i=0;i<128;++i) {
        v.trigger(s,std::max(.05f,i/127.f),1.f);
        if(i) std::cout << ',';
        std::cout << "{\"duration\":" << v.naturalFrameCount_ << ",\"fade\":" << v.gateFadeFrames_
                  << ",\"inverse\":" << v.inverseGateFadeFrames_ << ",\"fast\":" << v.fastDecayCoefficient_
                  << ",\"slow\":" << v.slowDecayCoefficient_ << '}';
    }
    std::cout << "],\"pitch\":[";
    for(int i=0;i<128;++i) {
        v.trigger(s,.8f,ratio(i));
        if(i) std::cout << ',';
        std::cout << "{\"ratio\":" << ratio(i) << ",\"filters\":[["
                  << v.noiseHighPass_.b0_ << ',' << v.noiseHighPass_.a1_ << ',' << v.noiseHighPass_.a2_
                  << "],[" << v.noiseLowPass_.b0_ << ',' << v.noiseLowPass_.a1_ << ',' << v.noiseLowPass_.a2_ << "]]}";
    }
    std::cout << "],\"partials\":[";
    for(int i=0;i<s.partialCount;++i) {
        if(i) std::cout << ',';
        std::cout << '[' << s.partials[i].frequencyHz << ',' << s.partials[i].amplitude << ',' << s.partials[i].bell << ']';
    }
    std::cout << "],\"attack\":" << v.attackCoefficient_ << ",\"bell\":" << v.bellAccentCoefficient_
              << ",\"click\":" << v.clickCoefficient_ << ",\"wobble_alpha\":" << v.wobbleAlpha_
              << ",\"wobble_drive\":" << v.wobbleDrive_ << ",\"bell_amount\":" << s.bellAccentAmount
              << ",\"click_amount\":" << s.clickAmount << ",\"fast_weight\":" << s.envelopeFastWeight
              << ",\"tonal_mix\":" << s.tonalMix << ",\"noise_mix\":" << s.noiseMix
              << ",\"drive\":" << s.saturationDrive << ",\"trim\":" << s.outputTrim << "}\n";
}

int main(int argc,char** argv) {
    if(argc==3 && std::string(argv[1])=="--tables") { tables(argv[2]); return 0; }
    if(argc==5 && std::string(argv[1])=="--tables") {
        int count=std::atoi(argv[3]); if(count!=3 && count!=6 && count!=47) return 2;
        tables(argv[2],count,std::atoi(argv[4])!=0); return 0;
    }
    if(argc!=8 && argc!=10 && argc!=11) return 2;
    int count=argc>=10 ? std::atoi(argv[8]) : 47;
    if(count!=3 && count!=6 && count!=47) return 2;
    const auto& selected=spec(argv[1],count,argc>=10 && std::atoi(argv[9])!=0);
    std::string kind=argv[1]; int decay=std::atoi(argv[2]),pitch=std::atoi(argv[3]);
    int samples=std::atoi(argv[4]),repeat=std::atoi(argv[5]),delay=std::atoi(argv[6]);
    uint32_t rngSeed=seed(kind);
    if(argc==11) {
        char* end=nullptr; auto value=std::strtoull(argv[10],&end,0);
        if(!*argv[10] || *end || value>0xffffffffULL) return 2;
        rngSeed=static_cast<uint32_t>(value);
    }
    MetalHiHatVoice v; v.init(44100,rngSeed);
    std::ofstream out(argv[7],std::ios::binary); if(!out) return 3;
    for(int i=0;i<samples;++i) {
        if(i==delay || (repeat>0 && i>delay && (i-delay)%repeat==0))
            v.trigger(selected,std::max(.05f,decay/127.f),ratio(pitch));
        float value=v.process(); if(!std::isfinite(value)) return 4;
        out.write(reinterpret_cast<const char*>(&value),sizeof(value));
    }
    std::cout << "active=" << v.isActive() << " frame=" << v.frameIndex_ << " duration=" << v.naturalFrameCount_
              << " phase_rng=" << v.phaseRandom_.state_ << " wobble_rng=" << v.wobbleRandom_.state_
              << " noise_rng=" << v.noise_.rng_.state_ << '\n';
}
