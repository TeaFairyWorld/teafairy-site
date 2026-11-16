import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { productCardHtml } from './course-view.js';
import { isStripeCheckoutUrl } from './checkout.js';
import { membershipConfig } from './membership-config.js';
import {
  createMembershipClient,
  loadShopProducts,
  shopCheckoutBody,
  shopCheckoutEndpoint,
} from './membership.js';

const root = document.querySelector('#shop');
const supabase = createMembershipClient(createClient);
const cancelled = new URLSearchParams(location.search).get('checkout') === 'cancelled';
if (cancelled) {
  const note = document.querySelector('#checkout-cancel');
  if (note) note.hidden = false;
}

try {
  const products = await loadShopProducts(supabase);
  root.innerHTML = products.length
    ? `<div class="course-grid">${products.map(productCardHtml).join('')}</div>`
    : '<p class="notice">No teas are listed yet.</p>';
  root.querySelectorAll('.checkout-form').forEach((form) => {
    form.addEventListener('submit', (event) => submitCheckout(form, event));
  });
} catch (error) {
  console.warn('shop', error);
  root.innerHTML = '<p class="notice" role="alert">The shop could not be loaded. Please try again.</p>';
}

async function submitCheckout(form, event) {
  event.preventDefault();
  const status = form.querySelector('.checkout-status');
  const button = form.querySelector('button');
  const request = shopCheckoutBody({ sku: form.getAttribute('data-sku'), quantity: Number(form.quantity.value) });
  if (!request.ok) {
    status.textContent = request.error === 'quantity' ? 'Choose a quantity from 1 to 20.' : 'This product cannot be ordered from this page.';
    return;
  }
  button.disabled = true;
  status.textContent = 'Opening secure payment…';
  try {
    const response = await fetch(shopCheckoutEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: membershipConfig.supabaseAnonKey,
        Authorization: 'Bearer ' + membershipConfig.supabaseAnonKey,
      },
      body: JSON.stringify(request.body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !isStripeCheckoutUrl(data.url)) {
      status.textContent = 'Checkout is not available right now. Nothing has been charged from this page.';
      button.disabled = false;
      return;
    }
    location.assign(data.url);
  } catch (error) {
    console.warn('checkout', error);
    status.textContent = 'Checkout is not available right now. Nothing has been charged from this page.';
    button.disabled = false;
  }
}
