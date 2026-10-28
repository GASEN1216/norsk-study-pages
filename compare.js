/* Independent textbook / workbook reading panes. */
(() => {
  'use strict';
  if (window.NorskCompare) return;
  const STORAGE_KEY = 'norsk-compare-v2';
  const BOOKS = ['textbook','workbook'];
  const LABELS = {textbook:'教材',workbook:'练习册'};
  const ZOOMS = ['fit-page','fit-width','0.75','1','1.25','1.5','2','3'];
  const makePane = book => ({slot:book,book,positions:{},page:1,id:'',zoom:'fit-page',tocOpen:false,expanded:new Set(),scroll:{left:0,top:0},run:0,task:null,settling:Promise.resolve(),dirty:true,error:false,resizeTimer:null,stageSize:''});
  const state = {root:null,deps:{},panes:{textbook:makePane('textbook'),workbook:makePane('workbook')},open:false,initialized:false,openedOnce:false,saved:false,mobileBook:'textbook',resizeTimer:null,saveTimer:null,storageWarning:false,focusFallback:false,observer:null};
  const e = value => (state.deps.escapeHTML || (text => String(text ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))))(value);
  const str = value => String(value ?? '');
  const $ = selector => state.root?.querySelector(selector);
  const paneNode = pane => $(`[data-cp-pane="${pane.slot}"]`);
  const node = (pane,selector) => paneNode(pane)?.querySelector(selector);
  const symbol = name => state.deps.icon?.(name) || '';
  const notify = message => state.deps.notify?.(message);
  const mobile = () => window.matchMedia('(max-width: 680px)').matches;
  const bookData = book => state.deps.data?.catalog?.books?.[book];
  const bookLabel = book => bookData(book)?.label || (bookData(book)?.kind === 'workbook' ? '练习册' : LABELS[book] || '教材');
  const seriesOf = book => bookData(book)?.seriesId || 'god-i-norsk';
  const availableBooks = () => Object.keys(state.deps.data?.catalog?.books || {});
  const chapters = book => [...(bookData(book)?.chapters || []),...(bookData(book)?.appendices || [])];
  const totalPages = book => Math.max(1,Number(bookData(book)?.pages) || 1);
  const button = (action,text,book='',attrs='',className='') => `<button type="button" class="cp-button ${className}" data-compare-action="${action}" ${book ? `data-cp-book="${book}"` : ''} ${attrs}>${text}</button>`;
  function findEntry(book,id) {
    for (const chapter of chapters(book)) {
      if (str(chapter.id) === str(id)) return {entry:chapter,chapter};
      const entry=(chapter.sections || []).find(section => str(section.id) === str(id));
      if (entry) return {entry,chapter};
    }
    return null;
  }
  function closestEntry(book,page) {
    let closest=null;
    for (const chapter of chapters(book)) {
      for (const entry of [chapter,...(chapter.sections || [])]) {
        if (Number(entry.page) <= page && (!closest || Number(entry.page) >= Number(closest.entry.page))) closest={entry,chapter};
      }
    }
    return closest;
  }
  function validPosition(book,value={}) {
    const page=Math.min(totalPages(book),Math.max(1,Math.floor(Number(value.page) || Number(chapters(book)[0]?.page) || 1)));
    const match=findEntry(book,value.id) || closestEntry(book,page);
    return {page,id:str(match?.entry?.id)};
  }
  function positions() {
    return Object.fromEntries(BOOKS.map(slot => [slot,{book:state.panes[slot].book,page:state.panes[slot].page,id:state.panes[slot].id}]));
  }
  function remember(pane) {
    pane.positions[pane.book]={page:pane.page,id:pane.id,zoom:pane.zoom,tocOpen:pane.tocOpen,expanded:[...pane.expanded],scroll:{...pane.scroll}};
  }
  function restorePane(pane,value={}) {
    const book=pane.book;
    Object.assign(pane,validPosition(book,value));
    pane.zoom=ZOOMS.includes(str(value.zoom)) ? str(value.zoom) : 'fit-page';
    pane.tocOpen=typeof value.tocOpen === 'boolean' ? value.tocOpen : window.innerWidth >= 1260;
    pane.expanded=new Set((Array.isArray(value.expanded) ? value.expanded : []).map(str).filter(id => chapters(book).some(chapter => str(chapter.id) === id)));
    const match=findEntry(book,pane.id);
    if (match) pane.expanded.add(str(match.chapter.id));
    pane.scroll={left:Math.max(0,Number(value.scroll?.left) || 0),top:Math.max(0,Number(value.scroll?.top) || 0)};
  }
  function switchBook(pane,book,seed) {
    if (!pane || !bookData(book)) return false;
    remember(pane); cancelRender(pane);
    pane.book=book;
    restorePane(pane,pane.positions[book] || seed || {});
    updatePane(pane); renderTOC(pane); save(); render(pane);
    return true;
  }
  function save() {
    clearTimeout(state.saveTimer);
    const record={version:2,mobileBook:state.mobileBook,seriesId:state.seriesId,panes:{}};
    for (const slot of BOOKS) {
      const pane=state.panes[slot];
      remember(pane);
      record.panes[slot]={book:pane.book,positions:pane.positions};
    }
    try { localStorage.setItem(STORAGE_KEY,JSON.stringify(record)); }
    catch {
      if (!state.storageWarning) notify('对照阅读位置暂时无法保存在本机，离开前可以记下两边页码。');
      state.storageWarning=true;
    }
  }
  function restore() {
    let saved=null;
    try { saved=JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem('norsk-compare-v1') || 'null'); } catch {}
    state.saved=!!((saved?.version === 2 && saved.panes) || (saved?.version === 1 && saved.textbook && saved.workbook));
    state.seriesId=state.saved ? str(saved.seriesId || 'god-i-norsk') : '';
    for (const slot of BOOKS) {
      const pane=state.panes[slot];
      const stored=saved?.version === 2 ? saved.panes?.[slot] : null;
      pane.book=bookData(stored?.book) ? stored.book : bookData(slot) ? slot : availableBooks()[0];
      pane.positions=Object.fromEntries(Object.entries(stored?.positions || {}).filter(([book,value]) => bookData(book) && value && typeof value === 'object'));
      if (saved?.version === 1 && saved[slot]) pane.positions[slot]=saved[slot];
      restorePane(pane,pane.positions[pane.book] || {});
    }
    if (BOOKS.includes(saved?.mobileBook)) state.mobileBook=saved.mobileBook;
  }
  function partFor(pane) {
    if (state.deps.documentPart) return state.deps.documentPart(pane.page,pane.book);
    const manifest=state.deps.data?.documents?.[pane.book];
    const parts=Array.isArray(manifest) ? manifest : manifest?.parts;
    return parts?.find(part => pane.page >= Number(part.startPage) && pane.page <= Number(part.endPage)) || null;
  }
  function safeURL(file) {
    if (state.deps.safeURL) return state.deps.safeURL(file);
    try { const url=new URL(str(file),document.baseURI); return ['http:','https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
  }
  function zoomOptions(selected) {
    const labels={'fit-page':'整页适配','fit-width':'适合宽度','0.75':'75%','1':'100%','1.25':'125%','1.5':'150%','2':'200%','3':'300%'};
    return ZOOMS.map(value => `<option value="${value}" ${value === selected ? 'selected' : ''}>${labels[value]}</option>`).join('');
  }
  function bookOptions(selected) {
    const groups=new Map();
    const series=state.deps.data?.catalog?.series || [];
    for (const book of availableBooks()) {
      const id=seriesOf(book);
      if (!groups.has(id)) groups.set(id,[]);
      groups.get(id).push(book);
    }
    return [...groups].map(([id,books]) => `<optgroup label="${e(series.find(item => item.id === id)?.title || (id === 'god-i-norsk' ? 'God i norsk' : id))}">${books.map(book => `<option value="${e(book)}" ${book === selected ? 'selected' : ''}>${e(bookData(book).title || bookLabel(book))}</option>`).join('')}</optgroup>`).join('');
  }
  function paneHTML(book) {
    const pane=state.panes[book];
    return `<section class="cp-pane ${pane.tocOpen ? '' : 'cp-toc-closed'}" data-cp-pane="${book}" aria-label="${book === 'textbook' ? '左侧' : '右侧'}独立阅读区"><header class="cp-pane-heading"><div><h2>${book === 'textbook' ? '左侧' : '右侧'}</h2><select class="cp-book-select" data-cp-select="${book}" aria-label="${book === 'textbook' ? '左侧' : '右侧'}选择书籍">${bookOptions(pane.book)}</select></div>${button('toc',`${symbol('menu')}<span>目录</span>`,book,`aria-expanded="${pane.tocOpen}" aria-controls="cp-${book}-toc"`,'cp-directory-toggle')}</header><div class="cp-pane-body"><aside class="cp-directory" id="cp-${book}-toc" aria-label="${book === 'textbook' ? '左侧' : '右侧'}章节目录" ${pane.tocOpen ? '' : 'hidden'}><div class="cp-directory-heading"><span>章节与小节</span>${button('toc',symbol('close') || '关闭',book,`aria-label="隐藏${book === 'textbook' ? '左侧' : '右侧'}目录"`,'cp-icon-button')}</div><nav class="cp-catalog" aria-label="${book === 'textbook' ? '左侧' : '右侧'}完整目录"></nav></aside><div class="cp-document"><div class="cp-toolbar"><span class="cp-current-title"></span><label class="cp-zoom-label"><span class="sr-only">${book === 'textbook' ? '左侧' : '右侧'}页面缩放</span><select data-cp-zoom="${book}" aria-label="${book === 'textbook' ? '左侧' : '右侧'}页面缩放">${zoomOptions(pane.zoom)}</select></label><a class="cp-download cp-icon-button" aria-label="下载${book === 'textbook' ? '左侧' : '右侧'}当前 PDF 分册" title="下载当前 PDF 分册" target="_blank" rel="noopener noreferrer">${symbol('download') || '下载'}</a></div><div class="cp-stage" tabindex="0" aria-label="${book === 'textbook' ? '左侧' : '右侧'} PDF 页面"><div class="cp-page-area"><canvas class="cp-canvas" role="img" hidden></canvas></div><div class="cp-message" role="status"></div></div><footer class="cp-page-controls">${button('prev',`${symbol('left')}<span>上一页</span>`,book,`aria-label="${book === 'textbook' ? '左侧' : '右侧'}上一页"`,'cp-page-button')}<form class="cp-page-form" data-cp-form="${book}"><label for="cp-${book}-page">PDF</label><input id="cp-${book}-page" aria-label="${book === 'textbook' ? '左侧' : '右侧'} PDF 页码" type="number" min="1" max="${totalPages(pane.book)}" step="1" inputmode="numeric" value="${pane.page}"><span class="cp-total">/ ${totalPages(pane.book)}</span><button type="submit" class="cp-button cp-jump">跳转</button></form>${button('next',`<span>下一页</span>${symbol('chevron')}`,book,`aria-label="${book === 'textbook' ? '左侧' : '右侧'}下一页"`,'cp-page-button')}</footer></div></div></section>`;
  }
  function build() {
    state.root.innerHTML=`<div class="cp-shell"><header class="cp-topbar"><div class="cp-title"><span>按需选择两侧书籍</span><h1>对照阅读</h1></div><div class="cp-mobile-switch" role="tablist" aria-label="选择阅读一侧">${BOOKS.map(book => button('mobile',book === 'textbook' ? '左侧' : '右侧',book,`role="tab" aria-selected="${state.mobileBook === book}"`)).join('')}</div><div class="cp-top-actions">${button('fullscreen','全屏对照','','aria-pressed="false"','cp-fullscreen')}${button('close',`${symbol('left')}<span>返回单页</span>`,'','','cp-close')}</div></header><div class="cp-panes">${BOOKS.map(paneHTML).join('')}</div></div>`;
    state.root.dataset.cpMobile=state.mobileBook;
    for (const book of BOOKS) {
      const pane=state.panes[book];
      renderTOC(pane); updatePane(pane);
      node(pane,'.cp-stage').addEventListener('scroll',() => {
        if (!state.open || pane.dirty) return;
        const stage=node(pane,'.cp-stage');
        pane.scroll={left:stage.scrollLeft,top:stage.scrollTop};
        clearTimeout(state.saveTimer); state.saveTimer=setTimeout(save,250);
      },{passive:true});
    }
  }
  function entryHTML(pane,entry,chapter,isChapter=false) {
    const id=str(entry.id);
    const number=/^(?:[\d.]+|\d+\.[A-Z])$/.test(id) ? (isChapter ? id.padStart(2,'0') : id) : '';
    const recording=pane.book === 'textbook' ? state.deps.entryAudio?.(entry,chapter,pane.book) : null;
    const synthetic=recording?.kind === 'synthetic';
    return `${button('entry',`${number ? `<span class="cp-entry-number">${e(number)}</span>` : ''}<span class="cp-entry-label">${e(entry.title)}${synthetic ? '<small class="cp-synthetic">合成补读</small>' : ''}</span>`,pane.slot,`data-cp-id="${e(id)}" aria-label="${bookLabel(pane.book)} ${e(number)} ${e(entry.title)}" ${pane.id === id ? 'aria-current="page"' : ''}`,'cp-entry')}<span class="cp-print-page" title="印刷页码">${e(entry.printedPage ?? '')}</span>${recording?.file ? button('audio',symbol('play') || '▶',pane.slot,`data-cp-id="${e(id)}" aria-label="播放${bookLabel(pane.book)} ${e(entry.title)}${synthetic ? ' · 合成补读' : ''}" title="${synthetic ? '播放合成补读' : '播放课文录音'}"`,'cp-audio') : ''}`;
  }
  function renderTOC(pane) {
    const list=node(pane,'.cp-catalog');
    if (!list) return;
    const all=chapters(pane.book);
    const count=(bookData(pane.book)?.chapters || []).length;
    list.innerHTML=all.length ? all.map((chapter,index) => {
      const expanded=pane.expanded.has(str(chapter.id));
      const sections=chapter.sections || [];
      return `${index === count && (bookData(pane.book)?.appendices || []).length ? '<div class="cp-appendix-label">附录</div>' : ''}<div class="cp-catalog-group" data-cp-group="${e(chapter.id)}"><div class="cp-chapter-row ${pane.id === str(chapter.id) ? 'cp-selected' : ''}">${sections.length ? button('expand',symbol('chevron') || '›',pane.slot,`data-cp-id="${e(chapter.id)}" aria-label="${expanded ? '收起' : '展开'}${bookLabel(pane.book)} ${e(chapter.title)}" aria-expanded="${expanded}"`,'cp-expand') : '<span class="cp-toggle-spacer"></span>'}${entryHTML(pane,chapter,chapter,true)}</div>${sections.length ? `<div class="cp-sections" ${expanded ? '' : 'hidden'}>${sections.map(section => `<div class="cp-section-row ${pane.id === str(section.id) ? 'cp-selected' : ''}">${entryHTML(pane,section,chapter)}</div>`).join('')}</div>` : ''}</div>`;
    }).join('') : '<p class="cp-directory-empty">目录暂未载入。</p>';
  }
  function updatePane(pane) {
    const selector=node(pane,'.cp-book-select');
    if (selector) { selector.innerHTML=bookOptions(pane.book); selector.value=pane.book; }
    const total=node(pane,'.cp-total');
    if (total) total.textContent=`/ ${totalPages(pane.book)}`;
    const zoom=node(pane,`[data-cp-zoom="${pane.slot}"]`);
    if (zoom) zoom.value=pane.zoom;
    const match=findEntry(pane.book,pane.id);
    node(pane,'.cp-current-title').textContent=match?.entry?.title || '开始阅读';
    node(pane,'.cp-current-title').title=match?.entry?.title || '';
    const input=node(pane,'input[type="number"]');
    input.value=pane.page; input.max=totalPages(pane.book); input.removeAttribute('aria-invalid');
    node(pane,'[data-compare-action="prev"]').disabled=pane.page <= 1;
    node(pane,'[data-compare-action="next"]').disabled=pane.page >= totalPages(pane.book);
    const part=partFor(pane);
    const link=node(pane,'.cp-download');
    const url=part?.file ? safeURL(part.file) : '';
    link.hidden=!url; if (url) link.href=url;
    const toggle=node(pane,'.cp-directory-toggle');
    toggle.setAttribute('aria-expanded',str(pane.tocOpen));
    toggle.setAttribute('aria-label',`${bookLabel(pane.book)}目录`);
    node(pane,'.cp-directory').hidden=!pane.tocOpen;
    paneNode(pane).classList.toggle('cp-toc-closed',!pane.tocOpen);
  }
  function cancelRender(pane) {
    pane.run += 1;
    if (pane.task) {
      const task=pane.task;
      pane.task=null;
      try { task.cancel(); } catch {}
      pane.settling=Promise.resolve(task.promise).catch(() => {});
    }
    pane.dirty=true;
  }
  function paneVisible(pane) { return state.open && !state.root.hidden && (!mobile() || state.mobileBook === pane.slot); }
  function renderMessage(pane,message,error=false) {
    const box=node(pane,'.cp-message');
    box.innerHTML=`${error ? '' : '<span class="cp-loader" aria-hidden="true"></span>'}<p>${e(message)}</p>${error ? button('retry','重新载入',pane.slot,'','cp-retry') : ''}`;
    box.hidden=false; node(pane,'.cp-canvas').hidden=true; pane.error=error;
  }
  async function render(pane) {
    cancelRender(pane);
    if (!paneVisible(pane)) return;
    const stage=node(pane,'.cp-stage');
    const renderKey=`${pane.book}:${pane.page}:${pane.zoom}:${stage.clientWidth}:${stage.clientHeight}:${window.devicePixelRatio || 1}`;
    if (pane.renderedKey === renderKey) {
      node(pane,'.cp-canvas').hidden=false; node(pane,'.cp-message').hidden=true;
      stage.scrollLeft=pane.scroll.left; stage.scrollTop=pane.scroll.top;
      pane.dirty=false; pane.error=false;
      return;
    }
    const run=pane.run;
    const part=partFor(pane);
    if (!part?.file) { renderMessage(pane,'这一页的 PDF 暂时无法载入。',true); return; }
    renderMessage(pane,'正在载入这一页…');
    let task=null;
    try {
      if (!state.deps.getPDF) throw new Error('PDF reader unavailable');
      const pdf=await state.deps.getPDF(part.file);
      if (run !== pane.run || !paneVisible(pane)) return;
      const pdfPage=await pdf.getPage(pane.page-Number(part.startPage)+1);
      if (run !== pane.run || !paneVisible(pane)) return;
      await pane.settling;
      if (run !== pane.run || !paneVisible(pane)) return;
      if (stage.clientWidth < 30 || stage.clientHeight < 30) return;
      const style=getComputedStyle(stage);
      const width=Math.max(20,stage.clientWidth-parseFloat(style.paddingLeft || 0)-parseFloat(style.paddingRight || 0)-2);
      const height=Math.max(20,stage.clientHeight-parseFloat(style.paddingTop || 0)-parseFloat(style.paddingBottom || 0)-2);
      const natural=pdfPage.getViewport({scale:1});
      const scale=pane.zoom === 'fit-page' ? Math.min(width/natural.width,height/natural.height) : pane.zoom === 'fit-width' ? width/natural.width : Number(pane.zoom);
      const viewport=pdfPage.getViewport({scale});
      const ratio=Math.max(.5,Math.min(window.devicePixelRatio || 1,2,Math.sqrt(16000000/(viewport.width*viewport.height))));
      const canvas=node(pane,'.cp-canvas');
      pane.renderedKey='';
      canvas.width=Math.max(1,Math.floor(viewport.width*ratio)); canvas.height=Math.max(1,Math.floor(viewport.height*ratio));
      canvas.style.width=`${Math.floor(viewport.width)}px`; canvas.style.height=`${Math.floor(viewport.height)}px`;
      canvas.setAttribute('aria-label',`${bookLabel(pane.book)}，PDF 第 ${pane.page} 页`);
      task=pdfPage.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio === 1 ? undefined : [ratio,0,0,ratio,0,0]});
      pane.task=task;
      await task.promise;
      if (run !== pane.run || !paneVisible(pane)) return;
      canvas.hidden=false; node(pane,'.cp-message').hidden=true;
      stage.scrollLeft=pane.scroll.left; stage.scrollTop=pane.scroll.top;
      pane.error=false; pane.dirty=false; pane.renderedKey=renderKey;
    } catch (error) {
      if (run !== pane.run || error?.name === 'RenderingCancelledException' || !paneVisible(pane)) return;
      renderMessage(pane,'这一页暂时无法显示，请检查网络后重试。',true);
    } finally { if (pane.task === task) pane.task=null; }
  }
  function goPage(pane,value,id='') {
    const page=Number(value);
    if (!Number.isInteger(page) || page < 1 || page > totalPages(pane.book)) {
      node(pane,'input[type="number"]').setAttribute('aria-invalid','true');
      notify(`${bookLabel(pane.book)}页码请输入 1–${totalPages(pane.book)} 的整数。`);
      return false;
    }
    pane.page=page;
    const match=(id && findEntry(pane.book,id)) || closestEntry(pane.book,page);
    pane.id=str(match?.entry?.id);
    if (match) pane.expanded.add(str(match.chapter.id));
    pane.scroll={left:0,top:0};
    updatePane(pane); renderTOC(pane); save(); render(pane);
    return true;
  }
  function toggleTOC(pane) {
    pane.tocOpen=!pane.tocOpen;
    updatePane(pane); save();
    requestAnimationFrame(() => render(pane));
  }
  function setMobileBook(book) {
    if (!BOOKS.includes(book)) return;
    state.mobileBook=book; state.root.dataset.cpMobile=book;
    state.root.querySelectorAll('[data-compare-action="mobile"]').forEach(button => button.setAttribute('aria-selected',str(button.dataset.cpBook === book)));
    for (const pane of Object.values(state.panes)) if (!paneVisible(pane)) cancelRender(pane);
    save(); requestAnimationFrame(() => render(state.panes[book]));
  }
  function updateFullscreenButton() {
    const active=document.fullscreenElement === state.root || state.focusFallback;
    const control=$('[data-compare-action="fullscreen"]');
    if (control) { control.textContent=active ? '退出全屏' : '全屏对照'; control.setAttribute('aria-pressed',str(active)); }
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === state.root) await document.exitFullscreen();
      else if (state.focusFallback) { state.focusFallback=false; state.root.classList.remove('cp-focus'); }
      else if (state.root.requestFullscreen) await state.root.requestFullscreen();
      else { state.focusFallback=true; state.root.classList.add('cp-focus'); }
    } catch { state.focusFallback=!state.focusFallback; state.root.classList.toggle('cp-focus',state.focusFallback); }
    updateFullscreenButton(); resize();
  }
  function close() {
    const result=positions(); hide(); state.deps.onClose?.(result);
  }
  function onClick(event) {
    const target=event.target.closest('[data-compare-action]');
    if (!target || !state.root.contains(target)) return;
    const pane=state.panes[target.dataset.cpBook];
    switch (target.dataset.compareAction) {
      case 'close': close(); break;
      case 'fullscreen': toggleFullscreen(); break;
      case 'mobile': setMobileBook(target.dataset.cpBook); break;
      case 'toc': toggleTOC(pane); break;
      case 'prev': goPage(pane,pane.page-1); break;
      case 'next': goPage(pane,pane.page+1); break;
      case 'retry': render(pane); break;
      case 'entry': {
        const match=findEntry(pane.book,target.dataset.cpId);
        if (match) { goPage(pane,Number(match.entry.page),match.entry.id); if (mobile()) { pane.tocOpen=false; updatePane(pane); save(); } }
        break;
      }
      case 'audio': {
        const match=findEntry(pane.book,target.dataset.cpId);
        if (pane.book === 'textbook' && match && state.deps.entryAudio?.(match.entry,match.chapter,pane.book)?.file) {
          goPage(pane,Number(match.entry.page),match.entry.id);
          if (mobile()) { pane.tocOpen=false; updatePane(pane); save(); }
          Promise.resolve(state.deps.playEntry?.(str(match.entry.id),pane.book)).catch(() => notify('这段录音暂时无法播放，请稍后重试。'));
        }
        break;
      }
      case 'expand': {
        const id=str(target.dataset.cpId);
        if (pane.expanded.has(id)) pane.expanded.delete(id); else pane.expanded.add(id);
        const expanded=pane.expanded.has(id);
        const group=target.closest('.cp-catalog-group');
        group.querySelector('.cp-sections').hidden=!expanded;
        target.setAttribute('aria-expanded',str(expanded));
        target.setAttribute('aria-label',`${expanded ? '收起' : '展开'}${bookLabel(pane.book)} ${findEntry(pane.book,id)?.entry?.title || '章节'}`);
        save(); break;
      }
    }
  }
  function resizePane(pane) {
    clearTimeout(pane.resizeTimer);
    cancelRender(pane);
    if (!paneVisible(pane)) return;
    pane.resizeTimer=setTimeout(() => { if (paneVisible(pane)) render(pane); },100);
  }
  function resize() {
    if (!state.open) return;
    for (const pane of Object.values(state.panes)) resizePane(pane);
  }
  function init(deps) {
    state.deps={...state.deps,...deps};
    state.root=document.querySelector('#compare-view');
    if (!state.root) return;
    if (!state.initialized) {
      restore(); build();
      state.root.addEventListener('click',onClick);
      state.root.addEventListener('submit',event => {
        const form=event.target.closest('[data-cp-form]');
        if (!form) return;
        event.preventDefault(); goPage(state.panes[form.dataset.cpForm],form.querySelector('input').value);
      });
      state.root.addEventListener('change',event => {
        const selectedSlot=event.target.dataset.cpSelect;
        if (selectedSlot) { switchBook(state.panes[selectedSlot],event.target.value); return; }
        const book=event.target.dataset.cpZoom;
        if (!book || !ZOOMS.includes(event.target.value)) return;
        const pane=state.panes[book]; pane.zoom=event.target.value; save(); render(pane);
      });
      state.root.addEventListener('keydown',event => {
        if (event.key === 'Escape' && state.focusFallback) { state.focusFallback=false; state.root.classList.remove('cp-focus'); updateFullscreenButton(); resize(); return; }
        const stage=event.target.closest('.cp-stage');
        if (!stage || !['PageDown','PageUp'].includes(event.key)) return;
        const pane=state.panes[stage.closest('[data-cp-pane]').dataset.cpPane];
        const page=pane.page+(event.key === 'PageDown' ? 1 : -1);
        if (page >= 1 && page <= totalPages(pane.book)) { event.preventDefault(); goPage(pane,page); }
      });
      document.addEventListener('fullscreenchange',() => { updateFullscreenButton(); if (state.open) resize(); });
      window.addEventListener('resize',resize);
      window.addEventListener('beforeunload',() => { if (state.open) save(); });
      if ('ResizeObserver' in window) {
        state.observer=new ResizeObserver(entries => {
          for (const entry of entries) {
            const pane=state.panes[entry.target.closest('[data-cp-pane]')?.dataset.cpPane];
            if (!pane) continue;
            const size=`${Math.round(entry.contentRect.width)}:${Math.round(entry.contentRect.height)}`;
            if (size === pane.stageSize) continue;
            pane.stageSize=size;
            if (state.open) resizePane(pane);
          }
        });
        for (const pane of Object.values(state.panes)) state.observer.observe(node(pane,'.cp-stage'));
      }
      state.initialized=true;
    }
  }
  function show(seed,options={}) {
    if (!state.initialized) return;
    const seriesId=options.seriesId || state.seriesId || seriesOf(state.panes.textbook.book);
    if (seriesId !== state.seriesId || (!state.openedOnce && !state.saved)) {
      const books=availableBooks().filter(book => seriesOf(book) === seriesId);
      const left=books.find(book => bookData(book)?.kind === 'textbook' || book === 'textbook') || books[0];
      const right=books.find(book => bookData(book)?.kind === 'workbook' || book === 'workbook') || left;
      for (const [slot,book] of [['textbook',left],['workbook',right]]) {
        if (!book) continue;
        const pane=state.panes[slot];
        if (state.openedOnce || state.saved) remember(pane);
        cancelRender(pane); pane.book=book;
        restorePane(pane,pane.positions[book] || seed?.[book] || {});
      }
      state.seriesId=seriesId;
    }
    state.open=true; state.openedOnce=true; state.root.hidden=false;
    for (const pane of Object.values(state.panes)) { updatePane(pane); renderTOC(pane); }
    updateFullscreenButton(); save();
    requestAnimationFrame(() => { if (state.open) for (const pane of Object.values(state.panes)) render(pane); });
  }
  function hide() {
    if (!state.initialized) return;
    state.open=false;
    clearTimeout(state.resizeTimer); clearTimeout(state.saveTimer);
    for (const pane of Object.values(state.panes)) { clearTimeout(pane.resizeTimer); cancelRender(pane); }
    save();
    state.root.hidden=true;
    if (document.fullscreenElement === state.root) Promise.resolve(document.exitFullscreen()).catch(() => {});
    state.focusFallback=false; state.root.classList.remove('cp-focus');
  }
  function refreshAudio() {
    if (state.open) for (const pane of Object.values(state.panes)) renderTOC(pane);
  }
  window.NorskCompare={init,show,hide,isOpen:() => state.open,resize,refreshAudio,positions};
})();
