/* Classroom PPT: the teacher's slides for the chapter being read.
   PowerPoint drew each deck as a PDF (scripts/prepare_media.py), so fonts and layout match the original deck;
   here the slides run down one column — a whole slide per screen on wide screens, a few at a time on phones —
   and each one is drawn at the screen's own pixel density. Only the slides near the view keep a canvas. */
(() => {
  'use strict';
  if (window.NorskSlides) return;
  const PLACE_KEY = 'norsk-ppt-slide-v1';
  const KEEP = 2;
  const state = {
    deps:{}, container:null, el:null, lessons:null, lessonsLoad:null, decks:[], deck:null, pdf:null, run:0, showRun:0,
    layout:null, current:0, drawn:new Map(), drawing:false, chapterDeck:{}, places:{}, frame:0, saveTimer:0, observer:null,
  };
  try { state.places = JSON.parse(localStorage.getItem(PLACE_KEY) || '{}') || {}; } catch {}
  const $ = (selector,root = document) => root.querySelector(selector);
  const e = value => state.deps.escapeHTML(value);
  const icon = name => state.deps.icon(name);
  const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const clamp = (value,low,high) => Math.min(high,Math.max(low,value));

  function init(deps) { state.deps = deps; }

  function skeleton(container) {
    if (state.container === container && state.el && container.contains(state.el.scroller)) return;
    state.container = container;
    state.decksKey = '';
    container.innerHTML = `<div class="sl-stage"><div class="sl-decks" role="tablist" aria-label="本章课堂 PPT"></div><div class="sl-scroller" tabindex="0"><div class="sl-track"></div></div></div>
      <div class="page-controls sl-controls"><span class="sl-progress" aria-hidden="true"><span></span></span>
        <button type="button" class="page-button" data-sl="prev" aria-label="上一张" title="上一张（←）">${icon('left')}<span>上一张</span></button>
        <form class="page-jump sl-jump"><label for="sl-input">幻灯片</label><input id="sl-input" type="number" min="1" value="1" aria-label="跳到第几张"><span class="sl-total">/ —</span></form>
        <button type="button" class="page-button" data-sl="next" aria-label="下一张" title="下一张（→）"><span>下一张</span>${icon('chevron')}</button></div>`;
    state.el = {
      decks:$('.sl-decks',container), scroller:$('.sl-scroller',container), track:$('.sl-track',container), controls:$('.sl-controls',container),
      progress:$('.sl-progress>span',container), input:$('#sl-input',container), total:$('.sl-total',container),
      prev:$('[data-sl="prev"]',container), next:$('[data-sl="next"]',container),
    };
    if (!container.dataset.slBound) container.addEventListener('click',event => {
      const target = event.target.closest('[data-sl]');
      if (!target) return;
      const action = target.dataset.sl;
      if (action === 'prev') step(-1);
      else if (action === 'next') step(1);
      else if (action === 'deck') chooseDeck(target.dataset.id);
      else if (action === 'chapter') state.deps.openSection(target.dataset.id);
      else if (action === 'retry') show(container,state.last || {});
    });
    container.dataset.slBound = '1';
    $('.sl-jump',container).addEventListener('submit',event => {
      event.preventDefault();
      const value = Number(state.el.input.value);
      if (!state.deck) return;
      if (!Number.isInteger(value) || value < 1 || value > state.deck.slides.length) {
        state.deps.notify(`请输入 1 到 ${state.deck.slides.length} 之间的幻灯片序号。`);
        state.el.input.value = state.current + 1;
        return;
      }
      goTo(value - 1);
      state.el.input.blur();
    });
    state.el.scroller.addEventListener('scroll',() => {
      if (state.frame) return;
      state.frame = requestAnimationFrame(() => { state.frame = 0; settle(); });
    },{passive:true});
    state.el.scroller.addEventListener('scrollend',() => { state.heading = null; settle(); });
    if ('ResizeObserver' in window) {
      state.observer?.disconnect();
      state.observer = new ResizeObserver(() => { if (state.deck && state.el.scroller.clientWidth) relayout(); });
      state.observer.observe(state.el.scroller);
    }
    state.deps.watchScroll?.(state.el.scroller);
  }

  function loadLessons() {
    if (state.lessons) return Promise.resolve(state.lessons);
    if (!state.lessonsLoad) state.lessonsLoad = state.deps.loadData('lessons').then(data => (state.lessons = data?.lessons || [])).catch(error => { state.lessonsLoad = null; throw error; });
    return state.lessonsLoad;
  }

  // The deck follows the directory: a section's own deck, else the one last opened in this chapter.
  async function show(container,{chapterId = '',sectionId = ''} = {}) {
    skeleton(container);
    state.last = {chapterId,sectionId};
    // Showing the same deck again (a resize, the directory) must not cancel the slides being drawn, so showing keeps its own count.
    const ticket = ++state.showRun;
    if (!state.lessons) message('正在载入课堂 PPT…');
    let lessons;
    try { lessons = await loadLessons(); }
    catch { if (ticket === state.showRun) message('课堂 PPT 暂时无法载入','请检查网络后重试。',true); return; }
    if (ticket !== state.showRun) return;
    const decks = lessons.filter(deck => String(deck.chapter) === String(chapterId));
    state.decks = decks;
    if (!decks.length) { empty(lessons,chapterId); return; }
    const deck = decks.find(item => item.sections?.includes(String(sectionId)))
      || decks.find(item => item.id === state.chapterDeck[chapterId])
      || (decks.includes(state.deck) ? state.deck : null) || decks[0];
    renderDecks(deck);
    if (deck !== state.deck) openDeck(deck);
    else relayout();
  }

  function renderDecks(active) {
    const {decks} = state.el;
    decks.hidden = false;
    const key = `${state.decks.map(deck => deck.id).join(' ')}|${active.id}`;
    if (key === state.decksKey) return;
    state.decksKey = key;
    decks.innerHTML = state.decks.map(deck => `<button type="button" role="tab" class="sl-deck" data-sl="deck" data-id="${e(deck.id)}" aria-selected="${deck === active}" title="${e(deck.title)} · ${deck.slides.length} 张">${e(deck.label || deck.title)}</button>`).join('');
    // Only the tab row moves to show the chosen deck; scrollIntoView could move the whole page on a phone.
    const chip = decks.querySelector('[aria-selected="true"]');
    if (chip && (chip.offsetLeft < decks.scrollLeft || chip.offsetLeft + chip.offsetWidth > decks.scrollLeft + decks.clientWidth)) decks.scrollLeft = chip.offsetLeft - 8;
  }

  function chooseDeck(id) {
    const deck = state.decks.find(item => item.id === id);
    if (!deck) return;
    state.chapterDeck[deck.chapter] = deck.id;
    renderDecks(deck);
    if (deck !== state.deck) openDeck(deck);
    // The directory and the original page follow the deck, so 原页 opens where these slides are.
    if (deck.sections?.length && !deck.sections.includes(String(state.last?.sectionId))) state.deps.openSection(deck.sections[0]);
  }

  async function openDeck(deck) {
    const run = ++state.run;
    release();
    state.deck = deck;
    state.chapterDeck[deck.chapter] = deck.id;
    state.pdf = null;
    state.deps.onDeck?.(deck);
    const {scroller,track,controls} = state.el;
    scroller.setAttribute('aria-label',`${deck.title}，共 ${deck.slides.length} 张`);
    controls.hidden = false;
    state.el.total.textContent = `/ ${deck.slides.length}`;
    state.el.input.max = deck.slides.length;
    track.innerHTML = deck.slides.map((slide,index) => `<figure class="sl-slide" role="img" data-index="${index}" aria-label="${e(`第 ${index+1} 张${slide.title ? `：${slide.title}` : ''}${slide.text ? ` ${slide.text.replace(/\n+/g,' ')}` : ''}`)}"><span class="sl-placeholder" aria-hidden="true">${e(slide.title)}</span></figure>`).join('');
    state.layout = null;
    state.current = clamp(Number(state.places[deck.id]) || 0,0,deck.slides.length - 1);
    relayout({aspect:16/9});
    try {
      const pdf = await state.deps.getPDF(deck.pdf);
      if (run !== state.run) return;
      state.pdf = pdf;
      const first = (await pdf.getPage(1)).getViewport({scale:1});
      if (run !== state.run) return;
      relayout({aspect:first.width / first.height});
      queue();
    } catch (error) {
      if (run !== state.run) return;
      console.error('课堂 PPT 加载失败',error);
      message('这份 PPT 暂时无法显示','请检查网络后重试；也可以点右上角下载原 PPT。',true);
    }
  }

  // Wide screens show one whole slide at a time and snap to it; narrow ones show a column of slides.
  function relayout({aspect} = {}) {
    const {scroller,track} = state.el;
    const deck = state.deck;
    if (!deck || !scroller.clientWidth) return;
    const keep = state.current;
    const ratio = aspect || state.layout?.aspect || 16/9;
    const narrow = scroller.clientWidth < 560;
    const pad = narrow ? 8 : 18, gap = narrow ? 10 : 18;
    const width = scroller.clientWidth - pad*2, height = scroller.clientHeight - pad*2;
    const w = Math.max(120,Math.floor(Math.min(width,height * ratio)));
    const h = Math.round(w / ratio);
    const paged = h >= scroller.clientHeight * .62;
    const top = paged ? Math.max(pad,Math.floor((scroller.clientHeight - h)/2)) : pad;
    const left = Math.floor((scroller.clientWidth - w)/2);
    const layout = {aspect:ratio,w,h,pitch:h + gap,top,left,paged,pad,n:deck.slides.length,height:paged ? scroller.clientHeight : 0};
    const before = state.layout;
    // Nothing moved (a phone's address bar sliding away, the deck shown again): the reader's scrolling is left alone.
    if (before && ['w','h','top','left','paged','n','height'].every(key => before[key] === layout[key])) { queue(); return; }
    const resized = !before || before.w !== w || before.h !== h;
    state.layout = layout;
    scroller.classList.toggle('is-paged',paged);
    scroller.style.scrollPaddingTop = paged ? '' : `${pad}px`;
    track.style.height = `${top*2 + layout.n*h + (layout.n-1)*gap}px`;
    for (const figure of track.children) {
      const index = Number(figure.dataset.index);
      figure.style.cssText = `top:${top + index*layout.pitch}px;left:${left}px;width:${w}px;height:${h}px`;
    }
    if (resized) release();
    goTo(keep,{instant:true});
    queue();
  }

  const offset = () => state.layout.paged ? state.layout.top - Math.floor((state.el.scroller.clientHeight - state.layout.h)/2) : state.layout.top - state.layout.pad;
  const targetTop = index => offset() + index * state.layout.pitch;

  function goTo(index,{instant = false} = {}) {
    if (!state.layout) return;
    const next = clamp(index,0,state.layout.n - 1);
    state.current = next;
    const smooth = !instant && !reduced();
    // While a smooth scroll is on its way the slide it heads for stays current, so quick presses add up.
    state.heading = smooth ? {index:next,until:Date.now() + 900} : null;
    clearTimeout(state.headingTimer);
    if (smooth) state.headingTimer = setTimeout(settle,950);
    state.el.scroller.scrollTo({top:targetTop(next),behavior:smooth ? 'smooth' : 'auto'});
    showPlace(next);
    queue();
  }
  function step(delta) { if (state.deck && state.layout) goTo(state.current + delta); }

  function indexAt() {
    const {scroller} = state.el;
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2 && scroller.scrollTop > 0) return state.layout.n - 1;
    return clamp(Math.round((scroller.scrollTop - offset()) / state.layout.pitch),0,state.layout.n - 1);
  }
  function settle() {
    if (!state.layout) return;
    const {heading} = state;
    const {scroller} = state.el;
    const arrived = heading && (Math.abs(scroller.scrollTop - clamp(targetTop(heading.index),0,scroller.scrollHeight - scroller.clientHeight)) < 2 || Date.now() > heading.until);
    if (!heading || arrived) { state.heading = null; state.current = indexAt(); }
    showPlace(state.current);
    queue();
    clearTimeout(state.saveTimer);
    const deck = state.deck, place = state.current;
    state.saveTimer = setTimeout(() => {
      if (!deck) return;
      state.places[deck.id] = place;
      try { localStorage.setItem(PLACE_KEY,JSON.stringify(state.places)); } catch {}
    },300);
  }
  function showPlace(index) {
    const n = state.layout?.n || 0;
    if (document.activeElement !== state.el.input) state.el.input.value = index + 1;
    state.el.progress.style.transform = `scaleX(${n ? (index + 1) / n : 0})`;
    state.el.prev.disabled = index <= 0;
    state.el.next.disabled = index >= n - 1;
  }

  function visibleRange() {
    const {scroller} = state.el, {top,pitch,n} = state.layout;
    const first = Math.floor((scroller.scrollTop - top) / pitch);
    const last = Math.floor((scroller.scrollTop + scroller.clientHeight - top) / pitch);
    return [clamp(first,0,n - 1),clamp(last,0,n - 1)];
  }
  // Slides on screen are drawn first, then their neighbours; canvases further away are given back.
  function queue() {
    if (!state.pdf || !state.layout || !state.container?.isConnected) return;
    const [first,last] = visibleRange();
    const low = Math.max(0,first - KEEP), high = Math.min(state.layout.n - 1,last + KEEP);
    for (const [index,item] of state.drawn) if (index < low || index > high) drop(index,item);
    if (state.drawing) return;
    const wanted = [];
    for (let index = low; index <= high; index++) if (!state.drawn.has(index)) wanted.push(index);
    wanted.sort((a,b) => (a >= first && a <= last ? 0 : 1) - (b >= first && b <= last ? 0 : 1) || Math.abs(a - state.current) - Math.abs(b - state.current));
    if (wanted.length) draw(wanted[0]);
  }
  async function draw(index) {
    const run = state.run, pdf = state.pdf, {w,h} = state.layout;
    const figure = state.el.track.children[index];
    if (!figure) return;
    const item = {canvas:document.createElement('canvas'),task:null};
    state.drawn.set(index,item);
    state.drawing = true;
    try {
      const page = await pdf.getPage(index + 1);
      if (run !== state.run || state.drawn.get(index) !== item) return;
      const viewport = page.getViewport({scale:w / page.getViewport({scale:1}).width});
      // The canvas holds one pixel per screen pixel (up to 3×), so the slide's text stays sharp.
      const ratio = Math.min(window.devicePixelRatio || 1,3,Math.sqrt(16000000 / (w*h)));
      item.canvas.width = Math.round(w * ratio);
      item.canvas.height = Math.round(h * ratio);
      item.task = page.render({canvasContext:item.canvas.getContext('2d',{alpha:false}),viewport,transform:ratio !== 1 ? [ratio,0,0,ratio,0,0] : null});
      await item.task.promise;
      item.task = null;
      if (run !== state.run || state.drawn.get(index) !== item) return;
      figure.append(item.canvas);
      requestAnimationFrame(() => item.canvas.classList.add('is-drawn'));
    } catch (error) {
      if (error?.name !== 'RenderingCancelledException') console.warn('幻灯片绘制失败',index + 1,error);
    } finally {
      // A slide that did not make it onto the page is free to be drawn again.
      if (state.drawn.get(index) === item && !item.canvas.isConnected) state.drawn.delete(index);
      state.drawing = false;
      queue();
    }
  }
  function drop(index,item) {
    state.drawn.delete(index);
    if (item.task) { try { item.task.cancel(); } catch {} }
    item.canvas.remove();
    item.canvas.width = item.canvas.height = 0;
  }
  function release() { for (const [index,item] of [...state.drawn]) drop(index,item); }

  function message(text,detail = '',retry = false) {
    ++state.run;
    release();
    state.deck = null;
    state.el.decks.hidden = !state.decks.length || !state.decksKey;
    state.el.controls.hidden = true;
    state.el.scroller.classList.remove('is-paged');
    state.el.track.style.height = '';
    state.el.track.innerHTML = `<div class="sl-message">${retry ? icon('file') : '<span class="loader"></span>'}<p>${e(text)}</p>${detail ? `<small>${e(detail)}</small>` : ''}${retry ? '<button type="button" data-sl="retry">重新载入</button>' : ''}</div>`;
    state.deps.onDeck?.(null);
  }
  // Chapters without slides point to the chapters that have them.
  function empty(lessons,chapterId) {
    // Each chapter button opens the chapter's first deck.
    const chapters = lessons.filter((deck,index) => lessons.findIndex(item => String(item.chapter) === String(deck.chapter)) === index);
    ++state.run;
    release();
    state.deck = null;
    state.el.decks.hidden = true;
    state.decksKey = '';
    state.el.controls.hidden = true;
    state.el.scroller.classList.remove('is-paged');
    state.el.track.style.height = '';
    const title = state.deps.chapterTitle?.(chapterId);
    state.el.track.innerHTML = `<div class="sl-message sl-empty">${icon('file')}<p>${title ? `「${e(title)}」` : '这一章'}还没有课堂 PPT</p><small>老师的 PPT 目前覆盖以下章节</small>
      <div class="sl-chapters">${chapters.map(deck => {
        const count = lessons.filter(item => String(item.chapter) === String(deck.chapter)).length;
        return `<button type="button" data-sl="chapter" data-id="${e(deck.sections?.[0] || deck.chapter)}"><strong>第 ${e(deck.chapter)} 章</strong><span>${count} 份</span></button>`;
      }).join('')}</div></div>`;
    state.deps.onDeck?.(null);
  }

  function hide() {
    ++state.run;
    release();
    state.deck = null;
    state.layout = null;
    if (state.el) state.el.track.innerHTML = '';
  }

  window.NorskSlides = {init,show,hide,step,deck:() => state.deck};
})();
