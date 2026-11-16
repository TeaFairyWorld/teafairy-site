import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { accountLabel, createMembershipClient, escapeHtml, isUuid, safeNext } from './membership.js';

const nav = document.querySelector('header nav');
if (nav) {
  const courses = nav.querySelector('a[href="courses.html"], a[href="/courses.html"]');
  if (!courses) {
    const link = document.createElement('a');
    link.href = 'courses.html';
    link.textContent = 'Courses';
    nav.appendChild(link);
  } else if (location.pathname.endsWith('/courses.html')) {
    courses.setAttribute('aria-current', 'page');
  }

  const slot = document.createElement('span');
  slot.className = 'account-slot';
  nav.appendChild(slot);

  const next = currentNext();
  const signInHref = `sign-in.html?next=${encodeURIComponent(next)}`;
  slot.innerHTML = `<a href="${signInHref}">Sign in</a>`;

  const supabase = createMembershipClient(createClient);
  let seenEvent = false;
  const paint = (session) => {
    if (!session) {
      slot.innerHTML = `<a href="${signInHref}">Sign in</a>`;
      return;
    }
    const label = escapeHtml(accountLabel(session));
    slot.innerHTML = `<details class="account-menu"><summary>${label}</summary><div class="menu"><a href="my-courses.html">My courses</a><a href="sign-out.html">Sign out</a></div></details>`;
  };
  // The sign-out page owns the client call. A second getSession on the same client can stall sign-out.
  if (!location.pathname.endsWith('/sign-out.html')) {
    supabase.auth.onAuthStateChange((_event, session) => {
      seenEvent = true;
      paint(session);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!seenEvent) paint(data.session);
    }).catch(() => {});
  }
}

function currentNext() {
  const page = location.pathname.split('/').pop() || 'index.html';
  const id = new URLSearchParams(location.search).get('id');
  if ((page === 'course.html' || page === 'lesson.html') && isUuid(id)) return safeNext(`${page}?id=${id}`);
  if (page === 'my-courses.html' || page === 'courses.html') return page;
  return 'my-courses.html';
}
