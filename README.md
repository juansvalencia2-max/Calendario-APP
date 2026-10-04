# Calendario de recordatorios con WhatsApp

Aplicación web estática (HTML + CSS + JavaScript, sin dependencias ni compilación) para organizar recordatorios en un calendario y enviarlos por WhatsApp.

## Funciones

- Calendario mensual (lunes a domingo) con navegación entre meses y botón «Hoy».
- Recordatorios con título, fecha, hora, teléfono de WhatsApp, mensaje, color y repetición (diaria, semanal, mensual o anual).
- Botón **Enviar por WhatsApp**: abre `wa.me` con el mensaje ya escrito (al número indicado o, si no hay número, para elegir el contacto).
- Avisos dentro de la app y notificaciones del navegador a la hora del recordatorio (o con antelación: 5 min, 15 min, 30 min, 1 h o 1 día).
- Marcar cada repetición como «Hecho» por separado.
- Lista de los próximos 7 días.
- Exportar e importar los recordatorios en JSON.
- Diseño adaptable a móvil y modo oscuro automático.

Los datos se guardan en el `localStorage` del navegador: no salen de tu dispositivo.

## Uso

Abre `index.html` en el navegador, o sírvelo localmente:

```sh
npx serve .
```

Doble clic en un día crea un recordatorio para esa fecha.

## Limitaciones

- WhatsApp no permite enviar mensajes automáticamente desde una página web: la app prepara el mensaje y tú lo envías con un toque. Para el envío automático hace falta un servidor con la API de WhatsApp Business.
- Los avisos solo aparecen mientras la página está abierta (en una pestaña o en segundo plano).
