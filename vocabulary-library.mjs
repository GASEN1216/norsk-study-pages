// Index and chapter caches are scoped by series, even if two books reuse IDs.
export function createVocabularyLibrary(loadData) {
  async function series() {
    const library = await loadData('vocabulary-library');
    if (!Array.isArray(library?.series)) throw new Error('词表书库格式无效');
    return library.series;
  }
  async function descriptor(seriesId) {
    const item = (await series()).find(item => item.id === seriesId);
    if (!item?.index || !item.bookId) throw new Error('这套教材的单词表尚未收录');
    return item;
  }
  async function index(seriesId) {
    const item = await descriptor(seriesId);
    const result = await loadData(`vocabulary-index:${seriesId}`,item.index);
    if (!Array.isArray(result?.chapters)) throw new Error('词表目录格式无效');
    return result;
  }
  async function chapter(seriesId,id) {
    const vocabulary = await index(seriesId);
    const selected = vocabulary.chapters.find(item => String(item.id) === String(id) || (item.sections || []).some(section => String(section.id) === String(id)));
    if (!selected || Array.isArray(selected.words)) return selected;
    if (!selected.file) throw new Error('本章词语文件尚未准备好');
    const content = await loadData(`vocabulary-chapter:${seriesId}:${selected.id}`,selected.file);
    Object.assign(selected,content);
    return selected;
  }
  async function allChapters(seriesId) {
    const vocabulary = await index(seriesId);
    await Promise.all(vocabulary.chapters.map(item => chapter(seriesId,item.id)));
    return vocabulary;
  }
  return {series,descriptor,index,chapter,allChapters};
}
