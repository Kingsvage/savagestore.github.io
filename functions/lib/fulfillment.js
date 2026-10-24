"use strict";

const TOPUP_GAME_IDS = new Set(["free-fire", "call-of-duty"]);
const FINAL_FULFILLMENT_STATES = new Set([
  "submitted",
  "delivered",
  "failed",
  "reconciliation-required"
]);

function validOrderId(orderId) {
  return typeof orderId === "string" && /^[A-Za-z0-9_-]{6,80}$/.test(orderId);
}

function stableFulfillmentKey(orderId) {
  if (!validOrderId(orderId)) throw new Error("Invalid Savage Store order ID.");
  return `savage-store-${orderId}`;
}

function classifySupplierFailure({ requestStarted = true, ambiguous = true, status = null, attempts = 1, maxAttempts = 4, idempotencySupported = false } = {}) {
  const notSent = requestStarted === false;
  const definiteRejection = requestStarted === true && ambiguous === false && Number(status) >= 400 && Number(status) < 500;
  const safeToRetry = notSent || (idempotencySupported && ambiguous);
  if (safeToRetry && Number(attempts) < Number(maxAttempts)) {
    return { status: "retryable", retrySafe: true };
  }
  if (definiteRejection) return { status: "failed", retrySafe: false };
  return { status: "reconciliation-required", retrySafe: false };
}

function validatePaymentEnvelope(payment, expectedReference) {
  if (!payment || payment.status !== "success") {
    throw new Error("Paystack did not verify a successful payment.");
  }
  if (payment.currency !== "NGN") throw new Error("Paystack currency mismatch.");
  if (!expectedReference || payment.reference !== expectedReference) {
    throw new Error("Paystack reference mismatch.");
  }
  if (!validOrderId(payment.metadata?.orderId)) {
    throw new Error("Paystack order metadata is invalid.");
  }
}

/**
 * Atomically changes an eligible paid top-up to a claimed state. A Firestore
 * transaction serializes competing webhook deliveries, so only one can win.
 * Retrying a previously attempted request is allowed only when a backend
 * result or an administrator has established that no supplier order exists.
 */
async function claimPaidTopup({
  db,
  payment,
  expectedReference,
  timestamp,
  allowSafeRetry = false
}) {
  validatePaymentEnvelope(payment, expectedReference);
  const { orderId } = payment.metadata;
  const orderRef = db.doc(`orders/${orderId}`);
  const claimKey = stableFulfillmentKey(orderId);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(orderRef);
    if (!snapshot.exists) throw new Error("Savage Store order was not found.");
    const order = snapshot.data();

    if (order.orderType !== "topup") throw new Error("Only top-up orders can be fulfilled by the supplier.");
    if (order.paymentReference !== expectedReference) throw new Error("Order payment reference mismatch.");
    if (order.currency !== "NGN") throw new Error("Order currency mismatch.");
    if (!TOPUP_GAME_IDS.has(order.gameId)) throw new Error("Order game is not supported.");
    if (!payment.metadata?.uid || String(order.userId || "") !== String(payment.metadata.uid)) {
      throw new Error("Order owner does not match Paystack metadata.");
    }
    if (payment.metadata.gameId !== order.gameId) throw new Error("Order game metadata mismatch.");
    if (String(payment.metadata.offerId || "") !== String(order.supplierOfferId || "")) {
      throw new Error("Order offer metadata mismatch.");
    }
    if (String(payment.metadata.categoryId || "") !== String(order.supplierCategoryId || "")) {
      throw new Error("Order supplier category mismatch.");
    }

    const expectedAmount = Math.round(Number(order.authoritativeAmount) * 100);
    if (!Number.isSafeInteger(expectedAmount) || expectedAmount <= 0 || Number(payment.amount) !== expectedAmount) {
      throw new Error("Paystack amount does not match the server-priced order.");
    }

    const currentState = order.fulfillmentStatus || "pending";
    const canStart = currentState === "pending";
    const canRetry = allowSafeRetry && currentState === "retryable" && order.fulfillmentRetrySafe === true;

    if (!canStart && !canRetry) {
      if (order.paymentStatus !== "paid") {
        transaction.update(orderRef, {
          paymentStatus: "paid",
          paidAt: timestamp,
          updatedAt: timestamp
        });
      }
      return { claimed: false, orderId, state: currentState, fulfillmentKey: order.fulfillmentKey || claimKey };
    }

    const attempt = Number(order.fulfillmentAttemptCount || 0) + 1;
    transaction.update(orderRef, {
      paymentStatus: "paid",
      paidAt: order.paidAt || timestamp,
      fulfillmentStatus: "claimed",
      fulfillmentKey: order.fulfillmentKey || claimKey,
      fulfillmentAttemptCount: attempt,
      fulfillmentRetrySafe: false,
      fulfillmentClaimedAt: timestamp,
      updatedAt: timestamp
    });
    return { claimed: true, orderId, order, attempt, fulfillmentKey: order.fulfillmentKey || claimKey };
  });
}

module.exports = {
  TOPUP_GAME_IDS,
  FINAL_FULFILLMENT_STATES,
  validOrderId,
  stableFulfillmentKey,
  classifySupplierFailure,
  validatePaymentEnvelope,
  claimPaidTopup
};
