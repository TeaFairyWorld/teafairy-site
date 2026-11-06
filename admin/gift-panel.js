(function () {
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function lines(value) {
    return escapeHtml(value).replace(/\n/g, "<br>");
  }

  function renderClaims(claims) {
    if (!claims || !claims.length) return "<p>No gift claims yet.</p>";
    var rows = claims.map(function (claim) {
      var id = escapeHtml(claim.id);
      var address = [claim.address_line1, claim.address_line2, claim.city, claim.postcode, claim.country]
        .filter(function (part) { return part; })
        .map(escapeHtml)
        .join("<br>");
      var shipped = claim.status === "shipped";
      var redacted = !!claim.redacted_at;
      var action = redacted
        ? "<small>Delivery details removed</small>"
        : shipped
          ? escapeHtml(claim.carrier || "") + " " + escapeHtml(claim.tracking_number || "")
          : '<label>Carrier <input data-gift-carrier="' + id + '" maxlength="80"></label>' +
            '<label>Tracking <input data-gift-tracking="' + id + '" maxlength="80"></label>' +
            '<button type="button" data-gift-action="ship" data-id="' + id + '">Mark as shipped</button>';
      return "<tr><td>" + escapeHtml(claim.confirmation_ref) + "<br><small>" + escapeHtml(claim.created_at || "") + "</small></td>" +
        "<td><span class=\"tag " + (shipped ? "shipped" : "pending") + "\">" + escapeHtml(claim.status) + "</span></td>" +
        "<td>" + escapeHtml(claim.recipient_name) + "</td>" +
        "<td>" + (address || "<small>Removed</small>") + "</td>" +
        "<td>" + escapeHtml(claim.phone || "") + "<br>" + escapeHtml(claim.email || "") + "</td>" +
        "<td>" + lines(claim.instructions || "") + "</td>" +
        "<td>" + action + "</td></tr>";
    }).join("");
    return "<table><tr><th>Reference</th><th>Status</th><th>Recipient</th><th>Address</th><th>Phone / email</th><th>Note</th><th>Dispatch</th></tr>" + rows + "</table>";
  }

  function campaignForm(campaign) {
    campaign = campaign || {};
    var deadline = campaign.redeem_deadline ? String(campaign.redeem_deadline).slice(0, 16) : "";
    var countries = Array.isArray(campaign.allowed_countries) ? campaign.allowed_countries.join(", ") : "";
    return '<div class="card"><h3>Thank-you gift settings</h3>' +
      "<p>Leave the gift unnamed here. Blank deadline means no closing date is published. A blank country list means this page does not limit countries. Retention is a working period after dispatch, not an automatic legal promise.</p>" +
      '<p><label><input id="gift-active" type="checkbox" style="width:auto" ' + (campaign.active ? "checked" : "") + '> Accept redemptions</label></p>' +
      '<p><label>Closing time (UTC, optional)<input id="gift-deadline" type="datetime-local" value="' + escapeHtml(deadline) + '"></label></p>' +
      '<p><label>Countries TeaFairy can post to (ISO codes, optional)<input id="gift-countries" value="' + escapeHtml(countries) + '" placeholder="GB, IE"></label></p>' +
      '<p><label>Remove delivery details this many days after dispatch<input id="gift-retention" type="number" min="1" max="3650" value="' + escapeHtml(campaign.retention_days || 90) + '"></label></p>' +
      '<p><button type="button" data-gift-action="save-campaign">Save gift settings</button> ' +
      '<button type="button" class="sec" data-gift-action="redact">Remove delivery details past this period</button></p></div>';
  }

  async function load(app) {
    var ctx = app._giftCtx;
    app.innerHTML = "<p>Loading gift claims…</p>";
    try {
      var listed = await ctx.call({ action: "list" });
      var cfg = await ctx.call({ action: "config" });
      app.innerHTML = '<div class="card"><h3>Thank-you gifts</h3><p>Addresses are for dispatch only. Marking a claim as shipped does not email the recipient and does not book a courier.</p></div>' +
        campaignForm(cfg.campaign) +
        '<div class="card">' + renderClaims(listed.claims || []) + "</div>";
    } catch (error) {
      app.innerHTML = '<div class="card">' + escapeHtml(error && error.message ? error.message : "Could not load gift claims.") + "</div>";
    }
  }

  function mount(app, ctx) {
    app._giftCtx = ctx;
    if (!app.dataset.giftsBound) {
      app.dataset.giftsBound = "1";
      app.addEventListener("click", function (event) {
        var button = event.target.closest("[data-gift-action]");
        if (!button || !app.contains(button)) return;
        onAction(app, button);
      });
    }
    load(app);
  }

  async function onAction(app, button) {
    var ctx = app._giftCtx;
    var action = button.getAttribute("data-gift-action");
    button.disabled = true;
    try {
      if (action === "ship") {
        if (!window.confirm("Mark this claim as shipped? This does not email the recipient and does not book a courier.")) {
          button.disabled = false;
          return;
        }
        var id = button.getAttribute("data-id");
        var carrier = app.querySelector('[data-gift-carrier="' + id + '"]');
        var tracking = app.querySelector('[data-gift-tracking="' + id + '"]');
        await ctx.call({
          action: "mark_shipped",
          claim_id: id,
          carrier: carrier ? carrier.value : "",
          tracking: tracking ? tracking.value : ""
        });
      } else if (action === "save-campaign") {
        var countries = document.getElementById("gift-countries").value.split(/[\s,]+/).filter(Boolean);
        var deadline = document.getElementById("gift-deadline").value;
        await ctx.call({
          action: "set_campaign",
          patch: {
            active: document.getElementById("gift-active").checked,
            redeem_deadline: deadline ? new Date(deadline + "Z").toISOString() : null,
            allowed_countries: countries.length ? countries.map(function (code) { return code.toUpperCase(); }) : null,
            retention_days: Number(document.getElementById("gift-retention").value)
          }
        });
      } else if (action === "redact") {
        if (!window.confirm("Remove delivery details from gifts marked shipped longer ago than the retention period?")) return;
        await ctx.call({ action: "redact_due" });
      }
      await load(app);
    } catch (error) {
      window.alert(error && error.message ? error.message : "Could not update the gift claim.");
      button.disabled = false;
    }
  }

  window.TeaFairyGifts = { escapeHtml: escapeHtml, renderClaims: renderClaims, mount: mount };
})();
