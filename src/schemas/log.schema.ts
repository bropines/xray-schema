// ============================================================
// Log Schema — src/schemas/log.schema.ts
// Source: docs/config/log.md
// ============================================================

import { z } from 'zod';
import { LogLevelSchema } from './primitives.js';

export const LogSchema = z.object({
  /** Path to access log file. Empty = stdout, "none" = discard */
  access: z.string().optional(),
  /** Path to error log file. Empty = stdout, "none" = discard */
  error: z.string().optional(),
  /**
   * Log level: debug, info, warning, error, none. The tag is `loglevel` up to
   * 26.10.31 and `logLevel` from 26.11.9 (v26.11.9:infra/conf/log.go:21); Go
   * matches JSON keys ignoring case, so either spelling loads on every release.
   */
  loglevel: LogLevelSchema.optional(),
  /** `loglevel` as 26.11.9 spells it; see there. */
  logLevel: LogLevelSchema.optional(),
  /** Enable DNS query logging (requires debug level) */
  dnsLog: z.boolean().optional(),
  /** Mask IP addresses in logs. "quarter"=mask 1/4, "half"=mask 1/2, "full"=mask all, or custom mask string */
  maskAddress: z.string().optional(),
}).passthrough();

export type LogConfig = z.infer<typeof LogSchema>;
