// INACTIVE. Do not treat a copy of this file as a deployment.
// Project tkxepmevhhzfmorbhriz only. Stays closed until the secret
// GIFT_SUBMIT_ACTIVE is exactly "true" and VOUCHER_PEPPER is set on the function.
// Review supabase/proposed/README.md before any human deploys it.

import { handleGiftSubmit } from "./handler.mjs";

Deno.serve((req: Request) =>
  handleGiftSubmit(
    req,
    {
      get(name: string): string {
        return Deno.env.get(name) ?? "";
      },
    },
    globalThis.fetch,
  )
);
