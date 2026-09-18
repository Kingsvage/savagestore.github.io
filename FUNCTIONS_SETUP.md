# Secure payment and supplier backend setup

The `functions/` directory is the only place that calls Paystack and FazerCards. Do not place either secret in GitHub Pages files, Firebase client configuration, or Firestore.

1. Install function dependencies: `cd functions && npm install`.
2. Authenticate to Firebase and select the existing Savage Store project.
3. Store production/test credentials outside the repository:
   - `firebase functions:secrets:set PAYSTACK_SECRET_KEY` (use an `sk_test_…` value until launch)
   - `firebase functions:secrets:set FAZERCARDS_API_KEY`
   - configure `FAZERCARDS_API_BASE` with the supplier's documented API base URL.
4. In Firestore `settings/config`, create a non-public `pricing` map with `exchangeRate`, `markupPercent`, `fixedMarkup`, `minimumProfit`, `roundTo`, and `endIn99`. The callable function calculates the final NGN amount on the server from the live offer cost.
5. Deploy: `firebase deploy --only functions,firestore:rules`.
6. In the Paystack dashboard (test mode), set the webhook URL to the deployed `paystackWebhook` endpoint and enable `charge.success`. Verify the webhook signing secret is handled by Paystack's signature header—the function validates it using the server secret.
7. Configure the FazerCards endpoint/path names to match the provider's current API documentation before enabling checkout. The included adapter deliberately has no supplier key or offer price in the browser.

GitHub Pages only hosts the frontend. It cannot securely verify payments or create supplier orders without the deployed Cloud Functions backend.
