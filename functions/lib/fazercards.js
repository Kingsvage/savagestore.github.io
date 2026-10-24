"use strict";

const crypto = require("node:crypto");

function normalizeFieldSchema(fields) {
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((field) => {
    const key = typeof field?.key === "string" ? field.key.trim() : "";
    const label = typeof field?.label === "string" ? field.label.trim() : key;
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || !label) return [];
    return [{
      key,
      label: label.slice(0, 80),
      type: typeof field.type === "string" ? field.type.slice(0, 24) : "text",
      required: field.required !== false
    }];
  });
}

function normalizeTopupCatalog(payload, categoryId) {
  const fields = normalizeFieldSchema(payload?.fields);
  const sourceOffers = Array.isArray(payload?.offers) ? payload.offers : [];
  const offers = sourceOffers.flatMap((offer) => {
    const id = offer?.offer_id == null ? "" : String(offer.offer_id);
    const cost = Number(offer?.price_usd);
    const name = typeof offer?.name === "string" ? offer.name.trim() : "";
    if (!id || !name || !Number.isFinite(cost) || cost <= 0) return [];
    return [{ id, name: name.slice(0, 120), supplierCost: cost, fields }];
  });
  return { categoryId: String(categoryId), fields, offers };
}

function validateTopupFields(schema, submittedFields) {
  if (!Array.isArray(schema) || schema.length === 0) {
    throw new Error("FazerCards did not provide the required player fields.");
  }
  if (!submittedFields || typeof submittedFields !== "object" || Array.isArray(submittedFields)) {
    throw new Error("Player information is invalid.");
  }
  const allowedKeys = new Set(schema.map((field) => field.key));
  if (Object.keys(submittedFields).some((key) => !allowedKeys.has(key))) {
    throw new Error("Player information does not match the current game form.");
  }
  const fields = {};
  for (const field of schema) {
    const value = submittedFields[field.key];
    if (value == null || String(value).trim() === "") {
      if (field.required) throw new Error(`${field.label} is required.`);
      continue;
    }
    const normalized = String(value).trim();
    if (normalized.length > 120) throw new Error(`${field.label} is too long.`);
    fields[field.key] = normalized;
  }
  return fields;
}

function primaryPlayerId(schema, fields) {
  const identityField = schema.find((field) => /^(player[_-]?id|user[_-]?id|uid)$/i.test(field.key));
  return identityField ? fields[identityField.key] || "" : Object.values(fields)[0] || "";
}

function buildFazerCardsTopupRequest({ categoryId, offerId, fields, idempotencyKey }) {
  if (!categoryId || !offerId || !idempotencyKey) throw new Error("FazerCards order identifiers are required.");
  if (idempotencyKey.length > 255 || !/^[\x21-\x7E]+$/.test(idempotencyKey)) {
    throw new Error("FazerCards idempotency key is invalid.");
  }
  return {
    path: "/topups/order",
    headers: { "Idempotency-Key": idempotencyKey },
    body: { category_id: categoryId, offer_id: offerId, fields }
  };
}

function verifyFazerCardsWebhookSignature(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== "string" || !secret) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const actualBytes = Buffer.from(signature, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

function mapFazerCardsStatus(status) {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (normalized === "completed") return { supplierStatus: normalized, status: "delivered", fulfillmentStatus: "delivered" };
  if (["failed", "refund", "refunded"].includes(normalized)) {
    return { supplierStatus: normalized, status: "failed", fulfillmentStatus: "failed" };
  }
  if (["created", "processing"].includes(normalized)) {
    return { supplierStatus: normalized, status: "processing", fulfillmentStatus: "submitted" };
  }
  return null;
}

module.exports = {
  normalizeFieldSchema,
  normalizeTopupCatalog,
  validateTopupFields,
  primaryPlayerId,
  buildFazerCardsTopupRequest,
  verifyFazerCardsWebhookSignature,
  mapFazerCardsStatus
};
