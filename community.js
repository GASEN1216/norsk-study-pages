/* Anonymous community rankings and levels. Only aggregate results and online heartbeats leave this browser. */
(() => {
  'use strict';
  if (window.NorskCommunity) return;

  const DEVICE_KEY = 'norsk-community-device-v1';
  const QUEUE_PREFIX = 'norsk-community-results-v1:';
  const RESULT_PREFIX = 'norsk-community-result-v2:';
  const TIMEOUT_MS = 12000;
  const PRESENCE_MS = 60000;
  const HONORS_TTL_MS = 20000;
  const CEREMONY_KEY = 'norsk-community-ceremony-v1';
  const WEEK = /^\d{4}-\d{2}-\d{2}$/;
  const ACTIVITIES = ['learn','quiz','match','cards','listen'];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const CONTROL = /[\p{Cc}\p{Cf}\p{Cs}]/u;
  const state = {
    initialized:false, identity:null, identitySaved:false, identityReady:null, profile:null,
    registration:null, flushing:null, startup:null, container:null, notify:null,
    period:'week', board:null, status:'idle', error:'', request:0, loadedAt:0, expanded:false, rulesOpen:false,
    editing:false, draft:'', saving:false, nameError:'', nameMessage:'', pending:0,
    stats:null, presenceTimer:null, presenceBusy:null, lastPing:0, confirmName:'', refreshing:null,
    lastWeek:null, lastWeekAt:0, lastWeekLoad:null, waitingCelebrate:false,
    honors:null, honorsAt:0, honorsLoad:null, honorsDirty:false,
  };
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const count = value => [...String(value)].length;
  const formatNumber = value => Number(value).toLocaleString('zh-CN');
  const isMounted = () => Boolean(state.container && state.container.isConnected !== false);
  const isVisible = () => isMounted() && document.visibilityState !== 'hidden' && !state.container.closest?.('[hidden]');
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
    const renamed=state.identity.nickname !== profile.nickname;
    state.profile={id:profile.id,nickname:profile.nickname};
    state.identity.nickname=profile.nickname;
    // Notes keep each nickname apart, so they look again when the name changes.
    if (renamed) { try { window.dispatchEvent(new CustomEvent('norskprofilechange',{detail:{nickname:profile.nickname}})); } catch { /* Listeners are optional. */ } }
    try { localStorage.setItem(DEVICE_KEY,JSON.stringify({version:1,...state.identity})); } catch { /* A name cache is optional; credentials were saved before registration. */ }
    return state.profile;
  }
  function resultPayload(result) {
    if (!result || !ACTIVITIES.includes(result.activity) || typeof result.id !== 'string' || !result.id.trim() || count(result.id) > 80 || CONTROL.test(result.id)) return null;
    if (!Number.isInteger(result.total) || result.total < 1 || result.total > 3000 || !Array.isArray(result.answers)) return null;
    return {sessionId:result.id,activity:result.activity,total:result.total,correct:Math.min(result.total,result.answers.filter(answer => answer?.points === 2).length)};
  }
  function validQueued(item) {
    return item && typeof item.sessionId === 'string' && item.sessionId.trim() && count(item.sessionId) <= 80 && !CONTROL.test(item.sessionId) && ACTIVITIES.includes(item.activity) && Number.isInteger(item.total) && item.total >= 1 && item.total <= 3000 && Number.isInteger(item.correct) && item.correct >= 0 && item.correct <= item.total;
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
  async function request(path,{method='GET',body,auth=false,timeout:limit=TIMEOUT_MS}={}) {
    const headers={Accept:'application/json'};
    if (body) headers['Content-Type']='application/json';
    if (auth) { const device=await prepareIdentity(); headers['X-Device-Id']=device.deviceId; headers.Authorization=`Bearer ${device.deviceSecret}`; }
    const controller=new AbortController();
    let timer;
    try {
      const timeout=new Promise((_,reject) => { timer=setTimeout(() => { controller.abort(); reject(issue('timeout')); },Math.min(TIMEOUT_MS,Math.max(1000,Number(limit) || TIMEOUT_MS))); });
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
        const before=state.stats?.xp;
        if (applyStats(reply.stats) && reply.duplicate !== true && whole(before) && levelInfo(state.stats.xp).level > levelInfo(before).level) announce(`升到 Lv.${levelInfo(state.stats.xp).level} 了`);
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
        if (event.key?.startsWith(RESULT_PREFIX+state.identity.deviceId+':') || event.key === QUEUE_PREFIX+state.identity.deviceId) { try { readQueue(); if (isMounted()) render(); } catch { /* Try again on the next open. */ } }
      });
    }
    if (!state.startup) state.startup=ensureRegistered().then(() => flushQueue()).catch(() => false).finally(() => { state.startup=null; });
    return state.startup;
  }
  async function recover() {
    try { const ok=await flushQueue(); if (isVisible()) await loadBoard(); return ok; } catch { return false; }
  }
  function friendly(error,forName=false) {
    if (error?.code === 'storage_unavailable') return '浏览器暂时无法记住你的身份，请允许保存网站数据后重试。';
    if (error?.code === 'rate_limited') return '操作有点频繁，请稍等片刻再试。';
    if (forName && ['nickname_invalid','invalid_request'].includes(error?.code)) return '请使用 1–20 个字符，去掉换行或特殊控制符后再保存。';
    return forName ? '昵称暂时未能保存，请稍后重试。' : '排行榜暂时无法连接，稍后再来看看。';
  }
  // Level L starts at 100 * ((L + 1)^2 - 4) XP; 4 stars = moon, 4 moons = sun, 4 suns = crown.
  const threshold = level => 100*((level+1)**2-4);
  function levelInfo(xp) {
    const value=Math.max(0,Math.floor(Number(xp) || 0));
    let level=Math.max(1,Math.floor(Math.sqrt(Math.floor((value+400)/100)))-1);
    while (threshold(level+1) <= value) level++;
    while (level > 1 && threshold(level) > value) level--;
    const start=threshold(level),next=threshold(level+1);
    return {level,xp:value,start,next,progress:(value-start)/(next-start)};
  }
  function levelIcons(level) {
    const parts=[['crown',Math.floor(level/64)],['sun',Math.floor(level%64/16)],['moon',Math.floor(level%16/4)],['star',level%4]];
    return parts.flatMap(([name,amount]) => Array.from({length:amount},() => icon(name))).join('');
  }
  const whole = value => Number.isInteger(value) && value >= 0;
  function applyStats(stats) {
    // Older servers return no stats; keep the last known values instead of failing.
    if (!stats || !whole(stats.xp) || !whole(stats.today) || !whole(stats.week) || !whole(stats.onlineToday)) return false;
    state.stats={xp:stats.xp,today:stats.today,week:stats.week,onlineToday:stats.onlineToday,onlineLimit:whole(stats.onlineLimit) ? stats.onlineLimit : 240};
    return true;
  }
  // Last week's top three; servers without this period simply skip the ceremony.
  function loadLastWeek() {
    if (state.lastWeekLoad || !state.identity || (state.lastWeekAt && Date.now()-state.lastWeekAt < 1800000)) return state.lastWeekLoad || Promise.resolve(false);
    state.lastWeekLoad=(async () => {
      const board=await request(`/leaderboard?period=lastweek&deviceId=${encodeURIComponent(state.identity.deviceId)}`);
      state.lastWeekAt=Date.now();
      if (board.period !== 'lastweek' || !Array.isArray(board.entries) || !WEEK.test(board.weekStart || '')) return false;
      const entries=board.entries.map(cleanEntry).filter(entry => entry.rank <= 3 && entry.xp > 0).slice(0,3);
      state.lastWeek={weekStart:board.weekStart,entries};
      maybeCeremony();
      return true;
    })().catch(() => { state.lastWeekAt=Date.now(); return false; }).finally(() => { state.lastWeekLoad=null; });
    return state.lastWeekLoad;
  }
  // Each browser sees each week's award ceremony once, the first time the leaderboard opens in the new week.
  function maybeCeremony() {
    const week=state.lastWeek;
    if (!week?.entries.length || !isVisible()) return;
    let seen='';
    try { seen=localStorage.getItem(CEREMONY_KEY) || ''; } catch { return; }
    if (seen === week.weekStart) return;
    if (!window.NorskCelebrate?.ceremony) {
      if (!state.waitingCelebrate) { state.waitingCelebrate=true; window.addEventListener('norskcelebrateready',() => { state.waitingCelebrate=false; maybeCeremony(); },{once:true}); }
      return;
    }
    try { localStorage.setItem(CEREMONY_KEY,week.weekStart); } catch { return; }
    try { void window.NorskCelebrate.ceremony({entries:week.entries,weekStart:week.weekStart,meId:state.profile?.id || ''}); } catch { /* Decoration only. */ }
  }
  function cleanEntry(entry) {
    if (!entry || !Number.isInteger(entry.rank) || entry.rank < 1 || typeof entry.id !== 'string' || typeof entry.nickname !== 'string' || !whole(entry.xp) || !whole(entry.words)) throw issue('service_unavailable');
    return {rank:entry.rank,id:entry.id,nickname:entry.nickname,xp:entry.xp,words:entry.words,level:Number.isInteger(entry.level) && entry.level >= 1 ? entry.level : null};
  }
  // Refresh the ranking list in place, without a loading state; failures keep the last list.
  function refreshList() {
    if (state.refreshing || !isVisible() || state.status !== 'ready' || !state.identity) return state.refreshing || Promise.resolve(false);
    const token=state.request, period=state.period;
    state.refreshing=(async () => {
      const board=await request(`/leaderboard?period=${period}&deviceId=${encodeURIComponent(state.identity.deviceId)}`);
      if (token !== state.request || period !== state.period || state.status !== 'ready') return false;
      if (board.period !== period || !Array.isArray(board.entries)) throw issue('service_unavailable');
      const entries=board.entries.map(cleanEntry), me=board.me ? cleanEntry(board.me) : null;
      if (me && me.id !== state.profile?.id) throw issue('service_unavailable');
      state.board={period,entries,me,updatedAt:board.updatedAt}; state.loadedAt=Date.now();
      render(); return true;
    })().catch(() => false).finally(() => { state.refreshing=null; });
    return state.refreshing;
  }
  async function loadBoard() {
    const token=++state.request, period=state.period;
    state.status='loading'; state.error=''; render();
    try {
      await ensureRegistered();
      await flushQueue();
      if (token !== state.request) return false;
      const [profileReply,board]=await Promise.all([
        request('/profile',{auth:true}),
        request(`/leaderboard?period=${period}&deviceId=${encodeURIComponent(state.identity.deviceId)}`),
      ]);
      if (token !== state.request) return false;
      applyProfile(profileReply.profile);
      applyStats(profileReply.stats);
      if (board.period !== period || !Array.isArray(board.entries)) throw issue('service_unavailable');
      const entries=board.entries.map(cleanEntry), me=board.me ? cleanEntry(board.me) : null;
      if (me && me.id !== state.profile.id) throw issue('service_unavailable');
      state.board={period,entries,me,updatedAt:board.updatedAt}; state.status='ready'; state.loadedAt=Date.now();
      render(); void loadLastWeek(); return true;
    } catch (error) {
      if (token !== state.request) return false;
      state.status='error'; state.error=friendly(error); render(); return false;
    }
  }
  function icon(name) {
    const paths={
      edit:'<path d="m15 5 4 4M5 19l4-1L20 7a2.8 2.8 0 0 0-4-4L5 14z"/>',
      star:'<path class="nc-fill" d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
      moon:'<path class="nc-fill" d="M15.5 3.5A8.7 8.7 0 1 0 20.6 16 7 7 0 0 1 15.5 3.5z"/>',
      sun:'<circle class="nc-fill" cx="12" cy="12" r="4.4"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
      crown:'<path class="nc-fill" d="M3.5 8.5 8 12l4-6.5 4 6.5 4.5-3.5-1.6 9.5H5.1z"/>',
    };
    return `<svg class="nc-icon nc-icon-${name}" viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
  }
  function button(action,text,style='',extra='') { return `<button type="button" class="nc-button ${style}" data-nc-action="${action}" ${extra}>${text}</button>`; }
  function row(entry,pinned=false) {
    const mine=entry.id === state.profile?.id;
    return `<li class="nc-row${mine ? ' is-me' : ''}${pinned ? ' is-pinned' : ''}${entry.rank <= 3 ? ' is-top is-top-'+entry.rank : ''}"${mine ? ' aria-label="你的排名"' : ''}><span class="nc-rank">${escapeHTML(entry.rank)}</span><span class="nc-learner"><span class="nc-name">${escapeHTML(entry.nickname)}</span>${mine ? '<span class="nc-you">我</span>' : ''}</span>${entry.level ? `<span class="nc-level" title="等级 ${entry.level}">Lv.${escapeHTML(entry.level)}</span>` : '<span></span>'}<span class="nc-xp">${formatNumber(entry.xp)}</span></li>`;
  }
  function boardMarkup() {
    if (state.status === 'error') return `<div class="nc-empty" role="status"><p>${escapeHTML(state.error)}</p>${button('retry','重新连接','nc-primary')}</div>`;
    if (!state.board || state.board.period !== state.period) return `<ol class="nc-list nc-loading" aria-label="正在读取排行榜">${Array.from({length:5},() => '<li class="nc-skeleton"><i></i><span></span><b></b></li>').join('')}</ol>`;
    const {entries,me}=state.board;
    if (!entries.length) return `<div class="nc-empty"><p>${state.period === 'week' ? '本周还没有人上榜。开着网站或练一组，就能看到自己的名字。' : '还没有人上榜。开着网站或练一组，就能看到自己的名字。'}</p></div>`;
    const shown=state.expanded ? entries : entries.slice(0,10);
    const pinned=me && !shown.some(entry => entry.id === me.id);
    return `<ol class="nc-list" aria-label="${state.period === 'week' ? '本周' : '总'}排行榜">${shown.map(entry => row(entry)).join('')}${pinned ? row(me,true) : ''}</ol>${entries.length > 10 ? button('more',state.expanded ? '收起' : `查看前 ${formatNumber(entries.length)} 名`,'nc-quiet nc-more') : ''}`;
  }
  function meMarkup() {
    const name=state.profile?.nickname || state.identity?.nickname;
    const stats=state.stats, info=levelInfo(stats?.xp || 0), me=state.status === 'ready' ? state.board?.me : null;
    const percent=Math.round(Math.min(1,Math.max(0,info.progress))*100);
    const confirm=state.confirmName ? `<div class="nc-confirm" role="alertdialog" aria-labelledby="nc-confirm-text"><p id="nc-confirm-text">已有学习者叫「${escapeHTML(state.confirmName)}」。同名会视为同一个人，经验和排名合并计算。这是你吗？</p><div>${button('confirm-name','是我，使用这个名字','nc-primary')}${button('cancel-confirm','换个名字','nc-quiet')}</div></div>` : '';
    const editing=state.editing ? `<form id="nc-name-form" class="nc-name-form" aria-busy="${state.saving}"><label class="nc-sr" for="nc-nickname">昵称</label><input id="nc-nickname" name="nickname" type="text" enterkeyhint="done" maxlength="40" value="${escapeHTML(state.draft)}" autocomplete="off" autocapitalize="off" spellcheck="false"${state.nameError ? ' aria-invalid="true" aria-describedby="nc-name-error"' : ''}${state.saving ? ' readonly' : ''}><span id="nc-name-count">${count(state.draft)}/20</span><button type="submit" class="nc-button nc-primary"${state.saving ? ' disabled' : ''}>${state.saving ? '保存中…' : '保存'}</button>${button('cancel-edit','取消','nc-quiet',state.saving ? 'disabled' : '')}</form>${confirm}${state.nameError ? `<p class="nc-name-error" id="nc-name-error" role="alert">${escapeHTML(state.nameError)}</p>` : ''}` : '';
    return `<div class="nc-me"><div class="nc-me-line"><span class="nc-badge" title="等级 ${info.level}"><b>Lv.${info.level}</b><span class="nc-badge-icons">${levelIcons(info.level)}</span></span><strong class="nc-me-name">${escapeHTML(name || '连接中…')}</strong>${state.editing ? '' : button('edit',icon('edit'),'nc-icon-button',`${!name ? 'disabled' : ''} aria-label="修改昵称" title="修改昵称"`)}</div>${editing}${state.nameMessage ? `<p class="nc-name-message" role="status">${escapeHTML(state.nameMessage)}</p>` : ''}<div class="nc-level-bar" role="progressbar" aria-label="距离下一级" aria-valuemin="${info.start}" aria-valuemax="${info.next}" aria-valuenow="${info.xp}"><span style="width:${percent}%"></span></div><div class="nc-me-meta"><span>${stats ? formatNumber(info.xp)+' XP' : '— XP'}</span><span>距 Lv.${info.level+1} 还差 ${formatNumber(info.next-info.xp)}</span></div><div class="nc-me-today"><span>今日 <b>+${formatNumber(stats?.today || 0)}</b></span><span>在线 <b>${formatNumber(stats?.onlineToday || 0)}</b>/${formatNumber(stats?.onlineLimit || 240)}</span><span>${me ? `${state.period === 'week' ? '本周' : '总榜'}第 <b>${formatNumber(me.rank)}</b> 名` : '尚未上榜'}</span></div></div>`;
  }
  function render() {
    const container=state.container;
    if (!isMounted() || container.closest?.('[hidden]')) return;
    const focused=document.activeElement;
    const focusId=container.contains?.(focused) ? focused?.id : null;
    const selection=focusId === 'nc-nickname' ? [focused.selectionStart,focused.selectionEnd] : null;
    container.innerHTML=`<section class="nc-panel" aria-labelledby="nc-title"><div class="nc-head"><h3 id="nc-title">排行榜</h3><div class="nc-tabs" role="tablist" aria-label="排行榜时段">${['week','all'].map(period => `<button type="button" id="nc-tab-${period}" class="nc-tab" role="tab" aria-selected="${state.period === period}" tabindex="${state.period === period ? 0 : -1}" data-nc-action="period" data-nc-period="${period}">${period === 'week' ? '本周' : '总榜'}</button>`).join('')}</div></div>${meMarkup()}<div id="nc-board" class="nc-board" role="tabpanel" aria-labelledby="nc-tab-${state.period}" aria-busy="${state.status === 'loading'}">${boardMarkup()}</div>${state.pending ? `<p class="nc-pending" role="status">${formatNumber(state.pending)} 次练习待上传，联网后自动补上。</p>` : ''}<details class="nc-rules"${state.rulesOpen ? ' open' : ''}><summary data-nc-action="rules">经验与等级怎么算</summary><ul><li>网站开着且在前台：每分钟 +2 XP，每天最多 240 XP。</li><li>所有练习每词 +2 XP；拼写、测验、配对、听音首答答对再 +8 XP；词卡为自评，只计每词 2 XP。联机翻翻乐每抢到一对 +10 XP。练习每天最多 5,000 XP。</li><li>昵称相同视为同一个人，多台设备的经验和排名合并计算；改成已有的昵称前会先确认。</li><li>等级：4 ${icon('star')} = 1 ${icon('moon')}，4 ${icon('moon')} = 1 ${icon('sun')}，4 ${icon('sun')} = 1 ${icon('crown')}。Lv.2 需 500 XP，Lv.5 需 3,200，Lv.10 需 11,700，Lv.16 需 28,500。</li></ul></details></section>`;
    if (focusId) {
      const next=container.querySelector?.('#'+focusId);
      next?.focus?.({preventScroll:true});
      if (next && selection && Number.isInteger(selection[0])) next.setSelectionRange?.(...selection);
    }
  }
  function bind(container) {
    if (!container || container.dataset?.ncBound === '1') return;
    if (container.dataset) container.dataset.ncBound='1';
    container.addEventListener('click',event => {
      const target=event.target.closest?.('[data-nc-action]');
      if (!target || target.disabled) return;
      const action=target.dataset.ncAction;
      if (action === 'retry') void loadBoard();
      else if (action === 'more') { state.expanded=!state.expanded; render(); }
      else if (action === 'rules') { event.preventDefault(); state.rulesOpen=!state.rulesOpen; render(); }
      else if (action === 'period' && state.period !== target.dataset.ncPeriod) {
        state.period=target.dataset.ncPeriod === 'all' ? 'all' : 'week'; state.expanded=false; void loadBoard();
        container.querySelector?.('#nc-tab-'+state.period)?.focus?.({preventScroll:true});
      } else if (action === 'edit') {
        state.editing=true; state.draft=state.profile?.nickname || state.identity?.nickname || ''; state.nameError=''; state.nameMessage=''; render();
        container.querySelector?.('#nc-nickname')?.focus?.(); container.querySelector?.('#nc-nickname')?.select?.();
      } else if (action === 'cancel-edit' && !state.saving) { state.editing=false; state.nameError=''; state.confirmName=''; render(); }
      else if (action === 'confirm-name') void saveNickname(true);
      else if (action === 'cancel-confirm') { state.confirmName=''; render(); container.querySelector?.('#nc-nickname')?.focus?.(); }
    });
    container.addEventListener('input',event => {
      if (event.target.id !== 'nc-nickname') return;
      state.draft=[...event.target.value].slice(0,20).join(''); state.confirmName='';
      event.target.value=state.draft;
      const counter=container.querySelector?.('#nc-name-count'); if (counter) counter.textContent=`${count(state.draft)}/20`;
    });
    container.addEventListener('submit',event => { if (event.target.id === 'nc-name-form') { event.preventDefault(); void saveNickname(); } });
    container.addEventListener('keydown',event => {
      // Esc leaves the nickname editor without saving and returns to the edit button.
      if (event.key === 'Escape' && state.editing && !state.saving && event.target.closest?.('#nc-name-form')) {
        event.preventDefault(); event.stopPropagation();
        state.editing=false; state.nameError=''; state.confirmName=''; render();
        container.querySelector?.('[data-nc-action="edit"]')?.focus?.({preventScroll:true});
        return;
      }
      if (event.target.getAttribute?.('role') !== 'tab' || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const next=event.key === 'Home' ? 'week' : event.key === 'End' ? 'all' : state.period === 'week' ? 'all' : 'week';
      container.querySelector?.('#nc-tab-'+next)?.click?.(); container.querySelector?.('#nc-tab-'+next)?.focus?.({preventScroll:true});
    });
  }
  async function saveNickname(confirm=false) {
    if (state.saving) return false;
    const nickname=confirm ? state.confirmName : state.draft.trim();
    state.nameMessage=''; state.nameError=''; state.confirmName='';
    if (!nickname || count(nickname) > 20 || CONTROL.test(nickname)) {
      state.nameError='请输入 1–20 个字符，不要包含换行或特殊控制符。'; render(); state.container?.querySelector?.('#nc-nickname')?.focus?.(); return false;
    }
    state.saving=true; render();
    try {
      await ensureRegistered();
      const response=await request('/profile',{method:'PATCH',body:confirm ? {nickname,confirm:true} : {nickname},auth:true});
      applyProfile(response.profile);
      state.editing=false; state.nameMessage=response.shared ? '已和同名的你合并。' : '昵称已更新。'; state.saving=false;
      announce(state.nameMessage);
      await loadBoard(); return true;
    } catch (error) {
      state.saving=false;
      if (error?.code === 'nickname_exists') { state.confirmName=nickname; render(); return false; }
      state.nameError=friendly(error,true); render(); return false;
    }
  }
  // The host re-creates the container on every render; keep data and refresh only when stale.
  async function mount(container) {
    if (!container) return false;
    state.container=container; bind(container); render();
    void initialize().catch(() => false);
    try { await prepareIdentity(); }
    catch (error) { state.status='error'; state.error=friendly(error); render(); return false; }
    // A second mount while the first load is still running reuses it.
    if (state.status === 'loading') return true;
    if (state.status === 'ready' && state.board?.period === state.period && Date.now()-state.loadedAt < 30000) { maybeCeremony(); return true; }
    return loadBoard();
  }
  // Being on the site earns online XP: one heartbeat a minute while the page is visible.
  function presenceTick() {
    if (state.presenceBusy) return state.presenceBusy;
    if (document.visibilityState === 'hidden' || window.navigator?.onLine === false || Date.now()-state.lastPing < 30000) return Promise.resolve(false);
    state.lastPing=Date.now();
    state.presenceBusy=(async () => {
      await ensureRegistered();
      const reply=await request('/presence',{method:'POST',body:{visible:true},auth:true});
      if (reply.accepted !== true) throw issue('service_unavailable');
      if (applyStats(reply.stats)) render();
      await refreshList();
      return true;
    })().catch(() => false).finally(() => { state.presenceBusy=null; });
    return state.presenceBusy;
  }
  function startPresence() {
    if (state.presenceTimer != null) return Promise.resolve(true);
    state.presenceTimer=setInterval(() => { void presenceTick(); },PRESENCE_MS);
    document.addEventListener?.('visibilitychange',() => { if (document.visibilityState === 'visible') void presenceTick(); });
    return presenceTick();
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
      // Quest and challenge progress changed; honors listeners hear about it once the server agrees.
      if (ok) void loadHonors(true);
      if (isVisible()) await loadBoard();
      return ok;
    } catch (error) {
      if (error?.code === 'storage_unavailable') announce('排行榜记录暂时无法保存，练习已完成。');
      return false;
    }
  }
  // Authenticated access for other features (联机翻翻乐). Unlike the calls above it rejects, with error.code set.
  async function publicRequest(path,options={}) {
    if (typeof path !== 'string' || !/^\/[\w\-/]*(\?[\w=&%.-]*)?$/.test(path)) throw issue('invalid_request');
    const {method='GET',body,auth=true,timeout}=options || {};
    if (!['GET','POST','PATCH'].includes(method)) throw issue('invalid_request');
    if (auth) await ensureRegistered();
    return request(path,{method,body,auth,timeout});
  }
  async function currentProfile() {
    const profile=await ensureRegistered();
    return {id:profile.id,nickname:profile.nickname};
  }
  // Quests, the weekly challenge, trophies and achievements. Cached briefly; resolves to the latest known data or null.
  function loadHonors(force=false) {
    if (state.honorsLoad) {
      if (force) state.honorsDirty=true;
      return state.honorsLoad;
    }
    if (!force && state.honors && Date.now()-state.honorsAt < HONORS_TTL_MS) return Promise.resolve(state.honors);
    // Changes during a request need one follow-up, shared by all waiting consumers.
    const load=(async () => {
      await ensureRegistered();
      do {
        state.honorsDirty=false;
        const data=await request('/honors',{auth:true});
        if (!data.today || !Array.isArray(data.today.quests) || !Array.isArray(data.achievements) || !Array.isArray(data.weeks)) throw issue('service_unavailable');
        state.honors=data; state.honorsAt=Date.now();
        try { window.dispatchEvent(new CustomEvent('norskhonorschange',{detail:data})); } catch { /* Listeners are optional. */ }
      } while (state.honorsDirty);
      return state.honors;
    })().catch(() => state.honors).finally(() => { state.honorsLoad=null; });
    state.honorsLoad=load;
    return load;
  }
  function honors(options) { return loadHonors(options?.force === true); }

  window.NorskCommunity = {init:safe(initialize),mount:safe(mount),startPresence:safe(startPresence),submitResult:safe(submitResult),flush:safe(recover),levelInfo,request:publicRequest,profile:currentProfile,honors};
  window.dispatchEvent(new Event('norskcommunityready'));
})();
