# Calendario de recordatorios con WhatsApp

Aplicación web estática (HTML + CSS + JavaScript, sin dependencias ni compilación) para organizar recordatorios en un calendario y enviarlos por WhatsApp.

## Funciones

- Calendario mensual (lunes a domingo) con navegación entre meses y botón «Hoy».
- Recordatorios con título, fecha, hora, teléfono de WhatsApp, mensaje, color y repetición (diaria, semanal, mensual o anual).
- Botón **Enviar por WhatsApp**: abre `wa.me` con el mensaje ya escrito (al número indicado o, si no hay número, para elegir el contacto).
- Avisos dentro de la app y notificaciones del navegador a la hora del recordatorio (o con antelación: 5 min, 15 min, 30 min, 1 h o 1 día).
- **Google Calendar** (botón en cada recordatorio) y **Exportar calendario** (`.ics` para Google, Apple Calendar u Outlook): el calendario del teléfono avisa aunque la app esté cerrada.
- Marcar cada repetición como «Hecho» por separado; los no hechos de hoy se marcan como «Vencido».
- Lista de los próximos 7 días (cada recordatorio una vez, en su próxima fecha).
- Repeticiones mensuales/anuales en días que no existen (31, 29 de febrero) caen en el último día del mes.
- Copia de seguridad: exportar e importar en JSON.
- Instalable como app (PWA), funciona sin conexión y con notificaciones en Android cuando se sirve por `http(s)`.
- Diseño adaptable a móvil y modo oscuro automático.

Los datos se guardan en el `localStorage` del navegador: no salen de tu dispositivo.

## Uso

Abre `index.html` en el navegador, o sírvelo localmente:

```sh
npx serve .
```

Doble clic en un día (o «+ Añadir») crea un recordatorio para esa fecha.

Para instalarla en el móvil y recibir notificaciones, publícala en un servidor con HTTPS (por ejemplo GitHub Pages) y usa «Añadir a pantalla de inicio».

## Tests

```sh
npm install
npm test
```

Ejecuta pruebas de extremo a extremo en Chromium sin interfaz (formulario, repeticiones, avisos, exportaciones, móvil).

## Limitaciones

- WhatsApp no permite enviar mensajes automáticamente desde una página web: la app prepara el mensaje y tú lo envías con un toque. Para el envío automático hace falta un servidor con la API de WhatsApp Business.
- Los avisos propios de la app solo aparecen mientras la página está abierta (en una pestaña o en segundo plano). Para avisos con la app cerrada, añade los recordatorios a Google Calendar o importa el `.ics`.
