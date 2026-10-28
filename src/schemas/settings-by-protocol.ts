// ============================================================
// Which settings schema a protocol's `settings` block follows
// ============================================================

import type { z } from 'zod';

import { VlessInboundSettingsSchema } from './inbounds/vless.inbound.js';
import { VmessInboundSettingsSchema } from './inbounds/vmess.inbound.js';
import { TrojanInboundSettingsSchema } from './inbounds/trojan.inbound.js';
import { ShadowsocksInboundSettingsSchema } from './inbounds/shadowsocks.inbound.js';
import { SocksInboundSettingsSchema } from './inbounds/socks.inbound.js';
import { HttpInboundSettingsSchema } from './inbounds/http.inbound.js';
import { TunnelInboundSettingsSchema } from './inbounds/tunnel.inbound.js';
import { HysteriaInboundSettingsSchema } from './inbounds/hysteria.inbound.js';
import { MasqueInboundSettingsSchema } from './inbounds/masque.inbound.js';
import { WireguardInboundSettingsSchema } from './inbounds/wireguard.inbound.js';
import { TunInboundSettingsSchema } from './inbounds/tun.inbound.js';

import { VlessOutboundSettingsSchema } from './outbounds/vless.outbound.js';
import { VmessOutboundSettingsSchema } from './outbounds/vmess.outbound.js';
import { TrojanOutboundSettingsSchema } from './outbounds/trojan.outbound.js';
import { ShadowsocksOutboundSettingsSchema } from './outbounds/shadowsocks.outbound.js';
import { SocksOutboundSettingsSchema } from './outbounds/socks.outbound.js';
import { HttpOutboundSettingsSchema } from './outbounds/http.outbound.js';
import { FreedomOutboundSettingsSchema } from './outbounds/freedom.outbound.js';
import { BlackholeOutboundSettingsSchema } from './outbounds/blackhole.outbound.js';
import { DnsOutboundSettingsSchema } from './outbounds/dns.outbound.js';
import { LoopbackOutboundSettingsSchema } from './outbounds/loopback.outbound.js';
import { HysteriaOutboundSettingsSchema } from './outbounds/hysteria.outbound.js';
import { MasqueOutboundSettingsSchema } from './outbounds/masque.outbound.js';
import { WireguardOutboundSettingsSchema } from './outbounds/wireguard.outbound.js';

/**
 * `settings` means something different for every protocol, so the wrapper
 * schemas leave it open and the shape is looked up here by the `protocol`
 * beside it.
 *
 * This lookup used to live as a `switch` inside the form validator, which is
 * why the JSON editors never checked a settings block at all: they had no
 * copy of it. One table, two readers — the forms and the linter now agree
 * about what a vless inbound's settings may contain.
 */

const INBOUND: Record<string, z.ZodTypeAny> = {
    vless: VlessInboundSettingsSchema,
    vmess: VmessInboundSettingsSchema,
    trojan: TrojanInboundSettingsSchema,
    shadowsocks: ShadowsocksInboundSettingsSchema,
    // The 2022 ciphers are the same block with different method names.
    'shadowsocks-2022': ShadowsocksInboundSettingsSchema,
    socks: SocksInboundSettingsSchema,
    // Not a schema of its own: the loader builds a `mixed` inbound from the
    // struct it builds `socks` from (v26.7.28:infra/conf/xray.go:27-28).
    mixed: SocksInboundSettingsSchema,
    http: HttpInboundSettingsSchema,
    tunnel: TunnelInboundSettingsSchema,
    // `tunnel` is the current name for what the docs still call dokodemo-door.
    'dokodemo-door': TunnelInboundSettingsSchema,
    hysteria: HysteriaInboundSettingsSchema,
    masque: MasqueInboundSettingsSchema,
    wireguard: WireguardInboundSettingsSchema,
    tun: TunInboundSettingsSchema,
};

const OUTBOUND: Record<string, z.ZodTypeAny> = {
    vless: VlessOutboundSettingsSchema,
    vmess: VmessOutboundSettingsSchema,
    trojan: TrojanOutboundSettingsSchema,
    shadowsocks: ShadowsocksOutboundSettingsSchema,
    'shadowsocks-2022': ShadowsocksOutboundSettingsSchema,
    socks: SocksOutboundSettingsSchema,
    http: HttpOutboundSettingsSchema,
    freedom: FreedomOutboundSettingsSchema,
    // Registered beside freedom and blackhole on every supported line, building
    // the same structs (v26.10.21:infra/conf/xray.go, outboundConfigLoader).
    direct: FreedomOutboundSettingsSchema,
    blackhole: BlackholeOutboundSettingsSchema,
    block: BlackholeOutboundSettingsSchema,
    dns: DnsOutboundSettingsSchema,
    loopback: LoopbackOutboundSettingsSchema,
    hysteria: HysteriaOutboundSettingsSchema,
    masque: MasqueOutboundSettingsSchema,
    wireguard: WireguardOutboundSettingsSchema,
};

/** Null for a protocol with no settings shape on record — nothing to check. */
export const inboundSettingsSchemaFor = (protocol: unknown): z.ZodTypeAny | null =>
    (typeof protocol === 'string' ? INBOUND[protocol] : undefined) ?? null;

export const outboundSettingsSchemaFor = (protocol: unknown): z.ZodTypeAny | null =>
    (typeof protocol === 'string' ? OUTBOUND[protocol] : undefined) ?? null;

/** Both directions, for code that only knows which side it is on at runtime. */
export const settingsSchemaFor = (
    direction: 'inbound' | 'outbound',
    protocol: unknown,
): z.ZodTypeAny | null =>
    (direction === 'inbound' ? inboundSettingsSchemaFor : outboundSettingsSchemaFor)(protocol);
