/**
 * Replaced by esbuild at OCI build time. This deliberately has no environment
 * fallback: a Deployment must not be able to substitute the source revision
 * that the image was compiled from.
 */
declare const __ROEBEL_STAGING_PARTICIPANT_GATEWAY_SOURCE_REVISION__: string;

export const COMPILED_SOURCE_REVISION = __ROEBEL_STAGING_PARTICIPANT_GATEWAY_SOURCE_REVISION__;
