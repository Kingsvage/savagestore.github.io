"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { claimPaidTopup, stableFulfillmentKey, classifySupplierFailure } = require("../lib/fulfillment");
const { calculateCustomerPrice, calculateMarketplaceFee } = require("../lib/pricing");
const { normalizeTopupCatalog, validateTopupFields, primaryPlayerId, buildFazerCardsTopupRequest, verifyFazerCardsWebhookSignature, mapFazerCardsStatus } = require("../lib/fazercards");
const crypto = require("node:crypto");

class MemoryFirestore {
  constructor(entries) {
    this.documents = new Map(Object.entries(entries));
    this.tail = Promise.resolve();
  }

  doc(path) {
    return { path };
  }

  runTransaction(callback) {
    const run = this.tail.then(async () => {
      const writes = [];
      const transaction = {
        get: async (ref) => {
          const data = this.documents.get(ref.path);
          return { exists: Boolean(data), data: () => ({ ...data }) };
        },
        update: (ref, patch) => writes.push([ref.path, patch])
      };
      const result = await callback(transaction);
      writes.forEach(([path, patch]) => {
        this.documents.set(path, { ...this.documents.get(path), ...patch });
      });
      return result;
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  read(path) {
    return this.documents.get(path);
  }
}

function paidPayment(overrides = {}) {
  return {
    status: "success",
    currency: "NGN",
    amount: 150000,
    reference: "savage-ref-1",
    metadata: {
      orderId: "SVG-12345678",
      uid: "customer-1",
      gameId: "free-fire",
      offerId: "offer-100",
      categoryId: "free-fire-global",
      ...overrides.metadata
    },
    ...overrides
  };
}

function freshDatabase(status = "pending", extras = {}) {
  return new MemoryFirestore({
    "orders/SVG-12345678": {
      orderId: "SVG-12345678",
      orderType: "topup",
      userId: "customer-1",
      paymentReference: "savage-ref-1",
      paymentStatus: "pending",
      fulfillmentStatus: status,
      authoritativeAmount: 1500,
      currency: "NGN",
      gameId: "free-fire",
      supplierCategoryId: "free-fire-global",
      supplierOfferId: "offer-100",
      ...extras
    }
  });
}

test("stable fulfillment key is derived from the Savage Store order ID", () => {
  assert.equal(stableFulfillmentKey("SVG-12345678"), "savage-store-SVG-12345678");
});

test("only one of two concurrent webhook claims wins", async () => {
  const db = freshDatabase();
  const args = { db, payment: paidPayment(), expectedReference: "savage-ref-1", timestamp: 100 };
  let logicalSupplierOrders = 0;
  const claims = await Promise.all([claimPaidTopup(args), claimPaidTopup(args)]);
  claims.forEach((claim) => { if (claim.claimed) logicalSupplierOrders += 1; });
  assert.equal(claims.filter((claim) => claim.claimed).length, 1);
  assert.equal(logicalSupplierOrders, 1);
  assert.equal(db.read("orders/SVG-12345678").fulfillmentAttemptCount, 1);
  assert.equal(db.read("orders/SVG-12345678").fulfillmentKey, "savage-store-SVG-12345678");
});

test("repeated success webhook does not claim a second supplier submission", async () => {
  const db = freshDatabase("claimed", { paymentStatus: "paid", fulfillmentKey: "savage-store-SVG-12345678" });
  const claim = await claimPaidTopup({ db, payment: paidPayment(), expectedReference: "savage-ref-1", timestamp: 200 });
  assert.equal(claim.claimed, false);
  assert.equal(claim.state, "claimed");
});

test("a crash after claim cannot be resubmitted by a repeated webhook", async () => {
  const db = freshDatabase();
  const args = { db, payment: paidPayment(), expectedReference: "savage-ref-1", timestamp: 200 };
  const firstClaim = await claimPaidTopup(args);
  assert.equal(firstClaim.claimed, true);
  // Model the function stopping after its durable claim and before the supplier call.
  const repeatedWebhook = await claimPaidTopup({ ...args, timestamp: 300 });
  assert.equal(repeatedWebhook.claimed, false);
  assert.equal(db.read("orders/SVG-12345678").paymentStatus, "paid");
  assert.equal(db.read("orders/SVG-12345678").fulfillmentStatus, "claimed");
  assert.equal(db.read("orders/SVG-12345678").fulfillmentAttemptCount, 1);
});

test("supplier timeout retries the same logical order with the documented idempotency key", () => {
  assert.deepEqual(classifySupplierFailure({ requestStarted: true, ambiguous: true, status: null, attempts: 1, idempotencySupported: true }), {
    status: "retryable",
    retrySafe: true
  });
  assert.deepEqual(classifySupplierFailure({ requestStarted: true, ambiguous: true, status: null, attempts: 4, idempotencySupported: true }), {
    status: "reconciliation-required",
    retrySafe: false
  });
  assert.deepEqual(classifySupplierFailure({ requestStarted: true, ambiguous: true, status: null, attempts: 1 }), {
    status: "reconciliation-required",
    retrySafe: false
  });
});

test("only a definite pre-request failure is auto-retryable", () => {
  assert.deepEqual(classifySupplierFailure({ requestStarted: false, ambiguous: false, status: null, attempts: 1 }), {
    status: "retryable",
    retrySafe: true
  });
  assert.deepEqual(classifySupplierFailure({ requestStarted: false, ambiguous: false, status: null, attempts: 4 }), {
    status: "reconciliation-required",
    retrySafe: false
  });
});

test("a definite supplier rejection is failed and not retried automatically", () => {
  assert.deepEqual(classifySupplierFailure({ requestStarted: true, ambiguous: false, status: 422, attempts: 1 }), {
    status: "failed",
    retrySafe: false
  });
});

test("unknown supplier outcome cannot be auto-retried", async () => {
  const db = freshDatabase("reconciliation-required", { paymentStatus: "paid" });
  const claim = await claimPaidTopup({ db, payment: paidPayment(), expectedReference: "savage-ref-1", timestamp: 200, allowSafeRetry: true });
  assert.equal(claim.claimed, false);
  assert.equal(db.read("orders/SVG-12345678").fulfillmentStatus, "reconciliation-required");
});

test("only explicitly safe retries can claim again", async () => {
  const db = freshDatabase("retryable", { paymentStatus: "paid", fulfillmentRetrySafe: true, fulfillmentAttemptCount: 1 });
  const claim = await claimPaidTopup({ db, payment: paidPayment(), expectedReference: "savage-ref-1", timestamp: 300, allowSafeRetry: true });
  assert.equal(claim.claimed, true);
  assert.equal(claim.attempt, 2);
  assert.equal(db.read("orders/SVG-12345678").fulfillmentRetrySafe, false);
});

test("payment amount, reference, owner, game and offer are validated", async () => {
  const scenarios = [
    { payment: paidPayment({ amount: 100 }), reference: "savage-ref-1" },
    { payment: paidPayment(), reference: "wrong-ref" },
    { payment: paidPayment({ metadata: { uid: "other-user" } }), reference: "savage-ref-1" },
    { payment: paidPayment({ metadata: { gameId: "call-of-duty" } }), reference: "savage-ref-1" },
    { payment: paidPayment({ metadata: { offerId: "other-offer" } }), reference: "savage-ref-1" }
    ,{ payment: paidPayment({ metadata: { categoryId: "other-category" } }), reference: "savage-ref-1" }
  ];
  for (const scenario of scenarios) {
    await assert.rejects(() => claimPaidTopup({ db: freshDatabase(), payment: scenario.payment, expectedReference: scenario.reference, timestamp: 1 }));
  }
});

test("server pricing uses private pricing inputs", () => {
  assert.equal(calculateCustomerPrice(100, { exchangeRate: 10, markupPercent: 5, minimumProfit: 20, roundTo: 10 }), 1050);
});

test("seller fee is calculated from the final sale amount", () => {
  assert.deepEqual(calculateMarketplaceFee(100000), { marketplaceFee: 5000, sellerPayout: 95000, feeRate: 0.05 });
  assert.deepEqual(calculateMarketplaceFee(120000), { marketplaceFee: 6000, sellerPayout: 114000, feeRate: 0.05 });
});

test("FazerCards catalog maps the documented API offer and dynamic fields", () => {
  const catalog = normalizeTopupCatalog({
    ok: true,
    category_id: "free-fire-global",
    fields: [{ key: "player_id", label: "Player ID", type: "text" }],
    offers: [{ offer_id: "ff-100", name: "100 Diamonds", price_usd: "1.25" }]
  }, "free-fire-global");
  assert.equal(catalog.offers[0].id, "ff-100");
  assert.equal(catalog.offers[0].supplierCost, 1.25);
  assert.deepEqual(validateTopupFields(catalog.fields, { player_id: "12345678" }), { player_id: "12345678" });
  assert.equal(primaryPlayerId(catalog.fields, { player_id: "12345678" }), "12345678");
  assert.throws(() => validateTopupFields(catalog.fields, { arbitrary: "12345678" }), /does not match/);
});

test("FazerCards top-up request uses its documented route, fields, and stable key", () => {
  assert.deepEqual(buildFazerCardsTopupRequest({
    categoryId: "free-fire-global",
    offerId: "ff-100",
    fields: { player_id: "12345678" },
    idempotencyKey: "savage-store-SVG-12345678"
  }), {
    path: "/topups/order",
    headers: { "Idempotency-Key": "savage-store-SVG-12345678" },
    body: { category_id: "free-fire-global", offer_id: "ff-100", fields: { player_id: "12345678" } }
  });
});

test("FazerCards webhook signatures are verified and provider statuses map safely", () => {
  const rawBody = Buffer.from('{"event":"order.status_changed"}');
  const secret = "unit-test-secret";
  const signature = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  assert.equal(verifyFazerCardsWebhookSignature(rawBody, signature, secret), true);
  assert.equal(verifyFazerCardsWebhookSignature(rawBody, signature, "wrong-secret"), false);
  assert.equal(verifyFazerCardsWebhookSignature(rawBody, "sha256=invalid", secret), false);
  assert.deepEqual(mapFazerCardsStatus("completed"), { supplierStatus: "completed", status: "delivered", fulfillmentStatus: "delivered" });
  assert.deepEqual(mapFazerCardsStatus("refund"), { supplierStatus: "refund", status: "failed", fulfillmentStatus: "failed" });
  assert.equal(mapFazerCardsStatus("unknown"), null);
});
