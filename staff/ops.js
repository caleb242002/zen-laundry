/* ==========================================================================
   Zen Laundry — shared helpers for the staff counter app and owner dashboard
   Built by KINGSTECH. Talks to the Google Apps Script backend (backend/Code.gs).
   ========================================================================== */
(function () {
  "use strict";

  var CONFIG = window.SITE_CONFIG || {};
  var Ops = { currency: "₦", settings: {} };

  /* ---------- DOM ---------- */
  Ops.$ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  Ops.$all = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };
  Ops.esc = function (s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  /* ---------- Formatting ---------- */
  Ops.money = function (n) {
    var v = Number(n) || 0;
    return (v < 0 ? "−" : "") + Ops.currency + Math.abs(v).toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  };
  Ops.when = function (iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " +
      d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true });
  };
  Ops.day = function (s) {
    if (!s) return "";
    var d = new Date(s.length === 10 ? s + "T12:00:00" : s);
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  };
  Ops.today = function (offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + (offsetDays || 0));
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  };
  Ops.STATUS = { received: "Received", ready: "Ready", collected: "Collected", "void": "Voided" };
  Ops.METHOD = { cash: "Cash", transfer: "Transfer", pos: "POS" };
  Ops.statusBadge = function (s) { return '<span class="badge badge-' + Ops.esc(s) + '">' + Ops.esc(Ops.STATUS[s] || s) + "</span>"; };

  /* ---------- Session ---------- */
  var TOKEN_KEY = "zen-ops-token";
  Ops.token = function (v) {
    try {
      if (v === undefined) return sessionStorage.getItem(TOKEN_KEY);
      if (v === null) sessionStorage.removeItem(TOKEN_KEY); else sessionStorage.setItem(TOKEN_KEY, v);
    } catch (e) { /* storage unavailable: session lasts until reload */ }
    return v;
  };
  Ops.onExpired = function () { location.reload(); };

  /* ---------- API ---------- */
  Ops.configured = function () { return !!CONFIG.ordersApi; };
  Ops.api = function (action, payload) {
    if (!CONFIG.ordersApi) return Promise.reject(new Error("The orders system isn't connected yet. Set ordersApi in assets/js/config.js."));
    var body = Object.assign({ action: action, token: Ops.token() }, payload || {});
    /* text/plain avoids a CORS preflight, which Apps Script doesn't answer */
    return fetch(CONFIG.ordersApi, { method: "POST", body: JSON.stringify(body), redirect: "follow" })
      .then(function (r) { return r.json(); }, function () { throw new Error("No connection. Check the internet and try again."); })
      .then(function (res) {
        if (res.ok) return res.data;
        if (res.error === "SESSION_EXPIRED") {
          Ops.token(null);
          Ops.onExpired();
          throw new Error("Your session ended. Please sign in again.");
        }
        throw new Error(res.error || "Something went wrong.");
      });
  };

  /* Disable a button while a request runs so taps can't double-submit. */
  Ops.busy = function (btn, promise) {
    if (!btn) return promise;
    var label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner-dark" aria-hidden="true"></span> Working…';
    function done() { btn.disabled = false; btn.innerHTML = label; }
    return promise.then(function (v) { done(); return v; }, function (e) { done(); throw e; });
  };

  /* ---------- Toast ---------- */
  Ops.toast = function (msg, type) {
    var box = Ops.$(".toast-stack") || document.body.appendChild(Object.assign(document.createElement("div"), { className: "toast-stack" }));
    box.setAttribute("role", "status");
    var t = document.createElement("div");
    t.className = "toast" + (type ? " toast-" + type : "");
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, type === "error" ? 6000 : 3500);
  };
  Ops.fail = function (err) { Ops.toast(err && err.message ? err.message : String(err), "error"); };

  /* ---------- Sign in ---------- */
  Ops.signIn = function (root, opts) {
    opts = opts || {};
    root.hidden = false;
    var form = Ops.$("form", root);
    var select = form.elements.staffId;
    var msg = Ops.$(".login-msg", root);
    if (!Ops.configured()) {
      msg.textContent = "The orders system isn't connected yet. Set ordersApi in assets/js/config.js (see README).";
      msg.hidden = false;
      form.querySelector("button").disabled = true;
      return new Promise(function () {});
    }
    Ops.api("staffList").then(function (list) {
      if (opts.ownerOnly) list = list.filter(function (s) { return s.role === "owner"; });
      select.innerHTML = '<option value="">Select your name</option>' + list.map(function (s) {
        return '<option value="' + Ops.esc(s.id) + '">' + Ops.esc(s.name) + "</option>";
      }).join("");
      if (list.length === 1) select.value = list[0].id;
      (select.value ? form.elements.pin : select).focus();
    }).catch(function (e) { msg.textContent = e.message; msg.hidden = false; });

    return new Promise(function (resolve) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        msg.hidden = true;
        if (!select.value || !form.elements.pin.value) { msg.textContent = "Choose your name and enter your PIN."; msg.hidden = false; return; }
        Ops.busy(form.querySelector("button"), Ops.api("login", { staffId: select.value, pin: form.elements.pin.value, ownerOnly: !!opts.ownerOnly }))
          .then(function (res) {
            form.reset();
            Ops.token(res.token);
            root.hidden = true;
            resolve(res.user);
          })
          .catch(function (err) { form.elements.pin.value = ""; msg.textContent = err.message; msg.hidden = false; form.elements.pin.focus(); });
      });
    });
  };

  /* ---------- Manager / owner approval ---------- */
  /* Resolves with { approverId, approverPin } or null if cancelled. */
  Ops.approve = function (approvers, what) {
    var dlg = Ops.$("#approve-dialog");
    var form = Ops.$("form", dlg);
    Ops.$("[data-approve-what]", dlg).textContent = what;
    form.elements.approverId.innerHTML = approvers.map(function (a) {
      return '<option value="' + Ops.esc(a.id) + '">' + Ops.esc(a.name) + "</option>";
    }).join("");
    form.elements.approverPin.value = "";
    dlg.showModal();
    form.elements.approverPin.focus();
    return new Promise(function (resolve) {
      function finish(val) {
        form.removeEventListener("submit", onSubmit);
        dlg.removeEventListener("close", onClose);
        if (dlg.open) dlg.close();
        resolve(val);
      }
      function onSubmit(e) {
        e.preventDefault();
        if (!form.elements.approverPin.value) return;
        finish({ approverId: form.elements.approverId.value, approverPin: form.elements.approverPin.value });
      }
      function onClose() { finish(null); }
      form.addEventListener("submit", onSubmit);
      dlg.addEventListener("close", onClose);
    });
  };

  /* ---------- Customer receipts ---------- */
  Ops.trackUrl = function (orderNo) {
    var base = CONFIG.siteUrl || (location.origin + location.pathname.replace(/\/staff\/.*$/, ""));
    return base.replace(/\/$/, "") + "/track.html?order=" + orderNo;
  };

  Ops.waLink = function (phone, text) {
    var d = String(phone || "").replace(/\D/g, "");
    var cc = String(Ops.settings.countryCode || "234");
    if (d.charAt(0) === "0") d = cc + d.slice(1);
    return "https://wa.me/" + d + "?text=" + encodeURIComponent(text);
  };

  Ops.receiptText = function (o) {
    var s = Ops.settings;
    var lines = [
      (s.businessName || "Zen Laundry") + " — Receipt",
      "Order #" + o.orderNo + " · " + Ops.when(o.createdAt),
      "Customer: " + o.customerName,
      ""
    ];
    o.items.forEach(function (i) { lines.push(i.qty + " × " + i.item + " — " + Ops.money(i.price * i.qty)); });
    lines.push("");
    lines.push("Items: " + o.itemCount);
    if (o.discount) lines.push("Discount: −" + Ops.money(o.discount));
    lines.push("Total: " + Ops.money(o.total));
    lines.push("Paid: " + Ops.money(o.paid));
    lines.push("Balance: " + Ops.money(o.balance));
    if (o.dueDate) lines.push("Ready by: " + Ops.day(o.dueDate));
    lines.push("");
    lines.push("Check your order any time: " + Ops.trackUrl(o.orderNo));
    if (s.paymentNotice) lines.push(s.paymentNotice);
    return lines.join("\n");
  };

  Ops.readyText = function (o) {
    return "Hello " + o.customerName + ", your laundry (order #" + o.orderNo + ", " + o.itemCount + " items) is ready for collection at " +
      (Ops.settings.businessName || "Zen Laundry") + "." + (o.balance > 0 ? " Balance to pay: " + Ops.money(o.balance) + "." : "") +
      "\nOrder details: " + Ops.trackUrl(o.orderNo);
  };

  /* Fill the printable receipt (#print-receipt) and print it. */
  Ops.printReceipt = function (o) {
    var s = Ops.settings;
    var box = Ops.$("#print-receipt");
    box.innerHTML =
      "<h2>" + Ops.esc(s.businessName || "Zen Laundry") + "</h2>" +
      '<p class="r-big">ORDER #' + o.orderNo + "</p>" +
      "<p>" + Ops.esc(Ops.when(o.createdAt)) + "<br>Served by " + Ops.esc(o.staffName) + "<br>Customer: " + Ops.esc(o.customerName) + "</p>" +
      "<table>" + o.items.map(function (i) {
        return "<tr><td>" + i.qty + " × " + Ops.esc(i.item) + "</td><td>" + Ops.money(i.price * i.qty) + "</td></tr>";
      }).join("") +
      (o.discount ? "<tr><td>Discount</td><td>−" + Ops.money(o.discount) + "</td></tr>" : "") +
      '<tr class="r-total"><td>TOTAL</td><td>' + Ops.money(o.total) + "</td></tr>" +
      "<tr><td>Paid</td><td>" + Ops.money(o.paid) + "</td></tr>" +
      "<tr><td>Balance</td><td>" + Ops.money(o.balance) + "</td></tr></table>" +
      "<p>Items: " + o.itemCount + (o.dueDate ? "<br>Ready by: " + Ops.esc(Ops.day(o.dueDate)) : "") + "</p>" +
      "<p>Track your order:<br>" + Ops.esc(Ops.trackUrl(o.orderNo)) + "</p>" +
      (s.paymentNotice ? "<p><strong>" + Ops.esc(s.paymentNotice) + "</strong></p>" : "") +
      (s.receiptFooter ? "<p>" + Ops.esc(s.receiptFooter) + "</p>" : "");
    window.print();
  };

  window.Ops = Ops;
})();
