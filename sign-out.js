import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { createMembershipClient, signOutLocal } from './membership.js';

const statusEl = document.querySelector('#auth-status');
const supabase = createMembershipClient(createClient);

try {
  const { error } = await signOutLocal(supabase);
  statusEl.textContent = error ? 'Sign-out did not finish. Try again.' : 'You are signed out on this website.';
} catch (error) {
  console.warn('sign out', error);
  statusEl.textContent = 'Sign-out did not finish. Try again.';
}
