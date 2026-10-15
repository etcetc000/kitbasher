# # - *ੈ✩‧₊˚murdenihcam USR machines˖⁺‧₊˚✧ - 
These are USR machines released for the [MDX X20 firmware](https://github.com/jmamma/MDX). 
- Discussion thread here: [Custom USR Machines for X.20](https://www.elektronauts.com/t/custom-usr-machines-for-x-20/257233). 
- Here's an MD/MnM community discord that I use to discuss this (see diy-machines) https://discord.gg/HNtQsSmkf
---

**important disclaimers**:
- I have tested these new machines a bunch already and tweaked them but it should of course go without saying, as Justin mentions in the release of X.20B, that you install third-party machines at your own risk. Back up your machine before doing any of this, including upgrading the firmware. That said, all of this appears to be running very smoothly on the UW+ MKII. 
- This is a project that is entirely conducted with LLM support for the coding. Development proceeded with lots of testing and iteration to tune the results.
- Finally, I’m not affiliated with the development of MDX in any way, just a member of the community who is very excited about the possibilities of this firmware! 

# **machine descriptions:**

1. SMP-SL[ICE] 
2. SMP-ST[RETCH]

## 1. SMP-SL[ICE]

3 versions: SMP-SL (slicing samples from ROM and E12 banks), SMP-SM (ROM bank), and SMP-SN (E12 bank).

**what it is**
A transient-detecting sample slicer and looper for the Machinedrum, compatible with the [X.20 firmware](https://github.com/jmamma/MDX) . This is most fun with longer samples but you can also get interesting textural results with shorter ones. the magic comes with plocking the SLNO parameter (slice number!) Not sure how useful this is on just E12. I have a version somewhere that does things like equal and random slices, let me know if you want that.

**NOTE:** Infinite decay/timestretch continues when changing to a new pattern. This can be stopped when the same track receives a new trig. Note as well that until a new trig comes in the new pattern, the repeating sound from the previous pattern will take on the LEV of the new track (keeping them the same will not cause any level changes when switching patterns).

**parameters**:\
**PTCH** - half a semitone per step (±32 semitones). It changes speed as well. This interacts with TIME in interesting ways.

**SMPL** - Which sample: 1–48 are the UW ROM slots, E1–E21 the internal samples. Takes effect at the next trig.

**DEC -** 0: plays the slice once at full level. 1–126: decay from about 0.03 s to 30 s, with the slice looping in the PLAY direction while it’s audible. 127: no decay, loops forever.

**TIME** - 0: normal playback. Above 0, slows the slice down without changing pitch, using a timestretching algorithm. 42: half speed. After 50% turn, grain sizes get smaller127: frozen in place (infinite repeat). DEC at 0 means no amp envelope on the time, decay at higher levels, there is.

**PLAY** - Direction of playback. FWD: forwards. REV: backwards. BI: turns round at each end of the slice. When DEC loops, it’s checked at every loop, so you can change it while a slice is held.

**THRS** - Threshold for transient slicing to occur. higher means fewer slices made.

**SLIC** - Number of slices across the whole sample. Takes effect at the next trig.

**SLNO** - Which slice plays. Values above SLIC wrap round (for example SLNO 10 with 8 slices plays slice 2). Takes effect at the next trig

---


## 2. SMP-ST[RETCH]

3 versions: SMP-ST (stretching samples from ROM and E12 banks), SMP-SR (ROM bank), and SMP-S2 (E12 bank).

**what it is**
A custom sample timestretching machine for the Elektron Machinedrum, compatible with the [X.20 firmware](https://github.com/jmamma/MDX). I wanted to make an homage to the Ableton texture warp mode: that gritty, Akai S950 kind of timestretch sound. This machine is focused on the textural exploration of slowing down the sample and altering the grain size and flux (jitter of grains). There are **3 versions depending on compatibility and/or your preferred use case (see dl links below):** one that addreses samples in UW ROM and E12, one for just the UW ROM, and one that just looks at *internal* E12 samples (the latter being compatible with all models). 

**NOTE:** Infinite decay/timestretch continues when changing to a new pattern. This can be stopped when the same track receives a new trig. Note as well that until a new trig comes in the new pattern, the repeating sound from the previous pattern will take on the LEV of the new track (keeping them the same will not cause any level changes when switching patterns).

**parameters**
Here you get a SMPL knob for selecting the respective sample slot to address (plockable of course) -- another side benefit of this is you don't have to dig thru ROM/E12 to find your sample, a DECay, the TIME knob, which starts at no stretch and increases to infinite freeeeeeeeeeze. GRAN and FLUX are designed to work like ableton's texture warp, and unlike in Ableton, we can actually modulate these params!!! have fun sssttrrreeeetttttccccchhhhiiiiiiiiiiiinnnnnggggggggg :)