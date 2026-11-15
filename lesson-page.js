import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { playerHtml } from './course-view.js';
import {
  createMembershipClient,
  escapeHtml,
  hasAccess,
  loadLesson,
  previewPlaybackUrl,
  sanitizePublicText,
} from './membership.js';

const root = document.querySelector('#lesson');
const id = new URLSearchParams(location.search).get('id');
const supabase = createMembershipClient(createClient);

try {
  const loaded = await loadLesson(supabase, id);
  if (!loaded) {
    root.innerHTML = '<p class="notice">This lesson is not available.</p><p><a href="courses.html">Back to courses</a></p>';
  } else {
    const { lesson, course } = loaded;
    const { data: { session } } = await supabase.auth.getSession();
    const owned = session ? await hasAccess(supabase, course.id) : false;
    const playbackUrl = lesson.is_preview === true ? await previewPlaybackUrl(supabase, lesson.id) : null;
    const title = escapeHtml(sanitizePublicText(lesson.title_en) || 'Lesson');
    const courseTitle = escapeHtml(sanitizePublicText(course.title_en) || 'Course');
    const plainTitle = sanitizePublicText(lesson.title_en);
    if (plainTitle) document.title = `${plainTitle} | TeaFairy`;
    const access = owned ? '<p>This lesson is included with your account.</p>' : '';
    root.innerHTML = `${playerHtml(lesson)}<p class="meta"><a href="course.html?id=${course.id}">${courseTitle}</a></p><h1>${title}</h1>${access}`;
    if (playbackUrl) await attachPreview(playbackUrl);
  }
} catch (error) {
  console.warn('lesson', error);
  root.innerHTML = '<p class="notice" role="alert">This lesson could not be loaded. Please try again.</p>';
}

async function attachPreview(url) {
  const video = document.querySelector('#preview-video');
  const note = document.querySelector('#preview-note');
  if (!video) return;
  video.hidden = false;
  if (note) note.hidden = true;
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    return;
  }
  const loaded = await new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.append(script);
  });
  if (loaded && window.Hls && window.Hls.isSupported()) {
    const hls = new window.Hls();
    hls.loadSource(url);
    hls.attachMedia(video);
    return;
  }
  video.src = url;
}
