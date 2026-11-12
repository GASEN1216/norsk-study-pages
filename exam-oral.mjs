/* 考试与面试 · 口语 (docs/exam-interview-plan.md): the speaking part of the Norskprøven A1–A2 self-test, opened by
   exam.mjs. Four tasks as in the real test: tell about yourself, describe a picture (with the examiner's follow-up
   questions), exchange information with a partner (played by the site's AI, scripts/exam_ai.py), talk about a
   familiar topic. The examiner's lines are recordings (audio/exam/<task>-e<n>.mp3, -f<n> follow-ups, -o the
   partner's opening line); the learner's answers are written down on the device (dictation.mjs) and only the text
   and its timing go to the AI. A task left halfway starts again from its beginning. */

const suffix = new URL(import.meta.url).search;
const KIND = {presentasjon:'介绍自己',bilde:'描述图片',samtale:'交换信息',tema:'熟悉话题'};
const TURN_PAUSE = 2.4;        // seconds of silence after speech that end a conversation turn
const FOLLOWUP_PAUSE = 3;      // …and a follow-up answer
const TURN_MAX = 45, FOLLOWUP_MAX = 60;

export function createOral(ctx) {
  const {root,deps,store,save,tasks,artReady,artURL,audioURL,icon,escape:e} = ctx;
  const nl = text => e(text).replace(/\n/g,'<br>');
  const run = () => store.active.speaking;
  const list = () => tasks.get(run().set) || [];
  const task = () => list()[run().task];
  let dictation = null, recorder = null, closed = false, audio = null, audioRun = 0, timer = null, flowId = 0, opening = false, between = null;
  let view = {phase:'prepare',lines:0,speaking:null,text:'',level:0,error:'',partnerBusy:false,followup:-1,zh:false};
  let progress = null, recogniser = 'loading';
  // A step that waited (a recording, the transcript, the partner, a pause) goes on only in the flow that started it:
  // leaving the test, or the page going to the background, starts a new flow.
  const live = id => !closed && id === flowId;

  /* ----- recogniser and microphone ----- */
  const loaded = import(`./dictation.mjs${suffix}`).then(module => module.load().then(() => (dictation = module)));
  function prepareRecogniser() {
    loaded.then(module => {
      if (!module.supported()) { recogniser = 'unsupported'; draw(); return; }
      module.prepare(p => { progress = p; showProgress(); }).then(ok => {
        recogniser = ok ? 'ready' : 'failed';
        if (closed) return;
        if (ok && view.phase === 'waiting') { beginTask(); return; }
        // Waiting with the microphone open for a recogniser that failed: close it and offer 再试一次.
        if (!ok && view.phase === 'waiting') { recorder?.close(); recorder = null; view.phase = 'prepare'; }
        draw();
      });
    }).catch(() => { recogniser = 'failed'; draw(); });
  }
  async function openMic() {
    if (opening || recorder || closed) return;
    // A failed recogniser (no network) gets another try with this tap.
    if (recogniser === 'failed') { recogniser = 'loading'; progress = null; prepareRecogniser(); }
    view.error = ''; opening = true; draw();
    try {
      const module = dictation || await loaded;
      const opened = await module.record({
        onText:text => { view.text = text; const box = root.querySelector('[data-oral-text]'); if (box) box.textContent = text || '…'; },
        onLevel:level => { view.level = level; const ring = root.querySelector('.ex-oral-mic'); if (ring) ring.style.setProperty('--level',Math.min(1,level*14).toFixed(2)); },
        onPause:seconds => { if (view.speaking?.endOnPause && seconds >= view.speaking.endOnPause && view.speaking.heard !== false) finishSpeaking(); }
      });
      opening = false;
      // Left the test, or the page went to the background, while the browser asked for the microphone.
      if (closed || document.hidden) { opened.close(); draw(); return; }
      recorder = opened;
      recorder.hold();
      if (recogniser === 'ready') beginTask(); else { view.phase = 'waiting'; draw(); }
    } catch (error) {
      opening = false;
      view.error = error?.code === 'denied' ? '麦克风没有打开。请在浏览器设置里允许使用麦克风，再点一次。' : error?.code === 'none' ? '没有找到麦克风。' : '麦克风暂时打不开，请再试一次。';
      draw();
    }
  }

  /* ----- sound ----- */
  function stopAudio() {
    audioRun += 1;
    if (audio) { audio.onended = audio.onerror = null; audio.pause(); audio.removeAttribute('src'); audio.load?.(); audio = null; }
  }
  // The page speaks (examiner, partner): the microphone hears nothing meanwhile.
  function play(url) {
    stopAudio();
    const token = audioRun;
    recorder?.hold();
    return new Promise(done => {
      ctx.quietOthers?.();
      const clip = new Audio(url);
      audio = clip;
      const end = outcome => { if (token === audioRun) { audio = null; done(outcome); } else done('stopped'); };
      clip.onended = () => end('ended');
      clip.onerror = () => end('missing');
      clip.play().catch(() => end('blocked'));
    });
  }
  const pauseBetween = ms => new Promise(done => setTimeout(done,ms));

  /* ----- the flow of a task ----- */
  async function beginTask() {
    if (closed || !recorder) return;
    const current = task();
    if (!current) { finish(); return; }
    run().followups ||= {};
    view = {...view,phase:'examiner',lines:0,speaking:null,text:'',followup:-1,error:''};
    // The conversation starts again from its first line: its earlier turns and their timing are dropped.
    if (current.kind === 'samtale') { run().conversation = []; if (run().metrics) delete run().metrics[current.id]; }
    save(); draw();
    const id = ++flowId;
    for (let i = 0; i < (current.examiner || []).length; i++) {
      view.lines = i+1; draw();
      const outcome = await play(audioURL(`${current.id}-e${i+1}`));
      if (closed || id !== flowId || outcome === 'stopped') return;
      if (outcome === 'blocked') { view.phase = 'blocked'; draw(); return; }
      await pauseBetween(outcome === 'missing' ? 1800 : 350);
      if (closed || id !== flowId) return;
    }
    if (current.kind === 'samtale') { partnerTurn(current); return; }
    speak({max:current.seconds?.[1] ? current.seconds[1]+15 : 150,band:current.seconds,label:'main'});
  }
  function speak({max,band,label,endOnPause = 0}) {
    if (closed || !recorder) return;
    view.phase = 'speak';
    view.text = '';
    view.speaking = {started:Date.now(),max,band,label,endOnPause,heard:false};
    recorder.reset(); recorder.release();
    draw();
    clearInterval(timer);
    timer = setInterval(() => {
      const s = view.speaking;
      if (!s) { clearInterval(timer); return; }
      const seconds = (Date.now()-s.started)/1000;
      if (recorder?.stats.speech > .3) s.heard = true;
      const clock = root.querySelector('[data-oral-clock]');
      if (clock) clock.textContent = clockText(seconds);
      if (seconds >= s.max) finishSpeaking();
    },250);
  }
  async function finishSpeaking() {
    const s = view.speaking;
    if (!s || s.ending || !recorder) return;
    s.ending = true;
    clearInterval(timer);
    view.phase = 'writing'; draw();
    const id = flowId;
    const {text,metrics} = await recorder.stop();
    if (!live(id)) return;
    view.speaking = null;
    const current = task(), answers = run().answers, measured = run().metrics;
    if (current.kind === 'samtale') {
      run().conversation.push({who:'student',text});
      measured[current.id] = mergeMetrics(measured[current.id],metrics);
      save();
      const elapsed = (Date.now()-view.talkStarted)/1000;
      if (elapsed >= (current.seconds?.[1] || 180) || view.endTalk) { nextTask(); return; }
      partnerTurn(current);
      return;
    }
    if (s.label === 'main') {
      answers[current.id] = text; measured[current.id] = metrics;
    } else {
      const question = current.followups[view.followup]?.nb || '';
      answers[current.id] = `${answers[current.id] || ''}\n\n(Oppfølgingsspørsmål: ${question})\n${text}`.trim();
      measured[current.id] = mergeMetrics(measured[current.id],metrics);
    }
    save();
    if (current.kind === 'bilde' && view.followup+1 < (current.followups || []).length) { askFollowup(current,view.followup+1); return; }
    nextTask();
  }
  function mergeMetrics(before,after) {
    if (!before) return after;
    const seconds = (before.seconds || 0)+(after.seconds || 0), words = (before.words || 0)+(after.words || 0), speech = (before.speechSeconds || 0)+(after.speechSeconds || 0);
    return {seconds,speechSeconds:Math.round(speech*10)/10,words,wordsPerMinute:seconds ? Math.round(words/(seconds/60)) : 0,longPauses:(before.longPauses || 0)+(after.longPauses || 0)};
  }
  async function askFollowup(current,index) {
    view.followup = index; view.phase = 'followup'; draw();
    const id = flowId;
    const outcome = await play(audioURL(`${current.id}-f${index+1}`));
    if (!live(id) || outcome === 'stopped') return;
    speak({max:FOLLOWUP_MAX,label:'followup',endOnPause:FOLLOWUP_PAUSE});
  }
  async function partnerTurn(current) {
    const conversation = run().conversation, id = flowId;
    view.phase = 'partner'; view.partnerBusy = true; draw();
    let line = null;
    if (!conversation.length) {
      view.talkStarted = Date.now();
      line = {text:current.opener?.nb || 'Hei!',audio:audioURL(`${current.id}-o`)};
    } else {
      try {
        const reply = await deps.request('/ai/partner',{method:'POST',body:{task:current.id,turns:conversation},timeout:45000});
        line = {text:reply.reply,audio:reply.audio ? apiURL(reply.audio) : null,done:reply.done};
      } catch (error) {
        if (!live(id)) return;
        view.partnerBusy = false;
        view.error = error?.code === 'ai_quota' ? '今天的 AI 次数用完了，这个任务先到这里。' : '同伴暂时没有回应。可以再试一次，或结束这段对话。';
        view.phase = 'partner-failed'; draw(); return;
      }
    }
    if (!live(id)) return;
    conversation.push({who:'partner',text:line.text});
    save();
    view.partnerBusy = false; draw();
    if (line.audio) { const outcome = await play(line.audio); if (!live(id) || outcome === 'stopped') return; }
    else { await pauseBetween(Math.min(4000,600+line.text.length*45)); if (!live(id)) return; }
    const elapsed = (Date.now()-view.talkStarted)/1000;
    if (line.done || elapsed >= (current.seconds?.[1] || 180)+20) { nextTask(); return; }
    speak({max:TURN_MAX,label:'turn',endOnPause:TURN_PAUSE});
  }
  const apiURL = path => new URL(`${String(window.NORSK_COMMUNITY_CONFIG?.apiBase || '/api/community').replace(/\/+$/,'')}${path}`,location.href).href;
  function nextTask() {
    stopAudio(); clearInterval(timer); view.speaking = null; view.endTalk = false;
    run().task += 1; save();
    if (run().task >= list().length) { finish(); return; }
    view.phase = 'between'; draw();
    const id = flowId;
    clearTimeout(between);
    between = setTimeout(() => { between = null; if (live(id)) beginTask(); },900);
  }
  function finish() {
    stopAudio(); clearInterval(timer);
    recorder?.close(); recorder = null;
    ctx.finished(run());
  }

  /* ----- drawing ----- */
  const clockText = seconds => `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
  function stateText() {
    const p = progress, percent = p?.total ? Math.round(p.loaded/p.total*100) : 0;
    return recogniser === 'ready' ? '识别器已经准备好。' : recogniser === 'unsupported' ? '这个浏览器用不了语音识别，请换新版 Chrome、Edge 或 Safari。' : recogniser === 'failed' ? '识别器没有准备好，请检查网络后再点一次。' : p?.downloading ? `正在下载识别器 ${percent}%（第一次约 118 MB，之后不用再下）` : '识别器准备中…';
  }
  function showProgress() {
    const line = root?.querySelector('.ex-oral-state');
    if (line && !closed) line.textContent = stateText(); else draw();
  }
  function prepareMarkup() {
    const label = opening ? '正在打开麦克风…' : recogniser === 'failed' ? '再试一次' : '打开麦克风，开始考试';
    return `<div class="ex-oral-card"><span class="ex-part-icon is-large">${icon('speaking')}</span><h2 tabindex="-1">口语 · 第 ${run().set} 套</h2>
      <p class="ex-oral-note">考试时你说的话会在这台设备上识别成文字，最后连同说话时长一起交给 AI 评分。请找一个安静的地方，最好戴耳机。</p>
      <p class="ex-oral-state${recogniser === 'ready' ? ' is-ready' : ''}" role="status">${stateText()}</p>
      ${view.error ? `<p class="ex-error" role="alert">${e(view.error)}</p>` : ''}
      ${view.phase === 'waiting' ? '<p class="ex-oral-note">麦克风已打开，识别器准备好就开始。</p>' : `<button type="button" class="ex-primary" data-oral="mic"${recogniser === 'unsupported' || opening ? ' disabled' : ''}>${icon('speaking')}${label}</button>`}
      ${run().task ? `<p class="ex-oral-note">从任务 ${run().task+1} 接着考，这个任务会从头开始。</p>` : ''}</div>`;
  }
  function examinerMarkup(current) {
    const shown = (current.examiner || []).slice(0,view.phase === 'examiner' ? view.lines : (current.examiner || []).length);
    return `<div class="ex-examiner"><span class="ex-examiner-tag">Sensor</span>${shown.map((line,i) => `<p class="${i === shown.length-1 && view.phase === 'examiner' ? 'is-now' : ''}"><span lang="nb">${e(line.nb)}</span>${view.zh ? `<small>${e(line.zh)}</small>` : ''}</p>`).join('')}<button type="button" class="ex-text-button" data-oral="zh">${view.zh ? '收起中文' : '看中文'}</button></div>`;
  }
  function speakingMarkup(current) {
    const s = view.speaking, band = s?.band, seconds = s ? (Date.now()-s.started)/1000 : 0;
    const goal = band ? `建议 ${band[0]/60}–${band[1]/60} 分钟` : s?.endOnPause ? '说完停一下，会自动接着进行' : '';
    const recording = view.phase === 'speak';
    return `<div class="ex-oral-speak${recording ? ' is-live' : ''}">
      <span class="ex-oral-mic" aria-hidden="true">${icon('speaking')}</span>
      <div class="ex-oral-meta"><strong>${recording ? '请说' : view.phase === 'writing' ? '正在整理文字…' : ''}</strong><span><b data-oral-clock>${clockText(seconds)}</b>${goal ? ` · ${goal}` : ''}</span></div>
      <p class="ex-oral-text" data-oral-text lang="nb" aria-live="polite">${e(view.text) || '…'}</p>
      ${recording ? `<button type="button" class="ex-primary" data-oral="done">说完了</button>` : ''}
    </div>`;
  }
  function talkMarkup(current) {
    const turns = run().conversation || [], name = current.partner?.name || 'Partner';
    return `<div class="ex-talk" aria-live="polite">${turns.map(turn => `<div class="ex-turn is-${turn.who}"><span>${turn.who === 'partner' ? e(name) : '你'}</span><p lang="nb">${e(turn.text) || '…'}</p></div>`).join('')}${view.partnerBusy ? `<div class="ex-turn is-partner is-busy"><span>${e(name)}</span><p><i></i><i></i><i></i></p></div>` : ''}</div>`;
  }
  function taskMarkup() {
    const current = task();
    if (!current) return '';
    const index = run().task, total = list().length;
    const hints = (current.bullets || []).length && ['speak','writing'].includes(view.phase) ? `<ul class="ex-bullets ex-oral-hints" lang="nb">${current.bullets.map(item => `<li>${e(item.nb)}${view.zh ? `<small>${e(item.zh)}</small>` : ''}</li>`).join('')}</ul>` : '';
    const picture = current.art ? (() => { const ready = artReady(current.art.id); return `<figure class="ex-picture${ready ? '' : ' is-stand-in'}" data-art="${e(current.art.id)}">${ready ? `<img src="${artURL(current.art.id)}" alt="考试场景图">` : `<figcaption>插图待画：${e(current.art.brief || '')}</figcaption>`}</figure>`; })() : '';
    const followup = view.followup >= 0 ? `<div class="ex-examiner is-followup"><span class="ex-examiner-tag">Sensor</span><p class="is-now"><span lang="nb">${e(current.followups[view.followup].nb)}</span>${view.zh ? `<small>${e(current.followups[view.followup].zh)}</small>` : ''}</p></div>` : '';
    const talk = current.kind === 'samtale' && (run().conversation || []).length ? talkMarkup(current) : '';
    const failed = view.phase === 'partner-failed' ? `<div class="ex-oral-actions">${view.error ? `<p class="ex-error">${e(view.error)}</p>` : ''}<button type="button" class="ex-primary" data-oral="partner-retry">再试一次</button><button type="button" class="ex-quiet" data-oral="end-talk">结束这段对话</button></div>` : '';
    const blocked = view.phase === 'blocked' ? `<div class="ex-oral-actions"><button type="button" class="ex-primary" data-oral="replay">${icon('sound')}点一下开始播放</button></div>` : '';
    const endTalk = current.kind === 'samtale' && view.phase === 'speak' && (Date.now()-(view.talkStarted || Date.now()))/1000 > 60 ? `<button type="button" class="ex-text-button" data-oral="end-talk">结束对话</button>` : '';
    const speaking = ['speak','writing'].includes(view.phase) ? speakingMarkup(current) : '';
    return `<div class="ex-bar"><button type="button" class="ex-exit" data-oral="exit" aria-label="退出，进度会保存">${icon('close')}<span>退出</span></button><div class="ex-bar-meta"><strong>口语 · 任务 ${index+1} / ${total}</strong><span>${KIND[current.kind] || ''} · 第 ${run().set} 套</span></div></div>
      <div class="ex-progress is-oral" aria-hidden="true">${list().map((_,i) => `<i class="${i < index ? 'is-done' : i === index ? 'is-now' : ''}"><b style="width:${i < index ? 100 : i === index ? 50 : 0}%"></b></i>`).join('')}</div>
      <div class="ex-stage ex-oral-stage">${examinerMarkup(current)}${picture}${followup}${talk}${hints}${speaking}${failed}${blocked}${endTalk}</div>`;
  }
  function draw() {
    if (closed || !root) return;
    document.body?.classList.toggle('practice-focus',!['prepare','waiting'].includes(view.phase));
    const prepare = ['prepare','waiting'].includes(view.phase);
    root.innerHTML = `<section class="ex-app ex-oral">${prepare ? `<div class="ex-bar"><button type="button" class="ex-exit" data-oral="exit">${icon('close')}<span>退出</span></button></div>${prepareMarkup()}` : view.phase === 'between' ? `<div class="ex-oral-card"><p class="ex-oral-note">进入下一个任务…</p></div>` : taskMarkup()}</section>`;
  }

  /* ----- events ----- */
  function onClick(event) {
    const target = event.target.closest?.('[data-oral]');
    if (!target || closed) return;
    const action = target.dataset.oral;
    if (action === 'mic') { openMic(); return; }
    if (action === 'exit') { leave(); return; }
    if (action === 'zh') { view.zh = !view.zh; draw(); return; }
    if (action === 'done') { finishSpeaking(); return; }
    if (action === 'replay') { beginTask(); return; }
    if (action === 'partner-retry') { view.error = ''; partnerTurn(task()); return; }
    if (action === 'end-talk') {
      if (view.phase === 'speak') { view.endTalk = true; finishSpeaking(); } else nextTask();
    }
  }
  function leave() {
    flowId += 1; clearTimeout(between); between = null;
    stopAudio(); clearInterval(timer);
    recorder?.close(); recorder = null;
    save();
    ctx.exit();
  }
  root.addEventListener('click',onClick);
  return {
    start() { prepareRecogniser(); view.phase = 'prepare'; draw(); root.querySelector('h2')?.focus?.({preventScroll:true}); },
    render: draw,
    // The page went to the background: the task in progress starts again when the learner comes back.
    pause() {
      if (view.phase === 'prepare') return;
      flowId += 1; clearTimeout(between); between = null;
      stopAudio(); clearInterval(timer); recorder?.close(); recorder = null;
      view = {...view,phase:'prepare',speaking:null,partnerBusy:false}; draw();
    },
    stopAudio,
    close() { closed = true; flowId += 1; clearTimeout(between); between = null; stopAudio(); clearInterval(timer); recorder?.close(); recorder = null; root.removeEventListener('click',onClick); }
  };
}
