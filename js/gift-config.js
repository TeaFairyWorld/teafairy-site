// Real submissions stay off until gift-submit is deployed on the UK gift project,
// the pepper is set, and a human has confirmed a redemption. Do not point this
// page at any other project.
(function (root) {
  var config = {
    submissionsEnabled: false,
    endpoint: "https://tkxepmevhhzfmorbhriz.supabase.co/functions/v1/gift-submit"
  };
  if (typeof module === "object" && module.exports) module.exports = config;
  root.TEAFAIRY_GIFT_CONFIG = config;
})(typeof globalThis !== "undefined" ? globalThis : this);
