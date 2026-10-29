import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const PATTERNS = [
  'eyJ[A-Za-z0-9_-]{20,}',
  'sk_(live|test)_[A-Za-z0-9]+',
  'sb_secret_[A-Za-z0-9_-]{20,}',
  'SUPABASE_(URL|ANON_KEY|SERVICE_ROLE_KEY)\\s*=\\s*[\'"]?https?://|SUPABASE_(URL|ANON_KEY|SERVICE_ROLE_KEY)\\s*=\\s*[\'"]?eyJ',
]
const EXCLUDE = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']
const all = process.argv.includes('--all')

const list = (cmd) => execSync(cmd, { encoding: 'utf8' }).split('\n').filter(Boolean)
const names = all ? list('git ls-files') : list('git diff --cached --name-only --diff-filter=ACMR')
const files = names.filter(
  (f) =>
    /\.(ts|tsx|js|jsx|json|env(\.[^.]+)?|ya?ml|md|sh|mjs|cjs)$/.test(f) &&
    !EXCLUDE.some((ex) => f === ex || f.endsWith(`/${ex}`)),
)

const re = new RegExp(PATTERNS.join('|'))
let failed = false
for (const f of files) {
  let text
  try {
    if (all) {
      if (!existsSync(f)) continue
      text = readFileSync(f, 'utf8')
    } else {
      text = execSync(`git show ":${f}"`, { encoding: 'utf8' })
    }
  } catch (e) {
    console.error(`Cannot read ${f}: ${e.message}`)
    failed = true
    continue
  }
  if (re.test(text)) {
    console.error(`Secret-like pattern in ${all ? 'tracked' : 'staged'} file: ${f}`)
    failed = true
  }
}
if (failed) {
  console.error(
    'Secret scan failed. Move secrets to .env.local and remove them from the files above.',
  )
  process.exit(1)
}
