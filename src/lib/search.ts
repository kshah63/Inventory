/**
 * Word matching for the catalogue, shared by the browser-side filter and
 * mirroring what search_catalogue() does in Postgres (migration 0012):
 * every word has to appear somewhere, in any order, with a trailing "s"
 * forgiven. Typing "pen blue" and "blue pen" must find the same thing.
 */

/** Split what someone typed into words. Punctuation separates, so
 * "A4 paper (ream)" and "a4 ream paper" come out as the same set. */
export function queryWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Everything worth searching an item by, as one lowercase string. */
export function searchableText(
  item: { name: string; sku: string },
  aliases: string[] = []
): string {
  return [item.name, item.sku, ...aliases].join(" ").toLowerCase();
}

/** True when every word appears in the text, in any order. */
export function matchesWords(text: string, words: string[]): boolean {
  return words.every((word) => {
    if (text.includes(word)) return true;
    // "pens" should find "pen" — but only for words long enough that
    // dropping a letter can't turn them into something else.
    return word.length >= 4 && word.endsWith("s") && text.includes(word.slice(0, -1));
  });
}

/** How well an item answers the query, for ordering results. Higher is
 * better: the whole phrase in the name beats every word in the name, which
 * beats a match that only came from the code or an alias. */
export function relevance(
  item: { name: string },
  haystack: string,
  query: string,
  words: string[]
): number {
  const name = item.name.toLowerCase();
  const phrase = query.trim().toLowerCase();
  if (phrase && name.includes(phrase)) return 3;
  if (matchesWords(name, words)) return 2;
  return haystack ? 1 : 0;
}
