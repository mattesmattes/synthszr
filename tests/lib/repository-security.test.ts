/**
 * Supply-chain policy guard (SEC-005, SEC-012).
 *
 * These are the properties that make an install reproducible: one lockfile,
 * one pinned package manager, a declared Node floor, and no build step that
 * downloads a tool at build time instead of resolving it from the lockfile.
 * A test rather than a convention, because every one of these regressed
 * silently before.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

describe('repository supply-chain policy', () => {
  it('pins exactly one package manager', () => {
    expect(pkg.packageManager).toBe('pnpm@10.20.0')
  })

  it('pins the runtime rather than allowing a range', () => {
    // Vercel picks the Lambda runtime from engines.node. A range like
    // ">=22.17" would let the platform silently move production to a
    // different major; the hard pin keeps it on 24. Verified that this costs
    // only a pnpm warning on the local Node 22.17 toolchain, not a failed
    // install.
    expect(pkg.engines.node).toBe('24.x')
    expect(pkg.engines.pnpm).toBe('10.20.x')
  })

  it('pins the runtime for version managers and the build platform', () => {
    // Both files are read by nvm/fnm locally and by Vercel when picking the
    // Lambda runtime. They name the target (24), while engines.node above is
    // the floor - a deployment must never silently fall back to Node 20.
    for (const file of ['.nvmrc', '.node-version']) {
      expect(existsSync(path.join(root, file))).toBe(true)
      expect(readFileSync(path.join(root, file), 'utf8').trim()).toBe('24')
    }
  })

  it('keeps pnpm as the only lockfile', () => {
    expect(existsSync(path.join(root, 'pnpm-lock.yaml'))).toBe(true)
    expect(existsSync(path.join(root, 'package-lock.json'))).toBe(false)
  })

  it('does not download build tools through npx', () => {
    // `npx tsx ...` resolves tsx from the network at build time, outside the
    // lockfile - the exact substitution point a registry compromise needs.
    expect(Object.values(pkg.scripts).join('\n')).not.toMatch(/\bnpx\b/)
    expect(pkg.devDependencies.tsx).toBeDefined()
  })

  it('does not invoke npm from a pnpm-managed project', () => {
    expect(Object.values(pkg.scripts).join('\n')).not.toMatch(/\bnpm run\b/)
  })

  it('keeps the semgrep ruleset loadable', () => {
    // This file was unparseable YAML for its entire life: three patterns
    // contained a bare ": ", which YAML reads as a mapping. Semgrep exited 7
    // without scanning, and the workflow's `|| true` reported success anyway,
    // so none of these rules ever ran. Parsing it here makes that failure
    // mode loud instead of silent.
    const raw = readFileSync(path.join(root, '.semgrep.yml'), 'utf8')
    const config = parseYaml(raw)

    expect(Array.isArray(config.rules)).toBe(true)
    expect(config.rules.length).toBeGreaterThan(0)

    const MATCHERS = ['pattern', 'patterns', 'pattern-either', 'pattern-regex']
    for (const rule of config.rules) {
      expect(rule.id, `rule without id: ${JSON.stringify(rule).slice(0, 80)}`).toBeTruthy()
      expect(['ERROR', 'WARNING', 'INFO']).toContain(rule.severity)
      expect(rule.message).toBeTruthy()
      expect(rule.languages?.length ?? 0).toBeGreaterThan(0)

      // Semgrep rejects a rule that has more than one top-level matcher -
      // sibling keys like `pattern:` next to `pattern-not:` have to be
      // wrapped in a single `patterns:` list instead.
      const present = MATCHERS.filter(key => key in rule)
      expect(present, `rule "${rule.id}" must have exactly one top-level matcher`).toHaveLength(1)
      expect('pattern-not' in rule, `rule "${rule.id}" has a stray top-level pattern-not`).toBe(false)
      expect('pattern-not-inside' in rule, `rule "${rule.id}" has a stray top-level pattern-not-inside`).toBe(false)
    }
  })

  it('documents every audit exception instead of lowering the gate', () => {
    // Advisories may only be suppressed one-by-one with a reason, never by
    // relaxing --audit-level.
    const ignored = pkg.pnpm?.auditConfig?.ignoreGhsas ?? []
    expect(Array.isArray(ignored)).toBe(true)
    for (const ghsa of ignored) {
      expect(ghsa).toMatch(/^GHSA-/)
    }
    expect(pkg.pnpm.auditExceptionNotes).toBeDefined()
    for (const ghsa of ignored) {
      expect(Object.keys(pkg.pnpm.auditExceptionNotes)).toContain(ghsa)
    }
  })
})
