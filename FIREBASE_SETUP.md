# Firebase Setup Notes

Use these rules to protect the production Firestore database. The website still
uses client-side UI checks, but real security must be enforced by Firestore.

## Install the Firestore rules

1. Open the Firebase console for the `savage-store-18507` project.
2. Go to **Firestore Database** → **Rules**.
3. Copy the contents of `firestore.rules` into the editor.
4. Click **Publish**.

## Add yourself as an admin

The rules use an `/admins/{uid}` document to identify admins.

1. Login to the site with your admin Gmail.
2. In Firebase console, go to **Authentication** → **Users**.
3. Copy your Firebase **User UID**.
4. Go to **Firestore Database** → **Data**.
5. Create a collection named `admins`.
6. Create a document whose document ID is your copied UID.
7. Add fields such as:
   - `email`: your admin Gmail
   - `role`: `admin`

Only create `admins` documents manually in the Firebase console. The rules block
website users from creating or editing admin records.

## Required manual tests after publishing

- Login as a normal customer and confirm Marketplace, Sell Account, and My Orders unlock.
- Login as a normal customer and confirm you cannot open the Admin dashboard.
- Login as the admin Gmail and confirm the Admin dashboard loads orders.
- Submit a top-up order as a customer and confirm it appears only for that customer.
- Update an order status as admin and confirm non-admin users cannot update it.
