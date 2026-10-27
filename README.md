# Zen Laundry Website

Built by KINGSTECH. Static, responsive marketing site using plain HTML, CSS and JavaScript, with no frameworks and no runtime dependencies.

## Pages

| Route | File | Purpose |
|---|---|---|
| `/` | `index.html` | Homepage (hero, services, how it works, individual, corporate, approach, FAQ, CTA) |
| `/services.html` | `services.html` | Detail for all six services, enquiry-based pricing |
| `/corporate.html` | `corporate.html` | Corporate landing page + quote form |
| `/book-pickup.html` | `book-pickup.html` | Laundry request form + WhatsApp alternative |
| `/about.html` | `about.html` | Brand story, values, approach |
| `/contact.html` | `contact.html` | Contact channels, hours, service areas, contact form, map slot |
| `/track.html` | `track.html` | Customer order tracking (needs `ordersApi`) |
| `/privacy.html` | `privacy.html` | Privacy notice for form data (draft, needs client review) |
| `404.html` | `404.html` | Not-found page |

## Project structure

```
assets/
  css/styles.css      Design tokens (colours, type, spacing) + all components
  js/config.js        ALL business details and form destinations (edit here)
  js/main.js          Navigation, config binding, forms, FAQ, back-to-top, SEO data
  images/             Optimised WebP photos (800w + 1400w), og-image.jpg, logo.png (to add)
src/
  partials/           Shared head, header and footer (edit once, applies to every page)
  pages/              Page content
build.py              Assembles src/ into the root .html files
robots.txt, sitemap.xml
```

### Editing pages
1. Edit files in `src/pages/` or `src/partials/`, not the root `.html` files, which are generated.
2. Run `python build.py`.
3. Upload the project root. `src/` and `build.py` don't need to be public.

Business details (phone, WhatsApp, email, address, hours, social links, form endpoints) live **only** in `assets/js/config.js`. Changing them there doesn't require a rebuild.

## How placeholders work

Every unconfirmed detail is `null` in `config.js`. Nothing is invented.

- `developmentMode: true`: missing details show as yellow **TBC** labels, so the client can see what's still needed.
- `developmentMode: false`: missing details are **hidden entirely**. WhatsApp and call buttons only appear once a number is set.

## Before launch: required from Zen Laundry

- [ ] **Original logo**: save as `assets/images/logo.png` (high quality, ideally square, at least 512×512). It's shown at its natural proportions and is never stretched. It's also used as the favicon.
- [ ] Phone (`phoneDisplay`, `phoneTel`), WhatsApp number (`whatsapp`, digits only, international format), email
- [ ] Physical address, service areas, Google Maps embed URL and link
- [ ] Opening hours
- [ ] Social media links (only accounts that exist)
- [ ] Pickup/delivery fees and rules (`operations.pickupDetails`), turnaround (optional), corporate business categories served
- [ ] Final wording for each service and the accepted items (see the yellow notes on the Services page)
- [ ] Approved business story for the About page
- [ ] Approved photographs: current images are royalty-free Unsplash stock (free commercial use) and should be replaced with real business photos where possible. Keep the file names and sizes (800w + 1400w WebP).
- [ ] Genuine customer reviews (optional). A template is commented out in `src/pages/index.html`. Use only real, approved reviews.
- [ ] Privacy policy review and effective date

## Before launch: technical

- [ ] **Connect the forms.** Create three forms with a form service (e.g. [Formspree](https://formspree.io)) or your own backend, and set `forms.booking`, `forms.corporate` and `forms.contact` in `config.js`. Each endpoint must accept a `POST` of form data and return a 2xx status. Until they're set, forms show an honest "not sent" message, never a false success. The hidden `_gotcha` field is a spam trap, and `_subject` sets the email subject (Formspree conventions).
- [ ] Set `siteUrl` in `config.js` once the domain is confirmed. Canonical URLs, `og:url` and absolute structured-data URLs are then added automatically.
- [ ] Replace `https://YOUR-DOMAIN` in `robots.txt` and `sitemap.xml`.
- [ ] Set `developmentMode: false`.
- [ ] Configure the host to serve `404.html` for missing pages, and enable HTTPS.
- [ ] Submit the sitemap in Google Search Console. Set up a Google Business Profile once the address is confirmed (local SEO).

## Launch testing checklist

- [ ] All pages load. Navigation and CTA links work (desktop, tablet, mobile).
- [ ] Logo displays without distortion.
- [ ] Each form validates and delivers a test submission to the agreed inbox. The failure message appears if the endpoint is unreachable.
- [ ] WhatsApp buttons open a chat with the correct business number.
- [ ] Phone and email links work on a mobile phone.
- [ ] No console errors. Keyboard navigation and visible focus work throughout.
- [ ] Page titles, descriptions, sitemap and robots.txt are correct for the live domain.
- [ ] All TBC labels are gone (check with `developmentMode: true` before switching it off).

## Orders & cash control

A small point-of-sale and audit system to stop money going missing. It has three parts:

| Part | Where | Who |
|---|---|---|
| Counter app | `/staff/` | Staff on the shop tablet/phone/PC: new orders, payments, collection, cash drawer |
| Owner dashboard | `/staff/owner.html` | Owner only, from anywhere: sales, cash differences, red flags, prices, staff |
| Track your order | `/track.html` | Customers: check their order and what they were charged |

Data lives in a **Google Sheet that only the owner can open**, with a Google Apps Script backend (`backend/Code.gs`). It's free, the owner owns the data, and staff never see or edit the sheet.

### How it stops theft

| Leak | Control |
|---|---|
| Orders taken "off the books" | Every order gets a **server-issued sequential ticket number** that must be written on every item's tag. Customers get a receipt (printed or WhatsApp) and can check it at `/track.html`. An order that isn't in the system can't be tracked, so customers notice. |
| Overcharging / pocketing the difference | Prices come only from the owner's price list. Staff can't type a price. The customer's receipt and tracking page show the official total. |
| Fake discounts | Every discount needs a reason **and a manager/owner PIN**. Nobody can approve their own. Large discounts are flagged. |
| Voiding a paid sale | Orders can't be deleted. Voids need a reason and a manager/owner PIN, and orders with money recorded **can't be voided at all**. |
| Releasing laundry without payment | Handing over an order with a balance needs a manager/owner PIN and is flagged. |
| Cash missing from the drawer | Each shift opens with a counted float and closes with a **blind count**: staff enter what they counted before they see the expected figure. Differences are shown per shift and per staff member. Cash taken out for expenses must be recorded. |
| "Customer paid by transfer" | Transfer/POS payments need a reference. The dashboard lists them to tick off against the bank statement. The receipt carries a payment notice naming the official account. |
| Using someone else's login | Personal PINs, idle sign-out after 10 minutes, PIN lockout after 5 wrong tries, and every action logged under a name. |
| Editing the sheet | Staff have no sheet access. If an order row is ever deleted, the missing ticket number is flagged at the top of the dashboard. |

### Setup (about 15 minutes, done by the owner's Google account)

1. Create a new Google Sheet, e.g. "Zen Laundry Ledger". **Don't share it with staff.**
2. In the sheet: **Extensions → Apps Script**. Delete the sample code, paste in all of `backend/Code.gs` and save.
3. Reload the sheet. A **Zen Laundry** menu appears. Run **1. Set up sheets** (approve the permissions prompt), then **2. Set / reset owner PIN**. Use 6 digits.
4. In Apps Script: **Deploy → New deployment → Web app**. Set *Execute as* to **Me** and *Who has access* to **Anyone**. Copy the URL ending in `/exec`.
5. Paste it into `assets/js/config.js` as `ordersApi`, then upload the site.
6. Open `/staff/owner.html`, sign in, and add the **price list** and **staff** (Prices and Staff tabs). Give at least one trusted person the **manager** role so discounts and voids can be approved when the owner is away.
7. Open `/staff/` on the shop device, sign in and open the drawer.

When `Code.gs` changes later, update the code in Apps Script, then **Deploy → Manage deployments → Edit → Version: New version**. This keeps the same URL.

Forgotten owner PIN: open the sheet and run **Zen Laundry → Set / reset owner PIN**. Only someone with access to the sheet can do this.

### Shop rules that make it work (agree these with staff)

The software only catches what goes through it. These rules close the gaps:

- **No ticket, no wash.** Every item gets a tag with the order number before it goes in the machine.
- **Every customer gets a receipt**, printed or on WhatsApp. Put up a sign: *"No receipt? Your wash is free — tell the owner."* This turns every customer into a checker.
- **Prefer transfer/POS to the business account.** Show the official account name on a sign at the counter and never accept transfers to a staff member's personal account.
- **Nothing leaves without being handed over in the app.**
- **Owner checks weekly:** red flags, drawer differences, and transfer references against the bank statement. Do occasional surprise drawer counts.
- Change a staff PIN or deactivate the account the day someone leaves.

### Limits

- Needs internet at the counter (mobile data is fine).
- The Google Sheet is fine for many thousands of orders. After a few years, copy old rows to an archive sheet if the apps slow down. Keep the most recent order rows, because ticket numbers continue from the Settings sheet.
- Receipt printing uses the browser print dialog. It works with most 58/80 mm Bluetooth/USB thermal printers that show up as a system printer, and with ordinary printers.

## Notes

- Fonts: Plus Jakarta Sans (Google Fonts) with system fallbacks.
- Accessibility: semantic landmarks, skip link, labelled fields, error summary + inline errors with text and icon (not colour alone), `aria-invalid`, keyboard-operable menu and FAQ (`<details>`), reduced-motion support.
- Out of scope for this version, available as separate additions: online payments, customer accounts. (Order tracking and the owner dashboard are covered by "Orders & cash control".)
