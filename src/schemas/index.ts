// ============================================================
// Xray-core Complete Zod Schema — Single Source of Truth
// src/schemas/index.ts
//
// This file re-exports ALL schemas and types.
// The XrayConfigSchema at the bottom is the root validator.
//
// Ported from the Xray Config UI Editor (src/core/xray/schemas), whose
// behaviour these files keep. Comments that name `core/xray/…`, "the
// editor" or "the form" point into that project.
// ============================================================

import { z } from 'zod';

// --- Primitives ---
export * from './primitives.js';

// --- Top-level sections ---
export { LogSchema, type LogConfig } from './log.schema.js';
export { ApiSchema, type ApiConfig } from './api.schema.js';
export { StatsSchema, type StatsConfig } from './stats.schema.js';
export { MetricsSchema, type MetricsConfig } from './metrics.schema.js';
export { GeodataSchema, type GeodataConfig } from './geodata.schema.js';
export { ReverseSchema, type ReverseConfig } from './reverse.schema.js';
export { FakeDnsSchema, type FakeDnsConfig } from './fakedns.schema.js';
export { PolicySchema, type PolicyConfig } from './policy.schema.js';
export { ObservatorySchema, BurstObservatorySchema, type ObservatoryConfig, type BurstObservatoryConfig } from './observatory.schema.js';
export { FallbackObjectSchema, type FallbackObject } from './fallback.schema.js';
export { DnsSchema, DnsServerObjectSchema, type DnsConfig, type DnsServerObject } from './dns.schema.js';
export { RoutingSchema, RoutingRuleSchema, BalancerSchema, type RoutingConfig, type RoutingRule, type Balancer } from './routing.schema.js';

// --- Inbound / Outbound wrappers ---
export { InboundSchema, SniffingSchema, AllocateSchema, type InboundConfig } from './inbound.schema.js';
export { OutboundSchema, MuxSchema, ProxySettingsSchema, type OutboundConfig } from './outbound.schema.js';

// --- Inbound protocol settings ---
export { VlessInboundSettingsSchema } from './inbounds/vless.inbound.js';
export { VmessInboundSettingsSchema } from './inbounds/vmess.inbound.js';
export { TrojanInboundSettingsSchema } from './inbounds/trojan.inbound.js';
export { ShadowsocksInboundSettingsSchema } from './inbounds/shadowsocks.inbound.js';
export { SocksInboundSettingsSchema } from './inbounds/socks.inbound.js';
export { HttpInboundSettingsSchema } from './inbounds/http.inbound.js';
export { TunnelInboundSettingsSchema } from './inbounds/tunnel.inbound.js';
export { HysteriaInboundSettingsSchema } from './inbounds/hysteria.inbound.js';
export { WireguardInboundSettingsSchema } from './inbounds/wireguard.inbound.js';
export { TunInboundSettingsSchema } from './inbounds/tun.inbound.js';

// --- Outbound protocol settings ---
export { VlessOutboundSettingsSchema } from './outbounds/vless.outbound.js';
export { VmessOutboundSettingsSchema } from './outbounds/vmess.outbound.js';
export { TrojanOutboundSettingsSchema } from './outbounds/trojan.outbound.js';
export { ShadowsocksOutboundSettingsSchema } from './outbounds/shadowsocks.outbound.js';
export { SocksOutboundSettingsSchema } from './outbounds/socks.outbound.js';
export { HttpOutboundSettingsSchema } from './outbounds/http.outbound.js';
export { FreedomOutboundSettingsSchema } from './outbounds/freedom.outbound.js';
export { BlackholeOutboundSettingsSchema } from './outbounds/blackhole.outbound.js';
export { DnsOutboundSettingsSchema } from './outbounds/dns.outbound.js';
export { LoopbackOutboundSettingsSchema } from './outbounds/loopback.outbound.js';
export { HysteriaOutboundSettingsSchema } from './outbounds/hysteria.outbound.js';
export { WireguardOutboundSettingsSchema } from './outbounds/wireguard.outbound.js';

// --- Transport schemas ---
export { StreamSettingsSchema, type StreamSettings } from './transport/stream.schema.js';
export { RawTransportSchema } from './transport/raw.transport.js';
export { WebSocketTransportSchema } from './transport/websocket.transport.js';
export { GrpcTransportSchema } from './transport/grpc.transport.js';
export { HttpUpgradeTransportSchema } from './transport/httpupgrade.transport.js';
export { MkcpTransportSchema } from './transport/mkcp.transport.js';
export { XhttpTransportSchema, XmuxSchema, XhttpExtraSchema } from './transport/xhttp.transport.js';
export { HysteriaTransportSchema } from './transport/hysteria.transport.js';
export { TlsSchema, CertificateObjectSchema } from './transport/tls.schema.js';
export { RealitySchema } from './transport/reality.schema.js';
export { SockoptSchema, HappyEyeballsSchema } from './transport/sockopt.schema.js';
export { FinalMaskSchema, QuicParamsSchema } from './transport/finalmask.schema.js';

// ============================================================
// Root XrayConfigSchema
// ============================================================

import { LogSchema } from './log.schema.js';
import { ApiSchema } from './api.schema.js';
import { StatsSchema } from './stats.schema.js';
import { MetricsSchema } from './metrics.schema.js';
import { GeodataSchema } from './geodata.schema.js';
import { ReverseSchema } from './reverse.schema.js';
import { FakeDnsSchema } from './fakedns.schema.js';
import { PolicySchema } from './policy.schema.js';
import { ObservatorySchema, BurstObservatorySchema } from './observatory.schema.js';
import { DnsSchema } from './dns.schema.js';
import { RoutingSchema } from './routing.schema.js';
import { InboundSchema } from './inbound.schema.js';
import { OutboundSchema } from './outbound.schema.js';

export const XrayConfigSchema = z.object({
  /**
   * Values for `env:NAME` references elsewhere in the config, 26.7 and later
   * (EnvConfig, v26.7.28:infra/conf/xray.go); 26.3 drops it.
   */
  env: z.record(z.string(), z.string()).optional(),
  /**
   * The Xray versions this config may run on; outside them the core refuses
   * to load it (VersionConfig, v26.10.21:infra/conf/version.go:10-15).
   */
  version: z.object({
    min: z.string().optional(),
    max: z.string().optional(),
  }).passthrough().optional(),
  log: LogSchema.optional(),
  api: ApiSchema.optional(),
  dns: DnsSchema.optional(),
  routing: RoutingSchema.optional(),
  policy: PolicySchema.optional(),
  inbounds: z.array(InboundSchema).optional(),
  outbounds: z.array(OutboundSchema).optional(),
  stats: StatsSchema.optional(),
  fakedns: FakeDnsSchema.optional(),
  metrics: MetricsSchema.optional(),
  observatory: ObservatorySchema.optional(),
  burstObservatory: BurstObservatorySchema.optional(),
  geodata: GeodataSchema.optional(),
  reverse: ReverseSchema.optional(),
}).passthrough(); // Allow unknown top-level keys to avoid breaking configs

export type XrayConfig = z.infer<typeof XrayConfigSchema>;
