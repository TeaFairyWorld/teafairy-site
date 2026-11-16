import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { membershipConfig } from './membership-config.js';
import {
  accountLabel,
  appleSignInEnabled,
  authCallbackUrl,
  createMembershipClient,
  isEmail,
  safeNext,
  sendEmailCode,
  signInWithApple,
  verifyEmailCode,
} from './membership.js';

const form = document.querySelector('#auth-form');
const statusEl = document.querySelector('#auth-status');
const codeBox = document.querySelector('#code-box');
const appleHost = document.querySelector('#apple-host');
const creating = form.dataset.create === 'up';
const next = safeNext(new URLSearchParams(location.search).get('next'));
const supabase = createMembershipClient(createClient);
let sent = false;

const swap = document.querySelector('[data-swap]');
if (swap) {
  const page = creating ? 'sign-in.html' : 'sign-up.html';
  swap.href = `${page}?next=${encodeURIComponent(next)}`;
}

supabase.auth.getSession().then(({ data }) => {
  if (data.session) {
    statusEl.textContent = `You are signed in as ${accountLabel(data.session)}.`;
    location.replace(next);
  }
}).catch(() => {});

if (appleSignInEnabled(membershipConfig)) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'apple-btn';
  button.textContent = 'Sign in with Apple';
  button.addEventListener('click', async () => {
    if (!form.agree.checked) {
      statusEl.textContent = 'Please accept the Terms and Privacy Policy first.';
      return;
    }
    button.disabled = true;
    statusEl.textContent = 'Opening Sign in with Apple…';
    const { error } = await signInWithApple(supabase, authCallbackUrl(next));
    if (error) {
      statusEl.textContent = 'Sign in with Apple is not available right now.';
      button.disabled = false;
    }
  });
  appleHost.append(button);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = form.email.value.trim();
  const button = form.querySelector('button[type="submit"]');
  if (!form.agree.checked) {
    statusEl.textContent = 'Please accept the Terms and Privacy Policy first.';
    return;
  }
  if (!isEmail(email)) {
    statusEl.textContent = 'Enter the email address for your TeaFairy account.';
    return;
  }
  button.disabled = true;
  if (sent) {
    const token = form.code.value.trim();
    if (!/^[0-9]{6}$/.test(token)) {
      statusEl.textContent = 'Enter the 6-digit code from the email.';
      button.disabled = false;
      return;
    }
    statusEl.textContent = 'Checking the code…';
    const { error } = await verifyEmailCode(supabase, email, token);
    if (error) {
      statusEl.textContent = friendly(error, creating, true);
      button.disabled = false;
      return;
    }
    location.replace(next);
    return;
  }
  statusEl.textContent = 'Sending a code…';
  const { error } = await sendEmailCode(supabase, email, { createUser: creating });
  button.disabled = false;
  if (error) {
    statusEl.textContent = friendly(error, creating, false);
    return;
  }
  sent = true;
  codeBox.hidden = false;
  form.code.disabled = false;
  button.textContent = creating ? 'Create account' : 'Sign in';
  statusEl.textContent = 'Check your email for a 6-digit code.';
});

function friendly(error, createUser, checkingCode) {
  const message = String(error && error.message || '').toLowerCase();
  console.warn('auth', error);
  if (/rate|too many|once every/.test(message)) return 'Please wait a moment, then try again.';
  if (!createUser && /not found|signups not allowed/.test(message)) return 'No TeaFairy account uses that email yet.';
  if (checkingCode && /expired|invalid|otp|token/.test(message)) return 'That code is not valid. Request a new one and try again.';
  return createUser ? 'The account could not be created just now.' : 'Sign-in did not complete.';
}
