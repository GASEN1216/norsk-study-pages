/* 听音选义 · 开口跟读 (2026-11-12, docs/exam-interview-plan.md): after a word sounds, the learner says it back. The
   meanings open as soon as the page heard them say something word-sized (some voice, then a short quiet): nobody waits
   for a recogniser (the teacher: 差不多对就过). Meanwhile that stretch of speech goes to the server's speech to text
   (chase-speech.mjs → /ai/transcribe); when it is roughly the word, the line says 念对了 — praise only, never a fault
   and never the transcript. The microphone is held while the word itself sounds. Loaded by practice.js only when 开口
   is chosen; scripts/check_practice_speak.mjs exercises the coach on a fake microphone. */

const suffix = new URL(import.meta.url).search;   // ?v=… : the same URL chase.js imports
let speech = null;
const loaded = import(`./chase-speech.mjs${suffix}`).then(module => (speech = module));

export const load = () => loaded;
export const isLoaded = () => Boolean(speech);
/** A microphone and Web Audio are all this needs. */
export const supported = () => typeof navigator === 'object' && Boolean(navigator.mediaDevices?.getUserMedia)
  && typeof window === 'object' && Boolean(window.AudioContext || window.webkitAudioContext);
/** The community API's request function: with it, said words are also checked on the server. */
export const useServer = request => loaded.then(module => { module.useServer(request); return module.prepare(); });

const VOICE = .02;          // a block louder than this is someone speaking (chase-speech's VOICE_RMS)
const SAID_MS = 250;        // at least this much voice is a word said, not a click or a breath
const DONE_MS = 450;        // …and then this much quiet: the word is over
const FORGET_MS = 1500;     // a blip too short to be a word is forgotten after this much quiet
const ROUGH = .5;           // how alike (1 = the same letters) what was heard must be to count as the word

/** The words of an entry as they are said: "Jeg heter ..." → ['Jeg','heter'], "et kjøkken" → ['et','kjøkken']. */
export function wordsOf(entry) {
  return String(entry || '').split(/[\s/–—]+/).map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'')).filter(word => /[\p{L}\p{N}]/u.test(word));
}
function letterDistance(a,b) {
  const row = Array.from({length:b.length+1},(_,i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1] === b[j-1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}
/** Whether `text` (what the server wrote) says roughly the entry: the matcher of 朗读 takes it, or some stretch of it,
 *  run together, is at most about half its letters off the entry run together (Musik for musikk, ne for nei). */
export function roughlySays(entry,text,module = speech) {
  const words = wordsOf(entry);
  if (!words.length || !module) return false;
  if (module.matchWords(words.map(word => ({text:word})),text,[]).count >= words.length) return true;
  const want = module.spokenTokens(words.join(' ')).join(''), heard = module.spokenTokens(text);
  if (!want) return false;
  for (let i = 0; i < heard.length; i++) {
    let joined = '';
    for (let j = i; j < heard.length && joined.length < want.length+4; j++) {
      joined += heard[j];
      if (1-letterDistance(joined,want)/Math.max(joined.length,want.length) >= ROUGH) return true;
    }
  }
  return false;
}

/** Ask for the microphone. Call it inside the learner's tap (iOS starts audio only there): when the module is loaded
 *  already the request starts synchronously. Rejects with an Error whose code is 'denied' or 'none'. */
export function openMic() {
  return speech ? speech.openMic() : loaded.then(module => module.openMic());
}

/** One word at a time on an open microphone. onLevel(rms) for the meter; onPass(word) once the learner said something
 *  word-sized after the word sounded; onRight(word) a moment later when the server heard roughly that word. */
export function createCoach(listener,{onLevel,onPass,onRight} = {}) {
  let entry = '', passed = true, on = false, timer = 0, voiced = 0, quietAt = 0, last = 0;
  const now = () => (typeof performance === 'object' ? performance.now() : Date.now());
  const fresh = () => { voiced = 0; quietAt = 0; last = 0; };
  // A transcript belongs to the word expected when its stretch was sent (it comes back a moment later, maybe after
  // the next word has started).
  const heard = (text,{hint} = {}) => { const word = (hint || []).join(' ') || entry; if (word && roughlySays(word,text)) onRight?.(word); };
  listener.start(onRight ? heard : null,level => {
    if (!on) return;
    onLevel?.(level);
    if (passed) return;
    const t = now(), step = last ? Math.min(200,t-last) : 0;
    last = t;
    if (level > VOICE) { voiced += step; quietAt = 0; return; }
    quietAt ||= t;
    if (voiced < SAID_MS) { if (t-quietAt >= FORGET_MS) voiced = 0; return; }
    if (t-quietAt >= DONE_MS) { passed = true; onPass?.(entry); }
  },() => wordsOf(entry),'word');
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
