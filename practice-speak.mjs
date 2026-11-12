/* 听音选义 · 开口跟读 (2026-11-12, docs/exam-interview-plan.md): after a word sounds, the learner says it; the page's
   own recogniser (chase-speech.mjs, shared with 警察抓小偷's 朗读) must hear roughly that before the meanings can be
   chosen (差不多对就过: the recogniser is neither exact nor quick).
   Loaded by practice.js only when 开口 is chosen. The word's own reading is never heard: the microphone is held while
   it sounds. Nothing here touches the page; scripts/check_practice_speak.mjs exercises the matching. */

const suffix = new URL(import.meta.url).search;   // ?v=… : the same URL chase.js imports, so one recogniser serves both
let speech = null;
const loaded = import(`./chase-speech.mjs${suffix}`).then(module => (speech = module));

export const load = () => loaded;
export const isLoaded = () => Boolean(speech);
export const supported = () => Boolean(speech?.supported());
export const isReady = () => Boolean(speech?.isReady());
export const cached = () => loaded.then(module => module.cached());
/** Download (first time) and start the recogniser; onProgress({loaded,total,downloading}). Resolves true when ready. */
export const prepare = onProgress => loaded.then(module => module.prepare(onProgress));

const VOICE = .02;          // a block louder than this is someone speaking (chase-speech's VOICE_RMS)
const QUIET_MS = 2000;      // after the voice stops this long without the word heard, that try missed
const ROUGH = .5;           // how alike (1 = the same letters) a stretch of what was heard must be to the entry

/** The words of an entry as they are said: "Jeg heter ..." → ['Jeg','heter'], "et kjøkken" → ['et','kjøkken']. */
export function wordsOf(entry) {
  return String(entry || '').split(/[\s/–—]+/).map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'')).filter(word => /[\p{L}\p{N}]/u.test(word));
}

/** Whether `text` (what the recogniser wrote) says the entry. matchWords is chase-speech's: in order, a letter or two
 *  off forgiven, an article said before the word or a light word swallowed at the end of a phrase is fine. */
export function saysEntry(entry,text,matchWords = speech?.matchWords,light = speech?.LIGHT,fold = speech?.foldWord) {
  const words = wordsOf(entry);
  if (!words.length || !matchWords) return false;
  const {count} = matchWords(words.map(word => ({text:word})),text,[]);
  if (count >= words.length) return true;
  // "Hvordan går det?" said with the last det swallowed (the matcher passes light words only before other words).
  return words.length >= 2 && count === words.length-1 && Boolean(light?.has(fold?.(words.at(-1))));
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
/** Whether `text` says roughly the entry (2026-11-12, the teacher: 差不多对就过). Besides saysEntry, a try passes when
 *  some stretch of what was heard, run together, is at most about half its letters off the entry run together
 *  (Musik for musikk, ne for nei, Hvordan går for Hvordan går det?). */
export function roughlySays(entry,text,tokens = speech?.spokenTokens) {
  if (saysEntry(entry,text)) return true;
  if (!tokens) return false;
  const want = tokens(wordsOf(entry).join(' ')).join(''), heard = tokens(text);
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

/** What was heard, fit to show: a short clip makes Whisper repeat itself ("Kaffe kaffe kaffe") or write letters that
 *  are no word ("KJLLLPL"). Repeats fold into one, words without a vowel and marks go, at most three words stay. */
export function tidy(text) {
  const words = String(text || '').split(/\s+/).map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,''))
    .filter(word => /\d/.test(word) || /[aeiouyæøåéèêóòâ]/i.test(word));
  const out = [];
  for (const word of words) {
    const fold = word.toLocaleLowerCase('nb');
    if (out.some(seen => seen.toLocaleLowerCase('nb') === fold)) continue;
    out.push(word);
    if (out.length === 3) break;
  }
  return out.join(' ');
}

/** Ask for the microphone. Call it inside the learner's tap (iOS starts audio only there): when the recogniser module
 *  is loaded already the request starts synchronously. Rejects with an Error whose code is 'denied' or 'none'. */
export function openMic() {
  return speech ? speech.openMic() : loaded.then(module => module.openMic());
}

/** One word at a time on an open microphone.
 *  onLevel(rms) for the meter, onText(text) for what was heard, onPass(text) once the word is said, onMiss(text)
 *  when someone spoke and stopped without it. */
export function createCoach(listener,{onLevel,onText,onPass,onMiss} = {}) {
  let entry = '', words = [], passed = true, voiced = false, quietAt = 0, last = '', on = false, timer = 0;
  const now = () => (typeof performance === 'object' ? performance.now() : Date.now());
  listener.start(text => {
    if (!on || passed) return;
    last = text;
    onText?.(text);
    if (roughlySays(entry,text)) { passed = true; on = false; listener.pause(); onPass?.(text); }
  },level => {
    if (!on || passed) return;
    onLevel?.(level);
    if (level > VOICE) { voiced = true; quietAt = 0; return; }
    if (!voiced) return;
    quietAt ||= now();
    if (now()-quietAt >= QUIET_MS) { voiced = false; quietAt = 0; onMiss?.(last); last = ''; }
  },() => words);
  listener.pause();
  return {
    /** Listen for this entry (after the word has sounded: call release()). */
    expect(next) { entry = String(next || ''); words = wordsOf(entry); passed = false; voiced = false; quietAt = 0; last = ''; },
    /** The page is about to sound the word: hear nothing until release(). */
    hold() { clearTimeout(timer); timer = 0; on = false; listener.hold(); },
    /** Start (or go on) hearing the learner, `delay` ms from now (a clip's tail still rings for a moment). */
    release(delay = 0) {
      clearTimeout(timer);
      timer = setTimeout(() => { timer = 0; if (passed) return; listener.release(); listener.resume(); on = true; voiced = false; quietAt = 0; },delay);
    },
    stop() { clearTimeout(timer); timer = 0; on = false; listener.pause(); },
    close() { clearTimeout(timer); timer = 0; on = false; listener.close(); },
    get listening() { return on; },
    get passed() { return passed; }
  };
}
