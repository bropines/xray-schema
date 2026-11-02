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

/**
 * service s3 (v26.10.31): an S3-compatible bucket. Build() refuses a missing
 * object and runs xdrive.ValidateS3Config (v26.10.31:infra/conf/transport_method.go:1009-1014,
 * 1076-1086; transport/internet/xdrive/s3.go:49-79): endpoint an http(s) URL
 * without credentials, query or fragment; a bucket name without "/"; with
 * virtual-hosted addressing (pathStyle false) a DNS endpoint and a DNS-safe
 * bucket; remoteFolder a non-empty relative prefix; and in `secrets`
 * AccessKeyID, SecretAccessKey and optionally SessionToken.
 */
export const XDriveS3Schema = z.object({
  endpoint: z.string().optional(),
  /** The signing region; no "/", ",", spaces or tabs. */
  region: z.string().optional(),
  bucket: z.string().optional(),
  /** Path-style addressing; omitted means true. */
  pathStyle: z.boolean().optional(),
}).passthrough();

export const XDriveTransportSchema = z.object({
  /** The folder both sides read and write: a path for local, a folder id for Google Drive. */
  remoteFolder: z.string().optional(),
  /** local, Google Drive (google-drive on v26.10.21), template or s3 (v26.10.31) — compared exactly. */
  service: z.string().optional(),
  /** Google Drive: ClientID, ClientSecret, RefreshToken; s3: AccessKeyID, SecretAccessKey[, SessionToken]. */
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
  /** service s3 (v26.10.31); see XDriveS3Schema. */
  s3: XDriveS3Schema.optional(),
  /** v26.10.21: the client's HTTP connections to the store, as XHTTP's xmux. */
  xmux: XmuxSchema.optional(),
}).passthrough();
