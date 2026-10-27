/* ==========================================================================
   Zen Laundry — Orders & Cash Control backend (Google Apps Script)
   Built by KINGSTECH.
   --------------------------------------------------------------------------
   The Google Sheet this script is attached to is the owner's private ledger.
   Staff NEVER get access to the sheet; they only use the counter app, which
   can add records but can never edit prices, delete orders or rewrite history.

   Controls enforced here (not in the browser, so they can't be bypassed):
   - Order numbers are issued by the server, in sequence, with no gaps.
   - Prices come from the owner's price list; staff can't type a price.
   - Orders and payments can't be deleted. Voids need a manager/owner PIN.
   - Discounts and releasing unpaid laundry need a manager/owner PIN, and the
     approver can't be the person asking (unless they are the owner).
   - Every payment belongs to an open drawer shift. Shifts close with a BLIND
     cash count: staff enter what they counted before seeing what was expected.
   - Transfer/POS payments require a reference so they can be matched to the bank.
   - Every action is written to an append-only Log sheet.

   Setup: see README.md, section "Orders & cash control".
   ========================================================================== */

var SHEETS = {
  Settings: ["key", "value"],
  Staff: ["id", "name", "role", "pinHash", "active", "createdAt"],
  Prices: ["id", "item", "category", "price", "active"],
  Orders: ["orderNo", "createdAt", "staffId", "staffName", "customerName", "customerPhone", "items", "itemCount",
           "subtotal", "discount", "discountReason", "discountApprovedBy", "total", "paid", "balance", "status",
           "dueDate", "notes", "readyAt", "collectedAt", "collectedBy", "releasedOnCreditBy", "voidedAt",
           "voidReason", "voidApprovedBy", "shiftId"],
  Payments: ["id", "time", "orderNo", "method", "amount", "reference", "staffId", "staffName", "shiftId"],
  Expenses: ["id", "time", "amount", "description", "staffId", "staffName", "shiftId"],
  Shifts: ["id", "staffId", "staffName", "openedAt", "openingFloat", "closedAt", "closedBy", "expectedCash",
           "countedCash", "variance", "notes"],
  Log: ["time", "staffId", "staffName", "action", "orderNo", "details"]
};

/* Columns stored as plain text so leading zeros / long numbers survive. */
var TEXT_COLUMNS = { Orders: ["customerPhone"], Payments: ["reference"], Staff: ["id"], Prices: ["id"] };

var DEFAULT_SETTINGS = {
  nextOrderNo: 1001,
  businessName: "Zen Laundry",
  currency: "₦",
  countryCode: "234",
  varianceAlert: 500,          // flag shifts whose cash is off by this much or more
  largeDiscountPercent: 20,    // flag discounts above this % of the order
  uncollectedDays: 14,         // flag ready orders older than this
  receiptFooter: "Please check your items before leaving. Keep this receipt for collection.",
  paymentNotice: "Only pay at the counter or to the official Zen Laundry account, and always ask for your receipt."
};

var METHODS = ["cash", "transfer", "pos"];
var ROLES = ["staff", "manager", "owner"];
var SESSION_HOURS = 12;
var MAX_PIN_ATTEMPTS = 5;
var LOCKOUT_MINUTES = 15;

/* ---------- Sheet menu (owner only — staff never open the sheet) ---------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu("Zen Laundry")
    .addItem("1. Set up sheets", "setup")
    .addItem("2. Set / reset owner PIN", "resetOwnerPin")
    .addToUi();
}

function setup() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(SHEETS[name]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, SHEETS[name].length).setFontWeight("bold");
    }
    (TEXT_COLUMNS[name] || []).forEach(function (col) {
      var idx = SHEETS[name].indexOf(col) + 1;
      sh.getRange(1, idx, sh.getMaxRows(), 1).setNumberFormat("@");
    });
  });
  var settings = readSettings_();
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
    if (!(k in settings)) ss.getSheetByName("Settings").appendRow([k, DEFAULT_SETTINGS[k]]);
  });
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty("PIN_SALT")) props.setProperty("PIN_SALT", Utilities.getUuid());
  var blank = ss.getSheetByName("Sheet1");
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  try { SpreadsheetApp.getUi().alert("Sheets are ready. Next: Zen Laundry → Set / reset owner PIN."); } catch (e) { /* run from editor */ }
}

function resetOwnerPin() {
  var ui = SpreadsheetApp.getUi();
  var name = ui.prompt("Owner name", "Name shown in the apps (e.g. Mr. Ade):", ui.ButtonSet.OK_CANCEL);
  if (name.getSelectedButton() !== ui.Button.OK || !name.getResponseText().trim()) return;
  var pin = ui.prompt("Owner PIN", "Choose a 6-digit PIN. Do not share it with staff.", ui.ButtonSet.OK_CANCEL);
  if (pin.getSelectedButton() !== ui.Button.OK) return;
  var p = pin.getResponseText().trim();
  if (!/^\d{6}$/.test(p)) { ui.alert("The owner PIN must be exactly 6 digits."); return; }
  var staff = rows_("Staff");
  var owner = staff.filter(function (s) { return s.role === "owner"; })[0];
  if (owner) {
    updateRow_("Staff", owner._row, { name: name.getResponseText().trim(), pinHash: hashPin_(p), active: true });
  } else {
    append_("Staff", { id: newId_("S"), name: name.getResponseText().trim(), role: "owner", pinHash: hashPin_(p), active: true, createdAt: new Date() });
  }
  log_({ id: "sheet", name: "Sheet owner" }, "owner_pin_reset", "", "");
  ui.alert("Owner PIN saved. You can now sign in to the owner dashboard.");
}

/* ---------- HTTP entry point ---------- */
function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents || "{}");
    var handler = ACTIONS[req.action];
    if (!handler) throw new Error("Unknown action.");
    var user = null;
    if (handler.auth) {
      user = sessionUser_(req.token);
      if (handler.auth === "owner" && user.role !== "owner") throw new Error("Owner access only.");
    }
    out = { ok: true, data: handler.write ? withLock_(function () { return handler.fn(req, user); }) : handler.fn(req, user) };
  } catch (err) {
    out = { ok: false, error: err.message || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, data: "Zen Laundry orders API" }))
    .setMimeType(ContentService.MimeType.JSON);
}

var ACTIONS = {
  /* public */
  staffList:   { fn: staffList_ },
  login:       { fn: login_ },
  track:       { fn: track_ },
  /* any signed-in staff */
  bootstrap:   { auth: "staff", fn: bootstrap_ },
  openShift:   { auth: "staff", write: true, fn: openShift_ },
  closeShift:  { auth: "staff", write: true, fn: closeShift_ },
  createOrder: { auth: "staff", write: true, fn: createOrder_ },
  findOrders:  { auth: "staff", fn: findOrders_ },
  getOrder:    { auth: "staff", fn: getOrder_ },
  addPayment:  { auth: "staff", write: true, fn: addPayment_ },
  markReady:   { auth: "staff", write: true, fn: markReady_ },
  collect:     { auth: "staff", write: true, fn: collect_ },
  voidOrder:   { auth: "staff", write: true, fn: voidOrder_ },
  addExpense:  { auth: "staff", write: true, fn: addExpense_ },
  logout:      { auth: "staff", fn: logout_ },
  /* owner only */
  report:      { auth: "owner", fn: report_ },
  adminData:   { auth: "owner", fn: adminData_ },
  savePrice:   { auth: "owner", write: true, fn: savePrice_ },
  saveStaff:   { auth: "owner", write: true, fn: saveStaff_ },
  saveSettings:{ auth: "owner", write: true, fn: saveSettings_ }
};

/* ---------- Auth ---------- */
function staffList_() {
  return rows_("Staff").filter(isActive_).map(function (s) { return { id: s.id, name: s.name, role: s.role }; });
}

function login_(req) {
  var s = checkPin_(req.staffId, req.pin);
  if (req.ownerOnly && s.role !== "owner") throw new Error("Owner access only.");
  var token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put("sess_" + token, s.id, SESSION_HOURS * 3600);
  log_(s, "login", "", req.ownerOnly ? "owner dashboard" : "counter");
  return { token: token, user: publicUser_(s) };
}

function logout_(req, user) {
  CacheService.getScriptCache().remove("sess_" + req.token);
  log_(user, "logout", "", "");
  return true;
}

function checkPin_(staffId, pin) {
  var cache = CacheService.getScriptCache();
  var key = "fail_" + staffId;
  var fails = Number(cache.get(key) || 0);
  if (fails >= MAX_PIN_ATTEMPTS) throw new Error("Too many wrong PINs. Try again in " + LOCKOUT_MINUTES + " minutes.");
  var s = rows_("Staff").filter(function (r) { return String(r.id) === String(staffId) && isActive_(r); })[0];
  if (!s || !pin || s.pinHash !== hashPin_(String(pin))) {
    cache.put(key, String(fails + 1), LOCKOUT_MINUTES * 60);
    if (s) log_(s, "wrong_pin", "", "attempt " + (fails + 1));
    throw new Error("Wrong PIN.");
  }
  cache.remove(key);
  return s;
}

/* A manager/owner approves a sensitive action by entering their PIN on the
   counter device. Staff can't approve their own requests (owner excepted). */
function approve_(approverId, approverPin, user, what) {
  if (!approverId || !approverPin) throw new Error(what + " needs a manager or owner PIN.");
  var a = checkPin_(approverId, approverPin);
  if (a.role !== "manager" && a.role !== "owner") throw new Error("Only a manager or the owner can approve " + what.toLowerCase() + ".");
  if (String(a.id) === String(user.id) && a.role !== "owner") throw new Error("You can't approve your own " + what.toLowerCase() + ". Ask another manager or the owner.");
  return a;
}

function sessionUser_(token) {
  var id = token && CacheService.getScriptCache().get("sess_" + token);
  if (!id) throw new Error("SESSION_EXPIRED");
  var s = rows_("Staff").filter(function (r) { return String(r.id) === String(id) && isActive_(r); })[0];
  if (!s) throw new Error("SESSION_EXPIRED");
  return s;
}

function hashPin_(pin) {
  var salt = PropertiesService.getScriptProperties().getProperty("PIN_SALT");
  if (!salt) throw new Error("Run Zen Laundry → Set up sheets first.");
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ":" + pin, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("");
}

function publicUser_(s) { return { id: s.id, name: s.name, role: s.role }; }
function isActive_(r) { return r.active === true || String(r.active).toUpperCase() === "TRUE"; }

/* ---------- Counter ---------- */
function bootstrap_(req, user) {
  var settings = readSettings_();
  var shift = currentShift_();
  return {
    user: publicUser_(user),
    settings: publicSettings_(settings),
    prices: rows_("Prices").filter(isActive_).map(function (p) { return { id: p.id, item: p.item, category: p.category, price: num_(p.price) }; }),
    approvers: rows_("Staff").filter(function (s) { return isActive_(s) && (s.role === "manager" || s.role === "owner"); })
      .map(function (s) { return { id: s.id, name: s.name }; }),
    shift: shift ? shiftSummary_(shift, false) : null
  };
}

function currentShift_() {
  return rows_("Shifts").filter(function (s) { return !s.closedAt; })[0] || null;
}

function requireShift_() {
  var s = currentShift_();
  if (!s) throw new Error("The cash drawer isn't open. Open it first.");
  return s;
}

function openShift_(req, user) {
  if (currentShift_()) throw new Error("The drawer is already open.");
  var float = num_(req.openingFloat);
  if (float < 0) throw new Error("Opening float can't be negative.");
  var shift = { id: newId_("SH"), staffId: user.id, staffName: user.name, openedAt: new Date(), openingFloat: float };
  append_("Shifts", shift);
  log_(user, "open_drawer", "", "float " + float);
  return shiftSummary_(rows_("Shifts").filter(function (s) { return s.id === shift.id; })[0], false);
}

function expectedCash_(shift) {
  var cashIn = rows_("Payments").filter(function (p) { return p.shiftId === shift.id && p.method === "cash"; })
    .reduce(function (t, p) { return t + num_(p.amount); }, 0);
  var cashOut = rows_("Expenses").filter(function (x) { return x.shiftId === shift.id; })
    .reduce(function (t, x) { return t + num_(x.amount); }, 0);
  return { float: num_(shift.openingFloat), cashIn: cashIn, cashOut: cashOut, expected: num_(shift.openingFloat) + cashIn - cashOut };
}

/* includeTotals=false hides the expected cash so the close is a blind count. */
function shiftSummary_(shift, includeTotals) {
  var out = { id: shift.id, openedBy: shift.staffName, openedAt: iso_(shift.openedAt), openingFloat: num_(shift.openingFloat) };
  out.expenses = rows_("Expenses").filter(function (x) { return x.shiftId === shift.id; })
    .map(function (x) { return { time: iso_(x.time), amount: num_(x.amount), description: x.description, staffName: x.staffName }; });
  if (includeTotals) {
    var c = expectedCash_(shift);
    out.expectedCash = c.expected;
    out.countedCash = num_(shift.countedCash);
    out.variance = num_(shift.variance);
  }
  return out;
}

function closeShift_(req, user) {
  var shift = requireShift_();
  if (req.countedCash === "" || req.countedCash === null || req.countedCash === undefined || isNaN(Number(req.countedCash))) {
    throw new Error("Enter the cash you counted.");
  }
  var counted = num_(req.countedCash);
  var c = expectedCash_(shift);
  var variance = counted - c.expected;
  updateRow_("Shifts", shift._row, {
    closedAt: new Date(), closedBy: user.name, expectedCash: c.expected, countedCash: counted,
    variance: variance, notes: String(req.notes || "").slice(0, 500)
  });
  log_(user, "close_drawer", "", "expected " + c.expected + ", counted " + counted + ", variance " + variance);
  return { expectedCash: c.expected, countedCash: counted, variance: variance, breakdown: c };
}

function createOrder_(req, user) {
  var shift = requireShift_();
  var name = String(req.customerName || "").trim();
  var phone = digits_(req.customerPhone);
  if (!name) throw new Error("Enter the customer's name.");
  if (phone.length < 7) throw new Error("Enter the customer's phone number.");

  var priceMap = {};
  rows_("Prices").filter(isActive_).forEach(function (p) { priceMap[p.id] = p; });
  var items = (req.items || []).map(function (it) {
    var p = priceMap[it.id];
    var qty = Math.floor(Number(it.qty));
    if (!p) throw new Error("An item is no longer on the price list. Reload the app.");
    if (!(qty > 0 && qty <= 500)) throw new Error("Invalid quantity for " + p.item + ".");
    return { id: p.id, item: p.item, price: num_(p.price), qty: qty };
  });
  if (!items.length) throw new Error("Add at least one item.");

  var subtotal = items.reduce(function (t, i) { return t + i.price * i.qty; }, 0);
  var itemCount = items.reduce(function (t, i) { return t + i.qty; }, 0);
  var discount = num_(req.discount);
  var approver = null;
  if (discount < 0 || discount > subtotal) throw new Error("Invalid discount.");
  if (discount > 0) {
    if (!String(req.discountReason || "").trim()) throw new Error("Give a reason for the discount.");
    approver = approve_(req.approverId, req.approverPin, user, "Discount");
  }
  var total = subtotal - discount;

  var pay = req.payment || {};
  var payAmount = num_(pay.amount);
  if (payAmount > 0) validatePayment_(pay, total);

  var settings = readSettings_();
  var orderNo = num_(settings.nextOrderNo) || DEFAULT_SETTINGS.nextOrderNo;
  setSetting_("nextOrderNo", orderNo + 1);

  var order = {
    orderNo: orderNo, createdAt: new Date(), staffId: user.id, staffName: user.name,
    customerName: name.slice(0, 80), customerPhone: phone, items: JSON.stringify(items), itemCount: itemCount,
    subtotal: subtotal, discount: discount, discountReason: discount ? String(req.discountReason).slice(0, 200) : "",
    discountApprovedBy: approver ? approver.name : "", total: total, paid: 0, balance: total, status: "received",
    dueDate: req.dueDate || "", notes: String(req.notes || "").slice(0, 300), shiftId: shift.id
  };
  append_("Orders", order);
  log_(user, "create_order", orderNo, itemCount + " items, total " + total + (discount ? ", discount " + discount + " approved by " + approver.name : ""));
  if (payAmount > 0) recordPayment_(orderNo, pay, user, shift);
  return getOrder_({ orderNo: orderNo });
}

function validatePayment_(pay, balance) {
  var amount = num_(pay.amount);
  if (METHODS.indexOf(pay.method) < 0) throw new Error("Choose how the customer paid.");
  if (!(amount > 0)) throw new Error("Enter the amount paid.");
  if (amount > balance) throw new Error("Payment is more than the balance due (" + balance + ").");
  if (pay.method !== "cash" && String(pay.reference || "").trim().length < 4) {
    throw new Error("Enter the transfer / POS reference so it can be matched to the bank statement.");
  }
}

function recordPayment_(orderNo, pay, user, shift) {
  var o = findOrderRow_(orderNo);
  var amount = num_(pay.amount);
  append_("Payments", {
    id: newId_("P"), time: new Date(), orderNo: orderNo, method: pay.method, amount: amount,
    reference: String(pay.reference || "").trim().slice(0, 60), staffId: user.id, staffName: user.name, shiftId: shift.id
  });
  var paid = num_(o.paid) + amount;
  updateRow_("Orders", o._row, { paid: paid, balance: num_(o.total) - paid });
  log_(user, "payment", orderNo, pay.method + " " + amount + (pay.reference ? " ref " + pay.reference : ""));
}

function addPayment_(req, user) {
  var shift = requireShift_();
  var o = findOrderRow_(req.orderNo);
  if (o.status === "void") throw new Error("This order was voided.");
  validatePayment_(req.payment || {}, num_(o.balance));
  recordPayment_(o.orderNo, req.payment, user, shift);
  return getOrder_({ orderNo: o.orderNo });
}

function markReady_(req, user) {
  var o = findOrderRow_(req.orderNo);
  if (o.status !== "received") throw new Error("Only received orders can be marked ready.");
  updateRow_("Orders", o._row, { status: "ready", readyAt: new Date() });
  log_(user, "mark_ready", o.orderNo, "");
  return getOrder_({ orderNo: o.orderNo });
}

function collect_(req, user) {
  var o = findOrderRow_(req.orderNo);
  if (o.status === "void") throw new Error("This order was voided.");
  if (o.status === "collected") throw new Error("This order was already collected on " + fmt_(o.collectedAt) + ".");
  var patch = { status: "collected", collectedAt: new Date(), collectedBy: user.name };
  if (num_(o.balance) > 0) {
    var a = approve_(req.approverId, req.approverPin, user, "Releasing unpaid laundry");
    patch.releasedOnCreditBy = a.name;
  }
  updateRow_("Orders", o._row, patch);
  log_(user, "collect", o.orderNo, num_(o.balance) > 0 ? "released with balance " + o.balance + " approved by " + patch.releasedOnCreditBy : "fully paid");
  return getOrder_({ orderNo: o.orderNo });
}

function voidOrder_(req, user) {
  var o = findOrderRow_(req.orderNo);
  if (o.status === "void") throw new Error("Already voided.");
  if (o.status === "collected") throw new Error("Collected orders can't be voided.");
  var reason = String(req.reason || "").trim();
  if (reason.length < 5) throw new Error("Give a clear reason for the void.");
  if (num_(o.paid) > 0) throw new Error("This order has payments recorded. Money taken can't be voided away. Contact the owner.");
  var a = approve_(req.approverId, req.approverPin, user, "Void");
  updateRow_("Orders", o._row, { status: "void", voidedAt: new Date(), voidReason: reason.slice(0, 200), voidApprovedBy: a.name, balance: 0 });
  log_(user, "void", o.orderNo, reason + " (approved by " + a.name + ")");
  return getOrder_({ orderNo: o.orderNo });
}

function addExpense_(req, user) {
  var shift = requireShift_();
  var amount = num_(req.amount);
  var desc = String(req.description || "").trim();
  if (!(amount > 0)) throw new Error("Enter the amount taken from the drawer.");
  if (desc.length < 3) throw new Error("Say what the money was for.");
  append_("Expenses", { id: newId_("E"), time: new Date(), amount: amount, description: desc.slice(0, 200), staffId: user.id, staffName: user.name, shiftId: shift.id });
  log_(user, "expense", "", amount + " — " + desc);
  return shiftSummary_(shift, false);
}

function findOrders_(req) {
  var q = String(req.query || "").trim().toLowerCase();
  var qDigits = digits_(q);
  var list = rows_("Orders");
  var hits = list.filter(function (o) {
    if (!q) return o.status === "received" || o.status === "ready";
    if (qDigits && String(o.orderNo) === qDigits.replace(/^0+/, "")) return true;
    if (qDigits.length >= 4 && String(o.customerPhone).indexOf(qDigits) >= 0) return true;
    return q.length >= 2 && String(o.customerName).toLowerCase().indexOf(q) >= 0;
  });
  return hits.slice(-50).reverse().map(orderOut_);
}

function getOrder_(req) {
  var o = findOrderRow_(req.orderNo);
  var out = orderOut_(o);
  out.payments = rows_("Payments").filter(function (p) { return String(p.orderNo) === String(o.orderNo); })
    .map(function (p) { return { time: iso_(p.time), method: p.method, amount: num_(p.amount), reference: p.reference, staffName: p.staffName }; });
  return out;
}

function orderOut_(o) {
  return {
    orderNo: num_(o.orderNo), createdAt: iso_(o.createdAt), staffName: o.staffName, customerName: o.customerName,
    customerPhone: String(o.customerPhone), items: safeJson_(o.items), itemCount: num_(o.itemCount),
    subtotal: num_(o.subtotal), discount: num_(o.discount), discountReason: o.discountReason, discountApprovedBy: o.discountApprovedBy,
    total: num_(o.total), paid: num_(o.paid), balance: num_(o.balance), status: o.status, dueDate: dateOnly_(o.dueDate),
    notes: o.notes, readyAt: iso_(o.readyAt), collectedAt: iso_(o.collectedAt), collectedBy: o.collectedBy,
    releasedOnCreditBy: o.releasedOnCreditBy, voidReason: o.voidReason, voidApprovedBy: o.voidApprovedBy
  };
}

/* ---------- Public order tracking (customer is the auditor) ---------- */
function track_(req) {
  var orderNo = digits_(req.orderNo).replace(/^0+/, "");
  var last4 = digits_(req.phoneLast4);
  if (!orderNo || last4.length !== 4) throw new Error("Enter your order number and the last 4 digits of your phone number.");
  var cache = CacheService.getScriptCache();
  var key = "track_" + orderNo;
  var tries = Number(cache.get(key) || 0);
  if (tries >= 10) throw new Error("Too many attempts. Please try again later.");
  var o = rows_("Orders").filter(function (r) { return String(r.orderNo) === orderNo; })[0];
  if (!o || String(o.customerPhone).slice(-4) !== last4) {
    cache.put(key, String(tries + 1), 3600);
    throw new Error("We couldn't find an order with those details. Check your receipt and try again.");
  }
  var settings = readSettings_();
  return {
    orderNo: num_(o.orderNo), createdAt: iso_(o.createdAt), status: o.status, dueDate: dateOnly_(o.dueDate),
    items: safeJson_(o.items).map(function (i) { return { item: i.item, qty: i.qty, price: i.price }; }),
    itemCount: num_(o.itemCount), discount: num_(o.discount), total: num_(o.total), paid: num_(o.paid), balance: num_(o.balance),
    currency: settings.currency, paymentNotice: settings.paymentNotice
  };
}

/* ---------- Owner reporting ---------- */
function report_(req) {
  var settings = readSettings_();
  var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  var from = String(req.from || ""), to = String(req.to || "");
  function inRange(d) {
    if (!d) return false;
    var day = Utilities.formatDate(new Date(d), tz, "yyyy-MM-dd");
    return day >= from && day <= to;
  }
  var orders = rows_("Orders"), payments = rows_("Payments"), expenses = rows_("Expenses"), shifts = rows_("Shifts"), log = rows_("Log");
  var rOrders = orders.filter(function (o) { return inRange(o.createdAt); });
  var live = rOrders.filter(function (o) { return o.status !== "void"; });
  var rPayments = payments.filter(function (p) { return inRange(p.time); });
  var rExpenses = expenses.filter(function (x) { return inRange(x.time); });
  var rShifts = shifts.filter(function (s) { return inRange(s.openedAt); });

  var sum = function (list, f) { return list.reduce(function (t, x) { return t + num_(x[f]); }, 0); };
  var byMethod = { cash: 0, transfer: 0, pos: 0 };
  rPayments.forEach(function (p) { byMethod[p.method] = (byMethod[p.method] || 0) + num_(p.amount); });

  /* per staff */
  var staff = {};
  function st(name) { return staff[name] || (staff[name] = { name: name, orders: 0, sales: 0, discounts: 0, voids: 0, collected: 0, variance: 0, shifts: 0 }); }
  rOrders.forEach(function (o) {
    var s = st(o.staffName);
    if (o.status === "void") { s.voids++; return; }
    s.orders++; s.sales += num_(o.total); s.discounts += num_(o.discount);
  });
  rPayments.forEach(function (p) { st(p.staffName).collected += num_(p.amount); });
  rShifts.filter(function (s) { return s.closedAt; }).forEach(function (s) { var x = st(s.closedBy || s.staffName); x.variance += num_(s.variance); x.shifts++; });

  /* daily */
  var days = {};
  rOrders.forEach(function (o) {
    var d = Utilities.formatDate(new Date(o.createdAt), tz, "yyyy-MM-dd");
    var x = days[d] || (days[d] = { day: d, orders: 0, sales: 0, collected: 0, cash: 0 });
    if (o.status !== "void") { x.orders++; x.sales += num_(o.total); }
  });
  rPayments.forEach(function (p) {
    var d = Utilities.formatDate(new Date(p.time), tz, "yyyy-MM-dd");
    var x = days[d] || (days[d] = { day: d, orders: 0, sales: 0, collected: 0, cash: 0 });
    x.collected += num_(p.amount);
    if (p.method === "cash") x.cash += num_(p.amount);
  });

  /* red flags */
  var flags = [];
  var varianceAlert = num_(settings.varianceAlert);
  var now = new Date();
  rShifts.forEach(function (s) {
    if (s.closedAt && Math.abs(num_(s.variance)) >= varianceAlert) {
      flags.push({ level: "high", text: "Drawer " + (num_(s.variance) < 0 ? "SHORT" : "over") + " by " + Math.abs(num_(s.variance)) + " on shift closed by " + (s.closedBy || s.staffName) + " (" + fmt_(s.closedAt) + ")." });
    }
    if (!s.closedAt && now - new Date(s.openedAt) > 14 * 3600 * 1000) {
      flags.push({ level: "medium", text: "Drawer opened by " + s.staffName + " at " + fmt_(s.openedAt) + " was never closed." });
    }
  });
  rOrders.forEach(function (o) {
    if (o.status === "void") flags.push({ level: "medium", text: "Order #" + o.orderNo + " voided by " + o.staffName + " — \"" + o.voidReason + "\" (approved by " + o.voidApprovedBy + ")." });
    var pct = num_(o.subtotal) ? num_(o.discount) / num_(o.subtotal) * 100 : 0;
    if (pct > num_(settings.largeDiscountPercent)) flags.push({ level: "medium", text: "Order #" + o.orderNo + ": " + Math.round(pct) + "% discount by " + o.staffName + " — \"" + o.discountReason + "\" (approved by " + o.discountApprovedBy + ")." });
    if (o.releasedOnCreditBy) flags.push({ level: "medium", text: "Order #" + o.orderNo + " released with " + o.balance + " unpaid (approved by " + o.releasedOnCreditBy + ")." });
  });
  var wrongPins = {};
  log.filter(function (l) { return l.action === "wrong_pin" && inRange(l.time); }).forEach(function (l) { wrongPins[l.staffName] = (wrongPins[l.staffName] || 0) + 1; });
  Object.keys(wrongPins).forEach(function (n) { if (wrongPins[n] >= 3) flags.push({ level: "low", text: wrongPins[n] + " wrong PIN attempts on " + n + "'s account." }); });
  var ageLimit = num_(settings.uncollectedDays) * 86400000;
  orders.forEach(function (o) {
    if (o.status === "ready" && o.readyAt && now - new Date(o.readyAt) > ageLimit) {
      flags.push({ level: "low", text: "Order #" + o.orderNo + " (" + o.customerName + ") ready since " + fmt_(o.readyAt) + " and not collected." });
    }
  });
  /* sequence check over the whole ledger: rows deleted or edited directly in the sheet show up here */
  var nums = orders.map(function (o) { return num_(o.orderNo); }).sort(function (a, b) { return a - b; });
  var missing = [];
  for (var i = 1; i < nums.length; i++) for (var n = nums[i - 1] + 1; n < nums[i] && missing.length < 50; n++) missing.push(n);
  if (missing.length) flags.unshift({ level: "high", text: "Order numbers missing from the ledger: #" + missing.join(", #") + ". Rows may have been deleted from the sheet." });

  var lvl = { high: 0, medium: 1, low: 2 };
  flags.sort(function (a, b) { return lvl[a.level] - lvl[b.level]; });

  return {
    range: { from: from, to: to },
    currency: settings.currency,
    kpis: {
      orders: live.length, sales: sum(live, "total"), collected: sum(rPayments, "amount"), byMethod: byMethod,
      expenses: sum(rExpenses, "amount"), discounts: sum(live, "discount"),
      voids: rOrders.length - live.length, voidValue: sum(rOrders.filter(function (o) { return o.status === "void"; }), "subtotal"),
      variance: sum(rShifts.filter(function (s) { return s.closedAt; }), "variance"),
      outstanding: sum(orders.filter(function (o) { return o.status !== "void"; }), "balance")
    },
    flags: flags,
    days: Object.keys(days).sort().map(function (k) { return days[k]; }),
    staff: Object.keys(staff).map(function (k) { return staff[k]; }),
    shifts: rShifts.reverse().map(function (s) {
      var running = !s.closedAt ? expectedCash_(s) : null;
      return { openedBy: s.staffName, openedAt: iso_(s.openedAt), closedAt: iso_(s.closedAt), closedBy: s.closedBy,
        openingFloat: num_(s.openingFloat), expectedCash: running ? running.expected : num_(s.expectedCash),
        countedCash: s.closedAt ? num_(s.countedCash) : null, variance: s.closedAt ? num_(s.variance) : null, notes: s.notes };
    }),
    bankPayments: rPayments.filter(function (p) { return p.method !== "cash"; }).reverse()
      .map(function (p) { return { time: iso_(p.time), orderNo: num_(p.orderNo), method: p.method, amount: num_(p.amount), reference: p.reference, staffName: p.staffName }; }),
    discounts: live.filter(function (o) { return num_(o.discount) > 0; }).reverse().map(orderOut_),
    voids: rOrders.filter(function (o) { return o.status === "void"; }).reverse().map(orderOut_),
    outstanding: orders.filter(function (o) { return o.status !== "void" && num_(o.balance) > 0; }).reverse().map(orderOut_),
    expenses: rExpenses.reverse().map(function (x) { return { time: iso_(x.time), amount: num_(x.amount), description: x.description, staffName: x.staffName }; }),
    log: log.filter(function (l) { return inRange(l.time); }).slice(-300).reverse()
      .map(function (l) { return { time: iso_(l.time), staffName: l.staffName, action: l.action, orderNo: l.orderNo, details: l.details }; })
  };
}

function adminData_() {
  return {
    settings: publicSettings_(readSettings_()),
    prices: rows_("Prices").map(function (p) { return { id: p.id, item: p.item, category: p.category, price: num_(p.price), active: isActive_(p) }; }),
    staff: rows_("Staff").map(function (s) { return { id: s.id, name: s.name, role: s.role, active: isActive_(s) }; })
  };
}

function savePrice_(req, user) {
  var p = req.price || {};
  var item = String(p.item || "").trim();
  var price = num_(p.price);
  if (!item) throw new Error("Enter the item name.");
  if (!(price >= 0)) throw new Error("Enter a valid price.");
  var data = { item: item.slice(0, 80), category: String(p.category || "General").trim().slice(0, 40), price: price, active: p.active !== false };
  if (p.id) {
    var row = rows_("Prices").filter(function (r) { return String(r.id) === String(p.id); })[0];
    if (!row) throw new Error("Price not found.");
    updateRow_("Prices", row._row, data);
    log_(user, "price_change", "", item + ": " + row.price + " → " + price + (data.active ? "" : " (hidden)"));
  } else {
    data.id = newId_("I");
    append_("Prices", data);
    log_(user, "price_add", "", item + ": " + price);
  }
  return adminData_();
}

function saveStaff_(req, user) {
  var s = req.staff || {};
  var name = String(s.name || "").trim();
  if (!name) throw new Error("Enter the staff member's name.");
  if (ROLES.indexOf(s.role) < 0) throw new Error("Choose a role.");
  if (s.pin && !/^\d{4,8}$/.test(String(s.pin))) throw new Error("PIN must be 4 to 8 digits.");
  var all = rows_("Staff");
  if (s.pin) {
    var h = hashPin_(String(s.pin));
    if (all.some(function (r) { return r.pinHash === h && String(r.id) !== String(s.id); })) throw new Error("That PIN is already in use. Choose another.");
  }
  if (s.id) {
    var row = all.filter(function (r) { return String(r.id) === String(s.id); })[0];
    if (!row) throw new Error("Staff member not found.");
    if (row.role === "owner" && (s.role !== "owner" || s.active === false)) throw new Error("The owner account can't be demoted or deactivated here.");
    var patch = { name: name.slice(0, 60), role: s.role, active: s.active !== false };
    if (s.pin) patch.pinHash = hashPin_(String(s.pin));
    updateRow_("Staff", row._row, patch);
    log_(user, "staff_update", "", name + " (" + s.role + (patch.active ? "" : ", deactivated") + (s.pin ? ", PIN reset" : "") + ")");
  } else {
    if (!s.pin) throw new Error("Set a PIN for the new staff member.");
    append_("Staff", { id: newId_("S"), name: name.slice(0, 60), role: s.role, pinHash: hashPin_(String(s.pin)), active: true, createdAt: new Date() });
    log_(user, "staff_add", "", name + " (" + s.role + ")");
  }
  return adminData_();
}

function saveSettings_(req, user) {
  var editable = ["businessName", "currency", "countryCode", "varianceAlert", "largeDiscountPercent", "uncollectedDays", "receiptFooter", "paymentNotice"];
  var s = req.settings || {};
  editable.forEach(function (k) { if (k in s) setSetting_(k, String(s[k]).slice(0, 300)); });
  log_(user, "settings_change", "", JSON.stringify(s).slice(0, 300));
  return adminData_();
}

/* ---------- Sheet helpers ---------- */
function sheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error("Sheet \"" + name + "\" is missing. Run Zen Laundry → Set up sheets.");
  return sh;
}

function rows_(name) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  var head = values.shift() || [];
  return values.map(function (r, i) {
    var o = { _row: i + 2 };
    head.forEach(function (h, j) { o[h] = r[j]; });
    return o;
  });
}

function append_(name, obj) {
  sheet_(name).appendRow(SHEETS[name].map(function (h) { return obj[h] === undefined ? "" : obj[h]; }));
}

function updateRow_(name, row, patch) {
  var sh = sheet_(name);
  var head = SHEETS[name];
  Object.keys(patch).forEach(function (k) {
    var col = head.indexOf(k);
    if (col < 0) throw new Error("Unknown column " + k);
    sh.getRange(row, col + 1).setValue(patch[k]);
  });
}

function findOrderRow_(orderNo) {
  var n = digits_(orderNo).replace(/^0+/, "");
  var o = rows_("Orders").filter(function (r) { return String(r.orderNo) === n; })[0];
  if (!o) throw new Error("Order #" + orderNo + " not found.");
  return o;
}

function readSettings_() {
  var out = {};
  var sh = SpreadsheetApp.getActive().getSheetByName("Settings");
  if (!sh) return out;
  sh.getDataRange().getValues().slice(1).forEach(function (r) { if (r[0]) out[r[0]] = r[1]; });
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) { if (!(k in out)) out[k] = DEFAULT_SETTINGS[k]; });
  return out;
}

function publicSettings_(s) {
  var out = {};
  Object.keys(s).forEach(function (k) { if (k !== "nextOrderNo") out[k] = s[k]; });
  return out;
}

function setSetting_(key, value) {
  var sh = sheet_("Settings");
  var keys = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (var i = 1; i < keys.length; i++) {
    if (keys[i][0] === key) { sh.getRange(i + 1, 2).setValue(value); return; }
  }
  sh.appendRow([key, value]);
}

function log_(user, action, orderNo, details) {
  sheet_("Log").appendRow([new Date(), user ? user.id : "", user ? user.name : "", action, orderNo || "", details || ""]);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { SpreadsheetApp.flush(); lock.releaseLock(); }
}

function newId_(prefix) { return prefix + "-" + Utilities.getUuid().slice(0, 8).toUpperCase(); }
function num_(v) { var n = Number(v); return isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function digits_(v) { return String(v || "").replace(/\D/g, ""); }
function iso_(d) { return d ? new Date(d).toISOString() : ""; }
function dateOnly_(d) {
  if (!d) return "";
  if (d instanceof Date) return Utilities.formatDate(d, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), "yyyy-MM-dd");
  return String(d);
}
function fmt_(d) { return d ? Utilities.formatDate(new Date(d), SpreadsheetApp.getActive().getSpreadsheetTimeZone(), "d MMM yyyy, h:mm a") : ""; }
function safeJson_(s) { try { return JSON.parse(s || "[]"); } catch (e) { return []; } }
