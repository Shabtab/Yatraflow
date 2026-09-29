// The ONE canonical-origin resolver for the public share surfaces (#362).
//
// Four surfaces used to mint addresses — the publication card handler, the
// sitemap, the web app's own share links and index.html's default tags — and
// they disagreed: two hardcoded the production origin, two read env vars with
// one precedence, and the web used location.origin. The handlers being wrong
// in the same direction is not the same as them agreeing: preview deployments
// minted `/i/<id>` links whose og:url claimed production while the bytes came
// from the preview. The precedence below is the documented choice — an
// operator-set `PUBLIC_ORIGIN` wins, then Vercel's production alias, then the
// known production origin — and every server surface reads it from HERE, so
// the card and the sitemap can never name different origins again.

export const DEFAULT_ORIGIN = 'https://yatraflow-blond.vercel.app'

/**
 * env → production alias → known production, trailing slashes stripped.
 * Same precedence the two handlers each used to carry privately; the default
 * is a parameter so tests can drive it without touching process.env.
 */
export function resolveOrigin(env = process.env) {
  const origin = env.PUBLIC_ORIGIN ||
    (env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
    DEFAULT_ORIGIN
  return String(origin).replace(/\/+$/, '')
}
