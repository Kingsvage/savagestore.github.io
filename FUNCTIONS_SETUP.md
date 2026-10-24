# Savage Store backend configuration notes

These instructions describe the existing Savage Store Firebase project. The working copy was not deployed. Review and run any deployment yourself only after checking your Firebase project and provider configuration.

## Trusted settings and secrets

- Public client-safe switches and branding live in `settings/public`: `topupEnabled`, `marketplaceEnabled`, `maintenanceMode`, and `supportWhatsapp`.
- Backend-only price inputs live in `privateSettings/pricing`: `exchangeRate`, `markupPercent`, `fixedMarkup`, `minimumProfit`, `roundTo`, optional `endIn99`, and `supplierCategoryIds` (a game ID to FazerCards category ID map).
- Keep `PAYSTACK_SECRET_KEY`, `FAZERCARDS_API_KEY`, and the FazerCards webhook signing secret as `FAZERCARDS_WEBHOOK_SECRET` in Firebase Secret Manager. The backend uses FazerCards' documented `https://api.fzr.cards/api/v2` host and `X-API-Key` header; the API key remains server-side.
- Do not put internal pricing, supplier costs, API keys, account passwords, or payment credentials in `settings/public`, frontend JavaScript, HTML, URLs, or browser storage.

If the existing project currently has values in `settings/config`, do not delete or overwrite that document blindly. Copy only public switches and the existing support number to `settings/public`. Move pricing inputs into `privateSettings/pricing` through a trusted Firebase Admin environment. The new Firestore rules deny client reads of the old config and private settings.

## Paystack and FazerCards

The frontend creates `orders/{orderId}` and calls `initializePaystackPayment` with that same ID. The callable retrieves the configured category's live offers and dynamic player fields from FazerCards, calculates NGN pricing on the server, validates the submitted player fields, and initializes Paystack. Only a signed webhook followed by Paystack's server-side transaction verification marks payment paid and attempts supplier fulfillment.

Set `privateSettings/pricing.supplierCategoryIds.free-fire` and `.call-of-duty` to the category IDs enabled for Savage Store in the FazerCards catalog. This must be done with trusted Firebase Admin access; do not put category settings or supplier costs in `settings/public`. Configure the Paystack webhook at the deployed `paystackWebhook` URL and enable the `charge.success` event. Configure the FazerCards webhook at the deployed `fazerCardsWebhook` URL, copy the generated signing secret into `FAZERCARDS_WEBHOOK_SECRET`, and enable order-created/status-changed events. Use a provider sandbox only if FazerCards provides one; its published docs warn that some trial use runs against production balance, so verify before placing a test order.

A Firestore transaction atomically claims fulfillment and persists `savage-store-{orderId}` before the supplier request. The backend sends this exact value in FazerCards' documented `Idempotency-Key` header to `POST /topups/order`, with the documented `category_id`, `offer_id`, and dynamic `fields` payload. The provider says a repeat request with the same key returns the original order. Timed-out or stale attempts are retried with the same key and bounded backoff; after the retry limit, the order enters reconciliation. Signed FazerCards order/status events update paid top-up fulfillment and write audit records. This prevents duplicate logical orders while the provider honors its documented idempotency behavior; it is not a claim of exactly-once network execution.

Cloud Functions must be deployed for callable checkout, signed webhook processing, and scheduled recovery to operate. See the [FazerCards API reference](https://reseller.fazercards.com/en/docs) and [idempotency guidance](https://reseller.fazercards.com/en/blog/fault-tolerant-gift-card-api-orders).

## Listings, sale fee, and private contact

Seller submissions go through `submitAccountListing`, which checks the current agreement version, creates a `pending-review` public listing, and stores seller email/contact in `listingSecrets`. Admin contact reveal uses a callable that checks admin authorization and records an access audit entry. No account passwords are collected or stored.

`recordAccountSale` is admin-only. It calculates the mandatory 5% fee from the final sale price only when the transfer is marked completed. It records the remaining 95% as seller proceeds and keeps payout status pending until an administrator confirms the actual payout. This collection is separate from top-up orders.

## UID lookup and account swaps

FazerCards documents `GET /topups/validate-id` and `POST /topups/validate-id` for some top-up categories; where supported, the response can include `valid`, `player_name`, and `region`. This is limited top-up player-ID validation, not a general public profile API and not proof of account ownership. The current app does not use it for swap requests. No authorized general profile provider is configured for Free Fire or Call of Duty Mobile.

Account swaps are disabled for both current games because the publishers' terms prohibit account trading or transfer. The page explains this and prevents submission; the backend independently enforces the restriction. Revisit this only if the applicable policies and authorization change.

## Screenshots and UI assets

Seller and swap screenshots currently accept public HTTP(S) image links. Direct uploads need Firebase Storage rules, upload size/type limits, and a private review flow. No new logo asset was created; pages use the existing Savage Store logo URL.
