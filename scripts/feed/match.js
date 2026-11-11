/**
 * Interest match used by digests.
 * Empty keywords, NAICS, states, or sources do not restrict that dimension.
 * A bid must pass every dimension that the subscriber filled in.
 * Keywords and NAICS match if any listed value hits. States and sources are exact.
 */

function list(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : String(value).split(/[,;\n]/);
  return raw.map((item) => String(item || "").trim()).filter(Boolean);
}

export function matchBid(bid, interests = {}) {
  if (!bid) return false;
  const keywords = list(interests.keywords).map((k) => k.toLowerCase());
  const naics = list(interests.naics).map((n) => n.replace(/\D/g, "")).filter(Boolean);
  const states = list(interests.states).map((s) => s.toUpperCase());
  const sources = list(interests.sources).map((s) => s.toLowerCase());
  if (keywords.length) {
    const hay = `${bid.title || ""} ${bid.agency || ""} ${bid.description || bid.summary || ""} ${bid.naics || ""}`.toLowerCase();
    if (!keywords.some((word) => hay.includes(word))) return false;
  }
  if (naics.length) {
    const code = String(bid.naics || "");
    if (!naics.some((n) => code === n || code.startsWith(n))) return false;
  }
  if (states.length && !states.includes(String(bid.state || "").toUpperCase())) return false;
  if (sources.length && !sources.includes(String(bid.source || "").toLowerCase())) return false;
  return true;
}

export function newSince(bid, sinceIso) {
  if (!sinceIso) return true;
  const posted = Date.parse(bid.posted || "");
  const since = Date.parse(sinceIso);
  if (Number.isNaN(posted) || Number.isNaN(since)) return true;
  return posted >= since;
}
