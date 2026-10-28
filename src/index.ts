/**
 * xray-schema: zod schemas for Xray-core configs, held to what each release
 * decodes, with `lint()` for config text and the per-tag key tables.
 *
 * The JSON Schemas are files, not exports: `xray-schema/schema/xray.schema.json`
 * and `xray-schema/schema/<tag>.schema.json`.
 */
export * from './schemas/index.js';
export {
    inboundSettingsSchemaFor,
    outboundSettingsSchemaFor,
    settingsSchemaFor,
} from './schemas/settings-by-protocol.js';
export { MasqueInboundSettingsSchema } from './schemas/inbounds/masque.inbound.js';
export { MasqueOutboundSettingsSchema } from './schemas/outbounds/masque.outbound.js';
export { MasqueTransportSchema } from './schemas/transport/masque.transport.js';
export { XDriveTransportSchema } from './schemas/transport/xdrive.transport.js';
export { lint, lintValue, formatPath, schemaFor, type LintIssue, type LintMode, type LintOptions } from './lint.js';
export { parseJsonc, type JsoncResult, type Path, type Span } from './jsonc.js';
export { keysFor, lines, supportedTags, type TagKeys } from './keys.js';
