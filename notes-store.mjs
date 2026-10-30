// Reading notes: highlights in 听读 and handwriting on the original pages. Like the wordbook they belong
// to the leaderboard nickname, but each nickname keeps a separate copy in this browser and a rename
// switches to that nickname's notes instead of carrying the current ones over. Each note syncs on
// its own (a page of handwriting can be large); a page merges stroke by stroke when two devices
// edited it. No DOM here, so scripts/check_notes.mjs runs it directly.
export const PERSON_KEY = 'norsk-notes-person-v1';
export const MARK_COLORS = ['amber','sage','rose','sky'];
export const INK_COLORS = ['ink','green','rust','gold','blue','plum'];
export const LIMITS = {note:1200,quote:600,caption:160,text:600,strokes:4000,points:1800,texts:200,gone:6000,batchItems:40,batchBytes:900*1024,page:470*1024};
const PEN = new Set(['pen','hl']);
const TOMBSTONE_DAYS = 180;
const SCALE = 10000;

const text = (value,limit) => String(value ?? '').normalize('NFC').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'').slice(0,limit);
const line = (value,limit) => text(value,limit).replace(/\s+/g,' ').trim();
// A note keeps its paragraphs: at most two line breaks in a row, no trailing space.
const prose = (value,limit) => text(value,limit).replace(/\r\n?/g,'\n').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
const int = (value,min,max) => Number.isFinite(Number(value)) ? Math.max(min,Math.min(max,Math.round(Number(value)))) : min;
const num = (value,min,max,fallback) => Number.isFinite(Number(value)) ? Math.max(min,Math.min(max,Number(value))) : fallback;
const stamp = value => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : new Date(0).toISOString();
const ms = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : 0;
export const safeId = value => /^[a-z0-9-]{4,40}$/.test(String(value || '')) ? String(value) : '';
export const safeBook = value => /^[a-z0-9-]{1,40}$/.test(String(value || '')) ? String(value) : '';
export const safePlace = value => /^[\w.-]{1,40}$/.test(String(value || '')) ? String(value) : '';
export function newId(prefix) {
  const random = globalThis.crypto?.getRandomValues ? [...globalThis.crypto.getRandomValues(new Uint8Array(6))].map(byte => byte.toString(16).padStart(2,'0')).join('') : Math.random().toString(16).slice(2,14);
  return `${prefix}-${Date.now().toString(36)}${random}`.slice(0,40);
}
// One handwriting note per page and nickname, so two devices writing on the same page meet in one note.
export function pageNoteId(book,page) {
  let hash = 2166136261;
  for (const char of `${book}:${page}`) { hash ^= char.codePointAt(0); hash = Math.imul(hash,16777619) >>> 0; }
  return `pg-${hash.toString(36)}-${String(page).replace(/[^a-z0-9]/gi,'').slice(0,8).toLowerCase()}`;
}
const source = raw => raw && typeof raw === 'object' && /^[0-9a-f]{20}$/.test(String(raw.id || '')) ? {id:String(raw.id),name:line(raw.name,20)} : null;

/* ---------- Shapes ---------- */
export function normalizeMark(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const s0 = int(value.s0,0,5000), s1 = int(value.s1,0,5000), w0 = int(value.w0,0,5000), w1 = int(value.w1,0,5000);
  const [from,to] = s0 < s1 || (s0 === s1 && w0 <= w1) ? [[s0,w0],[s1,w1]] : [[s1,w1],[s0,w0]];
  const mark = {s0:from[0],w0:from[1],s1:to[0],w1:to[1],quote:line(value.quote,LIMITS.quote),anchor:line(value.anchor,LIMITS.quote),
    color:MARK_COLORS.includes(value.color) ? value.color : MARK_COLORS[0],note:prose(value.note,LIMITS.note),shared:value.shared === true,created:stamp(value.created)};
  const from_ = source(value.from);
  if (from_) mark.from = from_;
  return mark;
}
function normalizeStroke(raw) {
  if (!raw || typeof raw !== 'object' || !safeId(raw.id) || !Array.isArray(raw.p)) return null;
  const points = [];
  for (let i = 0; i+2 < raw.p.length && points.length < LIMITS.points*3; i += 3) points.push(int(raw.p[i],-500,SCALE+500),int(raw.p[i+1],-500,SCALE+500),int(raw.p[i+2],0,100));
  if (!points.length) return null;
  return {id:raw.id,t:PEN.has(raw.t) ? raw.t : 'pen',c:INK_COLORS.includes(raw.c) ? raw.c : INK_COLORS[0],w:num(raw.w,.5,60,2.4),p:points,u:ms(raw.u)};
}
function normalizeText(raw) {
  if (!raw || typeof raw !== 'object' || !safeId(raw.id)) return null;
  const value = prose(raw.text,LIMITS.text);
  if (!value) return null;
  return {id:raw.id,x:int(raw.x,0,SCALE),y:int(raw.y,0,SCALE),w:int(raw.w,600,SCALE),s:num(raw.s,8,80,18),c:INK_COLORS.includes(raw.c) ? raw.c : INK_COLORS[0],text:value,u:ms(raw.u)};
}
const cutoff = () => Date.now()-TOMBSTONE_DAYS*864e5;
export function normalizePage(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const gone = {}, oldest = cutoff();
  Object.entries(value.gone && typeof value.gone === 'object' && !Array.isArray(value.gone) ? value.gone : {})
    .filter(([id,time]) => safeId(id) && ms(time) > oldest).sort((a,b) => b[1]-a[1]).slice(0,LIMITS.gone)
    .forEach(([id,time]) => { gone[id] = ms(time); });
  const alive = item => item && !(gone[item.id] && gone[item.id] >= item.u);
  const seen = new Set(), unique = item => item && !seen.has(item.id) && seen.add(item.id);
  const strokes = (Array.isArray(value.strokes) ? value.strokes : []).map(normalizeStroke).filter(alive).filter(unique).slice(0,LIMITS.strokes);
  const texts = (Array.isArray(value.texts) ? value.texts : []).map(normalizeText).filter(alive).filter(unique).slice(0,LIMITS.texts);
  const page = {strokes,texts,gone,shared:value.shared === true,caption:line(value.caption,LIMITS.caption),mu:ms(value.mu),aspect:num(value.aspect,.3,3,1.414),created:stamp(value.created)};
  const from_ = source(value.from);
  if (from_) page.from = from_;
  return page;
}
export const normalizeData = (kind,data) => kind === 'page' ? normalizePage(data) : normalizeMark(data);
export const pageIsEmpty = data => !data.strokes.length && !data.texts.length;

// Two copies of one page become one: every stroke and text box survives unless either copy erased it
// after its last change; the caption and sharing follow the copy whose settings changed last.
export function mergePages(first,second) {
  const a = normalizePage(first), b = normalizePage(second);
  const gone = {...a.gone};
  for (const [id,time] of Object.entries(b.gone)) if (!gone[id] || time > gone[id]) gone[id] = time;
  const pick = (left,right) => {
    const items = new Map();
    for (const item of [...left,...right]) { const known = items.get(item.id); if (!known || item.u > known.u) items.set(item.id,item); }
    return [...items.values()];
  };
  const meta = b.mu > a.mu ? b : a;
  return normalizePage({...meta,strokes:pick(a.strokes,b.strokes).sort((x,y) => x.u-y.u),texts:pick(a.texts,b.texts),gone,created:a.created < b.created ? a.created : b.created});
}
// Local and server copies of one note: pages merge; for highlights (and deletions) the later edit wins.
export function mergeNotes(local,remote) {
  const later = remote.updated > local.updated ? remote : local, updated = later.updated;
  if (remote.deleted || local.deleted) return later.deleted ? {...local,deleted:true,data:null,updated} : {...local,deleted:false,data:later.data,updated};
  if (local.kind === 'page' && remote.kind === 'page') return {...local,data:mergePages(local.data,remote.data),updated};
  return {...local,data:later.data,updated};
}
function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object' || !safeId(raw.id) || !['mark','page'].includes(raw.kind) || !safeBook(raw.book) || !safePlace(raw.place)) return null;
  const deleted = raw.deleted === true || !raw.data;
  return {id:raw.id,kind:raw.kind,book:raw.book,place:raw.place,updated:stamp(raw.updated),deleted,data:deleted ? null : normalizeData(raw.kind,raw.data),
    base:int(raw.base ?? raw.seq,0,Number.MAX_SAFE_INTEGER),dirty:raw.dirty === true};
}
const size = item => item.deleted ? 64 : JSON.stringify(item.data).length*1.2+200;

/* ---------- Where this browser keeps them ---------- */
// IndexedDB holds every nickname's notes; a page of handwriting would not fit in localStorage.
export function indexedDBBackend(factory = globalThis.indexedDB) {
  let opening;
  const open = () => opening ||= new Promise((resolve,reject) => {
    if (!factory) { reject(new Error('indexedDB unavailable')); return; }
    const request = factory.open('norsk-notes',1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('items',{keyPath:'key'}).createIndex('person','person');
      db.createObjectStore('meta',{keyPath:'person'});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = null; reject(request.error); };
  });
  const run = (stores,mode,work) => open().then(db => new Promise((resolve,reject) => {
    const tx = db.transaction(stores,mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error);
    result = work(tx);
  }));
  const ask = request => new Promise((resolve,reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  return {
    async load(person) {
      let items = [], meta = null;
      await run(['items','meta'],'readonly',tx => {
        ask(tx.objectStore('items').index('person').getAll(person)).then(rows => { items = rows; });
        ask(tx.objectStore('meta').get(person)).then(row => { meta = row; });
      });
      return {items,cursor:meta?.cursor || 0};
    },
    put(person,items) { return run(['items'],'readwrite',tx => { for (const item of items) tx.objectStore('items').put({...item,key:`${person}\n${item.id}`,person}); }); },
    drop(person,ids) { return run(['items'],'readwrite',tx => { for (const id of ids) tx.objectStore('items').delete(`${person}\n${id}`); }); },
    async get(person,id) { let row; await run(['items'],'readonly',tx => { ask(tx.objectStore('items').get(`${person}\n${id}`)).then(value => { row = value; }); }); return row || null; },
    setCursor(person,cursor) { return run(['meta'],'readwrite',tx => { tx.objectStore('meta').put({person,cursor}); }); }
  };
}
export function memoryBackend() {
  const people = new Map();
  const bucket = person => { if (!people.has(person)) people.set(person,{items:new Map(),cursor:0}); return people.get(person); };
  return {
    people,
    async load(person) { const b = bucket(person); return {items:[...b.items.values()].map(item => structuredClone(item)),cursor:b.cursor}; },
    async put(person,items) { const b = bucket(person); items.forEach(item => b.items.set(item.id,structuredClone(item))); },
    async drop(person,ids) { const b = bucket(person); ids.forEach(id => b.items.delete(id)); },
    async get(person,id) { const item = bucket(person).items.get(id); return item ? structuredClone(item) : null; },
    async setCursor(person,cursor) { bucket(person).cursor = cursor; }
  };
}

/* ---------- The working copy ---------- */
// `channel` (a BroadcastChannel) tells this browser's other tabs which notes were saved, so a tab
// never writes a page over strokes another tab added.
export function createNotesStore({backend = memoryBackend(),storage = globalThis.localStorage,now = () => new Date().toISOString(),channel = null} = {}) {
  const listeners = new Set();
  let person = '', items = new Map(), cursor = 0, version = 0, broken = false;
  try { person = /^[0-9a-f]{20}$/.test(storage?.getItem(PERSON_KEY) || '') ? storage.getItem(PERSON_KEY) : ''; } catch {}
  const emit = detail => listeners.forEach(listener => { try { listener(detail); } catch {} });
  const persist = list => backend.put(person,list.map(item => ({...item}))).then(() => {
    try { channel?.postMessage({person,ids:list.map(item => item.id)}); } catch {}
  },() => {
    if (!broken) { broken = true; emit({type:'storage'}); }
  });
  if (channel) channel.onmessage = async ({data}) => {
    if (!data || data.person !== person || !Array.isArray(data.ids)) return;
    for (const id of data.ids) {
      const saved = normalizeItem(await backend.get(person,id).catch(() => null));
      if (!saved || data.person !== person) continue;
      const local = items.get(id);
      // A page edited here too keeps both tabs' strokes; otherwise the other tab's save is the latest.
      const both = local && !local.deleted && !saved.deleted && local.kind === 'page' && saved.kind === 'page' && local.dirty;
      items.set(id,both ? {...saved,data:mergePages(local.data,saved.data),dirty:true,base:Math.max(saved.base,local.base),
        updated:saved.updated > local.updated ? saved.updated : local.updated} : saved);
      version++;
      emit({type:'remote',id});
    }
  };
  async function load(next) {
    const saved = await backend.load(next).catch(() => ({items:[],cursor:0}));
    person = next;
    items = new Map(saved.items.map(normalizeItem).filter(Boolean).map(item => [item.id,item]));
    cursor = saved.cursor || 0;
    version++;
  }
  const ready = load(person);
  function commit(item) {
    item.dirty = true;
    item.updated = now();
    item.rev = (item.rev || 0)+1;
    items.set(item.id,item);
    version++;
    persist([item]);
    emit({type:'change',id:item.id});
    return item;
  }
  return {
    ready,
    get person() { return person; },
    get cursor() { return cursor; },
    get version() { return version; },
    get storageBroken() { return broken; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    close() { try { channel?.close(); } catch {} },
    get: id => { const item = items.get(id); return item && !item.deleted ? item : null; },
    raw: id => items.get(id) || null,
    all: () => [...items.values()].filter(item => !item.deleted),
    dirty: () => [...items.values()].filter(item => item.dirty),
    marksIn: (book,place) => [...items.values()].filter(item => !item.deleted && item.kind === 'mark' && item.book === book && item.place === String(place)),
    page: (book,page) => { const item = items.get(pageNoteId(book,page)); return item && !item.deleted ? item : null; },
    // Saves a highlight (new or changed) or a page; data is normalized here.
    save({id,kind,book,place,data}) {
      const known = items.get(id);
      const value = normalizeData(kind,data);
      // Measured in UTF-8 bytes as the server measures it; a page over the limit would stop every sync.
      const raw = data && typeof data === 'object' ? data : {};
      if (kind === 'page' && ((raw.strokes?.length || 0) > LIMITS.strokes || (raw.texts?.length || 0) > LIMITS.texts || new TextEncoder().encode(JSON.stringify(value)).length > LIMITS.page)) {
        const error = new Error('这一页的笔迹太多了，请擦掉一些再写。'); error.code = 'note_too_large'; throw error;
      }
      return commit({id,kind,book:String(book),place:String(place),base:known?.base || 0,deleted:false,data:value,dirty:true,updated:'',rev:known?.rev || 0});
    },
    remove(id) {
      const known = items.get(id);
      if (!known || known.deleted) return null;
      return commit({...known,deleted:true,data:null});
    },
    // The server's view of a note, merged with unsent local changes.
    accept(remote) {
      const incoming = normalizeItem({...remote,base:remote.seq});
      if (!incoming) return;
      const local = items.get(incoming.id);
      let next;
      if (local?.dirty) next = {...mergeNotes(local,incoming),base:incoming.base,dirty:true,rev:(local.rev || 0)};
      else next = {...incoming,dirty:false};
      if (next.deleted && !local) return;
      items.set(next.id,next);
      version++;
      persist([next]);
      emit({type:'remote',id:next.id});
    },
    // A save reached the server: the note is clean unless it changed while the request was out.
    saved(id,seq,rev) {
      const item = items.get(id);
      if (!item) return;
      item.base = seq;
      if ((item.rev || 0) === rev) item.dirty = false;
      persist([item]);
    },
    // The server no longer has a note this browser saved there (its data was reset): send it as new.
    rebase(id,seq) { const item = items.get(id); if (item) { item.base = seq; item.dirty = !item.deleted; persist([item]); } },
    setCursor(value) { cursor = Math.max(cursor,value); backend.setCursor(person,cursor).catch(() => {}); },
    // The device's nickname is now `next`. Notes written before this device ever synced join it;
    // otherwise the previous nickname's notes stay behind for when it returns.
    async switchPerson(next) {
      if (next === person) return false;
      const orphans = person === '' ? [...items.values()] : [];
      await load(next);
      if (orphans.length) {
        for (const item of orphans) { const known = items.get(item.id); items.set(item.id,known ? {...mergeNotes(known,item),base:known.base,dirty:true} : {...item,base:0,dirty:true}); }
        await backend.put(next,[...items.values()]).catch(() => {});
        await backend.drop('',orphans.map(item => item.id)).catch(() => {});
      }
      try { storage?.setItem(PERSON_KEY,next); } catch {}
      emit({type:'person',person:next});
      return true;
    }
  };
}

/* ---------- Sync with the leaderboard server ---------- */
export function createNotesSync({store,request,onStatus = () => {},onPerson = () => {},delay = 2500,setTimer = setTimeout,clearTimer = clearTimeout}) {
  let timer = null, running = null, again = false, status = 'idle', nickname = '';
  const report = (next,detail = {}) => { status = next; try { onStatus(next,detail); } catch {} };
  async function pull() {
    for (let round = 0; round < 50; round++) {
      const reply = await request(`/notes?since=${store.cursor}`,{method:'GET'});
      const person = String(reply?.person || '');
      if (!/^[0-9a-f]{20}$/.test(person)) { const error = new Error('service_unavailable'); error.code = 'service_unavailable'; throw error; }
      nickname = String(reply.nickname || '');
      if (person !== store.person) {
        const had = store.person;
        await store.switchPerson(person);
        if (had) onPerson({person,nickname});
        continue;
      }
      for (const item of Array.isArray(reply.items) ? reply.items : []) store.accept(item);
      store.setCursor(Number(reply.cursor) || 0);
      if (!reply.more) return;
    }
  }
  function batches() {
    const groups = [];
    let group = [], bytes = 0;
    for (const item of store.dirty()) {
      const weight = size(item);
      if (group.length && (group.length >= LIMITS.batchItems || bytes+weight > LIMITS.batchBytes)) { groups.push(group); group = []; bytes = 0; }
      group.push(item); bytes += weight;
    }
    if (group.length) groups.push(group);
    return groups;
  }
  async function push() {
    for (let round = 0; round < 6; round++) {
      const groups = batches();
      if (!groups.length) return;
      let conflicted = false;
      for (const group of groups) {
        const sent = group.map(item => ({item,rev:item.rev || 0}));
        const reply = await request('/notes',{method:'POST',body:{person:store.person,items:sent.map(({item}) => ({id:item.id,kind:item.kind,book:item.book,place:item.place,
          updated:item.updated,deleted:item.deleted,base:item.base,...(item.deleted ? {} : {data:item.data})}))}});
        const revs = new Map(sent.map(({item,rev}) => [item.id,rev]));
        for (const done of reply?.saved || []) store.saved(done.id,Number(done.seq) || 0,revs.get(done.id));
        for (const remote of reply?.conflicts || []) {
          conflicted = true;
          if (remote.kind) store.accept(remote); else store.rebase(remote.id,Number(remote.seq) || 0);
        }
      }
      if (!conflicted) return;
    }
  }
  async function attempt() {
    await store.ready;
    for (let round = 0; round < 3; round++) {
      await pull();
      try { await push(); return {person:store.person,nickname}; }
      catch (error) { if (error?.code !== 'person_changed') throw error; }
    }
    return {person:store.person,nickname};
  }
  function run() {
    if (running) { again = true; return running; }
    clearTimer(timer); timer = null;
    report('syncing');
    running = attempt().then(result => { report(store.dirty().length ? 'pending' : 'synced',result); return result; },error => {
      report(['service_unavailable','timeout','rate_limited','unauthorized'].includes(error?.code) || !error?.code ? 'offline' : 'error',{code:error?.code || '',message:error?.message || ''});
      return null;
    }).finally(() => {
      running = null;
      if (again) { again = false; schedule(); }
    });
    return running;
  }
  function schedule(wait = delay) { clearTimer(timer); timer = setTimer(() => { timer = null; run(); },wait); }
  return {run,schedule,get status() { return status; },get nickname() { return nickname; }};
}
