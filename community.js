/* Anonymous community rankings. Only aggregate results leave this browser. */
(() => {
  'use strict';
  if (window.NorskCommunity) return;

  const DEVICE_KEY = 'norsk-community-device-v1';
  const QUEUE_PREFIX = 'norsk-community-results-v1:';
  const RESULT_PREFIX = 'norsk-community-result-v2:';
  const TIMEOUT_MS = 12000;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const CONTROL = /[\p{Cc}\p{Cf}\p{Cs}]/u;
  const state = {
    initialized:false, identity:null, identitySaved:false, identityReady:null, profile:null,
    registration:null, flushing:null, startup:null, dialog:null, notify:null,
    period:'week', board:null, status:'idle', error:'', request:0,
    editing:false, draft:'', saving:false, nameError:'', nameMessage:'', pending:0,
  };
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const count = value => [...String(value)].length;
  const formatNumber = value => Number(value).toLocaleString('zh-CN');
  const isOpen = () => Boolean(state.dialog?.open);
  function base() {
    const value=String(window.NORSK_COMMUNITY_CONFIG?.apiBase || '/api/community').trim();
    let url;
    try { url=new URL(value,window.location?.href || 'http://localhost/'); } catch { throw issue('service_unavailable'); }
    if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw issue('service_unavailable');
    return url.href.replace(/\/+$/,'');
  }
  const issue = code => Object.assign(new Error(code),{code});
  function announce(message) { try { state.notify?.(message); } catch { /* Host notifications are optional. */ } }
  function safe(run) { return (...args) => { try { return Promise.resolve(run(...args)).catch(() => false); } catch { return Promise.resolve(false); } }; }

  function storedIdentity() {
    let saved;
    try { saved=JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null'); } catch { return null; }
    if (!saved || !UUID.test(saved.deviceId) || !/^[0-9a-f]{64}$/i.test(saved.deviceSecret || '')) return null;
    return {deviceId:saved.deviceId,deviceSecret:saved.deviceSecret,nickname:typeof saved.nickname === 'string' ? saved.nickname : ''};
  }
  function createOrReadIdentity() {
    // This function runs only while holding a cross-tab lock. Re-read after acquiring it.
    const existing=storedIdentity();
    if (existing) return existing;
    if (!window.crypto?.getRandomValues) throw issue('storage_unavailable');
    const bytes=window.crypto.getRandomValues(new Uint8Array(48));
    bytes[6]=(bytes[6] & 15) | 64; bytes[8]=(bytes[8] & 63) | 128;
    const hex=Array.from(bytes,byte => byte.toString(16).padStart(2,'0')),id=hex.slice(0,16).join('');
    const identity={deviceId:`${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`,deviceSecret:hex.slice(16).join(''),nickname:''};
    try { localStorage.setItem(DEVICE_KEY,JSON.stringify({version:1,...identity})); }
    catch { throw issue('storage_unavailable'); }
    return identity;
  }
  function indexedIdentityLock(run) {
    // A readwrite transaction serializes first creation on browsers without Web Locks.
    // The database coordinates access only; credentials remain in localStorage.
    return new Promise((resolve,reject) => {
      if (!window.indexedDB?.open) { reject(issue('storage_unavailable')); return; }
      let opening;
      try { opening=window.indexedDB.open('norsk-community-coordination',1); } catch { reject(issue('storage_unavailable')); return; }
      let abandoned=false;
      opening.onupgradeneeded=() => { opening.result.createObjectStore('identity-lock'); };
      opening.onerror=opening.onblocked=() => { abandoned=true; reject(issue('storage_unavailable')); };
      opening.onsuccess=() => {
        const database=opening.result;
        if (abandoned) { database.close(); return; }
        let transaction,value,failure;
        try {
          transaction=database.transaction('identity-lock','readwrite');
          const reading=transaction.objectStore('identity-lock').get(DEVICE_KEY);
          reading.onsuccess=() => { try { value=run(); } catch (error) { failure=error; transaction.abort(); } };
          transaction.oncomplete=() => { database.close(); resolve(value); };
          transaction.onabort=transaction.onerror=() => { database.close(); reject(failure || issue('storage_unavailable')); };
        } catch { database.close(); reject(issue('storage_unavailable')); }
      };
    });
  }
  function prepareIdentity() {
    if (state.identitySaved) return Promise.resolve(state.identity);
    if (!state.identityReady) {
      state.identityReady=(async () => {
        let identity=storedIdentity();
        if (!identity) {
          const locks=window.navigator?.locks;
          identity=locks?.request ? await locks.request(DEVICE_KEY,{mode:'exclusive'},createOrReadIdentity) : await indexedIdentityLock(createOrReadIdentity);
        }
        state.identity=identity; state.identitySaved=true;
        return identity;
      })().catch(error => { state.identityReady=null; throw error; });
    }
    return state.identityReady;
  }
  function currentIdentity() {
    if (!state.identitySaved || !state.identity) throw issue('storage_unavailable');
    return state.identity;
  }
  function applyProfile(profile) {
    if (!profile || typeof profile.id !== 'string' || !profile.id || profile.id.length > 128 || typeof profile.nickname !== 'string' || !profile.nickname.trim() || count(profile.nickname) > 20 || (state.profile && profile.id !== state.profile.id)) throw issue('service_unavailable');
    state.profile={id:profile.id,nickname:profile.nickname};
    state.identity.nickname=profile.nickname;
    try { localStorage.setItem(DEVICE_KEY,JSON.stringify({version:1,...state.identity})); } catch { /* A name cache is optional; credentials were saved before registration. */ }
    return state.profile;
  }
  function resultPayload(result) {
    if (!result || !['learn','quiz','match'].includes(result.activity) || typeof result.id !== 'string' || !result.id.trim() || count(result.id) > 80 || CONTROL.test(result.id)) return null;
    if (!Number.isInteger(result.total) || result.total < 1 || result.total > 3000 || !Array.isArray(result.answers)) return null;
    return {sessionId:result.id,activity:result.activity,total:result.total,correct:Math.min(result.total,result.answers.filter(answer => answer?.points === 2).length)};
  }
  function validQueued(item) {
    return item && typeof item.sessionId === 'string' && item.sessionId.trim() && count(item.sessionId) <= 80 && !CONTROL.test(item.sessionId) && ['learn','quiz','match'].includes(item.activity) && Number.isInteger(item.total) && item.total >= 1 && item.total <= 3000 && Number.isInteger(item.correct) && item.correct >= 0 && item.correct <= item.total;
  }
  const resultKey = sessionId => RESULT_PREFIX+currentIdentity().deviceId+':'+encodeURIComponent(sessionId);
  function storeEntry(key,entry) {
    try { localStorage.setItem(key,JSON.stringify(entry)); }
    catch { throw issue('storage_unavailable'); }
  }
  function migrateQueue(deviceId) {
    let saved;
    try { saved=JSON.parse(localStorage.getItem(QUEUE_PREFIX+deviceId) || 'null'); } catch { return; }
    if (!saved || saved.deviceId !== deviceId || !Array.isArray(saved.items)) return;
    const completed=Array.isArray(saved.completed) ? saved.completed.filter(id => typeof id === 'string' && id && count(id) <= 80) : [];
    for (const item of saved.items) {
      if (!validQueued(item) || completed.includes(item.sessionId) || localStorage.getItem(resultKey(item.sessionId))) continue;
      storeEntry(resultKey(item.sessionId),{version:2,deviceId,sessionId:item.sessionId,activity:item.activity,total:item.total,correct:item.correct,status:'pending',queuedAt:Date.now()});
    }
    for (const sessionId of completed) {
      if (!localStorage.getItem(resultKey(sessionId))) storeEntry(resultKey(sessionId),{version:2,deviceId,sessionId,status:'done'});
    }
    // Retain the old envelope if any durable write above failed, so migration can resume.
    try { localStorage.removeItem(QUEUE_PREFIX+deviceId); } catch { /* Duplicate receipts are harmless. */ }
  }
  function readQueue() {
    const deviceId=currentIdentity().deviceId;
    migrateQueue(deviceId);
    const prefix=RESULT_PREFIX+deviceId+':',pending=[],completed=[];
    // Each session has its own key: another tab cannot overwrite unrelated pending results.
    const keys=[];
    for (let i=0; i<localStorage.length; i++) { const key=localStorage.key(i); if (key?.startsWith(prefix)) keys.push(key); }
    for (const key of keys) {
      let item;
      try { item=JSON.parse(localStorage.getItem(key) || 'null'); } catch { continue; }
      if (!item || item.deviceId !== deviceId || typeof item.sessionId !== 'string' || key !== resultKey(item.sessionId)) continue;
      if (item.status === 'done') completed.push(item.sessionId);
      else if (item.status === 'pending' && validQueued(item)) pending.push(item);
    }
    pending.sort((a,b) => (a.queuedAt || 0)-(b.queuedAt || 0) || a.sessionId.localeCompare(b.sessionId));
    const items=pending.map(item => ({sessionId:item.sessionId,activity:item.activity,total:item.total,correct:item.correct}));
    state.pending=items.length;
    return {version:2,deviceId,items,completed};
  }
  function enqueueResult(payload) {
    const deviceId=currentIdentity().deviceId;
    storeEntry(resultKey(payload.sessionId),{version:2,deviceId,...payload,status:'pending',queuedAt:Date.now()});
    state.pending++;
  }
  function acknowledgeResult(payload) {
    storeEntry(resultKey(payload.sessionId),{version:2,deviceId:currentIdentity().deviceId,sessionId:payload.sessionId,status:'done'});
    readQueue();
  }
  async function request(path,{method='GET',body,auth=false}={}) {
    const headers={Accept:'application/json'};
    if (body) headers['Content-Type']='application/json';
    if (auth) { const device=await prepareIdentity(); headers['X-Device-Id']=device.deviceId; headers.Authorization=`Bearer ${device.deviceSecret}`; }
    const controller=new AbortController();
    let timer;
    try {
      const timeout=new Promise((_,reject) => { timer=setTimeout(() => { controller.abort(); reject(issue('timeout')); },TIMEOUT_MS); });
      const operation=(async () => {
        const response=await fetch(base()+path,{method,headers,credentials:'same-origin',signal:controller.signal,...(body ? {body:JSON.stringify(body)} : {})});
        let data;
        try { data=await response.json(); } catch { throw issue('service_unavailable'); }
        if (!response.ok) throw issue(data?.code || (response.status === 429 ? 'rate_limited' : 'service_unavailable'));
        if (!data || typeof data !== 'object') throw issue('service_unavailable');
        return data;
      })();
      return await Promise.race([operation,timeout]);
    } catch (error) {
      if (error?.code) throw error;
      throw issue('service_unavailable');
    } finally { clearTimeout(timer); }
  }
  async function ensureRegistered() {
    await prepareIdentity();
    if (state.profile) return Promise.resolve(state.profile);
    if (!state.registration) {
      const {deviceId,deviceSecret}=state.identity;
      state.registration=request('/device',{method:'POST',body:{deviceId,deviceSecret}}).then(data => applyProfile(data.profile)).finally(() => { state.registration=null; });
    }
    return state.registration;
  }
  function flushQueue() {
    if (state.flushing) return state.flushing;
    state.flushing=(async () => {
      await ensureRegistered();
      for (;;) {
        const next=readQueue().items[0];
        if (!next) return true;
        const reply=await request('/results',{method:'POST',body:next,auth:true});
        if (reply.accepted !== true) throw issue('service_unavailable');
        // A lost response or failed local write leaves this item safe to retry: the server keys it by sessionId.
        acknowledgeResult(next);
      }
    })().catch(() => false).finally(() => { state.flushing=null; });
    return state.flushing;
  }
  async function initialize(options={}) {
    if (typeof options?.notify === 'function') state.notify=options.notify;
    await prepareIdentity();
    readQueue();
    if (!state.initialized) {
      state.initialized=true;
      window.addEventListener('online',() => { void recover(); });
      window.addEventListener('storage',event => {
        if (event.key?.startsWith(RESULT_PREFIX+state.identity.deviceId+':') || event.key === QUEUE_PREFIX+state.identity.deviceId) { try { readQueue(); if (isOpen()) render(); } catch { /* Try again on the next open. */ } }
      });
    }
    if (!state.startup) state.startup=ensureRegistered().then(() => flushQueue()).catch(() => false).finally(() => { state.startup=null; });
    return state.startup;
  }
  async function recover() {
    try { const ok=await flushQueue(); if (isOpen()) await loadBoard(); return ok; } catch { return false; }
  }
  function friendly(error,forName=false) {
    if (error?.code === 'storage_unavailable') return '浏览器暂时无法记住你的身份，请允许保存网站数据后重试。';
    if (error?.code === 'rate_limited') return '操作有点频繁，请稍等片刻再试。';
    if (forName && ['nickname_invalid','invalid_request'].includes(error?.code)) return '请使用 1–20 个字符，去掉换行或特殊控制符后再保存。';
    return forName ? '昵称暂时未能保存，请稍后重试。' : '排行榜暂时无法连接，稍后再来看看。';
  }
  function cleanEntry(entry) {
    if (!entry || !Number.isInteger(entry.rank) || entry.rank < 1 || typeof entry.id !== 'string' || typeof entry.nickname !== 'string' || !Number.isInteger(entry.xp) || entry.xp < 0 || !Number.isInteger(entry.words) || entry.words < 0) throw issue('service_unavailable');
    return {rank:entry.rank,id:entry.id,nickname:entry.nickname,xp:entry.xp,words:entry.words};
  }
  async function loadBoard() {
    const token=++state.request, period=state.period;
    state.status='loading'; state.error=''; render();
    try {
      await ensureRegistered();
      await flushQueue();
      const [profileReply,board]=await Promise.all([
        request('/profile',{auth:true}),
        request(`/leaderboard?period=${period}&deviceId=${encodeURIComponent(state.identity.deviceId)}`),
      ]);
      if (token !== state.request) return false;
      applyProfile(profileReply.profile);
      if (board.period !== period || !Array.isArray(board.entries)) throw issue('service_unavailable');
      const entries=board.entries.map(cleanEntry), me=board.me ? cleanEntry(board.me) : null;
      if (me && me.id !== state.profile.id) throw issue('service_unavailable');
      state.board={period,entries,me,updatedAt:board.updatedAt}; state.status='ready';
      render(); return true;
    } catch (error) {
      if (token !== state.request) return false;
      state.status='error'; state.error=friendly(error); render(); return false;
    }
  }
  function icon(name) {
    if (name === 'close') return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    if (name === 'edit') return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 5 4 4M5 19l4-1L20 7a2.8 2.8 0 0 0-4-4L5 14z"/></svg>';
    return '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M13 34C9 16 23 10 37 11c1 14-5 28-23 24M13 35l18-18M22 26l-1-8m1 8 9 1"/></svg>';
  }
  function button(action,text,style='',extra='') { return `<button type="button" class="nc-button ${style}" data-nc-action="${action}" ${extra}>${text}</button>`; }
  function row(entry,pinned=false) {
    const mine=entry.id === state.profile?.id;
    return `<div class="nc-row${mine ? ' is-me' : ''}${pinned ? ' is-pinned' : ''}" role="row"${mine ? ' aria-label="你的排名"' : ''}><span class="nc-rank${entry.rank <= 3 ? ' is-leading' : ''}" role="cell">${escapeHTML(entry.rank < 10 ? '0'+entry.rank : entry.rank)}</span><span class="nc-learner" role="cell"><span class="nc-name">${escapeHTML(entry.nickname)}</span>${mine ? '<span class="nc-you">我</span>' : ''}</span><span class="nc-xp" role="cell">${formatNumber(entry.xp)}</span><span class="nc-words" role="cell">${formatNumber(entry.words)}</span></div>`;
  }
  function boardMarkup() {
    if (state.status === 'loading' || state.status === 'idle') return `<div class="nc-loading" role="status" aria-label="正在读取排行榜"><p>正在读取大家的积累…</p>${Array.from({length:4},() => '<div class="nc-skeleton"><i></i><span></span><b></b></div>').join('')}</div>`;
    if (state.status === 'error') return `<div class="nc-empty nc-unavailable" role="status"><span class="nc-empty-mark">${icon('leaf')}</span><h3>稍后，再一起看看。</h3><p>${escapeHTML(state.error)}</p>${button('retry','重新连接','nc-primary')}</div>`;
    const {entries,me}=state.board;
    if (!entries.length) return `<div class="nc-empty"><span class="nc-empty-mark">${icon('leaf')}</span><h3>${state.period === 'week' ? '新的一周，从你开始。' : '第一份积累，正在路上。'}</h3><p>完成一组答题练习、测验或配对，<br>就能在这里看到自己的名字。</p>${button('close','去练一组','nc-primary')}</div>`;
    return `<div class="nc-table" role="table" aria-label="${state.period === 'week' ? '本周' : '累计'}学习排行榜"><div class="nc-table-head nc-row" role="row"><span role="columnheader">排名</span><span role="columnheader">学习者</span><span role="columnheader">XP</span><span role="columnheader">练词数</span></div><div role="rowgroup">${entries.map(entry => row(entry)).join('')}</div>${me && !entries.some(entry => entry.id === me.id) ? `<div class="nc-own-divider" aria-hidden="true">···</div><div role="rowgroup">${row(me,true)}</div>` : ''}</div>${!me ? '<p class="nc-first-note">练一组，让今天的积累也留在这里。</p>' : ''}`;
  }
  function render() {
    const dialog=state.dialog;
    if (!dialog) return;
    const focused=document.activeElement;
    const focusId=dialog.contains(focused) ? focused?.id : null;
    const selection=focusId === 'nc-nickname' ? [focused.selectionStart,focused.selectionEnd] : null;
    const name=state.profile?.nickname || state.identity?.nickname;
    const me=state.status === 'ready' ? state.board?.me : null;
    const personal=me ? `<span class="nc-personal-rank">${state.period === 'week' ? '本周' : '累计'}第 <strong>${formatNumber(me.rank)}</strong> 名</span>` : '';
    dialog.innerHTML=`<div class="nc-heading"><div><p class="nc-kicker">LITT HVER DAG · 一点一滴</p><h2 id="nc-title">一起积累</h2></div>${button('close',icon('close'),'nc-close','aria-label="关闭排行榜"')}</div><p class="nc-intro">每天练一点，看看我们走了多远。</p><section class="nc-profile" aria-label="我的昵称"><div class="nc-profile-line"><span class="nc-avatar" aria-hidden="true">ø</span><div class="nc-profile-name"><span>我的昵称</span><strong>${escapeHTML(name || '正在连接…')}</strong></div>${state.editing ? '' : button('edit',icon('edit')+'改名','nc-edit',`${!name ? 'disabled' : ''} aria-expanded="false" aria-controls="nc-name-form"`)}${personal}</div>${state.editing ? `<form id="nc-name-form" class="nc-name-form" aria-busy="${state.saving}"><label for="nc-nickname">给自己取个名字</label><div class="nc-name-input"><input id="nc-nickname" name="nickname" type="text" maxlength="40" value="${escapeHTML(state.draft)}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="nc-name-count nc-name-note${state.nameError ? ' nc-name-error' : ''}"${state.nameError ? ' aria-invalid="true"' : ''}${state.saving ? ' readonly' : ''}><span id="nc-name-count">${count(state.draft)} / 20</span></div><div class="nc-name-actions"><button type="submit" class="nc-button nc-primary"${state.saving ? ' disabled' : ''}>${state.saving ? '正在保存…' : '保存昵称'}</button>${button('cancel-edit','取消','nc-quiet',state.saving ? 'disabled' : '')}</div>${state.nameError ? `<p class="nc-name-error" id="nc-name-error" role="alert">${escapeHTML(state.nameError)}</p>` : ''}</form>` : ''}${state.nameMessage ? `<p class="nc-name-message" role="status">${escapeHTML(state.nameMessage)}</p>` : ''}<p class="nc-privacy" id="nc-name-note">同一浏览器会记住你。昵称和积分会展示在榜单。</p></section><div class="nc-board-top"><div class="nc-tabs" role="tablist" aria-label="排行榜时段">${['week','all'].map(period => `<button type="button" id="nc-tab-${period}" class="nc-tab" role="tab" aria-selected="${state.period === period}" aria-controls="nc-board" tabindex="${state.period === period ? 0 : -1}" data-nc-action="period" data-nc-period="${period}">${period === 'week' ? '本周榜' : '总榜'}</button>`).join('')}</div><span class="nc-board-caption">${state.period === 'week' ? '本周的积累' : '一路的积累'}</span></div><div id="nc-board" class="nc-board" role="tabpanel" aria-labelledby="nc-tab-${state.period}" aria-busy="${state.status === 'loading'}">${boardMarkup()}</div>${state.pending ? `<p class="nc-pending" role="status">还有 ${formatNumber(state.pending)} 次练习待更新，连接恢复后会自动补上。</p>` : ''}<footer class="nc-footer"><span>每词 2 XP · 答对再加 8 XP</span><span>每日最多 5,000 XP</span></footer>`;
    if (focusId) {
      const next=dialog.querySelector('#'+focusId);
      next?.focus({preventScroll:true});
      if (next && selection && Number.isInteger(selection[0])) next.setSelectionRange?.(...selection);
    }
  }
  function createDialog() {
    if (state.dialog?.isConnected) return state.dialog;
    const dialog=document.createElement('dialog');
    dialog.id='norsk-community'; dialog.className='nc-dialog'; dialog.setAttribute('aria-labelledby','nc-title');
    dialog.addEventListener('click',event => {
      const target=event.target.closest('[data-nc-action]');
      if (!target || !dialog.contains(target) || target.disabled) return;
      const action=target.dataset.ncAction;
      if (action === 'close') dialog.close();
      else if (action === 'retry') void loadBoard();
      else if (action === 'period' && state.period !== target.dataset.ncPeriod) {
        state.period=target.dataset.ncPeriod === 'all' ? 'all' : 'week'; state.board=null; void loadBoard();
        dialog.querySelector('#nc-tab-'+state.period)?.focus({preventScroll:true});
      } else if (action === 'edit') {
        state.editing=true; state.draft=state.profile?.nickname || state.identity.nickname || ''; state.nameError=''; state.nameMessage=''; render();
        dialog.querySelector('#nc-nickname')?.focus({preventScroll:true}); dialog.querySelector('#nc-nickname')?.select();
      } else if (action === 'cancel-edit' && !state.saving) { state.editing=false; state.nameError=''; render(); }
    });
    dialog.addEventListener('input',event => {
      if (event.target.id !== 'nc-nickname') return;
      state.draft=[...event.target.value].slice(0,20).join('');
      event.target.value=state.draft;
      const counter=dialog.querySelector('#nc-name-count'); if (counter) counter.textContent=`${count(state.draft)} / 20`;
    });
    dialog.addEventListener('submit',event => { if (event.target.id === 'nc-name-form') { event.preventDefault(); void saveNickname(); } });
    dialog.addEventListener('keydown',event => {
      // Keep practice shortcuts from acting behind the native modal. Escape keeps its native default.
      event.stopPropagation();
      if (event.target.getAttribute?.('role') !== 'tab' || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const next=event.key === 'Home' ? 'week' : event.key === 'End' ? 'all' : state.period === 'week' ? 'all' : 'week';
      dialog.querySelector('#nc-tab-'+next)?.click(); dialog.querySelector('#nc-tab-'+next)?.focus({preventScroll:true});
    });
    document.body.appendChild(dialog); state.dialog=dialog;
    return dialog;
  }
  async function saveNickname() {
    if (state.saving) return false;
    const nickname=state.draft.trim();
    state.nameMessage=''; state.nameError='';
    if (!nickname || count(nickname) > 20 || CONTROL.test(nickname)) {
      state.nameError='请输入 1–20 个字符，不要包含换行或特殊控制符。'; render(); state.dialog?.querySelector('#nc-nickname')?.focus(); return false;
    }
    state.saving=true; render();
    try {
      await ensureRegistered();
      const response=await request('/profile',{method:'PATCH',body:{nickname},auth:true});
      applyProfile(response.profile);
      state.editing=false; state.nameMessage='昵称已更新。'; state.saving=false;
      announce('昵称已更新。');
      await loadBoard(); return true;
    } catch (error) { state.nameError=friendly(error,true); state.saving=false; render(); return false; }
  }
  async function openDialog() {
    const dialog=createDialog();
    if (!dialog.open) {
      state.period='week'; state.board=null; state.nameMessage=''; state.status='loading'; render(); dialog.showModal();
    }
    void initialize().catch(() => false);
    try { await prepareIdentity(); }
    catch (error) { state.status='error'; state.error=friendly(error); render(); return false; }
    return loadBoard();
  }
  async function submitResult(result) {
    const payload=resultPayload(result);
    if (!payload) return false;
    try {
      await prepareIdentity();
      void initialize().catch(() => false);
      const queue=readQueue();
      if (queue.completed.includes(payload.sessionId) || queue.items.some(item => item.sessionId === payload.sessionId)) return flushQueue();
      // Persist before the first request; do not upload old practice history.
      enqueueResult(payload);
      const ok=await flushQueue();
      if (isOpen()) await loadBoard();
      return ok;
    } catch (error) {
      if (error?.code === 'storage_unavailable') announce('排行榜记录暂时无法保存，练习已完成。');
      return false;
    }
  }

  window.NorskCommunity = {init:safe(initialize),open:safe(openDialog),submitResult:safe(submitResult),flush:safe(recover)};
  window.dispatchEvent(new Event('norskcommunityready'));
})();
