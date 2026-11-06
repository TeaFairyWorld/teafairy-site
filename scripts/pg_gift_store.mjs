import pg from "pg";

export function createPgGiftStore(pool) {
  return {
    async serviceConfig() {
      const { rows } = await pool.query("select gift_service_config() as config");
      return rows[0].config;
    },
    async rateHit(bucket, limit) {
      const { rows } = await pool.query("select gift_rate_hit($1, $2) as hits", [bucket, limit]);
      return rows[0].hits;
    },
    async tryClaim(codeHash, claim) {
      const { rows } = await pool.query("select gift_try_claim($1, $2::jsonb) as result", [
        Buffer.from(codeHash),
        JSON.stringify(claim),
      ]);
      return rows[0].result;
    },
    async list() {
      const { rows } = await pool.query("select gift_admin_list() as result");
      return rows[0].result;
    },
    async markShipped(id, carrier, tracking) {
      const { rows } = await pool.query("select gift_admin_mark_shipped($1::uuid, $2, $3) as result", [
        id,
        carrier,
        tracking,
      ]);
      return rows[0].result;
    },
    async redactDue() {
      const { rows } = await pool.query("select gift_admin_redact_due() as result");
      return rows[0].result;
    },
    async setCampaign(patch) {
      const { rows } = await pool.query("select gift_admin_set_campaign($1::jsonb) as result", [
        JSON.stringify(patch),
      ]);
      return rows[0].result;
    },
    async provision(hashes) {
      const buffers = hashes.map((hash) => Buffer.from(hash));
      const placeholders = buffers.map((_, index) => `$${index + 1}::bytea`).join(", ");
      const { rows } = await pool.query(`select gift_provision_hashes(ARRAY[${placeholders}]) as result`, buffers);
      return rows[0].result;
    },
  };
}

export function createPool(connectionString) {
  return new pg.Pool({ connectionString, max: 30 });
}
