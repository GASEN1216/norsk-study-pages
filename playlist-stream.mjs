// Joins lesson recordings into one continuous MP3. A phone keeps playing a single file while the page sleeps, but a
// sleeping page cannot start the next file, so a playlist played as one recording goes on by itself.
// Every lesson file shares one encoding (MPEG-1 Layer III, 44.1 kHz mono); a file that does not match ends the join.

const BITRATES = {
  1:[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320],
  2:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
};
const SAMPLE_RATES = {3:[44100,48000,32000],2:[22050,24000,16000],0:[11025,12000,8000]};
// An MP3 decoder's output trails its input by this many samples.
const DECODER_DELAY = 529;

function frameAt(bytes,at) {
  if (bytes[at] !== 0xff || (bytes[at+1] & 0xe0) !== 0xe0) return null;
  const version = (bytes[at+1] >> 3) & 3, layer = (bytes[at+1] >> 1) & 3;
  const bitrateIndex = bytes[at+2] >> 4, rateIndex = (bytes[at+2] >> 2) & 3;
  if (version === 1 || layer !== 1 || !bitrateIndex || bitrateIndex === 15 || rateIndex === 3) return null;
  const mpeg1 = version === 3;
  const bitrate = BITRATES[mpeg1 ? 1 : 2][bitrateIndex]*1000, sampleRate = SAMPLE_RATES[version][rateIndex];
  const mono = bytes[at+3] >> 6 === 3, padding = (bytes[at+2] >> 1) & 1;
  return {
    sampleRate, mono, samples:mpeg1 ? 1152 : 576,
    size:Math.floor((mpeg1 ? 144 : 72)*bitrate/sampleRate)+padding,
    sideInfo:mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17),
  };
}
// The first frame may hold an Info/Xing header instead of sound; its LAME extension gives the encoder delay.
function infoDelay(bytes,at,frame) {
  const tag = at+4+frame.sideInfo;
  const name = String.fromCharCode(...bytes.subarray(tag,tag+4));
  if (name !== 'Info' && name !== 'Xing') return null;
  const flags = (bytes[tag+4] << 24 | bytes[tag+5] << 16 | bytes[tag+6] << 8 | bytes[tag+7]) >>> 0;
  let field = tag+8;
  if (flags & 1) field += 4;
  if (flags & 2) field += 4;
  if (flags & 4) field += 100;
  if (flags & 8) field += 4;
  return field+24 <= at+frame.size ? (bytes[field+21] << 4) | (bytes[field+22] >> 4) : 0;
}

// Returns the sound frames of one MP3 file without its tags and Info header.
export function readMp3(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let at = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    at = 10+((bytes[6] & 127) << 21 | (bytes[7] & 127) << 14 | (bytes[8] & 127) << 7 | (bytes[9] & 127))+(bytes[5] & 0x10 ? 10 : 0);
  }
  let end = bytes.length;
  if (end-128 >= at && bytes[end-128] === 0x54 && bytes[end-127] === 0x41 && bytes[end-126] === 0x47) end -= 128;
  let first = -1, format = null, frames = 0, delay = 0;
  while (at+4 <= end) {
    const frame = frameAt(bytes,at);
    if (!frame || at+frame.size > end) {
      // Leading junk is skipped byte by byte; after the sound starts, anything else ends it.
      if (first < 0 && at+4 < end) { at++; continue; }
      break;
    }
    if (first < 0) {
      format = frame;
      const encoderDelay = infoDelay(bytes,at,frame);
      first = encoderDelay == null ? at : at+frame.size;
      delay = encoderDelay || 0;
      at = first;
      continue;
    }
    if (frame.sampleRate !== format.sampleRate || frame.mono !== format.mono) break;
    frames++;
    at += frame.size;
  }
  if (!format || !frames) return null;
  return {
    audio:bytes.subarray(first,at), frames, sampleRate:format.sampleRate, mono:format.mono,
    duration:frames*format.samples/format.sampleRate, lead:(delay+DECODER_DELAY)/format.sampleRate,
  };
}

// Loads pieces ({id, url}) in order and joins them until one fails, changes encoding or passes maxBytes.
// Each section gives its span in the joined recording (start–end) and where its own clock starts (offset).
export async function joinRecordings(pieces,{load,maxBytes = Infinity,parallel = 3} = {}) {
  const pending = new Map();
  const fetchPiece = index => {
    if (index < pieces.length && !pending.has(index)) pending.set(index,Promise.resolve().then(() => load(pieces[index].url)).then(readMp3,() => null));
    return pending.get(index);
  };
  const parts = [], sections = [];
  let format = null, bytes = 0, time = 0;
  for (let index = 0; index < pieces.length; index++) {
    for (let ahead = index; ahead < index+parallel; ahead++) fetchPiece(ahead);
    const piece = await fetchPiece(index);
    pending.delete(index);
    if (!piece || (format && (piece.sampleRate !== format.sampleRate || piece.mono !== format.mono))) break;
    if (parts.length && bytes+piece.audio.length > maxBytes) break;
    format ||= piece;
    parts.push(piece.audio);
    sections.push({id:String(pieces[index].id),start:time,end:time+piece.duration,offset:time+piece.lead});
    bytes += piece.audio.length;
    time += piece.duration;
  }
  return {blob:new Blob(parts,{type:'audio/mpeg'}),sections,bytes,duration:time,complete:sections.length === pieces.length};
}
