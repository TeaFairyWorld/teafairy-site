import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { courseCardHtml } from './course-view.js';
import { createMembershipClient, loadPublishedCourses } from './membership.js';

const root = document.querySelector('#catalogue');
const supabase = createMembershipClient(createClient);

try {
  const courses = await loadPublishedCourses(supabase);
  root.innerHTML = courses.length
    ? `<div class="course-grid">${courses.map(courseCardHtml).join('')}</div>`
    : '<p class="notice">No courses are published yet.</p>';
} catch (error) {
  console.warn('courses', error);
  root.innerHTML = '<p class="notice" role="alert">Courses could not be loaded. Please try again.</p>';
}
