/** Generic extractors for public bid lists: HTML tables, RSS/Atom, and iCal. */

const BID_WORD = /\b(bid|bids|rfp|rfq|ifb|itb|solicitation|procure|procurement|vendor|purchasing|proposal)\b/i;

export function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveUrl(href, base) {
  try {
    const url = new URL(href, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

export function classifyPlatform(pageUrl, html = "") {
  const blob = `${pageUrl} ${String(html).slice(0, 6000)}`.toLowerCase();
  const rules = [
    ["bonfire", "bonfirehub.com"],
    ["bidnet", "bidnetdirect.com"],
    ["planetbids", "planetbids"],
    ["opengov", "opengov.com"],
    ["ionwave", "ionwave.net"],
    ["demandstar", "demandstar.com"],
    ["jaggaer", "sciquest.com"],
    ["jaggaer", "jaggaer.com"],
    ["ariba", "ariba.com"],
    ["periscope", "/bso/"],
    ["periscope", "bidsync"],
    ["socrata", "socrata.com"],
    ["socrata", "/resource/"],
    ["ckan", "ckan"],
    ["civicplus", "civicplus"],
    ["civicplus", "bids.aspx"],
    ["rss", "<rss"],
    ["rss", "<feed"],
    ["ical", "begin:vcalendar"],
    ["html-table", "<table"],
  ];
  for (const [name, needle] of rules) {
    if (blob.includes(needle)) return name;
  }
  return "";
}

const HOSTED = new Set(["bonfire", "bidnet", "planetbids", "opengov", "ionwave", "demandstar", "jaggaer", "ariba", "periscope"]);

export function isHostedPlatform(platform) {
  return HOSTED.has(platform);
}

function cells(row) {
  return [...String(row).matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => stripHtml(match[1]));
}

export function extractHtmlBids(html, pageUrl, agency) {
  const bids = [];
  const tables = String(html || "").match(/<table[\s\S]*?<\/table>/gi) || [];
  for (const table of tables) {
    const rows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
    if (rows.length < 2) continue;
    const header = cells(rows[0]).map((value) => value.toLowerCase());
    const titleIdx = header.findIndex((value) => /title|bid name|project|description|solicitation|commodity/.test(value));
    const dueIdx = header.findIndex((value) => /due|deadline|clos|open/.test(value));
    if (titleIdx < 0) continue;
    for (const row of rows.slice(1)) {
      const values = cells(row);
      const title = values[titleIdx] || "";
      if (title.length < 6 || title.length > 240) continue;
      if (/^(sealed bid|bids?|rfp|rfq|ifb|current bids|open bids|solicitations?)$/i.test(title)) continue;
      if (/is a bid where|kept hidden until the bid has been awarded/i.test(values.join(" "))) continue;
      const href = (row.match(/href=["']([^"']+)["']/i) || [])[1] || "";
      if (!href) continue;
      const url = resolveUrl(href, pageUrl);
      if (!url || url.replace(/\/$/, "") === String(pageUrl).replace(/\/$/, "")) continue;
      bids.push({
        title,
        agency,
        deadline: dueIdx >= 0 ? values[dueIdx] || "" : "",
        url,
        description: values.filter(Boolean).slice(0, 4).join(" · ").slice(0, 280),
      });
      if (bids.length >= 40) return bids;
    }
  }
  return bids;
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return match ? match[1] : "";
}

export function extractRssBids(xml, feedUrl, agency) {
  const bids = [];
  for (const block of String(xml || "").match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || []) {
    const title = stripHtml(tag(block, "title"));
    const href = stripHtml(tag(block, "link")) || (block.match(/<link[^>]+href=["']([^"']+)["']/i) || [])[1] || "";
    const url = resolveUrl(href, feedUrl);
    if (!title || !url) continue;
    const deadline = stripHtml(tag(block, "deadline") || tag(block, "due") || "");
    const posted = stripHtml(tag(block, "pubDate") || tag(block, "updated") || tag(block, "published") || "");
    bids.push({
      title: title.slice(0, 240),
      agency,
      deadline,
      posted: posted.slice(0, 10),
      url,
      description: stripHtml(tag(block, "description") || tag(block, "summary")).slice(0, 280),
    });
    if (bids.length >= 40) break;
  }
  return bids;
}

export function extractIcalBids(text, feedUrl, agency) {
  const bids = [];
  for (const block of String(text || "").split(/BEGIN:VEVENT/i).slice(1)) {
    const body = block.split(/END:VEVENT/i)[0] || "";
    const field = (name) => {
      const match = body.match(new RegExp(`^${name}[^:]*:(.*)$`, "im"));
      return match ? match[1].replace(/\\n/g, " ").replace(/\\,/g, ",").trim() : "";
    };
    const title = field("SUMMARY");
    const url = resolveUrl(field("URL"), feedUrl);
    if (!title || !url) continue;
    const end = field("DTEND") || field("DUE");
    let deadline = "";
    const digits = end.replace(/\D/g, "");
    if (digits.length >= 8) {
      deadline = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    }
    bids.push({
      title: title.slice(0, 240),
      agency,
      deadline,
      url,
      description: field("DESCRIPTION").slice(0, 280),
    });
    if (bids.length >= 40) break;
  }
  return bids;
}

export function bidLinks(html, pageUrl) {
  const found = [];
  const seen = new Set();
  for (const match of String(html || "").matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = resolveUrl(match[1], pageUrl);
    if (!url || seen.has(url)) continue;
    const text = stripHtml(match[2]);
    const blob = `${url} ${text}`;
    if (!BID_WORD.test(blob)) continue;
    if (/\.(pdf|docx?|xlsx?|zip)(\?|$)/i.test(url)) continue;
    seen.add(url);
    let score = 0;
    if (/bid|rfp|solicitation|procurement/.test(blob.toLowerCase())) score += 3;
    if (/sitemap|rss|atom|ics|bids\.aspx/.test(url.toLowerCase())) score += 2;
    try {
      if (new URL(url).host === new URL(pageUrl).host) score += 1;
    } catch { /* ignore */ }
    found.push({ url, text: text.slice(0, 160), score });
  }
  found.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
  return found.slice(0, 8);
}

export function looksLikeBidPage(html) {
  return BID_WORD.test(stripHtml(html).slice(0, 4000));
}
