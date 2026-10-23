/* Two quiet moments for the practice area: the finish of a set and the weekly award ceremony.
   Effects only overlay the page; they never add to or move its layout. Missing canvas or audio support skips them. */
(() => {
  'use strict';
  if (window.NorskCelebrate) return;
  const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const rand = (min,max) => min+Math.random()*(max-min);
  const pick = list => list[Math.floor(Math.random()*list.length)];
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const GOLD = ['#e9d3a0','#d8b76e','#f4e6c4','#c9a04a'];

  /* ---------- Light motes: one fixed canvas, drawn only while something moves. ---------- */
  const fx = {canvas:null,ctx:null,motes:[],emitters:[],frame:0,last:0,width:0,height:0};
  function ensureCanvas() {
    if (fx.canvas?.isConnected) return true;
    if (!document.body || typeof requestAnimationFrame !== 'function') return false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return false;
    canvas.className = 'nk-fx-canvas';
    canvas.setAttribute('aria-hidden','true');
    document.body.append(canvas);
    fx.canvas = canvas; fx.ctx = ctx;
    resize();
    window.addEventListener('resize',resize);
    // Background tabs pause animation frames; drop the scene instead of resuming it later.
    document.addEventListener('visibilitychange',() => { if (document.hidden) clear(); });
    return true;
  }
  function resize() {
    const ratio = Math.min(2,window.devicePixelRatio || 1);
    fx.width = window.innerWidth; fx.height = window.innerHeight;
    fx.canvas.width = Math.round(fx.width*ratio); fx.canvas.height = Math.round(fx.height*ratio);
    fx.ctx.setTransform(ratio,0,0,ratio,0,0);
  }
  function mote(options) { fx.motes.push({life:0,ttl:3,vx:0,vy:0,size:1.6,alpha:.8,sway:0,phase:Math.random()*6.28,color:pick(GOLD),...options}); }
  function play() {
    if (fx.frame || reduced() || !ensureCanvas()) return false;
    fx.last = performance.now();
    fx.frame = requestAnimationFrame(step);
    return true;
  }
  function clear() {
    fx.motes = []; fx.emitters = [];
    if (fx.frame) cancelAnimationFrame(fx.frame);
    fx.frame = 0;
    fx.ctx?.clearRect(0,0,fx.width,fx.height);
  }
  function step(time) {
    const dt = Math.min(.05,Math.max(0,(time-fx.last)/1000)), ctx = fx.ctx;
    fx.last = time;
    ctx.clearRect(0,0,fx.width,fx.height);
    fx.emitters = fx.emitters.filter(emitter => emitter.tick(dt) !== false);
    fx.motes = fx.motes.filter(m => {
      m.life += dt;
      if (m.life >= m.ttl) return false;
      m.x += (m.vx+Math.sin(m.life*1.3+m.phase)*m.sway)*dt; m.y += m.vy*dt;
      if (m.ring) {
        const t = m.life/m.ttl;
        ctx.globalAlpha = m.alpha*(1-t)**2;
        ctx.strokeStyle = m.color; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(m.x,m.y,m.radius+m.grow*(1-(1-t)**3),0,6.283); ctx.stroke();
        return true;
      }
      // Fade in, hold, fade out, with a slow shimmer.
      const t = m.life/m.ttl, envelope = Math.min(1,t/.2)*Math.min(1,(1-t)/.35);
      ctx.globalAlpha = m.alpha*envelope*(.7+.3*Math.sin(m.life*3+m.phase));
      const glow = ctx.createRadialGradient(m.x,m.y,0,m.x,m.y,m.size*3);
      glow.addColorStop(0,m.color); glow.addColorStop(.35,m.color+'88'); glow.addColorStop(1,m.color+'00');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(m.x,m.y,m.size*3,0,6.283); ctx.fill();
      return true;
    });
    ctx.globalAlpha = 1;
    if (fx.motes.length || fx.emitters.length) fx.frame = requestAnimationFrame(step);
    else { fx.frame = 0; ctx.clearRect(0,0,fx.width,fx.height); }
  }
  const rectOf = node => { const box = node?.getBoundingClientRect?.(); return box && box.width ? box : null; };

  /* ---------- Finishing a set ---------- */
  function countUp(node,to,decimals=0) {
    if (!node || reduced() || !Number.isFinite(to) || typeof requestAnimationFrame !== 'function') return;
    const start = performance.now(), duration = 1100, format = value => decimals ? value.toFixed(decimals) : String(Math.round(value));
    const tick = now => {
      const t = Math.min(1,(now-start)/duration);
      node.textContent = format(to*(1-(1-t)**4));
      if (t < 1 && node.isConnected) requestAnimationFrame(tick); else node.textContent = format(to);
    };
    node.textContent = format(0);
    requestAnimationFrame(tick);
    // Paused animation frames (a background tab) must never leave the score unfinished.
    setTimeout(() => { node.textContent = format(to); },duration+150);
  }
  // A band of light crosses the results card once; it sits above the card and is removed afterwards.
  function sheen(card,strength) {
    if (!card || reduced()) return;
    const layer = document.createElement('div');
    layer.className = `nk-sheen is-${strength}`;
    layer.setAttribute('aria-hidden','true');
    card.append(layer);
    setTimeout(() => layer.remove(),2200);
  }
  // Fine gold dust rising inside the card.
  function dust(card,count) {
    const box = rectOf(card);
    if (!box || !play()) return;
    for (let i=0;i<count;i++) mote({x:rand(box.left+12,box.right-12),y:rand(box.top+box.height*.45,box.bottom-6),vy:-rand(14,34),sway:rand(4,10),size:rand(1,2.2),ttl:rand(2.2,3.4),alpha:rand(.55,.9),life:-rand(0,.9)});
  }
  // A thin ring of light opens from the score.
  function halo(card) {
    const box = rectOf(card?.querySelector?.('.pr-score'));
    if (!box || !play()) return;
    const x = box.left+box.width/2, y = box.top+box.height/2, radius = box.width/2+8;
    mote({ring:true,x,y,radius,grow:46,ttl:1.6,alpha:.75,color:'#c9a04a'});
    mote({ring:true,x,y,radius,grow:30,ttl:1.6,alpha:.45,color:'#e9d3a0',life:-.25});
    for (let i=0;i<14;i++) { const angle = rand(0,6.283), r = radius+rand(4,24); mote({x:x+Math.cos(angle)*r,y:y+Math.sin(angle)*r,vx:Math.cos(angle)*rand(4,12),vy:Math.sin(angle)*rand(4,12)-8,size:rand(1,1.8),ttl:rand(1.6,2.4),life:-rand(.1,.5)}); }
  }
  // Only clearly good results get light; the rest simply see their score arrive.
  const FINISHES = {
    perfect:[card => { sheen(card,'gold'); dust(card,34); },card => { halo(card); dust(card,16); }],
    great:[card => sheen(card,'soft'),card => dust(card,14)],
    record:[card => { halo(card); sheen(card,'gold'); }],
  };
  let lastFinish = -1;
  function complete({ratio=0,newBest=false,score,decimals=0,anchor}={}) {
    countUp(anchor?.querySelector?.('.pr-score strong'),score,decimals);
    const tier = newBest ? 'record' : ratio >= 1 ? 'perfect' : ratio >= .8 ? 'great' : '';
    const options = FINISHES[tier];
    if (!options || !anchor) return;
    // Alternate between the variants so the same finish does not repeat twice in a row.
    let index = Math.floor(Math.random()*options.length);
    if (options.length > 1 && index === lastFinish) index = (index+1)%options.length;
    lastFinish = index;
    setTimeout(() => { if (anchor.isConnected) options[index](anchor); },350);
  }

  /* ---------- Sound: one warm chord for the ceremony ---------- */
  const audio = {context:null};
  function chord(notes,{spread=.06,length=1.6,volume=.028}={}) {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext || document.hidden) return;
      const context = audio.context ||= new AudioContext();
      const sound = () => {
        const start = context.currentTime+.02;
        notes.forEach((frequency,index) => {
          const oscillator = context.createOscillator(), gain = context.createGain(), at = start+index*spread;
          oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency,at);
          gain.gain.setValueAtTime(.0001,at); gain.gain.exponentialRampToValueAtTime(volume,at+.06); gain.gain.exponentialRampToValueAtTime(.0001,at+length);
          oscillator.connect(gain); gain.connect(context.destination);
          oscillator.start(at); oscillator.stop(at+length+.05);
        });
      };
      if (context.state === 'suspended') Promise.resolve(context.resume()).then(() => { if (context.state === 'running') sound(); }).catch(() => {});
      else sound();
    } catch { /* Sound is optional. */ }
  }

  /* ---------- Weekly award ceremony ---------- */
  const METALS = {1:['#f6e7bf','#d9b25f','#9c7426'],2:['#f4f6f7','#c3cbd0','#7d878d'],3:['#f1d2b6','#c48a5c','#7f4f2c']};
  let trophyId = 0;
  function trophy(rank) {
    const [light,mid,dark] = METALS[rank], id = `nk-trophy-${++trophyId}`;
    return `<svg class="nk-trophy" viewBox="0 0 80 100" aria-hidden="true"><defs><linearGradient id="${id}-m" x1="0" x2="1"><stop offset="0" stop-color="${dark}"/><stop offset=".3" stop-color="${mid}"/><stop offset=".52" stop-color="${light}"/><stop offset=".75" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient><linearGradient id="${id}-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3a34"/><stop offset="1" stop-color="#121c18"/></linearGradient><clipPath id="${id}-c"><path d="M20 10h40v16c0 15-8.5 25-20 27-11.5-2-20-12-20-27z"/></clipPath></defs><path fill="none" stroke="${mid}" stroke-width="2.4" d="M20.5 16H11c0 12 5 18 12.5 19.5M59.5 16H69c0 12-5 18-12.5 19.5"/><path fill="url(#${id}-m)" d="M20 10h40v16c0 15-8.5 25-20 27-11.5-2-20-12-20-27z"/><g clip-path="url(#${id}-c)"><rect class="nk-trophy-shine" x="-24" y="4" width="10" height="56" fill="#ffffff" opacity=".55" transform="skewX(-18)"/></g><path fill="url(#${id}-m)" d="M37 53h6l1.5 12h-9z"/><path fill="url(#${id}-m)" d="M29 65h22l2 6H27z"/><rect x="22" y="71" width="36" height="16" rx="1.5" fill="url(#${id}-s)"/><rect x="26" y="77" width="28" height="4" rx="1" fill="${mid}" opacity=".7"/></svg>`;
  }
  function weekLabel(weekStart) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStart || '');
    if (!match) return '';
    const first = new Date(Date.UTC(+match[1],+match[2]-1,+match[3])), last = new Date(first.getTime()+6*86400000);
    const label = date => `${date.getUTCMonth()+1}月${date.getUTCDate()}日`;
    return `${label(first)} – ${label(last)}`;
  }
  let ceremonyOpen = false;
  function ceremony({entries=[],weekStart='',meId=''}={}) {
    const winners = entries.filter(entry => entry && entry.rank >= 1 && entry.rank <= 3).slice(0,3);
    if (!winners.length || !document.body || ceremonyOpen) return Promise.resolve(false);
    ceremonyOpen = true;
    return new Promise(resolve => {
      const mine = winners.find(entry => entry.id === meId);
      const order = [2,1,3].map(rank => winners.find(entry => entry.rank === rank)).filter(Boolean);
      const delays = {3:.7,2:1.3,1:2};
      const labels = {1:'第一名',2:'第二名',3:'第三名'};
      const previousFocus = document.activeElement;
      const layer = document.createElement('div');
      layer.className = 'nk-ceremony';
      layer.setAttribute('role','dialog'); layer.setAttribute('aria-modal','true'); layer.setAttribute('aria-labelledby','nk-ceremony-title');
      layer.innerHTML = `<div class="nk-ceremony-light" aria-hidden="true"></div><div class="nk-ceremony-inner"><p class="nk-ceremony-kicker" lang="nb">Ukens mestere</p><h2 id="nk-ceremony-title">上周领奖台</h2><p class="nk-ceremony-dates">${escapeHTML(weekLabel(weekStart))}</p><ol class="nk-podium">${order.map(entry => `<li class="nk-place is-${entry.rank}${entry.id === meId ? ' is-me' : ''}" style="--delay:${delays[entry.rank]}s" aria-label="${labels[entry.rank]}：${escapeHTML(entry.nickname)}，${Number(entry.xp) || 0} XP"><div class="nk-place-award">${trophy(entry.rank)}</div><strong class="nk-place-name"><span class="nk-place-text">${escapeHTML(entry.nickname)}</span>${entry.id === meId ? '<span class="nk-place-me">我</span>' : ''}</strong><span class="nk-place-xp">${Number(entry.xp).toLocaleString('zh-CN')} XP</span><div class="nk-place-plinth"><span>${entry.rank}</span></div></li>`).join('')}</ol><p class="nk-ceremony-note">${mine ? `你是上周${labels[mine.rank]}。` : '新的一周已经开始。'}</p><button type="button" class="nk-ceremony-close">${mine ? '收下奖杯' : '继续'}</button></div>`;
      document.body.append(layer);
      document.body.classList.add('nk-ceremony-open');
      const timers = [];
      const later = (run,seconds) => timers.push(setTimeout(run,seconds*1000));
      const button = layer.querySelector('.nk-ceremony-close');
      let closing = false;
      const close = () => {
        if (closing) return;
        closing = true;
        timers.forEach(clearTimeout);
        fx.emitters = fx.emitters.filter(emitter => emitter !== falling);
        document.removeEventListener('keydown',onKey,true);
        layer.classList.add('is-leaving');
        setTimeout(() => {
          layer.remove(); document.body.classList.remove('nk-ceremony-open'); ceremonyOpen = false;
          previousFocus?.focus?.({preventScroll:true}); resolve(true);
        },reduced() ? 0 : 500);
      };
      const onKey = event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        else if (event.key === 'Tab') { event.preventDefault(); button.focus(); }
      };
      document.addEventListener('keydown',onKey,true);
      button.addEventListener('click',close);
      // Slow gold dust drifts down for as long as the ceremony is open.
      let waiting = 0;
      const falling = {tick:dt => {
        waiting -= dt;
        if (waiting <= 0 && fx.motes.length < 46) { waiting = rand(.08,.2); mote({x:rand(0,fx.width),y:-8,vy:rand(14,30),sway:rand(6,14),size:rand(.8,1.8),ttl:rand(7,11),alpha:rand(.35,.7)}); }
        return true;
      }};
      if (reduced()) { button.focus({preventScroll:true}); return; }
      if (play() || fx.frame) fx.emitters.push(falling);
      // The winner's halo arrives with one soft chord.
      if (winners.some(entry => entry.rank === 1)) later(() => chord([261.63,392,523.25,659.25]),delays[1]+.5);
      later(() => button.focus({preventScroll:true}),3.2);
    });
  }

  window.NorskCelebrate = {complete,ceremony,weekLabel,clear};
  window.dispatchEvent(new Event('norskcelebrateready'));
})();
