import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.join(__dirname, 'dist')
const SAFARI_DIR = path.join(__dirname, 'safari')
const RELEASE_DERIVED_DATA = path.join(SAFARI_DIR, 'release-build')
const APP_NAME = 'Synthszr Lexikon'

const APP_ENTITLEMENTS_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.security.app-sandbox</key>
\t<true/>
\t<key>com.apple.security.files.user-selected.read-only</key>
\t<true/>
\t<key>com.apple.security.network.client</key>
\t<true/>
</dict>
</plist>
`

const EXT_ENTITLEMENTS_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.security.app-sandbox</key>
\t<true/>
\t<key>com.apple.security.files.user-selected.read-only</key>
\t<true/>
</dict>
</plist>
`

function fail(message) {
  console.error(`\n[Safari Release] ${message}`)
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

function resolveDeveloperIdIdentity() {
  const override = process.env.APPLE_SIGN_IDENTITY?.trim()
  if (override) return override

  const raw = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
  })
  const match = raw.match(/"(Developer ID Application:[^"]+)"/)
  if (!match) {
    fail(
      'No "Developer ID Application" certificate found in Keychain. Install it in Xcode or set APPLE_SIGN_IDENTITY.',
    )
  }
  return match[1]
}

function resolveTeamId(identity) {
  const override = process.env.APPLE_TEAM_ID?.trim()
  if (override) return override
  const m = identity.match(/\(([A-Z0-9]{10})\)/)
  if (!m) {
    fail(`Could not extract 10-char Team ID from identity "${identity}". Set APPLE_TEAM_ID explicitly.`)
  }
  return m[1]
}

function resolveNotaryProfile() {
  const args = process.argv.slice(2)
  const idx = args.indexOf('--notary-profile')
  if (idx !== -1 && args[idx + 1]) return args[idx + 1].trim()
  return process.env.APPLE_NOTARY_PROFILE?.trim() || null
}

function main() {
  if (process.platform !== 'darwin') {
    fail('Safari macOS releases require macOS with Xcode installed.')
  }

  console.log('[Safari Release] 1/5 Syncing web assets & Safari Xcode project...')
  execFileSync(process.execPath, [path.join(__dirname, 'build-safari.mjs'), '--sync-only'], {
    stdio: 'inherit',
  })

  const manifest = JSON.parse(fs.readFileSync(path.join(DIST_DIR, 'manifest.json'), 'utf8'))
  const version = manifest.version

  const xcodeproj = findFileRecursive(
    SAFARI_DIR,
    (entry) => entry.isDirectory() && entry.name.endsWith('.xcodeproj'),
  )
  if (!xcodeproj) {
    fail(`Could not locate .xcodeproj inside ${SAFARI_DIR}`)
  }

  const identity = resolveDeveloperIdIdentity()
  const teamId = resolveTeamId(identity)
  const notaryProfile = resolveNotaryProfile()

  console.log(`[Safari Release] 2/5 Building Universal Binary (arm64 + x86_64) signed as "${identity}"...`)
  execFileSync(
    'xcodebuild',
    [
      '-project',
      xcodeproj,
      '-scheme',
      `${APP_NAME} (macOS)`,
      '-configuration',
      'Release',
      '-destination',
      'generic/platform=macOS',
      '-derivedDataPath',
      RELEASE_DERIVED_DATA,
      'ARCHS=arm64 x86_64',
      'ONLY_ACTIVE_ARCH=NO',
      `DEVELOPMENT_TEAM=${teamId}`,
      'CODE_SIGN_STYLE=Manual',
      `CODE_SIGN_IDENTITY=${identity}`,
      'CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO',
      'OTHER_CODE_SIGN_FLAGS=--timestamp --options=runtime',
      'build',
    ],
    { stdio: 'inherit' },
  )

  const releaseProductsDir = path.join(RELEASE_DERIVED_DATA, 'Build', 'Products', 'Release')
  const appPath = findFileRecursive(
    releaseProductsDir,
    (entry) => entry.isDirectory() && entry.name.endsWith('.app'),
  )
  if (!appPath) {
    fail(`Missing Release .app bundle in ${releaseProductsDir}`)
  }

  const appexPath = findFileRecursive(
    path.join(appPath, 'Contents', 'PlugIns'),
    (entry) => entry.isDirectory() && entry.name.endsWith('.appex'),
  )
  if (!appexPath) {
    fail(`Missing embedded .appex inside ${appPath}`)
  }

  console.log('[Safari Release] 3/5 Enforcing production entitlements (no get-task-allow) & deep Developer ID signature...')
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synthszr-safari-release-'))
  try {
    const appEntPath = path.join(tmpDir, 'app.entitlements')
    const extEntPath = path.join(tmpDir, 'ext.entitlements')
    fs.writeFileSync(appEntPath, APP_ENTITLEMENTS_PLIST)
    fs.writeFileSync(extEntPath, EXT_ENTITLEMENTS_PLIST)

    execFileSync(
      'codesign',
      ['--force', '--sign', identity, '--options', 'runtime', '--timestamp', '--entitlements', extEntPath, appexPath],
      { stdio: 'inherit' },
    )
    execFileSync(
      'codesign',
      ['--force', '--sign', identity, '--options', 'runtime', '--timestamp', '--entitlements', appEntPath, appPath],
      { stdio: 'inherit' },
    )

    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
      stdio: 'inherit',
    })

    const appArchs = execFileSync('lipo', ['-info', path.join(appPath, 'Contents', 'MacOS', APP_NAME)], {
      encoding: 'utf8',
    }).trim()
    const extArchs = execFileSync(
      'lipo',
      ['-info', path.join(appexPath, 'Contents', 'MacOS', `${APP_NAME} Extension`)],
      { encoding: 'utf8' },
    ).trim()
    console.log(`  App Binary: ${appArchs}`)
    console.log(`  Ext Binary: ${extArchs}`)

    console.log('[Safari Release] 4/5 Creating & signing compressed DMG...')
    const dmgStaging = path.join(tmpDir, 'dmg-staging')
    fs.mkdirSync(dmgStaging, { recursive: true })
    execFileSync('ditto', [appPath, path.join(dmgStaging, `${APP_NAME}.app`)], { stdio: 'inherit' })
    fs.symlinkSync('/Applications', path.join(dmgStaging, 'Applications'))

    const dmgPath = path.join(__dirname, `Synthszr-Lexikon-v${version}.dmg`)
    fs.rmSync(dmgPath, { force: true })
    execFileSync(
      'hdiutil',
      ['create', '-volname', APP_NAME, '-srcfolder', dmgStaging, '-ov', '-format', 'UDZO', dmgPath],
      { stdio: 'inherit' },
    )
    execFileSync('codesign', ['--force', '--sign', identity, '--timestamp', dmgPath], {
      stdio: 'inherit',
    })
    execFileSync('codesign', ['--verify', '--verbose=2', dmgPath], { stdio: 'inherit' })

    if (notaryProfile) {
      console.log(`[Safari Release] 5/5 Submitting DMG for Apple Notarization (profile "${notaryProfile}")...`)
      execFileSync(
        'xcrun',
        ['notarytool', 'submit', dmgPath, '--keychain-profile', notaryProfile, '--wait'],
        { stdio: 'inherit' },
      )
      execFileSync('xcrun', ['stapler', 'staple', dmgPath], { stdio: 'inherit' })
      execFileSync('xcrun', ['stapler', 'validate', dmgPath], { stdio: 'inherit' })
      console.log(`\nNotarized & stapled DMG ready for website distribution:\n  ${dmgPath}`)
    } else {
      const dmgSizeKb = (fs.statSync(dmgPath).size / 1024).toFixed(1)
      console.log(`\n[Safari Release] 5/5 Signed Universal DMG created (${dmgSizeKb} KB), NOT YET NOTARIZED:`)
      console.log(`  DMG: ${dmgPath}`)
      console.log('\nTo notarize & staple once for Gatekeeper-free distribution on synthszr.com:')
      console.log(
        `  1. xcrun notarytool store-credentials "synthszr-notary" --apple-id "<DEINE_APPLE_ID>" --team-id "${teamId}" --password "<APP_SPEZIFISCHES_PASSWORT>"`,
      )
      console.log('  2. APPLE_NOTARY_PROFILE=synthszr-notary npm run ext:release:safari')
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

main()
