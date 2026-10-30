// Handwriting on a page: drawing, hit-testing and reshaping strokes. A stroke's points are stored as
// [x, y, pressure] triples with x and y in 1/10000 of the page's width and height and pressure 0–100;
// its width is in 1/1000 of the page width, so it looks the same at every zoom. No DOM beyond a
// canvas context is touched, so scripts/check_notes.mjs can run the geometry directly.
export const SCALE = 10000;
export const INK = {ink:'#26342d',green:'#2c6650',rust:'#b0512f',gold:'#a97d24',blue:'#2f5c8a',plum:'#77466f'};
export const HIGHLIGHT = {ink:'#f4d65e',green:'#a9d9ab',rust:'#f5ad94',gold:'#f7c873',blue:'#a6cdee',plum:'#d9b0dc'};
export const PEN_SIZES = [2.2,3.6,5.8];
export const HIGHLIGHT_SIZES = [12,18,26];

export const pixels = (stroke,width,height) => {
  const out = [];
  for (let i = 0; i+2 < stroke.p.length; i += 3) out.push({x:stroke.p[i]/SCALE*width,y:stroke.p[i+1]/SCALE*height,p:stroke.p[i+2]/100});
  return out;
};

// A pen stroke is drawn as a filled outline whose width follows the pressure, tapering at both ends.
export function outline(points,size) {
  if (!points.length) return [];
  const widths = points.map((point,index) => {
    const pressure = .38+.9*Math.min(1,Math.max(0,point.p || .5));
    const fromStart = Math.min(1,.55+index*.15), fromEnd = Math.min(1,.6+(points.length-1-index)*.13);
    return size*pressure*Math.min(fromStart,fromEnd)/2;
  });
  const left = [], right = [];
  for (let i = 0; i < points.length; i++) {
    const before = points[Math.max(0,i-1)], after = points[Math.min(points.length-1,i+1)];
    let dx = after.x-before.x, dy = after.y-before.y;
    const length = Math.hypot(dx,dy) || 1;
    dx /= length; dy /= length;
    left.push({x:points[i].x-dy*widths[i],y:points[i].y+dx*widths[i]});
    right.push({x:points[i].x+dy*widths[i],y:points[i].y-dx*widths[i]});
  }
  return {left,right,widths};
}
function smoothPath(ctx,list,first = true) {
  if (first) ctx.moveTo(list[0].x,list[0].y); else ctx.lineTo(list[0].x,list[0].y);
  for (let i = 1; i < list.length-1; i++) ctx.quadraticCurveTo(list[i].x,list[i].y,(list[i].x+list[i+1].x)/2,(list[i].y+list[i+1].y)/2);
  if (list.length > 1) ctx.lineTo(list[list.length-1].x,list[list.length-1].y);
}
export function drawPen(ctx,stroke,width,height,color = INK[stroke.c] || INK.ink) {
  const points = pixels(stroke,width,height);
  if (!points.length) return;
  const size = stroke.w/1000*width;
  ctx.fillStyle = color;
  const extent = points.reduce((sum,point,index) => index ? sum+Math.hypot(point.x-points[index-1].x,point.y-points[index-1].y) : 0,0);
  if (points.length < 3 || extent < size*.6) {
    ctx.beginPath(); ctx.arc(points[0].x,points[0].y,Math.max(.6,size*(.38+.9*(points[0].p || .5))/2),0,Math.PI*2); ctx.fill();
    return;
  }
  const {left,right,widths} = outline(points,size);
  const end = points[points.length-1], start = points[0];
  ctx.beginPath();
  smoothPath(ctx,left);
  ctx.arc(end.x,end.y,widths[widths.length-1],Math.atan2(left[left.length-1].y-end.y,left[left.length-1].x-end.x),Math.atan2(right[right.length-1].y-end.y,right[right.length-1].x-end.x),true);
  smoothPath(ctx,right.slice().reverse(),false);
  ctx.arc(start.x,start.y,widths[0],Math.atan2(right[0].y-start.y,right[0].x-start.x),Math.atan2(left[0].y-start.y,left[0].x-start.x),true);
  ctx.closePath();
  ctx.fill();
}
// The highlighter keeps one width and lies under the text (its canvas multiplies with the page).
export function drawHighlight(ctx,stroke,width,height,color = HIGHLIGHT[stroke.c] || HIGHLIGHT.ink) {
  const points = pixels(stroke,width,height);
  if (!points.length) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = stroke.w/1000*width;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  if (points.length === 1) { ctx.moveTo(points[0].x,points[0].y); ctx.lineTo(points[0].x+.1,points[0].y); }
  else smoothPath(ctx,points);
  ctx.stroke();
}
export function drawStroke(ctx,stroke,width,height,options = {}) {
  if (stroke.t === 'hl') drawHighlight(ctx,stroke,width,height,options.color);
  else drawPen(ctx,stroke,width,height,options.color);
}
// Text boxes drawn into a picture (thumbnails, another learner's page); on the live page they are elements.
export function drawText(ctx,box,width,height) {
  const size = box.s/1000*width, x = box.x/SCALE*width, maxWidth = box.w/SCALE*width;
  ctx.fillStyle = INK[box.c] || INK.ink;
  ctx.font = `${size}px "PingFang SC","Microsoft YaHei",Georgia,serif`;
  ctx.textBaseline = 'top';
  let y = box.y/SCALE*height;
  for (const paragraph of box.text.split('\n')) {
    let row = '';
    for (const char of paragraph) {
      if (row && ctx.measureText(row+char).width > maxWidth) { ctx.fillText(row,x,y); y += size*1.45; row = char.trimStart(); }
      else row += char;
    }
    ctx.fillText(row,x,y); y += size*1.45;
  }
}
// Everything on a page, for a picture: highlights first so pen strokes stay crisp above them.
export function drawPage(ctx,page,width,height,{alpha = 1} = {}) {
  ctx.save();
  ctx.globalAlpha = alpha*.5;
  ctx.globalCompositeOperation = 'multiply';
  for (const stroke of page.strokes) if (stroke.t === 'hl') drawHighlight(ctx,stroke,width,height);
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'source-over';
  for (const stroke of page.strokes) if (stroke.t !== 'hl') drawPen(ctx,stroke,width,height);
  for (const box of page.texts) drawText(ctx,box,width,height);
  ctx.restore();
}

/* ---------- Geometry ---------- */
// Fewer points for a stroke that looks the same: Ramer–Douglas–Peucker on x and y, keeping too
// the points where the pressure changes noticeably.
export function simplify(flat,tolerance = 6) {
  const count = flat.length/3;
  if (count <= 3) return flat.slice();
  const keep = new Uint8Array(count);
  keep[0] = keep[count-1] = 1;
  const stack = [[0,count-1]];
  while (stack.length) {
    const [a,b] = stack.pop();
    const ax = flat[a*3], ay = flat[a*3+1], bx = flat[b*3], by = flat[b*3+1];
    const dx = bx-ax, dy = by-ay, length = Math.hypot(dx,dy) || 1;
    let worst = -1, distance = 0;
    for (let i = a+1; i < b; i++) {
      const d = Math.abs(dy*flat[i*3]-dx*flat[i*3+1]+bx*ay-by*ax)/length;
      if (d > distance) { distance = d; worst = i; }
    }
    if (worst > 0 && distance >= tolerance) { keep[worst] = 1; stack.push([a,worst],[worst,b]); }
  }
  let pressure = flat[2];
  for (let i = 1; i < count; i++) {
    if (Math.abs(flat[i*3+2]-pressure) > 15) keep[i] = 1;
    if (keep[i]) pressure = flat[i*3+2];
  }
  const out = [];
  for (let i = 0; i < count; i++) if (keep[i]) out.push(flat[i*3],flat[i*3+1],flat[i*3+2]);
  return out;
}
export function bounds(stroke) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i+2 < stroke.p.length; i += 3) {
    minX = Math.min(minX,stroke.p[i]); maxX = Math.max(maxX,stroke.p[i]);
    minY = Math.min(minY,stroke.p[i+1]); maxY = Math.max(maxY,stroke.p[i+1]);
  }
  return {minX,minY,maxX,maxY};
}
const segmentDistance = (px,py,ax,ay,bx,by) => {
  const dx = bx-ax, dy = by-ay, length = dx*dx+dy*dy;
  const t = length ? Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/length)) : 0;
  return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
};
// Does the eraser at (x, y) in page pixels, with this radius, touch the stroke?
export function touches(stroke,x,y,radius,width,height) {
  const reach = radius+stroke.w/1000*width/2;
  const points = pixels(stroke,width,height);
  if (points.length === 1) return Math.hypot(points[0].x-x,points[0].y-y) <= reach;
  for (let i = 1; i < points.length; i++) if (segmentDistance(x,y,points[i-1].x,points[i-1].y,points[i].x,points[i].y) <= reach) return true;
  return false;
}
export function inside(polygon,x,y) {
  let hit = false;
  for (let i = 0, j = polygon.length-1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x) hit = !hit;
  }
  return hit;
}
// A lasso (in page units) takes a stroke when most of its points lie inside.
export function lassoed(polygon,stroke) {
  let total = 0, hits = 0;
  for (let i = 0; i+2 < stroke.p.length; i += 3) { total++; if (inside(polygon,stroke.p[i],stroke.p[i+1])) hits++; }
  return total > 0 && hits/total >= .5;
}
// Moves and scales a stroke about (ox, oy), all in page units; widths scale with the shape.
export function transformStroke(stroke,{dx = 0,dy = 0,scale = 1,ox = 0,oy = 0}) {
  const p = stroke.p.slice();
  for (let i = 0; i+2 < p.length; i += 3) {
    p[i] = Math.round(ox+(p[i]-ox)*scale+dx);
    p[i+1] = Math.round(oy+(p[i+1]-oy)*scale+dy);
  }
  return {...stroke,p,w:Math.max(.5,Math.min(60,+(stroke.w*scale).toFixed(2)))};
}
