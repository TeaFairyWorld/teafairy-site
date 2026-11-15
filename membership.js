import { membershipConfig } from './membership-config.js';

// Catalogue columns only. stream_uid is requested later, and only for a preview lesson
// when website playback is configured. Paid lessons never get a playback URL here.
export const COURSE_LIST_COLUMNS = 'id,title_en,description_en,instructor,cover_url,sort_order';
export const LESSON_LIST_COLUMNS = 'id,course_id,position,title_en,is_preview,duration_s,thumbnail_url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STREAM_CODE = /^[A-Za-z0-9_-]{1,64}$/;
const STREAM_UID = /^[A-Za-z0-9]{1,64}$/;
const NEXT_PAGES = new Set(['my-courses.html', 'courses.html', 'course.html', 'lesson.html', 'index.html']);
const SHOP_PAGE_SKUS = new Set(['beginner-tea-set', 'TF-BEGINNER-SET']);

export function isUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

export function isEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

export function sanitizePublicText(value) {
  const replaced = String(value ?? '').replace(/baolili|鲍丽丽/gi, 'TeaFairy (茶仙子)');
  return replaced.replace(/(?:TeaFairy \(茶仙子\)\s*){2,}/g, 'TeaFairy (茶仙子) ').replace(/[ ]{2,}/g, ' ').trim();
}

export function publicInstructor(value) {
  const cleaned = sanitizePublicText(value);
  if (!cleaned || /^teafairy$/i.test(cleaned) || cleaned === 'TeaFairy (茶仙子)') return 'TeaFairy (茶仙子)';
  return cleaned;
}

/** Same en-GB currency formatting the app uses in src/lib/format.ts. */
export function formatMoney(minor, currency = 'GBP') {
  if (minor === null || minor === undefined || minor === '') return '';
  const amount = Number(minor);
  if (!Number.isFinite(amount)) return '';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'GBP' }).format(amount / 100);
}

export function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '';
  const total = Math.round(value);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  if (minutes <= 0) return remainder === 1 ? '1 sec' : `${remainder} sec`;
  if (remainder === 0) return minutes === 1 ? '1 min' : `${minutes} min`;
  return `${minutes} min ${remainder} sec`;
}

export function lessonCountLabel(count) {
  const n = Number(count) || 0;
  return n === 1 ? '1 lesson' : `${n} lessons`;
}

export function totalDurationLabel(lessons) {
  const known = (lessons || []).map((lesson) => Number(lesson.duration_s)).filter((n) => Number.isFinite(n) && n > 0);
  if (!known.length) return '';
  return formatDuration(known.reduce((sum, n) => sum + n, 0));
}

export function sortLessons(lessons) {
  return [...(lessons || [])].sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
}

export function httpsUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export function coverUrl(course, lessons) {
  return httpsUrl(course && course.cover_url) || httpsUrl((lessons || []).find((lesson) => httpsUrl(lesson.thumbnail_url))?.thumbnail_url);
}

/** Playback URL for a lesson that is already marked as a public preview. */
export function previewStreamUrl(lesson, config) {
  if (!lesson || lesson.is_preview !== true) return null;
  const code = config && config.streamCustomerCode;
  const uid = lesson.stream_uid;
  if (typeof code !== 'string' || !STREAM_CODE.test(code)) return null;
  if (typeof uid !== 'string' || !STREAM_UID.test(uid)) return null;
  return `https://customer-${code}.cloudflarestream.com/${uid}/manifest/video.m3u8`;
}

export function appleSignInEnabled(config = membershipConfig) {
  return !!(config && config.appleSignIn === true);
}

export function safeNext(value) {
  const fallback = 'my-courses.html';
  if (typeof value !== 'string' || !value || value.length > 120) return fallback;
  let url;
  try { url = new URL(value, 'https://teafairyworld.co.uk/'); } catch { return fallback; }
  if (url.origin !== 'https://teafairyworld.co.uk') return fallback;
  const page = url.pathname.replace(/^\//, '');
  if (!NEXT_PAGES.has(page)) return fallback;
  const id = url.searchParams.get('id');
  const extra = [...url.searchParams.keys()].filter((key) => key !== 'id');
  if (extra.length) return fallback;
  if (page === 'course.html' || page === 'lesson.html') {
    if (id && !isUuid(id)) return fallback;
    return id ? `${page}?id=${id}` : page;
  }
  if (id) return fallback;
  return page;
}

export function authCallbackUrl(next) {
  const url = new URL('auth-callback.html', typeof location !== 'undefined' ? location.href : 'https://teafairyworld.co.uk/');
  url.searchParams.set('next', safeNext(next));
  return url.href;
}

export function accountLabel(session) {
  const email = session && session.user && session.user.email;
  return typeof email === 'string' && email.includes('@') ? email : 'Account';
}

export function productsIncludingCourse(products, courseId) {
  if (!isUuid(courseId)) return [];
  return (products || []).filter((product) => product && product.grants_course_id === courseId);
}

/** The static shop page sells the Beginner Tea Set. Other SKUs have no page on this site. */
export function shopHrefForProduct(product) {
  if (!product || !SHOP_PAGE_SKUS.has(product.sku)) return '';
  return 'products.html';
}

export function createMembershipClient(createClient, config = membershipConfig) {
  if (!config || typeof config.supabaseUrl !== 'string' || typeof config.supabaseAnonKey !== 'string') {
    throw new Error('Membership Supabase config is missing');
  }
  if (!config.supabaseUrl.startsWith('https://') || config.supabaseAnonKey.length < 20) {
    throw new Error('Membership Supabase config is incomplete');
  }
  const scope = typeof window === 'undefined' ? null : window;
  if (scope && scope.__teafairyMembership) return scope.__teafairyMembership;
  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      detectSessionInUrl: false,
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  if (scope) scope.__teafairyMembership = client;
  return client;
}

function withLessons(row) {
  const { course_lessons: nested, ...course } = row;
  return { course, lessons: sortLessons(nested) };
}

export async function loadPublishedCourses(client) {
  const { data, error } = await client
    .from('courses')
    .select(`${COURSE_LIST_COLUMNS},course_lessons(${LESSON_LIST_COLUMNS})`)
    .eq('status', 'published')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data || []).map(withLessons);
}

export async function loadCourse(client, id) {
  if (!isUuid(id)) return null;
  const { data, error } = await client
    .from('courses')
    .select(`${COURSE_LIST_COLUMNS},course_lessons(${LESSON_LIST_COLUMNS})`)
    .eq('id', id)
    .eq('status', 'published')
    .maybeSingle();
  if (error) throw error;
  return data ? withLessons(data) : null;
}

export async function loadLesson(client, id) {
  if (!isUuid(id)) return null;
  const { data: lesson, error } = await client
    .from('course_lessons')
    .select(LESSON_LIST_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!lesson) return null;
  const course = await loadCourse(client, lesson.course_id);
  if (!course) return null;
  return { ...course, lesson: course.lessons.find((item) => item.id === lesson.id) || lesson };
}

/** Shop products whose grants_course_id is this course. An empty list means "do not mention a product". */
export async function bundledProducts(client, courseId) {
  if (!isUuid(courseId)) return [];
  const { data, error } = await client
    .from('products_public')
    .select('id,sku,name_en,price_minor,currency,image_url,grants_course_id')
    .eq('grants_course_id', courseId);
  if (error) return [];
  return productsIncludingCourse(data, courseId);
}

export async function hasAccess(client, courseId) {
  if (!isUuid(courseId)) return false;
  const { data, error } = await client.rpc('has_course_access', { c: courseId });
  if (error) return false;
  return data === true;
}

/** Same access path as the app: claim email-linked orders, then has_course_access per published course. */
export async function coursesWithAccess(client) {
  await client.rpc('claim_order_courses');
  const published = await loadPublishedCourses(client);
  const owned = [];
  for (const item of published) {
    if (await hasAccess(client, item.course.id)) owned.push(item);
  }
  return owned;
}

/**
 * Phase 2 replaces this with a short-lived Cloudflare Stream token from an Edge Function.
 * Until then, a preview plays only when it is marked is_preview and the public customer code is set.
 * Paid lessons are not requested and are not given a URL.
 */
export async function previewPlaybackUrl(client, lessonId, config = membershipConfig) {
  if (!isUuid(lessonId) || !config || !config.streamCustomerCode) return null;
  const { data, error } = await client
    .from('course_lessons')
    .select('id,is_preview,stream_uid')
    .eq('id', lessonId)
    .eq('is_preview', true)
    .maybeSingle();
  if (error || !data) return null;
  return previewStreamUrl(data, config);
}

export async function sendEmailCode(client, email, { createUser, redirectTo } = {}) {
  const shouldCreateUser = !!createUser;
  const options = { shouldCreateUser };
  if (redirectTo) options.emailRedirectTo = redirectTo;
  let result = await client.auth.signInWithOtp({ email, options });
  if (result.error && redirectTo && /redirect/i.test(result.error.message || '')) {
    result = await client.auth.signInWithOtp({ email, options: { shouldCreateUser } });
  }
  return result;
}

export async function verifyEmailCode(client, email, token) {
  return client.auth.verifyOtp({ email, token: token.trim(), type: 'email' });
}

export async function signInWithApple(client, redirectTo) {
  return client.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo, scopes: 'name email' },
  });
}

/** A server session that is already gone should still clear this browser. */
export function signOutCanFinishLocally(error) {
  if (!error) return true;
  return /session_not_found|session from session_id|session missing/i.test(String(error.message || error.msg || ''));
}

/** This browser only. Does not revoke the TeaFairy World app session. */
export async function signOutLocal(client) {
  const result = await client.auth.signOut({ scope: 'local' });
  const finished = signOutCanFinishLocally(result.error);
  if (finished && typeof localStorage !== 'undefined') {
    const ref = new URL(membershipConfig.supabaseUrl).hostname.split('.')[0];
    localStorage.removeItem(`sb-${ref}-auth-token`);
  }
  return finished ? { error: null } : result;
}

export async function completeAuthCallback(client, href) {
  const url = new URL(href);
  const described = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (described) return { data: null, error: new Error(described) };
  const code = url.searchParams.get('code');
  if (code) return client.auth.exchangeCodeForSession(code);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  if (tokenHash && type) return client.auth.verifyOtp({ token_hash: tokenHash, type });
  const session = await client.auth.getSession();
  if (session.error) return session;
  if (session.data.session) return { data: session.data, error: null };
  return { data: null, error: new Error('This sign-in link is incomplete or has expired.') };
}

export function bundleNote(products) {
  const rows = products || [];
  if (!rows.length) return '';
  const parts = rows.map((product) => {
    const name = escapeHtml(sanitizePublicText(product.name_en) || 'Shop product');
    const price = formatMoney(product.price_minor, product.currency || 'GBP');
    const label = price ? `${name} (${escapeHtml(price)})` : name;
    const href = shopHrefForProduct(product);
    return href ? `<a href="${escapeHtml(href)}">${label}</a>` : label;
  });
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `<p class="notice">This course is not sold on its own. It is included with ${list}.</p>`;
}
