/* 考试与面试 · 课本模拟考 (docs/exam-bank-format.md「课本模拟考卷」, docs/exam-interview-plan.md「课本模拟考」):
   the God i Norsk course's A1 and A2 exams as the teacher's papers lay them out — a Norwegian task line for each
   part, its points, then the numbered items (pick a word, a or b, write the form, match, answer questions on a text,
   listen twice, write a few sentences). Opened by exam.mjs; the parts can be turned back and forth and changed until
   the paper is handed in, and a paper left halfway waits behind 继续. Objective items are marked on the device; the
   writing and any short reading answer the key words did not recognise go to the site's AI once
   (scripts/exam_ai.py, part 'paper'). Results stay on the device and earn XP as activity 'exam-paper'.
   The pure parts (marking, points) are exported for scripts/check_exam_paper.mjs. */

const suffix = typeof import.meta === 'object' && import.meta.url ? new URL(import.meta.url).search : '';
export const PAPER_STORE = 'norsk-exam-paper-v1';
export const PAPER_SETS = [1,2,3];
export const PAPER_ACTIVITY = 'exam-paper';
export const PAPER_LEVELS = {
  A1:{chapters:'课本第 1–6 章',meta:'10 个部分 · 满分 100'},
  A2:{chapters:'课本第 7–11 章',meta:'9 个部分 · 满分 100，另有附加分 10'}
};
export const MAX_PLAYS = 2;
const TYPED = new Set(['fill','open','write']);

/* ---------- Pure helpers (scripts/check_exam_paper.mjs) ---------- */

/** An answer as it is compared: case, spaces, quotes, sentence-final stops and a leading «kl.» do not count; : = . */
export function foldAnswer(text) {
  return String(text ?? '').normalize('NFC').toLocaleLowerCase('nb')
    .replace(/[éèê]/g,'e').replace(/[’'`´]/g,'').replace(/:/g,'.')
    .replace(/[«»"“”!?,;()]+/g,' ').replace(/\.(?=\s|$)/g,' ').replace(/\s+/g,' ').trim()
    .replace(/^(?:kl|klokka|klokken)\.?\s+(?=\d)/,'');
}
const wordsOf = text => foldAnswer(text).replace(/[^\p{L}\p{N} ]+/gu,' ').replace(/\s+/g,' ').trim();
/** Key words of a reading question: every group needs one of its words. A word matches on word starts (nabo →
    naboen); a number written in digits, or a key marked «=» (=tre), only as a whole word, so 3 never passes for 30. */
export function matchesKeys(keys,text) {
  const said = ` ${wordsOf(text)} `;
  if (!said.trim() || !Array.isArray(keys) || !keys.length) return false;
  return keys.every(group => group.some(key => {
    const whole = String(key).startsWith('=') || /^\d+$/.test(String(key)), word = wordsOf(String(key).replace(/^=/,''));
    return word && said.includes(whole ? ` ${word} ` : ` ${word}`);
  }));
}
// Endings a word of the answer may add to a word of the model answer (naboen for nabo, mandagene for mandag).
const ENDINGS = new Set(['e','r','n','t','a','s','en','et','er','ne','ene','ar','ane']);
/** A short answer that says nothing beyond the model answer and has its key words: right without asking the AI
    («Spania», «Fra Spania», «mandag og onsdag»). Every word must come from the model answer (or its listed
    alternatives): a negation, another number, another unit or another verb sends the answer to the AI instead. */
export function sureAnswer(item,text) {
  const said = wordsOf(text).split(' ').filter(Boolean);
  const model = wordsOf([item.model,...(item.accept || [])].join(' ')).split(' ').filter(Boolean);
  const fits = word => model.some(known => known === word || (!/\d/.test(word + known) && word.length >= 3
    && (known.startsWith(word) || (word.startsWith(known) && ENDINGS.has(word.slice(known.length))))));
  return said.length > 0 && said.every(fits) && matchesKeys(item.keys,text);
}
export function itemPoints(section,item) {
  return Number.isFinite(item.points) ? item.points : section.points/section.items.length;
}
const filled = value => value !== undefined && value !== null && String(value).trim() !== '';
/** true / false for an objective item; null where meaning has to be judged: writing (the AI gives its points) and a
    reading answer that is not plainly the model answer (the AI reads it; until then it waits as 待评). */
export function checkItem(section,item,value) {
  if (section.kind === 'write') return null;
  if (!filled(value)) return false;
  if (section.kind === 'open') return sureAnswer(item,value) ? true : null;
  if (section.kind === 'ab' || section.kind === 'listen') return Number(value) === Number(item.answer);
  if (section.kind === 'match') return String(value) === String(item.answer);
  if (section.kind === 'pick') return foldAnswer(value) === foldAnswer(item.answer);
  if (section.kind === 'fill') return (item.answers || []).some(answer => foldAnswer(answer) === foldAnswer(value));
  return false;
}
export const countSentences = text => String(text || '').split(/[.!?]+(?=\s|$)/).filter(part => /\p{L}/u.test(part)).length;
const round = value => Math.round(value*10)/10;
/** Points of a paper from its answers and, once graded, the AI's reply ({write:[{id,points}], open:[{id,ok}]}). */
export function scorePaper(paper,answers = {},ai = null) {
  const written = new Map((ai?.write || []).map(entry => [entry.id,entry])), opened = new Map((ai?.open || []).map(entry => [entry.id,entry]));
  const out = {total:0,max:0,bonus:0,bonusMax:0,right:0,count:0,waiting:0,sections:[]};
  for (const section of paper.sections) {
    let got = 0, max = 0;
    const items = section.items.map(item => {
      const points = itemPoints(section,item), value = answers[item.id];
      let correct = checkItem(section,item,value), earned = 0, by = 'key';
      if (section.kind === 'write') {
        const graded = written.get(item.id);
        if (!filled(value)) correct = false;
        else if (graded) { earned = Math.max(0,Math.min(points,Number(graded.points) || 0)); correct = earned >= points/2; by = 'ai'; }
        else { correct = null; out.waiting += 1; }
      } else {
        if (correct === null) {
          // A reading answer the AI was asked about: its verdict; when it said nothing about this one, the key
          // words decide; before any reply, the answer waits.
          const said = opened.get(item.id);
          if (said && typeof said.ok === 'boolean') { correct = said.ok; by = 'ai'; }
          else if (ai) correct = matchesKeys(item.keys,value);
          else out.waiting += 1;
        }
        earned = correct ? points : 0;
      }
      got += earned; max += points; out.count += 1;
      if (correct) out.right += 1;
      return {id:item.id,points,earned,correct,by};
    });
    if (section.bonus) { out.bonus += got; out.bonusMax += max; } else { out.total += got; out.max += max; }
    out.sections.push({id:section.id,got:round(got),max:round(max),bonus:Boolean(section.bonus),items});
  }
  for (const key of ['total','max','bonus','bonusMax']) out[key] = round(out[key]);
  return out;
}
/** What the AI is asked about: written answers, and reading answers that are not plainly the model answer. */
export function aiRequest(paper,answers = {}) {
  const write = {}, open = {};
  for (const section of paper.sections) for (const item of section.items) {
    const value = answers[item.id];
    if (!filled(value)) continue;
    if (section.kind === 'write') write[item.id] = String(value);
    if (section.kind === 'open' && checkItem(section,item,value) === null) open[item.id] = String(value);
  }
  return Object.keys(write).length || Object.keys(open).length ? {part:'paper',paper:paper.id,answers:write,open} : null;
}
export function readPaperStore() {
  try { const value = JSON.parse(localStorage.getItem(PAPER_STORE) || 'null'); if (value?.version === 1) return value; } catch {}
  return {version:1,active:{},history:[],sets:{}};
}

/* ---------- The paper ---------- */

export function createPaper(ctx) {
  const {deps,icon,escape:e,quietOthers,exit} = ctx;
  // The page element can change between visits to 更多: it is taken anew whenever the paper attaches.
  let root = ctx.root;
  const v = deps.version ? `?v=${encodeURIComponent(deps.version)}` : '';
  const nl = text => e(text).replace(/\n/g,'<br>');
  let store = readPaperStore(), level = 'A1', view = 'intro', papers = new Map(), loading = new Map(), shown = null;
  let audio = null, audioRun = 0, playing = null, lastField = null, attached = false, starting = false, saveTimer = null;
  const ui = {zh:false,confirm:null,error:'',set:null,notice:''};
  const grading = new Set();

  function save() { clearTimeout(saveTimer); saveTimer = null; try { localStorage.setItem(PAPER_STORE,JSON.stringify(store)); } catch {} }
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save,400); }
  const run = () => store.active[level] || null;
  const paperId = (lvl,set) => `${lvl}-${set}`;
  const lastOf = lvl => store.history.filter(record => record.level === lvl).sort((a,b) => b.finishedAt.localeCompare(a.finishedAt))[0] || null;
  function load(id) {
    if (papers.has(id)) return Promise.resolve(papers.get(id));
    if (!loading.has(id)) loading.set(id,fetch(`data/exam/paper-${id}.json${v}`).then(response => { if (!response.ok) throw new Error('missing'); return response.json(); })
      .then(data => { papers.set(id,data); loading.delete(id); return data; }).catch(error => { loading.delete(id); throw error; }));
    return loading.get(id);
  }
  const current = () => papers.get(run()?.paper);
  const clipURL = id => `audio/exam/${id}.mp3${v}`;
  const dateText = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getMonth()+1} 月 ${d.getDate()} 日`; };
  const pts = value => `${round(value)}`.replace(/\.0$/,'');

  /* ----- rendering ----- */
  function render(focus = '') {
    if (!root || !attached) return;
    document.body?.classList.toggle('practice-focus',view === 'session' || view === 'grading');
    root.innerHTML = view === 'session' ? sessionMarkup() : view === 'grading' ? gradingMarkup() : view === 'result' ? resultMarkup() : introMarkup();
    if (focus) root.querySelector(focus)?.focus?.({preventScroll:true});
  }
  function confirmMarkup() {
    const c = ui.confirm;
    if (!c) return '';
    return `<div class="ex-confirm" role="dialog" aria-modal="true" aria-labelledby="xp-confirm-title"><div class="ex-confirm-card"><h3 id="xp-confirm-title">${e(c.title)}</h3><p>${e(c.text)}</p><div class="ex-confirm-actions">${c.actions.map(([action,label,primary]) => `<button type="button" class="${primary ? 'ex-primary' : 'ex-quiet'}" data-paper="${action}">${label}</button>`).join('')}</div></div></div>`;
  }

  /* intro */
  const RULES = [
    '整张卷子用挪威语出题，和课程考试的卷面一样。看不懂要求时，点「中文」看提示。',
    '各部分可以来回翻看、随时修改。中途退出会自动保存，回来接着做。',
    `听力部分的录音最多放 ${MAX_PLAYS} 遍，请先戴好耳机。`,
    '交卷后马上出分，每题都能看答案和讲解；写作和阅读问答由 AI 看意思、按卷面的评分说明给分。'
  ];
  function introMarkup() {
    const active = run(), done = store.sets[level] || [];
    const chosen = active?.set || ui.set || PAPER_SETS.find(n => !done.includes(n)) || 1;
    ui.set = chosen;
    const info = PAPER_LEVELS[level];
    return `<section class="ex-app ex-intro xp-intro" aria-labelledby="xp-intro-title">
      <div class="ex-intro-card">
        <button type="button" class="ex-close" data-paper="exit" aria-label="返回考试与面试">${icon('close')}</button>
        <span class="ex-part-icon is-large is-paper">${icon('paper')}</span>
        <p class="ex-kicker" lang="nb">GOD I NORSK · PRØVEEKSAMEN</p>
        <h2 id="xp-intro-title" tabindex="-1">${level} 模拟考试</h2>
        <p class="ex-intro-meta">${e(info.chapters)} · ${e(info.meta)}</p>
        <ul class="ex-rules">${RULES.map(rule => `<li>${rule}</li>`).join('')}</ul>
        <div class="ex-sets" role="group" aria-label="选择一套题">${PAPER_SETS.map(n => `<button type="button" class="ex-set" data-paper="set" data-set="${n}" aria-pressed="${n === chosen}"${active && active.set !== n ? ' disabled' : ''}>第 ${n} 套${done.includes(n) ? '<small>做过</small>' : ''}</button>`).join('')}</div>
        ${lastRow()}
        ${ui.error ? `<p class="ex-error" role="alert">${e(ui.error)}</p>` : ''}
        <div class="ex-intro-actions">${active ? `<button type="button" class="ex-primary" data-paper="resume">继续 · ${e(progressText(active))}</button><button type="button" class="ex-quiet" data-paper="restart">重新开始</button>` : `<button type="button" class="ex-primary" data-paper="start">开始</button>`}</div>
      </div>${confirmMarkup()}
    </section>`;
  }
  const progressText = active => `第 ${active.set} 套 · 第 ${(active.section || 0)+1} 部分`;
  function lastRow() {
    const last = lastOf(level);
    if (!last) return '';
    const score = last.score;
    return last.status === 'pending'
      ? `<div class="ex-last is-pending"><span>上次第 ${last.set} 套 ${score ? `${pts(score.total)} 分，` : ''}还有题等 AI 评分 · ${e(dateText(last.finishedAt))}</span><button type="button" class="ex-text-button" data-paper="show-result" data-id="${e(last.id)}">查看结果</button></div>`
      : `<div class="ex-last"><span>上次第 ${last.set} 套 <b class="xp-last-score">${pts(score?.total || 0)} 分</b> ${e(dateText(last.finishedAt))}</span><button type="button" class="ex-text-button" data-paper="show-result" data-id="${e(last.id)}">查看结果</button></div>`;
  }

  /* session */
  function sectionDone(section,answers) { return section.items.every(item => filled(answers[item.id])); }
  function sessionMarkup() {
    const active = run(), paper = current();
    if (!active || !paper) return `<section class="ex-app"><p class="ex-error">这套题暂时无法显示。</p><button type="button" class="ex-primary" data-paper="exit">返回</button></section>`;
    const index = Math.min(active.section || 0,paper.sections.length-1), section = paper.sections[index], last = index === paper.sections.length-1;
    const steps = paper.sections.map((item,i) => `<button type="button" class="xp-step${i === index ? ' is-current' : ''}${sectionDone(item,active.answers) ? ' is-done' : ''}" data-paper="goto" data-index="${i}" aria-label="第 ${i+1} 部分 ${e(item.title.nb)}${sectionDone(item,active.answers) ? '，已答完' : ''}"${i === index ? ' aria-current="step"' : ''}>${i+1}</button>`).join('');
    return `<section class="ex-app ex-session xp-session">
      <div class="ex-bar"><button type="button" class="ex-exit" data-paper="leave" aria-label="退出，进度会保存">${icon('close')}<span>退出</span></button><div class="ex-bar-meta"><strong>${level} · 第 ${active.set} 套</strong><span>第 ${index+1} 部分，共 ${paper.sections.length} 部分</span></div><button type="button" class="xp-hand-in" data-paper="hand-in">交卷</button></div>
      <nav class="xp-steps" aria-label="各部分">${steps}</nav>
      <article class="xp-sheet" aria-labelledby="xp-sec-title">
        <header class="xp-sec-head"><h2 id="xp-sec-title" tabindex="-1"><span class="xp-sec-no">${index+1}.</span><span lang="nb">${e(section.title.nb)}</span></h2><span class="xp-points" lang="nb">${pts(section.points)} poeng${section.bonus ? ' · tillegg' : ''}</span></header>
        <div class="xp-task"><p lang="nb">${e(section.task.nb)}</p><button type="button" class="xp-zh-toggle" data-paper="zh" aria-pressed="${ui.zh}">中文</button></div>
        ${ui.zh ? `<p class="xp-task-zh">${e(section.title.zh)}：${e(section.task.zh)}</p>` : ''}
        ${sectionTop(section,active)}
        <ol class="xp-items">${section.items.map((item,i) => itemMarkup(section,item,i,active)).join('')}</ol>
        ${TYPED.has(section.kind) ? `<div class="xp-keys" aria-label="挪威语字母">${['æ','ø','å','é'].map(letter => `<button type="button" data-paper="letter" data-letter="${letter}" aria-label="输入 ${letter}">${letter}</button>`).join('')}<span>点字母填进正在写的空</span></div>` : ''}
      </article>
      <div class="xp-nav"><button type="button" class="ex-quiet" data-paper="prev"${index === 0 ? ' disabled' : ''}>${icon('back')}上一部分</button>${last ? `<button type="button" class="ex-primary" data-paper="hand-in">交卷</button>` : `<button type="button" class="ex-primary" data-paper="next">下一部分${icon('arrow')}</button>`}</div>
      ${confirmMarkup()}
    </section>`;
  }
  function sectionTop(section,active) {
    if (section.kind === 'pick' && section.bank) {
      const used = new Set(section.once ? section.items.map(item => foldAnswer(active.answers[item.id])).filter(Boolean) : []);
      return `<ul class="xp-bank" aria-label="可选的词">${section.bank.map(word => `<li lang="nb" class="${used.has(foldAnswer(word)) ? 'is-used' : ''}">${e(word)}</li>`).join('')}</ul>`;
    }
    if (section.kind === 'match') return `<ul class="xp-defs">${section.bank.map(entry => `<li><b>${e(entry.key)}</b><span lang="nb">${e(entry.nb)}</span>${ui.zh ? `<small>${e(entry.zh)}</small>` : ''}</li>`).join('')}</ul>`;
    if (section.kind === 'open' && section.text) return `<div class="xp-passage" lang="nb"><p>${nl(section.text.nb)}</p></div>`;
    if (section.kind === 'listen') {
      const left = Math.max(0,MAX_PLAYS-(active.plays?.[section.id] || 0)), on = playing === section.id;
      return `<div class="xp-player${on ? ' is-playing' : ''}"><button type="button" class="xp-play" data-paper="play" aria-label="${on ? '停止播放' : '播放录音'}"${!left && !on ? ' disabled' : ''}>${icon(on ? 'stop' : 'play')}</button><div class="xp-player-text"><strong>${on ? '正在播放…' : left ? '播放录音' : '已经放完两遍'}</strong><span>${on ? '听完再作答也可以' : left ? `还能放 ${left} 遍` : '可以接着作答，交卷后能再听'}</span></div><span class="ex-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></div>${ui.notice ? `<p class="ex-error" role="alert">${e(ui.notice)}</p>` : ''}`;
    }
    return '';
  }
  // A sentence with its blank: the text before and after ___ (a blank at the end when the text has none).
  function splitBlank(text) {
    const at = String(text).indexOf('___');
    return at < 0 ? [String(text).replace(/\s*$/,' '),''] : [text.slice(0,at),text.slice(at+3)];
  }
  const startsSentence = before => !before.trim() || /[.!?]\s*$/.test(before);
  const capital = word => word.charAt(0).toLocaleUpperCase('nb')+word.slice(1);
  function itemMarkup(section,item,i,active) {
    const value = active.answers[item.id] ?? '', no = `<span class="xp-no">${i+1}.</span>`, label = `第 ${i+1} 题`;
    const points = Number.isFinite(item.points) ? `<span class="xp-item-points" lang="nb">${pts(item.points)} p</span>` : '';
    if (section.kind === 'pick') {
      const [before,after] = splitBlank(item.text), options = item.options || section.bank || [], upper = startsSentence(before);
      const select = `<select class="xp-blank" data-paper-field="${e(item.id)}" aria-label="${label}"><option value=""${value ? '' : ' selected'}></option>${options.map(word => `<option value="${e(word)}"${foldAnswer(word) === foldAnswer(value) ? ' selected' : ''}>${e(upper ? capital(word) : word)}</option>`).join('')}</select>`;
      return `<li class="xp-item">${no}<p class="xp-line" lang="nb">${e(before)}${select}${e(after)}${item.note ? ` <span class="xp-note">${e(item.note)}</span>` : ''}${item.options ? ` <span class="xp-note">(${item.options.map(e).join(' / ')})</span>` : ''}</p></li>`;
    }
    if (section.kind === 'fill') {
      // One width for the whole part: a blank's size must not give its answer away.
      const [before,after] = splitBlank(item.text), width = Math.max(6,...section.items.flatMap(entry => entry.answers || []).map(answer => answer.length+2));
      return `<li class="xp-item">${no}<p class="xp-line" lang="nb">${e(before)}<input class="xp-blank is-text" data-paper-field="${e(item.id)}" value="${e(value)}" style="--w:${width}ch" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next" aria-label="${label}">${e(after)}</p></li>`;
    }
    if (section.kind === 'ab' || section.kind === 'listen') {
      // Sentences stack for the whole part, so its a/b rows line up.
      const long = section.items.some(entry => entry.options.some(option => option.length > 18));
      return `<li class="xp-item">${no}<div class="xp-body">${item.question ? `<p class="xp-q" lang="nb">${e(item.question)}${points}</p>` : ''}<div class="xp-ab${long ? ' is-long' : ''}" role="radiogroup" aria-label="${label}">${item.options.map((option,k) => `<button type="button" class="xp-choice" role="radio" aria-checked="${String(value) === String(k)}" data-paper="choose" data-id="${e(item.id)}" data-value="${k}"><kbd>${'abcdefgh'[k]}</kbd><span lang="nb">${e(option)}</span></button>`).join('')}</div></div></li>`;
    }
    if (section.kind === 'match') {
      return `<li class="xp-item">${no}<div class="xp-body is-row"><span class="xp-word" lang="nb">${e(item.text)}</span><div class="xp-letters" role="radiogroup" aria-label="${label}：${e(item.text)}">${section.bank.map(entry => `<button type="button" role="radio" aria-checked="${value === entry.key}" data-paper="choose" data-id="${e(item.id)}" data-value="${e(entry.key)}">${e(entry.key)}</button>`).join('')}</div></div></li>`;
    }
    if (section.kind === 'open') {
      return `<li class="xp-item">${no}<div class="xp-body"><label class="xp-q" for="xp-f-${e(item.id)}" lang="nb">${e(item.question)}</label><input id="xp-f-${e(item.id)}" class="xp-answer" data-paper-field="${e(item.id)}" value="${e(value)}" autocomplete="off" autocapitalize="sentences" spellcheck="false" enterkeyhint="next" lang="nb"></div></li>`;
    }
    if (section.kind === 'write') {
      const count = countSentences(value);
      return `<li class="xp-item is-write">${no}<div class="xp-body"><label class="xp-q" for="xp-f-${e(item.id)}" lang="nb">${e(item.prompt.nb)}<span class="xp-item-points" lang="nb">${pts(itemPoints(section,item))} p</span></label>${ui.zh ? `<p class="xp-zh">${e(item.prompt.zh)}</p>` : ''}<textarea id="xp-f-${e(item.id)}" class="xp-text" data-paper-field="${e(item.id)}" rows="${item.sentences > 2 ? 6 : 3}" spellcheck="false" autocapitalize="sentences" lang="nb">${e(value)}</textarea><span class="xp-count${count >= (item.sentences || 1) ? ' is-enough' : ''}" data-paper-count="${e(item.id)}">${sentenceCount(item,count)}</span></div></li>`;
    }
    return '';
  }
  const sentenceCount = (item,count) => `${count} 句${item.sentences > 1 ? ` · 至少 ${item.sentences} 句` : ''}`;

  /* grading and results */
  function gradingMarkup() {
    return `<section class="ex-app ex-grading" role="status" aria-live="polite"><div class="ex-grading-card"><span class="ex-spinner" aria-hidden="true"></span><h2>正在评分</h2><p>选择、填空和连线已经判好；写作和阅读问答交给 AI 看意思、按卷面的评分说明给分，通常要半分钟左右，请不要关闭页面。</p></div></section>`;
  }
  function resultMarkup() {
    const record = shown, paper = record && papers.get(record.paper);
    if (!record || !paper) return introMarkup();
    const score = scorePaper(paper,record.answers,record.ai), waiting = score.waiting > 0;
    const head = `<div class="ex-result-head xp-result-head"><span class="xp-score${waiting ? ' is-waiting' : ''}"><b>${pts(score.total)}</b><small>/ ${pts(score.max)}</small></span><div><p class="ex-kicker" lang="nb">${level} · PRØVEEKSAMEN · SETT ${record.set}</p><h2 tabindex="-1">${waiting ? `已得 ${pts(score.total)} 分，还有 ${score.waiting} 题待评` : `得了 ${pts(score.total)} 分`}</h2>${score.bonusMax ? `<p class="xp-bonus">附加分 <b>+${pts(score.bonus)}</b> / ${pts(score.bonusMax)}</p>` : ''}${ui.error ? `<p class="ex-error">${e(ui.error)}</p>` : ''}${record.ai?.summary ? `<p class="xp-summary">${e(record.ai.summary)}</p>` : ''}</div>${waiting ? `<button type="button" class="ex-primary" data-paper="regrade" data-id="${e(record.id)}">现在评分</button>` : ''}</div>`;
    const sections = paper.sections.map((section,i) => reviewSection(section,i,score.sections[i],record)).join('');
    return `<section class="ex-app ex-result xp-result"><div class="ex-result-top"><button type="button" class="ex-quiet" data-paper="exit">${icon('close')}返回</button></div>${head}<div class="xp-review-list">${sections}</div><div class="ex-foot"><button type="button" class="ex-primary" data-paper="again">再考一次</button></div></section>`;
  }
  function reviewSection(section,i,mark,record) {
    const full = mark.items.every(item => item.correct === true);
    const rows = section.items.map((item,k) => reviewItem(section,item,k,mark.items[k],record)).join('');
    let extra = '';
    if (section.kind === 'open' && section.text) extra = `<div class="ex-script"><p><span lang="nb">${nl(section.text.nb)}</span><small>${nl(section.text.zh)}</small></p></div>`;
    if (section.kind === 'listen') extra = `<div class="ex-script"><button type="button" class="ex-text-button" data-paper="replay" data-id="${e(section.id)}">${icon('sound')}再听一遍</button>${section.listen.script.map(line => `<p>${line.who ? `<b>${e(line.who)}</b>` : ''}<span lang="nb">${e(line.nb)}</span></p>`).join('')}<p><small>${nl(section.listen.zh)}</small></p></div>`;
    if (section.kind === 'match') extra = `<ul class="xp-defs is-small">${section.bank.map(entry => `<li><b>${e(entry.key)}</b><span lang="nb">${e(entry.nb)}</span><small>${e(entry.zh)}</small></li>`).join('')}</ul>`;
    return `<details class="xp-review${full ? ' is-full' : ''}"${full ? '' : ' open'}><summary><span class="xp-sec-no">${i+1}.</span><span class="xp-review-title"><span lang="nb">${e(section.title.nb)}</span><small>${e(section.title.zh)}</small></span><b class="xp-review-points">${mark.items.some(item => item.correct === null) ? '待评' : `${pts(mark.got)} / ${pts(mark.max)}`}</b></summary>
      <div class="xp-review-body"><p class="xp-review-task" lang="nb">${e(section.task.nb)}</p>${extra}<ol class="xp-r-items">${rows}</ol></div></details>`;
  }
  function reviewItem(section,item,k,mark,record) {
    const value = record.answers[item.id], none = '<em class="xp-none">没有作答</em>';
    const state = mark.correct === null ? 'is-waiting' : mark.correct ? 'is-right' : 'is-wrong';
    const markIcon = `<span class="xp-mark">${mark.correct === null ? '…' : icon(mark.correct ? 'check' : 'cross')}</span>`;
    // The rule is explained where it was missed; a right answer shows only its meaning.
    const tr = item.tr ? `<p class="xp-tr">${e(item.tr)}</p>` : '', why = item.why && !mark.correct ? `<p class="xp-why">${e(item.why)}</p>` : '';
    let body = '';
    if (section.kind === 'pick' || section.kind === 'fill') {
      const [before,after] = splitBlank(item.text), right = section.kind === 'pick' ? item.answer : item.answers[0];
      const shownRight = section.kind === 'pick' && startsSentence(before) ? capital(right) : right;
      body = `<p lang="nb">${e(before)}<b class="xp-right">${e(shownRight)}</b>${e(after)}</p>${mark.correct ? '' : `<p class="xp-yours">${section.kind === 'pick' ? '你选的' : '你写的'}：${filled(value) ? `<s lang="nb">${e(value)}</s>` : none}</p>`}`;
    } else if (section.kind === 'ab' || section.kind === 'listen') {
      body = `${item.question ? `<p lang="nb">${e(item.question)}</p>` : ''}<p lang="nb"><b class="xp-right">${'abcdefgh'[item.answer]}) ${e(item.options[item.answer])}</b></p>${mark.correct ? '' : `<p class="xp-yours">你选的：${filled(value) ? `<s lang="nb">${'abcdefgh'[Number(value)]}) ${e(item.options[Number(value)] || '')}</s>` : none}</p>`}`;
    } else if (section.kind === 'match') {
      const entry = section.bank.find(option => option.key === item.answer);
      body = `<p lang="nb">${e(item.text)} → <b class="xp-right">${e(item.answer)}</b> ${e(entry?.nb || '')}</p>${mark.correct ? '' : `<p class="xp-yours">你选的：${filled(value) ? `<s>${e(value)}</s>` : none}</p>`}`;
    } else if (section.kind === 'open') {
      body = `<p lang="nb">${e(item.question)}</p><p class="xp-yours">你写的：${filled(value) ? `<span lang="nb">${e(value)}</span>` : none}${mark.by === 'ai' && mark.correct ? '<small class="xp-ai-ok">意思对（AI 看过）</small>' : ''}${mark.correct === null ? '<small class="xp-ai-wait">等 AI 看意思</small>' : ''}</p><p>参考答案：<b class="xp-right" lang="nb">${e(item.model)}</b></p>`;
      const why2 = (record.ai?.open || []).find(entry => entry.id === item.id)?.why;
      if (why2 && !mark.correct) body += `<p class="xp-why">${e(why2)}</p>`;
    } else if (section.kind === 'write') {
      const graded = (record.ai?.write || []).find(entry => entry.id === item.id);
      body = `<p lang="nb">${e(item.prompt.nb)}</p><p class="xp-tr">${e(item.prompt.zh)}</p>
        ${filled(value) ? `<div class="ex-compare"><div><small>你写的</small><p lang="nb">${nl(value)}</p></div>${graded?.corrected && foldAnswer(graded.corrected) !== foldAnswer(value) ? `<div><small>改正后</small><p lang="nb">${nl(graded.corrected)}</p></div>` : ''}</div>` : `<p class="xp-yours">${none}</p>`}
        ${graded ? `<p class="xp-ai-points"><b>${pts(mark.earned)} / ${pts(mark.points)} poeng</b>${e(graded.comment || '')}</p>` : filled(value) ? '<p class="xp-yours">还没评分。</p>' : ''}
        <details class="xp-model"><summary>看范文</summary><p lang="nb">${nl(item.model)}</p><small>${e(item.modelZh || '')}</small></details>`;
      return `<li class="xp-r-item ${state}">${markIcon}<div>${body}</div></li>`;
    }
    return `<li class="xp-r-item ${state}">${markIcon}<div>${body}${tr}${why}</div></li>`;
  }

  /* ----- running a paper ----- */
  async function begin(resume) {
    if (starting) return;
    starting = true;
    const lvl = level;
    try {
      const set = resume && run() ? run().set : ui.set || 1, id = paperId(lvl,set);
      try { await load(id); } catch { if (stillOnIntro(lvl)) { ui.error = '题目暂时无法载入，请检查网络后重试。'; render(); } return; }
      if (!stillOnIntro(lvl)) return;
      if (!resume || !run()) { store.active[lvl] = {paper:id,set,section:0,answers:{},plays:{},startedAt:new Date().toISOString()}; save(); }
      ui.error = ''; ui.notice = '';
      view = 'session'; render('#xp-sec-title');
    } finally { starting = false; }
  }
  const stillOnIntro = lvl => attached && level === lvl && view === 'intro';
  function goto(index) {
    const active = run(), paper = current();
    if (!active || !paper) return;
    stopSound();
    active.section = Math.max(0,Math.min(paper.sections.length-1,index));
    save(); ui.notice = ''; lastField = null;
    render('#xp-sec-title');
    root.querySelector('.xp-session')?.scrollIntoView?.({block:'start'});
  }
  function askHandIn() {
    const active = run(), paper = current();
    if (!active || !paper) return;
    const open = paper.sections.reduce((sum,section) => sum+section.items.filter(item => !filled(active.answers[item.id])).length,0);
    ui.confirm = {title:'交卷吗？',text:`${open ? `还有 ${open} 题没答。` : '题目都答完了。'}交卷后就不能再改，马上能看成绩、答案和讲解。`,actions:[['confirm-hand-in','交卷',true],['confirm-close','再看看']]};
    render();
  }
  function handIn() {
    const active = run(), paper = current();
    if (!active || !paper) return;
    stopSound(); flushFields();
    const record = {id:`paper-${paper.id}-${Date.now().toString(36)}`,paper:paper.id,level,set:active.set,finishedAt:new Date().toISOString(),answers:{...active.answers},status:'pending',ai:null};
    record.score = summary(scorePaper(paper,record.answers));
    store.history.unshift(record);
    store.history = store.history.slice(0,40);
    store.sets[level] = [...new Set([...(store.sets[level] || []),active.set])];
    delete store.active[level];
    const request = aiRequest(paper,record.answers);
    if (!request) { record.status = 'graded'; save(); award(record,paper); showResult(record); return; }
    save();
    gradeRecord(record,paper,request);
  }
  const summary = score => ({total:score.total,max:score.max,bonus:score.bonus,bonusMax:score.bonusMax,waiting:score.waiting});
  // The writing (and short answers the key words missed) go to the AI once per record; a second tap waits for it.
  async function gradeRecord(record,paper,request) {
    if (grading.has(record.id)) { view = 'grading'; render(); return; }
    grading.add(record.id);
    view = 'grading'; ui.error = ''; render();
    const stored = () => store.history.find(item => item.id === record.id) || record;
    try {
      const reply = await deps.request('/ai/grade',{method:'POST',body:request,timeout:150000});
      const target = stored();
      target.ai = {write:reply.write || [],open:reply.open || [],summary:reply.summary || ''};
      target.score = summary(scorePaper(paper,target.answers,target.ai));
      target.status = target.score.waiting ? 'pending' : 'graded';
      save();
    } catch (error) {
      ui.error = error?.code === 'ai_quota' ? '今天的 AI 评分次数用完了，写作明天再评。其余各题已经判好。'
        : error?.code === 'ai_unavailable' ? 'AI 评分暂时没有开启，写作之后可以再评。其余各题已经判好。'
        : '写作评分没有成功，答案已经保存。检查网络后点「现在评分」。';
    } finally {
      grading.delete(record.id);
      const target = stored();
      award(target,paper);
      if (attached && view === 'grading') showResult(target);
      else if (attached && view === 'intro') render();
    }
  }
  // XP once per paper (2 per item, 8 more for each right one, as in practice); writing waiting for the AI counts as not right.
  function award(record,paper) {
    if (record.awarded) return;
    const score = scorePaper(paper,record.answers,record.ai);
    record.awarded = true; save();
    deps.submitResult?.({id:record.id,activity:PAPER_ACTIVITY,total:score.count,answers:Array.from({length:score.count},(_,i) => ({points:i < score.right ? 2 : 0}))});
  }
  function showResult(record) { shown = record; level = record.level; view = 'result'; stopSound(); render('.xp-result h2'); }

  /* ----- listening: at most MAX_PLAYS playings while the paper is open ----- */
  function stopSound() {
    audioRun += 1;
    if (audio) { audio.onended = audio.onerror = audio.onplaying = null; audio.pause(); audio.removeAttribute('src'); audio.load?.(); audio = null; }
    const was = playing;
    playing = null;
    if (was && attached && view === 'session') redrawPlayer();
  }
  function redrawPlayer() {
    const node = root?.querySelector('.xp-player'), paper = current(), active = run();
    if (!node || !paper || !active) return;
    const section = paper.sections[active.section || 0];
    if (section?.kind !== 'listen') return;
    const holder = document.createElement('div');
    holder.innerHTML = sectionTop(section,active);
    node.parentNode.querySelector(':scope > .ex-error')?.remove();
    node.replaceWith(...holder.childNodes);
  }
  function play(sectionId,{count = true} = {}) {
    stopSound();
    quietOthers?.();
    const token = ++audioRun, clip = new Audio(clipURL(sectionId));
    audio = clip; playing = sectionId; ui.notice = '';
    let counted = false;
    clip.onplaying = () => {
      if (token !== audioRun || counted || !count) return;
      counted = true;
      const active = run();
      if (active) { active.plays ||= {}; active.plays[sectionId] = (active.plays[sectionId] || 0)+1; save(); }
    };
    clip.onended = () => { if (token === audioRun) { audio = null; playing = null; if (view === 'session') redrawPlayer(); } };
    clip.onerror = () => { if (token === audioRun) { audio = null; playing = null; ui.notice = '录音暂时放不出来，请检查网络后再点一次。这次不算次数。'; if (view === 'session') redrawPlayer(); } };
    clip.play()?.catch?.(() => { if (token === audioRun) { audio = null; playing = null; ui.notice = '录音没有放出来，请再点一次播放。'; if (view === 'session') redrawPlayer(); } });
    if (view === 'session') redrawPlayer();
  }

  /* ----- typing ----- */
  function store1(field) {
    const active = run();
    if (!active || !field?.dataset.paperField) return;
    active.answers[field.dataset.paperField] = field.value;
  }
  function flushFields() { root?.querySelectorAll('[data-paper-field]').forEach(store1); save(); }
  function refreshMarks(field) {
    const paper = current(), active = run();
    if (!paper || !active) return;
    const index = active.section || 0, section = paper.sections[index];
    root.querySelector(`.xp-step[data-index="${index}"]`)?.classList.toggle('is-done',sectionDone(section,active.answers));
    if (section.kind === 'pick' && section.once) {
      const used = new Set(section.items.map(item => foldAnswer(active.answers[item.id])).filter(Boolean));
      root.querySelectorAll('.xp-bank li').forEach(node => node.classList.toggle('is-used',used.has(foldAnswer(node.textContent))));
    }
    if (section.kind === 'write' && field) {
      const item = section.items.find(entry => entry.id === field.dataset.paperField), counter = root.querySelector(`[data-paper-count="${field.dataset.paperField}"]`);
      if (item && counter) { const count = countSentences(field.value); counter.textContent = sentenceCount(item,count); counter.classList.toggle('is-enough',count >= (item.sentences || 1)); }
    }
  }
  function insertLetter(letter) {
    const field = lastField && root.contains(lastField) ? lastField : root.querySelector('input[data-paper-field],textarea[data-paper-field]');
    if (!field) return;
    const start = field.selectionStart ?? field.value.length, end = field.selectionEnd ?? start;
    field.setRangeText ? field.setRangeText(letter,start,end,'end') : (field.value = field.value.slice(0,start)+letter+field.value.slice(end));
    field.focus({preventScroll:true});
    store1(field); saveSoon(); refreshMarks(field);
  }

  /* ----- events ----- */
  function onClick(event) {
    const target = event.target.closest?.('[data-paper]');
    if (!target || !root?.contains(target)) return;
    const action = target.dataset.paper, active = run();
    if (action === 'exit') { stopSound(); flushIfSession(); exit(); return; }
    if (action === 'set') { ui.set = Number(target.dataset.set); render(); return; }
    if (action === 'start') { begin(false); return; }
    if (action === 'resume') { begin(true); return; }
    if (action === 'restart') { ui.confirm = {title:'重新开始吗？',text:'这次已经写好的答案会清掉，不能恢复。',actions:[['confirm-restart','重新开始',true],['confirm-close','取消']]}; render(); return; }
    if (action === 'confirm-restart') { ui.confirm = null; delete store.active[level]; save(); render(); return; }
    if (action === 'confirm-close') { ui.confirm = null; render(); return; }
    if (action === 'leave') { stopSound(); flushFields(); ui.confirm = null; view = 'intro'; render('#xp-intro-title'); return; }
    if (action === 'goto') { flushFields(); goto(Number(target.dataset.index) || 0); return; }
    if (action === 'next' && active) { flushFields(); goto((active.section || 0)+1); return; }
    if (action === 'prev' && active) { flushFields(); goto((active.section || 0)-1); return; }
    if (action === 'hand-in') { flushFields(); askHandIn(); return; }
    if (action === 'confirm-hand-in') { ui.confirm = null; handIn(); return; }
    if (action === 'zh') { flushFields(); ui.zh = !ui.zh; render(); return; }
    if (action === 'letter') { insertLetter(target.dataset.letter); return; }
    if (action === 'choose' && active) {
      active.answers[target.dataset.id] = target.dataset.value;
      save();
      for (const node of target.parentNode.querySelectorAll('[data-paper="choose"]')) node.setAttribute('aria-checked',String(node === target));
      refreshMarks();
      return;
    }
    if (action === 'play' && active) {
      const section = current()?.sections[active.section || 0];
      if (!section || section.kind !== 'listen') return;
      if (playing === section.id) { stopSound(); return; }
      if ((active.plays?.[section.id] || 0) >= MAX_PLAYS) return;
      play(section.id);
      return;
    }
    if (action === 'replay') { if (playing === target.dataset.id) stopSound(); else play(target.dataset.id,{count:false}); return; }
    if (action === 'show-result') {
      const record = store.history.find(item => item.id === target.dataset.id);
      if (record) load(record.paper).then(() => { ui.error = ''; showResult(record); }).catch(() => { ui.error = '结果暂时无法打开，请检查网络后重试。'; render(); });
      return;
    }
    if (action === 'regrade') {
      const record = store.history.find(item => item.id === target.dataset.id);
      if (!record) return;
      load(record.paper).then(paper => { const request = aiRequest(paper,record.answers); if (request) gradeRecord(record,paper,request); }).catch(() => { ui.error = '题目暂时无法载入，请检查网络后重试。'; render(); });
      return;
    }
    if (action === 'again') { ui.error = ''; ui.set = shown?.set || ui.set; view = 'intro'; render('#xp-intro-title'); }
  }
  function flushIfSession() { if (view === 'session') flushFields(); }
  function onInput(event) {
    const field = event.target;
    if (!field?.dataset?.paperField || view !== 'session') return;
    store1(field); saveSoon(); refreshMarks(field);
  }
  function onFocus(event) { if (event.target?.matches?.('input[data-paper-field],textarea[data-paper-field]')) lastField = event.target; }
  // Letter buttons keep the caret where it was.
  function onPointerDown(event) { if (event.target.closest?.('[data-paper="letter"]')) event.preventDefault(); }
  function onKey(event) {
    // Enter in a one-line answer moves to the next blank of this part.
    if (event.key !== 'Enter' || !event.target?.matches?.('input[data-paper-field]')) return;
    event.preventDefault();
    const fields = [...root.querySelectorAll('[data-paper-field]')], next = fields[fields.indexOf(event.target)+1];
    if (next) next.focus(); else event.target.blur();
  }

  return {
    attach() {
      if (attached) return;
      root = ctx.root;
      if (!root) return;
      attached = true;
      root.addEventListener('click',onClick); root.addEventListener('input',onInput); root.addEventListener('change',onInput);
      root.addEventListener('focusin',onFocus); root.addEventListener('pointerdown',onPointerDown); root.addEventListener('mousedown',onPointerDown); root.addEventListener('keydown',onKey);
    },
    detach() {
      stopSound(); if (view === 'session') flushFields();
      if (view === 'session' || view === 'grading') view = 'intro';
      if (!attached) return;
      attached = false;
      root.removeEventListener('click',onClick); root.removeEventListener('input',onInput); root.removeEventListener('change',onInput);
      root.removeEventListener('focusin',onFocus); root.removeEventListener('pointerdown',onPointerDown); root.removeEventListener('mousedown',onPointerDown); root.removeEventListener('keydown',onKey);
    },
    open(lvl) {
      store = readPaperStore();
      level = PAPER_LEVELS[lvl] ? lvl : 'A1';
      view = 'intro'; ui.error = ''; ui.confirm = null; ui.set = null; ui.notice = '';
      this.attach();
      render('#xp-intro-title');
      const active = run();
      if (active) load(active.paper).catch(() => {});
    },
    render,
    stopAudio: stopSound,
    hidden() { stopSound(); if (view === 'session') flushFields(); else save(); },
    get view() { return view; }
  };
}
