(function () {
  // Public anon key for the UK gift project tkxepmevhhzfmorbhriz. Not a service-role key.
  var ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRreGVwbWV2aGh6Zm1vcmJocml6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5NzI1MDIsImV4cCI6MjEwOTU0ODUwMn0.HP-2ZfAvvfcfyYNPAydzlQHpX2fUsbeacTIDO4cTNmQ";
  var flow = window.TeaFairyGiftFlow;
  if (!flow) return;
  flow.attach(document, {
    config: window.TEAFAIRY_GIFT_CONFIG,
    anonKey: ANON,
    fetchImpl: function (url, options) {
      return window.fetch(url, options);
    }
  });
})();
