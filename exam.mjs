/* 考试与面试 (docs/exam-interview-plan.md, docs/exam-bank-format.md): the Norskprøven A1–A2 self-test under 更多,
   next to the A-team interview. Four parts taken apart, each giving an estimated level, run the way the real test
   runs them:
   - listening and reading: two short pre-tests (7 items each), then a main test of 16 whose mix of A1 and A2 items
     follows the pre-tests (the real test is partly adaptive). Listening plays every item twice and moves on by
     itself, never back; reading has 75 minutes for all three parts, free movement inside a part, never back to an
     earlier part. Items are drawn from the three sets' pool, unseen ones first.
   - writing: three texts in 90 minutes, graded by the site's AI (scripts/exam_ai.py through the community API).
   - speaking: exam-oral.mjs (four tasks with an examiner's voice, the conversation with an AI partner).
   A part left halfway waits behind 继续, its clock stopped. Results stay on the device and earn XP.
   Pictures come from the illustrator (assets/exam/<id>.webp); until one is there, a plain stand-in shows its brief.
   The pure parts (drawing items, the level, calendars, clocks, words) are exported for scripts/check_exam.mjs. */

const suffix = typeof import.meta === 'object' && import.meta.url ? new URL(import.meta.url).search : '';
export const STORE = 'norsk-exam-v1';
export const PARTS = {
  listening:{title:'听力',nb:'Lytting',meta:'约 40 分钟 · 30 题',files:'listening',activity:'exam-listen'},
  reading:{title:'阅读',nb:'Lesing',meta:'75 分钟 · 30 题',files:'reading',activity:'exam-read'},
  writing:{title:'写作',nb:'Skriving',meta:'90 分钟 · 3 篇',files:'writing',activity:'exam-write'},
  speaking:{title:'口语',nb:'Muntlig',meta:'约 20 分钟 · 4 个任务',files:'speaking',activity:'exam-speak'}
};
export const SETS = [1,2,3];
export const LEVEL_TEXT = {'under-A1':'低于 A1','A1':'A1','A2':'A2'};
export const READING_MS = 75*60*1000, WRITING_MS = 90*60*1000;
const ANSWER_MS = 12000, REPEAT_GAP_MS = 1600;
const SECTION_NAMES = ['预测验 1','预测验 2','主测验'];
const MONTHS = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember'];
const WEEKDAYS = ['ma','ti','on','to','fr','lø','sø'];

/* ---------- Pure helpers (scripts/check_exam.mjs) ---------- */

export function shuffle(list,random = Math.random) {
  const out = [...list];
  for (let i = out.length-1; i > 0; i--) { const j = Math.floor(random()*(i+1)); [out[i],out[j]] = [out[j],out[i]]; }
  return out;
}
/** Items as drawing units: one item, or a whole group (a shared-options listening group, a long reading text). */
export function buildUnits(items) {
  const units = [], groups = new Map();
  for (const item of items) {
    if (item.group) {
      if (!groups.has(item.group)) { const unit = {group:item.group,level:item.level,type:'group',ids:[]}; groups.set(item.group,unit); units.push(unit); }
      groups.get(item.group).ids.push(item.id);
    } else units.push({level:item.level,type:item.type,ids:[item.id]});
  }
  return units;
}
/** How many A1 and A2 items a section takes. score: right answers so far (pre-test 1, or both pre-tests). */
export function sectionPlan(stage,score = 0) {
  if (stage === 0) return {A1:4,A2:3};
  if (stage === 1) return score >= 5 ? {A1:2,A2:5} : score <= 2 ? {A1:6,A2:1} : {A1:4,A2:3};
  return score >= 10 ? {A1:4,A2:8,group:true} : score >= 6 ? {A1:8,A2:4,group:true} : {A1:12,A2:0,group:true};
}
/** Draw one section: unseen units first, the item types taken in turn, A1 before A2, a group at the end. */
export function drawSection(units,plan,{seen = new Set(),taken = new Set(),random = Math.random} = {}) {
  const fresh = unit => !unit.ids.some(id => taken.has(id));
  const unseenFirst = list => shuffle(list,random).sort((a,b) => Number(a.ids.some(id => seen.has(id)))-Number(b.ids.some(id => seen.has(id))));
  const chosen = [];
  for (const level of ['A1','A2']) {
    const byType = new Map();
    for (const unit of unseenFirst(units.filter(unit => unit.type !== 'group' && unit.level === level && fresh(unit)))) {
      if (!byType.has(unit.type)) byType.set(unit.type,[]);
      byType.get(unit.type).push(unit);
    }
    // Each type in proportion to its share of the bank (most items are multiple choice, as in the real test): the
    // k-th unit of a type of n sits at about (k+½)/n along the line, and the line is cut after the units needed.
    const types = shuffle([...byType.keys()],random), line = [];
    for (const type of types) byType.get(type).forEach((unit,k,list) => line.push({unit,at:(k+.25+random()*.5)/list.length}));
    const picked = line.sort((a,b) => a.at-b.at).slice(0,plan[level] || 0).map(entry => entry.unit);
    // Like tasks sit together, the way a test page runs.
    picked.sort((a,b) => types.indexOf(a.type)-types.indexOf(b.type));
    chosen.push(...picked);
  }
  if (plan.group) { const group = unseenFirst(units.filter(unit => unit.type === 'group' && fresh(unit)))[0]; if (group) chosen.push(group); }
  const ids = chosen.flatMap(unit => unit.ids);
  ids.forEach(id => taken.add(id));
  return ids;
}
export function isCorrect(item,value) {
  if (value === undefined || value === null || value === '') return false;
  if (['calendar','click'].includes(item.type)) return String(value) === String(item.answer);
  if (item.type === 'word') return foldWord(value) === foldWord(item.answer);
  return Number(value) === Number(item.answer);
}
const foldWord = word => String(word || '').toLocaleLowerCase('nb').normalize('NFC').replace(/[^\p{L}\p{N}]/gu,'');
const fold = text => String(text || '').toLocaleLowerCase('nb').normalize('NFC').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
/** The estimated level from answers [{level, correct}]: A2 needs most A2 items and nearly all A1 items right. */
export function estimate(answers) {
  const by = {A1:[0,0],A2:[0,0]};
  for (const answer of answers) { const row = by[answer.level] || by.A1; row[1] += 1; if (answer.correct) row[0] += 1; }
  const share = ([right,total]) => total ? right/total : 0;
  const level = by.A2[1] >= 4 && share(by.A2) >= .65 && share(by.A1) >= .7 ? 'A2' : share(by.A1) >= .6 ? 'A1' : 'under-A1';
  return {level,by};
}
/** A month as weeks of day numbers (Monday first, null outside the month). month: 'YYYY-MM'. */
export function calendarWeeks(month) {
  const [year,number] = String(month).split('-').map(Number);
  const first = (new Date(Date.UTC(year,number-1,1)).getUTCDay()+6)%7, days = new Date(Date.UTC(year,number,0)).getUTCDate();
  const cells = [...Array(first).fill(null),...Array.from({length:days},(_,i) => i+1)];
  while (cells.length%7) cells.push(null);
  return Array.from({length:cells.length/7},(_,i) => cells.slice(i*7,i*7+7));
}
export const monthName = month => { const [year,number] = String(month).split('-').map(Number); return `${MONTHS[number-1] || ''} ${year}`; };
/** Clock hands for "HH:MM": angles in degrees from twelve. */
export function clockHands(time) {
  const [hours,minutes] = String(time).split(/[:.]/).map(Number);
  return {hour:((hours%12)+minutes/60)*30,minute:minutes*6};
}
/** A text as words to click (word items): [{word, before, after}] and line breaks as {br:true}. */
export function wordTokens(text) {
  const out = [];
  String(text || '').split(/(\n)/).forEach(part => {
    if (part === '\n') { out.push({br:true}); return; }
    for (const piece of part.split(/\s+/).filter(Boolean)) {
      const [,before,word,after] = piece.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
      out.push({before,word,after});
    }
  });
  return out;
}
export const countWords = text => String(text || '').split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length;

/* ---------- The module ---------- */

export function createExam(deps = {}) {
  const e = value => String(value ?? '').replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const v = deps.version ? `?v=${encodeURIComponent(deps.version)}` : '';
  const nl = text => e(text).replace(/\n/g,'<br>');
  let root = null, screen = 'hub', partKey = null, store = read(), banks = {}, loading = {}, art = new Map();
  let audio = null, audioRun = 0, tick = null, answerTimer = null, flow = {phase:'idle',left:0}, oral = null, intro = {set:null};
  const ui = {zh:false,confirm:null,grading:false,error:''};
  let starting = false;
  // Records being graded now (by id): a second tap waits for the same answer instead of asking the AI again.
  const grading = new Set();
  // Silencing the site's other sounds calls back into this module's stopAudio (app.js pauseOtherAudio → 更多):
  // that call must not stop the clip about to play.
  let silencing = false;
  function quietOthers() { silencing = true; try { deps.stopAudio?.(); } finally { silencing = false; } }

  function read() {
    try { const value = JSON.parse(localStorage.getItem(STORE) || 'null'); if (value?.version === 1) return value; } catch {}
    return {version:1,history:[],active:{},seen:{},sets:{}};
  }
  function save() { try { localStorage.setItem(STORE,JSON.stringify(store)); } catch {} }
  const active = () => store.active[partKey] || null;
  const lastOf = key => store.history.filter(record => record.part === key).sort((a,b) => b.finishedAt.localeCompare(a.finishedAt))[0] || null;

  /* ----- data ----- */
  function loadPart(key) {
    if (banks[key]) return Promise.resolve(banks[key]);
    loading[key] ||= Promise.all(SETS.map(n => fetch(`data/exam/${PARTS[key].files}-${n}.json${v}`).then(response => { if (!response.ok) throw new Error('missing'); return response.json(); })))
      .then(files => {
        const bank = {items:new Map(),groups:new Map(),sets:new Map(),units:[]};
        for (const file of files) {
          for (const group of file.groups || []) bank.groups.set(group.id,group);
          for (const item of file.items || []) bank.items.set(item.id,item);
          if (file.tasks) bank.sets.set(file.set,file.tasks);
        }
        bank.units = buildUnits([...bank.items.values()]);
        return (banks[key] = bank);
      }).catch(error => { loading[key] = null; throw error; });
    return loading[key];
  }
  const bank = () => banks[partKey];
  const itemOf = id => bank()?.items.get(id);
  // Pictures: the illustrator's file, or a stand-in that shows its brief until it exists.
  function artReady(id) {
    if (!art.has(id)) {
      art.set(id,'loading');
      const image = new Image();
      const show = ok => {
        art.set(id,ok ? 'ok' : 'missing');
        const node = root?.querySelector(`[data-art="${id}"]`);
        if (!node) return;
        // A picture beside the writing box (or in the speaking test) changes alone: redrawing the page would take
        // the focus, and a phone's keyboard, away from the text being written.
        if (node.tagName === 'FIGURE') { if (ok) { node.classList.remove('is-stand-in'); node.innerHTML = `<img src="${artURL(id)}" alt="考试场景图">`; } return; }
        render();
      };
      image.onload = () => show(true);
      image.onerror = () => show(false);
      image.src = artURL(id);
    }
    return art.get(id) === 'ok';
  }
  const artURL = id => `assets/exam/${id}.webp${v}`;
  const audioURL = id => `audio/exam/${id}.mp3${v}`;

  /* ----- rendering ----- */
  const ICON = {
    listening:'<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="2.5" y="13" width="5" height="7.5" rx="2"/><rect x="16.5" y="13" width="5" height="7.5" rx="2"/>',
    reading:'<path d="M3 5.5c3-1.3 6-1.3 9 .6 3-1.9 6-1.9 9-.6V19c-3-1.3-6-1.3-9 .6-3-1.9-6-1.9-9-.6z"/><path d="M12 6.1v13.5"/>',
    writing:'<path d="m4.5 19.5 1-4.5L15.5 5l3.5 3.5-10 10z"/><path d="M13 7.5 16.5 11"/>',
    speaking:'<rect x="9" y="3" width="6" height="11.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
    interview:'<path d="M20 11a8 8 0 0 1-8 8H5l-4 3 1-7a8 8 0 1 1 18-4Z"/><path d="M6 10h9M6 14h6"/>',
    arrow:'<path d="m9 5 7 7-7 7"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',sound:'<path d="m11 5-6 5H2v6h3l6 5V5Zm5 4a6 6 0 0 1 0 10"/>',
    check:'<path d="m5 12.5 4.5 4.5L19 7.5"/>',cross:'<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name] || ''}</svg>`;
  const levelChip = (level,extra = '') => `<span class="ex-level is-${e(level)}${extra}">${e(LEVEL_TEXT[level] || level)}</span>`;
  const dateText = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getMonth()+1} 月 ${d.getDate()} 日`; };

  function render(focus = '') {
    if (!root) return;
    document.body?.classList.toggle('practice-focus',screen === 'session' || screen === 'grading');
    if (screen === 'oral') { oral?.render(); return; }
    root.innerHTML = screen === 'hub' ? hubMarkup() : screen === 'intro' ? introMarkup() : screen === 'session' ? sessionMarkup()
      : screen === 'grading' ? gradingMarkup() : screen === 'result' ? resultMarkup() : hubMarkup();
    afterRender();
    if (focus) root.querySelector(focus)?.focus?.({preventScroll:true});
  }
  function afterRender() {
    const timer = root?.querySelector('[data-exam-clock]');
    if (timer) timer.textContent = clockText();
  }

  /* ----- hub ----- */
  function partStatus(key) {
    if (store.active[key]) return `<span class="ex-part-status is-active">继续 · ${e(progressText(key))}</span>`;
    const last = lastOf(key);
    if (!last) return '<span class="ex-part-status">还没考过</span>';
    if (last.status === 'pending') return '<span class="ex-part-status is-active">等待评分</span>';
    return `<span class="ex-part-status">上次 ${levelChip(last.level,' is-small')} <small>${e(dateText(last.finishedAt))}</small></span>`;
  }
  function progressText(key) {
    const run = store.active[key];
    if (!run) return '';
    if (key === 'writing') return `第 ${run.set} 套`;
    if (key === 'speaking') return `第 ${run.set} 套 · 任务 ${(run.task || 0)+1}`;
    const done = Object.keys(run.answers || {}).length;
    return `已答 ${done} 题`;
  }
  function hubMarkup() {
    return `<div class="mh-tool-bar"><button type="button" class="mh-back" data-more="home"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg><span>更多</span></button></div>
      <section class="ex-app ex-hub" aria-labelledby="ex-title">
        <header class="ex-head"><p class="ex-kicker">PRØVE · 考试与面试</p><h2 id="ex-title" tabindex="-1">考试与面试</h2><p>照 Norskprøven A1–A2 的考法分项自测，也能练 A-team 面试；开口回答由 AI 点评。</p></header>
        <section class="ex-block" aria-labelledby="ex-test-title">
          <div class="ex-block-head"><h3 id="ex-test-title">Norskprøven A1–A2 自测</h3><span>四项分开考，各给一个估计等级</span></div>
          <div class="ex-parts">${Object.entries(PARTS).map(([key,part]) => `<button type="button" class="ex-part is-${key}" data-exam="part" data-part="${key}"><span class="ex-part-icon">${icon(key)}</span><span class="ex-part-text"><strong>${part.title} <em lang="nb">${part.nb}</em></strong><span>${part.meta}</span>${partStatus(key)}</span>${icon('arrow')}</button>`).join('')}</div>
          <p class="ex-fineprint">估计等级只供参考，不是官方成绩。写作和口语由 AI 按官方评分标准评分；口语只看说出的内容，发音不评。</p>
        </section>
        <section class="ex-block" aria-labelledby="ex-interview-title">
          <div class="ex-block-head"><h3 id="ex-interview-title">A-team 面试</h3><span>15 个常见问题</span></div>
          <button type="button" class="ex-interview" data-exam="interview"><span class="ex-part-icon">${icon('interview')}</span><span class="ex-part-text"><strong>面试练习</strong><span>双语翻卡、只看挪语，或听题后开口回答，AI 点评</span></span>${icon('arrow')}</button>
        </section>
      </section>`;
  }

  /* ----- intro ----- */
  const RULES = {
    listening:['先做两个预测验（各 7 题），再做主测验（16 题）。主测验的难度按预测验的成绩分配，和真实考试一样。','每题的问题和录音自动播放两遍，播完有 12 秒作答时间，然后自动进入下一题。','答过的题不能回头。中途退出，回来时从这一题重新播放。','请戴好耳机，先点「试听」调好音量。'],
    reading:['先做两个预测验（各 7 题），再做主测验（16 题）。三部分一共 75 分钟。','同一部分里可以前后翻看、修改答案；进入下一部分后不能回到前一部分。','建议每个预测验不超过 15 分钟，把时间留给主测验。中途退出，计时会暂停。'],
    writing:['90 分钟写三篇：一条短消息、一段看图描述（约 50–80 词）、一篇熟悉话题的短文（80 词以上）。','三篇可以来回切换，草稿自动保存。字数只是参考，写多不扣分。','交卷后由 AI 按官方评分标准评分：看是否完成任务，以及结构、拼写和标点、词汇、语法，等级取最低的一项。'],
    speaking:['四个任务：介绍自己、描述图片、和同伴交换信息、讲一个熟悉的话题，约 20 分钟。','考官的话会一句句播放。轮到你时开口说，说完点「说完了」。第 3 个任务由 AI 扮演同伴和你对话。','你说的话边说边识别成文字（录音只用来识别，不保存），文字交给 AI 评分；发音不评。']
  };
  function introMarkup() {
    const part = PARTS[partKey], run = active(), sets = ['writing','speaking'].includes(partKey);
    const done = store.sets[partKey] || [];
    const chosen = intro.set || run?.set || SETS.find(n => !done.includes(n)) || 1;
    intro.set = chosen;
    return `<section class="ex-app ex-intro" aria-labelledby="ex-intro-title">
      <div class="ex-intro-card">
        <button type="button" class="ex-close" data-exam="hub" aria-label="返回考试与面试">${icon('close')}</button>
        <span class="ex-part-icon is-large">${icon(partKey)}</span>
        <p class="ex-kicker">NORSKPRØVEN A1–A2 · ${e(part.nb.toUpperCase())}</p>
        <h2 id="ex-intro-title" tabindex="-1">${part.title}</h2>
        <p class="ex-intro-meta">${icon('clock')}${part.meta}</p>
        <ul class="ex-rules">${RULES[partKey].map(rule => `<li>${rule}</li>`).join('')}</ul>
        ${sets ? `<div class="ex-sets" role="group" aria-label="选择一套题">${SETS.map(n => `<button type="button" class="ex-set" data-exam="set" data-set="${n}" aria-pressed="${n === chosen}"${run && run.set !== n ? ' disabled' : ''}>第 ${n} 套${done.includes(n) ? '<small>做过</small>' : ''}</button>`).join('')}</div>` : ''}
        ${partKey === 'listening' ? `<button type="button" class="ex-soundcheck" data-exam="soundcheck">${icon('sound')}试听</button>` : ''}
        ${lastRow()}
        ${ui.error ? `<p class="ex-error" role="alert">${e(ui.error)}</p>` : ''}
        <div class="ex-intro-actions">${run ? `<button type="button" class="ex-primary" data-exam="resume">继续 · ${e(progressText(partKey))}</button><button type="button" class="ex-quiet" data-exam="restart">重新开始</button>` : `<button type="button" class="ex-primary" data-exam="start">开始</button>`}</div>
      </div>${confirmMarkup()}
    </section>`;
  }

  // The last result of this part: open it, or grade it again when the AI could not grade it then.
  function lastRow() {
    const last = lastOf(partKey);
    if (!last) return '';
    return last.status === 'pending'
      ? `<div class="ex-last is-pending"><span>上次的答案还没评分 · ${e(dateText(last.finishedAt))}</span><button type="button" class="ex-text-button" data-exam="regrade" data-id="${e(last.id)}">现在评分</button></div>`
      : `<div class="ex-last"><span>上次 ${levelChip(last.level,' is-small')} ${e(dateText(last.finishedAt))}</span><button type="button" class="ex-text-button" data-exam="show-result" data-id="${e(last.id)}">查看结果</button></div>`;
  }

  /* ----- session: listening and reading ----- */
  const currentIds = () => { const run = active(); return run?.sections?.[run.section] || []; };
  const currentId = () => currentIds()[active()?.index || 0];
  function clockText() {
    const run = active();
    if (!run || run.remaining == null) return '';
    const left = Math.max(0,run.remaining - (run.since ? Date.now()-run.since : 0)), minutes = Math.floor(left/60000), seconds = Math.floor(left%60000/1000);
    return `${minutes}:${String(seconds).padStart(2,'0')}`;
  }
  function sessionBar(label,count) {
    const run = active(), timed = run?.remaining != null;
    return `<div class="ex-bar"><button type="button" class="ex-exit" data-exam="exit" aria-label="退出，进度会保存">${icon('close')}<span>退出</span></button><div class="ex-bar-meta"><strong>${PARTS[partKey].title} · ${e(label)}</strong><span>${count}</span></div>${timed ? `<span class="ex-clock" role="timer" aria-label="剩余时间">${icon('clock')}<b data-exam-clock>${clockText()}</b></span>` : ''}</div>`;
  }
  function sessionMarkup() {
    if (partKey === 'writing') return writingMarkup();
    const run = active(), ids = currentIds(), id = currentId(), item = itemOf(id);
    if (!run || !item) return `<section class="ex-app"><p class="ex-error">这套题暂时无法显示。</p><button type="button" class="ex-primary" data-exam="hub">返回</button></section>`;
    const group = item.group ? bank().groups.get(item.group) : null;
    const position = `第 ${run.index+1} / ${ids.length} 题`;
    const body = partKey === 'listening' ? listeningItem(item,group,run) : readingItem(item,group,run);
    const nav = partKey === 'reading' ? readingNav(run,ids) : '';
    return `<section class="ex-app ex-session is-${partKey}">${sessionBar(SECTION_NAMES[run.section],position)}<div class="ex-progress" aria-hidden="true">${SECTION_NAMES.map((name,i) => `<i class="${i < run.section ? 'is-done' : i === run.section ? 'is-now' : ''}"><b style="width:${i < run.section ? 100 : i === run.section ? Math.round((run.index+1)/ids.length*100) : 0}%"></b></i>`).join('')}</div>${body}${nav}${confirmMarkup()}</section>`;
  }
  function questionOf(item,group) { return item.question || group?.question || {nb:'',zh:''}; }
  function optionsOf(item,group) { return item.options || group?.options || []; }
  function listeningItem(item,group,run) {
    const value = run.answers[item.id], phase = flow.phase;
    const label = phase === 'loading' ? '准备录音…' : phase === 'play1' ? '第 1 遍' : phase === 'gap' ? '马上播第 2 遍' : phase === 'play2' ? '第 2 遍' : phase === 'answer' ? `请作答 · ${Math.ceil(flow.left/1000)} 秒` : phase === 'missing' ? '这段录音还没准备好' : '';
    return `<div class="ex-stage">
      <div class="ex-player is-${phase}" role="status" aria-live="polite"><span class="ex-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span>${label}</span></div>
      <p class="ex-question" lang="nb">${nl(questionOf(item,group).nb)}</p>
      ${answersMarkup(item,group,value)}
      <div class="ex-foot"><button type="button" class="ex-primary ex-next" data-exam="next"${value === undefined && phase !== 'missing' && phase !== 'answer' ? ' disabled' : ''}>下一题${icon('arrow')}</button></div>
    </div>`;
  }
  function docMarkup(text,item) {
    if (!text) return '';
    const head = text.kind === 'sms' ? (text.from ? `<span class="ex-doc-from">${e(text.from)}</span>` : '')
      : text.kind === 'epost' ? `<dl class="ex-doc-mail">${text.from ? `<div><dt>Fra</dt><dd>${e(text.from)}</dd></div>` : ''}${text.title ? `<div><dt>Emne</dt><dd>${e(text.title)}</dd></div>` : ''}</dl>`
      : text.title ? `<h4 class="ex-doc-title">${e(text.title)}</h4>` : '';
    const words = item?.type === 'word' ? wordTokens(text.nb).map(token => token.br ? '<br>' : `${e(token.before)}${token.word ? `<button type="button" class="ex-word${foldWord(token.word) === foldWord(active()?.answers[item.id]) ? ' is-chosen' : ''}" data-exam="answer" data-value="${e(token.word)}">${e(token.word)}</button>` : ''}${e(token.after)} `).join('') : nl(text.nb);
    const footer = text.kind !== 'sms' && text.kind !== 'epost' && text.from ? `<p class="ex-doc-sign">${e(text.from)}</p>` : '';
    return `<article class="ex-doc is-${e(text.kind || 'fortelling')}" lang="nb">${head}<div class="ex-doc-body">${words}</div>${footer}</article>`;
  }
  function readingItem(item,group,run) {
    const value = run.answers[item.id], text = item.text || group?.text;
    return `<div class="ex-stage is-reading${text ? ' has-text' : ''}">${docMarkup(text,item)}<div class="ex-ask"><p class="ex-question" lang="nb">${nl(questionOf(item,group).nb)}</p>${item.type === 'word' ? `<p class="ex-hint">${value ? `你选了 <b lang="nb">${e(value)}</b>` : '在上面的文字里点一个词。'}</p>` : answersMarkup(item,group,value)}</div></div>`;
  }
  function readingNav(run,ids) {
    const last = run.index === ids.length-1;
    return `<nav class="ex-nav" aria-label="这一部分的题目"><button type="button" class="ex-quiet" data-exam="prev"${run.index ? '' : ' disabled'}>上一题</button><div class="ex-dots">${ids.map((id,i) => `<button type="button" class="ex-dot${run.answers[id] !== undefined ? ' is-answered' : ''}${i === run.index ? ' is-now' : ''}" data-exam="goto" data-index="${i}" aria-label="第 ${i+1} 题${run.answers[id] !== undefined ? '，已答' : ''}">${i+1}</button>`).join('')}</div>${last ? `<button type="button" class="ex-primary" data-exam="section-end">${run.section < 2 ? '下一部分' : '交卷'}</button>` : `<button type="button" class="ex-primary" data-exam="next">下一题</button>`}</nav>`;
  }
  function answersMarkup(item,group,value) {
    const type = item.type === 'shared' ? 'choice' : item.type;
    if (type === 'picture') return pictureMarkup(item,value);
    if (type === 'click') return clickMarkup(item,value);
    if (type === 'clock') return `<div class="ex-clocks">${optionsOf(item,group).map((option,i) => `<button type="button" class="ex-option ex-clock-option${Number(value) === i ? ' is-chosen' : ''}" data-exam="answer" data-value="${i}" aria-label="${e(option.nb)}">${clockSVG(option.nb)}</button>`).join('')}</div>`;
    if (type === 'calendar') return calendarMarkup(item,value);
    const long = optionsOf(item,group).some(option => option.nb.length > 40);
    return `<div class="ex-options${long || type === 'text' ? ' is-long' : ''}">${optionsOf(item,group).map((option,i) => `<button type="button" class="ex-option${Number(value) === i && value !== undefined ? ' is-chosen' : ''}" data-exam="answer" data-value="${i}" lang="nb"><kbd>${'ABCD'[i]}</kbd><span>${nl(option.nb)}</span></button>`).join('')}</div>`;
  }
  function pictureMarkup(item,value) {
    const id = item.art?.id, ready = id && artReady(id), panels = item.art?.panels || [];
    return `<div class="ex-panels" data-art="${e(id)}">${[0,1,2,3].map(i => `<button type="button" class="ex-panel${value !== undefined && Number(value) === i ? ' is-chosen' : ''}${ready ? '' : ' is-stand-in'}" data-exam="answer" data-value="${i}" aria-label="图 ${'ABCD'[i]}"${ready ? ` style="background-image:url('${artURL(id)}');background-position:${i%2 ? '100%' : '0'} ${i > 1 ? '100%' : '0'}"` : ''}><kbd>${'ABCD'[i]}</kbd>${ready ? '' : `<small>插图待画：${e(panels[i] || '')}</small>`}</button>`).join('')}</div>`;
  }
  function clickMarkup(item,value) {
    const id = item.art?.id, ready = id && artReady(id);
    return `<div class="ex-scene${ready ? '' : ' is-stand-in'}" data-art="${e(id)}">${ready ? `<img src="${artURL(id)}" alt="">` : `<p class="ex-scene-brief">插图待画：${e(item.art?.brief || '')}</p>`}${(item.art?.hotspots || []).map(spot => `<button type="button" class="ex-spot${String(value) === spot.id ? ' is-chosen' : ''}" data-exam="answer" data-value="${e(spot.id)}" style="left:${spot.x}%;top:${spot.y}%;width:${spot.w}%;height:${spot.h}%" aria-label="${e(spot.label || spot.id)}">${ready ? '' : `<small>${e(spot.label || spot.id)}</small>`}</button>`).join('')}</div>`;
  }
  function clockSVG(time) {
    const {hour,minute} = clockHands(time), hand = (angle,length) => { const r = angle*Math.PI/180; return `${(50+Math.sin(r)*length).toFixed(1)} ${(50-Math.cos(r)*length).toFixed(1)}`; };
    const ticks = Array.from({length:12},(_,i) => { const r = i*30*Math.PI/180, a = 41, b = i%3 ? 38 : 35; return `<path d="M${(50+Math.sin(r)*a).toFixed(1)} ${(50-Math.cos(r)*a).toFixed(1)} L${(50+Math.sin(r)*b).toFixed(1)} ${(50-Math.cos(r)*b).toFixed(1)}"/>`; }).join('');
    return `<svg class="ex-clockface" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="45"/>${ticks}<path class="ex-hand-h" d="M50 50 L${hand(hour,22)}"/><path class="ex-hand-m" d="M50 50 L${hand(minute,33)}"/><circle class="ex-pin" cx="50" cy="50" r="2.6"/></svg>`;
  }
  function calendarMarkup(item,value) {
    const cal = item.calendar || {};
    if (cal.pick === 'month') {
      const year = String(cal.month).slice(0,4);
      return `<div class="ex-months">${MONTHS.map((name,i) => { const key = `${year}-${String(i+1).padStart(2,'0')}`; return `<button type="button" class="ex-month${value === key ? ' is-chosen' : ''}" data-exam="answer" data-value="${key}" lang="nb">${name}</button>`; }).join('')}</div>`;
    }
    return `<div class="ex-calendar" lang="nb"><p class="ex-calendar-title">${e(monthName(cal.month))}</p><div class="ex-calendar-grid">${WEEKDAYS.map(day => `<span class="ex-weekday">${day}</span>`).join('')}${calendarWeeks(cal.month).flat().map(day => {
      if (!day) return '<span class="ex-day is-empty"></span>';
      const key = `${cal.month}-${String(day).padStart(2,'0')}`;
      return `<button type="button" class="ex-day${value === key ? ' is-chosen' : ''}" data-exam="answer" data-value="${key}">${day}</button>`;
    }).join('')}</div></div>`;
  }
  function confirmMarkup() {
    const c = ui.confirm;
    if (!c) return '';
    return `<div class="ex-confirm" role="dialog" aria-modal="true" aria-labelledby="ex-confirm-title"><div class="ex-confirm-card"><h3 id="ex-confirm-title">${e(c.title)}</h3><p>${e(c.text)}</p><div class="ex-confirm-actions">${c.actions.map(([action,label,primary]) => `<button type="button" class="${primary ? 'ex-primary' : 'ex-quiet'}" data-exam="${action}">${label}</button>`).join('')}</div></div></div>`;
  }

  /* ----- running a listening or reading test ----- */
  function startObjective() {
    const seen = new Set(store.seen[partKey] || []), taken = new Set();
    const first = drawSection(bank().units,sectionPlan(0),{seen,taken});
    store.active[partKey] = {part:partKey,startedAt:new Date().toISOString(),sections:[first],section:0,index:0,answers:{},taken:[...taken],
      remaining:partKey === 'reading' ? READING_MS : null,since:null};
    save();
  }
  function score(run,sections) { return sections.flatMap(i => run.sections[i] || []).filter(id => isCorrect(itemOf(id),run.answers[id])).length; }
  function nextSection() {
    const run = active();
    if (run.section >= 2) { finishObjective(); return; }
    const taken = new Set(run.taken), seen = new Set(store.seen[partKey] || []);
    const plan = run.section === 0 ? sectionPlan(1,score(run,[0])) : sectionPlan(2,score(run,[0,1]));
    run.sections.push(drawSection(bank().units,plan,{seen,taken}));
    run.taken = [...taken]; run.section += 1; run.index = 0;
    save(); render('.ex-question'); if (partKey === 'listening') playCurrent();
  }
  function advance() {
    const run = active();
    stopSound();
    if (run.index < currentIds().length-1) { run.index += 1; save(); render('.ex-question'); if (partKey === 'listening') playCurrent(); }
    else nextSection();
  }
  function finishObjective() {
    const run = active();
    stopSound(); stopClock();
    const ids = run.sections.flat(), answers = ids.map(id => { const item = itemOf(id); return {id,level:item.level,value:run.answers[id],correct:isCorrect(item,run.answers[id])}; });
    const {level,by} = estimate(answers);
    const record = {id:`exam-${partKey}-${Date.now().toString(36)}`,part:partKey,level,by,finishedAt:new Date().toISOString(),answers};
    store.history.unshift(record);
    store.history = store.history.slice(0,60);
    store.seen[partKey] = [...new Set([...ids,...(store.seen[partKey] || [])])].slice(0,Math.max(0,(bank().items.size || 90)-30));
    delete store.active[partKey];
    save();
    award(record,answers.length,answers.filter(answer => answer.correct).length);
    showResult(record);
  }
  function award(record,total,correct) {
    deps.submitResult?.({id:record.id,activity:PARTS[record.part].activity,total,level:record.level,answers:Array.from({length:total},(_,i) => ({points:i < correct ? 2 : 0}))});
  }

  /* ----- listening audio: every item twice, then a short time to answer ----- */
  function stopSound() {
    audioRun += 1;
    clearInterval(answerTimer); answerTimer = null;
    if (audio) { audio.onended = audio.onerror = null; audio.pause(); audio.removeAttribute('src'); audio.load?.(); audio = null; }
    flow = {phase:'idle',left:0};
  }
  function setFlow(phase,left = 0) {
    flow = {phase,left};
    const player = root?.querySelector('.ex-player');
    if (!player || screen !== 'session') return;
    const item = itemOf(currentId()), group = item?.group ? bank().groups.get(item.group) : null;
    const fresh = document.createElement('div');
    fresh.innerHTML = listeningItem(item,group,active());
    player.replaceWith(fresh.querySelector('.ex-player'));
    const next = root.querySelector('[data-exam="next"]');
    if (next) next.disabled = active().answers[item.id] === undefined && !['answer','missing'].includes(phase);
  }
  function playOnce(url,run) {
    return new Promise(done => {
      quietOthers();
      const clip = new Audio(url);
      audio = clip;
      clip.onended = () => done(run === audioRun ? 'ended' : 'stopped');
      clip.onerror = () => done(run === audioRun ? 'missing' : 'stopped');
      clip.play().catch(() => done(run === audioRun ? 'blocked' : 'stopped'));
    });
  }
  async function playCurrent() {
    const id = currentId(), run = ++audioRun;
    if (!id || screen !== 'session') return;
    setFlow('loading');
    for (const pass of [1,2]) {
      if (pass === 2) { setFlow('gap'); await new Promise(done => setTimeout(done,REPEAT_GAP_MS)); if (run !== audioRun) return; }
      setFlow(pass === 1 ? 'play1' : 'play2');
      const outcome = await playOnce(audioURL(id),run);
      if (outcome === 'stopped' || run !== audioRun) return;
      if (outcome === 'missing') { setFlow('missing'); return; }
      if (outcome === 'blocked') { setFlow('blocked'); renderBlocked(); return; }
    }
    // Time to answer, then the test moves on by itself.
    const until = Date.now()+ANSWER_MS;
    setFlow('answer',ANSWER_MS);
    answerTimer = setInterval(() => {
      if (run !== audioRun) return;
      const left = until-Date.now();
      if (left <= 0) { clearInterval(answerTimer); answerTimer = null; advance(); return; }
      setFlow('answer',left);
    },250);
  }
  // A browser that refuses to play without a tap (after a reload): one tap starts the item again.
  function renderBlocked() {
    const player = root?.querySelector('.ex-player');
    if (player) player.innerHTML = `<button type="button" class="ex-primary" data-exam="replay">${icon('sound')}点一下开始播放</button>`;
  }

  /* ----- the reading clock ----- */
  function startClock() {
    const run = active();
    if (!run || run.remaining == null) return;
    run.since = Date.now();
    clearInterval(tick);
    tick = setInterval(() => {
      const current = active();
      if (!current || current.remaining == null) { clearInterval(tick); tick = null; return; }
      const left = current.remaining-(Date.now()-current.since);
      const label = root?.querySelector('[data-exam-clock]');
      if (label) { label.textContent = clockText(); label.closest('.ex-clock')?.classList.toggle('is-low',left < 5*60000); }
      if (left <= 0) { clearInterval(tick); tick = null; current.remaining = 0; current.since = null; timeUp(); }
    },1000);
  }
  function stopClock() {
    clearInterval(tick); tick = null;
    const run = active();
    if (run?.since) { run.remaining = Math.max(0,run.remaining-(Date.now()-run.since)); run.since = null; save(); }
  }
  function timeUp() {
    if (partKey === 'writing') { submitWriting(true); return; }
    finishObjective();
  }

  /* ----- writing ----- */
  function writingMarkup() {
    const run = active(), tasks = bank().sets.get(run.set) || [], task = tasks[run.task || 0];
    if (!task) return '<section class="ex-app"><p class="ex-error">这套题暂时无法显示。</p></section>';
    const text = run.drafts[task.id] || '', words = countWords(text), [low,high] = task.words || [];
    const goal = high ? `${low}–${high} 词` : `${low} 词以上`;
    return `<section class="ex-app ex-session is-writing">${sessionBar(`第 ${run.set} 套`,`${tasks.length} 篇`)}
      <div class="ex-tabs" role="tablist">${tasks.map((item,i) => `<button type="button" role="tab" class="ex-tab" data-exam="task" data-index="${i}" aria-selected="${i === (run.task || 0)}"><b>${i+1}</b>${{melding:'短消息',bilde:'看图写',tema:'熟悉话题'}[item.kind] || ''}<small>${countWords(run.drafts[item.id] || '')} 词</small></button>`).join('')}</div>
      <div class="ex-write">
        <div class="ex-task"><p class="ex-question" lang="nb">${nl(task.prompt?.nb)}</p>${ui.zh ? `<p class="ex-zh">${nl(task.prompt?.zh)}</p>` : ''}${(task.bullets || []).length ? `<ul class="ex-bullets" lang="nb">${task.bullets.map(item => `<li>${e(item.nb)}${ui.zh ? `<small>${e(item.zh)}</small>` : ''}</li>`).join('')}</ul>` : ''}<button type="button" class="ex-text-button" data-exam="zh">${ui.zh ? '收起中文' : '看中文提示'}</button>${task.art ? sceneMarkup(task.art) : ''}</div>
        <div class="ex-editor"><label class="sr-only" for="ex-text">你的回答</label><textarea id="ex-text" lang="nb" spellcheck="false" autocapitalize="sentences" placeholder="Skriv her …" data-task="${e(task.id)}">${e(text)}</textarea>
          <div class="ex-editor-foot"><div class="ex-letters">${['æ','ø','å','é'].map(letter => `<button type="button" data-exam="letter" data-letter="${letter}" aria-label="输入 ${letter}">${letter}</button>`).join('')}</div><span class="ex-wordcount${words >= low ? ' is-enough' : ''}" data-exam-words>${words} 词 · 建议 ${goal}</span></div>
        </div>
      </div>
      <div class="ex-foot"><button type="button" class="ex-primary" data-exam="submit-writing">交卷</button></div>${confirmMarkup()}</section>`;
  }
  function sceneMarkup(artInfo) {
    const ready = artReady(artInfo.id);
    return `<figure class="ex-picture${ready ? '' : ' is-stand-in'}" data-art="${e(artInfo.id)}">${ready ? `<img src="${artURL(artInfo.id)}" alt="考试场景图">` : `<figcaption>插图待画：${e(artInfo.brief || '')}</figcaption>`}</figure>`;
  }
  function insertLetter(letter) {
    const field = root?.querySelector('#ex-text');
    if (!field) return;
    const start = field.selectionStart ?? field.value.length, end = field.selectionEnd ?? start;
    field.setRangeText?.(letter,start,end,'end');
    if (!field.setRangeText) field.value = field.value.slice(0,start)+letter+field.value.slice(end);
    field.focus();
    field.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function submitWriting(timeUpNow = false) {
    const run = active(), tasks = bank().sets.get(run.set) || [];
    if (!timeUpNow) {
      const short = tasks.filter(task => countWords(run.drafts[task.id] || '') < (task.words?.[0] || 0));
      ui.confirm = {title:'交卷吗？',text:short.length ? `第 ${short.map(task => tasks.indexOf(task)+1).join('、')} 篇还没到建议字数。交卷后由 AI 评分，不能再改。` : '交卷后由 AI 评分，不能再改。',actions:[['confirm-submit','交卷',true],['confirm-close','再写写']]};
      render(); return;
    }
    gradeWriting();
  }
  async function gradeWriting(record = null) {
    const run = active();
    stopClock();
    if (!record) {
      record = {id:`exam-writing-${Date.now().toString(36)}`,part:'writing',set:run.set,finishedAt:new Date().toISOString(),drafts:{...run.drafts},status:'pending'};
      store.history.unshift(record);
      store.sets.writing = [...new Set([...(store.sets.writing || []),run.set])];
      delete store.active.writing;
      save();
    }
    await gradeRecord(record,{part:'write',set:record.set,answers:record.drafts});
  }
  // Writing and speaking go to the AI through the community API; a record waits as 等待评分 until it succeeds.
  // One request per record: a second tap while it is out only shows the waiting screen.
  async function gradeRecord(record,body) {
    if (grading.has(record.id)) { screen = 'grading'; render(); return; }
    grading.add(record.id);
    screen = 'grading'; ui.grading = true; ui.error = ''; render();
    // The page may be left and opened again meanwhile (the store is read anew): the answer goes to the stored record.
    const stored = () => store.history.find(item => item.id === record.id) || record;
    try {
      const reply = await deps.request('/ai/grade',{method:'POST',body,timeout:150000});
      const target = stored();
      Object.assign(target,{status:'graded',level:reply.level,ai:reply});
      save();
      // XP: each task counts as five items, all right at A2, two at A1 (docs/community-deployment.md).
      const tasks = reply.tasks || [], count = level => tasks.filter(task => task.communication === level).length;
      award(target,(target.part === 'writing' ? 3 : 4)*5,5*count('A2')+2*count('A1'));
      grading.delete(record.id); ui.grading = grading.size > 0;
      graded(target);
    } catch (error) {
      grading.delete(record.id); ui.grading = grading.size > 0;
      if (root && screen === 'grading') ui.error = error?.code === 'ai_quota' ? '今天的 AI 点评次数用完了，明天再来评分。答案已经保存。' : error?.code === 'ai_unavailable' ? 'AI 评分暂时没有开启，答案已经保存，之后可以再评。' : '评分没有成功，答案已经保存。检查网络后点「重新评分」。';
      graded(stored());
    }
  }
  // The result opens only where it was waited for; elsewhere the home and intro pages show its new state.
  function graded(record) {
    if (!root) return;
    if (screen === 'grading') showResult(record);
    else if (screen === 'hub' || screen === 'intro') render();
  }
  function gradingMarkup() {
    return `<section class="ex-app ex-grading" role="status" aria-live="polite"><div class="ex-grading-card"><span class="ex-spinner" aria-hidden="true"></span><h2>AI 正在评分</h2><p>按 Norskprøven A1–A2 的评分标准逐项看，通常要半分钟左右，请不要关闭页面。</p></div></section>`;
  }

  /* ----- results ----- */
  let shown = null;
  function showResult(record) { shown = record; screen = 'result'; stopSound(); render('.ex-result h2'); }
  function resultMarkup() {
    const record = shown;
    if (!record) return hubMarkup();
    const part = PARTS[record.part];
    const head = record.status === 'pending'
      ? `<div class="ex-result-head"><span class="ex-level is-pending">待评分</span><div><h2 tabindex="-1">${part.title} · 答案已保存</h2>${ui.error ? `<p class="ex-error">${e(ui.error)}</p>` : ''}</div><button type="button" class="ex-primary" data-exam="regrade" data-id="${e(record.id)}">重新评分</button></div>`
      : `<div class="ex-result-head"><span class="ex-level is-big is-${e(record.level)}">${e(LEVEL_TEXT[record.level])}</span><div><p class="ex-kicker">估计等级 · ${part.title}</p><h2 tabindex="-1">${resultLine(record)}</h2><p class="ex-fineprint">${record.ai ? 'AI 按官方评分标准评分，只供参考。' : '按答对的 A1 题和 A2 题估计，只供参考，不是官方成绩。'}</p></div></div>`;
    // Listening and reading keep their answers as a list; writing and speaking as texts by task.
    const body = Array.isArray(record.answers) ? objectiveReview(record) : record.ai ? aiReview(record) : draftsReview(record);
    return `<section class="ex-app ex-result"><div class="ex-result-top"><button type="button" class="ex-quiet" data-exam="hub">${icon('close')}返回</button></div>${head}${body}<div class="ex-foot"><button type="button" class="ex-primary" data-exam="part" data-part="${record.part}">再考一次</button></div></section>`;
  }
  function resultLine(record) {
    if (record.by) {
      const [r1,t1] = record.by.A1, [r2,t2] = record.by.A2;
      return `A1 题答对 ${r1} / ${t1}${t2 ? ` · A2 题答对 ${r2} / ${t2}` : ''}`;
    }
    return {A2:'达到 A2 了','A1':'达到 A1','under-A1':'还没到 A1'}[record.level] || '';
  }
  function optionText(item,group,value) {
    if (value === undefined || value === null || value === '') return '没有作答';
    const type = item.type === 'shared' ? 'choice' : item.type;
    if (type === 'picture') return `图 ${'ABCD'[Number(value)]}`;
    if (type === 'click') return (item.art?.hotspots || []).find(spot => spot.id === String(value))?.label || value;
    if (type === 'calendar') { const [y,m,d] = String(value).split('-').map(Number); return d ? `${d}. ${MONTHS[m-1]}` : `${MONTHS[m-1]} ${y}`; }
    if (type === 'word') return String(value);
    return optionsOf(item,group)[Number(value)]?.nb || '';
  }
  function objectiveReview(record) {
    const rows = record.answers.map((answer,i) => {
      const item = itemOf(answer.id);
      if (!item) return '';
      const group = item.group ? bank().groups.get(item.group) : null, text = item.text || group?.text;
      const script = item.audio?.script || [];
      return `<details class="ex-review${answer.correct ? ' is-right' : ' is-wrong'}"><summary><span class="ex-review-mark">${icon(answer.correct ? 'check' : 'cross')}</span><span class="ex-review-no">${i+1}</span><span class="ex-review-q" lang="nb">${e(questionOf(item,group).nb)}</span>${levelChip(item.level,' is-small')}</summary>
        <div class="ex-review-body"><p class="ex-zh">${e(questionOf(item,group).zh)}</p>
        <p>你的答案：<b lang="nb">${e(optionText(item,group,answer.value))}</b>${answer.correct ? '' : ` · 正确答案：<b lang="nb">${e(optionText(item,group,item.answer))}</b>`}</p>
        ${item.explain ? `<p class="ex-explain">${e(item.explain)}</p>` : ''}
        ${script.length ? `<div class="ex-script">${record.part === 'listening' ? `<button type="button" class="ex-text-button" data-exam="review-play" data-id="${e(item.id)}">${icon('sound')}再听一遍</button>` : ''}${script.map(line => `<p><b>${e(line.who)}</b><span lang="nb">${e(line.nb)}</span><small>${e(line.zh)}</small></p>`).join('')}</div>` : ''}
        ${text ? `<div class="ex-script"><p><span lang="nb">${nl(text.nb)}</span><small>${nl(text.zh)}</small></p></div>` : ''}</div></details>`;
    }).join('');
    return `<div class="ex-review-list">${rows}</div>`;
  }
  function aiReview(record) {
    const ai = record.ai, tasks = (banks[record.part]?.sets.get(record.set)) || [];
    const names = {structure:'结构',spelling:'拼写和标点',vocabulary:'词汇',grammar:'语法',fluency:'流利度'};
    const criteria = Object.entries(ai.criteria || {}).map(([key,item]) => `<div class="ex-criterion"><span>${names[key] || key}</span>${levelChip(item.level,' is-small')}<p>${e(item.comment)}</p></div>`).join('');
    const taskRows = (ai.tasks || []).map((item,i) => {
      const task = tasks.find(t => t.id === item.id), mine = record.drafts?.[item.id] ?? record.answers?.[item.id] ?? '';
      const better = item.corrected || item.better;
      const same = better && fold(better) === fold(mine);
      return `<article class="ex-ai-task"><header><b>${i+1}</b><span>${e({melding:'短消息',bilde:'看图',tema:'熟悉话题',presentasjon:'介绍自己',samtale:'交换信息'}[task?.kind] || '')}</span>${levelChip(item.communication,' is-small')}</header><p>${e(item.comment)}</p>${mine ? `<div class="ex-compare"><div><small>你写的</small><p lang="nb">${nl(mine)}</p></div>${better && !same ? `<div><small>${record.part === 'writing' ? '改正后' : '更好的说法'}</small><p lang="nb">${nl(better)}</p></div>` : ''}</div>${same ? '<p class="ex-fineprint">这一篇没有要改的地方。</p>' : ''}` : better ? `<div class="ex-compare"><div><small>更好的说法</small><p lang="nb">${nl(better)}</p></div></div>` : ''}</article>`;
    }).join('');
    const mistakes = (ai.mistakes || []).map(item => `<li><s lang="nb">${e(item.wrong)}</s><span lang="nb">${e(item.right)}</span><small>${e(item.why)}</small></li>`).join('');
    return `<div class="ex-ai">${ai.summary ? `<p class="ex-ai-summary">${e(ai.summary)}</p>` : ''}<div class="ex-criteria">${criteria}${ai.pronunciation === false ? '<div class="ex-criterion"><span>发音</span><span class="ex-level is-small is-none">不评</span><p>只发送识别出的文字，所以发音没有评分。</p></div>' : ''}</div>${taskRows}${mistakes ? `<h3>主要错误</h3><ul class="ex-mistakes">${mistakes}</ul>` : ''}${ai.next ? `<p class="ex-ai-next"><b>下一步</b>${e(String(ai.next).replace(/^下一步[：:，,\s]*/,''))}</p>` : ''}</div>`;
  }
  function draftsReview(record) {
    const items = Object.entries(record.drafts || record.answers || {}).filter(([,text]) => text);
    return items.length ? `<div class="ex-ai">${items.map(([id,text]) => `<article class="ex-ai-task"><header><b>${e(id)}</b></header><p lang="nb">${nl(text)}</p></article>`).join('')}</div>` : '';
  }

  /* ----- events ----- */
  async function openPart(key) {
    stopSound(); stopClock();
    partKey = key; ui.error = ''; ui.confirm = null; intro.set = null;
    screen = 'intro'; render('#ex-intro-title');
    // Whether the server writes speech down is asked now, while the intro is read.
    if (key === 'speaking') { import(`./dictation.mjs${suffix}`).then(module => module.load().then(() => module.serverASR(deps.request))).catch(() => {}); return; }
    try { await loadPart(key); }
    catch { ui.error = '题目暂时无法载入，请检查网络后重试。'; render(); }
  }
  // 开始/继续 run once, and only while their intro is still on screen when the questions have loaded.
  async function begin(resume) {
    if (starting) return;
    starting = true;
    try { await beginPart(resume); } finally { starting = false; }
  }
  const stillOn = key => root && partKey === key && screen === 'intro';
  async function beginPart(resume) {
    const key = partKey;
    try { await loadPart(key); } catch { if (stillOn(key)) { ui.error = '题目暂时无法载入，请检查网络后重试。'; render(); } return; }
    if (!stillOn(key)) return;
    stopSound();
    if (key === 'speaking') { await openOral(resume); return; }
    if (!resume || !active()) {
      if (partKey === 'writing') {
        store.active.writing = {part:'writing',set:intro.set || 1,startedAt:new Date().toISOString(),drafts:{},task:0,remaining:WRITING_MS,since:null};
        save();
      } else startObjective();
    }
    screen = 'session'; render(partKey === 'writing' ? '#ex-text' : '.ex-question');
    startClock();
    if (partKey === 'listening') playCurrent();
  }
  async function openOral(resume) {
    try {
      const module = await import(`./exam-oral.mjs${suffix}`);
      const tasks = (await loadPart('speaking')).sets;
      if (!stillOn('speaking')) return;
      if (!resume || !store.active.speaking) { store.active.speaking = {part:'speaking',set:intro.set || 1,task:0,step:0,answers:{},metrics:{},conversation:[],startedAt:new Date().toISOString()}; save(); }
      oral = module.createOral({root,deps,store,save,tasks,artReady,artURL,audioURL,icon,escape:e,quietOthers,
        exit:() => { oral?.close(); oral = null; screen = 'hub'; render('#ex-title'); },
        finished:run => { oral?.close(); oral = null; finishOral(run); }});
      screen = 'oral'; oral.start();
    } catch (error) {
      oral = null; screen = 'intro'; ui.error = error?.code === 'denied' ? '麦克风没有打开。请在浏览器设置里允许使用麦克风后再试。' : error?.code === 'none' ? '没有找到麦克风。' : error?.message === 'unsupported' ? '这个浏览器用不了语音识别，请换新版 Chrome、Edge 或 Safari。' : '口语考试暂时无法开始，请检查网络后重试。';
      render();
    }
  }
  function finishOral(run) {
    const record = {id:`exam-speaking-${Date.now().toString(36)}`,part:'speaking',set:run.set,finishedAt:new Date().toISOString(),answers:{...run.answers},metrics:{...run.metrics},conversation:[...(run.conversation || [])],status:'pending'};
    store.history.unshift(record);
    store.sets.speaking = [...new Set([...(store.sets.speaking || []),run.set])];
    delete store.active.speaking;
    save();
    gradeRecord(record,{part:'speak',set:record.set,answers:record.answers,metrics:record.metrics,conversation:record.conversation});
  }
  function exitSession() {
    stopSound(); stopClock(); save();
    ui.confirm = null; screen = 'hub'; render('#ex-title');
  }
  function onClick(event) {
    const target = event.target.closest?.('[data-exam]');
    if (!target || !root?.contains(target)) return;
    const action = target.dataset.exam, run = active();
    if (action === 'part') { openPart(target.dataset.part); return; }
    if (action === 'interview') { deps.openInterview?.(); return; }
    if (action === 'hub') { stopSound(); stopClock(); screen = 'hub'; ui.error = ''; render('#ex-title'); return; }
    if (action === 'set') { intro.set = Number(target.dataset.set); render(); return; }
    if (action === 'soundcheck') { stopSound(); const run2 = ++audioRun; playOnce(audioURL('sound-check'),run2); return; }
    if (action === 'start') { begin(false); return; }
    if (action === 'resume') { begin(true); return; }
    if (action === 'restart') {
      ui.confirm = {title:'重新开始吗？',text:'这次的进度和已经写好的内容会清掉，不能恢复。',actions:[['confirm-restart','重新开始',true],['confirm-close','取消']]};
      render(); return;
    }
    if (action === 'confirm-restart') { ui.confirm = null; delete store.active[partKey]; save(); render(); return; }
    if (action === 'exit') { exitSession(); return; }
    if (action === 'replay') { playCurrent(); return; }
    if (action === 'answer' && run && screen === 'session') {
      const id = currentId();
      run.answers[id] = target.dataset.value;
      save();
      if (partKey === 'listening') {
        for (const node of root.querySelectorAll('[data-exam="answer"]')) node.classList.toggle('is-chosen',node === target);
        const next = root.querySelector('[data-exam="next"]');
        if (next) next.disabled = false;
      } else render();
      return;
    }
    if (action === 'next' && run) {
      if (partKey === 'reading') { if (run.index < currentIds().length-1) { run.index += 1; save(); render('.ex-question'); } return; }
      advance(); return;
    }
    if (action === 'prev' && run && run.index > 0) { run.index -= 1; save(); render('.ex-question'); return; }
    if (action === 'goto' && run) { run.index = Number(target.dataset.index) || 0; save(); render('.ex-question'); return; }
    if (action === 'section-end' && run) {
      const open = currentIds().filter(id => run.answers[id] === undefined).length;
      ui.confirm = {title:run.section < 2 ? '进入下一部分？' : '交卷吗？',text:`${open ? `还有 ${open} 题没答。` : ''}${run.section < 2 ? '进入下一部分后不能再回来修改。' : '交卷后就看成绩了。'}`,actions:[['confirm-section',run.section < 2 ? '进入下一部分' : '交卷',true],['confirm-close','再看看']]};
      render(); return;
    }
    if (action === 'confirm-section') { ui.confirm = null; nextSection(); return; }
    if (action === 'confirm-close') { ui.confirm = null; render(); return; }
    if (action === 'confirm-submit') { ui.confirm = null; submitWriting(true); return; }
    if (action === 'task' && run) { run.task = Number(target.dataset.index) || 0; save(); render('#ex-text'); return; }
    if (action === 'zh') { ui.zh = !ui.zh; render(); return; }
    if (action === 'letter') { insertLetter(target.dataset.letter); return; }
    if (action === 'submit-writing') { submitWriting(false); return; }
    if (action === 'regrade') {
      const record = store.history.find(item => item.id === target.dataset.id);
      if (!['writing','speaking'].includes(record?.part)) return;
      if (grading.has(record.id)) { screen = 'grading'; render(); return; }
      // The waiting screen comes at once (a second tap meets it); the tasks load for the result page first.
      grading.add(record.id); screen = 'grading'; ui.error = ''; render();
      loadPart(record.part).then(() => {
        grading.delete(record.id);
        if (record.part === 'writing') gradeWriting(record);
        else gradeRecord(record,{part:'speak',set:record.set,answers:record.answers,metrics:record.metrics,conversation:record.conversation});
      }).catch(() => {
        grading.delete(record.id);
        if (root && screen === 'grading') { ui.error = '题目暂时无法载入，请检查网络后重试。'; showResult(record); }
      });
      return;
    }
    if (action === 'show-result') {
      const record = store.history.find(item => item.id === target.dataset.id);
      if (record) loadPart(record.part).then(() => showResult(record)).catch(() => { ui.error = '结果暂时无法打开，请检查网络后重试。'; render(); });
      return;
    }
    if (action === 'review-play') { stopSound(); const run2 = ++audioRun; playOnce(audioURL(target.dataset.id),run2); return; }
  }
  function onInput(event) {
    const field = event.target;
    if (field?.id !== 'ex-text') return;
    const run = active();
    if (!run) return;
    run.drafts[field.dataset.task] = field.value;
    clearTimeout(onInput.timer);
    onInput.timer = setTimeout(save,500);
    const tasks = bank().sets.get(run.set) || [], task = tasks.find(item => item.id === field.dataset.task);
    const words = countWords(field.value), counter = root.querySelector('[data-exam-words]'), [low,high] = task?.words || [];
    if (counter) { counter.textContent = `${words} 词 · 建议 ${high ? `${low}–${high} 词` : `${low} 词以上`}`; counter.classList.toggle('is-enough',words >= (low || 0)); }
    const tab = root.querySelector(`[data-exam="task"][data-index="${tasks.indexOf(task)}"] small`);
    if (tab) tab.textContent = `${words} 词`;
  }
  function onKey(event) {
    if (screen !== 'session' || partKey === 'writing' || event.target.closest?.('input,textarea')) return;
    const key = event.key.toUpperCase(), index = 'ABCD'.indexOf(key);
    if (index >= 0 && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) root.querySelector(`[data-exam="answer"][data-value="${index}"]`)?.click();
  }
  function visibility() {
    if (screen !== 'session' && screen !== 'oral') return;
    if (document.hidden) { stopSound(); stopClock(); oral?.pause?.(); save(); }
    else if (screen === 'session') { startClock(); if (partKey === 'listening') playCurrent(); }
  }

  return {
    mount(element) {
      if (root) this.unmount();
      root = element;
      root.addEventListener('click',onClick); root.addEventListener('input',onInput); root.addEventListener('keydown',onKey);
      document.addEventListener('visibilitychange',visibility);
      store = read();
      // Back on the page: a test under way waits behind its intro (继续), with its clock stopped.
      if (screen === 'session' || screen === 'oral' || screen === 'grading') screen = partKey ? 'intro' : 'hub';
      render(screen === 'hub' ? '#ex-title' : '');
    },
    unmount() {
      stopSound(); stopClock(); oral?.close(); oral = null;
      document.body?.classList.remove('practice-focus');
      if (!root) return;
      root.removeEventListener('click',onClick); root.removeEventListener('input',onInput); root.removeEventListener('keydown',onKey);
      document.removeEventListener('visibilitychange',visibility);
      root = null;
    },
    stopAudio() { if (silencing) return; stopSound(); oral?.stopAudio?.(); },
    // The interview's picker closes back onto this page.
    focusInterview() { root?.querySelector('[data-exam="interview"]')?.focus?.({preventScroll:true}); }
  };
}
