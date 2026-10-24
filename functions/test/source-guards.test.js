"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "../..");
const read = (name) => fs.readFileSync(path.join(projectRoot, name), "utf8");

test("client creates and initializes a top-up using the same document ID", () => {
  const source = read("script.js");
  assert.match(source, /doc\(db, "orders", currentOrder\.orderId\)/);
  assert.match(source, /setDoc\(orderRef, orderData\)/);
  assert.match(source, /initializePayment\(\{ orderId: currentOrder\.orderId, gameFields \}\)/);
  assert.match(read("functions/index.js"), /db\.doc\(`orders\/\$\{orderId\}`\)/);
});

test("browser code cannot mark a payment paid or call the supplier", () => {
  const source = read("script.js");
  assert.doesNotMatch(source, /paymentStatus\s*:\s*["']paid["']/);
  assert.doesNotMatch(source, /supplierOrderId\s*:/);
  assert.doesNotMatch(source, /addDoc\([^\n]*orders/);
  assert.match(source, /window\.openAccountPurchase[\s\S]*?https:\/\/wa\.me\//);
});

test("payment webhook checks a signature and verifies with Paystack before fulfillment", () => {
  const source = read("functions/index.js");
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /transaction\/verify/);
  assert.match(source, /await fulfillVerifiedPayment\(reference\)/);
  assert.match(source, /secrets: \[paystackSecret, fazerCardsKey\]/);
});

test("FazerCards uses documented v2 top-up routes and persisted idempotency keys", () => {
  const source = read("functions/index.js");
  const adapter = read("functions/lib/fazercards.js");
  assert.match(source, /https:\/\/api\.fzr\.cards\/api\/v2/);
  assert.match(source, /\/topups\/offers\?category_id=/);
  assert.match(adapter, /path: "\/topups\/order"/);
  assert.match(adapter, /"Idempotency-Key": idempotencyKey/);
  assert.doesNotMatch(source, /\/offers\?game=/);
  assert.doesNotMatch(source, /supplier\("\/orders"/);
});

test("FazerCards status webhook verifies the signature before updating paid top-ups", () => {
  const source = read("functions/index.js");
  assert.match(source, /exports\.fazerCardsWebhook = onRequest\(\{ secrets: \[fazerCardsWebhookSecret\] \}/);
  assert.match(source, /verifyFazerCardsWebhookSignature\(rawBody, signature, fazerCardsWebhookSecret\.value\(\)\)/);
  assert.match(source, /order\.paymentStatus !== "paid"/);
  assert.match(source, /fulfillmentAudit/);
});

test("one Firebase app, Auth instance, and auth-state listener are declared", () => {
  const source = read("script.js");
  assert.equal((source.match(/\binitializeApp\(/g) || []).length, 1);
  assert.equal((source.match(/\bgetAuth\(/g) || []).length, 1);
  assert.equal((source.match(/\bonAuthStateChanged\(/g) || []).length, 1);
});

test("private pricing and sensitive records are denied to client reads", () => {
  const rules = read("firestore.rules");
  assert.match(rules, /match \/privateSettings\/\{settingId\}[\s\S]*?allow read, write: if false/);
  assert.match(rules, /match \/listingSecrets\/\{listingId\}[\s\S]*?allow read: if signedIn\(\) && resource\.data\.sellerId == request\.auth\.uid/);
  assert.match(rules, /match \/accountSwapSecrets\/\{swapId\}[\s\S]*?allow read: if isAdmin\(\)/);
  assert.match(rules, /match \/accountSales\/\{saleId\}[\s\S]*?allow create, update, delete: if false/);
});

test("all static HTML IDs are unique and cache versions match", () => {
  const htmlFiles = fs.readdirSync(projectRoot).filter((file) => file.endsWith(".html"));
  for (const file of htmlFiles) {
    const source = read(file);
    const ids = [...source.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    assert.deepEqual(duplicates, [], `${file} has duplicate IDs`);
    const scriptVersion = source.match(/script\.js\?v=(\d+)/)?.[1];
    const styleVersion = source.match(/style\.css\?v=(\d+)/)?.[1];
    if (scriptVersion && styleVersion) assert.equal(scriptVersion, styleVersion, `${file} uses mismatched cache versions`);
    if (scriptVersion || styleVersion) assert.equal(scriptVersion || styleVersion, "62", `${file} needs the current asset version`);
  }
});

test("top-up form renders provider-defined player fields and submits them to the server", () => {
  const html = read("topup.html");
  const source = read("script.js");
  assert.match(html, /id="game-fields-container"/);
  assert.doesNotMatch(html, /id="uid"/);
  assert.match(source, /offer\.fields/);
  assert.match(source, /initializePayment\(\{ orderId: currentOrder\.orderId, gameFields \}\)/);
});
