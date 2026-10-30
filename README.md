# txiki

Link shortener with per-link stats and no accounts. _Txiki_ is Basque for "small". Paste a link, get a short one and a key. Every time someone opens the short link you can see when, from which country and on what device.

Live at https://endika.github.io/txiki/

## How it works

1. **Create.** You paste a link, pass a Cloudflare Turnstile check and txiki returns a short link and a stats key. The key is 32 random bytes (43 base64url characters). The database only stores its SHA-256 hash.
2. **No accounts.** Whoever holds the key sees the stats and can delete the link. This browser keeps your links and keys in `localStorage` (the "My links" page), and the stats link doubles as a backup you can open anywhere.
3. **The short link.** It is `https://endika.github.io/txiki/#<code>`, with a 7-character code after the `#`. The page is static (GitHub Pages). When it opens, it calls the `txiki-click` Edge Function, which records the click and returns the destination.
4. **Country without keeping the IP.** The Edge Function works out the country from the IP with an embedded table of DB-IP ranges and discards the IP. It is never stored or logged.
5. **Unique visitors.** They are counted with `sha256(daily salt ‖ IP ‖ browser categories)`, truncated. The salt is deleted the next day, so nobody can recompute the hash afterwards.
6. **Exact location (optional).** Only if the link was created asking for it and the person opening it presses "Share location". It is rounded to 2 decimals (about 1 km) and added within 10 minutes of the click, once.
7. **Languages.** Spanish, English, Basque, Catalan and Galician.

## What is stored

Per click: country, browser, OS and device category, language, time zone, referrer host, the pseudonymous visitor hash and, only with consent, the approximate location. Never the IP, the full user agent or cookies, and there is no analytics.

Per link: destination, creation date and the hash of the key. For rate limiting, a 2-day hash of the creator's IP. Clicks and inactive links are deleted after 12 months.

The full notice, with legal basis and processors, is the Privacy page of the app (`#/privacy`, source in `src/views/privacy.ts` and `src/i18n/`).

## Verify it yourself

Open the browser devtools, Network tab.

1. Create a link. The `txiki-create` request carries the destination, the location flag and the Turnstile token. The key comes back in the response and never goes up again except as a parameter of the stats and delete calls.
2. Open the short link in another tab. The only request is `txiki-click`: it carries the code, the language, the time zone and the referrer host, and sends no cookies.
3. Open the stats link. The `link_stats` call carries the code and the key, and the response has aggregates plus the last 50 clicks.

In the database (schema `txiki`), `clicks` has no IP column and no user agent, `links` stores `token_hash` and not the key, and `create_log` and `salts` hold only hashes and salts. The tables have row-level security and no grants for `anon`: the browser can only execute `link_stats`, `delete_link` and `add_location`. Columns that hold personal data are tagged with `COMMENT ON COLUMN` in `supabase/migrations/0001_txiki.sql`.

## Stack

- Vite and TypeScript, no framework and no runtime dependencies in the page. Charts are plain SVG.
- Supabase: Postgres 17 (schema `txiki`, RPCs, `pg_cron` retention) and two Edge Functions (`txiki-create`, `txiki-click`) in Deno.
- Cloudflare Turnstile on the create page only.
- GitHub Pages under `/txiki/`, with a strict CSP.
- vitest with jsdom for the page and the function logic; a throwaway Postgres in Docker for the SQL.

## Develop

Create `.env.local`:

```sh
VITE_SUPABASE_URL=<your project URL>
VITE_SUPABASE_ANON_KEY=<your anon key>
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

`1x00000000000000000000AA` is Cloudflare's always-pass test key. Then `npm run dev`.

Gates: `npm run format:check`, `npm run lint`, `npm run type:check`, `npm run test:run`, `npm run test:sql`, `npm run secret-scan` and `npm run build`.

```sh
npm ci
npm run test:run   # page, API client, Edge Function logic, i18n
npm run test:sql   # needs Docker
```

`test:sql` starts a throwaway Postgres 17, applies the migration and checks the grants, the RLS, the stats and delete tokens, the rate limits and the retention job.

## Deploy

Production is applied by hand, from the repo root:

```sh
bash scripts/apply-prod.sh         # migration, then exposes the schema in PostgREST
bash scripts/deploy-functions.sh   # builds the geo table and deploys both functions
```

- Both scripts read a Supabase access token from `~/.config/supabase/mcp-token`.
- `deploy-functions.sh` also reads the Turnstile secret from `~/.config/txiki/turnstile-secret`.
- `DRY_RUN=1` on the second script prints what it would upload without calling the API.

The page deploys with GitHub Actions to Pages. It needs these repository secrets: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_TURNSTILE_SITE_KEY`. The Turnstile widget must allow the hostname `endika.github.io`.

## Attribution

IP to country data by [DB-IP](https://db-ip.com) (CC BY 4.0).

## License

[MIT](LICENSE)
