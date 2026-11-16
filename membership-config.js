// Membership, course checkout, lesson playback, and the shop use this config.
// Public anon key only, the same key already shipped in checkout.js and the admin page.
// Never put a service-role key or an Apple secret here.
export const membershipConfig = {
  supabaseUrl: 'https://lqghuvaazdnqzkbagbay.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxZ2h1dmFhemRucXprYmFnYmF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4NDAxNTUsImV4cCI6MjEwNzQxNjE1NX0.wl9O-H-cptZO8_743-QLWX8IcojsGIIF2JI3cuiCeyM',
  // Sign in with Apple stays off until a Services ID and return URL are configured.
  appleSignIn: false,
};
