# txiki

Link shortener with per-link stats and no accounts. _Txiki_ is Basque for "small".

**Use it:** https://endika.github.io/txiki/

1. Paste a link. Optionally, ask visitors to share their location.
2. You get a **short link** to share and a **stats key** (🔒) that is only for you. Anyone with the key can see the stats and delete the link, so don't share it.
3. Open the key to see clicks over time, countries, a map, devices and where visitors came from. Your links also appear under **My links** in this browser.
4. Optionally add a **note** ("CV · Company X") to remember where you shared each link. It is encrypted in your browser with the key, so the server stores it unreadable.

## What is stored

Per click: country, browser, OS, device type, language, time zone, referrer host, a visitor hash that changes every day and, only if the visitor agrees, the location rounded to about 1 km. Never the IP, the full user agent or cookies. Bot visits are counted apart. Everything is deleted after 12 months.

The full notice is the Privacy page of the app.

## Develop

```sh
npm ci
cat > .env.local <<'ENV'
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA
ENV
npm run dev
npm run test:run   # page, API client, Edge Function logic
npm run test:sql   # SQL tests, needs Docker
```

`1x00000000000000000000AA` is Cloudflare's always-pass test key.

Production is applied by hand from the repo root with `scripts/apply-prod.sh` (database) and `scripts/deploy-functions.sh` (Edge Functions). Both read a Supabase access token from `~/.config/supabase/mcp-token`. Once a month `scripts/load-geo-db.sh` loads the network and Spanish city data (DB-IP Lite) the same way.

## Attribution

IP to country, network and city data by [DB-IP](https://db-ip.com) (CC BY 4.0).

## License

[MIT](LICENSE)
