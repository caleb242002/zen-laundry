/* ==========================================================================
   Zen Laundry — owner dashboard
   Sales, cash variance, discounts, voids, bank payments to reconcile, red
   flags and the full activity log, plus price / staff / settings management.
   ========================================================================== */
(function () {
  "use strict";

  var $ = Ops.$, $all = Ops.$all, esc = Ops.esc, money = Ops.money;
  var admin = null;

  function start() {
    if (Ops.token()) {
      boot().catch(function () { Ops.token(null); signIn(); });
    } else {
      signIn();
    }
  }

  function signIn() {
    $("#app").hidden = true;
    Ops.signIn($("#login"), { ownerOnly: true }).then(function () { boot().catch(Ops.fail); });
  }

  function boot() {
    return Ops.api("adminData").then(function (d) {
      setAdmin(d);
      $("#app").hidden = false;
      $("#user-bar").hidden = false;
      setRange("today");
    });
  }

  function setAdmin(d) {
    admin = d;
    Ops.settings = d.settings;
    Ops.currency = d.settings.currency || Ops.currency;
    var owner = d.staff.filter(function (s) { return s.role === "owner"; })[0];
    $("#user-name").textContent = owner ? owner.name : "Owner";
    renderPrices();
    renderStaff();
    fillSettings();
  }

  function showTab(name) {
    $all(".ops-tab").forEach(function (t) { t.setAttribute("aria-selected", String(t.getAttribute("data-tab") === name)); });
    $all(".ops-panel").forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== name; });
  }

  /* ---------- Report ---------- */
  function setRange(key) {
    var from = Ops.today(), to = Ops.today();
    if (key === "yesterday") from = to = Ops.today(-1);
    if (key === "7") from = Ops.today(-6);
    if (key === "30") from = Ops.today(-29);
    if (key === "month") from = Ops.today().slice(0, 8) + "01";
    $("#r-from").value = from;
    $("#r-to").value = to;
    $all("[data-range]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-range") === key)); });
    loadReport();
  }

  function loadReport() {
    var from = $("#r-from").value, to = $("#r-to").value;
    if (!from || !to || from > to) return Ops.fail("Choose a valid date range.");
    $("#report").innerHTML = '<p class="muted">Loading…</p>';
    Ops.api("report", { from: from, to: to }).then(renderReport).catch(function (e) {
      $("#report").innerHTML = "";
      Ops.fail(e);
    });
  }

  function table(head, rows, empty) {
    if (!rows.length) return '<p class="muted">' + (empty || "Nothing in this period.") + "</p>";
    return '<div class="table-wrap"><table class="data"><thead><tr>' + head.map(function (h) {
      var num = h.charAt(0) === "#";
      return "<th" + (num ? ' class="num"' : "") + ">" + esc(num ? h.slice(1) : h) + "</th>";
    }).join("") + "</tr></thead><tbody>" + rows.map(function (r) {
      return "<tr>" + r.map(function (c, i) {
        return "<td" + (head[i].charAt(0) === "#" ? ' class="num"' : "") + ">" + c + "</td>";
      }).join("") + "</tr>";
    }).join("") + "</tbody></table></div>";
  }

  function kpi(label, value, sub, tone) {
    return '<div class="kpi' + (tone ? " kpi-" + tone : "") + '"><p class="kpi-label">' + esc(label) + '</p><p class="kpi-value">' + value + "</p>" + (sub ? '<p class="kpi-sub">' + sub + "</p>" : "") + "</div>";
  }

  function section(title, hint, body) {
    return '<section class="ops-card mt"><h2>' + esc(title) + "</h2>" + (hint ? '<p class="hint">' + hint + "</p>" : "") + '<div class="mt-sm">' + body + "</div></section>";
  }

  function varianceCell(v) {
    if (v === null) return '<span class="muted">open</span>';
    if (Math.abs(v) < 0.01) return '<span class="ok">balanced</span>';
    return '<span class="' + (v < 0 ? "bad" : "warn") + '">' + (v < 0 ? "short " : "over ") + money(Math.abs(v)) + "</span>";
  }

  function renderReport(r) {
    Ops.currency = r.currency || Ops.currency;
    var k = r.kpis;
    var html = '<div class="kpi-grid">' +
      kpi("Sales", money(k.sales), k.orders + " orders") +
      kpi("Money received", money(k.collected), "Cash " + money(k.byMethod.cash) + " · Transfer " + money(k.byMethod.transfer) + " · POS " + money(k.byMethod.pos)) +
      kpi("Drawer difference", money(k.variance), k.variance < 0 ? "Cash missing" : (k.variance > 0 ? "Cash over" : "All drawers balanced"), Math.abs(k.variance) >= 0.01 ? (k.variance < 0 ? "bad" : "warn") : "ok") +
      kpi("Discounts given", money(k.discounts), "", k.discounts ? "warn" : "") +
      kpi("Voided orders", String(k.voids), money(k.voidValue) + " value", k.voids ? "warn" : "") +
      kpi("Cash out (expenses)", money(k.expenses)) +
      kpi("Owed by customers", money(k.outstanding), "all open orders") +
      "</div>";

    html += section("Red flags", "Things worth a closer look. Not every flag means theft, but each one should have a good explanation.",
      r.flags.length ? '<ul class="flag-list">' + r.flags.map(function (f) {
        return '<li class="flag flag-' + f.level + '"><span class="flag-level">' + f.level + "</span>" + esc(f.text) + "</li>";
      }).join("") + "</ul>" : '<p class="ok">No red flags in this period.</p>');

    html += section("Cash drawer shifts", "Staff enter their cash count <strong>before</strong> seeing the expected amount, so a count can't be adjusted to match.",
      table(["Opened", "By", "Closed", "#Float", "#Expected", "#Counted", "Difference", "Notes"], r.shifts.map(function (s) {
        return [esc(Ops.when(s.openedAt)), esc(s.openedBy), s.closedAt ? esc(Ops.when(s.closedAt)) + " (" + esc(s.closedBy) + ")" : '<span class="warn">still open</span>',
          money(s.openingFloat), money(s.expectedCash), s.countedCash === null ? "—" : money(s.countedCash), varianceCell(s.variance), esc(s.notes || "")];
      })));

    html += section("Staff", "", table(["Name", "#Orders", "#Sales", "#Received", "#Discounts", "#Voids", "Drawer difference"], r.staff.map(function (s) {
      return [esc(s.name), s.orders, money(s.sales), money(s.collected), money(s.discounts), s.voids, s.shifts ? varianceCell(s.variance) : '<span class="muted">—</span>'];
    })));

    html += section("Transfers & POS to check against the bank",
      "Tick each one off against your bank or POS statement. A reference that isn't on the statement means the payment was never received by the business.",
      table(["Time", "#Order", "Method", "#Amount", "Reference", "Staff"], r.bankPayments.map(function (p) {
        return [esc(Ops.when(p.time)), "#" + p.orderNo, Ops.METHOD[p.method], money(p.amount), "<code>" + esc(p.reference) + "</code>", esc(p.staffName)];
      })));

    html += section("Discounts", "", table(["Order", "Customer", "#Subtotal", "#Discount", "Reason", "Given by", "Approved by"], r.discounts.map(function (o) {
      return ["#" + o.orderNo, esc(o.customerName), money(o.subtotal), money(o.discount), esc(o.discountReason), esc(o.staffName), esc(o.discountApprovedBy)];
    })));

    html += section("Voided orders", "", table(["Order", "Customer", "#Value", "Reason", "Staff", "Approved by"], r.voids.map(function (o) {
      return ["#" + o.orderNo, esc(o.customerName), money(o.subtotal), esc(o.voidReason), esc(o.staffName), esc(o.voidApprovedBy)];
    })));

    html += section("Customers who still owe", "All open orders with a balance, from any date.", table(["Order", "Customer", "Phone", "Status", "#Total", "#Balance", "Taken"], r.outstanding.map(function (o) {
      return ["#" + o.orderNo, esc(o.customerName), esc(o.customerPhone), Ops.statusBadge(o.status) + (o.releasedOnCreditBy ? ' <span class="muted">released by ' + esc(o.releasedOnCreditBy) + "</span>" : ""), money(o.total), money(o.balance), esc(Ops.when(o.createdAt))];
    }), "No outstanding balances."));

    html += section("Cash taken out of the drawer", "", table(["Time", "#Amount", "What for", "Staff"], r.expenses.map(function (x) {
      return [esc(Ops.when(x.time)), money(x.amount), esc(x.description), esc(x.staffName)];
    })));

    html += section("Day by day", "", table(["Day", "#Orders", "#Sales", "#Received", "#Cash"], r.days.map(function (d) {
      return [esc(Ops.day(d.day)), d.orders, money(d.sales), money(d.collected), money(d.cash)];
    })));

    html += section("Activity log", "Every sign-in, order, payment, approval and change. Staff can't edit or delete it.",
      table(["Time", "Who", "Action", "Order", "Details"], r.log.map(function (l) {
        return [esc(Ops.when(l.time)), esc(l.staffName), esc(String(l.action).replace(/_/g, " ")), l.orderNo ? "#" + esc(l.orderNo) : "", esc(l.details)];
      })));

    $("#report").innerHTML = html;
  }

  /* ---------- Prices ---------- */
  function renderPrices() {
    var cats = {};
    $("#price-rows").innerHTML = admin.prices.map(function (p) {
      cats[p.category] = true;
      return "<tr><td>" + esc(p.item) + "</td><td>" + esc(p.category) + '</td><td class="num">' + money(p.price) + "</td><td>" +
        (p.active ? '<span class="ok">On sale</span>' : '<span class="muted">Hidden</span>') +
        '</td><td><button class="btn btn-secondary btn-sm" type="button" data-edit-price="' + esc(p.id) + '">Edit</button></td></tr>';
    }).join("") || '<tr><td colspan="5" class="muted">No items yet. Add your first price above.</td></tr>';
    $("#cat-list").innerHTML = Object.keys(cats).map(function (c) { return '<option value="' + esc(c) + '">'; }).join("");
  }

  function editPrice(id) {
    var p = admin.prices.filter(function (x) { return String(x.id) === String(id); })[0];
    var f = $("#price-form");
    f.elements.id.value = p.id;
    f.elements.itemName.value = p.item;
    f.elements.category.value = p.category;
    f.elements.price.value = p.price;
    f.elements.active.checked = p.active;
    f.elements.itemName.focus();
  }

  /* ---------- Staff ---------- */
  function renderStaff() {
    $("#staff-rows").innerHTML = admin.staff.map(function (s) {
      return "<tr><td>" + esc(s.name) + "</td><td>" + esc(s.role) + "</td><td>" + (s.active ? '<span class="ok">Active</span>' : '<span class="muted">Deactivated</span>') +
        '</td><td><button class="btn btn-secondary btn-sm" type="button" data-edit-staff="' + esc(s.id) + '">Edit</button></td></tr>';
    }).join("");
  }

  function editStaff(id) {
    var s = admin.staff.filter(function (x) { return String(x.id) === String(id); })[0];
    var f = $("#staff-form");
    f.elements.id.value = s.id;
    f.elements.name.value = s.name;
    f.elements.role.value = s.role;
    f.elements.pin.value = "";
    f.elements.active.checked = s.active;
    $("#s-pin-hint").textContent = "(leave empty to keep current PIN)";
    f.elements.name.focus();
  }

  /* ---------- Settings ---------- */
  function fillSettings() {
    var f = $("#settings-form");
    Object.keys(admin.settings).forEach(function (k) { if (f.elements[k]) f.elements[k].value = admin.settings[k]; });
  }

  /* ---------- Events ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    $("#logout").addEventListener("click", function () {
      Ops.api("logout").catch(function () {}).then(function () { Ops.token(null); location.reload(); });
    });
    $all(".ops-tab").forEach(function (t) { t.addEventListener("click", function () { showTab(t.getAttribute("data-tab")); }); });
    $all("[data-range]").forEach(function (b) { b.addEventListener("click", function () { setRange(b.getAttribute("data-range")); }); });
    $("#range-form").addEventListener("submit", function (e) {
      e.preventDefault();
      $all("[data-range]").forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
      loadReport();
    });

    $("#price-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = e.target;
      var price = { id: f.elements.id.value, item: f.elements.itemName.value, category: f.elements.category.value, price: f.elements.price.value, active: f.elements.active.checked };
      Ops.busy(f.querySelector('button[type="submit"]'), Ops.api("savePrice", { price: price }))
        .then(function (d) { setAdmin(d); f.reset(); f.elements.id.value = ""; Ops.toast("Price saved.", "ok"); })
        .catch(Ops.fail);
    });
    $("#price-form").addEventListener("reset", function (e) { setTimeout(function () { e.target.elements.id.value = ""; }); });
    $("#price-rows").addEventListener("click", function (e) {
      var b = e.target.closest("[data-edit-price]");
      if (b) editPrice(b.getAttribute("data-edit-price"));
    });

    $("#staff-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = e.target;
      var staff = { id: f.elements.id.value, name: f.elements.name.value, role: f.elements.role.value, pin: f.elements.pin.value, active: f.elements.active.checked };
      Ops.busy(f.querySelector('button[type="submit"]'), Ops.api("saveStaff", { staff: staff }))
        .then(function (d) { setAdmin(d); f.reset(); Ops.toast("Staff saved.", "ok"); })
        .catch(Ops.fail);
    });
    $("#staff-form").addEventListener("reset", function (e) {
      setTimeout(function () { e.target.elements.id.value = ""; $("#s-pin-hint").textContent = "(4–8 digits)"; });
    });
    $("#staff-rows").addEventListener("click", function (e) {
      var b = e.target.closest("[data-edit-staff]");
      if (b) editStaff(b.getAttribute("data-edit-staff"));
    });

    $("#settings-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = e.target, s = {};
      Object.keys(admin.settings).forEach(function (k) { if (f.elements[k]) s[k] = f.elements[k].value; });
      Ops.busy(f.querySelector("button"), Ops.api("saveSettings", { settings: s }))
        .then(function (d) { setAdmin(d); Ops.toast("Settings saved.", "ok"); })
        .catch(Ops.fail);
    });

    start();
  });
})();
