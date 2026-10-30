/* 笔记: handwriting on the original pages, highlights and thoughts in 听读, and the notes square.
   Notes belong to the leaderboard nickname (see notes-store.mjs); app.js owns the store and its sync. */
// The drawing and data helpers come from app.js, which loads them with the site's version.
let SCALE,INK,HIGHLIGHT,PEN_SIZES,HIGHLIGHT_SIZES,drawStroke,drawPage,simplify,bounds,touches,inside,lassoed,transformStroke;
let MARK_COLORS,INK_COLORS,LIMITS,newId,pageNoteId,normalizePage,normalizeMark,pageIsEmpty,mergePages;

const TOOLS_KEY = 'norsk-notes-tools-v1';
const OTHERS_KEY = 'norsk-notes-others-v1';
const MARK_NAMES = {amber:'琥珀',sage:'青苔',rose:'蔷薇',sky:'远天'};
const INK_NAMES = {ink:'墨黑',green:'松绿',rust:'赭红',gold:'金褐',blue:'靛蓝',plum:'藕紫'};
const svg = body => `<svg aria-hidden="true" viewBox="0 0 24 24">${body}</svg>`;
const ICONS = {
  pen:svg('<path d="m4 20 1.2-4.6L15.7 4.9a2 2 0 0 1 2.9 0l.5.5a2 2 0 0 1 0 2.9L8.6 18.8z"/><path d="m13.5 7 3.5 3.5"/>'),
  hl:svg('<path d="m9 15-3 3H3l2-4"/><path d="m14.5 4.5 5 5-8.3 8.3-5-5z"/><path d="M4 21h16" opacity=".55"/>'),
  eraser:svg('<path d="m8 20-4.3-4.3a1.6 1.6 0 0 1 0-2.3L13.4 3.7a1.6 1.6 0 0 1 2.3 0l4.6 4.6a1.6 1.6 0 0 1 0 2.3L11 20z"/><path d="M8 20h12M8.5 9.5l6 6"/>'),
  lasso:svg('<path d="M7.4 17.6C4.2 16.4 2.5 14.3 2.5 12c0-4 4.3-7 9.5-7s9.5 3 9.5 7-4.3 7-9.5 7c-.9 0-1.8-.1-2.6-.3" stroke-dasharray="2.6 2.4"/><path d="M8.5 17.5c0 1.6-.9 3-2.4 3.5"/>'),
  text:svg('<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"/>'),
  undo:svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo:svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  more:svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  notebook:svg('<path d="M6 3.5h9.5L19 7v13.5H6z"/><path d="M15 3.5V7.5h4M9 11h7M9 14.5h7M9 18h4"/>'),
  close:svg('<path d="m6 6 12 12M18 6 6 18"/>'),
  heart:svg('<path d="M12 20s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z"/>'),
  chat:svg('<path d="M20 12a7.5 7.5 0 0 1-11 6.6L4 20l1.4-4.5A7.5 7.5 0 1 1 20 12z"/>'),
  collect:svg('<path d="M6 3.5h12v17l-6-4-6 4z"/><path d="M12 7.5v6M9 10.5h6"/>'),
  trash:svg('<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13"/>'),
  thought:svg('<path d="M5 18.5V6.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9z"/><path d="M8.5 9h7M8.5 12.5h4.5"/>'),
  words:svg('<path d="M5 4.5h10.5a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3z"/><path d="M5 16.5a3 3 0 0 1 3-3h10.5M9 8.5h5"/>'),
  globe:svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.5 3.5 5.3 3.5 8.5s-1.1 6-3.5 8.5c-2.4-2.5-3.5-5.3-3.5-8.5s1.1-6 3.5-8.5z"/>'),
  eye:svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  arrow:svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  finger:svg('<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10m0-.5V8a1.5 1.5 0 0 1 3 0v2m0-.5a1.5 1.5 0 0 1 3 0V14a6.5 6.5 0 0 1-6.5 6.5h-.6a6 6 0 0 1-4.6-2.2L4.5 15a1.6 1.6 0 0 1 2.4-2.1L9 15"/>')
};
const ui = {deps:null,store:null,initialized:false,tools:{tool:'pen',pen:'ink',hl:'ink',text:'ink',penSize:1,hlSize:1,fingers:true,penSeen:false},
  ink:null,histories:new Map(),touches:new Map(),annotating:false,palette:null,menuOpen:false,lesson:null,lessonObserver:null,card:null,
  drawer:null,drawerTab:'mine',others:{key:'',status:'idle',items:[]},overlay:null,showOthers:true,dialogs:[],overview:null,thumbs:new Map(),pendingMark:''};
const $ = (selector,root = document) => root.querySelector(selector);
const $$ = (selector,root = document) => [...root.querySelectorAll(selector)];
const e = value => ui.deps.escapeHTML(value);
const notify = message => ui.deps.notify(message);
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const narrow = () => !!window.matchMedia?.('(max-width: 720px)').matches;
const multiline = value => e(value).replace(/\n/g,'<br>');
function guard(run) {
  try { return run(); }
  catch (error) { notify(error?.message || '没有保存成功，请重试。'); return null; }
}
function readTools() {
  try { Object.assign(ui.tools,JSON.parse(localStorage.getItem(TOOLS_KEY) || '{}')); } catch {}
  if (!['pen','hl','eraser','lasso','text'].includes(ui.tools.tool)) ui.tools.tool = 'pen';
  for (const key of ['pen','hl','text']) if (!INK_COLORS.includes(ui.tools[key])) ui.tools[key] = 'ink';
  try { ui.showOthers = localStorage.getItem(OTHERS_KEY) !== 'off'; } catch {}
}
function saveTools() { try { localStorage.setItem(TOOLS_KEY,JSON.stringify(ui.tools)); } catch {} }
function when(iso) {
  const time = typeof iso === 'number' ? iso*1000 : Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const minutes = Math.round((Date.now()-time)/60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.round(minutes/60)} 小时前`;
  if (minutes < 2880) return '昨天';
  const date = new Date(time);
  return `${date.getMonth()+1}月${date.getDate()}日`;
}
const community = () => ui.deps.community();
async function api(path,options = {}) { return (await community()).request(path,options); }
function apiError(error,fallback) {
  const messages = {note_gone:'这条笔记已被作者撤回。',own_note:'这是你自己的笔记。',comment_invalid:`评论需为 1–${500} 个字。`,forbidden:'只能删除自己的评论或自己笔记下的评论。',rate_limited:'操作太频繁了，请稍后再试。'};
  notify(messages[error?.code] || fallback);
}

/* ================= Handwriting on the original page ================= */
const pageItem = () => ui.ink && ui.store.get(ui.ink.id);
function readDoc() {
  const item = pageItem();
  return item ? normalizePage(item.data) : normalizePage({created:new Date().toISOString()});
}
function pageHistory() {
  const id = ui.ink.id;
  if (!ui.histories.has(id)) ui.histories.set(id,{undo:[],redo:[]});
  return ui.histories.get(id);
}
function pageShown({stage,canvas,book,page}) {
  if (!ui.store || !canvas || canvas.hidden) return;
  const id = pageNoteId(book,page);
  const same = ui.ink && ui.ink.id === id && ui.ink.host.isConnected;
  if (!same) {
    pageHidden();
    const host = document.createElement('div');
    host.className = 'nt-ink';
    host.innerHTML = '<canvas class="nt-ink-other" aria-hidden="true"></canvas><canvas class="nt-ink-hl" aria-hidden="true"></canvas><canvas class="nt-ink-pen" aria-hidden="true"></canvas><canvas class="nt-ink-live" aria-hidden="true"></canvas><div class="nt-ink-texts"></div><svg class="nt-ink-lasso" aria-hidden="true"></svg>';
    stage.append(host);
    ui.ink = {stage,canvas,host,book:String(book),page:String(page),id,doc:null,drawing:null,selection:null,width:0,height:0};
    ui.ink.doc = readDoc();
    if (ui.overlay && (ui.overlay.book !== ui.ink.book || ui.overlay.place !== ui.ink.page)) ui.overlay = null;
    if (!stage.dataset.ntBound) bindStage(stage);
  }
  ui.ink.canvas = canvas;
  layoutInk();
  if (ui.annotating) showPalette();
  placeDock();
  if (ui.drawer && !ui.drawer.hidden) renderDrawer();
}
function pageHidden() {
  if (!ui.ink) return;
  finishTextEdit();
  ui.ink.host.remove();
  ui.ink = null;
  hidePalette();
}
function layoutInk() {
  const ink = ui.ink;
  if (!ink) return;
  const {canvas,host} = ink;
  const width = canvas.offsetWidth, height = canvas.offsetHeight;
  if (!width || !height) return;
  Object.assign(host.style,{left:`${canvas.offsetLeft}px`,top:`${canvas.offsetTop}px`,width:`${width}px`,height:`${height}px`});
  const ratio = Math.min(window.devicePixelRatio || 1,2);
  for (const layer of $$('canvas',host)) {
    layer.width = Math.round(width*ratio); layer.height = Math.round(height*ratio);
    layer.style.width = `${width}px`; layer.style.height = `${height}px`;
    layer.getContext('2d').setTransform(ratio,0,0,ratio,0,0);
  }
  $('.nt-ink-lasso',host).setAttribute('viewBox',`0 0 ${width} ${height}`);
  ink.width = width; ink.height = height; ink.ratio = ratio;
  if (ink.doc.aspect !== +(height/width).toFixed(3)) ink.doc.aspect = +(height/width).toFixed(3);
  paintInk();
}
function clear(layer) {
  const ctx = layer.getContext('2d');
  ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,layer.width,layer.height); ctx.restore();
  return ctx;
}
function paintInk() {
  const ink = ui.ink;
  if (!ink || !ink.width) return;
  const hidden = ink.selection?.moving ? new Set(ink.selection.strokes) : null;
  const hl = clear($('.nt-ink-hl',ink.host)), pen = clear($('.nt-ink-pen',ink.host));
  for (const stroke of ink.doc.strokes) {
    if (hidden?.has(stroke.id) || ink.drawing?.erased?.has(stroke.id)) continue;
    drawStroke(stroke.t === 'hl' ? hl : pen,stroke,ink.width,ink.height);
  }
  paintOther();
  renderTexts();
  renderSelection();
}
function paintOther() {
  const ink = ui.ink;
  if (!ink) return;
  const layer = $('.nt-ink-other',ink.host);
  const ctx = clear(layer);
  layer.hidden = !ui.overlay?.data;
  if (ui.overlay?.data) drawPage(ctx,normalizePage(ui.overlay.data),ink.width,ink.height,{alpha:.62});
}
function renderTexts() {
  const ink = ui.ink;
  const layer = $('.nt-ink-texts',ink.host);
  const editing = ink.editing?.id;
  const moving = ink.selection?.moving ? new Set(ink.selection.texts) : null;
  layer.innerHTML = ink.doc.texts.filter(box => box.id !== editing).map(box => {
    const shown = moving?.has(box.id) ? transformText(box,ink.selection.transform) : box;
    return `<div class="nt-text${ink.selection?.texts.includes(box.id) ? ' is-selected' : ''}" data-nt-text="${e(box.id)}" style="left:${shown.x/SCALE*100}%;top:${shown.y/SCALE*100}%;width:${shown.w/SCALE*100}%;font-size:${shown.s/1000*ink.width}px;color:${INK[shown.c]}">${multiline(shown.text)}</div>`;
  }).join('');
}

/* ---------- Pointer input ---------- */
const toolSize = () => ui.tools.tool === 'hl' ? HIGHLIGHT_SIZES[ui.tools.hlSize] : PEN_SIZES[ui.tools.penSize];
function pointIn(event) {
  const rect = ui.ink.canvas.getBoundingClientRect();
  return {x:(event.clientX-rect.left)/rect.width*SCALE,y:(event.clientY-rect.top)/rect.height*SCALE,
    px:event.clientX-rect.left,py:event.clientY-rect.top,p:event.pointerType === 'pen' || event.pointerType === 'touch' && event.pressure > 0 && event.pressure !== .5 ? event.pressure : .5};
}
function onPage(event) {
  const rect = ui.ink.canvas.getBoundingClientRect(), slack = 12;
  return event.clientX >= rect.left-slack && event.clientX <= rect.right+slack && event.clientY >= rect.top-slack && event.clientY <= rect.bottom+slack;
}
function willDraw(event) {
  if (!ui.ink || event.button > 0) return false;
  if (event.target.closest?.('.nt-palette,.nt-text-editor,.nt-sel-menu')) return false;
  if (!onPage(event)) return false;
  if (event.pointerType === 'pen') return true;
  return ui.annotating && (event.pointerType === 'mouse' || ui.tools.fingers);
}
function bindStage(stage) {
  stage.dataset.ntBound = '1';
  stage.addEventListener('pointerdown',onInkDown,{capture:true});
  stage.addEventListener('pointermove',onInkMove,{capture:true});
  stage.addEventListener('pointerup',onInkUp,{capture:true});
  stage.addEventListener('pointercancel',onInkCancel,{capture:true});
  // Fingers on the page are counted so that a second one turns a stroke into a pinch.
  for (const name of ['pointerup','pointercancel']) document.addEventListener(name,event => ui.touches.delete(event.pointerId),true);
  // While fingers write, two fingers move the page instead (the browser's own scrolling is off then).
  stage.addEventListener('pointermove',event => {
    if (event.pointerType !== 'touch' || !ui.touches.has(event.pointerId)) return;
    const before = midpoint();
    ui.touches.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if (ui.touches.size < 2 || !ui.annotating || !ui.tools.fingers) return;
    const after = midpoint();
    stage.scrollBy(before.x-after.x,before.y-after.y);
  },{capture:true});
  // Safari scrolls with the Apple Pencil unless its touches are cancelled; fingers keep scrolling.
  const stop = event => {
    if (!ui.ink || event.target.closest?.('.nt-text-editor,.nt-palette')) return;
    const stylus = [...event.touches].some(touch => touch.touchType === 'stylus');
    if (stylus || (ui.annotating && ui.tools.fingers)) event.preventDefault();
  };
  stage.addEventListener('touchstart',stop,{passive:false});
  stage.addEventListener('touchmove',stop,{passive:false});
  stage.addEventListener('dblclick',event => { if (ui.annotating) { event.stopPropagation(); event.preventDefault(); } },{capture:true});
}
function midpoint() {
  const points = [...ui.touches.values()];
  return {x:points.reduce((sum,point) => sum+point.x,0)/points.length,y:points.reduce((sum,point) => sum+point.y,0)/points.length};
}
function onInkDown(event) {
  if (event.pointerType === 'touch') ui.touches.set(event.pointerId,{x:event.clientX,y:event.clientY});
  const ink = ui.ink;
  // Two fingers are a pinch or a scroll, never writing: drop the stroke the first finger began.
  if (ink?.drawing && event.pointerType === 'touch' && ink.drawing.type === 'touch' && event.pointerId !== ink.drawing.id) { discardDrawing(); return; }
  if (!willDraw(event) || (event.pointerType === 'touch' && ui.touches.size > 1)) return;
  if (ink.drawing) return;
  const woke = !ui.annotating;
  if (event.pointerType === 'pen' && !ui.tools.penSeen) {
    // Once an Apple Pencil is used, fingers go back to scrolling, as in GoodNotes and Notability.
    ui.tools.penSeen = true; ui.tools.fingers = false; saveTools();
  }
  if (!ui.annotating) {
    if (!['pen','hl'].includes(ui.tools.tool)) { ui.tools.tool = 'pen'; saveTools(); }
    setAnnotating(true);
  }
  finishTextEdit();
  event.preventDefault();
  event.stopPropagation();
  try { ink.stage.setPointerCapture(event.pointerId); } catch {}
  const point = pointIn(event), tool = ui.tools.tool;
  ink.drawing = {id:event.pointerId,type:event.pointerType,tool,start:point,last:point,moved:false,woke};
  if (tool === 'pen' || tool === 'hl') {
    ink.drawing.stroke = {id:newId('s'),t:tool,c:ui.tools[tool],w:toolSize(),p:[Math.round(point.x),Math.round(point.y),Math.round(point.p*100)],u:Date.now()};
    paintLive();
  } else if (tool === 'eraser') {
    ink.drawing.erased = new Set();
    erase(point);
  } else if (tool === 'lasso') {
    const sel = ink.selection;
    const box = sel && selectionBox(sel);
    if (sel && box && Math.hypot(point.px-box.right,point.py-box.bottom) < 22) ink.drawing.mode = 'scale';
    else if (sel && box && point.px >= box.left-8 && point.px <= box.right+8 && point.py >= box.top-8 && point.py <= box.bottom+8) ink.drawing.mode = 'move';
    else { clearSelection(); ink.drawing.mode = 'lasso'; ink.drawing.path = [point]; }
    if (ink.drawing.mode !== 'lasso') { sel.moving = true; sel.transform = {dx:0,dy:0,scale:1,ox:box.ox,oy:box.oy}; ink.drawing.box = box; hideSelectionMenu(); paintInk(); }
  } else if (tool === 'text') {
    const hit = event.target.closest?.('[data-nt-text]');
    ink.drawing.text = hit?.dataset.ntText || '';
  }
}
function onInkMove(event) {
  const ink = ui.ink, drawing = ink?.drawing;
  if (!drawing || event.pointerId !== drawing.id) return;
  event.preventDefault();
  const events = event.getCoalescedEvents?.().length ? event.getCoalescedEvents() : [event];
  for (const item of events) {
    const point = pointIn(item);
    if (Math.hypot(point.px-drawing.start.px,point.py-drawing.start.py) > 3) drawing.moved = true;
    if (drawing.stroke) {
      // A light smoothing of the pointer keeps the line calm without lagging behind the pencil.
      const last = drawing.last, k = item.pointerType === 'pen' ? .62 : .5;
      const x = last.x+(point.x-last.x)*k, y = last.y+(point.y-last.y)*k;
      drawing.stroke.p.push(Math.round(x),Math.round(y),Math.round(point.p*100));
      drawing.last = {...point,x,y};
    } else if (drawing.tool === 'eraser') erase(point);
    else if (drawing.mode === 'lasso') drawing.path.push(point);
    else if (drawing.mode === 'move') { ink.selection.transform = {...ink.selection.transform,dx:point.x-drawing.start.x,dy:point.y-drawing.start.y}; }
    else if (drawing.mode === 'scale') {
      const box = drawing.box;
      const scale = Math.max(.2,Math.min(5,Math.max((point.px-box.left)/Math.max(8,box.right-box.left),(point.py-box.top)/Math.max(8,box.bottom-box.top))));
      ink.selection.transform = {...ink.selection.transform,scale};
    }
  }
  if (!drawing.frame) drawing.frame = requestAnimationFrame(() => { drawing.frame = 0; paintLive(); });
}
function onInkUp(event) {
  const ink = ui.ink, drawing = ink?.drawing;
  if (!drawing || event.pointerId !== drawing.id) return;
  cancelAnimationFrame(drawing.frame);
  ink.drawing = null;
  clear($('.nt-ink-live',ink.host));
  $('.nt-ink-lasso',ink.host).innerHTML = '';
  if (drawing.stroke && drawing.woke && !drawing.moved) paintInk();
  else if (drawing.stroke) {
    const stroke = {...drawing.stroke,p:simplify(drawing.stroke.p,4)};
    change({strokes:[]},{strokes:[stroke]});
  } else if (drawing.tool === 'eraser') {
    const gone = ink.doc.strokes.filter(stroke => drawing.erased.has(stroke.id));
    if (gone.length) change({strokes:gone},{strokes:[]}); else paintInk();
  } else if (drawing.mode === 'lasso') {
    const polygon = drawing.path.map(point => ({x:point.x,y:point.y}));
    if (polygon.length > 2) {
      const strokes = ink.doc.strokes.filter(stroke => lassoed(polygon,stroke)).map(stroke => stroke.id);
      const texts = ink.doc.texts.filter(box => inside(polygon,box.x+box.w/2,box.y+120)).map(box => box.id);
      if (strokes.length || texts.length) ink.selection = {strokes,texts};
    }
    paintInk();
  } else if (drawing.mode === 'move' || drawing.mode === 'scale') {
    const sel = ink.selection, t = sel.transform;
    sel.moving = false;
    if (Math.abs(t.dx) > 2 || Math.abs(t.dy) > 2 || Math.abs(t.scale-1) > .01) {
      const strokes = ink.doc.strokes.filter(stroke => sel.strokes.includes(stroke.id)), texts = ink.doc.texts.filter(box => sel.texts.includes(box.id));
      change({strokes,texts},{strokes:strokes.map(stroke => transformStroke(stroke,t)),texts:texts.map(box => transformText(box,t))},{keepSelection:true});
    } else paintInk();
  } else if (drawing.tool === 'text') {
    const box = drawing.text && ink.doc.texts.find(item => item.id === drawing.text);
    if (box) editText(box);
    else if (!drawing.moved) editText({id:newId('t'),x:Math.round(drawing.start.x),y:Math.round(drawing.start.y),w:Math.min(3600,SCALE-Math.round(drawing.start.x)),s:22,c:ui.tools.text,text:'',u:Date.now()},true);
  }
}
function onInkCancel(event) {
  const ink = ui.ink;
  if (!ink?.drawing || event.pointerId !== ink.drawing.id) return;
  discardDrawing();
}
function discardDrawing() {
  const ink = ui.ink;
  if (ink.drawing?.mode === 'move' || ink.drawing?.mode === 'scale') ink.selection.moving = false;
  cancelAnimationFrame(ink.drawing.frame);
  ink.drawing = null;
  clear($('.nt-ink-live',ink.host));
  $('.nt-ink-lasso',ink.host).innerHTML = '';
  paintInk();
}
function paintLive() {
  const ink = ui.ink, drawing = ink?.drawing;
  if (!drawing) return;
  const ctx = clear($('.nt-ink-live',ink.host));
  if (drawing.stroke) {
    ctx.globalAlpha = drawing.stroke.t === 'hl' ? .5 : 1;
    drawStroke(ctx,drawing.stroke,ink.width,ink.height);
    ctx.globalAlpha = 1;
  } else if (drawing.mode === 'lasso') {
    const path = drawing.path.map(point => `${point.px.toFixed(1)},${point.py.toFixed(1)}`).join(' ');
    $('.nt-ink-lasso',ink.host).innerHTML = `<polygon points="${path}" class="nt-lasso-path"/>`;
  } else if (drawing.mode === 'move' || drawing.mode === 'scale') {
    const sel = ink.selection;
    for (const stroke of ink.doc.strokes) if (sel.strokes.includes(stroke.id)) {
      ctx.globalAlpha = stroke.t === 'hl' ? .5 : 1;
      drawStroke(ctx,transformStroke(stroke,sel.transform),ink.width,ink.height);
    }
    ctx.globalAlpha = 1;
    renderTexts();
    renderSelection();
  } else if (drawing.tool === 'eraser') paintInk();
}
function erase(point) {
  const ink = ui.ink, radius = Math.max(7,ink.width*.012);
  let hit = false;
  for (const stroke of ink.doc.strokes) {
    if (ink.drawing.erased.has(stroke.id)) continue;
    if (touches(stroke,point.px,point.py,radius,ink.width,ink.height)) { ink.drawing.erased.add(stroke.id); hit = true; }
  }
  if (hit) paintInk();
}
const transformText = (box,t) => ({...box,x:Math.round(t.ox+(box.x-t.ox)*t.scale+t.dx),y:Math.round(t.oy+(box.y-t.oy)*t.scale+t.dy),w:Math.round(Math.max(600,box.w*t.scale)),s:Math.max(8,Math.min(80,+(box.s*t.scale).toFixed(1)))});

/* ---------- Changes, undo and redo ---------- */
// One edit replaces some strokes and text boxes by others; undo swaps them back. Items that come
// back get a newer time, so a merge with another device keeps them.
function apply(from,to) {
  const ink = ui.ink, now = Date.now(), doc = ink.doc;
  const back = new Set([...(to.strokes || []),...(to.texts || [])].map(item => item.id));
  for (const item of [...(from.strokes || []),...(from.texts || [])]) if (!back.has(item.id)) doc.gone[item.id] = now;
  const drop = new Set([...(from.strokes || []),...(from.texts || [])].map(item => item.id));
  doc.strokes = doc.strokes.filter(item => !drop.has(item.id)).concat((to.strokes || []).map(item => ({...item,u:now+1})));
  doc.texts = doc.texts.filter(item => !drop.has(item.id)).concat((to.texts || []).map(item => ({...item,u:now+1})));
  for (const id of back) delete doc.gone[id];
}
function change(from,to,{keepSelection = false} = {}) {
  const history = pageHistory();
  apply(from,to);
  history.undo.push({from,to});
  if (history.undo.length > 120) history.undo.shift();
  history.redo = [];
  if (keepSelection && ui.ink.selection) ui.ink.selection = {strokes:(to.strokes || []).map(item => item.id),texts:(to.texts || []).map(item => item.id)};
  else if (!keepSelection) ui.ink.selection = null;
  commitDoc();
}
function undo(redo = false) {
  if (!ui.ink) return;
  const history = pageHistory();
  const step = (redo ? history.redo : history.undo).pop();
  if (!step) return;
  if (redo) apply(step.from,step.to); else apply(step.to,step.from);
  (redo ? history.undo : history.redo).push(step);
  ui.ink.selection = null;
  commitDoc();
}
function commitDoc() {
  const ink = ui.ink;
  // Saved stroke by stroke over the stored page, so strokes this view has not seen (another device's,
  // or ones read after the page was opened) stay; erasing and undo are carried by the tombstones.
  const stored = pageItem();
  const data = stored ? mergePages(stored.data,ink.doc) : ink.doc;
  if (data.shared && pageIsEmpty(data)) { data.shared = false; data.mu = Date.now(); }
  const result = guard(() => ui.store.save({id:ink.id,kind:'page',book:ink.book,place:ink.page,data}));
  if (!result) { ink.doc = readDoc(); }
  else ink.doc = normalizePage(result.data);
  paintInk();
  updatePalette();
}
// Another device's edit arrived for the page on screen: show it unless a stroke is in progress.
function pageChanged(id) {
  if (!ui.ink || ui.ink.id !== id || ui.ink.drawing || ui.ink.editing) return;
  ui.ink.doc = readDoc();
  paintInk();
}

/* ---------- Lasso selection ---------- */
function selectionBox(sel) {
  const ink = ui.ink;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const stroke of ink.doc.strokes) if (sel.strokes.includes(stroke.id)) {
    const b = bounds(stroke), pad = stroke.w/1000*SCALE/2;
    minX = Math.min(minX,b.minX-pad); minY = Math.min(minY,b.minY-pad*ink.width/ink.height); maxX = Math.max(maxX,b.maxX+pad); maxY = Math.max(maxY,b.maxY+pad*ink.width/ink.height);
  }
  for (const node of $$('[data-nt-text]',ink.host)) if (sel.texts.includes(node.dataset.ntText)) {
    const box = ink.doc.texts.find(item => item.id === node.dataset.ntText);
    if (!box) continue;
    minX = Math.min(minX,box.x); minY = Math.min(minY,box.y); maxX = Math.max(maxX,box.x+box.w); maxY = Math.max(maxY,box.y+node.offsetHeight/ink.height*SCALE);
  }
  if (!Number.isFinite(minX)) return null;
  const t = sel.moving ? sel.transform : {dx:0,dy:0,scale:1,ox:minX,oy:minY};
  const map = (x,y) => ({x:(t.ox+(x-t.ox)*t.scale+t.dx)/SCALE*ink.width,y:(t.oy+(y-t.oy)*t.scale+t.dy)/SCALE*ink.height});
  const a = map(minX,minY), b = map(maxX,maxY);
  return {left:a.x-6,top:a.y-6,right:b.x+6,bottom:b.y+6,ox:minX,oy:minY};
}
function renderSelection() {
  const ink = ui.ink;
  const lasso = $('.nt-ink-lasso',ink.host);
  if (ink.drawing?.mode === 'lasso') return;
  const box = ink.selection && selectionBox(ink.selection);
  if (!box) { lasso.innerHTML = ''; hideSelectionMenu(); return; }
  lasso.innerHTML = `<rect class="nt-sel-box" x="${box.left}" y="${box.top}" width="${box.right-box.left}" height="${box.bottom-box.top}" rx="6"/><circle class="nt-sel-handle" cx="${box.right}" cy="${box.bottom}" r="7"/>`;
  if (!ink.selection.moving && !ink.drawing) showSelectionMenu(box);
}
function showSelectionMenu(box) {
  const ink = ui.ink;
  let menu = $('.nt-sel-menu',ink.host);
  if (!menu) { menu = document.createElement('div'); menu.className = 'nt-sel-menu'; ink.host.append(menu); }
  menu.innerHTML = `${INK_COLORS.map(color => `<button type="button" class="nt-dot" data-nt="sel-color" data-color="${color}" style="--dot:${INK[color]}" aria-label="改成${INK_NAMES[color]}"></button>`).join('')}<span class="nt-sep"></span><button type="button" class="nt-sel-delete" data-nt="sel-delete" aria-label="删除所选">${ICONS.trash}</button>`;
  const top = box.top > 52 ? box.top-46 : box.bottom+10;
  menu.style.left = `${Math.max(4,Math.min(ink.width-menu.offsetWidth-4,(box.left+box.right)/2-menu.offsetWidth/2))}px`;
  menu.style.top = `${top}px`;
}
function hideSelectionMenu() { ui.ink && $('.nt-sel-menu',ui.ink.host)?.remove(); }
function clearSelection() { if (ui.ink?.selection) { ui.ink.selection = null; renderSelection(); } }
function selectionAction(action,color) {
  const ink = ui.ink, sel = ink?.selection;
  if (!sel) return;
  const strokes = ink.doc.strokes.filter(stroke => sel.strokes.includes(stroke.id)), texts = ink.doc.texts.filter(box => sel.texts.includes(box.id));
  if (action === 'sel-delete') change({strokes,texts},{strokes:[],texts:[]});
  else change({strokes,texts},{strokes:strokes.map(stroke => ({...stroke,c:color})),texts:texts.map(box => ({...box,c:color}))},{keepSelection:true});
}

/* ---------- Text boxes ---------- */
function editText(box,created = false) {
  const ink = ui.ink;
  finishTextEdit();
  ink.editing = {id:box.id,box,created};
  renderTexts();
  const editor = document.createElement('textarea');
  editor.className = 'nt-text-editor';
  editor.value = box.text;
  editor.maxLength = LIMITS.text;
  editor.setAttribute('aria-label','页面文字');
  editor.placeholder = '写点什么…';
  Object.assign(editor.style,{left:`${box.x/SCALE*100}%`,top:`${box.y/SCALE*100}%`,width:`${box.w/SCALE*100}%`,fontSize:`${box.s/1000*ink.width}px`,color:INK[box.c]});
  ink.host.append(editor);
  const grow = () => { editor.style.height = 'auto'; editor.style.height = `${editor.scrollHeight+2}px`; };
  editor.addEventListener('input',grow);
  editor.addEventListener('blur',() => finishTextEdit());
  editor.addEventListener('keydown',event => { if (event.key === 'Escape') { event.stopPropagation(); editor.blur(); } });
  grow();
  editor.focus({preventScroll:true});
}
function finishTextEdit() {
  const ink = ui.ink, editing = ink?.editing;
  if (!editing) return;
  ink.editing = null;
  const editor = $('.nt-text-editor',ink.host);
  const value = editor?.value.replace(/\s+$/,'') || '';
  editor?.remove();
  const before = ink.doc.texts.find(item => item.id === editing.id);
  if (!value.trim()) { if (before) change({texts:[before]},{texts:[]}); else renderTexts(); return; }
  if (before && before.text === value) { renderTexts(); return; }
  change({texts:before ? [before] : []},{texts:[{...editing.box,text:value,c:before ? editing.box.c : ui.tools.text}]});
}

/* ---------- The tool palette ---------- */
function setAnnotating(on) {
  ui.annotating = on && !!ui.ink;
  document.body.classList.toggle('nt-annotating',ui.annotating);
  ui.ink?.stage.classList.toggle('nt-drawing',ui.annotating && ui.tools.fingers);
  if (!ui.annotating) { finishTextEdit(); clearSelection(); hidePalette(); }
  else showPalette();
  placeDock();
}
function paletteMarkup() {
  const t = ui.tools, colorTool = ['pen','hl','text'].includes(t.tool) ? t.tool : '';
  const history = ui.ink ? pageHistory() : {undo:[],redo:[]};
  const tool = (name,label) => `<button type="button" class="nt-tool${t.tool === name ? ' is-on' : ''}" data-nt="tool" data-tool="${name}" aria-pressed="${t.tool === name}" title="${label}" aria-label="${label}">${ICONS[name]}</button>`;
  const palette = colorTool === 'hl' ? HIGHLIGHT : INK;
  const sizes = colorTool === 'hl' ? HIGHLIGHT_SIZES : PEN_SIZES, size = colorTool === 'hl' ? t.hlSize : t.penSize;
  const doc = ui.ink?.doc;
  return `<div class="nt-palette-row">
    <div class="nt-group">${tool('pen','钢笔')}${tool('hl','荧光笔')}${tool('eraser','橡皮（整笔擦除）')}${tool('lasso','套索：圈选后移动、缩放、改色')}${tool('text','文字框')}</div>
    <span class="nt-sep"></span>
    <div class="nt-group nt-colors"${colorTool ? '' : ' aria-disabled="true"'}>${INK_COLORS.map(color => `<button type="button" class="nt-dot${colorTool && t[colorTool] === color ? ' is-on' : ''}" data-nt="color" data-color="${color}" style="--dot:${palette[color]}" aria-label="${INK_NAMES[color]}" aria-pressed="${!!colorTool && t[colorTool] === color}"${colorTool ? '' : ' disabled'}></button>`).join('')}</div>
    ${colorTool && colorTool !== 'text' ? `<span class="nt-sep"></span><div class="nt-group">${sizes.map((value,index) => `<button type="button" class="nt-size${index === size ? ' is-on' : ''}" data-nt="size" data-size="${index}" aria-label="${['细','中','粗'][index]}" aria-pressed="${index === size}"><i style="--size:${[3,5.5,8][index]}px;--dot:${palette[t[colorTool]]}"></i></button>`).join('')}</div>` : ''}
    <span class="nt-sep"></span>
    <div class="nt-group"><button type="button" class="nt-tool" data-nt="undo" aria-label="撤销" title="撤销"${history.undo.length ? '' : ' disabled'}>${ICONS.undo}</button><button type="button" class="nt-tool" data-nt="redo" aria-label="重做" title="重做"${history.redo.length ? '' : ' disabled'}>${ICONS.redo}</button></div>
    <div class="nt-group nt-tail"><button type="button" class="nt-tool" data-nt="palette-menu" aria-label="更多" aria-expanded="${ui.menuOpen}">${ICONS.more}</button><button type="button" class="nt-done" data-nt="done">完成</button></div>
  </div>
  ${ui.menuOpen ? `<div class="nt-palette-menu" role="menu">
    <button type="button" role="menuitemcheckbox" data-nt="fingers" aria-checked="${t.fingers}">${ICONS.finger}<span>手指也能书写<small>${t.fingers ? '单指写字，双指拖动页面' : '只用 Apple Pencil 或鼠标书写'}</small></span><i class="nt-switch${t.fingers ? ' is-on' : ''}"></i></button>
    <button type="button" role="menuitem" data-nt="share-page"${doc && !pageIsEmpty(doc) ? '' : ' disabled'}>${ICONS.globe}<span>${doc?.shared ? '已公开 · 修改说明或撤回' : '发布本页到笔记广场'}<small>${doc?.shared ? '广场上会同步你之后的修改' : '只公开这一页，其他笔记仍然私密'}</small></span></button>
    <button type="button" role="menuitem" data-nt="clear-page" class="is-danger"${doc && !pageIsEmpty(doc) ? '' : ' disabled'}>${ICONS.trash}<span>清空本页<small>可以撤销</small></span></button>
  </div>` : ''}
  ${ui.overlay ? `<div class="nt-overlay-chip">${ICONS.eye}<span>正在叠加「${e(ui.overlay.nickname)}」的笔记</span><button type="button" data-nt="overlay-off" aria-label="停止叠加">${ICONS.close}</button></div>` : ''}`;
}
function showPalette() {
  const view = $('#reading-view');
  if (!view || !ui.ink) return;
  if (!ui.palette) {
    ui.palette = document.createElement('div');
    ui.palette.className = 'nt-palette';
    ui.palette.setAttribute('role','toolbar');
    ui.palette.setAttribute('aria-label','手写工具');
  }
  if (!ui.palette.isConnected) view.append(ui.palette);
  updatePalette();
  requestAnimationFrame(() => ui.palette?.classList.add('is-open'));
}
function updatePalette() {
  const palette = ui.palette;
  if (!palette?.isConnected || !ui.ink) return;
  palette.innerHTML = paletteMarkup();
  // While writing, the palette lies over the reading toolbar (as the markup bar does in Apple Books),
  // so the whole page stays free to write on.
  const bar = $('#reading-view .reader-toolbar');
  const top = bar ? bar.offsetTop+(bar.offsetHeight-$('.nt-palette-row',palette).offsetHeight)/2 : ui.ink.stage.offsetTop+10;
  palette.style.top = `${Math.max(0,top)}px`;
}
function hidePalette() {
  ui.menuOpen = false;
  ui.palette?.classList.remove('is-open');
  ui.palette?.remove();
}
function overlayChip() {
  if (ui.annotating) { updatePalette(); return; }
  const view = $('#reading-view');
  let chip = $('.nt-overlay-float',view);
  if (!ui.overlay || !ui.ink) { chip?.remove(); return; }
  if (!chip) { chip = document.createElement('div'); chip.className = 'nt-overlay-chip nt-overlay-float'; view.append(chip); }
  chip.innerHTML = `${ICONS.eye}<span>正在叠加「${e(ui.overlay.nickname)}」的笔记</span><button type="button" data-nt="overlay-off" aria-label="停止叠加">${ICONS.close}</button>`;
  chip.style.top = `${ui.ink.stage.offsetTop+10}px`;
}

/* ---------- The dock: two buttons floating at the page's top right ---------- */
// The reading toolbar has no room to spare, so the notes controls float over the page instead.
function placeDock() {
  const view = $('#reading-view');
  if (!view || view.hidden || !ui.store) { ui.dock?.remove(); return; }
  const text = document.body.classList.contains('read-text');
  const target = text ? $('#reader-text') : $('#pdf-stage');
  if (!target || target.hidden || (!text && !ui.ink)) { ui.dock?.remove(); return; }
  if (!ui.dock) { ui.dock = document.createElement('div'); ui.dock.className = 'nt-dock'; ui.dock.setAttribute('role','group'); ui.dock.setAttribute('aria-label','笔记'); }
  const open = !!ui.drawer && !ui.drawer.hidden;
  ui.dock.innerHTML = `${text ? '' : `<button type="button" class="nt-dock-button${ui.annotating ? ' is-on' : ''}" data-nt="dock-pen" aria-pressed="${ui.annotating}" title="手写标注 · Apple Pencil 可直接在页面上写" aria-label="手写标注">${ICONS.pen}</button>`}<button type="button" class="nt-dock-button${open ? ' is-on' : ''}" data-nt="dock-notes" aria-expanded="${open}" title="我的笔记与大家的笔记" aria-label="笔记">${ICONS.notebook}${text ? '<span>笔记</span>' : ''}</button>`;
  if (!ui.dock.isConnected) view.append(ui.dock);
  const box = view.getBoundingClientRect(), area = target.getBoundingClientRect();
  // On phones it sits at the bottom, under the thumb; elsewhere at the top right of the page.
  ui.dock.style.top = `${narrow() ? area.bottom-box.top-ui.dock.offsetHeight-12 : area.top-box.top+12}px`;
  ui.dock.style.right = `${box.right-(area.left+target.clientWidth)+12}px`;
  ui.dock.hidden = ui.annotating;
}

/* ================= Highlights and thoughts in 听读 ================= */
const lessonBook = view => view?.meta?.bookId || 'textbook';
const lessonPlace = view => String(view?.meta?.readingId ?? view?.meta?.id ?? '');
const marksHere = () => ui.lesson ? ui.store.marksIn(lessonBook(ui.lesson),lessonPlace(ui.lesson)) : [];
const covers = (mark,range) => !(mark.s1 < range.from.s || (mark.s1 === range.from.s && mark.w1 < range.from.w) || mark.s0 > range.to.s || (mark.s0 === range.to.s && mark.w0 > range.to.w));
// A highlight keeps the sentence it began in; after the lesson text is rebuilt it follows that sentence.
function anchored(data,view = ui.lesson) {
  const sentences = view?.data?.sentences || [];
  if (sentences[data.s0]?.text === data.anchor || !data.anchor) return data;
  const moved = sentences.findIndex(sentence => sentence.text === data.anchor);
  if (moved < 0) return null;
  const shift = moved-data.s0;
  return {...data,s0:data.s0+shift,s1:data.s1+shift};
}
function lessonShown(view) {
  ui.lessonObserver?.disconnect();
  ui.lesson = view && view.root?.isConnected ? view : null;
  placeDock();
  if (!ui.lesson) return;
  const text = $('.rd-text',view.root);
  if (!text) return;
  // Two layers: the highlights multiply with the text under them; the note buttons stay crisp above.
  if (!$('.nt-marks',text)) text.prepend(Object.assign(document.createElement('div'),{className:'nt-marks'}),Object.assign(document.createElement('div'),{className:'nt-mark-glyphs'}));
  ui.lessonObserver = new ResizeObserver(() => paintMarks());
  ui.lessonObserver.observe(text);
  paintMarks();
  if (ui.showOthers) loadOthers();
  if (ui.drawer && !ui.drawer.hidden) renderDrawer();
  if (ui.pendingMark) {
    const id = ui.pendingMark;
    ui.pendingMark = '';
    requestAnimationFrame(() => focusMark(id));
  }
}
function wordNode(root,s,w) { return $(`.rd-sentence[data-s="${s}"] .rd-w[data-w="${w}"]`,root); }
function rangeRects(view,data,layerBox) {
  const rects = [];
  for (let s = data.s0; s <= data.s1; s++) {
    const sentence = view.data.sentences[s];
    if (!sentence) break;
    const last = (sentence.words || []).length-1;
    const first = wordNode(view.root,s,s === data.s0 ? data.w0 : 0), end = wordNode(view.root,s,s === data.s1 ? Math.min(data.w1,last) : last);
    if (!first || !end) continue;
    const range = document.createRange();
    range.setStartBefore(first); range.setEndAfter(end);
    for (const rect of range.getClientRects()) {
      if (rect.width < 2) continue;
      const top = rect.top-layerBox.top, left = rect.left-layerBox.left;
      const row = rects.find(item => Math.abs(item.top-top) < 4);
      if (row) { const right = Math.max(row.left+row.width,left+rect.width); row.left = Math.min(row.left,left); row.width = right-row.left; }
      else rects.push({top,left,width:rect.width,height:rect.height});
    }
  }
  return rects;
}
function paintMarks() {
  const view = ui.lesson;
  const layer = view && $('.nt-marks',view.root), glyphs = view && $('.nt-mark-glyphs',view.root);
  if (!layer || !glyphs) return;
  const box = layer.getBoundingClientRect();
  let html = '', buttons = '';
  if (ui.showOthers) for (const other of ui.others.key === `${lessonBook(view)}:${lessonPlace(view)}` ? ui.others.items.filter(item => item.kind === 'mark') : []) {
    const data = anchored(normalizeMark(other.data),view);
    if (!data) continue;
    for (const rect of rangeRects(view,data,box)) html += `<i class="nt-other-line" style="left:${rect.left}px;top:${rect.top+rect.height-5}px;width:${rect.width}px"></i>`;
  }
  for (const item of marksHere()) {
    const data = anchored(item.data,view);
    if (!data) continue;
    const rects = rangeRects(view,data,box);
    rects.forEach(rect => { html += `<i class="nt-hl nt-c-${data.color}" style="left:${rect.left-2}px;top:${rect.top+1}px;width:${rect.width+4}px;height:${rect.height}px"></i>`; });
    const last = rects[rects.length-1];
    if (last && (data.note || data.shared)) buttons += `<i class="nt-glyph nt-c-${data.color}" style="left:${last.left+last.width-4}px;top:${last.top-7}px" title="${data.note ? '有想法' : '已公开'}">${data.note ? ICONS.thought : ICONS.globe}</i>`;
  }
  layer.innerHTML = html;
  glyphs.innerHTML = buttons;
}
function focusMark(id) {
  const item = ui.store.get(id), view = ui.lesson;
  if (!item || !view) return;
  const data = anchored(item.data,view);
  const node = data && wordNode(view.root,data.s0,data.w0);
  if (!node) return;
  node.scrollIntoView({block:'center',behavior:reduced() ? 'auto' : 'smooth'});
  const sentence = node.closest('.rd-sentence');
  sentence?.classList.add('nt-flash');
  setTimeout(() => sentence?.classList.remove('nt-flash'),1600);
}
// The actions under a word or phrase card in 听读; reader.js asks for them while building the card.
function cardBar(context) {
  if (!ui.store || !context?.range) return '';
  ui.card = context;
  const current = marksHere().find(item => { const data = anchored(item.data); return data && covers(data,context.range); });
  context.markId = current?.id || '';
  const color = current ? current.data.color : '';
  return `<div class="nt-bar" role="group" aria-label="划线与笔记">
    <div class="nt-swatches">${MARK_COLORS.map(name => `<button type="button" class="nt-swatch nt-c-${name}${color === name ? ' is-on' : ''}" data-nt="mark" data-color="${name}" aria-pressed="${color === name}" aria-label="${MARK_NAMES[name]}色划线" title="${MARK_NAMES[name]}色划线"></button>`).join('')}</div>
    <span class="nt-sep"></span>
    <button type="button" class="nt-bar-button" data-nt="thought">${ICONS.thought}<span>${current?.data.note ? '改想法' : '写想法'}</span></button>
    <button type="button" class="nt-bar-button" data-nt="to-wordbook">${ICONS.words}<span>加入词本</span></button>
    ${current ? `<button type="button" class="nt-bar-icon" data-nt="unmark" aria-label="删除划线" title="删除划线">${ICONS.trash}</button>` : ''}
  </div>${current?.data.note ? `<blockquote class="nt-bar-note nt-c-${current.data.color}">${multiline(current.data.note)}</blockquote>` : ''}`;
}
function quoteFor(view,data) {
  const parts = [];
  for (let s = data.s0; s <= data.s1; s++) {
    const sentence = view.data.sentences[s], words = sentence?.words || [];
    if (!words.length) continue;
    const a = words[s === data.s0 ? data.w0 : 0], b = words[s === data.s1 ? Math.min(data.w1,words.length-1) : words.length-1];
    if (a && b) parts.push(sentence.text.slice(a[0],b[1]));
  }
  return parts.join(' ');
}
// A new highlight swallows the highlights it overlaps (as in Apple Books): one range, their thoughts joined.
function saveMark({color,note,shared,range,markId}) {
  const view = ui.lesson;
  if (!view) return null;
  const overlapping = marksHere().filter(item => { const data = anchored(item.data); return data && (item.id === markId || covers(data,range)); });
  let s0 = range.from.s, w0 = range.from.w, s1 = range.to.s, w1 = range.to.w;
  for (const item of overlapping) {
    const data = anchored(item.data);
    if (data.s0 < s0 || (data.s0 === s0 && data.w0 < w0)) { s0 = data.s0; w0 = data.w0; }
    if (data.s1 > s1 || (data.s1 === s1 && data.w1 > w1)) { s1 = data.s1; w1 = data.w1; }
  }
  const keep = overlapping.find(item => item.id === markId) || overlapping[0];
  const notes = note !== undefined ? [note] : overlapping.map(item => item.data.note).filter(Boolean);
  const data = {s0,w0,s1,w1,anchor:view.data.sentences[s0]?.text || '',color:color || keep?.data.color || 'amber',
    note:notes.join('\n\n'),shared:shared ?? overlapping.some(item => item.data.shared),created:keep?.data.created || new Date().toISOString(),...(keep?.data.from ? {from:keep.data.from} : {})};
  data.quote = quoteFor(view,data);
  return guard(() => {
    for (const item of overlapping) if (item !== keep) ui.store.remove(item.id);
    return ui.store.save({id:keep?.id || newId('m'),kind:'mark',book:lessonBook(view),place:lessonPlace(view),data});
  });
}
function cardAction(action,button) {
  const context = ui.card;
  if (!context) return;
  const close = () => ui.deps.closeReaderCard?.();
  if (action === 'mark') {
    const current = context.markId && ui.store.get(context.markId);
    if (current) guard(() => ui.store.save({...current,data:{...current.data,color:button.dataset.color}}));
    else saveMark({color:button.dataset.color,range:context.range});
    close();
  } else if (action === 'unmark') {
    const current = context.markId && ui.store.get(context.markId);
    if (current) { ui.store.remove(current.id); notify('已删除这条划线。'); }
    close();
  } else if (action === 'thought') {
    const current = context.markId && ui.store.get(context.markId);
    close();
    openMarkComposer(current,context.range,context.text);
  } else if (action === 'to-wordbook') {
    close();
    ui.deps.addToWordbook({word:context.text,meaning:context.meaning,example:context.sentence,exampleZh:context.sentenceZh});
  }
}
function openMarkComposer(item,range,text) {
  const data = item?.data;
  openComposer({kicker:data?.note ? '修改想法' : '写想法',quote:data?.quote || text,color:data?.color || 'amber',note:data?.note || '',shared:!!data?.shared,from:data?.from,
    placeholder:'这一句让你想到了什么？语法、用法、联想都可以写下来。',
    onSave:({note,shared}) => {
      if (item) return guard(() => ui.store.save({...item,data:{...item.data,note,shared}}));
      return saveMark({note,shared,range});
    },
    onDelete:item ? () => { ui.store.remove(item.id); notify('已删除这条划线。'); } : null});
}

/* ================= Dialogs ================= */
function openDialog(name,className,html,{onClose,label = '笔记',unsaved = () => false} = {}) {
  closeDialog(name,true);
  const shade = document.createElement('div');
  shade.className = 'nt-shade';
  const dialog = document.createElement('div');
  dialog.className = `nt-dialog ${className}`;
  dialog.setAttribute('role','dialog');
  dialog.setAttribute('aria-modal','true');
  dialog.setAttribute('aria-label',label);
  dialog.innerHTML = html;
  const opener = document.activeElement;
  document.body.append(shade,dialog);
  const entry = {name,shade,dialog,onClose,opener};
  ui.dialogs.push(entry);
  ui.deps.openLayer?.(`nt-${name}`,() => closeDialog(name,true,true));
  const dismiss = () => {
    if (!unsaved()) { closeDialog(name); return; }
    const field = $('textarea',dialog);
    field?.focus({preventScroll:true});
    dialog.classList.remove('nt-nudge'); void dialog.offsetWidth; dialog.classList.add('nt-nudge');
  };
  shade.addEventListener('click',dismiss);
  dialog.addEventListener('keydown',event => { if (event.key === 'Escape') { event.stopPropagation(); dismiss(); } });
  requestAnimationFrame(() => { shade.classList.add('is-open'); dialog.classList.add('is-open'); });
  return dialog;
}
function closeDialog(name,quiet = false,fromHistory = false) {
  const index = ui.dialogs.findIndex(item => item.name === name);
  if (index < 0) return;
  const [entry] = ui.dialogs.splice(index,1);
  if (!fromHistory) ui.deps.closeLayer?.(`nt-${name}`);
  entry.shade.remove();
  entry.dialog.remove();
  if (!quiet) entry.onClose?.();
  if (entry.opener?.isConnected) entry.opener.focus?.({preventScroll:true});
}
function openComposer({kicker,quote,color,note,shared,from,placeholder,onSave,onDelete,caption = false}) {
  const dialog = openDialog('composer','nt-composer',`<form class="nt-composer-card">
    <header class="nt-dialog-head"><p class="nt-kicker">${e(kicker)}</p><button type="button" class="nt-icon-button" data-nt="dialog-close" aria-label="关闭">${ICONS.close}</button></header>
    ${quote ? `<blockquote class="nt-quote nt-c-${e(color)}" lang="nb">${e(quote)}</blockquote>` : ''}
    ${from ? `<p class="nt-from">收自「${e(from.name)}」的笔记</p>` : ''}
    <label class="nt-field"><span class="sr-only">${caption ? '说明' : '想法'}</span><textarea name="note" rows="${caption ? 3 : 5}" maxlength="${caption ? LIMITS.caption : LIMITS.note}" placeholder="${e(placeholder)}">${e(note)}</textarea></label>
    <label class="nt-share"><input type="checkbox" name="shared"${shared ? ' checked' : ''}><span class="nt-switch"></span><span><strong>公开到笔记广场</strong><small>以你的昵称展示，可随时撤回。其他人可以点赞、评论和收藏。</small></span></label>
    <footer class="nt-dialog-actions">${onDelete ? `<button type="button" class="nt-text-button is-danger" data-nt="composer-delete">${caption ? '撤回公开' : '删除划线'}</button>` : ''}<span></span><button type="button" class="nt-button" data-nt="dialog-close">取消</button><button type="submit" class="nt-button is-primary">保存</button></footer>
  </form>`,{label:kicker,unsaved:() => form.elements.note.value !== note || form.elements.shared.checked !== !!shared});
  const form = $('form',dialog), field = form.elements.note;
  field.focus({preventScroll:true});
  field.setSelectionRange(field.value.length,field.value.length);
  form.addEventListener('submit',event => {
    event.preventDefault();
    const result = onSave({note:field.value,shared:form.elements.shared.checked});
    if (result !== null) closeDialog('composer',true);
  });
  form.addEventListener('keydown',event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) form.requestSubmit(); });
  $('[data-nt="composer-delete"]',dialog)?.addEventListener('click',() => { onDelete(); closeDialog('composer',true); });
}
function sharePage() {
  const ink = ui.ink;
  if (!ink) return;
  ui.menuOpen = false;
  updatePalette();
  const doc = ink.doc;
  openComposer({kicker:doc.shared ? '本页已公开' : '发布本页到笔记广场',caption:true,note:doc.caption,shared:true,
    placeholder:'给这一页写一句说明（可不填），比如「第 3 课动词变位整理」。',
    onSave:({note,shared}) => {
      ink.doc = {...ink.doc,caption:note,shared,mu:Date.now()};
      commitDoc();
      notify(shared ? '已发布到笔记广场。' : '已撤回，本页只有你能看到。');
      return true;
    },
    onDelete:doc.shared ? () => { ink.doc = {...ink.doc,shared:false,mu:Date.now()}; commitDoc(); notify('已撤回，本页只有你能看到。'); } : null});
}

/* ================= Pictures of pages ================= */
// A page picture: the original page (when it can be drawn) with the handwriting over it.
async function pageThumb(canvas,book,page,data) {
  const doc = normalizePage(data);
  const width = canvas.clientWidth || 220, height = Math.round(width*(doc.aspect || 1.414));
  const ratio = Math.min(window.devicePixelRatio || 1,2);
  canvas.width = Math.round(width*ratio); canvas.height = Math.round(height*ratio);
  canvas.style.aspectRatio = `${width} / ${height}`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio,0,0,ratio,0,0);
  ctx.fillStyle = '#fffdf6';
  ctx.fillRect(0,0,width,height);
  drawPage(ctx,doc,width,height);
  try {
    const image = await ui.deps.pageImage(book,page,width*ratio);
    if (!image || !canvas.isConnected) return;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    ctx.setTransform(ratio,0,0,ratio,0,0);
    drawPage(ctx,doc,width,height);
  } catch { /* The handwriting alone still reads. */ }
}
let thumbObserver;
function watchThumbs(root) {
  const fill = canvas => {
    const source = ui.thumbs.get(canvas.dataset.ntThumb);
    if (source) pageThumb(canvas,source.book,source.page,source.data);
  };
  if (!('IntersectionObserver' in window)) { $$('canvas[data-nt-thumb]',root).forEach(fill); return; }
  thumbObserver ||= new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { thumbObserver.unobserve(entry.target); fill(entry.target); }
  },{rootMargin:'240px'});
  $$('canvas[data-nt-thumb]',root).forEach(canvas => thumbObserver.observe(canvas));
}
function thumb(key,book,page,data) {
  ui.thumbs.set(key,{book,page,data});
  if (ui.thumbs.size > 400) ui.thumbs.delete(ui.thumbs.keys().next().value);
  return `<canvas class="nt-thumb" data-nt-thumb="${e(key)}" style="aspect-ratio:1 / ${normalizePage(data).aspect}" aria-hidden="true"></canvas>`;
}

/* ================= Entries (shared by the drawer, the overview and the square) ================= */
function myEntry(item,{showBook = false} = {}) {
  const label = ui.deps.placeLabel(item.book,item.kind,item.place);
  const meta = `${showBook ? `${e(ui.deps.bookLabel(item.book))} · ` : ''}${e(label)} · ${e(when(item.updated))}`;
  const badge = item.data.shared ? `<span class="nt-badge">${ICONS.globe}已公开</span>` : '';
  if (item.kind === 'page') {
    const d = item.data;
    return `<article class="nt-entry is-page" data-nt="jump" data-id="${e(item.id)}" tabindex="0">
      ${thumb(`mine:${item.id}:${item.updated}`,item.book,item.place,d)}
      <div class="nt-entry-body"><p class="nt-entry-meta">${meta}</p><p class="nt-entry-title">${d.caption ? e(d.caption) : `${d.strokes.length} 笔${d.texts.length ? ` · ${d.texts.length} 段文字` : ''}`}</p>${d.from ? `<p class="nt-from">含收自「${e(d.from.name)}」的笔记</p>` : ''}${badge}</div>
    </article>`;
  }
  const d = item.data;
  return `<article class="nt-entry is-mark nt-c-${d.color}" data-nt="jump" data-id="${e(item.id)}" tabindex="0">
    <blockquote class="nt-quote" lang="nb">${e(d.quote)}</blockquote>
    ${d.note ? `<p class="nt-entry-note">${multiline(d.note)}</p>` : ''}
    <p class="nt-entry-meta">${meta}${d.from ? ` · 收自「${e(d.from.name)}」` : ''}</p>${badge}
  </article>`;
}
function sharedEntry(item,{showPlace = true,overlay = false} = {}) {
  const d = item.data;
  const meta = `<span class="nt-author">${e(item.nickname)}</span>${showPlace ? `<span>${e(ui.deps.bookLabel(item.book))} · ${e(ui.deps.placeLabel(item.book,item.kind,item.place))}</span>` : ''}<span>${e(when(item.publishedAt))}</span>`;
  const stats = `<div class="nt-stats"><button type="button" class="nt-stat${item.liked ? ' is-on' : ''}" data-nt="like" data-id="${e(item.id)}" aria-pressed="${item.liked}" aria-label="点赞"${item.mine ? ' disabled' : ''}>${ICONS.heart}<span>${item.likes || ''}</span></button><button type="button" class="nt-stat" data-nt="detail" data-id="${e(item.id)}" aria-label="评论">${ICONS.chat}<span>${item.comments || ''}</span></button>${item.collects ? `<span class="nt-stat is-static">${ICONS.collect}<span>${item.collects}</span></span>` : ''}${overlay ? `<button type="button" class="nt-stat nt-overlay-toggle${ui.overlay?.id === item.id ? ' is-on' : ''}" data-nt="overlay" data-id="${e(item.id)}" aria-pressed="${ui.overlay?.id === item.id}">${ICONS.eye}<span>${ui.overlay?.id === item.id ? '取消叠加' : '叠加到本页'}</span></button>` : ''}</div>`;
  if (item.kind === 'page') {
    return `<article class="nt-entry is-page is-shared" data-nt="detail" data-id="${e(item.id)}" tabindex="0">
      ${d ? thumb(`pub:${item.id}:${item.updated}`,item.book,item.place,d) : `<div class="nt-thumb is-heavy">${ICONS.pen}<span>笔迹较多，点开查看</span></div>`}
      <div class="nt-entry-body"><p class="nt-entry-meta">${meta}</p>${d?.caption ? `<p class="nt-entry-title">${e(d.caption)}</p>` : ''}${stats}</div>
    </article>`;
  }
  const m = normalizeMark(d);
  return `<article class="nt-entry is-mark is-shared nt-c-${m.color}" data-nt="detail" data-id="${e(item.id)}" tabindex="0">
    <blockquote class="nt-quote" lang="nb">${e(m.quote)}</blockquote>${m.note ? `<p class="nt-entry-note">${multiline(m.note)}</p>` : ''}
    <p class="nt-entry-meta">${meta}</p>${stats}
  </article>`;
}

/* ================= The drawer beside the page ================= */
const readingPlace = () => ui.lesson && document.body.classList.contains('read-text') ? {book:lessonBook(ui.lesson),kind:'mark',place:lessonPlace(ui.lesson)}
  : ui.ink ? {book:ui.ink.book,kind:'page',place:ui.ink.page} : null;
function openDrawer(tab = ui.drawerTab) {
  ui.drawerTab = tab;
  if (!ui.drawer) {
    ui.drawer = document.createElement('aside');
    ui.drawer.className = 'nt-drawer';
    ui.drawer.setAttribute('aria-label','笔记');
    ui.drawer.setAttribute('role','dialog');
    document.body.append(ui.drawer);
    ui.drawer.addEventListener('keydown',event => { if (event.key === 'Escape') { event.stopPropagation(); closeDrawer(); } });
  }
  if (ui.drawer.hidden !== false || !ui.drawer.classList.contains('is-open')) {
    ui.drawer.hidden = false;
    ui.deps.openLayer?.('nt-drawer',() => closeDrawer(true));
    requestAnimationFrame(() => ui.drawer.classList.add('is-open'));
    document.body.classList.add('nt-drawer-open');
  }
  placeDock();
  renderDrawer();
  $('.nt-drawer-close',ui.drawer)?.focus({preventScroll:true});
}
function closeDrawer(fromHistory = false) {
  if (!ui.drawer || ui.drawer.hidden) return;
  ui.drawer.classList.remove('is-open');
  ui.drawer.hidden = true;
  document.body.classList.remove('nt-drawer-open');
  if (!fromHistory) ui.deps.closeLayer?.('nt-drawer');
  placeDock();
}
function syncLine() {
  const sync = ui.deps.syncState?.() || {};
  const name = sync.nickname || '';
  const status = sync.status === 'syncing' ? '正在同步…' : sync.status === 'offline' ? '暂时连不上服务器，笔记先存在这台设备。' : sync.status === 'error' ? '这次没有同步成功，稍后会再试。' : '';
  return `<p class="nt-sync">${name ? `笔记跟随昵称「${e(name)}」保存，用这个昵称的设备会自动同步；换昵称会切换到那个昵称自己的笔记。` : '笔记跟随你的排行榜昵称保存，用同一昵称的设备会自动同步。'}${status ? ` <span>${e(status)}</span>` : ''}${ui.store.storageBroken ? ' <span>这台设备的浏览器存储不可用，关闭页面前请保持联网。</span>' : ''}</p>`;
}
function renderDrawer() {
  const drawer = ui.drawer;
  if (!drawer || drawer.hidden) return;
  const place = readingPlace();
  const book = place?.book || ui.ink?.book || 'textbook';
  const scroll = $('.nt-drawer-body',drawer)?.scrollTop || 0;
  let body = '';
  if (ui.drawerTab === 'mine') {
    const items = ui.store.all().filter(item => item.book === book && (item.kind === 'mark' || !pageIsEmpty(item.data)));
    items.sort((a,b) => a.kind === 'page' && b.kind === 'page' ? Number(a.place)-Number(b.place) : a.kind !== b.kind ? (a.kind === 'mark' ? -1 : 1)
      : String(a.place).localeCompare(String(b.place),undefined,{numeric:true}) || a.data.s0-b.data.s0 || a.data.w0-b.data.w0);
    body = items.length ? `<div class="nt-list">${items.map(item => myEntry(item)).join('')}</div>`
      : `<div class="nt-empty">${ICONS.pen}<p>这本书还没有笔记</p><small>原页模式下点右上角的笔或直接用 Apple Pencil 书写；听读模式下点词或拖选一段即可划线、写想法。</small></div>`;
    body += syncLine();
  } else {
    const key = place ? `${place.book}:${place.place}` : '';
    if (key && ui.others.key !== key) loadOthers();
    const items = ui.others.key === key ? ui.others.items : [];
    const label = place ? ui.deps.placeLabel(place.book,place.kind,place.place) : '';
    body = `<div class="nt-others-head"><p>${place ? `${e(label)}的公开笔记` : '打开一页或一节课文，看看大家在这里写了什么。'}</p>${place?.kind === 'mark' ? `<label class="nt-share is-compact"><input type="checkbox" data-nt="show-others"${ui.showOthers ? ' checked' : ''}><span class="nt-switch"></span><span>在课文中标出大家的划线</span></label>` : ''}</div>`;
    if (ui.others.status === 'loading' && !items.length) body += '<div class="nt-empty"><span class="loader"></span></div>';
    else if (ui.others.status === 'error') body += '<div class="nt-empty"><p>暂时连不上服务器</p><button type="button" class="nt-button" data-nt="others-retry">重试</button></div>';
    else if (place && !items.length) body += `<div class="nt-empty">${ICONS.globe}<p>这里还没有人公开笔记</p><small>写下自己的笔记后，可以在${place.kind === 'page' ? '手写工具的「更多」里发布本页' : '想法里打开「公开到笔记广场」'}。</small></div>`;
    else body += `<div class="nt-list">${items.map(item => sharedEntry(item,{showPlace:false,overlay:item.kind === 'page'})).join('')}</div>`;
  }
  drawer.innerHTML = `<header class="nt-drawer-head"><div><p class="nt-kicker">NOTATER · ${e(ui.deps.bookLabel(book))}</p><h2>笔记</h2></div><button type="button" class="nt-icon-button nt-drawer-close" data-nt="drawer-close" aria-label="关闭笔记">${ICONS.close}</button></header>
    <div class="nt-tabs" role="tablist">${[['mine','我的'],['others','大家']].map(([tab,label]) => `<button type="button" role="tab" data-nt="drawer-tab" data-tab="${tab}" aria-selected="${ui.drawerTab === tab}">${label}</button>`).join('')}<button type="button" class="nt-tabs-link" data-nt="open-overview">全部笔记${ICONS.arrow}</button></div>
    <div class="nt-drawer-body">${body}</div>`;
  $('.nt-drawer-body',drawer).scrollTop = scroll;
  watchThumbs(drawer);
}
async function loadOthers(force = false) {
  const place = readingPlace();
  if (!place) return;
  const key = `${place.book}:${place.place}`;
  // Others' notes for this place stay a minute; opening the tab again asks the server afresh.
  if (!force && ui.others.key === key && ui.others.status !== 'error' && Date.now()-(ui.others.at || 0) < 60000) return;
  if (ui.others.key === key && ui.others.status === 'loading') return;
  ui.others = {key,status:'loading',items:ui.others.key === key ? ui.others.items : []};
  try {
    const reply = await api(`/notes/place?book=${encodeURIComponent(place.book)}&place=${encodeURIComponent(place.place)}`);
    if (ui.others.key !== key) return;
    ui.others = {key,status:'ready',items:Array.isArray(reply.items) ? reply.items : [],at:Date.now()};
  } catch {
    if (ui.others.key !== key) return;
    ui.others = {key,status:'error',items:[]};
  }
  paintMarks();
  renderDrawer();
}
async function toggleOverlay(id) {
  if (ui.overlay?.id === id) { ui.overlay = null; paintOther(); overlayChip(); renderDrawer(); return; }
  const item = ui.others.items.find(entry => entry.id === id);
  if (!item || !ui.ink) return;
  let data = item.data;
  if (!data) {
    try { data = (await api(`/notes/public/${id}`)).note.data; }
    catch (error) { apiError(error,'这页笔记暂时无法载入。'); return; }
  }
  ui.overlay = {id,nickname:item.nickname,book:item.book,place:item.place,data};
  paintOther();
  overlayChip();
  renderDrawer();
}

/* ================= One shared note, with its comments ================= */
async function openDetail(id) {
  const dialog = openDialog('detail','nt-detail','<div class="nt-detail-card"><div class="nt-empty"><span class="loader"></span></div></div>',{label:'笔记详情',unsaved:() => !!$('#nt-comment',dialog)?.value.trim()});
  let reply;
  try { reply = await api(`/notes/public/${id}`); }
  catch (error) {
    if (!dialog.isConnected) return;
    $('.nt-detail-card',dialog).innerHTML = `<header class="nt-dialog-head"><span></span><button type="button" class="nt-icon-button" data-nt="dialog-close" aria-label="关闭">${ICONS.close}</button></header><div class="nt-empty"><p>${error?.code === 'note_gone' ? '这条笔记已被作者撤回。' : '暂时无法打开，请稍后重试。'}</p></div>`;
    return;
  }
  if (!dialog.isConnected) return;
  renderDetail(dialog,reply);
}
function renderDetail(dialog,{note,comments}) {
  dialog.detail = {note,comments};
  const d = note.data, place = `${ui.deps.bookLabel(note.book)} · ${ui.deps.placeLabel(note.book,note.kind,note.place)}`;
  const mark = note.kind === 'mark' ? normalizeMark(d) : null;
  $('.nt-detail-card',dialog).innerHTML = `<header class="nt-dialog-head"><div><p class="nt-kicker">${e(place)}</p><p class="nt-detail-author"><strong>${e(note.nickname)}</strong><span>${e(when(note.publishedAt))}${note.updated && Date.parse(note.updated)/1000 > (note.publishedAt || 0)+60 ? ' · 已编辑' : ''}</span></p></div><button type="button" class="nt-icon-button" data-nt="dialog-close" aria-label="关闭">${ICONS.close}</button></header>
    <div class="nt-detail-body">
      ${mark ? `<blockquote class="nt-quote nt-c-${mark.color}" lang="nb">${e(mark.quote)}</blockquote>${mark.note ? `<p class="nt-detail-note">${multiline(mark.note)}</p>` : ''}`
        : `${normalizePage(d).caption ? `<p class="nt-detail-note">${e(normalizePage(d).caption)}</p>` : ''}${thumb(`detail:${note.id}:${note.updated}`,note.book,note.place,d)}`}
      <div class="nt-detail-actions">
        <button type="button" class="nt-pill${note.liked ? ' is-on' : ''}" data-nt="like" data-id="${e(note.id)}" aria-pressed="${note.liked}"${note.mine ? ' disabled' : ''}>${ICONS.heart}<span>${note.likes ? `${note.likes} 赞` : '赞'}</span></button>
        <button type="button" class="nt-pill${note.collected ? ' is-on' : ''}" data-nt="collect" data-id="${e(note.id)}"${note.mine || note.collected ? ' disabled' : ''}>${ICONS.collect}<span>${note.collected ? '已收入我的笔记' : '收入我的笔记'}</span></button>
        <button type="button" class="nt-pill" data-nt="goto" data-book="${e(note.book)}" data-kind="${e(note.kind)}" data-place="${e(note.place)}">${ICONS.arrow}<span>去原文</span></button>
      </div>
      <section class="nt-comments" aria-label="评论"><h3>评论 <span>${comments.length || ''}</span></h3>
        ${comments.length ? `<ol>${comments.map(item => `<li><p class="nt-comment-head"><strong>${e(item.nickname)}</strong><span>${e(when(item.at))}</span>${item.removable ? `<button type="button" class="nt-text-button" data-nt="uncomment" data-id="${item.id}">删除</button>` : ''}</p><p>${multiline(item.text)}</p></li>`).join('')}</ol>` : '<p class="nt-muted">还没有评论，说点什么吧。</p>'}
      </section>
    </div>
    <form class="nt-comment-form"><label class="sr-only" for="nt-comment">写评论</label><textarea id="nt-comment" name="text" rows="1" maxlength="500" placeholder="写下你的评论…"></textarea><button type="submit" class="nt-button is-primary">发送</button></form>`;
  watchThumbs(dialog);
  const form = $('.nt-comment-form',dialog);
  form.addEventListener('submit',async event => {
    event.preventDefault();
    const text = form.elements.text.value.trim();
    if (!text) return;
    if (form.dataset.sending) return;
    form.dataset.sending = '1';
    form.elements.text.disabled = true;
    $('button[type="submit"]',form).disabled = true;
    try {
      const reply = await api('/notes/comment',{method:'POST',body:{id:note.id,text}});
      dialog.detail.comments.push(reply.comment);
      dialog.detail.note.comments = reply.comments;
      renderDetail(dialog,dialog.detail);
      updateShared(note.id,{comments:reply.comments});
      $('.nt-comments li:last-child',dialog)?.scrollIntoView({block:'nearest'});
    } catch (error) { apiError(error,'评论没有发出去，请稍后重试。'); form.elements.text.disabled = false; $('button[type="submit"]',form).disabled = false; delete form.dataset.sending; }
  });
  form.elements.text.addEventListener('input',() => { const field = form.elements.text; field.style.height = 'auto'; field.style.height = `${Math.min(120,field.scrollHeight)}px`; });
}
// Likes and comment counts change in every list that shows the note.
function updateShared(id,fields) {
  for (const list of [ui.others.items,ui.overview?.square.items || []]) for (const item of list) if (item.id === id) Object.assign(item,fields);
  renderDrawer();
  if (ui.overview?.tab === 'square') renderOverviewBody();
}
async function like(id,button) {
  const dialog = ui.dialogs.find(item => item.name === 'detail')?.dialog;
  const known = [...ui.others.items,...(ui.overview?.square.items || [])].find(item => item.id === id) || dialog?.detail?.note;
  const liked = !(known?.liked);
  button.disabled = true;
  try {
    const reply = await api('/notes/like',{method:'POST',body:{id,liked}});
    updateShared(id,{liked:reply.liked,likes:reply.likes});
    if (dialog?.detail?.note.id === id) { Object.assign(dialog.detail.note,{liked:reply.liked,likes:reply.likes}); renderDetail(dialog,dialog.detail); }
  } catch (error) { apiError(error,'没有点上赞，请稍后重试。'); }
  finally { if (button.isConnected) button.disabled = false; }
}
async function collect(id,button) {
  if (ui.collecting) return;
  ui.collecting = true;
  if (button) button.disabled = true;
  let reply;
  try { reply = await api('/notes/collect',{method:'POST',body:{id}}); }
  catch (error) { apiError(error,'没有收进来，请稍后重试。'); if (button?.isConnected) button.disabled = false; return; }
  finally { ui.collecting = false; }
  const note = reply.note, from = {id:note.id,name:note.nickname};
  const done = guard(() => {
    if (note.kind === 'mark') {
      const data = normalizeMark(note.data);
      return ui.store.save({id:newId('m'),kind:'mark',book:note.book,place:note.place,data:{...data,shared:false,from,created:new Date().toISOString()}});
    }
    // Another learner's page joins one's own page as new strokes, which one can then edit.
    const theirs = normalizePage(note.data), known = ui.store.page(note.book,note.place);
    const mine = known ? normalizePage(known.data) : normalizePage({created:new Date().toISOString(),aspect:theirs.aspect});
    const now = Date.now();
    const data = {...mine,from:mine.from || from,strokes:[...mine.strokes,...theirs.strokes.map(stroke => ({...stroke,id:newId('s'),u:now}))],texts:[...mine.texts,...theirs.texts.map(box => ({...box,id:newId('t'),u:now}))]};
    return ui.store.save({id:pageNoteId(note.book,note.place),kind:'page',book:note.book,place:note.place,data});
  });
  if (!done) return;
  if (ui.ink && done.id === ui.ink.id) { ui.ink.doc = readDoc(); paintInk(); }
  notify(note.kind === 'page' ? `已收入你的第 ${note.place} 页笔记。` : '已收入我的笔记。');
  const dialog = ui.dialogs.find(item => item.name === 'detail')?.dialog;
  if (dialog?.detail) { dialog.detail.note.collected = true; dialog.detail.note.collects = reply.collects; renderDetail(dialog,dialog.detail); }
}

/* ================= 更多 → 笔记 ================= */
function renderOverview(slot) {
  ui.overview = ui.overview || {tab:'mine',book:'',kind:'',query:'',square:{sort:'new',kind:'',book:'',items:[],page:0,more:false,status:'idle'}};
  ui.overview.slot = slot;
  slot.innerHTML = `<div class="nt-overview">
    <header class="nt-overview-head"><p class="nt-kicker">NOTATER · 笔记</p><h2 tabindex="-1">读书笔记</h2><p>你在原页上的手写、听读里的划线和想法，以及大家公开分享的笔记。</p></header>
    <div class="nt-segment" role="tablist">${[['mine','我的笔记'],['square','笔记广场']].map(([tab,label]) => `<button type="button" role="tab" data-nt="overview-tab" data-tab="${tab}" aria-selected="${ui.overview.tab === tab}">${label}</button>`).join('')}</div>
    <div class="nt-overview-body"></div></div>`;
  renderOverviewBody();
  if (ui.overview.tab === 'square' && !ui.overview.square.items.length) loadSquare();
}
function chips(name,options,current) {
  return `<div class="nt-chips" role="group">${options.map(([value,label]) => `<button type="button" class="nt-chip" data-nt="${name}" data-value="${e(value)}" aria-pressed="${current === value}">${e(label)}</button>`).join('')}</div>`;
}
function renderOverviewBody() {
  const o = ui.overview, body = o?.slot && $('.nt-overview-body',o.slot);
  if (!body?.isConnected) return;
  if (o.tab === 'mine') {
    const all = ui.store.all().filter(item => item.kind === 'mark' || !pageIsEmpty(item.data));
    const books = [...new Set(all.map(item => item.book))];
    const query = o.query.trim().toLocaleLowerCase('nb');
    const items = all.filter(item => (!o.book || item.book === o.book) && (!o.kind || item.kind === o.kind)
      && (!query || [item.data.quote,item.data.note,item.data.caption,...(item.data.texts || []).map(box => box.text)].some(value => String(value || '').toLocaleLowerCase('nb').includes(query))))
      .sort((a,b) => b.updated.localeCompare(a.updated));
    body.innerHTML = `<div class="nt-filters">${books.length > 1 ? chips('ov-book',[['','全部书'],...books.map(book => [book,ui.deps.bookLabel(book)])],o.book) : ''}${chips('ov-kind',[['','全部'],['page','手写'],['mark','划线与想法']],o.kind)}
      <label class="nt-search">${'<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>'}<span class="sr-only">搜索笔记</span><input type="search" data-nt="ov-search" placeholder="搜索笔记里的文字" value="${e(o.query)}"></label></div>
      ${items.length ? `<div class="nt-grid">${items.map(item => `<div class="nt-cell">${myEntry(item,{showBook:books.length > 1})}<div class="nt-cell-actions"><button type="button" class="nt-text-button" data-nt="ov-share" data-id="${e(item.id)}">${item.data.shared ? '撤回公开' : '公开'}</button><button type="button" class="nt-text-button is-danger" data-nt="ov-delete" data-id="${e(item.id)}">删除</button></div></div>`).join('')}</div>`
        : `<div class="nt-empty">${ICONS.pen}<p>${all.length ? '没有符合条件的笔记' : '还没有笔记'}</p><small>${all.length ? '换个筛选条件试试。' : '在阅读页的原页上手写，或在听读里点词、拖选一段划线写想法。'}</small></div>`}
      ${syncLine()}`;
  } else {
    const s = o.square;
    const books = ui.deps.books();
    body.innerHTML = `<div class="nt-filters">${chips('sq-sort',[['new','最新'],['hot','最热']],s.sort)}${chips('sq-kind',[['','全部'],['page','手写'],['mark','划线与想法']],s.kind)}
      <label class="nt-select"><span class="sr-only">按书筛选</span><select data-nt="sq-book"><option value="">全部书</option>${books.map(([id,label]) => `<option value="${e(id)}"${s.book === id ? ' selected' : ''}>${e(label)}</option>`).join('')}</select></label></div>
      ${s.status === 'error' && !s.items.length ? '<div class="nt-empty"><p>笔记广场暂时打不开</p><button type="button" class="nt-button" data-nt="sq-retry">重试</button></div>'
        : !s.items.length && s.status === 'loading' ? '<div class="nt-empty"><span class="loader"></span></div>'
        : !s.items.length ? `<div class="nt-empty">${ICONS.globe}<p>还没有人公开笔记</p><small>在想法里打开「公开到笔记广场」，或在手写工具的「更多」里发布一整页。</small></div>`
        : `<div class="nt-grid is-square">${s.items.map(item => `<div class="nt-cell">${sharedEntry(item)}</div>`).join('')}</div>${s.more ? `<button type="button" class="nt-button nt-more" data-nt="sq-more"${s.status === 'loading' ? ' disabled' : ''}>${s.status === 'loading' ? '正在载入…' : '加载更多'}</button>` : ''}`}`;
  }
  watchThumbs(body);
}
async function loadSquare(append = false) {
  const s = ui.overview.square;
  const run = s.run = (s.run || 0)+1;
  s.status = 'loading';
  if (!append) { s.items = []; s.page = 0; }
  renderOverviewBody();
  try {
    const query = new URLSearchParams({sort:s.sort,page:String(s.page)});
    if (s.kind) query.set('kind',s.kind);
    if (s.book) query.set('book',s.book);
    const reply = await api(`/notes/square?${query}`);
    if (run !== s.run) return;
    s.items = append ? [...s.items,...reply.items] : reply.items;
    s.more = !!reply.more;
    s.status = 'ready';
  } catch {
    if (run !== s.run) return;
    s.status = 'error';
  }
  renderOverviewBody();
}
function overviewShare(id) {
  const item = ui.store.get(id);
  if (!item) return;
  if (item.kind === 'page') {
    const d = item.data;
    if (d.shared) { guard(() => ui.store.save({...item,data:{...d,shared:false,mu:Date.now()}})); notify('已撤回。'); return; }
    openComposer({kicker:'发布这一页到笔记广场',caption:true,note:d.caption,shared:true,placeholder:'给这一页写一句说明（可不填）。',
      onSave:({note,shared}) => { const done = guard(() => ui.store.save({...item,data:{...d,caption:note,shared,mu:Date.now()}})); if (done && shared) notify('已发布到笔记广场。'); return done; }});
    return;
  }
  guard(() => ui.store.save({...item,data:{...item.data,shared:!item.data.shared}}));
  notify(item.data.shared ? '已撤回。' : '已发布到笔记广场。');
}
function confirmDelete(id) {
  const item = ui.store.get(id);
  if (!item) return;
  const dialog = openDialog('confirm','nt-confirm',`<div class="nt-confirm-card"><p class="nt-kicker">删除笔记</p><p>${item.kind === 'page' ? `确定删除第 ${e(item.place)} 页的全部手写吗？` : '确定删除这条划线和想法吗？'}${item.data.shared ? '它也会从笔记广场撤下。' : ''}</p><footer class="nt-dialog-actions"><span></span><button type="button" class="nt-button" data-nt="dialog-close">取消</button><button type="button" class="nt-button is-danger" data-nt="confirm-delete">删除</button></footer></div>`,{label:'删除笔记'});
  $('[data-nt="confirm-delete"]',dialog).addEventListener('click',() => {
    closeDialog('confirm',true);
    if (item.kind === 'page') {
      const d = normalizePage(item.data), now = Date.now();
      for (const entry of [...d.strokes,...d.texts]) d.gone[entry.id] = now;
      guard(() => ui.store.save({...item,data:{...d,strokes:[],texts:[],shared:false,caption:'',mu:now}}));
      if (ui.ink?.id === id) { ui.ink.doc = readDoc(); paintInk(); }
    } else ui.store.remove(id);
    notify('已删除。');
  });
}

/* ================= Clicks ================= */
function onClick(event) {
  const target = event.target.closest('[data-nt]');
  if (!target || target.disabled) return;
  const action = target.dataset.nt, id = target.dataset.id;
  if (['mark','unmark','thought','to-wordbook'].includes(action)) { event.stopPropagation(); cardAction(action,target); return; }
  if (action === 'tool') { finishTextEdit(); clearSelection(); ui.tools.tool = target.dataset.tool; saveTools(); updatePalette(); return; }
  if (action === 'color') { ui.tools[ui.tools.tool] = target.dataset.color; saveTools(); updatePalette(); return; }
  if (action === 'size') { ui.tools[ui.tools.tool === 'hl' ? 'hlSize' : 'penSize'] = Number(target.dataset.size); saveTools(); updatePalette(); return; }
  if (action === 'undo' || action === 'redo') { undo(action === 'redo'); return; }
  if (action === 'palette-menu') { ui.menuOpen = !ui.menuOpen; updatePalette(); return; }
  if (action === 'done') { setAnnotating(false); return; }
  if (action === 'dock-pen') { setAnnotating(!ui.annotating); return; }
  if (action === 'dock-notes') { ui.drawer && !ui.drawer.hidden ? closeDrawer() : openDrawer(); return; }
  if (action === 'fingers') { ui.tools.fingers = !ui.tools.fingers; saveTools(); ui.ink?.stage.classList.toggle('nt-drawing',ui.annotating && ui.tools.fingers); updatePalette(); return; }
  if (action === 'share-page') { sharePage(); return; }
  if (action === 'clear-page') {
    ui.menuOpen = false;
    const ink = ui.ink;
    if (ink) change({strokes:ink.doc.strokes,texts:ink.doc.texts},{strokes:[],texts:[]});
    notify('已清空本页，可以撤销。');
    return;
  }
  if (action === 'sel-color' || action === 'sel-delete') { selectionAction(action,target.dataset.color); return; }
  if (action === 'overlay-off') { ui.overlay = null; paintOther(); overlayChip(); updatePalette(); renderDrawer(); return; }
  if (action === 'dialog-close') { const name = ui.dialogs.find(item => item.dialog.contains(target))?.name; if (name) closeDialog(name); return; }
  if (action === 'drawer-close') { closeDrawer(); return; }
  if (action === 'drawer-tab') { ui.drawerTab = target.dataset.tab; renderDrawer(); if (ui.drawerTab === 'others') loadOthers(true); return; }
  if (action === 'open-overview') { closeDrawer(); ui.deps.openOverview(); return; }
  if (action === 'show-others') { ui.showOthers = target.checked; try { localStorage.setItem(OTHERS_KEY,ui.showOthers ? 'on' : 'off'); } catch {} paintMarks(); return; }
  if (action === 'others-retry') { loadOthers(true); return; }
  if (action === 'overlay') { event.stopPropagation(); toggleOverlay(id); return; }
  if (action === 'like') { event.stopPropagation(); like(id,target); return; }
  if (action === 'collect') { collect(id,target); return; }
  if (action === 'uncomment') { uncomment(Number(id),target); return; }
  if (action === 'goto') { closeDialog('detail',true); jumpTo({book:target.dataset.book,kind:target.dataset.kind,place:target.dataset.place}); return; }
  if (action === 'detail') { event.stopPropagation(); openDetail(id); return; }
  if (action === 'jump') { const item = ui.store.get(id); if (item) { closeDrawer(); jumpTo(item); } return; }
  if (action === 'overview-tab') { ui.overview.tab = target.dataset.tab; $$('[data-nt="overview-tab"]',ui.overview.slot).forEach(tab => tab.setAttribute('aria-selected',String(tab === target))); renderOverviewBody(); if (ui.overview.tab === 'square' && !ui.overview.square.items.length) loadSquare(); return; }
  if (action === 'ov-book') { ui.overview.book = target.dataset.value; renderOverviewBody(); return; }
  if (action === 'ov-kind') { ui.overview.kind = target.dataset.value; renderOverviewBody(); return; }
  if (action === 'ov-share') { overviewShare(id); return; }
  if (action === 'ov-delete') { confirmDelete(id); return; }
  if (action === 'sq-sort' || action === 'sq-kind') { ui.overview.square[action === 'sq-sort' ? 'sort' : 'kind'] = target.dataset.value; loadSquare(); return; }
  if (action === 'sq-more') { ui.overview.square.page++; loadSquare(true); return; }
  if (action === 'sq-retry') loadSquare();
}
async function uncomment(id,button) {
  const dialog = ui.dialogs.find(item => item.name === 'detail')?.dialog;
  button.disabled = true;
  try {
    const reply = await api('/notes/comment/delete',{method:'POST',body:{id}});
    if (dialog?.detail) {
      dialog.detail.comments = dialog.detail.comments.filter(item => item.id !== id);
      dialog.detail.note.comments = reply.comments;
      renderDetail(dialog,dialog.detail);
      updateShared(dialog.detail.note.id,{comments:reply.comments});
    }
  } catch (error) { apiError(error,'没有删掉，请稍后重试。'); button.disabled = false; }
}
function jumpTo(item) {
  if (item.kind === 'mark') ui.pendingMark = item.id || '';
  ui.deps.jump({book:item.book,kind:item.kind,place:String(item.place)});
  if (item.kind === 'mark' && ui.lesson && lessonBook(ui.lesson) === item.book && lessonPlace(ui.lesson) === String(item.place) && ui.pendingMark) { const markId = ui.pendingMark; ui.pendingMark = ''; focusMark(markId); }
}

/* ================= Setup ================= */
function storeChanged(detail) {
  if (detail.type === 'person') {
    ui.histories.clear();
    ui.others = {key:'',status:'idle',items:[]};
    if (ui.ink) { ui.ink.doc = readDoc(); ui.ink.selection = null; paintInk(); }
  }
  if (detail.type === 'storage') notify('这台设备暂时无法保存笔记，请保持联网，笔记会存到服务器。');
  if (detail.type === 'remote' || detail.type === 'person') pageChanged(detail.id || ui.ink?.id);
  paintMarks();
  renderDrawer();
  if (ui.overview?.tab === 'mine') renderOverviewBody();
}
function init(deps) {
  ui.deps = {...ui.deps,...deps};
  ui.store = deps.store;
  if (ui.initialized) return;
  ({SCALE,INK,HIGHLIGHT,PEN_SIZES,HIGHLIGHT_SIZES,drawStroke,drawPage,simplify,bounds,touches,inside,lassoed,transformStroke} = deps.ink);
  ({MARK_COLORS,INK_COLORS,LIMITS,newId,pageNoteId,normalizePage,normalizeMark,pageIsEmpty,mergePages} = deps.model);
  ui.initialized = true;
  readTools();
  ui.store.subscribe(storeChanged);
  document.addEventListener('click',onClick);
  document.addEventListener('input',event => {
    if (event.target.matches?.('[data-nt="ov-search"]')) {
      ui.overview.query = event.target.value;
      clearTimeout(ui.searchTimer);
      ui.searchTimer = setTimeout(() => {
        const field = $('[data-nt="ov-search"]',ui.overview.slot), at = field?.selectionStart;
        renderOverviewBody();
        const next = $('[data-nt="ov-search"]',ui.overview.slot);
        if (next) { next.focus({preventScroll:true}); next.setSelectionRange(at,at); }
      },220);
    }
  });
  document.addEventListener('change',event => { if (event.target.matches?.('[data-nt="sq-book"]')) { ui.overview.square.book = event.target.value; loadSquare(); } });
  document.addEventListener('keydown',event => {
    const entry = event.target.closest?.('.nt-entry[data-nt]');
    if (entry && (event.key === 'Enter' || event.key === ' ') && event.target === entry) { event.preventDefault(); entry.click(); return; }
    if (!ui.annotating || !ui.ink || event.defaultPrevented || ui.dialogs.length || event.target.closest?.('input,textarea,select,[contenteditable],.nt-drawer,.nt-dialog')) return;
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === 'z') { event.preventDefault(); undo(event.shiftKey); }
    else if ((event.metaKey || event.ctrlKey) && key === 'y') { event.preventDefault(); undo(true); }
    else if ((key === 'delete' || key === 'backspace') && ui.ink.selection) { event.preventDefault(); selectionAction('sel-delete'); }
    else if (key === 'escape') { event.preventDefault(); if (ui.ink.selection) clearSelection(); else setAnnotating(false); }
  });
  window.addEventListener('resize',() => { if (ui.annotating) updatePalette(); overlayChip(); placeDock(); });
}
// Read-only handwriting over a page drawn elsewhere (双页对照).
function paintStatic(canvas,book,page) {
  if (!ui.store || !canvas?.isConnected) return;
  const parent = canvas.parentElement;
  let layer = parent.querySelector(`canvas.nt-static[data-for="${canvas.className}"]`);
  const item = ui.store.page(book,page);
  if (!item || pageIsEmpty(item.data)) { layer?.remove(); return; }
  if (!layer) { layer = document.createElement('canvas'); layer.className = 'nt-static'; layer.dataset.for = canvas.className; parent.append(layer); }
  const width = canvas.offsetWidth, height = canvas.offsetHeight, ratio = Math.min(window.devicePixelRatio || 1,2);
  Object.assign(layer.style,{left:`${canvas.offsetLeft}px`,top:`${canvas.offsetTop}px`,width:`${width}px`,height:`${height}px`});
  layer.width = Math.round(width*ratio); layer.height = Math.round(height*ratio);
  const ctx = layer.getContext('2d');
  ctx.setTransform(ratio,0,0,ratio,0,0);
  drawPage(ctx,item.data,width,height);
}
window.NorskNotes = {init,pageShown,pageHidden,lessonShown,cardBar,paintStatic,renderOverview,
  toggleAnnotate:() => setAnnotating(!ui.annotating),stopAnnotating:() => setAnnotating(false),get annotating() { return ui.annotating; },
  openDrawer,closeDrawer,toggleDrawer:() => (ui.drawer && !ui.drawer.hidden ? closeDrawer() : openDrawer()),
  leaveReading:() => { setAnnotating(false); pageHidden(); closeDrawer(); lessonShown(null); ui.overlay = null; overlayChip(); ui.dock?.remove(); },placeDock,
  hideOverview:() => { if (ui.overview) ui.overview.slot = null; },refresh:() => { renderDrawer(); renderOverviewBody(); }};
window.dispatchEvent(new Event('norsknotesready'));
