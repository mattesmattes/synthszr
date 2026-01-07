import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 16
const SALT_LENGTH = 16

// Version prefix for new encryption format
const VERSION_PREFIX = 'v2'

/**
 * Derive encryption key from secret and salt using scrypt
 * scrypt is a password-based key derivation function designed to be
 * computationally intensive to resist brute-force attacks
 */
function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, KEY_LENGTH)
}

/**
 * Get the encryption secret from environment
 */
function getSecret(): string {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is required. ' +
      'Generate one with: openssl rand -base64 32'
    )
  }
  return secret
}

/**
 * Encrypt text using AES-256-GCM with random salt
 * Format: v2:salt:iv:authTag:encryptedData (all hex encoded)
 *
 * Security improvements:
 * - Random salt per encryption (prevents rainbow table attacks)
 * - Random IV per encryption (prevents pattern analysis)
 * - Authenticated encryption (GCM mode provides integrity)
 */
export function encrypt(text: string): string {
  const secret = getSecret()

  // Generate random salt and IV for each encryption
  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)

  // Derive key using scrypt with random salt
  const key = deriveKey(secret, salt)

  const cipher = createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  // Format: v2:salt:iv:authTag:encryptedData
  return `${VERSION_PREFIX}:${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

/**
 * Decrypt text encrypted with encrypt()
 * Supports both new format (v2:salt:iv:authTag:data) and legacy format (iv:authTag:data)
 */
export function decrypt(encryptedText: string): string {
  const secret = getSecret()
  const parts = encryptedText.split(':')

  // Detect format based on version prefix or part count
  if (parts[0] === VERSION_PREFIX && parts.length === 5) {
    // New format: v2:salt:iv:authTag:encryptedData
    const salt = Buffer.from(parts[1], 'hex')
    const iv = Buffer.from(parts[2], 'hex')
    const authTag = Buffer.from(parts[3], 'hex')
    const encrypted = parts[4]

    // Derive key using the stored salt
    const key = deriveKey(secret, salt)

    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  } else if (parts.length === 3) {
    // Legacy format: iv:authTag:encryptedData (uses secret-derived salt)
    // Keep this for backwards compatibility with existing encrypted data
    const iv = Buffer.from(parts[0], 'hex')
    const authTag = Buffer.from(parts[1], 'hex')
    const encrypted = parts[2]

    // Legacy key derivation (salt from secret - not ideal but needed for compatibility)
    const legacySalt = secret.slice(0, 16)
    const key = scryptSync(secret, legacySalt, KEY_LENGTH)

    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  } else {
    throw new Error('Invalid encrypted format')
  }
}

/**
 * Re-encrypt data from legacy format to new secure format
 * Use this to migrate existing encrypted data
 */
export function migrateToSecureFormat(encryptedText: string): string {
  // Decrypt with legacy format
  const plaintext = decrypt(encryptedText)
  // Re-encrypt with new secure format
  return encrypt(plaintext)
}

/**
 * Check if encrypted text uses the new secure format
 */
export function isSecureFormat(encryptedText: string): boolean {
  return encryptedText.startsWith(VERSION_PREFIX + ':')
}
