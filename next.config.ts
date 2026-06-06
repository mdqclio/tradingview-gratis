import type { NextConfig } from "next";

/**
 * Content-Security-Policy.
 *
 * La app es 100% cliente y habla directo con la API pública de Binance:
 *  - REST:  https://api.binance.com
 *  - WS:    wss://stream.binance.com
 *
 * Esos orígenes deben estar permitidos en connect-src o la app deja de
 * cargar datos. El resto se mantiene lo más restrictivo posible.
 *
 * Nota: Next.js (App Router) en producción no necesita 'unsafe-eval'.
 * Se incluye 'unsafe-inline' en style-src porque Tailwind / componentes
 * inyectan estilos inline; los scripts inline de Next usan nonce propio,
 * pero para no romper el arranque sin nonce se permite 'unsafe-inline'
 * en script-src de forma conservadora. Ajustar a nonce/hash si se
 * endurece más adelante.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://api.binance.com wss://stream.binance.com",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
