import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const sharp = require('sharp')

const DIST_DIR = path.join(__dirname, 'dist')
const SAFARI_DIR = path.join(__dirname, 'safari')
const SAFARI_APP_SRC_DIR = path.join(__dirname, 'safari-app')
const DERIVED_DATA_DIR = path.join(SAFARI_DIR, 'build')
const APP_NAME = 'Synthszr Lexikon'
const BUNDLE_ID = 'com.synthszr.glossary'

const FULL_BLEED_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#111114"/>
  <rect x="192" y="756" width="640" height="84" rx="42" fill="#CCFF00"/>
  <text x="512" y="652" text-anchor="middle" font-family="ui-monospace, Menlo, Consolas, monospace" font-weight="800" font-size="560" fill="#FFFFFF">S</text>
</svg>`

const ROUNDED_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="224" fill="#111114"/>
  <rect x="192" y="756" width="640" height="84" rx="42" fill="#CCFF00"/>
  <text x="512" y="652" text-anchor="middle" font-family="ui-monospace, Menlo, Consolas, monospace" font-weight="800" font-size="560" fill="#FFFFFF">S</text>
</svg>`

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

function copyDirContents(srcDir, destDir) {
  fs.rmSync(destDir, { recursive: true, force: true })
  fs.mkdirSync(destDir, { recursive: true })
  fs.cpSync(srcDir, destDir, { recursive: true })
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

async function generateSafariIcons(projectRoot) {
  const fullBleedSvg = Buffer.from(FULL_BLEED_ICON_SVG)
  const roundedSvg = Buffer.from(ROUNDED_ICON_SVG)

  const appIconDir = path.join(projectRoot, 'Shared (App)', 'Assets.xcassets', 'AppIcon.appiconset')
  if (fs.existsSync(appIconDir)) {
    // App Store Connect requires iOS 1024x1024 icon to be opaque RGB without alpha (ITMS-90717)
    await sharp(fullBleedSvg)
      .resize(1024, 1024)
      .flatten({ background: '#111114' })
      .removeAlpha()
      .png()
      .toFile(path.join(appIconDir, 'universal-icon-1024@1x.png'))

    const macSizes = [
      ['mac-icon-16@1x.png', 16],
      ['mac-icon-16@2x.png', 32],
      ['mac-icon-32@1x.png', 32],
      ['mac-icon-32@2x.png', 64],
      ['mac-icon-128@1x.png', 128],
      ['mac-icon-128@2x.png', 256],
      ['mac-icon-256@1x.png', 256],
      ['mac-icon-256@2x.png', 512],
      ['mac-icon-512@1x.png', 512],
      ['mac-icon-512@2x.png', 1024],
    ]
    for (const [filename, size] of macSizes) {
      await sharp(roundedSvg).resize(size, size).png().toFile(path.join(appIconDir, filename))
    }
  }

  const largeIconPath = path.join(projectRoot, 'Shared (App)', 'Assets.xcassets', 'LargeIcon.imageset', 'icon-128.png')
  if (fs.existsSync(path.dirname(largeIconPath))) {
    await sharp(roundedSvg).resize(256, 256).png().toFile(largeIconPath)
  }

  const sharedAppIconPath = path.join(projectRoot, 'Shared (App)', 'Resources', 'Icon.png')
  fs.mkdirSync(path.dirname(sharedAppIconPath), { recursive: true })
  await sharp(roundedSvg).resize(256, 256).png().toFile(sharedAppIconPath)
}

function syncHostAppFiles(projectRoot) {
  const sharedAppDir = path.join(projectRoot, 'Shared (App)')
  const sharedAppResDir = path.join(sharedAppDir, 'Resources')
  const sharedExtDir = path.join(projectRoot, 'Shared (Extension)')

  fs.mkdirSync(path.join(sharedAppResDir, 'Base.lproj'), { recursive: true })
  fs.copyFileSync(path.join(SAFARI_APP_SRC_DIR, 'Main.html'), path.join(sharedAppResDir, 'Base.lproj', 'Main.html'))
  fs.copyFileSync(path.join(SAFARI_APP_SRC_DIR, 'Script.js'), path.join(sharedAppResDir, 'Script.js'))
  fs.copyFileSync(path.join(SAFARI_APP_SRC_DIR, 'Style.css'), path.join(sharedAppResDir, 'Style.css'))
  fs.copyFileSync(path.join(SAFARI_APP_SRC_DIR, 'ViewController.swift'), path.join(sharedAppDir, 'ViewController.swift'))

  const privacySrc = path.join(SAFARI_APP_SRC_DIR, 'PrivacyInfo.xcprivacy')
  fs.copyFileSync(privacySrc, path.join(sharedAppDir, 'PrivacyInfo.xcprivacy'))
  fs.copyFileSync(privacySrc, path.join(sharedExtDir, 'PrivacyInfo.xcprivacy'))
}

function patchMacStoryboard(projectRoot) {
  const sbPath = path.join(projectRoot, 'macOS (App)', 'Base.lproj', 'Main.storyboard')
  if (!fs.existsSync(sbPath)) return

  let sb = fs.readFileSync(sbPath, 'utf8')
  sb = sb.replace(
    /<windowStyleMask\s+key="styleMask"[^>]*\/>/,
    '<windowStyleMask key="styleMask" titled="YES" closable="YES" miniaturizable="YES" resizable="YES"/>',
  )
  sb = sb.replace(
    /<rect key="contentRect" x="196" y="240" width="\d+" height="\d+"\/>/,
    '<rect key="contentRect" x="196" y="180" width="560" height="680"/>',
  )
  sb = sb.replace(
    /<view key="view" id="m2S-Jp-Qdl">\s*<rect key="frame" x="0\.0" y="0\.0" width="\d+" height="\d+"\/>/,
    '<view key="view" id="m2S-Jp-Qdl">\n                        <rect key="frame" x="0.0" y="0.0" width="560" height="680"/>',
  )
  sb = sb.replace(
    /(<wkWebView[^>]*>\s*<rect key="frame" x="0\.0" y="0\.0" width=")\d+(" height=")\d+("\/>)/,
    '$1560$2680$3',
  )
  fs.writeFileSync(sbPath, sb)
}

function patchXcodeProject(xcodeproj, version) {
  const xcprojPath = path.join(xcodeproj, 'project.xcproj')
  if (!fs.existsSync(xcprojPath)) return

  let content = fs.readFileSync(xcprojPath, 'utf8')

  // 1. Register PrivacyInfo.xcprivacy for Shared (App)
  const appStart = content.indexOf('"path": "Shared (App)"')
  const appEnd = content.indexOf('"path": "Shared (Extension)"')
  if (appStart > 0 && appEnd > appStart) {
    const appSlice = content.slice(appStart, appEnd)
    const appAssetAnchor = '          "path": "Assets.xcassets",'
    if (!appSlice.includes('"PrivacyInfo.xcprivacy"') && appSlice.includes(appAssetAnchor)) {
      const appPrivacyReplacement =
        '          "path": "PrivacyInfo.xcprivacy",\n' +
        '          "target-membership": [\n' +
        '            "Synthszr Lexikon (iOS)/resources",\n' +
        '            "Synthszr Lexikon (macOS)/resources",\n' +
        '          ],\n' +
        '        }, {\n' +
        '          "path": "Assets.xcassets",'
      content =
        content.slice(0, appStart) +
        appSlice.replace(appAssetAnchor, appPrivacyReplacement) +
        content.slice(appEnd)
    }
  }

  // 2. Register PrivacyInfo.xcprivacy for Shared (Extension)
  const extHandlerNeedle = `          "path": "SafariWebExtensionHandler.swift",`
  const extPrivacyBlock = `          "path": "PrivacyInfo.xcprivacy",\n          "target-membership": [\n            "Synthszr Lexikon Extension (iOS)/resources",\n            "Synthszr Lexikon Extension (macOS)/resources",\n          ],\n        }, {\n          "path": "SafariWebExtensionHandler.swift",`
  const extStart = content.indexOf('"path": "Shared (Extension)"')
  const extEnd = content.indexOf('"path": "iOS (App)"')
  if (extStart > 0 && extEnd > extStart) {
    const extSlice = content.slice(extStart, extEnd)
    if (!extSlice.includes('"PrivacyInfo.xcprivacy"') && extSlice.includes(extHandlerNeedle)) {
      content =
        content.slice(0, extStart) +
        extSlice.replace(extHandlerNeedle, extPrivacyBlock) +
        content.slice(extEnd)
    }
  }

  // 3. Synchronize MARKETING_VERSION across all targets with manifest.json version
  content = content.replace(/"MARKETING_VERSION":\s*"[^"]+"/g, `"MARKETING_VERSION": "${version}"`)

  // 4. Add App Store compliance Info.plist keys on macOS App target
  const macAnchor = `"INFOPLIST_KEY_NSPrincipalClass": "NSApplication",`
  if (content.includes(macAnchor) && !content.includes('"INFOPLIST_KEY_LSApplicationCategoryType"')) {
    content = content.replace(
      macAnchor,
      `${macAnchor}\n        "INFOPLIST_KEY_ITSAppUsesNonExemptEncryption": "NO",\n        "INFOPLIST_KEY_LSApplicationCategoryType": "public.app-category.reference",\n        "INFOPLIST_KEY_NSHumanReadableCopyright": "Copyright © 2026 Synthszr. All rights reserved.",`,
    )
  }

  // 5. Add App Store compliance Info.plist keys on iOS App target
  const iosAnchor = `"INFOPLIST_KEY_CFBundleDisplayName": "Synthszr Lexikon",\n        "INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents": "YES",`
  if (content.includes(iosAnchor)) {
    const iosTargetSliceEnd = content.indexOf('"name": "Synthszr Lexikon (macOS)"')
    const iosSlice = iosTargetSliceEnd > 0 ? content.slice(0, iosTargetSliceEnd) : content
    if (!iosSlice.includes('"INFOPLIST_KEY_ITSAppUsesNonExemptEncryption"')) {
      content = content.replace(
        iosAnchor,
        `"INFOPLIST_KEY_CFBundleDisplayName": "Synthszr Lexikon",\n        "INFOPLIST_KEY_ITSAppUsesNonExemptEncryption": "NO",\n        "INFOPLIST_KEY_NSHumanReadableCopyright": "Copyright © 2026 Synthszr. All rights reserved.",\n        "INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents": "YES",`,
      )
    }
  }

  fs.writeFileSync(xcprojPath, content)
}

async function main() {
  if (process.platform !== 'darwin') {
    fail('Safari Web Extension builds require macOS with Xcode installed.')
  }

  const regenerate = process.argv.includes('--regenerate')
  const syncOnly = process.argv.includes('--sync-only')

  try {
    execFileSync('xcrun', ['--find', 'safari-web-extension-converter'], { stdio: 'ignore' })
  } catch {
    fail('xcrun safari-web-extension-converter not found. Please install Xcode from the Mac App Store.')
  }

  console.log('[Safari Build] 1/4 Building shared MV3 web assets (dist/)...')
  execFileSync(process.execPath, [path.join(__dirname, 'build.mjs')], {
    stdio: 'inherit',
  })

  const distManifestPath = path.join(DIST_DIR, 'manifest.json')
  if (!fs.existsSync(distManifestPath)) {
    fail(`Missing ${distManifestPath} after build.mjs`)
  }
  const distManifest = JSON.parse(fs.readFileSync(distManifestPath, 'utf8'))

  const existingXcodeproj = findFileRecursive(
    SAFARI_DIR,
    (entry) => entry.isDirectory() && entry.name.endsWith('.xcodeproj'),
  )

  if (regenerate || !existingXcodeproj) {
    console.log('[Safari Build] 2/4 Generating multiplatform (macOS + iOS) Xcode project...')
    fs.rmSync(SAFARI_DIR, { recursive: true, force: true })
    fs.mkdirSync(SAFARI_DIR, { recursive: true })
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
  } else {
    console.log('[Safari Build] 2/4 Preserving existing Xcode project (pass --regenerate to recreate)...')
  }

  const xcodeproj = findFileRecursive(
    SAFARI_DIR,
    (entry) => entry.isDirectory() && entry.name.endsWith('.xcodeproj'),
  )
  if (!xcodeproj) {
    fail(`Could not locate .xcodeproj inside ${SAFARI_DIR}`)
  }

  const projectRoot = path.dirname(xcodeproj)
  const extResourcesDir = path.join(projectRoot, 'Shared (Extension)', 'Resources')

  console.log('[Safari Build] 3/4 Syncing extension assets, standalone glossary container app & App Store compliance...')
  copyDirContents(DIST_DIR, extResourcesDir)

  // Use Safari MV3 non-persistent event page instead of service_worker to prevent WebKit cold-wake IPC hangs
  const safariManifestPath = path.join(extResourcesDir, 'manifest.json')
  const safariManifest = JSON.parse(fs.readFileSync(safariManifestPath, 'utf8'))
  safariManifest.background = {
    scripts: ['background/service-worker.js'],
    persistent: false,
  }
  fs.writeFileSync(safariManifestPath, `${JSON.stringify(safariManifest, null, 2)}\n`)

  syncHostAppFiles(projectRoot)
  await generateSafariIcons(projectRoot)
  patchMacStoryboard(projectRoot)
  patchXcodeProject(xcodeproj, distManifest.version)

  if (syncOnly) {
    console.log(`[Safari Build] Synced Xcode project ready at: ${xcodeproj}`)
    return
  }

  const scheme = resolveMacOsScheme(xcodeproj)
  console.log(`[Safari Build] 4/4 Building macOS app scheme "${scheme}" via xcodebuild...`)

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

  console.log('\nBuilt Synthszr Lexikon for Safari (App Store ready):')
  console.log(`  Version:       ${distManifest.version}`)
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

main().catch((err) => {
  console.error('\n[Safari Build] Failed:', err)
  process.exit(1)
})
