// Stable book IDs keep reading positions separate, even when chapter IDs overlap.
export function createReadingLibrary(catalog, storage) {
  const books = catalog.books;
  const series = catalog.series || [{id:'god-i-norsk',title:'God i norsk'}];
  const seriesFor = book => books[book]?.seriesId || 'god-i-norsk';
  const booksFor = id => Object.keys(books).filter(book => seriesFor(book) === id);
  const entries = book => (books[book]?.chapters || []).concat(books[book]?.appendices || []).flatMap(chapter => [chapter,...(chapter.sections || [])]);
  let saved = {};
  try { saved = JSON.parse(storage.getItem('norsk-reading-v2')) || {}; } catch {}
  const positions = Object.create(null), lastBooks = Object.create(null);
  function normalize(book, position) {
    const list = entries(book);
    const fallback = Number(list[0]?.page) || 1;
    const value = Number(position?.page);
    const page = Math.max(1,Math.min(books[book].pages,Number.isInteger(value) ? value : fallback));
    const selected = list.find(entry => String(entry.id) === String(position?.id));
    const closest = list.filter(entry => Number(entry.page) <= page).sort((a,b) => b.page-a.page)[0];
    return {page,id:String(selected?.id ?? closest?.id ?? '')};
  }
  for (const book of Object.keys(books)) {
    if (saved.positions?.[book]) positions[book] = normalize(book,saved.positions[book]);
  }
  for (const item of series) {
    const book = saved.lastBooks?.[item.id];
    if (books[book] && seriesFor(book) === item.id) lastBooks[item.id] = book;
  }
  let currentBook = books[saved.currentBook] ? saved.currentBook : Object.keys(books)[0];
  if (!Object.keys(positions).length) {
    try {
      const legacy = JSON.parse(storage.getItem('norsk-reading-v1'));
      if (legacy && books[legacy.book]) {
        currentBook = legacy.book;
        positions[currentBook] = normalize(currentBook,legacy);
      }
    } catch {}
  }
  lastBooks[seriesFor(currentBook)] = currentBook;
  const positionFor = book => ({...(positions[book] || normalize(book))});
  function remember(book, position, activate = true) {
    if (!books[book]) return;
    positions[book] = normalize(book,position);
    if (activate) { currentBook = book; lastBooks[seriesFor(book)] = book; }
    try {
      storage.setItem('norsk-reading-v2',JSON.stringify({currentBook,positions,lastBooks}));
      storage.setItem('norsk-reading-v1',JSON.stringify({book:currentBook,...positionFor(currentBook)}));
    } catch {}
  }
  return {series,seriesFor,booksFor,positionFor,remember,
    hasPosition: book => Object.hasOwn(positions,book),
    get currentBook() { return currentBook; },
    bookForSeries: id => lastBooks[id] || booksFor(id).find(book => books[book].kind === 'textbook') || booksFor(id)[0]};
}
