# Durian Paradise

E-commerce storefront for a durian seller in Singapore. Customers can order online delivery or book durian parties. Deployed on Render.

## Running locally

```bash
npm start        # starts server on port 3000
```

Environment variables are read from `process.env`. For local dev, set them manually or use a `.env` file with a loader. Key ones:

| Variable | Purpose |
|---|---|
| `PORT` | Server port (default: 3000) |
| `SITE_URL` | Full origin URL (default: https://www.durianparadises.com) |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `PAYMENT_PROVIDER` | `stripe_checkout` or `pending_dynamic_sgqr` |
| `RESEND_API_KEY` | Transactional email via Resend |
| `ENABLE_TEST_HELPERS` | Set to `1` to enable `/api/test/*` routes |
| `ANALYTICS_AUTH_USER` / `ANALYTICS_AUTH_PASSWORD` | Basic auth for analytics endpoint |

## Architecture

Single-file Node.js/Express app (`server.js`). No build step. Static HTML files served directly.

Data is stored as JSON files on disk (persisted on Render via a 1 GB disk mounted at `/var/data`):
- `orders.json` — all orders
- `reviews.json` — customer reviews
- `referrals.json` — referral codes and conversions
- `analytics.json` — page/event analytics

## Key API routes

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/payment-orders` | Create a new order |
| POST | `/api/payment-orders/:orderId/paid` | Mark order paid (PayNow flow) |
| GET | `/api/payment-orders/:orderId` | Get order status |
| POST | `/stripe-webhook` | Stripe webhook handler |
| POST | `/api/create-checkout-session` | Create Stripe Checkout session |
| GET | `/api/payment-config` | Returns active payment provider |
| POST | `/api/reviews` | Submit a review |
| GET | `/api/reviews` | List reviews |
| POST | `/api/referrals` | Create referral code |
| GET | `/api/referrals/:code` | Look up referral |
| GET | `/api/analytics/summary` | Analytics dashboard (auth required) |
| POST | `/api/analytics/events` | Track an analytics event |

## Product catalog

Products are keyed by `"type-group|variant"` (e.g. `"delivery-group1|650g"`, `"party-group2|g2-24"`). Prices are in cents (SGD). Defined statically in `server.js` around line 55.

## Payment flows

Two modes controlled by `PAYMENT_PROVIDER`:
- **`stripe_checkout`** — redirects to Stripe-hosted checkout; webhook marks order paid
- **`pending_dynamic_sgqr`** — shows a PayNow/SGQR QR code; customer pays manually, order polled/marked paid via `/api/payment-orders/:orderId/paid`

## Deployment

Deployed on Render (see `render.yaml`). Auto-deploys on push to `main`. Node 24. Logs split into `server.out.log` (stdout) and `server.err.log` (stderr) — these files are blocked from public access.

Sensitive files are blocked from static serving: `orders.json`, `analytics.json`, `referrals.json`, `server.js`, etc.

## Rules for Claude Code

Before editing any file:
- First explain what you are going to inspect.
- Do not make large rewrites unless explicitly asked.
- Do not change payment, order, email, cart, or environment variable logic unless the task is specifically about that system.
- Never expose secret values from environment variables.
- Preserve existing working behavior.
- Prefer small, testable fixes.
- Do not create unnecessary new files or dependencies.
- Do not rename environment variables unless absolutely necessary.
- If touching Stripe, order confirmation emails, cart clearing, or Render deployment, explain the full test plan.

After editing:
- Summarize every file changed.
- Explain exactly what changed and why.
- Give local testing steps.
- Give Render deployment testing steps if relevant.
- Tell me how to roll back if something breaks.

## Autonomy Rules

Claude should not ask for confirmation after every analysis.

Claude may proceed with code inspection, bug fixing, refactoring, formatting, and test/build runs without asking, as long as the change is safe and reversible.

Claude must ask before:
- deleting major files
- removing features
- changing payment/security-critical flows
- changing environment variable requirements
- making irreversible architecture changes

Default behavior: proceed, implement, test, then summarize.