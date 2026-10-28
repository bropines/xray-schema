// ============================================================
// StreamSettings Schema (wrapper) — Source: docs/config/transport.md
// ============================================================
import { z } from 'zod';
import { TransportNetworkSchema, TransportSecuritySchema } from '../primitives.js';
import { RawTransportSchema } from './raw.transport.js';
import { WebSocketTransportSchema } from './websocket.transport.js';
import { GrpcTransportSchema } from './grpc.transport.js';
import { HttpUpgradeTransportSchema } from './httpupgrade.transport.js';
import { MkcpTransportSchema } from './mkcp.transport.js';
import { XhttpTransportSchema, bindXhttpDownloadSettings } from './xhttp.transport.js';
import { HysteriaTransportSchema } from './hysteria.transport.js';
import { MasqueTransportSchema } from './masque.transport.js';
import { XDriveTransportSchema } from './xdrive.transport.js';
import { TlsSchema } from './tls.schema.js';
import { RealitySchema } from './reality.schema.js';
import { SockoptSchema } from './sockopt.schema.js';
import { FinalMaskSchema } from './finalmask.schema.js';

export const StreamSettingsSchema = z.object({
  /**
   * Where to connect instead of the outbound's own server. Only read on a
   * stream that is XHTTP's `downloadSettings`, for the download half; decoded
   * — and ignored — on every other stream (StreamConfig,
   * v26.10.21:infra/conf/transport_internet.go).
   */
  address: z.string().optional(),
  port: z.number().int().min(0).max(65535).optional(),

  // --- Transport ---
  /** Transport type: raw, xhttp, mkcp, grpc, websocket, httpupgrade, hysteria, masque (+ aliases) */
  network: z.union([TransportNetworkSchema, z.string()]).optional(),
  /**
   * 26.7's alias of network, and the one that wins when both are set
   * (v26.7.28:infra/conf/transport_internet.go:75); 26.3 ignores it. The
   * editor never writes it — it shows one a config has, see TransportSettings.
   */
  method: z.union([TransportNetworkSchema, z.string()]).optional(),
  rawSettings: RawTransportSchema.optional(),
  /** Alias: tcpSettings maps to rawSettings */
  tcpSettings: RawTransportSchema.optional(),
  xhttpSettings: XhttpTransportSchema.optional(),
  /** Alias: splithttpSettings maps to xhttpSettings */
  splithttpSettings: XhttpTransportSchema.optional(),
  kcpSettings: MkcpTransportSchema.optional(),
  grpcSettings: GrpcTransportSchema.optional(),
  wsSettings: WebSocketTransportSchema.optional(),
  httpupgradeSettings: HttpUpgradeTransportSchema.optional(),
  hysteriaSettings: HysteriaTransportSchema.optional(),
  /** 26.9.30. Only a masque proxy may carry this, and only this. */
  masqueSettings: MasqueTransportSchema.optional(),
  /** 26.9.30. A cloud drive as the carrier; XDriveSettingsEditor draws it, core/xray/xdrive.ts judges it. */
  xdriveSettings: XDriveTransportSchema.optional(),

  // --- Security ---
  /** Transport security: none, tls, reality */
  security: TransportSecuritySchema.optional(),
  tlsSettings: TlsSchema.optional(),
  realitySettings: RealitySchema.optional(),

  // --- Additional ---
  finalmask: FinalMaskSchema.optional(),
  sockopt: SockoptSchema.optional(),
}).passthrough();

bindXhttpDownloadSettings(StreamSettingsSchema);

export type StreamSettings = z.infer<typeof StreamSettingsSchema>;
