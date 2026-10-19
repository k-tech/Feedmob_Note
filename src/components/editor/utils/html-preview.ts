// A sandboxed opaque origin can run UI scripts but cannot read Minework's
// cookies/storage/DOM. CSP also blocks fetches, frames, forms and remote scripts.
export const HTML_SANDBOX = 'allow-scripts';
export const HTML_PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: http: data:; font-src data:; media-src https: http: data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
export function buildHtmlPreview(code: string) {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;font-family:system-ui,sans-serif;overflow-wrap:anywhere}img,video{max-width:100%}*{box-sizing:border-box}</style></head><body>${code}</body></html>`;
}
