// Membership pages (sign-in, courses, my courses) read this config.
// Guest checkout stays in checkout.js and still uses the production project.
// This file points at the TEST project so these pages can be tried without
// touching production. Change the URL and the public anon key together.
// Never put a service-role key or an Apple secret here.
export const membershipConfig = {
  supabaseUrl: 'https://mwtyriuhqltmlgqmygam.supabase.co',
  // Public anon key for the test project, same kind of key checkout.js already ships.
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13dHlyaXVocWx0bWxncW15Z2FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQyMjMxMDEsImV4cCI6MjEwOTc5OTEwMX0.wR8TRJlMiZN7jDyu9uzOY_RbM_2o2eZnjGwLzJmpow4',
  // Sign in with Apple stays off until the owner adds a Services ID and return URL.
  appleSignIn: false,
  // Public Cloudflare Stream customer code (the app's EXPO_PUBLIC_CF_STREAM_CUSTOMER_CODE).
  // Empty means a preview lesson is listed and is not played on the website.
  streamCustomerCode: '',
};
