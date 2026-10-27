/* ==========================================================================
   Zen Laundry — site behaviour
   Plain JavaScript, no dependencies. Reads business details from config.js.
   ========================================================================== */
(function () {
  "use strict";

  var CONFIG = window.SITE_CONFIG || {};
  var DEV = !!CONFIG.developmentMode;
  var root = document.documentElement;

  root.classList.add("js");
  if (DEV) root.classList.add("dev-mode");

  /* ---------- Helpers ---------- */
  function get(path) {
    return path.split(".").reduce(function (obj, key) {
      return obj && obj[key] !== undefined ? obj[key] : null;
    }, CONFIG);
  }
  function hasValue(v) {
    if (v === null || v === undefined) return false;
    if (Array.isArray(v)) return v.length > 0;
    return String(v).trim() !== "";
  }
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text) node.textContent = text;
    return node;
  }
  function tbc(label) { return el("span", { "class": "tbc" }, label || "To be confirmed"); }

  /* Missing value: show a TBC chip in development, hide entirely in production. */
  function handleMissing(node) {
    // data-config-self: hide only this element, not its surrounding block
    var wrap = node.hasAttribute("data-config-self") ? node : (node.closest("[data-config-wrap]") || node);
    if (DEV) {
      var label = node.getAttribute("data-label");
      if (node.tagName === "A" || node.hasAttribute("data-config-self")) {
        node.hidden = true;
        node.insertAdjacentElement("afterend", tbc(label));
      } else {
        node.textContent = "";
        node.appendChild(tbc(label));
      }
    } else {
      wrap.hidden = true;
    }
  }

  function whatsappUrl(message) {
    var num = get("contact.whatsapp");
    if (!hasValue(num)) return null;
    var url = "https://wa.me/" + String(num).replace(/\D/g, "");
    if (message) url += "?text=" + encodeURIComponent(message);
    return url;
  }

  var LINK_BUILDERS = {
    phone: function () { var t = get("contact.phoneTel"); return hasValue(t) ? "tel:" + String(t).replace(/\s/g, "") : null; },
    email: function () { var e = get("contact.email"); return hasValue(e) ? "mailto:" + e : null; },
    whatsapp: function (node) { return whatsappUrl(node.getAttribute("data-wa-message")); },
    map: function () { var m = get("location.mapLink"); return hasValue(m) ? m : null; }
  };

  /* ---------- 1. Bind config values into the page ---------- */
  function bindConfig() {
    // Text values
    $all("[data-config]").forEach(function (node) {
      var value = get(node.getAttribute("data-config"));
      if (hasValue(value)) node.textContent = value;
      else handleMissing(node);
    });

    // Lists (e.g. opening hours, corporate audiences)
    $all("[data-config-list]").forEach(function (node) {
      var value = get(node.getAttribute("data-config-list"));
      if (hasValue(value) && Array.isArray(value)) {
        node.textContent = "";
        value.forEach(function (item) { node.appendChild(el("li", null, item)); });
      } else {
        handleMissing(node);
      }
    });

    // Links
    $all("[data-link]").forEach(function (node) {
      var type = node.getAttribute("data-link");
      var href = null;
      if (type.indexOf("social.") === 0) {
        href = get(type);
      } else if (LINK_BUILDERS[type]) {
        href = LINK_BUILDERS[type](node);
      }
      if (hasValue(href)) {
        node.setAttribute("href", href);
        if (type === "whatsapp" || type === "map" || type.indexOf("social.") === 0) {
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener");
        }
        var textKey = node.getAttribute("data-link-text");
        if (textKey && hasValue(get(textKey))) node.textContent = get(textKey);
      } else {
        handleMissing(node);
      }
    });

    // Elements that only make sense when a value exists (no placeholder shown)
    $all("[data-requires]").forEach(function (node) {
      var keys = node.getAttribute("data-requires").split(",");
      var any = keys.some(function (k) { return hasValue(get(k.trim())); });
      if (!any && !DEV) node.hidden = true;
    });

    // Social list: hide whole block when no accounts exist
    $all("[data-social-list]").forEach(function (list) {
      var visible = $all("a", list).filter(function (a) { return !a.closest("[hidden]"); });
      if (!visible.length && !DEV) list.hidden = true;
    });

    // Map embed
    $all("[data-map]").forEach(function (node) {
      var src = get("location.mapEmbedUrl");
      if (hasValue(src)) {
        var iframe = el("iframe", {
          "class": "map-frame", src: src, loading: "lazy",
          referrerpolicy: "no-referrer-when-downgrade",
          title: "Map showing the Zen Laundry location"
        });
        node.textContent = "";
        node.appendChild(iframe);
        node.hidden = false;
      }
    });

    // Footer year
    $all("[data-year]").forEach(function (n) { n.textContent = new Date().getFullYear(); });

    // Logo fallback: if the logo file is missing, hide the broken image (the text name remains)
    $all(".brand-logo").forEach(function (img) {
      function onErr() {
        img.hidden = true;
        var brand = img.closest(".brand");
        if (brand) brand.classList.add("no-logo");
        if (DEV) console.warn("Zen Laundry logo not found at " + img.getAttribute("src") + " — add the original logo file.");
      }
      if (img.complete && img.naturalWidth === 0) onErr();
      else img.addEventListener("error", onErr);
    });
  }

  /* ---------- 2. SEO: canonical, Open Graph URL, structured data ---------- */
  function seo() {
    var siteUrl = get("siteUrl");
    if (hasValue(siteUrl)) {
      siteUrl = String(siteUrl).replace(/\/$/, "");
      var path = location.pathname.split("/").pop() || "";
      if (path === "index.html") path = "";
      var pageUrl = siteUrl + "/" + path;
      if (!$('link[rel="canonical"]')) document.head.appendChild(el("link", { rel: "canonical", href: pageUrl }));
      if (!$('meta[property="og:url"]')) document.head.appendChild(el("meta", { property: "og:url", content: pageUrl }));
      var ogImg = $('meta[property="og:image"]');
      if (ogImg && !/^https?:/.test(ogImg.content)) ogImg.content = siteUrl + "/" + ogImg.content.replace(/^\//, "");
    }

    // Structured data built ONLY from confirmed config values
    var data = {
      "@context": "https://schema.org",
      "@type": "DryCleaningOrLaundry",
      name: get("business.name"),
      description: get("business.description"),
      makesOffer: ["Washing and Ironing", "Pickup and Delivery", "Dry Cleaning", "Corporate Laundry", "Duvets and Bedsheets", "Shoe and Bag Cleaning"].map(function (s) {
        return { "@type": "Offer", itemOffered: { "@type": "Service", name: s } };
      })
    };
    if (hasValue(siteUrl)) { data.url = siteUrl; data.logo = siteUrl + "/assets/images/logo.png"; data.image = siteUrl + "/assets/images/og-image.jpg"; }
    if (hasValue(get("contact.phoneTel"))) data.telephone = get("contact.phoneTel");
    if (hasValue(get("contact.email"))) data.email = get("contact.email");
    if (hasValue(get("location.address"))) data.address = get("location.address");
    if (hasValue(get("location.serviceAreas"))) data.areaServed = get("location.serviceAreas");
    var socials = Object.keys(CONFIG.social || {}).map(function (k) { return CONFIG.social[k]; }).filter(hasValue);
    if (socials.length) data.sameAs = socials;
    var script = el("script", { type: "application/ld+json" });
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);
  }

  /* ---------- 3. Header & mobile navigation ---------- */
  function navigation() {
    var header = $(".site-header");
    var toggle = $(".menu-toggle");
    var panel = $("#mobile-nav");

    function onScroll() {
      if (header) header.classList.toggle("is-scrolled", window.scrollY > 8);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    if (!toggle || !panel) return;

    function setOpen(open, returnFocus) {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      panel.hidden = !open;
      if (open) {
        var first = $("a", panel);
        if (first) first.focus();
      } else if (returnFocus) {
        toggle.focus();
      }
    }
    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") setOpen(false, true);
    });
    $all("a", panel).forEach(function (a) { a.addEventListener("click", function () { setOpen(false); }); });
    document.addEventListener("click", function (e) {
      if (toggle.getAttribute("aria-expanded") === "true" && !panel.contains(e.target) && !toggle.contains(e.target)) setOpen(false);
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth >= 1024 && toggle.getAttribute("aria-expanded") === "true") setOpen(false);
    });
  }

  /* ---------- 4. Back to top ---------- */
  function backToTop() {
    var btn = $(".back-to-top");
    if (!btn) return;
    window.addEventListener("scroll", function () {
      btn.classList.toggle("is-visible", window.scrollY > 700);
    }, { passive: true });
    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0 });
      var skip = $(".skip-link");
      var target = $(".brand");
      if (target) target.focus({ preventScroll: true });
      else if (skip) skip.focus();
    });
  }

  /* ---------- 5. Restrained reveal-on-scroll ---------- */
  function reveal() {
    var items = $all(".reveal");
    if (!items.length) return;
    if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      items.forEach(function (i) { i.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add("is-in"); io.unobserve(entry.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    items.forEach(function (i) { io.observe(i); });
  }

  /* ---------- 6. Forms ---------- */
  var ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>';
  var ICON_ERR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 7v6M12 17h.01"/></svg>';

  var MESSAGES = {
    booking: {
      success: "<strong>Thank you — your laundry request has been sent.</strong><p>This is a request, not a confirmed booking. Zen Laundry will contact you to confirm availability, timing and any applicable details.</p>"
    },
    corporate: {
      success: "<strong>Thank you — your corporate enquiry has been sent.</strong><p>Zen Laundry will review your requirements and get in touch to discuss them and prepare a quotation.</p>"
    },
    contact: {
      success: "<strong>Thank you — your message has been sent.</strong><p>Zen Laundry will get back to you as soon as possible.</p>"
    }
  };

  function alternativeContactHtml() {
    var parts = [];
    var wa = whatsappUrl("Hello Zen Laundry, I'd like to make an enquiry.");
    if (wa) parts.push('<a href="' + wa + '" target="_blank" rel="noopener">chat on WhatsApp</a>');
    var tel = LINK_BUILDERS.phone();
    if (tel) parts.push('<a href="' + tel + '">call us</a>');
    var mail = LINK_BUILDERS.email();
    if (mail) parts.push('<a href="' + mail + '">email us</a>');
    if (!parts.length) return "";
    var last = parts.pop();
    return " You can also " + (parts.length ? parts.join(", ") + " or " : "") + last + ".";
  }

  function fieldLabel(field) {
    var id = field.id;
    var label = id ? $('label[for="' + id + '"]') : null;
    if (field.tagName === "FIELDSET") label = $("legend", field);
    if (!label) return field.name;
    var clone = label.cloneNode(true);
    $all(".req, .optional, .visually-hidden", clone).forEach(function (n) { n.remove(); });
    return clone.textContent.trim();
  }

  function validPhone(v) {
    if (!/^[+()\d\s-]+$/.test(v)) return false;
    var digits = v.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15;
  }
  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }

  function initForm(form) {
    var type = form.getAttribute("data-form");
    var endpoint = get("forms." + type);
    var status = $(".form-status", form);
    var summary = $(".error-summary", form);
    var submit = $('button[type="submit"]', form);
    var submitLabel = submit ? submit.innerHTML : "";
    var attempted = false;

    function errorNode(field) {
      var id = field.getAttribute("data-error-id") || (field.id || field.getAttribute("data-group")) + "-error";
      return document.getElementById(id);
    }
    function setError(field, message) {
      var node = errorNode(field);
      field.setAttribute("aria-invalid", message ? "true" : "false");
      if (!node) return;
      node.textContent = message || "";
      node.classList.toggle("is-visible", !!message);
    }

    function isConditionallyRequired(field) {
      var cond = field.getAttribute("data-required-if");
      if (!cond) return false;
      var parts = cond.split("=");
      var checked = $('input[name="' + parts[0] + '"]:checked', form);
      return !!checked && checked.value === parts[1];
    }

    function validateField(field) {
      if (field.tagName === "FIELDSET") {
        var groupRequired = field.hasAttribute("data-required-group");
        var anyChecked = $all("input:checked", field).length > 0;
        var msg = groupRequired && !anyChecked ? (field.getAttribute("data-error-msg") || "Please choose an option.") : "";
        setError(field, msg);
        return msg;
      }
      var value = field.value.trim();
      var required = field.required || isConditionallyRequired(field);
      var message = "";
      if (required && !value) {
        message = field.getAttribute("data-error-msg") || "Please enter your " + fieldLabel(field).toLowerCase() + ".";
      } else if (value && field.type === "email" && !validEmail(value)) {
        message = "Please enter a valid email address, for example name@example.com.";
      } else if (value && field.getAttribute("data-validate") === "phone" && !validPhone(value)) {
        message = "Please enter a valid phone number using digits only (you may include +, spaces or dashes).";
      } else if (value && field.type === "date" && field.min && value < field.min) {
        message = "Please choose today or a future date.";
      }
      setError(field, message);
      return message;
    }

    function validateOneOf() {
      var spec = form.getAttribute("data-require-one-of");
      if (!spec) return "";
      var names = spec.split(",");
      var fields = names.map(function (n) { return form.elements[n.trim()]; });
      var anyFilled = fields.some(function (f) { return f && f.value.trim(); });
      var node = document.getElementById(form.id + "-oneof-error");
      var msg = anyFilled ? "" : "Please provide an email address or a phone number so we can reply.";
      if (node) { node.textContent = msg; node.classList.toggle("is-visible", !!msg); }
      fields.forEach(function (f) {
        if (!f) return;
        if (!anyFilled) f.setAttribute("aria-invalid", "true");
        else validateField(f);
      });
      return msg ? { field: fields[0], message: msg } : "";
    }

    function validatables() {
      return $all("input, select, textarea, fieldset[data-required-group]", form).filter(function (f) {
        if (f.closest(".honeypot") || f.type === "hidden" || f.disabled) return false;
        if (f.tagName === "INPUT" && (f.type === "checkbox" || f.type === "radio")) return false;
        return !f.closest("[hidden]");
      });
    }

    function validateAll() {
      var errors = [];
      validatables().forEach(function (f) {
        var msg = validateField(f);
        if (msg) errors.push({ field: f, message: msg });
      });
      var oneOf = validateOneOf();
      if (oneOf) errors.push(oneOf);
      return errors;
    }

    function showSummary(errors) {
      if (!summary) return;
      var list = $("ul", summary);
      list.textContent = "";
      errors.forEach(function (err) {
        var target = err.field.tagName === "FIELDSET" ? $("input", err.field) : err.field;
        var li = el("li");
        var a = el("a", { href: "#" + (target.id || "") }, err.message);
        a.addEventListener("click", function (e) { e.preventDefault(); target.focus(); });
        li.appendChild(a);
        list.appendChild(li);
      });
      summary.hidden = false;
      summary.focus();
    }

    function showStatus(kind, html) {
      if (!status) return;
      status.className = "form-status " + (kind === "success" ? "is-success" : "is-error");
      status.innerHTML = (kind === "success" ? ICON_OK : ICON_ERR) + "<div>" + html + "</div>";
      status.hidden = false;
      status.focus();
    }

    function setLoading(loading) {
      if (!submit) return;
      submit.disabled = loading;
      submit.setAttribute("aria-busy", String(loading));
      submit.innerHTML = loading ? '<span class="spinner" aria-hidden="true"></span> Sending…' : submitLabel;
    }

    // Live re-validation after the first submit attempt
    form.addEventListener("input", function (e) {
      if (!attempted) return;
      var f = e.target.closest("fieldset[data-required-group]") || e.target;
      if (f.matches("input, select, textarea, fieldset")) validateField(f);
      if (form.hasAttribute("data-require-one-of")) validateOneOf();
    });
    form.addEventListener("change", function (e) {
      if (!attempted) return;
      var group = e.target.closest("fieldset[data-required-group]");
      if (group) validateField(group);
    });
    $all("input, select, textarea", form).forEach(function (f) {
      f.addEventListener("blur", function () { if (attempted && f.type !== "checkbox" && f.type !== "radio") validateField(f); });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      attempted = true;
      if (status) status.hidden = true;

      // Spam trap: real visitors never fill the hidden field.
      var trap = $(".honeypot input", form);
      if (trap && trap.value) return;

      var errors = validateAll();
      if (errors.length) { showSummary(errors); return; }
      if (summary) summary.hidden = true;

      if (!hasValue(endpoint)) {
        showStatus("error",
          "<strong>Your request has not been sent.</strong><p>Online submissions are not connected yet, so this form cannot deliver your message." +
          alternativeContactHtml() + "</p>" +
          (DEV ? '<p class="dev-note">Set SITE_CONFIG.forms.' + type + " in assets/js/config.js to connect this form.</p>" : ""));
        return;
      }

      setLoading(true);
      var controller = "AbortController" in window ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, 20000) : null;

      // Combine multi-select values (e.g. several services) into one readable line
      var payload = new FormData(form);
      Array.from(new Set(Array.from(payload.keys()))).forEach(function (key) {
        var all = payload.getAll(key);
        if (all.length > 1) payload.set(key, all.join(", "));
      });

      fetch(endpoint, {
        method: "POST",
        body: payload,
        headers: { Accept: "application/json" },
        signal: controller ? controller.signal : undefined
      })
        .then(function (res) {
          if (!res.ok) throw new Error("Server responded with " + res.status);
          form.reset();
          attempted = false;
          form.dispatchEvent(new Event("zen:reset"));
          showStatus("success", MESSAGES[type].success);
        })
        .catch(function (err) {
          var reason = err && err.name === "AbortError"
            ? "The request took too long to respond."
            : (navigator.onLine === false ? "You appear to be offline." : "Something went wrong while sending.");
          showStatus("error",
            "<strong>Your request was not sent.</strong><p>" + reason + " Your details are still in the form — please check your connection and try again." +
            alternativeContactHtml() + "</p>");
        })
        .then(function () {
          if (timer) clearTimeout(timer);
          setLoading(false);
        });
    });
  }

  /* ---------- 7. Booking page extras ---------- */
  function bookingExtras() {
    var form = $('form[data-form="booking"]');
    if (!form) return;

    // Show the pickup address only when pickup is chosen
    var addressWrap = $("#pickup-address-wrap");
    function syncAddress() {
      var choice = $('input[name="preference"]:checked', form);
      var show = choice && choice.value === "pickup";
      if (addressWrap) addressWrap.hidden = !show;
    }
    $all('input[name="preference"]', form).forEach(function (r) { r.addEventListener("change", syncAddress); });
    form.addEventListener("zen:reset", syncAddress);
    syncAddress();

    // No past dates
    var date = $("#preferred-date", form);
    if (date) {
      var d = new Date();
      date.min = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }

    // Preselect a service from ?service=...
    var params = new URLSearchParams(location.search);
    var svc = params.get("service");
    if (svc) {
      var box = $('input[name="services"][data-slug="' + svc.replace(/[^a-z-]/g, "") + '"]', form);
      if (box) box.checked = true;
    }

    // WhatsApp alternative with a prefilled summary of what has been entered
    var waBtn = $("#booking-whatsapp");
    if (waBtn && hasValue(get("contact.whatsapp"))) {
      waBtn.addEventListener("click", function (e) {
        e.preventDefault();
        var name = form.elements.name.value.trim();
        var services = $all('input[name="services"]:checked', form).map(function (i) { return i.value; });
        var pref = $('input[name="preference"]:checked', form);
        var lines = ["Hello Zen Laundry, I'd like to request a laundry service."];
        if (name) lines.push("Name: " + name);
        lines.push("Service(s): " + (services.length ? services.join(", ") : "(please describe)"));
        if (pref) lines.push("Preference: " + (pref.value === "pickup" ? "Pickup requested" : "Walk-in drop-off"));
        if (form.elements.date.value) lines.push("Preferred date: " + form.elements.date.value);
        if (form.elements.time.value) lines.push("Preferred time: " + form.elements.time.options[form.elements.time.selectedIndex].text);
        if (pref && pref.value === "pickup" && form.elements.address.value.trim()) lines.push("Pickup address: " + form.elements.address.value.trim());
        if (form.elements.instructions.value.trim()) lines.push("Notes: " + form.elements.instructions.value.trim());
        window.open(whatsappUrl(lines.join("\n")), "_blank", "noopener");
      });
    }
  }

  /* ---------- 7b. Order tracking (track.html) ---------- */
  function trackOrder() {
    var form = $("#track-form");
    if (!form) return;
    var status = $(".form-status", form);
    var result = $("#track-result");
    var STATUS = {
      received: ["We have your order", "Your items are being cleaned."],
      ready: ["Ready for collection", "Your laundry is ready. Bring your receipt when you collect."],
      collected: ["Collected", "This order has been collected. Thank you!"],
      "void": ["Cancelled", "This order was cancelled. Please contact us if you weren't expecting this."]
    };

    function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
    function showError(msg) {
      status.className = "form-status is-error";
      status.innerHTML = ICON_ERR + "<div><p>" + esc(msg) + "</p></div>";
      status.hidden = false;
      result.hidden = true;
    }

    var params = new URLSearchParams(location.search);
    if (params.get("order")) form.elements.orderNo.value = params.get("order").replace(/\D/g, "");
    (form.elements.orderNo.value ? form.elements.phoneLast4 : form.elements.orderNo).focus();

    if (!hasValue(CONFIG.ordersApi)) {
      showError("Online order tracking isn't available yet. Please contact us to check on your order.");
      $("p", status).insertAdjacentHTML("beforeend", alternativeContactHtml());
      form.querySelector("button").disabled = true;
      return;
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      status.hidden = true;
      var orderNo = form.elements.orderNo.value.replace(/\D/g, "");
      var last4 = form.elements.phoneLast4.value.replace(/\D/g, "");
      if (!orderNo || last4.length !== 4) return showError("Enter your order number and the last 4 digits of your phone number.");
      var btn = form.querySelector("button");
      btn.disabled = true;
      fetch(CONFIG.ordersApi, { method: "POST", body: JSON.stringify({ action: "track", orderNo: orderNo, phoneLast4: last4 }) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res.ok) return showError(res.error);
          var o = res.data;
          var cur = o.currency || "₦";
          function money(n) { return cur + Number(n).toLocaleString("en-NG"); }
          var s = STATUS[o.status] || [o.status, ""];
          result.innerHTML =
            '<div class="track-status track-' + esc(o.status) + '"><strong>' + esc(s[0]) + "</strong><span>" + esc(s[1]) + "</span></div>" +
            "<h3>Order #" + o.orderNo + "</h3>" +
            '<p class="hint">Received ' + esc(new Date(o.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })) +
            (o.dueDate && o.status === "received" ? " · expected ready " + esc(new Date(o.dueDate + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })) : "") + "</p>" +
            '<table class="track-table"><tbody>' + o.items.map(function (i) {
              return "<tr><td>" + i.qty + " × " + esc(i.item) + "</td><td>" + money(i.qty * i.price) + "</td></tr>";
            }).join("") +
            (o.discount ? "<tr><td>Discount</td><td>−" + money(o.discount) + "</td></tr>" : "") +
            '<tr class="track-total"><td>Total</td><td>' + money(o.total) + "</td></tr>" +
            "<tr><td>Paid</td><td>" + money(o.paid) + "</td></tr>" +
            "<tr><td><strong>Balance</strong></td><td><strong>" + money(o.balance) + "</strong></td></tr></tbody></table>" +
            (o.paymentNotice ? '<p class="hint">' + esc(o.paymentNotice) + "</p>" : "") +
            '<p class="hint">Does this not match your receipt or what you paid? <a href="contact.html">Tell us</a>.</p>';
          result.hidden = false;
        })
        .catch(function () { showError("We couldn't reach the server. Check your connection and try again."); })
        .then(function () { btn.disabled = false; });
    });
  }

  /* ---------- 8. Development banner ---------- */
  function devBanner() {
    if (!DEV) return;
    try { if (sessionStorage.getItem("zen-dev-banner") === "hidden") return; } catch (e) { /* storage unavailable */ }
    var banner = el("div", { "class": "dev-banner", role: "note" });
    banner.textContent = "Development mode: yellow TBC labels mark details awaiting confirmation.";
    var close = el("button", { type: "button" }, "Hide");
    close.addEventListener("click", function () {
      banner.remove();
      try { sessionStorage.setItem("zen-dev-banner", "hidden"); } catch (e) { /* ignore */ }
    });
    banner.appendChild(close);
    document.body.appendChild(banner);
  }

  /* ---------- Init ---------- */
  bindConfig();
  seo();
  navigation();
  backToTop();
  reveal();
  bookingExtras();
  trackOrder();
  $all("form[data-form]").forEach(initForm);
  devBanner();
})();
