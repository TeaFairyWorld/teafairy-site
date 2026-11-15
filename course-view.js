import {
  coverUrl,
  escapeHtml,
  formatDuration,
  httpsUrl,
  isUuid,
  lessonCountLabel,
  publicInstructor,
  sanitizePublicText,
  totalDurationLabel,
} from './membership.js';

export function courseCardHtml(item) {
  const course = item && item.course;
  const lessons = (item && item.lessons) || [];
  if (!course || !isUuid(course.id)) return '';
  const title = escapeHtml(sanitizePublicText(course.title_en) || 'Course');
  const description = escapeHtml(sanitizePublicText(course.description_en));
  const cover = coverUrl(course, lessons);
  const meta = [lessonCountLabel(lessons.length), totalDurationLabel(lessons)].filter(Boolean).join(' · ');
  const image = cover ? `<img src="${escapeHtml(cover)}" alt="">` : '';
  return `<article class="course-card">${image}<div class="pad"><h2>${title}</h2>${description ? `<p>${description}</p>` : ''}<p class="meta">${escapeHtml(meta)}</p><p><a class="btn" href="course.html?id=${course.id}">View course</a></p></div></article>`;
}

export function lessonListHtml(lessons) {
  const rows = (lessons || []).map((lesson) => {
    if (!isUuid(lesson.id)) return '';
    const title = escapeHtml(sanitizePublicText(lesson.title_en) || 'Lesson');
    const position = String(Number(lesson.position) || 0).padStart(2, '0');
    const duration = formatDuration(lesson.duration_s);
    const thumb = httpsUrl(lesson.thumbnail_url);
    const image = thumb ? `<img src="${escapeHtml(thumb)}" alt="">` : '';
    const badge = lesson.is_preview ? '<span class="badge">Free preview</span>' : '<span class="meta">Full lesson</span>';
    const time = duration ? `<span class="meta">${escapeHtml(duration)}</span>` : '';
    return `<li><a href="lesson.html?id=${lesson.id}">${image}<span class="grow"><span>${position} · ${title}</span>${time}${badge}</span></a></li>`;
  }).join('');
  return `<ol class="lessons">${rows}</ol>`;
}

export function ownedCourseHtml(item) {
  const course = item && item.course;
  const lessons = (item && item.lessons) || [];
  if (!course || !isUuid(course.id)) return '';
  const title = escapeHtml(sanitizePublicText(course.title_en) || 'Course');
  const cover = coverUrl(course, lessons);
  const image = cover ? `<img src="${escapeHtml(cover)}" alt="">` : '';
  return `<article class="course-card">${image}<div class="pad"><h2><a href="course.html?id=${course.id}">${title}</a></h2><p class="meta">On your account</p>${lessonListHtml(lessons)}</div></article>`;
}

export function courseDetailHtml(item, { owned = false, note = '' } = {}) {
  const course = item.course;
  const lessons = item.lessons || [];
  const title = escapeHtml(sanitizePublicText(course.title_en) || 'Course');
  const description = escapeHtml(sanitizePublicText(course.description_en));
  const instructor = escapeHtml(publicInstructor(course.instructor));
  const cover = coverUrl(course, lessons);
  const meta = [lessonCountLabel(lessons.length), totalDurationLabel(lessons)].filter(Boolean).join(' · ');
  const image = cover ? `<img class="course-cover" src="${escapeHtml(cover)}" alt="">` : '';
  const access = owned ? '<p>This course is on your account.</p>' : '';
  return `${image}<h1>${title}</h1><p class="meta">${escapeHtml(meta)} · ${instructor}</p>${description ? `<p>${description}</p>` : ''}${note}${access}<h2>Lessons</h2>${lessonListHtml(lessons)}`;
}

/** Paid lessons never receive a player. A preview player is only marked, and the URL is attached in script. */
export function playerHtml(lesson) {
  if (lesson && lesson.is_preview === true) {
    const poster = httpsUrl(lesson.thumbnail_url);
    const posterAttr = poster ? ` poster="${escapeHtml(poster)}"` : '';
    return `<div class="player-soon" id="player"><video id="preview-video" controls playsinline${posterAttr} hidden></video><div id="preview-note"><h2>Free preview</h2><p>This lesson is marked as a free preview. Playback on the website is not switched on yet.</p></div></div>`;
  }
  return `<div class="player-soon" id="player" role="status"><h2>Player coming soon</h2><p>This lesson is not played from a public link.</p></div>`;
}
