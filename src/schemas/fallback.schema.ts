// ============================================================
// Fallback Schema — src/schemas/fallback.schema.ts
// Source: docs/config/features/fallback.md
// Used by: VLESS inbound, Trojan inbound
// ============================================================

import { z } from 'zod';

export const FallbackObjectSchema = z.object({
  /** Match TLS SNI. Empty = any. Default: "" */
  name: z.string().optional(),
  /** Match TLS ALPN negotiation result. Empty = any. Default: "" */
  alpn: z.string().optional(),
  /** Match first-packet HTTP PATH. Must start with "/". Empty = any */
  path: z.string().optional(),
  /**
   * Destination for TLS-decrypted TCP traffic (REQUIRED).
   * Supports:
   * - number: port (e.g. 80)
   * - string: "addr:port" (TCP), or Unix socket absolute path, or just "80"
   */
  dest: z.union([z.number(), z.string()]),
  /**
   * How dest is reached: "tcp", "unix" or "serve". Empty is worked out from
   * dest (v26.10.21:infra/conf/vless.go:187-206, the same in trojan.go).
   */
  type: z.string().optional(),
  /** Send PROXY protocol. 0 = disabled (default), 1 = v1, 2 = v2 */
  xver: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
}).passthrough();

export type FallbackObject = z.infer<typeof FallbackObjectSchema>;
