import { handleGiftRedeem } from "../_shared/gift_http.ts";
import { supabaseGiftStore } from "../_shared/gift_store_supabase.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const origins = (Deno.env.get("GIFT_ALLOWED_ORIGINS") ?? "https://teafairyworld.co.uk,https://www.teafairyworld.co.uk")
  .split(",")
  .map((part) => part.trim())
  .filter(Boolean);

Deno.serve((req) =>
  handleGiftRedeem(req, {
    pepper: Deno.env.get("GIFT_CODE_PEPPER") ?? "",
    allowedOrigins: origins,
    store: supabaseGiftStore({ url, serviceRoleKey }),
  })
);
