import { PRESETS, type BrandingPreset } from './login-page.js'

/**
 * The public, machine-readable description of a relying party's login look.
 *
 * Deliberately narrower than `PresetCopy`: `siweStatement` and `walletNote` are login-page
 * internals (one is a signed message payload, the other an HTML comment) and no external
 * consumer should couple to them. Widening this later is cheap; narrowing it once an SDK
 * depends on a field is not.
 */
export interface BrandingDocument {
  preset: string
  title: string
  heading: string
  intro: string
  primaryColor: string
  secondaryColor: string
  context?: string
}

export function brandingDocument(preset: BrandingPreset, context?: string): BrandingDocument {
  const copy = PRESETS[preset]
  return {
    preset,
    title: copy.title,
    heading: copy.heading,
    intro: copy.intro,
    primaryColor: copy.primaryColor,
    secondaryColor: copy.secondaryColor,
    ...(context ? { context } : {}),
  }
}
