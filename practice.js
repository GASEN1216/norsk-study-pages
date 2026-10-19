/* Norwegian listening practice. All progress stays in this browser. */
(() => {
  'use strict';
  const STORAGE_KEY = 'norsk-practice-v1';
  const RATINGS = {2:'想起了',1:'有点模糊',0:'未记住'};
  const normalize = word => String(word || '').normalize('NFC').trim().toLocaleLowerCase('nb');
  const unique = values => [...new Set(values.filter(Boolean))];
  const blankStore = () => ({version:1,sets:[],recent:[],stats:{},history:[],active:null,draft:null});
  const state = {root:null,deps:{},sources:new Map(),chapters:[],basics:[],words:new Map(),selected:new Set(),limit:20,mode:'random',store:blankStore(),screen:'setup',result:null,storageError:'',initialized:false,visible:false,pending:null,playToken:0};
  const $ = selector => state.root?.querySelector(selector);
  const e = value => (state.deps.escapeHTML || (text => String(text ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))))(value);
  const button = (action,text,extra='',kind='') => `<button type="button" class="pr-button ${kind}" data-practice-action="${action}" ${extra}>${text}</button>`;
  const now = () => new Date().toISOString();
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
      return {...blankStore(),...value,recent:Array.isArray(value.recent) ? value.recent : []};
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
  function stopAudio() { ++state.playToken; state.deps.stopAudio?.(); }
  function draft() {
    state.store.draft = {sources:[...state.selected],limit:state.limit,mode:state.mode};
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
  function selectKeys(pool,limit,mode) {
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
    return keys.slice(0,Math.max(1,Math.min(pool.size,Math.floor(Number(limit) || 20))));
  }
  function applyConfig(config) {
    state.selected = new Set((config.sources || []).filter(token => state.sources.has(token)));
    state.limit = Math.max(1,Math.floor(Number(config.limit) || 20));
    state.mode = config.mode === 'weak' ? 'weak' : 'random';
  }
  function renderTOC() {
    return `<div class="pr-sidebar"><p class="pr-sidebar-label">每天听一点，慢慢记牢。</p>${button('setup','选择练习范围','','pr-side-button')}${button('history','学习记录','','pr-side-button')}${button('weak',`复习薄弱词 <span data-practice-stat="weak">${weakKeys().length}</span>`,'','pr-side-button')}<div class="pr-sidebar-stats"><span><strong data-practice-stat="practiced">${Object.keys(state.store.stats).length}</strong>已练词语</span><span><strong data-practice-stat="sessions">${state.store.history.length}</strong>完成次数</span></div><p class="pr-local-note">学习进度保存在此浏览器中。</p></div>`;
  }
  function syncSidebar() {
    const values = {weak:weakKeys().length,practiced:Object.keys(state.store.stats).length,sessions:state.store.history.length};
    document.querySelectorAll('[data-practice-stat]').forEach(node => { node.textContent = values[node.dataset.practiceStat] ?? ''; });
  }
  function shell(content) {
    state.root.innerHTML = `<div class="pr-app"><p id="pr-storage-warning" class="pr-storage-warning" role="status" ${state.storageError ? '' : 'hidden'}>${e(state.storageError)}</p>${content}</div><dialog class="pr-dialog pr-card-dialog" id="pr-card" aria-labelledby="pr-card-title"></dialog><dialog class="pr-dialog pr-confirm-dialog" id="pr-confirm" aria-labelledby="pr-confirm-title"></dialog>`;
    $('#pr-card').addEventListener('cancel',() => { if (currentSession()) currentSession().cardOpen = false; });
    $('#pr-confirm').addEventListener('cancel',event => { event.preventDefault(); state.pending = null; $('#pr-confirm').close(); if (state.screen === 'session') renderSession(); });
  }
  function sourceCheckbox(source,checked=false) {
    return `<label class="pr-source-row"><input type="checkbox" data-pr-source="${e(source.token)}" ${checked ? 'checked' : ''}><span><span class="pr-source-title">${e(source.label)}</span></span><small>${source.words.length} 词</small></label>`;
  }
  function savedGroups() {
    const saved = state.store.sets;
    const recent = state.store.recent;
    if (!saved.length && !recent.length) return '';
    return `<section class="pr-panel pr-combinations"><div class="pr-panel-heading"><h2>常练的组合</h2><span>选好后，一键开始</span></div>${saved.length ? `<div class="pr-combo-grid">${saved.map(set => `<article class="pr-combo"><strong>${e(set.name)}</strong><p>${e(selectedLabel(set.sources))}</p><div>${button('saved-start','开始这组',`data-pr-id="${e(set.id)}"`,'pr-small')}${button('saved-load','选用',`data-pr-id="${e(set.id)}"`,'pr-small pr-quiet')}${button('saved-delete','删除',`data-pr-id="${e(set.id)}" aria-label="删除组合 ${e(set.name)}"`,'pr-small pr-quiet')}</div></article>`).join('')}</div>` : ''}${recent.length ? `<details class="pr-recent"><summary>最近 ${recent.length} 个组合</summary><div class="pr-recent-list">${recent.map((entry,index) => `<div><span>${e(entry.label || selectedLabel(entry.sources))}<small>${entry.limit} 词 · ${entry.mode === 'weak' ? '优先薄弱' : '随机'}</small></span>${button('recent-start','再练一次',`data-pr-index="${index}"`,'pr-small')}</div>`).join('')}</div></details>` : ''}</section>`;
  }
  function renderSetup() {
    state.screen = 'setup';
    const pool = poolFor(state.selected);
    const active = currentSession();
    shell(`${active ? `<section class="pr-resume-banner"><div><strong>上次练习还在这里</strong><p>${e(active.label)} · 已完成 ${Object.keys(active.answers).length} / ${active.firstKeys.length} 词</p></div>${button('resume','继续练习','','pr-primary')}</section>` : ''}<div class="pr-intro"><div><p class="pr-kicker">LYTT & HUSK · 听音记词</p><h2>把听到的词，变成记住的词。</h2><p>先听读音，再判断自己是否想起意思。每次只专注一个词。</p></div><div class="pr-intro-mark" aria-hidden="true">ø</div></div><section class="pr-panel"><div class="pr-panel-heading"><h2>自由选择练习范围</h2>${button('clear-selection','清空选择','','pr-small pr-quiet')}</div><p class="pr-help">可以组合不同章节与常识。整章包含完整章词表；选择小节时，只练该小节的词。</p><div class="pr-source-tabs" role="group" aria-label="选择来源">${button('expand-chapters','展开教材目录','','pr-small')}${button('expand-basics','展开常识目录','','pr-small')}</div><div class="pr-source-columns"><section><h3>教材词汇</h3><div class="pr-chapter-list">${state.chapters.map(chapter => `<details class="pr-source-chapter" ${state.selected.has(chapter.token) || chapter.sections.some(section => state.selected.has(section.token)) ? 'open' : ''}><summary><span>第 ${e(chapter.id)} 章 · ${e(chapter.title)}</span><small>${chapter.words.length} 词</small></summary><label class="pr-source-row pr-whole-chapter"><input type="checkbox" data-pr-chapter="${e(chapter.token)}" ${state.selected.has(chapter.token) ? 'checked' : ''}><span>选择整章</span><small>${chapter.words.length} 词</small></label>${chapter.sections.map(section => sourceCheckbox(section,state.selected.has(chapter.token) || state.selected.has(section.token))).join('')}</details>`).join('') || '<p class="pr-help">教材词表暂未载入。</p>'}</div></section><section><h3>基础常识</h3><div id="pr-basic-sources">${state.basics.map(category => sourceCheckbox(category,state.selected.has(category.token))).join('') || '<p class="pr-help">基础常识暂未载入。</p>'}</div></section></div><div class="pr-selection-bar"><span>已选 <strong id="pr-source-count">${state.selected.size}</strong> 组，去重后 <strong id="pr-pool-count">${pool.size}</strong> 词</span><span id="pr-selection-label">${e(selectedLabel([...state.selected]))}</span></div><div class="pr-settings"><label>每次词数<input id="pr-limit" type="number" min="1" max="${Math.max(1,pool.size)}" value="${Math.min(state.limit,Math.max(1,pool.size))}" inputmode="numeric"></label><label>出题顺序<select id="pr-order"><option value="random" ${state.mode === 'random' ? 'selected' : ''}>随机抽词</option><option value="weak" ${state.mode === 'weak' ? 'selected' : ''}>优先薄弱词</option></select></label>${button('start',`开始听音练习 <span id="pr-start-count">${Math.min(state.limit,pool.size)}</span> 词`,'id="pr-start" '+(pool.size ? '' : 'disabled'),'pr-primary')}</div><div class="pr-save-combo"><label class="sr-only" for="pr-set-name">组合名称</label><input id="pr-set-name" type="text" maxlength="40" placeholder="给这组取个名字，如 1.4 + 2.4">${button('save-set','保存选题组合','','pr-small')}</div></section>${savedGroups()}<section class="pr-score-guide"><h3>怎样自评</h3><p><span>认识 / 想起了 <strong>2 分</strong></span><span>有点模糊 <strong>1 分</strong></span><span>不认识 / 未记住 <strong>0 分</strong></span></p><p>按第一次听到时的记忆自评。薄弱词会在最后再听一遍，回顾不改变首答分数。</p></section><div class="pr-setup-footer">${button('history','查看本机学习记录','','pr-quiet')}${button('weak',`复习薄弱词（${weakKeys().length}）`,'','pr-quiet')}</div>`);
    updateSelectionUI(false);
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
    $('#pr-source-count').textContent = state.selected.size;
    $('#pr-pool-count').textContent = pool.size;
    $('#pr-selection-label').textContent = selectedLabel([...state.selected]);
    $('#pr-limit').max = Math.max(1,pool.size);
    $('#pr-limit').value = Math.min(state.limit,Math.max(1,pool.size));
    $('#pr-start-count').textContent = Math.min(state.limit,pool.size);
    $('#pr-start').disabled = !pool.size;
    if (save) draft();
  }
  function rememberConfig(config,label) {
    const signature = JSON.stringify([config.sources.slice().sort(),config.limit,config.mode]);
    state.store.recent = [{...config,label,usedAt:now(),signature},...state.store.recent.filter(item => item.signature !== signature)].slice(0,6);
  }
  function startSession(config={},customKeys=null,label='') {
    const begin = () => {
      closeDialogs(); stopAudio();
      const sources = config.sources || [...state.selected];
      const pool = customKeys ? new Map(unique(customKeys).filter(key => state.words.has(key)).map(key => [key,state.words.get(key)])) : poolFor(sources);
      if (!pool.size) { announce('这组目前没有可练习的词，请重新选择范围。'); return; }
      const limit = Math.max(1,Math.min(pool.size,Number(config.limit) || state.limit));
      const mode = config.mode || state.mode;
      const firstKeys = selectKeys(pool,limit,mode);
      const session = {id:uid(),startedAt:now(),sources,label:label || selectedLabel(sources),mode,firstKeys,customKeys:customKeys ? [...pool.keys()] : null,reviewKeys:[],reviewAnswers:{},phase:'first',index:0,answers:{},paused:false,cardOpen:false};
      state.store.active = session;
      if (!customKeys) { applyConfig({sources,limit,mode}); rememberConfig({sources,limit,mode},session.label); state.store.draft={sources,limit,mode}; }
      persist(); renderSession(); playCurrent();
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
    stopAudio();
    const token = state.playToken;
    try {
      if (!state.deps.pronounce) { announce('读音服务暂未准备好，请刷新页面后重试。'); return; }
      await state.deps.pronounce(item);
    } catch { if (token === state.playToken) announce('这条读音暂时无法播放，可以重播或查看词卡。'); }
  }
  function pause() {
    if (!currentSession()) return;
    stopAudio(); currentSession().paused = true; currentSession().cardOpen = false;
    closeDialogs(); persist();
  }
  function renderSession() {
    const session = currentSession();
    if (!session) { renderSetup(); return; }
    state.screen = 'session';
    if (session.phase === 'review-intro') {
      shell(`<section class="pr-round-intro pr-panel"><p class="pr-kicker">再听一遍</p><h2>给薄弱词，再一次相遇。</h2><p>首轮已经完成，接下来回顾 ${session.reviewKeys.length} 个没记牢的词。</p><p class="pr-help">回顾不改变这次的首答分数。</p><div class="pr-action-row">${button('review-start','开始回顾','','pr-primary')}${button('finish','直接看结果','','pr-quiet')}</div></section>`);
      return;
    }
    const keys = currentKeys(session);
    const done = answered(session);
    const progress = Math.round((session.index + (done ? 1 : 0)) / Math.max(1,keys.length) * 100);
    shell(`<div class="pr-session-top"><div><span class="pr-kicker">${session.phase === 'review' ? '薄弱词回顾 · 不计入首答分数' : '听音自评'}</span><p>${e(session.label)}</p></div><div class="pr-session-tools">${button('pause',session.paused ? '继续' : '暂停','','pr-small')}${button('exit','退出练习','','pr-small pr-quiet')}</div></div><div class="pr-progress-label"><span>${session.phase === 'review' ? '回顾' : '首轮'} ${Math.min(session.index+1,keys.length)} / ${keys.length}</span><span>${progress}%</span></div><div class="pr-progress" role="progressbar" aria-label="本轮练习进度" aria-valuemin="0" aria-valuemax="${keys.length}" aria-valuenow="${session.index+(done ? 1 : 0)}"><span style="width:${progress}%"></span></div><section class="pr-listening-card ${session.paused ? 'is-paused' : ''}"><p class="pr-kicker">${session.paused ? '休息一下，进度已经保存' : done ? '已完成本词自评' : '只听声音，先在心里想一想'}</p><div class="pr-sound-symbol" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div><h2>${session.paused ? '准备好，再继续。' : done ? '看过词卡，再向前一步。' : '你听出了这个词吗？'}</h2><p>${session.paused ? '继续后会重播当前词。' : done ? `${RATINGS[answerMap(session)[currentKey(session)]]}${session.phase === 'first' ? ' · '+answerMap(session)[currentKey(session)]+' 分' : ''}` : '先回想意思，再选择最接近的状态。'}</p>${session.paused ? button('resume','继续听音练习','','pr-primary') : `<div class="pr-listen-action">${button('replay','重播读音','','pr-replay')}</div>${done ? `<div class="pr-action-row">${button('card','查看词卡','','pr-quiet')}${button('next',session.index === keys.length-1 ? (session.phase === 'review' || !session.reviewKeys.length ? '查看结果' : '进入回顾') : '下一词','','pr-primary')}</div>` : `<div class="pr-rating-buttons">${button('rate','<strong>认识</strong><span>想起了 · 2 分</span>','data-pr-points="2"','pr-rating pr-known')}${button('rate','<strong>有点模糊</strong><span>不太确定 · 1 分</span>','data-pr-points="1"','pr-rating pr-unsure')}${button('rate','<strong>不认识</strong><span>未记住 · 0 分</span>','data-pr-points="0"','pr-rating pr-unknown')}</div>${button('card','先查看词卡，再自评','','pr-quiet')}`}`}</section><p class="pr-keyboard-help">空格重播 · 1 认识 · 2 模糊 · 3 不认识 · → 下一词 · Esc 暂停</p>`);
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
    dialog.innerHTML = `<div class="pr-card-handle" aria-hidden="true"></div><div class="pr-card-top"><span class="pr-kicker">词卡</span>${button('card-close','关闭','aria-label="关闭词卡"','pr-small pr-quiet')}</div><h2 id="pr-card-title" lang="nb">${e(item.word)}</h2><div class="pr-card-phonetics">${item.syllables ? `<span>${e(item.syllables)}</span>` : ''}${item.ipa ? `<span>${e(item.ipa)}</span>` : ''}${button('replay','重听','','pr-small')}</div>${item.meaning ? `<p class="pr-card-meaning">${e(item.meaning)}</p>` : ''}${renderFacts(item)}${usage.length ? `<section class="pr-card-section"><h3>用法</h3>${usage.map(text => `<p>${e(text)}</p>`).join('')}</section>` : ''}${renderExampleSection('课文句子',item.practiceTextExamples)}${renderExampleSection('学习例句',item.practiceLearningExamples)}${item.sourceEntry ? `<section class="pr-card-section"><h3>原词条</h3><p lang="nb">${e(item.sourceEntry)}</p></section>` : ''}<p class="pr-card-source">${e(item.sourceLabels.slice(0,3).join(' · '))}</p><div class="pr-card-rating">${done ? `<p class="pr-answer-record" role="status">${session.phase === 'review' ? '本次回顾' : '首答'}：${e(RATINGS[answerMap(session)[key]])}${session.phase === 'first' ? ' · '+answerMap(session)[key]+' 分' : ' · 不改变首答分数'}</p>${button('next',session.index === currentKeys(session).length-1 ? (session.phase === 'review' || !session.reviewKeys.length ? '查看结果' : '进入回顾') : '下一词','','pr-primary')}` : `<p>按刚才听到时的记忆自评</p><div class="pr-rating-buttons">${button('rate','想起了 · 2 分','data-pr-points="2"','pr-rating pr-known')}${button('rate','有点模糊 · 1 分','data-pr-points="1"','pr-rating pr-unsure')}${button('rate','未记住 · 0 分','data-pr-points="0"','pr-rating pr-unknown')}</div>`}</div>`;
    session.cardOpen = true;
    if (!dialog.open) dialog.showModal();
  }
  function grade(points) {
    const session = currentSession();
    if (!session || session.paused || !['first','review'].includes(session.phase) || ![0,1,2].includes(points)) return;
    if (answered(session)) return;
    const key = currentKey(session);
    answerMap(session)[key] = points;
    if (session.phase === 'first') {
      const stats = state.store.stats[key] || {seen:0,points:0,lastPoints:0,streak:0,reviews:0};
      stats.seen += 1; stats.points += points; stats.lastPoints = points; stats.lastAt = now(); stats.streak = points === 2 ? stats.streak+1 : 0;
      state.store.stats[key] = stats;
      if (points < 2 && !session.reviewKeys.includes(key)) session.reviewKeys.push(key);
    } else {
      const stats = state.store.stats[key];
      if (stats) { stats.reviews = (stats.reviews || 0)+1; stats.lastReviewPoints = points; stats.lastReviewAt = now(); }
    }
    persist(); renderSession(); openCard();
  }
  function next() {
    const session = currentSession();
    if (!session || session.paused || !answered(session)) return;
    closeDialogs(); stopAudio(); session.cardOpen = false;
    if (session.index < currentKeys(session).length-1) {
      session.index += 1; persist(); renderSession(); playCurrent();
    } else if (session.phase === 'first' && session.reviewKeys.length) {
      session.phase = 'review-intro'; session.index = 0; persist(); renderSession();
    } else finish();
  }
  function finish() {
    const session = currentSession();
    if (!session) return;
    closeDialogs(); stopAudio();
    const pool = sessionPool(session);
    const result = {id:session.id,startedAt:session.startedAt,finishedAt:now(),label:session.label,sources:session.sources,customKeys:session.customKeys,mode:session.mode,total:session.firstKeys.length,reviewed:Object.keys(session.reviewAnswers).length,answers:session.firstKeys.map(key => ({key,word:pool.get(key)?.word || key,meaning:pool.get(key)?.meaning || '',points:session.answers[key] ?? 0}))};
    if (!state.store.history.some(item => item.id === result.id)) state.store.history.unshift(result);
    state.store.active = null; state.result = result; persist(); renderResult(result);
  }
  function dateLabel(date) {
    try { return new Date(date).toLocaleString('zh-CN',{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
    catch { return ''; }
  }
  function renderResult(result,fromHistory=false) {
    state.screen = 'results'; state.result = result;
    const counts = [2,1,0].map(points => result.answers.filter(answer => answer.points === points).length);
    const weak = result.answers.filter(answer => answer.points < 2 && state.words.has(answer.key));
    shell(`<section class="pr-results-hero"><div><p class="pr-kicker">${fromHistory ? '学习记录' : '这次练习完成了'}</p><h2>每次听懂一点，都是进步。</h2><p>${e(result.label)}</p><span class="pr-result-date">${e(dateLabel(result.finishedAt))} · ${result.total} 词 · 回顾 ${result.reviewed || 0} 词</span></div><div class="pr-score"><strong>${scoreOf(result)}</strong><span>首答得分 / 100</span></div></section><div class="pr-result-counts"><span><strong>${counts[0]}</strong>想起了</span><span><strong>${counts[1]}</strong>有点模糊</span><span><strong>${counts[2]}</strong>未记住</span></div><div class="pr-action-row pr-result-actions">${weak.length ? button('result-weak',`再练这 ${weak.length} 个薄弱词`,'','pr-primary') : ''}${button('result-again','再练同一组','','pr-secondary')}${button('setup','重新选题','','pr-quiet')}${button('history','学习记录','','pr-quiet')}</div><section class="pr-panel"><div class="pr-panel-heading"><h2>每个词的积累</h2><span>熟练度按历次首答计算</span></div><div class="pr-result-words">${result.answers.map(answer => { const learned=mastery(answer.key); return `<div class="pr-result-word"><div><strong lang="nb">${e(answer.word)}</strong><p>${e(answer.meaning)}</p></div><span class="pr-result-rating pr-points-${answer.points}">${e(RATINGS[answer.points])} · ${answer.points} 分</span><div class="pr-mastery"><span>${learned.text} · ${learned.percent}%</span><div><span style="width:${learned.percent}%"></span></div></div>${state.words.has(answer.key) ? button('result-word','重听',`data-pr-key="${e(answer.key)}"`,'pr-small pr-quiet') : ''}</div>`; }).join('')}</div></section>`);
  }
  function renderHistory() {
    state.screen = 'history';
    const history = state.store.history;
    const weak = weakKeys();
    shell(`<div class="pr-history-header"><div><p class="pr-kicker">一点一滴，留在这里</p><h2>本机学习记录</h2><p>已练 ${Object.keys(state.store.stats).length} 个词，完成 ${history.length} 次练习。</p></div><div class="pr-action-row">${button('export','导出记录','','pr-secondary')}${button('setup','选择新练习','','pr-primary')}</div></div>${weak.length ? `<div class="pr-resume-banner"><div><strong>${weak.length} 个词还值得再听一遍</strong><p>优先复习最近没记牢的词。</p></div>${button('weak','复习薄弱词','','pr-primary')}</div>` : ''}${history.length ? `<div class="pr-history-list">${history.map(result => `<article class="pr-history-entry"><div><strong>${e(result.label)}</strong><p>${e(dateLabel(result.finishedAt))} · ${result.total} 词 · ${result.mode === 'weak' ? '优先薄弱' : '随机练习'}</p></div><span class="pr-history-score">${scoreOf(result)}<small>分</small></span>${button('history-detail','查看',`data-pr-id="${e(result.id)}"`,'pr-small')}${result.answers.some(answer => answer.points < 2) ? button('history-weak','复习错词',`data-pr-id="${e(result.id)}"`,'pr-small pr-quiet') : ''}</article>`).join('')}</div>` : '<section class="pr-panel pr-empty"><h3>第一组练习，从今天开始。</h3><p>完成后会在这里看到得分与每个词的熟练度。</p></section>'}<p class="pr-local-note">记录保存在此浏览器，清除浏览器数据会同时清除记录。</p>`);
  }
  function closeDialogs() {
    for (const dialog of state.root?.querySelectorAll('dialog[open]') || []) dialog.close();
  }
  function confirmDialog(title,message,actions) {
    stopAudio();
    const session = currentSession();
    if (session) { session.paused = true; session.cardOpen = false; persist(); }
    closeDialogs();
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
    closeDialogs(); session.paused = false; session.cardOpen = false; persist(); renderSession(); playCurrent();
  }
  function saveSet() {
    if (!state.selected.size) { announce('请先选择练习范围。'); return; }
    const name = $('#pr-set-name').value.trim();
    if (!name) { $('#pr-set-name').focus(); announce('给这组选题取个名字，就可以随时重练。'); return; }
    const poolSize = poolFor(state.selected).size;
    state.limit = Math.max(1,Math.min(poolSize,Math.floor(Number($('#pr-limit')?.value) || 20)));
    state.mode = $('#pr-order')?.value === 'weak' ? 'weak' : 'random';
    const config = {sources:[...state.selected],limit:state.limit,mode:state.mode};
    const existing = state.store.sets.find(item => item.name === name);
    const save = () => {
      if (existing) Object.assign(existing,config,{updatedAt:now()});
      else state.store.sets.unshift({id:uid(),name,...config,createdAt:now()});
      state.store.draft=config; persist(); renderSetup(); announce('选题组合已保存。');
    };
    if (existing) confirmDialog('更新同名组合？',`“${name}”已存在，更新后会使用当前选题与词数。`,[{action:'confirm-run',text:'更新组合',primary:true,run:save},{action:'confirm-close',text:'取消'}]);
    else save();
  }
  function reviewKeys(keys,label,limit=keys.length) {
    if (!keys.length) { announce('目前没有需要复习的薄弱词，先完成一组练习吧。'); return; }
    startSession({sources:[],mode:'weak',limit},keys,label);
  }
  function exportRecords() {
    try {
      const backup = {version:1,exportedAt:now(),sets:state.store.sets,stats:state.store.stats,history:state.store.history,active:state.store.active,draft:state.store.draft,recent:state.store.recent};
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
    const target = event.target.closest('[data-practice-action]');
    if (!target || !state.initialized) return;
    const action = target.dataset.practiceAction;
    const session = currentSession();
    const id = target.dataset.prId;
    switch (action) {
      case 'setup': navigate('setup'); break;
      case 'history': navigate('history'); break;
      case 'export': exportRecords(); break;
      case 'weak': reviewKeys(weakKeys(),'薄弱词复习',Math.min(state.limit,weakKeys().length)); break;
      case 'clear-selection': state.selected.clear(); updateSelectionUI(); break;
      case 'expand-chapters': state.root.querySelectorAll('.pr-source-chapter').forEach(detail => { detail.open = true; }); break;
      case 'expand-basics': $('#pr-basic-sources')?.scrollIntoView({block:'start',behavior:'smooth'}); break;
      case 'save-set': saveSet(); break;
      case 'saved-load': { const set = state.store.sets.find(item => item.id === id); if (set) { applyConfig(set); draft(); renderSetup(); } break; }
      case 'saved-start': { const set = state.store.sets.find(item => item.id === id); if (set) startSession(set); break; }
      case 'saved-delete': {
        const set = state.store.sets.find(item => item.id === id);
        if (set) confirmDialog('删除这个选题组合？',set.name,[{action:'confirm-run',text:'删除组合',run:() => { state.store.sets=state.store.sets.filter(item => item.id !== id); persist(); renderSetup(); }},{action:'confirm-close',text:'保留'}]);
        break;
      }
      case 'recent-start': { const config = state.store.recent[Number(target.dataset.prIndex)]; if (config) startSession(config); break; }
      case 'start': startSession({sources:[...state.selected],limit:Number($('#pr-limit').value),mode:$('#pr-order').value}); break;
      case 'resume': resume(); break;
      case 'pause': if (session?.paused) resume(); else { pause(); renderSession(); } break;
      case 'exit': if (session) confirmDialog('离开这次练习？','可以保留当前进度，回来继续听。',[
        {action:'confirm-run',text:'保存并退出',primary:true,run:renderSetup},
        {action:'confirm-resume',text:'继续练习'},
        {action:'discard',text:'放弃本次进度'},
      ]); break;
      case 'discard': closeDialogs(); stopAudio(); state.store.active=null; persist(); renderSetup(); break;
      case 'confirm-run': { const run=state.pending; state.pending=null; closeDialogs(); run?.(); break; }
      case 'confirm-close': state.pending=null; closeDialogs(); if (state.screen === 'session') renderSession(); break;
      case 'confirm-resume': state.pending=null; resume(); break;
      case 'replay': playCurrent(); break;
      case 'card': openCard(); break;
      case 'card-close': $('#pr-card').close(); if (session) session.cardOpen=false; break;
      case 'rate': grade(Number(target.dataset.prPoints)); break;
      case 'next': next(); break;
      case 'review-start': if (session) { session.phase='review'; session.index=0; session.paused=false; persist(); renderSession(); playCurrent(); } break;
      case 'finish': finish(); break;
      case 'result-weak': if (state.result) reviewKeys(state.result.answers.filter(answer => answer.points < 2).map(answer => answer.key),'本次薄弱词复习'); break;
      case 'result-again': if (state.result) startSession({sources:state.result.sources,limit:state.result.total,mode:state.result.mode},state.result.customKeys || null,state.result.label); break;
      case 'result-word': { const word=state.words.get(target.dataset.prKey); stopAudio(); if (word) Promise.resolve(state.deps.pronounce?.(word)).catch(() => announce('读音暂时无法播放，请稍后重试。')); break; }
      case 'history-detail': { const result=state.store.history.find(item => item.id === id); if (result) renderResult(result,true); break; }
      case 'history-weak': { const result=state.store.history.find(item => item.id === id); if (result) reviewKeys(result.answers.filter(answer => answer.points < 2).map(answer => answer.key),`${dateLabel(result.finishedAt)} · 错词复习`); break; }
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
    } else if (input.id === 'pr-limit') {
      state.limit = Math.max(1,Math.min(poolFor(state.selected).size || 1,Math.floor(Number(input.value) || 20))); updateSelectionUI();
    } else if (input.id === 'pr-order') { state.mode=input.value === 'weak' ? 'weak' : 'random'; draft(); }
  }
  function onInput(event) {
    const input = event.target;
    if (!state.root?.contains(input) || input.id !== 'pr-limit' || input.value.trim() === '' || !Number.isFinite(Number(input.value))) return;
    state.limit = Math.max(1,Math.min(poolFor(state.selected).size || 1,Math.floor(Number(input.value))));
    const counter = $('#pr-start-count');
    if (counter) counter.textContent = Math.min(state.limit,poolFor(state.selected).size);
    draft();
  }
  function onKey(event) {
    if (!state.visible || state.screen !== 'session' || state.root.hidden || event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if ($('#pr-confirm')?.open) return;
    const session = currentSession();
    if (!session) return;
    if (event.key === 'Escape') {
      if ($('#pr-card')?.open) return;
      event.preventDefault(); if (!session.paused) { pause(); renderSession(); } return;
    }
    if (session.paused || session.phase === 'review-intro') return;
    if (event.code === 'Space' && event.target.tagName !== 'BUTTON') { event.preventDefault(); playCurrent(); }
    if (['1','2','3'].includes(event.key)) { event.preventDefault(); grade(3-Number(event.key)); }
    if (event.key === 'ArrowRight' && answered(session)) { event.preventDefault(); next(); }
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
    if (!session.firstKeys.length) { state.store.active=null; return; }
    const keys = currentKeys(session);
    const retainedIndex = keys.indexOf(oldKey);
    const unansweredIndex = keys.findIndex(key => !Object.prototype.hasOwnProperty.call(answerMap(session),key));
    session.index = retainedIndex >= 0 ? retainedIndex : Math.max(0,unansweredIndex);
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
      document.addEventListener('keydown',onKey);
      window.addEventListener('beforeunload',() => { if (currentSession()) { currentSession().paused=true; persist(); } });
      document.addEventListener('visibilitychange',() => { if (document.hidden && currentSession() && state.visible) { pause(); if (state.screen === 'session') renderSession(); } });
      state.initialized=true;
    }
    recoverActive();
    applyConfig(state.store.draft || state.store.recent[0] || {sources:state.chapters[0] ? [state.chapters[0].token] : [],limit:20,mode:'random'});
    renderSetup();
  }
  function show() {
    if (!state.initialized) return;
    state.visible=true;
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
