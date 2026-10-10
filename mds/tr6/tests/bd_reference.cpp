// Run the pinned Simple606 kick, with explicit optional noise/control experiments.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <iomanip>
// Test-only visibility and adapters; the pinned source headers stay unchanged.
#define private public
#include "SynthDrumCommon.hpp"
namespace SynthDrums606 {
static bool bdQuadratic=false;
static bool bdRecursive=false;
static float bdBaseClipPeak=0;
inline float quadraticSoft(float x) {
    x=clampf(x,-2.f,2.f);
    return x*(1.f-.25f*std::fabs(x));
}
inline float bdSoft(float x) {
    if(!bdQuadratic) return std::tanh(x);
    bdBaseClipPeak=std::max(bdBaseClipPeak,std::fabs(x));
    return quadraticSoft(x);
}
struct BDSweep : SweepSine {
    float oscX=0,oscY=0,oscCoefficient=0;
    void trigger(float amplitude,float startHz,float endHz,float ampDecay,float pitchDecay,float phaseOffset=0) {
        SweepSine::trigger(amplitude,startHz,endHz,ampDecay,pitchDecay,phaseOffset);
        oscX=.5f*std::cos(phaseOffset); oscY=.5f*std::sin(phaseOffset); oscCoefficient=0;
    }
    void prepareRecursive(float meanHz) {
        const float next=2.f*std::sin(kPi*meanHz/static_cast<float>(sampleRate_));
        oscX+=.5f*(next-oscCoefficient)*oscY;
        oscCoefficient=next;
    }
    float process() {
        if(!bdRecursive) return SweepSine::process();
        oscX-=oscCoefficient*oscY;
        oscY+=oscCoefficient*oscX;
        const float out=2.f*oscY*amp_;
        amp_*=ampCoef_;
        if(amp_<1.e-6f) amp_=0;
        return out;
    }
};
}
// Optional saturation/oscillator substitutions keep the source filters/envelopes.
#define soft bdSoft
#define SweepSine BDSweep
#include "BassDrum.hpp"
#undef SweepSine
#undef soft
#undef private

float processLeanMix(SynthDrums606::BassDrum& b,float noise) {
    const float body=b.body_.process();
    const float click=noise*b.clickEnv_.process();
    const float mix=body*(.92f+b.drive*.10f)+click*(.06f+b.clickAmount*.90f);
    const float filtered=b.bodyLPF_.process(mix);
    return b.dc_.process(SynthDrums606::bdSoft(filtered*(1.12f+b.drive*.12f))*b.level);
}

struct ControlSteps {
    int rate=1,frame=0;
    float amp=0,click=0,impulse=0,frequency=0,target=0;
    float ampPole=1,clickPole=1,impulsePole=1,pitchPole=1;
    float ampNext=0,clickNext=0,impulseNext=0,frequencyNext=0;
    float ampStep=0,clickStep=0,impulseStep=0,frequencyStep=0;
    void reset(const SynthDrums606::BassDrumVoice& v,int interval) {
        *this=ControlSteps(); rate=interval;
        const auto& b=v.bassDrum_;
        amp=b.body_.amp_; click=b.clickEnv_.value_; impulse=b.impulseEnv_.value_;
        frequency=b.body_.currentHz_; target=b.body_.targetHz_;
        ampPole=std::pow(b.body_.ampCoef_,rate);
        clickPole=std::pow(b.clickEnv_.coef_,rate); impulsePole=std::pow(b.impulseEnv_.coef_,rate);
        pitchPole=std::pow(1-b.body_.pitchCoef_,rate);
    }
    void prepare(SynthDrums606::BassDrumVoice& v) {
        auto& b=v.bassDrum_;
        if(frame%rate==0) {
            ampNext=amp*ampPole; clickNext=click*clickPole; impulseNext=impulse*impulsePole;
            if(ampNext<1.e-6f) ampNext=0;
            if(clickNext<1.e-6f) clickNext=0;
            if(impulseNext<1.e-6f) impulseNext=0;
            frequencyNext=target+(frequency-target)*pitchPole;
            ampStep=(ampNext-amp)/rate; clickStep=(clickNext-click)/rate;
            impulseStep=(impulseNext-impulse)/rate; frequencyStep=(frequencyNext-frequency)/rate;
            if(SynthDrums606::bdRecursive) b.body_.prepareRecursive(.5f*(frequency+frequencyNext+frequencyStep));
        }
        frequency+=frequencyStep; click+=clickStep; impulse+=impulseStep;
        b.body_.currentHz_=frequency; b.body_.pitchCoef_=0;
        b.body_.amp_=std::max(0.f,amp); b.body_.ampCoef_=1;
        b.clickEnv_.value_=std::max(0.f,click); b.clickEnv_.coef_=1;
        b.impulseEnv_.value_=std::max(0.f,impulse); b.impulseEnv_.coef_=1;
    }
    void advance(SynthDrums606::BassDrumVoice& v) {
        amp+=ampStep;
        v.bassDrum_.body_.amp_=std::max(0.f,amp);
    }
    void finish() {
        if(++frame%rate==0) {
            amp=ampNext; click=clickNext; impulse=impulseNext; frequency=frequencyNext;
        }
    }
};

int main(int argc, char** argv) {
    if (argc != 10 && argc != 12 && argc != 13 && argc != 14 && argc != 15 && argc != 16 && argc != 17 && argc != 18 && argc != 19) return 2;
    float trans=std::atoi(argv[1])/127.0f, decay=std::atoi(argv[2])/127.0f;
    float tune=-12+24*std::atoi(argv[3])/127.0f, heat=std::atoi(argv[4])/127.0f;
    bool xl=std::atoi(argv[5])!=0;
    int samples=std::atoi(argv[6]), repeat=std::atoi(argv[7]), delay=std::atoi(argv[8]);
    const bool lcgNoise=argc>=12 && std::atoi(argv[10])!=0;
    const uint32_t requestedSeed=argc>=12 ? static_cast<uint32_t>(std::strtoull(argv[11],nullptr,0)) : 0x606606u;
    const bool heatModulation=argc>=13 && std::atoi(argv[12])!=0;
    const int controlRate=argc>=14 ? std::atoi(argv[13]) : 1;
    if(controlRate!=1 && controlRate!=16 && controlRate!=32) return 2;
    const bool simpleImpulse=argc>=15 && std::atoi(argv[14])!=0;
    const bool omitImpulse=argc>=16 && std::atoi(argv[15])!=0;
    const bool quadraticSaturation=argc>=17 && std::atoi(argv[16])!=0;
    const bool recursiveBody=argc>=18 && std::atoi(argv[17])!=0;
    const bool leanMix=argc==19 && std::atoi(argv[18])!=0;
    if(simpleImpulse && omitImpulse) return 2;
    if(quadraticSaturation && !omitImpulse) return 2;
    if(recursiveBody && (!omitImpulse || controlRate!=32)) return 2;
    if(leanMix && (!recursiveBody || !lcgNoise)) return 2;
    SynthDrums606::bdQuadratic=quadraticSaturation;
    SynthDrums606::bdRecursive=recursiveBody;
    ControlSteps controls;
    const uint32_t seed=requestedSeed ? requestedSeed : 0x606606u;
    uint32_t noiseState=seed&0xffffffu;
    SynthDrums606::BassDrumVoice voice;
    voice.init(44100,seed);
    if(simpleImpulse) {
        const float pole=std::exp(-2.f*SynthDrums606::kPi*1350.f/44100.f);
        auto& f=voice.bassDrum_.impulseHPF_;
        f.b0_=pole; f.b1_=-pole; f.b2_=0; f.a1_=-pole; f.a2_=0;
    }
    if(omitImpulse) {
        auto& f=voice.bassDrum_.impulseHPF_;
        f.b0_=f.b1_=f.b2_=f.a1_=f.a2_=0;
    }
    std::ofstream out(argv[9],std::ios::binary);
    if (!out) return 3;
    uint64_t noiseDraws=0;
    for(int i=0;i<samples;++i) {
        if(heatModulation) heat=((i/96*37)%128)/127.f;
        if(i==delay || (repeat>0 && i>delay && (i-delay)%repeat==0)) {
            voice.trigger(std::pow(trans,.75f),xl?decay:decay*.45f,tune,0);
            if(controlRate!=1) controls.reset(voice,controlRate);
        }
        const bool wasActive=voice.isActive();
        if(wasActive) ++noiseDraws;
        float value=0;
        if(!lcgNoise && controlRate==1) value=voice.process();
        else if(voice.active_) {
            float noise;
            if(lcgNoise) {
                noiseState=(1664525u*noiseState+1013904223u)&0xffffffu;
                const float x=static_cast<float>(noiseState)/8388608.f-1.f;
                if(leanMix) noise=x;
                else {
                    noise=x-voice.noise_.lastIn_+.995f*voice.noise_.lastOut_;
                    voice.noise_.lastIn_=x; voice.noise_.lastOut_=noise;
                }
            } else noise=voice.noise_.process();
            if(controlRate!=1) controls.prepare(voice);
            value=(leanMix ? processLeanMix(voice.bassDrum_,noise) : voice.bassDrum_.process(noise))*SynthDrums606::kVoiceOutputTrim;
            if(controlRate!=1) controls.advance(voice);
            // Preserve BassDrumVoice's activity/tail policy with the changed noise.
            if(voice.bassDrum_.isActive()) voice.silenceFrames_=0;
            else if(std::fabs(value)<1.e-5f) {
                if(++voice.silenceFrames_>=32) voice.active_=false;
            } else voice.silenceFrames_=0;
            if(controlRate!=1) controls.finish();
        }
        if(wasActive && !voice.isActive()) std::cout << "idle_at=" << i << ' ';
        if(heat>.001f) {
            float gain=1+heat*3.5f;
            value=(quadraticSaturation ? SynthDrums606::quadraticSoft(value*gain) : std::tanh(value*gain))/std::sqrt(gain);
        }
        if(!std::isfinite(value)) return 4;
        out.write(reinterpret_cast<char*>(&value),sizeof(value));
    }
    std::cout << std::setprecision(10) << "active_at_end=" << voice.isActive()
              << " frequency=" << voice.bassDrum_.body_.currentHz_
              << " target=" << voice.bassDrum_.body_.targetHz_
              << (recursiveBody ? " initial_phase=" : " phase=") << voice.bassDrum_.body_.phase_
              << " amplitude=" << voice.bassDrum_.body_.amp_
              << " noise_draws=" << noiseDraws << '\n';
    if(quadraticSaturation) std::cout << "base_clip_input_peak=" << SynthDrums606::bdBaseClipPeak << '\n';
    if(recursiveBody) std::cout << "oscillator_x=" << voice.bassDrum_.body_.oscX
                               << " oscillator_y=" << voice.bassDrum_.body_.oscY
                               << " oscillator_coefficient=" << voice.bassDrum_.body_.oscCoefficient << '\n';
}
