"use strict";

function positiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return number;
}

function calculateCustomerPrice(supplierCost, pricing) {
  const cost = positiveNumber(supplierCost, "supplierCost");
  const exchangeRate = positiveNumber(pricing?.exchangeRate, "exchangeRate");
  const percent = Math.max(0, Number(pricing?.markupPercent || 0));
  const fixed = Math.max(0, Number(pricing?.fixedMarkup || 0));
  const minimumProfit = Math.max(0, Number(pricing?.minimumProfit || 0));
  const roundTo = Math.max(1, Number(pricing?.roundTo || 1));
  if (![percent, fixed, minimumProfit, roundTo].every(Number.isFinite)) {
    throw new Error("Pricing configuration contains an invalid number.");
  }

  const supplierNgn = cost * exchangeRate;
  const intended = Math.max(
    supplierNgn * (1 + percent / 100) + fixed,
    supplierNgn + minimumProfit
  );
  const rounded = Math.ceil(intended / roundTo) * roundTo;
  return Math.max(
    Math.ceil(supplierNgn + minimumProfit),
    rounded - (pricing?.endIn99 ? 1 : 0)
  );
}

function calculateMarketplaceFee(finalSalePrice, feeRate = 0.05) {
  const price = Number(finalSalePrice);
  const rate = Number(feeRate);
  if (!Number.isSafeInteger(price) || price <= 0) {
    throw new Error("Final sale price must be a positive whole number.");
  }
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error("Marketplace fee rate is invalid.");
  }
  const fee = Math.round(price * rate);
  return { marketplaceFee: fee, sellerPayout: price - fee, feeRate: rate };
}

module.exports = { positiveNumber, calculateCustomerPrice, calculateMarketplaceFee };
