// ============================================================
// VLESS Outbound Settings — Source: docs/config/outbounds/vless.md
// ============================================================

import { z } from 'zod';
import { UserLevelSchema, VlessFlowSchema } from '../primitives.js';
import { SniffingSchema } from '../inbound.schema.js';

/** Vision's padding seed and pre-connection count — core/xray/vless-vision.ts. */
const TestseedSchema = z.array(z.number().int().min(0).max(4294967295));
const TestpreSchema = z.number().int().min(0).max(4294967295);

/** One server in the grouped form. */
export const VlessVnextSchema = z.object({
  address: z.string().optional(),
  port: z.number().int().optional(),
  users: z.array(z.object({
    id: z.string().optional(),
    encryption: z.string().optional(),
    flow: VlessFlowSchema.optional(),
    level: UserLevelSchema,
    email: z.string().optional(),
    testseed: TestseedSchema.optional(),
    testpre: TestpreSchema.optional(),
  }).passthrough()).optional(),
}).passthrough();

export const VlessOutboundSettingsSchema = z.object({
  /** Servers in grouped form. The flat fields below are the newer spelling. */
  vnext: z.array(VlessVnextSchema).optional(),
  /** Server address */
  address: z.string().optional(),
  /** Server port */
  port: z.number().int().optional(),
  /** User UUID */
  id: z.string().optional(),
  /**
   * "none", or the client's VLESS Encryption string for the server's `decryption`
   * (core/xray/vless-encryption.ts). Every supported line refuses a VLESS
   * outbound without one, so it is never left out. Also read from
   * `vnext[].users[].encryption`.
   */
  encryption: z.string().optional(),
  /** XTLS flow control */
  flow: VlessFlowSchema.optional(),
  /** User level for policy */
  level: UserLevelSchema,
  /** User email for statistics */
  email: z.string().optional(),
  /** Post-quantum key exchange seed */
  seed: z.string().optional(),
  /** Vision's padding seed, four numbers. */
  testseed: TestseedSchema.optional(),
  /** Connections opened ahead of use. */
  testpre: TestpreSchema.optional(),
  /**
   * VLESS reverse proxy config (VLessReverseConfig): the tag the reverse
   * traffic arrives under, and sniffing for it — the whole SniffingConfig.
   */
  reverse: z.object({
    tag: z.string().optional(),
    sniffing: SniffingSchema.optional(),
  }).passthrough().optional(),
}).passthrough();
