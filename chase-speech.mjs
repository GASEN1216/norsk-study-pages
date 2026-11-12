/* Speech for the whole site: 警察抓小偷's 朗读 (chase.js), 听音选义's 跟读 (practice-speak.mjs) and 考试与面试's dictation
   (dictation.mjs) all hear the learner through this module.
   Since 2026-11-12 the words are written down by the community API (POST /ai/transcribe → Cloudflare's Whisper
   large-v3 turbo), not by a model on the phone: that one (nb-whisper-base, 118 MB) took many seconds to start on every
   page load and was not exact. The microphone's audio is cut at the speaker's pauses into short stretches (16 kHz),
   each goes to the server as a WAV, and its transcript is matched against the words expected (matchWords). A word
   lights up a second or two after the pause that ends it; the underline answers the voice at once (chase.js).
   Nothing here touches the page at load; the pure matcher is exercised by scripts/check_chase_speech.mjs. */

const VOICE_RMS = .02;               // a block louder than this is someone speaking

/* ---------- Matching (pure) ---------- */

const NUMBERS = ['null','en','to','tre','fire','fem','seks','sju','åtte','ni','ti','elleve','tolv','tretten','fjorten','femten','seksten','sytten','atten','nitten','tjue'];
const TENS = {20:'tjue',30:'tretti',40:'førti',50:'femti',60:'seksti',70:'sytti',80:'åtti',90:'nitti'};
const ORDINALS = ['','første','andre','tredje','fjerde','femte','sjette','sjuende','åttende','niende','tiende','ellevte','tolvte','trettende','fjortende','femtende','sekstende','syttende','attende','nittende','tjuende'];
// A word as compared: lower case, æ ø å spelt out, accents and everything that is not a letter or digit gone.
export const foldWord = word => String(word || '').toLowerCase().normalize('NFC').replace(/æ/g,'ae').replace(/ø/g,'o').replace(/å/g,'a')
  .normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');
const split = text => String(text || '').split(/[\s\-–—/]+/).map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'')).filter(Boolean);
// What the recogniser wrote, as words to compare; small numbers it wrote in digits are read as the words they are.
export function spokenTokens(text) {
  return split(text).map(word => /^\d+$/.test(word) && Number(word) < NUMBERS.length ? NUMBERS[Number(word)] : word).map(foldWord).filter(Boolean);
}
// The number a word says, written in digits or in letters, counted or ordered (25, tjuefem, 5., femte): the text has
// "5. juli" where the recogniser writes "femte juli", or the other way round. Up to 99 (ordinals up to 31, for dates).
const NUMBER_OF = new Map();
for (let n = 0; n <= 99; n++) {
  const ten = Math.floor(n/10)*10, names = n <= 20 ? [NUMBERS[n]] : n === ten ? [TENS[ten]] : [TENS[ten]+NUMBERS[n-ten]];
  if (n === 1) names.push('ett','ei');
  if (n === 7) names.push('syv','syvende');
  if (n === 20) names.push('tyve');
  if (n === 30) names.push('tredve');
  if (n >= 1 && n <= 31) names.push(n <= 20 ? ORDINALS[n] : n === 30 ? 'trettiende' : TENS[ten]+ORDINALS[n-ten]);
  for (const name of names) NUMBER_OF.set(foldWord(name),n);
}
const numberOf = word => /^\d+$/.test(word) ? Number(word) : NUMBER_OF.get(word) ?? null;
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
// A number is the number however it is written.
function close(heard,want) {
  if (heard === want || distance(heard,want) <= (want.length <= 3 ? 0 : want.length <= 8 ? 1 : 2)) return true;
  const n = numberOf(want);
  return n != null && n === numberOf(heard);
}
// A name is spelt any way by the recogniser (Yousef → Josef, Håvard → Hovar, Viola → Mio): it is taken as heard when
// the word written in its place starts alike or is no more than half its letters off.
const nameLike = (heard,want) => heard[0] === want[0] || distance(heard,want) <= Math.ceil(want.length/2);

/** How many of the words still to read were heard, in order.
 *  want: [{text, soft}] — the next words of the text. Soft words (names the recogniser cannot spell) pass when
 *  something like them is heard in their place; they, light words and numbers also pass once the words after them are
 *  heard. Any one other word passes that way too when the two words after it are heard right there (it was written
 *  as something else, or swallowed, and the reader has plainly read on). A wanted word may be heard as two (norsk
 *  kurs) or glued to a light word after it (josefer).
 *  before: the last few words already read. The recogniser hears the last second or so again, so its text often
 *  starts with them; where the text goes on with the same words (Jeg heter … Jeg heter …), words heard that could be
 *  those old ones prove nothing, and nothing is passed on their account.
 *  Returns {count, skipped}: count words from the front are read (skipped of them passed without being heard). */
export function matchWords(want,heardText,before = []) {
  const words = want.map(item => spokenTokens(item.text).join('')), name = want.map(item => Boolean(item.soft));
  const soft = want.map((item,i) => name[i] || LIGHT.has(words[i]) || !/[a-z]/.test(words[i]));
  const heard = spokenTokens(heardText), old = before.map(item => spokenTokens(item.text ?? item).join('')).filter(Boolean);
  const at = (i,k) => i >= heard.length || k >= words.length || !words[k] ? 0
    : close(heard[i],words[k]) ? 1 : i+1 < heard.length && close(heard[i]+heard[i+1],words[k]) ? 2 : 0;
  const glued = (i,k) => {
    const w = heard[i], next = words[k+1];
    if (!w || !next || !LIGHT.has(next) || w.length <= next.length+1 || !w.endsWith(next)) return false;
    return soft[k] || close(w.slice(0,-next.length),words[k]);
  };
  // Could the words heard from i on be old words heard again? (the first is one of the old words, and the next heard
  // word, when there is one, follows it there too)
  const stale = i => old.some((word,j) => close(heard[i],word) && (i+1 >= heard.length || j+1 >= old.length || close(heard[i+1],old[j+1])));
  // `count` wanted words from k on are heard from i on: how many heard words that takes, or 0.
  const run = (i,k,count) => {
    let used = 0;
    for (let n = 0; n < count; n++) { const step = at(i+used,k+n); if (!step) return 0; used += step; }
    return used;
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
    if (j > k && !stale(i)) {
      const a = at(i,j);
      if (a && (j+1 === words.length || at(i+a,j+1))) { skipped += j-k; k = j; continue; }
    }
    // Any one word passes when the two words after it are heard: right here (it left no trace) or after one heard
    // word (it was written as something else).
    if (k+2 < words.length) {
      const here = !stale(i) && run(i,k+1,2), after = !here && i+1 < heard.length && !stale(i+1) && run(i+1,k+1,2);
      if (here || after) { skipped++; k++; if (after) i++; continue; }
    }
    // A name written some other way (never an old word heard again: heter is not Håvard).
    if (name[k] && nameLike(heard[i],words[k]) && !old.some(word => close(heard[i],word))) { k++; i++; continue; }
    i++;
  }
  return {count:k,skipped};
}

/* ---------- The recogniser: the community API's speech to text ---------- */

const RATE = 16000;
const PAUSE_SECONDS = .35;           // a pause this long ends a stretch of speech
const STRETCH_SECONDS = 4;           // a stretch never grows longer: someone reading on still sees words come
const SHORTEST_SECONDS = .25;        // less voice than this is a click or a breath, not a word
const PAD_SECONDS = .15;             // a little of the quiet before and after the voice goes along (word edges)
const server = {request:null,status:null,ready:false};

/** The community API's request function (community.js, through chase.js, practice.js and 考试与面试). Speech is written
 *  down only when GET /ai/status says asr. */
export function useServer(request) {
  if (typeof request !== 'function' || request === server.request) return;
  Object.assign(server,{request,status:null,ready:false});
}
/** A microphone and Web Audio are all that is needed on the page. */
export function supported() {
  return typeof navigator === 'object' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof window === 'object'
    && Boolean(window.AudioContext || window.webkitAudioContext);
}
export const isReady = () => server.ready;
/** Whether speech can be written down now (asks the server once). Resolves true or false; never downloads anything. */
export function prepare() {
  if (!server.request) return Promise.resolve(false);
  server.status ||= Promise.resolve().then(() => server.request('/ai/status',{timeout:8000}))
    .then(reply => (server.ready = Boolean(reply?.asr))).catch(() => { server.status = null; return false; });
  return server.status;
}
/** 16 kHz float samples → a 16-bit mono PCM WAV, base64 (what /ai/transcribe takes). */
export function wavBase64(samples) {
  const view = new DataView(new ArrayBuffer(44+samples.length*2));
  const tag = (at,text) => { for (let i = 0; i < 4; i++) view.setUint8(at+i,text.charCodeAt(i)); };
  tag(0,'RIFF'); view.setUint32(4,36+samples.length*2,true); tag(8,'WAVE');
  tag(12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,RATE,true); view.setUint32(28,RATE*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
  tag(36,'data'); view.setUint32(40,samples.length*2,true);
  for (let i = 0; i < samples.length; i++) { const v = Math.max(-1,Math.min(1,samples[i])); view.setInt16(44+i*2,v < 0 ? v*0x8000 : v*0x7fff,true); }
  const bytes = new Uint8Array(view.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));
  return btoa(binary);
}
/** One stretch of speech written down: {text, ms}. kind: 'read' (朗读), 'word' (跟读) or 'exam' (考试与面试's own
 *  allowance); hint: words the speaker is about to say; task, before: see /ai/transcribe. Rejects when it fails. */
export async function transcribe(samples,{kind = 'exam',hint = [],task,before} = {}) {
  if (!server.request) throw new Error('no server');
  const started = performance.now();
  const words = (hint || []).map(word => String(word || '').trim()).filter(Boolean).join(' ').slice(0,200);
  const reply = await server.request('/ai/transcribe',{method:'POST',timeout:20000,body:{audio:wavBase64(samples),kind,
    ...(words ? {hint:words} : {}),...(task ? {task} : {}),...(before ? {before:String(before).slice(-300)} : {})}});
  return {text:String(reply?.text || ''),ms:Math.round(performance.now()-started)};
}

/* ---------- The microphone ---------- */

/** Ask for the microphone (call inside the player's tap: iOS starts audio only there). Resolves to a listener, or
 *  rejects with an Error whose `code` is 'denied' or 'none'. The listener hears nothing until start(). */
export async function openMic() {
  const {context,stream} = await openInput();
  return listener(context,stream);
}
/** The microphone as an audio context (16 kHz where the browser allows) and its stream, for other listeners
 *  (dictation.mjs). Same rules as openMic: call it inside a tap; rejects with code 'denied' or 'none'. */
export async function openInput() {
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
  return {context,stream};
}

// The speech of a listener, cut at pauses. Each stretch goes to the server as soon as it ends (they travel side by
// side: a round trip takes a second or more), and their transcripts are reported in the order they were said. What
// was heard before hold() or cut() is never reported.
function listener(context,stream) {
  const rate = context.sampleRate;
  let source, processor, mute;
  try {
    source = context.createMediaStreamSource(stream);
    // Blocks of about 64 ms at 16 kHz: the level answers the voice at once.
    processor = context.createScriptProcessor(rate <= 24000 ? 1024 : 2048,1,1); mute = context.createGain();
    mute.gain.value = 0;
    source.connect(processor); processor.connect(mute); mute.connect(context.destination);
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    context.close?.().catch(() => {});
    throw error;
  }
  let on = false, closed = false, held = false, onText = null, onLevel = null, expected = null, kind = 'read', gen = 0;
  let parts = [], length = 0, voiced = 0, quiet = 0, lead = [], total = 0, queue = Promise.resolve();
  const stats = {passes:0,ms:0,slowest:0,failed:0};
  const resample = block => {
    if (rate === RATE) return new Float32Array(block);
    const out = new Float32Array(Math.floor(block.length*RATE/rate)), step = rate/RATE;
    for (let i = 0; i < out.length; i++) { const x = i*step, j = Math.floor(x), f = x-j; out[i] = block[j]*(1-f)+(block[j+1] ?? block[j])*f; }
    return out;
  };
  const drop = () => { parts = []; length = 0; voiced = 0; quiet = 0; lead = []; };
  function send() {
    const samples = new Float32Array(length);
    let at = 0;
    for (const part of parts) { samples.set(part,at); at += part.length; }
    const enough = voiced >= SHORTEST_SECONDS, mine = gen, end = total/RATE;
    drop();
    if (!enough || !onText || !server.ready) return;
    let hint = [];
    try { hint = expected?.() || []; } catch {}
    const job = transcribe(samples,{kind,hint});
    job.catch(() => {});
    queue = queue.then(() => job).then(out => {
      if (!out || closed || mine !== gen) return;
      stats.passes++; stats.ms += out.ms; stats.slowest = Math.max(stats.slowest,out.ms);
      if (out.text) onText?.(out.text,{ms:out.ms,at:end,hint});
    },() => { stats.failed++; });
  }
  processor.onaudioprocess = event => {
    if (!on || held || closed) return;
    const block = event.inputBuffer.getChannelData(0);
    let sum = 0;
    for (const v of block) sum += v*v;
    const level = Math.sqrt(sum/block.length), fresh = resample(block), seconds = fresh.length/RATE;
    total += fresh.length;
    onLevel?.(level);
    if (level > VOICE_RMS) {
      if (!length) { for (const piece of lead) { parts.push(piece); length += piece.length; } lead = []; }
      parts.push(fresh); length += fresh.length; voiced += seconds; quiet = 0;
      if (length/RATE >= STRETCH_SECONDS) send();
      return;
    }
    if (length) {
      parts.push(fresh); length += fresh.length; quiet += seconds;
      if (quiet >= PAUSE_SECONDS) send();
      return;
    }
    // Before any voice: keep the last moment of quiet, so the first sound of a word is not cut off.
    lead.push(fresh);
    while (lead.reduce((sum,piece) => sum+piece.length,0) > PAD_SECONDS*RATE && lead.length > 1) lead.shift();
  };
  return {
    stats,
    /** Begin listening: onText(text,{ms,at,hint}) for each stretch written down (none when onText is null: then only the
     *  level is heard), onLevel(rms) for each block (about 16 a second), expect() → words the speaker is about to say.
     *  kind: whose allowance it counts against on the server ('read' for 朗读, 'word' for 跟读). */
    start(textHandler,levelHandler,expect,use = 'read') { onText = textHandler; onLevel = levelHandler; expected = expect || null; kind = use; on = true; context.resume?.().catch(() => {}); },
    /** Stop hearing: a stretch under way is sent if it holds a word, then nothing more until resume(). */
    pause() { if (length) send(); on = false; },
    resume() { if (closed) return; on = true; context.resume?.().catch(() => {}); },
    /** Words were matched up to `at`: nothing to do since stretches never overlap (kept for chase.js). */
    mark() {},
    /** A word was passed by hand: what was heard so far, and transcripts still on their way, are dropped. */
    cut() { gen++; drop(); },
    /** The page itself is about to make a sound (a word's reading): nothing is heard, or reported, until release(). */
    hold() { held = true; gen++; drop(); },
    release() { if (!held) return; held = false; gen++; drop(); },
    close() {
      closed = true;
      on = false;
      try { processor.disconnect(); source.disconnect(); mute.disconnect(); } catch {}
      stream.getTracks().forEach(track => track.stop());
      context.close?.().catch(() => {});
    }
  };
}
