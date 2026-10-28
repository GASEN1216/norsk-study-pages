/* 我的词本: the learner's own chapters of words and sentences, inside the word-list view. */
(() => {
  'use strict';
  if (window.NorskWordbook) return;
  const POS = ['名词','动词','形容词','副词','介词','代词','连词','数词','感叹词','专有名词','短语','句子'];
  const GENDERS = [['m','阳性 · en'],['f','阴性 · ei'],['m/f','阳性 / 阴性'],['n','中性 · et']];
  const GENDER_LABEL = {m:'阳性',f:'阴性','m/f':'阳性 / 阴性',n:'中性'};
  const SOURCE_LABEL = {textbook:'教材词表',basics:'基础常识','nb-uttale':'NB Uttale 词典',mixed:'教材词表与 NB Uttale'};
  const PENCIL = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4.5 19.5 1-4.5L15.5 5l3.5 3.5-10 10z"/><path d="M13 7.5 16.5 11"/></svg>';
  const DOTS = '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>';
  const TTS_BATCH = 6;
  const ui = {deps:null,root:null,list:null,store:null,chapterId:'',dialog:null,dialogClose:null,menu:false,lookupRun:0,
    audio:new Map(),audioQueue:new Set(),audioBusy:false,quotaDay:'',initialized:false};
  const $ = (selector,root = document) => root.querySelector(selector);
  const e = value => ui.deps.escapeHTML(value);
  const icon = name => ui.deps.icon(name);
  const today = () => new Date(Date.now()+8*3600e3).toISOString().slice(0,10);
  const book = () => ui.store.data;
  const chapter = () => book().chapters.find(item => item.id === ui.chapterId) || null;
  const query = () => ($('#vocab-search')?.value || '').trim().toLocaleLowerCase('nb');
  const remembered = () => { try { return localStorage.getItem('norsk-wordbook-chapter-v1') || ''; } catch { return ''; } };
  function selectChapter(id) {
    ui.chapterId = book().chapters.some(item => item.id === id) ? id : book().chapters[0]?.id || '';
    try { localStorage.setItem('norsk-wordbook-chapter-v1',ui.chapterId); } catch {}
  }
  function guard(run) {
    try { return run(); }
    catch (error) { ui.deps.notify(error?.message || '没有保存成功，请重试。'); return null; }
  }

  /* Where the data lives, in one sentence. */
  function storageLine() {
    const sync = ui.deps.syncState?.() || {}, name = ui.store.sync.nickname;
    const where = name ? `词本跟随昵称「${name}」保存在服务器，用这个昵称的设备会自动同步。` : '词本跟随你的排行榜昵称保存在服务器，用同一昵称的设备会自动同步。';
    const status = sync.status === 'syncing' ? '正在同步…' : sync.status === 'offline' ? '暂时连不上服务器：改动先存在这台设备，联网后自动同步。'
      : sync.status === 'error' ? '这次没有同步成功：改动先存在这台设备，稍后会再试。' : ui.store.sync.dirty ? '有改动等待同步。' : '';
    return `<p class="wb-storage" id="wb-storage" role="status">${e(where)}${status ? ` <span class="wb-sync is-${e(sync.status || 'pending')}">${e(status)}</span>` : ''}</p>`;
  }

  /* Sidebar: the learner's chapters, styled like the basics categories. */
  function renderTOC() {
    const chapters = book().chapters;
    const counts = new Map();
    for (const entry of book().entries) counts.set(entry.chapterId,(counts.get(entry.chapterId) || 0)+1);
    const searching = !!query();
    return `<div class="wb-toc">${chapters.map((item,index) => {
      const selected = !searching && item.id === ui.chapterId;
      return `<button type="button" class="toc-basic wb-toc-item ${selected ? 'selected' : ''}" data-wb-action="chapter" data-wb-id="${e(item.id)}" ${selected ? 'aria-current="true"' : ''}><span class="category-index">${String(index+1).padStart(2,'0')}</span><span class="wb-toc-title">${e(item.title)}</span><span class="category-count">${counts.get(item.id) || 0}</span></button>`;
    }).join('')}<button type="button" class="wb-toc-add" data-wb-action="new-chapter">${icon('plus')}<span>新建目录</span></button></div>`;
  }

  /* Rows look like the textbook word list; the pencil opens the entry. */
  function phonetics(entry) {
    const source = SOURCE_LABEL[entry.ipaSource];
    return `<div class="word-phonetics">${entry.syllables ? `<span class="syllables" title="音节">${e(entry.syllables)}</span>` : ''}${entry.ipa ? `<span class="ipa" title="国际音标${source ? ` · 来自${source}` : ''}">${e(entry.ipa)}</span>` : ''}</div>`;
  }
  function grammar(entry) {
    const details = [entry.pos,GENDER_LABEL[entry.gender],entry.article].filter(Boolean);
    return details.length ? `<p class="word-grammar">${details.map(e).join(' · ')}</p>` : '';
  }
  function audioNote(entry) {
    if (entry.audio) return '';
    const status = ui.audio.get(entry.word.toLocaleLowerCase('nb'));
    const text = status === 'loading' ? '读音生成中…' : status === 'quota' ? '今天的新读音已满，明天自动补上' : status === 'invalid' ? '这条无法生成读音' : '读音待生成';
    return `<span class="wb-audio-note${status === 'loading' ? ' is-loading' : ''}" title="点喇叭会先用设备自带的挪威语声音朗读">${e(text)}</span>`;
  }
  function row(entry,index,showChapter) {
    const chapterTitle = showChapter ? book().chapters.find(item => item.id === entry.chapterId)?.title || '' : '';
    const source = SOURCE_LABEL[entry.ipaSource];
    const aside = entry.example || entry.note || chapterTitle;
    return `<article class="vocab-row wb-row${aside ? '' : ' is-compact'}"><div class="word-cell"><div class="word-topline"><span class="word-spelling" lang="nb">${e(entry.word)}</span><button class="word-pronounce" data-action="pronounce" data-kind="vocabulary" data-index="${index}" aria-label="播放 ${e(entry.word)} 的读音">${icon('volume')}</button>${audioNote(entry)}<button type="button" class="wb-edit" data-wb-action="edit" data-wb-id="${e(entry.id)}" aria-label="编辑 ${e(entry.word)}" title="编辑">${PENCIL}</button></div><p class="word-meaning">${e(entry.meaning)}</p><div class="word-details">${phonetics(entry)}${grammar(entry)}</div>${entry.missing?.length ? `<p class="wb-warning">词典里没有找到 <span lang="nb">${e(entry.missing.join('、'))}</span>，请核对拼写；读音会照这个拼写朗读。</p>` : source ? `<p class="wb-source">音标来自${e(source)}</p>` : ''}</div>${aside ? `<div class="sentence-cell">${entry.example ? `<p class="sentence" lang="nb">${e(entry.example)}</p>` : ''}${entry.note ? `<p class="wb-note">${e(entry.note)}</p>` : ''}${chapterTitle ? `<div class="sentence-ref"><span>${e(chapterTitle)}</span></div>` : ''}</div>` : ''}</article>`;
  }
  function wordsFor(entries) {
    return entries.map(entry => ({word:entry.word,meaning:entry.meaning,ipa:entry.ipa,syllables:entry.syllables,...(entry.audio ? {audio:entry.audio} : {audioNote:'这条读音还没有生成好，联网后会自动补上。'})}));
  }
  function render() {
    if (!ui.initialized) return;
    const data = book(), searching = query();
    if (!chapter() && !searching) selectChapter(remembered());
    document.body.classList.add('wordbook-mode');
    $('#content-eyebrow').textContent = 'MIN ORDBOK · 我的词本';
    $('#content-title').textContent = searching ? data.title : chapter()?.title || data.title;
    if (!data.chapters.length) {
      ui.deps.setWords([]);
      ui.list.innerHTML = `<section class="wb-empty wb-first"><span class="wb-empty-mark" aria-hidden="true">å</span><h2>建一本自己的词本</h2><p>把课外遇到的单词和句子收在这里，按目录整理。音标和读音会自动补上，也能直接拿去练习。</p><form class="wb-inline-form" data-wb-form="first-chapter"><label class="sr-only" for="wb-first-chapter">第一个目录的名字</label><input id="wb-first-chapter" name="title" maxlength="40" placeholder="第一个目录，比如“第一周”" autocomplete="off" enterkeyhint="done" required><button type="submit" class="wb-button wb-primary">建立目录</button></form>${storageLine()}</section>`;
      return;
    }
    const entries = searching
      ? data.entries.filter(entry => [entry.word,entry.meaning,entry.example,entry.note].some(value => String(value || '').toLocaleLowerCase('nb').includes(searching)))
      : data.entries.filter(entry => entry.chapterId === ui.chapterId);
    // Newest first, so what was just added is at the top.
    entries.reverse();
    ui.deps.setWords(wordsFor(entries));
    const head = `<div class="wb-head"><p class="wb-count">${searching ? `搜索“${e(searching)}” · ` : ''}共 <strong>${entries.length}</strong> 条</p><div class="wb-actions"><button type="button" class="wb-button wb-primary" data-wb-action="add">${icon('plus')}<span>添加</span></button><div class="wb-menu-wrap"><button type="button" class="wb-icon-button" data-wb-action="menu" aria-haspopup="true" aria-expanded="false" aria-controls="wb-menu" aria-label="更多词本操作" title="更多">${DOTS}</button><div class="wb-menu" id="wb-menu" role="menu" hidden></div></div></div></div>`;
    const body = entries.length ? `<div class="wb-list">${entries.map((entry,index) => row(entry,index,!!searching)).join('')}</div>`
      : searching ? `<div class="empty-state">${icon('search')}<p>词本里没有找到“${e(searching)}”</p><small>试试别的拼写或中文释义。</small></div>`
      : `<section class="wb-empty"><h2>「${e(chapter()?.title || '')}」还是空的</h2><p>挪威语和中文释义必填，其余可以留空，音标和读音会自动补上。</p><div class="wb-empty-actions"><button type="button" class="wb-button wb-primary" data-wb-action="add">${icon('plus')}<span>添加第一个单词或句子</span></button><button type="button" class="wb-text-button" data-wb-action="paste">一次粘贴多行</button></div></section>`;
    ui.list.innerHTML = head+body+storageLine();
    ui.deps.prefetchList(ui.list);
    // Attaching readings saves the wordbook, which renders again: start that after this render.
    // Every entry gets one, not only the open chapter, so practice and imports sound right too.
    clearTimeout(ui.audioTimer);
    ui.audioTimer = setTimeout(() => queueAudio(book().entries),0);
  }
  function refresh() {
    if (!ui.deps?.isActive()) return;
    render();
    ui.deps.refreshChrome();
  }

  /* The ⋯ menu: this chapter first, then the whole wordbook. */
  function menuMarkup() {
    const index = book().chapters.findIndex(item => item.id === ui.chapterId), last = book().chapters.length-1;
    const item = (action,label,extra = '') => `<button type="button" role="menuitem" class="wb-menu-item${extra}" data-wb-action="${action}">${label}</button>`;
    return `<p class="wb-menu-label">本目录</p>${item('paste','批量粘贴')}${item('rename-chapter','重命名目录')}${index > 0 ? item('chapter-up','上移目录') : ''}${index < last ? item('chapter-down','下移目录') : ''}${item('delete-chapter','删除目录',' is-danger')}<p class="wb-menu-label">整本词本</p>${item('new-chapter','新建目录')}${item('rename-book','给词本改名')}${item('export','导出备份')}${item('import','从备份导入')}`;
  }
  function toggleMenu(open = !ui.menu) {
    const menu = $('#wb-menu'), button = $('[data-wb-action="menu"]');
    if (!menu || !button) { ui.menu = false; return; }
    ui.menu = open;
    if (open) menu.innerHTML = menuMarkup();
    menu.hidden = !open;
    button.setAttribute('aria-expanded',String(open));
    if (open) menu.querySelector('button')?.focus({preventScroll:true});
  }

  /* One dialog at a time: a sheet on phones, a centred card elsewhere. */
  function openDialog(title,body,footer,{onClose,wide = false} = {}) {
    closeDialog();
    const dialog = document.createElement('dialog');
    dialog.className = `wb-dialog${wide ? ' is-wide' : ''}`;
    dialog.setAttribute('aria-labelledby','wb-dialog-title');
    dialog.innerHTML = `<header class="wb-dialog-head"><h2 id="wb-dialog-title">${title}</h2><button type="button" class="wb-icon-button" data-wb-action="close-dialog" aria-label="关闭">${icon('close')}</button></header><div class="wb-dialog-body">${body}</div>${footer ? `<footer class="wb-dialog-foot">${footer}</footer>` : ''}`;
    dialog.addEventListener('cancel',event => { event.preventDefault(); closeDialog(); });
    dialog.addEventListener('click',event => { if (event.target === dialog) closeDialog(); });
    document.body.append(dialog);
    ui.dialog = dialog;
    ui.dialogClose = onClose || null;
    ui.returnFocus = document.activeElement;
    try { dialog.showModal(); } catch { dialog.setAttribute('open',''); }
    ui.deps.openLayer('wordbook-dialog',closeDialog);
    trackKeyboard();
    return dialog;
  }
  function closeDialog() {
    const dialog = ui.dialog;
    if (!dialog) return;
    ui.dialog = null;
    ui.lookupRun++;
    try { dialog.close(); } catch {}
    dialog.remove();
    // Closing from Back already used the history entry; closeLayer then finds nothing left to undo.
    ui.deps.closeLayer('wordbook-dialog');
    const close = ui.dialogClose; ui.dialogClose = null;
    close?.();
    if (ui.returnFocus?.isConnected) ui.returnFocus.focus({preventScroll:true});
  }
  // The on-screen keyboard covers the bottom of the screen; the sheet rises above it.
  let keyboardTracked = false;
  function trackKeyboard() {
    const viewport = window.visualViewport;
    if (keyboardTracked || !viewport) return;
    keyboardTracked = true;
    const update = () => document.documentElement.style.setProperty('--wb-keyboard',`${Math.max(0,Math.round(window.innerHeight-viewport.height-viewport.offsetTop))}px`);
    viewport.addEventListener('resize',update);
    viewport.addEventListener('scroll',update);
    update();
  }
  const button = (action,label,kind = '',extra = '') => `<button type="button" class="wb-button ${kind}" data-wb-action="${action}" ${extra}>${label}</button>`;

  /* Simple text prompts: names for chapters and the wordbook. */
  function promptDialog(title,label,value,save) {
    const dialog = openDialog(e(title),`<form class="wb-form" data-wb-form="prompt"><label class="wb-field"><span>${e(label)}</span><input name="value" maxlength="40" value="${e(value)}" autocomplete="off" enterkeyhint="done" required></label><p class="wb-error" role="alert" hidden></p></form>`,
      `${button('close-dialog','取消','wb-quiet')}${button('prompt-save','保存','wb-primary')}`);
    ui.promptSave = save;
    const input = dialog.querySelector('input');
    input.focus(); input.select();
  }
  function confirmDialog(title,message,action,label) {
    openDialog(e(title),`<p class="wb-confirm-text">${message}</p>`,`${button('close-dialog','取消','wb-quiet')}${button(action,e(label),'wb-danger')}`);
    ui.dialog.querySelector('.wb-danger')?.focus();
  }

  /* Adding and editing one entry. */
  function chapterOptions(selected) {
    return book().chapters.map(item => `<option value="${e(item.id)}" ${item.id === selected ? 'selected' : ''}>${e(item.title)}</option>`).join('');
  }
  function openEntry(id = '') {
    const entry = id ? ui.store.entry(id) : null;
    if (id && !entry) return;
    const value = entry || {word:'',meaning:'',pos:'',gender:'',example:'',note:''};
    const more = entry && (entry.pos || entry.gender || entry.example || entry.note);
    const body = `<form class="wb-form" data-wb-form="entry" data-wb-id="${e(id)}" novalidate>
      <label class="wb-field"><span>挪威语</span><input name="word" lang="nb" value="${e(value.word)}" maxlength="121" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next" placeholder="单词、短语或句子"></label>
      <div class="wb-lookup" id="wb-lookup" aria-live="polite"></div>
      <label class="wb-field"><span>中文释义</span><input name="meaning" value="${e(value.meaning)}" maxlength="200" autocomplete="off" enterkeyhint="done"></label>
      <div class="wb-suggest" id="wb-suggest"></div>
      <details class="wb-more" ${more ? 'open' : ''}><summary>词性、例句和备注（可选）</summary><div class="wb-more-body">
        <div class="wb-pair"><label class="wb-field"><span>词性</span><select name="pos"><option value="">—</option>${POS.map(pos => `<option ${pos === value.pos ? 'selected' : ''}>${pos}</option>`).join('')}${value.pos && !POS.includes(value.pos) ? `<option selected>${e(value.pos)}</option>` : ''}</select></label>
        <label class="wb-field" data-wb-gender ${value.pos === '名词' ? '' : 'hidden'}><span>名词性别</span><select name="gender"><option value="">—</option>${GENDERS.map(([key,label]) => `<option value="${key}" ${key === value.gender ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>
        <label class="wb-field"><span>例句</span><textarea name="example" lang="nb" rows="2" maxlength="300" spellcheck="false">${e(value.example)}</textarea></label>
        <label class="wb-field"><span>备注</span><input name="note" value="${e(value.note)}" maxlength="300" autocomplete="off"></label>
      </div></details>
      ${book().chapters.length > 1 ? `<label class="wb-field wb-inline-field"><span>${entry ? '所在目录' : '加到'}</span><select name="chapter">${chapterOptions(entry?.chapterId || ui.chapterId)}</select></label>` : ''}
      <p class="wb-error" role="alert" hidden></p></form>`;
    const footer = entry ? `${button('delete-entry','删除','wb-quiet wb-danger-text',`data-wb-id="${e(entry.id)}"`)}<span class="wb-spacer"></span>${button('close-dialog','取消','wb-quiet')}${button('save-entry','保存','wb-primary')}`
      : `<span class="wb-spacer"></span>${button('close-dialog','完成','wb-quiet')}${button('save-entry','添加','wb-primary')}`;
    const dialog = openDialog(entry ? '编辑词条' : '添加词条',body,footer);
    ui.form = {posTouched:!!value.pos,result:null,checked:''};
    if (value.word) lookup(value.word,!!entry);
    dialog.querySelector('[name="word"]').focus();
  }
  function sourceText(result) {
    return SOURCE_LABEL[result.ipaSource] ? `音标来自${SOURCE_LABEL[result.ipaSource]}` : '';
  }
  async function lookup(word,quiet = false) {
    const run = ++ui.lookupRun, box = $('#wb-lookup'), suggest = $('#wb-suggest');
    if (!box) return null;
    const text = word.trim();
    if (!text) { box.innerHTML = ''; suggest.innerHTML = ''; ui.form.result = null; ui.form.checked = ''; return null; }
    box.innerHTML = '<span class="wb-lookup-wait">正在查词典…</span>';
    let result;
    try { result = await ui.deps.lookup.describe(text); }
    catch { if (run === ui.lookupRun) box.innerHTML = '<span class="wb-lookup-wait">词典暂时无法载入；先保存也可以，读音照常生成。</span>'; return null; }
    if (run !== ui.lookupRun || !ui.dialog) return result;
    ui.form.result = result; ui.form.checked = text;
    const facts = [result.ipa,result.pos,GENDER_LABEL[result.gender],result.article].filter(Boolean).map(e).join(' · ');
    const doubt = [...result.missing,...result.nameOnly];
    box.innerHTML = doubt.length
      ? `<p class="wb-lookup-line is-warning"><b aria-hidden="true">!</b><span>${[
          result.missing.length ? `未在词典中找到 <span lang="nb">${e(result.missing.join('、'))}</span>` : '',
          result.nameOnly.length ? `词典里 <span lang="nb">${e(result.nameOnly.join('、'))}</span> 只作为人名或地名出现` : ''].filter(Boolean).join('；')}，请检查拼写。读音会照你写的拼写朗读。</span></p>`
      : facts ? `<p class="wb-lookup-line"><b aria-hidden="true">${icon('check')}</b><span lang="nb">${facts}</span><small>${e(sourceText(result))}</small></p>` : '';
    if (result.choices.length > 1 && !ui.form.posTouched) box.insertAdjacentHTML('beforeend',`<p class="wb-lookup-hint">这个拼写有 ${result.choices.map(choice => e(choice.pos)).join('、')} 等用法，可在“词性”里选一个。</p>`);
    const form = $('[data-wb-form="entry"]');
    if (form && result.pos && !ui.form.posTouched && !quiet) {
      form.elements.pos.value = POS.includes(result.pos) ? result.pos : '';
      form.elements.gender.value = result.gender || '';
      form.querySelector('[data-wb-gender]').hidden = form.elements.pos.value !== '名词';
    }
    renderSuggestions();
    return result;
  }
  // Textbook meanings are offered, never filled in by themselves: the learner taps one to use it.
  function renderSuggestions() {
    const box = $('#wb-suggest'), form = $('[data-wb-form="entry"]'), result = ui.form?.result;
    if (!box || !form) return;
    const current = form.elements.meaning.value.trim();
    const options = (result?.meanings || []).filter(item => item.text !== current);
    box.innerHTML = options.length ? `<p class="wb-suggest-label">教材里的释义，点一下填入：</p><div class="wb-chips">${options.map((item,index) => `<button type="button" class="wb-chip" data-wb-action="use-meaning" data-wb-index="${index}"><span>${e(item.text)}</span><small>${e(item.source)}</small></button>`).join('')}</div>` : '';
    ui.form.options = options;
  }
  function formError(form,message) {
    const box = form.querySelector('.wb-error');
    box.textContent = message;
    box.hidden = !message;
  }
  async function saveEntry() {
    const form = $('[data-wb-form="entry"]');
    if (!form || ui.saving) return;
    const word = form.elements.word.value.normalize('NFC').replace(/\s+/g,' ').trim();
    const meaning = form.elements.meaning.value.replace(/\s+/g,' ').trim();
    const problem = ui.deps.wordProblem(word) || (!meaning ? '请填写中文释义。' : '');
    if (problem) { formError(form,problem); (problem.includes('释义') ? form.elements.meaning : form.elements.word).focus(); return; }
    ui.saving = true;
    try {
      const result = ui.form.checked === word && ui.form.result ? ui.form.result : await ui.deps.lookup.describe(word).catch(() => null);
      const fields = {word,meaning,pos:form.elements.pos.value,gender:form.elements.pos.value === '名词' ? form.elements.gender.value : '',
        article:form.elements.pos.value === '名词' ? ({m:'en',f:'ei','m/f':'en/ei',n:'et'}[form.elements.gender.value] || '') : '',
        example:form.elements.example.value.trim(),note:form.elements.note.value.trim(),
        ipa:result?.ipa || '',ipaSource:result?.ipaSource || '',syllables:result?.syllables || '',syllablesSource:result?.syllablesSource || '',
        missing:result ? [...result.missing,...result.nameOnly] : []};
      const clip = ui.deps.clipFor(word);
      const id = form.dataset.wbId, chapterId = form.elements.chapter?.value || ui.chapterId;
      if (id) {
        const before = ui.store.entry(id);
        // A new spelling needs a new reading; the old clip belonged to the old text.
        if (before && before.word !== word) fields.audio = clip || undefined;
        if (!guard(() => ui.store.updateEntry(id,{...fields,chapterId}))) return;
        if (chapterId !== ui.chapterId && !query()) { selectChapter(chapterId); refresh(); }
        closeDialog();
        ui.deps.notify(`已保存 ${word}`,2200);
      } else {
        if (clip) fields.audio = clip;
        if (!guard(() => ui.store.addEntries(chapterId,[fields]))) return;
        if (chapterId !== ui.chapterId) { selectChapter(chapterId); refresh(); }
        // Stay in the form for the next word.
        form.reset();
        form.elements.chapter && (form.elements.chapter.value = chapterId);
        form.querySelector('[data-wb-gender]').hidden = true;
        ui.form = {posTouched:false,result:null,checked:''};
        $('#wb-lookup').innerHTML = ''; $('#wb-suggest').innerHTML = '';
        formError(form,'');
        form.elements.word.focus();
        ui.deps.notify(`已加入 ${word}${clip ? '' : ' · 读音正在生成'}`,2200);
      }
    } finally { ui.saving = false; }
  }

  /* Pasting many lines at once, checked before anything is added. */
  function openPaste() {
    openDialog('批量粘贴',`<form class="wb-form" data-wb-form="paste"><p class="wb-help">一行一条：挪威语在前，中文释义在后，中间用 — 、- 、= 或冒号隔开，例如“hus — 房子”。释义可以先空着。</p><label class="wb-field"><span class="sr-only">要添加的内容</span><textarea name="lines" rows="9" lang="nb" spellcheck="false" placeholder="hus — 房子&#10;Jeg heter Kari. — 我叫卡丽。&#10;kjøleskap">${e(ui.pasteText || '')}</textarea></label>${book().chapters.length > 1 ? `<label class="wb-field wb-inline-field"><span>加到</span><select name="chapter">${chapterOptions(ui.chapterId)}</select></label>` : ''}<p class="wb-error" role="alert" hidden></p></form>`,
      `<span class="wb-spacer"></span>${button('close-dialog','取消','wb-quiet')}${button('paste-check','检查','wb-primary')}`,{wide:true});
    ui.dialog.querySelector('textarea').focus();
  }
  async function checkPaste() {
    const form = $('[data-wb-form="paste"]');
    if (!form) return;
    ui.pasteText = form.elements.lines.value;
    ui.pasteChapter = form.elements.chapter?.value || ui.chapterId;
    const rows = ui.deps.parseBatch(ui.pasteText);
    if (!rows.length) { formError(form,'请先粘贴要添加的内容。'); return; }
    if (rows.length > 200) { formError(form,'一次最多 200 行，请分几次粘贴。'); return; }
    const footer = ui.dialog.querySelector('.wb-dialog-foot');
    footer.querySelector('[data-wb-action="paste-check"]').disabled = true;
    formError(form,'');
    const results = await Promise.all(rows.map(item => ui.deps.wordProblem(item.word) ? null : ui.deps.lookup.describe(item.word).catch(() => null)));
    if (!ui.dialog) return;
    ui.pasteRows = rows.map((item,index) => ({...item,problem:ui.deps.wordProblem(item.word),result:results[index],removed:false}));
    renderPastePreview();
  }
  function pasteReady(item) { return !item.removed && !item.problem && !!item.meaning.trim(); }
  function renderPastePreview() {
    const rows = ui.pasteRows, ready = rows.filter(pasteReady).length;
    const target = book().chapters.find(item => item.id === ui.pasteChapter)?.title || '';
    const body = ui.dialog.querySelector('.wb-dialog-body');
    body.innerHTML = `<p class="wb-help">释义空着的可以点教材释义或自己填；有问题的行不会加入。</p><ol class="wb-preview">${rows.map((item,index) => {
      if (item.removed) return '';
      const result = item.result, doubt = result ? [...result.missing,...result.nameOnly] : [];
      const status = item.problem ? `<p class="wb-preview-note is-error">${e(item.problem)}</p>`
        : doubt.length ? `<p class="wb-preview-note is-warning">词典里没有找到 <span lang="nb">${e(doubt.join('、'))}</span>，请核对拼写。</p>`
        : result?.ipa ? `<p class="wb-preview-note"><span lang="nb">${e(result.ipa)}</span>${result.pos ? ` · ${e(result.pos)}` : ''}</p>` : '';
      const chips = !item.meaning && result?.meanings?.length ? `<div class="wb-chips">${result.meanings.map((meaning,choice) => `<button type="button" class="wb-chip" data-wb-action="paste-meaning" data-wb-row="${index}" data-wb-index="${choice}"><span>${e(meaning.text)}</span><small>${e(meaning.source)}</small></button>`).join('')}</div>` : '';
      return `<li class="wb-preview-row${pasteReady(item) ? '' : ' is-pending'}"><div class="wb-preview-main"><span class="wb-preview-word" lang="nb">${e(item.word)}</span><label class="sr-only" for="wb-paste-${index}">${e(item.word)} 的释义</label><input id="wb-paste-${index}" class="wb-preview-meaning" data-wb-row="${index}" value="${e(item.meaning)}" placeholder="填写中文释义" maxlength="200" autocomplete="off"><button type="button" class="wb-icon-button wb-remove" data-wb-action="paste-remove" data-wb-row="${index}" aria-label="不加入 ${e(item.word)}">${icon('close')}</button></div>${status}${chips}</li>`;
    }).join('')}</ol>`;
    ui.dialog.querySelector('.wb-dialog-foot').innerHTML = `${button('paste-back','返回修改','wb-quiet')}<span class="wb-spacer"></span>${button('paste-add',ready ? `加入 ${ready} 条${target ? `到「${e(target)}」` : ''}` : '还没有可加入的行','wb-primary',ready ? '' : 'disabled')}`;
  }
  function pasteAdd() {
    const rows = (ui.pasteRows || []).filter(pasteReady);
    if (!rows.length) return;
    const fields = rows.map(item => {
      const result = item.result || {}, clip = ui.deps.clipFor(item.word);
      const pos = POS.includes(result.pos) ? result.pos : '';
      return {word:item.word.trim(),meaning:item.meaning.trim(),pos,gender:pos === '名词' ? result.gender || '' : '',article:pos === '名词' ? result.article || '' : '',example:'',note:'',
        ipa:result.ipa || '',ipaSource:result.ipaSource || '',syllables:result.syllables || '',syllablesSource:result.syllablesSource || '',
        missing:[...(result.missing || []),...(result.nameOnly || [])],...(clip ? {audio:clip} : {})};
    });
    if (!guard(() => ui.store.addEntries(ui.pasteChapter,fields))) return;
    if (ui.pasteChapter !== ui.chapterId) { selectChapter(ui.pasteChapter); refresh(); }
    ui.pasteText = ''; ui.pasteRows = null;
    closeDialog();
    ui.deps.notify(`已加入 ${fields.length} 条`,2600);
  }

  /* Readings: a textbook recording when the spelling matches one, otherwise a clip from the server. */
  function queueAudio(entries) {
    if (ui.quotaDay && ui.quotaDay !== today()) { ui.quotaDay = ''; for (const [key,status] of ui.audio) if (status === 'quota') ui.audio.delete(key); }
    for (const entry of entries) {
      const current = ui.store.entry(entry.id);
      if (!current || current.audio) continue;
      const key = current.word.toLocaleLowerCase('nb');
      // null: the textbook recordings are not loaded yet, so it is too early to ask the server.
      const clip = ui.deps.clipFor(current.word);
      if (clip === null) continue;
      if (clip) { guard(() => ui.store.setAudio(current.word,clip)); continue; }
      if (!ui.audio.has(key) || ui.audio.get(key) === 'offline') ui.audioQueue.add(current.word);
    }
    drainAudio();
  }
  async function drainAudio() {
    if (ui.audioBusy || !ui.audioQueue.size || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    ui.audioBusy = true;
    const texts = [...ui.audioQueue].slice(0,TTS_BATCH);
    texts.forEach(text => { ui.audioQueue.delete(text); ui.audio.set(text.toLocaleLowerCase('nb'),'loading'); });
    patchAudioNotes();
    let stop = false;
    try {
      const reply = await ui.deps.requestTTS(texts);
      for (const clip of reply?.clips || []) {
        const key = String(clip.text || '').toLocaleLowerCase('nb');
        if (clip.path) {
          ui.audio.delete(key);
          guard(() => ui.store.setAudio(clip.text,ui.deps.apiURL(clip.path)));
        } else ui.audio.set(key,clip.error === 'tts_invalid' ? 'invalid' : 'offline');
      }
    } catch (error) {
      const status = error?.code === 'tts_quota' ? 'quota' : 'offline';
      if (status === 'quota') ui.quotaDay = today();
      texts.forEach(text => ui.audio.set(text.toLocaleLowerCase('nb'),status));
      // Unavailable or over the limit: stop for now; the next visit, the next edit or coming online tries again.
      stop = true;
    } finally {
      ui.audioBusy = false;
      patchAudioNotes();
      if (!stop) drainAudio();
    }
  }
  function patchAudioNotes() { if (ui.deps.isActive()) render(); }

  /* Backups: a JSON file the learner keeps, and reading one back in. */
  function exportBackup() {
    const data = ui.store.exportData();
    const blob = new Blob([JSON.stringify(data,null,1)],{type:'application/json'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${data.title.replace(/[\\/:*?"<>|]/g,'') || '我的词本'}-${today().replace(/-/g,'')}.json`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href),4000);
    ui.deps.notify(`已导出 ${data.entries.length} 条`,2600);
  }
  function chooseBackup() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true;
    input.addEventListener('change',async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      if (file.size > 4*1024*1024) { ui.deps.notify('文件太大，不像是词本备份。'); return; }
      try {
        const data = JSON.parse(await file.text());
        if (data?.format !== 'norsk-wordbook') throw new Error();
        ui.importData = data;
        const chapters = Array.isArray(data.chapters) ? data.chapters.length : 0, entries = Array.isArray(data.entries) ? data.entries.length : 0;
        openDialog('从备份导入',`<p class="wb-confirm-text">备份里有 ${chapters} 个目录、${entries} 条。<br>“合并”保留现有内容，只加入新的；“替换”会删掉现有词本，所有同昵称的设备都会跟着替换。</p>`,
          `${button('close-dialog','取消','wb-quiet')}<span class="wb-spacer"></span>${button('import-replace','替换','wb-danger')}${button('import-merge','合并','wb-primary')}`);
      } catch { ui.deps.notify('这不是本站导出的词本文件。'); }
    });
    document.body.append(input);
    input.click();
  }
  function importBackup(mode) {
    const result = guard(() => ui.store.importData(ui.importData,mode));
    ui.importData = null;
    if (!result) return;
    closeDialog();
    selectChapter(ui.chapterId);
    ui.deps.notify(mode === 'replace' ? `已替换为备份：${result.chapters} 个目录、${result.entries} 条` : `已合并：新增 ${result.chapters} 个目录、${result.entries} 条`,3200);
  }

  function onClick(event) {
    if (!ui.initialized) return;
    if (ui.menu && !event.target.closest('.wb-menu-wrap')) toggleMenu(false);
    const target = event.target.closest('[data-wb-action]');
    if (!target || target.disabled) return;
    const action = target.dataset.wbAction, id = target.dataset.wbId;
    if (['menu'].includes(action)) { toggleMenu(); return; }
    if (target.closest('.wb-menu')) toggleMenu(false);
    switch (action) {
      case 'chapter': {
        const search = $('#vocab-search');
        if (search?.value) { search.value = ''; $('#heading-search')?.classList.remove('open'); }
        selectChapter(id); ui.deps.closeSidebar(); refresh(); window.scrollTo(0,0); break;
      }
      case 'new-chapter': promptDialog('新建目录','目录名字','',title => { const created = ui.store.addChapter(title); selectChapter(created); refresh(); }); break;
      case 'rename-chapter': if (chapter()) promptDialog('重命名目录','目录名字',chapter().title,title => ui.store.renameChapter(ui.chapterId,title)); break;
      case 'rename-book': promptDialog('给词本改名','词本名字',book().title,title => ui.store.rename(title)); break;
      case 'chapter-up': guard(() => ui.store.moveChapter(ui.chapterId,-1)); break;
      case 'chapter-down': guard(() => ui.store.moveChapter(ui.chapterId,1)); break;
      case 'delete-chapter': {
        const current = chapter();
        if (!current) break;
        const count = ui.store.entriesIn(current.id).length;
        confirmDialog(`删除「${current.title}」？`,count ? `目录里的 ${count} 条会一起删除，所有同昵称的设备都会同步删除，无法撤销。需要的话先用 ⋯ 菜单里的“导出备份”留一份。` : '这个目录是空的。','confirm-delete-chapter','删除目录');
        break;
      }
      case 'confirm-delete-chapter': {
        const current = chapter();
        if (current && guard(() => ui.store.deleteChapter(current.id))) { closeDialog(); selectChapter(''); refresh(); ui.deps.notify(`已删除「${current.title}」`,2400); }
        break;
      }
      case 'add': openEntry(); break;
      case 'edit': openEntry(id); break;
      case 'paste': openPaste(); break;
      case 'paste-check': checkPaste(); break;
      case 'paste-back': openPaste(); break;
      case 'paste-remove': ui.pasteRows[Number(target.dataset.wbRow)].removed = true; renderPastePreview(); break;
      case 'paste-meaning': {
        const item = ui.pasteRows[Number(target.dataset.wbRow)];
        item.meaning = item.result.meanings[Number(target.dataset.wbIndex)]?.text || item.meaning;
        renderPastePreview(); break;
      }
      case 'paste-add': pasteAdd(); break;
      case 'use-meaning': {
        const form = $('[data-wb-form="entry"]'), option = ui.form?.options?.[Number(target.dataset.wbIndex)];
        if (form && option) { form.elements.meaning.value = option.text; renderSuggestions(); form.elements.meaning.focus(); }
        break;
      }
      case 'save-entry': saveEntry(); break;
      case 'delete-entry': {
        const entry = ui.store.entry(id);
        if (entry) confirmDialog(`删除 ${entry.word}？`,'这一条会从词本里删除，同昵称的设备也会同步删除。','confirm-delete-entry','删除');
        ui.deleting = id;
        break;
      }
      case 'confirm-delete-entry': {
        const entry = ui.store.entry(ui.deleting);
        if (entry && guard(() => ui.store.deleteEntry(entry.id))) { closeDialog(); ui.deps.notify(`已删除 ${entry.word}`,2200); }
        break;
      }
      case 'prompt-save': submitPrompt(); break;
      case 'export': exportBackup(); break;
      case 'import': chooseBackup(); break;
      case 'import-merge': importBackup('merge'); break;
      case 'import-replace': importBackup('replace'); break;
      case 'close-dialog': closeDialog(); break;
    }
  }
  function submitPrompt() {
    const form = $('[data-wb-form="prompt"]');
    if (!form) return;
    const value = form.elements.value.value.trim();
    if (!value) { formError(form,'名字不能为空。'); form.elements.value.focus(); return; }
    try { ui.promptSave(value); closeDialog(); }
    catch (error) { formError(form,error?.message || '没有保存成功。'); }
  }
  function onSubmit(event) {
    const form = event.target.closest?.('[data-wb-form]');
    if (!form) return;
    event.preventDefault();
    if (form.dataset.wbForm === 'first-chapter') {
      const title = form.elements.title.value.trim();
      if (!title) { form.elements.title.focus(); return; }
      const created = guard(() => ui.store.addChapter(title));
      if (created) { selectChapter(created); refresh(); setTimeout(() => openEntry(),60); }
    }
    if (form.dataset.wbForm === 'prompt') submitPrompt();
    if (form.dataset.wbForm === 'entry') saveEntry();
    if (form.dataset.wbForm === 'paste') checkPaste();
  }
  let lookupTimer;
  function onInput(event) {
    const target = event.target;
    if (!ui.dialog?.contains(target)) return;
    if (target.name === 'word' && !event.isComposing) {
      clearTimeout(lookupTimer);
      formError(target.form,'');
      lookupTimer = setTimeout(() => lookup(target.value),320);
    }
    if (target.name === 'meaning') { formError(target.form,''); renderSuggestions(); }
    if (target.classList.contains('wb-preview-meaning')) {
      const item = ui.pasteRows?.[Number(target.dataset.wbRow)];
      if (item) {
        const wasReady = pasteReady(item);
        item.meaning = target.value;
        // Re-render only when the row changes state, so typing keeps its place.
        if (wasReady !== pasteReady(item)) { renderPastePreview(); const next = $(`#wb-paste-${target.dataset.wbRow}`); next?.focus(); next?.setSelectionRange(next.value.length,next.value.length); }
      }
    }
  }
  function onChange(event) {
    const target = event.target;
    if (!ui.dialog?.contains(target)) return;
    if (target.name === 'pos') { ui.form.posTouched = true; target.form.querySelector('[data-wb-gender]').hidden = target.value !== '名词'; }
  }
  function onKey(event) {
    if (!ui.initialized) return;
    if (event.key === 'Escape' && ui.menu) { toggleMenu(false); $('[data-wb-action="menu"]')?.focus(); return; }
    const target = event.target;
    // The buttons sit in the dialog footer, outside the form: Enter moves on, then saves.
    if (event.key === 'Enter' && !event.isComposing && target.form?.dataset.wbForm === 'entry' && ['word','meaning','note'].includes(target.name)) {
      event.preventDefault();
      if (target.name === 'word') target.form.elements.meaning.focus(); else saveEntry();
    }
  }
  // A field the keyboard would cover scrolls into the visible part of the sheet.
  function onFocus(event) {
    const field = event.target;
    if (!ui.dialog?.contains(field) || !/INPUT|TEXTAREA|SELECT/.test(field.tagName)) return;
    setTimeout(() => field.scrollIntoView?.({block:'nearest',behavior:'smooth'}),280);
  }

  function init(deps) {
    ui.deps = deps;
    ui.store = deps.store;
    if (!ui.initialized) {
      ui.root = deps.root;
      ui.list = document.createElement('div');
      ui.list.id = 'wordbook-root';
      ui.list.className = 'wordbook-root';
      ui.root.append(ui.list);
      document.addEventListener('click',onClick);
      document.addEventListener('submit',onSubmit);
      document.addEventListener('input',onInput);
      document.addEventListener('change',onChange);
      document.addEventListener('keydown',onKey);
      document.addEventListener('focusin',onFocus);
      window.addEventListener('online',() => { for (const [key,status] of ui.audio) if (status === 'offline') ui.audio.delete(key); if (deps.isActive()) render(); });
      ui.store.subscribe(() => { if (book().chapters.length && !chapter()) selectChapter(remembered()); refresh(); });
      ui.initialized = true;
    }
    selectChapter(ui.chapterId || remembered());
  }
  function hide() {
    document.body.classList.remove('wordbook-mode');
    toggleMenu(false);
    closeDialog();
    if (ui.list) ui.list.innerHTML = '';
  }
  window.NorskWordbook = {init,render,renderTOC,hide,syncChanged:() => { const line = $('#wb-storage'); if (line && ui.deps.isActive()) line.outerHTML = storageLine(); },
    title:() => book().title};
})();
