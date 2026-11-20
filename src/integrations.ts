/**
 * Integration Billing Config
 *
 * Configure who pays for each integration's API calls.
 *
 * - 'developer': The app owner pays (default).
 * - 'user': The calling user pays.
 *
 * `browser: true` opts an integration into the client-facing proxy at
 * /api/integrations/:name/:endpoint. Readaloud leaves every integration
 * server-only: fal (voice synthesis) and firecrawl (article scraping) are
 * called from src/actions and src/jobs, where input is validated and per-user
 * limits apply before anything is spent. See src/server/http-routes.ts.
 */

export const integrations: Record<
  string,
  { billing: 'developer' | 'user'; anonymous?: boolean; browser?: boolean }
> = {
  fal: { billing: 'developer' },
  firecrawl: { billing: 'developer' },
}
