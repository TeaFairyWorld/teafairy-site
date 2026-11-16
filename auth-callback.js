import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { completeAuthCallback, createMembershipClient, safeNext } from './membership.js';

const statusEl = document.querySelector('#auth-status');
const next = safeNext(new URLSearchParams(location.search).get('next'));
const supabase = createMembershipClient(createClient);

try {
  const result = await completeAuthCallback(supabase, location.href);
  const session = result && result.data && (result.data.session || (result.data.user && result.data));
  if (result.error || !session) {
    statusEl.textContent = 'This sign-in link could not be used. Request a new code.';
  } else {
    location.replace(next);
  }
} catch (error) {
  console.warn('auth callback', error);
  statusEl.textContent = 'This sign-in link could not be used. Request a new code.';
}
