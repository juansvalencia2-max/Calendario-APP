// End-to-end checks run in headless Chromium: `npm test`.
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : req.url.split('?')[0]);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

const rem = (o) => ({ id: o.id, title: o.title, date: o.date, time: o.time, phone: o.phone || '', message: o.message || '',
  repeat: o.repeat || 'none', advance: o.advance || 0, color: 'green', done: {} });

(async () => {
  const server = await serve();
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const results = [];
  const test = async (name, fn) => {
    try { await fn(); results.push(`✔ ${name}`); } catch (e) { results.push(`✘ ${name}\n    ${e.message}`); process.exitCode = 1; }
  };
  const seed = async (items) => {
    await page.evaluate((r) => {
      localStorage.setItem('wa-reminders.v1', JSON.stringify(r));
      localStorage.removeItem('wa-reminders.notified.v1');
    }, items);
    await page.reload();
  };
  const at = async (d) => { await page.clock.setFixedTime(d); };

  await page.clock.install({ time: new Date(2026, 0, 31, 10, 0) });
  await page.goto(url);

  await test('crear un recordatorio desde el formulario', async () => {
    await seed([]);
    await page.click('#btn-new');
    await page.fill('[name=title]', 'Pagar arriendo');
    await page.fill('[name=phone]', '+57 300 123 4567');
    await page.fill('[name=message]', 'Hola, recuerda pagar');
    await page.fill('[name=time]', '18:00');
    await page.click('button[type=submit]');
    assert.equal(await page.locator('#day-list .rem').count(), 1);
    assert.equal(await page.locator('.day.selected .chip').count(), 1);
  });

  await test('número de teléfono demasiado corto se rechaza', async () => {
    await page.click('#btn-new');
    await page.fill('[name=title]', 'X');
    await page.fill('[name=phone]', '123');
    await page.click('button[type=submit]');
    assert.ok(await page.locator('#dialog').evaluate((d) => d.open));
    await page.click('#btn-cancel');
  });

  await test('enlace de WhatsApp con número y mensaje', async () => {
    const href = await page.evaluate(() => {
      let u; window.open = (x) => { u = x; };
      document.querySelector('#day-list .btn-wa').click();
      return u;
    });
    assert.match(href, /^https:\/\/wa\.me\/573001234567\?text=/);
    assert.match(decodeURIComponent(href), /Hola, recuerda pagar/);
  });

  await test('mensual el día 31 cae en el último día de febrero', async () => {
    await seed([rem({ id: 'a', title: 'Fin de mes', date: '2026-01-31', time: '09:00', repeat: 'monthly' })]);
    await page.click('#btn-next');
    const days = await page.locator('.day:not(.other):has(.chip) .day-num').allTextContents();
    assert.deepEqual(days, ['28']);
  });

  await test('anual el 29 de febrero aparece el 28 en años no bisiestos', async () => {
    await seed([rem({ id: 'b', title: 'Cumple', date: '2024-02-29', time: '09:00', repeat: 'yearly' })]);
    await page.click('#btn-next');
    const days = await page.locator('.day:not(.other):has(.chip) .day-num').allTextContents();
    assert.deepEqual(days, ['28']);
  });

  await test('semanal solo el mismo día de la semana', async () => {
    await seed([rem({ id: 'w', title: 'Clase', date: '2026-01-05', time: '09:00', repeat: 'weekly' })]);
    const days = await page.locator('.day:not(.other):has(.chip) .day-num').allTextContents();
    assert.deepEqual(days, ['5', '12', '19', '26']);
  });

  await test('aviso a la hora programada', async () => {
    await at(new Date(2026, 0, 31, 9, 59));
    await seed([rem({ id: 'n', title: 'Llamar', date: '2026-01-31', time: '10:00' })]);
    assert.equal(await page.locator('.toast').count(), 0);
    await at(new Date(2026, 0, 31, 10, 0, 1));
    await page.reload();
    assert.equal(await page.locator('.toast').count(), 1);
    await page.reload();
    assert.equal(await page.locator('.toast').count(), 0, 'no debe repetir el aviso');
  });

  await test('aviso anticipado (1 día antes)', async () => {
    await at(new Date(2026, 0, 30, 10, 0));
    await seed([rem({ id: 'e', title: 'Mañana', date: '2026-01-31', time: '10:00', advance: 1440 })]);
    assert.equal(await page.locator('.toast').count(), 1);
  });

  await test('avisa tras la medianoche de un recordatorio de las 23:50', async () => {
    await at(new Date(2026, 0, 31, 0, 10));
    await seed([rem({ id: 'c', title: 'Casi medianoche', date: '2026-01-30', time: '23:50' })]);
    assert.equal(await page.locator('.toast').count(), 1);
  });

  await test('vencido de hoy sigue en «Próximos» hasta marcarlo hecho', async () => {
    await at(new Date(2026, 0, 31, 12, 0));
    await seed([rem({ id: 'd', title: 'Vencido', date: '2026-01-31', time: '08:00' })]);
    assert.equal(await page.locator('#upcoming-list .rem.overdue').count(), 1);
    await page.locator('#upcoming-list button:has-text("Hecho")').click();
    assert.equal(await page.locator('#upcoming-list .rem').count(), 0);
  });

  await test('«Próximos» muestra cada recordatorio una sola vez', async () => {
    await seed([rem({ id: 'r', title: 'Medicina', date: '2026-01-31', time: '20:00', repeat: 'daily' })]);
    assert.equal(await page.locator('#upcoming-list .rem').count(), 1);
  });

  await test('exportar .ics válido con repetición y alarma', async () => {
    await seed([rem({ id: 'i', title: 'Pago, mensual; ok', date: '2026-01-31', time: '09:00', repeat: 'monthly', advance: 15 })]);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-ics')]);
    const ics = fs.readFileSync(await dl.path(), 'utf8');
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /DTSTART:20260131T090000\r\n/);
    assert.match(ics, /RRULE:FREQ=MONTHLY;BYMONTHDAY=31,-1;BYSETPOS=1\r\n/);
    assert.match(ics, /TRIGGER:-PT15M\r\n/);
    assert.ok(ics.includes('SUMMARY:Pago\\, mensual\\; ok\r\n'), 'texto escapado');
    assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'líneas de máx. 75 bytes');
  });

  await test('enlace a Google Calendar', async () => {
    const href = await page.locator('#day-list a:has-text("Google Calendar")').getAttribute('href');
    const u = new URL(href);
    assert.equal(u.searchParams.get('dates'), '20260131T090000/20260131T093000');
    assert.match(u.searchParams.get('recur'), /FREQ=MONTHLY/);
  });

  await test('importar y exportar copia JSON', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export')]);
    const data = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.equal(data.length, 1);
    await seed([]);
    await page.setInputFiles('#input-import', { name: 'r.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([...data, { bad: true }])) });
    assert.equal(await page.locator('#day-list .rem').count(), 1);
  });

  await test('editar y eliminar', async () => {
    await page.locator('#day-list button:has-text("Editar")').click();
    await page.fill('[name=title]', 'Renombrado');
    await page.click('button[type=submit]');
    assert.equal(await page.locator('#day-list .rem-title').textContent(), 'Renombrado');
    page.once('dialog', (d) => d.accept());
    await page.locator('#day-list button:has-text("Editar")').click();
    await page.click('#btn-delete');
    assert.equal(await page.locator('#day-list .rem').count(), 0);
  });

  await test('service worker registrado (offline / notificaciones Android)', async () => {
    const ok = await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()));
    assert.ok(ok);
  });

  await test('sin desbordamiento horizontal en móvil', async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false);
  });

  await test('sin errores de JavaScript', async () => { assert.deepEqual(errors, []); });

  console.log(results.join('\n'));
  await browser.close();
  server.close();
})();
