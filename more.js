/* 更多: honors (weekly challenge, daily quests, season badges, trophies, achievements) and the
   lesson playlist. Honors are computed by the community service per learner; artwork is static. */
(() => {
  'use strict';
  if (window.NorskMore) return;
  const SEEN_KEY = 'norsk-honors-seen-v1';
  const TABS = {honors:{title:'荣誉',note:'徽章、奖杯与成就'},playlist:{title:'播放列表',note:'课文原录音随身听'}};
  const DAYS = ['一','二','三','四','五','六','日'];
  const RANKS = {1:'金杯',2:'银杯',3:'铜杯'};
  const state = {deps:{},root:null,tab:'honors',visible:false,honors:null,status:'idle',request:0,dialog:null,revealing:false,queue:[]};
  const $ = (selector,root = document) => root.querySelector(selector);
  const e = value => state.deps.escapeHTML ? state.deps.escapeHTML(value) : String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const art = name => `assets/honors/${name}.webp`;
  const weekArt = (n,perfect = false) => art(`week-${String(n).padStart(2,'0')}${perfect ? '-perfect' : ''}`);
  const pct = (progress,target) => target ? Math.max(0,Math.min(100,Math.round(Number(progress)/Number(target)*100))) : 0;
  const number = value => Number(value || 0).toLocaleString('zh-CN');
  function dayLabel(iso,offset = 0) {
    const [y,m,d] = String(iso || '').split('-').map(Number);
    if (!y) return '';
    const date = new Date(Date.UTC(y,m-1,d+offset));
    return `${date.getUTCMonth()+1}月${date.getUTCDate()}日`;
  }
  const weekRange = start => start ? `${dayLabel(start)} – ${dayLabel(start,6)}` : '';
  const img = (src,alt,cls = '') => `<img class="${cls}" src="${e(src)}" alt="${e(alt)}" loading="lazy" decoding="async" draggable="false">`;

  /* ---------- Data ---------- */
  async function load(force = false) {
    const run = ++state.request;
    let changed = false;
    if (!state.honors) state.status = 'loading';
    try {
      const community = await state.deps.community();
      const honors = await community.honors?.({force});
      if (run !== state.request) return;
      if (!honors || typeof honors !== 'object' || !honors.week) throw new Error('honors unavailable');
      changed = state.honors !== honors || state.status !== 'ready';
      state.honors = honors;
      state.status = 'ready';
    } catch {
      if (run !== state.request) return;
      const status = state.honors ? 'ready' : 'error';
      changed = state.status !== status;
      state.status = status;
    }
    if (changed && state.visible && state.tab === 'honors') render();
    state.deps.setTab && state.visible && state.deps.setTab(state.tab);
  }
  window.addEventListener('norskhonorschange',event => {
    if (event.detail && event.detail.week) { state.honors = event.detail; state.status = 'ready'; }
    if (state.visible && state.tab === 'honors') render();
  });

  /* ---------- Honors page ---------- */
  function ring(progress,target,done) {
    const value = done ? 100 : pct(progress,target), r = 47, length = 2*Math.PI*r;
    return `<svg class="mh-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="${r}" class="mh-ring-track"/><circle cx="50" cy="50" r="${r}" class="mh-ring-value" stroke-dasharray="${length}" stroke-dashoffset="${length*(1-value/100)}"/></svg>`;
  }
  function bar(progress,target,done) {
    return `<div class="mh-bar${done ? ' is-done' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="${Number(target) || 0}" aria-valuenow="${Math.min(Number(progress) || 0,Number(target) || 0)}"><i style="width:${done ? 100 : pct(progress,target)}%"></i></div>`;
  }
  function challengeCard(h) {
    const week = h.week, c = week.challenge || {};
    const today = h.today?.date;
    const days = (week.days || []).map((done,index) => {
      const iso = week.weekStart ? (() => { const [y,m,d] = week.weekStart.split('-').map(Number); const t = new Date(Date.UTC(y,m-1,d+index)); return t.toISOString().slice(0,10); })() : '';
      return `<li class="${done ? 'is-done' : ''}${iso === today ? ' is-today' : ''}${today && iso > today ? ' is-future' : ''}"><span>${DAYS[index]}</span><i aria-label="${done ? '已练习' : '未练习'}"></i></li>`;
    }).join('');
    if (!week.challenge) {
      const pending = Number(h.season?.current ?? week.n) < 1;
      const last = Number(h.season?.weeks) || 20;
      return `<section class="mh-hero" aria-labelledby="mh-week-title">
        <div class="mh-hero-art">${img(weekArt(pending ? 1 : last),'赛季徽章','mh-hero-badge')}</div>
        <div class="mh-hero-body"><p class="mh-kicker">${pending ? '赛季尚未开始' : `${e(last)} 周赛季已结束`}</p>
          <h2 id="mh-week-title">${pending ? '每周一个挪威文化主题' : '本赛季已结束'}</h2>
          <p class="mh-note">${pending ? `赛季将于 ${e(h.season?.start || '')} 开始。` : '已获得的徽章、全勤奖章、奖杯和成就可在下方查看。'}</p>
          <div class="mh-week-row"><ol class="mh-days" aria-label="本周练习天数">${days}</ol>
            <div class="mh-perfect"><span>本周已练 ${(week.days || []).filter(Boolean).length} 天<small>${e(weekRange(week.weekStart))}</small></span></div>
          </div>
        </div>
      </section>`;
    }
    return `<section class="mh-hero" aria-labelledby="mh-week-title">
      <div class="mh-hero-art${c.done ? ' is-done' : ''}">${ring(c.progress,c.target,c.done)}${img(weekArt(week.n),`第 ${week.n} 周徽章 ${c.theme || ''}`,'mh-hero-badge')}</div>
      <div class="mh-hero-body">
        <p class="mh-kicker"><span class="mh-kicker-nb">UKENS UTFORDRING · </span>第 ${e(week.n)} / ${e(h.season?.weeks || 20)} 周 · <span class="mh-nowrap">${e(weekRange(week.weekStart))}</span></p>
        <h2 id="mh-week-title"><span lang="nb">${e(c.theme || '')}</span> ${e(c.themeZh || '')}</h2>
        ${c.note ? `<p class="mh-note">${e(c.note)}</p>` : ''}
        <div class="mh-goal"><span>${e(c.title || '本周挑战')}</span><strong>${c.done ? '已完成' : `${number(Math.min(c.progress,c.target))} / ${number(c.target)}`}</strong></div>
        ${bar(c.progress,c.target,c.done)}
        <div class="mh-week-row"><ol class="mh-days" aria-label="本周练习天数">${days}</ol>
          <div class="mh-perfect${week.perfect ? ' is-earned' : ''}">${img(weekArt(week.n,true),'七天全勤奖章','mh-perfect-img')}<span>${week.perfect ? '本周全勤' : '七天全勤奖章'}<small>${week.perfect ? '已收入荣誉' : `本周已练 ${(week.days || []).filter(Boolean).length} 天`}</small></span></div>
        </div>
      </div>
    </section>`;
  }
  function questRows(quests) {
    return (quests || []).map(q => `<li class="mh-quest${q.done ? ' is-done' : ''}"><span class="mh-check" aria-hidden="true"></span><div><p>${e(q.title)}</p>${bar(q.progress,q.target,q.done)}</div><strong>${q.done ? '完成' : `${number(Math.min(q.progress,q.target))}/${number(q.target)}`}</strong></li>`).join('');
  }
  function seasonGrid(h) {
    return (h.weeks || []).map(w => {
      const c = w.challenge || {};
      const status = w.future ? 'is-future' : c.done ? 'is-earned' : w.n === h.week.n ? 'is-current' : 'is-missed';
      const label = w.future ? '尚未开始' : c.done ? '已获得' : w.n === h.week.n ? '进行中' : '未完成';
      return `<li><button type="button" class="mh-badge ${status}" data-more="badge" data-week="${e(w.n)}" aria-label="第 ${e(w.n)} 周 ${e(c.theme || '')} ${label}">
        <span class="mh-badge-art">${img(weekArt(w.n),'')}${w.perfect ? `<span class="mh-badge-perfect" title="全勤">${img(weekArt(w.n,true),'全勤奖章')}</span>` : ''}</span>
        <span class="mh-badge-no">第 ${e(w.n)} 周</span><span class="mh-badge-name" lang="nb">${e(c.theme || '')}</span>
      </button></li>`;
    }).join('');
  }
  function trophyShelf(h) {
    const trophies = [...(h.trophies || [])].sort((a,b) => String(b.weekStart).localeCompare(String(a.weekStart)));
    if (!trophies.length) return '<p class="mh-empty">每周排行榜前三名会在这里留下一座奖杯。周一结算上一周。</p>';
    return `<ol class="mh-trophies">${trophies.map(t => `<li class="mh-trophy rank-${e(t.rank)}">${img(art(`trophy-${t.rank}`),RANKS[t.rank] || '奖杯')}<strong>第 ${e(t.rank)} 名 · ${RANKS[t.rank] || ''}</strong><span>${e(weekRange(t.weekStart))}</span><small>${number(t.xp)} XP</small></li>`).join('')}</ol>`;
  }
  function achievementGrid(h) {
    return (h.achievements || []).map(a => `<li class="mh-achievement${a.earned ? ' is-earned' : ''}">
      <span class="mh-achievement-art">${img(art(`achievement-${a.id}`),'')}</span>
      <div><strong>${e(a.title)}</strong><p>${e(a.description || '')}</p>${a.earned ? `<small>${a.earnedAt ? `${e(String(a.earnedAt).slice(0,10))} 获得` : '已获得'}</small>` : `${bar(a.progress,a.target,false)}<small>${number(Math.min(a.progress,a.target))} / ${number(a.target)}</small>`}</div>
    </li>`).join('');
  }
  function honorsMarkup() {
    if (state.status === 'error') return `<div class="mh-offline"><p>荣誉需要连接学习排行榜服务，暂时无法载入。</p><button type="button" class="mh-button" data-more="retry">重新载入</button></div>`;
    if (!state.honors) return '<div class="rd-empty" role="status"><span class="loader"></span><p>正在载入荣誉…</p></div>';
    const h = state.honors;
    const earned = (h.weeks || []).filter(w => w.challenge?.done).length;
    const perfect = (h.weeks || []).filter(w => w.perfect).length;
    const achievements = (h.achievements || []).filter(a => a.earned).length;
    return `${challengeCard(h)}
      <div class="mh-split">
        <section class="mh-panel" aria-labelledby="mh-quests-title"><div class="mh-panel-head"><h3 id="mh-quests-title">今日任务</h3><span>${e(dayLabel(h.today?.date))} · 每天北京时间零点更新</span></div><ol class="mh-quests">${questRows(h.today?.quests)}</ol></section>
        <section class="mh-panel mh-stats" aria-label="荣誉统计">
          <div><strong>${earned}<small>/${e(h.season?.weeks || 20)}</small></strong><span>赛季徽章</span></div>
          <div><strong>${perfect}</strong><span>全勤奖章</span></div>
          <div><strong>${(h.trophies || []).length}</strong><span>周榜奖杯</span></div>
          <div><strong>${achievements}<small>/${(h.achievements || []).length}</small></strong><span>成就</span></div>
          <div class="mh-streak"><strong>${number(h.streak?.current)}<small> 天</small></strong><span>连续学习 · 最长 ${number(h.streak?.best)} 天</span></div>
        </section>
      </div>
      <section class="mh-section" aria-labelledby="mh-season-title"><div class="mh-panel-head"><h3 id="mh-season-title">赛季徽章</h3><span>20 周，每周一个挪威文化主题；完成当周挑战即获得徽章，七天都练习再得全勤奖章</span></div><ol class="mh-season">${seasonGrid(h)}</ol></section>
      <section class="mh-section" aria-labelledby="mh-trophy-title"><div class="mh-panel-head"><h3 id="mh-trophy-title">奖杯柜</h3><span>每周排行榜前三名</span></div>${trophyShelf(h)}</section>
      <section class="mh-section" aria-labelledby="mh-ach-title"><div class="mh-panel-head"><h3 id="mh-ach-title">成就</h3><span>长期积累的里程碑</span></div><ol class="mh-achievements">${achievementGrid(h)}</ol></section>`;
  }
  function tabsMarkup() {
    return `<div class="mh-tabs" role="tablist" aria-label="更多">${Object.entries(TABS).map(([key,tab]) => `<button type="button" role="tab" data-more="tab" data-tab="${key}" aria-selected="${state.tab === key}">${tab.title}</button>`).join('')}</div>`;
  }
  function render() {
    if (!state.root || !state.visible) return;
    if (state.tab === 'playlist') {
      state.root.innerHTML = `<div class="mh-app">${tabsMarkup()}<div class="mh-playlist"></div></div>`;
      state.deps.reader().then(reader => { const slot = $('.mh-playlist',state.root); if (slot && state.tab === 'playlist') reader.renderPlaylistPage(slot); }).catch(() => {
        const slot = $('.mh-playlist',state.root);
        if (slot) slot.innerHTML = '<div class="mh-offline"><p>播放列表暂时无法载入，请检查网络后重试。</p></div>';
      });
      return;
    }
    const scroll = window.scrollY;
    state.root.innerHTML = `<div class="mh-app">${tabsMarkup()}<div class="mh-honors">${honorsMarkup()}</div></div>`;
    if (Math.abs(window.scrollY-scroll) > 2) window.scrollTo(0,scroll);
  }

  /* ---------- Badge detail ---------- */
  function openBadge(n) {
    const h = state.honors, w = h?.weeks?.find(item => String(item.n) === String(n));
    if (!w) return;
    const c = w.challenge || {};
    const current = w.n === h.week.n ? h.week.challenge : null;
    const dialog = ensureDialog();
    dialog.innerHTML = `<div class="mh-dialog-card"><button type="button" class="rd-pop-close mh-dialog-close" data-more="dialog-close" aria-label="关闭"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      <div class="mh-dialog-art${c.done ? ' is-earned' : w.future ? ' is-future' : ''}">${img(weekArt(w.n),c.theme || '')}</div>
      <p class="mh-kicker">第 ${e(w.n)} 周 · ${e(weekRange(w.weekStart))}</p>
      <h3><span lang="nb">${e(c.theme || '')}</span> ${e(c.themeZh || '')}</h3>
      ${(current?.note || c.note) ? `<p class="mh-note">${e(current?.note || c.note)}</p>` : ''}
      <p class="mh-dialog-goal">${w.future ? '这一周还没开始，届时挑战是：' : '挑战：'}${e(c.title || '')}</p>
      ${current && !current.done ? `${bar(current.progress,current.target,false)}<p class="mh-dialog-progress">${number(current.progress)} / ${number(current.target)}</p>` : `<p class="mh-dialog-status">${c.done ? '已获得这枚徽章' : w.future ? '尚未开始' : '这一周的挑战没有完成'}${w.perfect ? ' · 本周全勤' : ''}</p>`}
    </div>`;
    dialog.setAttribute('aria-label',`第 ${w.n} 周徽章 ${c.theme || ''}`.trim());
    dialog.showModal?.() ?? dialog.setAttribute('open','');
  }
  function ensureDialog() {
    if (state.dialog?.isConnected) return state.dialog;
    const dialog = document.createElement('dialog');
    dialog.className = 'mh-dialog';
    dialog.addEventListener('click',event => { if (event.target === dialog || event.target.closest('[data-more="dialog-close"]')) dialog.close?.(); });
    document.body.append(dialog);
    state.dialog = dialog;
    return dialog;
  }

  /* ---------- Revealing new honors, one at a time ---------- */
  function honorKeys(h) {
    const keys = [];
    for (const w of h?.weeks || []) {
      if (w.challenge?.done) keys.push({key:`week-${w.n}`,image:weekArt(w.n),kicker:`第 ${w.n} 周挑战完成`,title:`${w.challenge.theme || ''} ${w.challenge.themeZh || ''}`.trim(),text:'赛季徽章已收入荣誉。'});
      if (w.perfect) keys.push({key:`perfect-${w.n}`,image:weekArt(w.n,true),kicker:'七天全勤',title:`第 ${w.n} 周全勤奖章`,text:'这一周每天都练习了。'});
    }
    for (const t of h?.trophies || []) keys.push({key:`trophy-${t.weekStart}`,image:art(`trophy-${t.rank}`),kicker:'周榜奖杯',title:`第 ${t.rank} 名 · ${RANKS[t.rank] || ''}`,text:weekRange(t.weekStart)});
    for (const a of h?.achievements || []) if (a.earned) keys.push({key:`achievement-${a.id}`,image:art(`achievement-${a.id}`),kicker:'成就',title:a.title,text:a.description || ''});
    return keys;
  }
  function reveal(h) {
    if (!h || !h.week) return;
    let seen;
    try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || 'null'); } catch { return; }
    const all = honorKeys(h);
    // The first visit records what is already earned without replaying it.
    if (!Array.isArray(seen)) { try { localStorage.setItem(SEEN_KEY,JSON.stringify(all.map(item => item.key))); } catch {} return; }
    const fresh = all.filter(item => !seen.includes(item.key) && !state.queue.some(queued => queued.key === item.key));
    if (!fresh.length) return;
    try { localStorage.setItem(SEEN_KEY,JSON.stringify([...seen,...fresh.map(item => item.key)].slice(-400))); } catch {}
    state.queue.push(...fresh);
    if (!state.revealing) nextReveal();
  }
  function nextReveal() {
    // Keep new honors queued while the multiplayer dialog owns the screen and focus.
    if (window.NorskDuel?.isOpen?.()) { state.revealing = false; return; }
    const item = state.queue.shift();
    if (!item || !document.body) { state.revealing = false; return; }
    state.revealing = true;
    const layer = document.createElement('div');
    layer.className = 'mh-reveal';
    layer.setAttribute('role','dialog');
    layer.setAttribute('aria-modal','true');
    layer.setAttribute('aria-label',item.kicker);
    layer.innerHTML = `<div class="mh-reveal-card"><div class="mh-reveal-art">${img(item.image,item.title)}</div><p class="mh-kicker">${e(item.kicker)}</p><h3>${e(item.title)}</h3>${item.text ? `<p>${e(item.text)}</p>` : ''}<button type="button" class="mh-reveal-ok">收下</button></div>`;
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      layer.classList.remove('is-open');
      setTimeout(() => { layer.remove(); nextReveal(); },window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 420);
    };
    layer.addEventListener('click',event => { if (event.target === layer || event.target.closest('.mh-reveal-ok')) close(); });
    layer.addEventListener('keydown',event => { if (event.key === 'Escape') close(); });
    document.body.append(layer);
    const image = layer.querySelector('img');
    const open = () => requestAnimationFrame(() => { layer.classList.add('is-open'); layer.querySelector('.mh-reveal-ok')?.focus({preventScroll:true}); window.NorskCelebrate?.motes?.(layer.querySelector('.mh-reveal-art')); });
    if (image.complete) open(); else { image.addEventListener('load',open,{once:true}); image.addEventListener('error',open,{once:true}); }
  }
  window.addEventListener('norskduelclose',() => { if (!state.revealing) nextReveal(); });

  /* ---------- Shell ---------- */
  function renderTOC(tab = state.tab) {
    const h = state.honors;
    const earned = h ? (h.weeks || []).filter(w => w.challenge?.done).length+(h.trophies || []).length : 0;
    const counts = {honors:earned ? String(earned) : '',playlist:''};
    return Object.entries(TABS).map(([key,item],index) => `<button class="toc-basic ${tab === key ? 'selected' : ''}" data-more="tab" data-tab="${key}" ${tab === key ? 'aria-current="true"' : ''}><span class="category-index">${String(index+1).padStart(2,'0')}</span><span>${item.title}<small class="category-level">${item.note}</small></span><span class="category-count">${e(counts[key])}</span></button>`).join('');
  }
  function onClick(event) {
    const target = event.target.closest('[data-more]');
    if (!target) return;
    const action = target.dataset.more;
    if (action === 'tab') {
      const inPage = !!target.closest('.mh-tabs');
      show(target.dataset.tab); state.deps.setTab?.(state.tab);
      if (inPage) state.root?.querySelector(`.mh-tabs [data-tab="${state.tab}"]`)?.focus({preventScroll:true});
      document.querySelector('#sidebar.open') && document.querySelector('#close-sidebar')?.click();
      return;
    }
    if (!state.root?.contains(target)) return;
    if (action === 'retry') { state.status = 'loading'; render(); load(true); }
    if (action === 'badge') openBadge(target.dataset.week);
    if (action === 'duel') state.deps.openDuel?.();
  }
  function init(deps) {
    state.deps = {...state.deps,...deps};
    state.root = deps.root || state.root;
    if (state.initialized) return;
    state.initialized = true;
    document.addEventListener('click',onClick);
    // The in-page tabs behave as a tab list: arrows, Home and End switch between 荣誉 and 播放列表.
    document.addEventListener('keydown',event => {
      const tab = event.target.closest?.('.mh-tabs [role="tab"]');
      if (!tab || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')], at = tabs.indexOf(tab);
      const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(at+(event.key === 'ArrowRight' ? 1 : -1)+tabs.length) % tabs.length];
      event.preventDefault();
      if (next && next !== tab) next.click();
    });
  }
  function show(tab = state.tab) {
    state.tab = TABS[tab] ? tab : 'honors';
    state.visible = true;
    render();
    if (state.tab === 'honors') load();
  }
  function hide() { state.visible = false; state.dialog?.close?.(); }

  window.NorskMore = {init,show,hide,renderTOC,reveal};
  window.dispatchEvent(new Event('norskmoreready'));
})();
