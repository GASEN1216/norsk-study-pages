/* Norwegian vocabulary practice. All progress stays in this browser. */
(() => {
  'use strict';
  if (window.NorskPractice) return;
  const LEGACY_STORAGE_KEY = 'norsk-practice-v1';
  const storageKeyFor = seriesId => seriesId === 'god-i-norsk' ? LEGACY_STORAGE_KEY : `${LEGACY_STORAGE_KEY}:${encodeURIComponent(seriesId)}`;
  const RATINGS = {2:'认识',1:'模糊',0:'不认识'};
  const ACTIVITIES = {
    cards:{title:'翻面词卡',description:'翻面回想，不会的再来'},
    learn:{title:'拼写学习',description:'看中文拼写，错了再练'},
    quiz:{title:'综合测验',description:'判断 · 选择 · 拼写'},
    match:{title:'配对消除',description:'限时配对，错配加时'},
    listen:{title:'听音选义',description:'听读音，选出意思'}
  };
  // Every finished activity earns leaderboard XP; self-rated cards earn participation XP only.
  const RANKED = ['cards','learn','quiz','match','listen'];
  const QUIZ_TYPES = ['judge','choice','spell'];
  const activityOf = config => ACTIVITIES[config?.activity] ? config.activity : 'listen';
  const defaultQuiz = () => ({types:[...QUIZ_TYPES],direction:'to-nb'});
  function quizConfig(value={}) {
    const types = unique((Array.isArray(value?.types) ? value.types : QUIZ_TYPES).filter(type => QUIZ_TYPES.includes(type)));
    return {types:types.length ? types : ['spell'],direction:['to-nb','to-zh','mixed'].includes(value?.direction) ? value.direction : 'to-nb'};
  }
  const normalize = word => String(word || '').normalize('NFC').trim().toLocaleLowerCase('nb');
  const unique = values => [...new Set(values.filter(Boolean))];
  const has = (object,key) => Object.prototype.hasOwnProperty.call(object || {},key);
  const blankStore = () => ({version:1,sets:[],recent:[],stats:{},history:[],active:null,draft:null,favorites:[],matchBest:{},keyboardMode:'screen',keyboardChoice:false,feedbackSound:true,communityPending:[]});
  const state = {seriesId:'god-i-norsk',seriesTitle:'God i norsk',storageKey:LEGACY_STORAGE_KEY,stores:new Map(),syncs:new Map(),root:null,deps:{},sources:new Map(),chapters:[],basics:[],words:new Map(),selected:new Set(),mode:'random',activity:'cards',quiz:defaultQuiz(),scopeTab:'chapters',scopeQuery:'',keyboardPage:'letters',store:blankStore(),screen:'setup',result:null,storageError:'',initialized:false,visible:false,pending:null,playToken:0,speakTimer:null,advanceTimer:null,matchTimer:null,matchStartedAt:null,justMatched:[],flipAnimation:false,communitySync:null};
  const $ = selector => state.root?.querySelector(selector);
  const e = value => (state.deps.escapeHTML || (text => String(text ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))))(value);
  const button = (action,text,extra='',kind='') => `<button type="button" class="pr-button ${kind}" data-practice-action="${action}" ${extra}>${text}</button>`;
  const ICONS = {
    close:'<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    speaker:'<path d="M11 5 6.5 9H3.5v6h3l4.5 4z"/><path d="M15.5 8.8a4.6 4.6 0 0 1 0 6.4M18.4 6a8.6 8.6 0 0 1 0 12"/>',
    pause:'<path d="M9 5.5v13M15 5.5v13"/>',
    play:'<path d="M8 5.5v13l10.5-6.5z"/>',
    star:'<path d="m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z"/>',
    swap:'<path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5"/>',
    turn:'<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.6h-4.6"/>',
    left:'<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
    down:'<path d="m6 9.5 6 6 6-6"/>',
    check:'<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    cross:'<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    keyboard:'<rect x="3" y="6.5" width="18" height="11" rx="2"/><path d="M7 10.5h.01M10.3 10.5h.01M13.7 10.5h.01M17 10.5h.01M8 14h8"/>',
    cards:'<rect x="4" y="6" width="12" height="14" rx="2"/><path d="M8 3.5h10a2 2 0 0 1 2 2V17"/>',
    learn:'<path d="m4.5 19.5 1-4.5L15.5 5l3.5 3.5-10 10z"/><path d="M13 7.5 16.5 11"/>',
    quiz:'<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="m8.5 9 1.8 1.8 3.4-3.6M8.5 15.5h7"/>',
    match:'<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><path d="m14.5 17 2 2 3.5-4"/>',
    listen:'<path d="M5 13a7 7 0 0 1 14 0v3.5a2 2 0 0 1-2 2h-1v-6h3M5 12.5h3v6H7a2 2 0 0 1-2-2z"/>',
  };
  const icon = (name,filled=false) => `<svg viewBox="0 0 24 24" aria-hidden="true">${filled ? ICONS[name].replace(/<path /g,'<path fill="currentColor" ') : ICONS[name]}</svg>`;
  const iconButton = (action,name,label,extra='',kind='') => button(action,icon(name),`aria-label="${label}" title="${label}" ${extra}`,`pr-icon-button ${kind}`);
  const rateControl = () => { const control=state.deps.renderRateControl?.() || ''; return control ? `<div class="pr-rate-control">${control}</div>` : ''; };
  const now = () => new Date().toISOString();
  // Effects belong to a fresh answer event, never to rendering or restored history.
  const effects = {context:null,voices:new Set(),audioToken:0,visualTimer:null,visualNodes:[],lastCompletedId:null};
  function unlockFeedbackAudio(event) {
    if (!event?.isTrusted || !state.store.feedbackSound || document.hidden) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!effects.context || effects.context.state === 'closed') effects.context = new AudioContext();
      if (effects.context.state === 'suspended') Promise.resolve(effects.context.resume()).catch(() => {});
    } catch { /* Older browsers and blocked audio still keep text feedback. */ }
  }
  function stopFeedbackAudio() {
    effects.audioToken++;
    for (const voice of effects.voices) {
      try { voice.oscillator.stop(); } catch {}
      try { voice.oscillator.disconnect(); voice.gain.disconnect(); } catch {}
    }
    effects.voices.clear();
  }
  function playFeedbackSound(kind) {
    stopFeedbackAudio();
    const context=effects.context, token=effects.audioToken;
    if (!state.store.feedbackSound || !context || context.state === 'closed' || document.hidden) return;
    const play = () => {
      if (token !== effects.audioToken || !state.store.feedbackSound || context.state !== 'running' || document.hidden) return;
      const notes={correct:[659.25,880],wrong:[220,196],streak:[659.25,880,1174.66],complete:[523.25,659.25,783.99,1046.5]}[kind] || [];
      try {
        notes.forEach((frequency,index) => {
          const oscillator=context.createOscillator(), gain=context.createGain(), voice={oscillator,gain};
          effects.voices.add(voice);
          const at=context.currentTime+.008+index*(kind === 'complete' ? .095 : .085), duration=kind === 'wrong' ? .12 : .16;
          oscillator.type=kind === 'wrong' ? 'triangle' : 'sine';
          oscillator.frequency.setValueAtTime(frequency,at);
          gain.gain.setValueAtTime(.0001,at);
          gain.gain.exponentialRampToValueAtTime(kind === 'wrong' ? .035 : .065,at+.012);
          gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
          oscillator.connect(gain); gain.connect(context.destination);
          oscillator.onended=() => { effects.voices.delete(voice); try { oscillator.disconnect(); gain.disconnect(); } catch {} };
          oscillator.start(at); oscillator.stop(at+duration+.01);
        });
      } catch { stopFeedbackAudio(); }
    };
    if (context.state === 'suspended') {
      try { Promise.resolve(context.resume()).then(play).catch(() => {}); } catch {}
    } else play();
  }
  function clearFeedbackVisual() {
    if (effects.visualTimer != null && typeof clearTimeout === 'function') clearTimeout(effects.visualTimer);
    effects.visualTimer=null;
    for (const node of effects.visualNodes) node.classList?.remove('pr-pulse-correct','pr-pulse-wrong','pr-pulse-streak','pr-celebrate');
    effects.visualNodes=[];
    $('.pr-completion-burst')?.remove?.();
  }
  function stopFeedback() { stopFeedbackAudio(); clearFeedbackVisual(); }
  function showFeedback(kind) {
    clearFeedbackVisual();
    playFeedbackSound(kind);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const card=$(kind === 'complete' ? '.pr-results-hero' : '.pr-exercise-card');
    if (!card) return;
    card.classList?.add(kind === 'complete' ? 'pr-celebrate' : `pr-pulse-${kind}`);
    effects.visualNodes.push(card);
    if (kind === 'complete') card.insertAdjacentHTML?.('beforeend',`<div class="pr-completion-burst" aria-hidden="true">${Array.from({length:18},(_,index) => `<i style="--pr-x:${8+index*5}%;--pr-drift:${(index%5-2)*22}px;--pr-delay:${index%4*35}ms;--pr-turn:${(index%2 ? 1 : -1)*(150+index*16)}deg"></i>`).join('')}</div>`);
    if (typeof setTimeout === 'function') effects.visualTimer=setTimeout(clearFeedbackVisual,kind === 'complete' ? 1500 : 800);
  }
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
  const currentSession = () => state.store.active;
  const currentKeys = session => session.phase === 'review' ? session.reviewKeys : session.firstKeys;
  const currentKey = session => currentKeys(session)[session.index];
  const answerMap = session => session.phase === 'review' ? session.reviewAnswers : session.answers;
  const answered = session => has(answerMap(session),currentKey(session));
  const scoreOf = result => result.total ? Math.round(result.answers.reduce((sum,item) => sum + item.points,0) / (result.total * 2) * 100) : 0;
  // Old listening results were self-ratings without answer details.
  const isObjective = result => activityOf(result) !== 'cards' && (activityOf(result) !== 'listen' || result.answers?.some(answer => answer.detail));
  function announce(message) { state.deps.notify?.(message); }
  function storageFailure(message) {
    if (!state.storageError) announce(message);
    state.storageError = message;
    const warning = $('#pr-storage-warning');
    if (warning) { warning.hidden = false; warning.textContent = message; }
  }
  function readStore() {
    try {
      const raw = localStorage.getItem(state.storageKey);
      if (!raw) return blankStore();
      const value = JSON.parse(raw);
      if (!value || value.version !== 1 || !Array.isArray(value.sets) || !Array.isArray(value.history) || !value.stats || typeof value.stats !== 'object') throw new Error('Invalid practice history');
      return {...blankStore(),...value,keyboardChoice:value.keyboardChoice === true,feedbackSound:true,communityPending:Array.isArray(value.communityPending) ? unique(value.communityPending.filter(id => typeof id === 'string')) : [],recent:Array.isArray(value.recent) ? value.recent : [],favorites:Array.isArray(value.favorites) ? unique(value.favorites.filter(key => typeof key === 'string')) : [],matchBest:value.matchBest && typeof value.matchBest === 'object' ? value.matchBest : {}};
    } catch {
      storageFailure('本机学习记录暂时无法读取。本次仍可练习，新进度可能无法在刷新后恢复。');
      return blankStore();
    }
  }
  function persistStore(store,key) {
    try { localStorage.setItem(key,JSON.stringify(store)); }
    catch { storageFailure('本机存储空间不足或暂不可用。本次仍可练习，刷新后可能丢失新进度。'); }
    if (store === state.store) syncSidebar();
  }
  function persist() { persistStore(state.store,state.storageKey); }
  function clearTimers() {
    if (typeof clearTimeout === 'function') { if (state.speakTimer != null) clearTimeout(state.speakTimer); if (state.advanceTimer != null) clearTimeout(state.advanceTimer); }
    state.speakTimer=null; state.advanceTimer=null;
  }
  function stopAudio() { ++state.playToken; clearTimers(); stopFeedback(); state.deps.stopAudio?.(); }
  // Read a word aloud without cutting off the short answer chime that may be starting.
  function speak(item,delay=0) {
    if (!item?.word) return;
    const token=++state.playToken;
    if (state.speakTimer != null && typeof clearTimeout === 'function') clearTimeout(state.speakTimer);
    state.speakTimer=null;
    state.deps.stopAudio?.();
    const run = () => {
      state.speakTimer=null;
      if (token !== state.playToken) return;
      if (!state.deps.pronounce) { announce('读音服务暂未准备好，请刷新页面后重试。'); return; }
      const failed = () => { if (token === state.playToken) announce('这条读音暂时无法播放，可以点喇叭重试。'); };
      try { Promise.resolve(state.deps.pronounce(item)).catch(failed); } catch { failed(); }
    };
    if (delay > 0 && typeof setTimeout === 'function') state.speakTimer=setTimeout(run,delay); else run();
  }
  const chimeDelay = () => effects.context && state.store.feedbackSound ? 280 : 0;
  function draft() {
    state.store.draft = {sources:[...state.selected],mode:state.mode,activity:state.activity,quiz:quizConfig(state.quiz)};
    persist();
  }
  function plainValue(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return unique(value.map(plainValue)).join('；');
    if (typeof value === 'object') return Object.entries(value).map(([key,item]) => `${key}：${plainValue(item)}`).join('；');
    return String(value);
  }
  function combine(existing,word,label) {
    if (!word?.word) return existing;
    const key = normalize(word.word);
    if (!key) return existing;
    const textExamples = unique([word.sentence,...(word.practiceTextExamples || [])]);
    const learningExamples = unique([word.example,...(word.practiceLearningExamples || []),...(Array.isArray(word.examples) ? word.examples.map(plainValue) : [])]);
    const examples = unique([...textExamples,...learningExamples]);
    if (!existing) return {...word,key,sourceLabels:[label],practiceExamples:examples,practiceTextExamples:textExamples,practiceLearningExamples:learningExamples};
    const merged = {...existing};
    for (const [field,value] of Object.entries(word)) if ((merged[field] == null || merged[field] === '') && value != null) merged[field] = value;
    for (const field of ['meaning','pos','gender','article']) merged[field] = unique([existing[field],word[field]].flatMap(value => String(value || '').split('；'))).join('；');
    merged.sourceEntry = unique([existing.sourceEntry,word.sourceEntry]).join('\n');
    merged.sourceLabels = unique([...existing.sourceLabels,label]);
    merged.practiceExamples = unique([...existing.practiceExamples,...examples]);
    merged.practiceTextExamples = unique([...(existing.practiceTextExamples || []),...textExamples]);
    merged.practiceLearningExamples = unique([...(existing.practiceLearningExamples || []),...learningExamples]);
    if (Array.isArray(word.forms)) merged.forms = unique([...(Array.isArray(existing.forms) ? existing.forms : []),...word.forms]);
    if (Array.isArray(word.formsExpanded)) merged.formsExpanded = unique([...(Array.isArray(existing.formsExpanded) ? existing.formsExpanded : []),...word.formsExpanded]);
    return merged;
  }
  function indexData(data) {
    state.sources.clear(); state.words.clear(); state.chapters = []; state.basics = [];
    const add = (token,label,words) => {
      const entries = new Map();
      for (const word of words || []) {
        const key = normalize(word.word);
        if (!key) continue;
        entries.set(key,combine(entries.get(key),word,label));
        state.words.set(key,combine(state.words.get(key),word,label));
      }
      const source = {token,label,words:[...entries.values()]};
      state.sources.set(token,source);
      return source;
    };
    for (const chapter of data?.vocabulary?.chapters || []) {
      const number = chapter.number ?? chapter.id;
      const label = `第 ${number} 章 · ${chapter.title}`;
      const sections = (chapter.sections || []).map(section => ({...section,...add(`section:${section.id}`,`${section.number ?? (/^[\d.]+$/.test(String(section.id)) ? section.id : '')} ${section.title}`.trim(),section.words)}));
      const chapterWords = Array.isArray(chapter.words) ? chapter.words : (chapter.sections || []).flatMap(section => section.words || []);
      const source = add(`chapter:${chapter.id}`,label,chapterWords);
      state.chapters.push({...chapter,...source,sections});
    }
    for (const category of data?.basics?.categories || []) state.basics.push({...category,...add(`basic:${category.id}`,category.title,category.items)});
  }
  function poolFor(tokens) {
    const pool = new Map();
    for (const token of tokens) {
      const source = state.sources.get(token);
      if (!source) continue;
      for (const word of source.words) pool.set(word.key,combine(pool.get(word.key),word,source.label));
    }
    return pool;
  }
  function sessionPool(session) {
    return session.customKeys ? new Map(session.customKeys.filter(key => state.words.has(key)).map(key => [key,state.words.get(key)])) : poolFor(session.sources);
  }
  function selectedLabel(tokens) {
    const labels = tokens.map(token => state.sources.get(token)?.label).filter(Boolean);
    return labels.length > 2 ? `${labels.slice(0,2).join(' + ')} 等 ${labels.length} 组` : labels.join(' + ');
  }
  function weakKeys() {
    return Object.entries(state.store.stats).filter(([key,stats]) => state.words.has(key) && stats.seen > 0 && (stats.lastPoints < 2 || stats.points / stats.seen < 1.5)).map(([key]) => key);
  }
  function shuffled(values) {
    const result = [...values];
    for (let i=result.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [result[i],result[j]]=[result[j],result[i]]; }
    return result;
  }
  function selectKeys(pool,mode) {
    const keys = shuffled([...pool.keys()]);
    if (mode === 'weak') {
      const priority = key => {
        const stats = state.store.stats[key];
        if (!stats?.seen) return 3;
        const average = stats.points / stats.seen;
        if (stats.lastPoints < 2) return stats.lastPoints + average / 10;
        return average < 1.5 ? 2 + average / 10 : 4 + average;
      };
      keys.sort((a,b) => priority(a)-priority(b));
    }
    return keys;
  }
  function applyConfig(config) {
    state.selected = new Set((config.sources || []).filter(token => state.sources.has(token)));
    state.mode = config.mode === 'weak' ? 'weak' : 'random';
    state.activity = activityOf(config);
    state.quiz = quizConfig(config.quiz);
  }
  function renderTOC() {
    return `<div class="pr-sidebar">${button('setup','选择练习','','pr-side-button')}${button('history','学习记录','','pr-side-button')}<div class="pr-sidebar-stats"><span><strong data-practice-stat="practiced">${Object.keys(state.store.stats).length}</strong>已练词语</span><span><strong data-practice-stat="sessions">${state.store.history.length}</strong>完成次数</span></div></div>`;
  }
  function syncSidebar() {
    const values = {weak:weakKeys().length,favorites:favoriteKeys().length,practiced:Object.keys(state.store.stats).length,sessions:state.store.history.length};
    document.querySelectorAll('[data-practice-stat]').forEach(node => { node.textContent = values[node.dataset.practiceStat] ?? ''; });
  }
  function shell(content) {
    clearFeedbackVisual();
    state.root.innerHTML = `<div class="pr-app"><p id="pr-storage-warning" class="pr-storage-warning" role="status" ${state.storageError ? '' : 'hidden'}>${e(state.storageError)}</p>${content}</div><dialog class="pr-dialog pr-card-dialog" id="pr-card" aria-labelledby="pr-card-title"></dialog><dialog class="pr-dialog pr-confirm-dialog" id="pr-confirm" aria-labelledby="pr-confirm-title"></dialog><dialog class="pr-dialog pr-scope-dialog" id="pr-scope" aria-labelledby="pr-scope-title"></dialog>`;
    $('#pr-confirm').addEventListener('cancel',event => { event.preventDefault(); state.pending = null; $('#pr-confirm').close(); if (state.screen === 'session') resume(); });
  }
  function sourceCheckbox(source,checked=false) {
    return `<label class="pr-source-row" data-pr-source-search="${e(source.label.toLocaleLowerCase('nb'))}"><input type="checkbox" data-pr-source="${e(source.token)}" ${checked ? 'checked' : ''}><span>${e(source.label)}</span><small>${source.words.length}</small></label>`;
  }
  function savedGroups() {
    const saved = state.store.sets, recent = state.store.recent;
    const rows = [...saved.map(set => `<div class="pr-saved-row"><span>${e(set.name)}</span>${button('saved-load','选用',`data-pr-id="${e(set.id)}"`,'pr-small')}${iconButton('saved-delete','close',`删除组合 ${e(set.name)}`,`data-pr-id="${e(set.id)}"`)}</div>`),...recent.map((entry,index) => `<div class="pr-saved-row is-recent"><span>${e(entry.label || selectedLabel(entry.sources))}</span>${button('recent-load','选用',`data-pr-index="${index}"`,'pr-small')}</div>`)];
    return `<div class="pr-setting-block"><span class="pr-setting-label">常用范围</span>${rows.join('')}<div class="pr-save-combo"><label class="sr-only" for="pr-set-name">组合名称</label><input id="pr-set-name" type="text" maxlength="40" placeholder="给当前范围起个名字">${button('save-set','保存','','pr-small')}</div></div>`;
  }
  function renderSetup() {
    state.screen = 'setup';
    const active = currentSession();
    const resumeBanner = active ? `<section class="pr-resume-banner"><span class="pr-mode-icon is-${activityOf(active)}">${icon(activityOf(active))}</span><div><strong>继续${e(ACTIVITIES[activityOf(active)].title)}</strong><span>${Object.keys(active.answers || {}).length} / ${active.firstKeys.length} 词</span></div>${button('resume','继续','','pr-primary')}</section>` : '';
    shell(`<div class="pr-home">${resumeBanner}<div class="pr-home-heading"><h2 class="pr-home-title">今天练什么？</h2><span class="pr-series-label">${e(state.seriesTitle)}</span></div><div class="pr-mode-grid" role="group" aria-label="练习方式">${Object.entries(ACTIVITIES).map(([key,item]) => `<button type="button" class="pr-mode-card is-${key}" data-pr-activity="${key}" aria-haspopup="dialog" aria-controls="pr-scope"><span class="pr-mode-icon">${icon(key)}</span><span class="pr-mode-title">${item.title}</span><span class="pr-mode-description">${item.description}</span></button>`).join('')}</div><div class="pr-home-columns">${historyColumn()}<div class="pr-home-board" id="pr-community-slot"></div></div></div>`);
    const slot = $('#pr-community-slot');
    if (slot) state.deps.mountCommunity?.(slot);
  }
  function historyStats() {
    return `<div class="pr-history-stats"><span><b>${Object.keys(state.store.stats).length}</b>已练词语</span><span><b>${state.store.history.length}</b>完成次数</span><span><b>${weakKeys().length}</b>薄弱词</span></div>`;
  }
  function historyEntry(result,actions=true) {
    const activity=activityOf(result), summary=resultSummary(result);
    return `<article class="pr-history-entry"><span class="pr-mode-icon is-${activity}">${icon(activity)}</span><button type="button" class="pr-history-main" data-practice-action="history-detail" data-pr-id="${e(result.id)}"><strong>${e(ACTIVITIES[activity].title)}</strong><span>${e(result.label)} · ${e(dateLabel(result.finishedAt))}</span></button><span class="pr-history-score">${summary.score}<small>${summary.unit}</small></span>${actions && result.answers.some(answer => answer.points < 2) ? button('history-weak','练错词',`data-pr-id="${e(result.id)}"`,'pr-small pr-quiet') : ''}</article>`;
  }
  function historyColumn() {
    const history = state.store.history;
    return `<section class="pr-home-history" aria-labelledby="pr-home-history-title"><div class="pr-column-head"><h3 id="pr-home-history-title">学习记录</h3>${history.length ? button('history',`全部 ${history.length}`,'','pr-small pr-quiet') : ''}</div>${historyStats()}${history.length ? `<div class="pr-history-list">${history.slice(0,6).map(result => historyEntry(result,false)).join('')}</div>` : '<p class="pr-column-empty">完成一组练习后，记录会出现在这里。</p>'}</section>`;
  }
  function scopeOptions() {
    const quiz = state.activity === 'quiz' ? `<div class="pr-setting-block"><span class="pr-setting-label">题型</span><div class="pr-chip-group" role="group" aria-label="测验题型">${[['judge','判断'],['choice','选择'],['spell','拼写']].map(([value,label]) => `<label class="pr-chip"><input type="checkbox" data-pr-quiz-type="${value}" ${state.quiz.types.includes(value) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></div><label class="pr-setting-block"><span class="pr-setting-label">方向</span><select id="pr-quiz-direction"><option value="to-nb" ${state.quiz.direction === 'to-nb' ? 'selected' : ''}>中文 → 挪威语</option><option value="to-zh" ${state.quiz.direction === 'to-zh' ? 'selected' : ''}>挪威语 → 中文</option><option value="mixed" ${state.quiz.direction === 'mixed' ? 'selected' : ''}>混合</option></select></label>` : '';
    return `<details class="pr-options"><summary>更多设置</summary><div class="pr-settings">${quiz}<label class="pr-setting-block"><span class="pr-setting-label">顺序</span><select id="pr-order"><option value="random" ${state.mode === 'random' ? 'selected' : ''}>随机</option><option value="weak" ${state.mode === 'weak' ? 'selected' : ''}>薄弱词优先</option></select></label><div class="pr-setting-block pr-setting-rate">${rateControl()}</div>${savedGroups()}</div></details>`;
  }
  function seriesChoice() {
    const options = state.deps.seriesOptions || [];
    if (options.length < 2) return '';
    return `<div class="pr-series-choice"><span class="pr-setting-label">教材</span><div class="pr-series-options" role="group" aria-label="选择教材">${options.map(item => button('series',e(item.title),`data-pr-series="${e(item.id)}" aria-pressed="${item.id === state.seriesId}"`,'pr-small')).join('')}</div></div>`;
  }
  function renderScope() {
    const dialog = $('#pr-scope');
    if (!dialog) return;
    const pool = poolFor(state.selected), weak = weakKeys().length, favorites = favoriteKeys().length;
    const quick = weak || favorites ? `<div class="pr-quick-row">${weak ? button('weak',`薄弱词 <b>${weak}</b>`,'','pr-chip-button') : ''}${favorites ? button('favorites',`${icon('star',true)}收藏 <b>${favorites}</b>`,'','pr-chip-button') : ''}</div>` : '';
    const minimum = state.activity === 'match' ? 2 : 1;
    dialog.innerHTML = `<div class="pr-dialog-heading"><span class="pr-mode-icon is-${state.activity}">${icon(state.activity)}</span><h2 id="pr-scope-title" tabindex="-1">${ACTIVITIES[state.activity].title}</h2>${iconButton('scope-close','close','返回练习方式','','pr-scope-close')}</div>${quick}${seriesChoice()}<div class="pr-source-tabs" role="group" aria-label="词语来源">${button('scope-tab',state.seriesTitle,`data-pr-tab="chapters" aria-pressed="${state.scopeTab === 'chapters'}"`,'pr-small')}${button('scope-tab','公共基础常识',`data-pr-tab="basics" aria-pressed="${state.scopeTab === 'basics'}"`,'pr-small')}</div><input type="search" class="pr-source-search" id="pr-source-search" placeholder="搜索章节或分类" aria-label="搜索练习范围" value="${e(state.scopeQuery)}"><div class="pr-source-columns"><section data-pr-scope-tab="chapters" ${state.scopeTab === 'chapters' ? '' : 'hidden'}><div class="pr-chapter-list">${state.chapters.map(chapter => `<details class="pr-source-chapter" data-pr-chapter-search="${e((chapter.label+' '+chapter.sections.map(section => section.label).join(' ')).toLocaleLowerCase('nb'))}" ${!state.selected.has(chapter.token) && chapter.sections.some(section => state.selected.has(section.token)) ? 'open' : ''}><summary><label class="pr-chapter-select"><input type="checkbox" data-pr-chapter="${e(chapter.token)}" ${state.selected.has(chapter.token) ? 'checked' : ''}><span><b>${e(chapter.number ?? chapter.id)}</b>${e(chapter.title)}</span><small>${chapter.words.length}</small></label><span class="pr-section-toggle" title="展开小节">${icon('down')}</span></summary>${chapter.sections.map(section => sourceCheckbox(section,state.selected.has(chapter.token) || state.selected.has(section.token))).join('')}</details>`).join('')}</div></section><section data-pr-scope-tab="basics" ${state.scopeTab === 'basics' ? '' : 'hidden'}><div id="pr-basic-sources">${state.basics.map(category => sourceCheckbox(category,state.selected.has(category.token))).join('')}</div></section></div><p class="pr-source-empty" id="pr-source-empty" hidden>没有匹配的范围</p>${scopeOptions()}<div class="pr-scope-footer"><span id="pr-scope-count" class="pr-scope-count" aria-live="polite">${pool.size ? `已选 <b>${pool.size}</b> 词` : '还没有选择'}</span>${button('clear-selection','清空',pool.size ? '' : 'hidden','pr-small pr-quiet')}${button('start','开始','id="pr-start" '+(pool.size < minimum ? 'disabled' : ''),'pr-primary pr-start')}</div>`;
    filterScope();
    updateSelectionUI(false);
    if (!dialog.open) { dialog.showModal?.(); $('#pr-scope-title')?.focus?.(); }
  }
  function loadScope(config) {
    state.selected = new Set((config.sources || []).filter(token => state.sources.has(token)));
    state.scopeQuery = '';
    state.scopeTab = [...state.selected].some(token => token.startsWith('chapter:') || token.startsWith('section:')) ? 'chapters' : 'basics';
    draft(); renderScope();
  }
  function filterScope() {
    const query = state.scopeQuery.trim().toLocaleLowerCase('nb');
    const all = selector => [...(state.root?.querySelectorAll(selector) || [])];
    let shown = 0;
    if (state.scopeTab === 'chapters') {
      all('[data-pr-chapter-search]').forEach(detail => {
        const chapterTitle = (detail.querySelector('summary')?.textContent || '').toLocaleLowerCase('nb');
        detail.hidden = !!query && !detail.dataset.prChapterSearch.includes(query);
        if (!detail.hidden) shown++;
        if (query && !detail.hidden) detail.open = true;
        detail.querySelectorAll('[data-pr-source-search]').forEach(row => { row.hidden = !!query && !chapterTitle.includes(query) && !row.dataset.prSourceSearch.includes(query); });
      });
    } else all('#pr-basic-sources [data-pr-source-search]').forEach(row => { row.hidden = !!query && !row.dataset.prSourceSearch.includes(query); if (!row.hidden) shown++; });
    const empty = $('#pr-source-empty');
    if (empty) empty.hidden = shown > 0;
  }
  function updateSelectionUI(save=true) {
    if (state.screen !== 'setup') return;
    for (const chapter of state.chapters) {
      const input = [...state.root.querySelectorAll('[data-pr-chapter]')].find(node => node.dataset.prChapter === chapter.token);
      if (input) { input.checked = state.selected.has(chapter.token); input.indeterminate = !input.checked && chapter.sections.some(section => state.selected.has(section.token)); }
      for (const section of chapter.sections) {
        const child = [...state.root.querySelectorAll('[data-pr-source]')].find(node => node.dataset.prSource === section.token);
        if (child) child.checked = state.selected.has(chapter.token) || state.selected.has(section.token);
      }
    }
    for (const category of state.basics) {
      const input = [...state.root.querySelectorAll('[data-pr-source]')].find(node => node.dataset.prSource === category.token);
      if (input) input.checked = state.selected.has(category.token);
    }
    const pool = poolFor(state.selected);
    const scopeCount = $('#pr-scope-count'), start = $('#pr-start'), clear = state.root.querySelector('[data-practice-action="clear-selection"]');
    if (scopeCount) scopeCount.innerHTML = pool.size ? `已选 <b>${pool.size}</b> 词${state.activity === 'match' && pool.size < 2 ? ' · 配对至少 2 词' : ''}` : '还没有选择';
    if (start) start.disabled = !pool.size || (state.activity === 'match' && pool.size < 2);
    if (clear) clear.hidden = !pool.size;
    if (save) draft();
  }
  function rememberConfig(config,label) {
    const signature = JSON.stringify([config.sources.slice().sort(),config.mode,activityOf(config),config.activity === 'quiz' ? quizConfig(config.quiz) : null]);
    state.store.recent = [{...config,label,usedAt:now(),signature},...state.store.recent.filter(item => JSON.stringify([(item.sources || []).slice().sort(),item.mode,activityOf(item),item.activity === 'quiz' ? quizConfig(item.quiz) : null]) !== signature)].slice(0,6);
  }
  function startSession(config={},customKeys=null,label='') {
    const begin = () => {
      closeDialogs(); stopAudio(); stopMatchClock();
      const sources = config.sources || [...state.selected];
      const pool = customKeys ? new Map(unique(customKeys).filter(key => state.words.has(key)).map(key => [key,state.words.get(key)])) : poolFor(sources);
      if (!pool.size) { announce('这组目前没有可练习的词，请重新选择范围。'); return; }
      const activity = activityOf(config);
      if (activity === 'match' && pool.size < 2) { announce('配对消除至少需要 2 个词，请多选一些词语。'); return; }
      const mode = config.mode || state.mode;
      const firstKeys = selectKeys(pool,mode);
      const session = {id:uid(),seriesId:state.seriesId,seriesTitle:state.seriesTitle,startedAt:now(),sources,label:label || selectedLabel(sources),mode,activity,quiz:quizConfig(config.quiz),firstKeys,customKeys:customKeys ? [...pool.keys()] : null,reviewKeys:[],reviewAnswers:{},details:{},reviewDetails:{},phase:'first',index:0,answers:{},paused:false,flipped:false,cardsReverse:false,inputDraft:''};
      if (['learn','quiz','listen'].includes(activity)) session.questions = makeQuestions(pool,firstKeys,activity,session.quiz);
      if (activity === 'match') { session.match={round:0,elapsedMs:0,penaltyMs:0,errors:{},matched:[],selected:null,wrong:[]}; makeMatchRound(session,pool); }
      state.store.active = session; state.keyboardPage='letters';
      if (!customKeys) { const saved={sources,mode,activity,quiz:session.quiz}; applyConfig(saved); rememberConfig(saved,session.label); state.store.draft=saved; }
      persist(); renderSession(); autoPlay(session); if (activity === 'match') startMatchClock();
    };
    if (currentSession()) {
      confirmDialog('还有一组未完成的练习','开始新练习会放弃旧练习的剩余进度，已答的记录会保留。',[
        {action:'confirm-resume',text:'继续上次练习',primary:true},
        {action:'confirm-run',text:'开始新的练习',run:begin},
        {action:'confirm-close',text:'取消'},
      ]);
    } else begin();
  }
  function activeItem() {
    const session = currentSession();
    return session && sessionPool(session).get(currentKey(session));
  }
  // Spelling practice may read the word first; in the quiz, audio must not reveal an answer early.
  function promptAudioAllowed(session) {
    const activity = activityOf(session);
    if (activity === 'match') return false;
    if (activity === 'cards' || activity === 'learn') return true;
    const question = session.questions?.[currentKey(session)];
    return !question || !!question.audio || question.direction === 'to-zh' || answered(session);
  }
  async function playCurrent() {
    const session = currentSession();
    if (!session || session.paused || !['first','review'].includes(session.phase)) return;
    // After a synonym was accepted, replay the word the learner actually wrote.
    const detail = answered(session) && questionDetails(session)[currentKey(session)];
    const item = (detail?.matchedKey && sessionPool(session).get(detail.matchedKey)) || activeItem();
    if (!item) { announce('这个词已不在当前词表中，请继续下一词。'); return; }
    if (!promptAudioAllowed(session)) return;
    stopAudio();
    const token = state.playToken;
    try {
      if (!state.deps.pronounce) { announce('读音服务暂未准备好，请刷新页面后重试。'); return; }
      await state.deps.pronounce(item);
    } catch { if (token === state.playToken) announce('这条读音暂时无法播放，可以点喇叭重试。'); }
  }
  // Read the new prompt when it is safe: Norwegian card faces, Norwegian prompts and listening items.
  function autoPlay(session) {
    if (!session || session.paused || !['first','review'].includes(session.phase) || answered(session)) return;
    const activity = activityOf(session);
    if (activity === 'match') return;
    if (activity === 'cards') { if (!session.cardsReverse) playCurrent(); return; }
    const question = session.questions?.[currentKey(session)];
    if (!question || question.audio || question.direction === 'to-zh' || activity === 'learn') playCurrent();
  }
  function pause() {
    if (!currentSession()) return;
    stopMatchClock();
    stopAudio(); currentSession().paused = true;
    closeDialogs(); persist();
  }
  function progressOf(session) {
    if (activityOf(session) === 'match') return {done:session.firstKeys.filter(key => has(session.answers,key)).length,total:session.firstKeys.length,review:false};
    if (session.phase === 'review') {
      const total = new Set(session.reviewKeys).size;
      return {done:Math.min(total,Object.values(session.reviewAnswers).filter(points => points === 2).length),total,review:true};
    }
    return {done:session.firstKeys.filter(key => has(session.answers,key)).length,total:session.firstKeys.length,review:false};
  }
  function sessionBar(session) {
    const {done,total,review} = progressOf(session), percent = Math.round(done/Math.max(total,1)*100), match = activityOf(session) === 'match';
    return `<div class="pr-session-bar${review ? ' is-review' : ''}">${iconButton('exit','close','退出练习')}<div class="pr-progress" role="progressbar" aria-label="${review ? '错词重练进度' : '练习进度'}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><span style="width:${percent}%"></span></div><span class="pr-progress-count">${review ? '<b>重练</b>' : ''}${done}/${total}</span>${rateControl()}${match ? iconButton('pause',session.paused ? 'play' : 'pause',session.paused ? '继续' : '暂停') : ''}</div>`;
  }
  function renderSession() {
    const session = currentSession();
    if (!session) { renderSetup(); return; }
    state.screen = 'session';
    if (session.phase === 'review-intro') { renderReviewIntro(session); return; }
    const activity = activityOf(session);
    if (activity === 'match') { renderMatch(session); return; }
    ensureQuestions(session);
    const item = activeItem();
    if (!item) { shell(sessionBar(session)+`<section class="pr-exercise-card pr-center-card"><h2>这个词已不在词表中</h2>${button('setup','重新选择','','pr-primary pr-wide')}</section>`); return; }
    if (session.paused) { shell(sessionBar(session)+`<section class="pr-exercise-card pr-center-card"><h2>已暂停</h2>${button('resume','继续练习','','pr-primary pr-wide')}</section>`); return; }
    if (activity === 'cards') renderCards(session,item); else renderQuestion(session,item);
  }
  function renderReviewIntro(session) {
    const count = new Set(session.reviewKeys).size;
    shell(`<section class="pr-exercise-card pr-center-card pr-round-intro"><span class="pr-round-count">${count}</span><h2>还有 ${count} 个词没记住</h2><p>再练一遍，直到全部答对。</p>${button('review-start','开始重练','','pr-primary pr-wide')}${button('finish','先看结果','','pr-quiet')}</section>`);
  }
  function favoriteKeys() { return (state.store.favorites || []).filter(key => state.words.has(key)); }
  function favoriteButton(key) {
    const favorite = (state.store.favorites || []).includes(key);
    return button('favorite',icon('star',favorite),`data-pr-key="${e(key)}" aria-pressed="${favorite}" aria-label="${favorite ? '取消收藏' : '收藏这个词'}" title="${favorite ? '取消收藏' : '收藏'}"`,'pr-icon-button pr-favorite-button');
  }
  function toggleFavorite(key) {
    if (!state.words.has(key)) return;
    const favorites = state.store.favorites ||= [];
    state.store.favorites = favorites.includes(key) ? favorites.filter(item => item !== key) : [...favorites,key];
    persist();
    // Update the star in place so a typed answer, keyboard and focus stay untouched.
    const favorite = state.store.favorites.includes(key);
    state.root?.querySelectorAll('[data-practice-action="favorite"]').forEach(control => {
      if (control.dataset?.prKey !== key) return;
      control.innerHTML = icon('star',favorite);
      control.setAttribute('aria-pressed',String(favorite));
      control.setAttribute('aria-label',favorite ? '取消收藏' : '收藏这个词');
      control.title = favorite ? '取消收藏' : '收藏';
    });
  }
  function renderCards(session,item) {
    const key = currentKey(session), done = answered(session), points = answerMap(session)[key];
    const reverse = !!session.cardsReverse, showWord = reverse ? session.flipped : !session.flipped;
    const main = showWord ? `<span class="pr-flash-word" lang="nb">${e(item.word)}</span>${item.ipa ? `<span class="pr-flash-ipa">${e(item.ipa)}</span>` : ''}` : `<span class="pr-flash-meaning">${e(item.meaning)}</span>`;
    const sub = session.flipped ? (showWord ? `<span class="pr-flash-sub">${e(item.meaning)}</span>` : `<span class="pr-flash-sub" lang="nb">${e(item.word)}</span>`) : '';
    const ratings = done ? `<div class="pr-rated"><span class="pr-rated-chip is-${points}">${e(RATINGS[points])}</span>${button('next','下一张','','pr-primary')}</div>` : `<div class="pr-rating-buttons">${[[0,'不认识','pr-unknown'],[1,'模糊','pr-unsure'],[2,'认识','pr-known']].map(([value,label,kind],index) => button('rate',`${label}<kbd>${index+1}</kbd>`,`data-pr-points="${value}"`,`pr-rating ${kind}`)).join('')}</div>`;
    shell(sessionBar(session)+`<section class="pr-exercise-card pr-cards-card"><button type="button" class="pr-flashcard${session.flipped ? ' is-flipped' : ''}${state.flipAnimation ? ' is-turning' : ''}" data-practice-action="flip" aria-label="翻面" aria-pressed="${session.flipped}">${main}${sub}<span class="pr-flip-mark" aria-hidden="true">${icon('turn')}</span></button><div class="pr-card-tools">${iconButton('previous','left','上一张',session.index && session.phase === 'first' ? '' : 'disabled')}${iconButton('replay','speaker','朗读')}${favoriteButton(key)}${iconButton('card-direction','swap',reverse ? '改为挪威语在正面' : '改为中文在正面',`aria-pressed="${reverse}"`)}</div>${ratings}</section>`);
    state.flipAnimation = false;
  }
  function flipCard() {
    const session = currentSession();
    if (!session || activityOf(session) !== 'cards' || session.paused || !['first','review'].includes(session.phase)) return;
    session.flipped = !session.flipped; state.flipAnimation = true;
    persist(); renderSession(); playCurrent();
  }
  function previousCard() {
    const session = currentSession();
    if (!session || activityOf(session) !== 'cards' || session.paused || session.phase !== 'first' || session.index < 1) return;
    stopAudio(); session.index--; session.flipped = false;
    persist(); renderSession(); if (!session.cardsReverse) playCurrent();
  }
  // Preserve Norwegian letters while accepting presentation differences in an answer.
  function normalizeAnswer(value) {
    return String(value || '').normalize('NFC').trim().toLocaleLowerCase('nb').replace(/\s+/gu,' ').replace(/[\p{P}]+$/gu,'').trim();
  }
  function acceptedSpellings(item) {
    const variants = Array.isArray(item.variants) ? item.variants : [];
    return unique([item.word,...variants.filter(value => typeof value === 'string')].map(normalizeAnswer));
  }
  function spellingCorrect(item,value) { const answer=normalizeAnswer(value); return !!answer && acceptedSpellings(item).includes(answer); }
  function meaningParts(item) {
    return unique(String(item?.meaning || '').normalize('NFC').toLocaleLowerCase('nb').replace(/[（(][^）)]*[）)]/g,'').split(/[；;、/，,]/).map(part => part.replace(/[\s\p{P}\p{S}]/gu,'')).filter(Boolean));
  }
  function sameMeaning(first,second) {
    const a=meaningParts(first), b=meaningParts(second);
    return a.some(value => b.includes(value));
  }
  function makeQuestions(pool,keys,activity,settings) {
    const config=quizConfig(settings), questions={};
    // Normalize each word once. Large ranges must not reparse every meaning for every question.
    const candidates=shuffled([...pool.keys()]), metadata=new Map(), byPrompt=new Map();
    for (const key of candidates) {
      const item=pool.get(key), parts=meaningParts(item), prompt=normalizeAnswer(item.meaning);
      metadata.set(key,{parts:new Set(parts),meaning:parts.join('|'),word:normalizeAnswer(item.word),prompt});
      if (!byPrompt.has(prompt)) byPrompt.set(prompt,[]);
      byPrompt.get(prompt).push(key);
    }
    const overlaps=(a,b) => [...metadata.get(a).parts].some(part => metadata.get(b).parts.has(part));
    // Distractors never share a meaning with the answer, so only one option can be right.
    const distractors=(key,direction,needed,distinct) => {
      const field=direction === 'to-nb' ? 'word' : 'meaning', values=new Set([metadata.get(key)[field]]), others=[];
      const offset=Math.floor(Math.random()*candidates.length);
      for (let step=0;step<candidates.length && others.length<needed;step++) {
        const other=candidates[(offset+step)%candidates.length], value=metadata.get(other)[field];
        if (other === key || overlaps(key,other)) continue;
        if (distinct && (!value || values.has(value) || (direction === 'to-zh' && others.some(known => overlaps(known,other))))) continue;
        values.add(value); others.push(other);
      }
      return others;
    };
    const typeCounts={};
    const optionsFor=(key,direction,others) => shuffled([key,...others]).map(option => ({key:option,text:direction === 'to-nb' ? pool.get(option).word : pool.get(option).meaning}));
    keys.forEach((key,index) => {
      if (activity === 'listen') {
        const others=distractors(key,'to-zh',3,true);
        // Too few distinct meanings: fall back to dictation of the same word.
        questions[key]=others.length === 3 ? {type:'choice',direction:'to-zh',audio:true,options:optionsFor(key,'to-zh',others)} : {type:'spell',direction:'to-nb',audio:true,acceptableKeys:[key]};
        return;
      }
      let type=activity === 'learn' ? 'spell' : config.types[index % config.types.length];
      // Alternate per type, so two enabled types cannot lock each type to one direction.
      const turn=typeCounts[type]=(typeCounts[type] || 0)+1;
      let direction=config.direction === 'mixed' ? (turn % 2 ? 'to-nb' : 'to-zh') : config.direction;
      if (type === 'spell') direction='to-nb';
      if (type === 'choice') {
        const others=distractors(key,direction,3,true);
        if (others.length === 3) questions[key]={type,direction,options:optionsFor(key,direction,others)};
        else type='spell';
      }
      if (type === 'judge') {
        const others=distractors(key,direction,1,false);
        if (!others.length) type='spell';
        else {
          const truth=Math.random() >= .5, proposed=truth ? key : others[0];
          questions[key]={type,direction,truth,proposedKey:proposed,proposed:direction === 'to-nb' ? pool.get(proposed).word : pool.get(proposed).meaning};
        }
      }
      if (type === 'spell') questions[key]={type:'spell',direction:'to-nb',acceptableKeys:byPrompt.get(metadata.get(key).prompt).slice()};
    });
    return questions;
  }
  function questionDetails(session) { return session.phase === 'review' ? (session.reviewDetails ||= {}) : (session.details ||= {}); }
  function submitObjective(value,unknown=false) {
    const session=currentSession();
    if (!session || session.paused || !['first','review'].includes(session.phase) || answered(session) || !['learn','quiz','listen'].includes(activityOf(session))) return;
    const key=currentKey(session), item=activeItem(), question=session.questions?.[key];
    if (!item || !question) return;
    let correct=false, submitted=String(value ?? ''), matchedKey=key;
    if (unknown) submitted='不知道';
    else if (question.type === 'spell') {
      if (!submitted.trim()) { announce('先输入挪威语，也可以选“不知道”。'); $('#pr-answer')?.focus?.(); return; }
      const pool=sessionPool(session), accepted=(question.acceptableKeys || [key]).find(option => pool.has(option) && spellingCorrect(pool.get(option),submitted));
      correct=!!accepted; matchedKey=accepted || key;
    } else if (question.type === 'choice') {
      const option=question.options[Number(value)];
      if (!option) return;
      correct=option.key === key; submitted=option.text;
    } else if (question.type === 'judge') { if (!['true','false'].includes(submitted)) return; correct=(submitted === 'true') === question.truth; submitted=submitted === 'true' ? '正确' : '错误'; }
    const expected=question.type === 'judge' ? (question.truth ? '正确' : '错误') : question.direction === 'to-zh' ? item.meaning : item.word;
    grade(correct ? 2 : 0,{type:question.type,direction:question.direction,audio:!!question.audio,submitted:unknown ? '不知道' : submitted,expected,correct,unknown,prompt:question.direction === 'to-zh' ? item.word : item.meaning,proposed:question.proposed || '',choice:question.type === 'choice' ? Number(value) : null,...(matchedKey !== key ? {matchedKey} : {})});
  }
  const touchScreen = () => !!window.matchMedia?.('(pointer: coarse)').matches;
  // A physical keyboard always types into the field, so desktops simply keep the on-screen layout.
  function keyboardMode() {
    return touchScreen() && state.store.keyboardChoice && state.store.keyboardMode === 'system' ? 'system' : 'screen';
  }
  function renderQuestion(session,item) {
    const activity=activityOf(session), key=currentKey(session), question=session.questions?.[key], done=answered(session), detail=questionDetails(session)[key];
    if (!question) { shell(sessionBar(session)+`<section class="pr-exercise-card pr-center-card"><h2>这道题暂时无法显示</h2>${button('setup','重新选择','','pr-primary pr-wide')}</section>`); return; }
    const toZh=question.direction === 'to-zh', promptText=toZh ? item.word : item.meaning;
    let prompt;
    if (question.audio) prompt=`<button type="button" class="pr-listen-button" data-practice-action="replay" aria-label="播放读音">${icon('speaker')}</button>${done ? `<p class="pr-listen-reveal" lang="nb">${e(item.word)}</p>` : ''}`;
    else if (question.type === 'judge') prompt=`<div class="pr-judge"><span class="${toZh ? 'pr-prompt-word' : 'pr-prompt-text'}" ${toZh ? 'lang="nb"' : ''}>${e(promptText)}</span><span class="pr-judge-equals" aria-label="是否等于">=</span><span class="${toZh ? 'pr-prompt-text' : 'pr-prompt-word'}" ${toZh ? '' : 'lang="nb"'}>${e(question.proposed)}</span></div>`;
    else prompt=`<div class="pr-prompt-row"><h2 class="pr-prompt${toZh ? ' is-word' : ''}" ${toZh ? 'lang="nb"' : ''}>${e(promptText)}</h2>${toZh || activity === 'learn' ? iconButton('replay','speaker',toZh ? '朗读' : '听读音','','pr-prompt-speaker') : ''}</div>`;
    let answerUI='';
    if (question.type === 'spell') {
      const mode=keyboardMode(), value=done ? (detail?.unknown ? '' : detail?.submitted || '') : session.inputDraft || '';
      answerUI=`<form class="pr-answer-form" id="pr-answer-form"><label class="sr-only" for="pr-answer">${question.audio ? '写出听到的挪威语' : '输入挪威语'}</label><input id="pr-answer" class="pr-answer-input${done ? (detail?.correct ? ' is-correct' : ' is-wrong') : ''}" type="text" lang="nb" inputmode="${mode === 'system' || !touchScreen() ? 'text' : 'none'}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${question.audio ? '写出听到的词' : '输入挪威语'}" value="${e(value)}" ${done ? 'disabled' : ''}></form>${done ? '' : `<div class="pr-keyboard-wrap"><div id="pr-keyboard">${renderKeyboard()}</div>${touchScreen() ? iconButton('keyboard-mode','keyboard',mode === 'system' ? '显示屏幕键盘' : '使用手机键盘',`aria-pressed="${mode === 'screen'}"`,'pr-keyboard-toggle') : ''}</div>`}`;
    } else if (question.type === 'choice') {
      answerUI=`<div class="pr-choice-grid${question.options.some(option => option.text.length > 14) ? ' is-long' : ''}">${question.options.map((option,index) => {
        const tone=done ? (option.key === key ? ' is-correct' : detail?.choice === index ? ' is-wrong' : ' is-dim') : '';
        return `<button type="button" class="pr-choice${tone}" data-practice-action="objective" data-pr-value="${index}" ${question.direction === 'to-nb' ? 'lang="nb"' : ''} ${done ? 'disabled' : ''}><kbd>${index+1}</kbd><span>${e(option.text)}</span></button>`;
      }).join('')}</div>`;
    } else {
      answerUI=`<div class="pr-choice-grid pr-judge-buttons">${[['true','对','check'],['false','错','cross']].map(([value,label,name],index) => {
        const chosen=detail?.submitted === (value === 'true' ? '正确' : '错误'), right=String(question.truth) === value;
        const tone=done ? (right ? ' is-correct' : chosen ? ' is-wrong' : ' is-dim') : '';
        return `<button type="button" class="pr-choice${tone}" data-practice-action="objective" data-pr-value="${value}" ${done ? 'disabled' : ''}><kbd>${index+1}</kbd>${icon(name)}<span>${label}</span></button>`;
      }).join('')}</div>`;
    }
    const footer=done ? answerPanel(session,item,question,detail) : `<div class="pr-question-footer">${button('unknown','不知道','','pr-quiet')}${question.type === 'spell' ? `<button type="submit" form="pr-answer-form" id="pr-check-answer" class="pr-button pr-primary" ${session.inputDraft?.trim() ? '' : 'disabled'}>检查</button>` : ''}</div>`;
    shell(sessionBar(session)+`<section class="pr-exercise-card pr-question-card is-${question.type}${question.audio ? ' is-audio' : ''}"><div class="pr-card-corner">${favoriteButton(key)}</div>${prompt}${answerUI}${footer}</section>`);
    if (!done && question.type === 'spell') $('#pr-answer')?.focus?.({preventScroll:true});
    if (done) state.root.querySelector('[data-practice-action="next"]')?.focus?.({preventScroll:true});
  }
  function answerPanel(session,item,question,detail) {
    const correct=!!detail?.correct, run=correct ? consecutiveCorrect(session) : 0;
    const shown=(detail?.matchedKey && sessionPool(session).get(detail.matchedKey)) || item;
    // Answers restored from the old self-rated listening mode carry no details.
    const title=!detail ? '已记录' : correct ? (run >= 3 ? `连对 ${run} 题` : '答对了') : detail.unknown ? '记一下' : '答错了';
    return `<div class="pr-feedback is-${!detail ? 'neutral' : correct ? 'correct' : 'wrong'}" role="status" aria-live="polite"><span class="pr-feedback-mark" aria-hidden="true">${icon(correct ? 'check' : 'cross')}</span><div class="pr-feedback-copy"><strong>${title}</strong><p><button type="button" class="pr-feedback-word" data-practice-action="word-card" data-pr-key="${e(shown.key || item.key)}" lang="nb">${e(shown.word)}</button><span>${e(shown.meaning)}</span></p></div>${iconButton('replay','speaker','再听一遍','','pr-feedback-replay')}${button('next','继续','','pr-primary pr-next')}</div>`;
  }
  function matchGroups(keys,pool) {
    const groups=[];
    let remaining=keys.filter(key => pool.has(key));
    while (remaining.length) {
      const group=[];
      remaining=remaining.filter(key => {
        if (group.length < 6 && !group.some(other => sameMeaning(pool.get(key),pool.get(other)))) { group.push(key); return false; }
        return true;
      });
      groups.push(group);
    }
    return groups;
  }
  function makeMatchRound(session,pool=sessionPool(session)) {
    const match=session.match;
    const groups=matchGroups(session.firstKeys.filter(key => !has(session.answers,key)),pool);
    match.roundKeys=groups[0] || [];
    match.totalRounds=match.round+groups.length;
    match.matched=[]; match.selected=null; match.wrong=[];
    match.tiles=shuffled(match.roundKeys.flatMap(key => [{id:`word:${key}`,key,side:'word',text:pool.get(key)?.word || key},{id:`meaning:${key}`,key,side:'meaning',text:pool.get(key)?.meaning || ''}]));
    // No words left (e.g. removed by a data update): let the round finish instead of showing an empty board.
    match.roundDone=!match.roundKeys.length; state.justMatched=[];
  }
  function matchTime(session) { return (session.match?.elapsedMs || 0)+(state.matchStartedAt == null ? 0 : Math.max(0,Date.now()-state.matchStartedAt))+(session.match?.penaltyMs || 0); }
  function timeLabel(ms) { return `${(Math.max(0,ms)/1000).toFixed(1)} 秒`; }
  function stopMatchClock() {
    const session=currentSession();
    if (session?.match && state.matchStartedAt != null) session.match.elapsedMs+=Math.max(0,Date.now()-state.matchStartedAt);
    state.matchStartedAt=null;
    if (state.matchTimer != null && typeof clearInterval === 'function') clearInterval(state.matchTimer);
    state.matchTimer=null;
  }
  function startMatchClock() {
    const session=currentSession();
    if (!session || activityOf(session) !== 'match' || session.paused || session.match.roundDone) return;
    stopMatchClock(); state.matchStartedAt=Date.now();
    if (typeof setInterval !== 'function') return;
    let savedAt=Date.now();
    state.matchTimer=setInterval(() => {
      const active=currentSession();
      if (active !== session || session.paused) { stopMatchClock(); return; }
      const timer=$('#pr-match-time'); if (timer) timer.textContent=timeLabel(matchTime(session));
      if (Date.now()-savedAt >= 1000) { session.match.elapsedMs+=Math.max(0,Date.now()-state.matchStartedAt); state.matchStartedAt=Date.now(); savedAt=Date.now(); persist(); }
    },100);
  }
  function renderMatch(session) {
    const match=session.match, best=state.store.matchBest?.[matchSignature(session)];
    const tile=item => {
      const matched=match.matched.includes(item.id), fresh=state.justMatched.includes(item.id);
      return `<button type="button" class="pr-match-tile${match.selected === item.id ? ' is-selected' : ''}${matched ? (fresh ? ' is-just-matched' : ' is-matched') : ''}${match.wrong.includes(item.id) ? ' is-wrong' : ''}" data-practice-action="match-tile" data-pr-tile="${e(item.id)}" ${matched ? 'disabled aria-hidden="true" tabindex="-1"' : ''} ${item.side === 'word' ? 'lang="nb"' : ''}>${e(item.text)}</button>`;
    };
    const board=session.paused ? `<div class="pr-center-card pr-match-paused"><h2>已暂停</h2>${button('resume','继续','','pr-primary pr-wide')}</div>` : `<div class="pr-match-board"><div class="pr-match-col">${match.tiles.filter(item => item.side === 'word').map(tile).join('')}</div><div class="pr-match-col">${match.tiles.filter(item => item.side === 'meaning').map(tile).join('')}</div></div>${match.roundDone ? `<div class="pr-match-next">${button('match-next','下一组','','pr-primary pr-wide')}</div>` : ''}`;
    shell(sessionBar(session)+`<section class="pr-exercise-card pr-match-card"><div class="pr-match-head"><strong class="pr-timer" id="pr-match-time" role="timer" aria-label="用时">${timeLabel(matchTime(session))}</strong>${match.penaltyMs ? `<span class="pr-penalty">含加时 ${timeLabel(match.penaltyMs)}</span>` : ''}${best ? `<span class="pr-best">最佳 ${timeLabel(best.timeMs)}</span>` : ''}</div>${board}</section>`);
    state.justMatched=[];
  }
  function matchSignature(session) { return JSON.stringify(session.firstKeys.slice().sort()); }
  function selectMatchTile(id) {
    const session=currentSession();
    if (!session || activityOf(session) !== 'match' || session.paused || session.match.roundDone) return;
    const match=session.match, tile=match.tiles.find(item => item.id === id);
    if (!tile || match.matched.includes(id)) return;
    match.wrong=[];
    const pool=sessionPool(session);
    const previous=match.tiles.find(item => item.id === match.selected);
    if (!previous || previous.side === tile.side) {
      match.selected=match.selected === id ? null : id;
      persist(); renderSession();
      if (tile.side === 'word' && match.selected === id) speak(pool.get(tile.key));
      return;
    }
    const word=tile.side === 'word' ? tile : previous, meaning=tile.side === 'meaning' ? tile : previous;
    match.selected=null;
    let feedback='wrong';
    if (word.key === meaning.key) {
      match.correctRun=(match.correctRun || 0)+1;
      feedback=match.correctRun === 3 || (match.correctRun >= 5 && match.correctRun%5 === 0) ? 'streak' : 'correct';
      match.matched.push(word.id,meaning.id); state.justMatched=[word.id,meaning.id];
      recordGrade(session,word.key,match.errors[word.key] ? 0 : 2,{type:'match',direction:'to-zh',submitted:meaning.text,expected:pool.get(word.key)?.meaning || '',correct:!match.errors[word.key],errors:match.errors[word.key] || 0,prompt:word.text});
      if (match.matched.length === match.tiles.length) {
        stopMatchClock(); match.roundDone=true;
        if (session.firstKeys.every(key => has(session.answers,key))) { speak(pool.get(word.key),chimeDelay()); finish(); return; }
      }
    } else {
      match.correctRun=0;
      match.penaltyMs+=1000; match.errors[word.key]=(match.errors[word.key] || 0)+1; match.wrong=[word.id,meaning.id];
    }
    persist(); renderSession(); showFeedback(feedback); speak(pool.get(word.key),chimeDelay());
    // A cleared board moves on by itself; the button stays as a fallback.
    if (match.roundDone && typeof setTimeout === 'function') state.advanceTimer=setTimeout(() => { state.advanceTimer=null; if (currentSession() === session) nextMatchRound(); },900);
  }
  function nextMatchRound() {
    const session=currentSession();
    if (!session || activityOf(session) !== 'match' || !session.match.roundDone || session.paused) return;
    if (state.advanceTimer != null && typeof clearTimeout === 'function') clearTimeout(state.advanceTimer);
    state.advanceTimer=null;
    if (session.firstKeys.every(key => has(session.answers,key))) { finish(); return; }
    session.match.round++; makeMatchRound(session); persist(); renderSession(); startMatchClock();
  }
  function renderFacts(item) {
    const verbLabels = {infinitive:'原形',present:'现在时',past:'过去时',pastParticiple:'过去分词'};
    const verbForms = item.verbForms && typeof item.verbForms === 'object' ? Object.entries(item.verbForms).map(([key,value]) => `${verbLabels[key] || key}：${plainValue(value)}`).join('；') : plainValue(item.verbForms);
    const genders = {m:'阳性',f:'阴性',n:'中性','f/m':'阴性或阳性','m/f':'阳性或阴性','m/n':'阳性或中性','f/n':'阴性或中性'};
    const gender = plainValue(item.gender).split('；').map(value => genders[value.trim()] || value).join('；');
    const facts = [
      ['词性',item.pos || item.partOfSpeech],['性别 / 冠词',unique([gender,plainValue(item.article)]).join(' · ')],
      ['变化形式',plainValue(item.formsExpanded || item.forms || item.inflections || item.conjugation)],['动词变化',verbForms],['语法',plainValue(item.grammar)],
    ].filter(([,value]) => value);
    return facts.length ? `<dl class="pr-word-facts">${facts.map(([label,value]) => `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>` : '';
  }
  function openWordCard(key) {
    const item = state.words.get(key), dialog = $('#pr-card');
    if (!item || !dialog) return;
    const usage = unique([plainValue(item.usage),plainValue(item.note)]);
    const examples = unique([...(item.practiceTextExamples || []),...(item.practiceLearningExamples || [])]).slice(0,3);
    dialog.innerHTML = `<div class="pr-card-top"><span class="pr-card-handle" aria-hidden="true"></span>${iconButton('card-close','close','关闭词卡')}</div><div class="pr-card-word"><h2 id="pr-card-title" lang="nb">${e(item.word)}</h2>${button('result-word',icon('speaker'),`data-pr-key="${e(key)}" aria-label="朗读 ${e(item.word)}" title="朗读"`,'pr-icon-button')}</div>${item.ipa || item.syllables ? `<p class="pr-card-phonetics">${[item.syllables,item.ipa].filter(Boolean).map(e).join(' · ')}</p>` : ''}${item.meaning ? `<p class="pr-card-meaning">${e(item.meaning)}</p>` : ''}${renderFacts(item)}${usage.length ? `<section class="pr-card-section">${usage.map(text => `<p>${e(text)}</p>`).join('')}</section>` : ''}${examples.length ? `<section class="pr-card-section">${examples.map(example => `<p class="pr-card-example" lang="nb">${e(example)}</p>`).join('')}</section>` : ''}<div class="pr-card-foot">${rateControl()}${favoriteButton(key)}</div>`;
    if (!dialog.open) dialog.showModal?.();
  }
  function recordGrade(session,key,points,detail=null) {
    if (has(answerMap(session),key)) return false;
    answerMap(session)[key] = points;
    if (detail) questionDetails(session)[key]=detail;
    if (session.phase === 'first') {
      const stats = state.store.stats[key] || {seen:0,points:0,lastPoints:0,streak:0,reviews:0};
      stats.seen += 1; stats.points += points; stats.lastPoints = points; stats.lastAt = now(); stats.streak = points === 2 ? stats.streak+1 : 0;
      state.store.stats[key] = stats;
      if (points < 2 && !['quiz','match'].includes(activityOf(session)) && !session.reviewKeys.includes(key)) session.reviewKeys.push(key);
    } else {
      const stats = state.store.stats[key];
      if (stats) { stats.reviews = (stats.reviews || 0)+1; stats.lastReviewPoints = points; stats.lastReviewAt = now(); }
    }
    return true;
  }
  function grade(points,detail=null) {
    const session = currentSession();
    if (!session || session.paused || !['first','review'].includes(session.phase) || ![0,1,2].includes(points)) return;
    if (answered(session)) return;
    const key = currentKey(session);
    recordGrade(session,key,points,detail);
    stopAudio();
    persist(); renderSession();
    if (detail) {
      const run=consecutiveCorrect(session);
      showFeedback(detail.correct ? (run === 3 || (run >= 5 && run%5 === 0) ? 'streak' : 'correct') : 'wrong');
      // Every answer, right or wrong, is followed by the correct Norwegian pronunciation.
      const pool=sessionPool(session);
      speak((detail.matchedKey && pool.get(detail.matchedKey)) || pool.get(key),chimeDelay());
    }
  }
  // Self-rated cards move straight on; the next Norwegian face is read aloud.
  function rateCard(points) {
    const session = currentSession();
    if (!session || activityOf(session) !== 'cards' || answered(session)) return;
    grade(points);
    if (answered(session)) next();
  }
  function next() {
    const session = currentSession();
    if (!session || session.paused || !['first','review'].includes(session.phase) || !answered(session)) return;
    closeDialogs(); stopAudio();
    const key = currentKey(session);
    if (session.phase === 'review' && session.reviewAnswers[key] < 2) {
      // A missed word returns at the end of the review queue until it is answered correctly.
      session.reviewKeys.push(key);
      delete session.reviewAnswers[key];
      if (session.reviewDetails) delete session.reviewDetails[key];
    }
    if (session.index < currentKeys(session).length-1) {
      session.index += 1; session.flipped=false; session.inputDraft=''; state.keyboardPage='letters'; persist(); renderSession(); autoPlay(session);
    } else if (session.phase === 'first' && session.reviewKeys.length) {
      session.phase = 'review-intro'; session.index = 0; persist(); renderSession();
    } else finish();
  }
  function finish() {
    const session = currentSession();
    if (!session) return;
    closeDialogs(); stopMatchClock();
    if (state.advanceTimer != null && typeof clearTimeout === 'function') clearTimeout(state.advanceTimer);
    state.advanceTimer=null;
    const pool = sessionPool(session);
    const result = {id:session.id,seriesId:session.seriesId || state.seriesId,seriesTitle:session.seriesTitle || state.seriesTitle,startedAt:session.startedAt,finishedAt:now(),label:session.label,sources:session.sources,customKeys:session.customKeys,mode:session.mode,activity:activityOf(session),quiz:session.quiz,total:session.firstKeys.length,reviewed:Object.keys(session.reviewAnswers).length,answers:session.firstKeys.map(key => ({key,word:pool.get(key)?.word || key,meaning:pool.get(key)?.meaning || '',points:session.answers[key] ?? 0,...(session.details?.[key] ? {detail:session.details[key]} : {})}))};
    if (result.activity === 'match') {
      result.timeMs=matchTime(session); result.penaltyMs=session.match.penaltyMs;
      const signature=matchSignature(session), best=state.store.matchBest?.[signature];
      result.newBest=!best || result.timeMs < best.timeMs;
      if (result.newBest) (state.store.matchBest ||= {})[signature]={timeMs:result.timeMs,finishedAt:result.finishedAt,total:result.total};
      result.bestMs=state.store.matchBest[signature].timeMs;
    }
    if (!state.store.history.some(item => item.id === result.id)) state.store.history.unshift(result);
    if (RANKED.includes(result.activity)) state.store.communityPending=unique([...(state.store.communityPending || []),result.id]);
    state.store.active = null; state.result = result; persist(); renderResult(result);
    if (effects.lastCompletedId !== result.id) { effects.lastCompletedId=result.id; showFeedback('complete'); }
    syncCommunity();
  }
  function syncCommunity() {
    const store=state.store, key=state.storageKey, submit=state.deps.submitPracticeResult;
    if (state.syncs.has(key)) return state.syncs.get(key);
    if (typeof submit !== 'function' || !store.communityPending?.length) return Promise.resolve(false);
    // Finish against the captured store when the learner changes books mid-request.
    const sync=(async () => {
      while (store.communityPending.length) {
        const id=store.communityPending[0], result=store.history.find(item => item.id === id);
        if (result && RANKED.includes(activityOf(result))) {
          try { if (await submit(result) !== true) return false; }
          catch { return false; }
        }
        store.communityPending=store.communityPending.filter(item => item !== id);
        persistStore(store,key);
      }
      return true;
    })().finally(() => { state.syncs.delete(key); if (state.communitySync === sync) state.communitySync=null; });
    state.syncs.set(key,sync); state.communitySync=sync;
    return sync;
  }
  function dateLabel(date) {
    try { return new Date(date).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
    catch { return ''; }
  }
  function resultSummary(result) {
    const activity=activityOf(result), correct=result.answers.filter(answer => answer.points === 2).length;
    if (activity === 'match') return {score:(result.timeMs/1000).toFixed(1),unit:'秒',headline:result.newBest ? '新纪录！' : '全部配对完成',note:`一次配对成功 ${correct} / ${result.total}`};
    if (isObjective(result)) return {score:scoreOf(result),unit:'%',headline:`答对 ${correct} / ${result.total}`,note:result.reviewed ? `重练 ${result.reviewed} 词，全部答对` : ''};
    const counts=[2,1,0].map(points => result.answers.filter(answer => answer.points === points).length);
    return {score:scoreOf(result),unit:'分',headline:`认识 ${counts[0]} · 模糊 ${counts[1]} · 不认识 ${counts[2]}`,note:result.reviewed ? `重练 ${result.reviewed} 词` : ''};
  }
  function renderResult(result,fromHistory=false) {
    state.screen = 'results'; state.result = result;
    const activity=activityOf(result), objective=isObjective(result), summary=resultSummary(result);
    const weak=result.answers.filter(answer => answer.points < 2 && state.words.has(answer.key));
    const rows=[...result.answers].sort((a,b) => a.points-b.points).map(answer => {
      const detail=answer.detail, mark=answer.points === 2 ? 'is-right' : answer.points === 1 ? 'is-unsure' : 'is-wrong';
      const label=objective ? (answer.points === 2 ? icon('check') : icon('cross')) : e(RATINGS[answer.points]);
      const mine=objective && answer.points < 2 && detail && activity !== 'match' && !detail.unknown && detail.type !== 'judge' ? `<small>你答 ${e(detail.submitted)}</small>` : objective && detail?.errors ? `<small>错配 ${detail.errors} 次</small>` : '';
      return `<div class="pr-result-word ${mark}">${state.words.has(answer.key) ? button('result-word',icon('speaker'),`data-pr-key="${e(answer.key)}" aria-label="朗读 ${e(answer.word)}"`,'pr-icon-button') : '<span></span>'}<button type="button" class="pr-result-main" data-practice-action="word-card" data-pr-key="${e(answer.key)}" ${state.words.has(answer.key) ? '' : 'disabled'}><strong lang="nb">${e(answer.word)}</strong><span>${e(answer.meaning)}</span>${mine}</button><span class="pr-result-mark" ${objective ? `aria-label="${answer.points === 2 ? '正确' : '错误'}"` : ''}>${label}</span></div>`;
    }).join('');
    shell(`<section class="pr-results-hero"><div class="pr-score"><strong>${summary.score}</strong><span>${summary.unit}</span></div><div class="pr-results-copy"><h2>${e(summary.headline)}</h2><p>${e(ACTIVITIES[activity].title)} · ${e(result.label)}${fromHistory ? ` · ${e(dateLabel(result.finishedAt))}` : ''}</p>${summary.note ? `<p>${e(summary.note)}</p>` : ''}</div></section><div class="pr-result-actions">${button('result-again',activity === 'match' ? '再玩一次' : '再练一次','','pr-primary')}${weak.length ? button('result-weak',`练错词 ${weak.length}`,'','pr-secondary') : ''}${button(fromHistory ? 'history' : 'setup','返回','','pr-quiet')}</div><section class="pr-result-list" aria-label="答题回顾">${rows}</section>`);
  }
  function renderHistory() {
    state.screen = 'history';
    const history = state.store.history;
    shell(`<div class="pr-history-page"><div class="pr-page-head"><h2>学习记录</h2>${history.length ? button('export','导出','','pr-quiet') : ''}${button('setup','返回','','pr-secondary')}</div>${historyStats()}${history.length ? `<div class="pr-history-list">${history.map(result => historyEntry(result)).join('')}</div>` : '<section class="pr-empty"><h3>还没有练习记录</h3><p>完成一组练习后会出现在这里。</p></section>'}</div>`);
  }
  function closeDialogs() {
    for (const dialog of state.root?.querySelectorAll('dialog[open]') || []) dialog.close();
  }
  function confirmDialog(title,message,actions) {
    stopAudio(); stopMatchClock();
    const session = currentSession();
    if (session) { session.paused = true; persist(); }
    if (!$('#pr-scope')?.open) closeDialogs();
    state.pending = actions.find(action => action.run)?.run || null;
    const dialog = $('#pr-confirm');
    dialog.innerHTML = `<h2 id="pr-confirm-title">${e(title)}</h2>${message ? `<p>${e(message)}</p>` : ''}<div class="pr-confirm-actions">${actions.map(action => button(action.action,e(action.text),'',action.primary ? 'pr-primary' : action.danger ? 'pr-quiet pr-danger' : 'pr-quiet')).join('')}</div>`;
    dialog.showModal();
  }
  function navigate(screen) {
    const go = () => { closeDialogs(); if (screen === 'history') renderHistory(); else renderSetup(); };
    if (state.screen === 'session' && currentSession()) {
      confirmDialog('先休息一下？','进度已保存，回来后可以继续。',[
        {action:'confirm-run',text:'保存并离开',primary:true,run:go},
        {action:'confirm-resume',text:'继续练习'},
      ]);
    } else { stopAudio(); go(); }
  }
  function resume() {
    const session = currentSession();
    if (!session) return;
    closeDialogs(); session.paused = false; persist(); renderSession(); autoPlay(session); if (activityOf(session) === 'match') startMatchClock();
  }
  function saveSet() {
    if (!state.selected.size) { announce('请先选择练习范围。'); return; }
    const name = $('#pr-set-name').value.trim();
    if (!name) { $('#pr-set-name').focus(); announce('给这组范围起个名字，就可以随时重练。'); return; }
    state.mode = ($('#pr-order')?.value || state.mode) === 'weak' ? 'weak' : 'random';
    const config = {sources:[...state.selected],mode:state.mode,activity:state.activity,quiz:quizConfig(state.quiz)};
    const existing = state.store.sets.find(item => item.name === name);
    const save = () => {
      if (existing) Object.assign(existing,config,{updatedAt:now()});
      else state.store.sets.unshift({id:uid(),name,...config,createdAt:now()});
      state.store.draft=config; persist(); renderSetup(); renderScope(); announce('练习范围已保存。');
    };
    if (existing) confirmDialog('更新同名范围？',`“${name}”已存在，将改为当前范围。`,[{action:'confirm-run',text:'更新',primary:true,run:save},{action:'confirm-close',text:'取消'}]);
    else save();
  }
  function reviewKeys(keys,label,activity='learn',quiz=state.quiz) {
    if (!keys.length) { announce('目前没有需要复习的薄弱词，先完成一组练习吧。'); return; }
    startSession({sources:[],mode:'weak',activity,quiz},keys,label);
  }
  // Objective tests and timed games are reviewed by spelling; the other modes repeat themselves.
  const reviewActivity = activity => ['quiz','match'].includes(activity) ? 'learn' : activity;
  function exportRecords() {
    try {
      const backup = {version:1,seriesId:state.seriesId,seriesTitle:state.seriesTitle,exportedAt:now(),sets:state.store.sets,stats:state.store.stats,history:state.store.history,active:state.store.active,draft:state.store.draft,recent:state.store.recent,favorites:state.store.favorites,matchBest:state.store.matchBest};
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json;charset=utf-8'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = `norsk-practice-${state.seriesId}-${now().slice(0,10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url),1000);
      announce('学习记录已导出，请保留下载的备份文件。');
    } catch { announce('记录导出失败，请稍后重试。'); }
  }
  function exitPrompt() {
    if (!currentSession()) return;
    confirmDialog('离开这次练习？','进度会保存，下次从这里继续。',[
      {action:'confirm-run',text:'保存并退出',primary:true,run:renderSetup},
      {action:'confirm-resume',text:'继续练习'},
      {action:'discard',text:'放弃本次进度',danger:true},
    ]);
  }
  function onClick(event) {
    if (state.initialized && state.visible && state.root?.contains(event.target)) unlockFeedbackAudio(event);
    const modeTarget = event.target.closest('[data-pr-activity]');
    if (modeTarget && state.initialized && state.root?.contains(modeTarget) && ACTIVITIES[modeTarget.dataset.prActivity]) { state.activity=modeTarget.dataset.prActivity; state.scopeQuery=''; if (state.selected.size) state.scopeTab=[...state.selected].some(token => !token.startsWith('basic:')) ? 'chapters' : 'basics'; draft(); renderScope(); return; }
    const target = event.target.closest('[data-practice-action]');
    if (!target || !state.initialized) return;
    const action = target.dataset.practiceAction;
    const session = currentSession();
    const id = target.dataset.prId;
    switch (action) {
      case 'setup': navigate('setup'); break;
      case 'history': navigate('history'); break;
      case 'export': exportRecords(); break;
      case 'weak': reviewKeys(weakKeys(),'薄弱词复习',state.activity,state.quiz); break;
      case 'favorites': { const keys=favoriteKeys(); if (!keys.length) { announce('先在练习中点星标收藏词语，就能在这里复习。'); break; } startSession({sources:[],mode:state.mode,activity:state.activity,quiz:state.quiz},keys,'收藏词语'); break; }
      case 'favorite': toggleFavorite(target.dataset.prKey || (session && currentKey(session))); break;
      case 'scope-open': renderScope(); break;
      case 'scope-close': $('#pr-scope')?.close?.(); break;
      case 'series': if (target.dataset.prSeries !== state.seriesId) { state.reopenActivity=state.activity; state.deps.selectSeries?.(target.dataset.prSeries); } break;
      case 'scope-tab': state.scopeTab=target.dataset.prTab === 'basics' ? 'basics' : 'chapters'; renderScope(); break;
      case 'clear-selection': state.selected.clear(); updateSelectionUI(); break;
      case 'save-set': saveSet(); break;
      case 'saved-load': { const set = state.store.sets.find(item => item.id === id); if (set) loadScope(set); break; }
      case 'recent-load': { const config = state.store.recent[Number(target.dataset.prIndex)]; if (config) loadScope(config); break; }
      case 'saved-start': { const set = state.store.sets.find(item => item.id === id); if (set) startSession(set); break; }
      case 'saved-delete': {
        const set = state.store.sets.find(item => item.id === id);
        if (set) confirmDialog('删除这个常用范围？',set.name,[{action:'confirm-run',text:'删除',primary:true,run:() => { state.store.sets=state.store.sets.filter(item => item.id !== id); persist(); renderSetup(); renderScope(); }},{action:'confirm-close',text:'保留'}]);
        break;
      }
      case 'recent-start': { const config = state.store.recent[Number(target.dataset.prIndex)]; if (config) startSession(config); break; }
      case 'start': startSession({sources:[...state.selected],mode:$('#pr-order')?.value || state.mode,activity:state.activity,quiz:state.quiz}); break;
      case 'resume': resume(); break;
      case 'pause': if (session?.paused) resume(); else { pause(); renderSession(); } break;
      case 'exit': exitPrompt(); break;
      case 'discard': closeDialogs(); stopAudio(); stopMatchClock(); state.store.active=null; persist(); renderSetup(); break;
      case 'confirm-run': { const run=state.pending; state.pending=null; closeDialogs(); run?.(); break; }
      case 'confirm-close': state.pending=null; $('#pr-confirm')?.close?.(); if (state.screen === 'session') resume(); break;
      case 'confirm-resume': state.pending=null; resume(); break;
      case 'replay': playCurrent(); break;
      case 'word-card': openWordCard(target.dataset.prKey); break;
      case 'card-close': $('#pr-card')?.close?.(); break;
      case 'rate': rateCard(Number(target.dataset.prPoints)); break;
      case 'flip': flipCard(); break;
      case 'card-direction': if (session && activityOf(session) === 'cards' && !session.paused) { session.cardsReverse=!session.cardsReverse; session.flipped=false; persist(); renderSession(); if (!session.cardsReverse) playCurrent(); } break;
      case 'previous': previousCard(); break;
      case 'objective': submitObjective(target.dataset.prValue); break;
      case 'unknown': submitObjective('',true); break;
      case 'letter': insertLetter(target.dataset.prLetter); break;
      case 'keyboard-page': state.keyboardPage=state.keyboardPage === 'symbols' ? 'letters' : 'symbols'; if ($('#pr-keyboard')) $('#pr-keyboard').innerHTML=renderKeyboard(); break;
      case 'keyboard-mode': toggleKeyboardMode(); break;
      case 'match-tile': selectMatchTile(target.dataset.prTile); break;
      case 'match-next': nextMatchRound(); break;
      case 'next': next(); break;
      case 'review-start': if (session && session.phase === 'review-intro') { session.phase='review'; session.index=0; session.paused=false; session.inputDraft=''; session.flipped=false; persist(); renderSession(); autoPlay(session); } break;
      case 'finish': finish(); break;
      case 'result-weak': if (state.result) reviewKeys(state.result.answers.filter(answer => answer.points < 2).map(answer => answer.key),'错词重练',reviewActivity(activityOf(state.result)),state.result.quiz); break;
      case 'result-again': if (state.result) startSession({sources:state.result.sources,mode:state.result.mode,activity:activityOf(state.result),quiz:state.result.quiz},state.result.customKeys || null,state.result.label); break;
      case 'result-word': { const word=state.words.get(target.dataset.prKey); stopAudio(); if (word) Promise.resolve().then(() => state.deps.pronounce?.(word)).catch(() => announce('读音暂时无法播放，请稍后重试。')); break; }
      case 'history-detail': { const result=state.store.history.find(item => item.id === id); if (result) renderResult(result,true); break; }
      case 'history-weak': { const result=state.store.history.find(item => item.id === id); if (result) reviewKeys(result.answers.filter(answer => answer.points < 2).map(answer => answer.key),`${dateLabel(result.finishedAt)} · 错词重练`,reviewActivity(activityOf(result)),result.quiz); break; }
    }
  }
  function onChange(event) {
    const input = event.target;
    if (!state.root?.contains(input)) return;
    if (input.dataset.prChapter) {
      const chapter = state.chapters.find(item => item.token === input.dataset.prChapter);
      if (!chapter) return;
      chapter.sections.forEach(section => state.selected.delete(section.token));
      if (input.checked) state.selected.add(chapter.token); else state.selected.delete(chapter.token);
      updateSelectionUI();
    } else if (input.dataset.prSource) {
      const token = input.dataset.prSource;
      const chapter = state.chapters.find(item => item.sections.some(section => section.token === token));
      if (chapter && state.selected.has(chapter.token)) {
        state.selected.delete(chapter.token);
        chapter.sections.forEach(section => { if (section.token !== token) state.selected.add(section.token); });
      } else if (input.checked) state.selected.add(token); else state.selected.delete(token);
      updateSelectionUI();
    } else if (input.id === 'pr-order') { state.mode=input.value === 'weak' ? 'weak' : 'random'; draft(); }
    else if (input.dataset.prQuizType) {
      const type=input.dataset.prQuizType, types=state.quiz.types;
      if (!QUIZ_TYPES.includes(type)) return;
      if (!input.checked && types.length === 1 && types.includes(type)) { input.checked=true; announce('至少保留一种题型。'); return; }
      state.quiz.types=input.checked ? unique([...types,type]) : types.filter(item => item !== type); draft();
    } else if (input.id === 'pr-quiz-direction') { state.quiz=quizConfig({...state.quiz,direction:input.value}); draft(); }
  }
  function onInput(event) {
    if (!state.root?.contains(event.target)) return;
    if (event.target.id === 'pr-source-search') { state.scopeQuery=event.target.value; filterScope(); }
    if (event.target.id === 'pr-answer') { const session=currentSession(); if (session && !session.paused && !answered(session)) { session.inputDraft=event.target.value; persist(); updateAnswerButton(); } }
  }
  function onSubmit(event) {
    if (event.target.id !== 'pr-answer-form' || !state.root?.contains(event.target)) return;
    event.preventDefault(); unlockFeedbackAudio(event); submitObjective($('#pr-answer')?.value || '');
  }
  function renderKeyboard() {
    const accents=['æ','ø','å','é'];
    if (keyboardMode() === 'system') return `<div class="pr-keyboard-row pr-keyboard-accents">${accents.map(letter => button('letter',letter,`data-pr-letter="${letter}"`,'pr-key')).join('')}</div>`;
    const symbols=state.keyboardPage === 'symbols';
    // Same places as a Norwegian keyboard: Å right of P, Ø and Æ right of L.
    const rows=symbols ? ['1234567890'.split(''),['.',',','?','!','-',"'",':','/'],['(',')','+','%','&','backspace']] : ['qwertyuiopå'.split(''),'asdfghjkløæ'.split(''),[...'zxcvbnmé','backspace']];
    const key = letter => button('letter',letter === 'backspace' ? '⌫' : e(letter),`data-pr-letter="${e(letter)}"${letter === 'backspace' ? ' aria-label="退格"' : ''}`,'pr-key'+(letter === 'backspace' ? ' pr-key-wide' : ''));
    return `<div class="pr-keyboard${symbols ? ' is-symbols' : ''}" role="group" aria-label="挪威语屏幕键盘">${rows.map(row => `<div class="pr-keyboard-row">${row.map(key).join('')}</div>`).join('')}<div class="pr-keyboard-row">${button('keyboard-page',symbols ? 'ABC' : '123','aria-label="'+(symbols ? '切换字母键盘' : '切换数字和符号')+'"','pr-key pr-key-wide')}${button('letter','空格','data-pr-letter=" " aria-label="空格"','pr-key pr-key-space')}${button('letter','-','data-pr-letter="-"','pr-key')}</div></div>`;
  }
  function consecutiveCorrect(session) {
    const keys=currentKeys(session), answers=answerMap(session);
    const counted=new Set();
    // A re-queued review word appears twice; its earlier copy was the missed attempt.
    for (let index=session.index;index>=0 && answers[keys[index]] === 2 && !counted.has(keys[index]);index--) counted.add(keys[index]);
    return counted.size;
  }
  function updateAnswerButton() {
    const input=$('#pr-answer'), check=$('#pr-check-answer');
    if (check) check.disabled=!input?.value.trim();
  }
  function insertLetter(letter) {
    const session=currentSession(), input=$('#pr-answer');
    if (!session || session.paused || answered(session) || !input || session.questions?.[currentKey(session)]?.type !== 'spell') return;
    if (letter !== 'backspace' && !/^[a-zæøåé0-9 .,?!\-':/()+%&]$/.test(letter)) return;
    let start=input.selectionStart ?? input.value.length;
    const end=input.selectionEnd ?? start;
    if (letter === 'backspace' && start === end && start > 0) {
      const before=input.value.slice(0,start);
      const last=typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter('nb',{granularity:'grapheme'}).segment(before)].at(-1)?.segment : [...before].at(-1);
      start-=last?.length || 0;
    }
    const inserted=letter === 'backspace' ? '' : letter;
    input.value=input.value.slice(0,start)+inserted+input.value.slice(end);
    input.focus?.({preventScroll:true}); input.setSelectionRange?.(start+inserted.length,start+inserted.length);
    session.inputDraft=input.value; persist(); updateAnswerButton();
  }
  function toggleKeyboardMode() {
    const input=$('#pr-answer'), session=currentSession();
    if (!input || !session || session.paused || answered(session)) return;
    const start=input.selectionStart, end=input.selectionEnd;
    session.inputDraft=input.value;
    state.store.keyboardMode=keyboardMode() === 'system' ? 'screen' : 'system'; state.store.keyboardChoice=true;
    persist(); renderSession(); $('#pr-answer')?.setSelectionRange?.(start,end);
  }
  function onKey(event) {
    if (event.isComposing || event.keyCode === 229 || !state.visible || state.screen !== 'session' || state.root.hidden || event.altKey || event.ctrlKey || event.metaKey) return;
    unlockFeedbackAudio(event);
    if ($('#pr-confirm')?.open) return;
    const session=currentSession();
    if (!session) return;
    const activity=activityOf(session);
    if (event.key === 'Escape') {
      if ($('#pr-card')?.open) return;
      event.preventDefault();
      if (activity === 'match') { if (session.paused) resume(); else { pause(); renderSession(); } }
      else exitPrompt();
      return;
    }
    if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || session.paused || session.phase === 'review-intro' || $('#pr-card')?.open) return;
    if (event.code === 'Space' && event.target.tagName !== 'BUTTON') {
      event.preventDefault();
      if (activity === 'cards') flipCard(); else if (activity !== 'match') playCurrent();
      return;
    }
    if (activity === 'cards') {
      if (['1','2','3'].includes(event.key) && !answered(session)) { event.preventDefault(); rateCard(Number(event.key)-1); return; }
      if (event.key === 'ArrowLeft') { event.preventDefault(); previousCard(); return; }
    } else if (activity !== 'match' && !answered(session)) {
      const question=session.questions?.[currentKey(session)];
      if (question?.type === 'choice' && ['1','2','3','4'].includes(event.key)) { event.preventDefault(); submitObjective(Number(event.key)-1); }
      else if (question?.type === 'judge' && ['1','2'].includes(event.key)) { event.preventDefault(); submitObjective(event.key === '1' ? 'true' : 'false'); }
    }
    if (activity !== 'match' && (event.key === 'ArrowRight' || (event.key === 'Enter' && event.target.tagName !== 'BUTTON')) && answered(session)) { event.preventDefault(); next(); }
  }
  // Restored or legacy sessions keep their questions; only missing or broken ones are rebuilt.
  function ensureQuestions(session,pool=sessionPool(session)) {
    const activity=activityOf(session);
    if (!['learn','quiz','listen'].includes(activity)) return;
    session.questions ||= {};
    const broken=session.firstKeys.filter(key => { const question=session.questions[key]; return !question || (question.options && question.options.some(option => !pool.has(option.key))) || (question.proposedKey && !pool.has(question.proposedKey)); });
    if (!broken.length) return;
    const generated=makeQuestions(pool,session.firstKeys,activity,session.quiz);
    for (const key of broken) session.questions[key]=generated[key];
  }
  function recoverActive() {
    const session = currentSession();
    if (!session) return;
    if (!Array.isArray(session.firstKeys) || !session.answers || !['first','review','review-intro'].includes(session.phase)) { state.store.active=null; return; }
    const oldKey = currentKeys(session)?.[session.index];
    const pool = sessionPool(session);
    session.firstKeys = session.firstKeys.filter(key => pool.has(key));
    session.reviewKeys = (session.reviewKeys || []).filter(key => pool.has(key));
    session.reviewAnswers ||= {};
    session.activity=activityOf(session); session.quiz=quizConfig(session.quiz); session.details ||= {}; session.reviewDetails ||= {};
    if (session.activity === 'match') {
      for (const key of Object.keys(session.answers)) if (!session.firstKeys.includes(key)) delete session.answers[key];
      for (const key of Object.keys(session.details)) if (!session.firstKeys.includes(key)) delete session.details[key];
    }
    if (!session.firstKeys.length) { state.store.active=null; return; }
    const keys = currentKeys(session);
    // Review queues may hold a re-queued word twice; its live copy is the later one.
    const retainedIndex = keys.lastIndexOf(oldKey);
    const unansweredIndex = keys.findIndex(key => !has(answerMap(session),key));
    session.index = retainedIndex >= 0 ? retainedIndex : Math.max(0,unansweredIndex);
    ensureQuestions(session,pool);
    if (session.activity === 'match') {
      state.matchStartedAt=null;
      if (!session.match || !Array.isArray(session.match.tiles)) { session.match={round:0,elapsedMs:0,penaltyMs:0,errors:{},matched:[],selected:null,wrong:[]}; makeMatchRound(session,pool); }
      else {
        const match=session.match;
        match.elapsedMs=Math.max(0,Number(match.elapsedMs) || 0); match.penaltyMs=Math.max(0,Number(match.penaltyMs) || 0);
        const oldTileCount=match.tiles.length;
        match.tiles=match.tiles.filter(tile => pool.has(tile.key)); match.matched=(match.matched || []).filter(id => match.tiles.some(tile => tile.id === id));
        match.selected=null; match.wrong=[]; match.errors ||= {};
        match.roundDone=match.tiles.length > 0 && match.tiles.every(tile => match.matched.includes(tile.id));
        if (!match.tiles.length || oldTileCount !== match.tiles.length) makeMatchRound(session,pool);
      }
    }
    session.paused = true;
  }
  function init(deps) {
    state.root = document.querySelector('#practice-view');
    if (!state.root) return;
    const seriesId=deps.series?.id || 'god-i-norsk';
    const changing=state.initialized && seriesId !== state.seriesId;
    if (changing) {
      hide(); closeDialogs(); persist();
      state.stores.set(state.seriesId,state.store);
      state.selected=new Set(); state.result=null; state.pending=null;
      state.screen='setup'; state.scopeTab='chapters'; state.scopeQuery='';
      state.keyboardPage='letters'; state.justMatched=[]; state.flipAnimation=false;
      state.storageError=''; state.communitySync=null;
    }
    state.deps = {...state.deps,...deps};
    state.seriesId=seriesId;
    state.seriesTitle=deps.series?.title || 'God i norsk';
    state.storageKey=storageKeyFor(seriesId);
    indexData(deps.data);
    if (!state.initialized || changing) {
      state.store=state.stores.get(seriesId) || readStore();
      state.stores.set(seriesId,state.store);
    }
    if (!state.initialized) {
      document.addEventListener('click',onClick);
      document.addEventListener('change',onChange);
      document.addEventListener('input',onInput);
      document.addEventListener('submit',onSubmit);
      document.addEventListener('keydown',onKey);
      document.addEventListener('pointerdown',event => { if (event.button === 0 && state.visible && state.root?.contains(event.target)) { unlockFeedbackAudio(event); if (event.target.closest('[data-pr-letter]')) event.preventDefault(); } });
      window.addEventListener('online',syncCommunity);
      window.addEventListener('beforeunload',() => { stopFeedback(); if (currentSession()) { stopMatchClock(); currentSession().paused=true; persist(); } });
      document.addEventListener('visibilitychange',() => {
        if (!document.hidden) return;
        stopFeedback();
        const session=currentSession();
        if (!session || !state.visible) return;
        // Only the timed game needs a visible pause; other modes simply stop speaking.
        if (activityOf(session) === 'match') { pause(); if (state.screen === 'session') renderSession(); }
        else { stopAudio(); persist(); }
      });
      state.initialized=true;
    }
    recoverActive();
    applyConfig(state.store.draft || state.store.recent[0] || {sources:state.chapters[0] ? [state.chapters[0].token] : [],mode:'random',activity:'cards'});
    renderSetup(); syncCommunity();
  }
  function show() {
    if (!state.initialized) return;
    state.visible=true; syncCommunity();
    const session=currentSession();
    if (state.screen === 'session' && session?.paused && activityOf(session) !== 'match') resume();
    else if (state.screen === 'session') renderSession();
    else if (state.screen === 'history') renderHistory();
    else if (state.screen === 'results' && state.result) renderResult(state.result);
    else renderSetup();
    // Switching textbook from the range dialog returns to the same activity's dialog.
    if (state.reopenActivity && state.screen === 'setup' && ACTIVITIES[state.reopenActivity]) { state.activity=state.reopenActivity; state.scopeQuery=''; renderScope(); }
    state.reopenActivity=null;
    syncSidebar();
  }
  function hide() {
    state.visible=false;
    if (currentSession()) pause(); else stopAudio();
  }
  window.NorskPractice = {init,show,hide,renderTOC};
  window.dispatchEvent(new Event('norskpracticeready'));
})();
