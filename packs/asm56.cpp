// Line encoder for the assembly source importer. The Python front end owns labels/sections.
#include "dsp56kEmu/assembler.h"
#include <iostream>
#include <iomanip>
#include <string>
int main() {
    dsp56k::Assembler assembler;
    std::string line;
    while (std::getline(std::cin, line)) {
        auto r = assembler.assemble(line.c_str());
        if (!r.success()) { std::cout << "ERR " << int(r.error) << " " << line << '\n'; continue; }
        for (unsigned i = 0; i < r.wordCount; ++i)
            std::cout << (i ? " " : "") << std::hex << std::setfill('0') << std::setw(6) << r.word[i];
        std::cout << '\n';
    }
}
