import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RPC_ERRORS } from '../../supabase/functions/_shared/rpc-errors'

const sql = readFileSync('supabase/migrations/0001_txiki.sql', 'utf8')
const raised = [...sql.matchAll(/raise exception '([^']+)'/g)].map((m) => m[1])

describe('RPC_ERRORS', () => {
  it.each(Object.entries(RPC_ERRORS))('%s is raised verbatim by the SQL', (_name, message) => {
    expect(raised).toContain(message)
  })
})
