// Service-role adapter. The browser never receives this key and never selects gift tables.
import { byteaHex, type ClaimPayload, type ServiceConfig } from "./gift_logic.ts";

type Cfg = { url: string; serviceRoleKey: string };

async function rpc<T>(cfg: Cfg, name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${cfg.url.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      apikey: cfg.serviceRoleKey,
      authorization: `Bearer ${cfg.serviceRoleKey}`,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`gift_rpc_${name}_${res.status}`);
  return await res.json() as T;
}

export function supabaseGiftStore(cfg: Cfg) {
  return {
    serviceConfig: () => rpc<ServiceConfig>(cfg, "gift_service_config", {}),
    rateHit: (bucket: string, limit: number) => rpc<number>(cfg, "gift_rate_hit", { p_bucket: bucket, p_limit: limit }),
    tryClaim: (codeHash: Uint8Array, claim: ClaimPayload) =>
      rpc<Record<string, unknown>>(cfg, "gift_try_claim", { p_code_hash: byteaHex(codeHash), p_claim: claim }),
    list: () => rpc<unknown[]>(cfg, "gift_admin_list", {}),
    markShipped: (id: string, carrier: string | null, tracking: string | null) =>
      rpc<Record<string, unknown>>(cfg, "gift_admin_mark_shipped", { p_id: id, p_carrier: carrier, p_tracking: tracking }),
    redactDue: () => rpc<number>(cfg, "gift_admin_redact_due", {}),
    setCampaign: (patch: Record<string, unknown>) =>
      rpc<ServiceConfig>(cfg, "gift_admin_set_campaign", { p_patch: patch }),
  };
}

export function supabaseRequireAdmin(cfg: Cfg & { anonKey: string }) {
  return async (req: Request) => {
    const header = req.headers.get("authorization") || "";
    const match = header.match(/^Bearer\s+(\S+)$/i);
    if (!match) return { ok: false as const, status: 401, error: "unauthorised" };
    const userRes = await fetch(`${cfg.url.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { authorization: `Bearer ${match[1]}`, apikey: cfg.anonKey },
    });
    if (!userRes.ok) return { ok: false as const, status: 401, error: "unauthorised" };
    const user = await userRes.json();
    const id = typeof user?.id === "string" ? user.id : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return { ok: false as const, status: 401, error: "unauthorised" };
    }
    const prof = await fetch(
      `${cfg.url.replace(/\/$/, "")}/rest/v1/profiles?id=eq.${id}&select=is_admin&limit=1`,
      {
        headers: {
          apikey: cfg.serviceRoleKey,
          authorization: `Bearer ${cfg.serviceRoleKey}`,
          accept: "application/json",
        },
      },
    );
    if (!prof.ok) return { ok: false as const, status: 403, error: "forbidden" };
    const rows = await prof.json();
    if (!rows?.[0]?.is_admin) return { ok: false as const, status: 403, error: "forbidden" };
    return { ok: true as const, userId: id };
  };
}
