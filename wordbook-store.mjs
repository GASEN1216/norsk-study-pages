// The learner's own wordbook. Like the leaderboard score it belongs to a nickname: the browser keeps a
// working copy in localStorage and syncs it with the leaderboard server, where every device using the
// same nickname shares one wordbook. Edits merge per chapter and entry (the later edit wins, deletions
// travel as tombstones). No DOM here, so scripts/check_wordbook.mjs runs it directly.
export const STORAGE_KEY = 'norsk-wordbook-v1';
export const SYNC_KEY = 'norsk-wordbook-sync-v1';
export const FORMAT = 'norsk-wordbook';
export const LIMITS = {title:40,chapters:200,entries:3000,word:120,meaning:200,example:300,note:300,deleted:4000};
export const POS_OPTIONS = ['名词','动词','形容词','副词','介词','代词','连词','数词','感叹词','专有名词','短语','句子'];
export const GENDERS = {m:'阳性',f:'阴性','m/f':'阳性 / 阴性',n:'中性'};
const TOMBSTONE_DAYS = 180;
const SOURCES = new Set(['textbook','basics','nb-uttale','mixed','rule','']);
const CJK = /[　-〿㐀-鿿豈-﫿＀-￯]/;

const text = (value,limit) => String(value ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,limit);
const stamp = value => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : new Date(0).toISOString();
const safeId = value => /^[a-z0-9-]{4,40}$/.test(String(value || '')) ? String(value) : '';
export const wordKey = value => text(value,LIMITS.word).toLocaleLowerCase('nb');
export function newId(prefix) {
  const random = globalThis.crypto?.getRandomValues ? [...globalThis.crypto.getRandomValues(new Uint8Array(6))].map(byte => byte.toString(16).padStart(2,'0')).join('') : Math.random().toString(16).slice(2,14);
  return `${prefix}-${Date.now().toString(36)}${random}`.slice(0,40);
}
// The Norwegian field takes letters, digits and ordinary punctuation; Chinese belongs in the meaning.
export function wordProblem(value) {
  const word = text(value,LIMITS.word+1);
  if (!word) return '请填写挪威语。';
  if (word.length > LIMITS.word) return `挪威语最多 ${LIMITS.word} 个字符。`;
  if (CJK.test(word)) return '挪威语一栏里有中文，请把中文写在释义里。';
  if (!/\p{L}/u.test(word)) return '挪威语至少要有一个字母。';
  if (/[<>{}\\[\]|^~@#$%*_=+]/.test(word)) return '挪威语里有无法朗读的符号。';
  return '';
}
// Only a site recording or a clip from the leaderboard server counts as audio.
export const validAudio = value => /^pronunciation\/[0-9a-f]{20}\.mp3$/.test(String(value || '')) || /^(https:\/\/[^/\s]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)\/[\w/.-]*\/tts\/[0-9a-f]{64}\.mp3$/.test(String(value || ''));

function normalizeEntry(raw,chapters) {
  if (!raw || typeof raw !== 'object') return null;
  const word = text(raw.word,LIMITS.word), meaning = text(raw.meaning,LIMITS.meaning);
  if (wordProblem(word) || !meaning || !chapters.has(raw.chapterId)) return null;
  const entry = {id:safeId(raw.id) || newId('e'),chapterId:raw.chapterId,word,meaning,
    pos:POS_OPTIONS.includes(raw.pos) ? raw.pos : text(raw.pos,20),
    gender:Object.hasOwn(GENDERS,raw.gender) ? raw.gender : '',
    article:['en','ei','et','en/ei','ei/en'].includes(raw.article) ? raw.article : '',
    example:text(raw.example,LIMITS.example),note:text(raw.note,LIMITS.note),
    ipa:text(raw.ipa,160),ipaSource:SOURCES.has(raw.ipaSource) ? raw.ipaSource : '',
    syllables:text(raw.syllables,200),syllablesSource:SOURCES.has(raw.syllablesSource) ? raw.syllablesSource : '',
    missing:Array.isArray(raw.missing) ? raw.missing.map(item => text(item,60)).filter(Boolean).slice(0,20) : [],
    createdAt:stamp(raw.createdAt),updatedAt:stamp(raw.updatedAt || raw.createdAt)};
  if (validAudio(raw.audio)) entry.audio = String(raw.audio);
  return entry;
}
export function normalizeWordbook(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const chapters = [], ids = new Set();
  for (const [index,item] of (Array.isArray(source.chapters) ? source.chapters : []).entries()) {
    const title = text(item?.title,LIMITS.title), id = safeId(item?.id) || newId('c');
    if (!title || ids.has(id) || chapters.length >= LIMITS.chapters) continue;
    ids.add(id);
    chapters.push({id,title,order:Number.isFinite(item.order) ? item.order : index,createdAt:stamp(item.createdAt),updatedAt:stamp(item.updatedAt || item.createdAt)});
  }
  chapters.sort((a,b) => a.order-b.order || a.createdAt.localeCompare(b.createdAt));
  chapters.forEach((chapter,index) => { chapter.order = index; });
  const entries = [], entryIds = new Set();
  for (const item of Array.isArray(source.entries) ? source.entries : []) {
    const entry = normalizeEntry(item,ids);
    if (!entry || entryIds.has(entry.id) || entries.length >= LIMITS.entries) continue;
    entryIds.add(entry.id);
    entries.push(entry);
  }
  const deleted = {}, cutoff = Date.now()-TOMBSTONE_DAYS*864e5;
  Object.entries(source.deleted && typeof source.deleted === 'object' && !Array.isArray(source.deleted) ? source.deleted : {})
    .filter(([id,time]) => safeId(id) && typeof time === 'string' && Date.parse(time) > cutoff)
    .sort((a,b) => b[1].localeCompare(a[1])).slice(0,LIMITS.deleted)
    .forEach(([id,time]) => { deleted[id] = time; });
  return {version:1,title:text(source.title,LIMITS.title) || '我的词本',titleUpdatedAt:stamp(source.titleUpdatedAt),chapters,entries,deleted,updatedAt:stamp(source.updatedAt)};
}

// Two copies of one wordbook become one: per chapter and entry the later edit wins, a deletion wins
// over anything older, and entries whose chapter is gone go with it.
export function mergeWordbooks(first,second) {
  const a = normalizeWordbook(first), b = normalizeWordbook(second);
  const deleted = {...a.deleted};
  for (const [id,time] of Object.entries(b.deleted)) if (!deleted[id] || time > deleted[id]) deleted[id] = time;
  const pick = (left,right) => {
    const items = new Map();
    for (const item of [...left,...right]) {
      const known = items.get(item.id);
      if (!known || item.updatedAt > known.updatedAt) items.set(item.id,item);
    }
    return [...items.values()].filter(item => !(deleted[item.id] && deleted[item.id] >= item.updatedAt));
  };
  const chapters = pick(a.chapters,b.chapters).sort((x,y) => x.order-y.order || x.createdAt.localeCompare(y.createdAt));
  const live = new Set(chapters.map(item => item.id));
  const entries = pick(a.entries,b.entries).filter(item => live.has(item.chapterId)).sort((x,y) => x.createdAt.localeCompare(y.createdAt));
  const titled = b.titleUpdatedAt > a.titleUpdatedAt ? b : a;
  return normalizeWordbook({title:titled.title,titleUpdatedAt:titled.titleUpdatedAt,chapters,entries,deleted,updatedAt:a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt});
}
// The content two copies are compared by, without the local save time.
export const contentSignature = data => { const {updatedAt,...rest} = normalizeWordbook(data); return JSON.stringify(rest); };

// "hus — 房子", "hus - 房子", "hus\t房子", "hus：房子", "hus = 房子", "hus 房子" or just "hus".
export function parseBatch(input) {
  const rows = [];
  for (const [index,line] of String(input ?? '').split(/\r?\n/).entries()) {
    const value = line.normalize('NFC').trim().replace(/^[-•·*]\s+/,'').replace(/^\d+[.)、]\s*/,'');
    if (!value) continue;
    let word = value, meaning = '';
    const separated = /^(.+?)(?:\s+[—–-]{1,2}\s+|\s*[—–]\s*|\t+|\s*[=:：]\s*)(.+)$/.exec(value);
    if (separated) [,word,meaning] = separated;
    else {
      const cjk = value.search(CJK);
      if (cjk > 0) { word = value.slice(0,cjk); meaning = value.slice(cjk); }
    }
    rows.push({line:index+1,word:text(word,LIMITS.word+1).replace(/[,，;；]$/,''),meaning:text(meaning,LIMITS.meaning)});
  }
  return rows;
}

// Practice and the multiplayer game read the wordbook as chapters of textbook-shaped words.
export function wordbookVocabulary(data) {
  const book = normalizeWordbook(data);
  return {title:book.title,chapters:book.chapters.map((chapter,index) => ({id:chapter.id,number:index+1,title:chapter.title,
    words:book.entries.filter(entry => entry.chapterId === chapter.id).map(entry => ({word:entry.word,meaning:entry.meaning,pos:entry.pos,gender:entry.gender,article:entry.article,example:entry.example,ipa:entry.ipa,syllables:entry.syllables,...(entry.audio ? {audio:entry.audio} : {}),wordbookId:entry.id}))}))};
}

export function createWordbookStore({storage = globalThis.localStorage,key = STORAGE_KEY,syncKey = SYNC_KEY,now = () => new Date().toISOString()} = {}) {
  const listeners = new Set();
  let data = read(), sync = readSync();
  function read() {
    try { return normalizeWordbook(JSON.parse(storage?.getItem(key) || 'null')); } catch { return normalizeWordbook(null); }
  }
  // Which nickname's server copy this browser last matched, at which revision, and whether edits are unsent.
  function readSync() {
    try {
      const value = JSON.parse(storage?.getItem(syncKey) || 'null') || {};
      return {person:/^[0-9a-f]{20}$/.test(value.person) ? value.person : '',nickname:text(value.nickname,40),revision:Number.isInteger(value.revision) && value.revision > 0 ? value.revision : 0,dirty:value.dirty === true,syncedAt:typeof value.syncedAt === 'string' ? value.syncedAt : ''};
    } catch { return {person:'',nickname:'',revision:0,dirty:false,syncedAt:''}; }
  }
  function writeSync(next) {
    sync = {...sync,...next};
    try { storage.setItem(syncKey,JSON.stringify(sync)); } catch {}
    return sync;
  }
  function emit() { listeners.forEach(listener => { try { listener(data); } catch {} }); }
  function save(value) {
    try { storage.setItem(key,JSON.stringify(value)); }
    catch { const error = new Error('浏览器存储空间不足，词本没有保存。请删掉一些词条后再试。'); error.code = 'storage_full'; throw error; }
    data = value;
  }
  function commit(next) {
    save(normalizeWordbook({...next,updatedAt:now()}));
    writeSync({dirty:true});
    emit();
    return data;
  }
  const tombstones = ids => { const deleted = {...data.deleted}, time = now(); ids.forEach(id => { deleted[id] = time; }); return deleted; };
  const chapter = id => data.chapters.find(item => item.id === id);
  const entry = id => data.entries.find(item => item.id === id);
  return {
    get data() { return data; },
    get sync() { return sync; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    // Another tab saved: take its copy without writing it back.
    reload() { data = read(); sync = readSync(); emit(); return data; },
    // The server's copy (or a merge with it) becomes the local copy, with nothing left to send.
    adopt(value,meta) { save(normalizeWordbook(value)); writeSync({...meta,dirty:false,syncedAt:now()}); emit(); return data; },
    chapter,entry,
    entriesIn: id => data.entries.filter(item => item.chapterId === id),
    rename(title) {
      const value = text(title,LIMITS.title);
      if (!value) throw new Error('名字不能为空。');
      return commit({...data,title:value,titleUpdatedAt:now()});
    },
    addChapter(title) {
      const value = text(title,LIMITS.title);
      if (!value) throw new Error('请给目录起个名字。');
      if (data.chapters.length >= LIMITS.chapters) throw new Error(`目录最多 ${LIMITS.chapters} 个。`);
      const id = newId('c');
      commit({...data,chapters:[...data.chapters,{id,title:value,order:data.chapters.length,createdAt:now(),updatedAt:now()}]});
      return id;
    },
    renameChapter(id,title) {
      const value = text(title,LIMITS.title);
      if (!value) throw new Error('请给目录起个名字。');
      return commit({...data,chapters:data.chapters.map(item => item.id === id ? {...item,title:value,updatedAt:now()} : item)});
    },
    moveChapter(id,delta) {
      const list = [...data.chapters], from = list.findIndex(item => item.id === id), to = from+delta;
      if (from < 0 || to < 0 || to >= list.length) return data;
      [list[from],list[to]] = [list[to],list[from]];
      return commit({...data,chapters:list.map((item,index) => item.order === index ? item : {...item,order:index,updatedAt:now()})});
    },
    deleteChapter(id) {
      const gone = data.entries.filter(item => item.chapterId === id).map(item => item.id);
      return commit({...data,chapters:data.chapters.filter(item => item.id !== id),entries:data.entries.filter(item => item.chapterId !== id),deleted:tombstones([id,...gone])});
    },
    addEntries(chapterId,items) {
      if (!chapter(chapterId)) throw new Error('请先选择一个目录。');
      if (data.entries.length+items.length > LIMITS.entries) throw new Error(`词本最多 ${LIMITS.entries} 条。`);
      const added = items.map(item => ({...item,id:newId('e'),chapterId,createdAt:now(),updatedAt:now()}));
      const next = commit({...data,entries:[...data.entries,...added]});
      return added.map(item => next.entries.find(saved => saved.id === item.id)).filter(Boolean);
    },
    updateEntry(id,fields) {
      const current = entry(id);
      if (!current) throw new Error('这条已经不在词本里了。');
      const chapterId = fields.chapterId && chapter(fields.chapterId) ? fields.chapterId : current.chapterId;
      commit({...data,entries:data.entries.map(item => item.id === id ? {...item,...fields,chapterId,updatedAt:now()} : item)});
      return entry(id);
    },
    // Audio arrives after the entry is saved; it belongs to every entry with the same spelling.
    setAudio(word,audio) {
      const target = wordKey(word);
      if (!validAudio(audio) || !data.entries.some(item => wordKey(item.word) === target && item.audio !== audio)) return data;
      return commit({...data,entries:data.entries.map(item => wordKey(item.word) === target && item.audio !== audio ? {...item,audio,updatedAt:now()} : item)});
    },
    deleteEntry(id) { return commit({...data,entries:data.entries.filter(item => item.id !== id),deleted:tombstones([id])}); },
    exportData() { const {deleted,...rest} = data; return {format:FORMAT,version:1,exportedAt:now(),...rest}; },
    // Merge keeps everything and adds what is new: same-named chapters are joined, and the same word with
    // the same meaning in one chapter is not added twice. Replace swaps the whole wordbook, on every device.
    importData(raw,mode = 'merge') {
      if (!raw || typeof raw !== 'object' || (raw.format && raw.format !== FORMAT)) throw new Error('这不是本站导出的词本文件。');
      const incoming = normalizeWordbook({...raw,deleted:{}});
      if (!incoming.chapters.length) throw new Error('文件里没有可导入的目录。');
      const time = now(), fresh = (item,fields = {}) => ({...item,...fields,updatedAt:time});
      if (mode === 'replace') {
        const kept = new Set([...incoming.chapters,...incoming.entries].map(item => item.id));
        commit({...incoming,title:incoming.title,titleUpdatedAt:time,chapters:incoming.chapters.map(item => fresh(item)),entries:incoming.entries.map(item => fresh(item)),
          deleted:tombstones([...data.chapters,...data.entries].map(item => item.id).filter(id => !kept.has(id)))});
        return {chapters:incoming.chapters.length,entries:incoming.entries.length};
      }
      const chapters = [...data.chapters], entries = [...data.entries], mapping = new Map(), ids = new Set(entries.map(item => item.id));
      let addedChapters = 0, addedEntries = 0;
      for (const item of incoming.chapters) {
        const same = chapters.find(existing => existing.title === item.title);
        if (same) { mapping.set(item.id,same.id); continue; }
        if (chapters.length >= LIMITS.chapters) continue;
        const id = chapters.some(existing => existing.id === item.id) || data.deleted[item.id] ? newId('c') : item.id;
        chapters.push(fresh(item,{id,order:chapters.length})); mapping.set(item.id,id); addedChapters++;
      }
      const seen = new Set(entries.map(item => `${item.chapterId}\n${wordKey(item.word)}\n${item.meaning}`));
      for (const item of incoming.entries) {
        const chapterId = mapping.get(item.chapterId), signature = `${chapterId}\n${wordKey(item.word)}\n${item.meaning}`;
        if (!chapterId || seen.has(signature) || entries.length >= LIMITS.entries) continue;
        seen.add(signature);
        const id = ids.has(item.id) || data.deleted[item.id] ? newId('e') : item.id;
        entries.push(fresh(item,{id,chapterId})); ids.add(id); addedEntries++;
      }
      commit({...data,chapters,entries});
      return {chapters:addedChapters,entries:addedEntries};
    },
  };
}

// Keeps the local copy and the nickname's server copy in step. `request(path,{method,body})` is
// NorskCommunity.request: GET /wordbook answers {person,nickname,revision,data}; POST /wordbook
// {baseRevision,data} saves when nobody saved in between and otherwise fails with revision_conflict.
export function createWordbookSync({store,request,onStatus = () => {},delay = 1500,setTimer = setTimeout,clearTimer = clearTimeout}) {
  let timer = null, running = null, again = false, status = 'idle';
  const report = (next,detail = {}) => { status = next; try { onStatus(next,detail); } catch {} };
  async function attempt() {
    for (let round = 0; round < 4; round++) {
      const remote = await request('/wordbook',{method:'GET'});
      const person = String(remote?.person || ''), revision = Number(remote?.revision) || 0, nickname = String(remote?.nickname || '');
      const local = store.data, meta = store.sync;
      // Unsent edits are merged in, and so is a wordbook started under a nickname this browser has since left.
      const carry = meta.dirty || (meta.person !== person && local.chapters.length > 0);
      const base = normalizeWordbook(remote?.data || null);
      const merged = carry ? mergeWordbooks(base,local) : base;
      if (!carry || (revision && contentSignature(merged) === contentSignature(base))) {
        store.adopt(merged,{person,nickname,revision});
        return {person,revision,changed:false};
      }
      try {
        const saved = await request('/wordbook',{method:'POST',body:{baseRevision:revision,data:merged}});
        store.adopt(merged,{person,nickname,revision:Number(saved?.revision) || revision+1});
        return {person,revision:Number(saved?.revision) || revision+1,changed:true};
      } catch (error) {
        if (error?.code !== 'revision_conflict') throw error;
      }
    }
    const error = new Error('revision_conflict'); error.code = 'revision_conflict'; throw error;
  }
  function run() {
    if (running) { again = true; return running; }
    clearTimer(timer); timer = null;
    report('syncing');
    running = attempt().then(result => { report('synced',result); return result; },error => {
      report(['service_unavailable','timeout','rate_limited','unauthorized'].includes(error?.code) || !error?.code ? 'offline' : 'error',{code:error?.code || ''});
      return null;
    }).finally(() => {
      running = null;
      if (again) { again = false; schedule(); }
    });
    return running;
  }
  function schedule(wait = delay) { clearTimer(timer); timer = setTimer(() => { timer = null; run(); },wait); }
  return {run,schedule,get status() { return status; }};
}
