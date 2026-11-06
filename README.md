# TeaFairy / TEAFAIRY LIMITED website
Static site. Legal pages: privacy, terms, refunds, community guidelines.

Gift form: `redeem.html` (nav: Gift). It posts to the existing Supabase project only after `gift-submit` is deployed. Until then the page says the address was not saved. Nothing in this repository is deployed by itself.

## Gift storage (needs owner approval)

Do not run these against production until you mean to.

1. In the Supabase SQL editor for project `lqghuvaazdnqzkbagbay`, run `supabase/migrations/20261106124500_gift_submissions.sql`.
2. Copy `supabase/functions/gift-submit` into the Supabase functions (teatok was not accessible from this environment) and deploy it with `verify_jwt = false`. The function uses the injected `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. It does not send email.
3. Publish this website only after step 2. Then open the table `gift_submissions` in the Supabase dashboard to read reference codes and addresses. The anon key cannot read that table.
