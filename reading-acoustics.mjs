// Small, deterministic acoustic comparison. This is approximate word practice, not speech transcription.
// Kept identical to scripts/benchmark_reading_acoustics.py; no network, audio device, or DOM access here.
export const ACOUSTIC_VERSION = 1;
export const THRESHOLD = 0.404496952466291;
const SIZE = 512, FRAME = 400, HOP = 160, BANDS = 26, COEFFICIENTS = 13;
const hamming = Float64Array.from({length:FRAME},(_,i) => .54-.46*Math.cos(2*Math.PI*i/(FRAME-1)));
const edges = Float64Array.from({length:28},(_,i) => {
  const low = 2595*Math.log10(1+80/700), high = 2595*Math.log10(1+7600/700);
  return 700*(10**((low+(high-low)*i/27)/2595)-1);
});
const bank = Array.from({length:BANDS},(_,j) => Float64Array.from({length:257},(_,i) =>
  Math.max(0,Math.min((i*16000/SIZE-edges[j])/(edges[j+1]-edges[j]),(edges[j+2]-i*16000/SIZE)/(edges[j+2]-edges[j+1])))));
const dct = Array.from({length:COEFFICIENTS},(_,j) => Float64Array.from({length:BANDS},(_,i) => Math.cos(Math.PI/BANDS*(i+.5)*(j+1))));
function power(frame) {
  const real = new Float64Array(SIZE), imaginary = new Float64Array(SIZE);
  for (let i=0;i<FRAME;i++) real[i]=(frame[i]-(i ? .97*frame[i-1] : 0))*hamming[i];
  for (let i=1,j=0;i<SIZE;i++) {
    let bit=SIZE>>1; for (;j&bit;bit>>=1) j^=bit; j^=bit;
    if(i<j) [real[i],real[j]]=[real[j],real[i]];
  }
  for(let length=2;length<=SIZE;length<<=1) {
    const angle=-2*Math.PI/length, wr=Math.cos(angle), wi=Math.sin(angle);
    for(let from=0;from<SIZE;from+=length) {
      let ur=1,ui=0;
      for(let j=0;j<length/2;j++) {
        const a=from+j,b=a+length/2,vr=real[b]*ur-imaginary[b]*ui,vi=real[b]*ui+imaginary[b]*ur;
        real[b]=real[a]-vr;imaginary[b]=imaginary[a]-vi;real[a]+=vr;imaginary[a]+=vi;
        const next=ur*wr-ui*wi;ui=ur*wi+ui*wr;ur=next;
      }
    }
  }
  return real.slice(0,257).map((v,i)=>v*v+imaginary[i]*imaginary[i]);
}
export function acousticFeatures(samples) {
  if (!samples || samples.length<FRAME || samples.length>16000*8 || !samples.every(Number.isFinite)) return [];
  const count=Math.floor((samples.length-FRAME)/HOP)+1, energy=new Float64Array(count);
  for(let i=0;i<count;i++) { let sum=0;for(let j=0;j<FRAME;j++)sum+=samples[i*HOP+j]**2;energy[i]=Math.sqrt(sum/FRAME); }
  const floor=Math.max(.003,Math.max(...energy)*.06), active=[];
  for(let i=0;i<count;i++)if(energy[i]>floor)active.push(i);
  if(active.length<3)return [];
  const first=Math.max(0,active[0]-2),end=Math.min(count,active.at(-1)+3), result=[];
  for(let i=first;i<end;i++) {
    const spectrum=power(samples.subarray(i*HOP,i*HOP+FRAME));
    const logs=bank.map(weights=>Math.log(Math.max(1e-12,weights.reduce((sum,w,k)=>sum+w*spectrum[k],0))));
    const row=dct.map(weights=>weights.reduce((sum,w,k)=>sum+w*logs[k],0));
    const norm=Math.max(1e-8,Math.hypot(...row));result.push(row.map(v=>v/norm));
  }
  // Match numpy.linspace's step multiplication (and explicit final endpoint), including integer-boundary rounding.
  return result.length<=75 ? result : Array.from({length:75},(_,i)=>i===74?result.at(-1):result[Math.floor(i*((result.length-1)/74))]);
}
export function acousticDistance(a,b) {
  if(!a?.length||!b?.length)return Infinity;
  let previous=new Float64Array(b.length+1).fill(Infinity);previous[0]=0;
  for(const frame of a) {
    const row=new Float64Array(b.length+1).fill(Infinity);
    for(let j=1;j<=b.length;j++) {
      const cost=Math.max(0,1-frame.reduce((sum,v,k)=>sum+v*b[j-1][k],0));
      row[j]=Math.min(previous[j]+cost,row[j-1]+cost,previous[j-1]+2*cost);
    }
    previous=row;
  }
  return previous[b.length]/(a.length+b.length);
}
export function decodeReference(value) {
  if(!Number.isInteger(value?.frames)||value.frames<3||value.frames>75||typeof value.data!=='string')throw new Error('Invalid acoustic reference');
  const binary=atob(value.data);
  if(binary.length!==value.frames*COEFFICIENTS)throw new Error('Invalid acoustic reference size');
  return Array.from({length:value.frames},(_,i)=>Array.from({length:COEFFICIENTS},(_,j)=>{
    const byte=binary.charCodeAt(i*COEFFICIENTS+j);return (byte>127?byte-256:byte)/127;
  }));
}
export function referenceShard(clip) {
  let hash=2166136261;
  for(let i=0;i<clip.length;i++)hash=Math.imul(hash^clip.charCodeAt(i),16777619);
  return (hash&255).toString(16).padStart(2,'0');
}

// One short utterance => at most one word. Re-arm only after a quiet boundary; sustained noise cannot advance a list.
export function createWordGate({reference,onResult,onLevel,onLongSpeech,quietMs=120,minimumVoiceMs=90,maximumMs=6000}={}) {
  let parts=[],length=0,voiced=0,quiet=0,lead=[],leadLength=0,blocked=false,noise=.004,peak=0;
  const clear=()=>{parts=[];length=voiced=quiet=peak=0;};
  const reset=()=>{clear();lead=[];leadLength=0;blocked=false;};
  function feed(block) {
    let sum=0;for(const v of block)sum+=v*v;
    const rms=Math.sqrt(sum/Math.max(1,block.length));onLevel?.(rms);
    if(!Number.isFinite(rms)){reset();return;}
    const ms=block.length/16,threshold=Math.max(.012,Math.min(.045,noise*3));
    const voice=rms>threshold;
    if(!voice)noise=noise*.97+rms*.03;
    if(blocked){if(!voice){quiet+=ms;if(quiet>=quietMs)reset();}else quiet=0;return;}
    if(voice){
      if(!parts.length&&lead.length){parts=lead.slice();length=leadLength;lead=[];leadLength=0;}
      parts.push(block.slice());length+=block.length;voiced+=ms;quiet=0;peak=Math.max(peak,rms);
    }else if(parts.length){parts.push(block.slice());length+=block.length;quiet+=ms;}
    else {lead.push(block.slice());leadLength+=block.length;while(leadLength>1600&&lead.length>1)leadLength-=lead.shift().length;}
    if(length/16>maximumMs){clear();blocked=true;onLongSpeech?.();return;}
    if(!parts.length||quiet<quietMs)return;
    const heard=voiced,ref=reference?.(),buffer=new Float32Array(length);let offset=0;
    for(const part of parts){buffer.set(part,offset);offset+=part.length;}
    const strength=peak;reset();
    if(heard<minimumVoiceMs||!ref)return;
    const started=typeof performance==='object'?performance.now():Date.now();
    const frames=acousticFeatures(buffer),score=acousticDistance(frames,ref);
    onResult?.({accepted:score<=THRESHOLD,score,voiceMs:heard,peak:strength,
      computeMs:(typeof performance==='object'?performance.now():Date.now())-started});
  }
  return {feed,reset};
}
