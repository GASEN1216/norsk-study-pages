// Christmas decorations (jul), from 2026-11-12 to tjuendedagen (see SEASON in app.js): a string of glowing bulbs under
// the header, glass baubles hanging from it into the page margins, a velvet Santa hat on the brand tile, the Christmas
// greeting in the brand line, soft snow drifting over the page and snow caps on the practice cards (season.css).
// Everything is an overlay that never changes the layout; nothing moves during a practice round or in the reader.

const GREETING = 'GOD JUL · GODT NYTT ÅR';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Bulb colours along the wire, in the order they repeat: warm red, gold, warm white, pine, slate blue.
const BULBS = ['red','gold','white','green','gold','red','blue','white','gold'];

const HAT = `<svg viewBox="0 0 64 48" aria-hidden="true"><defs>
  <linearGradient id="jul-hat-felt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9473b"/><stop offset=".55" stop-color="#b52e27"/><stop offset="1" stop-color="#7f1b18"/></linearGradient>
  <radialGradient id="jul-hat-fur" cx=".45" cy=".35" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#f6f1e6"/><stop offset="1" stop-color="#ddd5c6"/></radialGradient>
</defs>
  <path d="M9 33C11 20 21 8 35 6c9-1 16 4 19 12 2 6 1 12 3 16-4-3-7-9-8-14-3 5-5 10-6 15Z" fill="url(#jul-hat-felt)"/>
  <path d="M35 6c9-1 16 4 19 12 2 6 1 12 3 16-4-3-7-9-8-14-2-6-7-11-14-14Z" fill="#000" opacity=".12"/>
  <path d="M17 18c5-6 11-9 18-10" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".22"/>
  <rect x="5" y="30" width="45" height="11" rx="5.5" fill="url(#jul-hat-fur)"/>
  <path d="M8 33.5c4 1.6 8-.8 12 .6s8 1 12-.2 9 .8 14-.6" fill="none" stroke="#d8cfbe" stroke-width="1" stroke-linecap="round" opacity=".8"/>
  <circle cx="56" cy="35" r="6" fill="url(#jul-hat-fur)"/>
  <circle cx="54.2" cy="33.2" r="1.8" fill="#fff" opacity=".9"/>
</svg>`;

// One glass bauble: a glossy ball with a gold cap; `band` adds a thin gold ring around the middle.
function bauble(tone,band,n) {
  // Ids are per bauble: a gradient defined inside a hidden (display:none) bauble would paint nothing elsewhere.
  const id = `jul-ball-${n}`, cap = `jul-cap-${n}`;
  return `<svg viewBox="0 0 40 46" aria-hidden="true"><defs><radialGradient id="${id}" cx=".36" cy=".34" r=".78"><stop offset="0" class="jul-ball-hi-${tone}"/><stop offset=".55" class="jul-ball-mid-${tone}"/><stop offset="1" class="jul-ball-lo-${tone}"/></radialGradient>
    <linearGradient id="${cap}" x1="0" x2="1"><stop offset="0" stop-color="#8f6d2c"/><stop offset=".45" stop-color="#f1d79a"/><stop offset="1" stop-color="#9c7834"/></linearGradient></defs>
    <path d="M17 3.5a3 3 0 0 1 6 0" fill="none" stroke="#b6954f" stroke-width="1.2"/>
    <rect x="14.5" y="4" width="11" height="6.5" rx="1.6" fill="url(#${cap})"/>
    <circle cx="20" cy="27" r="17" fill="url(#${id})"/>
    ${band ? '<path d="M3.4 27.5c5 4 28.2 4 33.2 0" fill="none" stroke="#e9c97c" stroke-width="1.6" opacity=".85"/><path d="M4.6 21.5c5 3 25.8 3 30.8 0" fill="none" stroke="#e9c97c" stroke-width=".8" opacity=".6"/>' : ''}
    <ellipse cx="13.5" cy="19.5" rx="5" ry="3.2" transform="rotate(-35 13.5 19.5)" fill="#fff" opacity=".55"/>
    <circle cx="27" cy="35" r="2.2" fill="#fff" opacity=".18"/>
  </svg>`;
}

export function startSeason() {
  const body = document.body;
  const parts = [];

  // A wire of bulbs in shallow scallops along the header's bottom edge; each bulb breathes on its own rhythm.
  function lights(header) {
    const box = document.createElement('div');
    box.className = 'jul-lights';
    box.setAttribute('aria-hidden','true');
    header.append(box);
    let width = 0;
    const draw = () => {
      const next = Math.round(header.clientWidth);
      if (!next || next === width) return;
      width = next;
      const phone = width < 720;
      const count = Math.max(4,Math.round(width / (phone ? 80 : 128)));
      const span = width / count, sag = phone ? 7 : 10, top = 1;
      let wire = `M0 ${top}`, bulbs = '', index = 0;
      for (let i = 0; i < count; i++) {
        const x0 = i * span, x1 = x0 + span, cx = x0 + span / 2, cy = top + sag * 2;
        wire += ` Q${cx.toFixed(1)} ${cy} ${x1.toFixed(1)} ${top}`;
        for (const t of [.22,.5,.78]) {
          const x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1;
          const y = (1 - t) ** 2 * top + 2 * (1 - t) * t * cy + t * t * top;
          // Bulbs hang along the wire's slope, like real ones on a sagging string.
          const slope = 2 * (1 - t) * (cy - top) + 2 * t * (top - cy);
          const angle = Math.atan2(slope,span) * 180 / Math.PI * .6;
          const tone = BULBS[index % BULBS.length];
          const delay = -((index * 1.37) % 5.2).toFixed(2), period = (3.4 + (index * .53) % 2.4).toFixed(2);
          bulbs += `<g class="jul-bulb is-${tone}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angle.toFixed(1)})" style="--delay:${delay}s;--period:${period}s"><circle class="jul-glow" cy="7" r="${phone ? 9 : 11}"/><rect class="jul-cap" x="-1.6" y="-.6" width="3.2" height="3" rx=".7"/><path class="jul-core" d="M0 2.2c-2.6 0-3.4 2.6-3.1 4.6.3 2.4 1.7 4.4 3.1 5.4 1.4-1 2.8-3 3.1-5.4.3-2-.5-4.6-3.1-4.6Z"/><ellipse class="jul-shine" cx="-1.1" cy="5.4" rx=".8" ry="1.6"/></g>`;
          index++;
        }
      }
      box.innerHTML = `<svg width="${width}" height="34" viewBox="0 0 ${width} 34" preserveAspectRatio="xMinYMin meet"><defs>${['red','gold','white','green','blue'].map(tone => `<radialGradient id="jul-glow-${tone}"><stop offset="0" class="jul-stop-${tone}" stop-opacity=".8"/><stop offset=".45" class="jul-stop-${tone}" stop-opacity=".28"/><stop offset="1" class="jul-stop-${tone}" stop-opacity="0"/></radialGradient>`).join('')}</defs><path class="jul-wire" d="${wire}"/>${bulbs}</svg>`;
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(header);
    return () => { observer.disconnect(); box.remove(); };
  }

  // Baubles on gold threads: in the page margins on wide screens (practice and 更多 have them), and two small ones in
  // the empty top-right corner of the phone header. Each sways like a pendulum from its hook.
  function baubles(header) {
    const box = document.createElement('div');
    box.className = 'jul-baubles';
    box.setAttribute('aria-hidden','true');
    const hang = [
      // side, offset from the edge (px), thread length (px), size (px), tone, band, phone
      ['left',34,56,30,'red',true],['left',78,104,22,'gold',false],
      ['right',40,82,32,'gold',true],['right',86,40,22,'red',false],['right',122,122,24,'cream',true],
      ['right',20,12,19,'red',false,'phone'],['right',48,28,15,'gold',true,'phone'],['right',72,6,12,'cream',false,'phone'],
    ];
    // A cluster hanging from the header's top edge in the empty gap between the brand and the nav (every width above
    // phones), placed by measuring, so it never touches either. Lengths keep each bauble inside the header.
    const cluster = [[10,22,'red',true],[30,17,'gold',false],[4,14,'cream',true],[22,19,'red',false],[8,15,'gold',true]];
    const gap = cluster.map(([length,size,tone,band],n) => `<span class="jul-bauble is-gap" style="left:0;--len:${length}px;--size:${size}px;--sway:${(4.8 + n * .9).toFixed(1)}s;--delay:${(-n * 1.7).toFixed(1)}s"><i class="jul-thread"></i>${bauble(tone,band,hang.length + n)}</span>`).join('');
    box.innerHTML = hang.map(([side,offset,length,size,tone,band,phone],index) => `<span class="jul-bauble${phone ? ' is-phone' : ''}" style="${side}:${offset}px;--len:${length}px;--size:${size}px;--sway:${(5.2 + index * .7).toFixed(1)}s;--delay:${(-index * 1.3).toFixed(1)}s"><i class="jul-thread"></i>${bauble(tone,band,index)}</span>`).join('') + gap;
    header.append(box);
    const brand = header.querySelector('.brand'), nav = header.querySelector('.main-nav');
    const place = () => {
      const items = [...box.querySelectorAll('.is-gap')];
      const head = header.getBoundingClientRect(), from = brand?.getBoundingClientRect().right ?? 0, to = nav?.getBoundingClientRect().left ?? 0;
      // Phones stack the nav under the brand: their own corner baubles take over.
      const room = to - from - 24, phone = innerWidth <= 720;
      const fit = phone || room < 26 ? 0 : Math.min(items.length,Math.max(1,Math.floor(room / 26)));
      const spacing = fit > 1 ? Math.min(30,room / fit) : 0, start = from - head.left + 12 + (room - spacing * (fit - 1)) / 2;
      items.forEach((item,n) => {
        item.hidden = n >= fit;
        if (n < fit) item.style.left = `${Math.round(start + n * spacing - item.offsetWidth / 2)}px`;
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(header);
    return () => { observer.disconnect(); box.remove(); };
  }

  function hat(tile) {
    const span = document.createElement('span');
    span.className = 'jul-hat';
    span.innerHTML = HAT;
    tile.append(span);
    return () => span.remove();
  }

  function greeting(small) {
    const original = small.textContent;
    small.textContent = GREETING;
    small.classList.add('jul-greeting');
    return () => { small.textContent = original; small.classList.remove('jul-greeting'); };
  }

  // Snow: soft round flakes in two depths drifting down over the page (under the header), each pre-drawn once with a
  // faint cool shadow so it reads on cream and white alike. Paused in a practice round, the reader, a hidden tab or
  // when a full-screen game covers the page; none at all for learners who prefer less motion.
  function snow() {
    if (reduced()) return () => {};
    const canvas = document.createElement('canvas');
    canvas.className = 'jul-snow';
    canvas.setAttribute('aria-hidden','true');
    body.append(canvas);
    const context = canvas.getContext('2d');
    const sprites = new Map();
    const sprite = (radius) => {
      const key = Math.round(radius * 2);
      if (sprites.has(key)) return sprites.get(key);
      const r = key / 2, pad = Math.ceil(r * 1.6 + 3), size = Math.ceil((r + pad) * 2);
      const piece = document.createElement('canvas');
      piece.width = piece.height = size;
      const c = piece.getContext('2d');
      c.shadowColor = 'rgba(112,98,80,.32)';
      c.shadowBlur = Math.max(2.5,r * 1.5);
      c.shadowOffsetY = r * .25;
      const gradient = c.createRadialGradient(size / 2 - r * .3,size / 2 - r * .3,0,size / 2,size / 2,r);
      gradient.addColorStop(0,'rgba(255,255,255,1)');
      gradient.addColorStop(.6,'rgba(248,251,255,.97)');
      gradient.addColorStop(1,'rgba(230,226,218,.9)');
      c.fillStyle = gradient;
      c.beginPath(); c.arc(size / 2,size / 2,r,0,Math.PI * 2); c.fill();
      sprites.set(key,piece);
      return piece;
    };
    let flakes = [], frame = 0, last = 0, width = 0, height = 0, ratio = 1, covered = false, alive = true, wind = 0;
    const flake = (fresh) => {
      const near = Math.random() < .3;
      const radius = near ? 2.6 + Math.random() * 2.2 : 1.1 + Math.random() * 1.5;
      return {x:Math.random() * (width + 80) - 40,y:fresh ? Math.random() * height : -12,radius,near,
              fall:(near ? 26 : 14) + Math.random() * 14,sway:6 + Math.random() * (near ? 26 : 14),phase:Math.random() * Math.PI * 2,
              period:5 + Math.random() * 6,alpha:near ? .9 : .55 + Math.random() * .3};
    };
    const resize = () => {
      ratio = Math.min(2,window.devicePixelRatio || 1);
      width = innerWidth; height = innerHeight;
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      const want = Math.max(14,Math.min(36,Math.round(width * height / 30000)));
      while (flakes.length < want) flakes.push(flake(true));
      flakes.length = want;
    };
    const quiet = () => document.hidden || covered || body.classList.contains('practice-focus') || body.classList.contains('reader-focus')
      || /^(reading|compare)$/.test(body.dataset.view || '');
    const step = (time) => {
      if (!alive) return;
      frame = requestAnimationFrame(step);
      if (quiet()) { if (!canvas.hidden) canvas.hidden = true; last = time; return; }
      if (canvas.hidden) canvas.hidden = false;
      if (time - last < 30) return;
      const dt = Math.min(.1,(time - last) / 1000 || 0);
      last = time;
      // A slow breeze that comes and goes.
      wind = Math.sin(time / 9000) * 9 + Math.sin(time / 3700) * 4;
      context.setTransform(ratio,0,0,ratio,0,0);
      context.clearRect(0,0,width,height);
      for (const f of flakes) {
        f.y += f.fall * dt;
        f.x += wind * dt * (f.near ? 1.4 : .8);
        f.phase += dt * Math.PI * 2 / f.period;
        if (f.y - 10 > height || f.x < -60 || f.x > width + 60) Object.assign(f,flake(false));
        const image = sprite(f.radius);
        context.globalAlpha = f.alpha;
        context.drawImage(image,f.x + Math.sin(f.phase) * f.sway - image.width / 2,f.y - image.height / 2);
      }
    };
    const watch = setInterval(() => {
      const at = document.elementFromPoint(innerWidth / 2,innerHeight / 2);
      covered = !!at && !at.closest?.('.workspace,.site-header') && at !== body && at !== document.documentElement;
    },1000);
    resize();
    addEventListener('resize',resize);
    frame = requestAnimationFrame(step);
    return () => { alive = false; cancelAnimationFrame(frame); clearInterval(watch); removeEventListener('resize',resize); canvas.remove(); };
  }

  body.classList.add('season-jul');
  const header = document.querySelector('.site-header'), tile = document.querySelector('.brand-icon'), small = document.querySelector('.brand-name small');
  if (header) parts.push(lights(header),baubles(header));
  if (tile) parts.push(hat(tile));
  if (small) parts.push(greeting(small));
  parts.push(snow());
  return {stop() { body.classList.remove('season-jul'); while (parts.length) parts.pop()(); }};
}
