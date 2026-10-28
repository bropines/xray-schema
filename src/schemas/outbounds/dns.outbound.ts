// ============================================================
// DNS Outbound — Source: docs/config/outbounds/dns.md
// ============================================================
import { z } from 'zod';
import { UserLevelSchema, StringListSchema } from '../primitives.js';

export const DnsOutboundRuleSchema = z.object({
  /** Action: direct, hijack, drop, return */
  action: z.enum(['direct', 'hijack', 'drop', 'return']).optional(),
  /** Match DNS query type (number or range string "5-10" or "11,13,15-17") */
  qType: z.union([z.number(), z.string()]).optional(),
  /** DNS RCODE for return action (0-65535). Default: 0 */
  rCode: z.number().int().optional(),
  /** Domain match list (same as routing rule domain); a StringList */
  domain: StringListSchema.optional(),
}).passthrough();

export const DnsOutboundSettingsSchema = z.object({
  /** Rewrite transport protocol: "tcp" or "udp" */
  rewriteNetwork: z.enum(['tcp', 'udp']).optional(),
  /** Rewrite DNS server address */
  rewriteAddress: z.string().optional(),
  /** Rewrite DNS server port */
  rewritePort: z.number().int().optional(),
  /** User level for policy */
  userLevel: UserLevelSchema,
  /**
   * The older names of rewriteNetwork / rewriteAddress / rewritePort, still
   * read on every line — and when set they win
   * (v26.10.21:infra/conf/dns_proxy.go:74-82).
   */
  network: z.enum(['tcp', 'udp']).optional(),
  address: z.string().optional(),
  port: z.number().int().optional(),
  /**
   * "drop", "skip" or "reject" for non-A/AAAA queries. Deprecated from 26.7,
   * which translates it into rules (outbound:dns:settings.nonIPQuery).
   */
  nonIPQuery: z.string().optional(),
  /** Query types to block. Deprecated from 26.7 in favour of rules; 0..65535 there. */
  blockTypes: z.array(z.number().int()).optional(),
  /** DNS query rules */
  rules: z.array(DnsOutboundRuleSchema).optional(),
}).passthrough();
