/** Small in-page search index. Typo tolerance, light stemming, and a few synonym groups. */

const STOP = new Set(["a", "an", "the", "of", "for", "and", "or", "to", "in", "on", "at", "by", "with", "from", "your"]);

const GROUPS = [
  ["cleaning", "clean", "janitorial", "janitor", "custodial", "custodian", "housekeeping", "sanitation"],
  ["website", "web", "webpage", "site"],
  ["software", "application", "app", "programming", "developer", "programmer"],
];

const PHRASES = [
  { words: ["web", "design"], canon: "website" },
  { words: ["web", "site"], canon: "website" },
  { words: ["information", "technology"], canon: "software" },
];

const STATE_NAMES = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado",
  CT: "connecticut", DE: "delaware", DC: "district columbia", FL: "florida", GA: "georgia",
  HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas",
  KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland", MA: "massachusetts",
  MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana",
  NE: "nebraska", NV: "nevada", NH: "hampshire", NJ: "jersey", NM: "mexico", NY: "york",
  NC: "carolina", ND: "dakota", OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania",
  RI: "rhode island", SC: "carolina", SD: "dakota", TN: "tennessee", TX: "texas", UT: "utah",
  VT: "vermont", VA: "virginia", WA: "washington", WV: "virginia", WI: "wisconsin", WY: "wyoming",
};

const synonymOf = new Map();
for (const group of GROUPS) {
  for (const word of group) synonymOf.set(word, group);
}

export function stemToken(word) {
  let text = String(word || "").toLowerCase();
  if (text.length > 5 && text.endsWith("ing")) text = text.slice(0, -3);
  else if (text.length > 4 && text.endsWith("ed")) text = text.slice(0, -2);
  else if (text.length > 4 && text.endsWith("es")) text = text.slice(0, -2);
  else if (text.length > 3 && text.endsWith("s") && !text.endsWith("ss")) text = text.slice(0, -1);
  return text || String(word || "").toLowerCase();
}

export function tokenize(value) {
  return String(value || "").toLowerCase().match(/[a-z0-9]+/g) || [];
}

function trigrams(word) {
  const text = `  ${word} `;
  const out = [];
  for (let i = 0; i < text.length - 2; i++) out.push(text.slice(i, i + 3));
  return out;
}

function editDistance(left, right, max) {
  if (Math.abs(left.length - right.length) > max) return max + 1;
  let prev = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    const next = [i];
    let rowMin = next[0];
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      next[j] = Math.min(prev[j] + 1, next[j - 1] + 1, prev[j - 1] + cost);
      if (next[j] < rowMin) rowMin = next[j];
    }
    if (rowMin > max) return max + 1;
    prev = next;
  }
  return prev[right.length];
}

function expand(token) {
  const stem = stemToken(token);
  return synonymOf.get(token) || synonymOf.get(stem) || [token];
}

function concepts(query) {
  const raw = tokenize(query).filter((token) => token === "it" || !STOP.has(token));
  const used = new Set();
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    if (used.has(i)) continue;
    const phrase = PHRASES.find((item) => item.words.every((word, offset) => raw[i + offset] === word));
    if (phrase) {
      phrase.words.forEach((_, offset) => used.add(i + offset));
      out.push(phrase.canon);
      i += phrase.words.length - 1;
      continue;
    }
    out.push(raw[i]);
  }
  return out;
}

export function buildSearchIndex(bids) {
  const postings = new Map();
  const dictionary = new Set();
  const trigram = new Map();

  function add(token, id, weight) {
    if (!token || weight <= 0) return;
    let list = postings.get(token);
    if (!list) postings.set(token, list = new Map());
    list.set(id, Math.max(list.get(id) || 0, weight));
  }

  function remember(token) {
    if (token.length < 4 || dictionary.has(token)) return;
    dictionary.add(token);
    for (const gram of trigrams(token)) {
      let list = trigram.get(gram);
      if (!list) trigram.set(gram, list = []);
      list.push(token);
    }
  }

  for (const bid of bids) {
    const id = bid.id;
    const fields = [
      [bid.title, 8],
      [bid.solicitation, 6],
      [bid.agency, 5],
      [bid.naicsLabel, 4],
      [bid.naics, 3],
      [`${bid.place || ""} ${bid.state || ""} ${STATE_NAMES[bid.state] || ""}`, 3],
      [bid.summary || bid.description || "", 1],
    ];
    for (const [text, weight] of fields) {
      const words = tokenize(text);
      const isTitle = text === bid.title;
      for (const word of words) {
        if (STOP.has(word)) continue;
        if (word === "it") {
          if (isTitle) {
            add("it", id, weight);
            add("software", id, Math.round(weight * 0.8));
            remember("software");
          }
          continue;
        }
        add(word, id, weight);
        remember(word);
        const stem = stemToken(word);
        if (stem !== word) add(stem, id, Math.round(weight * 0.85));
      }
    }
  }
  const frozen = new Map();
  for (const [token, list] of postings) frozen.set(token, [...list.entries()]);
  return { postings: frozen, dictionary, trigram };
}

function nearest(index, token) {
  if (token.length < 5) return "";
  const max = token.length >= 8 ? 2 : 1;
  const counts = new Map();
  for (const gram of trigrams(token)) {
    for (const word of index.trigram.get(gram) || []) counts.set(word, (counts.get(word) || 0) + 1);
  }
  let best = "";
  let bestDistance = max + 1;
  let bestOverlap = 0;
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  for (const [word, overlap] of ranked) {
    const distance = editDistance(token, word, max);
    if (distance < bestDistance || (distance === bestDistance && overlap > bestOverlap)) {
      best = word;
      bestDistance = distance;
      bestOverlap = overlap;
    }
  }
  return bestDistance <= max ? best : "";
}

function keysFor(index, token) {
  const keys = new Set();
  const stem = stemToken(token);
  const known = index.postings.has(token) || index.postings.has(stem) || index.dictionary.has(token);
  const correction = known ? "" : nearest(index, token);
  const base = correction || token;
  for (const word of expand(base)) {
    keys.add(word);
    keys.add(stemToken(word));
  }
  keys.add(stem);
  return { keys, correction };
}

export function searchBids(index, query) {
  const parts = concepts(query);
  if (!parts.length || !index) return { suggestion: "", hits: [] };
  const corrections = [];
  let maps = null;
  for (const part of parts) {
    const { keys, correction } = part === "it"
      ? { keys: new Set(["it", "software", "application", "app", "programming"]), correction: "" }
      : keysFor(index, part);
    if (correction) corrections.push(correction);
    else corrections.push(part);
    const scores = new Map();
    for (const key of keys) {
      const boost = key === part || key === stemToken(part) ? 1 : 0.75;
      for (const [id, weight] of index.postings.get(key) || []) {
        scores.set(id, (scores.get(id) || 0) + weight * boost);
      }
    }
    maps = maps === null ? [scores] : maps.concat([scores]);
  }
  const [first, ...rest] = maps;
  const hits = [];
  for (const [id, score] of first) {
    let total = score;
    let ok = true;
    for (const map of rest) {
      const extra = map.get(id);
      if (!extra) { ok = false; break; }
      total += extra;
    }
    if (ok) hits.push({ id, score: total });
  }
  hits.sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  const suggestion = corrections.join(" ");
  const typed = parts.join(" ");
  return {
    suggestion: suggestion && suggestion !== typed ? suggestion : "",
    hits,
  };
}

export function suggestBids(index, query, titles, limit = 6) {
  const result = searchBids(index, query);
  const items = [];
  if (result.suggestion) items.push({ label: `Did you mean ${result.suggestion}?`, value: result.suggestion });
  for (const hit of result.hits) {
    const title = titles.get(hit.id);
    if (!title || items.some((item) => item.value === title)) continue;
    items.push({ label: title, value: title });
    if (items.length >= limit) break;
  }
  return items;
}
