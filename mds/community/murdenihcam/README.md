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
3. SMP-GR[ANULATOR]
4. NFX-MO[DULATOR

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

## 3. SMP-GR[ANULATOR]

**what it is**
An experimental granulator machine for the Elektron Machinedrum, compatible with the X.20 firmware

**parameters**

**PTCH (pitch):** Playback pitch of the grains, in half-semitone steps. 64 is the original pitch, and the full range is ±32 semitones. Pitch modulation (LFO) also moves in half-semitone steps. Pitch doesn’t change scan speed or grain length.

**SMPL (sample):** Which sample to granulate. It’s read when the track is triggered. NOTE: this means when looping the sample on full DEC, changing SMPL will not change the sound until triggered again.

- SMP-GR: UW ROM slots 1–48, then the E12 samples E1–E21.
- SMP-GM: UW ROM slots 1–48.
- SMP-G2: E12 samples 1–21.

**DEC (decay):** Overall amplitude decay. The time to fade out ranges from about 30 ms to 30 s, and 127 holds the sound forever. The default is 64, about 1 second. Grains continue for as long as the sound lasts and loop back around again. This behavior is great with longer samples and loops.

**DENS (density):** Number of grains playing at once, on average, from 0.5 (sparse, with gaps) to 3. Up to about DENS 49, grains play one at a time at full quality (44.1 kHz). Above that, they overlap at half rate (22 kHz), up to 3 at a time at maximum. Volume is adjusted so busier settings don’t get louder.

**SEEK:** Where in the sample grains are taken from, from the start (0) to the end (127). With SCAN at 64, every grain starts here. The further SCAN is from 64, the less SEEK matters, because the position is moving on its own. Assigning an LFO to SCAN while this is happening does do some interesting stuff though.

**SCAN:** Moves the grain position through the sample over time. At 64, the position is locked. Higher values scan forward and lower values scan in reverse, up to about 2× normal speed. Small turns away from 64 give very slow, fine movement. At the end of the sample, the position wraps around to the other end.

**GRAN (grain size):** Length of each grain, from about 3 ms to 740 ms; 64 is about 46 ms. Each grain fades in and out linearly over roughly its first and last quarter.

**SPRY (spray):** Random variation in where each grain starts, around the SEEK/SCAN position. It reaches the whole sample at maximum. Above 64, grains also have a growing chance of playing backwards, up to 50% at 127.

## 4. NFX-MO[DULATOR]

**what it is**
A multi-mode modulation effect, covering flanger, chorus, pitch and frequency shifting delays. Wild and exciting textural results abound: lots to explore and many spiralling sweet spots on this. 

**NOTE:** switching MODE does a short fade (about 1.5 ms out, 1.5 ms in) instead of jumping, so there’s a brief dip rather than a glitch. No trig is needed. A ringing feedback tail carries over into the new mode, but switching into a short delay (e.g. FLNG with low DLAY) can cut it off.

**parameters**
**MODE** - Toggles between 5 modes:

- **SPIN:** pitch-shifting delay. Feedback introduces spiral to the repeats. I love this one.
- **FLNG:** flanger
- **CHOR:** three-voice chorus (three taps 120° apart, feedback from all three). Low RATE with high FB gives a lovely clangy sound.
- **DBLR:** doubler: two slow, uneven, slightly detuned voices
- **BODE:** Bode shifter, a frequency shifting delay, causing clangy, inharmonic spirals. Another really exciting one.

**RATE** - LFO speed: 0.02–12 Hz in FLNG/DBLR, 0.05–10 Hz in CHOR. In SPIN it’s the shift, ±12 semitones. In BODE it’s the shift, ±1 kHz. 64 = no shift in SPIN and BODE.

**DPTH -** LFO depth in FLNG/CHOR/DBLR (up to 5 ms in CHOR). Window size (1.5–20 ms) in SPIN. In BODE: 0 = ring mod (static clang), 127 = pure shift (full spiral).

**FB -** Feedback. 64 = none, about 124 = unity (long trails), 125–127 = self-oscillation, below 64 = negative. In CHOR it tops out just below unity (0.98), so no self-oscillation there.

**SPRD -** Spread, per mode. FLNG adds a second tap. CHOR pulls the three voices’ delays apart (0 = the pure Monomachine-style sound). DBLR spreads the voice phase and delay. SPIN wobbles the shift (±25 cents). BODE wobbles the delay (±2 ms). This is a more subtle effect but interesting when modulated.

**ENTI -** Envelope time. This machine has a built-in envelope for modulating its delay time. At 64 (centre) it is deactivated. Left of centre = shorter delay times to longer, right = longer to shorter. Further from centre in either direction = longer envelope time. It is activated by trigs.

**DLAY -** Delay time, range dependent on mode (0.5–12 ms in CHOR).

**NBAL -** Input blend. Fully right = only the track just before, fully left = only two tracks before, centre = both. An empty neighbour track is ignored, so it can’t leak noise into the effect.