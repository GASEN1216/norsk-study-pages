/* Norwegian vocabulary practice. All progress stays in this browser. */
(() => {
  'use strict';
  if (window.NorskPractice) return;
  const L10N = window.NorskI18n || {lang:'zh',english:false,t:(text,vars) => vars ? text.replace(/\{(\w+)\}/g,(match,key) => key in vars ? String(vars[key]) : match) : text,gloss:item => String(item?.meaning ?? item?.zh ?? ''),data:() => Promise.resolve(null),name:nickname => String(nickname ?? ''),set() {}};
  const tx = L10N.t;
  // English devices: meanings are English glosses (Chinese only where a word has none); Chinese stays in meaningZh.
  const EN = !!L10N.english;
  const CJK = /[\u3400-\u9fff\uff01-\uff5e\u3000-\u303f]/;
  // On English devices, Chinese-only notes, usage and example translations are left out.
  const readable = text => !EN || !CJK.test(String(text || ''));
  const dropChineseGloss = text => EN ? String(text || '').replace(/\s*[（(][^（()）]*[\u3400-\u9fff][^（()）]*[）)]\s*$/u,'').trim() : text;
  const SENSE = EN ? '; ' : '；', COLON = EN ? ': ' : '：';
  // Data labels (parts of speech, basics and kitchen categories) are Chinese; English devices look each part up.
  const dataText = value => EN ? String(value || '').split(/(；|／|\/)/).map(part => /^(；|／|\/)$/.test(part) ? (part === '；' ? '; ' : '/') : tx(part.trim())).join('') : value;
  const LEGACY_STORAGE_KEY = 'norsk-practice-v1';
  const storageKeyFor = seriesId => seriesId === 'god-i-norsk' ? LEGACY_STORAGE_KEY : `${LEGACY_STORAGE_KEY}:${encodeURIComponent(seriesId)}`;
  const RATINGS = {2:tx('认识'),1:tx('模糊'),0:tx('不认识')};
  const ACTIVITIES = {
    cards:{title:tx('翻面词卡'),description:tx('翻面回想，不会的再来')},
    learn:{title:tx('拼写学习'),description:tx('看中文拼写，错了再练')},
    quiz:{title:tx('综合测验'),description:tx('判断 · 选择 · 拼写')},
    match:{title:tx('配对消除'),description:tx('限时配对，错配加时')},
    listen:{title:tx('听音选义'),description:tx('听读音，选出意思')}
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
  // Locale-aware lower-casing is slow and indexing asks for the same few thousand words again and again: remember them.
  const normalized = new Map();
  const normalize = word => {
    const text = String(word || '');
    let key = normalized.get(text);
    if (key === undefined) {
      key = text.normalize('NFC').trim().toLocaleLowerCase('nb');
      if (normalized.size < 60000) normalized.set(text,key);
    }
    return key;
  };
  const unique = values => [...new Set(values.filter(Boolean))];
  const has = (object,key) => Object.prototype.hasOwnProperty.call(object || {},key);
  const blankStore = () => ({version:1,sets:[],recent:[],stats:{},history:[],active:null,draft:null,favorites:[],matchBest:{},keyboardMode:'screen',keyboardChoice:false,feedbackSound:true,communityPending:[]});
  const state = {seriesId:'god-i-norsk',seriesTitle:'God i norsk',storageKey:LEGACY_STORAGE_KEY,stores:new Map(),syncs:new Map(),root:null,deps:{},sources:new Map(),chapters:[],basics:[],kitchen:[],mall:[],mine:[],wordbookTitle:tx('我的词本'),indexed:null,pendingWordbook:null,words:new Map(),selected:new Set(),mode:'random',activity:'cards',quiz:defaultQuiz(),scopeTab:'chapters',scopeQuery:'',keyboardPage:'letters',store:blankStore(),screen:'setup',result:null,storageError:'',initialized:false,visible:false,pending:null,playToken:0,speakTimer:null,advanceTimer:null,prepared:new Map(),prepareTimer:null,matchTimer:null,matchStartedAt:null,justMatched:[],flipAnimation:false,communitySync:null,honors:null,honorsStatus:'idle',honorsRequest:0};
  let sessionPools = new WeakMap(), checkedQuestions = new WeakSet(), inputSaveTimer = null;
  let editor = null;
  const EDITOR_REQUEST = 'norsk-practice-editor-request:';
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
      if (effects.context?.state === 'interrupted') releaseFeedbackAudio();
      if (!effects.context || effects.context.state === 'closed') effects.context = new AudioContext();
      if (effects.context.state === 'suspended') Promise.resolve(effects.context.resume()).catch(() => {});
    } catch { /* Older browsers and blocked audio still keep text feedback. */ }
  }
  // Like word readings, chimes get a fresh context after the page was hidden: iOS can leave the old one silent.
  function releaseFeedbackAudio() {
    stopFeedbackAudio();
    const context=effects.context;
    effects.context=null;
    if (context && context.state !== 'closed') { try { Promise.resolve(context.close()).catch(() => {}); } catch {} }
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
    // The celebration module, when loaded, gives the results card its own finishing touch.
    if (kind === 'complete' && !window.NorskCelebrate) card.insertAdjacentHTML?.('beforeend',`<div class="pr-completion-burst" aria-hidden="true">${Array.from({length:18},(_,index) => `<i style="--pr-x:${8+index*5}%;--pr-drift:${(index%5-2)*22}px;--pr-delay:${index%4*35}ms;--pr-turn:${(index%2 ? 1 : -1)*(150+index*16)}deg"></i>`).join('')}</div>`);
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
      storageFailure(tx('本机学习记录暂时无法读取。本次仍可练习，新进度可能无法在刷新后恢复。'));
      return blankStore();
    }
  }
  // One tab owns each textbook's saved record. A takeover saves the old tab first;
  // the new owner then reads the latest complete record, including deletions.
  function canEdit() { return editor?.key === state.storageKey && ['owned','memory'].includes(editor.status); }
  function ownsStore(store,key) { return editor?.key === key && editor.status === 'owned' && store === state.store; }
  function editorMessage() {
    if (!editor || editor.status === 'owned') return '';
    if (editor.status === 'memory') return tx('当前浏览器无法协调多个标签页的保存。本次仍可练习，但新记录只保留在当前页面；请勿刷新或关闭。');
    return editor.status === 'waiting' ? tx('正在连接本机学习记录，暂时只读。') : tx('这个教材的学习记录正在另一标签页中使用。本页暂时只读。');
  }
  function editorMarkup() {
    const message=editorMessage();
    return message ? `<p class="pr-storage-warning" role="status">${e(message)}${editor?.status === 'readonly' ? button('takeover',tx('在此继续'),'','pr-small') : ''}</p>` : '';
  }
  function releaseEditor() {
    const previous=editor;
    if (!previous) return;
    if (previous.status === 'owned') {
      pause(); persist();
      previous.status='readonly';
      previous.release?.();
    } else if (previous.status === 'waiting') previous.status='readonly';
    else if (previous.status === 'memory') pause();
  }
  function acquireEditor(wait=false) {
    if (editor?.key === state.storageKey && ['owned','waiting'].includes(editor.status)) return;
    const lock={key:state.storageKey,status:'waiting',release:null};
    editor=lock;
    const locks=window.navigator?.locks;
    const unavailable=() => { if (editor === lock) { lock.status='memory'; renderSetup(); } };
    if (!locks?.request) { unavailable(); return; }
    if (wait) {
      try { localStorage.setItem(EDITOR_REQUEST+lock.key,uid()); }
      catch { lock.status='readonly'; storageFailure(tx('无法向另一标签页请求继续，请先关闭那一页，再刷新本页。')); renderSetup(); return; }
    }
    renderSetup();
    try {
      void locks.request(lock.key+':editor',{mode:'exclusive',...(!wait ? {ifAvailable:true} : {})},async acquired => {
        if (editor !== lock || lock.status !== 'waiting' || state.storageKey !== lock.key) return;
        if (!acquired) { lock.status='readonly'; renderSetup(); return; }
        const held=new Promise(resolve => { lock.release=resolve; });
        lock.status='owned';
        state.store=readStore(); state.stores.set(state.seriesId,state.store);
        recoverActive();
        applyConfig(state.store.draft || state.store.recent[0] || {sources:state.chapters[0] ? [state.chapters[0].token] : [],mode:'random',activity:'cards'});
        renderSetup(); syncCommunity();
        await held;
      }).catch(unavailable);
    } catch { unavailable(); }
  }
  function requireEditor() {
    if (canEdit()) return true;
    announce(editorMessage() || tx('请先连接本机学习记录。'));
    return false;
  }
  function persistStore(store,key) {
    if (!ownsStore(store,key)) return;
    try { localStorage.setItem(key,JSON.stringify(store)); }
    catch { storageFailure(tx('本机存储空间不足或暂不可用。本次仍可练习，刷新后可能丢失新进度。')); }
    if (store === state.store) syncSidebar();
  }
  function persist() {
    if (inputSaveTimer != null) clearTimeout(inputSaveTimer);
    inputSaveTimer = null;
    persistStore(state.store,state.storageKey);
  }
  // Typing updates the live draft immediately; save once after the keystrokes settle.
  // Answers, navigation, visibility changes and unload still save synchronously.
  function saveInputDraft() {
    if (typeof setTimeout !== 'function') { persist(); return; }
    if (inputSaveTimer != null) clearTimeout(inputSaveTimer);
    inputSaveTimer = setTimeout(persist,200);
  }
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
      if (!state.deps.pronounce) { announce(tx('读音服务暂未准备好，请刷新页面后重试。')); return; }
      const failed = () => { if (token === state.playToken) announce(tx('这条读音暂时无法播放，可以点喇叭重试。')); };
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
    if (Array.isArray(value)) return unique(value.map(plainValue)).join(SENSE);
    if (typeof value === 'object') return Object.entries(value).map(([key,item]) => `${key}${COLON}${plainValue(item)}`).join(SENSE);
    return String(value);
  }
  // Senses merge with '；' as always; English devices merge English senses with '; ' and keep the Chinese apart.
  const MERGED_FIELDS = EN ? ['meaning','meaningZh','english','pos','gender','article'] : ['meaning','english','pos','gender','article'];
  const EN_SENSES = new Set(EN ? ['meaning','english'] : []);
  // An English device practises with English meanings; meaningZh keeps the Chinese for the online games.
  const localized = word => EN && word ? {...word,meaningZh:word.meaning ?? '',meaning:L10N.gloss(word)} : word;
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
    for (const field of MERGED_FIELDS) merged[field] = unique([existing[field],word[field]].flatMap(value => String(value || '').split(EN_SENSES.has(field) ? /\s*[;；]\s*/ : '；'))).join(EN_SENSES.has(field) ? '; ' : '；');
    merged.sourceEntry = unique([existing.sourceEntry,word.sourceEntry]).join('\n');
    merged.sourceLabels = unique([...existing.sourceLabels,label]);
    merged.practiceExamples = unique([...existing.practiceExamples,...examples]);
    merged.practiceTextExamples = unique([...(existing.practiceTextExamples || []),...textExamples]);
    merged.practiceLearningExamples = unique([...(existing.practiceLearningExamples || []),...learningExamples]);
    if (Array.isArray(word.forms)) merged.forms = unique([...(Array.isArray(existing.forms) ? existing.forms : []),...word.forms]);
    if (Array.isArray(word.formsExpanded)) merged.formsExpanded = unique([...(Array.isArray(existing.formsExpanded) ? existing.formsExpanded : []),...word.formsExpanded]);
    return merged;
  }
  const wordbookSignature = wordbook => { try { return JSON.stringify([wordbook?.title || '',wordbook?.chapters || []]); } catch { return ''; } };
  function indexData(data) {
    state.wordbookSignature = wordbookSignature(data?.wordbook);
    state.sources.clear(); state.words.clear(); state.prepared.clear(); state.chapters = []; state.basics = []; state.kitchen = []; state.mall = []; state.mine = [];
    state.indexed = data;
    sessionPools = new WeakMap(); checkedQuestions = new WeakSet();
    const add = (token,label,words) => {
      const entries = new Map();
      for (const raw of words || []) {
        const word = localized(raw);
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
      const label = tx('第 {n} 章 · {title}',{n:number,title:chapter.title});
      const sections = (chapter.sections || []).map(section => ({...section,...add(`section:${section.id}`,`${section.number ?? (/^[\d.]+$/.test(String(section.id)) ? section.id : '')} ${section.title}`.trim(),section.words)}));
      const chapterWords = Array.isArray(chapter.words) ? chapter.words : (chapter.sections || []).flatMap(section => section.words || []);
      const source = add(`chapter:${chapter.id}`,label,chapterWords);
      state.chapters.push({...chapter,...source,sections});
    }
    for (const category of data?.basics?.categories || []) state.basics.push({...category,...add(`basic:${category.id}`,dataText(category.title),category.items)});
    // 厨房 Kjøkken: 开饭啦's food words by kind of food, with their own readings (a public source, like the basics).
    const kitchenWords = id => (data?.kitchen?.entries || []).filter(item => item?.cat === id && item.word && item.zh).map(item => ({word:item.word,meaning:item.zh,
      english:item.en || '',ipa:item.ipa || '',pos:KITCHEN_POS[item.pos] || '',gender:item.gender || '',article:item.article || '',forms:(item.forms || []).filter(Boolean),
      audio:item.clip || '',...(item.ex ? {example:`${item.ex}${item.exZh && !EN ? `（${item.exZh}）` : ''}`,exampleSource:'study'} : {})}));
    for (const category of data?.kitchen?.categories || []) {
      const words = kitchenWords(category.id);
      if (words.length) state.kitchen.push({...category,title:category.zh,...add(`kitchen:${category.id}`,tx('厨房 · {name}',{name:dataText(category.zh)}),words)});
    }
    // 商场 Varehuset: 百货超市's things, one source per shop (and the colours), with their readings.
    for (const shop of data?.mall?.shops || []) {
      const words = (data?.mall?.entries || []).filter(item => item?.word && item.zh && (item.shops || [item.shop]).includes(shop.id)).map(item => ({word:item.word,meaning:item.zh,
        english:item.en || '',article:['en','ei','et'].includes(item.article) ? item.article : '',forms:(item.forms || []).filter(Boolean),audio:item.clip || ''}));
      if (words.length) state.mall.push({...shop,title:shop.zh,...add(`mall:${shop.id}`,tx('商场 · {name}',{name:EN && shop.en ? shop.en : dataText(shop.zh)}),words)});
    }
    // The learner's own wordbook: one source per chapter; words keep their own recording (audio).
    // The wordbook's default name is stored in Chinese; English devices show it in English.
    const wordbookTitle = String(data?.wordbook?.title || '').trim();
    state.wordbookTitle = (EN && wordbookTitle === '我的词本' ? '' : wordbookTitle) || tx('我的词本');
    for (const chapter of data?.wordbook?.chapters || []) state.mine.push({...chapter,...add(`mine:${chapter.id}`,String(chapter.title || ''),chapter.words)});
  }
  // The wordbook changed (an edit, or a sync from another device): only its sources are new. Selections
  // of chapters that are gone are dropped; an open session keeps going and is checked against the new words.
  function refreshWordbook(wordbook) {
    if (!state.indexed) return;
    if (state.visible && state.screen === 'session' && currentSession()) { state.pendingWordbook = wordbook; return; }
    state.pendingWordbook = null;
    // The store also changes for sync bookkeeping; the words are indexed again only when the wordbook itself changed.
    if (wordbookSignature(wordbook) === state.wordbookSignature) return;
    indexData({...state.indexed,wordbook});
    const kept = [...state.selected].filter(token => state.sources.has(token));
    if (kept.length !== state.selected.size) { state.selected = new Set(kept); if (canEdit()) draft(); }
    if (currentSession()) { recoverActive(); if (canEdit()) persist(); }
    if (!state.visible) return;
    if (state.screen === 'setup' && $('#pr-scope')?.open) renderScope();
    syncSidebar();
  }
  function applyPendingWordbook() { if (state.pendingWordbook) refreshWordbook(state.pendingWordbook); }
  const KITCHEN_POS = {noun:'名词',verb:'动词',adj:'形容词',phrase:'短语'};
  // Which source tab shows a range: textbook chapters first, then the wordbook, the kitchen, then the basics.
  function scopeTabFor(tokens) {
    const list = [...tokens];
    if (list.some(token => token.startsWith('chapter:') || token.startsWith('section:'))) return 'chapters';
    if (list.some(token => token.startsWith('mine:'))) return 'wordbook';
    if (list.some(token => token.startsWith('kitchen:'))) return 'kitchen';
    if (list.some(token => token.startsWith('mall:'))) return 'mall';
    return list.length ? 'basics' : 'chapters';
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
    if (!sessionPools.has(session)) sessionPools.set(session,session.customKeys ? customPool(session.customKeys) : poolFor(session.sources));
    return sessionPools.get(session);
  }
  function selectedLabel(tokens) {
    const labels = tokens.map(token => state.sources.get(token)?.label).filter(Boolean);
    return labels.length > 2 ? tx('{names} 等 {n} 组',{names:labels.slice(0,2).join(' + '),n:labels.length}) : labels.join(' + ');
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
  function customPool(keys) { return new Map(unique(keys).filter(key => state.words.has(key)).map(key => [key,state.words.get(key)])); }
  // A session's order is drawn while the learner is still choosing and its first recordings load
  // meanwhile, so the first word is read as soon as start is pressed.
  function orderSignature(sources,customKeys,mode,activity) {
    return JSON.stringify([state.seriesId,activity,mode,customKeys ? unique(customKeys).sort() : [...sources].sort()]);
  }
  function prepareOrder(sources,customKeys,mode,activity) {
    if (!state.deps.prefetch) return;
    const signature = orderSignature(sources,customKeys,mode,activity);
    if (state.prepared.has(signature)) return;
    const pool = customKeys ? customPool(customKeys) : poolFor(sources);
    if (!pool.size) return;
    const keys = selectKeys(pool,mode);
    state.prepared.set(signature,keys);
    while (state.prepared.size > 8) state.prepared.delete(state.prepared.keys().next().value);
    const first = activity === 'match' ? matchGroups(keys.slice(0,24),pool)[0] || [] : keys.slice(0,4);
    state.deps.prefetch(first.map(key => pool.get(key)));
  }
  // Ticking several chapters in a row draws once, after the clicks settle.
  function prepareScopeOrders() {
    if (!state.deps.prefetch || typeof setTimeout !== 'function') return;
    if (state.prepareTimer != null) clearTimeout(state.prepareTimer);
    state.prepareTimer = setTimeout(() => {
      state.prepareTimer = null;
      if (state.screen !== 'setup') return;
      prepareOrder([...state.selected],null,state.mode,state.activity);
      prepareOrder([],weakKeys(),'weak',state.activity);
      prepareOrder([],favoriteKeys(),state.mode,state.activity);
    },150);
  }
  function applyConfig(config) {
    state.selected = new Set((config.sources || []).filter(token => state.sources.has(token)));
    state.mode = config.mode === 'weak' ? 'weak' : 'random';
    state.activity = activityOf(config);
    state.quiz = quizConfig(config.quiz);
  }
  function renderTOC() {
    return `<div class="pr-sidebar">${button('setup',tx('选择练习'),'','pr-side-button')}${button('history',tx('学习记录'),'','pr-side-button')}<div class="pr-sidebar-stats"><span><strong data-practice-stat="practiced">${Object.keys(state.store.stats).length}</strong>${tx('已练词语')}</span><span><strong data-practice-stat="sessions">${state.store.history.length}</strong>${tx('完成次数')}</span></div></div>`;
  }
  function syncSidebar() {
    const values = {weak:weakKeys().length,favorites:favoriteKeys().length,practiced:Object.keys(state.store.stats).length,sessions:state.store.history.length};
    document.querySelectorAll('[data-practice-stat]').forEach(node => { node.textContent = values[node.dataset.practiceStat] ?? ''; });
  }
  function shell(content) {
    clearFeedbackVisual();
    state.root.innerHTML = `<div class="pr-app">${editorMarkup()}<p id="pr-storage-warning" class="pr-storage-warning" role="status" ${state.storageError ? '' : 'hidden'}>${e(state.storageError)}</p>${content}</div><dialog class="pr-dialog pr-card-dialog" id="pr-card" aria-labelledby="pr-card-title"></dialog><dialog class="pr-dialog pr-confirm-dialog" id="pr-confirm" aria-labelledby="pr-confirm-title"></dialog><dialog class="pr-dialog pr-scope-dialog" id="pr-scope" aria-labelledby="pr-scope-title"></dialog><dialog class="pr-dialog pr-online-dialog" id="pr-online" aria-labelledby="pr-online-title"></dialog><dialog class="pr-dialog pr-quests-dialog" id="pr-quests" aria-labelledby="pr-quests-title"></dialog>`;
    $('#pr-confirm').addEventListener('cancel',event => { event.preventDefault(); state.pending = null; $('#pr-confirm').close(); if (state.screen === 'session') resume(); });
    syncBackLayer();
  }
  function sourceCheckbox(source,checked=false) {
    return `<label class="pr-source-row" data-pr-source-search="${e(source.label.toLocaleLowerCase('nb'))}"><input type="checkbox" data-pr-source="${e(source.token)}" ${checked ? 'checked' : ''}><span>${e(source.label)}</span><small>${source.words.length}</small></label>`;
  }
  // The wordbook's chapters that have words, with a whole-book row when there are several.
  function wordbookSources() {
    const chapters = state.mine.filter(chapter => chapter.words.length);
    if (!chapters.length) return `<div class="pr-source-empty pr-wordbook-empty"><p>${tx('词本还是空的。')}</p>${button('wordbook-open',tx('去添加'),'','pr-small')}</div>`;
    const whole = chapters.length > 1 ? `<label class="pr-source-row pr-wordbook-all" data-pr-source-search="${e(state.wordbookTitle.toLocaleLowerCase('nb'))}"><input type="checkbox" data-pr-wordbook-all="1" ${chapters.every(chapter => state.selected.has(chapter.token)) ? 'checked' : ''}><span>${tx('整本')}</span><small>${poolFor(chapters.map(chapter => chapter.token)).size}</small></label>` : '';
    return `<div class="pr-chapter-list" id="pr-wordbook-sources">${whole}${chapters.map(chapter => sourceCheckbox(chapter,state.selected.has(chapter.token))).join('')}</div>`;
  }
  function savedGroups() {
    const saved = state.store.sets, recent = state.store.recent;
    const rows = [...saved.map(set => `<div class="pr-saved-row"><span>${e(set.name)}</span>${button('saved-load',tx('选用'),`data-pr-id="${e(set.id)}"`,'pr-small')}${iconButton('saved-delete','close',tx('删除组合 {name}',{name:e(set.name)}),`data-pr-id="${e(set.id)}"`)}</div>`),...recent.map((entry,index) => `<div class="pr-saved-row is-recent"><span>${e(entry.label || selectedLabel(entry.sources))}</span>${button('recent-load',tx('选用'),`data-pr-index="${index}"`,'pr-small')}</div>`)];
    return `<div class="pr-setting-block"><span class="pr-setting-label">${tx('常用范围')}</span>${rows.join('')}<div class="pr-save-combo"><label class="sr-only" for="pr-set-name">${tx('组合名称')}</label><input id="pr-set-name" type="text" maxlength="40" placeholder="${tx('给当前范围起个名字')}">${button('save-set',tx('保存'),'','pr-small')}</div></div>`;
  }
  function renderSetup() {
    state.screen = 'setup';
    applyPendingWordbook();
    const active = currentSession();
    const resumeBanner = active ? `<section class="pr-resume-banner"><span class="pr-mode-icon is-${activityOf(active)}">${icon(activityOf(active))}</span><div><strong>${tx('继续{title}',{title:e(ACTIVITIES[activityOf(active)].title)})}</strong><span>${tx('{done} / {n} 词',{done:Object.keys(active.answers || {}).length,n:active.firstKeys.length})}</span></div>${button('resume',tx('继续'),'','pr-primary')}</section>` : '';
    // The interface language switch sits quietly beside the textbook name; choosing reloads the page.
    const language = `<span class="pr-lang-dot" aria-hidden="true">·</span><button type="button" class="pr-lang-switch" data-practice-action="language" ${EN ? 'lang="zh" aria-label="Switch to Chinese">中文' : 'lang="en" aria-label="切换到英文界面">English'}</button>`;
    shell(`<div class="pr-home">${resumeBanner}<div class="pr-home-heading"><h2 class="pr-home-title">${tx('今天练什么？')}</h2><span class="pr-home-meta"><span class="pr-series-label">${e(state.seriesTitle)}</span>${language}</span></div><div class="pr-mode-grid" role="group" aria-label="${tx('练习方式')}">${Object.entries(ACTIVITIES).map(([key,item]) => `<button type="button" class="pr-mode-card is-${key}" data-pr-activity="${key}" aria-haspopup="dialog" aria-controls="pr-scope"><span class="pr-mode-icon">${icon(key)}</span><span class="pr-mode-title">${item.title}</span><span class="pr-mode-description">${item.description}</span></button>`).join('')}</div><div class="pr-goals" id="pr-goals">${goalsMarkup()}</div><div class="pr-home-columns">${historyColumn()}<div class="pr-home-board" id="pr-community-slot"></div></div></div>`);
    const slot = $('#pr-community-slot');
    if (slot) state.deps.mountCommunity?.(slot);
    loadHonors();
    // Continuing an unfinished session reads its current word, so load it already.
    if (active && active.phase !== 'review-intro') prefetchAhead(active);
  }
  // One quiet bar between the modes and the records: this week's challenge, today's quests, and the door to the games played together.
  function goalsMarkup() {
    const h = state.honors;
    const duel = `<button type="button" class="pr-goal is-duel" data-practice-action="online" aria-haspopup="dialog" aria-controls="pr-online"><span class="pr-goal-label">${tx('联机游戏')}</span><span class="pr-goal-sub">${ONLINE_GAMES.map(game => game.short).join(' · ')}</span><svg class="pr-goal-arrow" aria-hidden="true" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg></button>`;
    if (!h?.week?.challenge) return duel;
    const c = h.week.challenge, number = String(h.week.n).padStart(2,'0');
    const quests = h.today?.quests || [];
    const done = quests.filter(quest => quest.done).length;
    const value = c.done ? 100 : c.target ? Math.max(0,Math.min(100,Math.round(c.progress/c.target*100))) : 0;
    const title = challengeTitle(c);
    return `<button type="button" class="pr-goal is-week${c.done ? ' is-done' : ''}" data-practice-action="honors" aria-label="${tx('本周挑战：{title}，{state}',{title:e(title),state:c.done ? tx('已完成') : `${Math.min(c.progress,c.target)} / ${c.target}`})}"><img class="pr-goal-badge" src="assets/honors/week-${number}.webp" alt="" loading="lazy" decoding="async"><span class="pr-goal-label">${tx('本周挑战')} <span lang="nb">${e(c.theme || '')}</span></span><span class="pr-goal-sub">${e(title)}</span><span class="pr-goal-meter"><i style="width:${value}%"></i></span><b class="pr-goal-count">${c.done ? tx('完成') : `${Math.min(c.progress,c.target)}/${c.target}`}</b></button>
      <button type="button" class="pr-goal is-quests" data-practice-action="quests" aria-haspopup="dialog" aria-controls="pr-quests" aria-label="${tx('今日任务，完成 {done} / {n}',{done,n:quests.length})}"><span class="pr-goal-label">${tx('今日任务')}</span><span class="pr-goal-dots" aria-hidden="true">${quests.map(quest => `<i class="${quest.done ? 'is-done' : ''}"></i>`).join('')}</span><b class="pr-goal-count">${done}/${quests.length}</b></button>${duel}`;
  }
  // The server names quests and the weekly challenge in Chinese; English devices word them from the goal and target.
  const CHALLENGE_TITLES = {
    quests:n => tx('完成 {n} 个每日任务',{n}),days:n => Number(n) >= 7 ? tx('本周 7 天都有练习') : tx('本周 {n} 天有练习',{n}),
    words:n => tx('练习 {n} 个词',{n:Number(n).toLocaleString('en-US')}),xp:n => tx('获得 {n} XP',{n:Number(n).toLocaleString('en-US')}),
    duels:n => tx('玩 {n} 局联机翻翻乐',{n}),correct:n => tx('答对 {n} 题',{n}),modes:() => tx('五种练习各完成一次'),
  };
  const challengeTitle = c => String((EN && CHALLENGE_TITLES[c?.goal] && Number.isFinite(Number(c.target)) ? CHALLENGE_TITLES[c.goal](c.target) : c?.title) || '');
  const questTitle = quest => EN ? tx(String(quest?.title || '')) : quest.title;
  // 联机游戏: one door for every game played with classmates. Each card opens its own game; new games join this list.
  const ONLINE_GAMES = [
    {action:'duel',title:tx('联机翻翻乐'),short:tx('翻翻乐'),note:tx('和同学抢翻词对，挪威语配中文'),meta:tx('开房间 · 加入房间')},
    {action:'chase',title:tx('警察抓小偷'),short:tx('警察抓小偷'),note:tx('打课文比速度，警察追、小偷逃'),meta:tx('人机对战 · 开房间 · 加入房间')},
    {action:'kitchen',title:tx('开饭啦'),short:tx('开饭啦'),note:tx('听懂点单、配菜上桌，学会挪威的日常饮食'),meta:tx('一个人开张 · 开房间 · 加入房间')},
    {action:'mall',title:tx('百货超市'),short:tx('百货超市'),note:tx('当店员接待顾客，在货架上找对东西，学会购物用语'),meta:tx('逛店 · 一个人开店 · 和同学一起')},
  ];
  function openOnline() {
    const dialog = $('#pr-online');
    if (!dialog) return;
    const art = name => `assets/online/${name}.webp${state.deps.version ? `?v=${encodeURIComponent(state.deps.version)}` : ''}`;
    dialog.innerHTML = `<div class="pr-dialog-heading"><h2 id="pr-online-title" tabindex="-1">${tx('联机游戏')}</h2>${iconButton('online-close','close',tx('关闭'))}</div><div class="pr-online-games">${ONLINE_GAMES.map(game => `<button type="button" class="pr-online-game is-${game.action}" data-practice-action="${game.action}"><img class="pr-online-art" src="${e(art(game.action))}" alt="" decoding="async" draggable="false"><span class="pr-online-text"><strong>${game.title}</strong><span>${game.note}</span><small>${game.meta}</small></span><svg class="pr-goal-arrow" aria-hidden="true" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg></button>`).join('')}</div><p class="pr-online-note">${tx('更多联机游戏会陆续加到这里。')}</p>`;
    // A card whose picture is still being drawn keeps a quiet warm block instead of a broken image.
    dialog.querySelectorAll('.pr-online-art').forEach(image => image.addEventListener('error',() => { image.removeAttribute('src'); image.classList.add('is-missing'); },{once:true}));
    if (!dialog.open) dialog.showModal?.();
    $('#pr-online-title')?.focus?.();
  }
  // 今日任务: the day's three quests. A quest that can be done somewhere opens that place in one tap.
  const GAME_TITLES = Object.fromEntries(ONLINE_GAMES.map(game => [game.action,game.title]));
  const questMetric = quest => String(quest?.metric || {online:'minutes',duel:'duels'}[String(quest?.id || '').replace(/\d+$/,'')] || String(quest?.id || '').replace(/\d+$/,''));
  function questPlace(quest) {
    const metric = questMetric(quest);
    if (ACTIVITIES[metric]) return {activity:metric};
    if (metric === 'duels') return {game:'duel'};
    if (metric === 'chase' || metric === 'kitchen') return {game:metric};
    // Only objective answers count as 答对, and the quiz earns the most XP per word.
    if (metric === 'correct' || metric === 'xp') return {activity:'quiz'};
    if (metric === 'kinds') {
      const today = new Date().toDateString();
      const done = new Set(state.store.history.filter(result => new Date(result.finishedAt).toDateString() === today).map(result => activityOf(result)));
      // Somewhere new today: the first practice mode not yet finished today on this device.
      return {activity:Object.keys(ACTIVITIES).find(key => !done.has(key)) || state.activity};
    }
    if (metric === 'words' || metric === 'results') return {activity:state.activity};
    return null;
  }
  function questsMarkup() {
    const quests = state.honors?.today?.quests || [];
    const arrow = '<svg class="pr-goal-arrow" aria-hidden="true" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>';
    const row = (quest,index) => {
      const target = Number(quest.target) || 0, progress = Math.min(Number(quest.progress) || 0,target);
      const width = quest.done ? 100 : target ? Math.round(progress/target*100) : 0;
      const place = quest.done ? null : questPlace(quest);
      const where = place?.game ? GAME_TITLES[place.game] : place ? ACTIVITIES[place.activity].title : '';
      const body = `<span class="pr-quest-mark" aria-hidden="true"></span><span class="pr-quest-text"><strong>${e(questTitle(quest))}</strong><span class="pr-quest-meter" aria-hidden="true"><i style="width:${width}%"></i></span></span><span class="pr-quest-side"><b class="pr-quest-count">${quest.done ? tx('完成') : `${progress}/${target}`}</b>${where ? `<span class="pr-quest-go">${e(where)}${arrow}</span>` : quest.done ? '' : `<span class="pr-quest-hint">${tx('网站开着就计时')}</span>`}</span>`;
      return `<li>${where ? `<button type="button" class="pr-quest" data-practice-action="quest-go" data-pr-quest="${index}" aria-label="${e(tx('{title}，{progress}，去{place}',{title:questTitle(quest),progress:`${progress} / ${target}`,place:where}))}">${body}</button>` : `<div class="pr-quest${quest.done ? ' is-done' : ''}">${body}</div>`}</li>`;
    };
    return `<div class="pr-dialog-heading"><h2 id="pr-quests-title" tabindex="-1">${tx('今日任务')}</h2>${iconButton('quests-close','close',tx('关闭'))}</div><ol class="pr-quests">${quests.map(row).join('')}</ol><p class="pr-quests-foot"><span>${tx('每天北京时间零点更新')}</span><button type="button" class="pr-quests-link" data-practice-action="honors">${tx('荣誉与成就')}${arrow}</button></p>`;
  }
  function openQuests() {
    const dialog = $('#pr-quests');
    if (!dialog || !state.honors?.today?.quests?.length) return;
    dialog.innerHTML = questsMarkup();
    if (!dialog.open) dialog.showModal?.();
    $('#pr-quests-title')?.focus?.();
  }
  function goQuest(index) {
    const place = questPlace(state.honors?.today?.quests?.[index]);
    if (!place) return;
    if (place.activity && !canEdit()) { requireEditor(); return; }
    $('#pr-quests')?.close();
    if (place.game === 'duel') state.deps.openDuel?.();
    else if (place.game === 'chase') state.deps.openChase?.();
    else if (place.game === 'kitchen') state.deps.openKitchen?.();
    else openActivity(place.activity);
  }
  // Opening a practice mode: its range dialog, as the mode cards do.
  function openActivity(activity) {
    state.activity=activity; state.scopeQuery='';
    if (state.selected.size) state.scopeTab=scopeTabFor(state.selected);
    draft(); renderScope();
  }
  function updateGoals() {
    const slot = state.visible && state.screen === 'setup' ? $('#pr-goals') : null;
    if (slot) slot.innerHTML = goalsMarkup();
  }
  async function loadHonors(force=false) {
    const run = ++state.honorsRequest;
    try {
      const community = await state.deps.community?.();
      const honors = await community?.honors?.({force});
      if (run !== state.honorsRequest) return;
      if (honors?.week) { state.honors = honors; state.honorsStatus = 'ready'; }
      else if (!state.honors) state.honorsStatus = 'error';
    } catch { if (run === state.honorsRequest && !state.honors) state.honorsStatus = 'error'; }
    updateGoals();
  }
  window.addEventListener('norskhonorschange',event => { if (event.detail?.week) { state.honors = event.detail; state.honorsStatus = 'ready'; updateGoals(); } });
  // Word groups the multiplayer game can draw from: chapters of the current series and the basics.
  // Word ranges for 联机翻翻乐, shaped like the practice range picker: chapters with their sections,
  // basics categories, and the learner's own favourites and weak words. Words carry their first sense.
  // Rooms mix Chinese and English players: meaning is always the Chinese first sense, as before, and english carries
  // the whole English gloss ('' when a word has none; the games trim it to its first sense).
  function duelSources() {
    const chinese = word => EN ? word.meaningZh : word.meaning;
    const pick = words => words.filter(word => word?.word && chinese(word)).map(word => ({key:word.key,word:word.word,meaning:String(chinese(word)).split('；')[0],english:String(word.english || '').split(/\s*[;；]\s*/).filter(Boolean).join('; ')}));
    const sources = [];
    for (const chapter of state.chapters) {
      sources.push({token:chapter.token,label:chapter.label,group:'chapter',words:pick(chapter.words)});
      for (const section of chapter.sections) sources.push({token:section.token,label:section.label,group:'section',parent:chapter.token,words:pick(section.words)});
    }
    for (const category of state.basics) sources.push({token:category.token,label:category.label,group:'basics',words:pick(category.words)});
    for (const category of state.kitchen) sources.push({token:category.token,label:category.label,group:'basics',words:pick(category.words)});
    for (const category of state.mall) sources.push({token:category.token,label:category.label,group:'basics',words:pick(category.words)});
    for (const chapter of state.mine) sources.push({token:chapter.token,label:chapter.label,group:'wordbook',words:pick(chapter.words)});
    sources.push({token:'favorites',label:tx('收藏词'),group:'mine',words:pick(favoriteKeys().map(key => state.words.get(key)))});
    sources.push({token:'weak',label:tx('薄弱词'),group:'mine',words:pick(weakKeys().map(key => state.words.get(key)))});
    return sources.filter(source => source.words.length);
  }
  function historyStats() {
    return `<div class="pr-history-stats"><span><b>${Object.keys(state.store.stats).length}</b>${tx('已练词语')}</span><span><b>${state.store.history.length}</b>${tx('完成次数')}</span><span><b>${weakKeys().length}</b>${tx('薄弱词')}</span></div>`;
  }
  function historyEntry(result,actions=true) {
    const activity=activityOf(result), summary=resultSummary(result);
    return `<article class="pr-history-entry"><span class="pr-mode-icon is-${activity}">${icon(activity)}</span><button type="button" class="pr-history-main" data-practice-action="history-detail" data-pr-id="${e(result.id)}"><strong>${e(ACTIVITIES[activity].title)}</strong><span>${e(result.label)} · ${e(dateLabel(result.finishedAt))}</span></button><span class="pr-history-score">${summary.score}<small>${summary.unit}</small></span>${actions && result.answers.some(answer => answer.points < 2) ? button('history-weak',tx('练错词'),`data-pr-id="${e(result.id)}"`,'pr-small pr-quiet') : ''}</article>`;
  }
  function historyColumn() {
    const history = state.store.history;
    return `<section class="pr-home-history" aria-labelledby="pr-home-history-title"><div class="pr-column-head"><h3 id="pr-home-history-title">${tx('学习记录')}</h3>${history.length ? button('history',tx('全部 {n}',{n:history.length}),'','pr-small pr-quiet') : ''}</div>${historyStats()}${history.length ? `<div class="pr-history-list">${history.slice(0,6).map(result => historyEntry(result,false)).join('')}</div>` : `<p class="pr-column-empty">${tx('完成一组练习后，记录会出现在这里。')}</p>`}</section>`;
  }
  function scopeOptions() {
    const quiz = state.activity === 'quiz' ? `<div class="pr-setting-block"><span class="pr-setting-label">${tx('题型')}</span><div class="pr-chip-group" role="group" aria-label="${tx('测验题型')}">${[['judge',tx('判断')],['choice',tx('选择')],['spell',tx('拼写')]].map(([value,label]) => `<label class="pr-chip"><input type="checkbox" data-pr-quiz-type="${value}" ${state.quiz.types.includes(value) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></div><label class="pr-setting-block"><span class="pr-setting-label">${tx('方向')}</span><select id="pr-quiz-direction"><option value="to-nb" ${state.quiz.direction === 'to-nb' ? 'selected' : ''}>${tx('中文 → 挪威语')}</option><option value="to-zh" ${state.quiz.direction === 'to-zh' ? 'selected' : ''}>${tx('挪威语 → 中文')}</option><option value="mixed" ${state.quiz.direction === 'mixed' ? 'selected' : ''}>${tx('混合')}</option></select></label>` : '';
    return `<details class="pr-options"><summary>${tx('更多设置')}</summary><div class="pr-settings">${quiz}<label class="pr-setting-block"><span class="pr-setting-label">${tx('顺序')}</span><select id="pr-order"><option value="random" ${state.mode === 'random' ? 'selected' : ''}>${tx('随机')}</option><option value="weak" ${state.mode === 'weak' ? 'selected' : ''}>${tx('薄弱词优先')}</option></select></label><div class="pr-setting-block pr-setting-rate">${rateControl()}</div>${savedGroups()}</div></details>`;
  }
  function seriesChoice() {
    const options = state.deps.seriesOptions || [];
    if (options.length < 2) return '';
    return `<div class="pr-series-choice"><span class="pr-setting-label">${tx('教材')}</span><div class="pr-series-options" role="group" aria-label="${tx('选择教材')}">${options.map(item => button('series',e(item.title),`data-pr-series="${e(item.id)}" aria-pressed="${item.id === state.seriesId}"`,'pr-small')).join('')}</div></div>`;
  }
  function renderScope() {
    const dialog = $('#pr-scope');
    if (!dialog) return;
    const pool = poolFor(state.selected), weak = weakKeys().length, favorites = favoriteKeys().length;
    const quick = weak || favorites ? `<div class="pr-quick-row">${weak ? button('weak',tx('薄弱词 <b>{n}</b>',{n:weak}),'','pr-chip-button') : ''}${favorites ? button('favorites',`${icon('star',true)}${tx('收藏 <b>{n}</b>',{n:favorites})}`,'','pr-chip-button') : ''}</div>` : '';
    const minimum = state.activity === 'match' ? 2 : 1;
    dialog.innerHTML = `<div class="pr-dialog-heading"><span class="pr-mode-icon is-${state.activity}">${icon(state.activity)}</span><h2 id="pr-scope-title" tabindex="-1">${ACTIVITIES[state.activity].title}</h2>${iconButton('scope-close','close',tx('返回练习方式'),'','pr-scope-close')}</div>${quick}${seriesChoice()}<div class="pr-source-tabs" role="group" aria-label="${tx('词语来源')}">${button('scope-tab',state.seriesTitle,`data-pr-tab="chapters" aria-pressed="${state.scopeTab === 'chapters'}"`,'pr-small')}${button('scope-tab',tx('基础常识'),`data-pr-tab="basics" aria-label="${tx('公共基础常识')}" title="${tx('公共基础常识')}" aria-pressed="${state.scopeTab === 'basics'}"`,'pr-small')}${button('scope-tab',e(state.wordbookTitle),`data-pr-tab="wordbook" aria-pressed="${state.scopeTab === 'wordbook'}"`,'pr-small')}${state.kitchen.length ? button('scope-tab',tx('厨房'),`data-pr-tab="kitchen" aria-label="${tx('厨房 Kjøkken：开饭啦的食物词')}" title="${tx('厨房 Kjøkken：开饭啦的食物词')}" aria-pressed="${state.scopeTab === 'kitchen'}"`,'pr-small') : ''}${state.mall.length ? button('scope-tab',tx('商场'),`data-pr-tab="mall" aria-label="${tx('商场 Varehuset：百货超市的商品词')}" title="${tx('商场 Varehuset：百货超市的商品词')}" aria-pressed="${state.scopeTab === 'mall'}"`,'pr-small') : ''}</div><input type="search" class="pr-source-search" id="pr-source-search" placeholder="${tx('搜索章节或分类')}" aria-label="${tx('搜索练习范围')}" value="${e(state.scopeQuery)}"><div class="pr-source-columns"><section data-pr-scope-tab="chapters" ${state.scopeTab === 'chapters' ? '' : 'hidden'}><div class="pr-chapter-list">${state.chapters.map(chapter => `<details class="pr-source-chapter" data-pr-chapter-search="${e((chapter.label+' '+chapter.sections.map(section => section.label).join(' ')).toLocaleLowerCase('nb'))}" ${!state.selected.has(chapter.token) && chapter.sections.some(section => state.selected.has(section.token)) ? 'open' : ''}><summary><label class="pr-chapter-select"><input type="checkbox" data-pr-chapter="${e(chapter.token)}" ${state.selected.has(chapter.token) ? 'checked' : ''}><span><b>${e(chapter.number ?? chapter.id)}</b>${e(chapter.title)}</span><small>${chapter.words.length}</small></label><span class="pr-section-toggle" title="${tx('展开小节')}">${icon('down')}</span></summary>${chapter.sections.map(section => sourceCheckbox(section,state.selected.has(chapter.token) || state.selected.has(section.token))).join('')}</details>`).join('')}</div></section><section data-pr-scope-tab="basics" ${state.scopeTab === 'basics' ? '' : 'hidden'}><div id="pr-basic-sources">${state.basics.map(category => sourceCheckbox(category,state.selected.has(category.token))).join('')}</div></section><section data-pr-scope-tab="wordbook" ${state.scopeTab === 'wordbook' ? '' : 'hidden'}>${wordbookSources()}</section>${state.kitchen.length ? `<section data-pr-scope-tab="kitchen" ${state.scopeTab === 'kitchen' ? '' : 'hidden'}><div id="pr-kitchen-sources">${state.kitchen.map(category => sourceCheckbox(category,state.selected.has(category.token))).join('')}</div></section>` : ''}${state.mall.length ? `<section data-pr-scope-tab="mall" ${state.scopeTab === 'mall' ? '' : 'hidden'}><div id="pr-mall-sources">${state.mall.map(category => sourceCheckbox(category,state.selected.has(category.token))).join('')}</div></section>` : ''}</div><p class="pr-source-empty" id="pr-source-empty" hidden>${tx('没有匹配的范围')}</p>${scopeOptions()}<div class="pr-scope-footer"><span id="pr-scope-count" class="pr-scope-count" aria-live="polite">${pool.size ? tx('已选 <b>{n}</b> 词',{n:pool.size}) : tx('还没有选择')}</span>${button('clear-selection',tx('清空'),pool.size ? '' : 'hidden','pr-small pr-quiet')}${button('start',tx('开始'),'id="pr-start" '+(pool.size < minimum ? 'disabled' : ''),'pr-primary pr-start')}</div>`;
    filterScope();
    updateSelectionUI(false);
    if (!dialog.open) { dialog.showModal?.(); $('#pr-scope-title')?.focus?.(); }
  }
  function loadScope(config) {
    state.selected = new Set((config.sources || []).filter(token => state.sources.has(token)));
    state.scopeQuery = '';
    state.scopeTab = scopeTabFor(state.selected);
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
    } else all(state.scopeTab === 'wordbook' ? '#pr-wordbook-sources [data-pr-source-search]' : state.scopeTab === 'kitchen' ? '#pr-kitchen-sources [data-pr-source-search]' : state.scopeTab === 'mall' ? '#pr-mall-sources [data-pr-source-search]' : '#pr-basic-sources [data-pr-source-search]').forEach(row => { row.hidden = !!query && !row.dataset.prSourceSearch.includes(query); if (!row.hidden) shown++; });
    if (state.scopeTab === 'wordbook' && !state.mine.some(chapter => chapter.words.length)) shown = 1;
    const empty = $('#pr-source-empty');
    if (empty) empty.hidden = shown > 0;
  }
  function updateSelectionUI(save=true) {
    if (state.screen !== 'setup') return;
    const chapterInputs = new Map([...state.root.querySelectorAll('[data-pr-chapter]')].map(node => [node.dataset.prChapter,node]));
    const sourceInputs = new Map([...state.root.querySelectorAll('[data-pr-source]')].map(node => [node.dataset.prSource,node]));
    for (const chapter of state.chapters) {
      const input = chapterInputs.get(chapter.token);
      if (input) { input.checked = state.selected.has(chapter.token); input.indeterminate = !input.checked && chapter.sections.some(section => state.selected.has(section.token)); }
      for (const section of chapter.sections) {
        const child = sourceInputs.get(section.token);
        if (child) child.checked = state.selected.has(chapter.token) || state.selected.has(section.token);
      }
    }
    for (const category of [...state.basics,...state.kitchen,...state.mall,...state.mine]) {
      const input = sourceInputs.get(category.token);
      if (input) input.checked = state.selected.has(category.token);
    }
    const whole = state.root.querySelector('[data-pr-wordbook-all]');
    if (whole) {
      const chapters = state.mine.filter(chapter => chapter.words.length), chosen = chapters.filter(chapter => state.selected.has(chapter.token)).length;
      whole.checked = chosen === chapters.length; whole.indeterminate = chosen > 0 && chosen < chapters.length;
    }
    const pool = poolFor(state.selected);
    const scopeCount = $('#pr-scope-count'), start = $('#pr-start'), clear = state.root.querySelector('[data-practice-action="clear-selection"]');
    if (scopeCount) scopeCount.innerHTML = pool.size ? `${tx('已选 <b>{n}</b> 词',{n:pool.size})}${state.activity === 'match' && pool.size < 2 ? tx(' · 配对至少 2 词') : ''}` : tx('还没有选择');
    if (start) start.disabled = !pool.size || (state.activity === 'match' && pool.size < 2);
    if (clear) clear.hidden = !pool.size;
    if (save) draft();
    prepareScopeOrders();
  }
  function rememberConfig(config,label) {
    const signature = JSON.stringify([config.sources.slice().sort(),config.mode,activityOf(config),config.activity === 'quiz' ? quizConfig(config.quiz) : null]);
    state.store.recent = [{...config,label,usedAt:now(),signature},...state.store.recent.filter(item => JSON.stringify([(item.sources || []).slice().sort(),item.mode,activityOf(item),item.activity === 'quiz' ? quizConfig(item.quiz) : null]) !== signature)].slice(0,6);
  }
  function startSession(config={},customKeys=null,label='') {
    if (!requireEditor()) return;
    const begin = () => {
      if (!requireEditor()) return;
      closeDialogs(); stopAudio(); stopMatchClock();
      const sources = config.sources || [...state.selected];
      const pool = customKeys ? customPool(customKeys) : poolFor(sources);
      if (!pool.size) { announce(tx('这组目前没有可练习的词，请重新选择范围。')); return; }
      const activity = activityOf(config);
      if (activity === 'match' && pool.size < 2) { announce(tx('配对消除至少需要 2 个词，请多选一些词语。')); return; }
      const mode = config.mode || state.mode;
      const prepared = state.prepared.get(orderSignature(sources,customKeys,mode,activity));
      state.prepared.clear();
      const firstKeys = prepared?.length === pool.size && prepared.every(key => pool.has(key)) ? prepared : selectKeys(pool,mode);
      const session = {id:uid(),seriesId:state.seriesId,seriesTitle:state.seriesTitle,startedAt:now(),sources,label:label || selectedLabel(sources),mode,activity,quiz:quizConfig(config.quiz),firstKeys,customKeys:customKeys ? [...pool.keys()] : null,reviewKeys:[],reviewAnswers:{},details:{},reviewDetails:{},phase:'first',index:0,answers:{},paused:false,flipped:false,cardsReverse:false,inputDraft:''};
      sessionPools.set(session,pool);
      if (['learn','quiz','listen'].includes(activity)) session.questions = makeQuestions(pool,firstKeys,activity,session.quiz);
      checkedQuestions.add(session);
      if (activity === 'match') { session.match={round:0,elapsedMs:0,penaltyMs:0,errors:{},matched:[],selected:null,wrong:[]}; makeMatchRound(session,pool); }
      state.store.active = session; state.keyboardPage='letters';
      if (!customKeys) { const saved={sources,mode,activity,quiz:session.quiz}; applyConfig(saved); rememberConfig(saved,session.label); state.store.draft=saved; }
      persist(); renderSession(); autoPlay(session); if (activity === 'match') startMatchClock();
    };
    if (currentSession()) {
      confirmDialog(tx('还有一组未完成的练习'),tx('开始新练习会放弃旧练习的剩余进度，已答的记录会保留。'),[
        {action:'confirm-resume',text:tx('继续上次练习'),primary:true},
        {action:'confirm-run',text:tx('开始新的练习'),run:begin},
        {action:'confirm-close',text:tx('取消')},
      ]);
    } else begin();
  }
  function activeItem() {
    const session = currentSession();
    return session && sessionPool(session).get(currentKey(session));
  }
  // Load the recordings of this word and the next few (or the whole match group) ahead of time,
  // so every reading in practice starts as soon as it is asked for.
  function prefetchAhead(session) {
    if (!session || !state.deps.prefetch) return;
    const pool = sessionPool(session);
    const keys = activityOf(session) === 'match' ? session.match?.roundKeys || [] : (currentKeys(session) || []).slice(session.index || 0,(session.index || 0)+4);
    state.deps.prefetch(keys.map(key => pool.get(key)).filter(Boolean));
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
    if (!item) { announce(tx('这个词已不在当前词表中，请继续下一词。')); return; }
    if (!promptAudioAllowed(session)) return;
    stopAudio();
    const token = state.playToken;
    try {
      if (!state.deps.pronounce) { announce(tx('读音服务暂未准备好，请刷新页面后重试。')); return; }
      await state.deps.pronounce(item);
    } catch { if (token === state.playToken) announce(tx('这条读音暂时无法播放，可以点喇叭重试。')); }
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
    return `<div class="pr-session-bar${review ? ' is-review' : ''}">${iconButton('exit','close',tx('退出练习'))}<div class="pr-progress" role="progressbar" aria-label="${review ? tx('错词重练进度') : tx('练习进度')}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><span style="width:${percent}%"></span></div><span class="pr-progress-count">${review ? `<b>${tx('重练')}</b>` : ''}${done}/${total}</span>${rateControl()}${match ? iconButton('pause',session.paused ? 'play' : 'pause',session.paused ? tx('继续') : tx('暂停')) : ''}</div>`;
  }
  function renderSession() {
    const session = currentSession();
    if (!session) { renderSetup(); return; }
    state.screen = 'session';
    if (session.phase === 'review-intro') { renderReviewIntro(session); return; }
    prefetchAhead(session);
    const activity = activityOf(session);
    if (activity === 'match') { renderMatch(session); return; }
    ensureQuestions(session);
    const item = activeItem();
    if (!item) { shell(sessionBar(session)+`<section class="pr-exercise-card pr-center-card"><h2>${tx('这个词已不在词表中')}</h2>${button('setup',tx('重新选择'),'','pr-primary pr-wide')}</section>`); return; }
    if (session.paused) { shell(sessionBar(session)+`<section class="pr-exercise-card pr-center-card"><h2>${tx('已暂停')}</h2>${button('resume',tx('继续练习'),'','pr-primary pr-wide')}</section>`); return; }
    if (activity === 'cards') renderCards(session,item); else renderQuestion(session,item);
  }
  function renderReviewIntro(session) {
    const count = new Set(session.reviewKeys).size;
    shell(`<section class="pr-exercise-card pr-center-card pr-round-intro"><span class="pr-round-count">${count}</span><h2>${tx('还有 {n} 个词没记住',{n:count})}</h2><p>${tx('再练一遍，直到全部答对。')}</p>${button('review-start',tx('开始重练'),'','pr-primary pr-wide')}${button('finish',tx('先看结果'),'','pr-quiet')}</section>`);
  }
  function favoriteKeys() { return (state.store.favorites || []).filter(key => state.words.has(key)); }
  function favoriteButton(key) {
    const favorite = (state.store.favorites || []).includes(key);
    return button('favorite',icon('star',favorite),`data-pr-key="${e(key)}" aria-pressed="${favorite}" aria-label="${favorite ? tx('取消收藏') : tx('收藏这个词')}" title="${favorite ? tx('取消收藏') : tx('收藏')}"`,'pr-icon-button pr-favorite-button');
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
      control.setAttribute('aria-label',favorite ? tx('取消收藏') : tx('收藏这个词'));
      control.title = favorite ? tx('取消收藏') : tx('收藏');
    });
  }
  function renderCards(session,item) {
    const key = currentKey(session), done = answered(session), points = answerMap(session)[key];
    const reverse = !!session.cardsReverse, showWord = reverse ? session.flipped : !session.flipped;
    const english = EN ? '' : String(item.english || item.englishGloss || '').trim();
    const meaning = `<span class="pr-flash-meaning">${e(item.meaning)}</span>${english ? `<span class="pr-flash-english" lang="en">${e(english)}</span>` : ''}`;
    const main = showWord ? `<span class="pr-flash-word" lang="nb">${e(item.word)}</span>${item.ipa ? `<span class="pr-flash-ipa">${e(item.ipa)}</span>` : ''}` : meaning;
    const sub = session.flipped ? (showWord ? `<span class="pr-flash-sub">${e(item.meaning)}${english ? `<span class="pr-flash-sub-english" lang="en">${e(english)}</span>` : ''}</span>` : `<span class="pr-flash-sub" lang="nb">${e(item.word)}</span>`) : '';
    const ratings = done ? `<div class="pr-rated"><span class="pr-rated-chip is-${points}">${e(RATINGS[points])}</span>${button('next',tx('下一张'),'','pr-primary')}</div>` : `<div class="pr-rating-buttons">${[[0,RATINGS[0],'pr-unknown'],[1,RATINGS[1],'pr-unsure'],[2,RATINGS[2],'pr-known']].map(([value,label,kind],index) => button('rate',`${label}<kbd>${index+1}</kbd>`,`data-pr-points="${value}"`,`pr-rating ${kind}`)).join('')}</div>`;
    shell(sessionBar(session)+`<section class="pr-exercise-card pr-cards-card"><button type="button" class="pr-flashcard${session.flipped ? ' is-flipped' : ''}${state.flipAnimation ? ' is-turning' : ''}" data-practice-action="flip" aria-label="${EN ? 'Flip card' : '翻面'}" aria-pressed="${session.flipped}">${main}${sub}<span class="pr-flip-mark" aria-hidden="true">${icon('turn')}</span></button><div class="pr-card-tools">${iconButton('previous','left',tx('上一张'),session.index && session.phase === 'first' ? '' : 'disabled')}${iconButton('replay','speaker',tx('朗读'))}${favoriteButton(key)}${iconButton('card-direction','swap',reverse ? tx('改为挪威语在正面') : tx('改为中文在正面'),`aria-pressed="${reverse}"`)}</div>${ratings}</section>`);
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
      // 拼写学习: every third word is a cloze (fill in the missing letters) — easier to recall than a whole word from
      // nothing, and the mix keeps the round from feeling the same. A missed cloze comes back as full spelling in review.
      if (activity === 'learn' && type === 'spell' && index % 3 === 1) {
        const gap=gapLetters(pool.get(key).word);
        if (gap) questions[key].gap=gap;
      }
    });
    return questions;
  }
  // Which letters of a word go missing in a cloze: about two in five, always æ ø å é (the letters learners trip on),
  // never the first letter (it anchors the word). Positions count code points of the NFC form; words under three
  // letters get no cloze.
  function gapLetters(word) {
    const chars=[...String(word || '').normalize('NFC')], letters=chars.map((char,index) => /\p{L}/u.test(char) ? index : -1).filter(index => index >= 0);
    if (letters.length < 3) return null;
    const want=Math.max(1,Math.min(letters.length-1,Math.round(letters.length*.4))), open=letters.slice(1);
    const special=open.filter(index => /[æøåé]/iu.test(chars[index]));
    return [...shuffled(special),...shuffled(open.filter(index => !special.includes(index)))].slice(0,want).sort((a,b) => a-b);
  }
  // A cloze is asked in the first round only, and only while its positions still fit the word (the word list can change
  // under a saved session).
  function gapOf(session,question,item) {
    const gap=question?.gap;
    if (!Array.isArray(gap) || !gap.length || session.phase === 'review' || !item) return null;
    const chars=[...String(item.word || '').normalize('NFC')];
    return gap.every(index => Number.isInteger(index) && /\p{L}/u.test(chars[index] || '')) ? gap : null;
  }
  const gapInput = value => [...String(value || '').normalize('NFC').toLocaleLowerCase('nb').replace(/[^\p{L}]/gu,'')];
  function questionDetails(session) { return session.phase === 'review' ? (session.reviewDetails ||= {}) : (session.details ||= {}); }
  function submitObjective(value,unknown=false) {
    const session=currentSession();
    if (!session || session.paused || !['first','review'].includes(session.phase) || answered(session) || !['learn','quiz','listen'].includes(activityOf(session))) return;
    const key=currentKey(session), item=activeItem(), question=session.questions?.[key];
    if (!item || !question) return;
    let correct=false, submitted=String(value ?? ''), matchedKey=key;
    const gap=question.type === 'spell' ? gapOf(session,question,item) : null;
    if (unknown) submitted='不知道';
    else if (gap) {
      // The typed letters go into the blanks in order; the whole word is then checked like a spelling.
      const letters=gapInput(submitted);
      if (letters.length < gap.length) { announce(tx('还有空没填，也可以选“不知道”。')); $('#pr-answer')?.focus?.(); return; }
      const chars=[...String(item.word).normalize('NFC')];
      gap.forEach((index,slot) => { chars[index]=letters[slot]; });
      submitted=chars.join(''); correct=spellingCorrect(item,submitted);
    } else if (question.type === 'spell') {
      if (!submitted.trim()) { announce(tx('先输入挪威语，也可以选“不知道”。')); $('#pr-answer')?.focus?.(); return; }
      const pool=sessionPool(session), accepted=(question.acceptableKeys || [key]).find(option => pool.has(option) && spellingCorrect(pool.get(option),submitted));
      correct=!!accepted; matchedKey=accepted || key;
    } else if (question.type === 'choice') {
      const option=question.options[Number(value)];
      if (!option) return;
      correct=option.key === key; submitted=option.text;
    } else if (question.type === 'judge') { if (!['true','false'].includes(submitted)) return; correct=(submitted === 'true') === question.truth; submitted=submitted === 'true' ? '正确' : '错误'; }
    const expected=question.type === 'judge' ? (question.truth ? '正确' : '错误') : question.direction === 'to-zh' ? item.meaning : item.word;
    grade(correct ? 2 : 0,{type:question.type,direction:question.direction,audio:!!question.audio,submitted:unknown ? '不知道' : submitted,expected,correct,unknown,prompt:question.direction === 'to-zh' ? item.word : item.meaning,proposed:question.proposed || '',choice:question.type === 'choice' ? Number(value) : null,...(matchedKey !== key ? {matchedKey} : {}),...(gap ? {gap:gap.slice()} : {})});
  }
  const touchScreen = () => !!window.matchMedia?.('(pointer: coarse)').matches;
  // A physical keyboard always types into the field, so desktops simply keep the on-screen layout.
  function keyboardMode() {
    return touchScreen() && state.store.keyboardChoice && state.store.keyboardMode === 'system' ? 'system' : 'screen';
  }
  function renderQuestion(session,item) {
    const activity=activityOf(session), key=currentKey(session), question=session.questions?.[key], done=answered(session), detail=questionDetails(session)[key];
    if (!question) { shell(sessionBar(session)+`<section class="pr-exercise-card pr-center-card"><h2>${tx('这道题暂时无法显示')}</h2>${button('setup',tx('重新选择'),'','pr-primary pr-wide')}</section>`); return; }
    const toZh=question.direction === 'to-zh', promptText=toZh ? item.word : item.meaning;
    let prompt;
    if (question.audio) prompt=`<button type="button" class="pr-listen-button" data-practice-action="replay" aria-label="${tx('播放读音')}">${icon('speaker')}</button>${done ? `<p class="pr-listen-reveal" lang="nb">${e(item.word)}</p>` : ''}`;
    else if (question.type === 'judge') prompt=`<div class="pr-judge"><span class="${toZh ? 'pr-prompt-word' : 'pr-prompt-text'}" ${toZh ? 'lang="nb"' : ''}>${e(promptText)}</span><span class="pr-judge-equals" aria-label="${tx('是否等于')}">=</span><span class="${toZh ? 'pr-prompt-text' : 'pr-prompt-word'}" ${toZh ? '' : 'lang="nb"'}>${e(question.proposed)}</span></div>`;
    else prompt=`<div class="pr-prompt-row"><h2 class="pr-prompt${toZh ? ' is-word' : ''}" ${toZh ? 'lang="nb"' : ''}>${e(promptText)}</h2>${toZh || activity === 'learn' ? iconButton('replay','speaker',toZh ? tx('朗读') : tx('听读音'),'','pr-prompt-speaker') : ''}</div>`;
    let answerUI='';
    const gap=question.type === 'spell' ? gapOf(session,question,item) : null;
    if (question.type === 'spell') {
      const mode=keyboardMode(), value=done ? (detail?.unknown ? '' : detail?.submitted || '') : session.inputDraft || '';
      // A cloze shows the word as letter tiles with blanks; the real field sits out of sight and holds only the letters
      // typed into the blanks, so the screen keyboard, a phone's own keyboard and a physical one all work as before.
      const field=gap
        ? `<label class="sr-only" for="pr-answer">${tx('填出空缺的 {n} 个字母',{n:gap.length})}</label><label class="pr-gap${done ? (detail?.correct ? ' is-correct' : ' is-wrong') : ''}" id="pr-gap" for="pr-answer" lang="nb" aria-hidden="true">${gapTiles(item,gap,done ? detail : null)}</label><input id="pr-answer" class="pr-gap-input" type="text" lang="nb" enterkeyhint="done" inputmode="${mode === 'system' || !touchScreen() ? 'text' : 'none'}" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="${gap.length}" value="${e(done ? '' : gapInput(value).slice(0,gap.length).join(''))}" ${done ? 'disabled' : ''}>`
        : `<label class="sr-only" for="pr-answer">${question.audio ? tx('写出听到的挪威语') : tx('输入挪威语')}</label><input id="pr-answer" class="pr-answer-input${done ? (detail?.correct ? ' is-correct' : ' is-wrong') : ''}" type="text" lang="nb" enterkeyhint="done" inputmode="${mode === 'system' || !touchScreen() ? 'text' : 'none'}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${question.audio ? tx('写出听到的词') : tx('输入挪威语')}" value="${e(value)}" ${done ? 'disabled' : ''}>`;
      answerUI=`<form class="pr-answer-form${gap ? ' is-gap' : ''}" id="pr-answer-form">${field}</form>${done ? '' : `<div class="pr-keyboard-wrap"><div id="pr-keyboard">${renderKeyboard()}</div>${touchScreen() ? iconButton('keyboard-mode','keyboard',mode === 'system' ? tx('显示屏幕键盘') : tx('使用手机键盘'),`aria-pressed="${mode === 'screen'}"`,'pr-keyboard-toggle') : ''}</div>`}`;
    } else if (question.type === 'choice') {
      answerUI=`<div class="pr-choice-grid${question.options.some(option => option.text.length > 14) ? ' is-long' : ''}">${question.options.map((option,index) => {
        const tone=done ? (option.key === key ? ' is-correct' : detail?.choice === index ? ' is-wrong' : ' is-dim') : '';
        return `<button type="button" class="pr-choice${tone}" data-practice-action="objective" data-pr-value="${index}" ${question.direction === 'to-nb' ? 'lang="nb"' : ''} ${done ? 'disabled' : ''}><kbd>${index+1}</kbd><span>${e(option.text)}</span></button>`;
      }).join('')}</div>`;
    } else {
      answerUI=`<div class="pr-choice-grid pr-judge-buttons">${[['true',tx('对'),'check'],['false',tx('错'),'cross']].map(([value,label,name],index) => {
        const chosen=detail?.submitted === (value === 'true' ? '正确' : '错误'), right=String(question.truth) === value;
        const tone=done ? (right ? ' is-correct' : chosen ? ' is-wrong' : ' is-dim') : '';
        return `<button type="button" class="pr-choice${tone}" data-practice-action="objective" data-pr-value="${value}" ${done ? 'disabled' : ''}><kbd>${index+1}</kbd>${icon(name)}<span>${label}</span></button>`;
      }).join('')}</div>`;
    }
    const footer=done ? answerPanel(session,item,question,detail) : `<div class="pr-question-footer">${button('unknown',tx('不知道'),'','pr-quiet')}${question.type === 'spell' ? `<button type="submit" form="pr-answer-form" id="pr-check-answer" class="pr-button pr-primary" ${session.inputDraft?.trim() ? '' : 'disabled'}>${tx('检查')}</button>` : ''}</div>`;
    shell(sessionBar(session)+`<section class="pr-exercise-card pr-question-card is-${question.type}${gap ? ' is-gap' : ''}${question.audio ? ' is-audio' : ''}"><div class="pr-card-corner">${favoriteButton(key)}</div>${prompt}${answerUI}${footer}</section>`);
    if (!done && gap) updateGap();
    if (!done && question.type === 'spell') $('#pr-answer')?.focus?.({preventScroll:true});
    if (done) state.root.querySelector('[data-practice-action="next"]')?.focus?.({preventScroll:true});
  }
  // The word as tiles: given letters as they are, blanks as slots. Answered, each blank shows the right letter, green
  // where it was typed right and red where it was not.
  function gapTiles(item,gap,detail) {
    const chars=[...String(item.word).normalize('NFC')], blanks=new Map(gap.map((index,slot) => [index,slot]));
    const typed=detail && !detail.unknown ? [...String(detail.submitted || '').normalize('NFC')] : [];
    return chars.map((char,index) => {
      if (!blanks.has(index)) return char === ' ' ? '<span class="pr-gap-space"></span>' : `<span class="pr-gap-char">${e(char)}</span>`;
      if (!detail) return `<span class="pr-gap-slot" data-slot="${blanks.get(index)}"></span>`;
      const right=(typed[index] || '').toLocaleLowerCase('nb') === char.toLocaleLowerCase('nb');
      return `<span class="pr-gap-slot is-shown ${right ? 'is-right' : 'is-miss'}">${e(char)}</span>`;
    }).join('');
  }
  // Fills the blanks from the hidden field and marks the next one.
  function updateGap() {
    const input=$('#pr-answer'), board=$('#pr-gap');
    if (!input || !board) return;
    const letters=gapInput(input.value), slots=[...board.querySelectorAll('.pr-gap-slot')];
    slots.forEach((slot,index) => {
      slot.textContent=letters[index] || '';
      slot.classList.toggle('is-filled',!!letters[index]);
      slot.classList.toggle('is-next',index === letters.length);
    });
  }
  function answerPanel(session,item,question,detail) {
    const correct=!!detail?.correct, run=correct ? consecutiveCorrect(session) : 0;
    const shown=(detail?.matchedKey && sessionPool(session).get(detail.matchedKey)) || item;
    // Answers restored from the old self-rated listening mode carry no details.
    const title=!detail ? tx('已记录') : correct ? (run >= 3 ? tx('连对 {n} 题',{n:run}) : tx('答对了')) : detail.unknown ? tx('记一下') : tx('答错了');
    return `<div class="pr-feedback is-${!detail ? 'neutral' : correct ? 'correct' : 'wrong'}" role="status" aria-live="polite"><span class="pr-feedback-mark" aria-hidden="true">${icon(correct ? 'check' : 'cross')}</span><div class="pr-feedback-copy"><strong>${title}</strong><p><button type="button" class="pr-feedback-word" data-practice-action="word-card" data-pr-key="${e(shown.key || item.key)}" lang="nb">${e(shown.word)}</button><span>${e(shown.meaning)}</span></p></div>${iconButton('replay','speaker',tx('再听一遍'),'','pr-feedback-replay')}${button('next',tx('继续'),'','pr-primary pr-next')}</div>`;
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
  function timeLabel(ms) { return tx('{n} 秒',{n:(Math.max(0,ms)/1000).toFixed(1)}); }
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
    const board=session.paused ? `<div class="pr-center-card pr-match-paused"><h2>${tx('已暂停')}</h2>${button('resume',tx('继续'),'','pr-primary pr-wide')}</div>` : `<div class="pr-match-board"><div class="pr-match-col">${match.tiles.filter(item => item.side === 'word').map(tile).join('')}</div><div class="pr-match-col">${match.tiles.filter(item => item.side === 'meaning').map(tile).join('')}</div></div>${match.roundDone ? `<div class="pr-match-next">${button('match-next',tx('下一组'),'','pr-primary pr-wide')}</div>` : ''}`;
    shell(sessionBar(session)+`<section class="pr-exercise-card pr-match-card"><div class="pr-match-head"><strong class="pr-timer" id="pr-match-time" role="timer" aria-label="${tx('用时')}">${timeLabel(matchTime(session))}</strong>${match.penaltyMs ? `<span class="pr-penalty">${tx('含加时 {time}',{time:timeLabel(match.penaltyMs)})}</span>` : ''}${best ? `<span class="pr-best">${tx('最佳 {time}',{time:timeLabel(best.timeMs)})}</span>` : ''}</div>${board}</section>`);
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
    const verbLabels = {infinitive:tx('原形'),present:tx('现在时'),past:tx('过去时'),pastParticiple:tx('过去分词')};
    const verbForms = item.verbForms && typeof item.verbForms === 'object' ? Object.entries(item.verbForms).map(([key,value]) => `${verbLabels[key] || key}${COLON}${plainValue(value)}`).join(SENSE) : plainValue(item.verbForms);
    const genders = {m:tx('阳性'),f:tx('阴性'),n:tx('中性'),'f/m':tx('阴性或阳性'),'m/f':tx('阳性或阴性'),'m/n':tx('阳性或中性'),'f/n':tx('阴性或中性')};
    const gender = plainValue(item.gender).split(EN ? /\s*[;；]\s*/ : '；').map(value => genders[value.trim()] || value).join(SENSE);
    const shown = value => readable(value) ? value : '';
    const facts = [
      [tx('词性'),dataText(item.pos || item.partOfSpeech)],[tx('音节'),plainValue(item.syllables)],[tx('性别 / 冠词'),unique([gender,plainValue(item.article)]).join(' · ')],
      [tx('变化形式'),shown(plainValue(item.formsExpanded || item.forms || item.inflections || item.conjugation))],[tx('动词变化'),shown(verbForms)],[tx('语法'),shown(plainValue(item.grammar))],
    ].filter(([,value]) => value);
    return facts.length ? `<dl class="pr-word-facts">${facts.map(([label,value]) => `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>` : '';
  }
  function openWordCard(key) {
    const item = state.words.get(key), dialog = $('#pr-card');
    if (!item || !dialog) return;
    const usage = unique([plainValue(item.usage),plainValue(item.note)]).filter(readable);
    const examples = unique([...(item.practiceTextExamples || []),...(item.practiceLearningExamples || [])].map(dropChineseGloss)).slice(0,3);
    const english = EN ? '' : String(item.english || item.englishGloss || '').trim();
    dialog.innerHTML = `<div class="pr-card-top"><span class="pr-card-handle" aria-hidden="true"></span>${iconButton('card-close','close',tx('关闭词卡'))}</div><div class="pr-card-word"><div class="pr-card-head"><h2 id="pr-card-title" lang="nb">${e(item.word)}</h2>${item.ipa ? `<span class="pr-card-ipa">${e(item.ipa)}</span>` : ''}</div>${button('result-word',icon('speaker'),`data-pr-key="${e(key)}" aria-label="${tx('朗读 {word}',{word:e(item.word)})}" title="${tx('朗读')}"`,'pr-icon-button')}</div>${item.meaning ? `<p class="pr-card-meaning${english ? ' has-english' : ''}"><span>${e(item.meaning)}</span>${english ? `<span class="pr-card-english" lang="en">${e(english)}</span>` : ''}</p>` : ''}${renderFacts(item)}${usage.length ? `<section class="pr-card-section">${usage.map(text => `<p>${e(text)}</p>`).join('')}</section>` : ''}${examples.length ? `<section class="pr-card-section">${examples.map(example => `<p class="pr-card-example" lang="nb">${e(example)}</p>`).join('')}</section>` : ''}<div class="pr-card-foot">${rateControl()}${favoriteButton(key)}</div>`;
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
    let beatRecord=false;
    if (result.activity === 'match') {
      result.timeMs=matchTime(session); result.penaltyMs=session.match.penaltyMs;
      const signature=matchSignature(session), best=state.store.matchBest?.[signature];
      result.newBest=!best || result.timeMs < best.timeMs; beatRecord=!!best && result.newBest;
      if (result.newBest) (state.store.matchBest ||= {})[signature]={timeMs:result.timeMs,finishedAt:result.finishedAt,total:result.total};
      result.bestMs=state.store.matchBest[signature].timeMs;
    }
    if (!state.store.history.some(item => item.id === result.id)) state.store.history.unshift(result);
    if (RANKED.includes(result.activity)) state.store.communityPending=unique([...(state.store.communityPending || []),result.id]);
    state.store.active = null; state.result = result; persist(); renderResult(result);
    if (effects.lastCompletedId !== result.id) {
      effects.lastCompletedId=result.id; showFeedback('complete');
      const summary=resultSummary(result);
      window.NorskCelebrate?.complete?.({ratio:firstTryRatio(result),newBest:beatRecord,score:Number(summary.score),decimals:result.activity === 'match' ? 1 : 0,anchor:$('.pr-results-hero')});
    }
    syncCommunity();
  }
  function syncCommunity() {
    const store=state.store, key=state.storageKey, submit=state.deps.submitPracticeResult;
    const owner=editor;
    if (!ownsStore(store,key)) return Promise.resolve(false);
    if (state.syncs.has(owner)) return state.syncs.get(owner);
    if (typeof submit !== 'function' || !store.communityPending?.length) return Promise.resolve(false);
    // A successful upload may arrive after another tab takes ownership. Its durable
    // server receipt can be retried, but the old tab must never overwrite the new owner.
    const sync=(async () => {
      while (store.communityPending.length) {
        const id=store.communityPending[0], result=store.history.find(item => item.id === id);
        if (result && RANKED.includes(activityOf(result))) {
          try { if (await submit(result) !== true) return false; }
          catch { return false; }
        }
        if (editor !== owner || !ownsStore(store,key)) return false;
        store.communityPending=store.communityPending.filter(item => item !== id);
        persistStore(store,key);
      }
      return true;
    })().finally(() => { if (state.syncs.get(owner) === sync) state.syncs.delete(owner); if (state.communitySync === sync) state.communitySync=null; });
    state.syncs.set(owner,sync); state.communitySync=sync;
    return sync;
  }
  function dateLabel(date) {
    try { return EN ? new Date(date).toLocaleString('en-GB',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : new Date(date).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
    catch { return ''; }
  }
  // Share of first answers that were right (self-rated cards use their score).
  function firstTryRatio(result) {
    if (!result.total) return 0;
    return isObjective(result) ? result.answers.filter(answer => answer.points === 2).length/result.total : scoreOf(result)/100;
  }
  function resultSummary(result) {
    const activity=activityOf(result), correct=result.answers.filter(answer => answer.points === 2).length;
    if (activity === 'match') return {score:(result.timeMs/1000).toFixed(1),unit:tx('秒'),headline:result.newBest ? tx('新纪录！') : tx('全部配对完成'),note:tx('一次配对成功 {done} / {n}',{done:correct,n:result.total})};
    if (isObjective(result)) return {score:scoreOf(result),unit:'%',headline:tx('答对 {done} / {n}',{done:correct,n:result.total}),note:result.reviewed ? tx('重练 {n} 词，全部答对',{n:result.reviewed}) : ''};
    const counts=[2,1,0].map(points => result.answers.filter(answer => answer.points === points).length);
    return {score:scoreOf(result),unit:tx('分'),headline:tx('认识 {known} · 模糊 {unsure} · 不认识 {unknown}',{known:counts[0],unsure:counts[1],unknown:counts[2]}),note:result.reviewed ? tx('重练 {n} 词',{n:result.reviewed}) : ''};
  }
  function renderResult(result,fromHistory=false) {
    state.screen = 'results'; state.result = result;
    const activity=activityOf(result), objective=isObjective(result), summary=resultSummary(result);
    const weak=result.answers.filter(answer => answer.points < 2 && state.words.has(answer.key));
    // Draw the orders behind 再练一次 and 练错词 now, so either starts with its first word loaded.
    prepareOrder(result.sources || [],result.customKeys || null,result.mode || state.mode,activity);
    if (weak.length) prepareOrder([],result.answers.filter(answer => answer.points < 2).map(answer => answer.key),'weak',reviewActivity(activity));
    const rows=[...result.answers].sort((a,b) => a.points-b.points).map(answer => {
      const detail=answer.detail, mark=answer.points === 2 ? 'is-right' : answer.points === 1 ? 'is-unsure' : 'is-wrong';
      const label=objective ? (answer.points === 2 ? icon('check') : icon('cross')) : e(RATINGS[answer.points]);
      const mine=objective && answer.points < 2 && detail && activity !== 'match' && !detail.unknown && detail.type !== 'judge' ? `<small>${tx('你答 {answer}',{answer:e(detail.submitted)})}</small>` : objective && detail?.errors ? `<small>${tx('错配 {n} 次',{n:detail.errors})}</small>` : '';
      return `<div class="pr-result-word ${mark}">${state.words.has(answer.key) ? button('result-word',icon('speaker'),`data-pr-key="${e(answer.key)}" aria-label="${tx('朗读 {word}',{word:e(answer.word)})}"`,'pr-icon-button') : '<span></span>'}<button type="button" class="pr-result-main" data-practice-action="word-card" data-pr-key="${e(answer.key)}" ${state.words.has(answer.key) ? '' : 'disabled'}><strong lang="nb">${e(answer.word)}</strong><span>${e(answer.meaning)}</span>${mine}</button><span class="pr-result-mark" ${objective ? `aria-label="${answer.points === 2 ? tx('正确') : tx('错误')}"` : ''}>${label}</span></div>`;
    }).join('');
    shell(`<section class="pr-results-hero"><div class="pr-score"><strong>${summary.score}</strong><span>${summary.unit}</span></div><div class="pr-results-copy"><h2>${e(summary.headline)}</h2><p>${e(ACTIVITIES[activity].title)} · ${e(result.label)}${fromHistory ? ` · ${e(dateLabel(result.finishedAt))}` : ''}</p>${summary.note ? `<p>${e(summary.note)}</p>` : ''}</div></section><div class="pr-result-actions">${button('result-again',activity === 'match' ? tx('再玩一次') : tx('再练一次'),'','pr-primary')}${weak.length ? button('result-weak',tx('练错词 {n}',{n:weak.length}),'','pr-secondary') : ''}${button(fromHistory ? 'history' : 'setup',tx('返回'),'','pr-quiet')}</div><section class="pr-result-list" aria-label="${tx('答题回顾')}">${rows}</section>`);
  }
  function renderHistory() {
    state.screen = 'history';
    const history = state.store.history;
    shell(`<div class="pr-history-page"><div class="pr-page-head"><h2>${tx('学习记录')}</h2>${history.length ? button('export',tx('导出'),'','pr-quiet') : ''}${button('setup',tx('返回'),'','pr-secondary')}</div>${historyStats()}${history.length ? `<div class="pr-history-list">${history.map(result => historyEntry(result)).join('')}</div>` : `<section class="pr-empty"><h3>${tx('还没有练习记录')}</h3><p>${tx('完成一组练习后会出现在这里。')}</p></section>`}</div>`);
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
      confirmDialog(tx('先休息一下？'),tx('进度已保存，回来后可以继续。'),[
        {action:'confirm-run',text:tx('保存并离开'),primary:true,run:go},
        {action:'confirm-resume',text:tx('继续练习')},
      ]);
    } else { stopAudio(); go(); }
  }
  function resume() {
    if (!requireEditor()) return;
    const session = currentSession();
    if (!session) return;
    closeDialogs(); session.paused = false; persist(); renderSession(); autoPlay(session); if (activityOf(session) === 'match') startMatchClock();
  }
  function saveSet() {
    if (!state.selected.size) { announce(tx('请先选择练习范围。')); return; }
    const name = $('#pr-set-name').value.trim();
    if (!name) { $('#pr-set-name').focus(); announce(tx('给这组范围起个名字，就可以随时重练。')); return; }
    state.mode = ($('#pr-order')?.value || state.mode) === 'weak' ? 'weak' : 'random';
    const config = {sources:[...state.selected],mode:state.mode,activity:state.activity,quiz:quizConfig(state.quiz)};
    const existing = state.store.sets.find(item => item.name === name);
    const save = () => {
      if (existing) Object.assign(existing,config,{updatedAt:now()});
      else state.store.sets.unshift({id:uid(),name,...config,createdAt:now()});
      state.store.draft=config; persist(); renderSetup(); renderScope(); announce(tx('练习范围已保存。'));
    };
    if (existing) confirmDialog(tx('更新同名范围？'),tx('“{name}”已存在，将改为当前范围。',{name}),[{action:'confirm-run',text:tx('更新'),primary:true,run:save},{action:'confirm-close',text:tx('取消')}]);
    else save();
  }
  function reviewKeys(keys,label,activity='learn',quiz=state.quiz) {
    if (!keys.length) { announce(tx('目前没有需要复习的薄弱词，先完成一组练习吧。')); return; }
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
      announce(tx('学习记录已导出，请保留下载的备份文件。'));
    } catch { announce(tx('记录导出失败，请稍后重试。')); }
  }
  // During a session Back first asks, with the same prompt as the × button; elsewhere it leaves as usual.
  function syncBackLayer() {
    if (state.visible && state.screen === 'session' && currentSession()) state.deps.openLayer?.('practice',() => { if (state.visible && state.screen === 'session') exitPrompt(); });
    else state.deps.closeLayer?.('practice');
  }
  function exitPrompt() {
    if (!currentSession()) return;
    confirmDialog(tx('离开这次练习？'),tx('进度会保存，下次从这里继续。'),[
      {action:'confirm-run',text:tx('保存并退出'),primary:true,run:renderSetup},
      {action:'confirm-resume',text:tx('继续练习')},
      {action:'discard',text:tx('放弃本次进度'),danger:true},
    ]);
  }
  function onClick(event) {
    const requested=event.target.closest('[data-practice-action]')?.dataset.practiceAction;
    if (requested === 'takeover') { acquireEditor(true); return; }
    if (!canEdit() && (requested || event.target.closest('[data-pr-activity]')) && !['setup','history','export','history-detail','word-card','card-close','result-word','honors','duel','online','online-close','chase','kitchen','mall','series','wordbook-open','scope-tab','language','quests','quests-close','quest-go'].includes(requested)) { requireEditor(); return; }
    if (state.initialized && state.visible && state.root?.contains(event.target)) unlockFeedbackAudio(event);
    const modeTarget = event.target.closest('[data-pr-activity]');
    if (modeTarget && state.initialized && state.root?.contains(modeTarget) && ACTIVITIES[modeTarget.dataset.prActivity]) { openActivity(modeTarget.dataset.prActivity); return; }
    const target = event.target.closest('[data-practice-action]');
    if (!target || !state.initialized) return;
    const action = target.dataset.practiceAction;
    const session = currentSession();
    const id = target.dataset.prId;
    switch (action) {
      case 'setup': navigate('setup'); break;
      case 'online': openOnline(); break;
      case 'language': L10N.set(EN ? 'zh' : 'en'); break;
      case 'online-close': $('#pr-online')?.close(); break;
      case 'duel': $('#pr-online')?.close(); state.deps.openDuel?.(); break;
      case 'chase': $('#pr-online')?.close(); state.deps.openChase?.(); break;
      case 'kitchen': $('#pr-online')?.close(); state.deps.openKitchen?.(); break;
      case 'mall': $('#pr-online')?.close(); state.deps.openMall?.(); break;
      case 'quests': openQuests(); break;
      case 'quests-close': $('#pr-quests')?.close(); break;
      case 'quest-go': goQuest(Number(target.dataset.prQuest)); break;
      case 'honors': $('#pr-quests')?.close(); state.deps.openHonors?.(); break;
      case 'history': navigate('history'); break;
      case 'export': exportRecords(); break;
      case 'weak': reviewKeys(weakKeys(),tx('薄弱词复习'),state.activity,state.quiz); break;
      case 'favorites': { const keys=favoriteKeys(); if (!keys.length) { announce(tx('先在练习中点星标收藏词语，就能在这里复习。')); break; } startSession({sources:[],mode:state.mode,activity:state.activity,quiz:state.quiz},keys,tx('收藏词语')); break; }
      case 'favorite': toggleFavorite(target.dataset.prKey || (session && currentKey(session))); break;
      case 'scope-open': renderScope(); break;
      case 'scope-close': $('#pr-scope')?.close?.(); break;
      case 'series': if (target.dataset.prSeries !== state.seriesId) { state.reopenActivity=state.activity; state.deps.selectSeries?.(target.dataset.prSeries); } break;
      case 'scope-tab': state.scopeTab=['basics','wordbook','kitchen','mall'].includes(target.dataset.prTab) ? target.dataset.prTab : 'chapters'; renderScope(); break;
      case 'wordbook-open': $('#pr-scope')?.close?.(); state.deps.openWordbook?.(); break;
      case 'clear-selection': state.selected.clear(); updateSelectionUI(); break;
      case 'save-set': saveSet(); break;
      case 'saved-load': { const set = state.store.sets.find(item => item.id === id); if (set) loadScope(set); break; }
      case 'recent-load': { const config = state.store.recent[Number(target.dataset.prIndex)]; if (config) loadScope(config); break; }
      case 'saved-start': { const set = state.store.sets.find(item => item.id === id); if (set) startSession(set); break; }
      case 'saved-delete': {
        const set = state.store.sets.find(item => item.id === id);
        if (set) confirmDialog(tx('删除这个常用范围？'),set.name,[{action:'confirm-run',text:tx('删除'),primary:true,run:() => { state.store.sets=state.store.sets.filter(item => item.id !== id); persist(); renderSetup(); renderScope(); }},{action:'confirm-close',text:tx('保留')}]);
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
      case 'result-weak': if (state.result) reviewKeys(state.result.answers.filter(answer => answer.points < 2).map(answer => answer.key),tx('错词重练'),reviewActivity(activityOf(state.result)),state.result.quiz); break;
      case 'result-again': if (state.result) startSession({sources:state.result.sources,mode:state.result.mode,activity:activityOf(state.result),quiz:state.result.quiz},state.result.customKeys || null,state.result.label); break;
      case 'result-word': { const word=state.words.get(target.dataset.prKey); stopAudio(); if (word) Promise.resolve().then(() => state.deps.pronounce?.(word)).catch(() => announce(tx('读音暂时无法播放，请稍后重试。'))); break; }
      case 'history-detail': { const result=state.store.history.find(item => item.id === id); if (result) renderResult(result,true); break; }
      case 'history-weak': { const result=state.store.history.find(item => item.id === id); if (result) reviewKeys(result.answers.filter(answer => answer.points < 2).map(answer => answer.key),tx('{date} · 错词重练',{date:dateLabel(result.finishedAt)}),reviewActivity(activityOf(result)),result.quiz); break; }
    }
  }
  function onChange(event) {
    if (!canEdit()) return;
    const input = event.target;
    if (!state.root?.contains(input)) return;
    if (input.dataset.prChapter) {
      const chapter = state.chapters.find(item => item.token === input.dataset.prChapter);
      if (!chapter) return;
      chapter.sections.forEach(section => state.selected.delete(section.token));
      if (input.checked) state.selected.add(chapter.token); else state.selected.delete(chapter.token);
      updateSelectionUI();
    } else if (input.dataset.prWordbookAll) {
      for (const chapter of state.mine) if (chapter.words.length) { if (input.checked) state.selected.add(chapter.token); else state.selected.delete(chapter.token); }
      updateSelectionUI();
    } else if (input.dataset.prSource) {
      const token = input.dataset.prSource;
      const chapter = state.chapters.find(item => item.sections.some(section => section.token === token));
      if (chapter && state.selected.has(chapter.token)) {
        state.selected.delete(chapter.token);
        chapter.sections.forEach(section => { if (section.token !== token) state.selected.add(section.token); });
      } else if (input.checked) state.selected.add(token); else state.selected.delete(token);
      updateSelectionUI();
    } else if (input.id === 'pr-order') { state.mode=input.value === 'weak' ? 'weak' : 'random'; draft(); prepareScopeOrders(); }
    else if (input.dataset.prQuizType) {
      const type=input.dataset.prQuizType, types=state.quiz.types;
      if (!QUIZ_TYPES.includes(type)) return;
      if (!input.checked && types.length === 1 && types.includes(type)) { input.checked=true; announce(tx('至少保留一种题型。')); return; }
      state.quiz.types=input.checked ? unique([...types,type]) : types.filter(item => item !== type); draft();
    } else if (input.id === 'pr-quiz-direction') { state.quiz=quizConfig({...state.quiz,direction:input.value}); draft(); }
  }
  function onInput(event) {
    if (!canEdit()) return;
    if (!state.root?.contains(event.target)) return;
    if (event.target.id === 'pr-source-search') { state.scopeQuery=event.target.value; filterScope(); }
    if (event.target.id === 'pr-answer') {
      const session=currentSession();
      if (session && !session.paused && !answered(session)) {
        // A cloze field keeps letters only, no more than there are blanks.
        if (event.target.classList?.contains('pr-gap-input')) {
          const clean=gapInput(event.target.value).slice(0,Number(event.target.maxLength) || undefined).join('');
          if (clean !== event.target.value) event.target.value=clean;
        }
        session.inputDraft=event.target.value; saveInputDraft(); updateAnswerButton();
      }
    }
  }
  function onSubmit(event) {
    if (!canEdit()) { if (event.target.id === 'pr-answer-form') event.preventDefault(); return; }
    if (event.target.id !== 'pr-answer-form' || !state.root?.contains(event.target)) return;
    event.preventDefault(); unlockFeedbackAudio(event); submitObjective($('#pr-answer')?.value || '');
  }
  function renderKeyboard() {
    const accents=['æ','ø','å','é'];
    if (keyboardMode() === 'system') return `<div class="pr-keyboard-row pr-keyboard-accents">${accents.map(letter => button('letter',letter,`data-pr-letter="${letter}"`,'pr-key')).join('')}</div>`;
    const symbols=state.keyboardPage === 'symbols';
    // Same places as a Norwegian keyboard: Å right of P, Ø and Æ right of L.
    const rows=symbols ? ['1234567890'.split(''),['.',',','?','!','-',"'",':','/'],['(',')','+','%','&','backspace']] : ['qwertyuiopå'.split(''),'asdfghjkløæ'.split(''),[...'zxcvbnmé','backspace']];
    const key = letter => button('letter',letter === 'backspace' ? '⌫' : e(letter),`data-pr-letter="${e(letter)}"${letter === 'backspace' ? ` aria-label="${tx('退格')}"` : ''}`,'pr-key'+(letter === 'backspace' ? ' pr-key-wide' : ''));
    return `<div class="pr-keyboard${symbols ? ' is-symbols' : ''}" role="group" aria-label="${tx('挪威语屏幕键盘')}">${rows.map(row => `<div class="pr-keyboard-row">${row.map(key).join('')}</div>`).join('')}<div class="pr-keyboard-row">${button('keyboard-page',symbols ? 'ABC' : '123','aria-label="'+(symbols ? tx('切换字母键盘') : tx('切换数字和符号'))+'"','pr-key pr-key-wide')}${button('letter',tx('空格'),`data-pr-letter=" " aria-label="${tx('空格')}"`,'pr-key pr-key-space')}${button('letter','-','data-pr-letter="-"','pr-key')}</div></div>`;
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
    const cloze=input?.classList?.contains('pr-gap-input');
    if (cloze) updateGap();
    if (check) check.disabled=cloze ? gapInput(input.value).length < input.maxLength : !input?.value.trim();
  }
  function insertLetter(letter) {
    const session=currentSession(), input=$('#pr-answer');
    if (!session || session.paused || answered(session) || !input || session.questions?.[currentKey(session)]?.type !== 'spell') return;
    if (letter !== 'backspace' && !/^[a-zæøåé0-9 .,?!\-':/()+%&]$/.test(letter)) return;
    // A cloze takes letters only, one per blank, always at the end (backspace empties the last filled blank).
    if (input.classList?.contains('pr-gap-input')) {
      const letters=gapInput(input.value);
      if (letter === 'backspace') letters.pop();
      else if (/^\p{L}$/u.test(letter) && letters.length < input.maxLength) letters.push(letter);
      else return;
      input.value=letters.join('');
      input.focus?.({preventScroll:true}); input.setSelectionRange?.(input.value.length,input.value.length);
      session.inputDraft=input.value; saveInputDraft(); updateAnswerButton();
      return;
    }
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
    session.inputDraft=input.value; saveInputDraft(); updateAnswerButton();
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
    if (!canEdit()) return;
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
    if (checkedQuestions.has(session)) return;
    const activity=activityOf(session);
    if (!['learn','quiz','listen'].includes(activity)) return;
    session.questions ||= {};
    const broken=session.firstKeys.filter(key => { const question=session.questions[key]; return !question || (question.options && question.options.some(option => !pool.has(option.key))) || (question.proposedKey && !pool.has(question.proposedKey)); });
    if (broken.length) {
      const generated=makeQuestions(pool,session.firstKeys,activity,session.quiz);
      for (const key of broken) session.questions[key]=generated[key];
    }
    checkedQuestions.add(session);
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
      releaseEditor();
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
      document.addEventListener('pointerdown',event => {
        if (event.button !== 0 || !state.visible || !state.root?.contains(event.target)) return;
        unlockFeedbackAudio(event);
        if (event.target.closest('[data-pr-letter]')) event.preventDefault();
        // Word buttons in results and word cards start loading their recording before the click lands.
        const keyed = event.target.closest('[data-pr-key]');
        if (keyed && state.words.has(keyed.dataset.prKey)) state.deps.prefetch?.([state.words.get(keyed.dataset.prKey)]);
      });
      window.addEventListener('online',syncCommunity);
      window.addEventListener('storage',event => {
        if (event.key === EDITOR_REQUEST+state.storageKey && editor?.status === 'owned') {
          releaseEditor(); renderSetup();
        }
      });
      window.addEventListener('beforeunload',() => { stopFeedback(); if (currentSession()) { stopMatchClock(); currentSession().paused=true; persist(); } });
      window.addEventListener('pagehide',releaseEditor);
      window.addEventListener('pageshow',() => { if (editor?.status === 'readonly') acquireEditor(); });
      document.addEventListener('visibilitychange',() => {
        if (!document.hidden) return;
        stopFeedback(); releaseFeedbackAudio();
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
    renderSetup(); acquireEditor(); syncCommunity();
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
    syncBackLayer();
    // The 联机游戏 sheet does not stay open over another view.
    if ($('#pr-online')?.open) $('#pr-online').close();
    if ($('#pr-quests')?.open) $('#pr-quests').close();
    if (state.prepareTimer != null) clearTimeout(state.prepareTimer);
    state.prepareTimer=null;
    if (currentSession()) pause(); else stopAudio();
    applyPendingWordbook();
  }
  window.NorskPractice = {init,show,hide,renderTOC};
  Object.assign(window.NorskPractice,{duelSources,refreshWordbook,refreshHonors:() => loadHonors(true)});
  window.dispatchEvent(new Event('norskpracticeready'));
})();
