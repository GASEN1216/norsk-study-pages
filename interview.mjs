// Stable question IDs also identify the corresponding published audio files.
export const QUESTIONS = Object.freeze([
  {id:'ateam-01',no:'Hvordan er været i dag?',zh:'今天天气如何？'},
  {id:'ateam-02',no:'Når pleier dere å ha ungdomsmøter?',zh:'你们通常什么时候有年轻人聚会？'},
  {id:'ateam-03',no:'Hvor mange personer er det i menigheten din?',alternative:'Hvor mange mennesker er det i menigheten din?',zh:'你们教会有多少人？'},
  {id:'ateam-04',no:'Hva gjør du vanligvis på fritiden din?',zh:'你在空闲时间一般会做什么？'},
  {id:'ateam-05',no:'Hva jobber foreldrene dine med?',zh:'你的爸爸妈妈是做什么工作的？'},
  {id:'ateam-06',no:'Hvor mange personer er det i familien din?',zh:'你们家有多少人？'},
  {id:'ateam-07',no:'Hva slags frivillig arbeid (dugnad) gjør du vanligvis?',spoken:'Hva slags frivillig arbeid gjør du vanligvis?',zh:'你通常会做什么义工？'},
  {id:'ateam-08',no:'Hva er jobben din?',alternative:'Hva jobber du med?',zh:'你的工作是什么？'},
  {id:'ateam-09',no:'Hvordan ser en typisk dag ut for deg?',zh:'你的一天通常是怎么样的？'},
  {id:'ateam-10',no:'Hvorfor vil du komme til A-laget?',zh:'你为什么想要来 A-team？'},
  {id:'ateam-11',no:'Hvordan lærer du norsk?',zh:'你是如何学习挪威语的？'},
  {id:'ateam-12',no:'Når startet du å lære norsk?',zh:'你什么时候开始学习挪威语的？'},
  {id:'ateam-13',no:'Hva vil du jobbe med?',zh:'你想做什么类型的工作？'},
  {id:'ateam-14',no:'Hva er dine styrker og svakheter?',zh:'你的长处和短处是什么？'},
  {id:'ateam-15',no:'Hva vil du lære på A-laget?\nHva ønsker du å gjøre på A-laget?',zh:'你想在 A-team 学到什么东西？\n你希望在 A-team 做什么？'}
].map(Object.freeze));
// 2026-11-15 the picker offers whole banks (题库), not single questions to tick.
export const BANKS = Object.freeze([{id:'bank-1',title:'题库 1',note:'A-team 常见问题',questions:QUESTIONS}].map(Object.freeze));

// 怎么答 (2026-11-15): dist/data/exam/interview.json gives each question its three steps, more to say, words,
// sentence frames, a sample answer and the interviewer's follow-up questions. Anything malformed is left out.
export function validPrep(value) {
  const rows = Array.isArray(value?.questions) ? value.questions : [], prep = {};
  const text = item => typeof item === 'string' && item.trim() !== '';
  const pair = item => !!item && text(item.no) && text(item.zh);
  const list = (items,keep) => Array.isArray(items) ? items.filter(keep) : [];
  for (const q of QUESTIONS) {
    const row = rows.find(item => item?.id === q.id);
    if (!row) continue;
    prep[q.id] = {
      points:list(row.points,text),more:list(row.more,text),note:text(row.note) ? row.note : '',also:list(row.also,text),
      words:list(row.words,pair),frames:list(row.frames,pair),sample:pair(row.sample) ? row.sample : null,
      followUps:list(row.followUps,item => pair(item) && new RegExp(`^${q.id}-f\\d$`).test(item.id || ''))
        .map(item => ({id:item.id,no:item.no,zh:item.zh,answer:pair(item.answer) ? item.answer : null}))
    };
  }
  return prep;
}
const plain = value => String(value ?? '').replace(/\[\[|\]\]/g,'');

// Every round covers the chosen questions once, without repeating the last card across rounds.
export function createDeck(items = QUESTIONS,random = Math.random) {
  if (!items.length) throw new Error('The interview deck is empty.');
  let order = [], index = -1, round = 0, last;
  function next() {
    if (index+1 >= order.length) {
      order = [...items];
      for (let i = order.length-1;i > 0;i--) {
        const j = Math.floor(random()*(i+1));
        [order[i],order[j]] = [order[j],order[i]];
      }
      if (order.length > 1 && order[0].id === last) [order[0],order[1]] = [order[1],order[0]];
      index = -1;
      round++;
    }
    const question = order[++index];
    last = question.id;
    return {question,position:index+1,total:items.length,round};
  }
  return {next};
}

// Navigation cancels both audible playback and a play request that has not settled yet.
export function createPlayer({Audio = globalThis.Audio,synthesis = globalThis.speechSynthesis,Utterance = globalThis.SpeechSynthesisUtterance,
  stopOther = () => {},onchange = () => {},waitForVoices = () => new Promise(resolve => setTimeout(resolve,700))} = {}) {
  let token = 0, audio = null, utterance = null;
  const unavailable = '暂时播放不了，请再试一次。也可以先看题目练习。';
  function stop() {
    ++token;
    if (audio) { audio.onended = audio.onerror = null; audio.pause(); audio.removeAttribute?.('src'); audio.load?.(); audio = null; }
    if (utterance) { utterance.onend = utterance.onerror = null; synthesis?.cancel(); utterance = null; }
    onchange({status:'idle',message:''});
  }
  async function play(text,source) {
    stop();
    stopOther();
    const run = ++token;
    onchange({status:'loading',message:'正在准备…'});
    // A line whose address is still being looked up (点读) waits here; stopping meanwhile cancels it.
    let url = source?.url || '';
    if (!url && source?.find) {
      try { url = await source.find(); } catch { url = ''; }
      if (run !== token) return;
    }
    if (url && Audio) {
      const clip = new Audio(url);
      audio = clip;
      clip.preload = 'auto';
      clip.onended = () => { if (run === token) { audio = null; onchange({status:'idle',message:'听完了，试着回答吧。'}); } };
      clip.onerror = () => { if (run === token) { audio = null; onchange({status:'error',message:unavailable}); } };
      try {
        await clip.play();
        if (run !== token) { clip.pause(); return; }
        onchange({status:'playing',message:'正在播放问题…'});
        return;
      } catch {
        if (run !== token) return;
        clip.onended = clip.onerror = null;
        clip.pause();
        audio = null;
      }
    }
    if (run !== token) return;
    if (!synthesis || !Utterance) { onchange({status:'error',message:unavailable}); return; }
    let voices = synthesis.getVoices();
    if (!voices.length) { await waitForVoices(); voices = synthesis.getVoices(); }
    if (run !== token) return;
    const voice = voices.find(item => /^nb([-_]|$)/i.test(item.lang)) || voices.find(item => /^no([-_]|$)/i.test(item.lang));
    if (!voice) { onchange({status:'error',message:unavailable}); return; }
    const speech = new Utterance(text);
    utterance = speech;
    speech.voice = voice;
    speech.lang = voice.lang;
    speech.rate = .88;
    speech.onend = () => { if (run === token) { utterance = null; onchange({status:'idle',message:'听完了，试着回答吧。'}); } };
    speech.onerror = () => { if (run === token) { utterance = null; onchange({status:'error',message:unavailable}); } };
    onchange({status:'playing',message:'正在播放问题…'});
    try { synthesis.speak(speech); } catch { speech.onerror(); }
  }
  return {play,stop};
}

export function validManifest(value) {
  const rows = value?.recordings;
  if (!rows || typeof rows !== 'object' || Array.isArray(rows)) return {};
  const recordings = {};
  for (const q of QUESTIONS) {
    const row = rows[q.id];
    if (row && ['recording','synthetic'].includes(row.kind) && /^audio\/[\w/-]+\.(mp3|m4a|aac|ogg|opus|wav|webm|flac)$/i.test(row.file || '')) recordings[q.id] = row;
  }
  return recordings;
}

const ICONS = {
  sound:'<path d="m11 5-6 5H2v6h3l6 5V5Zm5 4a6 6 0 0 1 0 10m3-13a10 10 0 0 1 0 16"/>',
  play:'<path d="m9 5 12 8-12 8Z"/>',
  stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',
  next:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  flip:'<path d="M4 10a8 8 0 0 1 14-4l2 2M20 3v5h-5M20 14A8 8 0 0 1 6 20l-2-2M4 23v-5h5"/>',
  chat:'<path d="M23 12c0 4.4-3.6 8-8 8H7l-5 3 1.2-6A8 8 0 1 1 23 12Z"/><path d="M8 11h8M8 15h5"/>',
  close:'<path d="m7 7 12 12M19 7 7 19"/>',
  mic:'<rect x="10" y="3" width="6" height="12.5" rx="3"/><path d="M6 12.5a7 7 0 0 0 14 0M13 19.5v3"/>',
  check:'<path d="m5.5 13.5 5 5 10-11"/>',
  bulb:'<path d="M10 19.5h6M11 22.5h4M13 3a6.5 6.5 0 0 0-3.8 11.8c.6.5.8 1.1.8 1.8v.4h6v-.4c0-.7.3-1.3.8-1.8A6.5 6.5 0 0 0 13 3Z"/>',
  ask:'<path d="M22 12.5c0 4-3.6 7.5-8.5 7.5-1.2 0-2.3-.2-3.3-.5L5 21.5l1.3-4A7.2 7.2 0 0 1 5 12.5C5 8.4 8.8 5 13.5 5S22 8.4 22 12.5Z"/><path d="M11.6 10.6a2 2 0 1 1 2.6 1.9c-.5.2-.7.6-.7 1.1v.4M13.5 16.4v.1"/>',
  back:'<path d="M10 7 5 12l5 5"/><path d="M5 12h9a6 6 0 0 1 6 6v1"/>'
};
const icon = name => `<svg viewBox="0 0 26 26" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const MODES = [
  {id:'bilingual',title:'双语翻卡',note:'先读挪威语，翻面看中文',icon:'flip'},
  {id:'norwegian',title:'只看挪语',note:'只给问题，直接开口回答',icon:'chat'},
  {id:'audio',title:'听题回答',note:'随机听问题，再试着回答',icon:'sound'}
];
const modeRow = id => MODES.find(item => item.id === id) || MODES[0];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const lines = value => escapeHTML(value).replace(/\n/g,'<br>');
// [[…]] in a sample answer is what the learner swaps for their own facts; ___ in a frame is a blank to fill.
const swaps = value => escapeHTML(value).replace(/\[\[(.+?)\]\]/g,'<mark class="ai-swap">$1</mark>');
const blanks = value => escapeHTML(value).replace(/_{3,}/g,'<span class="ai-blank"><span class="sr-only">（空）</span></span>');
const CLIP = /^ateam-\d\d-(sample|f\d(-a)?)$/;
const PREP_TABS = [{id:'plan',title:'思路'},{id:'words',title:'词句'},{id:'sample',title:'示例'},{id:'follow',title:'追问'}];

// What a 怎么答 clip says: the sample answer, a follow-up question (Finn) or its short answer (-a).
export function clipText(question,p,clip) {
  if (!p || !CLIP.test(clip || '')) return '';
  if (clip === `${question.id}-sample`) return p.sample ? plain(p.sample.no) : '';
  const follow = p.followUps.find(item => item.id === clip.replace(/-a$/,''));
  if (!follow) return '';
  return clip.endsWith('-a') ? follow.answer?.no || '' : follow.no;
}

/* ----- 点读 (2026-11-15) ----- */
// Every Norwegian line a learner says after the sheet sounds when tapped: a line with its own recording plays that
// (the question, the follow-ups and their answers); a word from the textbooks plays the site's word reading
// (data/pronunciation.json, as 单词表 does); any other line is read by the site's /tts, in the voice of the sample
// answers, made once on the server and kept there for everyone.
const SAY = /^(word|frame|also|sample|better)-(\d{1,2})$/;
// A sample answer or a suggestion, sentence by sentence (marks kept). No lookbehind: older Safari cannot parse it.
export function sentences(value) {
  return String(value ?? '').replace(/([.!?])\s+/g,'$1\u0001').split('\u0001').map(item => item.trim()).filter(Boolean);
}
// What the reader is given: a blank (___) is a pause, and "varmt / kaldt" two words one after the other.
export function spokenText(value) {
  return plain(value).replace(/_{3,}/g,'...').replace(/\s*\/\s*/g,', ').replace(/\s+/g,' ').trim();
}
// The text of a tapped line of the sheet ('' for anything unknown); better-N comes from the AI's suggestion.
export function sayText(question,p,key,better = '') {
  if (!p || typeof key !== 'string') return '';
  if (CLIP.test(key)) return clipText(question,p,key);
  const match = SAY.exec(key);
  if (!match) return '';
  const index = Number(match[2]);
  if (match[1] === 'word') return p.words[index]?.no || '';
  if (match[1] === 'frame') return p.frames[index]?.no || '';
  if (match[1] === 'also') return p.also[index] || '';
  if (match[1] === 'sample') return p.sample ? sentences(p.sample.no)[index] || '' : '';
  return sentences(better)[index] || '';
}
const WORD_FILE = /^pronunciation\/[0-9a-f]{20}\.mp3$/, TTS_FILE = /^\/tts\/[0-9a-f]{64}\.mp3$/;
// Where a line without a recording is read from. The word list is fetched once; the server is asked one request at a
// time (it reads one batch at a time), six lines each, a tapped line before the ones only looked up in advance. A line
// the server could not read is asked again on the next tap; over the day's limit it is not asked again this visit.
export function createVoices({request = null,loadWords = () => Promise.resolve({}),apiURL = path => path,batch = 6} = {}) {
  const voiced = new Map(), queue = [];
  let words = null, wordsLoading = null, busy = false, quiet = false, scheduled = false;
  // Lines looked up together (a tab as it opens) go out in one request.
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; drain(); });
  }
  function wordTable() {
    if (words) return Promise.resolve(words);
    wordsLoading ||= Promise.resolve().then(loadWords).then(value => { words = value && typeof value === 'object' ? value : {}; return words; })
      .catch(() => ({})).finally(() => { wordsLoading = null; });
    return wordsLoading;
  }
  function wordFile(word) {
    if (!words || !word) return '';
    const row = words[word] ?? words[word.toLocaleLowerCase('nb')], file = typeof row === 'string' ? row : row?.file;
    return WORD_FILE.test(file || '') ? file : '';
  }
  // The address when it is known already (then a tap plays at once, inside the tap as iOS wants), else ''.
  function known({text,word = ''}) {
    const done = voiced.get(text);
    return wordFile(word) || (typeof done === 'string' ? done : '');
  }
  async function drain() {
    if (busy || !queue.length) return;
    busy = true;
    const texts = queue.splice(0,batch);
    let clips = [];
    try { clips = (await request('/tts',{method:'POST',body:{texts}}))?.clips || []; }
    catch (error) { if (['tts_quota','tts_unavailable'].includes(error?.code)) quiet = true; }
    for (const text of texts) {
      const waiting = voiced.get(text), path = clips.find(clip => clip?.text === text)?.path;
      const url = typeof path === 'string' && TTS_FILE.test(path) ? apiURL(path) : '';
      if (url) voiced.set(text,url); else voiced.delete(text);
      waiting?.settle?.(url);
    }
    if (quiet) for (const text of queue.splice(0)) { const waiting = voiced.get(text); voiced.delete(text); waiting?.settle?.(''); }
    busy = false;
    schedule();
  }
  function ask(text,first) {
    const waiting = voiced.get(text);
    if (typeof waiting === 'string') return Promise.resolve(waiting);
    if (waiting) {
      const at = queue.indexOf(text);
      if (first && at > 0) { queue.splice(at,1); queue.unshift(text); }
      return waiting;
    }
    if (!request || quiet) return Promise.resolve('');
    let settle;
    const promise = new Promise(resolve => { settle = resolve; });
    promise.settle = settle;
    voiced.set(text,promise);
    if (first) queue.unshift(text); else queue.push(text);
    schedule();
    return promise;
  }
  // The address of a line, looking it up: a word in the word list, else the server ('' when neither can read it).
  async function find(item,first = false) {
    if (item.word) { await wordTable(); const file = wordFile(item.word); if (file) return file; }
    return ask(item.text,first);
  }
  return {known,find};
}

const prepPlay = (clip,label,playing,text = '') => `<button type="button" class="ai-prep-play${text ? ' has-label' : ''}${playing === clip ? ' is-playing' : ''}" data-interview="prep-play" data-clip="${clip}" aria-label="${label}">${icon('sound')}${text ? `<span>${text}</span>` : ''}</button>`;
// The line that sounds is lit (is-playing; is-loading while its reading is fetched).
const lit = (key,{playing = '',state = ''} = {}) => playing === key ? (state === 'loading' ? ' is-playing is-loading' : ' is-playing') : '';
// A row that reads its Norwegian when tapped: the words, the frames and the other ways to ask.
const sayRow = (key,no,zh,o) => `<button type="button" class="ai-say ai-say-row${lit(key,o)}" data-interview="say" data-say="${key}"><span class="ai-say-copy"><span lang="nb">${no}</span>${zh ? `<small>${zh}</small>` : ''}</span>${icon('sound')}<span class="sr-only">（听读音）</span></button>`;
// Sentences inside a paragraph stay inline (a button would break the paragraph's flow), so they are spans with role=button.
export const saySentences = (prefix,value,o,format = escapeHTML) => sentences(value).map((item,index) => `<span class="ai-say ai-say-text${lit(`${prefix}-${index}`,o)}" role="button" tabindex="0" data-interview="say" data-say="${prefix}-${index}">${format(item)}</span>`).join(' ');
// A follow-up or its answer: the whole line is the button; the round speaker shows that it sounds.
const sayLine = (key,no,o) => `<button type="button" class="ai-say ai-prep-line${lit(key,o)}" data-interview="say" data-say="${key}"><span class="ai-prep-line-text" lang="nb">${escapeHTML(no)}</span><span class="ai-prep-play" aria-hidden="true">${icon('sound')}</span><span class="sr-only" lang="zh-CN">（听读音）</span></button>`;

function prepPanel(question,p,tab,{zh,playing,state,step}) {
  const o = {playing,state};
  if (tab === 'words') return `
    ${p.words.length ? `<section class="ai-prep-section"><h3>词汇</h3><ul class="ai-prep-words">${p.words.map((item,index) => `<li>${sayRow(`word-${index}`,escapeHTML(item.no),escapeHTML(item.zh),o)}</li>`).join('')}</ul></section>` : ''}
    ${p.frames.length ? `<section class="ai-prep-section"><h3>句型</h3><ul class="ai-prep-frames">${p.frames.map((item,index) => `<li>${sayRow(`frame-${index}`,blanks(item.no),blanks(item.zh),o)}</li>`).join('')}</ul></section>` : ''}`;
  if (tab === 'sample') return p.sample ? `
    <p class="ai-prep-lead">点一句听一句，跟着说。</p>
    <section class="ai-prep-section ai-prep-sample">
      <div class="ai-prep-sample-head"><h3>示例回答</h3>${prepPlay(`${question.id}-sample`,'听示例回答',playing,'听示例')}</div>
      <p class="ai-prep-sample-no" lang="nb">${saySentences('sample',p.sample.no,o,swaps)}</p>
      ${zh ? `<p class="ai-prep-sample-zh">${swaps(p.sample.zh)}</p>` : ''}
      <div class="ai-prep-sample-foot"><span class="ai-prep-legend"><i aria-hidden="true"></i>金色部分换成你自己的情况</span><button type="button" class="ai-prep-zh" data-interview="prep-zh" aria-pressed="${zh}">${zh ? '收起中文' : '看中文'}</button></div>
    </section>` : '';
  if (tab === 'follow') return `
    <p class="ai-prep-lead">答完以后，老师常会接着问。先自己试着答，再看参考。</p>
    <ol class="ai-prep-follow">${p.followUps.map((item,index) => `<li${index === step-1 ? ' class="is-current"' : ''}>
      ${sayLine(item.id,item.no,o)}
      <small>${escapeHTML(item.zh)}</small>
      ${item.answer ? `<details class="ai-prep-ref"${index === step-1 ? ' open' : ''}><summary>参考回答</summary>${sayLine(`${item.id}-a`,item.answer.no,o)}<small>${escapeHTML(item.answer.zh)}</small></details>` : ''}
    </li>`).join('')}</ol>
    ${step ? '' : `<button type="button" class="ai-start-button ai-prep-go" data-interview="prep-follow">练习追问${icon('next')}</button>`}`;
  return `
    ${p.points.length ? `<section class="ai-prep-section"><h3>三步答</h3><ol class="ai-prep-steps">${p.points.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ol></section>` : ''}
    ${p.more.length ? `<section class="ai-prep-section"><h3>还可以说</h3><ul class="ai-prep-more">${p.more.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul></section>` : ''}
    ${p.note ? `<aside class="ai-prep-note"><strong>注意</strong><p>${escapeHTML(p.note)}</p></aside>` : ''}
    ${p.also.length ? `<section class="ai-prep-section"><h3>老师也可能这样问</h3><ul class="ai-prep-also">${p.also.map((item,index) => `<li>${sayRow(`also-${index}`,escapeHTML(item),'',o)}</li>`).join('')}</ul></section>` : ''}`;
}

// The 怎么答 sheet for one question: 思路 · 词句 · 示例 · 追问. playing is the line that sounds, state its player's state.
export function prepMarkup(question,p,{tab = 'plan',zh = false,playing = '',state = '',step = 0} = {}) {
  const tabs = PREP_TABS.filter(item => (item.id !== 'follow' || p.followUps.length) && (item.id !== 'sample' || p.sample));
  const current = tabs.some(item => item.id === tab) ? tab : tabs[0].id;
  return `<div class="ai-prep-card">
    <header class="ai-prep-head">
      <div class="ai-prep-title"><h2 id="ai-prep-title" tabindex="-1" lang="nb"><button type="button" class="ai-say ai-say-title${lit('q',{playing,state})}" data-interview="say" data-say="q">${lines(question.no).replace(/(\S+)$/,`<span class="ai-say-end">$1${icon('sound')}</span>`)}<span class="sr-only" lang="zh-CN">（听问题）</span></button></h2><p>${lines(question.zh)}</p></div>
      <button type="button" class="ai-dialog-close" data-interview="prep-close" aria-label="关闭">${icon('close')}</button>
    </header>
    <div class="ai-prep-tabs" role="tablist" aria-label="怎么答">${tabs.map(item => `<button type="button" role="tab" class="ai-prep-tab" id="ai-prep-tab-${item.id}" data-interview="prep-tab" data-tab="${item.id}" aria-selected="${item.id === current}" aria-controls="ai-prep-panel" tabindex="${item.id === current ? 0 : -1}">${item.title}</button>`).join('')}</div>
    <div class="ai-prep-body" id="ai-prep-panel" role="tabpanel" aria-labelledby="ai-prep-tab-${current}" tabindex="0">${prepPanel(question,p,current,{zh,playing,state,step})}</div>
  </div>`;
}

export function createInterview(deps = {}) {
  const escape = escapeHTML;
  let screen = 'idle', mode = 'bilingual', bank = BANKS[0].id;
  // step 0 is the question itself; 1… are the interviewer's follow-ups (老师追问) on it.
  let deck = null, card = null, transition = '', step = 0;
  let flipped = false, revealed = false, root = null, listened = false;
  let audioFiles = {}, audioState = 'idle', audioMessage = '', loading = null, loaded = false;
  let prep = {}, prepLoading = null, prepLoaded = false;
  let sheetTab = 'plan', sheetZh = false, sheetClip = '', sheetPending = '', sheetState = 'idle';
  // 开口回答 (2026-11-12): the learner answers aloud; dictation.mjs writes it down on the device and the site's AI
  // (POST /ai/grade, part interview) says whether it answers the question and how to say it better.
  let answer = {status:'idle'}, recorder = null, dictation = null, answerTimer = null, answerRun = 0;
  const versioned = path => `${path}${deps.version ? `?v=${encodeURIComponent(deps.version)}` : ''}`;
  const active = () => ['loading','playing'].includes(audioState);
  function updateAudio(value) {
    audioState = value.status;
    audioMessage = value.message;
    if (!root) return;
    const status = root.querySelector('.ai-audio-status');
    if (status) { status.textContent = audioMessage; status.dataset.state = audioState; }
    root.querySelector('.ai-practice')?.classList.toggle('is-playing',audioState === 'playing');
    root.querySelector('.ai-practice')?.classList.toggle('is-loading',audioState === 'loading');
    const stop = root.querySelector('[data-interview="stop"]');
    if (stop) stop.hidden = !active();
    for (const button of root.querySelectorAll('[data-interview="play"]')) {
      button.disabled = audioState === 'loading';
      button.setAttribute('aria-label',playLabel());
    }
    for (const label of root.querySelectorAll('[data-ai-play-label]')) label.textContent = playLabel();
  }
  // The sheet's lines (and the AI's suggestion under an answer): the line that sounds is lit; tapping it again stops it.
  function updateSheetAudio(value) {
    sheetState = value.status;
    sheetClip = ['loading','playing'].includes(sheetState) ? sheetPending : '';
    if (!root) return;
    if (sheetState === 'error') sayFailed();
    for (const node of root.querySelectorAll('[data-say],[data-interview="prep-play"]')) {
      const on = !!sheetClip && (node.dataset.say || node.dataset.clip) === sheetClip;
      node.classList.toggle('is-playing',on);
      node.classList.toggle('is-loading',on && sheetState === 'loading');
    }
  }
  // The question card and the 怎么答 sheet each have a player; either one quiets the other and the site's audio.
  const player = createPlayer({stopOther:() => { deps.stopAudio?.(); sheetPlayer.stop(); },onchange:updateAudio});
  const sheetPlayer = createPlayer({stopOther:() => { deps.stopAudio?.(); player.stop(); },onchange:updateSheetAudio});
  function stopAudio() { player.stop(); sheetPlayer.stop(); }
  const playLabel = () => audioState === 'loading' ? '正在准备…' : audioState === 'error' ? '重新播放' : listened ? '再听一次' : '听问题';
  const follows = () => prep[card?.question?.id]?.followUps || [];
  // What the card asks now: the question, or the follow-up chosen on the chain.
  function asked() {
    const q = card?.question;
    if (!q) return null;
    const follow = step ? follows()[step-1] : null;
    return follow ? {...follow,follow:true} : q;
  }
  function norwegian(q) {
    return `<span lang="nb">${escape(q.no).replace(/\n/g,'<br>')}</span>${q.alternative ? `<span class="ai-alternative" lang="nb">${escape(q.alternative)}</span>` : ''}`;
  }
  const playButton = (large = false) => `<button type="button" class="${large ? 'ai-listen' : 'ai-hear'}" data-interview="play"${audioState === 'loading' ? ' disabled' : ''} aria-label="${playLabel()}">${icon(large ? 'play' : 'sound')}<span data-ai-play-label>${playLabel()}</span>${large ? '<span class="ai-sound-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>' : ''}</button>`;
  function focusTarget(name) {
    if (!root) return null;
    if (name === 'card') return root.querySelector('.ai-card');
    if (name === 'step') return root.querySelector('[data-interview="step"][aria-pressed="true"]');
    return root.querySelector(`[data-interview="${name}"]`);
  }
  function render(focus = '',motion = '') {
    if (!root) return;
    transition = motion;
    // While a session is under way the site's top bar steps aside (styles.css .practice-focus); its own ✕ leads out.
    document.body?.classList.toggle('practice-focus',screen === 'session');
    root.innerHTML = screen === 'session' ? sessionMarkup() : `${idleMarkup()}${dialogMarkup()}`;
    transition = '';
    if (focus) focusTarget(focus)?.focus({preventScroll:true});
  }
  const dialogEl = () => root?.querySelector('.ai-dialog');
  function openDialog() {
    const dialog = dialogEl();
    if (!dialog || dialog.open) return;
    dialog.showModal?.();
    dialog.querySelector('.ai-dialog-title h2')?.focus?.({preventScroll:true});
  }
  function closeDialog() { dialogEl()?.close?.(); }
  const bankRow = () => BANKS.find(item => item.id === bank) || BANKS[0];
  function selectedItems() { return bankRow().questions; }
  function idleMarkup() {
    return `<section class="ai-app ai-idle" aria-labelledby="ai-title">
      <header class="ai-heading"><p class="ai-kicker">A-TEAM · 面试练习</p><h2 id="ai-title">A-team 面试</h2><p>15 个常见问题，带答题思路和老师追问。</p></header>
      <div class="ai-idle-card"><p>还没有开始练习。</p><button type="button" class="ai-start-button" data-interview="open">选择题库${icon('next')}</button></div>
    </section>`;
  }
  function resumeRow() {
    if (!card) return '';
    return `<div class="ai-resume"><span class="ai-resume-icon">${icon('play')}</span><div><strong>继续上次的练习</strong><span>第 ${card.position} / ${card.total} 题</span></div><button type="button" class="ai-resume-go" data-interview="resume">继续</button></div>`;
  }
  const summary = () => `${bankRow().title} · ${bankRow().questions.length} 题 · ${modeRow(mode).title}`;
  function dialogMarkup() {
    return `<dialog class="ai-dialog" aria-labelledby="ai-dialog-title">
      <div class="ai-dialog-card">
        <div class="ai-dialog-head">
          <span class="ai-dialog-icon">${icon('chat')}</span>
          <div class="ai-dialog-title"><h2 id="ai-dialog-title" tabindex="-1">A-team 面试</h2><p>选好练习方式，再开口回答。</p></div>
          <button type="button" class="ai-dialog-close" data-interview="close" aria-label="关闭">${icon('close')}</button>
        </div>
        <div class="ai-dialog-body">
          ${resumeRow()}
          <div class="ai-dialog-block">
            <span class="ai-dialog-label">练习方式</span>
            <div class="ai-mode-row" role="group" aria-label="练习方式">${MODES.map(item => `<button type="button" class="ai-mode-chip" data-interview="mode" data-mode="${item.id}" aria-pressed="${mode === item.id}">${icon(item.icon)}<span>${item.title}</span></button>`).join('')}</div>
          </div>
          <div class="ai-dialog-block">
            <span class="ai-dialog-label">题库</span>
            <div class="ai-bank-list" role="radiogroup" aria-label="题库">${BANKS.map(item => `<button type="button" role="radio" class="ai-bank" data-interview="bank" data-bank="${item.id}" aria-checked="${item.id === bank}"><span class="ai-bank-mark" aria-hidden="true">${icon('check')}</span><span class="ai-bank-text"><strong>${item.title}</strong><small>${item.note} · ${item.questions.length} 题</small></span></button>`).join('')}</div>
          </div>
        </div>
        <div class="ai-dialog-foot"><span data-ai-summary>${summary()}</span><button type="button" class="ai-start-button" data-interview="start">开始练习${icon('next')}</button></div>
      </div>
    </dialog>`;
  }
  function updateDialog() {
    const dialog = dialogEl();
    if (!dialog) return;
    const line = dialog.querySelector('[data-ai-summary]');
    if (line) line.textContent = summary();
    for (const button of dialog.querySelectorAll('[data-interview="mode"]')) button.setAttribute('aria-pressed',String(button.dataset.mode === mode));
    for (const button of dialog.querySelectorAll('[data-interview="bank"]')) button.setAttribute('aria-checked',String(button.dataset.bank === bank));
  }
  function cardMarkup(q,motion) {
    const follow = q.follow ? ' is-follow' : '', eyebrow = q.follow ? '老师追问' : '挪威语问题';
    if (mode === 'bilingual') return `<button type="button" class="ai-card${follow}${flipped ? ' is-back' : ''}${motion}" data-interview="flip" aria-pressed="${flipped}" title="按空格或回车翻面"><span class="ai-card-eyebrow">${flipped ? '中文意思' : eyebrow}</span><span class="ai-card-text"${flipped ? ' lang="zh-CN"' : ''}>${flipped ? escape(q.zh).replace(/\n/g,'<br>') : norwegian(q)}</span><span class="ai-card-foot">${icon('flip')}${flipped ? '回到挪威语' : '点击翻面 · 看中文'}</span></button>`;
    if (mode === 'norwegian') return `<div class="ai-card${follow}${motion}" tabindex="-1"><span class="ai-card-eyebrow">${eyebrow}</span><div class="ai-card-text">${norwegian(q)}</div><span class="ai-card-foot">想一想，试着说出来</span></div>`;
    return `<div class="ai-card ai-card-audio${follow}${motion}" tabindex="-1">${q.follow ? `<span class="ai-card-eyebrow">${eyebrow}</span>` : ''}${playButton(true)}${revealed ? `<div class="ai-transcript">${norwegian(q)}</div>` : ''}<button type="button" class="ai-text-button ai-reveal" data-interview="reveal" aria-expanded="${revealed}">${revealed ? '收起题目' : '查看题目'}</button></div>`;
  }
  // The chain above the card: 原题 · 追问 1 · 追问 2 …, and 怎么答 at its end.
  function chainMarkup() {
    const p = prep[card.question.id];
    if (!p) return '';
    const labels = ['原题',...p.followUps.map((_,index) => `追问 ${index+1}`)];
    const chain = p.followUps.length ? `<div class="ai-chain" role="group" aria-label="原题和老师追问">${labels.map((label,index) => `<button type="button" class="ai-chain-step${index ? ' is-follow' : ''}" data-interview="step" data-step="${index}" aria-pressed="${index === step}">${label}</button>`).join('')}</div>` : '<span></span>';
    return `${chain}<button type="button" class="ai-prep-open" data-interview="prep" aria-haspopup="dialog">${icon('bulb')}<span>怎么答</span></button>`;
  }
  function sessionMarkup() {
    const q = asked(), end = card.position === card.total, single = card.total === 1;
    const motion = transition ? ` is-${transition}` : '';
    return `<section class="ai-app ai-session" aria-labelledby="ai-title">
      <h2 id="ai-title" class="sr-only">A-team 面试</h2>
      <div class="ai-session-bar">
        <button type="button" class="ai-exit" data-interview="exit" aria-label="结束练习，回到更多">${icon('close')}<span>结束</span></button>
        <div class="ai-session-meta"><strong>${bankRow().title}</strong><span>${modeRow(mode).title}${mode === 'audio' ? ' · 随机出题' : ''} · 第 ${card.round} 轮</span></div>
        <span class="ai-session-count"><b>${card.position}</b> / ${card.total}</span>
      </div>
      <div class="ai-progress-track" role="progressbar" aria-label="本轮题目" aria-valuemin="0" aria-valuemax="${card.total}" aria-valuenow="${card.position}"><i style="width:${card.position/card.total*100}%"></i></div>
      <div class="ai-practice${audioState === 'playing' ? ' is-playing' : ''}${audioState === 'loading' ? ' is-loading' : ''}">
        <div class="ai-chain-row" data-ai-chain>${chainMarkup()}</div>
        ${cardMarkup(q,motion)}
        <div class="ai-controls"><div class="ai-audio-controls">${mode !== 'audio' ? playButton() : ''}<button type="button" class="ai-stop" data-interview="stop" aria-label="停止播放"${active() ? '' : ' hidden'}>${icon('stop')}<span>停止</span></button></div><button type="button" class="ai-next" data-interview="next" title="按右方向键${mode === 'audio' ? '随机播放' : '进入'}下一题">${end ? (single ? '再练一遍' : '再练一轮') : mode === 'audio' ? '随机下一题' : '下一题'}${icon('next')}</button></div>
        <p class="ai-audio-status" data-state="${audioState}" role="status" aria-live="polite">${escape(audioMessage)}</p>
        ${mode !== 'bilingual' && deps.request ? answerMarkup() : ''}
        ${end ? `<p class="ai-round-note">${single ? '这一题练完了，可以再练一遍，或结束回到更多。' : '这轮最后一题，回答后可以再练一轮。'}</p>` : ''}
      </div>
    </section>`;
  }
  /* ----- 开口回答 ----- */
  // 开口回答 is one warm strip under the question that changes in place: 开口回答 → 正在听你说 → 正在整理 → the feedback.
  function answerMarkup() {
    const a = answer;
    const label = (title,note = '') => `<span class="ai-answer-label"><strong>${title}</strong>${note ? `<small>${note}</small>` : ''}</span>`;
    const mic = (extra = '') => `<span class="ai-answer-mic${extra}" aria-hidden="true">${icon('mic')}</span>`;
    const spinner = '<span class="ai-answer-spinner" aria-hidden="true"></span>';
    if (a.status === 'idle') return `<div class="ai-answer is-idle"><button type="button" class="ai-answer-start" data-interview="answer-start">${mic()}${label('开口回答','说完后 AI 告诉你答到没有、怎样说更自然')}</button></div>`;
    if (a.status === 'loading') return `<div class="ai-answer is-busy" role="status">${spinner}${label('马上就好…')}</div>`;
    // What the recogniser writes is not shown while the learner speaks: it is often not quite what was said, and it
    // comes a moment late (2026-11-12). The ring shows that the page is hearing.
    if (a.status === 'recording') return `<div class="ai-answer is-live">${mic(' is-live')}${label('正在听你说','<b data-ai-answer-clock>0:00</b> · 停一会儿会自动结束')}<button type="button" class="ai-start-button ai-answer-done" data-interview="answer-done">说完了</button></div>`;
    if (a.status === 'writing' || a.status === 'grading') return `<div class="ai-answer is-busy" role="status">${spinner}${a.status === 'writing' ? label('正在整理你说的话…') : label('AI 正在点评…','通常几秒钟，最长半分钟')}</div>`;
    if (a.status === 'error') return `<div class="ai-answer is-error" role="alert">${mic(' is-quiet')}${label(escape(a.error))}<button type="button" class="ai-answer-again" data-interview="${a.text ? 'answer-retry' : 'answer-start'}">${a.text ? '重新点评' : '再试一次'}</button></div>`;
    const r = a.result || {};
    const mistakes = (r.mistakes || []).map(item => `<li><s lang="nb">${escape(item.wrong)}</s><b lang="nb">${escape(item.right)}</b><small>${escape(item.why)}</small></li>`).join('');
    // First what matters: did it answer the question, and how to say it. The transcript (which may be off), the
    // corrected version and the single mistakes wait behind 看识别到的文字.
    const heard = `<div class="ai-answer-compare"><div><small>识别到的文字（可能不准）</small><p lang="nb">${escape(a.text)}</p></div>${r.corrected ? `<div><small>改正后</small><p lang="nb">${escape(r.corrected)}</p></div>` : ''}</div>${mistakes ? `<ul class="ai-answer-mistakes">${mistakes}</ul>` : ''}`;
    // A real interviewer goes on asking: the feedback leads straight to the next follow-up.
    const onward = step < follows().length ? `<button type="button" class="ai-answer-follow" data-interview="step-next">${icon('ask')}<span>老师接着问</span>${icon('next')}</button>` : '';
    return `<div class="ai-answer is-done"><div class="ai-answer-head"><div class="ai-answer-verdict ${r.answered ? 'is-yes' : 'is-no'}">${icon(r.answered ? 'check' : 'close')}<strong>${r.answered ? '答到问题了' : '还没答到这个问题'}</strong></div><button type="button" class="ai-answer-again" data-interview="answer-start">${icon('mic')}再答一次</button></div>
      ${r.comment ? `<p class="ai-answer-comment">${escape(r.comment)}</p>` : ''}
      ${r.better ? `<figure class="ai-answer-better"><figcaption>可以这样说<span>点句子听读音</span></figcaption><p lang="nb">${saySentences('better',r.better,{playing:sheetClip,state:sheetState})}</p></figure>` : ''}
      <details class="ai-answer-more"><summary>看识别到的文字${mistakes ? '和改错' : ''}</summary>${heard}</details>${onward}</div>`;
  }
  function updateAnswer(focus = '') {
    const slot = root?.querySelector('.ai-answer');
    if (!slot) return;
    const box = document.createElement('div');
    box.innerHTML = answerMarkup();
    slot.replaceWith(box.firstElementChild);
    if (focus) root.querySelector(focus)?.focus?.({preventScroll:true});
    if (answer.status === 'done') prepareSay(root.querySelector('.ai-answer'));
  }
  function resetAnswer() {
    answerRun += 1;
    clearInterval(answerTimer); answerTimer = null;
    recorder?.hold();
    answer = {status:'idle'};
  }
  function closeRecorder() { resetAnswer(); recorder?.close(); recorder = null; }
  // The recogniser takes several seconds to start each time the page opens: once it is downloaded, it starts in the
  // background as soon as a practice begins, so 开口回答 rarely waits for it.
  // The speech module and the server's answer to /ai/status come in while the first question is read.
  function warmRecogniser() {
    import(versioned('./dictation.mjs')).then(module => { dictation ||= module; return module.load().then(() => module.serverASR(deps.request)); }).catch(() => {});
  }
  // Inside the tap: the microphone opens first (iOS opens audio only there), then the recogniser loads.
  async function startAnswer() {
    stopAudio();
    const run = ++answerRun, question = asked();
    if (!question) return;
    answer = {status:'loading',progress:null};
    updateAnswer();
    const fail = message => { if (run === answerRun) { answer = {status:'error',error:message}; updateAnswer(); } };
    try {
      dictation ||= await import(versioned('./dictation.mjs'));
      await dictation.load();
      if (!dictation.supported()) { fail('这个浏览器用不了开口回答，可以换新版 Chrome、Edge 或 Safari。'); return; }
      // The server writes speech down (dictation.mjs); without it there is nothing to grade.
      if (!(await dictation.serverASR(deps.request))) { fail(dictation.unavailableNote('开口回答暂时用不了（语音识别没有开启），请稍后再试。')); return; }
      if (!recorder) {
        const opened = await dictation.record({
          onText:text => { if (answer.status === 'recording') answer.text = text; },
          onLevel:level => { root?.querySelector('.ai-answer-mic')?.style.setProperty('--level',Math.min(1,level*14).toFixed(2)); },
          onPause:seconds => { if (answer.status === 'recording' && seconds >= 3.2 && recorder?.stats.speech > .6) finishAnswer(); },
          // The server writes each stretch down as it comes (the question helps it spell what is said).
          transcribe:dictation.serverTranscriber(deps.request,() => answer.question || asked()?.id)
        });
        // Ended, moved on or went to the background while the browser asked for the microphone: close it again.
        if (run !== answerRun || !root) { opened.close(); return; }
        if (document.hidden) { opened.close(); resetAnswer(); updateAnswer(); return; }
        recorder = opened;
      }
      recorder.hold();
      recorder.reset(); recorder.release();
      answer = {status:'recording',text:'',started:Date.now(),question:question.id};
      updateAnswer('[data-interview="answer-done"]');
      answerTimer = setInterval(() => {
        const seconds = (Date.now()-answer.started)/1000, clock = root?.querySelector('[data-ai-answer-clock]');
        if (clock) clock.textContent = `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
        if (seconds >= 120) finishAnswer();
      },250);
    } catch (error) {
      fail(error?.code && dictation?.micMessage ? dictation.micMessage(error,'再试一次') : '暂时无法开口回答，请再试一次。');
    }
  }
  async function finishAnswer() {
    if (answer.status !== 'recording') return;
    const run = answerRun, id = answer.question;
    clearInterval(answerTimer); answerTimer = null;
    answer = {status:'writing',text:answer.text};
    updateAnswer();
    const {text,failed} = await recorder.stop();
    if (run !== answerRun) return;
    if (!text.trim()) {
      const error = failed ? dictation.unavailableNote('语音识别暂时没有回应，请稍后再试。') : '没有听到你的回答。靠近麦克风，再试一次。';
      answer = {status:'error',error}; updateAnswer(); return;
    }
    answer = {status:'grading',text,question:id};
    updateAnswer();
    grade(run);
  }
  async function grade(run) {
    const {text,question} = answer;
    try {
      const result = await deps.request('/ai/grade',{method:'POST',body:{part:'interview',task:question,answer:text},timeout:90000});
      if (run !== answerRun) return;
      answer = {status:'done',text,question,result};
      updateAnswer();
      deps.submitResult?.({id:`interview-${question}-${Date.now().toString(36)}`,activity:'interview',total:1,answers:[{points:result.answered ? 2 : 0}]});
    } catch (error) {
      if (run !== answerRun) return;
      answer = {status:'error',text,question,error:error?.code === 'ai_quota' ? '今天的 AI 点评次数用完了，明天再来。' : error?.code === 'ai_unavailable' ? 'AI 点评暂时没有开启。' : 'AI 点评没有成功，请检查网络后重试。'};
      updateAnswer();
    }
  }
  /* ----- 原题 · 追问 ----- */
  // Moving along the chain is like a new card: quiet, a fresh answer strip, and in 听题回答 the teacher asks at once.
  function goStep(next,focus = '') {
    if (!card || next < 0 || next > follows().length || next === step) return;
    stopAudio(); resetAnswer();
    step = next; flipped = revealed = listened = false;
    render(focus || (mode === 'audio' ? 'play' : 'card'),'entering');
    if (mode === 'audio') return listen();
  }
  /* ----- 怎么答 ----- */
  const sheetEl = () => root?.querySelector('.ai-prep');
  const warmed = new Set();
  // The sheet's clips are small; fetching them as it opens lets the first tap sound at once.
  function warm(url) {
    if (!url || warmed.has(url) || typeof fetch !== 'function' || globalThis.navigator?.connection?.saveData) return;
    warmed.add(url);
    fetch(url).catch(() => {});
  }
  function sheetMarkup() { return prepMarkup(card.question,prep[card.question.id],{tab:sheetTab,zh:sheetZh,playing:sheetClip,state:sheetState,step}); }
  /* ----- 点读 ----- */
  // /tts answers with a path on the community service (exam-oral.mjs and 词本 build the address the same way).
  const apiURL = path => {
    const address = `${String(globalThis.NORSK_COMMUNITY_CONFIG?.apiBase || '/api/community').replace(/\/+$/,'')}${path}`;
    return globalThis.location ? new URL(address,globalThis.location.href).href : address;
  };
  const voices = createVoices({request:deps.request || null,apiURL,loadWords:() => fetchJSON('data/pronunciation.json')});
  // A line that cannot sound says so where it was tapped: over the sheet (the site's toast lies under a modal
  // dialog), or in the card's status line for the suggestion under an answer.
  let toastTimer = null;
  function sayFailed() {
    const message = '这句暂时放不出来，请检查网络后再点一次。', host = sheetEl()?.querySelector('.ai-prep-card');
    if (sheetPending.startsWith('better-') || !host) {
      const status = root.querySelector('.ai-audio-status');
      if (status) { status.textContent = message; status.dataset.state = 'error'; }
      return;
    }
    let toast = host.querySelector('.ai-say-toast');
    if (!toast) { toast = document.createElement('p'); toast.className = 'ai-say-toast'; toast.setAttribute('role','status'); host.append(toast); }
    toast.textContent = message;
    toast.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-shown'),3200);
  }
  // A tapped line: the text to read, and its recording when it has one (word: the entry to look up in the word list).
  function sayItem(key) {
    const q = card?.question, p = prep[q?.id];
    if (!q || typeof key !== 'string') return null;
    if (key === 'q') return {text:q.spoken || q.no.replace(/\n/g,' '),url:versioned(audioFiles[q.id]?.file || `audio/a-team/${q.id}.mp3`)};
    const raw = sayText(q,p,key,answer.status === 'done' ? answer.result?.better : ''), text = spokenText(raw);
    if (!text) return null;
    if (CLIP.test(key)) return {text,url:versioned(`audio/exam/${key}.mp3`)};
    return {text,word:key.startsWith('word-') ? plain(raw).trim() : ''};
  }
  function say(key) {
    if (key === sheetClip && ['loading','playing'].includes(sheetState)) { sheetPlayer.stop(); return; }
    const item = sayItem(key);
    if (!item) return;
    sheetPending = key;
    const url = item.url || voices.known(item);
    sheetPlayer.play(item.text,url ? {url} : {find:() => voices.find(item,true)});
  }
  // The lines in view are looked up (and their clips fetched) as they appear, so a tap sounds at once.
  function prepareSay(scope) {
    for (const node of scope?.querySelectorAll?.('[data-say]') || []) {
      const item = sayItem(node.dataset.say);
      if (!item || item.url) { warm(item?.url); continue; }
      const url = voices.known(item);
      if (url) warm(url); else voices.find(item).then(warm,() => {});
    }
  }
  function openPrep() {
    const q = card?.question, p = prep[q?.id], host = root?.querySelector('.ai-session');
    if (!p || !host) return;
    if (['loading','recording'].includes(answer.status)) { resetAnswer(); updateAnswer(); }
    stopAudio();
    sheetEl()?.remove();
    // On a follow-up the sheet opens where that follow-up's answer is.
    if (step) sheetTab = 'follow';
    host.insertAdjacentHTML('beforeend',`<dialog class="ai-prep" aria-labelledby="ai-prep-title">${sheetMarkup()}</dialog>`);
    const sheet = host.lastElementChild;
    sheet.addEventListener('close',() => { sheetPlayer.stop(); sheet.remove(); });
    sheet.showModal?.();
    sheet.querySelector('#ai-prep-title')?.focus?.({preventScroll:true});
    if (p.sample) warm(versioned(`audio/exam/${q.id}-sample.mp3`));
    prepareSay(sheet);
  }
  function closePrep() { const sheet = sheetEl(); if (sheet?.open) sheet.close(); else sheet?.remove(); }
  function redrawSheet(focusTab = false) {
    const sheet = sheetEl();
    if (!sheet || !prep[card?.question?.id]) return;
    const scroll = sheet.querySelector('.ai-prep-body')?.scrollTop || 0, tab = sheetTab;
    sheet.innerHTML = sheetMarkup();
    if (!focusTab) { const body = sheet.querySelector('.ai-prep-body'); if (body) body.scrollTop = scroll; }
    else { sheet.querySelector(`[data-tab="${tab}"]`)?.focus?.({preventScroll:true}); prepareSay(sheet); }
  }
  function startSession() {
    const items = selectedItems();
    if (!items.length) return;
    stopAudio();
    resetAnswer();
    flipped = revealed = listened = false;
    step = 0; sheetTab = 'plan';
    deck = createDeck(items);
    card = deck.next();
    screen = 'session';
    warmRecogniser();
    closeDialog();
    // The host moves the module onto its own page; standalone use renders in place.
    if (deps.onStart) { deps.onStart(); if (mode === 'audio') listen(); return; }
    render(mode === 'audio' ? 'play' : 'card');
    if (mode === 'audio') listen();
  }
  function leave() {
    if (deps.onExit) { deps.onExit(); return; }
    screen = 'idle';
    render();
    openDialog();
  }
  function fetchJSON(path) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(),6000);
    return fetch(versioned(path),{signal:controller.signal})
      .then(response => { if (!response.ok) throw new Error('unavailable'); return response.json(); })
      .finally(() => clearTimeout(timer));
  }
  // The 怎么答 data comes in the background; a session already on screen gains its chain once nothing is in progress.
  function loadPrep() {
    if (prepLoaded || prepLoading) return prepLoading;
    prepLoading = fetchJSON('data/exam/interview.json')
      .then(value => {
        prep = validPrep(value); prepLoaded = Object.keys(prep).length > 0;
        if (prepLoaded && screen === 'session' && root && !sheetEl() && ['idle','done','error'].includes(answer.status)) {
          const slot = root.querySelector('[data-ai-chain]');
          if (slot) slot.innerHTML = chainMarkup();
        }
      })
      .catch(() => {}).finally(() => { prepLoading = null; });
    return prepLoading;
  }
  async function load() {
    loadPrep();
    if (loaded) return;
    if (!loading) {
      loading = fetchJSON('data/a-team-interview-audio.json')
        .then(value => { audioFiles = validManifest(value); loaded = true; })
        .catch(() => {}).finally(() => { loading = null; });
    }
    return loading;
  }
  function listen() {
    if (screen !== 'session' || !card) return;
    stopAudio();
    const q = asked();
    listened = true;
    // Start from the click itself; a background manifest fetch must not consume the audio gesture.
    load();
    if (q.follow) return player.play(q.no,{url:versioned(`audio/exam/${q.id}.mp3`)});
    const file = audioFiles[q.id]?.file || `audio/a-team/${q.id}.mp3`;
    return player.play(q.spoken || q.no.replace(/\n/g,' '),{url:versioned(file)});
  }
  function onClick(event) {
    const target = event.target.closest?.('[data-interview]');
    if (!target) {
      // A click on a dialog itself is a click on its backdrop: the picker leaves the interview, the sheet just closes.
      if (event.target?.classList?.contains('ai-prep')) { closePrep(); return; }
      if (event.target?.classList?.contains('ai-dialog')) { closeDialog(); leave(); }
      return;
    }
    if (!root?.contains(target)) return;
    const action = target.dataset.interview;
    if (screen === 'idle') {
      if (action === 'open') { openDialog(); return; }
      if (action === 'close') { closeDialog(); leave(); return; }
      if (action === 'mode' && MODES.some(item => item.id === target.dataset.mode)) { mode = target.dataset.mode; updateDialog(); return; }
      if (action === 'bank' && BANKS.some(item => item.id === target.dataset.bank)) { bank = target.dataset.bank; updateDialog(); return; }
      if (action === 'start') { startSession(); return; }
      if (action === 'resume' && card) { screen = 'session'; closeDialog(); if (deps.onStart) { deps.onStart(); return; } render(mode === 'audio' ? 'play' : 'card'); }
      return;
    }
    if (action === 'prep') { openPrep(); return; }
    if (action === 'prep-close') { closePrep(); return; }
    if (action === 'prep-tab') { if (target.dataset.tab !== sheetTab) { sheetTab = target.dataset.tab; redrawSheet(true); } return; }
    if (action === 'prep-zh') { sheetZh = !sheetZh; redrawSheet(); return; }
    if (action === 'prep-play') { if (CLIP.test(target.dataset.clip || '')) say(target.dataset.clip); return; }
    if (action === 'say') { say(target.dataset.say); return; }
    if (action === 'prep-follow') { closePrep(); goStep(1); return; }
    if (action === 'step') { goStep(Number(target.dataset.step),'step'); return; }
    if (action === 'step-next') { goStep(step+1); return; }
    if (action === 'exit') { stopAudio(); closeRecorder(); closePrep(); card = null; deck = null; step = 0; screen = 'idle'; leave(); return; }
    if (action === 'answer-start') { startAnswer(); return; }
    if (action === 'answer-done') { finishAnswer(); return; }
    if (action === 'answer-retry') { answer = {...answer,status:'grading'}; updateAnswer(); grade(answerRun); return; }
    if (action === 'flip' && mode === 'bilingual') { flipped = !flipped; render('card','flipping'); return; }
    if (action === 'next') { stopAudio(); resetAnswer(); card = deck.next(); step = 0; sheetTab = 'plan'; flipped = revealed = listened = false; render(mode === 'audio' ? 'play' : 'card','entering'); if (mode === 'audio') return listen(); return; }
    if (action === 'reveal') { revealed = !revealed; render('reveal'); return; }
    if (action === 'stop') { stopAudio(); focusTarget('play')?.focus({preventScroll:true}); return; }
    if (action === 'play') { if (answer.status === 'recording') { resetAnswer(); updateAnswer(); } return listen(); }
  }
  function onKey(event) {
    if (screen !== 'session' || event.altKey || event.ctrlKey || event.metaKey) return;
    // A sentence of a paragraph is a span with role=button: Enter and Space read it, as they would a button.
    if ((event.key === 'Enter' || event.key === ' ') && event.target?.matches?.('[role="button"][data-say]')) {
      event.preventDefault(); say(event.target.dataset.say); return;
    }
    // Inside the sheet the arrow keys move between its tabs and never turn the card.
    const tabs = event.target?.closest?.('.ai-prep-tabs');
    if (tabs && ['ArrowLeft','ArrowRight'].includes(event.key)) {
      const ids = [...tabs.querySelectorAll('[data-tab]')].map(button => button.dataset.tab), at = ids.indexOf(sheetTab);
      event.preventDefault();
      sheetTab = ids[(at+(event.key === 'ArrowRight' ? 1 : ids.length-1))%ids.length];
      redrawSheet(true);
      return;
    }
    if (event.key !== 'ArrowRight' || event.target?.closest?.('input,textarea,select,.ai-prep')) return;
    event.preventDefault(); root.querySelector('[data-interview="next"]')?.click();
  }
  function onCancel(event) {
    if (screen !== 'idle') return;
    event.preventDefault();
    closeDialog();
    leave();
  }
  // In the background the microphone closes. An answer being recorded starts again when the learner is back; one
  // already being written down or graded goes on (closing keeps what was heard), and its feedback waits on the page.
  function visibility() {
    if (!document.hidden) return;
    stopAudio();
    if (['loading','recording'].includes(answer.status)) { closeRecorder(); updateAnswer(); }
    else { recorder?.close(); recorder = null; }
  }
  function unmount() {
    document.body?.classList.remove('practice-focus');
    stopAudio();
    closeRecorder();
    closePrep();
    closeDialog();
    if (!root) return;
    root.removeEventListener('click',onClick); root.removeEventListener('keydown',onKey); root.removeEventListener('cancel',onCancel);
    document.removeEventListener('visibilitychange',visibility); window.removeEventListener('pagehide',stopAudio);
    root = null;
  }
  return {
    mount(element) {
      unmount();
      root = element;
      root.addEventListener('click',onClick); root.addEventListener('keydown',onKey); root.addEventListener('cancel',onCancel);
      document.addEventListener('visibilitychange',visibility); window.addEventListener('pagehide',stopAudio);
      render(screen === 'session' ? (mode === 'audio' ? 'play' : 'card') : '');
      if (screen === 'idle') openDialog();
      load();
    },
    // The shelf opens the picker over itself; a session left mid-round waits behind 继续.
    openPicker() { screen = 'idle'; if (root) { render(); openDialog(); } },
    unmount,stopAudio
  };
}
