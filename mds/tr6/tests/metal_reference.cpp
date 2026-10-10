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
static bool cubicSaturation=false;
static uint64_t curveClamps=0;
static float tr6Saturate(float value) {
    if(!cubicSaturation) return std::tanh(value);
    if(value < -1.f || value > 1.f) ++curveClamps;
    const float x=std::max(-1.f,std::min(1.f,value));
    return x-.25f*x*x*x;
}
#define private public
// Generated from the pinned header by replacing only its saturation call.
#include "tr6_hihats.hpp"
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

// The optional LCG model changes only the input to the existing WhiteNoise
// filter. Invert xorshift so the original process() consumes the desired value.
static uint32_t undoLeft(uint32_t value,int shift) {
    uint32_t x=value; for(int i=0;i<32;i+=shift) x=value^(x<<shift); return x;
}
static uint32_t undoRight(uint32_t value,int shift) {
    uint32_t x=value; for(int i=0;i<32;i+=shift) x=value^(x>>shift); return x;
}
static uint32_t beforeNext(uint32_t value) {
    return undoLeft(undoRight(undoLeft(value,5),17),13);
}

// Independent floating-point model of control-rate envelopes. The original
// voice still renders oscillators, noise, filters, gate, saturation and output.
struct EnvelopeSteps {
    int rate=1, frame=0;
    float fast=1,slow=1,attack=1,envelope=0,bell=1,click=1;
    float fastPole=1,slowPole=1,attackPole=1,bellPole=1,clickPole=1,weight=1;
    float envelopeStep=0,bellStep=0,clickStep=0;
    void reset(const MetalHiHatVoice& v,int stride) {
        *this=EnvelopeSteps(); rate=stride;
        fastPole=std::pow(v.fastDecayCoefficient_,rate);
        slowPole=std::pow(v.slowDecayCoefficient_,rate);
        attackPole=std::pow(1.f-v.attackCoefficient_,rate);
        bellPole=std::pow(v.bellAccentCoefficient_,rate);
        clickPole=std::pow(v.clickCoefficient_,rate);
        weight=v.fastEnvelopeWeight_;
    }
    void prepare(MetalHiHatVoice& v) {
        if(frame%rate==0) {
            fast*=fastPole; slow*=slowPole; attack*=attackPole;
            envelopeStep=((1.f-attack)*(weight*fast+(1.f-weight)*slow)-envelope)/rate;
            bellStep=(bell*bellPole-bell)/rate;
            clickStep=(click*clickPole-click)/rate;
        }
        envelope+=envelopeStep;
        v.attackEnvelope_=1; v.attackCoefficient_=0;
        v.fastEnvelope_=envelope; v.slowEnvelope_=0; v.fastEnvelopeWeight_=1;
        v.fastDecayCoefficient_=1; v.slowDecayCoefficient_=1;
        v.bellAccentEnvelope_=bell; v.bellAccentCoefficient_=1;
        v.clickEnvelope_=click; v.clickCoefficient_=1;
        bell+=bellStep; click+=clickStep; ++frame;
    }
};

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
    if(argc!=8 && argc!=10 && argc!=11 && argc!=12 && argc!=13 && argc!=14 && argc!=15 && argc!=16) return 2;
    int count=argc>=10 ? std::atoi(argv[8]) : 47;
    if(count!=3 && count!=6 && count!=47) return 2;
    auto selected=spec(argv[1],count,argc>=10 && std::atoi(argv[9])!=0);
    std::string kind=argv[1]; int decay=std::atoi(argv[2]),pitch=std::atoi(argv[3]);
    int samples=std::atoi(argv[4]),repeat=std::atoi(argv[5]),delay=std::atoi(argv[6]);
    uint32_t rngSeed=seed(kind);
    if(argc>=11) {
        char* end=nullptr; auto value=std::strtoull(argv[10],&end,0);
        if(!*argv[10] || *end || value>0xffffffffULL) return 2;
        rngSeed=static_cast<uint32_t>(value);
    }
    MetalHiHatVoice v; v.init(44100,rngSeed);
    const bool lcgNoise=argc>=12 && std::atoi(argv[11])!=0;
    const int envelopeRate=argc>=13 ? std::atoi(argv[12]) : 1;
    if(envelopeRate!=1 && envelopeRate!=4 && envelopeRate!=8 && envelopeRate!=16) return 2;
    const bool linearSaturation=argc>=14 && std::atoi(argv[13])!=0;
    cubicSaturation=argc>=15 && std::atoi(argv[14])!=0;
    const bool bypassNoiseDC=argc>=16 && std::atoi(argv[15])!=0;
    if(linearSaturation && cubicSaturation) return 2;
    if(linearSaturation) {
        // Independently express drive-only processing through the source's
        // existing bypass path. The separate click/noise term stays unchanged.
        selected.tonalMix*=selected.saturationDrive;
        selected.noiseMix*=selected.saturationDrive;
        selected.saturationDrive=0;
    }
    EnvelopeSteps envelopes;
    uint32_t lcg=((rngSeed ? rngSeed : 0x606606u)^0xA511E9B3u)&0xffffffu;
    std::ofstream out(argv[7],std::ios::binary); if(!out) return 3;
    for(int i=0;i<samples;++i) {
        if(i==delay || (repeat>0 && i>delay && (i-delay)%repeat==0)) {
            v.trigger(selected,std::max(.05f,decay/127.f),ratio(pitch));
            if(envelopeRate!=1) envelopes.reset(v,envelopeRate);
        }
        if(envelopeRate!=1 && v.isActive()) envelopes.prepare(v);
        if(lcgNoise && v.isActive()) {
            lcg=(lcg*1664525u+1013904223u)&0xffffffu;
            v.noise_.rng_.state_=beforeNext(lcg<<8);
            Random verify; verify.state_=v.noise_.rng_.state_;
            if(verify.next()!=(lcg<<8)) return 5;
        }
        // Reset only the optional pre-filter's history so its existing process
        // returns the next raw noise value. RNG draws and the following
        // high/low-pass filters keep their source behavior.
        if(bypassNoiseDC) { v.noise_.lastIn_=0; v.noise_.lastOut_=0; }
        float value=v.process(); if(!std::isfinite(value)) return 4;
        out.write(reinterpret_cast<const char*>(&value),sizeof(value));
    }
    std::cout << "active=" << v.isActive() << " frame=" << v.frameIndex_ << " duration=" << v.naturalFrameCount_
              << " phase_rng=" << v.phaseRandom_.state_ << " wobble_rng=" << v.wobbleRandom_.state_
              << " noise_rng=" << (lcgNoise ? lcg : v.noise_.rng_.state_)
              << " curve_clamps=" << curveClamps << '\n';
}
