/* ==========================================================================
   Zen Laundry — central business configuration
   --------------------------------------------------------------------------
   This is the ONLY place business details should be edited.
   Every page reads from this file, so nothing is hardcoded in multiple places.

   RULES
   - Leave a value as null until Zen Laundry has confirmed it.
   - null values are NEVER shown as fake data:
       developmentMode: true  -> a yellow "TBC" placeholder is shown instead
       developmentMode: false -> the item is hidden completely
   - Set developmentMode to false before launch.
   ========================================================================== */

window.SITE_CONFIG = {
  /* Set to false before the site goes live. */
  developmentMode: true,

  business: {
    name: "Zen Laundry",
    tagline: "Fresh Clothes. Less Stress. That's Zen.",
    description:
      "Zen Laundry provides washing and ironing, dry cleaning, pickup and delivery, corporate laundry, duvet and bedsheet care, and shoe and bag cleaning for individuals and businesses."
  },

  /* Production domain, e.g. "https://www.zenlaundry.example". No trailing slash.
     When set, canonical and Open Graph URLs are added automatically. */
  siteUrl: null,

  contact: {
    /* Phone as it should be displayed, e.g. "0800 000 0000" */
    phoneDisplay: null,
    /* Phone in international format for tel: links, e.g. "+2348000000000" */
    phoneTel: null,
    /* WhatsApp number: digits only, international format, no "+" or spaces,
       e.g. "2348000000000". Enables every WhatsApp button on the site. */
    whatsapp: null,
    email: null
  },

  location: {
    /* Full physical address as a single line */
    address: null,
    /* Areas covered for pickup and delivery, e.g. "Ikeja, Yaba and Surulere" */
    serviceAreas: null,
    /* Google Maps embed URL (the src of the embed iframe), once address is confirmed */
    mapEmbedUrl: null,
    /* Google Maps share link for "Get directions" */
    mapLink: null
  },

  /* Opening hours, one line per entry, e.g. ["Monday – Friday: 8:00am – 6:00pm", "Saturday: 9:00am – 4:00pm"] */
  hours: null,

  /* Only fill these if Zen Laundry wants them published. */
  operations: {
    /* e.g. "Most orders are ready within 48 hours." */
    turnaround: null,
    /* e.g. "Pickup and delivery fees depend on your location and will be confirmed when we contact you." */
    pickupDetails: null,
    /* Business categories confirmed for corporate laundry, e.g. ["Offices", "Hotels", "Schools"] */
    corporateAudiences: null
  },

  /* Social links: full URLs. Leave null if the account does not exist. */
  social: {
    instagram: null,
    facebook: null,
    tiktok: null,
    x: null,
    linkedin: null
  },

  /* Form destinations.
     Each must be an endpoint that accepts a POST of form data and returns a
     2xx status on success (e.g. a Formspree form URL "https://formspree.io/f/xxxxxxx",
     or your own backend). Until set, forms show an honest "not connected yet"
     message — they NEVER show a false success. */
  forms: {
    booking: null,
    corporate: null,
    contact: null
  },

  /* Orders & cash control: the Google Apps Script web app URL
     (ends in "/exec"). Powers the staff counter app (/staff/), the owner
     dashboard (/staff/owner.html) and the public "Track your order" page.
     See README.md → "Orders & cash control". */
  ordersApi: "https://script.google.com/macros/s/AKfycbx9KKFkK2vi38iAvoZS8S3CUCSC9pg2HHS0z_I5BX5PkfxOg_051ejpf8hxdbMUyKCh/exec"
};
