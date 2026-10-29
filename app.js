import {createDataLoader} from './loader.mjs?v=20261029-background-audio';
import {createReadingLibrary} from './reading-library.mjs?v=20261029-background-audio';
import {createVocabularyLibrary} from './vocabulary-library.mjs?v=20261029-background-audio';
import {createWordbookStore,createWordbookSync,wordbookVocabulary,wordProblem,parseBatch,STORAGE_KEY as WORDBOOK_KEY,SYNC_KEY as WORDBOOK_SYNC_KEY} from './wordbook-store.mjs?v=20261029-background-audio';
import {createWordbookLookup} from './wordbook-lookup.mjs?v=20261029-background-audio';

const VERSION = '20261029-background-audio';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const str = value => String(value ?? '');
const compareWords = new Intl.Collator('nb').compare;
const empty = (message, detail = '') => `<div class="empty-state">${icon('book')}<p>${escapeHTML(message)}</p>${detail ? `<small>${escapeHTML(detail)}</small>` : ''}</div>`;
const state = {
  view: 'reading', book: 'textbook', page: 1, readingId: '', vocabularyId: '', basicId: '',
  expanded: new Set(), data: {}, words: [], basicItems: [], pdfRun: 0, pdfCache: new Map(), renderTask: null,
  audioRange: null, audioToken: 0, pronunciationToken: 0, toastTimer: null, ready: false, pdfScale: 1,
  wordRate: 1, speechItem: null, viewRun: 0, practiceInitialized: false, compareInitialized: false, audioError: false,
  readMode: 'pdf', currentEntryId: '', endedToken: -1, moreTab: 'honors', moreInitialized: false, pendingDuel: null
};
const loadData = createDataLoader(state.data, {version:VERSION});
const featureLoads = new Map();
const featureAttempts = new Map();
const loading = message => `<div class="empty-state" role="status"><span class="loader"></span><p>${escapeHTML(message)}</p></div>`;

const vocabularyLibrary = createVocabularyLibrary(loadData);
state.vocabularySelections = new Map();
const activeSeriesId = () => state.library?.seriesFor(state.book) || 'god-i-norsk';
const activeSeriesTitle = () => state.library?.series.find(item => item.id === activeSeriesId())?.title || 'God i norsk';
const vocabularyBook = () => state.vocabularyDescriptor?.bookId || 'textbook';
const vocabularyIndex = (seriesId = activeSeriesId()) => vocabularyLibrary.index(seriesId);
const vocabularyChapter = (id,seriesId = activeSeriesId()) => vocabularyLibrary.chapter(seriesId,id);
// 我的词本 follows the leaderboard nickname: a local working copy, synced with the server in the background.
try { state.wordbookActive = localStorage.getItem('norsk-vocab-source-v1') === 'wordbook'; } catch { state.wordbookActive = false; }
let wordbookStore, wordbookSync, wordbookLookupInstance, wordbookAudio = null, wordbookSyncedAt = 0;
function wordbook() {
  if (wordbookStore) return wordbookStore;
  let storage;
  try { storage = window.localStorage; } catch {}
  wordbookStore = createWordbookStore({storage:storage || {getItem:() => null,setItem() {}}});
  wordbookStore.subscribe(() => {
    wordbookAudio = null;
    window.NorskPractice?.refreshWordbook?.(wordbookVocabulary(wordbookStore.data));
    if (wordbookStore.sync.dirty) wordbookSync ? wordbookSync.schedule() : syncWordbook();
  });
  window.addEventListener('storage',event => { if ([WORDBOOK_KEY,WORDBOOK_SYNC_KEY].includes(event.key)) wordbookStore.reload(); });
  return wordbookStore;
}
function syncWordbook() {
  wordbook();
  if (!wordbookSync) {
    wordbookSync = createWordbookSync({store:wordbookStore,request:(path,options) => prepareCommunity().then(community => community.request(path,options)),
      onStatus:(status,detail) => {
        state.wordbookSync = {status,...detail};
        if (status !== 'syncing') wordbookSyncedAt = Date.now();
        window.NorskWordbook?.syncChanged?.();
      }});
    window.addEventListener('online',() => wordbookSync.run());
    document.addEventListener('visibilitychange',() => { if (!document.hidden && Date.now()-wordbookSyncedAt > 60000) wordbookSync.run(); });
  }
  return wordbookSync.run();
}
function wordbookLookup() {
  return wordbookLookupInstance ||= createWordbookLookup({loadJSON:loadData,version:VERSION,fetchText:async path => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(),20000);
    try {
      const response = await fetch(path,{signal:controller.signal});
      if (!response.ok) throw new Error(`词典分片：HTTP ${response.status}`);
      return await response.text();
    } finally { clearTimeout(timer); }
  }});
}
// The site's own recording for exactly this spelling; null while the recordings list is not loaded.
function textbookClip(word) {
  const table = state.data.pronunciation;
  if (!table) return null;
  const path = table[str(word).trim().toLocaleLowerCase('nb')];
  return typeof path === 'string' && /^pronunciation\/[0-9a-f]{20}\.mp3$/.test(path) ? path : '';
}
// Readings of wordbook words outside the wordbook, e.g. in a multiplayer round.
function wordbookClip(word) {
  if (!wordbookStore) return '';
  if (!wordbookAudio) {
    wordbookAudio = new Map();
    for (const entry of wordbookStore.data.entries) if (entry.audio) wordbookAudio.set(entry.word.toLocaleLowerCase('nb'),entry.audio);
  }
  return wordbookAudio.get(str(word).trim().toLocaleLowerCase('nb')) || '';
}
function setWordbookActive(active,rerender = true) {
  state.wordbookActive = active;
  try { localStorage.setItem('norsk-vocab-source-v1',active ? 'wordbook' : ''); } catch {}
  if (!active) window.NorskWordbook?.hide();
  $('#vocab-search').value = '';
  if (rerender && state.view === 'vocabulary') setView('vocabulary',false);
  else renderStudyPicker();
}
function initWordbookUI() {
  window.NorskWordbook.init({root:$('#vocabulary-view'),store:wordbook(),syncState:() => state.wordbookSync || {},lookup:wordbookLookup(),
    clipFor:textbookClip,wordProblem,parseBatch,
    requestTTS:texts => prepareCommunity().then(community => community.request('/tts',{method:'POST',body:{texts}})),
    apiURL:path => new URL(`${str(window.NORSK_COMMUNITY_CONFIG?.apiBase || '/api/community').replace(/\/+$/,'')}${path}`,location.href).href,
    setWords:items => { state.words = items; },prefetchList:prefetchListWords,pronounce,notify,escapeHTML,icon,openLayer,closeLayer,closeSidebar,
    refreshChrome:() => { renderStudyPicker(); renderTOC(); },isActive:() => state.view === 'vocabulary' && state.wordbookActive});
}
function activateVocabulary(seriesId,descriptor,vocabulary) {
  if (state.vocabularySeriesId && state.vocabularyId) state.vocabularySelections.set(state.vocabularySeriesId,state.vocabularyId);
  state.vocabularySeriesId = seriesId;
  state.vocabularyDescriptor = descriptor;
  state.data.vocabulary = vocabulary;
  const saved = state.vocabularySelections.get(seriesId);
  state.vocabularyId = vocabulary.chapters.some(chapter => str(chapter.id) === saved || (chapter.sections || []).some(section => str(section.id) === saved)) ? saved : str(vocabulary.chapters[0]?.id || '');
  const chapter = vocabulary.chapters.find(item => str(item.id) === state.vocabularyId || (item.sections || []).some(section => str(section.id) === state.vocabularyId));
  if (chapter) state.expanded.add(`${descriptor.bookId}:${chapter.id}`);
}
function renderStudyPicker() {
  if (!state.library) return;
  const mine = state.view === 'vocabulary' && state.wordbookActive;
  const current = mine ? '' : activeSeriesId();
  $('#series-title').textContent = mine ? wordbook().data.title : activeSeriesTitle();
  // The word list also offers the learner's own wordbook, below the textbooks.
  const own = state.view === 'vocabulary' ? `<button type="button" role="option" class="series-option is-wordbook" data-action="choose-series" data-id="wordbook" aria-selected="${mine}"><span><strong>${escapeHTML(wordbook().data.title)}</strong><small>自己的单词和句子 · ${wordbook().data.entries.length} 条</small></span>${mine ? icon('check') : ''}</button>` : '';
  $('#series-menu').innerHTML = state.library.series.map(item => {
    const books = state.library.booksFor(item.id).map(book => bookData(book)?.label || '教材').join(' · ');
    return `<button type="button" role="option" class="series-option" data-action="choose-series" data-id="${escapeHTML(item.id)}" aria-selected="${item.id === current}"><span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(books)}</small></span>${item.id === current ? icon('check') : ''}</button>`;
  }).join('')+own;
  $('#book-picker').hidden = !['reading','vocabulary'].includes(state.view);
}
function toggleSeriesMenu(open = $('#series-menu').hidden) {
  $('#series-menu').hidden = !open;
  $('#series-button').setAttribute('aria-expanded',str(open));
}
function toggleSettings(open = $('#settings-menu').hidden) {
  const wasOpen = !$('#settings-menu').hidden, hadFocus = !!document.activeElement?.closest?.('#settings-menu');
  $('#settings-menu').hidden = !open;
  $('#settings-button').setAttribute('aria-expanded',str(open));
  // The menu is a small dialog: focus enters it on open and returns to its button when it closes.
  if (open && !wasOpen) ($('#settings-menu [aria-pressed="true"]') || $('#settings-menu button'))?.focus({preventScroll:true});
  else if (!open && hadFocus) $('#settings-button').focus({preventScroll:true});
}
const activeSearch = () => state.view === 'basics' ? $('#basics-search') : $('#vocab-search');
function toggleSearch(open = !$('#heading-search').classList.contains('open')) {
  const input = activeSearch();
  $('#heading-search').classList.toggle('open',open);
  $('#search-button').setAttribute('aria-expanded',str(open));
  $('#search-button').setAttribute('aria-label',open ? '关闭搜索' : '搜索');
  if (open) { input.focus(); return; }
  if (!input.value) return;
  input.value = '';
  if (state.view === 'basics') renderBasics(); else renderVocabulary();
}
function renderRateOptions() {
  $('#rate-options').innerHTML = wordRates.map(rate => `<button type="button" data-action="word-rate" data-rate="${rate}" aria-pressed="${rate === state.wordRate}">${rate}×</button>`).join('');
}
function setVocabSort(order) {
  if (!['easy','hard','alpha'].includes(order)) return;
  state.vocabSort = order;
  $$('[data-action="vocab-sort"]').forEach(button => button.setAttribute('aria-pressed',str(button.dataset.sort === order)));
  try { localStorage.setItem('norsk-vocab-sort-v1',order); } catch {}
  renderVocabulary();
}
function selectStudySeries(seriesId) {
  if (!state.library) return;
  if (seriesId === 'wordbook') { if (!state.wordbookActive) setWordbookActive(true); return; }
  if (state.wordbookActive && state.view === 'vocabulary') {
    const same = seriesId === activeSeriesId();
    setWordbookActive(false,same);
    if (same) return;
  }
  if (seriesId === activeSeriesId()) return;
  if (state.view === 'practice') window.NorskPractice?.hide();
  pauseOtherAudio();
  const view = state.view;
  switchBook(state.library.bookForSeries(seriesId));
  $('#vocab-search').value = '';
  renderStudyPicker();
  if (['vocabulary','practice'].includes(view)) setView(view,false);
}
function loadFeature(name) {
  if (featureLoads.has(name)) return featureLoads.get(name);
  let link, featureTimer;
  const attempt = featureAttempts.get(name) || 0;
  const stylesheet = new Promise((resolve,reject) => {
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${name}.css?v=${VERSION}`;
    const timer = setTimeout(() => { link.remove(); reject(new Error(`${name}: stylesheet timeout`)); },20000);
    link.onload = () => { clearTimeout(timer); resolve(); };
    link.onerror = () => { clearTimeout(timer); link.remove(); reject(new Error(`${name}: stylesheet unavailable`)); };
    document.head.append(link);
  });
  const module = import(`./${name}.js?v=${VERSION}${attempt ? `&retry=${attempt}` : ''}`);
  const deadline = new Promise((resolve,reject) => { featureTimer = setTimeout(() => reject(new Error(`${name}: feature timeout`)),20000); });
  const promise = Promise.race([Promise.all([stylesheet,module]),deadline]).then(result => {
    clearTimeout(featureTimer);
    return result;
  },error => {
    clearTimeout(featureTimer);
    link.remove();
    featureLoads.delete(name);
    featureAttempts.set(name,attempt+1);
    throw error;
  });
  featureLoads.set(name,promise);
  return promise;
}
let communityLoad, communityAttempt = 0;
function prepareCommunity() {
  if (!communityLoad) communityLoad = import(`./community-config.js?v=${VERSION}${communityAttempt ? `&retry=${communityAttempt}` : ''}`).then(() => loadFeature('community')).then(() => {
    window.NorskCommunity.init({notify});
    return window.NorskCommunity;
  }).catch(error => { communityLoad = null; communityAttempt++; throw error; });
  return communityLoad;
}
async function mountCommunity(container) {
  try { return await (await prepareCommunity()).mount(container); }
  catch {
    if (container.isConnected) container.innerHTML = '<p class="community-offline">排行榜暂时无法打开，请稍后重试。</p>';
    return false;
  }
}
// Being on the site earns online XP, so heartbeats start on every view, not only in practice.
function startPresence() {
  prepareCommunity().then(community => community.startPresence()).catch(() => {});
}
function submitPracticeResult(result) {
  return prepareCommunity().then(community => community.submitResult(result)).catch(() => false);
}
// The listen-and-read reader also owns the playlist and lock-screen controls of the lesson player.
let readerLoad;
function prepareReader() {
  if (!readerLoad) readerLoad = loadFeature('reader').then(() => {
    window.NorskReader.init({audio,playEntry,resumeLessonAudio,pauseLessonAudio,seekLesson,findEntry:id => findEntry(id,'textbook'),entryAudio,chapterAudio,allChapters:() => allChapters('textbook'),loadData,safeURL,notify,pronounce,prefetch:prefetchPronunciation,stopWordAudio:pauseOtherAudio,escapeHTML,icon,currentEntry:() => state.currentEntryId,playbackVersion:() => state.audioToken,openSection:openReaderSection,openLayer,closeLayer,version:VERSION});
    return window.NorskReader;
  }).catch(error => { readerLoad = null; throw error; });
  return readerLoad;
}
function readingTextMode() { return state.readMode === 'text' && state.book === 'textbook'; }
function applyReadMode() {
  const text = readingTextMode();
  if (!text && !$('#reader-text').hidden) window.NorskReader?.hide();
  document.body.classList.toggle('read-text',text);
  $$('[data-action="read-mode"]').forEach(button => button.setAttribute('aria-pressed',str(button.dataset.mode === (text ? 'text' : 'pdf'))));
  const textButton = $('[data-action="read-mode"][data-mode="text"]');
  textButton.disabled = state.book !== 'textbook';
  textButton.title = state.book === 'textbook' ? '逐词显示课文，跟着录音听读' : '听读目前只适用于有原录音的 God i norsk 教材';
  $('#pdf-stage').hidden = text;
  $('.page-controls').hidden = text;
  $('#reader-text').hidden = !text;
}
function setReadMode(mode) {
  state.readMode = mode === 'text' ? 'text' : 'pdf';
  try { localStorage.setItem('norsk-read-mode-v1',state.readMode); } catch {}
  renderPDF();
}
function showReaderText() {
  const container = $('#reader-text');
  if (!window.NorskReader) container.innerHTML = loading('正在准备听读课文…');
  prepareReader().then(reader => { if (state.view === 'reading' && readingTextMode()) reader.show(container,state.readingId); }).catch(() => {
    if (state.view === 'reading' && readingTextMode()) container.innerHTML = `${empty('听读课文暂时无法载入','请检查网络后重试。')}<button class="text-button" data-action="retry-pdf">重新载入</button>`;
  });
}
// Opens a God i norsk section as listen-and-read text, from the playlist or the transcript view.
function openReaderSection(id) {
  state.readMode = 'text';
  try { localStorage.setItem('norsk-read-mode-v1','text'); } catch {}
  if (state.view !== 'reading') setView('reading');
  selectEntry(id,'textbook');
}
function lessonEnded() {
  if (state.endedToken === state.audioToken) return;
  state.endedToken = state.audioToken;
  // A browser that calls every track finished as soon as it starts would otherwise race through the whole playlist.
  const now = Date.now();
  state.recentEnds = (state.recentEnds || []).filter(time => now-time < 4000).concat(now);
  if (state.recentEnds.length > 3) {
    state.recentEnds = [];
    audio.pause();
    notify('播放列表连续跳过了几节，已暂停。请点播放键继续。');
    return;
  }
  window.dispatchEvent(new CustomEvent('norsklessonend',{detail:{id:state.currentEntryId}}));
}
function seekLesson(delta) {
  if (!audio.src) return;
  const {start,end} = audioBounds();
  audio.currentTime = Math.max(start,Math.min(audio.currentTime+delta,(Number.isFinite(end) ? end : audio.duration)-.05));
  updateAudioUI();
}
async function openDuel(join = '') {
  try {
    const [community] = await Promise.all([prepareCommunity(),loadFeature('duel')]);
    window.NorskDuel.open({community,sources:() => window.NorskPractice?.duelSources?.() || [],pronounce,prefetch:prefetchPronunciation,notify,escapeHTML,join,onExit:() => {
      if (/[?&]room=/.test(location.search)) history.replaceState(null,'',`${location.pathname}${location.hash}`);
      window.NorskPractice?.refreshHonors?.();
    }});
  } catch { notify('联机翻翻乐暂时无法打开，请检查网络后重试。'); }
}
// Duels draw words from the practice sources, so the practice view is prepared first.
function requestDuel(join = '') {
  if (state.view === 'practice' && state.practiceInitialized && state.practiceSeriesId === activeSeriesId()) { openDuel(join); return; }
  state.pendingDuel = {join};
  setView('practice');
}
// Honors artwork that fails to load is replaced by a drawn medallion, so a badge is never a broken image.
const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX'];
function honorFallback(src) {
  const name = str(src).split('/').pop().replace(/\.webp.*$/,'');
  const week = /^week-(\d+)(-perfect)?$/.exec(name), trophy = /^trophy-(\d)$/.exec(name);
  const metal = trophy ? ['#d8b76e','#c9ccc4','#c08a5a'][Number(trophy[1])-1] || '#d8b76e' : week && !week[2] ? '#d1b06a' : '#c8cbc2';
  const inner = trophy ? '<path d="M46 40h28v10c0 10-6 17-14 18-8-1-14-8-14-18Z M58 68h4v10h-4Z M50 78h20v5H50Z" fill="#f6efd9" opacity=".9"/>'
    : week && week[2] ? Array.from({length:7},(_,i) => { const a = (i/7)*Math.PI*2-Math.PI/2; return `<circle cx="${60+Math.cos(a)*30}" cy="${60+Math.sin(a)*30}" r="2.6" fill="#f3ead2"/>`; }).join('')
    : week ? `<text x="60" y="68" text-anchor="middle" font-family="Georgia,serif" font-size="22" fill="#f3e6c4">${ROMAN[Number(week[1])-1] || ''}</text>`
    : '<path d="M60 44l4.5 9.6 10.5 1.2-7.8 7.1 2.2 10.4L60 67l-9.4 5.3 2.2-10.4-7.8-7.1 10.5-1.2Z" fill="#f3ead2" opacity=".9"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" fill="${metal}"/><circle cx="60" cy="60" r="49" fill="none" stroke="#fff8" stroke-width="1"/><circle cx="60" cy="60" r="43" fill="#21483e"/><circle cx="60" cy="60" r="40" fill="none" stroke="${metal}" stroke-width=".8" opacity=".7"/>${inner}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
document.addEventListener('error',event => {
  const image = event.target;
  if (image?.tagName !== 'IMG' || image.dataset.fallback || !/assets\/honors\//.test(image.getAttribute('src') || '')) return;
  image.dataset.fallback = '1';
  image.src = honorFallback(image.getAttribute('src'));
},true);
// A newly earned badge, medal, trophy or achievement is shown once, wherever the learner is.
window.addEventListener('norskhonorschange',event => {
  if (event.detail?.week) loadFeature('more').then(() => window.NorskMore?.reveal(event.detail)).catch(() => {});
});
function setMoreTab(tab) {
  state.moreTab = tab;
  if (state.view === 'more') history.replaceState(null,'',`#more/${tab}`);
  renderTOC();
}
async function prepareView(view,viewRun = state.viewRun) {
  const seriesId = activeSeriesId();
  const current = () => viewRun === state.viewRun && seriesId === activeSeriesId();
  if (['vocabulary','basics','practice'].includes(view)) loadData('pronunciation').catch(error => console.warn('读音目录未载入',error));
  if (view === 'vocabulary' && state.wordbookActive) {
    // The textbook recordings decide which entries need a reading from the server, so they load first.
    await Promise.all([loadFeature('wordbook'),loadData('pronunciation').catch(() => null)]);
    if (viewRun === state.viewRun) initWordbookUI();
    syncWordbook();
  } else if (view === 'vocabulary') {
    const [descriptor,vocabulary] = await Promise.all([vocabularyLibrary.descriptor(seriesId),vocabularyIndex(seriesId)]);
    if (current()) activateVocabulary(seriesId,descriptor,vocabulary);
  }
  if (view === 'basics') {
    await loadData('basics');
    if (!state.basicId) state.basicId = str(state.data.basics.categories?.[0]?.id || '');
  }
  if (view === 'practice') {
    // Celebrations are decoration: practice starts without them if they fail to load.
    loadFeature('celebrate').catch(error => console.warn('练习动画未载入',error));
    const [,,descriptor,vocabulary] = await Promise.all([loadFeature('practice'),loadData('basics'),vocabularyLibrary.descriptor(seriesId),vocabularyLibrary.allChapters(seriesId)]);
    if (!current()) return;
    activateVocabulary(seriesId,descriptor,vocabulary);
    if (!state.practiceInitialized || state.practiceSeriesId !== seriesId) {
      window.NorskPractice.init({data:{...state.data,vocabulary,wordbook:wordbookVocabulary(wordbook().data)},series:descriptor,openWordbook:() => { setWordbookActive(true,false); setView('vocabulary'); },pronounce,prefetch:prefetchPronunciation,notify,escapeHTML,stopAudio:pauseOtherAudio,renderRateControl:() => wordRateControl(),mountCommunity,submitPracticeResult,seriesOptions:state.library.series,selectSeries:selectStudySeries,community:prepareCommunity,openDuel:requestDuel,openHonors:() => { state.moreTab = 'honors'; setView('more'); },openLayer,closeLayer});
      state.practiceInitialized = true;
      state.practiceSeriesId = seriesId;
      prepareCommunity().catch(() => {});
      // A wordbook made on another device with this nickname arrives here as well.
      syncWordbook();
    }
  }
  if (view === 'more') {
    await loadFeature('more');
    if (!state.moreInitialized) {
      window.NorskMore.init({root:$('#more-view'),community:prepareCommunity,reader:prepareReader,notify,escapeHTML,icon,setTab:setMoreTab,openDuel:requestDuel,openPractice:() => setView('practice'),version:VERSION});
      state.moreInitialized = true;
    }
  }
  if (view === 'compare') {
    await loadFeature('compare');
    if (!state.compareInitialized) {
      window.NorskCompare.init({data:state.data,getPDF,documentPart,safeURL,escapeHTML,icon,notify,playEntry,entryAudio,onClose:positions => {
        rememberComparePositions(positions);
        setView('reading');
      }});
      state.compareInitialized = true;
    }
  }
}
function viewError(view,error) {
  console.warn(`学习资料未载入：${view}`,error);
  const target = view === 'vocabulary' ? $('#vocab-rows') : view === 'basics' ? $('#basics-items') : $(`#${view}-view`);
  target.innerHTML = `${empty('资料暂时无法载入','请检查网络后重试。')}<button class="text-button" data-action="retry-view">重新载入</button>`;
}
let pdfjsPromise;
const audio = $('#lesson-audio');
const pronunciationAudio = $('#word-audio');
const wordRates = [.5,.75,1,1.25,1.5];
try {
  const savedRate = Number(localStorage.getItem('norsk-word-rate-v1'));
  if (wordRates.includes(savedRate)) state.wordRate = savedRate;
  const savedSort = localStorage.getItem('norsk-vocab-sort-v1');
  if (['easy','hard','alpha'].includes(savedSort)) state.vocabSort = savedSort;
  if (localStorage.getItem('norsk-read-mode-v1') === 'text') state.readMode = 'text';
  const savedLessonRate = localStorage.getItem('norsk-lesson-rate-v1');
  if ([...$('#audio-speed').options].some(option => option.value === savedLessonRate)) $('#audio-speed').value = savedLessonRate;
} catch {}
renderRateOptions();
$$('[data-action="vocab-sort"]').forEach(button => button.setAttribute('aria-pressed',str(button.dataset.sort === (state.vocabSort || 'easy'))));
const labels = {reading:['LES & LYTT · 阅读与听力','阅读','让文字与声音相遇'],vocabulary:['ORDLISTE · 教材章末词表','单词表','在熟悉的句子里，认识新的词语'],basics:['DET GRUNNLEGGENDE · 日常积累','基础常识','循序渐进，从容易的开始'],practice:['ØV LITT HVER DAG · 每日练习','练习','一段专注的练习时间']};
labels.compare = ['LES SIDE OM SIDE · 双页对照','双页对照','选择书籍，各自翻阅'];
labels.more = ['MER · 荣誉与听力','更多','荣誉、播放列表与学习工具'];

function safeURL(path) {
  if (!path) return '';
  try {
    const url = new URL(String(path), document.baseURI);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}
function notify(message, duration = 4200) {
  const toast = $('#toast');
  clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  state.toastTimer = setTimeout(() => { toast.hidden = true; }, duration);
}
function saveReading() {
  state.library?.remember(state.book,{page:state.page,id:state.readingId});
}
function bookData(book = state.book) { return state.data.catalog?.books?.[book]; }
function renderBookPicker() {
  if (!state.library) return;
  const seriesId = state.library.seriesFor(state.book);
  renderStudyPicker();
  const books = state.library.booksFor(seriesId);
  $('#book-switch').hidden = books.length < 2;
  $('#book-switch').innerHTML = books.map(book => `<button data-book="${escapeHTML(book)}" class="${book === state.book ? 'selected' : ''}" aria-pressed="${book === state.book}">${escapeHTML(bookData(book).label || (bookData(book).kind === 'workbook' || book === 'workbook' ? '练习册' : '教材'))}</button>`).join('');
}
function switchBook(book) {
  if (!bookData(book) || book === state.book) return;
  saveReading();
  ++state.audioToken;
  audio.pause();
  $('#audio-dock').hidden = true;
  document.body.classList.remove('audio-open');
  state.book = book;
  const position = state.library.positionFor(book);
  state.page = position.page;
  state.readingId = position.id;
  const current = findEntry(state.readingId);
  if (current) state.expanded.add(`${book}:${current.chapter.id}`);
  if (state.view === 'reading') { updateReadingTitle(); renderTOC(); renderPDF(); renderLessons(); }
  saveReading();
}
function allChapters(book = state.book) {
  const data = bookData(book);
  return [...(data?.chapters || []), ...(data?.appendices || [])];
}
function findEntry(id, book = state.book) {
  for (const chapter of allChapters(book)) {
    if (str(chapter.id) === str(id)) return {entry:chapter,chapter};
    const section = (chapter.sections || []).find(item => str(item.id) === str(id));
    if (section) return {entry:section,chapter};
  }
  return null;
}
function chapterAudio(chapter) {
  if (!chapter) return null;
  const id = str(chapter.id);
  return state.data.audio?.chapters?.[id] || state.data.audio?.chapters?.[id.replace(/^chapter[-_]?/, '')] || null;
}
function missingEntryAudio(entry, chapter) {
  return (chapterAudio(chapter)?.missingSections || []).find(item => str(item.id) === str(entry.id));
}
function entryAudio(entry, chapter) {
  const data = chapterAudio(chapter);
  if (!data) return null;
  if (str(entry.id) === str(chapter.id)) return data.file ? {...data, start:0, end:data.duration} : null;
  const section = data.sections?.[str(entry.id)];
  if (!section || section.unavailable) return null;
  if (missingEntryAudio(entry,chapter) && !(section.kind === 'synthetic' && section.file)) return null;
  return {...section, file:section.file || data.file, clip:!section.file};
}
function activeChapter(book = state.book) {
  let current = null;
  for (const chapter of allChapters(book)) {
    if (Number(chapter.page) <= state.page && (!current || Number(chapter.page) >= Number(current.page))) current = chapter;
  }
  return current || allChapters(book)[0];
}
function closestEntry() {
  let current;
  for (const chapter of allChapters()) {
    for (const entry of [chapter, ...(chapter.sections || [])]) {
      if (Number(entry.page) <= state.page && (!current || Number(entry.page) >= Number(current.page))) current = entry;
    }
  }
  return current;
}
function entryNumber(entry, isChapter = false) {
  const id = str(entry.number ?? entry.id);
  return /^(?:[\d.]+|\d+\.[A-Z])$/.test(id) ? (isChapter ? id.padStart(2,'0') : id) : '';
}
// The directory slides over the page on phones, portrait tablets and phones held sideways (same queries as styles.css).
const DRAWER = '(max-width: 720px), (max-width: 1024px) and (orientation: portrait), (max-height: 520px)';
const drawerMode = () => window.matchMedia(DRAWER).matches;
let sidebarOpen = false;
function closeSidebar() {
  const sidebar = $('#sidebar'), wasOpen = sidebarOpen;
  const hadFocus = wasOpen && sidebar.contains(document.activeElement);
  sidebarOpen = false;
  sidebar.classList.remove('open');
  sidebar.inert = drawerMode();
  for (const behind of $$('.site-header, #main, #audio-dock')) behind.inert = false;
  $('#sidebar-shade').hidden = true;
  $('#open-sidebar').setAttribute('aria-expanded','false');
  if (!wasOpen) return;
  closeLayer('sidebar');
  if (hadFocus) $('#open-sidebar').focus({preventScroll:true});
}
function openSidebar() {
  sidebarOpen = true;
  $('#sidebar').inert = false;
  // The page behind the drawer is out of reach while it is open, for touch, Tab and screen readers alike.
  for (const behind of $$('.site-header, #main, #audio-dock')) behind.inert = true;
  $('#sidebar').classList.add('open');
  $('#sidebar-shade').hidden = false;
  $('#open-sidebar').setAttribute('aria-expanded','true');
  openLayer('sidebar',closeSidebar);
  $('#close-sidebar').focus({preventScroll:true});
}
// Back closes the topmost layer (directory, stage, playlist, word card) before it leaves the page. Each open layer
// owns one history entry; closing it from the page drops that entry again and keeps any address set meanwhile.
const layers = {stack:[],pending:0,skip:0,restore:''};
function openLayer(name,close) {
  if (layers.stack.some(layer => layer.name === name)) return;
  layers.stack.push({name,close});
  // A layer closed in the same moment hands its entry over instead of leaving it behind.
  if (layers.pending) { layers.pending--; return; }
  try { history.pushState(history.state,'',location.href); } catch { /* Back then simply leaves the page. */ }
}
function closeLayer(name) {
  const index = layers.stack.findIndex(layer => layer.name === name);
  if (index < 0) return;
  layers.stack.splice(index,1);
  if (++layers.pending > 1) return;
  setTimeout(() => {
    const steps = layers.pending;
    layers.pending = 0;
    if (!steps) return;
    layers.skip++;
    layers.restore = location.href;
    try { history.go(-steps); } catch { layers.skip--; layers.restore = ''; }
  },0);
}
window.addEventListener('popstate',() => {
  if (layers.skip) {
    layers.skip--;
    if (layers.restore && location.href !== layers.restore) history.replaceState(history.state,'',layers.restore);
    layers.restore = '';
    return;
  }
  layers.stack.pop()?.close();
});
function compareSeed() {
  const seed = {};
  saveReading();
  const currentChapter = findEntry(state.readingId)?.chapter;
  for (const book of state.library.booksFor(state.library.seriesFor(state.book))) {
    const match = findEntry(state.readingId,book) || findEntry(currentChapter?.id,book);
    const first = allChapters(book)[0];
    seed[book] = book === state.book ? {page:state.page,id:state.readingId} : state.library.hasPosition(book) ? state.library.positionFor(book) : {page:Number(match?.entry.page || first?.page) || 1,id:str(match?.entry.id || first?.id)};
  }
  return seed;
}
function rememberComparePositions(positions) {
  if (!state.library) return;
  saveReading();
  for (const position of Object.values(positions || {})) {
    if (position?.book) state.library.remember(position.book,position,false);
  }
  const position = Object.values(positions || {}).find(item => item?.book === state.book) || positions?.workbook;
  if (position?.book && bookData(position.book)) {
    state.book = position.book;
    state.page = position.page;
    state.readingId = str(position.id);
    const current = findEntry(state.readingId);
    if (current) state.expanded.add(`${state.book}:${current.chapter.id}`);
    saveReading();
  }
}
async function setView(view, updateHash = true) {
  if (!labels[view]) view = 'reading';
  const run = ++state.viewRun;
  clearTimeout(searchTimer);
  clearListPrefetch();
  wordClips.prefetch.clear();
  if (state.view === 'practice' && view !== 'practice') { window.NorskPractice?.hide(); pauseOtherAudio(); }
  if (state.view === 'more' && view !== 'more') window.NorskMore?.hide();
  if (state.view === 'vocabulary' && view !== 'vocabulary') window.NorskWordbook?.hide();
  if (state.view === 'compare' && view !== 'compare') {
    rememberComparePositions(window.NorskCompare?.positions?.());
    $('#word-audio').before($('#audio-dock'));
    window.NorskCompare?.hide();
  }
  if (state.view === 'reading' && view !== 'reading') {
    window.NorskReader?.hide();
    ++state.pdfRun;
    state.pdfLayoutKey = '';
    try { state.renderTask?.cancel(); } catch {}
    state.renderTask = null;
    document.body.classList.remove('reader-focus');
  }
  state.view = view;
  document.body.dataset.view = view;
  if (view === 'practice') {
    ++state.audioToken; audio.pause();
    $('#audio-dock').hidden = true;
    document.body.classList.remove('audio-open');
  }
  $$('.nav-button').forEach(button => {
    const active = button.dataset.view === (view === 'compare' ? 'reading' : view);
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  for (const name of Object.keys(labels)) $(`#${name}-view`).hidden = name !== view;
  $('#content-eyebrow').textContent = labels[view][0];
  $('#heading-note').textContent = labels[view][2];
  toggleSettings(false);
  toggleSeriesMenu(false);
  $('#heading-search').classList.toggle('open',!!activeSearch().value);
  $('#search-button').setAttribute('aria-expanded',str(!!activeSearch().value));
  $('#search-button').setAttribute('aria-label',activeSearch().value ? '关闭搜索' : '搜索');
  renderStudyPicker();
  $('#sidebar-label').textContent = view === 'basics' ? '基础知识' : view === 'practice' ? '我的练习' : view === 'more' ? '更多' : '学习目录';
  $('#sidebar-subtitle').textContent = view === 'basics' ? '从入门到进阶，依次学习。' : view === 'vocabulary' ? (state.wordbookActive ? '自己整理的单词和句子' : `${activeSeriesTitle()} · 教材词汇`) : view === 'practice' ? '选一组词语，每天复习一点。' : view === 'more' ? '徽章、奖杯与随身听。' : '循着目录，慢慢学会。';
  $('#content-title').textContent = labels[view][1];
  const hash = view === 'more' ? `#more/${state.moreTab}` : `#${view}`;
  if (updateHash && location.hash !== hash) history.replaceState(null,'',hash);
  window.scrollTo(0,0);
  closeSidebar();
  if (state.ready) {
    if (view === 'vocabulary' && !state.wordbookActive && (!state.data.vocabulary || state.vocabularySeriesId !== activeSeriesId())) $('#vocab-rows').innerHTML = loading('正在载入词表目录…');
    if (view === 'vocabulary' && state.wordbookActive && !window.NorskWordbook) $('#vocab-rows').innerHTML = loading('正在打开我的词本…');
    if (view === 'basics' && !state.data.basics) $('#basics-items').innerHTML = loading('正在载入基础知识…');
    if (view === 'practice' && (!state.practiceInitialized || state.practiceSeriesId !== activeSeriesId())) $('#practice-view').innerHTML = loading('正在准备练习词语…');
    if (view === 'compare' && !state.compareInitialized) $('#compare-view').innerHTML = loading('正在准备双页对照…');
    if (view === 'more' && !state.moreInitialized) $('#more-view').innerHTML = loading('正在准备…');
    if (!['reading','compare'].includes(view)) $('#toc').innerHTML = loading('正在准备目录…');
    try { await prepareView(view,run); }
    catch(error) { if (run === state.viewRun) viewError(view,error); return; }
    if (run !== state.viewRun) return;
    renderTOC();
    if (view === 'reading') { updateReadingTitle(); renderPDF(); renderLessons(); }
    if (view === 'vocabulary') renderVocabulary();
    if (view === 'basics') renderBasics();
    if (view === 'practice') {
      $('#content-title').textContent = `${activeSeriesTitle()} · 练习`;
      window.NorskPractice?.show();
      if (state.pendingDuel) { const {join} = state.pendingDuel; state.pendingDuel = null; openDuel(join); }
    }
    if (view === 'more') window.NorskMore?.show(state.moreTab);
    if (view === 'compare') {
      $('#content-title').textContent = labels.compare[1];
      $('#compare-view').append($('#audio-dock'));
      window.NorskCompare?.show(compareSeed(),{seriesId:state.library.seriesFor(state.book)});
    }
  }
}

function renderTOC() {
  const toc = $('#toc');
  if (state.view === 'compare') return;
  if (state.view === 'practice') { toc.innerHTML = window.NorskPractice?.renderTOC() || ''; return; }
  if (state.view === 'more') { toc.innerHTML = window.NorskMore?.renderTOC(state.moreTab) || ''; return; }
  if (state.view === 'vocabulary' && state.wordbookActive) { toc.innerHTML = window.NorskWordbook?.renderTOC() || ''; return; }
  if (state.view === 'basics') {
    const categories = state.data.basics?.categories || [];
    toc.innerHTML = categories.length ? categories.map((category,index) => `<button class="toc-basic ${str(category.id) === state.basicId ? 'selected' : ''}" data-action="category" data-id="${escapeHTML(category.id)}" ${str(category.id) === state.basicId ? 'aria-current="true"' : ''}><span class="category-index">${str(index+1).padStart(2,'0')}</span><span>${escapeHTML(category.title)}${category.levelLabel ? `<small class="category-level">${escapeHTML(category.levelLabel)}</small>` : ''}</span><span class="category-count">${(category.items || []).length}</span></button>`).join('') : empty('基础知识暂未载入');
    return;
  }
  const tocBook = state.view === 'vocabulary' ? vocabularyBook() : state.book;
  const selected = state.view === 'vocabulary' ? state.vocabularyId : state.readingId;
  const book = bookData(tocBook);
  if (!book) { toc.innerHTML = empty('目录载入失败','请刷新页面重试'); return; }
  const chapters = state.view === 'vocabulary' ? (state.data.vocabulary?.chapters || []).map(chapter => {
    const catalogChapter = (book.chapters || []).find(item => str(item.id) === str(chapter.readingId ?? chapter.number ?? chapter.id));
    return {...catalogChapter,...chapter,sections:(chapter.sections || []).map(section => {
      const catalogSection = (catalogChapter?.sections || []).find(item => str(item.id) === str(section.readingId ?? section.number ?? section.id));
      return {...catalogSection,...section};
    })};
  }) : allChapters(tocBook);
  if (!chapters.length) { toc.innerHTML = empty('词表目录暂未载入','请刷新页面重试'); return; }
  toc.innerHTML = chapters.map((chapter,index) => {
    const isAppendix = index === (book.chapters || []).length;
    const expanded = state.expanded.has(`${tocBook}:${chapter.id}`) || str(chapter.id) === str(findEntry(selected,tocBook)?.chapter?.id);
    const sections = chapter.sections || [];
    return `${isAppendix && (book.appendices || []).length ? '<div class="toc-divider">APPENDIX · 附录</div>' : ''}<div class="toc-group ${expanded ? 'expanded' : ''}"><div class="toc-chapter ${selected === str(chapter.id) ? 'active' : ''}"><button class="toc-toggle" data-action="expand" data-id="${escapeHTML(chapter.id)}" data-book="${tocBook}" aria-label="${expanded ? '收起' : '展开'}${escapeHTML(chapter.title)}" aria-expanded="${expanded}" ${sections.length ? '' : 'style="visibility:hidden"'}>${icon('chevron')}</button>${tocEntry(chapter,chapter,tocBook,true,selected)}</div>${sections.length ? `<div class="toc-sections">${sections.map(section => `<div class="toc-section ${selected === str(section.id) ? 'active' : ''}">${tocEntry(section,chapter,tocBook,false,selected)}</div>`).join('')}</div>` : ''}</div>`;
  }).join('');
}
function tocEntry(entry,chapter,book,isChapter,selected) {
  const playable = book === 'textbook' && state.view === 'reading';
  const recording = playable ? entryAudio(entry,chapter) : null;
  const missing = playable ? missingEntryAudio(entry,chapter) : null;
  const synthetic = recording?.kind === 'synthetic';
  const audioLabel = synthetic ? `播放 ${entry.title} · 合成补读（原录音缺失）` : recording ? `播放 ${entry.title}` : missing ? `原录音缺失：${missing.reason || entry.title}` : '未提供本节录音';
  const audioNote = synthetic ? '合成补读' : missing ? '原录音缺失' : '';
  const page = entry.printedPage ?? '';
  return `<button class="toc-title" data-action="select-entry" data-id="${escapeHTML(entry.id)}" data-book="${book}" ${selected === str(entry.id) ? 'aria-current="true"' : ''}><span class="toc-number">${escapeHTML(entryNumber(entry,isChapter))}</span><span class="toc-label">${escapeHTML(entry.title)}${audioNote ? `<span class="toc-audio-note">${audioNote}</span>` : ''}</span></button>${state.view === 'reading' ? `<span class="toc-page" title="印刷页码">${escapeHTML(page)}</span>` : ''}${playable ? `<button class="toc-audio" data-action="entry-audio" data-id="${escapeHTML(entry.id)}" title="${escapeHTML(audioLabel)}" aria-label="${escapeHTML(audioLabel)}" ${recording ? '' : 'disabled'}>${icon('play')}</button>` : ''}`;
}
function selectEntry(id,book = state.book) {
  if (state.view === 'vocabulary') {
    const chapter = state.data.vocabulary?.chapters.find(item => str(item.id) === str(id) || (item.sections || []).some(section => str(section.id) === str(id)));
    if (!chapter) return;
    state.expanded.add(`${vocabularyBook()}:${chapter.id}`);
    state.vocabularyId = str(id);
    state.vocabularySelections.set(activeSeriesId(),state.vocabularyId);
    $('#vocab-search').value = '';
    renderVocabulary();
  } else {
    const found = findEntry(id,book);
    if (!found) return;
    state.expanded.add(`${book}:${found.chapter.id}`);
    if (state.book !== book) switchBook(book);
    state.readingId = str(id);
    state.page = Math.max(1,Number(found.entry.page) || 1);
    updateReadingTitle(); renderPDF(); renderLessons(); saveReading();
  }
  renderTOC();
  closeSidebar();
}
function updateReadingTitle() {
  const book = bookData();
  const entry = findEntry(state.readingId)?.entry;
  const series = state.library?.series.find(item => item.id === state.library.seriesFor(state.book));
  $('#content-title').textContent = series?.title || '阅读';
  $('#reader-book-title').textContent = book?.title || '教材';
  renderBookPicker();
  $('#reader-section-title').textContent = entry?.title || '开始阅读';
  $('#page-total').textContent = `/ ${book?.pages || '—'}`;
  $('#page-input').value = state.page;
  $('#page-input').max = book?.pages || 999;
  $('#prev-page').disabled = state.page <= 1;
  $('#next-page').disabled = state.page >= Number(book?.pages || 1);
  $$('[data-book]', $('#book-switch')).forEach(button => button.classList.toggle('selected', button.dataset.book === state.book));
  const chapter = findEntry(state.readingId)?.chapter || activeChapter();
  const missing = state.book === 'textbook' ? chapterAudio(chapter)?.missingSections || [] : [];
  const audioNote = $('#reading-audio-note');
  if (state.audioError && state.book === 'textbook') {
    audioNote.hidden = false;
    audioNote.innerHTML = '课文录音目录暂时未载入。<button class="text-button" data-action="retry-audio">重新载入</button>';
    return;
  }
  audioNote.hidden = !missing.length;
  if (missing.length) {
    const synthesized = missing.filter(item => chapterAudio(chapter)?.sections?.[str(item.id)]?.kind === 'synthetic' && chapterAudio(chapter)?.sections?.[str(item.id)]?.file);
    const ids = missing.map(item => item.id).join('、');
    audioNote.textContent = synthesized.length === missing.length ? `原录音缺少 ${ids}，现提供明确标注的合成补读。` : synthesized.length ? `原录音缺少 ${ids}。${synthesized.map(item => item.id).join('、')} 现提供合成补读，其余缺失小节暂无法播放。` : `原录音缺失：${ids}。提供的第 ${chapter.id} 章音频未包含这些小节，对应播放按钮已停用。`;
  }
}
function showPDFMessage(message, detail = '', retry = false) {
  const box = $('#pdf-message');
  box.innerHTML = `${retry ? icon('file') : '<span class="loader"></span>'}<p>${escapeHTML(message)}</p>${detail ? `<span class="error-detail">${escapeHTML(detail)}</span>` : ''}${retry ? '<button data-action="retry-pdf">重新载入</button>' : ''}`;
  box.hidden = false;
  $('#pdf-canvas').hidden = true;
}
function documentPart(page,book) {
  const manifest = state.data.documents?.[book];
  const parts = Array.isArray(manifest) ? manifest : manifest?.parts;
  if (parts?.length) return parts.find(part => page >= Number(part.startPage) && page <= Number(part.endPage));
  const source = bookData(book);
  return source?.file ? {file:source.file,startPage:1,endPage:source.pages} : null;
}
async function getPDF(file) {
  const source = safeURL(file);
  if (!source) throw new Error('PDF 文件路径无效');
  const requestURL = new URL(source);
  requestURL.searchParams.set('v',VERSION);
  const url = requestURL.href;
  if (state.pdfCache.has(url)) return state.pdfCache.get(url);
  if (!pdfjsPromise) pdfjsPromise = import('./vendor/pdf.mjs?v=20261029-background-audio').then(module => {
    module.GlobalWorkerOptions.workerSrc = new URL(`./vendor/pdf.worker.mjs?v=${VERSION}`,document.baseURI).href;
    return module;
  }).catch(error => { pdfjsPromise = null; throw error; });
  const promise = pdfjsPromise.then(pdfjs => pdfjs.getDocument({url, isEvalSupported:false, disableStream:true, disableAutoFetch:true, rangeChunkSize:131072}).promise);
  state.pdfCache.set(url,promise);
  try { return await promise; }
  catch (error) { state.pdfCache.delete(url); throw error; }
}
async function renderPDF() {
  if (state.view !== 'reading') return;
  applyReadMode();
  if (readingTextMode()) {
    ++state.pdfRun;
    state.pdfLayoutKey = '';
    if (state.renderTask) { try { state.renderTask.cancel(); } catch {} state.renderTask = null; }
    showReaderText();
    return;
  }
  const stage = $('#pdf-stage');
  const layoutKey = [state.book,state.page,$('#zoom-select').value,stage.clientWidth,stage.clientHeight,window.devicePixelRatio || 1].join(':');
  if (state.pdfLayoutKey === layoutKey) return;
  state.pdfLayoutKey = layoutKey;
  const run = ++state.pdfRun;
  if (state.renderTask) { try { state.renderTask.cancel(); } catch {} state.renderTask = null; }
  const part = documentPart(state.page,state.book);
  if (!part) { state.pdfLayoutKey = ''; showPDFMessage('这一页的 PDF 尚未准备好','请稍后刷新页面，或选择其他章节。',true); return; }
  $('#pdf-download').href = safeURL(part.file);
  showPDFMessage('正在载入这一页…');
  try {
    const pdf = await getPDF(part.file);
    if (run !== state.pdfRun) return;
    const page = await pdf.getPage(state.page - Number(part.startPage) + 1);
    if (run !== state.pdfRun) return;
    const style = getComputedStyle(stage);
    const available = Math.max(160, stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2);
    const availableHeight = Math.max(80, stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - 2);
    const natural = page.getViewport({scale:1});
    const choice = $('#zoom-select').value;
    const scale = choice === 'fit' ? Math.min(available / natural.width, availableHeight / natural.height) : choice === 'width' ? available / natural.width : Number(choice);
    state.pdfScale = scale;
    const viewport = page.getViewport({scale});
    const ratio = Math.min(window.devicePixelRatio || 1,2,Math.sqrt(16000000/(viewport.width*viewport.height)));
    const canvas = $('#pdf-canvas');
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    canvas.setAttribute('aria-label',`${bookData()?.title || 'PDF'}，PDF 第 ${state.page} 页`);
    stage.style.justifyContent = viewport.width > available ? 'flex-start' : 'center';
    stage.style.alignItems = viewport.height > availableHeight ? 'flex-start' : 'center';
    const task = page.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio !== 1 ? [ratio,0,0,ratio,0,0] : null});
    state.renderTask = task;
    await task.promise;
    if (run !== state.pdfRun) return;
    state.renderTask = null;
    $('#pdf-message').hidden = true;
    canvas.hidden = false;
    stage.scrollTop = 0;
    stage.scrollLeft = 0;
  } catch(error) {
    if (run !== state.pdfRun || error?.name === 'RenderingCancelledException') return;
    state.pdfLayoutKey = '';
    console.error('PDF 加载失败',error);
    // A short technical note lets a reader report what failed on their device.
    const reason = error?.message ? `（${String(error.name || 'Error')}: ${String(error.message).slice(0,80)}）` : '';
    showPDFMessage('页面暂时无法显示',`请检查网络后重试；也可点击右上角下载当前 PDF 分册阅读。${reason}`,true);
  }
}
function changeZoom(direction) {
  const select = $('#zoom-select');
  const scale = Math.min(4, Math.max(.2, Math.round((state.pdfScale + direction * .2) * 100) / 100));
  let option = [...select.options].find(item => Number(item.value) === scale);
  if (!option) {
    option = $('#zoom-custom') || document.createElement('option');
    option.id = 'zoom-custom'; option.value = String(scale); option.textContent = `${Math.round(scale * 100)}%`;
    select.append(option);
  }
  select.value = String(scale);
  renderPDF();
}
function goPage(value) {
  const total = Number(bookData()?.pages) || 1;
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1 || page > total) {
    notify(`请输入 1 到 ${total} 之间的 PDF 页码。`);
    $('#page-input').value = state.page;
    return;
  }
  state.page = page;
  const closest = closestEntry();
  state.readingId = str(closest?.id || '');
  if (closest) {
    const found = findEntry(closest.id);
    if (found) state.expanded.add(`${state.book}:${found.chapter.id}`);
  }
  updateReadingTitle(); renderTOC(); renderPDF(); renderLessons(); saveReading();
}

// Class materials are rarely needed, so they stay out of the page until the toolbar button asks for them.
function showLessons(shown) {
  state.lessonsShown = shown;
  $('#lesson-toggle').setAttribute('aria-expanded',str(shown));
  $('#lesson-materials').hidden = !shown || state.book !== 'textbook';
  $('#lesson-materials').open = shown;
}
async function renderLessons() {
  $('#lesson-toggle').hidden = state.book !== 'textbook';
  $('#lesson-materials').hidden = state.book !== 'textbook' || !state.lessonsShown;
  if (state.book !== 'textbook') return;
  if (!state.data.lessons) {
    if (!$('#lesson-materials').open) return;
    $('#lesson-list').innerHTML = loading('正在载入课堂资料…');
    try { await loadData('lessons'); }
    catch(error) {
      console.warn('课堂资料未载入',error);
      $('#lesson-list').innerHTML = `${empty('课堂资料暂时无法载入')}<button class="text-button" data-action="retry-lessons">重新载入</button>`;
      return;
    }
  }
  const lessons = state.data.lessons?.lessons || [];
  const chapter = findEntry(state.readingId)?.chapter || activeChapter();
  const matches = state.book === 'textbook' ? lessons.filter(lesson => str(lesson.chapter) === str(chapter?.id)) : [];
  $('#lesson-count').textContent = matches.length ? `${matches.length} 份资料` : '';
  $('#lesson-list').innerHTML = matches.length ? matches.map(lesson => {
    const slides = lesson.slides || [];
    return `<article class="lesson-item"><div class="lesson-item-heading"><span>${escapeHTML(lesson.title)}</span>${lesson.file ? `<a class="lesson-download" href="${escapeHTML(safeURL(lesson.file))}" download>${icon('download')}下载原 PPT</a>` : ''}</div>${slides.length ? `<details class="lesson-slide-details"><summary>查看课堂内容 · ${slides.length} 页</summary><div class="lesson-slides">${slides.map((slide,index) => `<div class="lesson-slide"><strong>${escapeHTML(slide.title || `第 ${index+1} 页`)}</strong>${escapeHTML(slide.text || '')}</div>`).join('')}</div></details>` : ''}</article>`;
  }).join('') : '<p class="muted" style="font-size:11px;margin:0">本章没有附加课堂资料。选择其他章节可查看对应 PPT。</p>';
}
function vocabularySelection() {
  const chapters = state.data.vocabulary?.chapters || [];
  for (const chapter of chapters) {
    if (str(chapter.id) === state.vocabularyId) {
      const words = chapter.words || (chapter.sections || []).flatMap(section => (section.words || []).map(word => ({...word,sectionId:section.id,sectionTitle:section.title})));
      const seen = new Set();
      return {title:chapter.title,words:words.filter(word => { const key = str(word.word).toLocaleLowerCase('nb'); if (!key || seen.has(key)) return false; seen.add(key); return true; })};
    }
    const section = (chapter.sections || []).find(section => str(section.id) === state.vocabularyId);
    if (section) return {title:section.title,words:(section.words || []).map(word => ({...word,sectionId:section.id,sectionTitle:section.title}))};
  }
  return {title:findEntry(state.vocabularyId,vocabularyBook())?.entry?.title || '单词表',words:[]};
}
function phonetics(item) {
  const syllables = Array.isArray(item.syllables) ? item.syllables.join(' · ') : item.syllables;
  return `<div class="word-phonetics">${syllables ? `<span class="syllables" title="音节">${escapeHTML(syllables)}</span>` : ''}${item.ipa ? `<span class="ipa" title="国际音标">${escapeHTML(item.ipa)}</span>` : ''}</div>`;
}
function wordRateControl(word = '') {
  return `<label class="word-rate-control${word ? ' compact' : ''}"><span${word ? ' class="sr-only"' : ''}>读速</span><select data-word-rate aria-label="${escapeHTML(word ? `${word} 的读速` : '单词读速')}" title="单词读速，所有单词同步">${wordRates.map(rate => `<option value="${rate}"${rate === state.wordRate ? ' selected' : ''}>${rate}×</option>`).join('')}</select></label>`;
}
function setWordRate(value) {
  const rate = Number(value);
  if (!wordRates.includes(rate)) return;
  state.wordRate = rate;
  pronunciationAudio.defaultPlaybackRate = rate;
  pronunciationAudio.playbackRate = rate;
  pronunciationAudio.preservesPitch = true;
  $$('[data-word-rate]').forEach(select => { select.value = String(rate); });
  renderRateOptions();
  try { localStorage.setItem('norsk-word-rate-v1',String(rate)); } catch {}
  if (state.speechItem && 'speechSynthesis' in window && speechSynthesis.speaking && !speechSynthesis.paused) pronounce(state.speechItem);
}
function wordGrammar(item) {
  const genders = {m:'阳性',f:'阴性',n:'中性','m/f':'阴性 / 阳性','f/m':'阴性 / 阳性','m/n':'阳性 / 中性','f/n':'阴性 / 中性'};
  const gender = genders[item.gender] || item.gender;
  const details = [item.pos,gender,item.article].filter(Boolean);
  const sourceForms = item.formsExpanded?.length ? item.formsExpanded : item.forms;
  const forms = Array.isArray(sourceForms) ? sourceForms.join(' · ') : typeof sourceForms === 'string' ? sourceForms : '';
  return `${details.length ? `<p class="word-grammar">${details.map(escapeHTML).join(' · ')}</p>` : ''}${forms ? `<p class="word-grammar">变化：${escapeHTML(forms)}</p>` : ''}${item.usage ? `<p class="word-grammar">${escapeHTML(typeof item.usage === 'string' ? item.usage : '')}</p>` : ''}`;
}
function highlightedSentence(sentence,word) {
  if (!sentence) return '';
  const target = str(word).replace(/^(?:en|ei|et|å)\s+/i,'').trim();
  if (!target) return escapeHTML(sentence);
  const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  try {
    const expression = new RegExp(`(?<![\\p{L}\\p{N}])(${escapedTarget})(?![\\p{L}\\p{N}])`,'giu');
    return str(sentence).split(expression).map((part,index) => index % 2 ? `<mark>${escapeHTML(part)}</mark>` : escapeHTML(part)).join('');
  } catch { return escapeHTML(sentence); }
}
function vocabularyExample(word) {
  if (word.sentence) return highlightedSentence(word.sentence,word.word);
  if (word.example) return `<span class="example-label">学习例句</span>${highlightedSentence(word.example,word.word)}`;
  return '<span class="muted">可点击原词表查看用法。</span>';
}
async function renderVocabulary() {
  if (state.wordbookActive) { if (state.view === 'vocabulary') window.NorskWordbook?.render(); return; }
  if (state.view !== 'vocabulary' || !state.data.vocabulary || state.vocabularySeriesId !== activeSeriesId()) return;
  const id = state.vocabularyId;
  const seriesId = activeSeriesId();
  const run = state.viewRun;
  const chapter = state.data.vocabulary.chapters.find(chapter => str(chapter.id) === id || (chapter.sections || []).some(section => str(section.id) === id));
  if (chapter && !Array.isArray(chapter.words)) {
    state.words = [];
    $('#word-count').textContent = '—';
    $('#vocab-rows').innerHTML = loading('正在载入本章词语…');
    try { await vocabularyChapter(id,seriesId); }
    catch(error) { if (run === state.viewRun && id === state.vocabularyId) viewError('vocabulary',error); return; }
    if (run !== state.viewRun || id !== state.vocabularyId) return;
  }
  const selection = vocabularySelection();
  const query = $('#vocab-search').value.trim().toLocaleLowerCase('nb');
  const order = state.vocabSort || 'easy';
  state.words = selection.words.filter(word => !query || [word.word,word.meaning,word.sentence,word.example,word.usage,word.syllables,word.ipa].some(value => str(value).toLocaleLowerCase('nb').includes(query)));
  state.words.sort((a,b) => order === 'alpha' ? compareWords(str(a.word),str(b.word)) : ((Number(a.difficulty) || 3) - (Number(b.difficulty) || 3)) * (order === 'hard' ? -1 : 1) || compareWords(str(a.word),str(b.word)));
  $('#content-title').textContent = selection.title || '单词表';
  $('#word-count').textContent = state.words.length;
  const difficultyLabels = ['','入门','基础','常用','进阶','拓展'];
  $('#vocab-rows').innerHTML = state.words.length ? state.words.map((word,index) => `<article class="vocab-row"><div class="word-cell"><div class="word-topline"><span class="word-spelling" lang="nb">${escapeHTML(word.word)}</span><button class="word-pronounce" data-action="pronounce" data-kind="vocabulary" data-index="${index}" aria-label="播放 ${escapeHTML(word.word)} 的读音">${icon('volume')}</button><span class="difficulty">${difficultyLabels[Number(word.difficulty)] || '常用'}</span></div><p class="word-meaning">${escapeHTML(word.meaning)}</p><div class="word-details">${phonetics(word)}${wordGrammar(word)}</div></div><div class="sentence-cell"><p class="sentence" lang="nb">${vocabularyExample(word)}</p><div class="sentence-ref"><span>${escapeHTML(word.sectionTitle || selection.title || '')}</span>${word.page ? `<button data-action="sentence-page" data-book="${escapeHTML(vocabularyBook())}" data-page="${Number(word.page)}" title="前往教材对应页">${word.sentenceSource === 'ordliste' ? '词表' : '课文'} PDF 第 ${Number(word.page)} 页 ↗</button>` : ''}${word.sourcePage ? `<button data-action="sentence-page" data-book="${escapeHTML(vocabularyBook())}" data-page="${Number(word.sourcePage)}" title="查看教材原页">原词表 ↗</button>` : ''}</div></div></article>`).join('') : empty(query ? '没有找到这个词语' : '本小节暂无词条',query ? '试试其他单词或中文释义。' : '可在目录中选择其他小节或整章词汇。');
  prefetchListWords($('#vocab-rows'));
}
function renderBasics() {
  const categories = state.data.basics?.categories || [];
  const category = categories.find(item => str(item.id) === state.basicId) || categories[0];
  if (!category) {
    $('#basics-items').innerHTML = empty('基础知识暂未载入');
    return;
  }
  state.basicId = str(category.id);
  $('#content-title').textContent = category.title;
  $('#content-eyebrow').textContent = category.subtitle || labels.basics[0];
  $('#basics-description').textContent = category.description || '';
  $('#basics-description').hidden = !category.description;
  const query = $('#basics-search').value.trim().toLocaleLowerCase('nb');
  state.basicItems = (category.items || []).filter(item => !query || [item.word,item.meaning,item.note,item.example,item.ipa].some(value => str(value).toLocaleLowerCase('nb').includes(query)));
  // Categories with sentences or long compounds get one card per row on phones, so words do not break mid-word.
  $('#basics-items').classList.toggle('is-wide',(category.items || []).some(item => str(item.word).length > 16 || str(item.word).split(/\s+/).some(part => part.length > 10)));
  $('#basics-items').innerHTML = state.basicItems.length ? state.basicItems.map((item,index) => `<article class="basic-card"><div class="word-topline"><span class="word-spelling" lang="nb">${escapeHTML(item.word)}</span><button class="word-pronounce" data-action="pronounce" data-kind="basics" data-index="${index}" aria-label="播放 ${escapeHTML(item.word)} 的读音">${icon('volume')}</button></div><p class="word-meaning">${escapeHTML(item.meaning)}</p>${phonetics(item)}${item.note ? `<p class="basic-note">${escapeHTML(item.note)}</p>` : ''}${item.example ? `<p class="basic-example" lang="nb">${escapeHTML(item.example)}</p>` : ''}</article>`).join('') : `<div style="grid-column:1/-1">${empty('没有找到匹配内容','试试其他单词或中文释义。')}</div>`;
  prefetchListWords($('#basics-items'));
}

// Word recordings are fetched once and kept in memory. At normal speed they are decoded and
// played through Web Audio, which starts at once; other speeds use the media element so the
// pitch is preserved, playing from memory when the clip has been fetched.
const wordClips = {context:null,bytes:new Map(),loading:new Map(),decoding:new Map(),buffers:new Map(),objectURLs:new Map(),source:null,prefetch:new Map(),prefetchActive:0};
const WORD_BYTES_LIMIT = 400, WORD_BUFFER_LIMIT = 60;
// iOS mutes Web Audio with the ring/silent switch unless the page asks for playback audio.
let wordWebAudio;
function wordWebAudioAllowed() {
  if (wordWebAudio !== undefined) return wordWebAudio;
  if (navigator.audioSession) { try { navigator.audioSession.type = 'playback'; } catch {} return wordWebAudio = true; }
  return wordWebAudio = !(/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
}
function wordAudioContext() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext || !wordWebAudioAllowed()) return null;
  if (!wordClips.context || wordClips.context.state === 'closed') {
    try { wordClips.context = new AudioContext(); } catch { wordClips.context = null; }
  }
  return wordClips.context;
}
function pronunciationSource(item) {
  const table = state.data.pronunciation || {};
  const path = item?.audio || table[item?.word] || table[str(item?.word).toLocaleLowerCase('nb')] || table.words?.[item?.word] || wordbookClip(item?.word);
  return path ? safeURL(typeof path === 'string' ? path : path.file) : '';
}
function rememberWordClip(url,bytes) {
  wordClips.bytes.set(url,bytes);
  while (wordClips.bytes.size > WORD_BYTES_LIMIT) {
    const oldest = wordClips.bytes.keys().next().value;
    wordClips.bytes.delete(oldest);
    if (wordClips.objectURLs.has(oldest) && pronunciationAudio.src !== wordClips.objectURLs.get(oldest)) { URL.revokeObjectURL(wordClips.objectURLs.get(oldest)); wordClips.objectURLs.delete(oldest); }
  }
}
function loadWordClip(url) {
  wordClips.prefetch.delete(url);
  if (wordClips.bytes.has(url)) {
    const bytes = wordClips.bytes.get(url);
    wordClips.bytes.delete(url);
    wordClips.bytes.set(url,bytes);
    return Promise.resolve(bytes);
  }
  if (!wordClips.loading.has(url)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(),20000);
    const request = fetch(url,{signal:controller.signal}).then(response => {
      if (!response.ok) throw new Error(`读音下载失败：HTTP ${response.status}`);
      return response.arrayBuffer();
    }).then(bytes => { rememberWordClip(url,bytes); return bytes; }).finally(() => { clearTimeout(timeout); wordClips.loading.delete(url); });
    wordClips.loading.set(url,request);
  }
  return wordClips.loading.get(url);
}
function decodeWordClip(url) {
  const cached = wordClips.buffers.get(url);
  if (cached) { wordClips.buffers.delete(url); wordClips.buffers.set(url,cached); return Promise.resolve(cached); }
  if (wordClips.decoding.has(url)) return wordClips.decoding.get(url);
  const context = wordClips.context;
  if (!context) return Promise.resolve(null);
  const request = loadWordClip(url).then(bytes => {
    // The callback form also works in older Safari, where decodeAudioData returns no promise.
    return new Promise((resolve,reject) => { const result = context.decodeAudioData(bytes.slice(0),resolve,reject); result?.catch?.(reject); });
  }).then(buffer => {
    wordClips.buffers.set(url,buffer);
    while (wordClips.buffers.size > WORD_BUFFER_LIMIT) wordClips.buffers.delete(wordClips.buffers.keys().next().value);
    return buffer;
  }).finally(() => wordClips.decoding.delete(url));
  wordClips.decoding.set(url,request);
  return request;
}
function drainWordPrefetch() {
  while (wordClips.prefetchActive < 4 && wordClips.prefetch.size) {
    const url = wordClips.prefetch.keys().next().value;
    wordClips.prefetch.delete(url);
    wordClips.prefetchActive++;
    loadWordClip(url).then(() => wordClips.context ? decodeWordClip(url) : null).catch(() => {}).finally(() => {
      wordClips.prefetchActive--;
      drainWordPrefetch();
    });
  }
}
// Fetch, and once audio is unlocked decode, the words that are likely to be read next.
function prefetchPronunciation(items) {
  const list = [].concat(items || []).filter(Boolean);
  if (!list.length) return;
  if (!state.data.pronunciation) {
    const run = state.viewRun;
    loadData('pronunciation').then(() => { if (run === state.viewRun) prefetchPronunciation(list); }).catch(() => {});
    return;
  }
  for (const item of list) {
    const url = pronunciationSource(item);
    if (!url || wordClips.loading.has(url) || wordClips.decoding.has(url) || wordClips.buffers.has(url)) continue;
    if (wordClips.bytes.has(url) && !wordClips.context) continue;
    wordClips.prefetch.set(url,true);
  }
  while (wordClips.prefetch.size > WORD_BUFFER_LIMIT) wordClips.prefetch.delete(wordClips.prefetch.keys().next().value);
  drainWordPrefetch();
}
// A tap or key press lets the audio context run, so later readings can start without one.
function unlockWordAudio(event) {
  if (!event.isTrusted) return;
  const context = wordAudioContext();
  if (context?.state === 'suspended') Promise.resolve(context.resume()).catch(() => {});
  const button = event.target?.closest?.('[data-action="pronounce"]');
  if (button) prefetchPronunciation(pronounceItem(button));
}
document.addEventListener('pointerdown',unlockWordAudio,{capture:true,passive:true});
document.addEventListener('keydown',unlockWordAudio,{capture:true});
function pronounceItem(button) {
  return button.dataset.kind === 'basics' ? state.basicItems[Number(button.dataset.index)] : state.words[Number(button.dataset.index)];
}
// Rows fetch their recordings as they come near the screen, so any word in a list sounds at
// once when tapped (not when saving data). Without IntersectionObserver the first rows are fetched.
const wordRowObservers = new Map();
function clearListPrefetch(container) {
  if (container) { wordRowObservers.get(container)?.(); wordRowObservers.delete(container); return; }
  for (const dispose of wordRowObservers.values()) dispose();
  wordRowObservers.clear();
}
function prefetchListWords(container) {
  clearListPrefetch(container);
  const buttons = [...(container?.querySelectorAll('[data-action="pronounce"]') || [])];
  if (navigator.connection?.saveData || !buttons.length) return;
  const items = new Map(buttons.map(button => [button,pronounceItem(button)]));
  if (!('IntersectionObserver' in window)) {
    const run = () => prefetchPronunciation(buttons.slice(0,12).map(button => items.get(button)));
    if ('requestIdleCallback' in window) {
      const task = requestIdleCallback(run,{timeout:2000});
      wordRowObservers.set(container,() => cancelIdleCallback(task));
    } else {
      const task = setTimeout(run,600);
      wordRowObservers.set(container,() => clearTimeout(task));
    }
    return;
  }
  const observer = new IntersectionObserver(entries => {
    const near = entries.filter(entry => entry.isIntersecting).map(entry => entry.target);
    near.forEach(button => observer.unobserve(button));
    if (near.length) prefetchPronunciation(near.map(button => items.get(button)));
  },{rootMargin:'400px 0px'});
  buttons.forEach(button => observer.observe(button));
  wordRowObservers.set(container,() => observer.disconnect());
}
function stopWordSource() {
  const source = wordClips.source;
  wordClips.source = null;
  if (!source) return;
  source.onended = null;
  try { source.stop(); } catch {}
  try { source.disconnect(); } catch {}
}
function playWordBuffer(buffer) {
  const context = wordClips.context;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.onended = () => { if (wordClips.source === source) wordClips.source = null; try { source.disconnect(); } catch {} };
  wordClips.source = source;
  source.start();
}
function pauseOtherAudio() {
  window.NorskReader?.stopSlice?.();
  ++state.pronunciationToken;
  state.speechItem = null;
  stopWordSource();
  pronunciationAudio.pause();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
async function pronounce(item) {
  if (!item?.word) return;
  pauseOtherAudio();
  const token = state.pronunciationToken;
  audio.pause();
  if (!state.data.pronunciation && !item.audio) {
    try { await loadData('pronunciation'); }
    catch(error) { console.warn('读音目录未载入',error); }
    if (token !== state.pronunciationToken) return;
  }
  const url = pronunciationSource(item);
  if (url) {
    if (state.wordRate === 1 && wordClips.context?.state === 'running') {
      try {
        const buffer = await decodeWordClip(url);
        if (token !== state.pronunciationToken) return;
        if (buffer) { playWordBuffer(buffer); return; }
      } catch(error) { console.warn('读音改用播放器播放',error); }
      if (token !== state.pronunciationToken) return;
    }
    if (wordClips.bytes.has(url) && !wordClips.objectURLs.has(url)) wordClips.objectURLs.set(url,URL.createObjectURL(new Blob([wordClips.bytes.get(url)],{type:'audio/mpeg'})));
    pronunciationAudio.src = wordClips.objectURLs.get(url) || url;
    pronunciationAudio.defaultPlaybackRate = state.wordRate;
    pronunciationAudio.playbackRate = state.wordRate;
    pronunciationAudio.preservesPitch = true;
    if (!wordClips.bytes.has(url)) loadWordClip(url).catch(() => {});
    try { await pronunciationAudio.play(); } catch(error) { if (token === state.pronunciationToken) { console.error('发音播放失败',error); notify('这条读音暂时无法播放，请检查网络后重试。'); } }
    return;
  }
  // Wordbook entries whose reading is still being made say so instead of the general message.
  if (!('speechSynthesis' in window)) { notify(item.audioNote || '当前浏览器没有挪威语发音服务。这条词语的录音暂未提供。'); return; }
  let voices = speechSynthesis.getVoices();
  if (!voices.length) {
    voices = await new Promise(resolve => {
      const finish = () => { clearTimeout(timer); speechSynthesis.removeEventListener('voiceschanged',finish); resolve(speechSynthesis.getVoices()); };
      const timer = setTimeout(finish,700);
      speechSynthesis.addEventListener('voiceschanged',finish,{once:true});
    });
  }
  if (token !== state.pronunciationToken) return;
  const voice = voices.find(voice => /^nb[-_]/i.test(voice.lang)) || voices.find(voice => /^(no|nb)([-_]|$)/i.test(voice.lang));
  if (!voice) { notify(item.audioNote || '此设备未安装挪威语语音，暂时无法朗读这一词语。可在系统语音设置中添加 Norsk Bokmål。',6500); return; }
  const utterance = new SpeechSynthesisUtterance(item.spoken || item.word);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = state.wordRate;
  state.speechItem = item;
  utterance.onend = () => { if (token === state.pronunciationToken) state.speechItem = null; };
  utterance.onerror = () => { if (token === state.pronunciationToken) { state.speechItem = null; notify('挪威语朗读暂时不可用，请稍后重试。'); } };
  speechSynthesis.speak(utterance);
}
function timeLabel(seconds) {
  const time = Math.max(0,Math.floor(Number(seconds) || 0));
  return `${Math.floor(time/60)}:${str(time%60).padStart(2,'0')}`;
}
function audioBounds() {
  const start = state.audioRange?.start || 0;
  // Some phone browsers report a duration of 0 until the file is buffered; that is an unknown length, not an ended track.
  const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : NaN;
  const end = Number.isFinite(state.audioRange?.end) && state.audioRange.end > start ? Math.min(state.audioRange.end,Number.isFinite(duration) ? duration : Infinity) : duration;
  return {start,end,duration:Math.max(0,(end || 0)-start)};
}
function updateAudioUI() {
  const {start,duration} = audioBounds();
  const position = Math.max(0,audio.currentTime-start);
  $('#audio-current').textContent = timeLabel(position);
  $('#audio-duration').textContent = timeLabel(duration);
  $('#audio-progress').value = duration ? Math.min(1000,position/duration*1000) : 0;
  $('#audio-play').innerHTML = icon(audio.paused ? 'play' : 'pause');
  $('#audio-play').setAttribute('aria-label',audio.paused ? '播放音频' : '暂停播放');
}
async function playEntry(id,options = {}) {
  const found = findEntry(id,'textbook');
  const source = found && entryAudio(found.entry,found.chapter);
  if (!source?.file) { const missing = found && missingEntryAudio(found.entry,found.chapter); notify(missing ? `原录音缺失：${missing.reason || '提供的音频未包含本节。'}` : '这节课暂未提供对应录音。'); return; }
  pauseOtherAudio();
  const token = ++state.audioToken;
  const url = safeURL(source.file);
  if (!url) return;
  // Switching tracks without pausing first keeps a locked phone's audio session alive between playlist items.
  if (options.paused) audio.pause();
  state.currentEntryId = str(id);
  prepareReader().catch(() => {});
  state.audioRange = source.clip ? {start:Number(source.start) || 0,end:Number(source.end) || null} : {start:0,end:null};
  $('#audio-title').textContent = `${found.entry.title}${source.kind === 'synthetic' ? ' · 合成补读' : ''}`;
  $('#audio-label').textContent = `KAPITTEL ${found.chapter.id} · ${source.kind === 'synthetic' ? '合成补读 · 原录音缺失' : '课文音频'}`;
  $('#audio-dock').hidden = false;
  document.body.classList.add('audio-open');
  const startAt = state.audioRange.start + Math.max(0,Number(options.offset) || 0);
  let playing = null;
  try {
    if (audio.src !== url || audio.readyState < 1) {
      audio.src = url;
      // A track that starts at the top plays at once: a backgrounded page may only start sound straight from the
      // previous track's end, not after waiting for metadata.
      const early = !startAt && !options.paused;
      const ready = new Promise((resolve,reject) => {
        const cleanup = () => { clearTimeout(timer); audio.removeEventListener('loadedmetadata',loaded); audio.removeEventListener('error',failed); };
        const loaded = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error('Audio unavailable')); };
        const timer = setTimeout(() => { cleanup(); reject(new Error('Audio loading timeout')); },25000);
        audio.addEventListener('loadedmetadata',loaded,{once:true});
        audio.addEventListener('error',failed,{once:true});
        audio.load();
      });
      if (early) {
        audio.playbackRate = Number($('#audio-speed').value);
        playing = audio.play();
        playing.catch(() => {});
      }
      await ready;
    }
    if (token !== state.audioToken) return;
    if (!playing) audio.currentTime = startAt;
    audio.playbackRate = Number($('#audio-speed').value);
    updateAudioUI();
    window.dispatchEvent(new CustomEvent('norsklessonplay',{detail:{id:str(id),title:found.entry.title,chapter:str(found.chapter.id),synthetic:source.kind === 'synthetic',start:state.audioRange.start}}));
    if (options.paused) return;
    await (playing || audio.play());
  } catch(error) { if (token === state.audioToken) notify('这段录音暂时无法播放，请检查网络后重试。'); }
}
function resumeLessonAudio({reveal = false} = {}) {
  // A closed player stays closed: lock-screen and headset play keys must not start audio nobody can see or stop.
  // A play button on the page (the sentence stage) brings the player bar back instead.
  if (!audio.src) return;
  if ($('#audio-dock').hidden) {
    if (!reveal) return;
    $('#audio-dock').hidden = false;
    document.body.classList.add('audio-open');
  }
  pauseOtherAudio();
  // Cancel an older auto advance before the browser queues the play event.
  const token = ++state.audioToken;
  const {start,end} = audioBounds();
  if (audio.currentTime >= end-.08 || audio.currentTime < start) audio.currentTime = start;
  return audio.play().catch(() => { if (token === state.audioToken) notify('录音播放失败，请重新选择小节。'); });
}
function pauseLessonAudio() {
  // A user pause also cancels a playEntry() waiting for its audio metadata.
  ++state.audioToken;
  pauseOtherAudio();
  audio.pause();
}
function toggleAudio() {
  if (!audio.src) return;
  if (audio.paused) resumeLessonAudio();
  else pauseLessonAudio();
}

document.addEventListener('change',event => {
  if (event.target.matches('[data-word-rate]')) setWordRate(event.target.value);
});
document.addEventListener('click',event => {
  if (!event.target.closest('.series-picker')) toggleSeriesMenu(false);
  if (!event.target.closest('.settings-wrap')) toggleSettings(false);
  const view = event.target.closest('.nav-button[data-view]');
  if (view) { setView(view.dataset.view); return; }
  if (event.target.closest('#sidebar [data-practice-action]')) { closeSidebar(); return; }
  const bookButton = event.target.closest('#book-switch [data-book]');
  if (bookButton) {
    switchBook(bookButton.dataset.book);
    return;
  }
  const action = event.target.closest('[data-action]');
  if (!action) return;
  const {id,book} = action.dataset;
  switch (action.dataset.action) {
    case 'expand': {
      const key = `${book}:${id}`;
      const group = action.closest('.toc-group');
      const expanded = !group.classList.contains('expanded');
      group.classList.toggle('expanded',expanded);
      action.setAttribute('aria-expanded',str(expanded));
      action.setAttribute('aria-label',`${expanded ? '收起' : '展开'}章节`);
      if (expanded) state.expanded.add(key); else state.expanded.delete(key);
      break;
    }
    case 'select-entry': selectEntry(id,book); break;
    case 'toggle-series': toggleSeriesMenu(); break;
    case 'choose-series': toggleSeriesMenu(false); closeSidebar(); selectStudySeries(id); break;
    case 'toggle-search': toggleSearch(); break;
    case 'toggle-settings': toggleSettings(); break;
    case 'word-rate': setWordRate(action.dataset.rate); break;
    case 'vocab-sort': setVocabSort(action.dataset.sort); break;
    case 'entry-audio':
      if (state.book !== 'textbook' || state.readingId !== id) selectEntry(id,'textbook');
      playEntry(id);
      closeSidebar();
      break;
    case 'category': state.basicId = id; $('#basics-search').value = ''; renderTOC(); renderBasics(); closeSidebar(); break;
    case 'pronounce': pronounce(pronounceItem(action)); break;
    case 'open-basics': setView('basics'); break;
    case 'sentence-page':
      state.readMode = 'pdf';
      try { localStorage.setItem('norsk-read-mode-v1','pdf'); } catch {}
      switchBook(book || vocabularyBook()); setView('reading'); goPage(Number(action.dataset.page)); break;
    case 'retry-pdf': state.ready ? renderPDF() : initialize(); break;
    case 'retry-view': setView(state.view,false); break;
    case 'retry-lessons': renderLessons(); break;
    case 'retry-audio': loadAudioMetadata(); break;
    case 'read-mode': setReadMode(action.dataset.mode); break;
  }
});
$('#open-sidebar').addEventListener('click',openSidebar);
$('#close-sidebar').addEventListener('click',closeSidebar);
$('#sidebar-shade').addEventListener('click',closeSidebar);
$('#prev-page').addEventListener('click',() => goPage(state.page-1));
$('#next-page').addEventListener('click',() => goPage(state.page+1));
$('#open-compare').addEventListener('click',async () => {
  if (!state.ready) return;
  if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch {} }
  setView('compare');
});
$('#page-form').addEventListener('submit',event => { event.preventDefault(); goPage(Number($('#page-input').value)); });
$('#zoom-select').addEventListener('change',renderPDF);
$('#zoom-in').addEventListener('click',() => changeZoom(1));
$('#zoom-out').addEventListener('click',() => changeZoom(-1));
$('#pdf-canvas').addEventListener('dblclick',() => { $('#zoom-select').value = $('#zoom-select').value === 'fit' ? 'width' : 'fit'; renderPDF(); });
$('#reader-fullscreen').addEventListener('click',async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if ($('#reading-view').requestFullscreen) await $('#reading-view').requestFullscreen();
    else { document.body.classList.toggle('reader-focus'); renderPDF(); }
  } catch { document.body.classList.toggle('reader-focus'); renderPDF(); }
});
document.addEventListener('fullscreenchange',() => {
  const expanded = Boolean(document.fullscreenElement);
  $('#reader-fullscreen').setAttribute('aria-label',expanded ? '退出全屏' : '全屏阅读');
  $('#reader-fullscreen').title = expanded ? '退出全屏' : '全屏阅读';
  if (state.view === 'reading') renderPDF();
});
let searchTimer;
function scheduleSearch(event) {
  clearTimeout(searchTimer);
  if (event.isComposing) return;
  searchTimer = setTimeout(() => {
    if (state.view === 'vocabulary') renderVocabulary();
    if (state.view === 'basics') renderBasics();
  },80);
}
for (const selector of ['#vocab-search','#basics-search']) {
  $(selector).addEventListener('input',scheduleSearch);
  $(selector).addEventListener('compositionend',scheduleSearch);
}
$('#lesson-materials').addEventListener('toggle',() => {
  if (!$('#lesson-materials').open) { if (state.lessonsShown) showLessons(false); return; }
  if (state.ready) renderLessons();
});
$('#lesson-toggle').addEventListener('click',() => {
  showLessons(!state.lessonsShown);
  if (state.lessonsShown) $('#lesson-materials').scrollIntoView({block:'nearest',behavior:'smooth'});
});
$('#audio-play').addEventListener('click',toggleAudio);
$('#audio-speed').addEventListener('change',() => {
  audio.playbackRate = Number($('#audio-speed').value);
  try { localStorage.setItem('norsk-lesson-rate-v1',$('#audio-speed').value); } catch {}
});
$('#audio-back').addEventListener('click',() => seekLesson(-5));
$('#audio-forward').addEventListener('click',() => seekLesson(5));
$('#audio-transcript').addEventListener('click',() => prepareReader().then(reader => reader.openTranscript()).catch(() => notify('逐句听读暂时无法打开，请检查网络后重试。')));
$('#audio-playlist').addEventListener('click',() => prepareReader().then(reader => reader.openPlaylist()).catch(() => notify('播放列表暂时无法打开，请检查网络后重试。')));
$('#audio-progress').addEventListener('input',event => { const {start,duration} = audioBounds(); if (duration) audio.currentTime = start + Number(event.target.value)/1000*duration; updateAudioUI(); });
$('#audio-close').addEventListener('click',() => { ++state.audioToken; audio.pause(); $('#audio-dock').hidden = true; document.body.classList.remove('audio-open'); window.dispatchEvent(new CustomEvent('norsklessonclose')); });
audio.addEventListener('timeupdate',() => {
  // Only a clip inside a longer chapter file needs ending by hand; whole files end with the browser's own ended event.
  const {end} = audioBounds();
  if (Number.isFinite(state.audioRange?.end) && Number.isFinite(end) && audio.currentTime >= end && !audio.paused) {
    const token = state.audioToken;
    lessonEnded();
    if (token === state.audioToken) audio.pause();
  }
  updateAudioUI();
});
// Each resume is a new playback cycle, including replaying the same selected lesson.
audio.addEventListener('play',() => { state.endedToken = -1; });
audio.addEventListener('ended',lessonEnded);
for (const event of ['play','pause','loadedmetadata','durationchange','ended']) audio.addEventListener(event,updateAudioUI);
audio.addEventListener('error',() => { if (!$('#audio-dock').hidden) notify('录音载入失败，请检查网络后重试。'); });
pronunciationAudio.addEventListener('error',() => notify('这条读音暂时无法播放，请稍后重试。'));
document.addEventListener('keydown',event => {
  if (event.key === 'Escape') {
    toggleSettings(false);
    toggleSeriesMenu(false);
    if (event.target.closest?.('#heading-search')) toggleSearch(false);
  }
  // Esc closes only the topmost layer; the reader's own card handler sees the key as handled.
  if (event.key === 'Escape' && layers.stack.length) { event.preventDefault(); layers.stack.at(-1).close(); }
  else if (event.key === 'Escape' && document.body.classList.contains('reader-focus')) { document.body.classList.remove('reader-focus'); renderPDF(); }
  // Arrow keys turn PDF pages, except inside the listen-and-read text where they move between words.
  if (state.view !== 'reading' || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName) || event.target.closest?.('#reader-text') || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key === 'ArrowLeft' && state.page > 1) { event.preventDefault(); goPage(state.page-1); }
  if (event.key === 'ArrowRight' && state.page < Number(bookData()?.pages || 1)) { event.preventDefault(); goPage(state.page+1); }
});
function viewFromHash() {
  const [view,tab] = location.hash.slice(1).split('/');
  if (view === 'more' && tab) state.moreTab = tab;
  return view;
}
window.addEventListener('hashchange',() => setView(viewFromHash(),false));
let resizeTimer;
window.addEventListener('resize',() => {
  // Turning a tablet to landscape puts the directory back beside the page, so an open drawer closes.
  if (!drawerMode() && sidebarOpen) closeSidebar();
  $('#sidebar').inert = drawerMode() && !sidebarOpen;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.ready && state.view === 'reading' && ['fit','width'].includes($('#zoom-select').value)) renderPDF(); },180);
});
if ('ResizeObserver' in window) new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.ready && state.view === 'reading' && ['fit','width'].includes($('#zoom-select').value)) renderPDF(); },120);
}).observe($('#pdf-stage'));

async function loadAudioMetadata() {
  try { await loadData('audio'); state.audioError = false; }
  catch(error) { state.audioError = true; console.warn('课文录音目录未载入',error); }
  if (state.ready && state.view === 'reading') { updateReadingTitle(); renderTOC(); }
  if (state.ready && state.view === 'compare') window.NorskCompare?.refreshAudio();
}
async function initialize() {
  startPresence();
  showPDFMessage('正在载入阅读目录…');
  loadAudioMetadata();
  try {
    await Promise.all(['catalog','documents'].map(name => loadData(name)));
    if (!state.data.catalog?.books) throw new Error('目录格式无效');
  } catch(error) {
    console.warn('阅读目录未载入',error);
    $('#toc').innerHTML = empty('目录载入失败','请检查网络后刷新');
    showPDFMessage('学习资料暂时无法载入','请检查网络连接，并刷新页面。',true);
    $('#reader-section-title').textContent = '目录载入失败';
    $('#content-title').textContent = '教材阅读';
    return;
  }
  let storage;
  try { storage = window.localStorage; } catch { storage = {getItem:() => null,setItem:() => {}}; }
  state.library = createReadingLibrary(state.data.catalog,storage);
  state.book = state.library.currentBook;
  const position = state.library.positionFor(state.book);
  state.page = position.page;
  state.readingId = position.id;
  state.vocabularyId = str(state.data.vocabulary?.chapters?.[0]?.id || allChapters('textbook')[0]?.id || '');
  state.basicId = str(state.data.basics?.categories?.[0]?.id || '');
  const current = findEntry(state.readingId);
  if (current) state.expanded.add(`${state.book}:${current.chapter.id}`);
  state.ready = true;
  if (wordbook().data.chapters.length || wordbook().sync.person) syncWordbook();
  const room = (/[?&]room=(\d{4})(?:&|$)/.exec(str(location.search)) || [])[1];
  if (room) { state.pendingDuel = {join:room}; setView('practice',false); return; }
  setView(viewFromHash() || 'reading',false);
}
initialize();
