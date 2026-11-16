import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { bindBuyButton, courseDetailHtml } from './course-view.js';
import {
  bundleNote,
  bundledProducts,
  createMembershipClient,
  hasAccess,
  loadCourse,
  sanitizePublicText,
  startCourseCheckout,
} from './membership.js';

const root = document.querySelector('#course');
const id = new URLSearchParams(location.search).get('id');
const supabase = createMembershipClient(createClient);

try {
  const item = await loadCourse(supabase, id);
  if (!item) {
    root.innerHTML = '<p class="notice">This course is not available.</p><p><a href="courses.html">Back to courses</a></p>';
  } else {
    const products = await bundledProducts(supabase, item.course.id);
    const { data: { session } } = await supabase.auth.getSession();
    const owned = session ? await hasAccess(supabase, item.course.id) : false;
    const title = sanitizePublicText(item.course.title_en);
    if (title) document.title = `${title} | TeaFairy`;
    root.innerHTML = courseDetailHtml(item, { owned, signedIn: !!session, note: bundleNote(products) });
    bindBuyButton(supabase, startCourseCheckout);
  }
} catch (error) {
  console.warn('course', error);
  root.innerHTML = '<p class="notice" role="alert">This course could not be loaded. Please try again.</p>';
}
