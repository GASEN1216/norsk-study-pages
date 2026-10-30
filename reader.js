/* Listen and read: the lesson text word by word, kept in step with the original recording.
   Tap a word for its meaning and reading, hold and drag across words to replay that stretch,
   follow the recording sentence by sentence, and queue sections in a playlist that keeps
   playing in the background with lock-screen controls. */
(() => {
  'use strict';
  if (window.NorskReader) return;
  const PLAYLIST_KEY = 'norsk-playlist-v1';
  const ZH_KEY = 'norsk-reader-zh-v1';
  const LONG_PRESS_MS = 320;
  const LOOP_MODES = ['all','one','off'];
  const LOOP_LABELS = {all:'列表循环',one:'单节循环',off:'播完停止'};
  const RATES = ['0.5','0.75','0.9','1','1.25','1.5'];
  const state = {
    deps:{}, initialized:false, index:null, indexLoad:null, container:null, sectionId:'', data:null, view:null, visible:false, showRun:0,
    current:{sentence:-1,word:-1}, frame:0, followPausedUntil:0, press:null, selection:null, popover:null,
    showZh:true, stage:null, stageSection:'', sheet:null, slice:null, sliceTimer:0, sliceRun:0, sliceCancel:null,
    playlist:{items:[],loop:'all',shuffle:false}, shuffleOrder:null, page:null, playingSection:'', lastScroll:0, trackRun:0,
    meaning:null, meaningLoad:null,
  };
  const $ = (selector,root = document) => root.querySelector(selector);
  const $$ = (selector,root = document) => [...root.querySelectorAll(selector)];
  const e = value => state.deps.escapeHTML ? state.deps.escapeHTML(value) : String(value ?? '');
  const icon = name => state.deps.icon ? state.deps.icon(name) : '';
  const clock = seconds => { const t = Math.max(0,Math.round(Number(seconds) || 0)); return `${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`; };
  const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // Phones in either orientation: a word card there is a bottom sheet, not an inline card.
  const NARROW = '(max-width: 720px), (max-height: 520px)';
  const narrow = () => !!window.matchMedia?.(NARROW).matches;

  /* ---------- Data ---------- */
  function loadIndex() {
    if (state.index) return Promise.resolve(state.index);
    if (!state.indexLoad) state.indexLoad = state.deps.loadData('reader-index','data/reader-index.json').then(index => {
      state.index = {...index,byId:new Map((index.sections || []).map(item => [String(item.id),item]))};
      return state.index;
    }).catch(error => { state.indexLoad = null; throw error; });
    return state.indexLoad;
  }
  const loadSection = id => state.deps.loadData(`reader-${id}`,`data/${state.index.byId.get(String(id)).file}`);
  // Reviewed phrase meanings load beside the lesson; until they arrive a phrase card shows word glosses and the sentence only.
  function loadMeaning() {
    if (state.meaning) return Promise.resolve(state.meaning);
    if (!state.meaningLoad) {
      const version = state.deps.version ? `?v=${encodeURIComponent(state.deps.version)}` : '';
      state.meaningLoad = Promise.resolve()
        .then(() => Promise.all([import(`./reader-meaning.mjs${version}`),state.deps.loadData('reader-phrases','data/reader-phrases.json')]))
        .then(([module,glossary]) => (state.meaning = {resolve:module.resolveSelection,glossary}))
        .catch(error => { state.meaningLoad = null; throw error; });
    }
    return state.meaningLoad;
  }
  const sectionMeta = id => state.index?.byId.get(String(id)) || null;
  function chapterSections(chapterId) {
    return (state.index?.sections || []).filter(item => String(item.chapter) === String(chapterId));
  }
  function chapterOf(id) {
    const meta = sectionMeta(id);
    if (meta) return String(meta.chapter);
    const found = state.deps.findEntry(id);
    return found ? String(found.chapter.id) : '';
  }
  function sectionTitle(id) {
    const meta = sectionMeta(id);
    return meta ? `${meta.id} ${meta.title}` : String(id);
  }

  /* ---------- Time inside the shown section, whichever file is playing ---------- */
  function audioPath() {
    try { return new URL(state.deps.audio.currentSrc || state.deps.audio.src,document.baseURI).pathname; } catch { return ''; }
  }
  const sameFile = (path,file) => !!file && path.endsWith(`/${String(file).replace(/^\/+/,'')}`);
  function timeIn(meta) {
    const audio = state.deps.audio;
    if (!meta || !audio.src) return null;
    // A playlist joined into one recording carries this section at its own offset.
    const joined = state.deps.streamOffset?.(meta.id);
    if (joined != null) return audio.currentTime-joined;
    const path = audioPath();
    if (sameFile(path,meta.audio)) return audio.currentTime;
    // A whole chapter may be playing; its timeline contains this section's clip.
    const chapter = state.deps.chapterAudio?.({id:meta.chapter});
    const section = chapter?.sections?.[meta.id];
    if (chapter?.file && section && Number.isFinite(Number(section.start)) && sameFile(path,chapter.file)) return audio.currentTime-Number(section.start);
    return null;
  }
  function sectionPlaying(meta) {
    const t = timeIn(meta);
    return t != null && t >= -0.2 && t <= Number(meta.duration)+0.3;
  }
  function locate(sentences,t) {
    let lo = 0, hi = sentences.length-1, found = -1;
    while (lo <= hi) {
      const mid = (lo+hi) >> 1;
      if (sentences[mid].start <= t+0.02) { found = mid; lo = mid+1; } else hi = mid-1;
    }
    if (found < 0) return {sentence:-1,word:-1};
    const words = sentences[found].words || [];
    let word = -1;
    for (let i = 0; i < words.length; i++) { if (words[i][2] <= t+0.02) word = i; else break; }
    if (word >= 0 && t > words[word][3]+0.35 && found === sentences.length-1 && t > sentences[found].end+0.4) return {sentence:-1,word:-1};
    return {sentence:found,word};
  }

  /* ---------- Rendering the lesson text ---------- */
  function sentenceMarkup(sentence,index,lexicon) {
    const text = String(sentence.text || '');
    let html = '', cursor = 0;
    (sentence.words || []).forEach((word,wordIndex) => {
      const [from,to,,,key] = word;
      if (from < cursor || to > text.length) return;
      html += e(text.slice(cursor,from));
      const entry = lexicon?.[key];
      html += `<span class="rd-w${entry && !entry.zh && !word[5] ? ' is-unknown' : ''}" data-w="${wordIndex}">${e(text.slice(from,to))}</span>`;
      cursor = to;
    });
    html += e(text.slice(cursor));
    const zh = sentence.zh ? `<span class="rd-zh">${e(sentence.zh)}</span>` : '';
    const speaker = sentence.speaker ? `<span class="rd-speaker" lang="nb">${e(sentence.speaker)}</span>` : '';
    return `<p class="rd-sentence${sentence.heading ? ' is-heading' : ''}${sentence.subheading ? ' is-subheading' : ''}" data-s="${index}"><button type="button" class="rd-say" data-rd="from" data-s="${index}" aria-label="从这一句开始播放" title="从这一句开始播放">${icon('play')}</button>${speaker}<span class="rd-line" lang="nb">${html}</span>${zh}</p>`;
  }
  function neighbours(id) {
    const list = state.index?.sections || [];
    const at = list.findIndex(item => String(item.id) === String(id));
    return {previous:at > 0 ? list[at-1] : null,next:at >= 0 && at < list.length-1 ? list[at+1] : null};
  }
  function renderLesson(meta,data) {
    const {previous,next} = neighbours(meta.id);
    const queued = state.playlist.items.includes(String(meta.id));
    const translated = (data.sentences || []).some(sentence => sentence.zh);
    state.container.innerHTML = `<article class="rd-lesson${state.showZh && translated ? ' show-zh' : ''}" data-section="${e(meta.id)}">
      <header class="rd-head">
        <p class="rd-kicker">KAPITTEL ${e(meta.chapter)} · ${e(meta.id)}${meta.synthetic ? ' · 合成补读' : ''}</p>
        <h2 class="rd-title" lang="nb">${e(meta.title)}</h2>
        <p class="rd-meta">${clock(meta.duration)} · ${data.sentences.length} 句 · ${meta.synthetic ? '原录音缺失，按教材原文合成朗读' : '教材原录音'}</p>
        <div class="rd-actions">
          <button type="button" class="rd-button is-primary" data-rd="play">${icon('play')}<span>播放本节</span></button>
          <button type="button" class="rd-icon" data-rd="queue" aria-pressed="${queued}" aria-label="${queued ? '已在播放列表，点按移出' : '加入播放列表'}" title="${queued ? '已在播放列表' : '加入播放列表'}">${icon(queued ? 'check' : 'plus')}</button>
          ${translated ? `<button type="button" class="rd-icon is-text" data-rd="zh" aria-pressed="${state.showZh}" aria-label="显示整句译文" title="显示整句译文">译</button>` : ''}
          <button type="button" class="rd-icon" data-rd="stage" aria-label="逐句跟读" title="逐句跟读">${icon('text')}</button>
        </div>
      </header>
      <div class="rd-text">${data.sentences.map((sentence,index) => sentenceMarkup(sentence,index,data.lexicon)).join('')}</div>
      <p class="rd-hint">点词查义 · 按住拖过几个词，回放这段原声<span class="rd-hint-keys"> · 键盘：方向键选词，Shift 加方向键选一段，Enter 查看</span></p>
      <nav class="rd-pager" aria-label="上一节与下一节">
        ${previous ? `<button type="button" class="rd-page" data-rd="open" data-id="${e(previous.id)}">${icon('left')}<span><small>上一节</small>${e(previous.id)} ${e(previous.title)}</span></button>` : '<span></span>'}
        ${next ? `<button type="button" class="rd-page is-next" data-rd="open" data-id="${e(next.id)}"><span><small>下一节</small>${e(next.id)} ${e(next.title)}</span>${icon('chevron')}</button>` : '<span></span>'}
      </nav>
    </article><div class="rd-pop" role="dialog" aria-label="词语释义" hidden></div>`;
    state.view = {meta,data,root:$('.rd-lesson',state.container),sentences:$$('.rd-sentence',state.container)};
    $('.rd-w',state.view.root)?.setAttribute('tabindex','0');
    state.current = {sentence:-1,word:-1};
    syncHighlight(true);
    startFollowing();
    state.deps.onLesson?.(state.view);
  }
  function renderChapter(chapterId,note = '') {
    const sections = chapterSections(chapterId);
    const found = state.deps.findEntry(chapterId);
    state.view = null;
    state.deps.onLesson?.(null);
    state.container.innerHTML = `<article class="rd-lesson is-overview">
      <header class="rd-head"><p class="rd-kicker">KAPITTEL ${e(chapterId)} · 听读</p><h2 class="rd-title" lang="nb">${e(found?.chapter?.title || `第 ${chapterId} 章`)}</h2>${note ? `<p class="rd-meta">${e(note)}</p>` : '<p class="rd-meta">选择一节，逐词阅读并跟着原录音听。</p>'}
      ${sections.length ? `<div class="rd-actions"><button type="button" class="rd-button is-primary" data-rd="play-chapter" data-id="${e(chapterId)}">${icon('play')}<span>整章依次播放</span></button><button type="button" class="rd-button" data-rd="queue-chapter" data-id="${e(chapterId)}">${icon('plus')}<span>整章加入播放列表</span></button></div>` : ''}</header>
      ${sections.length ? `<ol class="rd-sections">${sections.map(item => `<li><button type="button" class="rd-section-card" data-rd="open" data-id="${e(item.id)}"><span class="rd-section-no">${e(item.id)}</span><span class="rd-section-title" lang="nb">${e(item.title)}</span><span class="rd-section-meta">${clock(item.duration)} · ${item.sentences} 句${item.synthetic ? ' · 合成补读' : ''}</span></button></li>`).join('')}</ol>` : '<p class="rd-empty">这一章暂无可听读的录音课文。</p>'}
    </article>`;
  }
  async function show(container,entryId) {
    state.container = container;
    if (!container) return;
    if (String(entryId || '') !== state.sectionId) stopSlice();
    state.visible = true;
    const run = ++state.showRun;
    let index;
    try { index = await loadIndex(); }
    catch {
      if (run === state.showRun) container.innerHTML = '<div class="rd-empty"><p>听读课文暂时无法载入。</p><button type="button" class="text-button" data-action="retry-pdf">重新载入</button></div>';
      return;
    }
    if (run !== state.showRun) return;
    let id = String(entryId || '');
    if (!index.byId.has(id)) {
      const chapter = chapterOf(id) || String(index.sections?.[0]?.chapter || '1');
      if (state.sectionId === `chapter:${chapter}` && container.querySelector('.rd-lesson')) return;
      state.sectionId = `chapter:${chapter}`;
      closePopover();
      renderChapter(chapter,id && id !== chapter ? '这一节没有原录音，选择本章其他小节听读。' : '');
      return;
    }
    if (state.sectionId === id && state.view && container.contains(state.view.root)) { syncHighlight(true); startFollowing(); state.deps.onLesson?.(state.view); return; }
    state.sectionId = id;
    closePopover();
    const meta = sectionMeta(id);
    if (!state.data || state.data.id !== id) container.innerHTML = '<div class="rd-empty" role="status"><span class="loader"></span><p>正在载入课文…</p></div>';
    try {
      const data = await loadSection(id);
      if (run !== state.showRun) return;
      state.data = data;
      renderLesson(meta,data);
      prefetchClips(data);
      loadMeaning().catch(() => {});
    } catch {
      if (run !== state.showRun) return;
      container.innerHTML = '<div class="rd-empty"><p>这一节的课文暂时无法载入。</p><button type="button" class="text-button" data-action="retry-pdf">重新载入</button></div>';
      state.sectionId = '';
    }
  }
  function prefetchClips(data) {
    if (navigator.connection?.saveData) return;
    const items = Object.entries(data.lexicon || {}).filter(([,entry]) => entry.clip).slice(0,40).map(([key,entry]) => ({word:key,audio:entry.clip}));
    const run = () => { if (state.visible && state.data === data) state.deps.prefetch?.(items); };
    if ('requestIdleCallback' in window) requestIdleCallback(run,{timeout:2500}); else setTimeout(run,800);
  }

  /* ---------- Following the recording ---------- */
  const readerVisible = () => state.visible && state.view?.root.isConnected && !state.container.hidden;
  const followingVisible = () => !document.hidden && (readerVisible() || (state.stage && !state.stage.hidden));
  function startFollowing() {
    if (state.frame || !followingVisible()) return;
    let lastFrame = -Infinity;
    const tick = now => {
      state.frame = 0;
      if (!followingVisible()) return;
      // A 30 Hz media display keeps word highlighting responsive without rebuilding it every screen frame.
      if (now-lastFrame >= 32) {
        lastFrame = now;
        state.lastTick = Date.now();
        syncHighlight();
        syncStage();
      }
      if (!state.deps.audio.paused) state.frame = requestAnimationFrame(tick);
    };
    state.frame = requestAnimationFrame(tick);
  }
  function syncHighlight(force = false) {
    const view = state.view;
    if (!readerVisible()) return;
    const t = timeIn(view.meta);
    const position = t == null ? {sentence:-1,word:-1} : locate(view.data.sentences,t);
    if (!force && position.sentence === state.current.sentence && position.word === state.current.word) return;
    const previous = state.current;
    if (previous.sentence !== position.sentence) {
      view.sentences[previous.sentence]?.classList.remove('is-current');
      view.sentences[position.sentence]?.classList.add('is-current');
    }
    if (previous.word >= 0) view.sentences[previous.sentence]?.querySelector(`.rd-w[data-w="${previous.word}"]`)?.classList.remove('is-spoken');
    if (position.word >= 0) view.sentences[position.sentence]?.querySelector(`.rd-w[data-w="${position.word}"]`)?.classList.add('is-spoken');
    state.current = position;
    view.root.classList.toggle('is-following',position.sentence >= 0 && !state.deps.audio.paused);
    if (position.sentence >= 0 && position.sentence !== previous.sentence && !state.deps.audio.paused && Date.now() > state.followPausedUntil && !state.popover) {
      const node = view.sentences[position.sentence];
      const box = node?.getBoundingClientRect(), frame = state.container.getBoundingClientRect();
      const top = Math.max(frame.top,0)+20, bottom = Math.min(frame.bottom,window.innerHeight-(document.body.classList.contains('audio-open') ? 150 : 40));
      if (box && (box.top < top || box.bottom > bottom)) node.scrollIntoView({block:'center',behavior:reduced() ? 'auto' : 'smooth'});
    }
  }
  // While the reader scrolls by hand, the text stops chasing the recording for a few seconds.
  window.addEventListener('wheel',() => { state.followPausedUntil = Date.now()+4000; },{passive:true,capture:true});
  window.addEventListener('touchmove',() => { if (!state.press?.selecting) state.followPausedUntil = Date.now()+4000; },{passive:true});

  /* ---------- Playing words, phrases and sentences ---------- */
  function sliceAudio() {
    if (!state.slice) { state.slice = new Audio(); state.slice.preload = 'auto'; }
    return state.slice;
  }
  function stopSlice() {
    state.sliceRun++;
    clearTimeout(state.sliceTimer);
    state.sliceTimer = 0;
    state.sliceCancel?.();
    if (state.slice) state.slice.pause();
  }
  // Replays part of the section recording without moving the lesson player.
  async function playSlice(meta,start,end) {
    const url = state.deps.safeURL(meta.audio);
    if (!url) return;
    state.deps.stopWordAudio?.();
    stopSlice();
    const run = state.sliceRun;
    if (!state.deps.audio.paused) state.deps.audio.pause();
    const player = sliceAudio();
    try {
      if (player.src !== url || player.readyState < 1) {
        if (player.src !== url) player.src = url;
        const ready = await new Promise((resolve,reject) => {
          let timer;
          const cleanup = () => {
            clearTimeout(timer);
            player.removeEventListener('loadedmetadata',done);
            player.removeEventListener('error',fail);
            if (state.sliceCancel === cancel) state.sliceCancel = null;
          };
          const done = () => { cleanup(); resolve(true); };
          const fail = () => { cleanup(); reject(new Error('slice')); };
          const cancel = () => { cleanup(); resolve(false); };
          state.sliceCancel = cancel;
          timer = setTimeout(fail,25000);
          player.addEventListener('loadedmetadata',done); player.addEventListener('error',fail); player.load();
        });
        if (!ready) return;
      }
      if (run !== state.sliceRun) return;
      const from = Math.max(0,start-0.06), to = end+0.12;
      player.currentTime = from;
      player.playbackRate = Number($('#audio-speed')?.value) || 1;
      await player.play();
      if (run !== state.sliceRun) return;
      const stop = () => {
        if (run !== state.sliceRun) return;
        if (player.currentTime >= to || player.paused) { player.pause(); return; }
        state.sliceTimer = setTimeout(stop,Math.max(15,(to-player.currentTime)*1000/(player.playbackRate || 1)-10));
      };
      stop();
    } catch { if (run === state.sliceRun) state.deps.notify?.('这段原录音暂时无法播放，请检查网络后重试。'); }
  }
  function sayWord(entry,key,word,meta) {
    if (entry?.clip) { stopSlice(); state.deps.pronounce({word:entry.surface || key,audio:entry.clip}); return; }
    playSlice(meta,word[2],word[3]);
  }
  async function playFrom(meta,seconds) {
    stopSlice();
    const t = timeIn(meta);
    if (t != null) {
      const audio = state.deps.audio;
      audio.currentTime = Math.max(0,audio.currentTime+(seconds-t));
      audio.play().catch(() => {});
      startFollowing();
      return;
    }
    await state.deps.playEntry(meta.id,{offset:seconds});
    startFollowing();
  }

  /* ---------- Word and phrase cards ---------- */
  function glossOf(word,lexicon) {
    const entry = lexicon?.[word[4]] || {};
    return {entry,zh:word[5] || entry.zh || ''};
  }
  function wordCard(view,sentenceIndex,wordIndex) {
    const sentence = view.data.sentences[sentenceIndex], word = sentence.words[wordIndex];
    const {entry,zh} = glossOf(word,view.data.lexicon);
    const surface = sentence.text.slice(word[0],word[1]);
    // A sense chosen for this sentence replaces the dictionary entry; its base form and part of
    // speech may belong to another word spelled the same way, so they are not shown with it.
    const own = !word[5];
    const lemma = own && entry.lemma && entry.lemma.toLocaleLowerCase('nb') !== surface.toLocaleLowerCase('nb') ? entry.lemma : '';
    const meta = own ? [entry.pos,entry.form].filter(Boolean).join(' · ') : '';
    return `<div class="rd-pop-head"><button type="button" class="rd-pop-say" data-rd="say" aria-label="朗读 ${e(surface)}">${icon('volume')}</button><strong lang="nb">${e(surface)}</strong>${lemma ? `<span class="rd-pop-lemma" lang="nb">原形 ${e(lemma)}</span>` : ''}<button type="button" class="rd-pop-close" data-rd="close" aria-label="关闭">${icon('close')}</button></div>
      <p class="rd-pop-zh">${zh ? e(zh) : '<span class="rd-pop-none">暂无释义，可结合整句译文理解</span>'}</p>${meta ? `<p class="rd-pop-meta">${e(meta)}</p>` : ''}
      <div class="rd-pop-sentence"><p lang="nb">${e(sentence.text)}</p>${sentence.zh ? `<p>${e(sentence.zh)}</p>` : ''}</div>
      <div class="rd-pop-actions"><button type="button" data-rd="slice-word">${icon('volume')}听原声</button><button type="button" data-rd="slice-sentence">${icon('play')}听本句</button></div>
      ${noteBar({range:{from:{s:sentenceIndex,w:wordIndex},to:{s:sentenceIndex,w:wordIndex}},text:surface,meaning:zh,sentence:sentence.text,sentenceZh:sentence.zh || ''})}`;
  }
  // Highlighting, thoughts and 加入词本 come from the notes feature, once it has loaded.
  function noteBar(context) {
    try { return state.deps.noteBar?.(context) || ''; } catch { return ''; }
  }
  function phraseCard(view,range) {
    const {from,to} = range;
    const sentences = view.data.sentences;
    const words = [];
    for (let s = from.s; s <= to.s; s++) {
      const list = sentences[s].words;
      const first = s === from.s ? from.w : 0, last = s === to.s ? to.w : list.length-1;
      for (let w = first; w <= last; w++) words.push({s,w,word:list[w]});
    }
    const text = from.s === to.s
      ? sentences[from.s].text.slice(words[0].word[0],words[words.length-1].word[1])
      : words.map(item => sentences[item.s].text.slice(item.word[0],item.word[1])).join(' ');
    const seen = new Set();
    const glosses = words.filter(item => { const key = item.word[4]; if (seen.has(key)) return false; seen.add(key); return true; }).map(item => {
      const {entry,zh} = glossOf(item.word,view.data.lexicon);
      return `<li><span lang="nb">${e(sentences[item.s].text.slice(item.word[0],item.word[1]))}</span>${!item.word[5] && entry.lemma && entry.lemma !== (entry.surface || item.word[4]) ? `<small lang="nb">${e(entry.lemma)}</small>` : ''}<em>${zh ? e(zh) : '—'}</em></li>`;
    }).join('');
    const translations = [...new Set(words.map(item => item.s))].map(s => sentences[s]).filter(sentence => sentence.zh);
    // Only a reviewed source gives the selection its own meaning; a sentence translation is never presented as one.
    const meaning = phraseMeaning(view,range);
    const whole = meaning?.source === 'reviewed-sentence';
    const lead = meaning?.translation ? `<div class="rd-pop-meaning"><span class="rd-pop-label">${whole ? '整句译文' : '短语释义'}</span><p>${e(meaning.translation)}</p></div>`
      : meaning ? '<p class="rd-pop-note">这段不是已收录的固定表达，暂无独立释义。</p>' : '';
    return `<div class="rd-pop-head"><button type="button" class="rd-pop-say" data-rd="slice-range" aria-label="回放这段原录音">${icon('volume')}</button><strong lang="nb">${e(text)}</strong><button type="button" class="rd-pop-close" data-rd="close" aria-label="关闭">${icon('close')}</button></div>
      ${lead}<ul class="rd-pop-glosses">${glosses}</ul>
      ${translations.length && !whole ? `<div class="rd-pop-sentence"><span class="rd-pop-label">整句参考译文</span>${translations.map(sentence => `<p lang="nb">${e(sentence.text)}</p><p>${e(sentence.zh)}</p>`).join('')}</div>` : ''}
      ${noteBar({range:{from:{...from},to:{...to}},text,meaning:meaning?.translation || '',sentence:sentences[from.s].text,sentenceZh:translations.map(sentence => sentence.zh).join(' ')})}`;
  }
  function phraseMeaning(view,range) {
    if (!state.meaning || !view.data?.sentences) return null;
    try { return state.meaning.resolve(view.data,range,state.meaning.glossary); } catch { return null; }
  }
  function placePopover(pop,anchor) {
    if (narrow()) {
      // The bottom sheet spans the screen; an inline width left from a wider window would push it off the edge.
      pop.classList.add('is-sheet'); pop.style.left = ''; pop.style.top = ''; pop.style.width = '';
      state.container.classList.add('has-sheet');
      // Keep the tapped words visible above the sheet.
      const covered = anchor.getBoundingClientRect().bottom-(pop.getBoundingClientRect().top-16);
      if (covered > 0) { state.followPausedUntil = Date.now()+6000; state.container.scrollBy({top:covered,behavior:reduced() ? 'auto' : 'smooth'}); }
      return;
    }
    pop.classList.remove('is-sheet');
    state.container.classList.remove('has-sheet');
    const host = state.container.getBoundingClientRect();
    const box = anchor.getBoundingClientRect();
    const width = Math.min(360,host.width-24);
    pop.style.width = `${width}px`;
    let left = box.left-host.left+box.width/2-width/2;
    left = Math.max(12,Math.min(left,host.width-width-12));
    const scroll = state.container.scrollTop;
    pop.style.left = `${left}px`;
    pop.style.top = `${box.bottom-host.top+scroll+10}px`;
    const below = Math.min(window.innerHeight,host.bottom)-box.bottom-(document.body.classList.contains('audio-open') ? 130 : 20);
    requestAnimationFrame(() => { if (pop.offsetHeight > below && box.top-host.top > pop.offsetHeight+20) pop.style.top = `${box.top-host.top+scroll-pop.offsetHeight-10}px`; });
  }
  function openPopover(kind,payload,anchor) {
    const view = state.view;
    const pop = $('.rd-pop',state.container);
    if (!view || !pop) return;
    if (!state.popover) state.deps.openLayer?.('word',closePopover);
    const popover = state.popover = {kind,...payload,anchor};
    pop.innerHTML = kind === 'word' ? wordCard(view,payload.s,payload.w) : phraseCard(view,payload.range);
    pop.hidden = false;
    pop.classList.remove('is-open');
    placePopover(pop,anchor);
    requestAnimationFrame(() => pop.classList.add('is-open'));
    if (kind === 'phrase' && !state.meaning) loadMeaning().then(() => {
      if (state.popover !== popover || state.view !== view) return;
      pop.innerHTML = phraseCard(view,payload.range);
      placePopover(pop,anchor);
    }).catch(() => {});
    if (kind === 'word') {
      const sentence = view.data.sentences[payload.s], word = sentence.words[payload.w];
      const {entry} = glossOf(word,view.data.lexicon);
      sayWord(entry,word[4],word,view.meta);
    } else playRange(view,payload.range);
  }
  function closePopover() {
    const anchor = state.popover?.anchor;
    if (state.popover) state.deps.closeLayer?.('word');
    state.popover = null;
    const pop = state.container && $('.rd-pop',state.container);
    const hadFocus = !!pop?.contains(document.activeElement);
    if (pop) { pop.hidden = true; pop.classList.remove('is-open'); }
    state.container?.classList?.remove('has-sheet');
    clearSelection();
    if (hadFocus && anchor?.isConnected) focusWord(anchor);
  }
  function playRange(view,range) {
    const first = view.data.sentences[range.from.s].words[range.from.w];
    const last = view.data.sentences[range.to.s].words[range.to.w];
    playSlice(view.meta,first[2],last[3]);
  }

  /* ---------- Selecting words: tap, or hold and drag ---------- */
  function wordAt(x,y) {
    const node = document.elementFromPoint(x,y)?.closest?.('.rd-w');
    if (!node || !state.view?.root.contains(node)) return null;
    return {s:Number(node.closest('.rd-sentence').dataset.s),w:Number(node.dataset.w),node};
  }
  const before = (a,b) => a.s < b.s || (a.s === b.s && a.w <= b.w);
  function paintSelection(anchor,focus) {
    clearSelection(false);
    const [from,to] = before(anchor,focus) ? [anchor,focus] : [focus,anchor];
    state.selection = {from:{s:from.s,w:from.w},to:{s:to.s,w:to.w}};
    for (const node of $$('.rd-w',state.view.root)) {
      const at = {s:Number(node.closest('.rd-sentence').dataset.s),w:Number(node.dataset.w)};
      if (before(from,at) && before(at,to)) node.classList.add('is-selected');
    }
    const marked = $$('.rd-w.is-selected',state.view.root);
    marked[0]?.classList.add('is-first'); marked[marked.length-1]?.classList.add('is-last');
  }
  function clearSelection(forget = true) {
    if (forget) state.selection = null;
    if (state.view?.root) $$('.rd-w.is-selected',state.view.root).forEach(node => node.classList.remove('is-selected','is-first','is-last'));
  }
  function onPointerDown(event) {
    if (event.button > 0 || !state.view) return;
    const hit = event.target.closest('.rd-w');
    if (!hit || !state.view.root.contains(hit)) return;
    const at = {s:Number(hit.closest('.rd-sentence').dataset.s),w:Number(hit.dataset.w),node:hit};
    const press = {id:event.pointerId,type:event.pointerType,x:event.clientX,y:event.clientY,anchor:at,focus:at,selecting:event.pointerType === 'mouse',moved:false,timer:0};
    if (press.type !== 'mouse') press.timer = setTimeout(() => {
      if (state.press !== press) return;
      press.selecting = true;
      paintSelection(press.anchor,press.anchor);
      navigator.vibrate?.(8);
    },LONG_PRESS_MS);
    state.press = press;
  }
  function onPointerMove(event) {
    const press = state.press;
    if (!press || event.pointerId !== press.id) return;
    const distance = Math.hypot(event.clientX-press.x,event.clientY-press.y);
    if (!press.selecting) {
      if (distance > 9) { clearTimeout(press.timer); state.press = null; }
      return;
    }
    if (distance > 4) press.moved = true;
    const at = wordAt(event.clientX,event.clientY);
    if (at && (at.s !== press.focus.s || at.w !== press.focus.w)) { press.focus = at; paintSelection(press.anchor,at); }
    else if (press.moved && !state.selection) paintSelection(press.anchor,press.focus);
  }
  function onPointerUp(event) {
    const press = state.press;
    if (!press || event.pointerId !== press.id) return;
    clearTimeout(press.timer);
    state.press = null;
    const span = state.selection && (state.selection.from.s !== state.selection.to.s || state.selection.from.w !== state.selection.to.w);
    // The click that follows a drag lands on the sentence, not a word; it must not close the card.
    state.openedAt = Date.now();
    if (press.selecting && span) { const range = state.selection; openPopover('phrase',{range},press.focus.node); paintSelection(range.from,range.to); return; }
    clearSelection();
    openPopover('word',{s:press.anchor.s,w:press.anchor.w},press.anchor.node);
    press.anchor.node.classList.add('is-selected','is-first','is-last');
  }
  function onPointerCancel(event) {
    if (state.press?.id !== event.pointerId) return;
    clearTimeout(state.press.timer);
    state.press = null;
    clearSelection();
  }
  // Keyboard: Tab reaches the lesson words once; arrows move word by word or sentence by sentence,
  // Shift with an arrow extends a selection, and Enter or Space opens the card for the word or selection.
  function focusWord(node) {
    $$('.rd-w[tabindex]',state.view?.root || document).forEach(other => { if (other !== node) other.removeAttribute('tabindex'); });
    node.setAttribute('tabindex','0');
    node.focus({preventScroll:false});
  }
  const wordPoint = node => ({s:Number(node.closest('.rd-sentence').dataset.s),w:Number(node.dataset.w)});
  function onWordKey(event) {
    const node = event.target.closest?.('.rd-w');
    if (!node || !state.view?.root.contains(node) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const range = state.selection;
      state.keyAnchor = null;
      if (range && (range.from.s !== range.to.s || range.from.w !== range.to.w)) { openPopover('phrase',{range},node); paintSelection(range.from,range.to); }
      else { clearSelection(); openPopover('word',wordPoint(node),node); node.classList.add('is-selected','is-first','is-last'); }
      state.openedAt = Date.now();
      $('.rd-pop .rd-pop-close',state.container)?.focus({preventScroll:true});
      return;
    }
    const words = $$('.rd-w',state.view.root), at = words.indexOf(node);
    let next = null;
    if (event.key === 'ArrowRight') next = words[at+1];
    else if (event.key === 'ArrowLeft') next = words[at-1];
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 'nextElementSibling' : 'previousElementSibling';
      let sentence = node.closest('.rd-sentence')[step];
      while (sentence && !$('.rd-w',sentence)) sentence = sentence[step];
      next = sentence && $('.rd-w',sentence);
    }
    if (!next) return;
    event.preventDefault();
    if (event.shiftKey) { state.keyAnchor ??= wordPoint(node); paintSelection(state.keyAnchor,wordPoint(next)); }
    else { state.keyAnchor = null; clearSelection(); }
    focusWord(next);
  }

  /* ---------- Sentence-by-sentence stage ---------- */
  function stageMeta() {
    const playing = state.deps.currentEntry?.() || '';
    if (sectionMeta(playing)) return sectionMeta(playing);
    const chapter = state.deps.chapterAudio?.({id:playing});
    if (chapter && state.deps.audio.src) {
      const t = state.deps.audio.currentTime;
      const inside = chapterSections(playing).find(item => { const section = chapter.sections?.[item.id]; return section && t >= Number(section.start) && t < Number(section.end); });
      if (inside) return inside;
    }
    return sectionMeta(state.sectionId) || null;
  }
  // A closed layer hands focus back to the control that opened it.
  function restoreFocus(layer,opener) {
    const active = document.activeElement;
    if (opener?.isConnected && (layer.contains(active) || !active || active === document.body)) opener.focus({preventScroll:true});
  }
  async function openTranscript() {
    if (!state.stage || state.stage.hidden) state.stageOpener = document.activeElement;
    await loadIndex();
    let meta = stageMeta();
    if (!meta) {
      const first = state.playlist.items.find(id => sectionMeta(id)) || state.index.sections?.[0]?.id;
      if (!first) { state.deps.notify?.('暂无可逐句跟读的课文。'); return; }
      meta = sectionMeta(first);
    }
    if (!state.stage) buildStage();
    state.stage.hidden = false;
    document.body.classList.add('rd-stage-open');
    state.deps.openLayer?.('stage',closeTranscript);
    requestAnimationFrame(() => state.stage.classList.add('is-open'));
    await fillStage(meta);
    $('.rd-stage-close',state.stage)?.focus({preventScroll:true});
    startFollowing();
  }
  function closeTranscript() {
    if (!state.stage || state.stage.hidden) return;
    state.deps.closeLayer?.('stage');
    state.stage.classList.remove('is-open');
    document.body.classList.remove('rd-stage-open');
    restoreFocus(state.stage,state.stageOpener);
    state.stageOpener = null;
    setTimeout(() => { if (!state.stage.classList.contains('is-open')) state.stage.hidden = true; },reduced() ? 0 : 260);
  }
  function buildStage() {
    const stage = document.createElement('div');
    stage.className = 'rd-stage';
    stage.hidden = true;
    stage.setAttribute('role','dialog');
    stage.setAttribute('aria-modal','true');
    stage.setAttribute('aria-label','逐句跟读');
    stage.innerHTML = `<header class="rd-stage-head"><button type="button" class="rd-stage-close" data-rd="stage-close" aria-label="收起">${icon('chevron')}</button><div class="rd-stage-title"><strong></strong><span></span></div><button type="button" class="rd-stage-zh" data-rd="stage-zh" aria-pressed="false">译文</button></header>
      <div class="rd-stage-lines" lang="nb"></div>
      <div class="rd-stage-controls">
        <div class="rd-stage-progress"><input type="range" min="0" max="1000" value="0" aria-label="播放进度" data-rd-progress><div><span data-rd-now>0:00</span><span data-rd-left>0:00</span></div></div>
        <div class="rd-stage-transport">
          <button type="button" data-rd="prev-track" aria-label="上一节">${icon('left')}</button>
          <button type="button" data-rd="back5" aria-label="后退 5 秒">${icon('back5')}</button>
          <button type="button" class="rd-stage-play" data-rd="toggle" aria-label="播放">${icon('play')}</button>
          <button type="button" data-rd="fwd5" aria-label="前进 5 秒">${icon('fwd5')}</button>
          <button type="button" data-rd="next-track" aria-label="下一节">${icon('chevron')}</button>
        </div>
        <div class="rd-stage-options">
          <button type="button" data-rd="rate" aria-label="播放速度"><span data-rd-rate>1×</span></button>
          <button type="button" data-rd="loop" aria-label="循环方式"><span data-rd-loop></span></button>
          <button type="button" data-rd="shuffle" aria-pressed="false" aria-label="随机播放"><span>随机</span></button>
          <button type="button" data-rd="sheet" aria-label="播放列表">${icon('list')}</button>
        </div>
      </div>`;
    document.body.append(stage);
    stage.addEventListener('click',onClick);
    stage.addEventListener('input',event => {
      if (!event.target.matches('[data-rd-progress]')) return;
      const meta = sectionMeta(state.stageSection);
      const t = timeIn(meta);
      if (t == null) return;
      const target = Number(event.target.value)/1000*meta.duration;
      state.deps.audio.currentTime += target-t;
      syncStage(true);
    });
    stage.addEventListener('keydown',event => { if (event.key === 'Escape') { event.stopPropagation(); closeTranscript(); } });
    stage.controls = {toggle:$('[data-rd="toggle"]',stage),progress:$('[data-rd-progress]',stage),now:$('[data-rd-now]',stage),left:$('[data-rd-left]',stage),lines:$('.rd-stage-lines',stage)};
    state.stage = stage;
  }
  async function fillStage(meta) {
    state.stageSection = String(meta.id);
    const stage = state.stage;
    stage.stageData = null;
    $('.rd-stage-title strong',stage).textContent = `${meta.id} ${meta.title}`;
    $('.rd-stage-title span',stage).textContent = `God i norsk · Kapittel ${meta.chapter}${meta.synthetic ? ' · 合成补读' : ''}`;
    const lines = $('.rd-stage-lines',stage);
    lines.innerHTML = '<p class="rd-stage-line is-loading">正在载入…</p>';
    try {
      const data = await loadSection(meta.id);
      if (state.stageSection !== String(meta.id)) return;
      stage.dataset.translated = String(data.sentences.some(sentence => sentence.zh));
      lines.innerHTML = data.sentences.map((sentence,index) => `<button type="button" class="rd-stage-line${sentence.heading || sentence.subheading ? ' is-heading' : ''}" data-rd="stage-seek" data-s="${index}">${sentence.speaker ? `<em>${e(sentence.speaker)}</em>` : ''}<span>${e(sentence.text)}</span>${sentence.zh ? `<small>${e(sentence.zh)}</small>` : ''}</button>`).join('');
      stage.stageData = {meta,data,current:-1,lines:$$('.rd-stage-line',stage)};
      syncStageOptions();
      syncStage(true);
    } catch { if (state.stageSection === String(meta.id)) lines.innerHTML = '<p class="rd-stage-line">这一节的课文暂时无法载入。</p>'; }
  }
  function syncStageOptions() {
    const stage = state.stage;
    if (!stage) return;
    const rate = `${Number($('#audio-speed')?.value || 1)}×`;
    $('[data-rd-rate]',stage).textContent = rate;
    $('[data-rd="rate"]',stage).setAttribute('aria-label',`播放速度 ${rate}`);
    $('[data-rd-loop]',stage).textContent = LOOP_LABELS[state.playlist.loop];
    $('[data-rd="loop"]',stage).setAttribute('aria-label',`循环方式：${LOOP_LABELS[state.playlist.loop]}`);
    $('[data-rd="shuffle"]',stage).setAttribute('aria-pressed',String(state.playlist.shuffle));
    $('[data-rd="stage-zh"]',stage).setAttribute('aria-pressed',String(state.showZh));
    stage.classList.toggle('show-zh',state.showZh);
  }
  function syncStage(force = false) {
    const stage = state.stage;
    if (!stage || stage.hidden || !stage.stageData) return;
    const meta = stageMeta();
    if (meta && String(meta.id) !== state.stageSection && sectionPlaying(meta)) { fillStage(meta); return; }
    const playback = stage.stageData, controls = stage.controls;
    const {data,lines} = playback;
    const t = timeIn(playback.meta);
    const paused = state.deps.audio.paused;
    if (playback.paused !== paused) {
      controls.toggle.innerHTML = icon(paused ? 'play' : 'pause');
      controls.toggle.setAttribute('aria-label',paused ? '播放' : '暂停');
      playback.paused = paused;
    }
    const duration = Number(playback.meta.duration) || 0;
    const now = t == null ? 0 : Math.max(0,Math.min(duration,t));
    const progress = duration ? Math.round(now/duration*1000) : 0;
    if (playback.progress !== progress) { controls.progress.value = progress; playback.progress = progress; }
    const nowLabel = clock(now), leftLabel = `-${clock(duration-now)}`;
    if (playback.nowLabel !== nowLabel) { controls.now.textContent = nowLabel; playback.nowLabel = nowLabel; }
    if (playback.leftLabel !== leftLabel) { controls.left.textContent = leftLabel; playback.leftLabel = leftLabel; }
    const index = t == null ? -1 : locate(data.sentences,t).sentence;
    if (!force && index === playback.current) return;
    lines[playback.current]?.classList.remove('is-current');
    lines.forEach((line,i) => line.classList.toggle('is-past',index >= 0 && i < index));
    const line = lines[index];
    line?.classList.add('is-current');
    playback.current = index;
    const box = controls.lines;
    if (line) box.scrollTo({top:line.offsetTop-box.clientHeight*0.32,behavior:reduced() || force ? 'auto' : 'smooth'});
  }

  /* ---------- Playlist ---------- */
  function readPlaylist() {
    try {
      const saved = JSON.parse(localStorage.getItem(PLAYLIST_KEY) || 'null');
      if (saved && Array.isArray(saved.items)) state.playlist = {items:[...new Set(saved.items.map(String))].slice(0,200),loop:LOOP_MODES.includes(saved.loop) ? saved.loop : 'all',shuffle:!!saved.shuffle};
    } catch { /* A playlist is a convenience; an unreadable one starts empty. */ }
    try { const zh = localStorage.getItem(ZH_KEY); if (zh != null) state.showZh = zh !== '0'; } catch {}
  }
  function savePlaylist() {
    state.shuffleOrder = null;
    try { localStorage.setItem(PLAYLIST_KEY,JSON.stringify(state.playlist)); } catch { /* Kept for this visit only. */ }
    renderSheet(); renderPage(); syncStageOptions(); syncMediaSession();
    window.dispatchEvent(new Event('norskplaylistchange'));
    const queueButton = state.view && $('[data-rd="queue"]',state.view.root);
    if (queueButton) {
      const queued = state.playlist.items.includes(String(state.view.meta.id));
      queueButton.setAttribute('aria-pressed',String(queued));
      queueButton.setAttribute('aria-label',queued ? '已在播放列表，点按移出' : '加入播放列表');
      queueButton.title = queued ? '已在播放列表' : '加入播放列表';
      queueButton.innerHTML = icon(queued ? 'check' : 'plus');
    }
  }
  function addToPlaylist(ids,{play = false} = {}) {
    const valid = [...new Set(ids.map(String))].filter(id => sectionMeta(id));
    const fresh = valid.filter(id => !state.playlist.items.includes(id));
    state.playlist.items.push(...fresh);
    savePlaylist();
    if (play && valid[0]) state.deps.playEntry(valid[0]);
    else if (fresh.length) state.deps.notify?.(fresh.length === 1 ? `已加入播放列表：${sectionTitle(fresh[0])}` : `已加入 ${fresh.length} 节到播放列表`);
    else if (valid.length) state.deps.notify?.('这些小节已在播放列表中。');
  }
  function removeFromPlaylist(id) {
    state.playlist.items = state.playlist.items.filter(item => item !== String(id));
    savePlaylist();
  }
  function moveInPlaylist(id,step) {
    const items = state.playlist.items, at = items.indexOf(String(id)), to = at+step;
    if (at < 0 || to < 0 || to >= items.length) return;
    [items[at],items[to]] = [items[to],items[at]];
    savePlaylist();
  }
  function nextInPlaylist(id,step = 1,automatic = false) {
    let items = state.playlist.items.filter(item => sectionMeta(item));
    if (!items.length) return null;
    let at = items.indexOf(String(id));
    if (automatic && state.playlist.loop === 'one' && at >= 0) return items[at];
    if (state.playlist.shuffle && items.length > 1) {
      if (state.playlist.loop !== 'off') {
        const others = items.filter(item => item !== String(id));
        return others[Math.floor(Math.random()*others.length)];
      }
      // Play-once needs a finite shuffled order, rather than endlessly picking another item.
      if (!state.shuffleOrder || state.shuffleOrder.length !== items.length || state.shuffleOrder.some(item => !items.includes(item))) {
        const rest = items.filter(item => item !== String(id));
        for (let last = rest.length-1; last > 0; last--) {
          const pick = Math.floor(Math.random()*(last+1));
          [rest[last],rest[pick]] = [rest[pick],rest[last]];
        }
        state.shuffleOrder = at >= 0 ? [String(id),...rest] : rest;
      }
      items = state.shuffleOrder;
      at = items.indexOf(String(id));
    }
    if (at < 0) return step > 0 ? items[0] : items[items.length-1];
    const next = at+step;
    if (next >= items.length) return automatic && state.playlist.loop === 'off' ? null : items[0];
    if (next < 0) return items[items.length-1];
    return items[next];
  }
  function cancelTrackNavigation() { state.trackRun++; }
  // What the lesson player joins into one recording; a shuffled join tells the list the order it chose.
  function playlistPlan() {
    if (!state.index) return null;
    const {loop,shuffle} = state.playlist;
    return {items:state.playlist.items.filter(item => sectionMeta(item)),loop,shuffle};
  }
  function useOrder(order) { if (state.playlist.shuffle) state.shuffleOrder = order.map(String); }
  async function navigateTrack(step,endedId = null) {
    const current = state.deps.currentEntry?.() || state.stageSection || state.sectionId;
    if (endedId !== null && (String(current) !== endedId || !state.playlist.items.includes(endedId))) return;
    const run = ++state.trackRun;
    const playbackVersion = state.deps.playbackVersion?.();
    const active = () => run === state.trackRun && playbackVersion === state.deps.playbackVersion?.()
      && current === (state.deps.currentEntry?.() || state.stageSection || state.sectionId);
    try { if (!state.index) await loadIndex(); }
    catch { if (active()) state.deps.notify?.('播放列表暂时无法载入，请检查网络后重试。'); return; }
    if (!active()) return;
    const inList = state.playlist.items.includes(String(current));
    if (endedId !== null && !inList) return;
    let target;
    if (inList || (!sectionMeta(current) && state.playlist.items.length)) target = nextInPlaylist(current,step,endedId !== null);
    else {
      const {previous,next} = neighbours(current);
      target = step > 0 ? next?.id : previous?.id;
    }
    if (target) state.deps.playEntry(target);
  }
  const skipTrack = step => navigateTrack(step);
  window.addEventListener('norsklessonend',event => navigateTrack(1,String(event.detail?.id || '')));
  function playlistRows(compact) {
    const current = String(state.deps.currentEntry?.() || '');
    const items = state.playlist.items.filter(id => sectionMeta(id));
    if (!items.length) return `<p class="rd-list-empty">播放列表还是空的。从下方选几节课文，空闲时放在一旁听。</p>`;
    const total = items.reduce((sum,id) => sum+Number(sectionMeta(id).duration || 0),0);
    return `<p class="rd-list-total">${items.length} 节 · 共 ${clock(total)}</p><ol class="rd-list">${items.map((id,index) => {
      const meta = sectionMeta(id), playing = id === current;
      return `<li class="rd-list-row${playing ? ' is-playing' : ''}"><button type="button" class="rd-list-main" data-rd="list-play" data-id="${e(id)}"><span class="rd-list-no">${playing ? '<i class="rd-eq" aria-hidden="true"><b></b><b></b><b></b></i>' : e(meta.id)}</span><span class="rd-list-title" lang="nb">${e(meta.title)}<small>第 ${e(meta.chapter)} 章 · ${clock(meta.duration)}${meta.synthetic ? ' · 合成补读' : ''}</small></span></button>${compact ? '' : `<button type="button" class="rd-list-icon" data-rd="list-up" data-id="${e(id)}" aria-label="上移" ${index ? '' : 'disabled'}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg></button>`}<button type="button" class="rd-list-icon" data-rd="list-open" data-id="${e(id)}" aria-label="打开课文">${icon('text')}</button><button type="button" class="rd-list-icon" data-rd="list-remove" data-id="${e(id)}" aria-label="移出播放列表">${icon('close')}</button></li>`;
    }).join('')}</ol>`;
  }
  function adderMarkup() {
    const chapters = [...new Set((state.index?.sections || []).map(item => String(item.chapter)))];
    return `<div class="rd-adder"><p class="rd-adder-title">添加课文</p><div class="rd-adder-chips"><button type="button" class="rd-chip" data-rd="add-all">全部 ${state.index?.sections?.length || 0} 节</button>${chapters.map(chapter => `<button type="button" class="rd-chip" data-rd="add-chapter" data-id="${e(chapter)}">第 ${e(chapter)} 章</button>`).join('')}</div>
      <details class="rd-adder-detail"><summary>按小节挑选</summary>${chapters.map(chapter => `<div class="rd-adder-chapter"><p>第 ${e(chapter)} 章</p>${chapterSections(chapter).map(item => { const queued = state.playlist.items.includes(String(item.id)); return `<button type="button" class="rd-adder-row" data-rd="${queued ? 'list-remove' : 'add-one'}" data-id="${e(item.id)}" aria-pressed="${queued}"><span>${e(item.id)}</span><span lang="nb">${e(item.title)}</span><small>${clock(item.duration)}</small>${icon(queued ? 'check' : 'plus')}</button>`; }).join('')}</div>`).join('')}</details></div>`;
  }
  function modeBar() {
    // Loop and shuffle only mean something once there is a list to play.
    if (!state.playlist.items.some(id => sectionMeta(id))) return '';
    return `<div class="rd-list-modes"><button type="button" class="rd-mode" data-rd="loop">${e(LOOP_LABELS[state.playlist.loop])}</button><button type="button" class="rd-mode" data-rd="shuffle" aria-pressed="${state.playlist.shuffle}">随机播放</button>${state.playlist.items.length ? '<button type="button" class="rd-mode is-quiet" data-rd="clear">清空</button>' : ''}</div>`;
  }
  async function openPlaylist() {
    if (!state.sheet || state.sheet.hidden) state.sheetOpener = document.activeElement;
    await loadIndex();
    if (!state.sheet) {
      const sheet = document.createElement('div');
      sheet.className = 'rd-sheet';
      sheet.hidden = true;
      sheet.innerHTML = `<button type="button" class="rd-sheet-shade" data-rd="sheet-close" aria-label="关闭播放列表"></button><section class="rd-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="rd-sheet-title"><header class="rd-sheet-head"><div><p class="rd-kicker">SPILLELISTE</p><h2 id="rd-sheet-title">播放列表</h2></div><button type="button" class="rd-pop-close" data-rd="sheet-close" aria-label="关闭">${icon('close')}</button></header><div class="rd-sheet-body"></div></section>`;
      document.body.append(sheet);
      sheet.addEventListener('click',onClick);
      sheet.addEventListener('keydown',event => { if (event.key === 'Escape') { event.stopPropagation(); closePlaylist(); } });
      state.sheet = sheet;
    }
    renderSheet();
    state.sheet.hidden = false;
    state.deps.openLayer?.('playlist',closePlaylist);
    requestAnimationFrame(() => state.sheet.classList.add('is-open'));
    $('.rd-sheet-head .rd-pop-close',state.sheet)?.focus({preventScroll:true});
  }
  function closePlaylist() {
    if (!state.sheet || state.sheet.hidden) return;
    state.deps.closeLayer?.('playlist');
    state.sheet.classList.remove('is-open');
    restoreFocus(state.sheet,state.sheetOpener);
    state.sheetOpener = null;
    setTimeout(() => { if (!state.sheet.classList.contains('is-open')) state.sheet.hidden = true; },reduced() ? 0 : 240);
  }
  // Rebuilding a list keeps keyboard focus on the same control, or on a steady one nearby when that control is gone.
  function rebuild(root,render,fallback) {
    const active = root.contains(document.activeElement) ? document.activeElement : null;
    const {rd,id = ''} = active?.dataset || {};
    render();
    if (!active) return;
    const same = rd && $$('[data-rd]',root).find(node => node.dataset.rd === rd && (node.dataset.id || '') === id);
    (same || fallback?.())?.focus({preventScroll:true});
  }
  function renderSheet() {
    if (!state.sheet) return;
    const body = $('.rd-sheet-body',state.sheet);
    const open = $('.rd-adder-detail',state.sheet)?.open;
    rebuild(body,() => {
      body.innerHTML = `${modeBar()}${playlistRows(true)}${adderMarkup()}`;
      if (open) $('.rd-adder-detail',state.sheet).open = true;
    },() => $('.rd-sheet-head .rd-pop-close',state.sheet));
  }
  // The full-page playlist lives under 更多.
  async function renderPlaylistPage(container) {
    state.page = container;
    container.innerHTML = '<div class="rd-empty" role="status"><span class="loader"></span><p>正在载入播放列表…</p></div>';
    try { await loadIndex(); } catch { container.innerHTML = '<div class="rd-empty"><p>播放列表暂时无法载入，请检查网络后重试。</p></div>'; return; }
    renderPage();
  }
  function renderPage() {
    const page = state.page;
    if (!page?.isConnected || !state.index) return;
    const open = $('.rd-adder-detail',page)?.open;
    const hasItems = state.playlist.items.some(id => sectionMeta(id));
    rebuild(page,() => {
      page.innerHTML = `<section class="rd-page-list"><header class="rd-page-head"><div><p class="rd-kicker">SPILLELISTE · 随身听</p><h2>播放列表</h2><p class="rd-meta">把课文原录音排成一张清单，按顺序在后台播放；锁屏或切到别的应用也能继续听，遇到不会的词再回到课文里点。</p></div>${hasItems ? `<button type="button" class="rd-button is-primary" data-rd="list-start">${icon('play')}<span>${state.deps.audio.paused ? '开始播放' : '从头播放'}</span></button>` : ''}</header>${modeBar()}${playlistRows(false)}${adderMarkup()}</section>`;
      if (open) $('.rd-adder-detail',page).open = true;
    },() => $('.rd-adder-chips button',page));
  }

  /* ---------- Lock screen and headset controls ---------- */
  function syncMediaSession(detail) {
    const session = navigator.mediaSession;
    if (!session || typeof window.MediaMetadata !== 'function') return;
    const id = String(detail?.id || state.deps.currentEntry?.() || '');
    if (detail) {
      const meta = sectionMeta(id);
      const found = state.deps.findEntry(id);
      try {
        session.metadata = new MediaMetadata({title:meta ? `${meta.id} ${meta.title}` : (found?.entry?.title || 'God i norsk'),artist:`God i norsk · Kapittel ${detail.chapter || meta?.chapter || ''}`,album:'Norsk 学习书房',artwork:[{src:new URL('assets/honors/player-cover.webp',document.baseURI).href,sizes:'384x384',type:'image/webp'}]});
      } catch { /* Metadata is optional. */ }
    }
    const set = (action,handler) => { try { session.setActionHandler(action,handler); } catch { /* Unsupported action. */ } };
    const audio = state.deps.audio;
    set('play',() => {
      if (state.deps.resumeLessonAudio) return state.deps.resumeLessonAudio();
      state.deps.stopWordAudio?.();
      return audio.play().catch(() => {});
    });
    set('pause',() => {
      state.trackRun++;
      if (state.deps.pauseLessonAudio) state.deps.pauseLessonAudio();
      else audio.pause();
    });
    const seek = delta => {
      state.trackRun++;
      if (state.deps.seekLesson) state.deps.seekLesson(delta);
      else audio.currentTime = Math.max(0,Math.min(audio.duration || Infinity,audio.currentTime+delta));
    };
    const offset = details => Number.isFinite(details?.seekOffset) && details.seekOffset > 0 ? details.seekOffset : 5;
    set('seekbackward',details => seek(-offset(details)));
    set('seekforward',details => seek(offset(details)));
    set('previoustrack',() => skipTrack(-1));
    set('nexttrack',() => skipTrack(1));
  }
  window.addEventListener('norsklessonplay',event => {
    state.trackRun++;
    const previous = state.playingSection;
    state.playingSection = String(event.detail?.id || '');
    // When the playlist moves on while its text is open, the page turns with it.
    const view = state.view;
    if (view?.root.isConnected && document.body.dataset.view === 'reading' && !state.container?.hidden && previous && String(view.meta.id) === previous && state.playingSection !== previous && sectionMeta(state.playingSection) && !state.popover) state.deps.openSection?.(state.playingSection);
    syncMediaSession(event.detail);
    renderSheet(); renderPage();
    if (state.stage && !state.stage.hidden) { const meta = sectionMeta(state.playingSection); if (meta && String(meta.id) !== state.stageSection) fillStage(meta); }
    startFollowing();
  });
  window.addEventListener('norsklessonclose',() => { state.trackRun++; syncHighlight(true); });

  /* ---------- Actions ---------- */
  function cycleRate() {
    const select = $('#audio-speed');
    if (!select) return;
    const at = RATES.indexOf(select.value);
    select.value = RATES[(at+1) % RATES.length];
    select.dispatchEvent(new Event('change',{bubbles:true}));
    syncStageOptions();
  }
  function onClick(event) {
    const target = event.target.closest('[data-rd]');
    if (!target) return;
    const action = target.dataset.rd, id = target.dataset.id;
    const view = state.view, popover = state.popover;
    switch (action) {
      case 'play': if (view) state.deps.playEntry(view.meta.id); break;
      case 'queue': if (view) state.playlist.items.includes(String(view.meta.id)) ? removeFromPlaylist(view.meta.id) : addToPlaylist([view.meta.id]); break;
      case 'zh':
        state.showZh = !state.showZh;
        try { localStorage.setItem(ZH_KEY,state.showZh ? '1' : '0'); } catch {}
        view?.root.classList.toggle('show-zh',state.showZh);
        target.setAttribute('aria-pressed',String(state.showZh));
        syncStageOptions();
        break;
      case 'stage': openTranscript(); break;
      case 'open': closePopover(); state.deps.openSection?.(id); break;
      case 'play-chapter': { const ids = chapterSections(id).map(item => String(item.id)); addToPlaylist(ids); if (ids[0]) state.deps.playEntry(ids[0]); break; }
      case 'queue-chapter': addToPlaylist(chapterSections(id).map(item => item.id)); break;
      case 'from': if (view) { const sentence = view.data.sentences[Number(target.dataset.s)]; playFrom(view.meta,sentence.start); } break;
      case 'close': closePopover(); break;
      case 'say': if (view && popover?.kind === 'word') { const word = view.data.sentences[popover.s].words[popover.w]; sayWord(glossOf(word,view.data.lexicon).entry,word[4],word,view.meta); } break;
      case 'slice-word': if (view && popover?.kind === 'word') { const word = view.data.sentences[popover.s].words[popover.w]; playSlice(view.meta,word[2],word[3]); } break;
      case 'slice-sentence': if (view && popover?.kind === 'word') { const sentence = view.data.sentences[popover.s]; playSlice(view.meta,sentence.start,sentence.end); } break;
      case 'from-word': if (view && popover?.kind === 'word') { const sentence = view.data.sentences[popover.s]; closePopover(); playFrom(view.meta,sentence.start); } break;
      case 'slice-range': if (view && popover?.kind === 'phrase') playRange(view,popover.range); break;
      case 'from-range': if (view && popover?.kind === 'phrase') { const sentence = view.data.sentences[popover.range.from.s]; closePopover(); playFrom(view.meta,sentence.start); } break;
      case 'stage-close': closeTranscript(); break;
      case 'stage-zh': state.showZh = !state.showZh; try { localStorage.setItem(ZH_KEY,state.showZh ? '1' : '0'); } catch {} syncStageOptions(); view?.root.classList.toggle('show-zh',state.showZh); view && $('[data-rd="zh"]',view.root)?.setAttribute('aria-pressed',String(state.showZh)); break;
      case 'stage-seek': {
        const data = state.stage?.stageData;
        if (!data) break;
        const sentence = data.data.sentences[Number(target.dataset.s)];
        playFrom(data.meta,sentence.start);
        break;
      }
      case 'toggle': {
        const audio = state.deps.audio, data = state.stage?.stageData;
        if (data && timeIn(data.meta) == null) { state.deps.playEntry(data.meta.id); break; }
        // The lesson player's own controls keep its pending loads, word audio and player bar in step.
        if (!audio.paused) { if (state.deps.pauseLessonAudio) state.deps.pauseLessonAudio(); else audio.pause(); }
        else if (state.deps.resumeLessonAudio) state.deps.resumeLessonAudio({reveal:true});
        else audio.play().catch(() => {});
        startFollowing();
        break;
      }
      case 'back5': case 'fwd5': { const audio = state.deps.audio; if (audio.src) audio.currentTime = Math.max(0,Math.min(audio.duration || Infinity,audio.currentTime+(action === 'back5' ? -5 : 5))); syncStage(true); break; }
      case 'prev-track': skipTrack(-1); break;
      case 'next-track': skipTrack(1); break;
      case 'rate': cycleRate(); break;
      case 'loop': state.playlist.loop = LOOP_MODES[(LOOP_MODES.indexOf(state.playlist.loop)+1) % LOOP_MODES.length]; savePlaylist(); break;
      case 'shuffle': state.playlist.shuffle = !state.playlist.shuffle; savePlaylist(); break;
      case 'clear': state.playlist.items = []; savePlaylist(); break;
      case 'sheet': openPlaylist(); break;
      case 'sheet-close': closePlaylist(); break;
      case 'list-play': state.deps.playEntry(id); break;
      case 'list-start': { const first = state.playlist.items.find(item => sectionMeta(item)); if (first) state.deps.playEntry(first); break; }
      case 'list-open': closePlaylist(); closeTranscript(); state.deps.openSection?.(id); break;
      case 'list-remove': removeFromPlaylist(id); break;
      case 'list-up': moveInPlaylist(id,-1); break;
      case 'add-all': addToPlaylist((state.index?.sections || []).map(item => item.id)); break;
      case 'add-chapter': addToPlaylist(chapterSections(id).map(item => item.id)); break;
      case 'add-one': addToPlaylist([id]); break;
    }
  }
  function onDocumentClick(event) {
    if (!state.popover || Date.now()-(state.openedAt || 0) < 450) return;
    if (event.target.closest('.rd-pop') || event.target.closest('.rd-w')) return;
    closePopover();
  }

  function init(deps) {
    state.deps = {...state.deps,...deps};
    if (state.initialized) return;
    state.initialized = true;
    readPlaylist();
    // A saved list must also work when playback starts from the PDF directory.
    if (state.playlist.items.length) loadIndex().catch(() => {});
    document.addEventListener('click',event => { if (event.target.closest('#reader-text') || event.target.closest('.rd-page-list')) onClick(event); },false);
    document.addEventListener('click',onDocumentClick,true);
    document.addEventListener('pointerdown',event => { if (event.target.closest('#reader-text')) onPointerDown(event); });
    document.addEventListener('pointermove',onPointerMove);
    document.addEventListener('pointerup',onPointerUp);
    document.addEventListener('pointercancel',onPointerCancel);
    document.addEventListener('keydown',event => {
      if (event.key === 'Escape' && state.popover && !event.defaultPrevented) closePopover();
    });
    // The context menu would cover the selection on a long press.
    document.addEventListener('contextmenu',event => { if (event.target.closest('#reader-text .rd-w')) event.preventDefault(); });
    // Once a hold turns into a selection, dragging selects words instead of scrolling. The blocking listener stays on the
    // lesson text so scrolling elsewhere on the site never waits for it.
    document.querySelector('#reader-text')?.addEventListener('touchmove',event => { if (state.press?.selecting) event.preventDefault(); },{passive:false});
    document.addEventListener('keydown',onWordKey);
    // Rotating or resizing across the phone width moves an open card between the bottom sheet and the inline card.
    window.matchMedia?.(NARROW).addEventListener?.('change',() => {
      const pop = state.popover && state.container && $('.rd-pop',state.container);
      if (!pop || pop.hidden) return;
      if (state.popover.anchor?.isConnected) placePopover(pop,state.popover.anchor); else closePopover();
    });
    const audio = state.deps.audio;
    audio.addEventListener('play',stopSlice);
    // Resuming or seeking the same track is a newer playback choice even when its ID is unchanged.
    for (const name of ['play','seeking','seeked']) audio.addEventListener(name,() => { state.trackRun++; });
    for (const name of ['play','playing','seeked']) audio.addEventListener(name,startFollowing);
    for (const name of ['pause','seeked','emptied']) audio.addEventListener(name,() => { syncHighlight(true); syncStage(true); });
    audio.addEventListener('ratechange',syncStageOptions);
    // Animation frames pause in background or throttled tabs; the media clock still ticks a few times a second.
    audio.addEventListener('timeupdate',() => { if (followingVisible() && Date.now()-(state.lastTick || 0) > 300) { syncHighlight(); syncStage(); } });
    document.addEventListener('visibilitychange',() => {
      if (document.hidden) { cancelAnimationFrame(state.frame); state.frame = 0; }
      else startFollowing();
    });
    syncMediaSession();
  }
  function hide() {
    state.visible = false;
    state.showRun++;
    stopSlice();
    closePopover();
    state.deps.onLesson?.(null);
    if (!followingVisible()) { cancelAnimationFrame(state.frame); state.frame = 0; }
  }

  window.NorskReader = {init,show,hide,closeCard:() => closePopover(),stopSlice,cancelTrackNavigation,playlistPlan,useOrder,openTranscript,closeTranscript,openPlaylist,closePlaylist,renderPlaylistPage,addToPlaylist};
  window.dispatchEvent(new Event('norskreaderready'));
})();
