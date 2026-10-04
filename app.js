(() => {
  'use strict';

  const STORAGE_KEY = 'wa-reminders.v1';
  const NOTIFIED_KEY = 'wa-reminders.notified.v1';
  const CHECK_INTERVAL_MS = 30 * 1000;
  // Ignore occurrences older than this when deciding whether to alert.
  const LATE_WINDOW_MS = 60 * 60 * 1000;

  const REPEAT_LABELS = {
    none: '', daily: 'Cada día', weekly: 'Cada semana', monthly: 'Cada mes', yearly: 'Cada año',
  };

  // ---------- Date helpers (local time, 'YYYY-MM-DD' strings) ----------

  const pad = (n) => String(n).padStart(2, '0');
  const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromKey = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const todayKey = () => toKey(new Date());
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const fmtLong = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtShort = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtMonth = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' });

  function occursOn(rem, key) {
    if (key < rem.date) return false;
    if (key === rem.date) return true;
    const base = fromKey(rem.date);
    const d = fromKey(key);
    switch (rem.repeat) {
      case 'daily': return true;
      case 'weekly': return base.getDay() === d.getDay();
      // Days that don't exist in the target month (31st, Feb 29) fall on its last day.
      case 'monthly': return clampedDay(base.getDate(), d) === d.getDate();
      case 'yearly': return base.getMonth() === d.getMonth() && clampedDay(base.getDate(), d) === d.getDate();
      default: return false;
    }
  }

  function clampedDay(day, d) {
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return Math.min(day, lastDay);
  }

  function occurrenceTime(rem, key) {
    const [h, m] = rem.time.split(':').map(Number);
    const d = fromKey(key);
    d.setHours(h, m, 0, 0);
    return d;
  }

  // ---------- Storage ----------

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      toast('No se pudo guardar', 'El almacenamiento del navegador no está disponible.');
    }
  }

  let reminders = load(STORAGE_KEY, []);
  let notified = load(NOTIFIED_KEY, {});
  const persist = () => save(STORAGE_KEY, reminders);

  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  function remindersOn(key) {
    return reminders
      .filter((r) => occursOn(r, key))
      .sort((a, b) => a.time.localeCompare(b.time));
  }

  const isDone = (rem, key) => Boolean(rem.done && rem.done[key]);

  // ---------- WhatsApp ----------

  function normalizePhone(phone) {
    return (phone || '').replace(/\D/g, '');
  }

  function whatsappText(rem, key) {
    const when = `${fmtLong.format(fromKey(key))} a las ${rem.time}`;
    const body = rem.message && rem.message.trim() ? rem.message.trim() : rem.title;
    return `⏰ Recordatorio: ${rem.title}\n📅 ${when}\n\n${body}`;
  }

  function whatsappUrl(rem, key) {
    const phone = normalizePhone(rem.phone);
    const text = encodeURIComponent(whatsappText(rem, key));
    return phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
  }

  function openWhatsApp(rem, key) {
    window.open(whatsappUrl(rem, key), '_blank', 'noopener');
  }

  // ---------- Calendar export (Google Calendar / .ics) ----------

  const EVENT_MINUTES = 30;
  const icsStamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

  function rrule(rem) {
    const day = fromKey(rem.date).getDate();
    // BYMONTHDAY=n,-1 + BYSETPOS=1 picks day n, or the last day when the month is shorter.
    const clamp = day > 28 ? `;BYMONTHDAY=${day},-1;BYSETPOS=1` : '';
    switch (rem.repeat) {
      case 'daily': return 'RRULE:FREQ=DAILY';
      case 'weekly': return 'RRULE:FREQ=WEEKLY';
      case 'monthly': return `RRULE:FREQ=MONTHLY${clamp}`;
      case 'yearly': return `RRULE:FREQ=YEARLY;BYMONTH=${fromKey(rem.date).getMonth() + 1}${clamp}`;
      default: return '';
    }
  }

  function eventDetails(rem) {
    const lines = [];
    if (rem.message) lines.push(rem.message);
    lines.push(`Enviar por WhatsApp: ${whatsappUrl(rem, rem.date)}`);
    return lines.join('\n\n');
  }

  function googleCalendarUrl(rem) {
    const start = occurrenceTime(rem, rem.date);
    const end = new Date(start.getTime() + EVENT_MINUTES * 60 * 1000);
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: rem.title,
      dates: `${icsStamp(start)}/${icsStamp(end)}`,
      details: eventDetails(rem),
    });
    const rule = rrule(rem);
    if (rule) params.set('recur', rule);
    return `https://calendar.google.com/calendar/render?${params}`;
  }

  const icsEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

  // RFC 5545: lines longer than 75 octets are folded with CRLF + space.
  function icsFold(line) {
    const bytes = new TextEncoder();
    const out = [];
    let cur = '';
    for (const ch of line) {
      if (bytes.encode(cur + ch).length > (out.length ? 74 : 75)) {
        out.push(cur);
        cur = '';
      }
      cur += ch;
    }
    out.push(cur);
    return out.join('\r\n ');
  }

  function buildIcs(list) {
    const now = new Date();
    const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Calendario WhatsApp//ES', 'CALSCALE:GREGORIAN'];
    for (const rem of list) {
      const start = occurrenceTime(rem, rem.date);
      const end = new Date(start.getTime() + EVENT_MINUTES * 60 * 1000);
      lines.push(
        'BEGIN:VEVENT',
        `UID:${rem.id}@calendario-whatsapp`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${icsStamp(start)}`,
        `DTEND:${icsStamp(end)}`,
        `SUMMARY:${icsEscape(rem.title)}`,
        `DESCRIPTION:${icsEscape(eventDetails(rem))}`,
      );
      const rule = rrule(rem);
      if (rule) lines.push(rule);
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${icsEscape(rem.title)}`,
        `TRIGGER:-PT${rem.advance || 0}M`,
        'END:VALARM',
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    return lines.map(icsFold).join('\r\n') + '\r\n';
  }

  function download(name, content, type) {
    const a = el('a', { href: URL.createObjectURL(new Blob([content], { type })), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- State & rendering ----------

  const $ = (sel) => document.querySelector(sel);
  const grid = $('#grid');
  const monthLabel = $('#month-label');
  const dayLabel = $('#day-label');
  const dayList = $('#day-list');
  const upcomingList = $('#upcoming-list');

  let swRegistration = null;
  let viewYear;
  let viewMonth;
  let selectedKey = todayKey();
  {
    const now = new Date();
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c) node.append(c);
    return node;
  }

  function renderCalendar() {
    monthLabel.textContent = cap(fmtMonth.format(new Date(viewYear, viewMonth, 1)));
    grid.replaceChildren();

    const first = new Date(viewYear, viewMonth, 1);
    const offset = (first.getDay() + 6) % 7; // Monday-first
    const start = addDays(first, -offset);
    const today = todayKey();

    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      const key = toKey(d);
      const items = remindersOn(key);
      const classes = ['day'];
      if (d.getMonth() !== viewMonth) classes.push('other');
      if (key === today) classes.push('today');
      if (key === selectedKey) classes.push('selected');

      const cell = el('button', {
        type: 'button',
        class: classes.join(' '),
        role: 'gridcell',
        'aria-label': `${fmtLong.format(d)}, ${items.length} recordatorio(s)`,
        onclick: () => selectDay(key),
        ondblclick: () => openDialog(null, key),
      }, el('span', { class: 'day-num', text: String(d.getDate()) }));

      items.slice(0, 3).forEach((r) => {
        cell.append(el('span', {
          class: `chip ${r.color || 'green'}${isDone(r, key) ? ' done' : ''}`,
          text: `${r.time} ${r.title}`,
        }));
      });
      if (items.length > 3) cell.append(el('span', { class: 'more', text: `+${items.length - 3} más` }));
      grid.append(cell);
    }
  }

  function reminderItem(rem, key, { showDate = false } = {}) {
    const done = isDone(rem, key);
    const overdue = !done && occurrenceTime(rem, key) < new Date();
    const meta = [showDate ? fmtShort.format(fromKey(key)) : null, rem.time, REPEAT_LABELS[rem.repeat], rem.phone]
      .filter(Boolean).join(' · ');

    return el('li', { class: `rem${done ? ' done' : ''}${overdue ? ' overdue' : ''}` }, [
      el('span', { class: `rem-bar ${rem.color || 'green'}` }),
      el('div', {}, [
        el('div', { class: 'rem-title', text: rem.title }),
        el('div', { class: 'rem-meta' }, [overdue ? el('span', { class: 'badge', text: 'Vencido' }) : null, meta]),
        rem.message ? el('div', { class: 'rem-msg', text: rem.message }) : null,
        el('div', { class: 'rem-actions' }, [
          el('button', { type: 'button', class: 'btn btn-wa', text: 'Enviar por WhatsApp', onclick: () => openWhatsApp(rem, key) }),
          el('button', {
            type: 'button', class: 'btn btn-ghost btn-sm', text: done ? 'Desmarcar' : 'Hecho',
            onclick: () => toggleDone(rem.id, key),
          }),
          el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Editar', onclick: () => openDialog(rem.id) }),
          el('a', {
            class: 'btn btn-ghost btn-sm', href: googleCalendarUrl(rem), target: '_blank', rel: 'noopener',
            title: 'Añadir a Google Calendar para recibir el aviso aunque esta página esté cerrada', text: 'Google Calendar',
          }),
        ]),
      ]),
    ]);
  }

  function renderDay() {
    dayLabel.textContent = selectedKey === todayKey() ? `Hoy, ${fmtLong.format(fromKey(selectedKey))}` : cap(fmtLong.format(fromKey(selectedKey)));
    const items = remindersOn(selectedKey);
    dayList.replaceChildren(...(items.length
      ? items.map((r) => reminderItem(r, selectedKey))
      : [el('li', { class: 'empty', text: 'Sin recordatorios. Pulsa «+ Añadir» para crear uno.' })]));
  }

  function renderUpcoming() {
    const start = new Date();
    const out = [];
    const seen = new Set();
    for (let i = 0; i < 7; i++) {
      const key = toKey(addDays(start, i));
      // Each reminder is listed once, at its next pending occurrence. Today's
      // past items stay listed (as "Vencido") until marked as done.
      remindersOn(key).forEach((r) => {
        if (isDone(r, key) || seen.has(r.id)) return;
        seen.add(r.id);
        out.push([r, key]);
      });
    }
    upcomingList.replaceChildren(...(out.length
      ? out.map(([r, key]) => reminderItem(r, key, { showDate: true }))
      : [el('li', { class: 'empty', text: 'Nada pendiente esta semana. 🎉' })]));
  }

  function render() {
    renderCalendar();
    renderDay();
    renderUpcoming();
  }

  function selectDay(key) {
    selectedKey = key;
    const d = fromKey(key);
    if (d.getMonth() !== viewMonth || d.getFullYear() !== viewYear) {
      viewYear = d.getFullYear();
      viewMonth = d.getMonth();
    }
    render();
  }

  function toggleDone(id, key) {
    const rem = reminders.find((r) => r.id === id);
    if (!rem) return;
    rem.done = rem.done || {};
    if (rem.done[key]) delete rem.done[key];
    else rem.done[key] = true;
    persist();
    render();
  }

  // ---------- Dialog ----------

  const dialog = $('#dialog');
  const form = $('#form');
  const btnDelete = $('#btn-delete');

  function openDialog(id, dateKey) {
    form.reset();
    const rem = id ? reminders.find((r) => r.id === id) : null;
    $('#dialog-title').textContent = rem ? 'Editar recordatorio' : 'Nuevo recordatorio';
    btnDelete.hidden = !rem;
    form.elements.id.value = rem ? rem.id : '';
    form.elements.title.value = rem ? rem.title : '';
    form.elements.date.value = rem ? rem.date : (dateKey || selectedKey);
    form.elements.time.value = rem ? rem.time : '09:00';
    form.elements.phone.value = rem ? rem.phone || '' : '';
    form.elements.message.value = rem ? rem.message || '' : '';
    form.elements.repeat.value = rem ? rem.repeat : 'none';
    form.elements.advance.value = String(rem ? rem.advance : 0);
    form.elements.color.value = rem ? rem.color || 'green' : 'green';
    dialog.showModal();
    form.elements.title.focus();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = form.elements;
    const phone = f.phone.value.trim();
    if (phone && normalizePhone(phone).length < 8) {
      f.phone.setCustomValidity('Introduce un número válido con código de país.');
      f.phone.reportValidity();
      return;
    }
    const data = {
      title: f.title.value.trim(),
      date: f.date.value,
      time: f.time.value,
      phone,
      message: f.message.value.trim(),
      repeat: f.repeat.value,
      advance: Number(f.advance.value),
      color: f.color.value,
    };
    if (!data.title || !data.date || !data.time) return;

    const existing = reminders.find((r) => r.id === f.id.value);
    if (existing) {
      // Changing the schedule invalidates previous alerts and completions.
      if (existing.date !== data.date || existing.time !== data.time || existing.repeat !== data.repeat) {
        existing.done = {};
        clearNotified(existing.id);
      }
      Object.assign(existing, data);
    } else {
      reminders.push({ id: newId(), done: {}, ...data });
    }
    persist();
    dialog.close();
    selectDay(data.date);
  });

  form.elements.phone.addEventListener('input', () => form.elements.phone.setCustomValidity(''));
  $('#btn-cancel').addEventListener('click', () => dialog.close());

  btnDelete.addEventListener('click', () => {
    const id = form.elements.id.value;
    if (!id || !confirm('¿Eliminar este recordatorio?')) return;
    reminders = reminders.filter((r) => r.id !== id);
    clearNotified(id);
    persist();
    dialog.close();
    render();
  });

  // ---------- Alerts ----------

  // Drop alert records older than a few days so storage doesn't grow forever.
  function pruneNotified() {
    const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
    let changed = false;
    for (const [k, t] of Object.entries(notified)) {
      if (t < cutoff) { delete notified[k]; changed = true; }
    }
    if (changed) save(NOTIFIED_KEY, notified);
  }

  function clearNotified(id) {
    for (const k of Object.keys(notified)) if (k.startsWith(`${id}|`)) delete notified[k];
    save(NOTIFIED_KEY, notified);
  }

  function toast(title, body, actions = []) {
    const node = el('div', { class: 'toast', role: 'status' }, [
      el('div', { class: 'toast-title', text: title }),
      body ? el('div', { class: 'toast-body', text: body }) : null,
    ]);
    const close = () => node.remove();
    const row = el('div', { class: 'toast-actions' }, [
      ...actions.map(([label, cls, fn]) => el('button', {
        type: 'button', class: `btn ${cls}`, text: label, onclick: () => { fn(); close(); },
      })),
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Cerrar', onclick: close }),
    ]);
    node.append(row);
    $('#toasts').append(node);
    if (!actions.length) setTimeout(close, 5000);
  }

  function alertReminder(rem, key) {
    const body = `${fmtLong.format(fromKey(key))} a las ${rem.time}${rem.message ? ` — ${rem.message}` : ''}`;
    toast(`⏰ ${rem.title}`, body, [
      ['Enviar por WhatsApp', 'btn-wa', () => openWhatsApp(rem, key)],
      ['Hecho', 'btn-ghost btn-sm', () => toggleDone(rem.id, key)],
    ]);
    showSystemNotification(`⏰ ${rem.title}`, body, `${rem.id}|${key}`, whatsappUrl(rem, key));
  }

  async function showSystemNotification(title, body, tag, url) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const options = { body, tag, icon: 'icon.svg', data: { url } };
    // Android Chrome only allows notifications through a service worker.
    if (swRegistration) {
      try {
        await swRegistration.showNotification(title, options);
        return;
      } catch {
        // Fall through to the page-level API.
      }
    }
    try {
      const n = new Notification(title, options);
      n.onclick = () => { window.focus(); window.open(url, '_blank', 'noopener'); n.close(); };
    } catch {
      // Notifications unavailable in this context; the in-app toast is still shown.
    }
  }

  function checkDue() {
    const now = Date.now();
    const base = new Date();
    // Yesterday catches late-night items right after midnight; looking 2 days
    // ahead lets "avisar 1 día antes" fire for tomorrow's items.
    for (let i = -1; i <= 2; i++) {
      const key = toKey(addDays(base, i));
      for (const rem of remindersOn(key)) {
        const id = `${rem.id}|${key}`;
        if (notified[id] || isDone(rem, key)) continue;
        const at = occurrenceTime(rem, key).getTime();
        const trigger = at - (rem.advance || 0) * 60 * 1000;
        if (now >= trigger && now <= at + LATE_WINDOW_MS) {
          notified[id] = now;
          save(NOTIFIED_KEY, notified);
          alertReminder(rem, key);
        }
      }
    }
  }

  function updateNotifyButton() {
    const btn = $('#btn-notify');
    if (!('Notification' in window)) {
      btn.hidden = true;
      return;
    }
    btn.textContent = Notification.permission === 'granted' ? '🔔 Notificaciones activas' : '🔔 Activar notificaciones';
    btn.disabled = Notification.permission !== 'default';
  }

  $('#btn-notify').addEventListener('click', async () => {
    await Notification.requestPermission();
    updateNotifyButton();
  });

  // ---------- Import / export ----------

  $('#btn-export').addEventListener('click', () => {
    download(`recordatorios-${todayKey()}.json`, JSON.stringify(reminders, null, 2), 'application/json');
  });

  $('#btn-ics').addEventListener('click', () => {
    if (!reminders.length) {
      toast('Nada que exportar', 'Crea al menos un recordatorio.');
      return;
    }
    download(`recordatorios-${todayKey()}.ics`, buildIcs(reminders), 'text/calendar');
  });

  $('#input-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw new Error('formato');
      const valid = data.filter((r) => r && typeof r.title === 'string'
        && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && /^\d{2}:\d{2}$/.test(r.time));
      const ids = new Set(reminders.map((r) => r.id));
      let added = 0;
      for (const r of valid) {
        const rem = {
          id: r.id && !ids.has(r.id) ? String(r.id) : newId(),
          title: r.title, date: r.date, time: r.time,
          phone: typeof r.phone === 'string' ? r.phone : '',
          message: typeof r.message === 'string' ? r.message : '',
          repeat: REPEAT_LABELS[r.repeat] !== undefined ? r.repeat : 'none',
          advance: Number(r.advance) || 0,
          color: ['green', 'blue', 'orange', 'pink', 'purple'].includes(r.color) ? r.color : 'green',
          done: r.done && typeof r.done === 'object' ? r.done : {},
        };
        ids.add(rem.id);
        reminders.push(rem);
        added++;
      }
      persist();
      render();
      toast('Importación completada', `${added} recordatorio(s) añadidos.`);
    } catch {
      toast('No se pudo importar', 'El archivo no es un JSON de recordatorios válido.');
    }
  });

  // ---------- Navigation ----------

  $('#btn-prev').addEventListener('click', () => {
    viewMonth -= 1;
    if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
    renderCalendar();
  });
  $('#btn-next').addEventListener('click', () => {
    viewMonth += 1;
    if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
    renderCalendar();
  });
  $('#btn-today').addEventListener('click', () => selectDay(todayKey()));
  $('#btn-new').addEventListener('click', () => openDialog(null));
  $('#btn-add-day').addEventListener('click', () => openDialog(null, selectedKey));

  // Keep "today" highlighting, "Vencido" badges and the upcoming list fresh.
  let lastToday = todayKey();
  setInterval(() => {
    checkDue();
    if (todayKey() !== lastToday) {
      lastToday = todayKey();
      render();
    } else if (!dialog.open) {
      renderDay();
      renderUpcoming();
    }
  }, CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkDue(); renderUpcoming(); } });

  // Service workers need http(s); opened as file:// the app still works without one.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js')
      .then((reg) => { swRegistration = reg; })
      .catch(() => {});
  }

  updateNotifyButton();
  pruneNotified();
  render();
  checkDue();
})();
