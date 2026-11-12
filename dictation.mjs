/* Free speech for 考试与面试 (docs/exam-interview-plan.md): the speaking test and the A-team interview record what
   the learner says and write it down with the page's own recogniser (chase-speech.mjs, nb-whisper in a worker).
   Whisper hears at most 6 s and needs about 2 s of silence after the last word, so the speech is cut into stretches
   of at most 3.5 s at its pauses (createSegmenter, pure), and each stretch is transcribed in turn while the learner
   goes on talking. The same pass measures what fluency needs: seconds spoken, long pauses. Nothing leaves the
   device but the text. Loaded only when 考试与面试 asks for it; scripts/check_dictation.mjs runs the segmenter. */

const suffix = new URL(import.meta.url).search;   // ?v=… : one recogniser module for the whole site
let speech = null;
const loaded = import(`./chase-speech.mjs${suffix}`).then(module => (speech = module));

export const load = () => loaded;
export const supported = () => Boolean(speech?.supported());
export const isReady = () => Boolean(speech?.isReady());
export const prepare = onProgress => loaded.then(module => module.prepare(onProgress));

const RATE = 16000;
export const SEGMENT = {
  voice: .015,          // a block louder than this (RMS) is speech
  gap: .55,             // a pause this long closes a stretch
  longest: 3.5,         // a stretch never grows longer (the model's window minus the silence it needs)
  shortest: .3,         // stretches with less speech than this are breath and clicks, not words
  longPause: 2          // pauses this long count against fluency
};

/** Cuts a stream of 16 kHz blocks into stretches of speech. onSegment(samples, {start, end}) for each one.
 *  Reports the measurements fluency needs: speech seconds, long pauses, total seconds. */
export function createSegmenter({onSegment,onPause,rate = RATE,options = SEGMENT} = {}) {
  let parts = [], length = 0, voiced = 0, silent = 0, started = -1, total = 0, heardAny = false;
  let lastVoiceAt = -1, pausedFor = 0;
  const stats = {speech:0,longPauses:0,total:0};
  // carry: the part after the cut is speech (a stretch cut for length, mid-sentence) rather than the silence after it.
  const emit = (cut,carry = false) => {
    if (!length) return;
    const all = new Float32Array(length);
    let at = 0;
    for (const part of parts) { all.set(part,at); at += part.length; }
    const take = Math.min(length,cut ?? length), rest = all.slice(take);
    if (voiced/rate >= options.shortest) onSegment?.(all.slice(0,take),{start:started/rate,end:(started+take)/rate});
    parts = rest.length ? [rest] : []; length = rest.length; voiced = carry ? rest.length : 0; silent = 0;
    started = rest.length ? started+take : -1;
  };
  return {
    stats,
    push(block) {
      let sum = 0;
      for (const value of block) sum += value*value;
      const loud = Math.sqrt(sum/Math.max(1,block.length)) > options.voice, seconds = block.length/rate;
      total += block.length;
      stats.total = total/rate;
      if (loud) {
        if (heardAny && pausedFor >= options.longPause) stats.longPauses += 1;
        heardAny = true; pausedFor = 0; lastVoiceAt = total/rate;
        stats.speech += seconds;
      } else if (heardAny) {
        pausedFor += seconds;
        onPause?.(pausedFor);
      }
      if (!loud && !length) return;               // silence before speech is not kept
      if (started < 0) started = total-block.length;
      parts.push(block); length += block.length;
      if (loud) { voiced += block.length; silent = 0; } else silent += block.length;
      if (silent/rate >= options.gap) { emit(length-silent+Math.round(.15*rate)); return; }
      if (length/rate >= options.longest) {
        // Too long without a pause: cut at the quietest block of the last second, so a word is rarely split.
        let best = length, quiet = Infinity, at = 0;
        const from = length-rate;
        for (const part of parts) {
          for (let i = 0; i+256 <= part.length; i += 256) {
            if (at+i < from) continue;
            let energy = 0;
            for (let j = i; j < i+256; j++) energy += part[j]*part[j];
            if (energy < quiet) { quiet = energy; best = at+i+128; }
          }
          at += part.length;
        }
        emit(best,true);
      }
    },
    /** End of speech: the open stretch goes out too. */
    flush() { if (length && voiced) emit(); else { parts = []; length = 0; voiced = 0; silent = 0; started = -1; } },
    get pausedFor() { return pausedFor; },
    get heardAny() { return heardAny; },
    get lastVoiceAt() { return lastVoiceAt; }
  };
}

// Things Whisper writes for noise or silence, never for a learner's answer.
const NOISE = /^(teksting|tekst(et)? av|undertekst|takk for (at du så|oppmerksomheten)|musikk|\[.*\]|\(.*\)|…|\.+)$/i;
export function cleanPiece(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  // A stretch's text sometimes repeats its last words ("jeg liker jeg liker"): keep one.
  for (let size = 3; size >= 1; size--) {
    while (words.length >= size*2 && words.slice(-size).join(' ').toLowerCase() === words.slice(-size*2,-size).join(' ').toLowerCase()) words.splice(-size,size);
  }
  // Stutters and false starts ("Kan Kan K K Kan"): a letter or two without a vowel that begin the next word go, and
  // a word said again right away counts once (the hesitation itself is in the fluency measurements).
  const bare = word => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const kept = [];
  words.forEach((word,i) => {
    const b = bare(word), next = bare(words[i+1] || '');
    if (b && b.length <= 2 && !/[aeiouyæøåé0-9]/.test(b) && next.startsWith(b)) return;
    if (kept.length && b && bare(kept.at(-1)) === b) return;
    kept.push(word);
  });
  const joined = kept.join(' ');
  return NOISE.test(joined) ? '' : joined;
}

export const countWords = text => String(text || '').split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length;

/** Ask for the microphone inside the learner's tap and start writing down what is said.
 *  onText(fullText) as pieces come in; onLevel(rms); onPause(seconds of silence after speech).
 *  Resolves to {stop(): Promise<{text, metrics}>, close(), hold(), release()}. Rejects with code 'denied'|'none'. */
export async function record({onText,onLevel,onPause} = {}) {
  const module = speech || await loaded;
  const {context,stream} = await module.openInput();
  const rate = context.sampleRate;
  let source, processor, mute;
  try {
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(rate <= 24000 ? 1024 : 2048,1,1); mute = context.createGain();
    mute.gain.value = 0;
    source.connect(processor); processor.connect(mute); mute.connect(context.destination);
  } catch (error) {
    // The microphone is open but cannot be listened to (e.g. a browser that refuses a 16 kHz context for it).
    stream.getTracks().forEach(track => track.stop());
    context.close?.().catch(() => {});
    throw error;
  }
  const pieces = [], queue = [];
  let busy = false, held = false, closed = false, idle = null, generation = 0;
  const text = () => pieces.filter(Boolean).join(' ').replace(/\s+([.,!?])/g,'$1').trim();
  async function pump() {
    if (busy || !queue.length) { if (!busy && !queue.length) idle?.(); return; }
    busy = true;
    const {samples,index,gen} = queue.shift();
    let out = {text:''};
    try { out = await module.transcribeAudio(samples,{bonus:0}); } catch {}
    if (gen === generation) pieces[index] = cleanPiece(out.text);   // an answer started over drops older pieces
    busy = false;
    if (!closed) onText?.(text());
    pump();
  }
  let count = 0;
  const fresh = () => createSegmenter({onSegment:samples => { queue.push({samples,index:count++,gen:generation}); pump(); },onPause});
  let segmenter = fresh();
  const resample = block => {
    if (rate === RATE) return new Float32Array(block);
    const out = new Float32Array(Math.floor(block.length*RATE/rate)), step = rate/RATE;
    for (let i = 0; i < out.length; i++) { const x = i*step, j = Math.floor(x), f = x-j; out[i] = block[j]*(1-f)+(block[j+1] ?? block[j])*f; }
    return out;
  };
  processor.onaudioprocess = event => {
    if (held || closed) return;
    const block = resample(event.inputBuffer.getChannelData(0));
    let sum = 0;
    for (const value of block) sum += value*value;
    onLevel?.(Math.sqrt(sum/block.length));
    segmenter.push(block);
  };
  context.resume?.().catch(() => {});
  function close() {
    if (closed) return;
    closed = true;
    try { processor.disconnect(); source.disconnect(); mute.disconnect(); } catch {}
    stream.getTracks().forEach(track => track.stop());
    context.close?.().catch(() => {});
  }
  return {
    get stats() { return segmenter.stats; },
    get text() { return text(); },
    /** The page is about to speak (a question, the partner): what the microphone hears is not the learner. */
    hold() { held = true; segmenter.flush(); },
    release() { held = false; },
    /** Finish: the last stretch is transcribed, then the text and the measurements. The microphone stays open
     *  for the next answer until close(). */
    async stop() {
      segmenter.flush();
      held = true;
      // A recogniser that stopped answering (its worker died) must not keep the answer waiting: 20 s at most.
      if (busy || queue.length) {
        let limit;
        await Promise.race([new Promise(done => { idle = done; pump(); }),new Promise(done => { limit = setTimeout(done,20000); })]);
        clearTimeout(limit);
      }
      idle = null;
      const final = text(), stats = segmenter.stats, words = countWords(final);
      const metrics = {seconds:Math.round(stats.total),speechSeconds:Math.round(stats.speech*10)/10,words,
        wordsPerMinute:stats.speech >= 1 ? Math.round(words/(stats.total/60)) : 0,longPauses:stats.longPauses};
      return {text:final,metrics};
    },
    /** A new answer on the same microphone: forget what was heard. */
    reset() {
      generation += 1; pieces.length = 0; queue.length = 0; count = 0;
      segmenter = fresh();
      held = false;
    },
    close
  };
}
