/** Pure list helpers shared by the browser. No secrets and no network. */

export function dedupeKeyUrl(link) {
  try {
    const url = new URL(link);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    const pathName = url.pathname.replace(/\/$/, "").toLowerCase();
    return `${host}${pathName}`;
  } catch {
    return String(link || "").trim().toLowerCase();
  }
}

export function dedupeKeyTitle(title) {
  return String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** SAM.gov rows win when a URL or title is already present. */
export function mergeBidLists(samBids, rfpBids) {
  const seenUrl = new Set();
  const seenTitle = new Set();
  const out = [];
  for (const bid of [...samBids, ...rfpBids]) {
    if (!bid) continue;
    const url = bid.link ? dedupeKeyUrl(bid.link) : "";
    const title = dedupeKeyTitle(bid.title);
    if (url && seenUrl.has(url)) continue;
    if (title && seenTitle.has(title)) continue;
    if (url) seenUrl.add(url);
    if (title) seenTitle.add(title);
    out.push(bid);
  }
  return out;
}

export function safeWebhookUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function claimPayload(bid, claimedAt, contactEmail) {
  const body = {
    bidId: String(bid?.id || ""),
    title: String(bid?.title || ""),
    agency: String(bid?.agency || ""),
    deadline: String(bid?.due || bid?.deadline || ""),
    claimedAt: String(claimedAt || ""),
  };
  const email = String(contactEmail || "").trim();
  if (email && EMAIL.test(email)) body.contactEmail = email;
  return body;
}
