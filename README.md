# HaYaM 🎂 Cakes & SweeTs

A responsive cake shop and custom-order app you can open and edit in Visual Studio Code. Customers can create accounts with phone + password, verify their phone by SMS, submit custom cake requests, upload payment receipts, and chat with the shop. Admins can review orders, manage statuses, and view receipts privately.

## Run it locally

1. Create a [Supabase](https://supabase.com/) project.
2. In the Supabase SQL Editor, run `supabase/schema.sql`.
3. In **Project Settings → API**, copy the Project URL and anon/public key into `config.js`. The anon key is intended for browser use; never put a `service_role` key in this app.
4. In Supabase **Authentication → Providers → Phone**, enable phone authentication and configure an SMS provider. Set your minimum password length and authentication settings there. Phone numbers must use international format, such as `+201012345678`.
5. Create the first admin user through the app and complete phone verification. In the Supabase SQL Editor, promote that user's UUID:

   ```sql
   update public.profiles set role = 'admin' where id = 'YOUR_AUTH_USER_UUID';
   ```

   Find the UUID in **Authentication → Users**. Do not hard-code admin credentials in the frontend. Admin accounts should use a unique password and a phone number you control.
6. Serve the folder with VS Code's **Live Server** extension (or `python -m http.server 8000`) and open the local address. The Supabase JavaScript client is loaded from `esm.sh`, so an internet connection is needed.

Supabase phone signup sends a one-time SMS code. The customer sets and confirms a password in the app, verifies their number, then uses their phone + password to sign in.

## Order and payment flow

A customer submits a request; it appears as **Awaiting review**. The admin reviews it and changes the status to **Approve order**. The admin should send the current InstaPay payment instructions to the customer through the order chat. The customer uploads the receipt image; the image is saved in a private bucket and the order becomes **Payment under review**. The admin manually inspects the receipt, then changes the status to **Confirm payment**. Never treat a receipt image as proof of payment by itself.

The app does **not** claim it can determine whether a receipt image is genuine or edited. Image-forensics AI is not reliable proof of payment and needs a separately configured server-side AI provider. All receipt checks remain manual; there is no automatic approval or payment processing.

## Security and production notes

- `supabase/schema.sql` enables row-level security and private receipt storage. Customers can see their own orders and messages; only admins can view all orders, update order status, and access other customers' receipts.
- Keep Supabase's SMS rate limits, CAPTCHA/bot protection, and password policies enabled. Phone/SMS charges may apply.
- Use HTTPS and configure Supabase Auth's allowed redirect URLs for your deployed domain.
- The displayed cake cards are sample items, not a live priced catalog. Confirm availability, price, delivery, and InstaPay details with customers in chat before taking payment.
- This starter does not process payments, send push notifications, or include an AI image-verification service.
