/**
 * Secure payment and supplier boundary for Savage Store.
 * Configure secrets outside source control:
 * firebase functions:secrets:set PAYSTACK_SECRET_KEY
 * firebase functions:secrets:set FAZERCARDS_API_KEY
 * Set FAZERCARDS_API_BASE with functions config or an environment variable.
 */
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();
const paystackSecret = defineSecret("PAYSTACK_SECRET_KEY");
const fazercardsKey = defineSecret("FAZERCARDS_API_KEY");
const supplierBaseUrl = defineString("FAZERCARDS_API_BASE");

const PAYSTACK_API = "https://api.paystack.co";
const CURRENCY = "NGN";

function requireAuth(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in before continuing.");
  return request.auth.uid;
}

function safeNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new HttpsError("invalid-argument", `${name} must be a positive number.`);
  }
  return number;
}

function calculateCustomerPrice(supplierCost, pricing) {
  const exchangeRate = safeNumber(pricing.exchangeRate, "exchangeRate");
  const percent = Math.max(0, Number(pricing.markupPercent || 0));
  const fixed = Math.max(0, Number(pricing.fixedMarkup || 0));
  const minimumProfit = Math.max(0, Number(pricing.minimumProfit || 0));
  const supplierNgn = supplierCost * exchangeRate;
  const intended = Math.max(supplierNgn * (1 + percent / 100) + fixed, supplierNgn + minimumProfit);
  const rounded = Math.ceil(intended / Math.max(1, Number(pricing.roundTo || 1))) * Math.max(1, Number(pricing.roundTo || 1));
  const psychologicalDiscount = pricing.endIn99 ? 1 : 0;
  return Math.max(Math.ceil(supplierNgn + minimumProfit), rounded - psychologicalDiscount);
}

async function paystack(path, options = {}) {
  const response = await fetch(`${PAYSTACK_API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${paystackSecret.value()}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok || !body.status) throw new Error(body.message || "Paystack request failed.");
  return body.data;
}

async function supplier(path, options = {}) {
  const base = supplierBaseUrl.value();
  if (!base) throw new Error("Supplier integration is not configured.");
  const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${fazercardsKey.value()}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error("Supplier request failed.");
  return response.json();
}

exports.getTopupCatalog = onCall({ secrets: [fazercardsKey] }, async (request) => {
  requireAuth(request);
  const gameId = String(request.data.gameId || "");
  if (!['free-fire', 'call-of-duty'].includes(gameId)) throw new HttpsError("invalid-argument", "Unsupported game.");
  const settings = (await db.doc("settings/config").get()).data() || {};
  const catalog = await supplier(`/categories?game=${encodeURIComponent(gameId)}`);
  const offers = await supplier(`/offers?game=${encodeURIComponent(gameId)}`);
  const pricing = settings.pricing || {};
  return {
    gameId,
    fields: catalog.fields || [],
    offers: (offers.data || offers.offers || []).map((offer) => ({
      id: String(offer.id), name: offer.name, gameId,
      price: calculateCustomerPrice(Number(offer.cost || offer.price), pricing),
      currency: CURRENCY
    }))
  };
});

exports.initializePaystackPayment = onCall({ secrets: [paystackSecret, fazercardsKey] }, async (request) => {
  const uid = requireAuth(request);
  const { orderId, offerId, gameId, player } = request.data || {};
  if (!orderId || !offerId || !['free-fire', 'call-of-duty'].includes(gameId) || !player) {
    throw new HttpsError("invalid-argument", "Order, offer, game, and player details are required.");
  }
  const orderRef = db.doc(`orders/${orderId}`);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists || orderSnap.data().userId !== uid) throw new HttpsError("permission-denied", "Order not found.");
  if (orderSnap.data().paymentStatus !== "pending") throw new HttpsError("failed-precondition", "This order is no longer payable.");
  const offers = await supplier(`/offers?game=${encodeURIComponent(gameId)}`);
  const offer = (offers.data || offers.offers || []).find((item) => String(item.id) === String(offerId));
  if (!offer) throw new HttpsError("not-found", "This offer is unavailable.");
  const settings = (await db.doc("settings/config").get()).data() || {};
  const amount = calculateCustomerPrice(Number(offer.cost || offer.price), settings.pricing || {});
  const reference = `svg_${orderId}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const transaction = await paystack("/transaction/initialize", { method: "POST", body: JSON.stringify({
    email: orderSnap.data().customerEmail, amount: Math.round(amount * 100), currency: CURRENCY,
    reference, metadata: { orderId, uid, gameId, offerId }
  })});
  await orderRef.update({ paymentReference: reference, paymentStatus: "pending", authoritativeAmount: amount, currency: CURRENCY, supplierOfferId: String(offerId), gameId, player, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  return { authorizationUrl: transaction.authorization_url, reference };
});

async function fulfillVerifiedPayment(reference) {
  const payment = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (payment.status !== "success" || payment.currency !== CURRENCY) throw new Error("Payment was not successful.");
  const orderId = payment.metadata?.orderId;
  const orderRef = db.doc(`orders/${orderId}`);
  await db.runTransaction(async (transaction) => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) throw new Error("Order does not exist.");
    const order = orderSnap.data();
    if (order.paymentReference !== payment.reference || payment.amount !== Math.round(Number(order.authoritativeAmount) * 100)) throw new Error("Payment verification mismatch.");
    if (order.paymentStatus === "paid") return;
    transaction.update(orderRef, { paymentStatus: "paid", fulfillmentStatus: "processing", status: "processing", paidAt: admin.firestore.FieldValue.serverTimestamp(), paymentReference: payment.reference });
  });
  const updated = (await orderRef.get()).data();
  if (updated.supplierOrderId) return;
  try {
    const result = await supplier("/orders", { method: "POST", body: JSON.stringify({ game: updated.gameId, offerId: updated.supplierOfferId, player: updated.player, clientReference: orderId }) });
    await orderRef.update({ supplierOrderId: String(result.id || result.orderId), supplierStatus: result.status || "processing", fulfillmentStatus: "processing", supplierCreatedAt: admin.firestore.FieldValue.serverTimestamp() });
  } catch (error) {
    await orderRef.update({ fulfillmentStatus: "failed", supplierStatus: "failed", fulfillmentError: "Supplier order could not be created.", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    console.error("SUPPLIER FULFILLMENT ERROR", error.message);
  }
}

exports.paystackWebhook = onRequest({ secrets: [paystackSecret] }, async (req, res) => {
  const signature = req.headers["x-paystack-signature"];
  const expected = crypto.createHmac("sha512", paystackSecret.value()).update(req.rawBody).digest("hex");
  if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return res.status(401).send("Invalid signature");
  }
  if (req.body?.event === "charge.success") await fulfillVerifiedPayment(req.body.data.reference);
  return res.status(200).send("ok");
});
