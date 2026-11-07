import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ALLOWED_SKU,
  MAX_QUANTITY,
  appReturnUrl,
  checkoutHeaders,
  guestCheckoutRequest,
  isStripeCheckoutUrl,
} from './checkout.js';
import {
  MAX_QUANTITY as SERVER_MAX,
  acceptWebhook,
  createReservation,
  markPaid,
  releaseReservation,
} from './guest-checkout-contract.mjs';

function db(overrides = {}) {
  return {
    nextId: 0,
    products: [{
      skuKey: ALLOWED_SKU,
      price_minor: 9999,
      currency: 'GBP',
      stock: 3,
      active: true,
      grants_course_id: null,
      ship_regions: ['GB', 'IE'],
      ...overrides,
    }],
    orders: [],
  };
}

test('guest request drops price, email, and return url', () => {
  const result = guestCheckoutRequest({
    sku: ALLOWED_SKU,
    quantity: 2,
    price_minor: 1,
    price: 0,
    email: 'buyer@example.com',
    return_url: 'https://evil.example/steal',
  });
  assert.deepEqual(result, { ok: true, body: { sku: ALLOWED_SKU, quantity: 2 } });
});

test('guest request rejects another sku and bad quantities', () => {
  assert.equal(guestCheckoutRequest({ sku: 'course', quantity: 1 }).error, 'sku');
  for (const quantity of [0, -1, 1.5, MAX_QUANTITY + 1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(guestCheckoutRequest({ quantity }).ok, false);
  }
  assert.equal(guestCheckoutRequest({ quantity: 1 }).body.quantity, 1);
});

test('checkout headers use the publishable anon key and no Stripe secret', () => {
  const headers = checkoutHeaders();
  const payload = JSON.parse(Buffer.from(headers.apikey.split('.')[1], 'base64url').toString());
  assert.equal(payload.role, 'anon');
  assert.equal(headers.Authorization, 'Bearer ' + headers.apikey);
  const serialized = JSON.stringify(headers);
  assert.equal(serialized.includes('service_role'), false);
  assert.equal(serialized.includes('sk_live'), false);
  assert.equal(serialized.includes('sk_test'), false);
});

test('only a real Stripe Checkout https URL is accepted', () => {
  assert.equal(isStripeCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_123'), true);
  assert.equal(isStripeCheckoutUrl('https://checkout.stripe.com.evil.example/c/pay/x'), false);
  assert.equal(isStripeCheckoutUrl('http://checkout.stripe.com/c/pay/x'), false);
  assert.equal(isStripeCheckoutUrl('https://teafairyworld.co.uk/order-success.html'), false);
  assert.equal(isStripeCheckoutUrl('javascript:alert(1)'), false);
});

test('app return urls stay limited to the existing app schemes', () => {
  assert.equal(appReturnUrl('teatok://orders', 'cs_1'), 'teatok://orders?session_id=cs_1');
  assert.equal(appReturnUrl('exp://1.1.1.1:8081?x=1', 'a b'), 'exp://1.1.1.1:8081?x=1&session_id=a%20b');
  assert.equal(appReturnUrl('https://evil.example', 'cs_1'), null);
  assert.equal(appReturnUrl('javascript:alert(1)', 'cs_1'), null);
  assert.equal(MAX_QUANTITY, SERVER_MAX);
});

test('reservation uses the server price, countries, and stock', () => {
  const state = db();
  const result = createReservation(state, { sku: ALLOWED_SKU, quantity: 2, price_minor: 1, sessionId: 'cs_a' });
  assert.equal(result.ok, true);
  assert.equal(result.stripe.unit_amount, 9999);
  assert.equal(result.stripe.shipping_minor, 0);
  assert.deepEqual(result.stripe.allowed_countries, ['GB', 'IE']);
  assert.equal(result.order.user_id, null);
  assert.equal(result.order.customer_id, null);
  assert.equal(result.order.channel, 'web');
  assert.equal(result.order.grants_course, false);
  assert.equal(state.products[0].stock, 1);
});

test('manipulated sku, course grant, empty countries, and under-threshold price are refused', () => {
  assert.equal(createReservation(db(), { sku: 'other', quantity: 1, sessionId: 'cs_b' }).error, 'sku');
  assert.equal(createReservation(db({ grants_course_id: 'course-1' }), { sku: ALLOWED_SKU, quantity: 1, sessionId: 'cs_c' }).error, 'unavailable');
  assert.equal(createReservation(db({ ship_regions: [] }), { sku: ALLOWED_SKU, quantity: 1, sessionId: 'cs_d' }).error, 'no_destinations');
  assert.equal(createReservation(db({ price_minor: 1000 }), { sku: ALLOWED_SKU, quantity: 1, sessionId: 'cs_e' }).error, 'shipping_not_configured');
  assert.equal(createReservation(db({ price_minor: 15000 }), { sku: ALLOWED_SKU, quantity: 1, sessionId: 'cs_f' }).error, 'price_config');
});

test('stock cannot be oversold by a second reservation', () => {
  const state = db({ stock: 1 });
  assert.equal(createReservation(state, { sku: ALLOWED_SKU, quantity: 1, sessionId: 'cs_1' }).ok, true);
  assert.equal(createReservation(state, { sku: ALLOWED_SKU, quantity: 1, sessionId: 'cs_2' }).error, 'stock');
  assert.equal(state.products[0].stock, 0);
  assert.equal(state.orders.length, 1);
});

test('paid webhook is idempotent and does not change stock again', () => {
  const state = db({ stock: 2 });
  createReservation(state, { sku: ALLOWED_SKU, quantity: 1, sessionId: 'cs_pay' });
  const event = {
    channel: 'web',
    payment_status: 'paid',
    sessionId: 'cs_pay',
    amount_total: 9999,
    currency: 'gbp',
    email: 'guest@example.com',
    shipping_name: 'Guest',
    shipping_address: { country: 'GB', line1: '1 Test Street' },
  };
  assert.equal(markPaid(state, event).ok, true);
  assert.equal(markPaid(state, event).duplicate, true);
  assert.equal(state.products[0].stock, 1);
  assert.equal(state.orders.filter((order) => order.status === 'paid').length, 1);
});

test('unpaid, mismatched, missing, and app events do not create a second charge path', () => {
  const state = db();
  createReservation(state, { sku: ALLOWED_SKU, quantity: 1, sessionId: 'cs_wait' });
  const stock = state.products[0].stock;
  assert.equal(markPaid(state, { channel: 'web', payment_status: 'unpaid', sessionId: 'cs_wait', amount_total: 9999, currency: 'gbp' }).pending, true);
  assert.equal(markPaid(state, { channel: 'web', payment_status: 'paid', sessionId: 'cs_wait', amount_total: 1, currency: 'gbp' }).error, 'amount_mismatch');
  assert.equal(markPaid(state, { channel: 'web', payment_status: 'paid', sessionId: 'missing', amount_total: 9999, currency: 'gbp' }).error, 'missing_reservation');
  assert.equal(markPaid(state, { channel: 'app', payment_status: 'paid', sessionId: 'cs_app', amount_total: 9999, currency: 'gbp' }).ignored, true);
  assert.equal(state.orders[0].status, 'pending');
  assert.equal(state.products[0].stock, stock);
});

test('cancel restores stock once and cannot restore a paid order', () => {
  const state = db({ stock: 2 });
  createReservation(state, { sku: ALLOWED_SKU, quantity: 1, sessionId: 'cs_cancel' });
  assert.equal(releaseReservation(state, { channel: 'web', sessionId: 'cs_cancel' }).ok, true);
  assert.equal(releaseReservation(state, { channel: 'web', sessionId: 'cs_cancel' }).duplicate, true);
  assert.equal(state.products[0].stock, 2);
  createReservation(state, { sku: ALLOWED_SKU, quantity: 1, sessionId: 'cs_paid' });
  markPaid(state, { channel: 'web', payment_status: 'paid', sessionId: 'cs_paid', amount_total: 9999, currency: 'gbp' });
  const stock = state.products[0].stock;
  assert.equal(releaseReservation(state, { channel: 'web', sessionId: 'cs_paid' }).error, 'bad_status');
  assert.equal(state.products[0].stock, stock);
});

test('invalid webhook signature is rejected before an order update', () => {
  assert.equal(acceptWebhook({}, () => true).error, 'bad_signature');
  assert.equal(acceptWebhook({ 'stripe-signature': 'forged' }, () => false).error, 'bad_signature');
  assert.equal(acceptWebhook({ 'stripe-signature': 'signed' }, (value) => value === 'signed').ok, true);
});

test('public pages do not contain secrets, a free course, or worldwide shipping', () => {
  const files = ['products.html', 'order-success.html', 'checkout.js', 'index.html'].map((name) => readFileSync(name, 'utf8'));
  const combined = files.join('\n');
  for (const secret of ['service_role', 'sk_live', 'sk_test', 'whsec_']) {
    assert.equal(combined.includes(secret), false, secret);
  }
  const products = files[0];
  assert.equal(/free course/i.test(products), false);
  assert.equal(products.includes('全球免运费'), false);
  assert.equal(products.includes('worldwide'), false);
  assert.equal(products.includes('£50'), true);
  assert.equal(products.includes('does not include a course'), true);
  assert.equal(files[1].includes('does not include a course'), true);
});
