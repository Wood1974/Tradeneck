/* TradeDeck analytics — GA4 loader + typed event wrapper.
 *
 * SETUP (one step): create a GA4 property at analytics.google.com, then paste
 * its Measurement ID below. Until you do, every call below is a safe no-op —
 * nothing loads, nothing is sent, no console noise.
 *
 * Once the ID is set, mark `sign_up` and `escrow_funded` as KEY EVENTS in
 * GA4 → Admin → Events. Without that, GA4 cannot attribute revenue to a
 * traffic source and "is SEO working?" stays unanswerable.
 */
(function () {
  'use strict';

  var GA_MEASUREMENT_ID = ''; // <-- paste 'G-XXXXXXXXXX' here

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  var enabled = /^G-[A-Z0-9]+$/i.test(GA_MEASUREMENT_ID);

  if (enabled) {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
    document.head.appendChild(s);

    gtag('js', new Date());
    // send_page_view is off because the app is a SPA: the URL changes via
    // history.pushState, which GA4's automatic pageview never sees. td.page()
    // fires them explicitly instead — including the first one, below.
    gtag('config', GA_MEASUREMENT_ID, { send_page_view: false });
  }

  /* Events worth having. Anything not on this list is noise; anything on it
   * answers a question about whether the business works. */
  var td = {
    enabled: enabled,

    page: function (path, title) {
      if (!enabled) return;
      gtag('event', 'page_view', {
        page_path: path || location.pathname,
        page_title: title || document.title,
        page_location: location.origin + (path || location.pathname)
      });
    },

    event: function (name, params) {
      if (!enabled) return;
      gtag('event', name, params || {});
    },

    // ---- funnel shorthands -------------------------------------------------
    signUp:        function (m)        { td.event('sign_up', { method: m || 'email' }); },
    login:         function (m)        { td.event('login',   { method: m || 'email' }); },
    jobPosted:     function (t, c, v)  { td.event('job_posted',  { trade: t, county: c, value: v }); },
    jobApplied:    function (id, t)    { td.event('job_applied', { job_id: id, trade: t }); },
    escrowFunded:  function (id, cents){ td.event('escrow_funded', {
                                           currency: 'USD',
                                           value: (cents || 0) / 100,
                                           job_id: id
                                         }); },
    drawSubmitted: function (id)       { td.event('draw_submitted', { draw_id: id }); },
    drawApproved:  function (id)       { td.event('draw_approved',  { draw_id: id }); },
    stripeConnect: function ()         { td.event('stripe_connect_started'); },
    cta:           function (label, loc){ td.event('cta_click', { cta_label: label, cta_location: loc }); }
  };

  window.td = td;

  // Marketing pages are static, so fire their pageview immediately. The app
  // (index.html) sets data-manual-pageview and calls td.page() from its router.
  if (!document.currentScript || !document.currentScript.hasAttribute('data-manual-pageview')) {
    td.page();
  }
})();
