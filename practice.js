/* Norwegian listening practice. All progress stays in this browser. */
(() => {
  'use strict';
  if (window.NorskPractice) return;
  const STORAGE_KEY = 'norsk-practice-v1';
  const RATINGS = {2:'想起了',1:'有点模糊',0:'未记住'};
  const ACTIVITIES = {
    cards:{title:'翻面词卡',description:'翻面回想，标记掌握情况',hint:'看词回想释义，也可以切换正反面。'},
    learn:{title:'拼写学习',description:'根据释义写出挪威语',hint:'输入挪威语；没想起来也可以先看答案，稍后再练。'},
    quiz:{title:'综合测验',description:'判断、选择、拼写交替练',hint:'每个词只答一次，完成后查看准确率和答案。'},
    match:{title:'配对消除',description:'找到词语和释义，挑战用时',hint:'每组最多 6 对，全部消除后继续下一组。错配加 1 秒。'},
    listen:{title:'听音记词',description:'听读音，回想意思并自评',hint:'先听读音，再按第一印象自评。'}
  };
  const activityOf = config => ACTIVITIES[config?.activity] ? config.activity : 'listen';
  const defaultQuiz = () => ({types:['judge','choice','spell'],direction:'to-nb',showAnswers:true});
  function quizConfig(value={}) {
    const types = unique((Array.isArray(value.types) ? value.types : defaultQuiz().types).filter(type => ['judge','choice','spell'].includes(type)));
    return {types:types.length ? types : ['spell'],direction:['to-nb','to-zh','mixed'].includes(value.direction) ? value.direction : 'to-nb',showAnswers:value.showAnswers !== false};
  }
  const normalize = word => String(word || '').normalize('NFC').trim().toLocaleLowerCase('nb');
  const unique = values => [...new Set(values.filter(Boolean))];
  const blankStore = () => ({version:1,sets:[],recent:[],stats:{},history:[],active:null,draft:null,favorites:[],matchBest:{},keyboardMode:'screen',feedbackSound:true,communityPending:[]});
  const state = {root:null,deps:{},sources:new Map(),chapters:[],basics:[],words:new Map(),selected:new Set(),mode:'random',activity:'cards',quiz:defaultQuiz(),scopeTab:'chapters',scopeQuery:'',keyboardPage:'letters',store:blankStore(),screen:'setup',result:null,storageError:'',initialized:false,visible:false,pending:null,playToken:0,matchTimer:null,matchStartedAt:null,communitySync:null};
  const $ = selector => state.root?.querySelector(selector);
  const e = value => (state.deps.escapeHTML || (text => String(text ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))))(value);
  const button = (action,text,extra='',kind='') => `<button type="button" class="pr-button ${kind}" data-practice-action="${action}" ${extra}>${text}</button>`;
  const rateControl = () => { const control=state.deps.renderRateControl?.() || ''; return control ? `<div class="pr-rate-control">${control}</div>` : ''; };
  const now = () => new Date().toISOString();
  // Effects belong to a fresh answer event, never to rendering or restored history.
  const effects = {context:null,voices:new Set(),audioToken:0,visualTimer:null,visualNodes:[],lastCompletedId:null};
  const soundIcon = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 4-6 5H2v6h3l6 5z"/>${state.store.feedbackSound ? '<path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>' : '<path d="m16 9 6 6m0-6-6 6"/>'}</svg>`;
  const soundControl = () => button('sound',`${soundIcon()}<span>音效${state.store.feedbackSound ? '开' : '关'}</span>`,`aria-pressed="${state.store.feedbackSound}" aria-label="${state.store.feedbackSound ? '关闭' : '开启'}练习音效" title="练习音效${state.store.feedbackSound ? '已开启' : '已关闭'}"`,'pr-small pr-quiet pr-sound-toggle');
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
  function toggleSound(event) {
    state.store.feedbackSound=!state.store.feedbackSound;
    if (state.store.feedbackSound) unlockFeedbackAudio(event); else stopFeedbackAudio();
    persist();
    // Update only the toggle so the spelling draft, caret and keyboard stay intact.
    state.root?.querySelectorAll('[data-practice-action="sound"]').forEach(control => {
      control.innerHTML=`${soundIcon()}<span>音效${state.store.feedbackSound ? '开' : '关'}</span>`;
      control.setAttribute('aria-pressed',String(state.store.feedbackSound));
      control.setAttribute('aria-label',`${state.store.feedbackSound ? '关闭' : '开启'}练习音效`);
      control.title=`练习音效${state.store.feedbackSound ? '已开启' : '已关闭'}`;
    });
  }
  function feedbackMarkup(kind,title,body='',streak=0) {
    const icon=kind === 'correct' ? '<path d="m5 12 4 4L19 6"/>' : kind === 'wrong' ? '<path d="M5 9a7 7 0 1 1 0 7M5 4v5h5"/>' : '<path d="M12 5v14M5 12h14"/>';
    return `<div class="pr-feedback pr-answer-feedback is-${kind}" role="status" aria-live="polite"><span class="pr-feedback-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></span><div class="pr-feedback-copy"><strong>${title}</strong>${body}</div>${streak >= 3 ? `<span class="pr-streak-badge">${streak} 连对<span aria-hidden="true">✦</span></span>` : ''}</div>`;
  }
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
  const currentSession = () => state.store.active;
  const currentKeys = session => session.phase === 'review' ? session.reviewKeys : session.firstKeys;
  const currentKey = session => currentKeys(session)[session.index];
  const answerMap = session => session.phase === 'review' ? session.reviewAnswers : session.answers;
  const answered = session => Object.prototype.hasOwnProperty.call(answerMap(session),currentKey(session));
  const scoreOf = result => result.total ? Math.round(result.answers.reduce((sum,item) => sum + item.points,0) / (result.total * 2) * 100) : 0;
  function announce(message) { state.deps.notify?.(message); }
  function storageFailure(message) {
    if (!state.storageError) announce(message);
    state.storageError = message;
    const warning = $('#pr-storage-warning');
    if (warning) { warning.hidden = false; warning.textContent = message; }
  }
  function readStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return blankStore();
      const value = JSON.parse(raw);
      if (!value || value.version !== 1 || !Array.isArray(value.sets) || !Array.isArray(value.history) || !value.stats || typeof value.stats !== 'object') throw new Error('Invalid practice history');
      return {...blankStore(),...value,feedbackSound:value.feedbackSound !== false,communityPending:Array.isArray(value.communityPending) ? unique(value.communityPending.filter(id => typeof id === 'string')) : [],recent:Array.isArray(value.recent) ? value.recent : [],favorites:Array.isArray(value.favorites) ? unique(value.favorites.filter(key => typeof key === 'string')) : [],matchBest:value.matchBest && typeof value.matchBest === 'object' ? value.matchBest : {}};
    } catch {
      storageFailure('本机学习记录暂时无法读取。本次仍可练习，新进度可能无法在刷新后恢复。');
      return blankStore();
    }
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY,JSON.stringify(state.store)); }
    catch { storageFailure('本机存储空间不足或暂不可用。本次仍可练习，刷新后可能丢失新进度。'); }
    syncSidebar();
  }
  function stopAudio() { ++state.playToken; stopFeedback(); state.deps.stopAudio?.(); }
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
      const label = `第 ${chapter.id} 章 · ${chapter.title}`;
      const sections = (chapter.sections || []).map(section => ({...section,...add(`section:${section.id}`,`${section.id} ${section.title}`,section.words)}));
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
  function mastery(key) {
    const stats = state.store.stats[key];
    if (!stats?.seen) return {text:'尚未练习',percent:0};
    const percent = Math.round(stats.points / (stats.seen * 2) * 100);
    return {text:percent >= 85 ? '熟悉' : percent >= 50 ? '巩固中' : '待复习',percent};
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
    return `<div class="pr-sidebar"><p class="pr-sidebar-label">每天练一点，慢慢记牢。</p>${button('setup','选择练习','','pr-side-button')}${button('history','学习记录','','pr-side-button')}${button('weak',`复习薄弱词 <span data-practice-stat="weak">${weakKeys().length}</span>`,'','pr-side-button')}${button('favorites',`只练收藏 <span data-practice-stat="favorites">${favoriteKeys().length}</span>`,'','pr-side-button')}<div class="pr-sidebar-stats"><span><strong data-practice-stat="practiced">${Object.keys(state.store.stats).length}</strong>已练词语</span><span><strong data-practice-stat="sessions">${state.store.history.length}</strong>完成次数</span></div><p class="pr-local-note">学习进度保存在此浏览器中。</p></div>`;
  }
  function syncSidebar() {
    const values = {weak:weakKeys().length,favorites:favoriteKeys().length,practiced:Object.keys(state.store.stats).length,sessions:state.store.history.length};
    document.querySelectorAll('[data-practice-stat]').forEach(node => { node.textContent = values[node.dataset.practiceStat] ?? ''; });
  }
  function shell(content) {
    clearFeedbackVisual();
    state.root.innerHTML = `<div class="pr-app"><p id="pr-storage-warning" class="pr-storage-warning" role="status" ${state.storageError ? '' : 'hidden'}>${e(state.storageError)}</p>${content}</div><dialog class="pr-dialog pr-card-dialog" id="pr-card" aria-labelledby="pr-card-title"></dialog><dialog class="pr-dialog pr-confirm-dialog" id="pr-confirm" aria-labelledby="pr-confirm-title"></dialog><dialog class="pr-dialog pr-scope-dialog" id="pr-scope" aria-labelledby="pr-scope-title"></dialog>`;
    $('#pr-card').addEventListener('cancel',() => { if (currentSession()) currentSession().cardOpen = false; });
    $('#pr-confirm').addEventListener('cancel',event => { event.preventDefault(); state.pending = null; $('#pr-confirm').close(); if (state.screen === 'session') renderSession(); });
  }
  function sourceCheckbox(source,checked=false) {
    return `<label class="pr-source-row" data-pr-source-search="${e(source.label.toLocaleLowerCase('nb'))}"><input type="checkbox" data-pr-source="${e(source.token)}" ${checked ? 'checked' : ''}><span><span class="pr-source-title">${e(source.label)}</span></span><small>${source.words.length} 词</small></label>`;
  }
  function savedGroups() {
    const saved = state.store.sets, recent = state.store.recent;
    if (!saved.length && !recent.length) return '';
    return `<details class="pr-options pr-saved-options"><summary>常用与最近范围</summary><div class="pr-recent-list">${saved.map(set => `<div><span>${e(set.name)}<small>${e(selectedLabel(set.sources))}</small></span>${button('saved-load','选用',`data-pr-id="${e(set.id)}"`,'pr-small')}${button('saved-delete','删除',`data-pr-id="${e(set.id)}" aria-label="删除组合 ${e(set.name)}"`,'pr-small pr-quiet')}</div>`).join('')}${recent.map((entry,index) => `<div><span>${e(entry.label || selectedLabel(entry.sources))}</span>${button('recent-load','选用',`data-pr-index="${index}"`,'pr-small')}</div>`).join('')}</div></details>`;
  }
  function modeIcon(activity) {
    const paths = {cards:'M5 5h11v14H5z M9 2h10v14',learn:'m4 17 1-5L15 2l5 5-10 10z M4 21h16',quiz:'M5 3h14v18H5z M8 8l2 2 4-4 M8 15h8',match:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',listen:'M11 4 5 9H2v6h3l6 5z M15 8a6 6 0 0 1 0 8 M18 5a10 10 0 0 1 0 14'};
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[activity]}"/></svg>`;
  }
  function renderSetup() {
    state.screen = 'setup';
    const active = currentSession();
    shell(`${active ? `<section class="pr-resume-banner"><div><strong>上次练习还在这里</strong><p>${e(ACTIVITIES[activityOf(active)].title)} · ${e(active.label)} · 已完成 ${Object.keys(active.answers).length} / ${active.firstKeys.length} 词</p></div>${button('resume','继续练习','','pr-primary')}</section>` : ''}<div class="pr-intro"><div><p class="pr-kicker">ØV LITT HVER DAG · 每天练一点</p><h2>把学过的，慢慢记牢。</h2><p>选一种方式，开始今天的练习。</p></div></div><div class="pr-mode-grid" role="group" aria-label="练习方式">${Object.entries(ACTIVITIES).map(([key,item]) => `<button type="button" class="pr-mode-card" data-pr-activity="${key}" aria-haspopup="dialog" aria-controls="pr-scope"><span class="pr-mode-icon">${modeIcon(key)}</span><span class="pr-mode-title">${item.title}</span><span class="pr-mode-description">${item.description}</span><span class="pr-mode-arrow" aria-hidden="true">↗</span></button>`).join('')}</div><div class="pr-setup-footer">${soundControl()}${button('history','学习记录','','pr-quiet')}${button('community','排行榜','','pr-quiet')}</div>`);
  }
  function scopeOptions() {
    const types = state.quiz.types;
    return `<details class="pr-options pr-scope-options"><summary>更多选项</summary><div class="pr-settings"><label>出题顺序<select id="pr-order"><option value="random" ${state.mode === 'random' ? 'selected' : ''}>随机抽词</option><option value="weak" ${state.mode === 'weak' ? 'selected' : ''}>优先薄弱词</option></select></label>${rateControl()}</div>${state.activity === 'quiz' ? `<div class="pr-quiz-options"><div class="pr-check-options" role="group" aria-label="测验题型">${[['judge','判断'],['choice','四选一'],['spell','拼写']].map(([value,label]) => `<label><input type="checkbox" data-pr-quiz-type="${value}" ${types.includes(value) ? 'checked' : ''}>${label}</label>`).join('')}</div><label class="pr-direction-label">出题方向<select id="pr-quiz-direction"><option value="to-nb" ${state.quiz.direction === 'to-nb' ? 'selected' : ''}>中文 → 挪威语</option><option value="to-zh" ${state.quiz.direction === 'to-zh' ? 'selected' : ''}>挪威语 → 中文</option><option value="mixed" ${state.quiz.direction === 'mixed' ? 'selected' : ''}>两个方向混合</option></select></label><label><input type="checkbox" id="pr-show-answers" ${state.quiz.showAnswers ? 'checked' : ''}>答题后显示正确答案</label><p class="pr-help">拼写题始终看中文写挪威语；方向设置适用于判断和选择。候选词不足时会改为拼写题。</p></div>` : ''}<div class="pr-scope-shortcuts">${button('weak',`复习薄弱词 · ${weakKeys().length}`,weakKeys().length ? '' : 'disabled','pr-small')}${button('favorites',`只练收藏 · ${favoriteKeys().length}`,favoriteKeys().length ? '' : 'disabled','pr-small')}</div>${savedGroups()}<details class="pr-options"><summary>保存当前范围</summary><div class="pr-save-combo"><label class="sr-only" for="pr-set-name">组合名称</label><input id="pr-set-name" type="text" maxlength="40" placeholder="范围名称">${button('save-set','保存','','pr-small')}</div></details></details>`;
  }
  function renderScope() {
    const dialog = $('#pr-scope');
    if (!dialog) return;
    const pool = poolFor(state.selected);
    dialog.innerHTML = `<div class="pr-dialog-heading"><div><p class="pr-kicker">选择练习范围</p><h2 id="pr-scope-title" tabindex="-1">${ACTIVITIES[state.activity].title}</h2></div>${button('scope-close','<span aria-hidden="true">×</span>','aria-label="返回练习方式"','pr-quiet pr-scope-close')}</div><div class="pr-source-tabs" role="group" aria-label="词语来源">${button('scope-tab','教材词汇',`data-pr-tab="chapters" aria-pressed="${state.scopeTab === 'chapters'}"`,'pr-small')}${button('scope-tab','基础常识',`data-pr-tab="basics" aria-pressed="${state.scopeTab === 'basics'}"`,'pr-small')}</div><input type="search" class="pr-source-search" id="pr-source-search" placeholder="搜索章节、小节或分类" aria-label="搜索练习范围" value="${e(state.scopeQuery)}"><div class="pr-source-columns"><section data-pr-scope-tab="chapters" ${state.scopeTab === 'chapters' ? '' : 'hidden'}><div class="pr-chapter-list">${state.chapters.map(chapter => `<details class="pr-source-chapter" data-pr-chapter-search="${e((chapter.label+' '+chapter.sections.map(section => section.label).join(' ')).toLocaleLowerCase('nb'))}" ${!state.selected.has(chapter.token) && chapter.sections.some(section => state.selected.has(section.token)) ? 'open' : ''}><summary><label class="pr-chapter-select"><input type="checkbox" data-pr-chapter="${e(chapter.token)}" ${state.selected.has(chapter.token) ? 'checked' : ''}><span>第 ${e(chapter.id)} 章 · ${e(chapter.title)}</span><small>${chapter.words.length} 词</small></label><span class="pr-section-toggle">小节 <span aria-hidden="true">⌄</span></span></summary>${chapter.sections.map(section => sourceCheckbox(section,state.selected.has(chapter.token) || state.selected.has(section.token))).join('')}</details>`).join('')}</div></section><section data-pr-scope-tab="basics" ${state.scopeTab === 'basics' ? '' : 'hidden'}><div id="pr-basic-sources">${state.basics.map(category => sourceCheckbox(category,state.selected.has(category.token))).join('')}</div></section></div><p class="pr-source-empty pr-help" id="pr-source-empty" hidden>没有匹配的范围，试试其他名称。</p>${scopeOptions()}<p id="pr-start-note" class="pr-help" ${state.activity === 'match' && pool.size === 1 ? '' : 'hidden'}>配对消除至少需要 2 个词。</p><div class="pr-scope-footer"><div class="pr-scope-total"><span id="pr-scope-count" aria-live="polite">已选 ${pool.size} 个词</span>${button('clear-selection','清空','','pr-small pr-quiet')}</div>${button('start','开始练习','id="pr-start" '+(!pool.size || (state.activity === 'match' && pool.size < 2) ? 'disabled' : ''),'pr-primary')}</div>`;
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
    const label = $('#pr-selection-label'), count = $('#pr-selection-count'), scopeCount = $('#pr-scope-count'), start = $('#pr-start'), note = $('#pr-start-note');
    if (label) label.textContent = selectedLabel([...state.selected]) || '还没有选择练习范围';
    if (count) count.textContent = `${pool.size} 个词 · 去重后全部练习`;
    if (scopeCount) scopeCount.textContent = `已选 ${pool.size} 个词`;
    if (start) start.disabled = !pool.size || (state.activity === 'match' && pool.size < 2);
    if (note) note.hidden = state.activity !== 'match' || pool.size !== 1;
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
      const session = {id:uid(),startedAt:now(),sources,label:label || selectedLabel(sources),mode,activity,quiz:quizConfig(config.quiz),firstKeys,customKeys:customKeys ? [...pool.keys()] : null,reviewKeys:[],reviewAnswers:{},details:{},reviewDetails:{},phase:'first',index:0,answers:{},paused:false,cardOpen:false,flipped:false,cardsReverse:false,inputDraft:''};
      if (activity === 'quiz' || activity === 'learn') session.questions = makeQuestions(pool,firstKeys,activity,session.quiz);
      if (activity === 'match') { session.match={round:0,elapsedMs:0,penaltyMs:0,errors:{},matched:[],selected:null,wrong:[]}; makeMatchRound(session,pool); }
      state.store.active = session; state.keyboardPage='letters';
      if (!customKeys) { const saved={sources,mode,activity,quiz:session.quiz}; applyConfig(saved); rememberConfig(saved,session.label); state.store.draft=saved; }
      persist(); renderSession(); if (activity === 'listen') playCurrent(); if (activity === 'match') startMatchClock();
    };
    if (currentSession()) {
      confirmDialog('还有一组未完成练习','开始新练习会放弃旧练习的剩余进度；已经记录的自评会保留。',[
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
  async function playCurrent() {
    const session = currentSession();
    if (!session || session.paused || !['first','review'].includes(session.phase)) return;
    const item = activeItem();
    if (!item) { announce('这个词已不在当前词表中，请继续下一词。'); return; }
    const activity = activityOf(session);
    if (activity === 'match') return;
    if ((activity === 'learn' || activity === 'quiz') && session.questions?.[currentKey(session)]?.direction !== 'to-zh' && (!answered(session) || (activity === 'quiz' && !session.quiz.showAnswers))) return;
    stopAudio();
    const token = state.playToken;
    try {
      if (!state.deps.pronounce) { announce('读音服务暂未准备好，请刷新页面后重试。'); return; }
      await state.deps.pronounce(item);
    } catch { if (token === state.playToken) announce('这条读音暂时无法播放，可以重播或查看词卡。'); }
  }
  function pause() {
    if (!currentSession()) return;
    stopMatchClock();
    stopAudio(); currentSession().paused = true; currentSession().cardOpen = false;
    closeDialogs(); persist();
  }
  function renderSession() {
    const session = currentSession();
    if (!session) { renderSetup(); return; }
    state.screen = 'session';
    if (activityOf(session) !== 'listen') { renderActivitySession(session); return; }
    if (session.phase === 'review-intro') {
      shell(`<section class="pr-round-intro pr-panel"><p class="pr-kicker">再听一遍</p><h2>给薄弱词，再一次相遇。</h2><p>首轮已经完成，接下来回顾 ${session.reviewKeys.length} 个没记牢的词。</p><p class="pr-help">回顾不改变这次的首答分数。</p><div class="pr-action-row">${button('review-start','开始回顾','','pr-primary')}${button('finish','直接看结果','','pr-quiet')}</div></section>`);
      return;
    }
    const keys = currentKeys(session);
    const done = answered(session);
    const progress = Math.round((session.index + (done ? 1 : 0)) / Math.max(1,keys.length) * 100);
    shell(`<div class="pr-session-top"><div><span class="pr-kicker">${session.phase === 'review' ? '薄弱词回顾 · 不计入首答分数' : '听音自评'}</span><p>${e(session.label)}</p></div><div class="pr-session-tools">${soundControl()}${button('pause',session.paused ? '继续' : '暂停','','pr-small')}${button('exit','退出练习','','pr-small pr-quiet')}</div></div><div class="pr-progress-label"><span>${session.phase === 'review' ? '回顾' : '首轮'} ${Math.min(session.index+1,keys.length)} / ${keys.length}</span><span>${progress}%</span></div><div class="pr-progress" role="progressbar" aria-label="本轮练习进度" aria-valuemin="0" aria-valuemax="${keys.length}" aria-valuenow="${session.index+(done ? 1 : 0)}"><span style="width:${progress}%"></span></div><section class="pr-listening-card ${session.paused ? 'is-paused' : ''}"><p class="pr-kicker">${session.paused ? '休息一下，进度已经保存' : done ? '已完成本词自评' : '只听声音，先在心里想一想'}</p><div class="pr-sound-symbol" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div><h2>${session.paused ? '准备好，再继续。' : done ? '看过词卡，再向前一步。' : '你听出了这个词吗？'}</h2><p>${session.paused ? '继续后会重播当前词。' : done ? `${RATINGS[answerMap(session)[currentKey(session)]]}${session.phase === 'first' ? ' · '+answerMap(session)[currentKey(session)]+' 分' : ''}` : '先回想意思，再选择最接近的状态。'}</p>${session.paused ? `<div class="pr-listen-action">${button('resume','继续听音练习','','pr-primary')}${rateControl()}</div>` : `<div class="pr-listen-action">${button('replay','重播读音','','pr-replay')}${rateControl()}</div>${done ? `<div class="pr-action-row">${button('card','查看词卡','','pr-quiet')}${button('next',session.index === keys.length-1 ? (session.phase === 'review' || !session.reviewKeys.length ? '查看结果' : '进入回顾') : '下一词','','pr-primary')}</div>` : `<div class="pr-rating-buttons">${button('rate','<strong>认识</strong><span>想起了 · 2 分</span>','data-pr-points="2"','pr-rating pr-known')}${button('rate','<strong>有点模糊</strong><span>不太确定 · 1 分</span>','data-pr-points="1"','pr-rating pr-unsure')}${button('rate','<strong>不认识</strong><span>未记住 · 0 分</span>','data-pr-points="0"','pr-rating pr-unknown')}</div>${button('card','先查看词卡，再自评','','pr-quiet')}`}`}</section><p class="pr-keyboard-help">空格重播 · 1 认识 · 2 模糊 · 3 不认识 · → 下一词 · Esc 暂停</p>`);
  }
  function favoriteKeys() { return (state.store.favorites || []).filter(key => state.words.has(key)); }
  function favoriteButton(key) {
    const favorite = (state.store.favorites || []).includes(key);
    return button('favorite',favorite ? '★ 已收藏' : '☆ 收藏',`data-pr-key="${e(key)}" aria-pressed="${favorite}" aria-label="${favorite ? '取消收藏' : '收藏这个词'}"`,'pr-small pr-favorite-button');
  }
  function toggleFavorite(key) {
    if (!state.words.has(key)) return;
    const favorites = state.store.favorites ||= [];
    state.store.favorites = favorites.includes(key) ? favorites.filter(item => item !== key) : [...favorites,key];
    persist();
    if (state.screen === 'session') renderSession(); else renderSetup();
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
    keys.forEach((key,index) => {
      let type=activity === 'learn' ? 'spell' : config.types[index % config.types.length];
      let direction=config.direction === 'mixed' ? (index % 2 ? 'to-zh' : 'to-nb') : config.direction;
      if (type === 'spell') direction='to-nb';
      const others=[];
      if (type !== 'spell') {
        const field=direction === 'to-nb' ? 'word' : 'meaning';
        const values=new Set([metadata.get(key)[field]]);
        const offset=Math.floor(Math.random()*candidates.length);
        const needed=type === 'choice' ? 3 : 1;
        for (let step=0;step<candidates.length && others.length<needed;step++) {
          const other=candidates[(offset+step)%candidates.length], value=metadata.get(other)[field];
          if (other === key || overlaps(key,other)) continue;
          if (type === 'choice' && (!value || values.has(value) || (direction === 'to-zh' && others.some(known => overlaps(known,other))))) continue;
          values.add(value); others.push(other);
        }
      }
      if (type === 'choice') {
        if (others.length === 3) questions[key]={type,direction,options:shuffled([key,...others]).map(option => ({key:option,text:direction === 'to-nb' ? pool.get(option).word : pool.get(option).meaning}))};
        else type='spell';
      }
      if (type === 'judge') {
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
    if (!session || session.paused || answered(session) || !['learn','quiz'].includes(activityOf(session))) return;
    const key=currentKey(session), item=activeItem(), question=session.questions?.[key];
    if (!item || !question) return;
    let correct=false, submitted=String(value ?? '');
    if (unknown) { submitted='不知道'; }
    else if (question.type === 'spell') {
      if (!unknown && !submitted.trim()) { announce('先输入挪威语，也可以选择“不知道”。'); $('#pr-answer')?.focus?.(); return; }
      const pool=sessionPool(session);
      correct=!unknown && (question.acceptableKeys || [key]).some(accepted => pool.has(accepted) && spellingCorrect(pool.get(accepted),submitted));
    } else if (question.type === 'choice') {
      const option=question.options[Number(value)];
      if (!option) return;
      correct=option.key === key; submitted=option.text;
    } else if (question.type === 'judge') { if (!['true','false'].includes(submitted)) return; correct=(submitted === 'true') === question.truth; submitted=submitted === 'true' ? '正确' : '错误'; }
    const expected=question.type === 'judge' ? (question.truth ? '正确' : '错误') : question.direction === 'to-zh' ? item.meaning : item.word;
    grade(correct ? 2 : 0,{type:question.type,direction:question.direction,submitted:unknown ? '不知道' : submitted,expected,correct,unknown,prompt:question.direction === 'to-zh' ? item.word : item.meaning,proposed:question.proposed || '',choice:question.type === 'choice' ? Number(value) : null});
  }
  function sessionHeader(session,completed,total,label='') {
    const percent=Math.round(completed/Math.max(total,1)*100);
    return `<div class="pr-session-top"><div><span class="pr-kicker">${e(ACTIVITIES[activityOf(session)].title)}${session.phase === 'review' ? ' · 错词回顾' : ''}</span><p>${e(session.label)}</p></div><div class="pr-session-tools">${soundControl()}${button('pause',session.paused ? '继续' : '暂停','','pr-small')}${button('exit','退出练习','','pr-small pr-quiet')}</div></div><div class="pr-progress-label"><span>${e(label || (session.phase === 'review' ? '回顾' : '本轮'))} · ${completed} / ${total}</span><span>${percent}%</span></div><div class="pr-progress" role="progressbar" aria-label="本轮练习进度" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${completed}"><span style="width:${percent}%"></span></div>`;
  }
  function nextLabel(session) {
    return session.index === currentKeys(session).length-1 ? (session.phase !== 'review' && session.reviewKeys.length && activityOf(session) !== 'quiz' ? '进入回顾' : '查看结果') : (activityOf(session) === 'cards' ? '下一张' : '继续');
  }
  function renderActivitySession(session) {
    if (session.phase === 'review-intro') {
      shell(`<section class="pr-round-intro pr-panel"><p class="pr-kicker">再练一次</p><h2>把没记牢的，再过一遍。</h2><p>接下来回顾 ${session.reviewKeys.length} 个词，首答成绩已经保存。</p><div class="pr-action-row">${button('review-start','开始回顾','','pr-primary')}${button('finish','查看结果','','pr-quiet')}</div></section>`); return;
    }
    const activity=activityOf(session);
    if (activity === 'match') { renderMatch(session); return; }
    const keys=currentKeys(session), done=answered(session), item=activeItem();
    if (!item) { shell('<section class="pr-panel"><p>当前词语已不在词表中，请返回选择新练习。</p>'+button('setup','选择练习','','pr-primary')+'</section>'); return; }
    const top=sessionHeader(session,session.index+(done ? 1 : 0),keys.length);
    if (session.paused) { shell(top+`<section class="pr-exercise-card is-paused"><p class="pr-kicker">进度已保存</p><h2>准备好，再继续。</h2><p>回来后从当前词语接着练。</p>${button('resume','继续练习','','pr-primary')}${rateControl()}</section>`); return; }
    if (activity === 'cards') {
      const showWord=session.cardsReverse ? session.flipped : !session.flipped;
      shell(top+`<section class="pr-exercise-card"><div class="pr-flash-tools">${button('card-direction',session.cardsReverse ? '中文在正面' : '挪威语在正面','aria-label="切换词卡正反面"','pr-small pr-quiet')}${favoriteButton(item.key)}</div><button type="button" class="pr-flashcard${session.flipped ? ' is-flipped' : ''}" data-practice-action="flip" aria-label="翻转词卡" aria-pressed="${session.flipped}"><span class="pr-kicker">${showWord ? '挪威语' : '中文释义'}</span><span class="${showWord ? 'pr-flash-word' : 'pr-flash-meaning'}" ${showWord ? 'lang="nb"' : ''}>${e(showWord ? item.word : item.meaning)}</span>${showWord && item.ipa ? `<span class="pr-flash-hint">${e(item.ipa)}</span>` : ''}<span class="pr-flash-hint">点击翻面 · 空格翻面</span></button><div class="pr-flash-tools">${button('replay','听发音','','pr-small')}${rateControl()}</div>${done ? `<div class="pr-feedback ${answerMap(session)[currentKey(session)] === 2 ? 'is-correct' : 'is-neutral'}" role="status">已记录：${e(RATINGS[answerMap(session)[currentKey(session)]])}${session.phase === 'review' ? ' · 首答分数保持不变' : ''}</div>` : `<div class="pr-rating-buttons">${button('rate','已掌握','data-pr-points="2"','pr-rating pr-known')}${button('rate','有点模糊','data-pr-points="1"','pr-rating pr-unsure')}${button('rate','再练一次','data-pr-points="0"','pr-rating pr-unknown')}</div>`}<div class="pr-exercise-footer pr-flash-controls">${button('previous','上一张',session.index ? '' : 'disabled','pr-quiet')}${button('flip','翻面','','pr-secondary')}${button('next',nextLabel(session),done ? '' : 'disabled','pr-primary')}</div><p class="pr-keyboard-help">空格翻面 · 1 已掌握 · 2 模糊 · 3 再练 · ← → 切换已答词卡 · Esc 暂停</p></section>`);
      return;
    }
    const key=currentKey(session), question=session.questions[key], detail=questionDetails(session)[key], prompt=question.direction === 'to-zh' ? item.word : item.meaning;
    const typeLabel={spell:'写出挪威语',choice:'选择正确答案',judge:'判断这组词义是否对应'}[question.type];
    const answerUI=question.type === 'spell' ? `<form class="pr-answer-form" id="pr-answer-form"><label class="sr-only" for="pr-answer">输入挪威语</label><input id="pr-answer" class="pr-answer-input" type="text" lang="nb" inputmode="${state.store.keyboardMode === 'system' ? 'text' : 'none'}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="点选字母，或直接输入…" value="${e(done ? detail?.submitted === '不知道' ? '' : detail?.submitted || '' : session.inputDraft || '')}" ${done ? 'disabled' : ''}>${done ? '' : `<div class="pr-input-tools"><span>挪威语 · Bokmål</span>${button('keyboard-mode',state.store.keyboardMode === 'system' ? '使用屏幕键盘' : '使用设备键盘','','pr-small pr-quiet')}</div><div id="pr-keyboard">${renderKeyboard()}</div>`}</form>` : question.type === 'choice' ? `<div class="pr-choice-grid">${question.options.map((option,index) => `<button type="button" class="pr-button pr-choice${done && detail?.choice === index ? ' is-selected'+(detail.correct ? ' is-correct' : ' is-wrong') : ''}${done && session.quiz.showAnswers && option.key === key ? ' is-correct' : ''}" data-practice-action="objective" data-pr-value="${index}" ${done ? 'disabled' : ''}><span>${index+1}.</span> ${e(option.text)}</button>`).join('')}</div>` : `<p class="pr-flash-meaning" ${question.direction === 'to-nb' ? 'lang="nb"' : ''}>${e(question.proposed)}</p><div class="pr-choice-grid">${[['true','正确'],['false','错误']].map(([value,label]) => `<button type="button" class="pr-button pr-choice${done && detail?.submitted === label ? ' is-selected'+(detail.correct ? ' is-correct' : ' is-wrong') : ''}" data-practice-action="objective" data-pr-value="${value}" ${done ? 'disabled' : ''}>${label}</button>`).join('')}</div>`;
    const correctRun=done && detail?.correct ? consecutiveCorrect(session) : 0;
    const feedback=done ? feedbackMarkup(detail?.correct ? 'correct' : 'wrong',detail?.correct ? (correctRun >= 2 ? `连续答对 ${correctRun} 题` : '答对了，做得好！') : detail?.unknown ? '先记住，再练一次' : '再记一次，下次会更熟。',(activity === 'learn' || session.quiz.showAnswers) ? `<p>正确答案：<span lang="${question.direction === 'to-zh' ? 'zh' : 'nb'}">${e(detail?.expected || item.word)}</span>${question.type === 'judge' ? ` · ${e(item.word)}：${e(item.meaning)}` : ''}</p>` : '',detail?.correct ? correctRun : 0) : '';
    const replaySafe=question.direction === 'to-zh' || (done && (activity === 'learn' || session.quiz.showAnswers));
    shell(top+`<section class="pr-exercise-card ${question.type === 'spell' ? 'pr-spelling-card' : ''}"><div class="pr-flash-tools"><span class="pr-kicker">${typeLabel}</span>${favoriteButton(key)}</div><h2 class="${question.direction === 'to-zh' ? 'pr-flash-word' : 'pr-flash-meaning'}" ${question.direction === 'to-zh' ? 'lang="nb"' : ''}>${e(prompt)}</h2>${answerUI}${feedback}<div class="pr-exercise-footer">${replaySafe ? button('replay',done ? '听正确读音' : '朗读题目','','pr-small pr-quiet')+rateControl() : ''}${done ? button('next',nextLabel(session),'','pr-primary') : button('unknown','不知道','','pr-quiet')+(question.type === 'spell' ? `<button type="submit" form="pr-answer-form" id="pr-check-answer" class="pr-button pr-primary" ${session.inputDraft?.trim() ? '' : 'disabled'}>检查答案</button>` : '')}</div><p class="pr-keyboard-help">${question.type === 'spell' ? 'Enter 检查答案' : question.type === 'choice' ? '1–4 选择答案' : '1 正确 · 2 错误'} · 答题后 → 继续 · Esc 暂停</p></section>`);
    if (!done && question.type === 'spell') $('#pr-answer')?.focus?.({preventScroll:true});
    if (done) state.root.querySelector('[data-practice-action="next"]')?.focus?.({preventScroll:true});
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
    const groups=matchGroups(session.firstKeys.filter(key => !Object.prototype.hasOwnProperty.call(session.answers,key)),pool);
    match.roundKeys=groups[0] || [];
    match.totalRounds=match.round+groups.length;
    match.matched=[]; match.selected=null; match.wrong=[];
    match.tiles=shuffled(match.roundKeys.flatMap(key => [{id:`word:${key}`,key,side:'word',text:pool.get(key)?.word || key},{id:`meaning:${key}`,key,side:'meaning',text:pool.get(key)?.meaning || ''}]));
    match.roundDone=false;
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
    const match=session.match, completed=session.firstKeys.filter(key => Object.prototype.hasOwnProperty.call(session.answers,key)).length, total=session.firstKeys.length;
    const top=sessionHeader(session,completed,total,`第 ${match.round+1} / ${match.totalRounds || Math.ceil(total/6)} 组`);
    const best=state.store.matchBest?.[matchSignature(session)];
    shell(top+`<section class="pr-exercise-card"><div class="pr-match-top"><div class="pr-timer" role="timer" aria-label="本次配对用时"><strong id="pr-match-time">${timeLabel(matchTime(session))}</strong><span>错配加时 ${timeLabel(match.penaltyMs)}</span></div><p class="pr-help">${best ? `同范围最佳 ${timeLabel(best.timeMs)}` : '找到词语与对应释义'}</p></div>${session.paused ? `<div class="pr-round-intro"><h2>休息一下，计时已暂停。</h2>${button('resume','继续配对','','pr-primary')}</div>` : `<div class="pr-match-grid">${match.tiles.map(tile => `<button type="button" class="pr-match-tile${match.selected === tile.id ? ' is-selected' : ''}${match.matched.includes(tile.id) ? ' is-matched' : ''}${match.wrong.includes(tile.id) ? ' is-wrong' : ''}" data-practice-action="match-tile" data-pr-tile="${e(tile.id)}" ${match.matched.includes(tile.id) ? 'disabled aria-hidden="true" tabindex="-1"' : ''} ${tile.side === 'word' ? 'lang="nb"' : ''}>${e(tile.text)}</button>`).join('')}</div>${feedbackMarkup(match.wrong.length ? 'wrong' : match.correctRun ? 'correct' : 'neutral',match.wrong.length ? '再试一次' : match.roundDone ? '这组全部配对成功！' : match.correctRun ? '配对成功！' : '找到词语和释义',`<p>${match.wrong.length ? '用时加 1 秒，继续找对应的释义。' : match.roundDone ? '准备好，进入下一组。' : '先选一个词，再选对应的释义。'}</p>`,match.wrong.length ? 0 : match.correctRun || 0)}${match.roundDone ? `<div class="pr-exercise-footer">${button('match-next','下一组','','pr-primary')}</div>` : ''}`}</section>`);
  }
  function matchSignature(session) { return JSON.stringify(session.firstKeys.slice().sort()); }
  function selectMatchTile(id) {
    const session=currentSession();
    if (!session || activityOf(session) !== 'match' || session.paused || session.match.roundDone) return;
    const match=session.match, tile=match.tiles.find(item => item.id === id);
    if (!tile || match.matched.includes(id)) return;
    match.wrong=[];
    const previous=match.tiles.find(item => item.id === match.selected);
    if (!previous || previous.side === tile.side) { match.selected=match.selected === id ? null : id; persist(); renderSession(); return; }
    const word=tile.side === 'word' ? tile : previous, meaning=tile.side === 'meaning' ? tile : previous;
    const pool=sessionPool(session);
    match.selected=null;
    let feedback='wrong';
    if (word.key === meaning.key) {
      match.correctRun=(match.correctRun || 0)+1;
      feedback=match.correctRun === 3 || (match.correctRun >= 5 && match.correctRun%5 === 0) ? 'streak' : 'correct';
      match.matched.push(word.id,meaning.id);
      recordGrade(session,word.key,match.errors[word.key] ? 0 : 2,{type:'match',direction:'to-zh',submitted:meaning.text,expected:pool.get(word.key)?.meaning || '',correct:!match.errors[word.key],errors:match.errors[word.key] || 0,prompt:word.text});
      if (match.matched.length === match.tiles.length) {
        stopMatchClock(); match.roundDone=true;
        if (session.firstKeys.every(key => Object.prototype.hasOwnProperty.call(session.answers,key))) { finish(); return; }
      }
    } else {
      match.correctRun=0;
      match.penaltyMs+=1000; match.errors[word.key]=(match.errors[word.key] || 0)+1; match.wrong=[word.id,meaning.id];
    }
    persist(); renderSession(); showFeedback(feedback);
  }
  function nextMatchRound() {
    const session=currentSession();
    if (!session || activityOf(session) !== 'match' || !session.match.roundDone || session.paused) return;
    if (session.firstKeys.every(key => Object.prototype.hasOwnProperty.call(session.answers,key))) { finish(); return; }
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
  function openCard() {
    const session = currentSession();
    const item = activeItem();
    if (!session || !item || session.paused) return;
    const dialog = $('#pr-card');
    const done = answered(session);
    const key = currentKey(session);
    const usage = unique([plainValue(item.usage),plainValue(item.note)]);
    const renderExampleSection = (title,examples) => examples?.length ? `<section class="pr-card-section"><h3>${title}</h3>${examples.slice(0,4).map(example => `<p class="pr-card-example" lang="nb">${e(example)}</p>`).join('')}</section>` : '';
    dialog.innerHTML = `<div class="pr-card-handle" aria-hidden="true"></div><div class="pr-card-top"><span class="pr-kicker">词卡</span>${button('card-close','关闭','aria-label="关闭词卡"','pr-small pr-quiet')}</div><h2 id="pr-card-title" lang="nb">${e(item.word)}</h2><div class="pr-card-phonetics">${item.syllables ? `<span>${e(item.syllables)}</span>` : ''}${item.ipa ? `<span>${e(item.ipa)}</span>` : ''}${button('replay','重听','','pr-small')}${rateControl()}</div>${item.meaning ? `<p class="pr-card-meaning">${e(item.meaning)}</p>` : ''}${renderFacts(item)}${usage.length ? `<section class="pr-card-section"><h3>用法</h3>${usage.map(text => `<p>${e(text)}</p>`).join('')}</section>` : ''}${renderExampleSection('课文句子',item.practiceTextExamples)}${renderExampleSection('学习例句',item.practiceLearningExamples)}${item.sourceEntry ? `<section class="pr-card-section"><h3>原词条</h3><p lang="nb">${e(item.sourceEntry)}</p></section>` : ''}<p class="pr-card-source">${e(item.sourceLabels.slice(0,3).join(' · '))}</p><div class="pr-card-rating">${done ? `<p class="pr-answer-record" role="status">${session.phase === 'review' ? '本次回顾' : '首答'}：${e(RATINGS[answerMap(session)[key]])}${session.phase === 'first' ? ' · '+answerMap(session)[key]+' 分' : ' · 不改变首答分数'}</p>${button('next',session.index === currentKeys(session).length-1 ? (session.phase === 'review' || !session.reviewKeys.length ? '查看结果' : '进入回顾') : '下一词','','pr-primary')}` : `<p>按刚才听到时的记忆自评</p><div class="pr-rating-buttons">${button('rate','想起了 · 2 分','data-pr-points="2"','pr-rating pr-known')}${button('rate','有点模糊 · 1 分','data-pr-points="1"','pr-rating pr-unsure')}${button('rate','未记住 · 0 分','data-pr-points="0"','pr-rating pr-unknown')}</div>`}</div>`;
    session.cardOpen = true;
    if (!dialog.open) dialog.showModal();
  }
  function recordGrade(session,key,points,detail=null) {
    if (Object.prototype.hasOwnProperty.call(answerMap(session),key)) return false;
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
    persist(); renderSession(); if (activityOf(session) === 'listen') openCard();
    if (detail) {
      const run=consecutiveCorrect(session);
      showFeedback(detail.correct ? (run === 3 || (run >= 5 && run%5 === 0) ? 'streak' : 'correct') : 'wrong');
    }
  }
  function next() {
    const session = currentSession();
    if (!session || session.paused || !answered(session)) return;
    closeDialogs(); stopAudio(); session.cardOpen = false;
    if (session.index < currentKeys(session).length-1) {
      session.index += 1; session.flipped=false; session.inputDraft=''; state.keyboardPage='letters'; persist(); renderSession(); if (activityOf(session) === 'listen') playCurrent();
    } else if (session.phase === 'first' && session.reviewKeys.length) {
      session.phase = 'review-intro'; session.index = 0; persist(); renderSession();
    } else finish();
  }
  function finish() {
    const session = currentSession();
    if (!session) return;
    closeDialogs(); stopAudio(); stopMatchClock();
    const pool = sessionPool(session);
    const result = {id:session.id,startedAt:session.startedAt,finishedAt:now(),label:session.label,sources:session.sources,customKeys:session.customKeys,mode:session.mode,activity:activityOf(session),quiz:session.quiz,total:session.firstKeys.length,reviewed:Object.keys(session.reviewAnswers).length,answers:session.firstKeys.map(key => ({key,word:pool.get(key)?.word || key,meaning:pool.get(key)?.meaning || '',points:session.answers[key] ?? 0,...(session.details?.[key] ? {detail:session.details[key]} : {})}))};
    if (result.activity === 'match') {
      result.timeMs=matchTime(session); result.penaltyMs=session.match.penaltyMs;
      const signature=matchSignature(session), best=state.store.matchBest?.[signature];
      result.newBest=!best || result.timeMs < best.timeMs;
      if (result.newBest) (state.store.matchBest ||= {})[signature]={timeMs:result.timeMs,finishedAt:result.finishedAt,total:result.total};
      result.bestMs=state.store.matchBest[signature].timeMs;
    }
    if (!state.store.history.some(item => item.id === result.id)) state.store.history.unshift(result);
    if (['learn','quiz','match'].includes(result.activity)) state.store.communityPending=unique([...(state.store.communityPending || []),result.id]);
    state.store.active = null; state.result = result; persist(); renderResult(result);
    if (effects.lastCompletedId !== result.id) { effects.lastCompletedId=result.id; showFeedback('complete'); }
    syncCommunity();
  }
  function syncCommunity() {
    if (state.communitySync || typeof state.deps.submitPracticeResult !== 'function' || !state.store.communityPending?.length) return state.communitySync || Promise.resolve(false);
    state.communitySync=(async () => {
      while (state.store.communityPending.length) {
        const id=state.store.communityPending[0], result=state.store.history.find(item => item.id === id);
        if (result && ['learn','quiz','match'].includes(activityOf(result))) {
          try { if (await state.deps.submitPracticeResult(result) !== true) return false; }
          catch { return false; }
        }
        state.store.communityPending=state.store.communityPending.filter(item => item !== id);
        persist();
      }
      return true;
    })().finally(() => { state.communitySync=null; });
    return state.communitySync;
  }
  function dateLabel(date) {
    try { return new Date(date).toLocaleString('zh-CN',{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
    catch { return ''; }
  }
  function renderResult(result,fromHistory=false) {
    state.screen = 'results'; state.result = result;
    if (activityOf(result) !== 'listen') { renderActivityResult(result,fromHistory); return; }
    const counts = [2,1,0].map(points => result.answers.filter(answer => answer.points === points).length);
    const weak = result.answers.filter(answer => answer.points < 2 && state.words.has(answer.key));
    shell(`<section class="pr-results-hero"><div><p class="pr-kicker">${fromHistory ? '学习记录' : '这次练习完成了'}</p><h2>每次听懂一点，都是进步。</h2><p>${e(result.label)}</p><span class="pr-result-date">${e(dateLabel(result.finishedAt))} · ${result.total} 词 · 回顾 ${result.reviewed || 0} 词</span></div><div class="pr-score"><strong>${scoreOf(result)}</strong><span>首答得分 / 100</span></div></section><div class="pr-result-counts"><span><strong>${counts[0]}</strong>想起了</span><span><strong>${counts[1]}</strong>有点模糊</span><span><strong>${counts[2]}</strong>未记住</span></div><div class="pr-action-row pr-result-actions">${weak.length ? button('result-weak',`再练这 ${weak.length} 个薄弱词`,'','pr-primary') : ''}${button('result-again','再练同一组','','pr-secondary')}${button('setup','重新选题','','pr-quiet')}${button('history','学习记录','','pr-quiet')}</div><section class="pr-panel"><div class="pr-panel-heading"><h2>每个词的积累</h2><div class="pr-result-heading-controls"><span>熟练度按历次首答计算</span>${rateControl()}</div></div><div class="pr-result-words">${result.answers.map(answer => { const learned=mastery(answer.key); return `<div class="pr-result-word"><div><strong lang="nb">${e(answer.word)}</strong><p>${e(answer.meaning)}</p></div><span class="pr-result-rating pr-points-${answer.points}">${e(RATINGS[answer.points])} · ${answer.points} 分</span><div class="pr-mastery"><span>${learned.text} · ${learned.percent}%</span><div><span style="width:${learned.percent}%"></span></div></div>${state.words.has(answer.key) ? button('result-word','重听',`data-pr-key="${e(answer.key)}"`,'pr-small pr-quiet') : ''}</div>`; }).join('')}</div></section>`);
  }
  function renderActivityResult(result,fromHistory=false) {
    const activity=activityOf(result), title=ACTIVITIES[activity].title, objective=['learn','quiz','match'].includes(activity);
    const correct=result.answers.filter(answer => answer.points === 2).length;
    const weak=result.answers.filter(answer => answer.points < 2 && state.words.has(answer.key));
    const headline=activity === 'match' ? '全部配对完成。' : objective ? '看看这次记住了多少。' : '又记牢了一些词。';
    shell(`<section class="pr-results-hero"><div><p class="pr-kicker">${fromHistory ? '学习记录' : '练习完成'} · ${title}</p><h2>${headline}</h2><p>${e(result.label)}</p><span class="pr-result-date">${e(dateLabel(result.finishedAt))} · ${result.total} 词${result.reviewed ? ` · 回顾 ${result.reviewed} 词` : ''}</span></div><div class="pr-score"><strong>${activity === 'match' ? (result.timeMs/1000).toFixed(1) : scoreOf(result)}</strong><span>${activity === 'match' ? '秒 · 含错配加时' : objective ? '首答准确率 / %' : '首答得分 / 100'}</span></div></section>${activity === 'match' ? `<p class="pr-help">${result.newBest ? '本次创下同范围最佳！' : ''} 同范围最佳 ${timeLabel(result.bestMs || result.timeMs)} · 错配加时 ${timeLabel(result.penaltyMs || 0)}</p>` : ''}<div class="pr-result-counts"><span><strong>${correct}</strong>${objective ? (activity === 'match' ? '一次配对成功' : '首答正确') : '已掌握'}</span><span><strong>${result.total-correct}</strong>${objective ? '需要巩固' : '还需回想'}</span><span><strong>${result.total}</strong>完成词语</span></div><div class="pr-action-row pr-result-actions">${weak.length ? button('result-weak',`复习这 ${weak.length} 个词`,'','pr-secondary') : ''}${button('result-again',activity === 'match' ? '再玩一次' : '再练同一组','','pr-primary')}${button('setup','选择练习','','pr-quiet')}${button('history','学习记录','','pr-quiet')}</div><section class="pr-panel"><div class="pr-panel-heading"><h2>${objective ? '答案回顾' : '每个词的积累'}</h2>${rateControl()}</div><div class="pr-result-words">${result.answers.map(answer => {
      const detail=answer.detail, learned=mastery(answer.key);
      return `<div class="pr-result-word"><div><strong lang="nb">${e(answer.word)}</strong><p>${e(answer.meaning)}</p>${detail ? `<p class="pr-answer-detail">${{spell:'拼写',choice:'选择',judge:'判断',match:'配对'}[detail.type] || '作答'}${detail.proposed ? ` · 题面：${e(detail.prompt)} ↔ ${e(detail.proposed)}` : ''}<br>你的回答：${e(detail.submitted)}${detail.errors ? ` · 此前错配 ${detail.errors} 次` : ''}<br>正确答案：${e(detail.expected)}</p>` : ''}</div><span class="pr-result-rating pr-points-${answer.points}">${objective ? (answer.points === 2 ? '正确' : '需巩固') : `${e(RATINGS[answer.points])} · ${answer.points} 分`}</span><div class="pr-mastery"><span>${learned.text} · ${learned.percent}%</span><div><span style="width:${learned.percent}%"></span></div></div>${state.words.has(answer.key) ? button('result-word','重听',`data-pr-key="${e(answer.key)}"`,'pr-small pr-quiet') : ''}</div>`;
    }).join('')}</div></section>`);
  }
  function renderHistory() {
    state.screen = 'history';
    const history = state.store.history, weak = weakKeys();
    shell(`<div class="pr-history-header"><div><p class="pr-kicker">一点一滴，留在这里</p><h2>本机学习记录</h2><p>已练 ${Object.keys(state.store.stats).length} 个词，完成 ${history.length} 次练习。</p></div><div class="pr-action-row">${button('export','导出记录','','pr-secondary')}${button('setup','选择练习','','pr-primary')}</div></div>${weak.length ? `<div class="pr-resume-banner"><div><strong>${weak.length} 个词还值得再练一遍</strong><p>优先复习最近没记牢的词。</p></div>${button('weak','复习薄弱词','','pr-primary')}</div>` : ''}${history.length ? `<div class="pr-history-list">${history.map(result => { const activity=activityOf(result); return `<article class="pr-history-entry"><div><strong>${e(result.label)}</strong><p>${e(ACTIVITIES[activity].title)} · ${e(dateLabel(result.finishedAt))} · ${result.total} 词 · ${result.mode === 'weak' ? '优先薄弱' : '随机顺序'}</p></div><span class="pr-history-score">${activity === 'match' ? (result.timeMs/1000).toFixed(1) : scoreOf(result)}<small>${activity === 'match' ? '秒' : ['learn','quiz'].includes(activity) ? '%' : '分'}</small></span>${button('history-detail','查看',`data-pr-id="${e(result.id)}"`,'pr-small')}${result.answers.some(answer => answer.points < 2) ? button('history-weak','复习错词',`data-pr-id="${e(result.id)}"`,'pr-small pr-quiet') : ''}</article>`; }).join('')}</div>` : '<section class="pr-panel pr-empty"><h3>第一组练习，从今天开始。</h3><p>完成后会在这里看到成绩与逐词回顾。</p></section>'}<p class="pr-local-note">记录保存在此浏览器，清除浏览器数据会同时清除记录。</p>`);
  }
  function closeDialogs() {
    for (const dialog of state.root?.querySelectorAll('dialog[open]') || []) dialog.close();
  }
  function confirmDialog(title,message,actions) {
    stopAudio(); stopMatchClock();
    const session = currentSession();
    if (session) { session.paused = true; session.cardOpen = false; persist(); }
    if (!$('#pr-scope')?.open) closeDialogs();
    state.pending = actions.find(action => action.run)?.run || null;
    const dialog = $('#pr-confirm');
    dialog.innerHTML = `<h2 id="pr-confirm-title">${e(title)}</h2><p>${e(message)}</p><div class="pr-confirm-actions">${actions.map(action => button(action.action,e(action.text),'',action.primary ? 'pr-primary' : 'pr-quiet')).join('')}</div>`;
    dialog.showModal();
  }
  function navigate(screen) {
    const go = () => { closeDialogs(); if (screen === 'history') renderHistory(); else renderSetup(); };
    if (state.screen === 'session' && currentSession()) {
      confirmDialog('先休息一下？','当前进度已保存，回来后可以继续。',[
        {action:'confirm-run',text:'保存并离开练习',primary:true,run:go},
        {action:'confirm-resume',text:'继续练习'},
      ]);
    } else { stopAudio(); go(); }
  }
  function resume() {
    const session = currentSession();
    if (!session) return;
    closeDialogs(); session.paused = false; session.cardOpen = false; persist(); renderSession(); if (activityOf(session) === 'listen') playCurrent(); if (activityOf(session) === 'match') startMatchClock();
  }
  function saveSet() {
    if (!state.selected.size) { announce('请先选择练习范围。'); return; }
    const name = $('#pr-set-name').value.trim();
    if (!name) { $('#pr-set-name').focus(); announce('给这组选题取个名字，就可以随时重练。'); return; }
    state.mode = ($('#pr-order')?.value || state.mode) === 'weak' ? 'weak' : 'random';
    const config = {sources:[...state.selected],mode:state.mode,activity:state.activity,quiz:quizConfig(state.quiz)};
    const existing = state.store.sets.find(item => item.name === name);
    const save = () => {
      if (existing) Object.assign(existing,config,{updatedAt:now()});
      else state.store.sets.unshift({id:uid(),name,...config,createdAt:now()});
      state.store.draft=config; persist(); renderSetup(); renderScope(); announce('练习范围已保存。');
    };
    if (existing) confirmDialog('更新同名组合？',`“${name}”已存在，更新后会使用当前范围和练习方式。`,[{action:'confirm-run',text:'更新组合',primary:true,run:save},{action:'confirm-close',text:'取消'}]);
    else save();
  }
  function reviewKeys(keys,label,activity='listen',quiz=state.quiz) {
    if (!keys.length) { announce('目前没有需要复习的薄弱词，先完成一组练习吧。'); return; }
    startSession({sources:[],mode:'weak',activity,quiz},keys,label);
  }
  function exportRecords() {
    try {
      const backup = {version:1,exportedAt:now(),sets:state.store.sets,stats:state.store.stats,history:state.store.history,active:state.store.active,draft:state.store.draft,recent:state.store.recent,favorites:state.store.favorites,matchBest:state.store.matchBest};
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json;charset=utf-8'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = `norsk-practice-${now().slice(0,10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url),1000);
      announce('学习记录已导出，请保留下载的备份文件。');
    } catch { announce('记录导出失败，请稍后重试。'); }
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
      case 'sound': toggleSound(event); break;
      case 'setup': navigate('setup'); break;
      case 'history': navigate('history'); break;
      case 'community': syncCommunity(); state.deps.openCommunity?.(); break;
      case 'export': exportRecords(); break;
      case 'weak': reviewKeys(weakKeys(),'薄弱词复习',state.activity,state.quiz); break;
      case 'favorites': { const keys=favoriteKeys(); if (!keys.length) { announce('先在词卡或练习中收藏词语，就能在这里复习。'); break; } startSession({sources:[],mode:state.mode,activity:state.activity,quiz:state.quiz},keys,'收藏词语'); break; }
      case 'favorite': toggleFavorite(target.dataset.prKey || (session && currentKey(session))); break;
      case 'scope-open': renderScope(); break;
      case 'scope-close': $('#pr-scope')?.close?.(); break;
      case 'scope-tab': state.scopeTab=target.dataset.prTab === 'basics' ? 'basics' : 'chapters'; renderScope(); break;
      case 'clear-selection': state.selected.clear(); updateSelectionUI(); break;
      case 'expand-chapters': state.root.querySelectorAll('.pr-source-chapter').forEach(detail => { detail.open = true; }); break;
      case 'expand-basics': $('#pr-basic-sources')?.scrollIntoView({block:'start',behavior:'smooth'}); break;
      case 'save-set': saveSet(); break;
      case 'saved-load': { const set = state.store.sets.find(item => item.id === id); if (set) loadScope(set); break; }
      case 'recent-load': { const config = state.store.recent[Number(target.dataset.prIndex)]; if (config) loadScope(config); break; }
      case 'saved-start': { const set = state.store.sets.find(item => item.id === id); if (set) startSession(set); break; }
      case 'saved-delete': {
        const set = state.store.sets.find(item => item.id === id);
        if (set) confirmDialog('删除这个选题组合？',set.name,[{action:'confirm-run',text:'删除组合',run:() => { state.store.sets=state.store.sets.filter(item => item.id !== id); persist(); renderSetup(); renderScope(); }},{action:'confirm-close',text:'保留'}]);
        break;
      }
      case 'recent-start': { const config = state.store.recent[Number(target.dataset.prIndex)]; if (config) startSession(config); break; }
      case 'start': startSession({sources:[...state.selected],mode:$('#pr-order')?.value || state.mode,activity:state.activity,quiz:state.quiz}); break;
      case 'resume': resume(); break;
      case 'pause': if (session?.paused) resume(); else { pause(); renderSession(); } break;
      case 'exit': if (session) confirmDialog('离开这次练习？','保留当前进度，下次从这里继续。',[
        {action:'confirm-run',text:'保存并退出',primary:true,run:renderSetup},
        {action:'confirm-resume',text:'继续练习'},
        {action:'discard',text:'放弃本次进度'},
      ]); break;
      case 'discard': closeDialogs(); stopAudio(); stopMatchClock(); state.store.active=null; persist(); renderSetup(); break;
      case 'confirm-run': { const run=state.pending; state.pending=null; closeDialogs(); run?.(); break; }
      case 'confirm-close': state.pending=null; $('#pr-confirm')?.close?.(); if (state.screen === 'session') renderSession(); break;
      case 'confirm-resume': state.pending=null; resume(); break;
      case 'replay': playCurrent(); break;
      case 'card': openCard(); break;
      case 'card-close': $('#pr-card').close(); if (session) session.cardOpen=false; break;
      case 'rate': grade(Number(target.dataset.prPoints)); break;
      case 'flip': if (session && activityOf(session) === 'cards' && !session.paused) { session.flipped=!session.flipped; persist(); renderSession(); } break;
      case 'card-direction': if (session && activityOf(session) === 'cards' && !session.paused) { session.cardsReverse=!session.cardsReverse; session.flipped=false; persist(); renderSession(); } break;
      case 'previous': if (session && activityOf(session) === 'cards' && !session.paused && session.index > 0) { session.index--; session.flipped=false; stopAudio(); persist(); renderSession(); } break;
      case 'objective': submitObjective(target.dataset.prValue); break;
      case 'unknown': submitObjective('',true); break;
      case 'letter': insertLetter(target.dataset.prLetter); break;
      case 'keyboard-page': state.keyboardPage=state.keyboardPage === 'symbols' ? 'letters' : 'symbols'; if ($('#pr-keyboard')) $('#pr-keyboard').innerHTML=renderKeyboard(); break;
      case 'keyboard-mode': toggleKeyboardMode(); break;
      case 'match-tile': selectMatchTile(target.dataset.prTile); break;
      case 'match-next': nextMatchRound(); break;
      case 'next': next(); break;
      case 'review-start': if (session) { session.phase='review'; session.index=0; session.paused=false; session.inputDraft=''; session.flipped=false; persist(); renderSession(); if (activityOf(session) === 'listen') playCurrent(); } break;
      case 'finish': finish(); break;
      case 'result-weak': if (state.result) reviewKeys(state.result.answers.filter(answer => answer.points < 2).map(answer => answer.key),'本次薄弱词复习',['quiz','match'].includes(activityOf(state.result)) ? 'learn' : activityOf(state.result),state.result.quiz); break;
      case 'result-again': if (state.result) startSession({sources:state.result.sources,mode:state.result.mode,activity:activityOf(state.result),quiz:state.result.quiz},state.result.customKeys || null,state.result.label); break;
      case 'result-word': { const word=state.words.get(target.dataset.prKey); stopAudio(); if (word) Promise.resolve(state.deps.pronounce?.(word)).catch(() => announce('读音暂时无法播放，请稍后重试。')); break; }
      case 'history-detail': { const result=state.store.history.find(item => item.id === id); if (result) renderResult(result,true); break; }
      case 'history-weak': { const result=state.store.history.find(item => item.id === id); if (result) reviewKeys(result.answers.filter(answer => answer.points < 2).map(answer => answer.key),`${dateLabel(result.finishedAt)} · 错词复习`,['quiz','match'].includes(activityOf(result)) ? 'learn' : activityOf(result),result.quiz); break; }
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
      if (!['judge','choice','spell'].includes(type)) return;
      if (!input.checked && types.length === 1 && types.includes(type)) { input.checked=true; announce('至少保留一种测验题型。'); return; }
      state.quiz.types=input.checked ? unique([...types,type]) : types.filter(item => item !== type); draft();
    } else if (input.id === 'pr-quiz-direction') { state.quiz=quizConfig({...state.quiz,direction:input.value}); draft(); }
    else if (input.id === 'pr-show-answers') { state.quiz.showAnswers=input.checked; draft(); }
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
    if (state.store.keyboardMode === 'system') return `<div class="pr-keyboard-row pr-keyboard-accents">${['æ','ø','å','é'].map(letter => button('letter',letter,`data-pr-letter="${letter}"`,'pr-key')).join('')}</div>`;
    const symbols=state.keyboardPage === 'symbols';
    const rows=symbols ? ['1234567890'.split(''),['.',',','?','!','-',"'",':','/'],['(',')','+','%','&','backspace']] : ['qwertyuiop'.split(''),'asdfghjkl'.split(''),[...'zxcvbnm','backspace']];
    const key = letter => button('letter',letter === 'backspace' ? '⌫' : e(letter),`data-pr-letter="${e(letter)}"${letter === 'backspace' ? ' aria-label="退格"' : ''}`,'pr-key'+(letter === 'backspace' ? ' pr-key-wide' : ''));
    return `<div class="pr-keyboard" role="group" aria-label="挪威语屏幕键盘">${rows.map(row => `<div class="pr-keyboard-row">${row.map(key).join('')}</div>`).join('')}<div class="pr-keyboard-row">${button('keyboard-page',symbols ? 'ABC' : '123','aria-label="'+(symbols ? '切换字母键盘' : '切换数字和符号')+'"','pr-key pr-key-wide')}${['æ','ø','å','é'].map(key).join('')}${button('letter','空格','data-pr-letter=" " aria-label="空格"','pr-key pr-key-space')}</div></div>`;
  }
  function consecutiveCorrect(session) {
    const keys=currentKeys(session), answers=answerMap(session);
    let count=0;
    for (let index=session.index;index>=0 && answers[keys[index]] === 2;index--) count++;
    return count;
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
    state.store.keyboardMode=state.store.keyboardMode === 'system' ? 'screen' : 'system';
    persist(); renderSession(); $('#pr-answer')?.setSelectionRange?.(start,end);
  }
  function onKey(event) {
    if (event.isComposing || event.keyCode === 229 || !state.visible || state.screen !== 'session' || state.root.hidden || event.altKey || event.ctrlKey || event.metaKey) return;
    unlockFeedbackAudio(event);
    if ($('#pr-confirm')?.open) return;
    const session=currentSession();
    if (!session) return;
    if (event.key === 'Escape') {
      if ($('#pr-card')?.open) return;
      event.preventDefault(); if (!session.paused) { pause(); renderSession(); } return;
    }
    if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || session.paused || session.phase === 'review-intro') return;
    const activity=activityOf(session);
    if (event.code === 'Space' && event.target.tagName !== 'BUTTON') {
      event.preventDefault();
      if (activity === 'cards') { session.flipped=!session.flipped; persist(); renderSession(); }
      else if (activity !== 'match') playCurrent();
    }
    if (activity === 'listen' || activity === 'cards') {
      if (['1','2','3'].includes(event.key)) { event.preventDefault(); grade(3-Number(event.key)); }
      if (activity === 'cards' && event.key === 'ArrowLeft' && session.index > 0) { event.preventDefault(); session.index--; session.flipped=false; stopAudio(); persist(); renderSession(); }
    } else if (activity === 'quiz' && !answered(session)) {
      const question=session.questions?.[currentKey(session)];
      if (question?.type === 'choice' && ['1','2','3','4'].includes(event.key)) { event.preventDefault(); submitObjective(Number(event.key)-1); }
      else if (question?.type === 'judge' && ['1','2'].includes(event.key)) { event.preventDefault(); submitObjective(event.key === '1' ? 'true' : 'false'); }
    }
    if (activity !== 'match' && (event.key === 'ArrowRight' || (event.key === 'Enter' && event.target.tagName !== 'BUTTON')) && answered(session)) { event.preventDefault(); next(); }
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
    const retainedIndex = keys.indexOf(oldKey);
    const unansweredIndex = keys.findIndex(key => !Object.prototype.hasOwnProperty.call(answerMap(session),key));
    session.index = retainedIndex >= 0 ? retainedIndex : Math.max(0,unansweredIndex);
    if (['learn','quiz'].includes(session.activity)) {
      const generated=makeQuestions(pool,session.firstKeys,session.activity,session.quiz);
      session.questions ||= {};
      for (const key of session.firstKeys) {
        const question=session.questions[key];
        if (!question || (question.options && question.options.some(option => !pool.has(option.key))) || (question.proposedKey && !pool.has(question.proposedKey))) session.questions[key]=generated[key];
      }
    }
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
    session.paused = true; session.cardOpen = false;
  }
  function init(deps) {
    state.root = document.querySelector('#practice-view');
    if (!state.root) return;
    state.deps = {...state.deps,...deps};
    indexData(deps.data);
    if (!state.initialized) {
      state.store=readStore();
      document.addEventListener('click',onClick);
      document.addEventListener('change',onChange);
      document.addEventListener('input',onInput);
      document.addEventListener('submit',onSubmit);
      document.addEventListener('keydown',onKey);
      document.addEventListener('pointerdown',event => { if (event.button === 0 && state.visible && state.root?.contains(event.target)) { unlockFeedbackAudio(event); if (event.target.closest('[data-pr-letter]')) event.preventDefault(); } });
      window.addEventListener('online',syncCommunity);
      window.addEventListener('beforeunload',() => { stopFeedback(); if (currentSession()) { stopMatchClock(); currentSession().paused=true; persist(); } });
      document.addEventListener('visibilitychange',() => { if (!document.hidden) return; stopFeedback(); if (currentSession() && state.visible) { pause(); if (state.screen === 'session') renderSession(); } });
      state.initialized=true;
    }
    recoverActive();
    applyConfig(state.store.draft || state.store.recent[0] || {sources:state.chapters[0] ? [state.chapters[0].token] : [],mode:'random',activity:'cards'});
    renderSetup(); syncCommunity();
  }
  function show() {
    if (!state.initialized) return;
    state.visible=true; syncCommunity();
    if (state.screen === 'session') renderSession();
    else if (state.screen === 'history') renderHistory();
    else if (state.screen === 'results' && state.result) renderResult(state.result);
    else renderSetup();
    syncSidebar();
  }
  function hide() {
    state.visible=false;
    if (currentSession()) pause(); else stopAudio();
  }
  window.NorskPractice = {init,show,hide,renderTOC};
  window.dispatchEvent(new Event('norskpracticeready'));
})();
