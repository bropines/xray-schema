// ============================================================
// xdrive Transport — `XDriveConfig` in infra/conf (v26.9.30 and later)
// ============================================================
//
// The keys and their JSON types only. What Build() and the store then refuse
// — the service names per line, Google Drive's three secrets, the template's
// own shape, the VLESS-only rule of v26.10.21 — is core/xray/xdrive.ts, and
// XDriveSettingsEditor draws the object (v26.10.21:infra/conf/transport_method.go:985-1003).
import { z } from 'zod';
import { XmuxSchema } from './xhttp.transport.js';

const Uint32Schema = z.number().int().min(0).max(4294967295);

export const XDriveTransportSchema = z.object({
  /** The folder both sides read and write: a path for local, a folder id for Google Drive. */
  remoteFolder: z.string().optional(),
  /** local, Google Drive (google-drive on v26.10.21) or template — compared exactly. */
  service: z.string().optional(),
  /** Google Drive: ClientID, ClientSecret, RefreshToken, in that order. */
  secrets: z.array(z.string()).optional(),
  // The tuning numbers; 0 means the store's default (core/xray/xdrive.ts, XDRIVE_NUMBERS).
  segmentBytes: Uint32Schema.optional(),
  flushIntervalMs: Uint32Schema.optional(),
  pollIntervalMs: Uint32Schema.optional(),
  maxPollIntervalMs: Uint32Schema.optional(),
  sessionTtlSeconds: Uint32Schema.optional(),
  concurrency: Uint32Schema.optional(),
  eagerWindowMs: Uint32Schema.optional(),
  holeTimeoutMs: Uint32Schema.optional(),
  /**
   * service template: the HTTP file API, a JSON object the store decodes
   * itself (a json.RawMessage to the loader, so any JSON passes the decode).
   */
  template: z.unknown().optional(),
  /** v26.10.21: the client's HTTP connections to the store, as XHTTP's xmux. */
  xmux: XmuxSchema.optional(),
}).passthrough();
