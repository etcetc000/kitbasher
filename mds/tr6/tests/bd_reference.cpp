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
        if(frame%rate==0) {
            ampNext=amp*ampPole; clickNext=click*clickPole; impulseNext=impulse*impulsePole;
            if(ampNext<1.e-6f) ampNext=0;
            if(clickNext<1.e-6f) clickNext=0;
            if(impulseNext<1.e-6f) impulseNext=0;
            frequencyNext=target+(frequency-target)*pitchPole;
            ampStep=(ampNext-amp)/rate; clickStep=(clickNext-click)/rate;
            impulseStep=(impulseNext-impulse)/rate; frequencyStep=(frequencyNext-frequency)/rate;
        }
        frequency+=frequencyStep; click+=clickStep; impulse+=impulseStep;
        auto& b=v.bassDrum_;
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
    if (argc != 10 && argc != 12 && argc != 13 && argc != 14 && argc != 15 && argc != 16) return 2;
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
    const bool omitImpulse=argc==16 && std::atoi(argv[15])!=0;
    if(simpleImpulse && omitImpulse) return 2;
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
                noise=x-voice.noise_.lastIn_+.995f*voice.noise_.lastOut_;
                voice.noise_.lastIn_=x; voice.noise_.lastOut_=noise;
            } else noise=voice.noise_.process();
            if(controlRate!=1) controls.prepare(voice);
            value=voice.bassDrum_.process(noise)*SynthDrums606::kVoiceOutputTrim;
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
