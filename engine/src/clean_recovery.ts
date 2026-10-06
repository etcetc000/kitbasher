// --clean-recovery: the overload policy applied whatever models are selected. It turns on the
// ordered DSP1 overrun handler (recover.ts) and adds three helpers around the base's own code --
// output-owned pacing on DSP1 (dsp1pace.ts, outputpace.ts), a paced output clear (clearpace.ts), and
// DSP2 block-boundary retirement that sheds voices when rendering falls behind the codec clock
// (retire.ts). No model code is replaced.
import {records} from './dsp.js';
import {wordsLE} from './bytes.js';
import {outputPaceRoutine} from './outputpace.js';
import {PACE_SITE,PACE_BASE,paceRecords} from './dsp1pace.js';
import {CLEAR_SITE,CLEAR_BASE,CLEAR_AT,CLEAR_HOOK,CLEAR_WORDS} from './clearpace.js';
import {retireRoutine,RETIRE_SITE,RETIRE_BASE} from './retire.js';
import type {Features,Selection} from './plan.js';
import type {Firmware} from './container.js';
import type {Base} from './bases.js';

/** The fixes the browser patcher applies by default. Other combinations remain available as explicit options. */
export function currentFirmwareFixes(): Pick<Selection,'ctrControlAll'|'features'> {
  return {ctrControlAll:true,features:{cleanRecovery:true,hostReorder:false}};
}

/** Expand --clean-recovery into the recovery options it implies; throws on a conflicting option. */
export function recoveryFeatures(f: Features = {}): Features {
  if(!f.cleanRecovery)return f;
  if(f.dsp1Recover===false || f.dsp1Realign || f.dsp1Diag ||
     (f.dsp1RecoverVariant!==undefined && f.dsp1RecoverVariant!=='ordered'))
    throw new Error('Clean recovery requires ordered recovery without codec realignment or diagnostic display');
  return {...f,dsp1Recover:true,dsp1Realign:false,dsp1RecoverVariant:'ordered',cpuIndicator:f.cpuIndicator??true};
}
/** A DSP upload's memory in one space (0 P, 1 X, 2 Y) as the loader leaves it. */
export function memory(words:number[],space=0):Map<number,number> {
  const m=new Map<number,number>();
  for(const r of records(words).recs)if(r.tag===space)
    for(let i=0;i<r.count;i++)m.set(r.addr+i,words[r.index+3+i]);
  return m;
}
export const cleanDsp1Records=()=>[
  ...paceRecords(outputPaceRoutine()),
  {space:0,addr:CLEAR_AT,words:CLEAR_WORDS},
  {space:0,addr:CLEAR_SITE,words:CLEAR_HOOK},
];
export const cleanDsp1Sites=()=>[PACE_SITE,PACE_SITE+1,...CLEAR_HOOK.map((_,i)=>CLEAR_SITE+i)];

/** Every reason the helpers cannot go into this base: an anchor that differs from stock, or a helper
 *  address the base already loads. Unknown firmware is refused rather than guessed at. */
export function cleanBaseProblems(fw:Firmware,base:Base):string[] {
  const why:string[]=[],d1=wordsLE(fw.slots[2].raw),d2=wordsLE(fw.slots[1].raw);
  const r1=records(d1).recs,r2=records(d2).recs,rt=retireRoutine(),pace=outputPaceRoutine();
  // Preview needs a few anchor words and occupied spans, not maps of every DSP word.
  // Inspect current bytes every time, retaining last-write-wins upload semantics.
  const wordAt=(words:number[],recs:typeof r1,at:number):number|undefined=>{
    let value:number|undefined;
    for(const r of recs)if(r.tag===0 && r.addr<=at && at<r.addr+r.count)
      value=words[r.index+3+at-r.addr];
    return value;
  };
  for(const [words,recs,at,expected] of [[d1,r1,PACE_SITE,PACE_BASE],[d1,r1,CLEAR_SITE,CLEAR_BASE],[d2,r2,RETIRE_SITE,RETIRE_BASE]] as const)
    if(expected.some((v,i)=>wordAt(words,recs,at+i)!==v))why.push(`Clean recovery: unsupported stock anchor at P:$${at.toString(16)}`);
  for(const [recs,at,n] of [[r1,pace.at,pace.words.length],
      [r1,CLEAR_AT,CLEAR_WORDS.length],[r2,rt.at,rt.words.length]] as const)
    for(const space of [0,1,2]) {
      if(recs.some(r=>r.tag===space && r.count>0 && r.addr<at+n && r.addr+r.count>at))
        why.push(`Clean recovery: helper at $${at.toString(16)} overlaps loaded ${'PXY'[space]} memory`);
    }
  if(!base.dsp2.freeRegions.some(([a,b])=>rt.at>=a&&rt.at+rt.words.length<=b))
    why.push('Clean recovery: DSP2 helper is outside discovered free memory');
  return why;
}
/** Free DSP2 regions with the retirement helper's words cut out, so no model is placed over it. */
export function reserveRecovery(regions:[number,number][]):[number,number][] {
  const r=retireRoutine(),lo=r.at,hi=lo+r.words.length;
  return regions.flatMap(([a,b]):[number,number][]=>b<=lo||a>=hi?[[a,b]]:
    [...(a<lo?[[a,lo] as [number,number]]:[]),...(b>hi?[[hi,b] as [number,number]]:[])]);
}
/** Replace the three stock words at the retirement hook in place (no overlapping record is added)
 *  and append the helper as a new record before the upload's entry record. With
 *  `matchingOverlays`, a hook that a later record repeats is patched in every copy. */
export function patchRetirement(input:number[],matchingOverlays=false):number[] {
  const output=input.slice(),rt=retireRoutine(),rs=records(output).recs;
  RETIRE_BASE.forEach((v,i)=>{
    const at=RETIRE_SITE+i,matches=rs.filter(r=>r.tag===0&&r.addr<=at&&at<r.addr+r.count);
    if(!matches.length || (!matchingOverlays && matches.length!==1))throw new Error('Ambiguous retirement hook');
    // X.13 and X.14 load this region again in a later record. Every copy must hold the
    // stock instructions, and the caller enables this only for bases known to do so.
    for(const r of matches) {
      const pos=r.index+3+at-r.addr;
      if(output[pos]!==v)throw new Error('Retirement stock anchor changed');
      output[pos]=rt.hook[i];
    }
  });
  const {entryAt}=records(output);
  return [...output.slice(0,entryAt),0,rt.at,rt.words.length,...rt.words,...output.slice(entryAt)];
}
/** Gate: read every helper word and hook back from the built uploads. */
export function checkCleanRecovery(dsp1:number[],dsp2:number[]):{ok:boolean;detail:string} {
  const p1=memory(dsp1),p2=memory(dsp2),r=retireRoutine(),errors:string[]=[];
  for(const rec of cleanDsp1Records())if(rec.words.some((v,i)=>p1.get(rec.addr+i)!==v))errors.push(`DSP1 $${rec.addr.toString(16)}`);
  for(const [at,words] of [[RETIRE_SITE,r.hook],[r.at,r.words]] as const)
    if(words.some((v,i)=>p2.get(at+i)!==v))errors.push(`DSP2 $${at.toString(16)}`);
  return {ok:!errors.length,detail:errors.length?errors.join(', '):
    'Output-owned pacing, paced output clear and codec-clock debt retirement (64 words); exact helper readback; model code unchanged'};
}
