# Gift redemption deploy notes

Status: reviewed in the repository, not deployed. Project `tkxepmevhhzfmorbhriz` (`teafairy-gift-redemption`, org `rgldhpuyoqbumeuolule`, region `eu-west-2`) was empty when this was written: no gift tables, no migrations, and no edge functions. Do not apply this to any other project.

The public gift page stays closed until every step below is done and a real test redemption has been checked. `js/gift-config.js` must stay `submissionsEnabled: false` until then.

## What the pieces do

- `supabase/migrations/20261106150000_gift_redeem.sql` creates schema `gift_private`. Production ids are `G01`–`G20` (standard) and `GP01` (grand). A separate TEST-ONLY batch is `T01`–`T05` (standard) and `TP01` (grand). Issuing or redeeming the test batch does not insert or consume the production 21.
- `GP01` and `TP01` are the grand prize only. Redeeming one does not add a standard gift.
- The code is 16 random bytes, shown as 26 Crockford characters. The database stores `HMAC-SHA256` of the canonical code, keyed with `VOUCHER_PEPPER`. The pepper lives only as an edge-function secret.
- Addresses are inserted inside `gift_private.redeem`. `anon` cannot read or insert the tables. The edge function calls `public.gift_redeem` with the service role. That wrapper is not granted to `anon`. Management functions (`issue_batch`, `distribution_list`, `clear_distribution`) are not granted to `anon` or `service_role`.
- There is no expiry, membership, email, or shipping automation.

## Secrets

Create `supabase/.env` on the operator machine from `supabase/.env.example`. Do not commit it.

```bash
supabase secrets set --project-ref tkxepmevhhzfmorbhriz --env-file ./supabase/.env
```

`VOUCHER_PEPPER` must be at least 32 characters, with no spaces or line breaks. Leave `GIFT_SUBMIT_ACTIVE` empty until the test batch has been checked. The function also expects the platform-injected `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Do not copy the service-role key into the website or this repository.

Deploy `gift-submit` with `verify_jwt = false` (see `config.snippet.toml`). A deployed function still returns "unavailable" until `GIFT_SUBMIT_ACTIVE` is exactly `true` and the pepper is set.

## Owner-only code list

Plaintext codes are not kept in git. After the migration is applied, the owner runs this in the Supabase SQL editor (the postgres role), not through the public API. Use the same pepper value as the edge secret. The setting lasts for one transaction and is not written to a table.

```sql
begin;
select set_config('gift.voucher_pepper', '<pepper, this query must not be saved>', true);
select gift_private.issue_batch('test');
commit;
```

Then export and, once the copy is in a private store, clear the parked plaintext:

```sql
select * from gift_private.distribution_list();
select gift_private.clear_distribution();
select gift_private.distribution_pending();
```

`distribution_pending` must return `0` before the session ends. Copy the list into a password manager or a private file outside this repository. Do not paste it into git or chat. If the copy fails, do not call `clear_distribution`; the rows can be listed again. Clearing does not delete voucher hashes, so a cleared code cannot be shown again.

Issue production only after the test batch redeems correctly:

```sql
begin;
select set_config('gift.voucher_pepper', '<same pepper>', true);
select gift_private.issue_batch('production');
commit;
```

Export and clear that list the same way. `issue_batch` skips ids that already exist, so a second run does not rotate codes. The SQL editor may keep query history: remove the statement that contained the pepper.

Read stored addresses as the database owner in the SQL editor: `select` from `gift_private.addresses`. Do not expose `gift_private` in the API settings. The anon key cannot read that table.

## Switch the page on

1. Apply the migration to `tkxepmevhhzfmorbhriz`.
2. Set the pepper secret. Leave the function inactive.
3. Deploy `gift-submit`.
4. Issue and export the TEST-ONLY batch. Confirm `T01` and `TP01` with the edge function: a second submit of the same code returns `invalid_or_used` and does not change the address. `GP01` must still be absent.
5. Set `GIFT_SUBMIT_ACTIVE=true` with `supabase secrets set`.
6. Only then set `submissionsEnabled` to `true` in `js/gift-config.js` and publish the website.
7. Issue the production batch and export it privately.

The edge function was not deployed from this environment, and the migration was not applied.
