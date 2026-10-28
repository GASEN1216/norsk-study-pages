/* 联机翻翻乐 (Vendespill): a timed memory race in waves. Loaded on demand; nothing touches the page until open().
   Everyone plays the same face-down wave; the server referees each claim, keeps the score and deals the next wave. */
(() => {
  'use strict';
  if (window.NorskDuel) return;

  const PREFS_KEY = 'norsk-duel-v2';
  const COUNTS = [16,24,36,48,72];
  const MIN_POOL = 6, MAX_POOL = 120, MAX_TEXT = 40, MAX_BODY_BYTES = 15800;
  const MISS_LOCK_MS = 700, GLOW_MS = 750, TICKER_MS = 2200, ROLL_MS = 600;
  const POLL_MS = {lobby:1500, finished:1500, countdown:500, playing:650, hidden:4000};
  const TEAMS = {pine:{name:'松绿队',color:'#2f6b55'}, amber:{name:'琥珀队',color:'#a87a2a'}};
  const TEAM_IDS = ['pine','amber'];
  // Muted, distinguishable tones that sit with the site's forest green and gold.
  const COLORS = ['#2f6b55','#a87a2a','#46698c','#8b4d6a','#2d7473','#a65d3c','#677634','#6c5e8c'];
  const MODES = {ffa:{name:'个人混战',hint:'各自为战'}, team:{name:'组队',hint:'松绿队对琥珀队'}};
  const CONTROL = /[\p{Cc}\p{Cf}\p{Cs}]/u;
  const ERRORS = {
    room_not_found:'房间不存在或已过期。', room_full:'房间已满（最多 8 人）。', not_host:'只有房主可以这样做。',
    not_in_room:'你已不在这个房间。', rate_limited:'操作有点频繁，请稍等片刻。', invalid_pairs:'这组词暂时无法使用，请换一组范围。',
    storage_unavailable:'浏览器暂时无法记住你的身份，请允许保存网站数据后重试。', timeout:'网络有点慢，请稍后重试。',
    room_busy:'这一局正在进行。', not_started:'这一波还没开始。', game_over:'这一局已经结束。', not_in_game:'本局你在观战，下一局再一起玩。',
    not_enough_ready:'至少一半、且两人以上准备好后才能提前开始。',
  };
  const friendly = error => ERRORS[error?.code] || '网络不太稳定，请稍后重试。';

  /* ---------- Pure logic (exercised by scripts/check_duel.cjs) ---------- */

  const clean = value => String(value ?? '').normalize('NFC').replace(/\s+/g,' ').trim();
  const length = value => [...value].length;
  const foldKey = value => clean(value).normalize('NFKC').toLocaleLowerCase();
  // Cards show the first sense only: "教师；老师" becomes "教师".
  function shortMeaning(meaning) {
    const text = clean(meaning);
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if ('（(［[【'.includes(char)) depth++;
      else if ('）)］]】'.includes(char)) depth = Math.max(0,depth-1);
      else if ((char === '；' || char === ';') && depth === 0) return text.slice(0,i).trim() || text;
    }
    return text;
  }
  const usable = value => value && length(value) <= MAX_TEXT && !CONTROL.test(value);
  // Merge the chosen sources into one word list, each key once. A chosen chapter covers its sections.
  function poolFor(sources, tokens) {
    const chosen = new Set(tokens || []), seen = new Set(), words = [];
    for (const source of sources || []) {
      if (!chosen.has(source?.token) && !(source?.parent && chosen.has(source.parent))) continue;
      for (const item of source.words || []) {
        const key = item?.key ?? item?.word;
        if (key == null || seen.has(key)) continue;
        seen.add(key); words.push(item);
      }
    }
    return words;
  }
  // Draw pairs whose Norwegian words and Chinese meanings are all distinct, preferring faces that fit a card.
  function drawPairs(words, count, random=Math.random) {
    const pool = [];
    for (const item of words || []) {
      const no = clean(item?.word), zh = shortMeaning(item?.meaning);
      if (usable(no) && usable(zh)) pool.push({key:item.key ?? no, no, zh});
    }
    for (let i = pool.length-1; i > 0; i--) { const j = Math.floor(random()*(i+1)); [pool[i],pool[j]] = [pool[j],pool[i]]; }
    const compact = item => length(item.no) <= 18 && length(item.zh) <= 12;
    pool.sort((a,b) => compact(b)-compact(a));
    const picked = [], words_ = new Set(), meanings = new Set();
    for (const item of pool) {
      const word = foldKey(item.no), meaning = foldKey(item.zh);
      if (words_.has(word) || meanings.has(meaning)) continue;
      words_.add(word); meanings.add(meaning); picked.push(item);
      if (picked.length >= count) break;
    }
    return picked;
  }
  const drawable = words => drawPairs(words,MAX_POOL,() => 0).length;
  // How many words a word-count choice (16 … 72, or 'all') gives from what the range offers.
  function resolveCount(choice, available) {
    const wanted = choice === 'all' ? MAX_POOL : Number(choice) || COUNTS[0];
    return Math.max(0,Math.min(wanted,available,MAX_POOL));
  }
  // Mirrors the server: 180 s + 4 s per word, from 3½ to 8 minutes.
  const matchSeconds = count => Math.max(210,Math.min(480,180+4*count));
  const minutesLabel = seconds => `约 ${Math.max(1,Math.round(seconds/60))} 分钟`;
  const utf8Bytes = text => { let bytes = 0; for (const char of text) { const code = char.codePointAt(0); bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4; } return bytes; };
  // A pool of long phrases can exceed the request limit; the longest pairs give way first.
  function fitPayload(body, limit=MAX_BODY_BYTES) {
    let pairs = [...body.pairs];
    const size = list => utf8Bytes(JSON.stringify({...body,pairs:list}));
    while (pairs.length > MIN_POOL && size(pairs) > limit) {
      const longest = pairs.reduce((best,pair,index) => utf8Bytes(pair.no+pair.zh) > utf8Bytes(pairs[best].no+pairs[best].zh) ? index : best,0);
      pairs = pairs.filter((_,index) => index !== longest);
    }
    return {...body,pairs};
  }
  const chosenIn = (tokens, source) => tokens.includes(source.token) || Boolean(source.parent && tokens.includes(source.parent));
  // Picker semantics like practice: a chapter covers its sections; unticking one section keeps the others.
  function toggleSource(sources, tokens, token) {
    const source = (sources || []).find(item => item.token === token);
    if (!source) return [...tokens];
    const sections = parent => sources.filter(item => item.parent === parent).map(item => item.token);
    let next = new Set(tokens);
    if (source.group === 'chapter') {
      if (next.has(token)) next.delete(token); else next.add(token);
      sections(token).forEach(item => next.delete(item));
    } else if (source.parent && next.has(source.parent)) {
      next.delete(source.parent);
      sections(source.parent).forEach(item => { if (item !== token) next.add(item); });
    } else if (next.has(token)) next.delete(token);
    else {
      next.add(token);
      const siblings = source.parent ? sections(source.parent) : [];
      if (siblings.length && siblings.every(item => next.has(item))) { siblings.forEach(item => next.delete(item)); next.add(source.parent); }
    }
    return [...next];
  }
  function chapterState(sources, tokens, chapter) {
    if (tokens.includes(chapter.token)) return 'true';
    return sources.some(item => item.parent === chapter.token && tokens.includes(item.token)) ? 'mixed' : 'false';
  }
  function selectionLabel(sources, tokens) {
    const labels = (sources || []).filter(source => tokens.includes(source.token)).map(source => source.label);
    const text = labels.length > 2 ? `${labels.slice(0,2).join('、')} 等 ${labels.length} 组` : labels.join('、');
    return [...text].slice(0,60).join('');
  }
  // The server flips countdown to playing lazily; clients follow their synced clock.
  function phaseOf(room, serverNow) {
    if (!room) return 'none';
    if (room.status === 'countdown' && Number.isFinite(room.startsAt) && serverNow >= room.startsAt) return 'playing';
    return room.status;
  }
  const waveOf = room => room?.match?.wave || null;
  const waveKey = room => room?.match ? `${room.code}:${room.round}:${room.match.wave.n}` : '';
  function waveOpen(room, serverNow) {
    const wave = waveOf(room);
    return Boolean(wave) && phaseOf(room,serverNow) === 'playing' && serverNow >= wave.opensAt && serverNow < room.match.endsAt;
  }
  const newLocal = key => ({key, flipped:[], lockedUntil:0, pending:null});
  // A tap on card `index`. Returns the next private state and what should happen.
  function flipCard(local, room, index, now, serverNow) {
    const none = {local, effect:null};
    const wave = waveOf(room), card = wave?.cards?.[index];
    if (!card || !waveOpen(room,serverNow) || local.key !== waveKey(room)) return none;
    if (wave.claims.some(claim => claim.pair === card.pair) || local.pending || now < local.lockedUntil || local.flipped.includes(index)) return none;
    const flipped = local.flipped.length >= 2 ? [] : local.flipped;
    if (!flipped.length) return {local:{...local,flipped:[index],lockedUntil:0}, effect:{type:'flip',index}};
    const first = flipped[0], other = wave.cards[first];
    if (other.pair === card.pair && other.kind !== card.kind) {
      return {local:{...local,flipped:[first,index],pending:{a:first,b:index,pair:card.pair}}, effect:{type:'claim',wave:wave.n,a:first,b:index}};
    }
    return {local:{...local,flipped:[first,index],lockedUntil:now+MISS_LOCK_MS}, effect:{type:'miss',a:first,b:index,until:now+MISS_LOCK_MS}};
  }
  // After a miss the two cards turn back once the lock has passed.
  function settleMiss(local, now) {
    return !local.pending && local.flipped.length === 2 && now >= local.lockedUntil ? {...local,flipped:[],lockedUntil:0} : local;
  }
  const claimDone = local => ({...local,pending:null,flipped:[],lockedUntil:0});
  // Fold a server state into the private view of the wave; report pairs someone else took from under my fingers.
  function mergeWave(local, room, me) {
    const key = waveKey(room), same = Boolean(local) && local.key === key;
    const base = same ? local : newLocal(key);
    const wave = waveOf(room);
    const owners = new Map((wave?.claims || []).map(claim => [claim.pair,claim.playerId]));
    const pairOf = index => wave?.cards?.[index]?.pair;
    const stolen = [...new Set(base.flipped.map(pairOf).filter(pair => owners.has(pair) && owners.get(pair) !== me))];
    const pending = base.pending && owners.has(base.pending.pair) ? null : base.pending;
    const flipped = base.flipped.filter(index => !owners.has(pairOf(index)));
    return {local:{...base,flipped,pending,lockedUntil:flipped.length === 2 ? base.lockedUntil : 0}, stolen, changed:!same};
  }
  const freshClaims = (lastSeq, room) => (room?.match?.recent || []).filter(claim => claim.seq > lastSeq);
  const colorFor = (mode, player) => mode === 'team' && TEAMS[player?.team] ? TEAMS[player.team].color : COLORS[(Number(player?.color) || 0) % COLORS.length];
  // Live scoreboard: players in the match by points, then pairs, then join order.
  function standings(room) {
    const mode = room.match?.mode || room.mode;
    const players = room.players.filter(player => player.playing).map((player,order) => ({...player,order,color:colorFor(mode,player)}));
    players.sort((a,b) => b.points-a.points || b.pairs-a.pairs || a.order-b.order);
    const teams = mode === 'team' ? TEAM_IDS.map(id => {
      const members = players.filter(player => player.team === id);
      return {id,name:TEAMS[id].name,color:TEAMS[id].color,points:members.reduce((sum,player) => sum+player.points,0),members};
    }) : [];
    return {players,teams};
  }
  // Server time = local time + offset; samples with quick round trips are trusted most.
  function syncClock(clock, serverTime, sentAt, receivedAt) {
    if (!Number.isFinite(serverTime) || !Number.isFinite(sentAt) || !Number.isFinite(receivedAt)) return clock;
    const rtt = Math.max(0,receivedAt-sentAt), offset = serverTime-(sentAt+receivedAt)/2;
    if (!clock || rtt <= clock.rtt*1.25+30 || clock.age >= 20) return {offset,rtt,age:0};
    return {...clock,rtt:clock.rtt*1.05,age:clock.age+1};
  }
  const formatClock = ms => { const seconds = Math.max(0,Math.ceil(ms/1000)); return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`; };
  const shareLink = (location, code) => `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}#practice`;
  const validCode = value => /^\d{4}$/.test(String(value ?? ''));
  // Phones keep four columns (24 cards fit at 360 px); wider screens spread a wave over fewer rows.
  function columnsFor(cards, narrow) {
    if (narrow) return cards <= 9 ? 3 : 4;
    return cards <= 16 ? 4 : cards <= 20 ? 5 : 6;
  }
  function multiplierText(claim) {
    const parts = [];
    if (claim.streak >= 5) parts.push('连抢 ×2'); else if (claim.streak >= 3) parts.push('连抢 ×1.5');
    if (claim.golden) parts.push('金色 ×2');
    if (claim.sprint) parts.push('冲刺 ×2');
    return parts.join(' · ');
  }

  /* ---------- Overlay ---------- */

  const ui = {open:false};
  const fallbackEscape = value => String(value ?? '').replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const e = value => (ui.opts?.escapeHTML || fallbackEscape)(value);
  const $ = selector => ui.root?.querySelector(selector);
  const ICONS = {
    close:'<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    copy:'<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
    share:'<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12"/>',
    shuffle:'<path d="M4 7h3.5c4 0 5 10 9 10H20M4 17h3.5c1.6 0 2.6-1.6 3.5-3.4M13 10.4C13.9 8.6 15 7 16.5 7H20M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5"/>',
    star:'<path d="M12 4.5 13.6 10.4 19.5 12l-5.9 1.6L12 19.5l-1.6-5.9L4.5 12l5.9-1.6z"/>',
    check:'<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    down:'<path d="m6 9.5 6 6 6-6"/>',
    speaker:'<path d="M11 5 6.5 9H3.5v6h3l4.5 4z"/><path d="M15.5 8.8a4.6 4.6 0 0 1 0 6.4"/>',
  };
  const icon = name => `<svg class="nd-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  const button = (action,text,kind='',extra='') => `<button type="button" class="nd-button ${kind}" data-nd-action="${action}" ${extra}>${text}</button>`;
  const serverNow = () => Date.now()+(ui.clock?.offset || 0);
  const meOf = room => room?.players?.find(player => player.id === room.me) || null;
  const isHost = room => Boolean(room && room.me && room.me === room.hostId);
  const between = room => room && (room.status === 'lobby' || room.status === 'finished');
  const screenOf = room => !room ? 'lobby' : room.status === 'lobby' ? 'room' : room.status === 'finished' ? 'results' : 'game';
  const reducedMotion = () => { try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; } catch { return false; } };
  const nameOf = (room, id) => id === room?.me ? '我' : room?.players?.find(player => player.id === id)?.nickname || '';

  function readPrefs() {
    try { const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null'); return saved && typeof saved === 'object' ? saved : {}; } catch { return {}; }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY,JSON.stringify({version:2,mode:ui.config.mode,choice:ui.config.choice,tokens:ui.config.tokens})); } catch { /* Preferences are a convenience. */ }
  }
  function loadSources() {
    let list = [];
    try { list = ui.opts.sources?.() || []; } catch { list = []; }
    return (Array.isArray(list) ? list : []).filter(source => source && typeof source.token === 'string' && Array.isArray(source.words) && source.words.length);
  }
  const configSignature = () => JSON.stringify([ui.config.mode,ui.config.choice,[...ui.config.tokens].sort()]);
  function configSummary() {
    const words = poolFor(ui.sources,ui.config.tokens), available = drawable(words), count = resolveCount(ui.config.choice,available);
    return {available,count,seconds:matchSeconds(count),label:selectionLabel(ui.sources,ui.config.tokens)};
  }

  function open(options={}) {
    if (ui.open) { focusFirst(); return Promise.resolve(true); }
    const community = options.community || window.NorskCommunity;
    if (!community?.request || !community?.profile || !document?.body) {
      try { options.notify?.('联机翻翻乐暂时无法使用，请稍后再试。'); } catch { /* Optional. */ }
      return Promise.resolve(false);
    }
    Object.assign(ui,{open:true,opts:options,community,session:(ui.session || 0)+1,room:null,local:null,clock:null,profile:null,
      screen:'',busy:false,message:'',joinCode:validCode(options.join) ? String(options.join) : '',pollTimer:null,polling:null,failures:0,offline:false,
      tickTimer:null,missTimer:null,toastTimer:null,tickerTimer:null,dealTimer:null,settingsTimer:null,resizeTimer:null,timers:new Set(),
      gone:new Set(),glowing:new Set(),built:'',gameKey:'',boardCards:[],boardWave:0,interlude:'',lastSeq:-1,shown:new Map(),words:null,
      confirm:false,honorsFor:'',pushed:'',editing:'',picker:null,lastPhase:'',settingsSync:null,readyRun:0,
      lastFocus:document.activeElement,historyToken:'nd-'+Date.now().toString(36)+Math.random().toString(36).slice(2,7)});
    ui.sources = loadSources();
    const prefs = readPrefs(), tokens = new Set(ui.sources.map(source => source.token));
    const saved = Array.isArray(prefs.tokens) ? prefs.tokens.filter(token => tokens.has(token)) : [];
    const fallback = ui.sources.find(source => source.group === 'chapter') || ui.sources.find(source => source.group !== 'mine') || ui.sources[0];
    ui.config = {mode:MODES[prefs.mode] ? prefs.mode : 'ffa',choice:prefs.choice === 'all' || COUNTS.includes(prefs.choice) ? prefs.choice : 24,
      tokens:saved.length ? saved : fallback ? [fallback.token] : []};
    const root = document.createElement('div');
    root.className = 'nd-root';
    root.setAttribute('role','dialog');
    root.setAttribute('aria-modal','true');
    root.setAttribute('aria-labelledby','nd-title');
    root.innerHTML = `<div class="nd-shell"><header class="nd-top"><div class="nd-brand"><span class="nd-kicker">Vendespill</span><h2 id="nd-title" tabindex="-1">联机翻翻乐</h2></div><span class="nd-room-chip" id="nd-room-chip" hidden></span><button type="button" class="nd-icon-button" data-nd-action="close" aria-label="离开联机翻翻乐" title="离开">${icon('close')}</button></header><main class="nd-body" id="nd-body"></main></div><p class="nd-offline" id="nd-offline" role="status" hidden>网络不稳，正在重新连接…</p><p class="nd-toast" id="nd-toast" role="status" aria-live="polite" hidden></p><div class="nd-sheet-layer" id="nd-sheet" hidden></div><div class="nd-confirm-layer" id="nd-confirm" hidden><div class="nd-confirm" role="alertdialog" aria-modal="true" aria-labelledby="nd-confirm-text"><p id="nd-confirm-text">离开这一局吗？已抢到的词对仍会计分。</p><div class="nd-actions">${button('confirm-stay','继续游戏','nd-primary','id="nd-confirm-stay"')}${button('confirm-leave','离开','nd-quiet')}</div></div></div>`;
    ui.root = root;
    ui.handlers = {click:onClick,input:onInput,compositionend:onInput,submit:onSubmit};
    for (const [type,handler] of Object.entries(ui.handlers)) root.addEventListener(type,handler);
    // Keys are heard on the document so Esc and the Tab loop still work when a rebuilt board drops focus.
    document.addEventListener('keydown',onKey);
    ui.onVisibility = () => { if (ui.room) schedulePoll(document.visibilityState === 'hidden' ? POLL_MS.hidden : 0); };
    ui.onResize = () => { clearTimeout(ui.resizeTimer); ui.resizeTimer = setTimeout(fitCards,150); };
    ui.onPopState = onPopState;
    document.addEventListener('visibilitychange',ui.onVisibility);
    window.addEventListener('resize',ui.onResize);
    window.addEventListener('popstate',ui.onPopState);
    try { history.pushState({...(history.state && typeof history.state === 'object' ? history.state : {}),norskDuel:ui.historyToken},'',location.href); } catch { /* Back simply leaves the page. */ }
    document.body.append(root);
    document.body.classList.add('nd-open');
    render();
    $('#nd-title')?.focus({preventScroll:true});
    const session = ui.session;
    void (async () => {
      try { ui.profile = await community.profile(); }
      catch (error) { if (session === ui.session) { ui.message = friendly(error); render(); } return; }
      if (session !== ui.session) return;
      render();
      if (ui.joinCode && validCode(options.join)) await joinRoom(ui.joinCode);
    })();
    return Promise.resolve(true);
  }

  function inMatch(room) {
    const me = meOf(room), phase = phaseOf(room,serverNow());
    return (phase === 'countdown' || phase === 'playing') && Boolean(me?.playing) && !me.left;
  }
  function requestClose() {
    if (!ui.open) return;
    if (ui.confirm) { hideConfirm(); return; }
    if (ui.picker) { closePicker(); return; }
    if (inMatch(ui.room)) showConfirm(); else exit();
  }
  function showConfirm() {
    ui.confirm = true;
    const layer = $('#nd-confirm');
    if (layer) { layer.hidden = false; $('#nd-confirm-stay')?.focus({preventScroll:true}); }
  }
  function hideConfirm() {
    ui.confirm = false;
    const layer = $('#nd-confirm');
    if (layer) layer.hidden = true;
    focusFirst();
  }
  function exit() {
    if (!ui.open) return;
    const room = ui.room;
    ui.open = false; ui.session++;
    if (room) void ui.community.request(`/duel/rooms/${room.code}/leave`,{method:'POST',body:{}}).catch(() => {});
    stopTimers();
    for (const [type,handler] of Object.entries(ui.handlers || {})) ui.root?.removeEventListener(type,handler);
    document.removeEventListener('keydown',onKey);
    document.removeEventListener('visibilitychange',ui.onVisibility);
    window.removeEventListener('resize',ui.onResize);
    window.removeEventListener('popstate',ui.onPopState);
    ui.root?.remove();
    ui.root = null; ui.room = null;
    document.body.classList.remove('nd-open');
    setRoomInURL(null);
    try {
      if (history.state?.norskDuel === ui.historyToken) {
        window.addEventListener('popstate',() => setRoomInURL(null),{once:true});
        history.back();
      }
    } catch { /* History is best effort. */ }
    try { ui.lastFocus?.focus?.({preventScroll:true}); } catch { /* The old element may be gone. */ }
    try { ui.opts?.onExit?.(); } catch { /* Host callback. */ }
    window.dispatchEvent(new Event('norskduelclose'));
  }
  function onPopState() {
    if (!ui.open || history.state?.norskDuel === ui.historyToken) return;
    // The back gesture asks to close; mid-match it asks first and keeps the overlay's history entry.
    if (inMatch(ui.room) || ui.picker) {
      try { history.pushState({...(history.state && typeof history.state === 'object' ? history.state : {}),norskDuel:ui.historyToken},'',location.href); } catch { /* Ignore. */ }
      if (ui.picker) closePicker(); else showConfirm();
    } else {
      ui.historyToken = '';
      exit();
    }
  }
  function later(run, delay) {
    const timer = setTimeout(() => { ui.timers.delete(timer); run(); },delay);
    ui.timers.add(timer);
    return timer;
  }
  function stopTimers() {
    for (const name of ['pollTimer','missTimer','toastTimer','tickerTimer','dealTimer','settingsTimer','resizeTimer']) { clearTimeout(ui[name]); ui[name] = null; }
    clearInterval(ui.tickTimer); ui.tickTimer = null;
    for (const timer of ui.timers || []) clearTimeout(timer);
    ui.timers?.clear?.();
  }
  function setRoomInURL(code) {
    try {
      const url = new URL(location.href);
      if (code) url.searchParams.set('room',code); else if (url.searchParams.has('room')) url.searchParams.delete('room'); else return;
      history.replaceState(history.state,'',url.href);
    } catch { /* The share link still works. */ }
  }
  function toast(message, duration=2600) {
    const node = $('#nd-toast');
    if (!node) return;
    clearTimeout(ui.toastTimer);
    node.textContent = message; node.hidden = false; node.classList.remove('is-leaving');
    ui.toastTimer = setTimeout(() => { node.classList.add('is-leaving'); ui.toastTimer = setTimeout(() => { node.hidden = true; },400); },duration);
  }
  function setOffline(offline) {
    if (ui.offline === offline) return;
    ui.offline = offline;
    const node = $('#nd-offline');
    if (node) node.hidden = !offline;
  }
  function speak(word) {
    try { void Promise.resolve(ui.opts.pronounce?.({word})).catch(() => {}); } catch { /* Audio is optional. */ }
  }

  /* Network */

  async function call(path, body) {
    const sentAt = Date.now(), session = ui.session;
    const data = await ui.community.request(path,body === undefined ? {timeout:8000} : {method:'POST',body,timeout:10000});
    if (session === ui.session) ui.clock = syncClock(ui.clock,data?.serverTime,sentAt,Date.now());
    return data;
  }
  function nextDelay() {
    if (document.visibilityState === 'hidden') return POLL_MS.hidden;
    return POLL_MS[phaseOf(ui.room,serverNow())] || POLL_MS.lobby;
  }
  function schedulePoll(delay) {
    clearTimeout(ui.pollTimer);
    if (!ui.open || !ui.room) return;
    ui.pollTimer = setTimeout(poll,Math.max(0,delay));
  }
  async function poll() {
    const room = ui.room, session = ui.session;
    if (!room || !ui.open) return;
    if (ui.polling?.session === session && ui.polling.code === room.code) return;
    const polling = ui.polling = {session,code:room.code};
    try {
      const data = await call(`/duel/rooms/${room.code}?v=${room.version}${ui.words ? `&have=${ui.words.number}` : ''}`);
      if (session !== ui.session || ui.room?.code !== room.code) return;
      ui.failures = 0; setOffline(false);
      if (!data.unchanged) applyState(data);
      schedulePoll(nextDelay());
    } catch (error) {
      if (session !== ui.session || ui.room?.code !== room.code) return;
      if (error?.code === 'room_not_found' || error?.code === 'not_in_room') { lostRoom(friendly(error)); return; }
      ui.failures++;
      if (ui.failures >= 2) setOffline(true);
      schedulePoll(error?.code === 'rate_limited' ? 4000 : Math.min(8000,1000*2**Math.min(ui.failures-1,3)));
    } finally {
      if (ui.polling === polling) ui.polling = null;
    }
  }
  function lostRoom(message) {
    ui.room = null; ui.local = null; ui.message = message; ui.words = null; ui.gameKey = ''; ui.built = '';
    clearTimeout(ui.pollTimer); clearInterval(ui.tickTimer); ui.tickTimer = null;
    setOffline(false); setRoomInURL(null); render();
  }
  async function action(path, body, {quiet=false}={}) {
    if (ui.busy) return null;
    ui.busy = true; ui.message = ''; render();
    try {
      const data = await call(path,body);
      if (!ui.open) return null;
      if (data?.code && Array.isArray(data.players)) applyState(data);
      return data;
    } catch (error) {
      if (!ui.open) return null;
      if (error?.code === 'room_not_found' || error?.code === 'not_in_room') lostRoom(friendly(error));
      else if (quiet) toast(friendly(error));
      else ui.message = friendly(error);
      return null;
    } finally {
      ui.busy = false;
      if (ui.open) render();
    }
  }
  // Small room changes (ready, team, settings) never block the screen.
  async function quietCall(path, body) {
    const session = ui.session, code = ui.room?.code;
    const active = () => ui.open && session === ui.session && code === ui.room?.code;
    try {
      const data = await call(path,body);
      if (!active()) return null;
      if (data?.code && Array.isArray(data.players)) applyState(data);
      return data;
    } catch (error) {
      if (!active()) return null;
      if (error?.code === 'room_not_found' || error?.code === 'not_in_room') lostRoom(friendly(error)); else toast(friendly(error));
      return null;
    }
  }
  function enter(state) {
    ui.room = null; ui.local = null; ui.gone = new Set(); ui.built = ''; ui.gameKey = ''; ui.lastPhase = ''; ui.lastSeq = -1; ui.words = null; ui.shown = new Map();
    if (!ui.profile) ui.community.profile().then(profile => { ui.profile = profile; }).catch(() => {});
    applyState(state);
    setRoomInURL(state.code);
    schedulePoll(nextDelay());
  }
  function settingsBody() {
    const words = poolFor(ui.sources,ui.config.tokens), count = resolveCount(ui.config.choice,drawable(words));
    if (count < MIN_POOL) return null;
    const pairs = drawPairs(words,count).map(({no,zh}) => ({no,zh}));
    return fitPayload({mode:ui.config.mode,label:selectionLabel(ui.sources,ui.config.tokens),pairs});
  }
  async function createRoom() {
    const body = settingsBody();
    if (!body) { ui.message = `所选范围至少需要 ${MIN_POOL} 个释义不同的词，请多选几个范围。`; render(); return; }
    savePrefs();
    const state = await action('/duel/rooms',body);
    if (state?.code) { ui.pushed = state.code+'|'+configSignature(); enter(state); }
  }
  async function joinRoom(code) {
    if (!validCode(code)) { ui.message = '请输入 4 位数字房间号。'; render(); return; }
    const state = await action(`/duel/rooms/${code}/join`,{});
    if (state?.code) { ui.joinCode = ''; enter(state); }
    else if (!ui.message) ui.message = ERRORS.room_not_found;
  }
  function leaveRoom() {
    const room = ui.room;
    if (!room) return;
    void ui.community.request(`/duel/rooms/${room.code}/leave`,{method:'POST',body:{}}).catch(() => {});
    lostRoom('');
  }
  const hostEditing = room => Boolean(room && isHost(room) && between(room) && (ui.pushed.startsWith(room.code+'|') || ui.editing === room.code));
  // The host's changes reach everyone shortly after they settle; the server resets readiness for them.
  function scheduleSettings() {
    const room = ui.room;
    if (!hostEditing(room)) return;
    clearTimeout(ui.settingsTimer);
    ui.settingsTimer = setTimeout(pushSettings,300);
  }
  async function pushSettings() {
    clearTimeout(ui.settingsTimer); ui.settingsTimer = null;
    if (ui.settingsSync) return ui.settingsSync;
    const session = ui.session, code = ui.room?.code;
    const sync = (async () => {
      while (ui.open && session === ui.session && code === ui.room?.code) {
        const room = ui.room;
        const ownsDraft = isHost(room) && (ui.pushed.startsWith(room.code+'|') || ui.editing === room.code);
        if (!ownsDraft) return true;
        const signature = room.code+'|'+configSignature();
        if (ui.pushed === signature) return true;
        // A previously ready host may have triggered a countdown while an edit was debounced.
        // Withdrawing readiness cancels that stale countdown before publishing the new pool.
        const me = meOf(room);
        if (me?.ready && (between(room) || (room.status === 'countdown' && me.playing))) {
          if (!await quietCall(`/duel/rooms/${room.code}/ready`,{ready:false})) return false;
          continue;
        }
        if (!between(room)) return false;
        const body = settingsBody();
        if (!body) { toast(`所选范围至少需要 ${MIN_POOL} 个释义不同的词。`); return false; }
        const data = await quietCall(`/duel/rooms/${room.code}/settings`,body);
        if (!data || !ui.open || session !== ui.session || code !== ui.room?.code) return false;
        // Only acknowledge a successful request. A later edit is sent next, never concurrently.
        ui.pushed = signature;
      }
      return false;
    })();
    ui.settingsSync = sync;
    try { return await sync; }
    finally { if (ui.settingsSync === sync) ui.settingsSync = null; }
  }
  async function setReady(ready) {
    const room = ui.room, session = ui.session, run = ui.readyRun = (ui.readyRun || 0)+1;
    if (!room) return;
    if (ready && isHost(room) && between(room) && !await pushSettings()) return;
    if (!ui.open || session !== ui.session || ui.room?.code !== room.code || run !== ui.readyRun) return;
    return quietCall(`/duel/rooms/${room.code}/ready`,{ready});
  }
  async function startMatch() {
    const room = ui.room, session = ui.session, run = ui.readyRun = (ui.readyRun || 0)+1;
    if (!room || !await pushSettings()) return;
    if (!ui.open || session !== ui.session || ui.room?.code !== room.code || run !== ui.readyRun || !between(ui.room)) return;
    return action(`/duel/rooms/${room.code}/start`,{},{quiet:true});
  }
  async function sendClaim(effect) {
    const room = ui.room, session = ui.session;
    const word = waveOf(room)?.cards?.[effect.a]?.kind === 'no' ? waveOf(room).cards[effect.a].face : waveOf(room)?.cards?.[effect.b]?.face;
    try {
      const data = await call(`/duel/rooms/${room.code}/claim`,{wave:effect.wave,a:effect.a,b:effect.b});
      if (session !== ui.session || ui.room?.code !== room.code) return;
      ui.local = claimDone(ui.local);
      // Only the claimer hears the word, so sounds never pile up on a shared table.
      if (data.accepted) speak(word);
      else if (data.reason === 'claimed') toast(`慢了一步，${nameOf(data,data.claimedBy) || '别人'} 先抢到了`);
      applyState(data);
    } catch (error) {
      if (session !== ui.session) return;
      ui.local = claimDone(ui.local);
      if (error?.code === 'room_not_found' || error?.code === 'not_in_room') { lostRoom(friendly(error)); return; }
      toast(error?.code === 'not_in_game' ? ERRORS.not_in_game : '网络没跟上，这一对没抢到，可以再翻一次。');
      patchBoard();
      schedulePoll(0);
    }
  }

  /* State */

  function applyState(state) {
    if (!state || !Array.isArray(state.players)) return;
    const previous = ui.room;
    if (previous && previous.code === state.code && state.version < previous.version) return;
    if (previous?.code === state.code && previous.round !== state.round) { ui.lastSeq = -1; ui.shown = new Map(); }
    ui.room = state;
    if (state.results?.words) ui.words = {number:state.results.number,list:state.results.words};
    const merged = mergeWave(ui.local,state,state.me);
    ui.local = merged.local;
    for (const pair of merged.stolen) {
      const claim = waveOf(state).claims.find(item => item.pair === pair);
      const face = waveOf(state).cards.find(card => card.pair === pair && card.kind === 'no')?.face;
      toast(`「${face || '这一对'}」被 ${nameOf(state,claim?.playerId) || '别人'} 抢先一步`);
    }
    const fresh = freshClaims(ui.lastSeq,state);
    if (fresh.length) {
      // A claim seen for the first time: everyone reads "hus — 房子 · 霍瓦尔" for a moment.
      if (state.status === 'playing') showTicker(fresh[fresh.length-1],state);
      ui.lastSeq = fresh[fresh.length-1].seq;
    }
    const results = state.results;
    if (state.status === 'finished' && results && !results.xpPending && ui.honorsFor !== state.code+':'+results.number) {
      ui.honorsFor = state.code+':'+results.number;
      try { void ui.community.honors?.({force:true}); } catch { /* Honors are optional. */ }
    }
    if (state.status === 'countdown' && previous?.status !== 'countdown') {
      try { ui.opts.prefetch?.(waveOf(state)?.cards.filter(card => card.kind === 'no').map(card => ({word:card.face})) || []); } catch { /* Audio is optional. */ }
    }
    render();
  }
  function showTicker(claim, room) {
    const node = $('#nd-ticker');
    if (!node) return;
    const extra = multiplierText(claim);
    node.innerHTML = `<span lang="nb" class="nd-ticker-no">${e(claim.no)}</span><span class="nd-ticker-sep">—</span><span class="nd-ticker-zh">${e(claim.zh)}</span><span class="nd-ticker-who">· ${e(nameOf(room,claim.playerId))}</span><b class="nd-ticker-points">+${claim.points}</b>${extra ? `<small>${e(extra)}</small>` : ''}`;
    node.classList.remove('is-shown'); void node.offsetWidth; node.classList.add('is-shown');
    clearTimeout(ui.tickerTimer);
    ui.tickerTimer = setTimeout(() => node.classList.remove('is-shown'),TICKER_MS);
  }

  /* Rendering */

  function render() {
    if (!ui.open || !ui.root) return;
    const room = ui.room, screen = screenOf(room);
    const chip = $('#nd-room-chip');
    if (chip) { chip.hidden = !room; chip.textContent = room ? `房间 ${room.code}` : ''; }
    const body = $('#nd-body');
    if (screen === 'game') {
      const key = `${room.code}:${room.round}`;
      if (ui.screen !== 'game' || ui.gameKey !== key) { body.innerHTML = gameMarkup(room); ui.gameKey = key; ui.built = ''; ui.lastPhase = ''; ui.openedWave = ''; startTicker(); keepFocus(); }
      ui.screen = screen;
      syncBoard();
      return;
    }
    if (ui.screen === 'game') { clearInterval(ui.tickTimer); ui.tickTimer = null; clearTimeout(ui.dealTimer); ui.gameKey = ''; ui.built = ''; }
    const focused = document.activeElement, focusKey = ui.root.contains(focused) && body.contains(focused) ? focused.dataset?.ndFocus || focused.id : '';
    const selection = focused?.id === 'nd-join-code' ? [focused.selectionStart,focused.selectionEnd] : null;
    const scroll = ui.root.scrollTop;
    const entering = ui.screen !== screen;
    body.innerHTML = `<div class="nd-screen${entering ? ' nd-enter' : ''}">${screen === 'lobby' ? lobbyMarkup() : screen === 'room' ? roomMarkup(room) : resultsMarkup(room)}</div>`;
    ui.screen = screen;
    if (!entering) ui.root.scrollTop = scroll;
    if (screen === 'results') rollNumbers(body,entering);
    if (focusKey) {
      const next = body.querySelector(`[data-nd-focus="${focusKey}"]`) || body.querySelector('#'+CSS.escape(focusKey));
      next?.focus?.({preventScroll:true});
      if (next && selection) next.setSelectionRange?.(...selection);
    } else if (entering && screen !== 'lobby' && !ui.picker) focusFirst();
  }
  function focusFirst() {
    const target = ui.root?.querySelector('.nd-body .nd-primary:not(:disabled)') || ui.root?.querySelector('#nd-title');
    target?.focus?.({preventScroll:true});
  }
  const messageMarkup = () => ui.message ? `<p class="nd-message" role="alert">${e(ui.message)}</p>` : '';
  const segment = (name,value,label,hint,selected,disabled=false) => `<button type="button" class="nd-option" role="radio" aria-checked="${selected}" data-nd-action="${name}" data-nd-value="${value}" data-nd-focus="${name}-${value}"${disabled ? ' disabled' : ''}><span>${label}</span>${hint ? `<small>${hint}</small>` : ''}</button>`;

  // Range, word count and mode for the next match: editable for the host, a summary for everyone else.
  function settingsEditor() {
    const summary = configSummary();
    const counts = COUNTS.map(count => segment('count',count,String(count),'',ui.config.choice === count,summary.available < count))
      .concat(segment('count','all','全部',summary.available ? String(Math.min(summary.available,MAX_POOL)) : '',ui.config.choice === 'all',!summary.available));
    return `<div class="nd-field"><span class="nd-label">词语范围</span><button type="button" class="nd-range" data-nd-action="picker" data-nd-focus="picker"><span class="nd-range-label">${summary.label ? e(summary.label) : '还没有选择范围'}</span><small>${summary.available ? `${summary.available >= MAX_POOL ? `${MAX_POOL}+` : summary.available} 词可用` : ''}</small><span class="nd-range-change">更改</span></button></div>
      <div class="nd-field"><span class="nd-label" id="nd-count-label">词数</span><div class="nd-segment nd-counts" role="radiogroup" aria-labelledby="nd-count-label">${counts.join('')}</div></div>
      <div class="nd-field"><span class="nd-label" id="nd-mode-label">玩法</span><div class="nd-segment" role="radiogroup" aria-labelledby="nd-mode-label">${Object.entries(MODES).map(([value,mode]) => segment('mode',value,mode.name,mode.hint,ui.config.mode === value)).join('')}</div></div>
      <p class="nd-estimate" aria-live="polite">${summary.count >= MIN_POOL ? `${summary.count} 词 · ${minutesLabel(summary.seconds)}，词对分波发出，抢完一波来下一波` : `所选范围至少需要 ${MIN_POOL} 个释义不同的词`}</p>`;
  }
  function settingsSummary(room) {
    const settings = room.settings;
    return `<div class="nd-summary"><p class="nd-summary-label">${settings.label ? e(settings.label) : '词语范围'}</p><p class="nd-summary-meta"><b>${settings.count}</b> 词 · ${MODES[settings.mode].name} · ${minutesLabel(settings.durationSec)}</p></div>`;
  }
  function lobbyMarkup() {
    const summary = configSummary();
    return `${messageMarkup()}<section class="nd-panel" aria-labelledby="nd-create-title"><h3 id="nd-create-title">开一个房间</h3>${settingsEditor()}
      <div class="nd-create-foot">${button('create',ui.busy ? '正在创建…' : '创建房间','nd-primary nd-wide',summary.count >= MIN_POOL && !ui.busy ? '' : 'disabled')}</div></section>
      <section class="nd-panel nd-join" aria-labelledby="nd-join-title"><h3 id="nd-join-title">加入房间</h3><form class="nd-join-form" data-nd-form="join"><label class="nd-sr" for="nd-join-code">房间号</label><input id="nd-join-code" name="code" type="text" inputmode="numeric" enterkeyhint="go" pattern="[0-9]{4}" maxlength="4" autocomplete="off" placeholder="4 位房间号" value="${e(ui.joinCode)}"><button type="submit" class="nd-button"${ui.busy ? ' disabled' : ''}>加入</button></form></section>
      <p class="nd-hint">${ui.profile ? `你将以「${e(ui.profile.nickname)}」参加，昵称可在排行榜里修改。` : '正在连接…'}每抢到一对 10 分；8 秒内连抢、金色词对和最后 30 秒冲刺都会加倍。两人以上玩满两分钟的对局计入每日任务和成就。</p>`;
  }
  function playerItem(room, player) {
    const me = player.id === room.me;
    return `<li class="nd-player${me ? ' is-me' : ''}${player.connected ? '' : ' is-away'}${player.ready ? ' is-ready' : ''}" style="--nd-color:${colorFor(room.mode,player)}"><i class="nd-dot" aria-hidden="true"></i><span class="nd-player-name">${e(player.nickname)}${me ? '<span class="nd-sr">（我）</span>' : ''}</span>${player.host ? '<span class="nd-badge">房主</span>' : ''}${player.connected ? '' : '<span class="nd-away">离线</span>'}<span class="nd-ready-mark" aria-label="${player.ready ? '已准备' : '未准备'}">${player.ready ? icon('check') : ''}</span></li>`;
  }
  function roster(room) {
    const host = isHost(room), me = meOf(room), active = room.players.filter(player => !player.left);
    if (room.mode !== 'team') return `<ul class="nd-players nd-roster">${active.map(player => playerItem(room,player)).join('')}</ul>`;
    return `<div class="nd-teams">${TEAM_IDS.map(id => { const members = active.filter(player => player.team === id); return `<section class="nd-team is-${id}" style="--nd-color:${TEAMS[id].color}"><header><span>${TEAMS[id].name}</span><small>${members.length} 人</small></header><ul class="nd-players">${members.map(player => playerItem(room,player)).join('') || '<li class="nd-player is-empty">还没有人</li>'}</ul>${me && me.team !== id ? button('team',`加入${TEAMS[id].name}`,'nd-small',`data-nd-value="${id}" data-nd-focus="team-${id}"`) : ''}</section>`; }).join('')}</div>${host && active.length > 1 ? `<div class="nd-row">${button('shuffle',`${icon('shuffle')}随机分队`,'nd-quiet nd-small','data-nd-focus="shuffle"')}</div>` : ''}`;
  }
  // One primary action: 准备. The host may also start early once half the room, and at least two people, are ready.
  function readyBar(room) {
    const me = meOf(room), host = isHost(room);
    const counted = room.readyCount+(host && !me?.ready ? 1 : 0);
    const early = host && room.readyNeeded > 1 && room.readyCount < room.readyNeeded && counted >= 2 && counted*2 >= room.readyNeeded;
    const dots = room.players.filter(player => player.connected).map(player => `<i class="${player.ready ? 'is-ready' : ''}" style="--nd-color:${colorFor(room.mode,player)}"></i>`).join('');
    return `<div class="nd-ready"><p class="nd-ready-count"><span class="nd-ready-dots" aria-hidden="true">${dots}</span>已准备 <b>${room.readyCount}</b>/${room.readyNeeded}${room.readyNeeded > 1 ? ' · 全员准备后自动开始' : ''}</p>
      ${me?.ready ? `<p class="nd-waiting">${icon('check')}已准备，等其他人…</p>${button('ready','取消准备','nd-quiet','data-nd-value="false" data-nd-focus="ready-off"')}` : button('ready','准备','nd-primary nd-wide','data-nd-value="true" data-nd-focus="ready-on"')}
      ${early ? button('start',`提前开始（${counted}/${room.readyNeeded}）`,'nd-quiet nd-small','data-nd-focus="start"') : ''}</div>`;
  }
  function nextPanel(room, title) {
    const host = isHost(room), editing = hostEditing(room);
    // Until the host changes something, the room keeps what it had; say so under the editor.
    const pending = editing && !ui.pushed.startsWith(room.code+'|') ? `<p class="nd-hint nd-hint-tight">房间当前：${e(room.settings.label || '词语范围')} · ${room.settings.count} 词 · ${MODES[room.settings.mode].name}。改动后对所有人生效。</p>` : '';
    const settings = editing ? settingsEditor()+pending : `${settingsSummary(room)}${host ? button('edit-settings','更改设置','nd-quiet nd-small','data-nd-focus="edit-settings"') : '<p class="nd-hint nd-hint-tight">房主可以调整范围和词数，改动会实时显示。</p>'}`;
    return `<section class="nd-panel nd-next" aria-labelledby="nd-next-title"><h3 id="nd-next-title">${title}</h3>${settings}${readyBar(room)}</section>`;
  }
  function roomMarkup(room) {
    const link = shareLink(location,room.code), active = room.players.filter(player => !player.left);
    return `${messageMarkup()}<section class="nd-panel nd-room" aria-labelledby="nd-room-title"><p class="nd-kicker" id="nd-room-title">房间号</p>
      <div class="nd-code-row"><span class="nd-code" aria-label="房间号 ${room.code.split('').join(' ')}">${room.code}</span>${button('copy-code',`${icon('copy')}<span>复制</span>`,'nd-quiet nd-small','data-nd-focus="copy-code"')}</div>
      <div class="nd-share"><p class="nd-link" title="${e(link)}">${e(link.replace(/^https?:\/\//,''))}</p>${button('share',`${icon('share')}<span>邀请同学</span>`,'nd-small','data-nd-focus="share"')}</div>
      <p class="nd-muted nd-center">${active.length}/${room.maxPlayers || 8} 人</p>${roster(room)}</section>
      ${nextPanel(room,'第一局')}<div class="nd-foot">${button('leave','离开房间','nd-quiet')}</div>`;
  }
  function gameMarkup(room) {
    return `<div class="nd-game nd-enter"><div class="nd-hud"><div class="nd-timer" id="nd-timer" role="timer" aria-label="剩余时间"><svg viewBox="0 0 36 36" aria-hidden="true"><circle class="nd-timer-track" cx="18" cy="18" r="15.9"/><circle class="nd-timer-ring" id="nd-timer-ring" cx="18" cy="18" r="15.9" pathLength="100"/></svg><span id="nd-time">0:00</span></div><div class="nd-scorebar" id="nd-scorebar"></div></div>
      <div class="nd-subline"><span class="nd-wave-label" id="nd-wave"></span><p class="nd-ticker" id="nd-ticker" aria-live="polite"></p></div>
      <p class="nd-watch" id="nd-watch" hidden>本局观战中，下一局一起玩。</p>
      <div class="nd-board" id="nd-board"><div class="nd-grid" id="nd-grid"></div><div class="nd-interlude" id="nd-interlude" hidden></div><div class="nd-countdown" id="nd-countdown" hidden></div><div class="nd-timeup" id="nd-timeup" hidden><span>时间到</span></div></div></div>`;
  }
  function cardMarkup(card, index) {
    return `<button type="button" class="nd-card" data-nd-card="${index}" aria-label="第 ${index+1} 张牌"><span class="nd-card-inner"><span class="nd-face nd-front ${card.kind === 'no' ? 'is-no' : 'is-zh'}"${card.kind === 'no' ? ' lang="nb"' : ' lang="zh"'}><span class="nd-text">${e(card.face)}</span><span class="nd-tag" aria-hidden="true"></span></span><span class="nd-face nd-back" aria-hidden="true">${icon('star')}</span></span></button>`;
  }
  // A new wave: the cleared board waits through the interlude, then the next cards are dealt.
  function syncBoard() {
    const room = ui.room, wave = waveOf(room), key = waveKey(room);
    if (!wave) return;
    if (ui.built === key) { patchBoard(); return; }
    const wait = wave.opensAt-serverNow();
    if (ui.built && wait > 450 && !reducedMotion()) {
      if (ui.interlude !== key) {
        ui.interlude = key;
        finishOldBoard(room);
        showInterlude(wave);
        clearTimeout(ui.dealTimer);
        ui.dealTimer = setTimeout(() => { if (waveKey(ui.room) === key) buildBoard(); },Math.max(0,wait-380));
      }
      patchHud();
      return;
    }
    buildBoard();
  }
  function buildBoard() {
    const room = ui.room, wave = waveOf(room), grid = $('#nd-grid');
    if (!wave || !grid) return;
    const count = wave.cards.length;
    grid.style.setProperty('--nd-cols-wide',columnsFor(count,false));
    grid.style.setProperty('--nd-cols-narrow',columnsFor(count,true));
    grid.style.setProperty('--nd-rows-wide',Math.ceil(count/columnsFor(count,false)));
    grid.style.setProperty('--nd-rows-narrow',Math.ceil(count/columnsFor(count,true)));
    const hadCard = !!grid.contains(document.activeElement);
    grid.innerHTML = wave.cards.map(cardMarkup).join('');
    if (hadCard) keepFocus(grid.querySelector('.nd-card'));
    grid.classList.remove('is-dealt'); void grid.offsetWidth; grid.classList.add('is-dealt');
    ui.built = waveKey(room); ui.boardWave = wave.n; ui.boardCards = wave.cards;
    ui.gone = new Set(wave.claims.map(claim => claim.pair)); ui.glowing = new Set();
    ui.local = mergeWave(ui.local,room,room.me).local;
    requestAnimationFrame(fitCards);
    patchBoard();
  }
  // Long words shrink until they fit their card; Norwegian words never break mid-word.
  function fitCards() {
    for (const text of ui.root?.querySelectorAll('.nd-text') || []) {
      const box = text.parentElement;
      text.style.fontSize = '';
      let size = parseFloat(getComputedStyle(text).fontSize) || 16;
      const limitW = box.clientWidth-10, limitH = box.clientHeight-8;
      for (let guard = 0; guard < 20 && size > 10 && (text.scrollWidth > limitW || text.scrollHeight > limitH); guard++) {
        size -= 1; text.style.fontSize = `${size}px`;
      }
    }
  }
  // The final pair of a cleared wave arrives with the next wave: give it its glow on the old board.
  function finishOldBoard(room) {
    const last = (room.match?.recent || []).filter(claim => claim.wave === ui.boardWave);
    for (const claim of last) {
      for (const node of ui.root.querySelectorAll('[data-nd-card]')) {
        const card = ui.boardCards[Number(node.dataset.ndCard)];
        if (card?.pair !== claim.pair || node.classList.contains('is-claimed')) continue;
        markClaimed(node,room,claim.playerId,card);
      }
    }
  }
  function markClaimed(node, room, playerId, card) {
    const owner = room.players.find(player => player.id === playerId);
    node.classList.add('is-up','is-claimed','is-glow');
    node.classList.toggle('is-mine',playerId === room.me);
    node.style.setProperty('--nd-claim',colorFor(room.match?.mode,owner));
    const tag = node.querySelector('.nd-tag');
    if (tag) tag.textContent = playerId === room.me ? '我' : owner?.nickname || '';
    node.disabled = true;
    node.setAttribute('aria-label',`${card.face}，${tag?.textContent || ''}抢到`);
    keepFocus(node.closest('#nd-body')?.querySelector('.nd-card:not(:disabled)'));
  }
  // Rebuilt boards and claimed cards must not strand keyboard focus outside the game.
  function keepFocus(preferred) {
    if (!ui.root || ui.root.contains(document.activeElement)) return;
    (preferred || $('#nd-title'))?.focus({preventScroll:true});
  }
  function showInterlude(wave) {
    const node = $('#nd-interlude');
    if (!node) return;
    node.innerHTML = `<i class="nd-hairline"></i><p><span>第 ${wave.n} 波</span>${wave.pass > 1 ? '<small>复习轮 · 同样的词再来一遍</small>' : ''}</p>`;
    node.hidden = false;
    node.classList.remove('is-playing'); void node.offsetWidth; node.classList.add('is-playing');
    later(() => { if (node.isConnected) node.hidden = true; },1700);
  }
  function scoreMarkup(room) {
    const {players,teams} = standings(room);
    if (room.match?.mode === 'team') {
      return `<div class="nd-team-bar">${teams.map(team => `<div class="nd-team-score is-${team.id}" style="--nd-color:${team.color}"><span class="nd-team-name">${team.name}</span><b data-nd-roll="t:${team.id}" data-nd-target="${team.points}">${ui.shown.get('t:'+team.id) ?? team.points}</b><small>${team.members.map(player => `<span class="${player.id === room.me ? 'is-me' : ''}">${e(player.id === room.me ? '我' : player.nickname)}</span>`).join('')}</small></div>`).join('')}</div>`;
    }
    return `<ol class="nd-scores" aria-label="比分">${players.map(player => `<li class="nd-score${player.id === room.me ? ' is-me' : ''}${player.connected ? '' : ' is-away'}${player.streak >= 3 ? ' is-hot' : ''}" style="--nd-color:${player.color}"><i class="nd-dot" aria-hidden="true"></i><span class="nd-score-name">${e(player.id === room.me ? '我' : player.nickname)}</span><b data-nd-roll="p:${player.id}" data-nd-target="${player.points}">${ui.shown.get('p:'+player.id) ?? player.points}</b>${player.streak >= 3 ? `<small class="nd-streak">连${player.streak}</small>` : ''}</li>`).join('')}</ol>`;
  }
  // Scores count up over ~600 ms instead of jumping.
  function rollNumbers(scope, fromZero=false) {
    for (const node of scope.querySelectorAll('[data-nd-roll]')) {
      const id = node.dataset.ndRoll, target = Number(node.dataset.ndTarget);
      const from = fromZero && !ui.shown.has(id) ? 0 : ui.shown.get(id) ?? target;
      if (from === target || reducedMotion() || document.visibilityState === 'hidden') { node.textContent = String(target); ui.shown.set(id,target); continue; }
      const start = performance.now();
      const step = time => {
        const t = Math.min(1,(time-start)/ROLL_MS), value = Math.round(from+(target-from)*(1-(1-t)**3));
        ui.shown.set(id,value);
        if (node.isConnected) node.textContent = String(value);
        if (t < 1 && node.isConnected) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      // Animation frames pause in background tabs; the true score always lands.
      later(() => { if (node.isConnected && node.dataset.ndTarget === String(target)) { node.textContent = String(target); ui.shown.set(id,target); } },ROLL_MS+80);
    }
  }
  function patchHud() {
    const room = ui.room;
    const bar = $('#nd-scorebar');
    if (bar) {
      // Rebuilt only when something changed; the numbers then count up from what is on screen.
      const signature = JSON.stringify([room.match?.mode,room.players.map(player => [player.id,player.points,player.pairs,player.streak,player.connected,player.playing,player.team])]);
      if (bar.dataset.signature !== signature) { bar.innerHTML = scoreMarkup(room); bar.dataset.signature = signature; rollNumbers(bar); }
    }
    const watch = $('#nd-watch');
    if (watch) { const me = meOf(room); watch.hidden = Boolean(me?.playing && !me.left) || room.status === 'countdown'; }
    tick();
  }
  function patchBoard() {
    const room = ui.room;
    if (!ui.open || !room || ui.screen !== 'game' || !ui.root) return;
    if (ui.built !== waveKey(room)) { patchHud(); return; }
    const wave = waveOf(room), now = Date.now(), local = ui.local || newLocal(ui.built);
    const open = waveOpen(room,serverNow());
    const claims = new Map(wave.claims.map(claim => [claim.pair,claim]));
    const me = meOf(room), playing = Boolean(me?.playing && !me.left);
    const flipped = new Set(local.flipped);
    const missed = !local.pending && local.flipped.length === 2 && now < local.lockedUntil;
    for (const node of ui.root.querySelectorAll('[data-nd-card]')) {
      const index = Number(node.dataset.ndCard), card = wave.cards[index], claim = claims.get(card.pair);
      if (claim && !node.classList.contains('is-claimed')) {
        markClaimed(node,room,claim.playerId,card);
        const fresh = !ui.gone.has(card.pair) || ui.glowing.has(card.pair);
        ui.gone.add(card.pair);
        if (fresh && !reducedMotion()) {
          // Glow softly in the claimer's colour, then fold away.
          ui.glowing.add(card.pair);
          later(() => { ui.glowing.delete(card.pair); node.classList.remove('is-glow'); node.classList.add('is-gone'); },GLOW_MS);
        } else { node.classList.remove('is-glow'); node.classList.add('is-gone'); }
        continue;
      }
      if (claim) continue;
      node.classList.toggle('is-up',flipped.has(index));
      node.classList.toggle('is-golden',card.pair === wave.golden);
      node.classList.toggle('is-miss',missed && flipped.has(index));
      node.classList.toggle('is-pending',Boolean(local.pending) && (local.pending.a === index || local.pending.b === index));
      node.disabled = !open || !playing;
      node.setAttribute('aria-label',flipped.has(index) ? card.face : `第 ${index+1} 张牌${card.pair === wave.golden ? '，金色词对' : ''}`);
    }
    patchHud();
  }
  function startTicker() {
    clearInterval(ui.tickTimer);
    ui.tickTimer = setInterval(tick,200);
  }
  function tick() {
    const room = ui.room;
    if (!ui.open || !room?.match || ui.screen !== 'game' || document.visibilityState === 'hidden') return;
    const match = room.match, now = serverNow(), phase = phaseOf(room,now), wave = match.wave;
    const remaining = Math.max(0,match.endsAt-Math.max(now,match.startsAt));
    const time = $('#nd-time');
    if (time) { const text = formatClock(remaining); if (time.textContent !== text) time.textContent = text; }
    const ring = $('#nd-timer-ring');
    if (ring) ring.style.strokeDashoffset = String(100-100*remaining/(match.durationSec*1000));
    const sprint = phase === 'playing' && remaining <= (room.sprintSec || 30)*1000 && remaining > 0;
    $('#nd-timer')?.classList.toggle('is-sprint',sprint);
    $('#nd-board')?.classList.toggle('is-sprint',sprint);
    const label = $('#nd-wave');
    if (label) { const text = `第 ${wave.n} 波${wave.pass > 1 ? ' · 复习' : ''}${sprint ? ' · 冲刺 ×2' : ''}`; if (label.textContent !== text) label.textContent = text; }
    const countdown = $('#nd-countdown');
    if (countdown) {
      const left = Math.ceil((room.startsAt-now)/1000), show = room.status === 'countdown' && left > 0;
      if (countdown.hidden === show) countdown.hidden = !show;
      if (show && countdown.dataset.value !== String(left)) {
        const me = meOf(room), host = isHost(room);
        countdown.dataset.value = String(left);
        countdown.innerHTML = `<div class="nd-countdown-inner"><p class="nd-kicker">即将开始 · ${match.poolSize} 词 · ${minutesLabel(match.durationSec)}</p><span class="nd-count-number" aria-live="assertive">${left}</span><p class="nd-countdown-note">${match.mode === 'team' ? '组队' : '个人混战'} · 第 1 波 ${wave.size} 对</p><div class="nd-actions">${host ? button('cancel','取消','nd-quiet nd-on-veil') : me?.playing ? button('ready','还没准备好','nd-quiet nd-on-veil','data-nd-value="false"') : button('ready','加入这一局','nd-quiet nd-on-veil','data-nd-value="true"')}</div></div>`;
      }
    }
    const timeup = $('#nd-timeup');
    if (timeup) { const over = room.status === 'playing' && now >= match.endsAt; if (timeup.hidden === over) timeup.hidden = !over; }
    if (phase !== ui.lastPhase || (wave && now >= wave.opensAt && ui.openedWave !== waveKey(room))) {
      ui.lastPhase = phase;
      if (now >= wave.opensAt) ui.openedWave = waveKey(room);
      if (phase === 'playing') { patchBoard(); schedulePoll(0); }
    }
  }
  function resultsMarkup(room) {
    const results = room.results, host = isHost(room);
    if (!results) return `<section class="nd-panel"><p class="nd-muted">正在结算…</p></section>`;
    const winner = results.winner;
    const title = !winner ? (results.ranking.some(row => row.points) ? '平局' : '时间到，没有人抢到词对') : winner.type === 'team' ? `${TEAMS[winner.id]?.name || ''}获胜` : winner.id === room.me ? '你赢了' : `${e(results.ranking.find(row => row.id === winner.id)?.nickname || '')} 获胜`;
    const teams = results.mode === 'team' && results.teams.length === 2 ? `<div class="nd-final-teams">${results.teams.slice().sort((a,b) => TEAM_IDS.indexOf(a.id)-TEAM_IDS.indexOf(b.id)).map(team => `<div class="nd-final-team${team.won ? ' is-won' : ''}" style="--nd-color:${TEAMS[team.id].color}"><span>${TEAMS[team.id].name}</span><b data-nd-roll="r:${results.number}:${team.id}" data-nd-target="${team.points}">${ui.shown.get(`r:${results.number}:${team.id}`) ?? 0}</b><small>${team.pairs} 对</small></div>`).join('<span class="nd-versus">:</span>')}</div>` : '';
    const xp = row => row.xp == null ? (results.xpPending ? '…' : results.xpError ? '未记录' : '') : `+${row.xp} XP`;
    const rows = results.ranking.map((row,index) => `<li class="nd-rank-row${row.id === room.me ? ' is-me' : ''}${row.rank === 1 && row.points > 0 ? ' is-first' : ''}" style="--nd-color:${colorFor(results.mode,row)};--i:${index}"><span class="nd-rank">${row.rank}</span><span class="nd-rank-main"><span class="nd-player-name"><i class="nd-dot" aria-hidden="true"></i>${e(row.nickname)}${row.id === room.me ? '<span class="nd-badge is-me">我</span>' : ''}</span><small>${row.pairs} 对 · 最高连抢 ${row.bestStreak} · ${xp(row)}</small></span><b class="nd-rank-points" data-nd-roll="r:${results.number}:${row.id}" data-nd-target="${row.points}">${ui.shown.get(`r:${results.number}:${row.id}`) ?? 0}</b></li>`).join('');
    const note = results.counts ? '' : `<p class="nd-ceremony-note">${results.present < 2 ? '结束时不足两人' : '对局不足两分钟'}，本局照常获得经验，但不计入每日任务和成就。</p>`;
    return `${messageMarkup()}<section class="nd-ceremony-card" aria-labelledby="nd-results-title"><p class="nd-kicker">第 ${results.number} 局 · ${formatClock(results.durationMs)}${results.label ? ` · ${e(results.label)}` : ''}</p><h3 id="nd-results-title" class="nd-winner">${title}</h3>${teams}<ol class="nd-ranking">${rows}</ol>${note}</section>
      ${nextPanel(room,'下一局')}${wordsMarkup(room)}<div class="nd-foot">${button('leave','离开房间','nd-quiet')}</div>`;
  }
  // Every word of the match, who took it (and how often across review passes); tap to hear it.
  function wordsMarkup(room) {
    const list = ui.words?.number === room.results?.number ? ui.words.list : room.results?.words;
    if (!list?.length) return '';
    const rows = list.map((word,index) => {
      const takers = new Map();
      for (const take of word.takes) takers.set(take.playerId,(takers.get(take.playerId) || 0)+1);
      const who = [...takers].map(([id,times]) => `${e(id === room.me ? '我' : room.results.ranking.find(row => row.id === id)?.nickname || '')}${times > 1 ? ` ×${times}` : ''}`).join('、');
      return `<li><button type="button" class="nd-word" data-nd-action="say" data-nd-value="${index}"><span class="nd-word-no" lang="nb">${e(word.no)}</span><span class="nd-word-zh">${e(word.zh)}</span><span class="nd-word-who">${who || '无人抢到'}</span>${icon('speaker')}</button></li>`;
    }).join('');
    return `<section class="nd-panel nd-words"><details${list.length <= 16 ? ' open' : ''}><summary>本局词语 <b>${list.length}</b></summary><ul class="nd-word-list">${rows}</ul></details></section>`;
  }

  /* Range picker (a sheet over the overlay) */

  function openPicker() {
    // Chapters with only some sections chosen open up, so the choice is visible.
    const opened = ui.sources.filter(source => source.parent && ui.config.tokens.includes(source.token)).map(source => source.parent);
    ui.picker = {query:'',expanded:new Set(opened),before:configSignature()};
    renderPicker();
    $('#nd-sheet-search')?.focus({preventScroll:true});
  }
  function closePicker() {
    const picker = ui.picker;
    if (!picker) return;
    ui.picker = null;
    const layer = $('#nd-sheet');
    if (layer) { layer.hidden = true; layer.innerHTML = ''; }
    savePrefs();
    render();
    $('[data-nd-focus="picker"]')?.focus({preventScroll:true});
    if (picker.before !== configSignature()) scheduleSettings();
  }
  function renderPicker() {
    const layer = $('#nd-sheet'), picker = ui.picker;
    if (!layer || !picker) return;
    const query = picker.query.trim().toLocaleLowerCase('nb');
    const matches = source => !query || source.label.toLocaleLowerCase('nb').includes(query);
    const tokens = ui.config.tokens;
    const row = (source, extra='') => `<button type="button" class="nd-pick${extra}" role="checkbox" aria-checked="${source.group === 'chapter' ? chapterState(ui.sources,tokens,source) : chosenIn(tokens,source)}" data-nd-action="pick" data-nd-value="${e(source.token)}" data-nd-focus="pick-${e(source.token)}"><span class="nd-check" aria-hidden="true">${icon('check')}</span><span class="nd-pick-label">${e(source.label)}</span><small>${source.words.length}</small></button>`;
    const mine = ui.sources.filter(source => source.group === 'mine' && matches(source));
    const chapters = ui.sources.filter(source => source.group === 'chapter').map(chapter => {
      const sections = ui.sources.filter(source => source.parent === chapter.token);
      const shownSections = sections.filter(matches);
      if (!matches(chapter) && !shownSections.length) return '';
      const expanded = picker.expanded.has(chapter.token) || (query && shownSections.length && !matches(chapter));
      return `<div class="nd-pick-chapter">${sections.length ? `<div class="nd-pick-head">${row(chapter)}<button type="button" class="nd-icon-button nd-expand" data-nd-action="expand" data-nd-value="${e(chapter.token)}" aria-expanded="${Boolean(expanded)}" aria-label="展开小节" data-nd-focus="expand-${e(chapter.token)}">${icon('down')}</button></div>` : row(chapter)}${expanded ? `<div class="nd-pick-sections">${(query ? shownSections : sections).map(section => row(section,' is-section')).join('')}</div>` : ''}</div>`;
    }).join('');
    const basics = ui.sources.filter(source => source.group === 'basics' && matches(source));
    const wordbook = ui.sources.filter(source => source.group === 'wordbook' && matches(source));
    const summary = configSummary();
    const focused = document.activeElement, focusKey = layer.contains(focused) ? focused.dataset?.ndFocus || focused.id : '';
    const scroll = layer.querySelector('.nd-sheet-body')?.scrollTop || 0;
    layer.innerHTML = `<div class="nd-sheet" role="dialog" aria-modal="true" aria-labelledby="nd-sheet-title"><header class="nd-sheet-head"><h3 id="nd-sheet-title">词语范围</h3><button type="button" class="nd-icon-button" data-nd-action="picker-done" aria-label="完成">${icon('close')}</button></header>
      <input type="search" class="nd-search" id="nd-sheet-search" placeholder="搜索章节、小节或分类" aria-label="搜索词语范围" value="${e(picker.query)}" autocomplete="off">
      <div class="nd-sheet-body">${mine.length ? `<p class="nd-group-title">我的</p><div class="nd-pick-list">${mine.map(source => row(source)).join('')}</div>` : ''}${wordbook.length ? `<p class="nd-group-title">我的词本</p><div class="nd-pick-list">${wordbook.map(source => row(source)).join('')}</div>` : ''}${chapters ? `<p class="nd-group-title">教材章节</p><div class="nd-pick-list">${chapters}</div>` : ''}${basics.length ? `<p class="nd-group-title">基础常识</p><div class="nd-pick-list">${basics.map(source => row(source)).join('')}</div>` : ''}${!mine.length && !wordbook.length && !chapters && !basics.length ? '<p class="nd-muted nd-center">没有匹配的范围</p>' : ''}</div>
      <footer class="nd-sheet-foot"><span class="nd-muted">已选 <b>${summary.available >= MAX_POOL ? `${MAX_POOL}+` : summary.available}</b> 词</span>${button('pick-all','全选','nd-quiet nd-small','data-nd-focus="pick-all"')}${button('pick-none','清空','nd-quiet nd-small','data-nd-focus="pick-none"')}${button('picker-done','完成','nd-primary nd-small','data-nd-focus="picker-done"')}</footer></div>`;
    layer.hidden = false;
    const body = layer.querySelector('.nd-sheet-body');
    if (body) body.scrollTop = scroll;
    if (focusKey) {
      const next = layer.querySelector(`[data-nd-focus="${focusKey}"]`) || layer.querySelector('#'+CSS.escape(focusKey));
      next?.focus?.({preventScroll:true});
      if (focusKey === 'nd-sheet-search' && next) { const end = next.value.length; next.setSelectionRange?.(end,end); }
    }
  }

  /* Events */

  function flip(index) {
    const room = ui.room;
    if (!room || !ui.local) return;
    const now = Date.now();
    ui.local = settleMiss(ui.local,now);
    const {local,effect} = flipCard(ui.local,room,index,now,serverNow());
    if (!effect) return;
    ui.local = local;
    if (effect.type === 'claim') void sendClaim(effect);
    if (effect.type === 'miss') {
      clearTimeout(ui.missTimer);
      ui.missTimer = setTimeout(() => { ui.local = settleMiss(ui.local,Date.now()); patchBoard(); },MISS_LOCK_MS+20);
    }
    patchBoard();
  }
  async function copyText(text, done) {
    try { await navigator.clipboard.writeText(text); toast(done); }
    catch { toast(`请手动复制：${text}`,5000); }
  }
  function onClick(event) {
    const card = event.target.closest?.('[data-nd-card]');
    if (card && ui.root.contains(card)) { if (!card.disabled) flip(Number(card.dataset.ndCard)); return; }
    const target = event.target.closest?.('[data-nd-action]');
    if (!target || target.disabled) return;
    const value = target.dataset.ndValue, room = ui.room;
    switch (target.dataset.ndAction) {
      case 'close': requestClose(); break;
      case 'confirm-stay': hideConfirm(); break;
      case 'confirm-leave': ui.confirm = false; exit(); break;
      case 'mode': if (MODES[value]) { ui.config.mode = value; savePrefs(); render(); scheduleSettings(); } break;
      case 'count': { const choice = value === 'all' ? 'all' : Number(value); if (choice === 'all' || COUNTS.includes(choice)) { ui.config.choice = choice; savePrefs(); render(); scheduleSettings(); } break; }
      case 'picker': openPicker(); break;
      case 'picker-done': closePicker(); break;
      case 'pick': ui.config.tokens = toggleSource(ui.sources,ui.config.tokens,value); ui.message = ''; renderPicker(); break;
      case 'expand': { const set = ui.picker?.expanded; if (set) { if (set.has(value)) set.delete(value); else set.add(value); renderPicker(); } break; }
      case 'pick-all': {
        // Every chapter and category on show; a whole chapter replaces any of its sections.
        const query = ui.picker?.query.trim().toLocaleLowerCase('nb') || '';
        const visible = new Set(ui.sources.filter(source => ['chapter','basics','wordbook'].includes(source.group) && (!query || source.label.toLocaleLowerCase('nb').includes(query))).map(source => source.token));
        const kept = ui.config.tokens.filter(token => !visible.has(ui.sources.find(source => source.token === token)?.parent));
        ui.config.tokens = [...new Set([...kept,...visible])];
        renderPicker(); break;
      }
      case 'pick-none': ui.config.tokens = []; renderPicker(); break;
      case 'create': void createRoom(); break;
      case 'edit-settings': if (room && isHost(room)) { ui.editing = room.code; render(); } break;
      case 'copy-code': if (room) void copyText(room.code,'房间号已复制'); break;
      case 'share': {
        if (!room) break;
        const url = shareLink(location,room.code);
        if (navigator.share) navigator.share({title:'联机翻翻乐',text:`来一起玩联机翻翻乐，房间号 ${room.code}`,url}).catch(() => {});
        else void copyText(url,'邀请链接已复制');
        break;
      }
      case 'leave': leaveRoom(); break;
      case 'ready': if (room) void setReady(value === 'true'); break;
      case 'start': if (room) void startMatch(); break;
      case 'cancel': if (room) void quietCall(`/duel/rooms/${room.code}/cancel`,{}); break;
      case 'team': if (room && TEAMS[value]) void quietCall(`/duel/rooms/${room.code}/team`,{team:value}); break;
      case 'shuffle': if (room) void quietCall(`/duel/rooms/${room.code}/team`,{shuffle:true}); break;
      case 'say': { const word = ui.words?.list?.[Number(value)]; if (word) speak(word.no); break; }
    }
  }
  function onSubmit(event) {
    if (event.target.dataset?.ndForm !== 'join') return;
    event.preventDefault();
    void joinRoom(ui.joinCode);
  }
  function onInput(event) {
    // Rebuilding the list mid-composition would cancel Chinese input; filter once the word is committed.
    if (event.isComposing) return;
    if (event.target.id === 'nd-sheet-search' && ui.picker) { ui.picker.query = event.target.value; renderPicker(); return; }
    if (event.target.id !== 'nd-join-code') return;
    const digits = event.target.value.replace(/\D/g,'').slice(0,4);
    if (event.target.value !== digits) event.target.value = digits;
    ui.joinCode = digits;
    if (ui.message) { ui.message = ''; const note = $('.nd-message'); note?.remove(); }
  }
  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); requestClose(); return; }
    if (event.key !== 'Tab') return;
    if (!ui.root?.contains(document.activeElement)) { event.preventDefault(); keepFocus(); return; }
    // Keep focus inside the overlay, and inside the sheet or the confirmation while one is open.
    const scope = ui.confirm ? $('#nd-confirm') : ui.picker ? $('#nd-sheet') : ui.root;
    const focusable = [...scope.querySelectorAll('button:not(:disabled),input:not(:disabled),summary,[tabindex="0"],h2[tabindex]')]
      .filter(node => !node.closest('[hidden]') && (ui.confirm || !node.closest('#nd-confirm')) && (ui.picker || ui.confirm || !node.closest('#nd-sheet')));
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length-1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  window.NorskDuel = {open,close:requestClose,isOpen:() => ui.open};
  window.dispatchEvent(new Event('norskduelready'));
})();
