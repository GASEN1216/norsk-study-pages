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
    if (source?.url && Audio) {
      const clip = new Audio(source.url);
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
  close:'<path d="m7 7 12 12M19 7 7 19"/>'
};
const icon = name => `<svg viewBox="0 0 26 26" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const MODES = [
  {id:'bilingual',title:'双语翻卡',note:'先读挪威语，翻面看中文',icon:'flip'},
  {id:'norwegian',title:'只看挪语',note:'只给问题，直接开口回答',icon:'chat'},
  {id:'audio',title:'听题回答',note:'随机听问题，再试着回答',icon:'sound'}
];
const modeRow = id => MODES.find(item => item.id === id) || MODES[0];

export function createInterview(deps = {}) {
  const escape = value => String(value ?? '').replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let screen = 'idle', mode = 'bilingual', selected = new Set(QUESTIONS.map(q => q.id));
  let deck = null, card = null, transition = '';
  let flipped = false, revealed = false, root = null, listened = false;
  let audioFiles = {}, audioState = 'idle', audioMessage = '', loading = null, loaded = false;
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
  const player = createPlayer({stopOther:() => deps.stopAudio?.(),onchange:updateAudio});
  function stopAudio() { player.stop(); }
  const playLabel = () => audioState === 'loading' ? '正在准备…' : audioState === 'error' ? '重新播放' : listened ? '再听一次' : '听问题';
  function norwegian(q) {
    return `<span lang="nb">${escape(q.no).replace(/\n/g,'<br>')}</span>${q.alternative ? `<span class="ai-alternative" lang="nb">${escape(q.alternative)}</span>` : ''}`;
  }
  const playButton = (large = false) => `<button type="button" class="${large ? 'ai-listen' : 'ai-hear'}" data-interview="play"${audioState === 'loading' ? ' disabled' : ''} aria-label="${playLabel()}">${icon(large ? 'play' : 'sound')}<span data-ai-play-label>${playLabel()}</span>${large ? '<span class="ai-sound-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>' : ''}</button>`;
  function focusTarget(name) {
    if (!root) return null;
    if (name === 'card') return root.querySelector('.ai-card');
    return root.querySelector(`[data-interview="${name}"]`);
  }
  function render(focus = '',motion = '') {
    if (!root) return;
    transition = motion;
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
  function selectedItems() { return QUESTIONS.filter(q => selected.has(q.id)); }
  function idleMarkup() {
    return `<section class="ai-app ai-idle" aria-labelledby="ai-title">
      <header class="ai-heading"><p class="ai-kicker">A-TEAM · 面试练习</p><h2 id="ai-title">A-team 面试</h2><p>15 个常见问题，选好题目再开始。</p></header>
      <div class="ai-idle-card"><p>还没有选择题目。</p><button type="button" class="ai-start-button" data-interview="open">选择题目${icon('next')}</button></div>
    </section>`;
  }
  function resumeRow() {
    if (!card) return '';
    return `<div class="ai-resume"><span class="ai-resume-icon">${icon('play')}</span><div><strong>继续上次的练习</strong><span>第 ${card.position} / ${card.total} 题</span></div><button type="button" class="ai-resume-go" data-interview="resume">继续</button></div>`;
  }
  function dialogMarkup() {
    const count = selected.size;
    return `<dialog class="ai-dialog" aria-labelledby="ai-dialog-title">
      <div class="ai-dialog-card">
        <div class="ai-dialog-head">
          <span class="ai-dialog-icon">${icon('chat')}</span>
          <div class="ai-dialog-title"><h2 id="ai-dialog-title" tabindex="-1">A-team 面试</h2><p>选好题目，再开口回答。</p></div>
          <button type="button" class="ai-dialog-close" data-interview="close" aria-label="关闭">${icon('close')}</button>
        </div>
        <div class="ai-dialog-body">
          ${resumeRow()}
          <div class="ai-dialog-block">
            <span class="ai-dialog-label">练习方式</span>
            <div class="ai-mode-row" role="group" aria-label="练习方式">${MODES.map(item => `<button type="button" class="ai-mode-chip" data-interview="mode" data-mode="${item.id}" aria-pressed="${mode === item.id}">${icon(item.icon)}<span>${item.title}</span></button>`).join('')}</div>
          </div>
          <div class="ai-dialog-block">
            <div class="ai-list-head"><span class="ai-dialog-label">面试题目</span><span class="ai-list-count">${QUESTIONS.length} 题</span><button type="button" class="ai-list-toggle" data-interview="toggle-all">${count === QUESTIONS.length ? '取消全选' : '全选'}</button></div>
            <ul class="ai-pick-list">${QUESTIONS.map(q => `<li><label class="ai-pick-row"><input type="checkbox" data-question="${q.id}" ${selected.has(q.id) ? 'checked' : ''}><span class="ai-pick-no">${q.id.slice(-2)}</span><span class="ai-pick-text"><span lang="nb">${escape(q.no).replace(/\n/g,'<br>')}</span><small>${escape(q.zh).replace(/\n/g,'<br>')}</small></span></label></li>`).join('')}</ul>
          </div>
        </div>
        <div class="ai-dialog-foot"><span data-ai-summary>已选 ${count} 题 · ${modeRow(mode).title}</span><button type="button" class="ai-start-button" data-interview="start"${count ? '' : ' disabled'}>开始练习${icon('next')}</button></div>
      </div>
    </dialog>`;
  }
  function updateDialog() {
    const dialog = dialogEl();
    if (!dialog) return;
    const count = selected.size;
    const summary = dialog.querySelector('[data-ai-summary]');
    if (summary) summary.textContent = `已选 ${count} 题 · ${modeRow(mode).title}`;
    const start = dialog.querySelector('[data-interview="start"]');
    if (start) start.disabled = count === 0;
    const toggle = dialog.querySelector('[data-interview="toggle-all"]');
    if (toggle) toggle.textContent = count === QUESTIONS.length ? '取消全选' : '全选';
    for (const button of dialog.querySelectorAll('[data-interview="mode"]')) button.setAttribute('aria-pressed',String(button.dataset.mode === mode));
  }
  function cardMarkup(q,motion) {
    if (mode === 'bilingual') return `<button type="button" class="ai-card${flipped ? ' is-back' : ''}${motion}" data-interview="flip" aria-pressed="${flipped}" title="按空格或回车翻面"><span class="ai-card-eyebrow">${flipped ? '中文意思' : '挪威语问题'}</span><span class="ai-card-text"${flipped ? ' lang="zh-CN"' : ''}>${flipped ? escape(q.zh).replace(/\n/g,'<br>') : norwegian(q)}</span><span class="ai-card-foot">${icon('flip')}${flipped ? '回到挪威语' : '点击翻面 · 看中文'}</span></button>`;
    if (mode === 'norwegian') return `<div class="ai-card${motion}" tabindex="-1"><span class="ai-card-eyebrow">挪威语问题</span><div class="ai-card-text">${norwegian(q)}</div><span class="ai-card-foot">想一想，试着说出来</span></div>`;
    return `<div class="ai-card ai-card-audio${motion}" tabindex="-1">${playButton(true)}${revealed ? `<div class="ai-transcript">${norwegian(q)}</div>` : ''}<button type="button" class="ai-text-button ai-reveal" data-interview="reveal" aria-expanded="${revealed}">${revealed ? '收起题目' : '查看题目'}</button></div>`;
  }
  function sessionMarkup() {
    const q = card.question, end = card.position === card.total, single = card.total === 1;
    const motion = transition ? ` is-${transition}` : '';
    return `<section class="ai-app ai-session" aria-labelledby="ai-title">
      <h2 id="ai-title" class="sr-only">A-team 面试</h2>
      <div class="ai-session-bar">
        <button type="button" class="ai-exit" data-interview="exit" aria-label="结束练习，回到更多">${icon('close')}<span>结束</span></button>
        <div class="ai-session-meta"><strong>面试题目</strong><span>${modeRow(mode).title}${mode === 'audio' ? ' · 随机出题' : ''} · 第 ${card.round} 轮</span></div>
        <span class="ai-session-count"><b>${card.position}</b> / ${card.total}</span>
      </div>
      <div class="ai-progress-track" role="progressbar" aria-label="本轮题目" aria-valuemin="0" aria-valuemax="${card.total}" aria-valuenow="${card.position}"><i style="width:${card.position/card.total*100}%"></i></div>
      <div class="ai-practice${audioState === 'playing' ? ' is-playing' : ''}${audioState === 'loading' ? ' is-loading' : ''}">
        ${cardMarkup(q,motion)}
        <div class="ai-controls"><div class="ai-audio-controls">${mode !== 'audio' ? playButton() : ''}<button type="button" class="ai-stop" data-interview="stop" aria-label="停止播放"${active() ? '' : ' hidden'}>${icon('stop')}<span>停止</span></button></div><button type="button" class="ai-next" data-interview="next" title="按右方向键${mode === 'audio' ? '随机播放' : '进入'}下一题">${end ? (single ? '再练一遍' : '再练一轮') : mode === 'audio' ? '随机下一题' : '下一题'}${icon('next')}</button></div>
        <p class="ai-audio-status" data-state="${audioState}" role="status" aria-live="polite">${escape(audioMessage)}</p>
        ${end ? `<p class="ai-round-note">${single ? '这一题练完了，可以再练一遍，或结束回到更多。' : '这轮最后一题，回答后可以再练一轮。'}</p>` : ''}
      </div>
    </section>`;
  }
  function startSession() {
    const items = selectedItems();
    if (!items.length) return;
    stopAudio();
    flipped = revealed = listened = false;
    deck = createDeck(items);
    card = deck.next();
    screen = 'session';
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
  async function load() {
    if (loaded) return;
    if (!loading) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(),6000);
      loading = fetch(`data/a-team-interview-audio.json${deps.version ? `?v=${encodeURIComponent(deps.version)}` : ''}`,{signal:controller.signal})
        .then(response => { if (!response.ok) throw new Error('manifest unavailable'); return response.json(); })
        .then(value => { audioFiles = validManifest(value); loaded = true; })
        .catch(() => {}).finally(() => { clearTimeout(timer); loading = null; });
    }
    return loading;
  }
  function listen() {
    if (screen !== 'session' || !card) return;
    stopAudio();
    const q = card.question;
    listened = true;
    // Start from the click itself; a background manifest fetch must not consume the audio gesture.
    load();
    const file = audioFiles[q.id]?.file || `audio/a-team/${q.id}.mp3`;
    return player.play(q.spoken || q.no.replace(/\n/g,' '),{url:`${file}${deps.version ? `?v=${encodeURIComponent(deps.version)}` : ''}`});
  }
  function onClick(event) {
    const target = event.target.closest?.('[data-interview]');
    if (!target) {
      // A click on the dialog itself is a click on the backdrop: leave the interview.
      if (event.target?.classList?.contains('ai-dialog')) { closeDialog(); leave(); }
      return;
    }
    if (!root?.contains(target)) return;
    const action = target.dataset.interview;
    if (screen === 'idle') {
      if (action === 'open') { openDialog(); return; }
      if (action === 'close') { closeDialog(); leave(); return; }
      if (action === 'mode' && MODES.some(item => item.id === target.dataset.mode)) { mode = target.dataset.mode; updateDialog(); return; }
      if (action === 'toggle-all') {
        const all = selected.size === QUESTIONS.length;
        for (const q of QUESTIONS) { if (all) selected.delete(q.id); else selected.add(q.id); }
        const dialog = dialogEl();
        if (dialog) for (const box of dialog.querySelectorAll('[data-question]')) box.checked = !all;
        updateDialog();
        return;
      }
      if (action === 'start') { startSession(); return; }
      if (action === 'resume' && card) { screen = 'session'; closeDialog(); if (deps.onStart) { deps.onStart(); return; } render(mode === 'audio' ? 'play' : 'card'); }
      return;
    }
    if (action === 'exit') { stopAudio(); card = null; deck = null; screen = 'idle'; leave(); return; }
    if (action === 'flip' && mode === 'bilingual') { flipped = !flipped; render('card','flipping'); return; }
    if (action === 'next') { stopAudio(); card = deck.next(); flipped = revealed = listened = false; render(mode === 'audio' ? 'play' : 'card','entering'); if (mode === 'audio') return listen(); return; }
    if (action === 'reveal') { revealed = !revealed; render('reveal'); return; }
    if (action === 'stop') { stopAudio(); focusTarget('play')?.focus({preventScroll:true}); return; }
    if (action === 'play') return listen();
  }
  function onChange(event) {
    const id = event.target?.dataset?.question;
    if (!id || !QUESTIONS.some(q => q.id === id)) return;
    if (event.target.checked) selected.add(id); else selected.delete(id);
    updateDialog();
  }
  function onKey(event) {
    if (screen !== 'session' || event.key !== 'ArrowRight' || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input,textarea,select')) return;
    event.preventDefault(); root.querySelector('[data-interview="next"]')?.click();
  }
  function onCancel(event) {
    if (screen !== 'idle') return;
    event.preventDefault();
    closeDialog();
    leave();
  }
  function visibility() { if (document.hidden) stopAudio(); }
  function unmount() {
    stopAudio();
    closeDialog();
    if (!root) return;
    root.removeEventListener('click',onClick); root.removeEventListener('change',onChange); root.removeEventListener('keydown',onKey); root.removeEventListener('cancel',onCancel);
    document.removeEventListener('visibilitychange',visibility); window.removeEventListener('pagehide',stopAudio);
    root = null;
  }
  return {
    mount(element) {
      unmount();
      root = element;
      root.addEventListener('click',onClick); root.addEventListener('change',onChange); root.addEventListener('keydown',onKey); root.addEventListener('cancel',onCancel);
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
