"""Build the DSP56300 instruction encoder (build/assembly/asm56.exe) from dsp56300 sources.

    python packs/build_assembler.py --dsp-source /path/to/dsp56300/source [--cxx g++]

Needs a C++20 compiler. Only the assembler files of dsp56300 are compiled, not the emulator.
"""
import argparse
import os
from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parents[1]
def main():
    ap=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dsp-source',type=Path,required=True,help='the dsp56300 source directory that contains dsp56kEmu/')
    ap.add_argument('--cxx',default=os.environ.get('CXX','g++'),help='C++20 compiler (default: $CXX or g++)')
    a=ap.parse_args(); out=ROOT/'build/assembly'; out.mkdir(parents=True,exist_ok=True)
    cmd=[a.cxx,'-std=c++20','-O1','-ffunction-sections','-fdata-sections','-DNDEBUG','-I',str(a.dsp_source),str(ROOT/'packs/asm56.cpp')]
    cmd += [str(a.dsp_source/'dsp56kEmu'/n) for n in ('assembler.cpp','disasm.cpp','opcodes.cpp','registers.cpp')]
    cmd += ['-Wl,--gc-sections','-o',str(out/'asm56.exe')]
    subprocess.run(cmd,check=True)
if __name__=='__main__': main()
