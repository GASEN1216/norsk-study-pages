/* 警察抓小偷's 朗读 mode: the player reads the text aloud instead of typing it. Loaded by chase.js only when 朗读 is chosen.
   The recogniser is the page's own (dist/asr: nb-whisper-base with a 6 s window, built by scripts/build_asr.py, run by
   transformers.js in a worker): browsers' built-in recognition mostly fails in China (Google) or ignores Norwegian.
   While the player reads, the latest few seconds of microphone audio are transcribed whenever the model is free, and
   the transcript is matched against the words still to read (matchWords). Each pass takes about 1 s on a 2025 phone.
   Nothing here touches the page at load; the pure matcher is exercised by scripts/check_chase_speech.mjs. */

export const MODEL = 'nb-whisper-base-6s-2';   // scripts/build_asr.py's MODEL (the folder in dist/asr)
const WINDOW_SECONDS = 5.6;          // what each pass hears (the model's window is 6 s)
const OVERLAP_SECONDS = 1.2;         // after words are matched, audio before this much ahead of that moment is dropped
const STEP_SECONDS = .25;            // a new pass needs at least this much new audio
const VOICE_RMS = .02;               // a 4096-sample block louder than this is someone speaking
const VOICE_HOLD = 1.6;              // passes run until this long after the last voice
const GEN = {max_new_tokens:32,no_repeat_ngram_size:4};   // a short window sometimes makes Whisper repeat itself

/* ---------- Matching (pure) ---------- */

const NUMBERS = ['null','en','to','tre','fire','fem','seks','sju','åtte','ni','ti','elleve','tolv','tretten','fjorten','femten','seksten','sytten','atten','nitten','tjue'];
// A word as compared: lower case, æ ø å spelt out, accents and everything that is not a letter or digit gone.
export const foldWord = word => String(word || '').toLowerCase().normalize('NFC').replace(/æ/g,'ae').replace(/ø/g,'o').replace(/å/g,'a')
  .normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');
const split = text => String(text || '').split(/[\s\-–—/]+/).map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'')).filter(Boolean);
// What the recogniser wrote, as words to compare; small numbers it wrote in digits are read as the words they are.
export function spokenTokens(text) {
  return split(text).map(word => /^\d+$/.test(word) && Number(word) < NUMBERS.length ? NUMBERS[Number(word)] : word).map(foldWord).filter(Boolean);
}
// Short unstressed words are often swallowed by the recogniser or glued to the word before (Yousef er → Josefer).
export const LIGHT = new Set(['er','og','i','på','en','et','ei','å','at','av','om','de','du','som','til','har','var','men','så','nå','den','det','seg','meg','deg'].map(foldWord));
function distance(a,b) {
  if (a === b) return 0;
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
// One letter off is forgiven from four letters, two from nine; a misheard word (forstår → foreslår) is not the word.
const close = (heard,want) => heard === want || distance(heard,want) <= (want.length <= 3 ? 0 : want.length <= 8 ? 1 : 2);

/** How many of the words still to read were heard, in order.
 *  want: [{text, soft}] — soft words (names the recogniser cannot spell, light words, numbers) pass once the words after
 *  them are heard. A wanted word may be heard as two (norsk kurs) or glued to a light word after it (josefer).
 *  Returns {count, skipped}: count words from the front are read (skipped of them passed as soft). */
export function matchWords(want,heardText) {
  const words = want.map(item => spokenTokens(item.text).join('')), soft = want.map((item,i) => Boolean(item.soft) || LIGHT.has(words[i]) || !/[a-z]/.test(words[i]));
  const heard = spokenTokens(heardText);
  const at = (i,k) => i >= heard.length || k >= words.length || !words[k] ? 0
    : close(heard[i],words[k]) ? 1 : i+1 < heard.length && close(heard[i]+heard[i+1],words[k]) ? 2 : 0;
  const glued = (i,k) => {
    const w = heard[i], next = words[k+1];
    if (!w || !next || !LIGHT.has(next) || w.length <= next.length+1 || !w.endsWith(next)) return false;
    return soft[k] || close(w.slice(0,-next.length),words[k]);
  };
  let k = 0, skipped = 0;
  for (let i = 0; i < heard.length && k < words.length;) {
    // A word with nothing to say (a lone mark) is passed at once.
    if (!words[k]) { k++; continue; }
    const step = at(i,k);
    if (step) { k++; i += step; continue; }
    if (glued(i,k)) { k += 2; i++; continue; }
    // Up to two soft words in a row pass once the word after them is heard, and the one after that too unless the
    // list ends there (the list is never the end of the text: more words follow, so the last soft word waits).
    let j = k;
    while (j < words.length-1 && j-k < 2 && soft[j]) j++;
    if (j > k) {
      const a = at(i,j);
      if (a && (j+1 === words.length || at(i+a,j+1))) { skipped += j-k; k = j; continue; }
    }
    i++;
  }
  return {count:k,skipped};
}

/* ---------- The recogniser (worker) ---------- */

const base = new URL('./asr/',import.meta.url);
const recogniser = {worker:null,ready:false,loading:null,files:{},listeners:new Set(),runs:new Map(),seq:0,loadMs:0};

function onWorker({data}) {
  if (data.type === 'progress') {
    const p = data.p || {};
    if (p.file && p.total) recogniser.files[p.file] = {loaded:p.loaded || 0,total:p.total};
    if (p.status === 'done' && p.file && recogniser.files[p.file]) recogniser.files[p.file].loaded = recogniser.files[p.file].total;
    const list = Object.values(recogniser.files), loaded = list.reduce((a,f) => a+f.loaded,0), total = list.reduce((a,f) => a+f.total,0);
    for (const listen of recogniser.listeners) listen({loaded,total,downloading:list.some(f => f.total > 5e6) && loaded < total});
  } else if (data.type === 'loaded' || data.type === 'error') {
    recogniser.done?.(data);
  } else if (data.type === 'text') {
    const done = recogniser.runs.get(data.id);
    recogniser.runs.delete(data.id);
    done?.(data);
  }
}
/** Whether this browser can run the recogniser at all. */
export function supported() {
  return typeof Worker === 'function' && typeof WebAssembly === 'object' && Boolean(navigator.mediaDevices?.getUserMedia)
    && Boolean(window.AudioContext || window.webkitAudioContext) && typeof caches === 'object';
}
/** Whether the model is already in this browser's cache (then preparing it needs no download). */
export async function cached() {
  try {
    const keys = await (await caches.open('transformers-cache')).keys();
    return keys.some(request => request.url.includes(`/${MODEL}/onnx/decoder`));
  } catch { return false; }
}
export const isReady = () => recogniser.ready;
/** Download (first time) and start the model. onProgress({loaded,total,downloading}) while files come in.
 *  Several callers share one load. Resolves true when ready, false on failure. */
export function prepare(onProgress) {
  if (onProgress) recogniser.listeners.add(onProgress);
  if (recogniser.ready) return Promise.resolve(true);
  recogniser.loading ||= (async () => {
    try {
      if (!supported()) return false;
      recogniser.worker ||= new Worker(new URL('runtime/asr-worker.js?v=2',base),{type:'module'});
      recogniser.worker.onmessage = onWorker;
      recogniser.worker.onerror = event => recogniser.done?.({type:'error',message:event.message || 'worker'});
      // Test models of other windows (the 2026-11 phone trials) are dead weight in the cache.
      try {
        const cache = await caches.open('transformers-cache');
        await Promise.all((await cache.keys()).filter(r => /\/asr\/nb-whisper-/.test(r.url) && !r.url.includes(`/${MODEL}/`)).map(r => cache.delete(r)));
      } catch {}
      const reply = await new Promise(done => { recogniser.done = done; recogniser.worker.postMessage({type:'load',model:MODEL}); });
      recogniser.done = null;
      if (reply.type !== 'loaded') { console.warn('朗读识别没有准备好',reply.message); return false; }
      recogniser.loadMs = reply.ms;
      recogniser.ready = true;
      return true;
    } catch (error) {
      console.warn('朗读识别没有准备好',error);
      return false;
    } finally {
      recogniser.loading = null;
    }
  })();
  return recogniser.loading.finally(() => { if (onProgress) recogniser.listeners.delete(onProgress); });
}
function transcribe(audio) {
  const id = ++recogniser.seq;
  return new Promise(done => { recogniser.runs.set(id,done); recogniser.worker.postMessage({type:'run',id,audio,gen:GEN},[audio.buffer]); });
}

/* ---------- The microphone ---------- */

/** Ask for the microphone (call inside the player's tap: iOS starts audio only there). Resolves to a listener, or
 *  rejects with an Error whose `code` is 'denied' or 'none'. The listener hears nothing until start(). */
export async function openMic() {
  const Context = window.AudioContext || window.webkitAudioContext;
  let context;
  try { context = new Context({sampleRate:16000}); } catch { context = new Context(); }
  context.resume?.().catch(() => {});
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}}); }
  catch (error) {
    context.close?.().catch(() => {});
    const failure = new Error(String(error?.message || error));
    failure.code = error?.name === 'NotAllowedError' || error?.name === 'SecurityError' ? 'denied' : 'none';
    throw failure;
  }
  return listener(context,stream);
}

function listener(context,stream) {
  const rate = context.sampleRate, source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096,1,1), mute = context.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);
  // Audio is kept as 16 kHz samples since the last cut, at most a window and a half (older audio is never needed).
  const keep = Math.round(WINDOW_SECONDS*1.5*16000);
  let samples = new Float32Array(0), heardTo = 0, ranTo = 0, voiceAt = -Infinity, total = 0;
  let on = false, closed = false, busy = false, onText = null, onLevel = null, timer = 0;
  const stats = {passes:0,ms:0,slowest:0};
  const resample = block => {
    if (rate === 16000) return new Float32Array(block);
    const out = new Float32Array(Math.floor(block.length*16000/rate)), step = rate/16000;
    for (let i = 0; i < out.length; i++) { const x = i*step, j = Math.floor(x), f = x-j; out[i] = block[j]*(1-f)+(block[j+1] ?? block[j])*f; }
    return out;
  };
  processor.onaudioprocess = event => {
    if (!on) return;
    const block = event.inputBuffer.getChannelData(0);
    let sum = 0;
    for (const v of block) sum += v*v;
    const level = Math.sqrt(sum/block.length);
    const fresh = resample(block);
    total += fresh.length;
    if (level > VOICE_RMS) voiceAt = total/16000;
    const next = new Float32Array(Math.min(keep,samples.length+fresh.length));
    const from = samples.length+fresh.length-next.length;
    next.set(samples.subarray(Math.max(0,from)),0);
    next.set(fresh,next.length-fresh.length);
    samples = next;
    onLevel?.(level);
  };
  const now = () => total/16000;
  async function pump() {
    timer = 0;
    if (!on || closed || busy) return;
    const t = now();
    if (recogniser.ready && t-voiceAt <= VOICE_HOLD && t-ranTo >= STEP_SECONDS && samples.length > 8000) {
      busy = true;
      ranTo = t;
      // The last WINDOW_SECONDS, but nothing from before the last cut (words already read).
      const want = Math.min(samples.length,Math.round(WINDOW_SECONDS*16000),Math.max(8000,Math.round((t-heardTo)*16000)));
      const audio = samples.slice(samples.length-want);
      const out = await transcribe(audio);
      busy = false;
      stats.passes++;
      stats.ms += out.ms;
      stats.slowest = Math.max(stats.slowest,out.ms);
      if (on && !closed && out.text) onText?.(out.text,{ms:out.ms,at:t});
    }
    if (on && !closed) timer = setTimeout(pump,60);
  }
  return {
    stats,
    /** Begin listening: onText(text,{ms,at}) for each transcript, onLevel(rms) for each block (about 4 a second). */
    start(textHandler,levelHandler) { onText = textHandler; onLevel = levelHandler; on = true; context.resume?.().catch(() => {}); if (!timer) timer = setTimeout(pump,60); },
    /** Stop hearing (pause): what was heard so far is dropped. */
    pause() { on = false; samples = new Float32Array(0); heardTo = ranTo = now(); clearTimeout(timer); timer = 0; },
    resume() { if (closed) return; on = true; context.resume?.().catch(() => {}); if (!timer) timer = setTimeout(pump,60); },
    /** Words were matched in the transcript of audio heard up to `at`: later passes start a little before that. */
    mark(at) { heardTo = Math.max(heardTo,at-OVERLAP_SECONDS); },
    /** A word was passed by hand: later passes hear only what comes after now. */
    cut() { heardTo = ranTo = now(); },
    close() {
      closed = true;
      on = false;
      clearTimeout(timer);
      try { processor.disconnect(); source.disconnect(); mute.disconnect(); } catch {}
      stream.getTracks().forEach(track => track.stop());
      context.close?.().catch(() => {});
    }
  };
}
