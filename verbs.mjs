/* 动词本: every verb of God i norsk and the teacher's decks, shown the way the decks teach them
   (å lytte | lytter | lyttet | har lyttet), with a daily drill that brings each form back until it sticks.
   Data: data/verbs.json (scripts/build_verbs.py). Progress stays on this device (localStorage).

   How a verb is learnt: a new verb is introduced once with its four forms, the rule of its group and
   one sentence per form. Its three forms to learn (present, past, perfect; the infinitive is the cue)
   then come back a few cards later and on later days, each step a little harder: choose the form in a
   sentence → type it in a sentence → type it from the cue alone → type the whole row. Only the first
   answer of a day moves a form on; a wrong answer comes back later in the same round until it is right.
   A form is mastered after right answers on four separate days (1, 3, 7 days apart). */

export const STORE_KEY = 'norsk-verbs-v1';
export const SLOTS = ['infinitive','present','past','perfect'];
export const ASKED = ['present','past','perfect'];
export const INTERVALS = [0,1,3,7,21,60];
export const MASTERED = 4;
const LABEL = {infinitive:'动词原型',present:'现在时',past:'过去时',perfect:'完成时'};
const TAG = {infinitive:'原型',present:'现在时',past:'过去时',perfect:'完成时'};
const STATUS = {new:'未开始',learning:'学习中',familiar:'熟悉',mastered:'已掌握'};
const DAILY = [3,5,8,12];
const REVIEW_CAP = 40;
const LETTERS = ['å','ø','æ','é'];

/* ---------- Pure helpers (also used by scripts/check_verbs.mjs) ---------- */

export function dayOf(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function addDays(day,count) {
  const [y,m,d] = day.split('-').map(Number);
  return dayOf(new Date(y,m-1,d+count));
}
export const itemKey = (id,slot) => `${id}:${slot}`;
export function blankStore() {
  return {v:1,items:{},started:{},settings:{daily:5},log:{}};
}

// Only the first answer of a day moves a form between boxes, so drilling one form ten times in an
// evening counts as one day; a wrong first answer drops it back and brings it again tomorrow.
export function gradeItem(item,correct,day) {
  const next = {b:item?.b || 0,n:(item?.n || 0)+1,w:(item?.w || 0)+(correct ? 0 : 1),d:item?.d || day,t:item?.t || ''};
  if (next.t === day) {
    if (!correct) next.d = addDays(day,1);
    return next;
  }
  next.t = day;
  if (correct) { next.b = Math.min(next.b+1,INTERVALS.length-1); next.d = addDays(day,INTERVALS[next.b]); }
  else { next.b = Math.min(next.b,1); next.d = addDays(day,1); }
  return next;
}
export function boxesOf(verb,store) {
  return ASKED.map(slot => store.items[itemKey(verb.id,slot)]?.b || 0);
}
export function verbStatus(verb,store) {
  if (!store.started[verb.id]) return 'new';
  const low = Math.min(...boxesOf(verb,store));
  return low >= MASTERED ? 'mastered' : low >= 2 ? 'familiar' : 'learning';
}
export function dueSlots(verb,store,day) {
  if (!store.started[verb.id]) return [];
  return ASKED.filter(slot => { const item = store.items[itemKey(verb.id,slot)]; return !item || !item.d || item.d <= day; });
}
export function learnedOn(store,day) {
  return Object.values(store.started).filter(value => value === day).length;
}

// Reviews first (most overdue and weakest first), with one new verb after every two reviews, and
// never the same verb twice in a row. A verb whose due forms are all strong is asked as one row.
export function planSession(verbs,store,day,{daily = 5,extra = 0,cap = REVIEW_CAP} = {}) {
  const reviews = [];
  for (const verb of verbs) {
    const due = dueSlots(verb,store,day);
    if (!due.length) continue;
    const items = due.map(slot => ({slot,item:store.items[itemKey(verb.id,slot)] || {}}));
    const weight = Math.min(...items.map(({item}) => (item.b || 0)*1000 - daysBetween(item.d || day,day)));
    if (due.length >= 2 && items.every(({item}) => (item.b || 0) >= 3)) reviews.push({kind:'row',verb:verb.id,slots:due,weight});
    else for (const {slot,item} of items) reviews.push({kind:'item',verb:verb.id,slot,weight:(item.b || 0)*1000 - daysBetween(item.d || day,day)});
  }
  reviews.sort((a,b) => a.weight - b.weight);
  const kept = interleave(reviews.slice(0,cap));
  const room = Math.max(0,daily - learnedOn(store,day)) + extra;
  const fresh = verbs.filter(verb => !store.started[verb.id]).slice(0,room).map(verb => ({kind:'learn',verb:verb.id}));
  const queue = [];
  let r = 0;
  for (const learn of fresh) { queue.push(...kept.slice(r,r+2),learn); r += 2; }
  queue.push(...kept.slice(r));
  return spaceOut(queue.map(({weight,...card}) => card));
}
function daysBetween(from,to) {
  const parse = day => { const [y,m,d] = day.split('-').map(Number); return Date.UTC(y,m-1,d); };
  return Math.round((parse(to)-parse(from))/864e5);
}
// Weakest verbs first, but their forms taken in turns, so one verb's forms are spread over the round.
export function interleave(cards) {
  const groups = new Map();
  for (const card of cards) { if (!groups.has(card.verb)) groups.set(card.verb,[]); groups.get(card.verb).push(card); }
  const out = [];
  while (groups.size) for (const [verb,list] of groups) { out.push(list.shift()); if (!list.length) groups.delete(verb); }
  return out;
}
export function spaceOut(cards) {
  const out = [...cards];
  for (let i = 1; i < out.length; i++) {
    if (out[i].verb !== out[i-1].verb) continue;
    const j = out.findIndex((card,k) => k > i && card.verb !== out[i-1].verb);
    if (j > 0) out.splice(i,0,...out.splice(j,1));
  }
  return out;
}
// Put a card `offset` places ahead, but never right after a card of the same verb.
export function insertAhead(queue,card,offset) {
  let at = Math.min(offset,queue.length);
  while (at < queue.length && (queue[at-1]?.verb === card.verb || queue[at]?.verb === card.verb)) at++;
  queue.splice(at,0,card);
  return queue;
}
export function normalize(text) {
  return String(text ?? '').normalize('NFC').replace(/[’`´]/g,"'").replace(/\s+/g,' ').trim().toLocaleLowerCase('nb');
}
// What the learner types: the verb itself. "har", "å" and a seg/av that the screen already shows may be
// typed or left out.
export function accepts(expected,given,{prefix = '',suffix = ''} = {}) {
  const value = normalize(given);
  const core = normalize(expected);
  const options = new Set([core]);
  for (const p of ['',normalize(prefix)]) for (const s of ['',normalize(suffix)]) options.add(normalize(`${p} ${core} ${s}`));
  return options.has(value);
}
// Split a shown form into what is typed and what is printed around it: har lyttet seg → har / lyttet / seg.
export function formParts(form,slot) {
  const words = form.split(' ');
  let prefix = '', suffix = '';
  if (slot === 'infinitive' && words[0] === 'å') prefix = words.shift();
  if (slot === 'perfect' && words[0] === 'har') prefix = words.shift();
  if (words.length > 1) suffix = words.slice(1).join(' ');
  return {prefix,core:words[0],suffix};
}
// Letters of the right answer the learner missed or got wrong (for a quiet underline).
export function missedLetters(expected,given) {
  const a = [...expected], b = [...normalize(given)];
  const table = Array.from({length:a.length+1},() => new Array(b.length+1).fill(0));
  for (let i = a.length-1; i >= 0; i--) for (let j = b.length-1; j >= 0; j--) {
    table[i][j] = a[i].toLocaleLowerCase('nb') === b[j] ? table[i+1][j+1]+1 : Math.max(table[i+1][j],table[i][j+1]);
  }
  const missed = new Array(a.length).fill(true);
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i].toLocaleLowerCase('nb') === b[j]) { missed[i] = false; i++; j++; }
    else if (table[i+1][j] >= table[i][j+1]) i++;
    else j++;
  }
  return missed;
}

/* ---------- Store ---------- */

function readStore() {
  try {
    const value = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (value && value.v === 1 && value.items && value.started) return {...blankStore(),...value,settings:{...blankStore().settings,...value.settings}};
  } catch {}
  return blankStore();
}
function writeStore(store) {
  try { localStorage.setItem(STORE_KEY,JSON.stringify(store)); return true; } catch { return false; }
}
// The 更多 shelf shows today's numbers without loading the verb list.
export function shelfSummary(day = dayOf()) {
  const store = readStore();
  const ids = Object.keys(store.started);
  let due = 0, mastered = 0;
  for (const id of ids) {
    const items = ASKED.map(slot => store.items[itemKey(id,slot)]);
    if (items.some(item => !item || !item.d || item.d <= day)) due++;
    if (items.every(item => (item?.b || 0) >= MASTERED)) mastered++;
  }
  return {started:ids.length,due,mastered};
}

/* ---------- The page ---------- */

export function createVerbs(deps = {}) {
  const e = value => deps.escapeHTML ? deps.escapeHTML(value) : String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => deps.icon ? deps.icon(name) : '';
  const version = deps.version ? `?v=${encodeURIComponent(deps.version)}` : '';
  const state = {root:null,data:null,loading:null,store:readStore(),view:'book',grouping:'chapters',group:'all',query:'',open:null,session:null,result:null,autoplay:true,sequence:null};
  const byId = new Map();
  let groupsCache = null;

  function load() {
    if (state.data) return Promise.resolve(state.data);
    if (!state.loading) {
      const styles = new Promise(resolve => {
        if (document.querySelector('link[data-verbs-css]')) { resolve(); return; }
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = `verbs.css${version}`; link.dataset.verbsCss = '';
        link.onload = link.onerror = () => resolve();
        document.head.append(link);
      });
      const data = fetch(`data/verbs.json${version}`).then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); });
      state.loading = Promise.all([data,styles]).then(([value]) => {
        state.data = value;
        for (const verb of value.verbs) byId.set(verb.id,verb);
        return value;
      }).catch(error => { state.loading = null; throw error; });
    }
    return state.loading;
  }

  /* ----- groups ----- */
  function groupings() {
    if (groupsCache) return groupsCache;
    const data = state.data, verbs = data.verbs;
    const chapters = [];
    const sectionTitle = new Map(data.sections.map(section => [section.id,section.title]));
    const chapterTitle = new Map((data.chapters || []).map(chapter => [chapter.id,chapter.title]));
    for (const verb of verbs) {
      let chapter = chapters.find(item => item.key === verb.chapter);
      if (!chapter) { chapter = {key:verb.chapter,label:`第 ${verb.chapter} 章`,ids:[],subs:new Map()}; chapters.push(chapter); }
      chapter.ids.push(verb.id);
      const sub = verb.section || '';
      if (!chapter.subs.has(sub)) chapter.subs.set(sub,{label:sub ? `${sub} ${sectionTitle.get(sub) || ''}` : '只在词表或课件里',ids:[]});
      chapter.subs.get(sub).ids.push(verb.id);
    }
    chapters.sort((a,b) => Number(a.key)-Number(b.key));
    for (const chapter of chapters) chapter.title = chapterTitle.get(chapter.key) || '';
    // Each verb sits only under the first deck that teaches it; later decks say how many they repeat.
    const seen = new Set(), decks = [];
    for (const deck of data.decks) {
      const ids = [];
      for (const ref of deck.verbs) if (!seen.has(ref.id) && byId.has(ref.id)) { seen.add(ref.id); ids.push(ref.id); }
      const again = [...new Set(deck.verbs.map(ref => ref.id))].filter(id => byId.has(id) && !ids.includes(id));
      if (ids.length || again.length) decks.push({key:deck.id,label:`课件 ${deck.label}`,title:'',ids,again,subs:new Map([['',{label:'',ids}]])});
    }
    const kinds = data.groups.map(group => ({key:group.id,label:group.label,title:group.rule,page:group.page,ids:verbs.filter(verb => verb.group === group.id).map(verb => verb.id)}))
      .filter(group => group.ids.length).map(group => ({...group,subs:new Map([['',{label:'',ids:group.ids}]])}));
    groupsCache = {chapters,decks,kinds};
    return groupsCache;
  }
  const currentGroups = () => groupings()[state.grouping] || [];
  function scopeIds(groupKey = state.group) {
    const groups = currentGroups();
    if (groupKey === 'all') {
      const ids = groups.flatMap(group => group.ids);
      const rest = state.data.verbs.map(verb => verb.id).filter(id => !ids.includes(id));
      return [...ids,...rest];
    }
    return groups.find(group => group.key === groupKey)?.ids || [];
  }

  /* ----- markup pieces ----- */
  function ring(verb) {
    const status = verbStatus(verb,state.store);
    const value = status === 'new' ? 0 : Math.min(1,Math.min(...boxesOf(verb,state.store))/MASTERED);
    const r = 7, length = 2*Math.PI*r;
    return `<span class="vb-ring is-${status}" title="${STATUS[status]}"><svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="${r}" class="vb-ring-track"/>${value ? `<circle cx="9" cy="9" r="${r}" class="vb-ring-value" stroke-dasharray="${length}" stroke-dashoffset="${length*(1-value)}"/>` : ''}${status === 'mastered' ? '<path d="m6 9.2 2 2 4-4.2" class="vb-ring-check"/>' : ''}</svg><span class="sr-only">${STATUS[status]}</span></span>`;
  }
  function highlight(example,{blank = false} = {}) {
    const text = example.text;
    const marks = [...(example.marks || [])].sort((a,b) => a[0]-b[0]);
    let out = '', at = 0;
    for (const [start,end,role] of marks) {
      out += e(text.slice(at,start));
      const piece = text.slice(start,end);
      if (blank && role === 'verb') out += `<span class="vb-blank" aria-label="空格"><span>${' '.repeat(Math.max(4,piece.length))}</span></span>`;
      else if (blank) out += e(piece);
      else out += `<mark class="${role === 'verb' ? '' : 'is-aux'}">${e(piece)}</mark>`;
      at = end;
    }
    return out + e(text.slice(at));
  }
  function sourceLabel(example) {
    if (example.source === 'ppt') {
      const [deck,slide] = String(example.ref || '').split('#');
      const label = state.data.decks.find(item => item.id === deck)?.label || deck;
      return `课件 ${label} · 第 ${slide} 页`;
    }
    if (example.source === 'textbook') return `课文 ${String(example.ref || '').split('#')[0]}`;
    return '学习例句';
  }
  const speak = (path,text,cls = '') => path ? `<button type="button" class="vb-speak ${cls}" data-verbs="say" data-audio="${e(path)}" data-text="${e(text)}" aria-label="朗读 ${e(text)}">${icon('volume')}</button>` : '';
  function formsRow(verb,{big = false,mark = ''} = {}) {
    return `<div class="vb-forms${big ? ' is-big' : ''}">${SLOTS.map(slot => `<div class="vb-form${mark === slot ? ' is-marked' : ''}"><span class="vb-form-label">${LABEL[slot]}</span><button type="button" class="vb-form-word" lang="nb" data-verbs="say" data-audio="${e(verb.audio?.[slot] || '')}" data-text="${e(verb[slot])}">${e(verb[slot])}</button></div>`).join('')}</div>`;
  }
  function ruleLine(verb) {
    const group = state.data.groups.find(item => item.id === verb.group);
    if (!group) return '';
    return `<p class="vb-rule"><span class="vb-chip${verb.irregular ? ' is-irregular' : ''}">${e(group.label)}</span>${e(group.rule)}</p>`;
  }
  function examplesBlock(verb,{first = false} = {}) {
    return `<ol class="vb-examples">${SLOTS.map(slot => {
      const list = verb.examples[slot] || [];
      const shown = first ? list.slice(0,1) : list;
      return shown.map((example,index) => `<li><span class="vb-ex-tag">${index ? '' : TAG[slot]}</span><div class="vb-ex-body"><p class="vb-ex-nb" lang="nb">${highlight(example)}${speak(example.audio,example.text,'is-small')}</p>${example.zh ? `<p class="vb-ex-zh">${e(example.zh)}</p>` : ''}<p class="vb-ex-src">${e(sourceLabel(example))}${example.note ? ` · ${e(example.note)}` : ''}</p></div></li>`).join('');
    }).join('')}</ol>`;
  }
  function whereLine(verb) {
    const sections = verb.sections || [];
    const decks = (verb.decks || []).map(ref => { const deck = state.data.decks.find(item => item.id === ref.deck); return deck ? `${deck.label} 第 ${ref.slide} 页` : ''; }).filter(Boolean);
    const unique = [...new Set(decks)];
    return `<p class="vb-where">${sections.length ? `<span>课文 ${e(sections.slice(0,8).join(' · '))}${sections.length > 8 ? ` 等 ${sections.length} 节` : ''}</span>` : ''}${unique.length ? `<span>课件 ${e(unique.slice(0,4).join(' · '))}</span>` : ''}</p>`;
  }
  function progressLine(verb) {
    if (!state.store.started[verb.id]) return '';
    return `<div class="vb-steps">${ASKED.map(slot => { const b = state.store.items[itemKey(verb.id,slot)]?.b || 0; return `<span><small>${TAG[slot]}</small><i>${[1,2,3,4].map(n => `<b class="${b >= n ? 'is-on' : ''}"></b>`).join('')}</i></span>`; }).join('')}</div>`;
  }
  function detail(verb) {
    const phrases = verb.phrases?.length ? `<p class="vb-phrases">${verb.phrases.map(p => `<span lang="nb">${e(p.text)}</span> ${e(p.zh)}`).join('　')}</p>` : '';
    return `<div class="vb-detail" id="vb-detail-${e(verb.id)}">
      <div class="vb-detail-head">${formsRow(verb)}<button type="button" class="vb-quiet" data-verbs="sequence" data-id="${e(verb.id)}">${icon('play')}<span>听四种形态</span></button></div>
      ${ruleLine(verb)}${phrases}${examplesBlock(verb)}<div class="vb-detail-foot">${whereLine(verb)}${progressLine(verb)}</div></div>`;
  }
  function row(verb) {
    const open = state.open === verb.id;
    return `<li class="vb-row${open ? ' is-open' : ''}" data-id="${e(verb.id)}"><button type="button" class="vb-row-main" data-verbs="toggle" data-id="${e(verb.id)}" aria-expanded="${open}" aria-controls="vb-detail-${e(verb.id)}">
      ${ring(verb)}<span class="vb-cells" lang="nb"><span class="vb-inf">${e(verb.infinitive)}</span><span>${e(verb.present)}</span><span>${e(verb.past)}</span><span>${e(verb.perfect)}</span></span>
      <span class="vb-zh">${e(verb.zh)}${verb.irregular ? '<em>不规则</em>' : ''}</span><span class="vb-chev">${icon('chevron')}</span></button>${open ? detail(verb) : ''}</li>`;
  }

  /* ----- book view ----- */
  function counts(ids) {
    const total = {new:0,learning:0,familiar:0,mastered:0};
    for (const id of ids) total[verbStatus(byId.get(id),state.store)]++;
    return total;
  }
  function todayNumbers(ids) {
    const day = dayOf();
    const verbs = ids.map(id => byId.get(id));
    const due = verbs.filter(verb => dueSlots(verb,state.store,day).length).length;
    const room = Math.max(0,(state.store.settings.daily || 5) - learnedOn(state.store,day));
    const fresh = Math.min(room,verbs.filter(verb => !state.store.started[verb.id]).length);
    return {due,fresh,room};
  }
  function hero() {
    const ids = state.data.verbs.map(verb => verb.id);
    const total = counts(ids), all = ids.length;
    const today = todayNumbers(scopeIds('all'));
    const started = all - total.new;
    const share = key => `${(total[key]/all*100).toFixed(2)}%`;
    const plan = today.due || today.fresh
      ? `<p class="vb-today-plan">${today.due ? `<span><b>${today.due}</b> 个复习</span>` : ''}${today.fresh ? `<span><b>${today.fresh}</b> 个新动词</span>` : ''}</p>`
      : '<p class="vb-today-plan is-done">今天的都练完了</p>';
    const button = today.due || today.fresh ? `<button type="button" class="vb-primary" data-verbs="start" data-group="all">${started ? '开始今天的练习' : '从第一个动词开始'}</button>` : `<button type="button" class="vb-secondary" data-verbs="start" data-group="all" data-extra="1">再学 ${state.store.settings.daily || 5} 个新动词</button>`;
    return `<header class="vb-hero"><div class="vb-hero-text"><p class="mh-kicker" lang="nb">VERB</p><h2 tabindex="-1">动词本</h2>
      <p class="vb-hero-note">课本 15 章和课件里的 ${all} 个动词，每个都按课件的样子列出四种形态。每天复习到期的，再学几个新的。</p>
      <div class="vb-meter" role="img" aria-label="已掌握 ${total.mastered}，熟悉 ${total.familiar}，学习中 ${total.learning}，未开始 ${total.new}"><i class="is-mastered" style="width:${share('mastered')}"></i><i class="is-familiar" style="width:${share('familiar')}"></i><i class="is-learning" style="width:${share('learning')}"></i></div>
      <p class="vb-meter-legend"><span class="is-mastered">已掌握 ${total.mastered}</span><span class="is-familiar">熟悉 ${total.familiar}</span><span class="is-learning">学习中 ${total.learning}</span><span>未开始 ${total.new}</span></p></div>
      <div class="vb-today"><p class="vb-today-title">今天</p>${plan}${button}
      <label class="vb-daily"><span>每次新学</span><select data-verbs="daily">${DAILY.map(n => `<option value="${n}"${n === (state.store.settings.daily || 5) ? ' selected' : ''}>${n} 个</option>`).join('')}</select></label></div></header>`;
  }
  function toolbar() {
    const tabs = [['chapters','课本章节'],['decks','课件'],['kinds','变化规律']];
    return `<div class="vb-toolbar"><div class="vb-tabs" role="tablist" aria-label="分组方式">${tabs.map(([key,label]) => `<button type="button" role="tab" aria-selected="${state.grouping === key}" class="${state.grouping === key ? 'is-active' : ''}" data-verbs="grouping" data-key="${key}">${label}</button>`).join('')}</div>
      <label class="vb-search">${icon('search')}<input type="search" placeholder="找动词：任何形态或中文" aria-label="搜索动词" value="${e(state.query)}" data-verbs="search" lang="nb"></label></div>`;
  }
  function rail() {
    const groups = currentGroups();
    const all = scopeIds('all');
    const entry = (key,label,title,ids) => { const c = counts(ids); return `<button type="button" class="vb-rail-item${state.group === key ? ' is-active' : ''}" data-verbs="group" data-key="${e(key)}" aria-pressed="${state.group === key}"><span class="vb-rail-label">${e(label)}${title ? `<small lang="nb">${e(title)}</small>` : ''}</span><span class="vb-rail-count">${ids.length ? `${c.mastered}<small>/${ids.length}</small>` : '<small>—</small>'}</span></button>`; };
    return `<nav class="vb-rail" aria-label="动词分组">${entry('all','全部','',all)}${groups.map(group => entry(group.key,group.label,group.title,group.ids)).join('')}</nav>`;
  }
  function listBody() {
    const query = normalize(state.query);
    if (query) {
      const hits = state.data.verbs.filter(verb => SLOTS.some(slot => normalize(verb[slot]).includes(query)) || verb.zh.includes(state.query.trim()) || normalize(verb.en || '').includes(query));
      return hits.length ? `<section class="vb-group"><header class="vb-group-head"><h3>找到 ${hits.length} 个动词</h3></header>${tableHead()}<ul class="vb-rows">${hits.map(row).join('')}</ul></section>` : `<p class="vb-empty">没有找到「${e(state.query.trim())}」。可以输入任何一种形态，比如 lyttet，或者中文意思。</p>`;
    }
    const groups = state.group === 'all' ? currentGroups() : currentGroups().filter(group => group.key === state.group);
    const leftover = state.group === 'all' && state.grouping === 'decks' ? state.data.verbs.filter(verb => !groups.some(group => group.ids.includes(verb.id))) : [];
    return groups.map(group => {
      const today = todayNumbers(group.ids);
      const practise = group.ids.length ? `<button type="button" class="vb-quiet" data-verbs="start" data-group="${e(group.key)}">${today.due || today.fresh ? `练这一组${today.due ? ` · 复习 ${today.due}` : ''}${today.fresh ? ` · 新学 ${today.fresh}` : ''}` : '这一组今天练完了'}</button>` : '';
      const repeated = group.again?.length ? `<span lang="nb">${group.again.map(id => e(byId.get(id).infinitive)).join('、')}</span>` : '';
      const note = group.page ? `<p class="vb-group-note">${e(group.title)}<span>课本第 ${e(group.page)} 页</span></p>`
        : repeated ? `<p class="vb-group-note">${group.ids.length ? '还教了前面课件已经列出的' : '这一课教的动词前面的课件已经列出：'}${repeated}</p>` : '';
      const subs = [...group.subs.values()].filter(sub => sub.ids.length);
      return `<section class="vb-group"><header class="vb-group-head"><h3>${e(group.label)}${group.title && !group.page ? ` <span lang="nb">${e(group.title)}</span>` : ''}</h3>${practise}</header>${note}${group.ids.length ? tableHead() : ''}${subs.map(sub => `${sub.label ? `<p class="vb-sub" lang="nb">${e(sub.label)}</p>` : ''}<ul class="vb-rows">${sub.ids.map(id => row(byId.get(id))).join('')}</ul>`).join('')}</section>`;
    }).join('') + (leftover.length ? `<section class="vb-group"><header class="vb-group-head"><h3>课件里没有的动词</h3></header><p class="vb-group-note">这些动词只在课本里出现，按课本顺序排在最后。</p>${tableHead()}<ul class="vb-rows">${leftover.map(row).join('')}</ul></section>` : '');
  }
  const tableHead = () => `<div class="vb-head" aria-hidden="true"><span></span><span class="vb-cells"><span>动词原型</span><span>现在时</span><span>过去时</span><span>完成时</span></span><span>释义</span><span></span></div>`;
  function renderBook(focus = '') {
    const scroll = window.scrollY;
    focusMode(false);
    state.root.innerHTML = `<div class="vb-book"><div class="mh-tool-bar"><button type="button" class="mh-back" data-more="home"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg><span>更多</span></button></div>${hero()}${toolbar()}<div class="vb-layout">${rail()}<div class="vb-list" id="vb-list">${listBody()}</div></div></div>`;
    if (focus) state.root.querySelector(focus)?.focus({preventScroll:true});
    if (state.view === 'book' && scroll) window.scrollTo(0,scroll);
  }
  function refreshList() {
    const list = state.root?.querySelector('#vb-list');
    if (list) list.innerHTML = listBody();
  }

  /* ----- session ----- */
  function startSession(groupKey,extra = false) {
    stopSequence();
    const ids = scopeIds(groupKey);
    const verbs = ids.map(id => byId.get(id)).filter(Boolean);
    const day = dayOf();
    const cards = planSession(verbs,state.store,day,{daily:state.store.settings.daily || 5,extra:extra ? state.store.settings.daily || 5 : 0});
    if (!cards.length) { deps.notify?.('这一组今天没有要练的动词了。'); return; }
    const label = groupKey === 'all' ? '今天的练习' : currentGroups().find(group => group.key === groupKey)?.label || '练习';
    state.session = {day,label,queue:cards,total:cards.reduce((sum,card) => sum + (card.kind === 'learn' ? 4 : 1),0),done:0,current:null,lastVerb:'',reveal:null,fresh:[],reviewed:new Set(),right:0,firstTries:0,missed:new Map()};
    state.view = 'session';
    window.scrollTo(0,0);
    nextCard();
  }
  function nextCard() {
    const session = state.session;
    session.reveal = null;
    const index = session.queue.findIndex(card => card.verb !== session.lastVerb);
    const at = index < 0 ? 0 : index;
    const card = session.queue.splice(at,1)[0];
    if (!card) { finishSession(); return; }
    if (card.kind === 'item') {
      const box = state.store.items[itemKey(card.verb,card.slot)]?.b || 0;
      card.type = card.type || (box === 0 && !state.store.items[itemKey(card.verb,card.slot)]?.t ? 'choose' : box <= 1 ? 'cloze' : 'recall');
      if ((card.type === 'choose' || card.type === 'cloze') && !(byId.get(card.verb).examples[card.slot] || []).some(example => example.marks?.some(mark => mark[2] === 'verb'))) card.type = 'recall';
      if (card.type === 'choose') card.options = shuffle(chooseOptions(byId.get(card.verb)));
      // Every answer counts, also on other days, so the next time this form comes up it brings another sentence.
      card.example = pickExample(byId.get(card.verb),card.slot,state.store.items[itemKey(card.verb,card.slot)]?.n || 0);
    }
    session.current = card;
    session.lastVerb = card.verb;
    renderSession();
    prefetchAround();
  }
  // The learn card shows the first sentence of each form; questions use the others first, so the
  // learner meets a new sentence where there is one.
  function pickExample(verb,slot,asked) {
    const list = (verb.examples[slot] || []).filter(example => example.marks?.some(mark => mark[2] === 'verb'));
    if (!list.length) return null;
    return list[(asked+1) % list.length];
  }
  function chooseOptions(verb) {
    const words = [formParts(verb.infinitive,'infinitive').core,formParts(verb.present,'present').core,formParts(verb.past,'past').core,formParts(verb.perfect,'perfect').core];
    return [...new Set(words)];
  }
  function shuffle(list) {
    const out = [...list];
    for (let i = out.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [out[i],out[j]] = [out[j],out[i]]; }
    return out;
  }
  function expectedFor(card) {
    const verb = byId.get(card.verb);
    return formParts(verb[card.slot],card.slot);
  }
  function answer(given) {
    const session = state.session, card = session.current;
    if (!card || session.reveal) return;
    const verb = byId.get(card.verb);
    if (card.kind === 'row') {
      const results = card.slots.map((slot,index) => ({slot,given:given[index] || '',ok:accepts(formParts(verb[slot],slot).core,given[index] || '',formParts(verb[slot],slot))}));
      for (const result of results) record(verb,result.slot,result.ok,result.given,card);
      session.reveal = {results,ok:results.every(result => result.ok)};
      const wrong = results.filter(result => !result.ok).map(result => result.slot);
      if (wrong.length) for (const slot of wrong) insertAhead(session.queue,{kind:'item',verb:verb.id,slot,type:'recall',retry:true},3);
    } else {
      const parts = expectedFor(card);
      const ok = given !== null && accepts(parts.core,given,parts);
      record(verb,card.slot,ok,given || '',card);
      session.reveal = {ok,given:given || ''};
      if (!ok) insertAhead(session.queue,{kind:'item',verb:verb.id,slot:card.slot,type:card.type === 'choose' ? 'cloze' : card.type,retry:true},3);
    }
    if (!card.retry) session.done++;
    writeStore(state.store);
    renderSession();
    if (state.autoplay) {
      const slot = card.kind === 'row' ? null : card.slot;
      if (slot && verb.audio?.[slot]) say(verb.audio[slot],verb[slot]);
    }
  }
  function record(verb,slot,ok,given,card) {
    const session = state.session, key = itemKey(verb.id,slot);
    state.store.items[key] = gradeItem(state.store.items[key],ok,session.day);
    if (!card.retry) { session.firstTries++; if (ok) session.right++; }
    if (!ok) session.missed.set(key,{verb:verb.id,slot,given});
    session.reviewed.add(verb.id);
    const log = state.store.log[session.day] || (state.store.log[session.day] = {a:0,c:0});
    log.a++; if (ok) log.c++;
    // Keep only the last 60 days of the daily log.
    const days = Object.keys(state.store.log).sort();
    while (days.length > 60) delete state.store.log[days.shift()];
  }
  function learnDone() {
    const session = state.session, card = session.current;
    if (!card || card.kind !== 'learn') return;
    state.store.started[card.verb] = session.day;
    writeStore(state.store);
    session.fresh.push(card.verb);
    session.done++;
    ASKED.forEach((slot,index) => insertAhead(session.queue,{kind:'item',verb:card.verb,slot},[1,3,6][index]));
    nextCard();
  }
  function finishSession() {
    const session = state.session;
    state.result = {label:session.label,fresh:session.fresh,reviewed:[...session.reviewed].filter(id => !session.fresh.includes(id)),right:session.right,firstTries:session.firstTries,missed:[...session.missed.values()]};
    state.session = null;
    state.view = 'result';
    renderResult();
  }
  function sessionBar() {
    const session = state.session;
    const value = Math.min(100,Math.round(session.done/Math.max(1,session.total)*100));
    return `<div class="vb-session-bar"><button type="button" class="mh-back" data-verbs="leave">${icon('left')}<span>结束</span></button><div class="vb-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${session.total}" aria-valuenow="${session.done}" aria-label="${e(session.label)}进度"><i style="width:${value}%"></i></div><span class="vb-progress-count">${session.done} / ${session.total}</span><button type="button" class="vb-icon-toggle${state.autoplay ? ' is-on' : ''}" data-verbs="autoplay" aria-pressed="${state.autoplay}" aria-label="答完自动朗读" title="答完自动朗读">${icon('volume')}</button></div>`;
  }
  function cue(verb) {
    return `<p class="vb-cue"><span lang="nb">${e(verb.infinitive)}</span><span class="vb-cue-zh">${e(verb.zh)}</span></p>`;
  }
  function letterKeys() {
    return `<div class="vb-letters" aria-label="挪威语字母">${LETTERS.map(letter => `<button type="button" data-verbs="letter" data-letter="${letter}" tabindex="-1">${letter}</button>`).join('')}</div>`;
  }
  function input(id,label,parts,value = '',result = '') {
    return `<label class="vb-input${result ? ` is-${result}` : ''}"><span class="sr-only">${e(label)}</span>${parts.prefix ? `<span class="vb-fixed" lang="nb">${e(parts.prefix)}</span>` : ''}<input id="${id}" type="text" lang="nb" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" value="${e(value)}"${result ? ' disabled' : ''}>${parts.suffix ? `<span class="vb-fixed" lang="nb">${e(parts.suffix)}</span>` : ''}</label>`;
  }
  function answerShown(expected,given) {
    if (!given) return `<span class="vb-answer" lang="nb">${e(expected)}</span>`;
    const missed = missedLetters(expected,given);
    return `<span class="vb-answer" lang="nb">${[...expected].map((char,index) => missed[index] ? `<u>${e(char)}</u>` : e(char)).join('')}</span>`;
  }
  function learnCard(verb) {
    const where = verb.section ? `第 ${verb.chapter} 章 · ${verb.section}` : verb.chapter ? `第 ${verb.chapter} 章` : '';
    return `<article class="vb-card is-learn" aria-labelledby="vb-learn-title"><p class="vb-card-kicker">新动词${where ? ` · ${e(where)}` : ''}</p>
      <h3 id="vb-learn-title" class="vb-learn-zh">${e(verb.zh)}</h3>${formsRow(verb,{big:true})}${ruleLine(verb)}${examplesBlock(verb,{first:true})}
      <div class="vb-card-actions"><button type="button" class="vb-quiet" data-verbs="sequence" data-id="${e(verb.id)}">${icon('play')}<span>听四种形态</span></button><button type="button" class="vb-primary" data-verbs="learned">记住了，开始练</button></div></article>`;
  }
  function questionCard(card) {
    const verb = byId.get(card.verb), session = state.session, reveal = session.reveal;
    const kicker = card.kind === 'row' ? '写出整行' : card.type === 'choose' ? `${LABEL[card.slot]} · 选一选` : `写出${LABEL[card.slot]}`;
    let body = '';
    if (card.kind === 'row') {
      body = `${cue(verb)}<form class="vb-row-form" data-verbs="row-form">${card.slots.map((slot,index) => {
        const result = reveal?.results?.[index];
        return `<div class="vb-row-field"><span class="vb-form-label">${LABEL[slot]}</span>${input(`vb-row-${index}`,LABEL[slot],formParts(verb[slot],slot),result?.given || '',result ? (result.ok ? 'right' : 'wrong') : '')}${result && !result.ok ? `<p class="vb-correction">${answerShown(formParts(verb[slot],slot).core,result.given)}</p>` : ''}</div>`;
      }).join('')}${reveal ? '' : `<div class="vb-answer-actions">${letterKeys()}<button type="button" class="vb-quiet" data-verbs="unknown">不会</button><button type="submit" class="vb-primary">检查</button></div>`}</form>`;
    } else {
      const parts = formParts(verb[card.slot],card.slot);
      // The sentence can be heard only once it is answered; before that its audio would give the form away.
      const sentence = card.example && card.type !== 'recall' ? `<p class="vb-sentence" lang="nb">${reveal ? `${highlight(card.example)}${speak(card.example.audio,card.example.text)}` : highlight(card.example,{blank:true})}</p>${card.example.zh ? `<p class="vb-sentence-zh">${e(card.example.zh)}</p>` : ''}` : '';
      if (card.type === 'choose') {
        body = `${cue(verb)}${sentence}<div class="vb-choices" role="group" aria-label="选择正确的形态">${card.options.map(option => {
          const chosen = reveal && normalize(reveal.given) === normalize(option), right = reveal && normalize(option) === normalize(parts.core);
          return `<button type="button" class="vb-choice${right ? ' is-right' : chosen ? ' is-wrong' : ''}" data-verbs="choose" data-value="${e(option)}" lang="nb"${reveal ? ' disabled' : ''}>${e(option)}</button>`;
        }).join('')}</div>`;
      } else {
        const label = `写出${LABEL[card.slot]}`;
        const field = input('vb-answer',label,card.type === 'recall' ? parts : {prefix:'',suffix:''},reveal ? reveal.given : '',reveal ? (reveal.ok ? 'right' : 'wrong') : '');
        body = `${cue(verb)}${card.type === 'recall' ? `<p class="vb-ask">${LABEL[card.slot]}是？</p>` : sentence}<form class="vb-answer-form" data-verbs="answer-form">${field}${reveal ? '' : `<div class="vb-answer-actions">${letterKeys()}<button type="button" class="vb-quiet" data-verbs="unknown">不会</button><button type="submit" class="vb-primary">检查</button></div>`}</form>${reveal && card.type === 'recall' && card.example ? `<p class="vb-sentence is-after" lang="nb">${highlight(card.example)}${speak(card.example.audio,card.example.text)}</p>${card.example.zh ? `<p class="vb-sentence-zh">${e(card.example.zh)}</p>` : ''}` : ''}`;
      }
    }
    let feedback = '';
    if (reveal) {
      const slot = card.kind === 'row' ? '' : card.slot;
      const message = reveal.ok ? (card.retry ? '这次对了' : '对了') : card.kind === 'row' ? '还差一点，错的形态等一下再练' : `正确是 ${answerShown(formParts(verb[slot],slot).core,reveal.given)}，等一下再练一次`;
      // A row card already shows the whole row in its fields; a single form is shown inside its row.
      feedback = `<div class="vb-feedback ${reveal.ok ? 'is-right' : 'is-wrong'}" role="status"><p>${reveal.ok ? icon('check') : ''}<span>${message}</span></p>${card.kind === 'row' ? '' : formsRow(verb,{mark:slot})}<button type="button" class="vb-primary" data-verbs="next">继续</button></div>`;
    }
    return `<article class="vb-card${reveal ? ' is-revealed' : ''}" tabindex="-1"><p class="vb-card-kicker">${card.retry ? '再试一次 · ' : ''}${e(kicker)}</p>${body}${feedback}</article>`;
  }
  function renderSession() {
    const session = state.session, card = session.current;
    const verb = byId.get(card.verb);
    focusMode(true);
    state.root.innerHTML = `<div class="vb-session">${sessionBar()}${card.kind === 'learn' ? learnCard(verb) : questionCard(card)}</div>`;
    // Choices are not focused up front: a ring on one option would read like a hint.
    const focus = session.reveal ? '[data-verbs="next"]' : card.kind === 'learn' ? '[data-verbs="learned"]' : card.type === 'choose' ? '.vb-card' : 'input:not([disabled])';
    const target = state.root.querySelector(focus);
    target?.focus({preventScroll:true});
    if (card.kind === 'learn' && state.autoplay && verb.audio?.infinitive) say(verb.audio.infinitive,verb.infinitive);
  }
  function prefetchAround() {
    const session = state.session;
    const upcoming = [session.current,...session.queue.slice(0,3)].filter(Boolean).map(card => byId.get(card.verb));
    const items = [];
    for (const verb of upcoming) for (const slot of SLOTS) if (verb.audio?.[slot]) items.push({word:verb[slot],audio:verb.audio[slot]});
    const example = session.current?.example;
    if (example?.audio) items.push({word:example.text,audio:example.audio});
    deps.prefetch?.(items);
  }
  function renderResult() {
    const result = state.result;
    const rate = result.firstTries ? Math.round(result.right/result.firstTries*100) : 0;
    const tomorrow = state.data.verbs.filter(verb => dueSlots(verb,state.store,addDays(dayOf(),1)).length).length;
    const missed = result.missed.slice(0,8).map(item => { const verb = byId.get(item.verb); return `<li><span class="vb-missed-label">${LABEL[item.slot]}</span><span lang="nb">${e(verb.infinitive)} → <b>${e(verb[item.slot])}</b></span>${item.given ? `<span class="vb-missed-given" lang="nb">写成 ${e(item.given)}</span>` : ''}</li>`; }).join('');
    focusMode(false);
    state.root.innerHTML = `<div class="vb-session"><article class="vb-card is-result"><p class="vb-card-kicker">${e(result.label)} · 完成</p><h3>${result.fresh.length ? `新学了 ${result.fresh.length} 个动词` : '今天的复习完成了'}</h3>
      <dl class="vb-result-stats"><div><dt>新学</dt><dd>${result.fresh.length}</dd></div><div><dt>复习</dt><dd>${result.reviewed.length}</dd></div><div><dt>一次答对</dt><dd>${rate}<small>%</small></dd></div></dl>
      ${missed ? `<div class="vb-missed"><p>这些形态答错过，已经安排在明天再练${result.missed.length > 8 ? `（共 ${result.missed.length} 个，这里列出前 8 个）` : ''}：</p><ul>${missed}</ul></div>` : `<p class="vb-result-note">都一次答对了。</p>`}
      <p class="vb-result-note">明天到期 ${tomorrow} 个动词。</p>
      <div class="vb-card-actions"><button type="button" class="vb-quiet" data-verbs="start" data-group="all" data-extra="1">再学 ${state.store.settings.daily || 5} 个新动词</button><button type="button" class="vb-primary" data-verbs="book">回到动词本</button></div></article></div>`;
    state.root.querySelector('[data-verbs="book"]')?.focus({preventScroll:true});
  }

  /* ----- audio ----- */
  function say(path,text) {
    stopSequence();
    if (path) deps.pronounce?.({word:text,audio:path});
  }
  function stopSequence() {
    if (!state.sequence) return;
    state.sequence.cancelled = true;
    state.sequence.audio.pause();
    state.sequence = null;
  }
  // The four forms one after another, the rhythm the decks read them in.
  async function playSequence(verb) {
    stopSequence();
    deps.stopAudio?.();
    const audio = new Audio(), run = {audio,cancelled:false};
    state.sequence = run;
    for (const slot of SLOTS) {
      const path = verb.audio?.[slot];
      if (!path || run.cancelled) continue;
      audio.src = path;
      try {
        await audio.play();
        await new Promise(resolve => { audio.onended = resolve; audio.onerror = resolve; audio.onpause = resolve; });
      } catch { break; }
      if (run.cancelled) return;
      await new Promise(resolve => setTimeout(resolve,260));
    }
    if (state.sequence === run) state.sequence = null;
  }

  /* ----- events ----- */
  function onClick(event) {
    const target = event.target.closest('[data-verbs]');
    if (!target || !state.root?.contains(target)) return;
    const action = target.dataset.verbs;
    if (action === 'say') { say(target.dataset.audio,target.dataset.text); return; }
    if (action === 'sequence') { playSequence(byId.get(target.dataset.id)); return; }
    if (action === 'toggle') {
      const id = target.dataset.id;
      state.open = state.open === id ? null : id;
      const item = target.closest('.vb-row');
      item.outerHTML = row(byId.get(id));
      if (state.open) {
        for (const other of state.root.querySelectorAll('.vb-row.is-open')) if (other.dataset.id !== id) other.outerHTML = row(byId.get(other.dataset.id));
        const verb = byId.get(id);
        deps.prefetch?.(SLOTS.filter(slot => verb.audio?.[slot]).map(slot => ({word:verb[slot],audio:verb.audio[slot]})));
      }
      state.root.querySelector(`.vb-row[data-id="${CSS.escape(id)}"] .vb-row-main`)?.focus({preventScroll:true});
      return;
    }
    if (action === 'grouping') { state.grouping = target.dataset.key; state.group = 'all'; state.open = null; renderBook(`[data-verbs="grouping"][data-key="${target.dataset.key}"]`); return; }
    if (action === 'group') { state.group = target.dataset.key; state.open = null; renderBook(`[data-verbs="group"][data-key="${CSS.escape(target.dataset.key)}"]`); state.root.querySelector('#vb-list')?.scrollIntoView?.({block:'nearest'}); return; }
    if (action === 'start') { startSession(target.dataset.group || 'all',target.dataset.extra === '1'); return; }
    if (action === 'learned') { learnDone(); return; }
    if (action === 'choose') { answer(target.dataset.value); return; }
    if (action === 'unknown') { if (state.session?.current?.kind === 'row') answer(state.session.current.slots.map(() => '')); else answer(null); return; }
    if (action === 'next') { nextCard(); return; }
    if (action === 'letter') {
      const field = state.root.querySelector('.vb-input input:focus') || state.lastInput || state.root.querySelector('.vb-input input:not([disabled])');
      if (field && !field.disabled) {
        const start = field.selectionStart ?? field.value.length, end = field.selectionEnd ?? field.value.length;
        field.value = field.value.slice(0,start) + target.dataset.letter + field.value.slice(end);
        field.focus({preventScroll:true});
        field.setSelectionRange(start+1,start+1);
      }
      return;
    }
    if (action === 'autoplay') { state.autoplay = !state.autoplay; target.classList.toggle('is-on',state.autoplay); target.setAttribute('aria-pressed',String(state.autoplay)); return; }
    if (action === 'leave') { stopSequence(); state.session = null; state.view = 'book'; renderBook('.vb-hero h2'); window.scrollTo(0,0); return; }
    if (action === 'book') { state.result = null; state.view = 'book'; renderBook('.vb-hero h2'); window.scrollTo(0,0); }
  }
  function onSubmit(event) {
    const form = event.target.closest('[data-verbs]');
    if (!form || !state.root?.contains(form)) return;
    event.preventDefault();
    if (form.dataset.verbs === 'answer-form') {
      const value = form.querySelector('input')?.value || '';
      if (!value.trim()) { form.querySelector('input')?.focus(); return; }
      answer(value);
    }
    if (form.dataset.verbs === 'row-form') answer([...form.querySelectorAll('input')].map(field => field.value));
  }
  function onInput(event) {
    const field = event.target;
    if (!state.root?.contains(field)) return;
    if (field.dataset.verbs === 'search') { state.query = field.value; state.open = null; refreshList(); return; }
  }
  function onChange(event) {
    const field = event.target;
    if (!state.root?.contains(field)) return;
    if (field.dataset.verbs === 'daily') { state.store.settings.daily = Number(field.value) || 5; writeStore(state.store); renderBook('[data-verbs="daily"]'); }
  }
  function onFocusIn(event) {
    if (event.target.matches?.('.vb-input input')) state.lastInput = event.target;
  }
  function onKey(event) {
    if (!state.root || state.view !== 'session' || !state.session) return;
    if (event.key === 'Enter' && event.target.matches?.('.vb-row-form input:not([disabled])')) {
      const fields = [...state.root.querySelectorAll('.vb-row-form input:not([disabled])')];
      const next = fields[fields.indexOf(event.target)+1];
      if (next) { event.preventDefault(); next.focus(); return; }
    }
    // A focused button (继续) handles Enter itself.
    if (event.key === 'Enter' && state.session.reveal && !event.target.matches?.('input,button')) { event.preventDefault(); nextCard(); }
    if (event.key === 'Enter' && state.session.reveal && event.target.matches?.('input[disabled]')) { event.preventDefault(); nextCard(); }
    if (state.session.current?.type === 'choose' && !state.session.reveal && /^[1-4]$/.test(event.key)) {
      const option = state.session.current.options[Number(event.key)-1];
      if (option) answer(option);
    }
  }

  /* ----- mount ----- */
  function mount(root) {
    state.root = root;
    state.store = readStore();
    root.addEventListener('click',onClick);
    root.addEventListener('submit',onSubmit);
    root.addEventListener('input',onInput);
    root.addEventListener('change',onChange);
    root.addEventListener('focusin',onFocusIn);
    document.addEventListener('keydown',onKey);
    root.innerHTML = '<div class="mh-tool-bar"><button type="button" class="mh-back" data-more="home"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg><span>更多</span></button></div><div class="mh-offline"><p>正在打开动词本…</p></div>';
    return load().then(() => {
      if (state.root !== root) return;
      // A round left half way goes on where it stopped; a finished round's summary is not shown twice.
      if (state.view === 'session' && state.session) renderSession();
      else { state.view = 'book'; state.result = null; renderBook(); }
    });
  }
  // While a session is under way the site's top bar steps aside (styles.css .practice-focus); its own ✕ leads out.
  function focusMode(on) { document.body?.classList.toggle('practice-focus',on); }
  function unmount() {
    stopSequence();
    if (!state.root) return;
    focusMode(false);
    state.root.removeEventListener('click',onClick);
    state.root.removeEventListener('submit',onSubmit);
    state.root.removeEventListener('input',onInput);
    state.root.removeEventListener('change',onChange);
    state.root.removeEventListener('focusin',onFocusIn);
    document.removeEventListener('keydown',onKey);
    state.root = null;
  }
  return {mount,unmount,stopAudio:stopSequence};
}

