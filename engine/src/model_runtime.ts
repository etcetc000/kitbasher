// Component evidence for md-voice/1, independent of a firmware's version label.
// This qualifies the model interface, not the complete firmware or its timing.
import {be32,concat,sha256} from './bytes.js';
import type {Base} from './bases.js';
import type {Firmware} from './container.js';
import {OS_LIMIT} from './container.js';

export interface RuntimeEvidence {
  id:string;
  abi:'md-voice/1';
  dsp2:string;
  sram:string;
  extensions:string;
  evidence:string;
}
export interface RuntimeQualification {
  ok:boolean;
  why:string;
  components:{dsp2:string;sram:string;extensions:string};
  reusedFrom:string|null;
  evidence:string|null;
  sourceSha256:string;
}
export const MODEL_SYMBOLS={md_sine:0x148000,md_output:0x140,md_voice:0x141,md_track:0x142};

export async function runtimeComponents(fw:Firmware,base:Base):Promise<RuntimeQualification['components']> {
  const s=base.boot.sram,offset=s.src-base.os.cfBase;
  if(offset<0 || s.len<=0 || offset+s.len>fw.slots[0].raw.length) throw new Error('Model runtime: invalid SRAM copy');
  // Addresses and lengths are part of the identity: identical bytes relocated to
  // different addresses are not automatically the same runtime interface.
  const segment=(ram:number,bytes:Uint8Array)=>concat([be32(ram),be32(bytes.length),bytes]);
  const [dsp2,sram,extensions]=await Promise.all([
    sha256(fw.slots[1].raw),
    sha256(segment(s.dst,fw.slots[0].raw.subarray(offset,offset+s.len))),
    sha256(concat(base.segments.map(s=>segment(s.ram,s.bytes)))),
  ]);
  return {dsp2,sram,extensions};
}

export async function qualifyModelRuntime(fw:Firmware,base:Base,rules:RuntimeEvidence[]):Promise<RuntimeQualification> {
  const components=await runtimeComponents(fw,base);
  const sourceSha256=await sha256(fw.flash.subarray(0x4000,OS_LIMIT));
  const matching=rules.filter(r=>r.abi==='md-voice/1' && r.dsp2===components.dsp2 &&
    r.sram===components.sram && r.extensions===components.extensions && r.evidence);
  const reasons:string[]=[];
  if(!matching.length) {
    const dspRules=rules.filter(r=>r.abi==='md-voice/1' && r.dsp2===components.dsp2);
    if(!dspRules.length) reasons.push('DSP2 model interface has no matching component evidence');
    else reasons.push('DSP2 matches, but the SRAM or executable extensions need integration verification');
  }
  const d=base.dsp2;
  if(d.dispatch.init!==0x145af5 || d.dispatch.trigger!==0x145bb6 || d.dispatch.render!==0x145c77)
    reasons.push('model dispatch geometry differs from md-voice/1');
  if(d.workspace.base!==0x12d000 || d.workspace.slice!==2048 || d.bankEnd!==0x135206)
    reasons.push('scratch ownership differs from md-voice/1');
  if(!d.bootWrites?.known) reasons.push('DSP2 boot writes could not be bounded');
  const rule=matching[0];
  return {ok:!reasons.length,why:reasons.length?reasons.join('; '):
    `md-voice/1: exact DSP2, SRAM and executable-extension match to ${rule.id}; dispatch and scratch geometry checked`,
    components,reusedFrom:reasons.length?null:rule.id,evidence:reasons.length?null:rule.evidence,sourceSha256};
}
