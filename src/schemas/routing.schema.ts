// ============================================================
// Routing Schema — src/schemas/routing.schema.ts
// Source: docs/config/routing.md
// ============================================================

import { z } from 'zod';
import {
  RoutingDomainStrategySchema,
  RoutingProtocolSchema,
  BalancerStrategyTypeSchema,
  DomainListSchema,
  IPListSchema,
  StringListSchema,
  NetworkListSchema,
  DurationStringSchema,
  commaList,
} from './primitives.js';

// --- Webhook ---
// An object on every line (WebhookRuleConfig: v26.3.27:infra/conf/router.go:525-529,
// v26.7.28:infra/conf/router.go:126-130, v26.9.9:infra/conf/router.go:126-130).
// See core/xray/routing-webhook.ts for what else the core refuses about it.
export const WebhookObjectSchema = z.object({
  /** URL to POST webhook notifications */
  url: z.string(),
  /** Deduplication interval in seconds — a uint32 in the core */
  deduplication: z.number().int().min(0).max(4294967295).optional(),
  /** Custom HTTP headers for the webhook request */
  headers: z.record(z.string(), z.string()).optional(),
}).passthrough();

// --- Routing Rule ---
// Every list here is the core's StringList — an array, or one comma-separated
// string — and every port a PortList: a number or a "53,443,1000-2000" string
// (RawFieldRule, v26.10.21:infra/conf/router.go:140-160).
export const RoutingRuleSchema = z.object({
  /**
   * Not read by any supported line: RouterRule has only ruleTag, outboundTag
   * and balancerTag (v26.10.21:infra/conf/router.go:127-131). Kept because
   * published configs and this app's own generators still write
   * `"type": "field"`, which loads; the rule editor hides it.
   */
  type: z.string().optional(),
  /** Rule tag for identification */
  ruleTag: z.string().optional(),

  // --- Match conditions (AND logic) ---
  /** Domain match list (domain:, full:, regexp:, geosite:, etc.) */
  domain: DomainListSchema.optional(),
  /** The same as `domain`; when both are set the core matches both lists. */
  domains: DomainListSchema.optional(),
  /** IP match list (IP, CIDR, geoip:, etc.) */
  ip: IPListSchema.optional(),
  /** Destination port or port range, e.g. "80", "1-65535", "53,443,1000-2000" */
  port: z.union([z.number(), z.string()]).optional(),
  /** Source port or port range */
  sourcePort: z.union([z.number(), z.string()]).optional(),
  /** Local port (for transparent proxy) */
  localPort: z.union([z.number(), z.string()]).optional(),
  /** Network type: "tcp", "udp", "tcp,udp" or a list of them */
  network: NetworkListSchema.optional(),
  /** Source IP list (alias: source) */
  source: IPListSchema.optional(),
  /** The same as `source`; when both are set the core matches both lists. */
  sourceIP: IPListSchema.optional(),
  /** Local IP list (for transparent proxy) */
  localIP: IPListSchema.optional(),
  /** User email match list */
  user: StringListSchema.optional(),
  /** VLESS route value, a PortList: a number or a "1-5,7" string */
  vlessRoute: z.union([z.number(), z.string()]).optional(),
  /** Inbound tag match list */
  inboundTag: StringListSchema.optional(),
  /** Sniffed protocol match list */
  protocol: commaList(RoutingProtocolSchema).optional(),
  /** Attribute match (for external rule providers) */
  attrs: z.record(z.string(), z.string()).optional(),
  /** Process name match list */
  process: StringListSchema.optional(),
  /**
   * The OS the Xray process itself runs on ("windows", "linux", "darwin"),
   * matched case-insensitively — for one rule set shared by mixed-OS nodes.
   * Read from v26.9.9 (infra/conf/router.go); 26.3 and 26.7 drop it. See
   * core/xray/versions.
   */
  localOS: StringListSchema.optional(),

  // --- Actions ---
  /** Target outbound tag */
  outboundTag: z.string().optional(),
  /** Target balancer tag (mutually exclusive with outboundTag) */
  balancerTag: z.string().optional(),
  /**
   * Webhook notification on match. An object, never a bare URL string: the
   * rule decodes it into a struct, and a string there fails the decode and
   * the config with it (v26.7.28:infra/conf/router.go:151-157).
   */
  webhook: WebhookObjectSchema.optional(),
}).passthrough();

// --- Balancer Strategy Settings ---
// router.StrategyWeight, decoded straight from JSON (v26.10.21:app/router/config.pb.go:444-448).
export const CostObjectSchema = z.object({
  /** true: `match` is a regular expression; false: an exact outbound tag */
  regexp: z.boolean().optional(),
  /** The outbound tag, or the expression when regexp is true */
  match: z.string().optional(),
  /** Cost value */
  value: z.number().optional(),
}).passthrough();

// leastLoad's settings (strategyLeastLoadConfig, v26.10.21:infra/conf/router_strategy.go).
export const StrategySettingsSchema = z.object({
  /** How many of the best outbounds to pick from */
  expected: z.number().optional(),
  /** Maximum acceptable RTT, a Go duration ("1s", "500ms") — a number is refused */
  maxRTT: DurationStringSchema.optional(),
  /** Tolerance for RTT difference */
  tolerance: z.number().optional(),
  /** Baseline RTT values, Go durations ("1s", "500ms") */
  baselines: z.array(DurationStringSchema).optional(),
  /** Cost adjustments for specific outbounds */
  costs: z.array(CostObjectSchema).optional(),
}).passthrough();

// --- Balancer Strategy ---
export const StrategyObjectSchema = z.object({
  /** Strategy type: random, roundRobin, leastPing, leastLoad */
  type: BalancerStrategyTypeSchema.optional(),
  /** Strategy-specific settings */
  settings: StrategySettingsSchema.optional(),
}).passthrough();

// --- Balancer ---
export const BalancerSchema = z.object({
  /** Balancer tag for routing rules */
  tag: z.string(),
  /** Prefix-match selectors for outbound tags */
  selector: StringListSchema,
  /** Fallback outbound tag when no selected outbound is available */
  fallbackTag: z.string().optional(),
  /** Balancing strategy */
  strategy: StrategyObjectSchema.optional(),
}).passthrough();

// --- Top-level Routing ---
export const RoutingSchema = z.object({
  /** Domain resolution strategy: AsIs, IPIfNonMatch, IPOnDemand */
  domainStrategy: RoutingDomainStrategySchema.optional(),
  /** Routing rules, matched in order */
  rules: z.array(RoutingRuleSchema).optional(),
  /** Load balancers */
  balancers: z.array(BalancerSchema).optional(),
  /**
   * A Lua routing script, 26.10 and later (v26.10.10:infra/conf/router.go).
   * 26.10.21 refuses it beside rules or a domainStrategy, and inline `base64:`
   * scripts — core/xray/lua-scripts.ts.
   */
  script: z.string().optional(),
}).passthrough();

export type RoutingConfig = z.infer<typeof RoutingSchema>;
export type RoutingRule = z.infer<typeof RoutingRuleSchema>;
export type Balancer = z.infer<typeof BalancerSchema>;
