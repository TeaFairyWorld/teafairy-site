import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { bindBuyButton, buyControlsHtml, lockedLessonHtml, playbackPendingHtml, streamPlayerHtml } from './course-view.js';
import {
  createMembershipClient,
  escapeHtml,
  fetchLessonPlayback,
  hasAccess,
  loadLesson,
  sanitizePublicText,
  startCourseCheckout,
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
    const playback = await fetchLessonPlayback(supabase, lesson.id);
    const title = escapeHtml(sanitizePublicText(lesson.title_en) || 'Lesson');
    const courseTitle = escapeHtml(sanitizePublicText(course.title_en) || 'Course');
    const plainTitle = sanitizePublicText(lesson.title_en);
    if (plainTitle) document.title = `${plainTitle} | TeaFairy`;
    const controls = buyControlsHtml({
      courseId: course.id,
      priceMinor: course.price_minor,
      currency: course.currency,
      signedIn: !!session,
      owned,
      watchHref: `lesson.html?id=${lesson.id}`,
      returnPage: `lesson.html?id=${lesson.id}`,
    });
    const player = renderPlayer(playback, { lesson, owned, controls });
    const access = owned ? '<p>This lesson is included with your account.</p>' : '';
    root.innerHTML = `${player}<p class="meta"><a href="course.html?id=${course.id}">${courseTitle}</a></p><h1>${title}</h1>${access}`;
    bindBuyButton(supabase, startCourseCheckout);
    const video = document.querySelector('#lesson-video');
    if (video && playback.ok && !playback.iframe) await attachPlayback(video, playback.url);
  }
} catch (error) {
  console.warn('lesson', error);
  root.innerHTML = '<p class="notice" role="alert">This lesson could not be loaded. Please try again.</p>';
}

function renderPlayer(playback, { lesson, owned, controls }) {
  if (playback.ok) return streamPlayerHtml(playback.url, { iframe: playback.iframe, poster: lesson.thumbnail_url });
  if (playback.error === 'expired') {
    return '<div class="player-soon" role="status"><h2>This playback link has expired</h2><p>Reload the page to request a new one.</p></div>';
  }
  if (owned || lesson.is_preview) return playbackPendingHtml();
  if (playback.error === 'locked') return lockedLessonHtml(controls);
  return `${playbackPendingHtml()}${controls}`;
}

async function attachPlayback(video, url) {
  if (video.canPlayType('application/vnd.apple.mpegurl') || !url.includes('.m3u8')) {
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
