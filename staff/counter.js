/* ==========================================================================
   Zen Laundry — staff counter app
   Every order gets a server-issued ticket number; prices come from the
   owner's list; sensitive actions need a manager PIN. See backend/Code.gs.
   ========================================================================== */
(function () {
  "use strict";

  var $ = Ops.$, $all = Ops.$all, esc = Ops.esc, money = Ops.money;
  var IDLE_MINUTES = 10;
  var state = { user: null, prices: [], approvers: [], shift: null, cart: {}, current: null };

  /* ---------- Start-up ---------- */
  function start() {
    if (Ops.token()) {
      boot().catch(function () { Ops.token(null); signIn(); });
    } else {
      signIn();
    }
  }

  function signIn() {
    $("#app").hidden = true;
    $("#open-drawer").hidden = true;
    $("#user-bar").hidden = true;
    Ops.signIn($("#login")).then(function () { boot().catch(Ops.fail); });
  }

  function boot() {
    return Ops.api("bootstrap").then(function (d) {
      state.user = d.user;
      state.prices = d.prices;
      state.approvers = d.approvers;
      state.shift = d.shift;
      Ops.settings = d.settings;
      Ops.currency = d.settings.currency || Ops.currency;
      $("#user-name").textContent = d.user.name;
      $("#user-bar").hidden = false;
      renderPrices();
      renderCart();
      showForShift();
      watchIdle();
    });
  }

  function showForShift() {
    var open = !!state.shift;
    $("#open-drawer").hidden = open;
    $("#app").hidden = !open;
    var pill = $("#drawer-pill");
    pill.textContent = open ? "Drawer open" : "Drawer closed";
    pill.className = "pill " + (open ? "pill-ok" : "pill-warn");
    if (open) {
      $("#shift-info").textContent = "Opened by " + state.shift.openedBy + " at " + Ops.when(state.shift.openedAt) +
        " with a float of " + money(state.shift.openingFloat) + ".";
      renderExpenses();
    } else {
      $("#opening-float").focus();
    }
  }

  /* Sign out after inactivity so nobody records under someone else's name. */
  var idleTimer;
  function watchIdle() {
    function reset() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { logout("Signed out after " + IDLE_MINUTES + " minutes of inactivity."); }, IDLE_MINUTES * 60000);
    }
    ["click", "keydown", "touchstart"].forEach(function (ev) { document.addEventListener(ev, reset, { passive: true }); });
    reset();
  }

  function logout(message) {
    Ops.api("logout").catch(function () {}).then(function () {
      Ops.token(null);
      if (message) try { sessionStorage.setItem("zen-ops-msg", message); } catch (e) { /* ignore */ }
      location.reload();
    });
  }

  /* ---------- Tabs ---------- */
  function showTab(name) {
    $all(".ops-tab").forEach(function (t) { t.setAttribute("aria-selected", String(t.getAttribute("data-tab") === name)); });
    $all(".ops-panel").forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== name; });
    if (name === "orders") $("#search-form").elements.query.focus();
  }

  /* ---------- Price list & cart ---------- */
  function renderPrices() {
    var filter = $("#item-filter").value.trim().toLowerCase();
    var groups = {};
    state.prices.forEach(function (p) {
      if (filter && p.item.toLowerCase().indexOf(filter) < 0 && String(p.category).toLowerCase().indexOf(filter) < 0) return;
      (groups[p.category || "General"] = groups[p.category || "General"] || []).push(p);
    });
    var html = Object.keys(groups).map(function (cat) {
      return '<h3 class="cat">' + esc(cat) + "</h3>" + groups[cat].map(function (p) {
        var q = state.cart[p.id] || 0;
        return '<div class="price-row' + (q ? " has-qty" : "") + '">' +
          '<span class="pr-name">' + esc(p.item) + '<small>' + money(p.price) + "</small></span>" +
          '<span class="stepper">' +
          '<button type="button" data-dec="' + esc(p.id) + '" aria-label="Remove one ' + esc(p.item) + '"' + (q ? "" : " disabled") + ">−</button>" +
          '<output aria-live="polite">' + q + "</output>" +
          '<button type="button" data-inc="' + esc(p.id) + '" aria-label="Add one ' + esc(p.item) + '">+</button>' +
          "</span></div>";
      }).join("");
    }).join("");
    $("#price-list").innerHTML = html || '<p class="muted">' + (state.prices.length ? "No items match." : "The owner hasn't added any prices yet.") + "</p>";
  }

  function totals() {
    var subtotal = 0, count = 0;
    state.prices.forEach(function (p) {
      var q = state.cart[p.id] || 0;
      subtotal += p.price * q;
      count += q;
    });
    var discount = Math.min(Math.max(Number($("#discount").value) || 0, 0), subtotal);
    return { subtotal: subtotal, count: count, discount: discount, total: subtotal - discount };
  }

  function renderCart() {
    var lines = state.prices.filter(function (p) { return state.cart[p.id]; }).map(function (p) {
      return "<li><span>" + state.cart[p.id] + " × " + esc(p.item) + "</span><span>" + money(p.price * state.cart[p.id]) + "</span></li>";
    });
    $("#cart").innerHTML = lines.join("") || '<li class="muted">No items yet.</li>';
    var t = totals();
    $("#t-count").textContent = t.count;
    $("#t-subtotal").textContent = money(t.subtotal);
    $("#t-discount").textContent = "−" + money(t.discount);
    $("#t-discount-row").hidden = !t.discount;
    $("#t-total").textContent = money(t.total);
    var amount = $("#pay-amount");
    if (!amount.dataset.touched) amount.value = t.total || "";
  }

  function updatePayFields() {
    var method = $("#order-form").elements.method.value;
    $("#pay-fields").hidden = method === "later";
    $("#ref-field").hidden = method === "cash" || method === "later";
    $("#transfer-hint").hidden = method !== "transfer";
  }

  function resetOrder() {
    state.cart = {};
    $("#order-form").reset();
    delete $("#pay-amount").dataset.touched;
    $(".disc").open = false;
    $("#item-filter").value = "";
    updatePayFields();
    renderPrices();
    renderCart();
    $("#order-done").hidden = true;
    $("#order-form").hidden = false;
    $("#c-name").focus();
  }

  function submitOrder(e) {
    e.preventDefault();
    var f = e.target, t = totals();
    var method = f.elements.method.value;
    var payload = {
      customerName: f.elements.customerName.value,
      customerPhone: f.elements.customerPhone.value,
      items: Object.keys(state.cart).filter(function (id) { return state.cart[id] > 0; }).map(function (id) { return { id: id, qty: state.cart[id] }; }),
      discount: t.discount,
      discountReason: f.elements.discountReason.value,
      dueDate: f.elements.dueDate.value,
      notes: f.elements.notes.value,
      payment: method === "later" ? null : { method: method, amount: Number(f.elements.amount.value) || 0, reference: f.elements.reference.value }
    };
    if (!payload.items.length) return Ops.fail("Add at least one item.");
    if (payload.payment && payload.payment.amount > t.total) return Ops.fail("Amount received is more than the total.");

    var approval = t.discount > 0
      ? Ops.approve(state.approvers, "A discount of " + money(t.discount))
      : Promise.resolve({});
    approval.then(function (a) {
      if (!a) return;
      Object.assign(payload, a);
      return Ops.busy(f.querySelector('button[type="submit"]'), Ops.api("createOrder", payload)).then(orderSaved);
    }).catch(Ops.fail);
  }

  function orderSaved(o) {
    state.current = o;
    $("#order-form").hidden = true;
    $("#order-done").hidden = false;
    $("#done-no").textContent = "#" + o.orderNo;
    $("#done-tag").textContent = "#" + o.orderNo;
    $("#done-summary").textContent = o.customerName + " · " + o.itemCount + " items · Total " + money(o.total) +
      " · Paid " + money(o.paid) + (o.balance ? " · Balance " + money(o.balance) : "");
    $("#done-wa").href = Ops.waLink(o.customerPhone, Ops.receiptText(o));
    window.scrollTo(0, 0);
  }

  /* ---------- Find / collect ---------- */
  function search(e) {
    if (e) e.preventDefault();
    var q = $("#search-form").elements.query.value;
    Ops.busy($("#search-form button"), Ops.api("findOrders", { query: q })).then(function (list) {
      $("#order-detail").hidden = true;
      $("#results").innerHTML = list.length ? '<ul class="result-list">' + list.map(function (o) {
        return '<li><button type="button" data-open="' + o.orderNo + '">' +
          '<strong>#' + o.orderNo + "</strong> " + esc(o.customerName) +
          '<span class="muted"> · ' + o.itemCount + " items · " + esc(Ops.when(o.createdAt)) + "</span>" +
          '<span class="r-right">' + (o.balance > 0 ? '<span class="owe">' + money(o.balance) + " due</span>" : "") + Ops.statusBadge(o.status) + "</span>" +
          "</button></li>";
      }).join("") + "</ul>" : '<p class="muted mt">No orders found.</p>';
    }).catch(Ops.fail);
  }

  function openOrder(no) {
    return Ops.api("getOrder", { orderNo: no }).then(renderDetail).catch(Ops.fail);
  }

  function renderDetail(o) {
    state.current = o;
    var box = $("#order-detail");
    var active = o.status === "received" || o.status === "ready";
    box.innerHTML =
      '<div class="detail-head"><h2>Order #' + o.orderNo + "</h2>" + Ops.statusBadge(o.status) + "</div>" +
      '<p class="muted">' + esc(o.customerName) + " · " + esc(o.customerPhone) + " · taken by " + esc(o.staffName) + " on " + esc(Ops.when(o.createdAt)) +
      (o.dueDate ? " · ready by " + esc(Ops.day(o.dueDate)) : "") + "</p>" +
      (o.notes ? '<p class="note-box">' + esc(o.notes) + "</p>" : "") +
      '<ul class="cart">' + o.items.map(function (i) { return "<li><span>" + i.qty + " × " + esc(i.item) + "</span><span>" + money(i.qty * i.price) + "</span></li>"; }).join("") + "</ul>" +
      '<dl class="totals"><div><dt>Items</dt><dd>' + o.itemCount + "</dd></div>" +
      (o.discount ? "<div><dt>Discount (" + esc(o.discountReason) + ", approved by " + esc(o.discountApprovedBy) + ")</dt><dd>−" + money(o.discount) + "</dd></div>" : "") +
      '<div><dt>Total</dt><dd>' + money(o.total) + "</dd></div><div><dt>Paid</dt><dd>" + money(o.paid) + '</dd></div><div class="grand"><dt>Balance</dt><dd>' + money(o.balance) + "</dd></div></dl>" +
      (o.payments.length ? '<h3 class="mt">Payments</h3><ul class="simple-list">' + o.payments.map(function (p) {
        return "<li>" + esc(Ops.when(p.time)) + " · " + Ops.METHOD[p.method] + " " + money(p.amount) + (p.reference ? " · ref " + esc(p.reference) : "") + " · " + esc(p.staffName) + "</li>";
      }).join("") + "</ul>" : "") +
      (o.status === "collected" ? '<p class="mt">Collected ' + esc(Ops.when(o.collectedAt)) + " by " + esc(o.collectedBy) + (o.releasedOnCreditBy ? " (released unpaid, approved by " + esc(o.releasedOnCreditBy) + ")" : "") + ".</p>" : "") +
      (o.status === "void" ? '<p class="mt">Voided: ' + esc(o.voidReason) + " (approved by " + esc(o.voidApprovedBy) + ").</p>" : "") +
      (active && o.balance > 0 ?
        '<form id="pay-form" class="pay-box mt" novalidate><h3>Take payment</h3><div class="form-grid two">' +
        '<div class="field"><label class="field-label" for="pp-method">Method</label><select class="select" id="pp-method" name="method"><option value="cash">Cash</option><option value="transfer">Transfer</option><option value="pos">POS</option></select></div>' +
        '<div class="field"><label class="field-label" for="pp-amount">Amount</label><input class="input" id="pp-amount" name="amount" type="number" min="0" step="any" inputmode="decimal" value="' + o.balance + '"></div>' +
        '<div class="field" id="pp-ref-wrap" hidden><label class="field-label" for="pp-ref">Reference</label><input class="input" id="pp-ref" name="reference" autocomplete="off"></div>' +
        '</div><button class="btn btn-primary mt" type="submit">Record payment</button></form>' : "") +
      '<div class="btn-row mt">' +
      (o.status === "received" ? '<button class="btn btn-secondary" type="button" data-act="ready">Mark ready</button>' : "") +
      (o.status === "ready" ? '<a class="btn btn-secondary" target="_blank" rel="noopener" href="' + esc(Ops.waLink(o.customerPhone, Ops.readyText(o))) + '">Tell customer it\'s ready</a>' : "") +
      (active ? '<button class="btn btn-primary" type="button" data-act="collect">Hand over to customer</button>' : "") +
      '<a class="btn btn-secondary" target="_blank" rel="noopener" href="' + esc(Ops.waLink(o.customerPhone, Ops.receiptText(o))) + '">WhatsApp receipt</a>' +
      '<button class="btn btn-secondary" type="button" data-act="print">Print receipt</button>' +
      (active && o.paid === 0 ? '<button class="btn btn-danger" type="button" data-act="void">Void order</button>' : "") +
      "</div>";
    box.hidden = false;
    box.scrollIntoView({ behavior: "smooth", block: "start" });

    var pf = $("#pay-form");
    if (pf) {
      pf.elements.method.addEventListener("change", function () { $("#pp-ref-wrap").hidden = pf.elements.method.value === "cash"; });
      pf.addEventListener("submit", function (e) {
        e.preventDefault();
        var pay = { method: pf.elements.method.value, amount: Number(pf.elements.amount.value) || 0, reference: pf.elements.reference.value };
        Ops.busy(pf.querySelector("button"), Ops.api("addPayment", { orderNo: o.orderNo, payment: pay }))
          .then(function (u) { Ops.toast("Payment of " + money(pay.amount) + " recorded.", "ok"); renderDetail(u); })
          .catch(Ops.fail);
      });
    }
  }

  function detailAction(act, btn) {
    var o = state.current;
    if (act === "print") return Ops.printReceipt(o);
    if (act === "ready") {
      return Ops.busy(btn, Ops.api("markReady", { orderNo: o.orderNo })).then(renderDetail).catch(Ops.fail);
    }
    if (act === "collect") {
      if (!confirm("Count the items with the customer: " + o.itemCount + " items tagged #" + o.orderNo + ". Hand over now?")) return;
      var approval = o.balance > 0
        ? Ops.approve(state.approvers, "Releasing laundry with " + money(o.balance) + " unpaid")
        : Promise.resolve({});
      return approval.then(function (a) {
        if (!a) return;
        return Ops.busy(btn, Ops.api("collect", Object.assign({ orderNo: o.orderNo }, a))).then(function (u) {
          Ops.toast("Order #" + u.orderNo + " handed over.", "ok");
          renderDetail(u);
        });
      }).catch(Ops.fail);
    }
    if (act === "void") {
      var reason = prompt("Why is order #" + o.orderNo + " being voided?");
      if (!reason) return;
      return Ops.approve(state.approvers, "Voiding order #" + o.orderNo).then(function (a) {
        if (!a) return;
        return Ops.busy(btn, Ops.api("voidOrder", Object.assign({ orderNo: o.orderNo, reason: reason }, a))).then(renderDetail);
      }).catch(Ops.fail);
    }
  }

  /* ---------- Drawer ---------- */
  function renderExpenses() {
    var list = state.shift.expenses || [];
    $("#expense-list").innerHTML = list.length ? list.map(function (x) {
      return "<li>" + esc(Ops.when(x.time)) + " · " + money(x.amount) + " · " + esc(x.description) + " · " + esc(x.staffName) + "</li>";
    }).join("") : '<li class="muted">Nothing taken out this shift.</li>';
  }

  function addExpense(e) {
    e.preventDefault();
    var f = e.target;
    Ops.busy(f.querySelector("button"), Ops.api("addExpense", { amount: Number(f.elements.amount.value) || 0, description: f.elements.description.value }))
      .then(function (shift) { state.shift = shift; f.reset(); renderExpenses(); Ops.toast("Cash out recorded.", "ok"); })
      .catch(Ops.fail);
  }

  function closeDrawer(e) {
    e.preventDefault();
    var f = e.target;
    if (f.elements.countedCash.value === "") return Ops.fail("Enter the cash you counted.");
    if (!confirm("Submit " + money(f.elements.countedCash.value) + " as the cash counted? This can't be changed.")) return;
    Ops.busy(f.querySelector("button"), Ops.api("closeShift", { countedCash: f.elements.countedCash.value, notes: f.elements.notes.value }))
      .then(function (r) {
        f.hidden = true;
        var v = r.variance;
        var box = $("#close-result");
        box.className = "form-status mt " + (Math.abs(v) < 0.01 ? "is-success" : "is-error");
        box.innerHTML = "<div><strong>Drawer closed.</strong>" +
          "<p>Opening float " + money(r.breakdown.float) + " + cash taken " + money(r.breakdown.cashIn) + " − cash out " + money(r.breakdown.cashOut) +
          " = expected <strong>" + money(r.expectedCash) + "</strong>.</p>" +
          "<p>Counted " + money(r.countedCash) + ". " + (Math.abs(v) < 0.01 ? "The drawer balances." : (v < 0 ? "Short by " : "Over by ") + money(Math.abs(v)) + ". The owner has been notified.") + "</p>" +
          '<button class="btn btn-secondary btn-sm" type="button" id="after-close">Sign out</button></div>';
        box.hidden = false;
        $("#after-close").addEventListener("click", function () { logout(); });
        state.shift = null;
        $("#drawer-pill").textContent = "Drawer closed";
        $("#drawer-pill").className = "pill pill-warn";
      })
      .catch(Ops.fail);
  }

  /* ---------- Events ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    try {
      var m = sessionStorage.getItem("zen-ops-msg");
      if (m) { sessionStorage.removeItem("zen-ops-msg"); Ops.toast(m); }
    } catch (e) { /* ignore */ }

    Ops.onExpired = function () { Ops.toast("Your session ended. Please sign in again.", "error"); setTimeout(function () { location.reload(); }, 1500); };

    $("#logout").addEventListener("click", function () { logout(); });
    $all(".ops-tab").forEach(function (t) { t.addEventListener("click", function () { showTab(t.getAttribute("data-tab")); }); });

    $("#open-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var v = e.target.elements.openingFloat.value;
      if (v === "") return Ops.fail("Enter the cash in the drawer, even if it's 0.");
      Ops.busy(e.target.querySelector("button"), Ops.api("openShift", { openingFloat: v }))
        .then(function (shift) { state.shift = shift; showForShift(); Ops.toast("Drawer opened.", "ok"); })
        .catch(Ops.fail);
    });

    $("#item-filter").addEventListener("input", renderPrices);
    $("#price-list").addEventListener("click", function (e) {
      var inc = e.target.closest("[data-inc]"), dec = e.target.closest("[data-dec]");
      if (inc) state.cart[inc.getAttribute("data-inc")] = (state.cart[inc.getAttribute("data-inc")] || 0) + 1;
      else if (dec) state.cart[dec.getAttribute("data-dec")] = Math.max(0, (state.cart[dec.getAttribute("data-dec")] || 0) - 1);
      else return;
      renderPrices();
      renderCart();
    });
    $("#discount").addEventListener("input", renderCart);
    $("#pay-amount").addEventListener("input", function () { this.dataset.touched = "1"; });
    $all('#order-form input[name="method"]').forEach(function (r) { r.addEventListener("change", updatePayFields); });
    $("#order-form").addEventListener("submit", submitOrder);
    $("#done-new").addEventListener("click", resetOrder);
    $("#done-print").addEventListener("click", function () { Ops.printReceipt(state.current); });

    $("#search-form").addEventListener("submit", search);
    $("#results").addEventListener("click", function (e) {
      var b = e.target.closest("[data-open]");
      if (b) openOrder(b.getAttribute("data-open"));
    });
    $("#order-detail").addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]");
      if (b) detailAction(b.getAttribute("data-act"), b);
    });

    $("#expense-form").addEventListener("submit", addExpense);
    $("#close-form").addEventListener("submit", closeDrawer);

    updatePayFields();
    start();
  });
})();
