/* Pure selection semantics for an existing reader view. No DOM, network, playback or storage. */
const tokens = value => String(value ?? '').normalize('NFC').toLocaleLowerCase('nb').match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
const keyOf = value => tokens(value).join(' ');
const point = (section, value) => {
  if (!value || !Number.isInteger(value.s) || !Number.isInteger(value.w)
      || value.s < 0 || value.w < 0 || !section.sentences?.[value.s]?.words?.[value.w]) {
    throw new RangeError('Selection is outside the reader text');
  }
  return {s:value.s,w:value.w};
};

/**
 * Return a selected expression's meaning when an existing reviewed source supports it.
 * `translation` is null for a partial/unreviewed fragment: its full sentence is returned
 * separately as `context`, so callers cannot mistake a sentence translation for a phrase.
 * Word indexes are inclusive and may cross sentences. Neither input is mutated.
 */
export function resolveSelection(section, range, glossary = {}) {
  let from = point(section,range?.from), to = point(section,range?.to);
  if (from.s > to.s || (from.s === to.s && from.w > to.w)) [from,to] = [to,from];
  const words = [], context = [], selectedParts = [];
  let complete = true;
  for (let s = from.s; s <= to.s; s++) {
    const sentence = section.sentences[s];
    const first = s === from.s ? from.w : 0;
    const last = s === to.s ? to.w : sentence.words.length-1;
    if (first !== 0 || last !== sentence.words.length-1) complete = false;
    context.push({sentence:s,text:sentence.text,zh:sentence.zh || ''});
    selectedParts.push(sentence.text.slice(sentence.words[first][0],sentence.words[last][1]));
    for (let w = first; w <= last; w++) {
      const row = sentence.words[w], entry = section.lexicon?.[row[4]] || {};
      words.push({sentence:s,word:w,text:sentence.text.slice(row[0],row[1]),
        zh:row[5] || entry.zh || '',lemma:row[5] ? null : entry.lemma || null,
        pos:row[5] ? null : entry.pos || null,form:row[5] ? null : entry.form || null,
        start:row[2],end:row[3]});
    }
  }
  const text = selectedParts.join(' '), key = keyOf(text);
  let translation = null, source = 'context';
  const contextual = from.s === to.s && (glossary.contexts || []).find(entry =>
    entry.section === section.id && entry.sentence === context[0].text && keyOf(entry.text) === key
    && (entry.charStart == null || entry.charStart === section.sentences[from.s].words[from.w][0]));
  // A reader sentence row can itself contain several spoken sentences.
  const expression = from.s === to.s && !/[.!?;:\r\n]/u.test(text);
  if (contextual?.zh) { translation = contextual.zh; source = 'reviewed-context'; }
  else if (complete && context.every(sentence => sentence.zh)) {
    translation = context.map(sentence => sentence.zh).join('\n'); source = 'reviewed-sentence';
  } else if (expression && Object.hasOwn(glossary.phrases || {},key)) {
    translation = glossary.phrases[key]; source = 'reviewed-expression';
  } else if (words.length === 1 && words[0].zh) {
    translation = words[0].zh; source = 'word';
  }
  return {section:section.id,from,to,text,translation,source,context,words,
    audio:{file:section.audio,start:words[0].start,end:words.at(-1).end,original:!section.synthetic}};
}
