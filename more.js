/* 更多: a small shelf of tools — interview practice, the lesson playlist and the honors record.
   Honors are computed by the community service per learner; artwork is static. */
(() => {
  'use strict';
  if (window.NorskMore) return;
  const SEEN_KEY = 'norsk-honors-seen-v1';
  // Only the honors pop-up shows on the practice page, so only it follows the interface language (docs/i18n.md).
  const L10N = window.NorskI18n || {lang:'zh',english:false,t:(text,vars) => vars ? text.replace(/\{(\w+)\}/g,(match,key) => key in vars ? String(vars[key]) : match) : text,gloss:item => String(item?.meaning ?? item?.zh ?? ''),data:() => Promise.resolve(null),name:nickname => String(nickname ?? ''),set() {}};
  const tx = L10N.t;
  const EN_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const TOOLS = {
    interview:{title:'A-team 面试',note:'15 个常见问题，挑几题开口练',meta:'15 题',icon:'<path d="M20 11a8 8 0 0 1-8 8H5l-4 3 1-7a8 8 0 1 1 18-4Z"/><path d="M6 10h9M6 14h6"/>'},
    playlist:{title:'播放列表',note:'把课文录音排成清单，锁屏也能听',meta:'随身听',icon:'<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="2" y="12" width="5" height="9" rx="2"/><rect x="17" y="12" width="5" height="9" rx="2"/>'},
    honors:{title:'荣誉',note:'赛季徽章、全勤奖章、奖杯和长期成就',meta:'20 周赛季',icon:'<circle cx="12" cy="9" r="6"/><path d="m8 14-2 9 6-3 6 3-2-9m-6-5 1.4 1.5L15 7"/>'},
    notes:{title:'笔记',note:'我的手写与划线，和大家分享的笔记广场',meta:'笔记广场',icon:'<path d="M6 3.5h9.5L19 7v13.5H6z"/><path d="M15 3.5V7.5h4M9 11h7M9 14.5h7M9 18h4"/>'},
    verbs:{title:'动词本',note:'课本和课件里的全部动词，四种形态练到会',feature:true,icon:'<path d="M4 6.5h16M4 12h11M4 17.5h7"/><path d="m16.5 15 3 2.5-3 2.5"/>'}
  };
  const DAYS = ['一','二','三','四','五','六','日'];
  const RANKS = {1:'金杯',2:'银杯',3:'铜杯'};
  const state = {deps:{},root:null,tab:'home',visible:false,honors:null,status:'idle',request:0,makeupBusy:false,dialog:null,revealing:false,queue:[],interview:null,interviewLoading:null,verbs:null,verbsLoading:null,renderRun:0};
  const $ = (selector,root = document) => root.querySelector(selector);
  const e = value => state.deps.escapeHTML ? state.deps.escapeHTML(value) : String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const art = name => `assets/honors/${name}.webp`;
  const weekArt = (n,perfect = false) => art(`week-${String(n).padStart(2,'0')}${perfect ? '-perfect' : ''}`);
  // One-day event medals (双11): art is named by the event id without its year.
  const eventArt = (event,gold = false) => art(`event-${String(event.id).replace(/-\d{4}$/,'')}${gold ? '-gold' : ''}`);
  const pct = (progress,target) => target ? Math.max(0,Math.min(100,Math.round(Number(progress)/Number(target)*100))) : 0;
  const number = value => Number(value || 0).toLocaleString('zh-CN');
  function dayLabel(iso,offset = 0) {
    const [y,m,d] = String(iso || '').split('-').map(Number);
    if (!y) return '';
    const date = new Date(Date.UTC(y,m-1,d+offset));
    return L10N.english ? `${EN_MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}` : `${date.getUTCMonth()+1}月${date.getUTCDate()}日`;
  }
  const weekRange = start => start ? `${dayLabel(start)} – ${dayLabel(start,6)}` : '';
  const img = (src,alt,cls = '',eager = false) => `<img class="${cls}" src="${e(src)}" alt="${e(alt)}"${eager ? '' : ' loading="lazy"'} decoding="async" draggable="false">`;

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
    if (changed && state.visible) {
      if (state.tab === 'honors') render();
      else if (state.tab === 'home') updateWeek();
    }
    state.deps.setTab && state.visible && state.deps.setTab(state.tab);
  }
  window.addEventListener('norskhonorschange',event => {
    if (event.detail && event.detail.week) { state.honors = event.detail; state.status = 'ready'; }
    if (!state.visible) return;
    if (state.tab === 'honors') render();
    else if (state.tab === 'home') updateWeek();
  });

  /* ---------- The shelf ---------- */
  function weekMarkup() {
    const week = state.honors?.week, c = week?.challenge;
    if (!c) return '';
    const value = c.done ? 100 : pct(c.progress,c.target);
    return `<button type="button" class="mh-week${c.done ? ' is-done' : ''}" data-more="tab" data-tab="honors">
      ${img(weekArt(week.n),'','mh-week-art')}
      <span class="mh-week-body"><small>本周挑战 · 第 ${e(week.n)} 周</small><strong><span lang="nb">${e(c.theme || '')}</span> ${e(c.themeZh || '')}</strong><span class="mh-week-progress"><span class="mh-week-bar" aria-hidden="true"><i style="width:${value}%"></i></span><b>${c.done ? '完成' : `${number(Math.min(c.progress,c.target))}/${number(c.target)}`}</b></span></span>
      <svg class="mh-tool-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
    </button>`;
  }
  function updateWeek() {
    const slot = state.root && $('#mh-hub-week',state.root);
    if (slot) slot.innerHTML = weekMarkup();
  }
  function hubMarkup() {
    return `<div class="mh-app"><header class="mh-hub"><p class="mh-kicker">MER · 更多</p><h2 tabindex="-1">学习工具</h2><p class="mh-hub-note">动词本、面试练习、随身听、读书笔记和这一季的荣誉，都在这里。</p></header>
      ${featureMarkup()}<div class="mh-tools">${Object.entries(TOOLS).filter(([,tool]) => !tool.feature).map(([key,tool]) => `<button type="button" class="mh-tool is-${key}" data-more="tab" data-tab="${key}"><span class="mh-tool-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${tool.icon}</svg></span><span class="mh-tool-text"><strong>${tool.title}</strong><span>${tool.note}</span></span><span class="mh-tool-meta">${tool.meta}</span><svg class="mh-tool-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button>`).join('')}</div>
      <div id="mh-hub-week">${weekMarkup()}</div></div>`;
  }
  // The verb book is a daily habit, so it sits above the shelf with today's numbers instead of in it.
  function featureMarkup() {
    const tool = TOOLS.verbs;
    return `<button type="button" class="mh-feature is-verbs" data-more="tab" data-tab="verbs"><span class="mh-tool-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${tool.icon}</svg></span><span class="mh-tool-text"><strong>${tool.title}</strong><span>${tool.note}</span></span><span class="mh-feature-status" id="mh-verbs-status">${verbsStatus()}</span><svg class="mh-tool-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button>`;
  }
  function verbsStatus() {
    const summary = state.verbsModule?.shelfSummary?.();
    if (!summary) return '';
    if (!summary.started) return '从第 1 章开始';
    return `<span>${summary.due ? `今天复习 <b>${summary.due}</b> 个` : '今天的复习已完成'}</span><small>已掌握 ${summary.mastered}</small>`;
  }
  function ensureVerbs() {
    if (state.verbs) return Promise.resolve(state.verbs);
    if (!state.verbsLoading) {
      state.verbsLoading = import(`./verbs.mjs${state.deps.version ? `?v=${encodeURIComponent(state.deps.version)}` : ''}`).then(module => {
        state.verbsModule = module;
        state.verbs = module.createVerbs({version:state.deps.version,escapeHTML:state.deps.escapeHTML,icon:state.deps.icon,notify:state.deps.notify,pronounce:state.deps.pronounce,prefetch:state.deps.prefetch,stopAudio:() => state.deps.stopAudio?.()});
        return state.verbs;
      }).catch(error => { state.verbsLoading = null; throw error; });
    }
    return state.verbsLoading;
  }
  function backBar() {
    return `<div class="mh-tool-bar"><button type="button" class="mh-back" data-more="home"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg><span>更多</span></button></div>`;
  }

  /* ---------- Honors page ---------- */
  function ring(progress,target,done) {
    const value = done ? 100 : pct(progress,target), r = 47, length = 2*Math.PI*r;
    return `<svg class="mh-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="${r}" class="mh-ring-track"/><circle cx="50" cy="50" r="${r}" class="mh-ring-value" stroke-dasharray="${length}" stroke-dashoffset="${length*(1-value/100)}"/></svg>`;
  }
  function bar(progress,target,done) {
    return `<div class="mh-bar${done ? ' is-done' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="${Number(target) || 0}" aria-valuenow="${Math.min(Number(progress) || 0,Number(target) || 0)}"><i style="width:${done ? 100 : pct(progress,target)}%"></i></div>`;
  }
  function makeupMarkup(h) {
    const makeup = h.makeup;
    if (makeup?.used) return `<p class="mh-makeup is-used" tabindex="-1">本周的补打卡用在了 ${e(dayLabel(makeup.used))}，下周一会有新的机会。</p>`;
    if (!makeup?.days?.length) return '';
    return `<div class="mh-makeup" tabindex="-1"><p>有漏掉的打卡？每周可以补一天，连续天数和全勤都算。</p><div class="mh-makeup-days">${makeup.days.map(day => `<button type="button" class="mh-button" data-more="makeup" data-day="${e(day)}"${state.makeupBusy ? ' disabled' : ''}>补 ${e(dayLabel(day))}</button>`).join('')}</div></div>`;
  }
  async function claimMakeup(day) {
    if (state.makeupBusy) return;
    state.makeupBusy = true;
    render();
    try {
      const community = await state.deps.community();
      await community.claimMakeup(day);
      state.deps.notify?.(`已补上 ${dayLabel(day)} 的打卡。`);
    } catch (error) {
      state.deps.notify?.(error?.code === 'makeup_used' ? '本周的补打卡机会已经用过了。' : error?.code === 'makeup_unavailable' ? '这一天已经不能补了。' : '补打卡没有成功，请检查网络后重试。');
      load(true);
    }
    state.makeupBusy = false;
    if (state.visible && state.tab === 'honors') { render(); $('.mh-makeup',state.root)?.focus({preventScroll:true}); }
  }
  function challengeCard(h) {
    const week = h.week, c = week.challenge || {};
    const today = h.today?.date;
    const days = (week.days || []).map((done,index) => {
      const iso = week.weekStart ? (() => { const [y,m,d] = week.weekStart.split('-').map(Number); const t = new Date(Date.UTC(y,m-1,d+index)); return t.toISOString().slice(0,10); })() : '';
      const madeUp = week.makeups?.[index];
      return `<li class="${done ? 'is-done' : ''}${madeUp ? ' is-makeup' : ''}${iso === today ? ' is-today' : ''}${today && iso > today ? ' is-future' : ''}"><span>${DAYS[index]}</span><i role="img" aria-label="${madeUp ? '已补打卡' : done ? '已练习' : '未练习'}"></i></li>`;
    }).join('');
    if (!week.challenge) {
      const pending = Number(h.season?.current ?? week.n) < 1;
      const last = Number(h.season?.weeks) || 20;
      return `<section class="mh-hero" aria-labelledby="mh-week-title">
        <div class="mh-hero-art">${img(weekArt(pending ? 1 : last),'赛季徽章','mh-hero-badge')}</div>
        <div class="mh-hero-body"><p class="mh-kicker">${pending ? '赛季尚未开始' : `${e(last)} 周赛季已结束`}</p>
          <h2 id="mh-week-title" tabindex="-1">${pending ? '每周一个挪威文化主题' : '本赛季已结束'}</h2>
          <p class="mh-note">${pending ? `赛季将于 ${e(h.season?.start || '')} 开始。` : '已获得的徽章、全勤奖章、奖杯和成就可在下方查看。'}</p>
          <div class="mh-week-row"><ol class="mh-days" aria-label="本周练习天数">${days}</ol>
            <div class="mh-perfect"><span>本周已练 ${(week.days || []).filter(Boolean).length} 天<small>${e(weekRange(week.weekStart))}</small></span></div>
          </div>
          ${makeupMarkup(h)}
        </div>
      </section>`;
    }
    return `<section class="mh-hero" aria-labelledby="mh-week-title">
      <div class="mh-hero-art${c.done ? ' is-done' : ''}">${ring(c.progress,c.target,c.done)}${img(weekArt(week.n),`第 ${week.n} 周徽章 ${c.theme || ''}`,'mh-hero-badge')}</div>
      <div class="mh-hero-body">
        <p class="mh-kicker"><span class="mh-kicker-nb">UKENS UTFORDRING · </span>第 ${e(week.n)} / ${e(h.season?.weeks || 20)} 周 · <span class="mh-nowrap">${e(weekRange(week.weekStart))}</span></p>
        <h2 id="mh-week-title" tabindex="-1"><span lang="nb">${e(c.theme || '')}</span> ${e(c.themeZh || '')}</h2>
        ${c.note ? `<p class="mh-note">${e(c.note)}</p>` : ''}
        <div class="mh-goal"><span>${e(c.title || '本周挑战')}</span><strong>${c.done ? '已完成' : `${number(Math.min(c.progress,c.target))} / ${number(c.target)}`}</strong></div>
        ${bar(c.progress,c.target,c.done)}
        <div class="mh-week-row"><ol class="mh-days" aria-label="本周练习天数">${days}</ol>
          ${week.perfect
            ? `<button type="button" class="mh-perfect is-earned" data-more="jump" data-target="mh-medals-title">${img(weekArt(week.n,true),'七天全勤奖章','mh-perfect-img')}<span>本周全勤<small>查看全勤奖章</small></span></button>`
            : `<div class="mh-perfect">${img(weekArt(week.n,true),'七天全勤奖章','mh-perfect-img')}<span>七天全勤奖章<small>本周已练 ${(week.days || []).filter(Boolean).length} 天</small></span></div>`}
        </div>
        ${makeupMarkup(h)}
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
      return `<li><button type="button" class="mh-badge ${status}" data-more="badge" data-week="${e(w.n)}" aria-label="第 ${e(w.n)} 周 ${e(c.theme || '')} ${label}${w.perfect ? '，已获全勤奖章' : ''}">
        <span class="mh-badge-art">${img(weekArt(w.n),'')}${w.perfect ? `<span class="mh-badge-perfect" title="全勤">${img(weekArt(w.n,true),'')}</span>` : ''}</span>
        <span class="mh-badge-no">第 ${e(w.n)} 周</span><span class="mh-badge-name" lang="nb">${e(c.theme || '')}</span>
      </button></li>`;
    }).join('');
  }
  function medalShelf(h) {
    const weeks = (h.weeks || []).filter(w => w.perfect).reverse();
    if (!weeks.length) return '<p class="mh-empty">周一到周日七天都打卡，这里就会多一枚奖章。漏掉的一天可以用补打卡补上。</p>';
    return `<ol class="mh-medals">${weeks.map(w => `<li><button type="button" class="mh-medal" data-more="badge" data-week="${e(w.n)}" aria-label="第 ${e(w.n)} 周全勤奖章 ${e(w.challenge?.theme || '')}">${img(weekArt(w.n,true),'')}<small>第 ${e(w.n)} 周</small><strong lang="nb">${e(w.challenge?.theme || '')}</strong></button></li>`).join('')}</ol>`;
  }
  // 纪念章: medals of one-day events. Earned ones stay for good with the day's whole-site record;
  // on the event day itself the medal waits here, unlit, with today's progress.
  function eventShelf(h) {
    const events = (h.events || []).filter(event => event.earned || event.active).reverse();
    return `<ol class="mh-events">${events.map(event => {
      const goal = event.earned ? event.words : event.xp;
      const line = event.gold ? '金色纪念章' : event.earned ? (event.active ? `再练 ${number(Math.max(0,goal.target-goal.progress))} 个词升级金色` : '纪念章') : `今天获得 ${number(goal.target)} XP 即得`;
      const site = `全站 ${number(event.site?.people)} 人 · ${number(event.site?.progress)} 词`;
      return `<li class="mh-event${event.earned ? ' is-earned' : ''}${event.gold ? ' is-gold' : ''}">${img(eventArt(event,event.gold),`${event.theme || ''} 纪念章`)}
        <div><small>${e(dayLabel(event.day))} · ${e(event.title || '')}</small><strong lang="nb">${e(event.theme || '')}</strong><p>${e(line)}</p>
        ${event.gold || (event.earned && !event.active) ? '' : `${bar(goal.progress,goal.target,false)}<span class="mh-event-count">${number(Math.min(goal.progress,goal.target))} / ${number(goal.target)}${event.earned ? ' 词' : ' XP'}</span>`}
        <span class="mh-event-site">${e(site)}${event.site?.done ? ' · 全站目标达成' : event.active ? ` / ${number(event.site?.target)}` : ''}</span></div></li>`;
    }).join('')}</ol>`;
  }
  function trophyShelf(h) {
    const trophies = [...(h.trophies || [])].sort((a,b) => String(b.weekStart).localeCompare(String(a.weekStart)));
    if (!trophies.length) return '<p class="mh-empty">每周排行榜前三名会在这里留下一座奖杯。周一结算上一周。</p>';
    return `<ol class="mh-trophies">${trophies.map(t => `<li class="mh-trophy rank-${e(t.rank)}">${img(art(`trophy-${t.rank}`),RANKS[t.rank] || '奖杯')}<strong>第 ${e(t.rank)} 名 · ${RANKS[t.rank] || ''}</strong><span>${e(weekRange(t.weekStart))}</span><small>${number(t.xp)} XP</small></li>`).join('')}</ol>`;
  }
  function achievementGrid(h) {
    return [...(h.achievements || [])].sort((a,b) => Number(Boolean(b.earned))-Number(Boolean(a.earned))).map(a => `<li class="mh-achievement${a.earned ? ' is-earned' : ''}">
      <span class="mh-achievement-art">${img(art(`achievement-${a.id}`),'')}</span>
      <div><strong>${e(a.title)}</strong><p>${e(a.description || '')}</p>${a.earned ? `<small>${a.earnedAt ? `${e(dayLabel(a.earnedAt))} 获得` : '已获得'}</small>` : `${bar(a.progress,a.target,false)}<small>${number(Math.min(a.progress,a.target))} / ${number(a.target)}</small>`}</div>
    </li>`).join('');
  }
  function honorsMarkup() {
    if (state.status === 'error') return `<div class="mh-offline"><p>荣誉需要连接学习排行榜服务，暂时无法载入。</p><button type="button" class="mh-button" data-more="retry">重新载入</button></div>`;
    if (!state.honors) return '<div class="rd-empty" role="status"><span class="loader"></span><p>正在载入荣誉…</p></div>';
    const h = state.honors;
    const earned = (h.weeks || []).filter(w => w.challenge?.done).length;
    const perfect = (h.weeks || []).filter(w => w.perfect).length;
    const achievements = (h.achievements || []).filter(a => a.earned).length;
    const stat = (target,value,label) => `<button type="button" data-more="jump" data-target="${target}"><strong>${value}</strong><span>${label}</span></button>`;
    const eventSection = (h.events || []).some(event => event.earned || event.active) ? `<section class="mh-section" aria-labelledby="mh-events-title"><div class="mh-panel-head"><h3 id="mh-events-title" tabindex="-1">纪念章</h3><span>特别的日子限定一天，拿到就永久收藏</span></div>${eventShelf(h)}</section>` : '';
    const eventToday = (h.events || []).some(event => event.active);
    return `${challengeCard(h)}${eventToday ? eventSection : ''}
      <div class="mh-split">
        <section class="mh-panel" aria-labelledby="mh-quests-title"><div class="mh-panel-head"><h3 id="mh-quests-title">今日任务</h3><span>${e(dayLabel(h.today?.date))} · 每天北京时间零点更新</span></div><ol class="mh-quests">${questRows(h.today?.quests)}</ol></section>
        <section class="mh-panel mh-stats" aria-label="荣誉统计">
          ${stat('mh-season-title',`${earned}<small>/${e(h.season?.weeks || 20)}</small>`,'赛季徽章')}
          ${stat('mh-medals-title',`${perfect}<small>/${e(h.season?.weeks || 20)}</small>`,'全勤奖章')}
          ${stat('mh-trophy-title',(h.trophies || []).length,'周榜奖杯')}
          ${stat('mh-ach-title',`${achievements}<small>/${(h.achievements || []).length}</small>`,'成就')}
          <div class="mh-streak"><strong>${number(h.streak?.current)}<small> 天</small></strong><span>连续学习 · 最长 ${number(h.streak?.best)} 天</span></div>
        </section>
      </div>
      <section class="mh-section" aria-labelledby="mh-season-title"><div class="mh-panel-head"><h3 id="mh-season-title" tabindex="-1">赛季徽章</h3><span>20 周，每周一个挪威文化主题；完成当周挑战即获得徽章</span></div><ol class="mh-season">${seasonGrid(h)}</ol></section>
      <section class="mh-section" aria-labelledby="mh-medals-title"><div class="mh-panel-head"><h3 id="mh-medals-title" tabindex="-1">全勤奖章</h3><span>周一到周日七天都打卡，每周一枚</span></div>${medalShelf(h)}</section>
      ${eventToday ? '' : eventSection}
      <section class="mh-section" aria-labelledby="mh-trophy-title"><div class="mh-panel-head"><h3 id="mh-trophy-title" tabindex="-1">奖杯柜</h3><span>每周排行榜前三名</span></div>${trophyShelf(h)}</section>
      <section class="mh-section" aria-labelledby="mh-ach-title"><div class="mh-panel-head"><h3 id="mh-ach-title" tabindex="-1">成就</h3><span>长期积累的里程碑</span></div><ol class="mh-achievements">${achievementGrid(h)}</ol></section>`;
  }

  /* ---------- Render ---------- */
  // The interview module is loaded once and shared by the shelf's picker and its own page.
  function ensureInterview() {
    if (state.interview) return Promise.resolve(state.interview);
    if (!state.interviewLoading) {
      state.interviewLoading = import(`./interview.mjs${state.deps.version ? `?v=${encodeURIComponent(state.deps.version)}` : ''}`).then(module => {
        state.interview = module.createInterview({version:state.deps.version,stopAudio:() => state.deps.stopAudio?.(),onExit:closeInterview,onStart:openInterviewSession});
        return state.interview;
      }).catch(error => { state.interviewLoading = null; throw error; });
    }
    return state.interviewLoading;
  }
  function pickerLayer() {
    let layer = document.getElementById?.('mh-interview-picker');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'mh-interview-picker';
      layer.className = 'mh-interview-picker';
      document.body.append(layer);
    }
    return layer;
  }
  // The picker floats over the shelf, the way practice opens its range dialog over the mode cards.
  function openPicker() {
    ensureInterview().then(interview => {
      if (!state.visible || state.tab !== 'home') return;
      interview.openPicker();
      interview.mount(pickerLayer());
    }).catch(() => state.deps.notify?.('面试暂时无法载入，请检查网络后重试。'));
  }
  function closeInterview() {
    const layer = document.getElementById?.('mh-interview-picker');
    show('home');
    state.deps.setTab?.('home');
    layer?.remove();
    state.root?.querySelector('.mh-tools [data-tab="interview"]')?.focus?.({preventScroll:true});
  }
  function openInterviewSession() {
    show('interview');
    state.deps.setTab?.('interview');
    document.getElementById?.('mh-interview-picker')?.remove();
  }
  function render() {
    if (!state.root || !state.visible) return;
    const run = ++state.renderRun;
    if (state.tab !== 'interview') state.interview?.unmount();
    if (state.tab !== 'verbs') state.verbs?.unmount();
    if (state.tab === 'home') {
      state.root.innerHTML = hubMarkup();
      ensureVerbs().then(() => { const slot = document.getElementById?.('mh-verbs-status'); if (slot && run === state.renderRun) slot.innerHTML = verbsStatus(); }).catch(() => {});
      return;
    }
    if (state.tab === 'verbs') {
      // The verb book draws its own way back: 更多 on its pages, 结束 inside a practice round.
      state.root.innerHTML = `<div class="mh-app"><div class="mh-verbs"></div></div>`;
      ensureVerbs().then(verbs => { const slot = $('.mh-verbs',state.root); if (run === state.renderRun && slot && state.visible && state.tab === 'verbs') return verbs.mount(slot); }).catch(() => {
        const slot = $('.mh-verbs',state.root);
        if (run === state.renderRun && slot && state.visible && state.tab === 'verbs') slot.innerHTML = '<div class="mh-offline"><p>动词本暂时无法载入，请检查网络后重试。</p></div>';
      });
      return;
    }
    if (state.tab === 'interview') {
      // The session bar carries its own 结束, as practice does, so the page needs no second way back.
      state.root.innerHTML = `<div class="mh-app"><div class="mh-interview" id="mh-panel-interview"></div></div>`;
      const mount = () => { const slot = $('.mh-interview',state.root); if (run === state.renderRun && slot && state.visible && state.tab === 'interview') state.interview.mount(slot); };
      if (state.interview) { mount(); return; }
      ensureInterview().then(mount).catch(() => {
        const slot = $('.mh-interview',state.root);
        if (run === state.renderRun && slot && state.visible && state.tab === 'interview') slot.innerHTML = `${backBar()}<div class="mh-offline"><p>问题卡暂时无法载入，请检查网络后重试。</p><button type="button" class="mh-button" data-more="interview-retry">重新载入</button></div>`;
      });
      return;
    }
    if (state.tab === 'notes') {
      state.root.innerHTML = `<div class="mh-app">${backBar()}<div class="mh-notes"></div></div>`;
      state.deps.notes().then(notes => { const slot = $('.mh-notes',state.root); if (run === state.renderRun && slot && state.visible && state.tab === 'notes') notes.renderOverview(slot); }).catch(() => {
        const slot = $('.mh-notes',state.root);
        if (run === state.renderRun && slot && state.visible && state.tab === 'notes') slot.innerHTML = '<div class="mh-offline"><p>笔记暂时无法载入，请检查网络后重试。</p></div>';
      });
      return;
    }
    if (state.tab === 'playlist') {
      state.root.innerHTML = `<div class="mh-app">${backBar()}<div class="mh-playlist"></div></div>`;
      state.deps.reader().then(reader => { const slot = $('.mh-playlist',state.root); if (run === state.renderRun && slot && state.visible && state.tab === 'playlist') reader.renderPlaylistPage(slot); }).catch(() => {
        const slot = $('.mh-playlist',state.root);
        if (run === state.renderRun && slot && state.visible && state.tab === 'playlist') slot.innerHTML = '<div class="mh-offline"><p>播放列表暂时无法载入，请检查网络后重试。</p></div>';
      });
      return;
    }
    const scroll = window.scrollY;
    state.root.innerHTML = `<div class="mh-app">${backBar()}<div class="mh-honors">${honorsMarkup()}</div></div>`;
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
      <div class="mh-dialog-arts${w.perfect ? ' has-medal' : ''}"><div class="mh-dialog-art${c.done ? ' is-earned' : w.future ? ' is-future' : ''}">${img(weekArt(w.n),c.theme || '','',true)}</div>${w.perfect ? `<div class="mh-dialog-medal">${img(weekArt(w.n,true),`第 ${w.n} 周全勤奖章`,'',true)}</div>` : ''}</div>
      <p class="mh-kicker">第 ${e(w.n)} 周 · ${e(weekRange(w.weekStart))}</p>
      <h3><span lang="nb">${e(c.theme || '')}</span> ${e(c.themeZh || '')}</h3>
      ${(current?.note || c.note) ? `<p class="mh-note">${e(current?.note || c.note)}</p>` : ''}
      <p class="mh-dialog-goal">${w.future ? '这一周还没开始，届时挑战是：' : '挑战：'}${e(c.title || '')}</p>
      ${current && !current.done ? `${bar(current.progress,current.target,false)}<p class="mh-dialog-progress">${number(current.progress)} / ${number(current.target)}</p>` : `<p class="mh-dialog-status">${c.done ? '已获得这枚徽章' : w.future ? '尚未开始' : '这一周的挑战没有完成'}</p>`}
      ${w.perfect ? '<p class="mh-dialog-perfect">七天全勤，已获得这一周的全勤奖章</p>' : ''}
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
      if (w.challenge?.done) keys.push({key:`week-${w.n}`,image:weekArt(w.n),kicker:tx('第 {n} 周挑战完成',{n:w.n}),title:(L10N.english ? w.challenge.theme || '' : `${w.challenge.theme || ''} ${w.challenge.themeZh || ''}`).trim(),text:tx('赛季徽章已收入荣誉。')});
      if (w.perfect) keys.push({key:`perfect-${w.n}`,image:weekArt(w.n,true),kicker:tx('七天全勤'),title:tx('第 {n} 周全勤奖章',{n:w.n}),text:tx('这一周七天都有打卡，奖章已收入荣誉。')});
    }
    for (const event of h?.events || []) {
      const title = `${event.theme || ''} ${tx('纪念章')}`.trim();
      if (event.earned) keys.push({key:`event-${event.id}`,image:eventArt(event),kicker:tx('{title} 限定纪念章',{title:tx(event.title || '')}),title,text:tx('{day}获得 {n} XP，纪念章已收入荣誉。',{day:dayLabel(event.day),n:Number(event.xp?.target || 0).toLocaleString('en-US')})});
      if (event.gold) keys.push({key:`event-${event.id}-gold`,image:eventArt(event,true),kicker:tx('金色纪念章'),title,text:tx('{day}练了 {n} 个词，纪念章升级为金色。',{day:dayLabel(event.day),n:Number(event.words?.target || 0).toLocaleString('en-US')})});
    }
    for (const t of h?.trophies || []) keys.push({key:`trophy-${t.weekStart}`,image:art(`trophy-${t.rank}`),kicker:tx('周榜奖杯'),title:tx('第 {n} 名 · {cup}',{n:t.rank,cup:tx(RANKS[t.rank] || '')}),text:weekRange(t.weekStart)});
    for (const a of h?.achievements || []) if (a.earned) keys.push({key:`achievement-${a.id}`,image:art(`achievement-${a.id}`),kicker:tx('成就'),title:tx(a.title || ''),text:tx(a.description || '')});
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
    if (fresh.length) {
      try { localStorage.setItem(SEEN_KEY,JSON.stringify([...seen,...fresh.map(item => item.key)].slice(-400))); } catch {}
      state.queue.push(...fresh);
    }
    // Also honors held back while a game had the screen: the game's exit refreshes honors, and they show now.
    if (state.queue.length && !state.revealing) nextReveal();
  }
  function nextReveal() {
    // Keep new honors queued while a game owns the screen and focus (翻翻乐, 抓小偷, 开饭啦, 百货超市): a card over a game
    // in play covers the shop or the kitchen mid-shift. They show when the game is closed (its exit refreshes honors).
    if (['NorskDuel','NorskChase','NorskKitchen','NorskMall'].some(name => window[name]?.isOpen?.())) { state.revealing = false; return; }
    const item = state.queue.shift();
    if (!item || !document.body) {
      state.revealing = false;
      if (state.revealReturn?.isConnected) state.revealReturn.focus?.({preventScroll:true});
      state.revealReturn = null;
      return;
    }
    if (!state.revealing) state.revealReturn = document.activeElement;
    state.revealing = true;
    const layer = document.createElement('div');
    layer.className = 'mh-reveal';
    layer.setAttribute('role','dialog');
    layer.setAttribute('aria-modal','true');
    layer.setAttribute('aria-label',item.kicker);
    layer.innerHTML = `<div class="mh-reveal-card"><div class="mh-reveal-art">${img(item.image,item.title,'',true)}</div><p class="mh-kicker">${e(item.kicker)}</p><h3>${e(item.title)}</h3>${item.text ? `<p>${e(item.text)}</p>` : ''}<button type="button" class="mh-reveal-ok">${tx('收下')}</button></div>`;
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      layer.classList.remove('is-open');
      setTimeout(() => { layer.remove(); nextReveal(); },window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 420);
    };
    layer.addEventListener('click',event => { if (event.target === layer || event.target.closest('.mh-reveal-ok')) close(); });
    // 收下 is the only control, so Tab stays on it instead of walking the page behind.
    layer.addEventListener('keydown',event => { if (event.key === 'Escape') close(); if (event.key === 'Tab') event.preventDefault(); });
    document.body.append(layer);
    const image = layer.querySelector('img');
    const open = () => requestAnimationFrame(() => { layer.classList.add('is-open'); layer.querySelector('.mh-reveal-ok')?.focus({preventScroll:true}); window.NorskCelebrate?.motes?.(layer.querySelector('.mh-reveal-art')); });
    if (image.complete) open(); else { image.addEventListener('load',open,{once:true}); image.addEventListener('error',open,{once:true}); }
  }
  window.addEventListener('norskduelclose',() => { if (!state.revealing) nextReveal(); });

  /* ---------- Shell ---------- */
  function onClick(event) {
    const target = event.target.closest('[data-more]');
    if (!target) return;
    const action = target.dataset.more;
    if (action === 'tab') {
      if (target.dataset.tab === 'interview') { openPicker(); return; }
      show(target.dataset.tab,'.mh-back');
      state.deps.setTab?.(state.tab);
      document.querySelector('#sidebar.open') && document.querySelector('#close-sidebar')?.click();
      return;
    }
    if (action === 'home') {
      const from = state.tab;
      show('home',`[data-tab="${from}"]`);
      state.deps.setTab?.('home');
      return;
    }
    if (!state.root?.contains(target)) return;
    if (action === 'interview-retry') render();
    if (action === 'retry') { state.status = 'loading'; render(); load(true); }
    if (action === 'badge') openBadge(target.dataset.week);
    if (action === 'jump') {
      const heading = document.getElementById?.(target.dataset.target);
      heading?.closest('.mh-section')?.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',block:'start'});
      heading?.focus({preventScroll:true});
    }
    if (action === 'duel') state.deps.openDuel?.();
    if (action === 'makeup') claimMakeup(target.dataset.day);
  }
  function init(deps) {
    state.deps = {...state.deps,...deps};
    state.root = deps.root || state.root;
    if (state.initialized) return;
    state.initialized = true;
    document.addEventListener('click',onClick);
  }
  function show(tab = state.tab,focus = '') {
    const next = tab === 'home' || TOOLS[tab] ? tab : 'home', changed = state.visible && state.tab !== next;
    state.tab = next;
    state.visible = true;
    render();
    if (changed) window.scrollTo(0,0);
    if (next === 'honors' || next === 'home') load();
    if (focus) state.root?.querySelector(focus)?.focus({preventScroll:true});
  }
  function hide() { state.visible = false; ++state.renderRun; state.interview?.unmount(); state.verbs?.unmount(); state.dialog?.close?.(); window.NorskNotes?.hideOverview?.(); }
  function stopAudio() { state.interview?.stopAudio(); state.verbs?.stopAudio(); }

  window.NorskMore = {init,show,hide,reveal,stopAudio};
  window.dispatchEvent(new Event('norskmoreready'));
})();
