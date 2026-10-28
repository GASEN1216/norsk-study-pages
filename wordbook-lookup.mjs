// Fills in what a learner's own entry can be given automatically: IPA, syllables, part of speech
// and gender from the textbook lists and the NB Uttale lexicon, plus textbook meanings that are only
// ever offered as suggestions. Built by scripts/build_wordbook_lookup.py; no DOM here, so checks run in Node.
export const SHARD_COUNT = 256;
export const TOKEN = /(?:[\p{L}]+|\d+)(?:[-'’][\p{L}]+)*/gu;
const ARTICLES = new Set(['en','ei','et','å']);
const POS = {NN:'名词',VB:'动词',JJ:'形容词',AB:'副词',PP:'介词',PN:'代词',RG:'数词',RO:'序数词',IN:'感叹词',KN:'连词',DT:'限定词',IE:'不定式标记',PM:'专有名词'};
const ARTICLE_FOR = {m:'en',f:'ei','m/f':'en/ei',n:'et'};

export const lookupKey = value => String(value ?? '').normalize('NFC').replace(/[’`´]/g,"'").replace(/\s+/g,' ').trim().toLocaleLowerCase('nb');
export function shardOf(key) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(key)) hash = Math.imul(hash ^ byte,0x01000193) >>> 0;
  return hash % SHARD_COUNT;
}
export function parseShard(text) {
  const words = new Map();
  // A checkout may have turned the shards' line endings into CRLF; the content is the same.
  for (const line of String(text).split(/\r?\n/)) {
    const [key,...variants] = line.split('\t');
    if (!key || !variants.length) continue;
    words.set(key,variants.map(variant => {
      const [ipa,codes = ''] = variant.split('|');
      return {ipa,codes:codes ? codes.split(',') : []};
    }));
  }
  return words;
}
// The same rule the textbook lists use for words without reviewed syllables: split between vowel
// groups, keeping common onset clusters (skj, kj, sj, st, tr …) with the following syllable.
const CLUSTERS = ['skj','kj','sj','sk','st','sp','tr','dr','br','pr','fr','gr','kr','kl','gl','pl','bl'];
export function splitWord(word) {
  const lower = word.toLocaleLowerCase('nb');
  const vowels = [...lower.matchAll(/ei|ai|øy|au|oi|ui|eu|[aeiouyæøåéèêóòôü]/g)];
  const cuts = [];
  for (let i = 0; i < vowels.length-1; i++) {
    const start = vowels[i].index+vowels[i][0].length, end = vowels[i+1].index, gap = lower.slice(start,end);
    const cluster = CLUSTERS.find(item => gap.endsWith(item));
    cuts.push(gap.length <= 1 ? start : cluster ? end-(cluster === 'skj' ? 3 : 2) : end-1);
  }
  let result = word;
  for (const cut of cuts.reverse()) if (cut > 0 && cut < word.length) result = result.slice(0,cut)+'·'+result.slice(cut);
  return result;
}
export const syllabify = text => String(text).replace(TOKEN,token => /^\d+$/.test(token) ? token : token.split('-').map(splitWord).join('-'));
const bareIPA = value => String(value || '').trim().replace(/^\/|\/$/g,'');
// Reviewed syllables are stored in lower case; put their breaks into the learner's own spelling.
function withBreaks(word,syllables) {
  const breaks = [];
  let letters = 0;
  for (const char of String(syllables)) { if (char === '·') breaks.push(letters); else letters++; }
  if (letters !== word.length || String(syllables).replace(/·/g,'').toLocaleLowerCase('nb') !== word.toLocaleLowerCase('nb')) return '';
  let result = '';
  [...word].forEach((char,index) => { if (breaks.includes(index)) result += '·'; result += char; });
  return result;
}

// Chooses what the form fills in by itself: a part of speech only when the lexicon has one reading.
export function lexiconFacts(variants) {
  const codes = [...new Set((variants || []).flatMap(variant => variant.codes))];
  const real = codes.filter(code => !code.startsWith('PM'));
  const choices = (real.length ? real : codes).map(code => { const [pos,gender = ''] = code.split('.'); return {pos:POS[pos] || '',gender}; }).filter(choice => choice.pos);
  const distinct = [...new Map(choices.map(choice => [choice.pos,choice])).values()];
  return {ipa:variants?.[0]?.ipa || '',choices:distinct,pos:distinct.length === 1 ? distinct[0].pos : '',gender:distinct.length === 1 ? distinct[0].gender : ''};
}

// Phrase syllables from a reviewed entry ("god mor·gen"), placed into the learner's spelling and case.
function recase(value,syllables) {
  const pieces = String(syllables).match(/[^\s]+/g) || [], tokens = value.match(TOKEN) || [];
  const words = pieces.map(piece => piece.match(/[\p{L}·'’-]+|\d+/u)?.[0] || '').filter(Boolean);
  if (words.length !== tokens.length) return '';
  let index = 0, failed = false;
  const result = value.replace(TOKEN,word => { const broken = withBreaks(word,words[index++]); if (!broken) failed = true; return broken || word; });
  return failed ? '' : result;
}

export function createWordbookLookup({loadJSON,fetchText,version = ''}) {
  const shards = new Map();
  let hintsPromise;
  const hints = () => hintsPromise ||= loadJSON('wordbook-hints','data/wordbook-hints.json').then(data => data?.entries || {}).catch(error => { hintsPromise = null; throw error; });
  function shard(index) {
    if (!shards.has(index)) {
      const name = index.toString(16).padStart(2,'0');
      const request = fetchText(`data/lexicon/${name}.tsv${version ? `?v=${encodeURIComponent(version)}` : ''}`).then(parseShard);
      request.catch(() => shards.delete(index));
      shards.set(index,request);
    }
    return shards.get(index);
  }
  async function lexicon(key) { return (await shard(shardOf(key))).get(key) || null; }
  async function token(word,entries) {
    const key = lookupKey(word);
    const hint = (entries[key] || []).find(item => item.i);
    if (hint) return {key,ipa:bareIPA(hint.i),syllables:withBreaks(word,hint.s || ''),source:hint.src.startsWith('基础常识') ? 'basics' : 'textbook'};
    const variants = await lexicon(key);
    // A lower-case spelling found only as a name ("huus" → Huus) is more likely a typo than a name.
    const nameOnly = variants && word === word.toLocaleLowerCase('nb') && variants.every(variant => variant.codes.length && variant.codes.every(code => code === 'PM'));
    return variants ? {key,ipa:variants[0].ipa,syllables:'',source:'nb-uttale',variants,nameOnly} : {key,ipa:'',syllables:'',source:'',missing:!/^\d+$/.test(key)};
  }
  // Everything the form can say about one spelling. Meanings are suggestions with their source.
  async function describe(text) {
    const value = String(text ?? '').normalize('NFC').trim();
    const key = lookupKey(value);
    const result = {key,ipa:'',ipaSource:'',syllables:'',syllablesSource:'',pos:'',gender:'',article:'',posSource:'',choices:[],meanings:[],missing:[],nameOnly:[],tokens:0};
    if (!key) return result;
    const entries = await hints();
    const words = value.match(TOKEN) || [];
    result.tokens = words.length;
    // "et hus" and "å bo" are looked up as the word after the article.
    const head = words.length === 2 && ARTICLES.has(lookupKey(words[0])) ? lookupKey(words[1]) : '';
    const own = entries[key] || [], related = !own.length && head ? entries[head] || [] : [];
    const known = own.length ? own : related;
    result.meanings = [...new Map(known.map(item => [item.m,{text:item.m,source:item.src}])).values()].slice(0,4);
    // Textbook facts are filled in only when every listing agrees (skje: 发生 动词 / 勺子 名词 does not).
    const readings = [...new Map(known.filter(item => item.p).map(item => [item.p,{pos:item.p,gender:own.length ? item.g || '' : '',article:own.length ? item.a || '' : '',src:item.src}])).values()];
    result.choices = readings.map(({pos,gender}) => ({pos,gender}));
    if (readings.length === 1) {
      Object.assign(result,{pos:readings[0].pos,gender:readings[0].gender,article:readings[0].article});
      result.posSource = readings[0].src.startsWith('基础常识') ? 'basics' : 'textbook';
    }
    const whole = own.find(item => item.i);
    if (whole) {
      result.ipa = whole.i.startsWith('/') ? whole.i : `/${whole.i}/`;
      result.ipaSource = whole.src.startsWith('基础常识') ? 'basics' : 'textbook';
      const reviewed = /^\d+$/.test(key) ? '' : recase(value,whole.s || '');
      result.syllables = reviewed || syllabify(value); result.syllablesSource = reviewed ? result.ipaSource : 'rule';
      return result;
    }
    const parts = await Promise.all(words.map(word => token(word,entries)));
    result.missing = [...new Set(parts.filter(part => part.missing).map(part => part.key))];
    result.nameOnly = parts.filter(part => part.nameOnly).map(part => part.key);
    if (words.length === 1 && parts[0]?.variants) {
      const lexical = lexiconFacts(parts[0].variants);
      if (!result.choices.length) result.choices = lexical.choices;
      if (!result.pos && lexical.pos && !result.nameOnly.length) { result.pos = lexical.pos; result.gender = lexical.gender; result.posSource = 'nb-uttale'; }
      if (!result.article && result.pos === '名词' && result.gender) result.article = ARTICLE_FOR[result.gender] || '';
    }
    if (parts.length && !result.missing.length && parts.every(part => part.ipa)) {
      result.ipa = `/${parts.map(part => part.ipa).join(' ')}/`;
      const sources = new Set(parts.map(part => part.source));
      result.ipaSource = sources.size === 1 ? [...sources][0] : 'mixed';
    }
    if (words.length) {
      let index = 0;
      result.syllables = value.replace(TOKEN,word => { const part = parts[index++]; return part?.syllables || (/^\d+$/.test(word) ? word : word.split('-').map(splitWord).join('-')); });
      result.syllablesSource = parts.every(part => part.syllables) ? (parts[0]?.source || 'textbook') : 'rule';
    }
    return result;
  }
  return {describe,hints,lexicon};
}
