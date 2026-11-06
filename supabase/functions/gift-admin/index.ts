import { handleGiftAdmin } from "../_shared/gift_http.ts";
import { supabaseGiftStore, supabaseRequireAdmin } from "../_shared/gift_store_supabase.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const origins = (Deno.env.get("GIFT_ALLOWED_ORIGINS") ?? "https://teafairyworld.co.uk,https://www.teafairyworld.co.uk")
  .split(",")
  .map((part) => part.trim())
  .filter(Boolean);

const store = supabaseGiftStore({ url, serviceRoleKey });

Deno.serve((req) =>
  handleGiftAdmin(req, {
    allowedOrigins: origins,
    store,
    requireAdmin: supabaseRequireAdmin({ url, serviceRoleKey, anonKey }),
  })
);
