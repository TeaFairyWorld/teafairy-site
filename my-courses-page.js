import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { ownedCourseHtml, paidBannerHtml } from './course-view.js';
import { coursesWithAccess, createMembershipClient, retryUntilAccess } from './membership.js';

const root = document.querySelector('#mine');
const paid = new URLSearchParams(location.search).get('paid') === '1';
const supabase = createMembershipClient(createClient);

try {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const banner = paid ? paidBannerHtml() : '';
    const next = paid ? 'my-courses.html?paid=1' : 'my-courses.html';
    root.innerHTML = `${banner}<p>Sign in with the same email you use for TeaFairy. Courses on that account are listed here.</p><p><a class="btn" href="sign-in.html?next=${encodeURIComponent(next)}">Sign in</a></p>`;
  } else {
    if (paid) root.innerHTML = `${paidBannerHtml()}<p>Checking your account…</p>`;
    const courses = await retryUntilAccess(() => coursesWithAccess(supabase), {
      paid,
      attempts: 4,
      wait: () => new Promise((resolve) => setTimeout(resolve, 1500)),
    });
    const banner = paid ? paidBannerHtml() : '';
    const body = courses.length
      ? courses.map(ownedCourseHtml).join('')
      : `<p>${paid ? 'Your course will appear here in a moment.' : 'No course is on this account yet.'}</p><p><a href="courses.html">Browse courses</a></p>`;
    root.innerHTML = banner + body;
  }
} catch (error) {
  console.warn('my courses', error);
  root.innerHTML = '<p class="notice" role="alert">Your courses could not be loaded. Please try again.</p>';
}
