/* 听音选义 · 开口跟读 (2026-11-12, docs/exam-interview-plan.md): after a word sounds, the learner says it back. The
   meanings open as soon as the page heard them say something word-sized (some voice, then a short quiet): nobody waits
   for a recogniser (the teacher: 差不多对就过). Since 2026-11-13 nothing is sent to the server's speech to text either
   (the user: 听音选义不如直接去掉服务器识别 — the day's speech allowance is kept for 考试与面试 and 朗读), so the line
   only ever says 念过了. The microphone is held while the word itself sounds. Loaded by practice.js only when 开口 is
   chosen; scripts/check_practice_speak.mjs exercises the coach on a fake microphone. */

const suffix = new URL(import.meta.url).search;   // ?v=… : the same URL chase.js imports
let speech = null;
const loaded = import(`./chase-speech.mjs${suffix}`).then(module => (speech = module));

export const load = () => loaded;
export const isLoaded = () => Boolean(speech);
/** A microphone and Web Audio are all this needs. */
export const supported = () => typeof navigator === 'object' && Boolean(navigator.mediaDevices?.getUserMedia)
  && typeof window === 'object' && Boolean(window.AudioContext || window.webkitAudioContext);

const VOICE = .02;          // a block louder than this is someone speaking (chase-speech's VOICE_RMS)
const SAID_MS = 250;        // at least this much voice is a word said, not a click or a breath
const DONE_MS = 450;        // …and then this much quiet: the word is over
const FORGET_MS = 1500;     // a blip too short to be a word is forgotten after this much quiet

/** Ask for the microphone. Call it inside the learner's tap (iOS starts audio only there): when the module is loaded
 *  already the request starts synchronously. Rejects with an Error whose code is 'denied' or 'none'. */
export function openMic() {
  return speech ? speech.openMic() : loaded.then(module => module.openMic());
}

/** One word at a time on an open microphone. onLevel(rms) for the meter; onPass(word) once the learner said something
 *  word-sized after the word sounded. No transcripts are asked for. */
export function createCoach(listener,{onLevel,onPass} = {}) {
  let entry = '', passed = true, on = false, timer = 0, voiced = 0, quietAt = 0, last = 0;
  const now = () => (typeof performance === 'object' ? performance.now() : Date.now());
  const fresh = () => { voiced = 0; quietAt = 0; last = 0; };
  listener.start(null,level => {
    if (!on) return;
    onLevel?.(level);
    if (passed) return;
    const t = now(), step = last ? Math.min(200,t-last) : 0;
    last = t;
    if (level > VOICE) { voiced += step; quietAt = 0; return; }
    quietAt ||= t;
    if (voiced < SAID_MS) { if (t-quietAt >= FORGET_MS) voiced = 0; return; }
    if (t-quietAt >= DONE_MS) { passed = true; onPass?.(entry); }
  },null,'word');
  listener.pause();
  return {
    /** A new word: listen for it once release() is called. */
    expect(next) { entry = String(next || ''); passed = false; fresh(); },
    /** The page is about to sound the word: hear nothing until release(). */
    hold() { clearTimeout(timer); timer = 0; on = false; listener.hold(); },
    /** Start (or go on) hearing the learner, `delay` ms from now (a clip's tail still rings for a moment). */
    release(delay = 0) {
      clearTimeout(timer);
      timer = setTimeout(() => { timer = 0; listener.release(); listener.resume(); on = true; fresh(); },delay);
    },
    stop() { clearTimeout(timer); timer = 0; on = false; listener.pause(); },
    close() { clearTimeout(timer); timer = 0; on = false; listener.close(); },
    get listening() { return on; },
    get passed() { return passed; }
  };
}
