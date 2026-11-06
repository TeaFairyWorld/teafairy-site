# TeaFairy / TEAFAIRY LIMITED website
Static site. Legal pages: privacy, terms, refunds, community guidelines.

## Gift redemption

`redeem.html` (nav: Gift) is the interview thank-you form: 20 separate standard gifts and one standalone grand prize. The grand prize does not include a standard gift. The form is switched off. `js/gift-config.js` sets `submissionsEnabled` to `false`, so the page does not send or store an address and does not show a success receipt.

When a human later switches it on, the only gift endpoint is:

`https://tkxepmevhhzfmorbhriz.supabase.co/functions/v1/gift-submit`

That is project `tkxepmevhhzfmorbhriz` (UK, `eu-west-2`). The request body is `{code, recipient_name, phone, email, address1, address2, city, postcode, country, consent}`. The browser sends the code itself. It does not send a gift id or a hash. A success receipt is only `{confirmation_id, tier}`.

The earlier plaintext `gift_save_submission` draft (`20261106124500_gift_submissions.sql`) is withdrawn and removed. Do not recreate it. The reviewed replacement is `supabase/migrations/20261106150000_gift_redeem.sql` and `supabase/functions/gift-submit/`. It has not been applied or deployed. Steps, the test-only batch, and the owner-only code export are in `supabase/proposed/README.md`.

Nothing in this repository deploys itself. Do not commit voucher codes, `VOUCHER_PEPPER`, the service-role key, `supabase/.env`, or real addresses.
