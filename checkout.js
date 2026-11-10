// Public website checkout helper. The publishable anon key below is already
// shipped on this static site. Never put the service role key or a Stripe secret here.
const PUBLISHABLE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxZ2h1dmFhemRucXprYmFnYmF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4NDAxNTUsImV4cCI6MjEwNzQxNjE1NX0.wl9O-H-cptZO8_743-QLWX8IcojsGIIF2JI3cuiCeyM';

export const ALLOWED_SKU = 'beginner-tea-set';
export const MAX_QUANTITY = 20;
export const CHECKOUT_ENDPOINT = 'https://lqghuvaazdnqzkbagbay.supabase.co/functions/v1/create-guest-checkout';

// The browser may only ask for the allowlisted set and a quantity.
// Price, address, email, and return URLs are ignored so a modified page cannot set them.
export function guestCheckoutRequest(input) {
  const sku = input && Object.prototype.hasOwnProperty.call(input, 'sku') ? input.sku : ALLOWED_SKU;
  if (sku !== ALLOWED_SKU) return { ok: false, error: 'sku' };
  const quantity = input ? input.quantity : undefined;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    return { ok: false, error: 'quantity' };
  }
  return { ok: true, body: { sku: ALLOWED_SKU, quantity } };
}

export function checkoutHeaders() {
  return {
    'Content-Type': 'application/json',
    apikey: PUBLISHABLE_ANON_KEY,
    Authorization: 'Bearer ' + PUBLISHABLE_ANON_KEY,
  };
}

export function isStripeCheckoutUrl(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com';
}

// Existing app return bridge. Website success URLs must not use this.
export function appReturnUrl(returnParam, sessionId) {
  if (typeof returnParam !== 'string' || !/^(teatok|exp|exps):\/\//.test(returnParam)) return null;
  const sid = sessionId || '';
  return returnParam + (returnParam.includes('?') ? '&' : '?') + 'session_id=' + encodeURIComponent(sid);
}
