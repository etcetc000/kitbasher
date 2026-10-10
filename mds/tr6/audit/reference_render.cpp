// Source-level audit harness. This is not a DSP56303 port or timing benchmark.
#include "BassDrum.hpp"
#include "Snare.hpp"
#include "Toms.hpp"
#include "HiHats.hpp"
#include "Clap.hpp"
#include "cymbal_spec.hpp"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

using namespace SynthDrums606;
constexpr int sampleRate = 44100;

void little(std::ostream& out, uint32_t value, int bytes) {
    for (int i = 0; i < bytes; ++i) out.put(static_cast<char>(value >> (8*i)));
}

void wav(const std::string& path, const std::vector<float>& samples) {
    std::ofstream out(path, std::ios::binary);
    if (!out) throw std::runtime_error("Cannot write " + path);
    // IEEE float preserves the source output, including peaks above unity.
    out.write("RIFF", 4); little(out, 36 + samples.size()*4, 4);
    out.write("WAVEfmt ", 8); little(out, 16, 4); little(out, 3, 2);
    little(out, 1, 2); little(out, sampleRate, 4);
    little(out, sampleRate*4, 4); little(out, 4, 2); little(out, 32, 2);
    out.write("data", 4); little(out, samples.size()*4, 4);
    out.write(reinterpret_cast<const char*>(samples.data()), samples.size()*4);
}

template<class Voice, class Trigger>
void check(const std::string& name, float decay, float ratio,
           bool retrigger, Trigger trigger, const std::string& directory) {
    Voice voice;
    voice.init(sampleRate, 0x606606u);
    trigger(voice, decay, ratio);
    double energy = 0;
    float peak = 0;
    int lastAudible = -1;
    std::vector<float> samples(sampleRate*3);
    for (int i=0; i<static_cast<int>(samples.size()); ++i) {
        if (retrigger && i > 0 && i % 4410 == 0) trigger(voice, decay, ratio);
        float value = voice.process();
        if (!std::isfinite(value)) throw std::runtime_error(name + ": nonfinite sample");
        samples[i] = value;
        peak = std::max(peak, std::fabs(value));
        energy += double(value)*value;
        if (std::fabs(value) > 1e-5f) lastAudible = i;
    }
    if (peak < 1e-6f) throw std::runtime_error(name + ": silent output");
    std::cout << name << ',' << decay << ',' << ratio << ',' << retrigger
              << ',' << peak << ',' << std::sqrt(energy/samples.size())
              << ',' << lastAudible << ',' << voice.isActive() << '\n';
    if (!retrigger && decay == 0.8f && ratio == 1.0f)
        wav(directory + "/" + name + ".wav", samples);
}

int main(int argc, char** argv) {
    if (argc != 2) return 2;
    try {
        std::cout << std::setprecision(9)
                  << "voice,decay,pitch_ratio,retrigger,peak,rms,last_audible_sample,active_at_end\n";
        for (float decay : {0.05f, 0.8f, 1.0f}) {
            for (float ratio : {0.5f, 1.0f, 2.0f}) {
                for (bool retrigger : {false, true}) {
                    auto kick = [](auto& v, float d, float p) {
                        v.trigger(std::pow(0.4f, 0.75f), d*0.45f, 2.22f + 12*std::log2(p), 0);
                    };
                    check<BassDrumVoice>("BD",decay,ratio,retrigger,kick,argv[1]);
                    check<SnareVoice>("SD",decay,ratio,retrigger,
                        [](auto& v,float d,float p){v.trigger(d,p,0.75f,1.0f);},argv[1]);
                    check<TomVoice>("LT",decay,ratio,retrigger,
                        [](auto& v,float d,float p){v.trigger(kLowTomSpec,d,p);},argv[1]);
                    check<TomVoice>("HT",decay,ratio,retrigger,
                        [](auto& v,float d,float p){v.trigger(kHighTomSpec,d,p);},argv[1]);
                    check<MetalHiHatVoice>("CH",decay,ratio,retrigger,
                        [](auto& v,float d,float p){v.trigger(kClosedHatSpec,d,p);},argv[1]);
                    check<MetalHiHatVoice>("OH",decay,ratio,retrigger,
                        [](auto& v,float d,float p){v.trigger(kOpenHatSpec,d,p);},argv[1]);
                    check<MetalHiHatVoice>("CY",decay,ratio,retrigger,
                        [](auto& v,float d,float p){v.trigger(kCymbalSpec,d,p);},argv[1]);
                    check<ClapVoice>("CP",decay,ratio,retrigger,
                        [](auto& v,float d,float p){v.trigger(d,p,0.5f);},argv[1]);
                }
            }
        }
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n'; return 1;
    }
}
