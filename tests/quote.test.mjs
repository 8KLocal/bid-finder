import test from "node:test";
import assert from "node:assert/strict";
import { quoteLines, quoteMail } from "../assets/quote.js";

test("mailing charge sits between postage and per-page printing", () => {
  const quote = quoteMail({
    firstClassCents: 78,
    certifiedCents: 500,
    returnReceiptCents: 250,
    mailingChargeCents: 500,
    perPageCents: 15,
    serviceFeeCents: 500,
  }, 3, "firstclass", false);
  assert.equal(quote.mailingCharge, 500);
  assert.equal(quote.total, 78 + 500 + 45 + 500);
  const labels = quoteLines(quote).map((line) => line[0]);
  assert.deepEqual(labels.slice(0, 3), ["Postage", "Mailing charge", "Per-page printing"]);
});

test("mailing charge defaults to 500 cents", () => {
  const quote = quoteMail({ firstClassCents: 78, perPageCents: 15, serviceFeeCents: 0 }, 1, "firstclass", false);
  assert.equal(quote.mailingCharge, 500);
  assert.equal(quote.total, 78 + 500 + 15);
});
