import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.join(__dirname, 'dist')
const SAFARI_DIR = path.join(__dirname, 'safari')
const DERIVED_DATA_DIR = path.join(SAFARI_DIR, 'build')
const APP_NAME = 'Synthszr Lexikon'
const BUNDLE_ID = 'com.synthszr.glossary'

function fail(message) {
  console.error(`\n[Safari Build] ${message}`)
  process.exit(1)
}

function findFileRecursive(dir, predicate) {
  if (!fs.existsSync(dir)) return null
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (predicate(entry, full)) return full
    if (entry.isDirectory()) {
      const nested = findFileRecursive(full, predicate)
      if (nested) return nested
    }
  }
  return null
}

function resolveMacOsScheme(xcodeproj) {
  const raw = execFileSync('xcodebuild', ['-list', '-project', xcodeproj], {
    encoding: 'utf8',
  })
  const lines = raw.split(/\r?\n/).map((l) => l.trim())
  const macScheme = lines.find((l) => l.includes('macOS') && !l.startsWith('Information'))
  if (macScheme) return macScheme
  return `${APP_NAME} (macOS)`
}

function main() {
  if (process.platform !== 'darwin') {
    fail('Safari Web Extension builds require macOS with Xcode installed.')
  }

  try {
    execFileSync('xcrun', ['--find', 'safari-web-extension-converter'], { stdio: 'ignore' })
  } catch {
    fail('xcrun safari-web-extension-converter not found. Please install Xcode from the Mac App Store.')
  }

  console.log('[Safari Build] 1/3 Building shared MV3 web assets (dist/)...')
  execFileSync(process.execPath, [path.join(__dirname, 'build.mjs')], {
    stdio: 'inherit',
  })

  if (!fs.existsSync(path.join(DIST_DIR, 'manifest.json'))) {
    fail(`Missing ${path.join(DIST_DIR, 'manifest.json')} after build.mjs`)
  }

  fs.rmSync(SAFARI_DIR, { recursive: true, force: true })
  fs.mkdirSync(SAFARI_DIR, { recursive: true })

  console.log('[Safari Build] 2/3 Generating multiplatform (macOS + iOS) Xcode project...')
  execFileSync(
    'xcrun',
    [
      'safari-web-extension-converter',
      DIST_DIR,
      '--project-location',
      SAFARI_DIR,
      '--app-name',
      APP_NAME,
      '--bundle-identifier',
      BUNDLE_ID,
      '--swift',
      '--copy-resources',
      '--no-open',
      '--no-prompt',
      '--force',
    ],
    { stdio: 'inherit' },
  )

  const xcodeproj = findFileRecursive(
    SAFARI_DIR,
    (entry) => entry.isDirectory() && entry.name.endsWith('.xcodeproj'),
  )
  if (!xcodeproj) {
    fail(`Could not locate generated .xcodeproj inside ${SAFARI_DIR}`)
  }

  const scheme = resolveMacOsScheme(xcodeproj)
  console.log(`[Safari Build] 3/3 Building macOS app scheme "${scheme}" via xcodebuild...`)

  const xcodeArgs = [
    '-project',
    xcodeproj,
    '-scheme',
    scheme,
    '-configuration',
    'Release',
    '-derivedDataPath',
    DERIVED_DATA_DIR,
    'build',
  ]

  const teamId = process.env.APPLE_TEAM_ID?.trim()
  if (teamId) {
    xcodeArgs.push(`DEVELOPMENT_TEAM=${teamId}`)
    if (process.env.APPLE_SIGN_IDENTITY?.trim()) {
      xcodeArgs.push(`CODE_SIGN_IDENTITY=${process.env.APPLE_SIGN_IDENTITY.trim()}`)
    }
  } else {
    xcodeArgs.push(
      'CODE_SIGN_IDENTITY=-',
      'DEVELOPMENT_TEAM=',
      'CODE_SIGNING_REQUIRED=NO',
      'AD_HOC_CODE_SIGNING_ALLOWED=YES',
    )
  }

  execFileSync('xcodebuild', xcodeArgs, { stdio: 'inherit' })

  const releaseProductsDir = path.join(DERIVED_DATA_DIR, 'Build', 'Products', 'Release')
  const appPath = findFileRecursive(
    releaseProductsDir,
    (entry) => entry.isDirectory() && entry.name.endsWith('.app'),
  )
  if (!appPath) {
    fail(`Build completed, but no .app bundle found in ${releaseProductsDir}`)
  }

  const pluginsDir = path.join(appPath, 'Contents', 'PlugIns')
  const appexPath = findFileRecursive(
    pluginsDir,
    (entry) => entry.isDirectory() && entry.name.endsWith('.appex'),
  )
  if (!appexPath) {
    fail(`Embedded Safari extension (.appex) not found inside ${pluginsDir}`)
  }

  console.log('\nBuilt Synthszr Lexikon for Safari:')
  console.log(`  Xcode Project: ${xcodeproj} (macOS + iOS)`)
  console.log(`  macOS App:     ${appPath}`)
  console.log(`  App Extension: ${appexPath}`)
  console.log('\nNext steps to test locally in Safari:')
  console.log(`  1. open "${appPath}"`)
  if (!teamId) {
    console.log('  2. In Safari: Einstellungen -> Erweitert -> „Funktionen fuer Webentwickler anzeigen“')
    console.log('  3. Safari -> Entwickler -> „Nicht signierte Erweiterungen erlauben“')
  }
  console.log('  4. Safari -> Einstellungen -> Erweiterungen -> „Synthszr Lexikon“ aktivieren & „Immer auf jeder Website erlauben“')
}

main()
