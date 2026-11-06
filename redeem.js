(function () {
  var form = document.getElementById("redeem-form");
  var button = document.getElementById("submit");
  button.disabled = false;
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    form.reset();
    document.getElementById("form-wrap").remove();
    var done = document.getElementById("success");
    done.hidden = false;
    done.focus();
  });
})();
