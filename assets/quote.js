/** Mail quote shared by the page. The PHP quote uses the same line order and the same default of 500 cents. */

export function quoteMail(fees, pages, mailClass, receipt) {
  const count = Math.max(1, Number(pages) || 1);
  const postage = mailClass === "certified" ? Number(fees.certifiedCents) || 0 : Number(fees.firstClassCents) || 0;
  const returnReceipt = receipt ? Number(fees.returnReceiptCents) || 0 : 0;
  const mailingCharge = Number(fees.mailingChargeCents ?? 500);
  const printing = count * (Number(fees.perPageCents) || 0);
  const serviceFee = Number(fees.serviceFeeCents) || 0;
  return {
    postage,
    returnReceipt,
    mailingCharge,
    pages: printing,
    serviceFee,
    total: postage + returnReceipt + mailingCharge + printing + serviceFee,
    pagesCount: count,
    currency: "usd",
    note: "Estimate from the rates configured for this service. Not a USPS guarantee.",
  };
}

/** Postage, then the flat mailing charge, then per-page printing. */
export function quoteLines(quote) {
  const lines = [
    ["Postage", quote.postage],
    ["Mailing charge", quote.mailingCharge],
    ["Per-page printing", quote.pages],
  ];
  if (quote.returnReceipt) lines.push(["Return receipt", quote.returnReceipt]);
  if (quote.serviceFee) lines.push(["Service fee", quote.serviceFee]);
  return lines;
}
