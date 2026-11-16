import {
  coverUrl,
  escapeHtml,
  formatDuration,
  formatMoney,
  httpsUrl,
  isUuid,
  lessonCountLabel,
  publicInstructor,
  sanitizePublicText,
  streamPlayerUrl,
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
  const price = formatMoney(course.price_minor, course.currency || 'GBP');
  const image = cover ? `<img src="${escapeHtml(cover)}" alt="">` : '';
  return `<article class="course-card">${image}<div class="pad"><h2>${title}</h2>${description ? `<p>${description}</p>` : ''}<p class="meta">${escapeHtml(meta)}</p>${price ? `<p class="price">${escapeHtml(price)}</p>` : ''}<p><a class="btn" href="course.html?id=${course.id}">View course</a></p></div></article>`;
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

export function firstLessonHref(lessons) {
  const lesson = (lessons || []).find((item) => isUuid(item.id));
  return lesson ? `lesson.html?id=${lesson.id}` : 'my-courses.html';
}

export function buyControlsHtml({ courseId, priceMinor, currency, signedIn = false, owned = false, watchHref = '', returnPage = '' } = {}) {
  if (!isUuid(courseId)) return '';
  const price = formatMoney(priceMinor, currency || 'GBP');
  const priceHtml = price ? `<p class="price">${escapeHtml(price)}</p>` : '';
  if (owned) {
    const href = watchHref || 'my-courses.html';
    return `${priceHtml}<p><a class="btn" href="${escapeHtml(href)}">Watch now</a></p>`;
  }
  const eu = '<p class="meta">Checkout is not available to EU buyers.</p>';
  if (!signedIn) {
    const next = encodeURIComponent(returnPage || `course.html?id=${courseId}`);
    return `${priceHtml}<p><a class="btn" href="sign-in.html?next=${next}">Buy course</a></p>${eu}`;
  }
  return `${priceHtml}<p><button class="btn" type="button" id="buy-course" data-course="${courseId}">Buy course</button></p>${eu}<p id="buy-status" role="status"></p>`;
}

export function courseDetailHtml(item, { owned = false, signedIn = false, note = '' } = {}) {
  const course = item.course;
  const lessons = item.lessons || [];
  const title = escapeHtml(sanitizePublicText(course.title_en) || 'Course');
  const description = escapeHtml(sanitizePublicText(course.description_en));
  const instructor = escapeHtml(publicInstructor(course.instructor));
  const cover = coverUrl(course, lessons);
  const meta = [lessonCountLabel(lessons.length), totalDurationLabel(lessons)].filter(Boolean).join(' · ');
  const image = cover ? `<img class="course-cover" src="${escapeHtml(cover)}" alt="">` : '';
  const buy = buyControlsHtml({
    courseId: course.id,
    priceMinor: course.price_minor,
    currency: course.currency,
    signedIn,
    owned,
    watchHref: firstLessonHref(lessons),
    returnPage: `course.html?id=${course.id}`,
  });
  return `${image}<h1>${title}</h1><p class="meta">${escapeHtml(meta)} · ${instructor}</p>${description ? `<p>${description}</p>` : ''}${note}${buy}<h2>Lessons</h2>${lessonListHtml(lessons)}`;
}

export function streamPlayerHtml(url, { iframe = false, poster = '' } = {}) {
  const safe = streamPlayerUrl(iframe ? { iframe_url: url } : { playback_url: url });
  if (!safe) return '';
  if (iframe) {
    return `<div class="player-soon"><iframe src="${escapeHtml(safe)}" title="Lesson video" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  const posterAttr = httpsUrl(poster) ? ` poster="${escapeHtml(httpsUrl(poster))}"` : '';
  return `<div class="player-soon"><video id="lesson-video" controls playsinline${posterAttr}></video></div>`;
}

export function lockedLessonHtml(controls) {
  return `<div class="player-soon" role="status"><h2>This lesson is locked</h2><p>Buy the course to watch it.</p></div>${controls || ''}`;
}

export function playbackPendingHtml() {
  return '<div class="player-soon" role="status"><h2>Playback is not available yet</h2><p>Nothing has been charged from this page.</p></div>';
}

export function paidBannerHtml() {
  return '<p class="notice" id="paid-banner">Payment received. Your course is unlocked.</p>';
}

export function productCardHtml(product) {
  if (!product || typeof product.sku !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(product.sku)) return '';
  const name = escapeHtml(sanitizePublicText(product.name_en) || 'Tea');
  const zh = product.name_zh ? ` <small>${escapeHtml(sanitizePublicText(product.name_zh))}</small>` : '';
  const description = escapeHtml(sanitizePublicText(product.description_en));
  const price = formatMoney(product.price_minor, product.currency || 'GBP');
  const image = httpsUrl((Array.isArray(product.images) && product.images[0]) || product.image_url);
  const img = image ? `<img src="${escapeHtml(image)}" alt="">` : '';
  let grant = '';
  if (isUuid(product.grants_course_id)) {
    const title = sanitizePublicText(product.grants_course_title_en || '');
    grant = `<p>${title ? `Includes the course ${escapeHtml(title)}.` : 'Includes a course.'}</p>`;
  } else if (Object.prototype.hasOwnProperty.call(product, 'grants_course_id')) {
    grant = '<p>This product does not include a course.</p>';
  }
  const form = product.in_stock === false
    ? '<p>Out of stock.</p>'
    : `<form class="checkout-form" data-sku="${escapeHtml(product.sku)}"><label>Quantity</label><input name="quantity" type="number" min="1" max="20" value="1" inputmode="numeric" required><button class="btn" type="submit">Continue to payment</button><p class="checkout-status" role="status"></p></form>`;
  return `<article class="course-card" id="${escapeHtml(product.sku)}">${img}<div class="pad"><h2>${name}${zh}</h2>${price ? `<p class="price">${escapeHtml(price)}</p>` : ''}${description ? `<p>${description}</p>` : ''}${grant}${form}</div></article>`;
}

export function bindBuyButton(client, start) {
  const button = document.querySelector('#buy-course');
  if (!button || typeof start !== 'function') return;
  button.addEventListener('click', async () => {
    const status = document.querySelector('#buy-status');
    button.disabled = true;
    if (status) status.textContent = 'Opening secure payment…';
    const result = await start(client, button.getAttribute('data-course'));
    if (result && result.error === 'already_owned') {
      location.reload();
      return;
    }
    if (!result || !result.ok || !result.url) {
      if (status) status.textContent = 'Checkout is not available right now. Nothing has been charged from this page.';
      button.disabled = false;
      return;
    }
    location.assign(result.url);
  });
}
