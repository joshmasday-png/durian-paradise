# Deploy Durian Paradise On Render

This project includes a Node backend for:
- PayNow/UEN payment order creation
- persistent customer reviews
- referral links and referral reward tracking

## 1. Push the latest code to GitHub

```powershell
git add .
git commit -m "Update PayNow checkout and referral backend"
git push
```

## 2. Create the Render service

1. Log in to Render.
2. Click `New +`.
3. Choose `Blueprint`.
4. Connect the GitHub repository for this project.
5. Render will detect [render.yaml](/c:/Users/joshm/Downloads/durian-paradise/render.yaml).
6. Continue the setup.

## 3. Set environment variables in Render

Set these values in the Render dashboard:

- `SITE_URL`
  - your live Render URL or custom domain, for example:
  - `https://www.durianparadises.com`
- `BUSINESS_UEN`
  - `53490378M`
- `PAYMENT_PROVIDER`
  - `pending_dynamic_sgqr`
- `PAYMENT_PROVIDER_NAME`
  - `PayNow / SGQR`
- `STRIPE_SECRET_KEY`
  - only needed later if you add Stripe checkout
- `RESEND_API_KEY`
  - needed for automatic order-confirmation emails
- `ORDER_EMAIL_FROM`
  - `Durian Paradise <orders@durianparadises.com>`
- `ORDER_EMAIL_REPLY_TO`
  - `durianparadise6940@gmail.com`
- `ORDER_NOTIFICATION_EMAIL`
  - `durianparadise6940@gmail.com`
- `ANALYTICS_AUTH_USER`
  - choose an owner-only username for analytics access
- `ANALYTICS_AUTH_PASSWORD`
  - choose a strong owner-only password for analytics access

These file paths are already configured in `render.yaml` to use the persistent disk:

- `/var/data/reviews.json`
- `/var/data/orders.json`
- `/var/data/referrals.json`
- `/var/data/analytics.json`

## 4. Persistent Data

Render is configured with a mounted disk so reviews, PayNow payment orders, and referral rewards survive redeploys and restarts.

The live data files will be stored at:

- `/var/data/reviews.json`
- `/var/data/orders.json`
- `/var/data/referrals.json`
- `/var/data/analytics.json`

## 5. Important Limitations

PayNow UEN payment orders create the exact amount and order reference for customers to key into their banking app. Automatic bank confirmation still needs a connected bank/SGQR provider API.

The referral backend records referral conversions and issued rewards. Referrers should generate their referral link using the same contact number they plan to use at checkout, because rewards are now matched automatically by that checkout number even if they return on a different browser or device.

Order-confirmation emails and customer-paid notifications require an email provider API key. This project is ready for Resend using `RESEND_API_KEY`; without that key, orders still save, but email sending is skipped.

Analytics access is owner-only when `ANALYTICS_AUTH_USER` and `ANALYTICS_AUTH_PASSWORD` are set. Requests to `/api/analytics/summary` and any future `analytics.html` page will require those credentials.
