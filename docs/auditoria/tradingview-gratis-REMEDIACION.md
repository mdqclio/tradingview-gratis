# Remediación de readiness — tradingview-gratis

- **Repo:** `tradingview-gratis`
- **Fecha:** 2026-06-06
- **Base:** `docs/auditoria/tradingview-gratis.md`
- **Alcance de esta tanda:** solo arreglos seguros, reversibles, en código. Sin
  despliegues, sin reescritura de historial, sin force-push.

**Leyenda:** ✅ hecho · 📄 documentado / parcial · ⏳ pendiente (requiere algo
externo o refactor grande)

---

## ✅ 1) Cabeceras de seguridad (audit punto 5)

**Archivo:** `next.config.ts` (estaba vacío).

Se agregó `async headers()` aplicado a todas las rutas (`/:path*`) con:

- **`Content-Security-Policy`** restrictiva. Lo crítico es `connect-src`, que
  permite explícitamente los orígenes de Binance para no romper la app:
  `connect-src 'self' https://api.binance.com wss://stream.binance.com`.
  Resto: `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`,
  `base-uri 'self'`, `form-action 'self'`, `img-src` con `data:`/`blob:`,
  `worker-src 'self' blob:`, `upgrade-insecure-requests`.
  - `style-src` incluye `'unsafe-inline'` (Tailwind / estilos inline de
    componentes) y `script-src` incluye `'unsafe-inline'` de forma conservadora
    para no romper el arranque sin nonce. Es el único matiz a endurecer si más
    adelante se migra a nonce/hash. **No** se usa `'unsafe-eval'`.
- **`Strict-Transport-Security`**: `max-age=63072000; includeSubDomains; preload`.
- **`X-Content-Type-Options`**: `nosniff`.
- **`X-Frame-Options`**: `DENY` (anti-clickjacking; redundante con
  `frame-ancestors 'none'` pero cubre navegadores viejos).
- **`Referrer-Policy`**: `strict-origin-when-cross-origin`.
- **`Permissions-Policy`**: `camera=(), microphone=(), geolocation=()`.

**Verificado:** `next build` OK; la conexión a Binance (REST + WS) sigue
permitida por `connect-src`. **Reversible:** revertir el archivo a su contenido
vacío original.

> Nota de despliegue: si la app se sirve detrás de un CDN/host (p. ej. Vercel),
> conviene confirmar que el host no elimine ni duplique estas cabeceras. HSTS
> con `preload` solo debe activarse cuando se sirva siempre por HTTPS.

---

## ✅ 2) Caché de corta vida + dedup de peticiones a Binance (audit puntos 7 y 8)

**Archivo:** `src/lib/binance/rest.ts`.

Se agregó un helper `cachedJson(key, ttlMs, loader)` que:

- **Deduplica peticiones idénticas en vuelo** (varias llamadas concurrentes con
  la misma clave comparten la misma `Promise`).
- **Sirve la última respuesta durante un TTL corto** por clave.
- **No cachea fallos** (se borra la entrada en `catch` para permitir reintento
  inmediato).

Aplicado a:

- `fetchKlines` → TTL **5 s**, clave `klines:SYMBOL:interval:limit`.
- `fetchTicker24h` → TTL **4 s**, clave `ticker:SYMBOL`.
- `fetchTickers24h` → TTL **4 s**, clave estable independiente del orden de los
  símbolos (`tickers:` + lista ordenada).

`fetchExchangeSymbols` ya tenía memoización en módulo + `force-cache`; se dejó
intacto.

**Por qué es seguro / bajo riesgo:** los datos en vivo (velas y precio actual)
llegan por **WebSocket**, no por estas llamadas REST. Estos `fetch` solo traen
el *snapshot* inicial / 24h, así que un TTL de pocos segundos no degrada la
frescura percibida, pero sí elimina la ráfaga de peticiones al alternar rápido
símbolo/timeframe (causa típica de bans 418/429 de Binance sobre la IP del
usuario). `BottomPanel` refresca el ticker cada 5 s y `Watchlist` también
sondea; el caché absorbe solapamientos.

**Verificado:** `tsc --noEmit` OK, `eslint` OK, `next build` OK.
**Reversible:** quitar el wrapper `cachedJson` y volver a los `fetch` directos.

> El debounce explícito en el cambio de símbolo/timeframe a nivel de UI no era
> necesario: el caché por clave ya colapsa los cambios rápidos a la misma
> respuesta dentro del TTL. Un debounce adicional en `PriceChart`/store sería
> una mejora menor opcional, no se forzó para mantener el cambio acotado.

---

## ✅ 3) `.gitignore` — `.env*` y `.next/` (audit punto 3)

**Confirmado, sin cambios necesarios.** El `.gitignore` ya cubre:

- `/.next/` (línea de "next.js").
- `.env*` (línea de "env files").
- Además: `*.pem`, `*.key`, `id_rsa*`, `credentials.json`, `.aws/`, `.ssh/`,
  `*.tsbuildinfo`, `.vercel`.

`git ls-files` no muestra ningún `.env` ni `.next/` versionado.

---

## ⏳ Pendiente para el dueño (requiere cuenta/servicio externo)

### Monitoreo / observabilidad (audit punto 10 — 🔴, el más urgente)

Requiere una cuenta externa (Sentry o equivalente) y/o Web Vitals, así que
queda fuera de esta tanda de "solo código seguro". Pasos sugeridos:

1. **Error tracking de cliente:** crear proyecto en Sentry, instalar
   `@sentry/nextjs`, ejecutar `npx @sentry/wizard@latest -i nextjs`. Como la app
   no tiene backend, basta la config de cliente (DSN público).
2. **Reportar fallos hoy silenciosos:**
   - `src/lib/binance/rest.ts`: los `throw new Error("klines/ticker ...")` deben
     reportarse (Sentry `captureException`) además de propagarse.
   - `src/lib/binance/ws.ts`: los `catch {}` y desconexiones del WebSocket deben
     loguear/reportar (hoy se tragan en silencio).
3. **Web Vitals:** exportar `reportWebVitals` o usar `@vercel/analytics` /
   `next/web-vitals` para enviar LCP/INP/CLS.
4. **Alertas:** configurar alertas en Sentry por tasa de errores (detectar caída
   de Binance, cambios de su API, o bans 418/429 masivos).

### Endurecer CSP a nonce/hash (opcional)

`script-src`/`style-src` usan `'unsafe-inline'` por compatibilidad de arranque.
Migrar a nonce por request endurece la protección anti-XSS. No es bloqueante
para una app sin entradas de usuario que generen HTML.

### Proxy server-side con caché de histórico (opcional, audit punto 7)

Un proxy propio (route handler / edge) que cachee el histórico de velas
inmutable trasladaría el rate limit de la IP del usuario a la del servidor y
centralizaría el control. Es un refactor mayor (introduce backend donde hoy no
hay) — se documenta como mejora, no se fuerza.

---

## Verificación de esta tanda

| Check | Resultado |
|-------|-----------|
| `tsc --noEmit` | ✅ sin errores |
| `eslint` (archivos tocados) | ✅ sin errores |
| `next build` | ✅ compila y prerenderiza OK |
| Conexión a Binance tras CSP | ✅ `connect-src` permite REST + WS |

> `next lint` ya no existe en Next.js 16 (se usa `eslint` directo, como en el
> script `lint` del `package.json`).

---

## Archivos modificados

- `next.config.ts` — cabeceras de seguridad (CSP/HSTS/nosniff/frame/referrer/permissions).
- `src/lib/binance/rest.ts` — caché TTL + dedup de peticiones a Binance.
- `docs/auditoria/tradingview-gratis-REMEDIACION.md` — este documento.

`.gitignore` revisado, sin cambios (ya correcto).
