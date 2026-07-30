import { escapeHtmlText, sanitizeNewsletterHtml } from "./sanitize"

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://roebel.app"

// Mona Sans (selbst gehostet): Apple Mail/iOS laden die Webfont, Gmail/Outlook
// ignorieren @font-face und fallen sauber auf den System-Stack zurück.
export const FONT_STACK =
  "'Mona Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif"
export const FONT_FACE_STYLE = `<style>@font-face{font-family:'Mona Sans';font-style:normal;font-weight:200 900;font-stretch:75% 125%;font-display:swap;src:url('${BASE_URL}/fonts/mona-sans/MonaSansVF.woff2') format('woff2');}</style>`

// Headline-Treatment wie im Web (globals.css): Mona Sans SemiCondensed = Breitenachse 87,5%.
// UPPERCASE + Letterspacing + Navy rendern überall; die Condensed-Stauchung greift nur in
// Clients, die die Variable-Font laden (Apple Mail/iOS) — der Rest fällt sauber zurück.
const HEADLINE_BASE = `font-family:${FONT_STACK};font-stretch:87.5%;text-transform:uppercase;letter-spacing:0.03em;font-weight:800;color:#00498B;`

const TAG_STYLES: Record<string, string> = {
  h1: `${HEADLINE_BASE}font-size:22px;line-height:1.25;margin:30px 0 12px;`,
  h2: `${HEADLINE_BASE}font-size:16px;line-height:1.3;margin:28px 0 10px;`,
  h3: "font-size:17px;line-height:1.4;color:#111827;margin:20px 0 8px;font-weight:600;",
  p: "font-size:15px;line-height:1.65;color:#374151;margin:0 0 14px;",
  ul: "margin:0 0 14px;padding-left:22px;",
  ol: "margin:0 0 14px;padding-left:22px;",
  li: "font-size:15px;line-height:1.6;color:#374151;margin-bottom:6px;",
  a: "color:#00498B;text-decoration:underline;",
  blockquote: "border-left:3px solid #00498B;margin:0 0 14px;padding:4px 0 4px 14px;color:#4B5563;",
  hr: "border:none;border-top:1px solid #E5E7EB;margin:24px 0;",
  img: "max-width:100%;height:auto;border-radius:8px;margin:0 0 14px;",
  strong: "font-weight:600;color:#111827;",
}

/** Injects inline styles into Tiptap-generated HTML so email clients render it.
 *  Merges with any existing style attribute (author styles win over the base). */
export function inlineStyleNewsletterHtml(html: string): string {
  return html.replace(
    /<(h1|h2|h3|p|ul|ol|li|a|blockquote|hr|img|strong)((?:\s[^>]*)?\/?)>/g,
    (_m, tag: string, attrs: string) => {
      const base = TAG_STYLES[tag]
      const styleMatch = attrs.match(/\sstyle\s*=\s*"([^"]*)"/i)
      if (styleMatch) {
        const author = styleMatch[1].trim()
        const merged = `${base}${author}${author.endsWith(";") || author === "" ? "" : ";"}`
        return `<${tag}${attrs.replace(styleMatch[0], ` style="${merged}"`)}>`
      }
      return `<${tag} style="${base}"${attrs}>`
    }
  )
}

export function renderNewsletterEmail(opts: {
  subject: string
  preheader?: string | null
  contentHtml: string
  unsubscribeUrl: string
  heroImageUrl?: string | null
}): string {
  const { subject, preheader, contentHtml, unsubscribeUrl, heroImageUrl } = opts
  const body = inlineStyleNewsletterHtml(sanitizeNewsletterHtml(contentHtml))
  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtmlText(subject)}</title>${FONT_FACE_STYLE}</head>
<body style="margin:0;padding:0;font-family:${FONT_STACK};background-color:#f3f4f6;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtmlText(preheader)}</div>` : ""}
  <table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#ffffff;border-radius:16px;overflow:hidden;">
      ${heroImageUrl ? `<tr><td style="padding:0;"><img src="${heroImageUrl}" width="600" alt="" style="width:100%;max-width:600px;height:auto;display:block;"></td></tr>` : ""}
      <tr><td style="padding:32px;font-family:${FONT_STACK};">${body}</td></tr>
      <tr><td style="padding:24px 32px;background-color:#f9fafb;border-top:1px solid #E5E7EB;">
        <p style="font-size:12px;line-height:1.6;color:#6B7280;margin:0;font-family:${FONT_STACK};">
          Du erhältst diese E-Mail, weil du den Newsletter der Röbel App abonniert hast.<br>
          Dieser Newsletter wird mit KI-Unterstützung erstellt und vor dem Versand redaktionell geprüft.<br>
          <a href="${unsubscribeUrl}" style="color:#6B7280;text-decoration:underline;">Abmelden</a> ·
          <a href="${BASE_URL}/impressum" style="color:#6B7280;text-decoration:underline;">Impressum</a> ·
          <a href="${BASE_URL}/datenschutz" style="color:#6B7280;text-decoration:underline;">Datenschutz</a>
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</body>
</html>`.trim()
}
