import {createDataLoader} from './loader.mjs?v=20261023-vocab-review';
import {createReadingLibrary} from './reading-library.mjs?v=20261023-vocab-review';
import {createVocabularyLibrary} from './vocabulary-library.mjs?v=20261023-vocab-review';

const VERSION = '20261023-vocab-review';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const str = value => String(value ?? '');
const empty = (message, detail = '') => `<div class="empty-state">${icon('book')}<p>${escapeHTML(message)}</p>${detail ? `<small>${escapeHTML(detail)}</small>` : ''}</div>`;
const state = {
  view: 'reading', book: 'textbook', page: 1, readingId: '', vocabularyId: '', basicId: '',
  expanded: new Set(), data: {}, words: [], basicItems: [], pdfRun: 0, pdfCache: new Map(), renderTask: null,
  audioRange: null, audioToken: 0, pronunciationToken: 0, toastTimer: null, ready: false, pdfScale: 1,
  wordRate: 1, speechItem: null, viewRun: 0, practiceInitialized: false, compareInitialized: false, audioError: false
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
  const current = activeSeriesId();
  $('#series-title').textContent = activeSeriesTitle();
  $('#series-menu').innerHTML = state.library.series.map(item => {
    const books = state.library.booksFor(item.id).map(book => bookData(book)?.label || '教材').join(' · ');
    return `<button type="button" role="option" class="series-option" data-action="choose-series" data-id="${escapeHTML(item.id)}" aria-selected="${item.id === current}"><span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(books)}</small></span>${item.id === current ? icon('check') : ''}</button>`;
  }).join('');
  $('#book-picker').hidden = !['reading','vocabulary'].includes(state.view);
}
function toggleSeriesMenu(open = $('#series-menu').hidden) {
  $('#series-menu').hidden = !open;
  $('#series-button').setAttribute('aria-expanded',str(open));
}
function toggleSettings(open = $('#settings-menu').hidden) {
  $('#settings-menu').hidden = !open;
  $('#settings-button').setAttribute('aria-expanded',str(open));
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
  if (!state.library || seriesId === activeSeriesId()) return;
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
async function prepareView(view,viewRun = state.viewRun) {
  const seriesId = activeSeriesId();
  const current = () => viewRun === state.viewRun && seriesId === activeSeriesId();
  if (['vocabulary','basics','practice'].includes(view)) loadData('pronunciation').catch(error => console.warn('读音目录未载入',error));
  if (view === 'vocabulary') {
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
      window.NorskPractice.init({data:{...state.data,vocabulary},series:descriptor,pronounce,notify,escapeHTML,stopAudio:pauseOtherAudio,renderRateControl:() => wordRateControl(),mountCommunity,submitPracticeResult,seriesOptions:state.library.series,selectSeries:selectStudySeries});
      state.practiceInitialized = true;
      state.practiceSeriesId = seriesId;
      prepareCommunity().catch(() => {});
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
} catch {}
renderRateOptions();
$$('[data-action="vocab-sort"]').forEach(button => button.setAttribute('aria-pressed',str(button.dataset.sort === (state.vocabSort || 'easy'))));
const labels = {reading:['LES & LYTT · 阅读与听力','阅读','让文字与声音相遇'],vocabulary:['ORDLISTE · 教材章末词表','单词表','在熟悉的句子里，认识新的词语'],basics:['DET GRUNNLEGGENDE · 日常积累','基础常识','循序渐进，从容易的开始'],practice:['ØV LITT HVER DAG · 每日练习','练习','一段专注的练习时间']};
labels.compare = ['LES SIDE OM SIDE · 双页对照','双页对照','选择书籍，各自翻阅'];

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
function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#sidebar').inert = window.matchMedia('(max-width: 720px)').matches;
  $('#sidebar-shade').hidden = true;
  $('#open-sidebar').setAttribute('aria-expanded','false');
}
function openSidebar() {
  $('#sidebar').inert = false;
  $('#sidebar').classList.add('open');
  $('#sidebar-shade').hidden = false;
  $('#open-sidebar').setAttribute('aria-expanded','true');
}
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
  if (state.view === 'practice' && view !== 'practice') { window.NorskPractice?.hide(); pauseOtherAudio(); }
  if (state.view === 'compare' && view !== 'compare') {
    rememberComparePositions(window.NorskCompare?.positions?.());
    $('#word-audio').before($('#audio-dock'));
    window.NorskCompare?.hide();
  }
  if (state.view === 'reading' && view !== 'reading') {
    ++state.pdfRun;
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
  renderStudyPicker();
  $('#sidebar-label').textContent = view === 'basics' ? '基础知识' : view === 'practice' ? '我的练习' : '学习目录';
  $('#sidebar-subtitle').textContent = view === 'basics' ? '从入门到进阶，依次学习。' : view === 'vocabulary' ? `${activeSeriesTitle()} · 教材词汇` : view === 'practice' ? '选一组词语，每天复习一点。' : '循着目录，慢慢学会。';
  $('#content-title').textContent = labels[view][1];
  if (updateHash && location.hash !== `#${view}`) history.replaceState(null,'',`#${view}`);
  window.scrollTo(0,0);
  closeSidebar();
  if (state.ready) {
    if (view === 'vocabulary' && (!state.data.vocabulary || state.vocabularySeriesId !== activeSeriesId())) $('#vocab-rows').innerHTML = loading('正在载入词表目录…');
    if (view === 'basics' && !state.data.basics) $('#basics-items').innerHTML = loading('正在载入基础知识…');
    if (view === 'practice' && (!state.practiceInitialized || state.practiceSeriesId !== activeSeriesId())) $('#practice-view').innerHTML = loading('正在准备练习词语…');
    if (view === 'compare' && !state.compareInitialized) $('#compare-view').innerHTML = loading('正在准备双页对照…');
    if (!['reading','compare'].includes(view)) $('#toc').innerHTML = loading('正在准备目录…');
    try { await prepareView(view,run); }
    catch(error) { if (run === state.viewRun) viewError(view,error); return; }
    if (run !== state.viewRun) return;
    renderTOC();
    if (view === 'reading') { updateReadingTitle(); renderPDF(); renderLessons(); }
    if (view === 'vocabulary') renderVocabulary();
    if (view === 'basics') renderBasics();
    if (view === 'practice') { $('#content-title').textContent = `${activeSeriesTitle()} · 练习`; window.NorskPractice?.show(); }
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
  if (!pdfjsPromise) pdfjsPromise = import('./vendor/pdf.mjs?v=20261023-vocab-review').then(module => {
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
  const run = ++state.pdfRun;
  if (state.renderTask) { try { state.renderTask.cancel(); } catch {} state.renderTask = null; }
  const part = documentPart(state.page,state.book);
  if (!part) { showPDFMessage('这一页的 PDF 尚未准备好','请稍后刷新页面，或选择其他章节。',true); return; }
  $('#pdf-download').href = safeURL(part.file);
  showPDFMessage('正在载入这一页…');
  try {
    const pdf = await getPDF(part.file);
    if (run !== state.pdfRun) return;
    const page = await pdf.getPage(state.page - Number(part.startPage) + 1);
    if (run !== state.pdfRun) return;
    const stage = $('#pdf-stage');
    const style = getComputedStyle(stage);
    const available = Math.max(160, stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2);
    const availableHeight = Math.max(80, stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - 2);
    const natural = page.getViewport({scale:1});
    const choice = $('#zoom-select').value;
    const scale = choice === 'fit' ? Math.min(available / natural.width, availableHeight / natural.height) : choice === 'width' ? available / natural.width : Number(choice);
    state.pdfScale = scale;
    const viewport = page.getViewport({scale});
    const ratio = Math.min(window.devicePixelRatio || 1,2);
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
    console.error('PDF 加载失败',error);
    showPDFMessage('页面暂时无法显示','请检查网络后重试；也可点击右上角下载当前 PDF 分册阅读。',true);
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

async function renderLessons() {
  $('#lesson-materials').hidden = state.book !== 'textbook';
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
  state.words.sort((a,b) => order === 'alpha' ? str(a.word).localeCompare(str(b.word),'nb') : ((Number(a.difficulty) || 3) - (Number(b.difficulty) || 3)) * (order === 'hard' ? -1 : 1) || str(a.word).localeCompare(str(b.word),'nb'));
  $('#content-title').textContent = selection.title || '单词表';
  $('#word-count').textContent = state.words.length;
  const difficultyLabels = ['','入门','基础','常用','进阶','拓展'];
  $('#vocab-rows').innerHTML = state.words.length ? state.words.map((word,index) => `<article class="vocab-row"><div class="word-cell"><div class="word-topline"><span class="word-spelling" lang="nb">${escapeHTML(word.word)}</span><button class="word-pronounce" data-action="pronounce" data-kind="vocabulary" data-index="${index}" aria-label="播放 ${escapeHTML(word.word)} 的读音">${icon('volume')}</button><span class="difficulty">${difficultyLabels[Number(word.difficulty)] || '常用'}</span></div><p class="word-meaning">${escapeHTML(word.meaning)}</p><div class="word-details">${phonetics(word)}${wordGrammar(word)}</div></div><div class="sentence-cell"><p class="sentence" lang="nb">${vocabularyExample(word)}</p><div class="sentence-ref"><span>${escapeHTML(word.sectionTitle || selection.title || '')}</span>${word.page ? `<button data-action="sentence-page" data-book="${escapeHTML(vocabularyBook())}" data-page="${Number(word.page)}" title="前往教材对应页">${word.sentenceSource === 'ordliste' ? '词表' : '课文'} PDF 第 ${Number(word.page)} 页 ↗</button>` : ''}${word.sourcePage ? `<button data-action="sentence-page" data-book="${escapeHTML(vocabularyBook())}" data-page="${Number(word.sourcePage)}" title="查看教材原页">原词表 ↗</button>` : ''}</div></div></article>`).join('') : empty(query ? '没有找到这个词语' : '本小节暂无词条',query ? '试试其他单词或中文释义。' : '可在目录中选择其他小节或整章词汇。');
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
  $('#basics-items').innerHTML = state.basicItems.length ? state.basicItems.map((item,index) => `<article class="basic-card"><div class="word-topline"><span class="word-spelling" lang="nb">${escapeHTML(item.word)}</span><button class="word-pronounce" data-action="pronounce" data-kind="basics" data-index="${index}" aria-label="播放 ${escapeHTML(item.word)} 的读音">${icon('volume')}</button></div><p class="word-meaning">${escapeHTML(item.meaning)}</p>${phonetics(item)}${item.note ? `<p class="basic-note">${escapeHTML(item.note)}</p>` : ''}${item.example ? `<p class="basic-example" lang="nb">${escapeHTML(item.example)}</p>` : ''}</article>`).join('') : `<div style="grid-column:1/-1">${empty('没有找到匹配内容','试试其他单词或中文释义。')}</div>`;
}

function pauseOtherAudio() {
  ++state.pronunciationToken;
  state.speechItem = null;
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
  const table = state.data.pronunciation || {};
  const path = item.audio || table[item.word] || table[str(item.word).toLocaleLowerCase('nb')] || table.words?.[item.word];
  if (path) {
    pronunciationAudio.src = safeURL(typeof path === 'string' ? path : path.file);
    pronunciationAudio.defaultPlaybackRate = state.wordRate;
    pronunciationAudio.playbackRate = state.wordRate;
    pronunciationAudio.preservesPitch = true;
    try { await pronunciationAudio.play(); } catch(error) { if (token === state.pronunciationToken) { console.error('发音播放失败',error); notify('这条读音暂时无法播放，请检查网络后重试。'); } }
    return;
  }
  if (!('speechSynthesis' in window)) { notify('当前浏览器没有挪威语发音服务。这条词语的录音暂未提供。'); return; }
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
  if (!voice) { notify('此设备未安装挪威语语音，暂时无法朗读这一词语。可在系统语音设置中添加 Norsk Bokmål。',6500); return; }
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
  const end = Number.isFinite(state.audioRange?.end) && state.audioRange.end > start ? Math.min(state.audioRange.end,Number.isFinite(audio.duration) ? audio.duration : Infinity) : audio.duration;
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
async function playEntry(id) {
  const found = findEntry(id,'textbook');
  const source = found && entryAudio(found.entry,found.chapter);
  if (!source?.file) { const missing = found && missingEntryAudio(found.entry,found.chapter); notify(missing ? `原录音缺失：${missing.reason || '提供的音频未包含本节。'}` : '这节课暂未提供对应录音。'); return; }
  pauseOtherAudio();
  const token = ++state.audioToken;
  const url = safeURL(source.file);
  if (!url) return;
  audio.pause();
  state.audioRange = source.clip ? {start:Number(source.start) || 0,end:Number(source.end) || null} : {start:0,end:null};
  $('#audio-title').textContent = `${found.entry.title}${source.kind === 'synthetic' ? ' · 合成补读' : ''}`;
  $('#audio-label').textContent = `KAPITTEL ${found.chapter.id} · ${source.kind === 'synthetic' ? '合成补读 · 原录音缺失' : '课文音频'}`;
  $('#audio-dock').hidden = false;
  document.body.classList.add('audio-open');
  try {
    if (audio.src !== url || audio.readyState < 1) {
      audio.src = url;
      await new Promise((resolve,reject) => {
        const cleanup = () => { clearTimeout(timer); audio.removeEventListener('loadedmetadata',loaded); audio.removeEventListener('error',failed); };
        const loaded = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error('Audio unavailable')); };
        const timer = setTimeout(() => { cleanup(); reject(new Error('Audio loading timeout')); },25000);
        audio.addEventListener('loadedmetadata',loaded,{once:true});
        audio.addEventListener('error',failed,{once:true});
        audio.load();
      });
    }
    if (token !== state.audioToken) return;
    audio.currentTime = state.audioRange.start;
    audio.playbackRate = Number($('#audio-speed').value);
    updateAudioUI();
    await audio.play();
  } catch(error) { if (token === state.audioToken) notify('这段录音暂时无法播放，请检查网络后重试。'); }
}
function toggleAudio() {
  if (!audio.src) return;
  pauseOtherAudio();
  if (audio.paused) {
    const {start,end} = audioBounds();
    if (audio.currentTime >= end-.08 || audio.currentTime < start) audio.currentTime = start;
    audio.play().catch(() => notify('录音播放失败，请重新选择小节。'));
  } else audio.pause();
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
    case 'pronounce': pronounce(action.dataset.kind === 'basics' ? state.basicItems[Number(action.dataset.index)] : state.words[Number(action.dataset.index)]); break;
    case 'open-basics': setView('basics'); break;
    case 'sentence-page': switchBook(book || vocabularyBook()); setView('reading'); goPage(Number(action.dataset.page)); break;
    case 'retry-pdf': state.ready ? renderPDF() : initialize(); break;
    case 'retry-view': setView(state.view,false); break;
    case 'retry-lessons': renderLessons(); break;
    case 'retry-audio': loadAudioMetadata(); break;
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
$('#vocab-search').addEventListener('input',renderVocabulary);
$('#basics-search').addEventListener('input',renderBasics);
$('#lesson-materials').addEventListener('toggle',() => { if ($('#lesson-materials').open && state.ready) renderLessons(); });
$('#audio-play').addEventListener('click',toggleAudio);
$('#audio-speed').addEventListener('change',() => { audio.playbackRate = Number($('#audio-speed').value); });
$('#audio-progress').addEventListener('input',event => { const {start,duration} = audioBounds(); if (duration) audio.currentTime = start + Number(event.target.value)/1000*duration; updateAudioUI(); });
$('#audio-close').addEventListener('click',() => { ++state.audioToken; audio.pause(); $('#audio-dock').hidden = true; document.body.classList.remove('audio-open'); });
audio.addEventListener('timeupdate',() => {
  const {end} = audioBounds();
  if (Number.isFinite(end) && audio.currentTime >= end) audio.pause();
  updateAudioUI();
});
for (const event of ['play','pause','loadedmetadata','durationchange','ended']) audio.addEventListener(event,updateAudioUI);
audio.addEventListener('error',() => { if (!$('#audio-dock').hidden) notify('录音载入失败，请检查网络后重试。'); });
pronunciationAudio.addEventListener('error',() => notify('这条读音暂时无法播放，请稍后重试。'));
document.addEventListener('keydown',event => {
  if (event.key === 'Escape') {
    toggleSettings(false);
    toggleSeriesMenu(false);
    if (event.target.closest?.('#heading-search')) toggleSearch(false);
  }
  if (event.key === 'Escape') { closeSidebar(); if (document.body.classList.contains('reader-focus')) { document.body.classList.remove('reader-focus'); renderPDF(); } }
  if (state.view !== 'reading' || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName) || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key === 'ArrowLeft' && state.page > 1) { event.preventDefault(); goPage(state.page-1); }
  if (event.key === 'ArrowRight' && state.page < Number(bookData()?.pages || 1)) { event.preventDefault(); goPage(state.page+1); }
});
window.addEventListener('hashchange',() => setView(location.hash.slice(1),false));
let resizeTimer;
window.addEventListener('resize',() => {
  $('#sidebar').inert = window.matchMedia('(max-width: 720px)').matches && !$('#sidebar').classList.contains('open');
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
  setView(location.hash.slice(1) || 'reading',false);
}
initialize();
