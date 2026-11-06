(function () {
  var PROD = "https://lqghuvaazdnqzkbagbay.supabase.co/functions/v1/gift-redeem";
  // Public anon key already shipped with the site admin. It is not a service-role secret.
  var ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxZ2h1dmFhemRucXprYmFnYmF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4NDAxNTUsImV4cCI6MjEwNzQxNjE1NX0.wl9O-H-cptZO8_743-QLWX8IcojsGIIF2JI3cuiCeyM";
  var lang = "en";
  var lastError = null;
  var lastCampaign = null;
  var offline = false;

  var TEXT = {
    en: {
      title: "Redeem your gift | TeaFairy · TEAFAIRY LIMITED",
      closed: "TeaFairy is not accepting gift redemptions at the moment. If you submit now, your code will not be used.",
      offline: "The redemption service is not connected yet. Nothing will be saved if you submit before it is available.",
      deadlineUnset: "not set",
      countriesUnset: "not limited on this page",
      countriesPrefix: "TeaFairy has listed: ",
      invalid_code: "This code could not be redeemed. Check the code, or email hello@teafairyworld.co.uk if you have just submitted and are not sure it went through. Please do not keep retrying.",
      closed_submit: "TeaFairy is not accepting gift redemptions at the moment. Your code has not been used.",
      rate_limited: "Please wait a little while before trying again. Your code has not been used.",
      unavailable: "We could not reach the redemption service, so nothing was submitted. Please try again later or email hello@teafairyworld.co.uk.",
      invalid_request: "Those details could not be sent. Please check the form. Your code has not been used.",
      origin: "This page is not allowed to submit from here.",
      sending: "Sending…",
      submit: "Submit my delivery details",
      successTitle: "We have your delivery details",
      successBody: "Thank you. Please keep the confirmation reference below if you need to contact TeaFairy. We will not show your address or your code again on this page. TeaFairy will use the reference while arranging dispatch. No email is sent from this page.",
      fieldInvalid: "Please check this.",
      fieldRequired: "Please tick this to continue.",
      fieldUnavailable: "TeaFairy cannot post the gift to that country. Your code has not been used.",
      summary: "Please check the highlighted details. Your code has not been used."
    },
    zh: {
      title: "领取礼物 | TeaFairy · TEAFAIRY LIMITED",
      closed: "TeaFairy 目前尚未开放兑换。现在提交不会使用你的兑换码。",
      offline: "兑换服务尚未接通。在接通之前提交不会保存任何信息。",
      deadlineUnset: "尚未设定",
      countriesUnset: "本页尚未限制",
      countriesPrefix: "TeaFairy 目前列为：",
      invalid_code: "这个兑换码无法使用。请核对兑换码。如果你刚刚提交过、不确定是否成功，请发邮件到 hello@teafairyworld.co.uk，不要反复尝试。",
      closed_submit: "TeaFairy 目前尚未开放兑换。兑换码尚未被使用。",
      rate_limited: "请稍后再试。兑换码尚未被使用。",
      unavailable: "暂时联系不上兑换服务，因此没有提交任何信息。请稍后再试，或发邮件到 hello@teafairyworld.co.uk。",
      invalid_request: "这些信息无法送出。请检查表格。兑换码尚未被使用。",
      origin: "当前页面不允许提交。",
      sending: "正在提交…",
      submit: "提交收货信息",
      successTitle: "我们已收到你的收货信息",
      successBody: "谢谢。请保存下面的确认编号，以便联系 TeaFairy 时核对。本页不会再次显示你的地址或兑换码。TeaFairy 会在安排寄送时使用该编号。本页不会发送电子邮件。",
      fieldInvalid: "请检查此项。",
      fieldRequired: "请勾选后继续。",
      fieldUnavailable: "TeaFairy 目前无法把礼物寄到该国家或地区。兑换码尚未被使用。",
      summary: "请检查标出的项目。兑换码尚未被使用。"
    }
  };

  var FIELDS = ["recipient_name", "address_line1", "address_line2", "city", "postcode", "country", "phone", "email", "instructions", "consent"];

  function t(key) {
    return TEXT[lang][key] || TEXT.en[key] || "";
  }

  function localHost() {
    return location.hostname === "localhost" || location.hostname === "127.0.0.1";
  }

  function endpoint() {
    return localHost() ? location.origin + "/functions/v1/gift-redeem" : PROD;
  }

  function headers() {
    var h = { "content-type": "application/json", accept: "application/json" };
    if (!localHost()) {
      h.apikey = ANON;
      h.authorization = "Bearer " + ANON;
    }
    return h;
  }

  function stripQuery() {
    var params = new URLSearchParams(location.search);
    var next = new URLSearchParams();
    if (params.get("lang") === "zh" || params.get("lang") === "en") next.set("lang", params.get("lang"));
    var nextText = next.toString();
    if (location.search.replace(/^\?/, "") !== nextText) {
      history.replaceState(null, "", location.pathname + (nextText ? "?" + nextText : "") + location.hash);
    }
    return next.get("lang") === "zh" ? "zh" : "en";
  }

  function applyLang(next) {
    lang = next === "zh" ? "zh" : "en";
    document.documentElement.lang = lang === "zh" ? "zh-Hans" : "en";
    document.title = t("title");
    document.getElementById("lang-en").setAttribute("aria-pressed", lang === "en" ? "true" : "false");
    document.getElementById("lang-zh").setAttribute("aria-pressed", lang === "zh" ? "true" : "false");
    var button = document.getElementById("submit");
    if (button && !button.dataset.busy) button.textContent = t("submit");
    if (lastCampaign) showCampaign(lastCampaign);
    var offlineNote = document.getElementById("offline-note");
    if (offline && offlineNote) {
      offlineNote.hidden = false;
      offlineNote.textContent = t("offline");
    }
    if (lastError) showError(lastError.code, lastError.fields);
  }

  function showError(code, fields) {
    lastError = { code: code, fields: fields || null };
    var box = document.getElementById("form-error");
    if (!box) return;
    FIELDS.forEach(function (name) {
      var el = document.getElementById(name);
      if (!el) return;
      el.removeAttribute("aria-invalid");
      el.removeAttribute("aria-describedby");
      var note = document.getElementById(name + "-error");
      if (note) note.remove();
    });
    var lines = [];
    if (fields) {
      Object.keys(fields).forEach(function (name) {
        var el = document.getElementById(name);
        var kind = fields[name];
        var msg = kind === "required" ? t("fieldRequired") : kind === "unavailable" ? t("fieldUnavailable") : t("fieldInvalid");
        if (el) {
          el.setAttribute("aria-invalid", "true");
          var note = document.createElement("p");
          note.id = name + "-error";
          note.className = "field-error";
          note.textContent = msg;
          el.insertAdjacentElement("afterend", note);
          el.setAttribute("aria-describedby", note.id);
        }
        lines.push(msg);
      });
    }
    box.hidden = false;
    box.textContent = (code === "invalid_details" ? t("summary") : t(code)) || t("invalid_request");
    if (lines.length) box.textContent += " " + lines.filter(function (m, i, a) { return a.indexOf(m) === i; }).join(" ");
    box.focus();
  }

  function clearError() {
    lastError = null;
    var box = document.getElementById("form-error");
    if (box) {
      box.hidden = true;
      box.textContent = "";
    }
  }

  function fillCountries() {
    return fetch("iso-countries.json", { headers: { accept: "application/json" } }).then(function (res) {
      if (!res.ok) throw new Error("countries");
      return res.json();
    }).then(function (rows) {
      var select = document.getElementById("country");
      var current = select.value || "GB";
      select.textContent = "";
      rows.forEach(function (row) {
        if (!row || !/^[A-Z]{2}$/.test(row.code)) return;
        var option = document.createElement("option");
        option.value = row.code;
        option.textContent = row.en + " / " + (row.zh || row.en);
        if (row.code === current) option.selected = true;
        select.appendChild(option);
      });
      if (!select.value) select.value = "GB";
    }).catch(function () {});
  }

  function showCampaign(data) {
    lastCampaign = data;
    var deadline = document.getElementById("deadline-text");
    var countries = document.getElementById("countries-text");
    var closed = document.getElementById("closed-note");
    if (data && data.redeem_deadline) {
      var when = new Date(data.redeem_deadline);
      deadline.textContent = isNaN(when.getTime()) ? t("deadlineUnset") : when.toLocaleString(lang === "zh" ? "zh-CN" : "en-GB", { timeZone: "UTC" }) + " UTC";
    } else if (deadline) {
      deadline.textContent = t("deadlineUnset");
    }
    if (data && Array.isArray(data.allowed_countries) && data.allowed_countries.length) {
      countries.textContent = t("countriesPrefix") + data.allowed_countries.join(", ");
    } else if (countries) {
      countries.textContent = t("countriesUnset");
    }
    if (data && data.active === false) {
      closed.hidden = false;
      closed.textContent = t("closed");
    } else if (closed) {
      closed.hidden = true;
    }
    var offline = document.getElementById("offline-note");
    if (offline) offline.hidden = true;
  }

  function loadCampaign() {
    return fetch(endpoint(), { method: "GET", headers: { accept: "application/json" } }).then(function (res) {
      if (!res.ok) throw new Error("campaign");
      return res.json();
    }).then(showCampaign).catch(function () {
      offline = true;
      var note = document.getElementById("offline-note");
      if (note) {
        note.hidden = false;
        note.textContent = t("offline");
      }
    });
  }

  function payload() {
    return {
      code: document.getElementById("code").value,
      recipient_name: document.getElementById("recipient_name").value,
      address_line1: document.getElementById("address_line1").value,
      address_line2: document.getElementById("address_line2").value,
      city: document.getElementById("city").value,
      postcode: document.getElementById("postcode").value,
      country: document.getElementById("country").value,
      phone: document.getElementById("phone").value,
      consent: document.getElementById("consent").checked === true
    };
  }

  function succeed(ref) {
    ["code", "recipient_name", "address_line1", "address_line2", "city", "postcode", "phone"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = "";
    });
    var consent = document.getElementById("consent");
    if (consent) consent.checked = false;
    var wrap = document.getElementById("form-wrap");
    if (wrap) wrap.remove();
    var panel = document.getElementById("success");
    document.getElementById("success-title").textContent = t("successTitle");
    document.getElementById("success-body").textContent = t("successBody");
    document.getElementById("ref").textContent = ref;
    panel.hidden = false;
    panel.focus();
  }

  function onSubmit(event) {
    event.preventDefault();
    var button = document.getElementById("submit");
    if (button.dataset.busy === "1") return;
    clearError();
    button.dataset.busy = "1";
    button.disabled = true;
    button.textContent = t("sending");
    var form = document.getElementById("redeem-form");
    if (form) form.setAttribute("aria-busy", "true");
    fetch(endpoint(), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload()),
      credentials: "omit",
      cache: "no-store",
      redirect: "error"
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        return { status: res.status, body: body };
      });
    }).then(function (result) {
      var body = result.body || {};
      if (result.status === 200 && body.ok === true && /^TF-[0-9A-F]{8}$/.test(body.confirmation_ref || "")) {
        succeed(body.confirmation_ref);
        return;
      }
      var code = body.error || (result.status === 429 ? "rate_limited" : "unavailable");
      if (code === "closed") code = "closed_submit";
      showError(code, body.fields || null);
    }).catch(function () {
      showError("unavailable");
    }).then(function () {
      var still = document.getElementById("submit");
      if (!still) return;
      still.dataset.busy = "";
      still.disabled = false;
      still.textContent = t("submit");
      var liveForm = document.getElementById("redeem-form");
      if (liveForm) liveForm.removeAttribute("aria-busy");
    });
  }

  lang = stripQuery();
  applyLang(lang);
  document.getElementById("lang-en").addEventListener("click", function () { applyLang("en"); });
  document.getElementById("lang-zh").addEventListener("click", function () { applyLang("zh"); });
  document.getElementById("redeem-form").addEventListener("submit", onSubmit);
  document.getElementById("submit").disabled = false;
  fillCountries();
  loadCampaign();
})();
