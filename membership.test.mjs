import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CHECKOUT_ENDPOINT } from './checkout.js';
import { membershipConfig } from './membership-config.js';
import { courseDetailHtml, ownedCourseHtml, playerHtml } from './course-view.js';
import {
  COURSE_LIST_COLUMNS,
  LESSON_LIST_COLUMNS,
  appleSignInEnabled,
  bundleNote,
  formatMoney,
  previewStreamUrl,
  productsIncludingCourse,
  publicInstructor,
  safeNext,
  sanitizePublicText,
  shopHrefForProduct,
  signOutCanFinishLocally,
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

test('lesson catalogue columns do not include stream uid or a course price', () => {
  assert.equal(LESSON_LIST_COLUMNS.includes('stream_uid'), false);
  assert.equal(COURSE_LIST_COLUMNS.includes('price_minor'), false);
  assert.equal(COURSE_LIST_COLUMNS.includes('apple_product_id'), false);
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

test('preview playback is refused for paid lessons and without a customer code', () => {
  const paid = { is_preview: false, stream_uid: 'abc123' };
  const preview = { is_preview: true, stream_uid: 'abc123' };
  assert.equal(previewStreamUrl(paid, { streamCustomerCode: 'customer1' }), null);
  assert.equal(previewStreamUrl(preview, { streamCustomerCode: '' }), null);
  assert.equal(previewStreamUrl(preview, { streamCustomerCode: 'bad/code' }), null);
  assert.equal(previewStreamUrl({ is_preview: true, stream_uid: '../secret' }, { streamCustomerCode: 'customer1' }), null);
  assert.equal(
    previewStreamUrl(preview, { streamCustomerCode: 'customer1' }),
    'https://customer-customer1.cloudflarestream.com/abc123/manifest/video.m3u8',
  );
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
});

test('bundle note appears only for a product that grants the course', () => {
  const courseId = '124c5530-4179-4c32-9650-acbf16311239';
  const products = productsIncludingCourse([
    { sku: 'TF-BEGINNER-SET', name_en: 'TeaFairy Beginner Tea Set', price_minor: 9999, currency: 'GBP', grants_course_id: courseId },
    { sku: 'other', name_en: 'Other tea', price_minor: 1000, currency: 'GBP', grants_course_id: null },
  ], courseId);
  assert.equal(products.length, 1);
  assert.equal(shopHrefForProduct(products[0]), 'products.html');
  const note = bundleNote(products);
  assert.match(note, /not sold on its own/);
  assert.match(note, /TeaFairy Beginner Tea Set/);
  assert.match(note, /href="products.html"/);
  assert.equal(note.toLowerCase().includes('buy this course'), false);
  assert.equal(bundleNote([]), '');
  assert.equal(bundleNote([{ sku: 'loose-leaf', name_en: 'Loose leaf', price_minor: 1200, currency: 'GBP', grants_course_id: courseId }]).includes('href='), false);
});

test('paid lessons render a placeholder and never a player', () => {
  const paid = playerHtml({ is_preview: false, title_en: 'Da Hong Pao', stream_uid: 'should-not-appear' });
  assert.match(paid, /Player coming soon/);
  assert.equal(paid.includes('<video'), false);
  assert.equal(paid.includes('should-not-appear'), false);
  assert.equal(paid.includes('cloudflarestream'), false);
  const preview = playerHtml({ is_preview: true, title_en: 'Taiping Houkui' });
  assert.match(preview, /Free preview/);
  assert.match(preview, /not switched on yet/);
  const courseId = '124c5530-4179-4c32-9650-acbf16311239';
  const item = {
    course: { id: courseId, title_en: 'TeaFairy\'s Tea-by-Tea', description_en: 'Taught by TeaFairy.', instructor: 'TeaFairy' },
    lessons: [{ id: courseId, position: 1, title_en: 'Taiping Houkui', is_preview: true, duration_s: null }],
  };
  const detail = courseDetailHtml(item);
  assert.equal(detail.toLowerCase().includes('buy'), false);
  assert.match(detail, /TeaFairy \(茶仙子\)/);
  assert.match(ownedCourseHtml(item), /On your account/);
  assert.equal(ownedCourseHtml(item).toLowerCase().includes('buy'), false);
});

test('app-facing legal pages do not gain an account link', () => {
  for (const file of ['privacy.html', 'terms.html', 'refunds.html', 'community-guidelines.html', 'admin/index.html', '404.html', 'order-success.html']) {
    const html = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.equal(html.includes('site-header.js'), false, file);
    assert.equal(html.includes('courses.html'), false, file);
  }
});
