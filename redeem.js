(function () {
  var ENDPOINT = "https://lqghuvaazdnqzkbagbay.supabase.co/functions/v1/gift-submit";
  var ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxZ2h1dmFhemRucXprYmFnYmF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4NDAxNTUsImV4cCI6MjEwNzQxNjE1NX0.wl9O-H-cptZO8_743-QLWX8IcojsGIIF2JI3cuiCeyM";
  var form = document.getElementById("redeem-form");
  var button = document.getElementById("submit");
  var note = document.getElementById("not-saved");
  button.disabled = false;
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    note.hidden = true;
    button.disabled = true;
    var body = {
      reference_code: document.getElementById("code").value,
      recipient_name: document.getElementById("recipient_name").value,
      phone: document.getElementById("phone").value,
      address_line1: document.getElementById("address_line1").value,
      address_line2: document.getElementById("address_line2").value,
      city: document.getElementById("city").value,
      postcode: document.getElementById("postcode").value,
      country: document.getElementById("country").value
    };
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", apikey: ANON, authorization: "Bearer " + ANON },
      body: JSON.stringify(body),
      credentials: "omit",
      cache: "no-store"
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok || !json || json.ok !== true) throw new Error("not saved");
      });
    }).then(function () {
      form.reset();
      document.getElementById("form-wrap").hidden = true;
      var done = document.getElementById("success");
      done.hidden = false;
      done.focus();
    }).catch(function () {
      note.hidden = false;
      button.disabled = false;
    });
  });
})();
