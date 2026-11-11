// Norwegian speech recognition inside the page for 警察抓小偷's 朗读 mode: nb-whisper-base (scripts/build_asr.py) run by
// transformers.js in this worker, so the game never freezes while it listens.
// The model files are fetched from asr/<model>/ beside this folder (weights in numbered chunks of at most 20 MB) and
// kept in the browser's Cache Storage ('transformers-cache'), so only the first use downloads them. The runtime is our
// bundle of transformers.js with onnxruntime-web's plain wasm build (scripts/build_asr.py). ort's threads need a
// cross-origin isolated page; the site is not one today, so it runs on one thread there. On an isolated page
// (scripts/serve.py with NORSK_COI=1) four threads halve a pass (measured 2026-11-11: about 700 → 350 ms).
//
// A pass must be quick for the reader to see words light up as they are said, and it must not write nonsense, which
// holds the line (the 2026-11-11 measurements, see the notes in chase-speech.mjs):
//   * the encoder takes any length up to 6 s. Its work grows with the window, but Whisper needs real silence after
//     the last word: with under two seconds of zeros it repeats itself or writes syllables. So the audio gets 3 s of
//     zeros (not always the full 6 s), and the rest of the 6 s is filled with what the encoder makes of silence,
//     worked out once at load: the decoder then sees the long silence that tells it the text is over;
//   * a text that starts repeating itself is ended there and the repeat left out, and it never gets more tokens
//     than that much audio could hold;
//   * the words the reader is expected to say next get a bonus, so a near miss falls to the word in the text
//     (forstår, not foreslår) and a learner's accent is heard for what it means to say. Measured with voices of
//     other languages reading the text: 33 % of the words held the line without it, 20 % with 3.5; and with a
//     different text read aloud (about 250 passes each) at most one word was passed, with or without it. Where the
//     model would end the text, it ends: the bonus never makes it go on.
//   in:  {type:'load', model}
//        {type:'run', id, audio: Float32Array of 16 kHz samples, expect?: [words of the text], options?}
//   out: {type:'progress', p}  {type:'loaded', ms}  {type:'error', message}  {type:'text', id, text, ms, tokens, error?}
import { pipeline, env, LogitsProcessor, LogitsProcessorList, Tensor, cat } from './transformers.wasm.mjs';

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.remoteHost = new URL('../', import.meta.url).href;
env.remotePathTemplate = '{model}/';
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL('./', import.meta.url).href;
// Threads need a cross-origin isolated page (SharedArrayBuffer). Where the page is one, up to four are used
// (?threads=N on the worker's address sets another number, for measuring); elsewhere one.
const asked = Number(new URL(self.location.href).searchParams.get('threads')) || 4;
const threads = self.crossOriginIsolated ? Math.max(1, Math.min(asked, navigator.hardwareConcurrency || 1)) : 1;
env.backends.onnx.wasm.numThreads = threads;

const RATE = 16000, HOP = 320;         // samples a second; samples for one encoder position (two 10 ms frames)
const MAX_SECONDS = 6;                 // the encoder's position table (build_asr.py's SECONDS)
// tail: seconds of zeros after the audio; silence: seconds of silence states after that (up to the 6 s);
// bonus: for the expected words' tokens (logits); tokensPerSecond: the most text a second of audio may give;
// repeat: tokens that, written twice, end the text.
const DEFAULTS = { tail: 3, silence: 6, bonus: 3.5, tokensPerSecond: 7, repeat: 3 };
// Which files to load (build_asr.py's ENCODER / DECODER and their data chunks).
const FILES = { dtype: { encoder_model: 'uint8', decoder_model_merged: 'q8' }, use_external_data_format: { encoder_model: 2, decoder_model_merged: 4 } };

let asr = null, name = '', silence = null, prefix = 4, eos = 50257;
const paths = new Map();

async function encode(features) {
  const model = asr.model;
  return (await model._prepare_encoder_decoder_kwargs_for_generation({ inputs_tensor: features, model_inputs: { input_features: features },
    model_input_name: 'input_features', generation_config: model.generation_config })).encoder_outputs;
}
// `count` positions of the silence states from position `from` on.
function silenceTail(from, count) {
  const width = silence.dims[2];
  return new Tensor('float32', silence.data.slice(from * width, (from + count) * width), [1, count, width]);
}
// The text ends where its last `size` tokens were already written earlier in it (`found` then says so: those
// tokens are the start of a repeat and are left out of the text).
class EndOnRepeat extends LogitsProcessor {
  constructor(size) { super(); this.size = size; this.found = false; }
  _call(ids, logits) {
    const seq = ids[0], n = seq.length, size = this.size;
    if (!this.found && n - prefix >= size * 2) {
      search: for (let i = prefix; i + size * 2 <= n; i++) {
        for (let j = 0; j < size; j++) if (seq[i + j] !== seq[n - size + j]) continue search;
        this.found = true;
        break;
      }
    }
    if (this.found) {
      const data = logits[0].data;
      data.fill(-Infinity);
      data[eos] = 0;
    }
    return logits;
  }
}
// The expected words as token paths: at any point the first token of each word gets the bonus, and inside a word
// (the text so far ends with its first tokens) its next token. Where the model would end the text, it ends: the
// bonus never makes it go on with words nobody said.
class Expect extends LogitsProcessor {
  constructor(list, bonus) { super(); this.list = list; this.bonus = bonus; }
  _call(ids, logits) {
    const seq = ids[0], n = seq.length, data = logits[0].data, favoured = new Set();
    const end = data[eos];
    let ends = true;
    for (let i = 0; i < data.length; i++) if (data[i] > end) { ends = false; break; }
    if (ends) return logits;
    for (const path of this.list) {
      favoured.add(path[0]);
      for (let k = 1; k < path.length && k <= n - prefix; k++) {
        let same = true;
        for (let j = 0; j < k; j++) if (Number(seq[n - k + j]) !== path[j]) { same = false; break; }
        if (same) favoured.add(path[k]);
      }
    }
    for (const id of favoured) data[id] += this.bonus;
    return logits;
  }
}
// A word as Whisper may write it: after a space, as it stands, in small letters, or with a capital.
function wordPaths(words) {
  const list = [];
  for (const word of words || []) {
    const clean = String(word).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!clean) continue;
    for (const form of new Set([clean, clean.toLowerCase(), clean[0].toUpperCase() + clean.slice(1)])) {
      if (!paths.has(form)) paths.set(form, asr.tokenizer.encode(' ' + form, { add_special_tokens: false }));
      if (paths.get(form).length) list.push(paths.get(form));
    }
  }
  if (paths.size > 4000) paths.clear();
  return list;
}

async function transcribe(audio, expect, options) {
  const o = { ...DEFAULTS, ...(options || {}) }, model = asr.model;
  const samples = Math.min(MAX_SECONDS * RATE, Math.max(RATE, Math.ceil((audio.length + o.tail * RATE) / HOP) * HOP));
  const { input_features } = await asr.processor.feature_extractor(audio, { max_length: samples });
  let states = await encode(input_features);
  const have = states.dims[1], more = Math.min(silence.dims[1] - have, Math.round(o.silence * 50));
  if (more > 0) states = cat([states, silenceTail(have, more)], 1);
  const processors = new LogitsProcessorList(), repeat = o.repeat ? new EndOnRepeat(o.repeat) : null;
  if (repeat) processors.push(repeat);
  const list = o.bonus ? wordPaths(expect) : [];
  if (list.length) processors.push(new Expect(list, o.bonus));
  const out = await model.generate({ inputs: input_features, encoder_outputs: states, language: 'norwegian', task: 'transcribe',
    max_new_tokens: Math.max(6, Math.round(4 + o.tokensPerSecond * audio.length / RATE)), no_repeat_ngram_size: 4, logits_processor: processors });
  let tokens = Array.from(out.data, Number).slice(prefix).filter(id => id !== eos);
  const count = tokens.length;
  if (repeat?.found) tokens = tokens.slice(0, -o.repeat);
  return { text: asr.tokenizer.decode(tokens, { skip_special_tokens: true }).trim(), tokens: count };
}

self.onmessage = async ({ data }) => {
  if (data.type === 'load') {
    if (asr && name === data.model) { self.postMessage({ type: 'loaded', ms: 0 }); return; }
    const started = performance.now();
    try {
      asr = await pipeline('automatic-speech-recognition', data.model, {
        ...FILES,
        device: 'wasm',
        progress_callback: p => self.postMessage({ type: 'progress', p: { status: p.status, file: p.file, loaded: p.loaded, total: p.total } })
      });
      const model = asr.model, config = model.generation_config;
      // generate() takes the encoder's output ready-made (transcribe appends the silence states to it).
      if (!model.forward_params.includes('encoder_outputs')) model.forward_params = [...model.forward_params, 'encoder_outputs'];
      eos = Number(Array.isArray(config.eos_token_id) ? config.eos_token_id[0] : config.eos_token_id) || eos;
      // What the encoder makes of silence, for every position (and its first, slow run is spent here).
      silence = await encode((await asr.processor.feature_extractor(new Float32Array(RATE), { max_length: MAX_SECONDS * RATE })).input_features);
      // The decoder's first run is several times slower too (buffers, compilation): spend it now on a second of silence.
      prefix = 4;
      await transcribe(new Float32Array(RATE), [], {});
      name = data.model;
      self.postMessage({ type: 'loaded', ms: Math.round(performance.now() - started), threads });
    } catch (error) {
      asr = null;
      self.postMessage({ type: 'error', message: String(error && error.message || error) });
    }
  } else if (data.type === 'run') {
    const started = performance.now();
    try {
      const out = await transcribe(data.audio, data.expect, data.options);
      self.postMessage({ type: 'text', id: data.id, text: out.text, tokens: out.tokens, ms: Math.round(performance.now() - started) });
    } catch (error) {
      self.postMessage({ type: 'text', id: data.id, text: '', tokens: 0, ms: Math.round(performance.now() - started), error: String(error && error.message || error) });
    }
  }
};
