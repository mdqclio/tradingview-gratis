# Auditoría de readiness para producción — tradingview-gratis

- **Repo:** `tradingview-gratis`
- **Fecha:** 2026-06-06
- **Stack:** Next.js 16.2.6 (App Router) · React 19 · TypeScript 5 · Tailwind v4 · shadcn/base-ui · zustand · lightweight-charts. Datos en vivo desde la **API pública de Binance** (REST `api.binance.com` + WebSocket `stream.binance.com`).
- **Naturaleza:** Aplicación **100% cliente / estática**. No hay backend propio, ni API routes, ni middleware, ni base de datos, ni autenticación, ni variables de entorno. Es un visor de charts de cripto que consume directamente la API pública de Binance desde el navegador.

**Leyenda:** 🟢 ok · 🟡 mejorable · 🔴 bloqueante · ⚪ N/A

---

## 1) Front comprimido / sin source maps / sin secretos cliente (NEXT_PUBLIC) — 🟢

`next build` ya minifica y comprime el bundle. Los source maps de producción están **desactivados por defecto** (no se activó `productionBrowserSourceMaps` en `next.config.ts`, que está vacío). **No existe ninguna variable `NEXT_PUBLIC_*`** ni uso de `process.env` en `src/` (grep sin resultados): no hay riesgo de filtrar claves al cliente porque no hay claves. Toda la lógica es pública por diseño (consume la API pública de Binance sin credenciales).

**Riesgo:** Bajo. Único matiz: al ser todo cliente, la lógica de negocio (indicadores, llamadas a Binance) es totalmente visible — esperable y aceptable para un visor open source.

## 2) RLS / aislamiento de datos por usuario — ⚪ N/A

No hay usuarios, ni cuentas, ni datos persistidos por usuario, ni base de datos. No aplica el concepto de Row Level Security ni de aislamiento de datos.

**Riesgo:** N/A.

## 3) Git sin secretos (.env) — 🟢

`git ls-files` no muestra **ningún archivo `.env`** versionado. El `.gitignore` cubre `.env*`, `*.pem`, `*.key`, `id_rsa*`, `credentials.json`, `.aws/`, `.ssh/`. El historial completo (`git log --all -p`) no contiene secretos reales: las coincidencias de "api_key/secret/dotenv" son únicamente ruido del `package-lock.json` (dependencia transitiva `@dotenvx/dotenvx`, no usada en el código). Historial corto y limpio (3 commits).

**Riesgo:** Bajo.

## 4) API routes con auth / permisos / validación — ⚪ N/A

**No existe ninguna API route** (`src/app/**/route.*` vacío) ni handler server-side propio. Tampoco hay middleware. El cliente habla directo con Binance. No hay superficie de API propia que proteger.

**Riesgo:** N/A — aunque ver punto 7 (las llamadas a Binance ocurren desde el navegador del usuario, sin proxy propio).

## 5) Hosting / entornos / env vars — 🟡

Proyecto generado con Create Next App, orientado a Vercel (assets `vercel.svg`, `.vercel` en `.gitignore`). Al no haber backend ni env vars, el deploy es trivial (estático/edge). **Falta**, sin embargo, configuración explícita de producción: no hay `.env.example` documentando entornos (aceptable porque no hay vars), no hay cabeceras de seguridad (CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`) en `next.config.ts`, y el README no documenta el procedimiento de deploy ni entornos (staging/prod).

**Riesgo:** Medio-bajo. Sin cabeceras de seguridad la app es más vulnerable a clickjacking/MIME-sniffing/inyección; conviene añadir `headers()` con CSP antes de exponer en producción.

## 6) Login / sesiones / vulnerabilidades — ⚪ N/A

No hay sistema de login, sesiones, cookies de auth ni manejo de credenciales. No aplica la superficie típica de vulnerabilidades de autenticación.

**Riesgo:** N/A.

## 7) Rate limiting — 🟡

No hay rutas propias que limitar. **Pero** todas las llamadas (REST klines/ticker/exchangeInfo y el WebSocket) se hacen **desde el navegador del usuario contra Binance**, no hay proxy propio. Implicaciones:

- El rate limit lo aplica **Binance** sobre la **IP del usuario final**. Un usuario que abra muchos símbolos/timeframes podría toparse con bans temporales de Binance (HTTP 418/429), degradando su propia experiencia.
- `fetchKlines`/`fetchTicker24h` usan `cache: "no-store"` → cada cambio de símbolo/timeframe golpea Binance de nuevo, sin throttling ni debounce visible a nivel de capa de datos.
- Riesgo de costo monetario: **ninguno** — Binance es gratuito y no hay servicio de pago ni LLM detrás. Mitiga mucho la gravedad.

**Riesgo:** Medio-bajo. No hay costo económico, pero la UX puede romperse por rate limits de Binance del lado del cliente. Un proxy/caché server-side mitigaría y centralizaría el control.

## 8) Caché — 🟡

Mixto y mejorable:

- `fetchExchangeSymbols` usa `cache: "force-cache"` + memoización en módulo (`cachedSymbols`) — bien.
- `fetchKlines`, `fetchTicker24h`, `fetchTickers24h` usan `cache: "no-store"` — razonable para datos en vivo, pero el histórico de velas (klines cerradas) podría cachearse con `revalidate` para reducir golpes a Binance.
- No hay ISR ni Next Data Cache aprovechado (todo es client-side, fuera del cache server de Next).
- WS singleton por pestaña con reconexión exponencial — buena práctica.

**Riesgo:** Bajo. Funciona, pero hay margen para cachear histórico inmutable.

## 9) Escalabilidad — 🟢

Al ser una app estática/cliente, escala trivialmente vía CDN/edge: no hay servidor con estado, no hay base de datos, no hay cuello de botella propio. La carga real recae en Binance (su infraestructura) y en el navegador de cada usuario. El singleton de WebSocket evita múltiples conexiones por pestaña.

**Riesgo:** Bajo. El único límite de escala es el rate limit de Binance por IP de usuario (ver punto 7), no la app en sí.

## 10) Monitoreo / alertas — 🔴

**No hay absolutamente nada de observabilidad:** sin error tracking (Sentry/similar), sin analytics, sin logging de errores de cliente, sin reporte de fallos de fetch/WS, sin Web Vitals, sin alertas. Los `catch {}` en el WS (`ws.ts`) y los `throw new Error` en `rest.ts` se pierden silenciosamente: si Binance cambia su API, banea la IP o cae el WS, **nadie se entera**. Para un producto en producción esto es un punto ciego total.

**Riesgo:** Alto. Imposible detectar incidentes, regresiones de rendimiento o caídas de la dependencia externa (Binance) sin telemetría.

---

## Tabla resumen

| # | Punto | Estado |
|---|-------|--------|
| 1 | Front comprimido / sin source maps / sin secretos cliente | 🟢 |
| 2 | RLS / aislamiento de datos por usuario | ⚪ N/A |
| 3 | Git sin secretos (.env) | 🟢 |
| 4 | API routes con auth / permisos / validación | ⚪ N/A |
| 5 | Hosting / entornos / env vars | 🟡 |
| 6 | Login / sesiones / vulnerabilidades | ⚪ N/A |
| 7 | Rate limiting | 🟡 |
| 8 | Caché | 🟡 |
| 9 | Escalabilidad | 🟢 |
| 10 | Monitoreo / alertas | 🔴 |

**Conteo:** 🟢 3 · 🟡 3 · 🔴 1 · ⚪ 3

---

## Los 3 arreglos más urgentes

1. **🔴 Monitoreo / alertas (punto 10):** integrar error tracking de cliente (Sentry o equivalente) + Web Vitals, y reportar explícitamente los fallos de fetch a Binance y desconexiones del WS. Hoy todo error se traga en silencio; sin esto no hay forma de detectar caídas de la dependencia externa.
2. **🟡 Cabeceras de seguridad (punto 5):** añadir `async headers()` en `next.config.ts` con CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, HSTS y frame-ancestors. La app no tiene secretos, pero sigue expuesta a clickjacking y MIME-sniffing en producción.
3. **🟡 Resiliencia frente al rate limit de Binance (puntos 7 y 8):** introducir debounce/throttle en los cambios de símbolo/timeframe y, idealmente, un proxy server-side con caché del histórico de velas inmutable. Evita que el usuario sea baneado por Binance (418/429) y centraliza el control de tasa fuera de su IP.
