// Local, approximate word verification for the chase game. Audio never goes to a recognition service.
import {openInput,micFailure} from './microphone.mjs?v=20261115-local-reading';
import {to16k} from './chase-speech.mjs?v=20261115-local-reading';
import {createDataLoader} from './loader.mjs?v=20261115-local-reading';
export {micHelp,micMessage} from './microphone.mjs?v=20261115-local-reading';
const data={},load=createDataLoader(data,{timeout:12000}),version='20261115-local-reading';
export const supported=()=>Boolean(globalThis.navigator?.mediaDevices?.getUserMedia&&(globalThis.window?.AudioContext||globalThis.window?.webkitAudioContext)&&globalThis.Worker);
export const isReady=()=>Boolean(data.references?.schema===1);
export async function prepare() {
  const manifest=await load('references',new URL(`./data/reading-acoustics/index.json?v=${version}`,import.meta.url).href);
  if(manifest.schema!==1||manifest.algorithm!=='mfcc13-cosine-dtw-v1'||manifest.count<1){delete data.references;throw new Error('Acoustic reference version mismatch');}
  return true;
}
export async function openMic(options={}) {
  const input=await openInput({signal:options.signal});
  try{return await createLocalListener(input,options);}catch(error){input.close();throw error;}
}
export async function createLocalListener(input,{signal,onError,onState,workerFactory=()=>new Worker(new URL(`./reading-worker.mjs?v=${version}`,import.meta.url),{type:'module'})}={}) {
  let worker,closed=false,opened=false,on=false,held=false,epoch=0,target=null,pass=null,level=null,expect=null,lastPassed=null,timer;
  let resolveReady,rejectReady;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});ready.catch(()=>{});
  const stats={passes:0,ms:0,slowest:0,failed:0};
  const cancelled=()=>micFailure(new DOMException('Recording cancelled','AbortError'),'worker','cancelled');
  function close(error=cancelled()) {
    if(closed)return;closed=true;on=false;clearTimeout(timer);signal?.removeEventListener('abort',abort);
    if(worker){worker.onmessage=worker.onerror=worker.onmessageerror=null;worker.terminate();}
    input.close();rejectReady(error);
  }
  function fail(error){const notify=opened;const reason=error?.micFailure?error:micFailure(error,'worker','audio');close(reason);if(notify)onError?.(reason);}
  const abort=()=>close();
  const send=message=>{if(!closed)worker.postMessage(message);};
  function reset(){epoch++;target=null;send({type:'target',epoch,target:null});}
  function updateTarget() {
    const next=expect?.();
    if(!next?.id){if(target)reset();return;}
    if(next.id===target?.id&&next.clip===target?.clip)return;
    target=next;epoch++;send({type:'target',epoch,target:{id:next.id,clip:next.clip||''},next:next.next||[]});
  }
  try {
    worker=workerFactory();
    worker.onmessage=({data:message})=>{
      if(closed)return;
      if(message.type==='ready'){clearTimeout(timer);resolveReady();return;}
      if(!on||held||!target||message.epoch!==epoch||message.id!==target.id||expect?.()?.id!==target.id)return;
      if(message.type==='state'){onState?.(message.state);return;}
      if(message.type!=='result')return;
      stats.passes++;stats.ms+=message.computeMs||0;stats.slowest=Math.max(stats.slowest,message.computeMs||0);
      if(!message.accepted){stats.failed++;onState?.('retry');return;}
      if(lastPassed===target.id)return;lastPassed=target.id;
      pass?.(target.text,{local:true,id:target.id,score:message.score,ms:message.computeMs});
      updateTarget();
    };
    worker.onerror=()=>fail(new Error('Local audio worker failed'));
    worker.onmessageerror=()=>fail(new Error('Local audio message could not be decoded'));
    timer=setTimeout(()=>fail(new Error('Local audio worker did not start')),8000);
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)throw cancelled();
    input.onFailure(fail);
    input.listen(block=>{
      if(!on||held||closed)return;
      let sum=0;for(const value of block)sum+=value*value;level?.(Math.sqrt(sum/Math.max(1,block.length)));
      updateTarget();if(!target)return;
      const samples=to16k(block,input.context.sampleRate);
      worker.postMessage({type:'audio',epoch,samples},[samples.buffer]);
    });
    await ready;if(closed)throw cancelled();opened=true;
  }catch(error){close(error);throw error?.micFailure?error:micFailure(error,'worker','audio');}
  return {
    stats,get closed(){return closed||input.closed;},close,
    start(onPass,onLevel,expected){pass=onPass;level=onLevel;expect=expected;on=true;held=false;reset();updateTarget();void input.resume();},
    pause(){on=false;reset();},resume(){if(closed)return;on=true;reset();updateTarget();void input.resume();},
    hold(){held=true;reset();},release(){if(closed)return;held=false;reset();if(on)updateTarget();},
    cut(){reset();if(on&&!held)updateTarget();},mark(){}
  };
}
