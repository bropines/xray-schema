// ============================================================
// HTTP Outbound — Source: docs/config/outbounds/http.md
// ============================================================
import { z } from 'zod';
import { UserLevelSchema } from '../primitives.js';

/**
 * The grouped shape: `servers[0]`, its login in `users[0]`
 * (v26.10.21:infra/conf/http.go). Build() reads it only when the flat
 * `address` is absent — core/xray/outbound-credentials.ts says which shape a
 * config is in.
 */
export const HttpOutboundServerSchema = z.object({
  address: z.string().optional(),
  port: z.number().int().optional(),
  users: z.array(z.object({
    user: z.string().optional(),
    pass: z.string().optional(),
    level: UserLevelSchema,
    email: z.string().optional(),
  }).passthrough()).optional(),
}).passthrough();

export const HttpOutboundSettingsSchema = z.object({
  servers: z.array(HttpOutboundServerSchema).optional(),
  address: z.string().optional(),
  port: z.number().int().optional(),
  user: z.string().optional(),
  pass: z.string().optional(),
  level: UserLevelSchema,
  email: z.string().optional(),
  /** Custom HTTP headers (key → value) */
  headers: z.record(z.string(), z.string()).optional(),
}).passthrough();
