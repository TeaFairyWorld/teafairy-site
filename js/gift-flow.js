(function (root, factory) {
  var api = factory(typeof module === "object" && module.exports ? require("./gift-code.js") : root.TeaFairyGiftCode);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TeaFairyGiftFlow = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (codes) {
  var ENDPOINT = "https://tkxepmevhhzfmorbhriz.supabase.co/functions/v1/gift-submit";
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var SUBMIT_LABEL = "Submit my delivery details / 提交收货信息";
  var CLOSED_LABEL = "Not open yet / 尚未开放";

  function submissionsEnabled(config) {
    return !!(config && config.submissionsEnabled === true && config.endpoint === ENDPOINT);
  }

  function interpretResult(http) {
    if (!http || http.networkError) return { view: "unavailable" };
    var json = http.json;
    if (http.status === 200 && json && typeof json === "object"
      && typeof json.confirmation_id === "string" && UUID.test(json.confirmation_id)
      && (json.tier === "standard" || json.tier === "grand")) {
      return { view: "success", confirmationId: json.confirmation_id, tier: json.tier };
    }
    if (http.status === 400 && json && json.error === "invalid_or_used") return { view: "invalid_or_used" };
    if (http.status === 400 && json && json.error === "invalid_request") return { view: "invalid_request" };
    return { view: "unavailable" };
  }

  function readFields(doc) {
    function value(id) {
      var el = doc.getElementById(id);
      return el && typeof el.value === "string" ? el.value : "";
    }
    var consent = doc.getElementById("consent");
    return {
      code: value("code"),
      recipient_name: value("recipient_name"),
      phone: value("phone"),
      email: value("email"),
      address1: value("address1"),
      address2: value("address2"),
      city: value("city"),
      postcode: value("postcode"),
      country: value("country"),
      consent: !!(consent && consent.checked)
    };
  }

  function submitGift(fields, options) {
    var config = options && options.config;
    if (!submissionsEnabled(config)) return Promise.resolve({ view: "disabled", sent: false });
    var prepared = codes.prepareGiftSubmission(fields);
    if (!prepared.ok) return Promise.resolve({ view: "invalid_request", sent: false });
    if (!options.anonKey || typeof options.fetchImpl !== "function") {
      return Promise.resolve({ view: "unavailable", sent: false });
    }
    var payload = prepared.submission;
    return Promise.resolve(options.fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        apikey: options.anonKey,
        authorization: "Bearer " + options.anonKey
      },
      body: JSON.stringify(payload),
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer"
    })).then(function (res) {
      return Promise.resolve(res.json()).catch(function () { return null; }).then(function (json) {
        var view = interpretResult({ status: res.status, json: json });
        view.sent = true;
        return view;
      });
    }).catch(function () {
      return { view: "unavailable", sent: true };
    });
  }

  function hide(el) {
    if (el) el.hidden = true;
  }

  function applyView(doc, state) {
    var inactive = doc.getElementById("gift-inactive");
    var unavailable = doc.getElementById("gift-unavailable");
    var invalid = doc.getElementById("gift-invalid");
    var fields = doc.getElementById("gift-fields");
    var success = doc.getElementById("gift-success");
    var standard = doc.getElementById("standard-note");
    var grand = doc.getElementById("grand-note");
    var confirm = doc.getElementById("confirmation-id");
    var formWrap = doc.getElementById("form-wrap");
    var form = doc.getElementById("redeem-form");
    var fieldset = doc.getElementById("gift-fields-set");
    var button = doc.getElementById("submit");
    [inactive, unavailable, invalid, fields, success, standard, grand].forEach(hide);
    if (confirm) confirm.textContent = "";
    if (state.view === "success") {
      if (confirm) confirm.textContent = state.confirmationId;
      if (state.tier === "grand") {
        if (grand) grand.hidden = false;
      } else if (state.tier === "standard") {
        if (standard) standard.hidden = false;
      }
      if (success) success.hidden = false;
      if (formWrap) formWrap.hidden = true;
      if (form && typeof form.reset === "function") form.reset();
      if (success && typeof success.focus === "function") success.focus();
      return;
    }
    if (formWrap) formWrap.hidden = false;
    var closed = state.view === "disabled";
    if (fieldset) fieldset.disabled = closed;
    if (button) button.textContent = closed ? CLOSED_LABEL : SUBMIT_LABEL;
    if (closed && inactive) inactive.hidden = false;
    else if (state.view === "unavailable" && unavailable) unavailable.hidden = false;
    else if (state.view === "invalid_or_used" && invalid) invalid.hidden = false;
    else if (state.view === "invalid_request" && fields) fields.hidden = false;
  }

  function attach(doc, options) {
    var config = (options && options.config) || { submissionsEnabled: false };
    var fetchImpl = options && options.fetchImpl;
    var anonKey = options && options.anonKey || "";
    applyView(doc, { view: submissionsEnabled(config) ? "ready" : "disabled" });
    var form = doc.getElementById("redeem-form");
    if (!form || typeof form.addEventListener !== "function") return;
    var busy = false;
    var view = doc.defaultView;
    if (view && typeof view.addEventListener === "function") {
      view.addEventListener("pageshow", function () {
        if (!submissionsEnabled(config) && typeof form.reset === "function") form.reset();
        if (!submissionsEnabled(config)) applyView(doc, { view: "disabled" });
      });
    }
    form.addEventListener("submit", function (event) {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      if (busy) return;
      if (!submissionsEnabled(config)) {
        applyView(doc, { view: "disabled" });
        return;
      }
      if (typeof form.reportValidity === "function" && !form.reportValidity()) return;
      busy = true;
      var button = doc.getElementById("submit");
      if (button) button.disabled = true;
      submitGift(readFields(doc), { config: config, fetchImpl: fetchImpl, anonKey: anonKey }).then(function (result) {
        busy = false;
        applyView(doc, result);
      }, function () {
        busy = false;
        applyView(doc, { view: "unavailable" });
      });
    });
  }

  return {
    ENDPOINT: ENDPOINT,
    submissionsEnabled: submissionsEnabled,
    interpretResult: interpretResult,
    readFields: readFields,
    submitGift: submitGift,
    applyView: applyView,
    attach: attach
  };
});
