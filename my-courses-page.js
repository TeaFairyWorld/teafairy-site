import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { ownedCourseHtml } from './course-view.js';
import { coursesWithAccess, createMembershipClient } from './membership.js';

const root = document.querySelector('#mine');
const supabase = createMembershipClient(createClient);

try {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    root.innerHTML = '<p>Sign in with the same email you use for TeaFairy. Courses on that account are listed here.</p><p><a class="btn" href="sign-in.html?next=my-courses.html">Sign in</a></p>';
  } else {
    const courses = await coursesWithAccess(supabase);
    root.innerHTML = courses.length
      ? courses.map(ownedCourseHtml).join('')
      : '<p>No course is on this account yet.</p><p><a href="courses.html">Browse courses</a></p>';
  }
} catch (error) {
  console.warn('my courses', error);
  root.innerHTML = '<p class="notice" role="alert">Your courses could not be loaded. Please try again.</p>';
}
