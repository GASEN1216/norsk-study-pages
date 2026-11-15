/* One owner for microphone capture and the page's audio-session mode. No audio, device IDs or transcripts are
   logged. A pending getUserMedia cannot be cancelled by browsers: abandon it, stop a late stream, and do not
   open a second permission request until it settles. Tests inject the platform, not a second implementation. */
const PERMISSION = new Set(['NotAllowedError','PermissionDeniedError','SecurityError']);
const RETRY = new Set(['NotReadableError','TrackStartError','AbortError','OverconstrainedError','ConstraintNotSatisfiedError']);
const VOICE = {echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1};
const named = (name,message) => Object.assign(new Error(message),{name});

export function micFailure(error,stage = 'capture',code) {
  if (error?.micFailure) return code && code !== error.code
    ? Object.assign(new Error(error.message),{...error,stage,code,cause:error}) : error;
  const reason = String(error?.name || 'Error'), message = String(error?.message || reason);
  code ||= PERMISSION.has(reason) ? 'denied'
    : ['NotFoundError','DevicesNotFoundError'].includes(reason) ? 'none'
    : ['OverconstrainedError','ConstraintNotSatisfiedError'].includes(reason) ? 'constraints'
    : reason === 'InvalidStateError' ? (/AudioSession|audio session|category/i.test(message) ? 'session' : 'inactive')
    : ['NotReadableError','TrackStartError'].includes(reason) ? 'busy'
    : reason === 'NotSupportedError' && stage === 'open' ? 'unsupported' : 'audio';
  return Object.assign(new Error(message),{micFailure:true,reason,stage,code,cause:error});
}

// Complete phrases shared by all features; tx() may translate both fields without parsing browser errors.
export const MIC_HELP = {
  denied:['麦克风未获允许','请在当前网站的设置中允许麦克风。iPhone Safari：页面菜单 → 网站设置 → 麦克风；其他浏览器还需检查手机的应用权限。'],
  insecure:['需要安全连接','请用正式的 HTTPS 网址打开，再试一次。'],
  policy:['此页面不能申请麦克风','请在 Safari 或系统浏览器中直接打开本站，再试一次。'],
  none:['没有可用的麦克风','请检查手机或耳机的麦克风，断开耳机后可以再试一次。'],
  constraints:['麦克风设置不兼容','请断开外接耳机后再试，或使用手机自带的麦克风。'],
  busy:['麦克风暂时无法启动','请结束其他通话或录音后再试；仍然失败时，关闭此标签页后重新打开。'],
  session:['音频模式未能切换','请关闭此标签页后重新打开，再试一次。'],
  inactive:['页面暂时不能录音','请回到当前页面，再点一次录音。'],
  interrupted:['录音已中断','请结束通话或回到当前页面，再点一次录音。'],
  pending:['麦克风询问尚未结束','请先处理浏览器的麦克风询问；若没有弹窗，请刷新页面后再试。'],
  timeout:['等待麦克风超时','请处理浏览器的麦克风询问；若没有弹窗，请刷新页面后再试。'],
  'in-use':['另一项录音尚未结束','请先结束当前录音，再开始这一项。'],
  unsupported:['浏览器无法使用麦克风','请用新版 Safari、Chrome 或 Edge 直接打开本站。'],
  load:['录音功能未能载入','请检查网络连接，再试一次。'],
  audio:['音频输入未能启动','请再点一次录音；仍然失败时，关闭此标签页后重新打开。'],
  cancelled:['录音已取消','需要时可以再点一次录音。']
};
// Messenger apps' own browsers (WeChat, QQ, DingTalk, Weibo, Feishu, Douyin): the microphone often opens only in the
// phone's real browser. `app` is a separate phrase so tx() can translate it on its own.
const IN_APP = /MicroMessenger|QQ\/|DingTalk|Weibo|Lark|Feishu|aweme|Bytedance/i;
export const IN_APP_HINT = '在微信等应用里打不开时，请点右上角「…」选「在浏览器打开」。';
export const micHelp = error => {
  const [title,hint] = MIC_HELP[error?.code] || MIC_HELP.audio;
  const inApp = !['unsupported','cancelled','in-use','load'].includes(error?.code) && IN_APP.test(globalThis.navigator?.userAgent || '');
  return {title,hint,app:inApp ? IN_APP_HINT : ''};
};
export function micMessage(error) {
  const {title,hint,app} = micHelp(error);
  return `${title}。${hint}${app}${error?.reason ? `（${error.reason}）` : ''}`;
}

export function createMicrophoneController({nav = globalThis.navigator,win = globalThis.window,doc = globalThis.document,
  clock = globalThis,now = Date.now,permissionMs = 45000,resumeMs = 2500,stalledMs = 8000,muteMs = 4000} = {}) {
  let current = null, generation = 0;
  const requests = new Set(), history = [];
  const log = (event,detail = {}) => { history.push({at:now(),event,...detail}); if (history.length > 50) history.shift(); };
  const active = () => Boolean(current) || requests.size > 0;
  const sessionType = () => nav?.audioSession?.type || 'unavailable';
  const stopTracks = stream => { for (const track of stream?.getTracks?.() || []) { try { track.stop(); } catch {} } };
  function playback() {
    if (active()) return;
    try { if (nav?.audioSession && sessionType() !== 'playback') nav.audioSession.type = 'playback'; } catch {}
  }
  function recording() {
    const session = nav?.audioSession;
    if (!session || ['auto','play-and-record'].includes(session.type)) return;
    // Some host apps reject an explicit recording category but accept automatic selection.
    for (const type of ['play-and-record','auto']) {
      try { session.type = type; } catch (error) { log('session-set-failed',{reason:error.name}); }
      if (['auto','play-and-record'].includes(session.type)) { log('session',{type:session.type}); return; }
    }
    throw micFailure(named('InvalidStateError','AudioSession category is not compatible with audio capture.'),'session');
  }
  const bounded = (promise,ms,error) => new Promise((resolve,reject) => {
    const timer = clock.setTimeout(() => reject(error),ms);
    Promise.resolve(promise).then(resolve,reject).finally(() => clock.clearTimeout(timer));
  });
  const closeContext = context => {
    try { return bounded(context?.close?.(),resumeMs,null).catch(() => {}); } catch { return Promise.resolve(); }
  };
  function diagnostics() {
    return {mode:sessionType(),pending:requests.size,phase:current?.phase || 'idle',context:current?.context?.state,
      sampleRate:current?.context?.sampleRate,tracks:current?.stream?.getTracks?.().map(t => ({state:t.readyState,muted:t.muted,enabled:t.enabled})) || [],
      events:history.map(event => ({...event}))};
  }
  async function open({signal,onError} = {}) {
    if (signal?.aborted) throw micFailure(named('AbortError','Microphone request cancelled'),'open','cancelled');
    if (win?.isSecureContext === false) throw micFailure(named('SecurityError','HTTPS is required'),'open','insecure');
    const Context = win?.AudioContext || win?.webkitAudioContext;
    if (!nav?.mediaDevices?.getUserMedia || !Context) throw micFailure(named('NotSupportedError','Microphone or Web Audio unavailable'),'open','unsupported');
    if (doc?.hidden) throw micFailure(named('InvalidStateError','Document is not visible'),'open','inactive');
    const policy = doc?.permissionsPolicy || doc?.featurePolicy;
    if (policy?.allowsFeature && !policy.allowsFeature('microphone')) throw micFailure(named('NotAllowedError','Microphone disabled by Permissions Policy'),'open','policy');
    if (current) throw micFailure(named('InvalidStateError','Another recording owns the microphone'),'open','in-use');
    if (requests.size) throw micFailure(named('InvalidStateError','Previous permission request has not settled'),'open','pending');

    const previousMode = sessionType(), attempts = [], removers = [], handlers = new Set();
    let stream,context,source,processor,gain,closed = false,ready = false,stage = 'session',watchdog,mutedAt = null,lastFrame = now(),resuming = null;
    let rejectCancelled;
    const cancelled = new Promise((_,reject) => { rejectCancelled = reject; });
    cancelled.catch(() => {});
    const lease = current = {phase:'opening',context:null,stream:null,terminal:null,generation:++generation};
    log('opening');
    const listenEvent = (target,name,fn) => {
      target?.addEventListener?.(name,fn);
      removers.push(() => target?.removeEventListener?.(name,fn));
    };
    function restore() {
      if (active() || generation !== lease.generation) return;
      try { if (nav?.audioSession && ['auto','playback'].includes(previousMode)) nav.audioSession.type = previousMode; } catch {}
    }
    function close(error,notify = false) {
      if (closed) return;
      closed = true;
      if (current === lease) current = null;
      clock.clearInterval(watchdog);
      for (const remove of removers.splice(0)) { try { remove(); } catch {} }
      if (processor) processor.onaudioprocess = null;
      for (const node of [processor,source,gain]) { try { node?.disconnect(); } catch {} }
      stopTracks(stream);
      void closeContext(context).then(restore);
      const reason = error || micFailure(named('AbortError','Microphone request cancelled'),'close','cancelled');
      lease.terminal = reason;
      rejectCancelled(reason);
      log('closed',{code:reason.code,reason:reason.reason});
      if (notify && ready) {
        for (const handler of [onError,...handlers]) { try { handler?.(reason); } catch {} }
      }
      handlers.clear();
    }
    const fail = (error,where = stage,code) => { const failure = micFailure(error,where,code); close(failure,true); return failure; };
    const check = () => { if (closed) throw lease.terminal; };
    const wait = promise => Promise.race([promise,cancelled]);
    listenEvent(signal,'abort',() => close());
    listenEvent(doc,'visibilitychange',() => { if (doc.hidden) fail(named('AbortError','Page hidden'),'visibility','interrupted'); });
    listenEvent(win,'pagehide',() => fail(named('AbortError','Page closed'),'visibility','interrupted'));

    function newContext() {
      // Use the hardware's preferred rate everywhere; the callers resample PCM to 16 kHz themselves.
      context = lease.context = new Context();
      // Called synchronously in the initiating tap. A pending resume must not block the permission prompt.
      try { Promise.resolve(context.resume?.()).catch(error => log('early-resume',{reason:error.name})); } catch {}
    }
    async function ensureRunning() {
      if (context.state === 'running') return;
      await wait(bounded(Promise.resolve().then(() => context.resume()),resumeMs,
        micFailure(named('TimeoutError','AudioContext did not resume'),'resume','audio')));
      check();
      if (context.state !== 'running') throw micFailure(named('InvalidStateError','AudioContext is not running'),'resume','audio');
    }
    function resume() {
      if (closed) return Promise.resolve(false);
      if (!resuming) resuming = ensureRunning().then(() => true,error => { if (!closed) fail(error,'resume','interrupted'); return false; })
        .finally(() => { resuming = null; });
      return resuming;
    }
    async function request(constraints) {
      check();
      recording(); // Before EVERY attempt, while the opening lease is already protected from playback.
      log('request',{mode:sessionType()});
      const token = {};
      requests.add(token);
      let raw;
      try { raw = nav.mediaDevices.getUserMedia({audio:constraints}); }
      catch (error) { requests.delete(token); throw error; }
      const result = Promise.resolve(raw).then(value => {
        requests.delete(token);
        if (closed) { stopTracks(value); restore(); throw micFailure(named('AbortError','Late microphone discarded'),'capture','cancelled'); }
        return value;
      },error => { requests.delete(token); restore(); throw error; });
      return wait(bounded(result,permissionMs,micFailure(named('TimeoutError','Microphone permission or start timed out'),'capture','timeout')));
    }
    try {
      recording();
      stage = 'context'; newContext();
      stage = 'capture';
      try { stream = await request(VOICE); }
      catch (error) {
        attempts.push({stage,reason:error.reason || error.name,message:error.message});
        check();
        if (!RETRY.has(error.name) && !(error.name === 'InvalidStateError' && /AudioSession|category/i.test(error.message))) throw error;
        await wait(closeContext(context));
        context = lease.context = null;
        stream = await request(true);
      }
      check();
      lease.stream = stream;
      if (!stream?.getTracks?.().some(track => track.kind !== 'video' && track.readyState === 'live')) throw named('NotFoundError','No live audio track returned');
      stage = 'context';
      if (!context) newContext();
      stage = 'source';
      try { source = context.createMediaStreamSource(stream); }
      catch (error) {
        attempts.push({stage,reason:error.name,message:error.message});
        await wait(closeContext(context)); check();
        stage = 'context'; newContext();
        stage = 'source'; source = context.createMediaStreamSource(stream);
      }
      stage = 'resume'; await ensureRunning(); check();
      for (const track of stream.getTracks()) {
        listenEvent(track,'ended',() => fail(named('NotReadableError','Microphone track ended'),'track','interrupted'));
        listenEvent(track,'mute',() => { mutedAt ??= now(); log('muted'); });
        listenEvent(track,'unmute',() => { mutedAt = null; lastFrame = now(); log('unmuted'); });
      }
      listenEvent(context,'statechange',() => {
        if (!closed && context.state !== 'running') void resume();
      });
      ready = true; lease.phase = 'ready';
      log('ready',{sampleRate:context.sampleRate,mode:sessionType()});
      const input = {
        context,stream,source,
        get closed() { return closed; },
        close:() => close(),resume,
        onFailure(handler) { handlers.add(handler); return () => handlers.delete(handler); },
        listen(handler) {
          check();
          if (processor) throw new Error('Input already has an audio processor');
          try {
            processor = context.createScriptProcessor(context.sampleRate <= 24000 ? 1024 : 2048,1,1);
            gain = context.createGain(); gain.gain.value = 0;
            processor.onaudioprocess = event => {
              if (closed) return;
              lastFrame = now();
              try { handler(event.inputBuffer.getChannelData(0)); } catch (error) { fail(error,'processor','audio'); }
            };
            source.connect(processor); processor.connect(gain); gain.connect(context.destination);
            lastFrame = now();
            watchdog = clock.setInterval(() => {
              if (closed) return;
              if (stream.getTracks().some(track => track.readyState !== 'live')) { fail(named('NotReadableError','Microphone track ended'),'track','interrupted'); return; }
              const muted = stream.getTracks().some(track => track.muted);
              if (muted) mutedAt ??= now(); else mutedAt = null;
              if ((mutedAt !== null && now()-mutedAt >= muteMs) || now()-lastFrame >= stalledMs) {
                fail(named('NotReadableError','Audio input stopped delivering frames'),'frames','interrupted'); return;
              }
              if (context.state !== 'running') void resume();
            },1000);
          } catch (error) { throw fail(error,'processor','audio'); }
        }
      };
      return input;
    } catch (error) {
      const failure = micFailure(error,stage);
      failure.attempts = [...attempts,{stage:failure.stage,reason:failure.reason,message:failure.message}];
      log('failure',{stage:failure.stage,code:failure.code,reason:failure.reason});
      close(failure);
      stopTracks(stream); // Abort may win after the request resolved but before its await continuation ran.
      throw failure;
    }
  }
  return {open,live:active,playback,diagnostics};
}

let local;
export function microphoneController() {
  // Query-string module variants still coordinate through a single controller for this window.
  if (typeof window === 'object') {
    const key = Symbol.for('norsk.microphone.controller.v1');
    const controller = window[key] ||= createMicrophoneController();
    window.NorskMicrophone = controller;
    return controller;
  }
  return local ||= createMicrophoneController();
}
export const openInput = options => microphoneController().open(options);
