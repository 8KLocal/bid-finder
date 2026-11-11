/**
 * Shared draft copy for the browser and the optional model API.
 * Builds a response the reader can edit. Nothing here is submitted anywhere.
 */

export function formatDue(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "the deadline on the official notice";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }) + " ET";
}

export function noticeFacts(bid) {
  return {
    title: bid.title || "",
    solicitation: bid.solicitation || "",
    agency: bid.agency || "",
    subTier: bid.subTier || "",
    office: bid.office || "",
    posted: bid.posted || "",
    due: bid.due || "",
    dueDisplay: formatDue(bid.due),
    type: bid.type || "",
    naics: bid.naics || "",
    naicsLabel: bid.naicsLabel || "",
    setAside: bid.setAside || "",
    place: bid.place || "",
    remote: Boolean(bid.remote),
    contact: bid.contact || "",
    link: bid.link || "",
    summary: bid.summary || "",
  };
}

export const DRAFT_SYSTEM = `You draft proposal responses for open United States government contract notices.
The reader is a private company preparing its own response. Write in plain, professional American English.
Rules:
- Use only facts present in the notice. Never invent past performance, certifications, prices, headcount, locations, or security clearances.
- Where company-specific information is required, insert a bracket placeholder such as [Your legal company name].
- The first lines must say this is a draft for human review and that it has not been submitted to any government portal.
- The first line must include: AI draft, review before submitting.
- Use these headings, in order: Draft notice, Compliance checklist, Transmittal, Understanding of the requirement, Technical approach, Relevant experience, Staffing, Schedule, Pricing, Contact, Before you submit.
- If the notice is about a website, application, software, hosting, or related remote support, describe an approach that fits that work. If it is about something else, follow the notice instead of forcing a software story.
- Keep it under 900 words.`;

export function modelMessages(bid) {
  return [
    { role: "system", content: DRAFT_SYSTEM },
    { role: "user", content: "Draft a response from this public notice JSON:\n" + JSON.stringify(noticeFacts(bid), null, 2) },
  ];
}

export function fallbackDraft(bid) {
  const b = noticeFacts(bid);
  const agency = b.agency || "[Agency]";
  const place = b.place ? `Place of performance: ${b.place}` : "Place of performance: see the official notice";
  const remote = b.remote ? "The notice mentions remote work. Confirm whether remote delivery is actually allowed before you rely on it." : "Confirm the place of performance and any on-site requirement on the official notice.";
  const summary = b.summary || "[Paste the requirement summary from the official notice. Do not guess at scope that is not written down.]";
  return `DRAFT FOR YOUR REVIEW — NOT SUBMITTED
It's Workplace prepared this draft from the public notice so you can edit it. It is not an offer, not legal advice, and it has not been sent to SAM.gov or any contracting officer.

Draft notice
Title: ${b.title || "[Title]"}
Solicitation: ${b.solicitation || "[Solicitation number]"}
Agency: ${agency}${b.subTier && b.subTier !== b.agency ? " / " + b.subTier : ""}
Office: ${b.office || "[Office]"}
Notice type: ${b.type || "[Type]"}
NAICS: ${b.naics || "[NAICS]"}${b.naicsLabel ? " (" + b.naicsLabel + ")" : ""}
Set-aside: ${b.setAside || "See the official notice"}
Response deadline: ${b.dueDisplay}
${place}
Official notice: ${b.link || "[Link]"}

Compliance checklist
- Confirm the deadline, amendments, set-aside, and where to submit on the official notice.
- Replace every bracket. Do not invent past performance or a price.
- AI draft, review before submitting. Payment is not a guarantee of award.

Transmittal
[Your legal company name] is pleased to offer this draft response to ${agency} for "${b.title || "the referenced requirement"}". This response is contingent on the terms in the official notice dated ${b.posted || "[posted date]"}.

Understanding of the requirement
${summary}

Technical approach
- Read the official notice, attachments, and amendments, and restate the work in our own words before pricing it.
- For website, application, or software work: confirm users, content, integrations, hosting, accessibility, and security expectations with the written requirement.
- Deliver in short milestones (discovery, build, review, launch or handoff) with a named point of contact.
- ${remote}
- Keep working files and credentials in the government's required systems. Do not invent a tool stack the notice does not allow.

Relevant experience
[Insert two or three similar engagements. For each one: customer, year, what you built or supported, and the result. Leave this blank rather than inventing past performance.]

Staffing
[Name the project lead and the roles you will actually staff. Note which people work remotely and which, if any, would be on site.]

Schedule
The public deadline is ${b.dueDisplay}. [Insert a short milestone schedule that fits the period of performance in the notice. Do not promise dates the notice does not support.]

Pricing
[Insert pricing only after reading the instructions. Do not invent labor rates, discounts, or a total price here.]
Set-aside noted on the public extract: ${b.setAside || "see the notice"}.

Contact
[Your name], [title]
[Your legal company name]
[Email] · [Phone]
Contracting contact listed publicly: ${b.contact || "see the official notice"}

Before you submit
Replace every bracket. Check amendments. Submit only through the channel the official notice names. It's Workplace (ITS WORKPLACE INC) does not submit this draft for you.
`;
}
