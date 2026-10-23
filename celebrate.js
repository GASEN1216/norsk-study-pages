/* Practice celebrations: answer sparkles, combo badges, completion scenes, level-ups and the weekly trophy ceremony.
   Everything here is decorative. Missing canvas, audio or animation support simply skips the effect. */
(() => {
  'use strict';
  if (window.NorskCelebrate) return;
  const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const rand = (min,max) => min+Math.random()*(max-min);
  const pick = list => list[Math.floor(Math.random()*list.length)];
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const PALETTES = {
    flag:['#ba0c2f','#ffffff','#00205b','#e8475f','#3b5ba5'],
    meadow:['#6aa57e','#2c8455','#c9952b','#e0b057','#8fae7e','#f2d48a'],
    aurora:['#5ee0b5','#7ad7f0','#a78bfa','#f0abfc','#86efac'],
    gold:['#f5c542','#e0a92e','#fff2b3','#d6a330','#ffd36e'],
    autumn:['#c0533a','#e07b2a','#d6a330','#a5751f','#b5523b'],
    pastel:['#f4a6b7','#a6d8f4','#b9e4a6','#f9dc8c','#cdb4f4'],
    silver:['#e6ebee','#b9c3c9','#ffffff','#a7b0b4'],
    bronze:['#d79a6a','#c08457','#f0c8a4','#a4683f'],
  };

  /* ---------- Particle engine: one fixed canvas, drawn only while something moves. ---------- */
  const fx = {canvas:null,ctx:null,particles:[],emitters:[],frame:0,last:0,width:0,height:0};
  function ensureCanvas() {
    if (fx.canvas?.isConnected) return true;
    if (!document.body || typeof requestAnimationFrame !== 'function') return false;
    const canvas = document.createElement('canvas');
    canvas.className = 'nk-fx-canvas';
    canvas.setAttribute('aria-hidden','true');
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return false;
    document.body.append(canvas);
    fx.canvas = canvas; fx.ctx = ctx;
    resize();
    window.addEventListener('resize',resize);
    // Background tabs pause animation frames; drop the scene instead of resuming it later.
    document.addEventListener('visibilitychange',() => { if (document.hidden) clearAll(); });
    return true;
  }
  function resize() {
    if (!fx.canvas) return;
    const ratio = Math.min(2,window.devicePixelRatio || 1);
    fx.width = window.innerWidth; fx.height = window.innerHeight;
    fx.canvas.width = Math.round(fx.width*ratio); fx.canvas.height = Math.round(fx.height*ratio);
    fx.ctx.setTransform(ratio,0,0,ratio,0,0);
  }
  function add(particle) {
    fx.particles.push({life:0,ttl:2,vx:0,vy:0,gravity:0,drag:0,rotation:0,spin:0,size:6,alpha:1,fade:.3,wobble:0,wobbleSpeed:1,flipSpeed:8,phase:Math.random()*6.28,...particle});
  }
  function run() {
    if (fx.frame || !ensureCanvas()) return;
    fx.last = performance.now();
    fx.frame = requestAnimationFrame(step);
  }
  function clearAll() {
    fx.particles = []; fx.emitters = [];
    if (fx.frame) cancelAnimationFrame(fx.frame);
    fx.frame = 0;
    fx.ctx?.clearRect(0,0,fx.width,fx.height);
  }
  function step(time) {
    const dt = Math.min(.05,Math.max(0,(time-fx.last)/1000)); fx.last = time;
    const ctx = fx.ctx;
    ctx.clearRect(0,0,fx.width,fx.height);
    fx.emitters = fx.emitters.filter(emitter => { emitter.age = (emitter.age || 0)+dt; return emitter.tick(dt,emitter.age) !== false; });
    const alive = [];
    for (const p of fx.particles) {
      p.life += dt;
      if (p.life >= p.ttl) { p.onDeath?.(p); continue; }
      const drag = Math.max(0,1-p.drag*dt);
      p.vx = p.vx*drag + Math.sin(p.life*p.wobbleSpeed+p.phase)*p.wobble*dt;
      p.vy = p.vy*drag + p.gravity*dt;
      p.x += p.vx*dt; p.y += p.vy*dt; p.rotation += p.spin*dt;
      if (p.trail) { (p.history ||= []).push([p.x,p.y]); if (p.history.length > p.trail) p.history.shift(); }
      const remaining = p.ttl-p.life;
      const alpha = p.alpha*Math.min(1,remaining/Math.max(.01,p.fade))*Math.min(1,p.life/.06+.2);
      draw(ctx,p,Math.max(0,Math.min(1,alpha)));
      alive.push(p);
    }
    fx.particles = alive;
    if (fx.particles.length || fx.emitters.length) fx.frame = requestAnimationFrame(step);
    else { fx.frame = 0; ctx.clearRect(0,0,fx.width,fx.height); }
  }
  function starPath(ctx,radius,points=5,inset=.45) {
    ctx.beginPath();
    for (let i=0;i<points*2;i++) {
      const r = i%2 ? radius*inset : radius, angle = i*Math.PI/points-Math.PI/2;
      ctx[i ? 'lineTo' : 'moveTo'](Math.cos(angle)*r,Math.sin(angle)*r);
    }
    ctx.closePath();
  }
  function draw(ctx,p,alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color; ctx.strokeStyle = p.color;
    if (p.trail && p.history?.length > 1) {
      ctx.lineWidth = p.size*.6; ctx.lineCap = 'round';
      ctx.beginPath(); p.history.forEach(([x,y],i) => ctx[i ? 'lineTo' : 'moveTo'](x,y)); ctx.stroke();
    }
    ctx.translate(p.x,p.y); ctx.rotate(p.rotation);
    switch (p.shape) {
      case 'rect': { const flip = Math.cos(p.life*p.flipSpeed+p.phase); ctx.scale(1,flip); ctx.fillRect(-p.size/2,-p.size*.32,p.size,p.size*.64); break; }
      case 'ribbon': { const flip = Math.cos(p.life*p.flipSpeed+p.phase); ctx.scale(flip,1); ctx.fillRect(-p.size*.18,-p.size,p.size*.36,p.size*2); break; }
      case 'circle': ctx.beginPath(); ctx.arc(0,0,p.size/2,0,6.283); ctx.fill(); break;
      case 'star': starPath(ctx,p.size); ctx.fill(); break;
      case 'twinkle': { const pulse = .55+.45*Math.sin(p.life*9+p.phase); ctx.scale(pulse,pulse); starPath(ctx,p.size,4,.22); ctx.fill(); break; }
      case 'spark': ctx.shadowColor = p.color; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(0,0,p.size/2,0,6.283); ctx.fill(); break;
      case 'snow': { const gradient = ctx.createRadialGradient(0,0,0,0,0,p.size); gradient.addColorStop(0,'#ffffff'); gradient.addColorStop(1,'#ffffff00'); ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(0,0,p.size,0,6.283); ctx.fill(); break; }
      case 'leaf': {
        const flip = .35+.65*Math.abs(Math.cos(p.life*p.flipSpeed+p.phase)); ctx.scale(flip,1);
        ctx.beginPath(); ctx.moveTo(0,-p.size); ctx.quadraticCurveTo(p.size*.8,-p.size*.2,0,p.size); ctx.quadraticCurveTo(-p.size*.8,-p.size*.2,0,-p.size); ctx.fill();
        ctx.globalAlpha = alpha*.45; ctx.strokeStyle = '#00000055'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0,-p.size*.85); ctx.lineTo(0,p.size*1.25); ctx.stroke();
        break;
      }
      case 'balloon': {
        const r = p.size;
        ctx.rotate(-p.rotation+Math.sin(p.life*1.6+p.phase)*.12);
        ctx.strokeStyle = '#7c877f88'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0,r*1.18); ctx.bezierCurveTo(r*.3,r*1.8,-r*.3,r*2.3,r*.1,r*3.1); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(0,0,r*.86,r,0,0,6.283); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-r*.14,r*1.16); ctx.lineTo(r*.14,r*1.16); ctx.lineTo(0,r*.96); ctx.fill();
        ctx.fillStyle = '#ffffff66'; ctx.beginPath(); ctx.ellipse(-r*.32,-r*.38,r*.16,r*.28,-.5,0,6.283); ctx.fill();
        break;
      }
      case 'ring': { const grow = p.life/p.ttl; ctx.lineWidth = 3*(1-grow)+.5; ctx.beginPath(); ctx.arc(0,0,p.size*(.2+grow),0,6.283); ctx.stroke(); break; }
    }
    ctx.restore();
  }
  const SHAPES = ['rect','rect','ribbon','circle','star'];
  const confettiPiece = (x,y,vx,vy,palette,extra={}) => add({x,y,vx,vy,shape:pick(SHAPES),color:pick(palette),size:rand(7,12),gravity:520,drag:1.6,spin:rand(-8,8),flipSpeed:rand(6,14),wobble:rand(30,90),wobbleSpeed:rand(2,5),ttl:rand(2.4,3.6),fade:.6,...extra});

  /* ---------- Scenes ---------- */
  const effects = {
    cannons(palette=PALETTES.flag,count=70) {
      const {width:w,height:h} = fx;
      for (const side of [-1,1]) for (let i=0;i<count;i++) {
        const angle = (side < 0 ? -62 : -118)+rand(-16,16), speed = rand(700,1200)*Math.min(1.2,h/800+.4);
        confettiPiece(side < 0 ? -10 : w+10,h*.92,Math.cos(angle*Math.PI/180)*speed,Math.sin(angle*Math.PI/180)*speed,palette,{delay:0});
      }
    },
    rain(palette=PALETTES.meadow,count=140,duration=1.6) {
      let made = 0;
      fx.emitters.push({tick:(dt,age) => {
        const due = Math.min(count,Math.round(count*age/duration));
        for (;made<due;made++) confettiPiece(rand(0,fx.width),-20,rand(-60,60),rand(60,220),palette,{gravity:180,drag:.9,ttl:rand(3.4,4.8)});
        return made < count;
      }});
    },
    burst(x,y,palette=PALETTES.gold,count=40,{speed=[260,620],shapes=['star','circle','spark'],size=[5,10],gravity=380,ttl=[.9,1.6]}={}) {
      for (let i=0;i<count;i++) {
        const angle = rand(0,6.283), velocity = rand(...speed);
        add({x,y,vx:Math.cos(angle)*velocity,vy:Math.sin(angle)*velocity,shape:pick(shapes),color:pick(palette),size:rand(...size),gravity,drag:2.4,spin:rand(-6,6),ttl:rand(...ttl),fade:.5});
      }
    },
    ring(x,y,color='#f5c542',size=120) { add({x,y,shape:'ring',color,size,ttl:.7,fade:.7}); },
    fireworks(duration=2.6,palettes=[PALETTES.gold,PALETTES.aurora,PALETTES.flag,PALETTES.pastel]) {
      let next = 0;
      fx.emitters.push({tick:(dt,age) => {
        if (age >= next && age < duration) {
          next = age+rand(.18,.38);
          const palette = pick(palettes), x = rand(fx.width*.15,fx.width*.85), target = rand(fx.height*.12,fx.height*.42);
          add({x,y:fx.height+10,vx:rand(-40,40),vy:-Math.sqrt(2*620*(fx.height-target)),gravity:620,shape:'spark',color:'#fff2c4',size:4,trail:8,ttl:Math.sqrt(2*(fx.height-target)/620),fade:.01,
            onDeath:p => {
              effects.burst(p.x,p.y,palette,56,{speed:[120,420],shapes:['spark','spark','twinkle'],size:[3,6],gravity:160,ttl:[1.1,1.8]});
              effects.ring(p.x,p.y,palette[0],90);
            }});
        }
        return age < duration+.1;
      }});
    },
    balloons(palette=PALETTES.pastel,count=16) {
      for (let i=0;i<count;i++) add({x:rand(fx.width*.06,fx.width*.94),y:fx.height+rand(40,360),vx:0,vy:-rand(150,260),shape:'balloon',color:pick(palette),size:rand(18,30),gravity:-10,wobble:rand(20,50),wobbleSpeed:rand(1,2),ttl:rand(4.2,5.6),fade:.8});
    },
    leaves(count=46) {
      for (let i=0;i<count;i++) add({x:rand(-40,fx.width+40),y:rand(-200,-10),vx:rand(-20,40),vy:rand(50,110),shape:'leaf',color:pick(PALETTES.autumn),size:rand(7,12),gravity:30,drag:.6,spin:rand(-2.5,2.5),flipSpeed:rand(2,4),wobble:rand(60,140),wobbleSpeed:rand(1.2,2.4),ttl:rand(4.5,6),fade:1});
    },
    snow(count=90) {
      for (let i=0;i<count;i++) add({x:rand(0,fx.width),y:rand(-fx.height*.6,-6),vx:rand(-15,15),vy:rand(40,90),shape:'snow',color:'#fff',size:rand(2,5),gravity:8,wobble:rand(15,40),wobbleSpeed:rand(1,2.5),ttl:rand(4.5,6.5),fade:1.2,alpha:.95});
    },
    stars(x=fx.width/2,y=fx.height*.42) {
      effects.burst(x,y,PALETTES.gold,70,{speed:[300,900],shapes:['star','star','twinkle'],size:[7,14],gravity:420,ttl:[1.4,2.2]});
      effects.ring(x,y,'#f5c542',160);
    },
    twinkles(count=40) {
      for (let i=0;i<count;i++) add({x:rand(0,fx.width),y:rand(0,fx.height*.55),shape:'twinkle',color:pick(['#ffffff','#fff2b3','#c4f1ff']),size:rand(3,7),ttl:rand(1.6,3.2),fade:.8});
    },
  };

  /* ---------- Sound: short synthesized phrases for the big moments. ---------- */
  const audio = {context:null};
  function chord(notes,{gap=.11,length=.32,type='triangle',volume=.06}={}) {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext || document.hidden) return;
      const context = audio.context ||= new AudioContext();
      const play = () => {
        const start = context.currentTime+.02;
        notes.forEach((frequency,index) => {
          const oscillator = context.createOscillator(), gain = context.createGain(), at = start+index*gap;
          oscillator.type = type; oscillator.frequency.setValueAtTime(frequency,at);
          gain.gain.setValueAtTime(.0001,at); gain.gain.exponentialRampToValueAtTime(volume,at+.02); gain.gain.exponentialRampToValueAtTime(.0001,at+length);
          oscillator.connect(gain); gain.connect(context.destination);
          oscillator.start(at); oscillator.stop(at+length+.02);
        });
      };
      if (context.state === 'suspended') Promise.resolve(context.resume()).then(() => { if (context.state === 'running') play(); }).catch(() => {});
      else play();
    } catch { /* Sound is optional. */ }
  }
  const FANFARE = [523.25,659.25,783.99,1046.5,783.99,1046.5,1318.51];
  const LEVEL_UP = [392,523.25,659.25,783.99,1046.5];

  /* ---------- Overlays run one at a time, so a level-up waits for the completion scene. ---------- */
  const overlays = {queue:[],active:null,lastCompleteAt:0};
  function enqueue(open) {
    return new Promise(resolve => {
      overlays.queue.push(() => open().then(resolve,resolve));
      if (!overlays.active) nextOverlay();
    });
  }
  function nextOverlay() {
    const open = overlays.queue.shift();
    if (!open) { overlays.active = null; return; }
    overlays.active = open().finally(nextOverlay);
  }
  // A decorative card that closes by itself, on a click, or with Escape.
  function flash(markup,{className='',duration=3000,onOpen}={}) {
    return new Promise(resolve => {
      if (!document.body) { resolve(); return; }
      const layer = document.createElement('div');
      layer.className = `nk-flash ${className}`;
      layer.innerHTML = markup;
      document.body.append(layer);
      let closed = false, timer;
      const close = () => {
        if (closed) return; closed = true;
        clearTimeout(timer); document.removeEventListener('keydown',onKey,true);
        layer.classList.add('is-leaving');
        setTimeout(() => { layer.remove(); resolve(); },reduced() ? 0 : 260);
      };
      const onKey = event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
      layer.addEventListener('click',close);
      document.addEventListener('keydown',onKey,true);
      timer = setTimeout(close,duration);
      onOpen?.(layer);
    });
  }
  const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z"/></svg>';
  const BADGES = {
    crown:'<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="#f5c542" stroke="#b8792a" stroke-width="2.5" stroke-linejoin="round" d="M8 22l13 11 11-19 11 19 13-11-5 28H13z"/><rect x="13" y="50" width="38" height="6" rx="2" fill="#e0a92e" stroke="#b8792a" stroke-width="2.5"/><circle cx="32" cy="38" r="4" fill="#ba0c2f"/><circle cx="8" cy="22" r="3.5" fill="#fff2b3"/><circle cx="32" cy="14" r="3.5" fill="#fff2b3"/><circle cx="56" cy="22" r="3.5" fill="#fff2b3"/></svg>',
    medal:'<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="#3b5ba5" d="M18 4h12l6 18h-12z"/><path fill="#ba0c2f" d="M46 4H34l-6 18h12z"/><circle cx="32" cy="40" r="19" fill="#f5c542" stroke="#b8792a" stroke-width="3"/><circle cx="32" cy="40" r="12" fill="none" stroke="#fff2b3" stroke-width="2"/><path fill="#fff" d="m32 31 2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/></svg>',
    rocket:'<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="#e8475f" d="M20 40l-8 4 6-14zM44 40l8 4-6-14z"/><path fill="#fffdf8" stroke="#244d43" stroke-width="2.5" d="M32 4c10 8 14 20 12 38H20C18 24 22 12 32 4z"/><circle cx="32" cy="22" r="5" fill="#7ad7f0" stroke="#244d43" stroke-width="2.5"/><path fill="#f5c542" d="M24 44h16l-4 12-4-6-4 6z"/></svg>',
    sprout:'<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="#a5751f" d="M14 46h36l-4 14H18z"/><path fill="none" stroke="#2c8455" stroke-width="3.5" stroke-linecap="round" d="M32 46V26"/><path fill="#6aa57e" d="M32 30C32 18 22 12 10 14c0 11 9 17 22 16z"/><path fill="#8fae7e" d="M32 26c0-10 8-16 20-15 0 10-8 16-20 15z"/></svg>',
    clock:'<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="36" r="22" fill="#fffdf8" stroke="#244d43" stroke-width="3.5"/><path fill="#244d43" d="M27 6h10v6H27z"/><path fill="none" stroke="#ba0c2f" stroke-width="3.5" stroke-linecap="round" d="M32 36 42 26"/><path fill="none" stroke="#244d43" stroke-width="3" stroke-linecap="round" d="M32 20v4M48 36h-4M32 52v-4M16 36h4"/></svg>',
  };
  const PHRASES = {
    perfect:[['Perfekt!','满分，完美！'],['Fantastisk!','太棒了，一个没错！'],['Helt rått!','无懈可击！']],
    great:[['Kjempebra!','非常好！'],['Supert!','超棒的一组！'],['Strålende!','闪闪发光！']],
    good:[['Bra jobbet!','做得不错！'],['Godt gått!','稳步前进！'],['Fint!','继续保持！']],
    grow:[['Fortsett!','每练一次都在进步'],['Øvelse gjør mester!','熟能生巧'],['Ikke gi opp!','别放弃，再来一组']],
    record:[['Ny rekord!','刷新个人最佳！']],
  };
  // Several scenes per tier; the last scene is not repeated right away.
  const SCENES = {
    perfect:[
      {id:'fireworks',badge:'crown',run:() => { effects.fireworks(); setTimeout(() => effects.rain(PALETTES.gold,80,1.2),500); }},
      {id:'aurora',badge:'crown',aurora:true,run:() => { effects.twinkles(50); effects.stars(); setTimeout(() => effects.rain(PALETTES.aurora,90,1.4),300); }},
      {id:'royal',badge:'medal',run:() => { effects.cannons(PALETTES.gold,80); setTimeout(() => effects.stars(),250); }},
    ],
    great:[
      {id:'flag',badge:'medal',run:() => effects.cannons(PALETTES.flag,70)},
      {id:'starburst',badge:'medal',run:() => { effects.stars(); effects.rain(PALETTES.meadow,70,1.2); }},
      {id:'balloons',badge:'rocket',run:() => { effects.balloons(PALETTES.pastel,18); effects.cannons(PALETTES.pastel,36); }},
    ],
    good:[
      {id:'balloons-light',badge:'rocket',run:() => effects.balloons(PALETTES.pastel,12)},
      {id:'meadow',badge:'medal',run:() => effects.rain(PALETTES.meadow,110,1.4)},
      {id:'leaves',badge:'sprout',run:() => { effects.leaves(40); effects.rain(PALETTES.autumn,40,1); }},
    ],
    grow:[
      {id:'snow',badge:'sprout',run:() => effects.snow(90)},
      {id:'leaves-soft',badge:'sprout',run:() => effects.leaves(36)},
      {id:'twinkle',badge:'sprout',run:() => effects.twinkles(60)},
    ],
    record:[
      {id:'record',badge:'clock',run:() => { effects.fireworks(1.8,[PALETTES.flag,PALETTES.gold]); effects.cannons(PALETTES.flag,50); }},
    ],
  };
  let lastScene = '';
  try { lastScene = sessionStorage.getItem('nk-last-scene') || ''; } catch { /* Repeats are harmless. */ }
  function chooseScene(tier) {
    const options = SCENES[tier].filter(scene => scene.id !== lastScene);
    const scene = pick(options.length ? options : SCENES[tier]);
    lastScene = scene.id;
    try { sessionStorage.setItem('nk-last-scene',scene.id); } catch {}
    return scene;
  }
  function tierOf({ratio,newBest}) {
    if (newBest) return 'record';
    return ratio >= 1 ? 'perfect' : ratio >= .8 ? 'great' : ratio >= .5 ? 'good' : 'grow';
  }
  const starsFor = tier => ({record:3,perfect:3,great:2,good:1,grow:0})[tier];

  function countUp(node,to,{decimals=0,duration=900}={}) {
    if (!node || reduced() || typeof requestAnimationFrame !== 'function') return;
    const start = performance.now(), format = value => decimals ? value.toFixed(decimals) : String(Math.round(value));
    const tick = now => {
      const t = Math.min(1,(now-start)/duration), eased = 1-(1-t)**3;
      node.textContent = format(to*eased);
      if (t < 1) requestAnimationFrame(tick); else node.textContent = format(to);
    };
    node.textContent = format(0);
    requestAnimationFrame(tick);
  }
  function center(node) {
    const box = node?.getBoundingClientRect?.();
    return box && box.width ? {x:box.left+box.width/2,y:box.top+box.height/2} : null;
  }

  /* ---------- Public moments ---------- */
  // A finished practice set: themed scene, phrase, earned stars and the score counting up.
  function complete({ratio=0,newBest=false,score,decimals=0,bestRun=0,total=0,anchor}={}) {
    overlays.lastCompleteAt = Date.now();
    const tier = tierOf({ratio,newBest}), scene = chooseScene(tier), [phrase,translation] = pick(PHRASES[tier]);
    const scoreNode = anchor?.querySelector?.('.pr-score strong');
    if (scoreNode && Number.isFinite(score)) countUp(scoreNode,score,{decimals});
    const earned = starsFor(tier);
    const detail = bestRun >= 3 ? `最长连对 ${bestRun}` : total ? `完成 ${total} 个词` : '';
    const markup = `<div class="nk-flash-card is-${tier}" role="status" aria-live="polite">${scene.aurora ? '<div class="nk-aurora" aria-hidden="true"><i></i><i></i><i></i></div>' : ''}<div class="nk-flash-badge" aria-hidden="true"><span class="nk-rays"></span>${BADGES[scene.badge]}</div><p class="nk-flash-phrase" lang="nb">${escapeHTML(phrase)}</p><p class="nk-flash-sub">${escapeHTML(translation)}</p>${tier === 'grow' ? '' : `<div class="nk-flash-stars" aria-label="${earned} 颗星">${[0,1,2].map(index => `<span class="${index < earned ? 'is-on' : ''}" style="--i:${index}">${STAR}</span>`).join('')}</div>`}${detail ? `<p class="nk-flash-detail">${escapeHTML(detail)}</p>` : ''}</div>`;
    return enqueue(() => flash(markup,{className:`is-complete${scene.aurora ? ' has-aurora' : ''}`,duration:tier === 'grow' ? 2400 : 3200,onOpen:() => { if (!reduced()) { run(); scene.run(); } }}));
  }
  // A right answer: sparkles at the check mark and the XP it earned floating up.
  function answer({anchor,xp=0}={}) {
    const point = center(anchor);
    if (!point || reduced()) return;
    run();
    effects.burst(point.x,point.y,PALETTES.meadow,16,{speed:[120,300],shapes:['star','circle'],size:[4,7],gravity:260,ttl:[.5,.9]});
    if (xp > 0) floatText(point,`+${xp} XP`);
  }
  function floatText(point,text,className='') {
    if (!document.body) return;
    const node = document.createElement('span');
    node.className = `nk-float ${className}`;
    node.textContent = text;
    node.setAttribute('aria-hidden','true');
    node.style.left = `${point.x}px`; node.style.top = `${point.y}px`;
    document.body.append(node);
    setTimeout(() => node.remove(),1300);
  }
  // Consecutive right answers grow from a small badge into a burning banner.
  const COMBO = [[15,'is-legend','Legendarisk!'],[10,'is-fire','Utrolig!'],[5,'is-hot','Supert!'],[3,'is-warm','Bra!']];
  const FLAME = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c1 3.6 5.5 5.6 5.5 11a5.5 5.5 0 0 1-11 0c0-2.4 1.2-4 2.4-5.1.2 1.8 1 3 2.1 3.4-.4-3.6.1-6.6 1-9.3z"/></svg>';
  function combo(runLength) {
    if (!document.body || runLength < 3) return;
    const [,tone,word] = COMBO.find(([minimum]) => runLength >= minimum);
    document.querySelector('.nk-combo')?.remove();
    const node = document.createElement('div');
    node.className = `nk-combo ${tone}`;
    node.setAttribute('aria-hidden','true');
    node.innerHTML = `${FLAME}<b>连对 ×${runLength}</b><span lang="nb">${word}</span>`;
    document.body.append(node);
    setTimeout(() => node.remove(),1700);
    if (reduced()) return;
    const point = center(node);
    if (point && runLength >= 5) { run(); effects.burst(point.x,point.y,runLength >= 10 ? PALETTES.autumn : PALETTES.gold,runLength >= 10 ? 36 : 20,{speed:[160,420],shapes:['spark','star'],size:[3,7],gravity:300,ttl:[.6,1.1]}); }
    if (runLength >= 10 && runLength%5 === 0) chord([783.99,987.77,1174.66,1567.98],{gap:.07,length:.22,volume:.04});
  }
  // Two matched tiles each send up a small puff of colour.
  function matched(nodes=[]) {
    if (reduced()) return;
    for (const node of nodes) {
      const point = center(node);
      if (!point) continue;
      run(); effects.burst(point.x,point.y,PALETTES.pastel,10,{speed:[90,240],shapes:['circle','star'],size:[4,7],gravity:200,ttl:[.45,.8]});
    }
  }
  // Leaderboard XP arrives after the server accepts a result; level-ups get their own moment.
  function xp({gained=0,level,previousLevel,icons=''}={}) {
    const recent = Date.now()-overlays.lastCompleteAt < 90000;
    if (!recent) return;
    const score = document.querySelector('.pr-results-hero .pr-score');
    const point = center(score);
    if (gained > 0 && point) floatText({x:point.x,y:point.y-40},`+${gained} XP`,'is-big');
    if (level > previousLevel) levelUp({level,icons});
  }
  function levelUp({level,icons=''}) {
    const markup = `<div class="nk-flash-card is-level" role="status" aria-live="polite"><div class="nk-flash-badge is-level" aria-hidden="true"><span class="nk-rays"></span><span class="nk-level-number">Lv.${escapeHTML(level)}</span></div><p class="nk-flash-phrase" lang="nb">Nytt nivå!</p><p class="nk-flash-sub">升到 Lv.${escapeHTML(level)} 了</p>${icons ? `<div class="nk-level-icons">${icons}</div>` : ''}</div>`;
    return enqueue(() => flash(markup,{className:'is-level-up',duration:3400,onOpen:() => {
      chord(LEVEL_UP,{gap:.09,length:.3,volume:.05});
      if (reduced()) return;
      run(); effects.stars(fx.width/2,fx.height*.4); setTimeout(() => effects.cannons(PALETTES.gold,46),300);
    }}));
  }

  /* ---------- Weekly trophy ceremony ---------- */
  const TROPHY_TONES = {1:['#fff2b3','#f5c542','#c98f1c'],2:['#ffffff','#d5dde1','#8e989d'],3:['#f6d1b0','#d08b5b','#8f5530']};
  let trophyId = 0;
  function trophy(rank,className='nk-trophy-art') {
    const [light,mid,dark] = TROPHY_TONES[rank], id = `nk-trophy-${++trophyId}`;
    return `<svg class="${className}" viewBox="0 0 80 96" aria-hidden="true"><defs><linearGradient id="${id}-g" x1="0" x2="1"><stop offset="0" stop-color="${mid}"/><stop offset=".45" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient><clipPath id="${id}-c"><path d="M18 8h44v18c0 16-9 27-22 29C27 53 18 42 18 26z"/></clipPath></defs><path fill="none" stroke="${dark}" stroke-width="5" d="M19 16H8c0 14 6 20 14 21M61 16h11c0 14-6 20-14 21"/><path fill="url(#${id}-g)" stroke="${dark}" stroke-width="2.5" d="M18 8h44v18c0 16-9 27-22 29C27 53 18 42 18 26z"/><g clip-path="url(#${id}-c)"><rect class="nk-shine" x="-30" y="0" width="16" height="70" fill="#ffffffaa" transform="skewX(-20)"/></g><path fill="url(#${id}-g)" stroke="${dark}" stroke-width="2.5" d="M34 55h12v12H34z"/><path fill="url(#${id}-g)" stroke="${dark}" stroke-width="2.5" d="M24 67h32l4 13H20z"/><rect x="16" y="80" width="48" height="9" rx="2" fill="${dark}"/><text x="40" y="37" text-anchor="middle" font-size="20" font-weight="700" font-family="Georgia,serif" fill="${dark}">${rank}</text></svg>`;
  }
  function weekLabel(weekStart) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStart || '');
    if (!match) return '';
    const first = new Date(Date.UTC(+match[1],+match[2]-1,+match[3])), last = new Date(first.getTime()+6*86400000);
    const label = date => `${date.getUTCMonth()+1}月${date.getUTCDate()}日`;
    return `${label(first)} – ${label(last)}`;
  }
  const ceremonyState = {open:false};
  function ceremony({entries=[],weekStart='',meId='',replay=false}={}) {
    const winners = entries.filter(entry => entry && entry.rank >= 1 && entry.rank <= 3).slice(0,3);
    if (!winners.length || !document.body || ceremonyState.open) return Promise.resolve(false);
    return enqueue(() => new Promise(resolve => {
      ceremonyState.open = true;
      const mine = winners.find(entry => entry.id === meId);
      const order = [2,1,3].map(rank => winners.find(entry => entry.rank === rank)).filter(Boolean);
      const delays = {3:.5,2:1.1,1:1.7};
      const previousFocus = document.activeElement;
      const layer = document.createElement('div');
      layer.className = 'nk-ceremony';
      layer.setAttribute('role','dialog'); layer.setAttribute('aria-modal','true'); layer.setAttribute('aria-labelledby','nk-ceremony-title');
      layer.innerHTML = `<div class="nk-ceremony-sky" aria-hidden="true"><div class="nk-aurora"><i></i><i></i><i></i></div><i class="nk-beam is-left"></i><i class="nk-beam is-right"></i></div><div class="nk-ceremony-inner"><p class="nk-ceremony-kicker" lang="nb">UKENS MESTERE</p><h2 id="nk-ceremony-title">上周排行榜 · 颁奖典礼</h2><p class="nk-ceremony-dates">${escapeHTML(weekLabel(weekStart))}</p><ol class="nk-podium">${order.map(entry => `<li class="nk-place is-${entry.rank}${entry.id === meId ? ' is-me' : ''}" style="--delay:${delays[entry.rank]}s"><div class="nk-place-trophy">${trophy(entry.rank)}</div><strong class="nk-place-name"><span class="nk-place-text">${escapeHTML(entry.nickname)}</span>${entry.id === meId ? '<span class="nk-place-me">我</span>' : ''}</strong><span class="nk-place-xp"><b data-count="${Number(entry.xp) || 0}">${Number(entry.xp).toLocaleString('zh-CN')}</b> XP</span><div class="nk-place-block"><span>${entry.rank}</span></div></li>`).join('')}</ol>${mine ? `<p class="nk-ceremony-mine">恭喜！你获得了上周第 ${mine.rank} 名，奖杯已放进你的荣誉柜。</p>` : '<p class="nk-ceremony-note">本周继续练习，下周一的领奖台上也许就是你。</p>'}<button type="button" class="nk-ceremony-close">${mine ? '收下奖杯' : '为他们鼓掌'}</button></div>`;
      document.body.append(layer);
      document.body.classList.add('nk-ceremony-open');
      const timers = [];
      const later = (fn,seconds) => timers.push(setTimeout(fn,seconds*1000));
      const button = layer.querySelector('.nk-ceremony-close');
      let closing = false;
      const close = () => {
        if (closing) return; closing = true;
        timers.forEach(clearTimeout);
        document.removeEventListener('keydown',onKey,true);
        const finish = () => {
          layer.classList.add('is-leaving');
          setTimeout(() => { layer.remove(); document.body.classList.remove('nk-ceremony-open'); ceremonyState.open = false; previousFocus?.focus?.({preventScroll:true}); resolve(true); },reduced() ? 0 : 320);
        };
        // Applause sends one last shower of confetti before the curtain falls.
        if (!reduced()) { run(); effects.cannons(mine ? PALETTES.gold : PALETTES.flag,40); chord([659.25,783.99,1046.5],{gap:.06,length:.2,volume:.04}); setTimeout(finish,650); }
        else finish();
      };
      const onKey = event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        else if (event.key === 'Tab') { event.preventDefault(); button.focus(); }
      };
      document.addEventListener('keydown',onKey,true);
      button.addEventListener('click',close);
      if (reduced()) { button.focus(); return; }
      layer.querySelectorAll('[data-count]').forEach(node => { const place = node.closest('.nk-place'); const rank = Number(place.className.match(/is-(\d)/)[1]); later(() => countUp(node,Number(node.dataset.count),{duration:800}),delays[rank]+.5); });
      for (const entry of order) later(() => {
        const point = center(layer.querySelector(`.nk-place.is-${entry.rank} .nk-place-trophy`));
        run();
        if (point) { effects.burst(point.x,point.y,entry.rank === 1 ? PALETTES.gold : entry.rank === 2 ? PALETTES.silver : PALETTES.bronze,entry.rank === 1 ? 50 : 30,{speed:[160,460],shapes:['star','spark','twinkle'],size:[4,9],gravity:300,ttl:[.8,1.4]}); effects.ring(point.x,point.y,TROPHY_TONES[entry.rank][1],110); }
        chord([[0,523.25,587.33,659.25][entry.rank]*(entry.rank === 1 ? 1.5 : 1)],{length:.4,volume:.05});
      },delays[entry.rank]+1.02); // the trophy has landed: its drop starts at +0.3s and lasts 0.7s
      later(() => { run(); effects.fireworks(3.2); effects.cannons(PALETTES.gold,60); chord(FANFARE,{gap:.12,length:.4,volume:.05}); if (mine) effects.stars(); },2.9);
      later(() => { run(); effects.twinkles(40); },.2);
      later(() => button.focus({preventScroll:true}),3);
    }));
  }

  window.NorskCelebrate = {complete,answer,combo,matched,xp,levelUp,ceremony,trophy,weekLabel,clear:clearAll};
  window.dispatchEvent(new Event('norskcelebrateready'));
})();
