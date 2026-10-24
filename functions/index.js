"use strict";

/**
 * Trusted Savage Store backend. Secrets stay in Secret Manager and all
 * payment, supplier, listing-agreement, swap-review and settlement decisions
 * are made here rather than in GitHub Pages JavaScript.
 */
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");
const { calculateCustomerPrice, calculateMarketplaceFee } = require("./lib/pricing");
const { claimPaidTopup, validOrderId, stableFulfillmentKey, classifySupplierFailure } = require("./lib/fulfillment");
const { normalizeTopupCatalog, validateTopupFields, primaryPlayerId, buildFazerCardsTopupRequest, verifyFazerCardsWebhookSignature, mapFazerCardsStatus } = require("./lib/fazercards");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const paystackSecret = defineSecret("PAYSTACK_SECRET_KEY");
const fazerCardsKey = defineSecret("FAZERCARDS_API_KEY");
const fazerCardsWebhookSecret = defineSecret("FAZERCARDS_WEBHOOK_SECRET");

const PAYSTACK_API = "https://api.paystack.co";
const FAZERCARDS_API = "https://api.fzr.cards/api/v2";
const CURRENCY = "NGN";
const SELLER_AGREEMENT_VERSION = "seller-v1-2026-10-24";
const SWAP_AGREEMENT_VERSION = "swap-v1-2026-10-24";
const MARKETPLACE_FEE_RATE = 0.05;
const MAX_FULFILLMENT_ATTEMPTS = 4;

// No documented, authorized public UID-lookup provider is configured. The
// adapters are intentionally null until Savage Store supplies an approved API.
const gameProfileProviders = Object.freeze({
  "free-fire": null,
  "call-of-duty": null
});

// Publisher terms checked on 2026-10-24 prohibit account trading for both
// currently supported games. Keep swaps disabled until an authorized policy
// basis changes; this does not imply publisher approval.
const gamePolicies = Object.freeze({
  "free-fire": { swapsEnabled: false },
  "call-of-duty": { swapsEnabled: false }
});

class ProviderRequestError extends Error {
  constructor(message, { status = null, requestStarted = false, ambiguous = false } = {}) {
    super(message);
    this.name = "ProviderRequestError";
    this.status = status;
    this.requestStarted = requestStarted;
    this.ambiguous = ambiguous;
  }
}

function requireAuth(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in before continuing.");
  return request.auth.uid;
}

async function requireAdmin(request) {
  const uid = requireAuth(request);
  const adminDoc = await db.doc(`admins/${uid}`).get();
  if (!adminDoc.exists) throw new HttpsError("permission-denied", "Administrator access is required.");
  return uid;
}

function cleanText(value, name, maxLength, { required = true } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new HttpsError("invalid-argument", `${name} is required.`);
  if (text.length > maxLength) throw new HttpsError("invalid-argument", `${name} is too long.`);
  return text;
}

function validateGameId(gameId) {
  if (!["free-fire", "call-of-duty"].includes(gameId)) {
    throw new HttpsError("invalid-argument", "Unsupported game.");
  }
  return gameId;
}

function safeHttpUrl(value, name, { optional = false } = {}) {
  if (optional && !value) return "";
  try {
    const url = new URL(String(value));
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol");
    return url.href;
  } catch {
    throw new HttpsError("invalid-argument", `${name} must be a valid HTTP or HTTPS URL.`);
  }
}

async function readJson(response, serviceName) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderRequestError(`${serviceName} returned an invalid response.`, {
      status: response.status,
      requestStarted: true,
      ambiguous: true
    });
  }
}

async function requestJson(base, path, { serviceName, headers = {}, ...options }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${base}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...headers }
    });
    const body = await readJson(response, serviceName);
    if (!response.ok || body.status === false || body.ok === false) {
      throw new ProviderRequestError(`${serviceName} rejected the request.`, {
        status: response.status,
        requestStarted: true,
        ambiguous: response.status >= 500
      });
    }
    return body.data === undefined ? body : body.data;
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error;
    throw new ProviderRequestError(`${serviceName} request outcome is unknown.`, {
      requestStarted: true,
      ambiguous: true
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function supplier(path, options = {}) {
  const key = fazerCardsKey.value();
  if (!key) throw new ProviderRequestError("FazerCards credentials are not configured.", { requestStarted: false });
  return requestJson(FAZERCARDS_API, path, {
    ...options,
    serviceName: "FazerCards",
    headers: { "X-API-Key": key, ...(options.headers || {}) }
  });
}

async function paystack(path, options = {}) {
  const key = paystackSecret.value();
  if (!key) throw new ProviderRequestError("Paystack is not configured.", { requestStarted: false });
  return requestJson(PAYSTACK_API, path, {
    ...options,
    serviceName: "Paystack",
    headers: { Authorization: `Bearer ${key}`, ...(options.headers || {}) }
  });
}

async function getPrivatePricing() {
  const snapshot = await db.doc("privateSettings/pricing").get();
  const pricing = snapshot.data() || {};
  if (!snapshot.exists || !pricing.exchangeRate) {
    throw new HttpsError("failed-precondition", "Top-up pricing is not configured on the server.");
  }
  return pricing;
}

async function getSafePublicSettings() {
  const snapshot = await db.doc("settings/public").get();
  return snapshot.data() || {};
}

function ensureTopupsEnabled(settings) {
  if (settings.maintenanceMode || settings.topupEnabled === false) {
    throw new HttpsError("failed-precondition", "Game top-ups are temporarily unavailable.");
  }
}

async function listSupplierOffers(gameId, pricing) {
  const categoryId = cleanText(pricing?.supplierCategoryIds?.[gameId], "FazerCards category ID", 120, { required: false });
  if (!categoryId) {
    throw new HttpsError("failed-precondition", `FazerCards category is not configured for ${gameId}.`);
  }
  const response = await supplier(`/topups/offers?category_id=${encodeURIComponent(categoryId)}`);
  if (response.category_id && String(response.category_id) !== categoryId) {
    throw new HttpsError("failed-precondition", "FazerCards returned offers for a different game category.");
  }
  const catalog = normalizeTopupCatalog(response, categoryId);
  if (!catalog.fields.length) {
    throw new HttpsError("failed-precondition", "FazerCards has not provided the player fields required for this game.");
  }
  if (!catalog.offers.length) {
    throw new HttpsError("failed-precondition", "FazerCards has no active offers for this game category.");
  }
  return catalog;
}

exports.getTopupCatalog = onCall({ secrets: [fazerCardsKey] }, async (request) => {
  requireAuth(request);
  const gameId = validateGameId(request.data?.gameId);
  ensureTopupsEnabled(await getSafePublicSettings());
  const pricing = await getPrivatePricing();
  const catalog = await listSupplierOffers(gameId, pricing);
  return {
    gameId,
    categoryId: catalog.categoryId,
    fields: catalog.fields,
    offers: catalog.offers.map((offer) => {
      return {
        id: String(offer.id),
        name: offer.name,
        gameId,
        price: calculateCustomerPrice(offer.supplierCost, pricing),
        fields: offer.fields,
        currency: CURRENCY
      };
    })
  };
});

exports.initializePaystackPayment = onCall(
  { secrets: [paystackSecret, fazerCardsKey] },
  async (request) => {
    const uid = requireAuth(request);
    const orderId = cleanText(request.data?.orderId, "Order ID", 80);
    if (!validOrderId(orderId)) throw new HttpsError("invalid-argument", "Order ID is invalid.");
    ensureTopupsEnabled(await getSafePublicSettings());

    const orderRef = db.doc(`orders/${orderId}`);
    const snapshot = await orderRef.get();
    if (!snapshot.exists) throw new HttpsError("not-found", "Top-up order was not found.");
    const order = snapshot.data();
    if (order.userId !== uid || order.orderType !== "topup") {
      throw new HttpsError("permission-denied", "This order cannot be paid by this account.");
    }
    if (order.paymentStatus !== "pending" || order.fulfillmentStatus !== "pending") {
      throw new HttpsError("failed-precondition", "This order is no longer payable.");
    }
    const gameId = validateGameId(order.gameId);
    const offerId = cleanText(order.supplierOfferId, "Supplier offer", 120);
    const customerEmail = cleanText(request.auth.token.email, "Google account email", 254);
    if (!customerEmail.includes("@") || request.auth.token.email_verified !== true) {
      throw new HttpsError("failed-precondition", "A verified Google email is required.");
    }

    const pricing = await getPrivatePricing();
    const catalog = await listSupplierOffers(gameId, pricing);
    const offer = catalog.offers.find((item) => String(item.id) === offerId);
    if (!offer) throw new HttpsError("failed-precondition", "This top-up product is no longer available.");
    const submittedFields = request.data?.gameFields || (
      order.gameUID && catalog.fields.length === 1
        ? { [catalog.fields[0].key]: order.gameUID }
        : null
    );
    let gameFields;
    try {
      gameFields = validateTopupFields(catalog.fields, submittedFields);
    } catch (error) {
      throw new HttpsError("invalid-argument", error.message);
    }
    const playerId = primaryPlayerId(catalog.fields, gameFields);
    if (!playerId) throw new HttpsError("invalid-argument", "Player ID is required.");
    const amount = calculateCustomerPrice(offer.supplierCost, pricing);
    const paymentReference = `savage-store-${orderId}`;

    const initialization = await db.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(orderRef);
      if (!currentSnapshot.exists) throw new HttpsError("not-found", "Top-up order was not found.");
      const current = currentSnapshot.data();
      if (current.userId !== uid || current.orderType !== "topup") {
        throw new HttpsError("permission-denied", "This order cannot be paid by this account.");
      }
      if (current.paymentStatus !== "pending" || current.fulfillmentStatus !== "pending") {
        throw new HttpsError("failed-precondition", "This order is no longer payable.");
      }
      if (current.paymentInitializationStatus === "initialized" && current.authorizationUrl) {
        return { existing: true, authorizationUrl: current.authorizationUrl, reference: current.paymentReference };
      }
      if (current.paymentInitializationStatus === "initializing" || current.paymentInitializationStatus === "reconciliation-required") {
        throw new HttpsError("failed-precondition", "Checkout status is being reconciled. Please contact Technical Support before retrying.");
      }
      transaction.update(orderRef, {
        paymentReference,
        paymentInitializationStatus: "initializing",
        authoritativeAmount: amount,
        price: amount,
        currency: CURRENCY,
        supplierOfferId: offerId,
        supplierCategoryId: catalog.categoryId,
        gameFields,
        gameUID: playerId,
        item: cleanText(String(offer.name || current.item || "Game top-up"), "Product", 120),
        gameId,
        customerEmail,
        googleEmail: customerEmail,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return { existing: false, reference: paymentReference };
    });
    if (initialization.existing) {
      return { authorizationUrl: initialization.authorizationUrl, reference: initialization.reference, amount };
    }

    try {
      const transaction = await paystack("/transaction/initialize", {
        method: "POST",
        body: JSON.stringify({
          email: customerEmail,
          amount: Math.round(amount * 100),
          currency: CURRENCY,
          reference: paymentReference,
          callback_url: "https://savagestore.github.io/topup.html",
          metadata: { orderId, uid, gameId, offerId, categoryId: catalog.categoryId }
        })
      });
      if (!transaction.authorization_url) {
        await orderRef.update({
          paymentInitializationStatus: "reconciliation-required",
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        throw new HttpsError("internal", "Paystack did not return a checkout link. Contact Technical Support before retrying.");
      }
      await orderRef.update({
        paymentInitializationStatus: "initialized",
        authorizationUrl: transaction.authorization_url,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return { authorizationUrl: transaction.authorization_url, reference: paymentReference, amount };
    } catch (error) {
      const ambiguous = error instanceof ProviderRequestError && error.ambiguous;
      await orderRef.update({
        paymentInitializationStatus: ambiguous ? "reconciliation-required" : "failed",
        paymentInitializationError: "Secure checkout could not be initialized.",
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      if (error instanceof HttpsError) throw error;
      console.error("PAYSTACK INITIALIZATION ERROR", { orderId, code: error.status || "request-error" });
      throw new HttpsError("unavailable", "Secure checkout could not be initialized. Please contact Technical Support before retrying.");
    }
  }
);

async function markFulfillmentError(orderRef, error) {
  const current = (await orderRef.get()).data() || {};
  const attempts = Number(current.fulfillmentAttemptCount || 1);
  const outcome = classifySupplierFailure({
    requestStarted: error instanceof ProviderRequestError ? error.requestStarted : true,
    ambiguous: error instanceof ProviderRequestError ? error.ambiguous : true,
    status: error instanceof ProviderRequestError ? error.status : null,
    attempts,
    maxAttempts: MAX_FULFILLMENT_ATTEMPTS,
    idempotencySupported: true
  });
  if (outcome.status === "retryable") {
    const backoffMs = Math.min(60 * 60 * 1000, 60 * 1000 * (2 ** Math.max(0, attempts - 1)));
    await orderRef.update({
      fulfillmentStatus: outcome.status,
      fulfillmentRetrySafe: outcome.retrySafe,
      nextFulfillmentAttemptAt: admin.firestore.Timestamp.fromMillis(Date.now() + backoffMs),
      fulfillmentError: "Retrying the same supplier order with its stable idempotency key.",
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return;
  }
  await orderRef.update({
    fulfillmentStatus: outcome.status,
    fulfillmentRetrySafe: outcome.retrySafe,
    fulfillmentError: outcome.status === "failed"
      ? "Supplier rejected the request. Review the supplier response and correct the issue."
      : "Automatic retries are exhausted. Reconcile the order in FazerCards before taking further action.",
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  console.error("SUPPLIER FULFILLMENT NEEDS REVIEW", {
    orderId: orderRef.id,
    status: error instanceof ProviderRequestError ? error.status : null,
    ambiguous: error instanceof ProviderRequestError ? error.ambiguous : true
  });
}

async function fulfillVerifiedPayment(reference, allowSafeRetry = false) {
  const payment = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
  const orderId = payment.metadata?.orderId;
  if (!validOrderId(orderId)) throw new Error("Verified Paystack metadata does not identify an order.");
  const orderRef = db.doc(`orders/${orderId}`);
  const claim = await claimPaidTopup({
    db,
    payment,
    expectedReference: reference,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    allowSafeRetry
  });
  if (!claim.claimed) return;

  await orderRef.update({
    fulfillmentStatus: "submitting",
    fulfillmentStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  try {
    const supplierRequest = buildFazerCardsTopupRequest({
      categoryId: claim.order.supplierCategoryId,
      offerId: claim.order.supplierOfferId,
      fields: claim.order.gameFields,
      idempotencyKey: claim.fulfillmentKey
    });
    const result = await supplier(supplierRequest.path, {
      method: "POST",
      headers: supplierRequest.headers,
      body: JSON.stringify(supplierRequest.body)
    });
    const supplierOrderId = result.order?.id || result.order_id || result.id || result.orderId;
    if (!supplierOrderId) {
      throw new ProviderRequestError("FazerCards response omitted its order ID.", {
        status: 200,
        requestStarted: true,
        ambiguous: true
      });
    }
    const finalSupplierStatus = mapFazerCardsStatus(result.order?.status || result.status || "processing") || {
      supplierStatus: String(result.order?.status || result.status || "processing"),
      status: "processing",
      fulfillmentStatus: "submitted"
    };
    await orderRef.update({
      paymentStatus: "paid",
      ...finalSupplierStatus,
      supplierOrderId: String(supplierOrderId),
      fulfillmentSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
      fulfillmentRetrySafe: false,
      ...(finalSupplierStatus.fulfillmentStatus === "delivered" ? { deliveredAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
      ...(finalSupplierStatus.fulfillmentStatus === "failed" ? { failedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    await markFulfillmentError(orderRef, error);
  }
}

exports.paystackWebhook = onRequest({ secrets: [paystackSecret, fazerCardsKey] }, async (req, res) => {
  const signature = req.get("x-paystack-signature");
  const rawBody = req.rawBody;
  if (!signature || !Buffer.isBuffer(rawBody)) return res.status(401).send("Invalid signature");
  const expected = crypto.createHmac("sha512", paystackSecret.value()).update(rawBody).digest("hex");
  const signatureBytes = Buffer.from(signature, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (signatureBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(signatureBytes, expectedBytes)) {
    return res.status(401).send("Invalid signature");
  }

  if (req.body?.event !== "charge.success") return res.status(200).send("ok");
  const reference = req.body?.data?.reference;
  if (typeof reference !== "string" || !reference) return res.status(400).send("Missing reference");
  try {
    await fulfillVerifiedPayment(reference);
    return res.status(200).send("ok");
  } catch (error) {
    console.error("PAYSTACK WEBHOOK PROCESSING ERROR", { reference, message: error.message });
    return res.status(500).send("Unable to process payment event");
  }
});

exports.fazerCardsWebhook = onRequest({ secrets: [fazerCardsWebhookSecret] }, async (req, res) => {
  const rawBody = req.rawBody;
  const signature = req.get("x-webhook-signature") || "";
  if (!verifyFazerCardsWebhookSignature(rawBody, signature, fazerCardsWebhookSecret.value())) {
    return res.status(401).send("Invalid signature");
  }

  const payload = req.body && typeof req.body === "object" ? req.body : null;
  const data = payload?.data;
  const supplierOrderId = typeof data?.order_id === "string" ? data.order_id : "";
  const mapped = mapFazerCardsStatus(data?.status);
  if (!payload || !["order.created", "order.status_changed"].includes(payload.event) || !supplierOrderId || !mapped) {
    return res.status(200).send("ok");
  }

  try {
    const matchingOrders = await db.collection("orders")
      .where("supplierOrderId", "==", supplierOrderId)
      .limit(5)
      .get();
    for (const orderDoc of matchingOrders.docs) {
      let applied = false;
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(orderDoc.ref);
        if (!snapshot.exists) return;
        const order = snapshot.data();
        if (order.orderType !== "topup" || order.supplierOrderId !== supplierOrderId || order.paymentStatus !== "paid") return;
        if (["delivered", "failed"].includes(order.fulfillmentStatus)) return;
        transaction.update(orderDoc.ref, {
          ...mapped,
          ...(mapped.fulfillmentStatus === "delivered" ? { deliveredAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
          ...(mapped.fulfillmentStatus === "failed" ? { failedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
          supplierWebhookEvent: cleanText(payload.event, "Webhook event", 80),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        applied = true;
      });
      if (applied) {
        const auditId = typeof payload.event_id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(payload.event_id)
          ? payload.event_id
          : crypto.createHash("sha256").update(rawBody).digest("hex");
        await orderDoc.ref.collection("fulfillmentAudit").doc(auditId).set({
          action: "fazercards-webhook",
          event: payload.event,
          supplierOrderId,
          supplierStatus: mapped.supplierStatus,
          at: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
    }
    return res.status(200).send("ok");
  } catch (error) {
    console.error("FAZERCARDS WEBHOOK PROCESSING ERROR", { supplierOrderId, message: error.message });
    return res.status(500).send("Unable to process supplier event");
  }
});

exports.recoverTopupFulfillment = onSchedule(
  { schedule: "every 5 minutes", secrets: [paystackSecret, fazerCardsKey], timeoutSeconds: 120 },
  async () => {
    const staleLimit = Date.now() - 5 * 60 * 1000;
    const activeStates = ["claimed", "submitting"];
    const activeSnapshots = await Promise.all(activeStates.map((status) =>
      db.collection("orders").where("fulfillmentStatus", "==", status).limit(100).get()
    ));
    for (const snapshot of activeSnapshots) {
      for (const orderDoc of snapshot.docs) {
        const order = orderDoc.data();
        const started = order.fulfillmentClaimedAt || order.fulfillmentStartedAt;
        const startedMs = typeof started?.toMillis === "function" ? started.toMillis() : 0;
        if (startedMs && startedMs < staleLimit) {
          const canRetryWithIdempotency = Number(order.fulfillmentAttemptCount || 0) < MAX_FULFILLMENT_ATTEMPTS;
          await orderDoc.ref.update({
            fulfillmentStatus: canRetryWithIdempotency ? "retryable" : "reconciliation-required",
            fulfillmentRetrySafe: canRetryWithIdempotency,
            nextFulfillmentAttemptAt: admin.firestore.Timestamp.now(),
            fulfillmentError: canRetryWithIdempotency
              ? "Resubmitting the same logical order with its stable FazerCards idempotency key."
              : "Automatic attempts are exhausted. Reconcile the order in FazerCards before taking further action.",
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      }
    }

    const retrySnapshot = await db.collection("orders").where("fulfillmentStatus", "==", "retryable").limit(100).get();
    for (const orderDoc of retrySnapshot.docs) {
      const order = orderDoc.data();
      const due = order.nextFulfillmentAttemptAt?.toMillis?.() || 0;
      if (order.fulfillmentRetrySafe === true && due <= Date.now() && Number(order.fulfillmentAttemptCount || 0) < MAX_FULFILLMENT_ATTEMPTS && order.paymentReference) {
        try {
          await fulfillVerifiedPayment(order.paymentReference, true);
        } catch (error) {
          console.error("SAFE FULFILLMENT RETRY ERROR", { orderId: orderDoc.id, message: error.message });
        }
      }
    }
  }
);

exports.resolveTopupFulfillment = onCall(
  { secrets: [paystackSecret, fazerCardsKey] },
  async (request) => {
    const adminUid = await requireAdmin(request);
    const orderId = cleanText(request.data?.orderId, "Order ID", 80);
    if (!validOrderId(orderId)) throw new HttpsError("invalid-argument", "Order ID is invalid.");
    const resolution = request.data?.resolution;
    const orderRef = db.doc(`orders/${orderId}`);
    const supplierOrderId = cleanText(request.data?.supplierOrderId || "", "Supplier order ID", 120, { required: false });

    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists) throw new HttpsError("not-found", "Order was not found.");
      const order = snapshot.data();
      if (order.orderType !== "topup" || order.fulfillmentStatus !== "reconciliation-required" || order.paymentStatus !== "paid") {
        throw new HttpsError("failed-precondition", "This order is not awaiting supplier reconciliation.");
      }
      if (resolution === "supplier-found") {
        if (!supplierOrderId) throw new HttpsError("invalid-argument", "Supplier order ID is required.");
        transaction.update(orderRef, {
          fulfillmentStatus: "submitted",
          supplierOrderId,
          supplierStatus: "processing",
          fulfillmentRetrySafe: false,
          lastFulfillmentResolution: { action: resolution, adminUid, at: admin.firestore.FieldValue.serverTimestamp() },
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } else if (resolution === "supplier-not-found") {
        transaction.update(orderRef, {
          fulfillmentStatus: "retryable",
          fulfillmentRetrySafe: true,
          nextFulfillmentAttemptAt: admin.firestore.Timestamp.now(),
          lastFulfillmentResolution: { action: resolution, adminUid, at: admin.firestore.FieldValue.serverTimestamp() },
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        throw new HttpsError("invalid-argument", "Choose supplier-found or supplier-not-found.");
      }
    });

    if (resolution === "supplier-not-found") await fulfillVerifiedPayment((await orderRef.get()).data().paymentReference, true);
    await db.collection(`orders/${orderId}/fulfillmentAudit`).add({ action: resolution, adminUid, supplierOrderId: supplierOrderId || null, at: admin.firestore.FieldValue.serverTimestamp() });
    return { ok: true, fulfillmentKey: stableFulfillmentKey(orderId) };
  }
);

exports.updateTopupOrderStatus = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const orderId = cleanText(request.data?.orderId, "Order ID", 80);
  const status = cleanText(request.data?.status, "Order status", 20);
  if (!validOrderId(orderId) || !["processing", "delivered", "failed"].includes(status)) {
    throw new HttpsError("invalid-argument", "Order ID or status is invalid.");
  }
  const orderRef = db.doc(`orders/${orderId}`);
  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(orderRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Order was not found.");
    const order = snapshot.data();
    if (order.orderType !== "topup") throw new HttpsError("failed-precondition", "This action is only for top-up orders.");
    if (status === "delivered" && (order.paymentStatus !== "paid" || !["submitted", "delivered"].includes(order.fulfillmentStatus))) {
      throw new HttpsError("failed-precondition", "Only paid orders confirmed by the supplier can be marked delivered.");
    }
    if (["delivered", "failed"].includes(order.status) && status !== order.status) {
      throw new HttpsError("failed-precondition", "A final top-up status cannot be reopened.");
    }
    transaction.update(orderRef, {
      status,
      fulfillmentStatus: status === "delivered" ? "delivered" : status === "failed" ? "failed" : order.fulfillmentStatus,
      ...(status === "delivered" ? { deliveredAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
      ...(status === "failed" ? { failedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { orderId, status, fulfillmentStatus: status === "delivered" ? "delivered" : status === "failed" ? "failed" : order.fulfillmentStatus };
  });
  await db.collection(`orders/${orderId}/fulfillmentAudit`).add({
    action: "admin-status-update",
    adminUid,
    status,
    at: admin.firestore.FieldValue.serverTimestamp()
  });
  return result;
});

exports.submitAccountListing = onCall(async (request) => {
  const uid = requireAuth(request);
  const data = request.data || {};
  const gameId = validateGameId(data.gameId);
  if (data.sellerAgreementAccepted !== true || data.sellerAgreementVersion !== SELLER_AGREEMENT_VERSION) {
    throw new HttpsError("failed-precondition", "Accept the current Marketplace Seller Agreement before submitting.");
  }
  const title = cleanText(data.title, "Account title", 120);
  const region = cleanText(data.region, "Region", 80);
  const level = cleanText(data.level, "Level", 40);
  const rank = cleanText(data.rank, "Rank", 80);
  const description = cleanText(data.description, "Description", 1500);
  const contact = cleanText(data.contact, "Contact information", 80);
  const price = Number(data.price);
  if (!Number.isSafeInteger(price) || price <= 0) throw new HttpsError("invalid-argument", "Price must be a positive whole number.");
  const images = ["image1", "image2", "image3"].map((field) => safeHttpUrl(data[field], field, { optional: true }));
  const user = await admin.auth().getUser(uid);
  const listingRef = db.collection("listings").doc();
  const listingData = {
    sellerId: uid,
    sellerName: cleanText(user.displayName || "Savage Store seller", "Seller name", 100),
    gameId,
    title,
    region,
    price,
    level,
    rank,
    description,
    image1: images[0],
    image2: images[1],
    image3: images[2],
    status: "pending-review",
    sellerAgreementVersion: SELLER_AGREEMENT_VERSION,
    sellerAgreementAcceptedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  const privateListingData = {
    sellerId: uid,
    sellerEmail: user.email || "",
    contact,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };
  await db.runTransaction(async (transaction) => {
    transaction.create(listingRef, listingData);
    transaction.create(db.doc(`listingSecrets/${listingRef.id}`), privateListingData);
  });
  return { listingId: listingRef.id, status: "pending-review" };
});

exports.getAdminListingContact = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const listingId = cleanText(request.data?.listingId, "Listing ID", 120);
  const listingSnapshot = await db.doc(`listings/${listingId}`).get();
  if (!listingSnapshot.exists) throw new HttpsError("not-found", "Listing was not found.");
  const privateSnapshot = await db.doc(`listingSecrets/${listingId}`).get();
  if (!privateSnapshot.exists) throw new HttpsError("not-found", "Private seller contact is unavailable.");
  const privateData = privateSnapshot.data();
  await db.collection("listingContactAccessAudit").add({
    listingId,
    sellerId: privateData.sellerId,
    adminId: adminUid,
    accessedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return {
    sellerEmail: cleanText(privateData.sellerEmail || "", "Seller email", 254, { required: false }),
    contact: cleanText(privateData.contact || "", "Seller contact", 80, { required: false })
  };
});

function validatePlayerUid(gameId, uid) {
  const value = cleanText(uid, "Player UID", 32);
  const provider = gameProfileProviders[gameId];
  const valid = typeof provider?.validateUid === "function" ? provider.validateUid(value) : /^\d{1,32}$/.test(value);
  if (!valid) throw new HttpsError("invalid-argument", "Enter a valid numeric player UID for the selected game.");
  return value;
}

async function consumeLookupRateLimit(uid) {
  const ref = db.doc(`profileLookupRateLimits/${uid}`);
  const now = Date.now();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.data() || {};
    const windowStart = Number(current.windowStart || 0);
    const count = windowStart > now - 60000 ? Number(current.count || 0) : 0;
    if (count >= 5) throw new HttpsError("resource-exhausted", "Too many lookup requests. Try again in one minute.");
    transaction.set(ref, { windowStart: count === 0 ? now : windowStart, count: count + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
}

exports.lookupGameProfile = onCall(async (request) => {
  const uid = requireAuth(request);
  const gameId = validateGameId(request.data?.gameId);
  const playerUid = validatePlayerUid(gameId, request.data?.uid);
  await consumeLookupRateLimit(uid);
  const provider = gameProfileProviders[gameId];
  if (!provider) {
    return {
      available: false,
      gameId,
      message: "Automatic lookup is unavailable. Savage Store has no documented, authorized profile API configured for this game."
    };
  }

  // Provider adapters must return only fields their documented API allows.
  // A lookup token, not browser-submitted profile JSON, binds the result to its owner.
  const profile = await provider.lookup(playerUid);
  const token = crypto.randomUUID();
  await db.doc(`profileLookupTokens/${token}`).set({
    ownerId: uid,
    gameId,
    uid: playerUid,
    provider: provider.id,
    profile,
    fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 15 * 60 * 1000)
  });
  return { available: true, gameId, profile, profileProvider: provider.id, lookupToken: token, fetchedAt: new Date().toISOString() };
});

exports.createAccountSwap = onCall(async (request) => {
  const ownerId = requireAuth(request);
  const data = request.data || {};
  const gameId = validateGameId(data.gameId);
  if (gamePolicies[gameId]?.swapsEnabled !== true) {
    throw new HttpsError("failed-precondition", "Account swaps are unavailable for this game under its current publisher terms.");
  }
  if (data.agreementAccepted !== true || data.agreementVersion !== SWAP_AGREEMENT_VERSION) {
    throw new HttpsError("failed-precondition", "Accept the current account-swap policy notice before submitting.");
  }
  const playerUid = validatePlayerUid(gameId, data.uid);
  const lookupToken = cleanText(data.lookupToken, "Profile lookup", 80);
  const tokenRef = db.doc(`profileLookupTokens/${lookupToken}`);
  const tokenSnapshot = await tokenRef.get();
  if (!tokenSnapshot.exists) throw new HttpsError("failed-precondition", "Run an authorized profile lookup before submitting.");
  const token = tokenSnapshot.data();
  if (token.ownerId !== ownerId || token.gameId !== gameId || token.uid !== playerUid || token.expiresAt.toMillis() <= Date.now()) {
    throw new HttpsError("permission-denied", "Profile lookup does not match this account or has expired.");
  }
  const ownerProfileSnapshot = await db.doc(`users/${ownerId}`).get();
  const ownerContact = cleanText(ownerProfileSnapshot.data()?.phone || "", "Savage Store profile contact", 80);
  const screenshots = Array.isArray(data.screenshots) ? data.screenshots.slice(0, 5).map((value, index) => safeHttpUrl(value, `Screenshot ${index + 1}`, { optional: true })).filter(Boolean) : [];
  const cashDifference = Number(data.cashDifference ?? 0);
  if (!Number.isSafeInteger(cashDifference) || cashDifference < 0) throw new HttpsError("invalid-argument", "Cash difference must be a non-negative whole number.");
  const swapRef = db.collection("accountSwaps").doc();
  await db.runTransaction(async (transaction) => {
    const currentToken = await transaction.get(tokenRef);
    if (!currentToken.exists || currentToken.data().ownerId !== ownerId) throw new HttpsError("failed-precondition", "Profile lookup token has already been used.");
    transaction.create(swapRef, {
      swapId: swapRef.id,
      ownerId,
      gameId,
      uid: playerUid,
      region: cleanText(data.region || "", "Region", 80, { required: false }),
      publicProfileSnapshot: token.profile,
      profileProvider: token.provider,
      profileFetchedAt: token.fetchedAt,
      desiredSwapDetails: cleanText(data.desiredSwapDetails, "Swap requirements", 1200),
      description: cleanText(data.description || "", "Description", 1200, { required: false }),
      screenshots,
      cashDifference,
      status: "pending-review",
      agreementAccepted: true,
      agreementVersion: SWAP_AGREEMENT_VERSION,
      submittedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    transaction.create(db.doc(`accountSwapSecrets/${swapRef.id}`), {
      ownerId,
      contact: ownerContact,
      adminNotes: "",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    transaction.delete(tokenRef);
  });
  return { swapId: swapRef.id, status: "pending-review" };
});

exports.reviewAccountSwap = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const swapId = cleanText(request.data?.swapId, "Swap ID", 120);
  const status = cleanText(request.data?.status, "Review status", 40);
  const allowed = new Set(["under-review", "verification-required", "approved", "rejected", "matched", "transfer-in-progress", "completed", "cancelled", "suspended"]);
  if (!allowed.has(status)) throw new HttpsError("invalid-argument", "Unsupported swap review status.");
  const swapRef = db.doc(`accountSwaps/${swapId}`);
  const notes = cleanText(request.data?.adminNotes || "", "Admin notes", 1500, { required: false });
  if (["rejected", "suspended"].includes(status) && !notes) {
    throw new HttpsError("failed-precondition", "Add a reason before rejecting or suspending a swap request.");
  }
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(swapRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Swap request was not found.");
    const swap = snapshot.data();
    if (["approved", "matched", "transfer-in-progress", "completed"].includes(status) && gamePolicies[swap.gameId]?.swapsEnabled !== true) {
      throw new HttpsError("failed-precondition", "This game's current publisher terms do not allow account swaps to proceed.");
    }
    if (swap.ownerId === adminUid && ["approved", "matched", "transfer-in-progress", "completed"].includes(status)) {
      throw new HttpsError("permission-denied", "An administrator cannot approve or complete their own swap request.");
    }
    transaction.update(swapRef, {
      status,
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewedBy: adminUid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    transaction.set(db.doc(`accountSwapSecrets/${swapId}`), {
      adminNotes: notes,
      lastReviewedBy: adminUid,
      lastReviewedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
  return { swapId, status };
});

exports.recordAccountSale = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const listingId = cleanText(request.data?.listingId, "Listing ID", 120);
  const buyerId = cleanText(request.data?.buyerId, "Buyer Firebase UID", 128);
  const finalSalePrice = Number(request.data?.finalSalePrice);
  if (!Number.isSafeInteger(finalSalePrice) || finalSalePrice <= 0) throw new HttpsError("invalid-argument", "Final sale price must be a positive whole number.");
  const paymentStatus = request.data?.paymentStatus || "pending";
  const transferStatus = request.data?.transferStatus || "pending";
  const sellerPayoutStatus = request.data?.sellerPayoutStatus || "pending";
  if (!["pending", "confirmed", "failed"].includes(paymentStatus)) throw new HttpsError("invalid-argument", "Invalid sale payment status.");
  if (!["pending", "in-progress", "completed", "failed"].includes(transferStatus)) throw new HttpsError("invalid-argument", "Invalid account transfer status.");
  if (!["pending", "paid"].includes(sellerPayoutStatus)) throw new HttpsError("invalid-argument", "Invalid seller payout status.");
  if (transferStatus === "completed" && paymentStatus !== "confirmed") throw new HttpsError("failed-precondition", "Confirm account-sale payment before marking transfer complete.");
  if (sellerPayoutStatus === "paid" && transferStatus !== "completed") throw new HttpsError("failed-precondition", "Record seller payout only after the transfer is complete.");

  const listingRef = db.doc(`listings/${listingId}`);
  const saleRef = db.doc(`accountSales/${listingId}`);
  try {
    await admin.auth().getUser(buyerId);
  } catch {
    throw new HttpsError("not-found", "The buyer account was not found.");
  }
  const saleResult = await db.runTransaction(async (transaction) => {
    const listingSnapshot = await transaction.get(listingRef);
    const priorSaleSnapshot = await transaction.get(saleRef);
    if (!listingSnapshot.exists) throw new HttpsError("not-found", "Listing was not found.");
    const listing = listingSnapshot.data();
    if (listing.sellerId === buyerId) throw new HttpsError("failed-precondition", "A seller cannot be their own account-sale buyer.");
    if (!priorSaleSnapshot.exists && listing.status !== "approved") throw new HttpsError("failed-precondition", "Only an approved listing can enter an account sale.");
    if (priorSaleSnapshot.exists && priorSaleSnapshot.data().buyerId !== buyerId) {
      throw new HttpsError("failed-precondition", "The buyer on a recorded account sale cannot be changed.");
    }
    if (priorSaleSnapshot.exists && priorSaleSnapshot.data().transferStatus === "completed") {
      const priorSale = priorSaleSnapshot.data();
      if (transferStatus !== "completed" || paymentStatus !== "confirmed" || finalSalePrice !== priorSale.finalSalePrice) {
        throw new HttpsError("failed-precondition", "A completed account sale cannot be reopened or repriced.");
      }
      if (priorSale.sellerPayoutStatus === "paid" && sellerPayoutStatus !== "paid") {
        throw new HttpsError("failed-precondition", "A recorded seller payout cannot be reversed.");
      }
    }

    const completed = transferStatus === "completed";
    const fee = completed ? calculateMarketplaceFee(finalSalePrice, MARKETPLACE_FEE_RATE) : { marketplaceFee: 0, sellerPayout: 0, feeRate: MARKETPLACE_FEE_RATE };
    const sale = {
      saleId: listingId,
      listingId,
      sellerId: listing.sellerId,
      buyerId,
      gameId: listing.gameId || "free-fire",
      originalListingPrice: Number(listing.price || 0),
      finalSalePrice,
      feeRate: fee.feeRate,
      marketplaceFee: fee.marketplaceFee,
      sellerProceeds: fee.sellerPayout,
      feeApplied: completed,
      paymentStatus,
      transferStatus,
      sellerPayoutStatus,
      adminId: adminUid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(priorSaleSnapshot.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
      ...(completed ? { completedAt: admin.firestore.FieldValue.serverTimestamp() } : {})
    };
    transaction.set(saleRef, sale, { merge: true });
    transaction.update(listingRef, {
      status: completed ? "sold" : transferStatus === "failed" ? "approved" : "under-sale",
      ...(completed ? { soldAt: admin.firestore.FieldValue.serverTimestamp(), soldTo: buyerId, saleId: listingId } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { saleId: listingId, completed, ...fee };
  });
  await db.collection(`accountSales/${listingId}/audit`).add({
    action: "admin-sale-update",
    adminId: adminUid,
    finalSalePrice,
    paymentStatus,
    transferStatus,
    sellerPayoutStatus,
    at: admin.firestore.FieldValue.serverTimestamp()
  });
  return saleResult;
});
