import {createWordGate,decodeReference,referenceShard} from './reading-acoustics.mjs?v=20261115-local-reading';
import {createDataLoader} from './loader.mjs?v=20261115-local-reading';

export function createReferenceStore({fetcher=globalThis.fetch,base=new URL('./data/reading-acoustics/',import.meta.url),limit=12}={}) {
  const cache={},load=createDataLoader(cache,{timeout:12000,fetcher}),recent=new Map();
  async function get(clip) {
    if(typeof clip!=='string'||!clip||clip.length>300)return null;
    const key=referenceShard(clip),data=await load(key,new URL(`${key}.json?v=20261115-local-reading`,base).href);
    recent.delete(key);recent.set(key,true);
    while(recent.size>limit){const oldest=recent.keys().next().value;recent.delete(oldest);delete cache[oldest];}
    return Object.hasOwn(data,clip)?decodeReference(data[clip]):null;
  }
  return {get};
}

export function createReadingEngine({references=createReferenceStore(),post=()=>{}}={}) {
  let epoch=0,target=null,reference=null,accepted=false,disposed=false;
  const gate=createWordGate({reference:()=>reference,onLongSpeech:()=>post({type:'state',epoch,id:target?.id,state:'pause-between'}),
    onResult:result=>{
      if(!target||accepted||disposed)return;
      if(result.accepted)accepted=true;
      post({type:'result',epoch,id:target.id,...result});
    }});
  function receive(message) {
    if(disposed)return;
    if(message.type==='target') {
      epoch=message.epoch;target=message.target;reference=null;accepted=false;gate.reset();
      if(!target)return;
      const own=target,ownEpoch=epoch;
      post({type:'state',epoch,id:own.id,state:'loading'});
      void references.get(own.clip).then(value=>{
        if(disposed||target!==own||epoch!==ownEpoch)return;
        reference=value;gate.reset();post({type:'state',epoch,id:own.id,state:value?'ready':'missing'});
      },()=>{if(!disposed&&target===own&&epoch===ownEpoch)post({type:'state',epoch,id:own.id,state:'unavailable'});});
      for(const clip of [...new Set(message.next||[])].slice(0,4))void references.get(clip).catch(()=>{});
    }else if(message.type==='audio'&&message.epoch===epoch&&target&&reference&&!accepted)gate.feed(message.samples);
  }
  return {receive,close(){disposed=true;reference=target=null;gate.reset();}};
}

if(typeof self==='object'&&typeof document==='undefined'&&typeof self.postMessage==='function') {
  const engine=createReadingEngine({post:message=>self.postMessage(message)});
  self.onmessage=event=>engine.receive(event.data);
  self.postMessage({type:'ready'});
}
