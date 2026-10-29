import { createRpc } from '../_shared/deps.ts'
import { requireEnv } from '../_shared/env.ts'
import { createLookup } from '../_shared/geo.ts'
import { GEO } from '../_shared/geo-data.ts'
import { handleClick } from '../_shared/handlers.ts'

const lookup = await createLookup(GEO)

const deps = {
  rpc: createRpc(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY')),
  country: (ip: string | null) => (ip === null ? null : lookup(ip)),
}

Deno.serve((req: Request) => handleClick(req, deps))
