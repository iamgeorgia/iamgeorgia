import type { HelpArticle, HelpBlock, HelpRole } from "./types";

/**
 * Searching the manual, in the browser, with no server.
 *
 * Eighty articles of prose are a few hundred kilobytes of strings — far less
 * than one gallery image — so an index built once when this module loads
 * answers instantly and never goes stale against a copy on a server. The hub
 * imports this module lazily, on the first keystroke, so a reader who only
 * browses never downloads it.
 */

export interface HelpSearchEntry {
  id: string;
  title: string;
  summary: string;
  category: HelpArticle["category"];
  roles: HelpRole[];
  keywords: string;
  /** The section headings, joined: "cancel a leg" should find the board's "Cancelling a leg". */
  headings: string;
  /** Every sentence of every block, joined — what a body hit searches. */
  body: string;
}

export interface HelpSearchHit {
  entry: HelpSearchEntry;
  score: number;
  /** The first sentence of the body containing the first token, or the summary. */
  snippet: string;
}

const blockText = (block: HelpBlock): string => {
  switch (block.type) {
    case "paragraph":
    case "callout":
      return `${"title" in block && block.title ? `${block.title}. ` : ""}${block.text}`;
    case "heading":
      return block.text;
    case "steps":
    case "list":
      return block.items.join(" ");
    case "table":
      return [block.columns.join(" "), ...block.rows.map((row) => row.join(" "))].join(" ");
    case "definitions":
      return block.items.map((item) => `${item.term}: ${item.description}`).join(" ");
    case "where":
      return block.path.join(" ");
    case "links":
      return block.items.map((item) => item.label).join(" ");
    case "figure":
      return block.alt;
  }
};

/** Inline markup out, so `**Publish**` matches "publish". */
const plain = (text: string): string => text.replace(/\*\*/g, "").replace(/`/g, "");

export function buildHelpSearchIndex(articles: HelpArticle[]): HelpSearchEntry[] {
  return articles.map((article) => ({
    id: article.id,
    title: article.title,
    summary: article.summary,
    category: article.category,
    roles: article.roles,
    keywords: article.keywords.join(" ").toLowerCase(),
    headings: article.blocks
      .flatMap((block) => (block.type === "heading" ? [block.text] : []))
      .join(" ")
      .toLowerCase(),
    body: plain(article.blocks.map(blockText).join(" ")),
  }));
}

/** Words of two letters or more, lower-cased. "cancel a leg" → ["cancel", "leg"]. */
export const tokenize = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2);

const WEIGHT = { title: 6, keywords: 4, headings: 3, summary: 2, body: 1 } as const;

/**
 * Scores an entry against the tokens: a token counts once per field it
 * appears in, weighted by how much that field says about the article. A hit
 * in the title outweighs six in the body, which is what puts "Getting a hotel
 * on sale" above every article that happens to mention publishing; a hit in
 * a section heading outranks the summary, so an article whose section is
 * about the thing asked for beats one whose title merely contains a word of
 * it. A query with every token in one article outranks one with half —
 * the bonus for a full match keeps "cancel a leg" on the board rather than
 * on the statuses glossary that has "leg" in its title.
 */
function scoreEntry(entry: HelpSearchEntry, tokens: string[]): number {
  const title = entry.title.toLowerCase();
  const summary = entry.summary.toLowerCase();
  const body = entry.body.toLowerCase();
  let score = 0;
  let matched = 0;

  const fields: [string, number][] = [
    [title, WEIGHT.title],
    [entry.keywords, WEIGHT.keywords],
    [entry.headings, WEIGHT.headings],
    [summary, WEIGHT.summary],
    [body, WEIGHT.body],
  ];

  for (const token of tokens) {
    let hit = false;
    for (const [text, weight] of fields) {
      if (!text.includes(token)) continue;
      score += weight;
      hit = true;
    }
    if (hit) matched += 1;
  }

  return matched === tokens.length ? score + WEIGHT.title : score;
}

function snippetFor(entry: HelpSearchEntry, tokens: string[]): string {
  const sentences = entry.body.split(/(?<=[.!?])\s+/);
  const first = tokens[0];
  const hit = first ? sentences.find((sentence) => sentence.toLowerCase().includes(first)) : undefined;
  const chosen = hit ?? entry.summary;
  return chosen.length > 180 ? `${chosen.slice(0, 177).trimEnd()}…` : chosen;
}

/**
 * The best twenty matches a role may read, strongest first. An empty or
 * one-letter query returns nothing rather than everything — a list of every
 * article is the hub, not a search result.
 */
export function searchHelp(
  index: HelpSearchEntry[],
  query: string,
  role: HelpRole,
  limit = 20,
): HelpSearchHit[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  return index
    .filter((entry) => entry.roles.includes(role))
    .map((entry) => ({ entry, score: scoreEntry(entry, tokens), snippet: "" }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
    .slice(0, limit)
    .map((hit) => ({ ...hit, snippet: snippetFor(hit.entry, tokens) }));
}
