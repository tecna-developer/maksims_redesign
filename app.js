/* Maksims OÜ — progressive enhancement only.
 *
 * Text and language switching are handled at build time (see build.mjs), so
 * nothing here is required for the page to be readable, navigable or submittable.
 * Loaded with `defer`.
 */
(function () {
  'use strict';

  var doc = document;
  var $ = function (sel, root) { return (root || doc).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); };

  /* ---------------------------------------------------------- mobile nav --- */

  var toggle = $('#navToggle');
  var mobileNav = $('#mobileNav');

  if (toggle && mobileNav) {
    var setNav = function (open) {
      mobileNav.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      var label = open ? toggle.getAttribute('data-label-close') : toggle.getAttribute('data-label-open');
      if (label) toggle.setAttribute('aria-label', label);
    };

    toggle.addEventListener('click', function () {
      setNav(!mobileNav.classList.contains('open'));
    });

    $$('a', mobileNav).forEach(function (a) {
      a.addEventListener('click', function () { setNav(false); });
    });

    // Escape closes the menu and hands focus back to the button that opened it,
    // rather than stranding the user inside a panel they can't see.
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mobileNav.classList.contains('open')) {
        setNav(false);
        toggle.focus();
      }
    });
  }

  /* ------------------------------------------------------- reveal on scroll - */

  var reveals = $$('.reveal');
  if (reveals.length) {
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry, i) {
          if (!entry.isIntersecting) return;
          entry.target.style.transitionDelay = (i % 4) * 45 + 'ms';
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        });
      }, { threshold: 0.15 });
      reveals.forEach(function (el) { io.observe(el); });
    } else {
      reveals.forEach(function (el) { el.classList.add('in-view'); });
    }
  }

  /* --------------------------------------------------------- click-to-map --- */

  var mapLoad = $('#mapLoad');
  var mapHolder = $('#mapHolder');
  if (mapLoad && mapHolder) {
    mapLoad.addEventListener('click', function () {
      var frame = $('iframe', mapHolder);
      if (frame && !frame.src) frame.src = frame.getAttribute('data-src');
      mapHolder.hidden = false;
      mapLoad.parentNode.removeChild(mapLoad);
    });
  } else if (mapLoad) {
    mapLoad.parentNode.removeChild(mapLoad);
  }

  /* ---------------------------------------------------------------- form --- */

  var form = $('#quoteForm');
  if (!form) return;

  var statusBox = $('#formStatus');
  var submitBtn = $('#quoteSubmit');
  var started = $('#fStarted');
  if (started) started.value = String(Date.now());

  // Don't offer a start date in the past.
  var startDate = $('[data-min="today"]', form);
  if (startDate) startDate.min = new Date().toISOString().slice(0, 10);

  var MSG = {
    required: form.getAttribute('data-msg-required'),
    email: form.getAttribute('data-msg-email'),
    consent: form.getAttribute('data-msg-consent'),
    summary: form.getAttribute('data-msg-summary'),
    okTitle: form.getAttribute('data-msg-ok-title'),
    okBody: form.getAttribute('data-msg-ok-body'),
    errTitle: form.getAttribute('data-msg-err-title'),
    errBody: form.getAttribute('data-msg-err-body')
  };

  function showError(field, message) {
    var box = doc.getElementById('e-' + field.id.replace(/^f-/, ''));
    field.setAttribute('aria-invalid', 'true');
    if (box) { box.textContent = message; box.classList.add('show'); }
  }

  function clearError(field) {
    var box = doc.getElementById('e-' + field.id.replace(/^f-/, ''));
    field.removeAttribute('aria-invalid');
    if (box) { box.textContent = ''; box.classList.remove('show'); }
  }

  function validate() {
    var bad = [];
    $$('[required]', form).forEach(function (field) {
      clearError(field);
      var empty = field.type === 'checkbox' ? !field.checked : !field.value.trim();
      if (empty) {
        showError(field, field.type === 'checkbox' ? MSG.consent : MSG.required);
        bad.push(field);
        return;
      }
      if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(field.value.trim())) {
        showError(field, MSG.email);
        bad.push(field);
      }
    });
    return bad;
  }

  // Clear a field's error as soon as the user starts fixing it.
  $$('[required]', form).forEach(function (field) {
    field.addEventListener('input', function () {
      if (field.hasAttribute('aria-invalid')) clearError(field);
    });
    field.addEventListener('change', function () {
      if (field.hasAttribute('aria-invalid')) clearError(field);
    });
  });

  function setStatus(kind, title, body) {
    if (!statusBox) return;
    statusBox.className = 'form-status show form-status--' + kind;
    statusBox.innerHTML = '';
    if (title) {
      var h = doc.createElement('h3');
      h.textContent = title;
      statusBox.appendChild(h);
    }
    var p = doc.createElement('p');
    p.textContent = body;
    statusBox.appendChild(p);
    statusBox.focus();
    statusBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function setBusy(busy) {
    if (!submitBtn) return;
    submitBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
    submitBtn.textContent = busy
      ? submitBtn.getAttribute('data-label-sending')
      : submitBtn.getAttribute('data-label');
  }

  /** Hand the enquiry to the visitor's mail client when no endpoint is configured. */
  function sendByMail(data) {
    var lines = [];
    $$('label', form).forEach(function (label) {
      var id = label.getAttribute('for');
      if (!id) return;
      var field = doc.getElementById(id);
      if (!field || field.type === 'checkbox' || !field.name) return;
      var value = data.get(field.name);
      if (value) lines.push(label.textContent.replace(/\s*\*\s*$/, '').trim() + ': ' + value);
    });
    ['legal_form', 'stock_accounting', 'fixed_assets', 'company_status', 'access_24h'].forEach(function (name) {
      var group = form.querySelector('[name="' + name + '"]');
      var legend = group && group.closest('fieldset') && $('legend', group.closest('fieldset'));
      if (legend && data.get(name)) lines.push(legend.textContent.trim() + ': ' + data.get(name));
    });
    var subject = (data.get('company_name') || '') + ' — ' + (form.getAttribute('data-subject') || 'Hinnapäring');
    window.location.href = 'mailto:' + form.getAttribute('data-email') +
      '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(lines.join('\n'));
  }

  form.addEventListener('submit', function (e) {
    var bad = validate();
    if (bad.length) {
      e.preventDefault();
      setStatus('error', null, MSG.summary);
      bad[0].focus();
      return;
    }

    // Honeypot: a real person never sees this field, so a value means a bot.
    // Fail silently — telling the bot it was caught only helps it adapt.
    if (form.website && form.website.value) { e.preventDefault(); return; }

    var data = new FormData(form);

    if (form.getAttribute('data-mode') === 'mailto') {
      e.preventDefault();
      sendByMail(data);
      setStatus('ok', MSG.okTitle, MSG.okBody);
      return;
    }

    // Without fetch the form posts normally — the native path still works.
    if (!window.fetch) return;

    e.preventDefault();
    setBusy(true);

    fetch(form.action, { method: 'POST', body: data, headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        setStatus('ok', MSG.okTitle, MSG.okBody);
        form.reset();
        if (started) started.value = String(Date.now());
      })
      .catch(function () {
        // Never claim success we can't verify — the visitor gets the real
        // outcome and a way to reach us regardless.
        setStatus('error', MSG.errTitle, MSG.errBody);
      })
      .then(function () { setBusy(false); });
  });
})();
