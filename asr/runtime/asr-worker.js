// Norwegian speech recognition inside the page for 警察抓小偷's 朗读 mode: nb-whisper-base with a 6 s window
// (scripts/build_asr.py) run by transformers.js in this worker, so the game never freezes while it listens.
// The model files are fetched from asr/<model>/ beside this folder (weights in numbered chunks of at most 20 MB) and
// kept in the browser's Cache Storage ('transformers-cache'), so only the first use downloads them. The runtime is our
// bundle of transformers.js with onnxruntime-web's plain wasm build (scripts/build_asr.py). One thread: ort's threads
// need a cross-origin isolated page, which the site is not.
//   in:  {type:'load', model}  {type:'run', id, audio: Float32Array of 16 kHz samples, gen?: generation options}
//   out: {type:'progress', p}  {type:'loaded', ms}  {type:'error', message}  {type:'text', id, text, ms, error?}
import { pipeline, env } from './transformers.wasm.mjs';

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.remoteHost = new URL('../', import.meta.url).href;
env.remotePathTemplate = '{model}/';
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL('./', import.meta.url).href;
env.backends.onnx.wasm.numThreads = 1;

let asr = null, name = '';

self.onmessage = async ({ data }) => {
  if (data.type === 'load') {
    if (asr && name === data.model) { self.postMessage({ type: 'loaded', ms: 0 }); return; }
    const started = performance.now();
    try {
      asr = await pipeline('automatic-speech-recognition', data.model, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: p => self.postMessage({ type: 'progress', p: { status: p.status, file: p.file, loaded: p.loaded, total: p.total } })
      });
      // The first run is several times slower (buffers, compilation): spend it now on a second of silence.
      await asr(new Float32Array(16000), { language: 'norwegian', task: 'transcribe', max_new_tokens: 4 });
      name = data.model;
      self.postMessage({ type: 'loaded', ms: Math.round(performance.now() - started) });
    } catch (error) {
      asr = null;
      self.postMessage({ type: 'error', message: String(error && error.message || error) });
    }
  } else if (data.type === 'run') {
    const started = performance.now();
    try {
      const out = await asr(data.audio, { language: 'norwegian', task: 'transcribe', ...(data.gen || {}) });
      self.postMessage({ type: 'text', id: data.id, text: String(out && out.text || '').trim(), ms: Math.round(performance.now() - started) });
    } catch (error) {
      self.postMessage({ type: 'text', id: data.id, text: '', ms: Math.round(performance.now() - started), error: String(error && error.message || error) });
    }
  }
};
