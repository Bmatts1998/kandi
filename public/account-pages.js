(function () {
  "use strict";
  var page = document.getElementById("page");
  if (!page) return;
  var params = new URLSearchParams(location.search);
  var token = params.get("token") || "";
  // Keep the token out of history/screenshots once we've read it.
  try { history.replaceState({}, "", location.pathname); } catch (_) {}

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function post(url, body) {
    return fetch(url, { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, data: d }; }); });
  }
  function done(title, text, cls) {
    page.innerHTML = '<h1>' + esc(title) + '</h1><p class="' + (cls || "") + '">' + esc(text) + '</p><a class="btn" href="/">Open Kandi</a>';
  }

  if (page.getAttribute("data-page") === "verify") {
    if (!token) { done("Link missing", "That confirmation link looks incomplete. Open the latest email from Kandi and tap the button again.", "err"); return; }
    post("/api/email/verify", { token: token }).then(function (res) {
      if (res.ok) {
        done("You're confirmed! ✨", "Your email is verified" + (res.data.username ? " for @" + res.data.username : "") + ". Head back to Kandi — if the app is already open, tap “I confirmed it” to jump in.", "ok");
      } else {
        done("Couldn't confirm", res.data.error || "That link didn't work. Open Kandi and tap Resend.", "err");
      }
    }).catch(function () { done("Can't reach Kandi", "Check your connection and open the link again.", "err"); });
    return;
  }

  if (page.getAttribute("data-page") === "reset") {
    var form = document.getElementById("reset-form");
    var msg = document.getElementById("msg");
    var btn = document.getElementById("go");
    if (!token) { done("Link missing", "That reset link looks incomplete. Ask for a new one from the Kandi login screen.", "err"); return; }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var a = document.getElementById("pw1").value;
      var b = document.getElementById("pw2").value;
      msg.textContent = "";
      if (a.length < 8) { msg.textContent = "Password must be at least 8 characters."; return; }
      if (a !== b) { msg.textContent = "Those passwords don't match."; return; }
      btn.disabled = true;
      post("/api/password/reset", { token: token, password: a }).then(function (res) {
        if (res.ok) done("Password updated", "You can log in" + (res.data.username ? " as @" + res.data.username : "") + " with your new password.", "ok");
        else { btn.disabled = false; msg.textContent = res.data.error || "That didn't work. Try again."; }
      }).catch(function () { btn.disabled = false; msg.textContent = "Can't reach Kandi. Check your connection."; });
    });
  }
})();
