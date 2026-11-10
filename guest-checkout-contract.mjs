// Tested contract for a future teatok change. This file is not deployed and
// does not call Stripe or the production database. Port it into
// create-guest-checkout and the existing stripe-webhook without changing the
// app path (metadata.channel !== 'web').
//
// Required before activation, still unread from this environment:
// - orders.channel must accept the value 'web' (add the enum label if it is an enum)
// - a unique index on orders.stripe_session_id
// - create-guest-checkout deployed with the service role only on the server
// - stripe-webhook signature check unchanged, with a web branch that does not
//   decrement stock again
// Do not apply those database changes until they are reviewed.

export const ALLOWED_SKU = 'beginner-tea-set';
export const UNIT_PRICE_MINOR = 9999;
export const FREE_SHIPPING_MINOR = 5000;
export const MAX_QUANTITY = 20;

export function createReservation(db, input) {
  if (!input || input.sku !== ALLOWED_SKU) return fail(400, 'sku');
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_QUANTITY) {
    return fail(400, 'quantity');
  }
  const product = db.products.find((item) => item.skuKey === ALLOWED_SKU);
  if (!product || !product.active || product.grants_course_id) return fail(409, 'unavailable');
  if (product.currency !== 'GBP') return fail(409, 'price_config');
  if (!Array.isArray(product.ship_regions) || product.ship_regions.length === 0) return fail(409, 'no_destinations');
  const merchandise = product.price_minor * input.quantity;
  // This set is £99.99, so a normal quantity is already above £50. A lower
  // configured price must stop checkout rather than invent a shipping fee.
  if (!Number.isSafeInteger(merchandise) || merchandise < FREE_SHIPPING_MINOR) return fail(409, 'shipping_not_configured');
  if (product.price_minor !== UNIT_PRICE_MINOR) return fail(409, 'price_config');
  if (product.stock < input.quantity) return fail(409, 'stock');
  if (db.orders.some((order) => order.stripe_session_id === input.sessionId)) return fail(409, 'duplicate_session');
  product.stock -= input.quantity;
  const order = {
    id: ++db.nextId,
    user_id: null,
    customer_id: null,
    channel: 'web',
    status: 'pending',
    stripe_session_id: input.sessionId,
    sku: ALLOWED_SKU,
    quantity: input.quantity,
    unit_price_minor: product.price_minor,
    amount_minor: merchandise,
    shipping_minor: 0,
    currency: 'GBP',
    ship_regions: product.ship_regions.slice(),
    grants_course: false,
    customer_email: null,
    shipping_name: null,
    shipping_address: null,
  };
  db.orders.push(order);
  return {
    ok: true,
    order,
    stripe: {
      unit_amount: product.price_minor,
      currency: 'gbp',
      quantity: input.quantity,
      shipping_minor: 0,
      allowed_countries: order.ship_regions.slice(),
      success_url: 'https://teafairyworld.co.uk/order-success.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://teafairyworld.co.uk/products.html?checkout=cancelled',
      metadata: { channel: 'web', sku_key: ALLOWED_SKU, order_id: String(order.id) },
    },
  };
}

export function markPaid(db, event) {
  if (!event || event.channel !== 'web') return { ok: true, ignored: true };
  if (event.payment_status !== 'paid') return { ok: true, pending: true };
  const order = db.orders.find((item) => item.stripe_session_id === event.sessionId && item.channel === 'web');
  if (!order) return fail(500, 'missing_reservation');
  if (event.amount_total !== order.amount_minor + order.shipping_minor || String(event.currency).toLowerCase() !== 'gbp') {
    return fail(409, 'amount_mismatch');
  }
  if (order.status === 'paid') return { ok: true, duplicate: true, order };
  if (order.status !== 'pending') return fail(409, 'bad_status');
  order.status = 'paid';
  order.customer_email = event.email || null;
  order.shipping_name = event.shipping_name || null;
  order.shipping_address = event.shipping_address || null;
  return { ok: true, order };
}

export function releaseReservation(db, event) {
  if (!event || event.channel !== 'web') return { ok: true, ignored: true };
  const order = db.orders.find((item) => item.stripe_session_id === event.sessionId && item.channel === 'web');
  if (!order || order.status === 'cancelled') return { ok: true, duplicate: true };
  if (order.status !== 'pending') return fail(409, 'bad_status');
  order.status = 'cancelled';
  const product = db.products.find((item) => item.skuKey === order.sku);
  product.stock += order.quantity;
  return { ok: true, order };
}

export function acceptWebhook(headers, verify) {
  const signature = headers && headers['stripe-signature'];
  if (!signature || typeof verify !== 'function' || !verify(signature)) return fail(400, 'bad_signature');
  return { ok: true };
}

function fail(status, error) {
  return { ok: false, status, error };
}
