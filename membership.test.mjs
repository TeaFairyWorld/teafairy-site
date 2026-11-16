import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CHECKOUT_ENDPOINT } from './checkout.js';
import { membershipConfig } from './membership-config.js';
import { buyControlsHtml, courseDetailHtml, lockedLessonHtml, ownedCourseHtml, playbackPendingHtml, productCardHtml, streamPlayerHtml } from './course-view.js';
import {
  COURSE_LIST_COLUMNS,
  LESSON_LIST_COLUMNS,
  appleSignInEnabled,
  bundleNote,
  courseCheckoutResult,
  formatMoney,
  playbackResult,
  productsIncludingCourse,
  publicInstructor,
  retryUntilAccess,
  safeNext,
  sanitizePublicText,
  shopCheckoutBody,
  shopCheckoutEndpoint,
  shopHrefForProduct,
  signOutCanFinishLocally,
  streamPlayerUrl,
} from './membership.js';

function jwtPayload(token) {
  const body = token.split('.')[1];
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
}

test('membership config is the test project anon key', () => {
  const payload = jwtPayload(membershipConfig.supabaseAnonKey);
  assert.equal(payload.ref, 'mwtyriuhqltmlgqmygam');
  assert.equal(payload.role, 'anon');
  assert.equal(membershipConfig.supabaseUrl, 'https://mwtyriuhqltmlgqmygam.supabase.co');
  assert.equal(membershipConfig.appleSignIn, false);
  assert.equal(membershipConfig.streamCustomerCode, '');
  assert.equal(membershipConfig.supabaseAnonKey.includes('service_role'), false);
});

test('guest checkout stays on the production project', () => {
  assert.equal(CHECKOUT_ENDPOINT, 'https://lqghuvaazdnqzkbagbay.supabase.co/functions/v1/create-guest-checkout');
  const checkout = readFileSync(new URL('./checkout.js', import.meta.url), 'utf8');
  assert.match(checkout, /lqghuvaazdnqzkbagbay/);
  assert.equal(checkout.includes('mwtyriuhqltmlgqmygam'), false);
});

test('lesson catalogue columns do not include a stream id', () => {
  assert.equal(LESSON_LIST_COLUMNS.includes('stream_uid'), false);
  assert.equal(COURSE_LIST_COLUMNS.includes('price_minor'), true);
  assert.equal(COURSE_LIST_COLUMNS.includes('apple_product_id'), false);
  const source = ['membership.js', 'lesson-page.js', 'course-page.js', 'products-page.js']
    .map((name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'))
    .join('\n');
  assert.equal(source.includes('stream_uid'), false);
});

test('prices use the app en-GB currency format', () => {
  const expected = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(99.99);
  assert.equal(formatMoney(9999, 'GBP'), expected);
  assert.match(formatMoney(4999, 'GBP'), /49\.99/);
  assert.equal(formatMoney(null, 'GBP'), '');
});

test('public copy does not keep the founder personal name', () => {
  assert.equal(publicInstructor('Baolili 鲍丽丽'), 'TeaFairy (茶仙子)');
  assert.equal(publicInstructor('TeaFairy'), 'TeaFairy (茶仙子)');
  assert.equal(publicInstructor(''), 'TeaFairy (茶仙子)');
  assert.equal(sanitizePublicText('Learn with Baolili'), 'Learn with TeaFairy (茶仙子)');
});

test('playback accepts only a Cloudflare Stream URL from the function', () => {
  const iframe = 'https://iframe.cloudflarestream.com/signed-token';
  const manifest = 'https://customer-abc.cloudflarestream.com/signed-token/manifest/video.m3u8';
  assert.equal(streamPlayerUrl({ iframe_url: iframe }), iframe);
  assert.equal(streamPlayerUrl({ playback_url: manifest }), manifest);
  assert.equal(streamPlayerUrl({ playback_url: 'https://evil.example/video.m3u8' }), '');
  assert.equal(streamPlayerUrl({ iframe_url: 'javascript:alert(1)' }), '');
  assert.equal(playbackResult(403, { playback_url: manifest }).error, 'locked');
  assert.equal(playbackResult(404, {}).error, 'unavailable');
  assert.equal(playbackResult(200, { playback_url: manifest, expires_at: '2000-01-01T00:00:00Z' }).error, 'expired');
  assert.equal(playbackResult(200, { iframe_url: iframe }).url, iframe);
  assert.equal(streamPlayerHtml(manifest).includes('<iframe'), false);
  assert.equal(streamPlayerHtml('https://evil.example/x'), '');
});

test('course checkout uses the server price and a Stripe URL', () => {
  assert.equal(courseCheckoutResult(409, { error: 'already_owned' }).error, 'already_owned');
  assert.equal(courseCheckoutResult(404, {}).error, 'unavailable');
  assert.equal(courseCheckoutResult(200, { url: 'https://evil.example/pay' }).error, 'unavailable');
  assert.equal(
    courseCheckoutResult(200, { url: 'https://checkout.stripe.com/c/pay/cs_test_123' }).url,
    'https://checkout.stripe.com/c/pay/cs_test_123',
  );
});

test('shop checkout posts sku and quantity to the test project', () => {
  const body = shopCheckoutBody({ sku: 'TF-BEGINNER-SET', quantity: 2, price_minor: 1, email: 'a@b.c' });
  assert.deepEqual(body, { ok: true, body: { sku: 'TF-BEGINNER-SET', quantity: 2 } });
  assert.equal(shopCheckoutBody({ sku: '../secret', quantity: 1 }).error, 'sku');
  assert.equal(shopCheckoutEndpoint().includes('mwtyriuhqltmlgqmygam'), true);
  assert.equal(shopCheckoutEndpoint().includes('lqghuvaazdnqzkbagbay'), false);
});

test('access is checked again after payment', async () => {
  let calls = 0;
  const courses = await retryUntilAccess(async () => {
    calls += 1;
    return calls < 3 ? [] : [{ course: { id: 'x' } }];
  }, { paid: true, attempts: 4, wait: async () => {} });
  assert.equal(calls, 3);
  assert.equal(courses.length, 1);
});

test('a missing server session still counts as signed out locally', () => {
  assert.equal(signOutCanFinishLocally(null), true);
  assert.equal(signOutCanFinishLocally({ message: 'Session from session_id claim in JWT does not exist' }), true);
  assert.equal(signOutCanFinishLocally({ message: 'Auth session missing!' }), true);
  assert.equal(signOutCanFinishLocally({ message: 'network down' }), false);
});

test('apple button flag accepts only boolean true', () => {
  assert.equal(appleSignInEnabled({ appleSignIn: false }), false);
  assert.equal(appleSignInEnabled({ appleSignIn: 'true' }), false);
  assert.equal(appleSignInEnabled({ appleSignIn: true }), true);
});

test('return path stays on this site', () => {
  assert.equal(safeNext('course.html?id=124c5530-4179-4c32-9650-acbf16311239'), 'course.html?id=124c5530-4179-4c32-9650-acbf16311239');
  assert.equal(safeNext('https://evil.example/course.html'), 'my-courses.html');
  assert.equal(safeNext('//evil.example/course.html'), 'my-courses.html');
  assert.equal(safeNext('course.html?id=not-a-uuid'), 'my-courses.html');
  assert.equal(safeNext('javascript:alert(1)'), 'my-courses.html');
  assert.equal(safeNext('my-courses.html?paid=1'), 'my-courses.html?paid=1');
  assert.equal(safeNext('my-courses.html?paid=2'), 'my-courses.html');
});

test('bundle note appears only for a product that grants the course', () => {
  const courseId = '124c5530-4179-4c32-9650-acbf16311239';
  const products = productsIncludingCourse([
    { sku: 'TF-BEGINNER-SET', name_en: 'TeaFairy Beginner Tea Set', price_minor: 9999, currency: 'GBP', grants_course_id: courseId },
    { sku: 'other', name_en: 'Other tea', price_minor: 1000, currency: 'GBP', grants_course_id: null },
  ], courseId);
  assert.equal(products.length, 1);
  assert.equal(shopHrefForProduct(products[0]), 'products.html#TF-BEGINNER-SET');
  const note = bundleNote(products);
  assert.match(note, /Included with/);
  assert.match(note, /TeaFairy Beginner Tea Set/);
  assert.match(note, /href="products.html#TF-BEGINNER-SET"/);
  assert.equal(bundleNote([]), '');
});

test('course pages sell at the backend price and lock unpaid lessons', () => {
  const courseId = '124c5530-4179-4c32-9650-acbf16311239';
  const item = {
    course: {
      id: courseId,
      title_en: 'TeaFairy\'s Tea-by-Tea',
      description_en: 'Taught by TeaFairy.',
      instructor: 'TeaFairy',
      price_minor: 4999,
      currency: 'GBP',
    },
    lessons: [{ id: courseId, position: 1, title_en: 'Taiping Houkui', is_preview: true, duration_s: null }],
  };
  const detail = courseDetailHtml(item, { signedIn: false });
  assert.match(detail, /£49\.99/);
  assert.match(detail, /Buy course/);
  assert.match(detail, /not available to EU buyers/);
  assert.match(detail, /sign-in\.html\?next=/);
  assert.match(courseDetailHtml(item, { owned: true }), /Watch now/);
  assert.equal(courseDetailHtml(item, { owned: true }).includes('Buy course'), false);
  const locked = lockedLessonHtml(buyControlsHtml({ courseId, priceMinor: 3999, currency: 'GBP', signedIn: true }));
  assert.match(locked, /This lesson is locked/);
  assert.match(locked, /£39\.99/);
  assert.match(locked, /id="buy-course"/);
  assert.match(playbackPendingHtml(), /Playback is not available yet/);
  const card = productCardHtml({ sku: 'TF-BEGINNER-SET', name_en: 'TeaFairy Beginner Tea Set', price_minor: 9999, currency: 'GBP', grants_course_id: null });
  assert.match(card, /£99\.99/);
  assert.match(card, /does not include a course/);
  assert.match(productCardHtml({ sku: 'SET', name_en: 'Set', price_minor: 1000, currency: 'GBP', grants_course_id: courseId, course_title_en: 'TeaFairy\'s Tea-by-Tea' }), /Includes the course/);
  assert.match(detail, /TeaFairy \(茶仙子\)/);
  assert.match(ownedCourseHtml(item), /On your account/);
});

test('app-facing legal pages do not gain an account link', () => {
  for (const file of ['privacy.html', 'terms.html', 'refunds.html', 'community-guidelines.html', 'admin/index.html', '404.html', 'order-success.html']) {
    const html = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.equal(html.includes('site-header.js'), false, file);
    assert.equal(html.includes('courses.html'), false, file);
  }
});
