import { google, gmail_v1 } from 'googleapis'
import { getAuthenticatedClient } from './oauth'

export interface EmailMessage {
  id: string
  threadId: string
  from: string
  subject: string
  date: Date
  snippet: string
  htmlBody: string | null
  textBody: string | null
}

export class GmailClient {
  private gmail: gmail_v1.Gmail

  constructor(refreshToken: string) {
    const auth = getAuthenticatedClient(refreshToken)
    this.gmail = google.gmail({ version: 'v1', auth })
  }

  /**
   * Fetch emails from specific senders
   * Note: For large sender lists (>30), queries are batched to avoid Gmail API limits
   *
   * IMPROVED (2026-01-18):
   * - Includes Promotions/Updates categories explicitly
   * - Increased per-batch results for better coverage
   * - Tracks which senders were found for gap detection
   */
  async fetchEmailsFromSenders(
    senderEmails: string[],
    maxResults: number = 50,
    afterDate?: Date,
    beforeDate?: Date
  ): Promise<EmailMessage[]> {
    // Batch size to avoid Gmail query length limits
    // Gmail has ~2048 char limit, each email adds ~30 chars, so 30 is safe
    const BATCH_SIZE = 30

    // INCREASED: Request more results per batch to avoid missing low-volume senders
    const RESULTS_PER_BATCH = 100

    // Build date filter suffix
    let dateFilter = ''
    if (afterDate) {
      const dateStr = afterDate.toISOString().split('T')[0].replace(/-/g, '/')
      dateFilter += ` after:${dateStr}`
    }
    if (beforeDate) {
      const nextDay = new Date(beforeDate)
      nextDay.setDate(nextDay.getDate() + 1)
      const dateStr = nextDay.toISOString().split('T')[0].replace(/-/g, '/')
      dateFilter += ` before:${dateStr}`
    }

    console.log(`[Gmail] ========== FETCH START ==========`)
    console.log(`[Gmail] Searching ${senderEmails.length} senders, afterDate: ${afterDate?.toISOString()}, beforeDate: ${beforeDate?.toISOString()}`)
    console.log(`[Gmail] Sample senders: ${senderEmails.slice(0, 10).join(', ')}${senderEmails.length > 10 ? '...' : ''}`)

    // Split into batches if needed
    const batches: string[][] = []
    for (let i = 0; i < senderEmails.length; i += BATCH_SIZE) {
      batches.push(senderEmails.slice(i, i + BATCH_SIZE))
    }

    console.log(`[Gmail] Split into ${batches.length} batches of max ${BATCH_SIZE} senders each`)

    const allMessages: gmail_v1.Schema$Message[] = []
    const seenIds = new Set<string>()

    // Process each batch
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex]
      const fromQuery = batch.map(email => `from:${email}`).join(' OR ')
      // IMPROVED: Don't restrict to inbox - search everywhere including Promotions/Updates
      const query = `(${fromQuery})${dateFilter}`

      console.log(`[Gmail] Batch ${batchIndex + 1}/${batches.length}: ${batch.length} senders`)
      console.log(`[Gmail] Batch ${batchIndex + 1} senders: ${batch.slice(0, 5).join(', ')}${batch.length > 5 ? '...' : ''}`)
      console.log(`[Gmail] Batch ${batchIndex + 1} query: ${query.slice(0, 200)}...`)

      try {
        const listResponse = await this.gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: RESULTS_PER_BATCH, // INCREASED: Fixed per-batch limit instead of divided
          includeSpamTrash: false,
        })

        const messages = listResponse.data.messages || []
        console.log(`[Gmail] Batch ${batchIndex + 1} RESULT: ${messages.length} messages found`)

        for (const msg of messages) {
          if (msg.id && !seenIds.has(msg.id)) {
            seenIds.add(msg.id)
            allMessages.push(msg)
          }
        }
      } catch (error) {
        console.error(`[Gmail] Error in batch ${batchIndex + 1}:`, error)
        // Continue with other batches
      }
    }

    console.log(`[Gmail] ========== FETCH SUMMARY ==========`)
    console.log(`[Gmail] Total unique messages from all batches: ${allMessages.length}`)

    // Sort by internalDate (most recent first) to ensure fair distribution across batches
    // Gmail's internalDate is a string timestamp in milliseconds
    allMessages.sort((a, b) => {
      const dateA = parseInt(a.internalDate || '0', 10)
      const dateB = parseInt(b.internalDate || '0', 10)
      return dateB - dateA // Most recent first
    })

    // Limit to maxResults and fetch full message details
    const messagesToFetch = allMessages.slice(0, maxResults)
    console.log(`[Gmail] Will fetch details for ${messagesToFetch.length} messages (maxResults: ${maxResults})`)
    const emails: EmailMessage[] = []

    for (const msg of messagesToFetch) {
      if (!msg.id) continue

      try {
        const fullMessage = await this.gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full',
        })

        const email = this.parseMessage(fullMessage.data)
        if (email) {
          emails.push(email)
        }
      } catch (error) {
        console.error('[Gmail] Error fetching message:', msg.id, error)
      }
    }

    // Log which senders were actually found
    const foundSenders = new Set(emails.map(e => {
      const match = e.from.match(/<([^>]+)>/)
      return match ? match[1].toLowerCase() : e.from.toLowerCase()
    }))
    console.log(`[Gmail] ========== FETCH COMPLETE ==========`)
    console.log(`[Gmail] Fetched ${emails.length} full emails from ${foundSenders.size} unique senders`)
    console.log(`[Gmail] Found senders: ${Array.from(foundSenders).slice(0, 15).join(', ')}${foundSenders.size > 15 ? '...' : ''}`)

    // Check which registered senders were NOT found
    const missingSenders = senderEmails.filter(s => !foundSenders.has(s.toLowerCase()))
    if (missingSenders.length > 0) {
      console.log(`[Gmail] WARNING: ${missingSenders.length}/${senderEmails.length} registered senders had NO emails in results`)
      console.log(`[Gmail] Missing senders sample: ${missingSenders.slice(0, 10).join(', ')}${missingSenders.length > 10 ? '...' : ''}`)
    }

    return emails
  }

  /**
   * Fetch emails from a SINGLE sender - used as fallback for missed senders
   * This is more targeted and reliable than batch queries for specific senders
   *
   * ADDED (2026-01-18): Per-sender fallback to catch newsletters missed by batch queries
   */
  async fetchEmailsFromSingleSender(
    senderEmail: string,
    maxResults: number = 5,
    afterDate?: Date
  ): Promise<EmailMessage[]> {
    let dateFilter = ''
    if (afterDate) {
      const dateStr = afterDate.toISOString().split('T')[0].replace(/-/g, '/')
      dateFilter = ` after:${dateStr}`
    }

    // Simple, targeted query for a single sender
    const query = `from:${senderEmail}${dateFilter}`

    console.log(`[Gmail] Single-sender fetch for: ${senderEmail}`)

    try {
      const listResponse = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults,
        includeSpamTrash: false,
      })

      const messages = listResponse.data.messages || []
      console.log(`[Gmail] Single-sender found: ${messages.length} messages`)

      const emails: EmailMessage[] = []
      for (const msg of messages) {
        if (!msg.id) continue

        try {
          const fullMessage = await this.gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'full',
          })

          const email = this.parseMessage(fullMessage.data)
          if (email) {
            emails.push(email)
          }
        } catch (error) {
          console.error('[Gmail] Error fetching message:', msg.id, error)
        }
      }

      return emails
    } catch (error) {
      console.error(`[Gmail] Error in single-sender fetch for ${senderEmail}:`, error)
      return []
    }
  }

  /**
   * Parse a Gmail message into our EmailMessage format
   */
  private parseMessage(message: gmail_v1.Schema$Message): EmailMessage | null {
    if (!message.id || !message.threadId || !message.payload) {
      return null
    }

    const headers = message.payload.headers || []
    const getHeader = (name: string): string => {
      const header = headers.find(h => h.name?.toLowerCase() === name.toLowerCase())
      return header?.value || ''
    }

    const from = getHeader('From')
    const subject = getHeader('Subject')
    const dateStr = getHeader('Date')

    // Parse body
    const { htmlBody, textBody } = this.extractBody(message.payload)

    return {
      id: message.id,
      threadId: message.threadId,
      from,
      subject,
      date: dateStr ? new Date(dateStr) : new Date(),
      snippet: message.snippet || '',
      htmlBody,
      textBody,
    }
  }

  /**
   * Extract HTML and plain text body from message payload
   */
  private extractBody(payload: gmail_v1.Schema$MessagePart): {
    htmlBody: string | null
    textBody: string | null
  } {
    let htmlBody: string | null = null
    let textBody: string | null = null

    const processPartRecursively = (part: gmail_v1.Schema$MessagePart) => {
      if (part.mimeType === 'text/html' && part.body?.data) {
        htmlBody = Buffer.from(part.body.data, 'base64').toString('utf-8')
      } else if (part.mimeType === 'text/plain' && part.body?.data) {
        textBody = Buffer.from(part.body.data, 'base64').toString('utf-8')
      }

      // Process nested parts
      if (part.parts) {
        for (const subPart of part.parts) {
          processPartRecursively(subPart)
        }
      }
    }

    // Check if body is directly on payload
    if (payload.body?.data) {
      if (payload.mimeType === 'text/html') {
        htmlBody = Buffer.from(payload.body.data, 'base64').toString('utf-8')
      } else if (payload.mimeType === 'text/plain') {
        textBody = Buffer.from(payload.body.data, 'base64').toString('utf-8')
      }
    }

    // Process nested parts
    if (payload.parts) {
      for (const part of payload.parts) {
        processPartRecursively(part)
      }
    }

    return { htmlBody, textBody }
  }

  /**
   * Mark a message as read
   */
  async markAsRead(messageId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: ['UNREAD'],
      },
    })
  }

  /**
   * Add a label to a message
   */
  async addLabel(messageId: string, labelId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: [labelId],
      },
    })
  }

  /**
   * Get user profile to verify connection
   */
  async getProfile(): Promise<{ email: string; messagesTotal: number }> {
    const response = await this.gmail.users.getProfile({
      userId: 'me',
    })

    return {
      email: response.data.emailAddress || '',
      messagesTotal: response.data.messagesTotal || 0,
    }
  }

  /**
   * Fetch emails by sender and subject pattern
   * Used for importing emails with specific subject tags like "+dailyrepo"
   */
  async fetchEmailsBySubject(
    senderEmail: string | null,
    subjectContains: string,
    maxResults: number = 50,
    hoursBack: number = 24
  ): Promise<EmailMessage[]> {
    // Build query: optionally filter by sender, always filter by subject
    // Gmail search: subject:"text" matches subjects containing "text"
    const afterDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000)
    const dateStr = afterDate.toISOString().split('T')[0].replace(/-/g, '/')

    // Escape special characters in subject for Gmail query
    const escapedSubject = subjectContains.replace(/[+]/g, '')
    const fromFilter = senderEmail ? `from:${senderEmail} ` : ''
    const query = `${fromFilter}subject:"${escapedSubject}" after:${dateStr}`

    console.log('[Gmail] Fetching emails by subject with query:', query)

    try {
      const listResponse = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults,
        includeSpamTrash: false,
      })

      console.log('[Gmail] Found messages:', listResponse.data.messages?.length || 0)

      const messages = listResponse.data.messages || []
      const emails: EmailMessage[] = []

      for (const msg of messages) {
        if (!msg.id) continue

        const fullMessage = await this.gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full',
        })

        const email = this.parseMessage(fullMessage.data)
        if (email) {
          // Double-check subject contains the pattern (case-insensitive)
          if (email.subject.toLowerCase().includes(subjectContains.toLowerCase())) {
            emails.push(email)
          }
        }
      }

      return emails
    } catch (error) {
      console.error('Error fetching emails by subject:', error)
      throw error
    }
  }

  /**
   * List all Gmail labels
   * Returns label ID and name for each label
   */
  async listLabels(): Promise<Array<{ id: string; name: string }>> {
    try {
      const response = await this.gmail.users.labels.list({
        userId: 'me',
      })

      return (response.data.labels || [])
        .filter((label): label is gmail_v1.Schema$Label => !!label.id && !!label.name)
        .map(label => ({
          id: label.id!,
          name: label.name!,
        }))
    } catch (error) {
      console.error('[Gmail] Error listing labels:', error)
      return []
    }
  }

  /**
   * Fetch emails from specific Gmail labels
   * Used to fetch newsletters that are labeled (e.g., "newsstand-ai", "newsstand-marketing")
   *
   * IMPROVED (2026-01-18):
   * - Uses labelIds parameter instead of label: query for reliability
   * - Properly handles labels with special characters (#, /, spaces)
   * - Increased per-label results
   *
   * @param labelPattern - Pattern to match label names (e.g., "newsstand" matches "newsstand-ai", "newsstand/marketing")
   * @param maxResults - Maximum number of emails to fetch
   * @param afterDate - Only fetch emails after this date
   */
  async fetchEmailsFromLabels(
    labelPattern: string,
    maxResults: number = 50,
    afterDate?: Date
  ): Promise<EmailMessage[]> {
    // First, find all labels matching the pattern
    const allLabels = await this.listLabels()

    // IMPROVED: More flexible label matching - handle # prefix and case variations
    const normalizedPattern = labelPattern.toLowerCase().replace(/^#/, '')
    const matchingLabels = allLabels.filter(label => {
      const normalizedLabelName = label.name.toLowerCase().replace(/^#/, '')
      return normalizedLabelName.includes(normalizedPattern)
    })

    if (matchingLabels.length === 0) {
      console.log(`[Gmail] No labels found matching pattern: ${labelPattern}`)
      return []
    }

    console.log(`[Gmail] Found ${matchingLabels.length} labels matching "${labelPattern}":`,
      matchingLabels.map(l => `${l.name} (id: ${l.id})`).join(', '))

    // Build date query filter
    let dateQuery = ''
    if (afterDate) {
      const dateStr = afterDate.toISOString().split('T')[0].replace(/-/g, '/')
      dateQuery = `after:${dateStr}`
    }

    const allMessages: gmail_v1.Schema$Message[] = []
    const seenIds = new Set<string>()

    // IMPROVED: Use labelIds parameter instead of label: query
    // This is more reliable and handles special characters correctly
    for (const label of matchingLabels) {
      try {
        console.log(`[Gmail] Fetching from label "${label.name}" (id: ${label.id})`)

        const listResponse = await this.gmail.users.messages.list({
          userId: 'me',
          labelIds: [label.id], // Use labelIds instead of query - more reliable!
          q: dateQuery || undefined, // Only add date filter if present
          maxResults: 100, // INCREASED: More results per label
          includeSpamTrash: false,
        })

        const messages = listResponse.data.messages || []
        console.log(`[Gmail] Label "${label.name}" returned ${messages.length} messages`)

        for (const msg of messages) {
          if (msg.id && !seenIds.has(msg.id)) {
            seenIds.add(msg.id)
            allMessages.push(msg)
          }
        }
      } catch (error) {
        console.error(`[Gmail] Error fetching from label "${label.name}":`, error)
        // Continue with other labels
      }
    }

    console.log(`[Gmail] Total unique messages from labels: ${allMessages.length}`)

    // Sort by internalDate (most recent first)
    allMessages.sort((a, b) => {
      const dateA = parseInt(a.internalDate || '0', 10)
      const dateB = parseInt(b.internalDate || '0', 10)
      return dateB - dateA
    })

    // Limit to maxResults and fetch full message details
    const messagesToFetch = allMessages.slice(0, maxResults)
    const emails: EmailMessage[] = []

    for (const msg of messagesToFetch) {
      if (!msg.id) continue

      try {
        const fullMessage = await this.gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full',
        })

        const email = this.parseMessage(fullMessage.data)
        if (email) {
          emails.push(email)
        }
      } catch (error) {
        console.error('[Gmail] Error fetching message:', msg.id, error)
      }
    }

    return emails
  }

  /**
   * Scan unique senders from a specific date or last N days
   * Returns aggregated sender info with email count and sample subjects
   * @param afterDate - Scan emails after this date (takes precedence over days)
   * @param days - Fallback: scan last N days if afterDate not provided
   * @param maxMessages - Maximum messages to scan
   */
  async scanUniqueSenders(
    afterDate?: Date,
    days: number = 30,
    maxMessages: number = 500
  ): Promise<Array<{
    email: string
    name: string
    count: number
    subjects: string[]
    latestDate: Date
  }>> {
    const scanAfter = afterDate || new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const dateStr = scanAfter.toISOString().split('T')[0].replace(/-/g, '/')

    // Search for emails that look like newsletters (excluding obvious non-newsletters)
    // category:promotions often catches newsletters, category:updates too
    // Exclude sent mail, drafts, and trash
    const query = `after:${dateStr} -in:sent -in:drafts -in:trash`

    console.log('[Gmail] Scanning unique senders with query:', query)

    try {
      const listResponse = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: maxMessages,
        includeSpamTrash: false,
      })

      console.log('[Gmail] Found messages to scan:', listResponse.data.messages?.length || 0)

      const messages = listResponse.data.messages || []
      const senderMap = new Map<string, {
        email: string
        name: string
        count: number
        subjects: string[]
        latestDate: Date
      }>()

      // Fetch headers for each message (we only need From, Subject, Date)
      for (const msg of messages) {
        if (!msg.id) continue

        try {
          const fullMessage = await this.gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
          })

          const headers = fullMessage.data.payload?.headers || []
          const getHeader = (name: string): string => {
            const header = headers.find(h => h.name?.toLowerCase() === name.toLowerCase())
            return header?.value || ''
          }

          const fromRaw = getHeader('From')
          const subject = getHeader('Subject')
          const dateStr = getHeader('Date')

          // Parse "Name <email@domain.com>" format
          const emailMatch = fromRaw.match(/<([^>]+)>/)
          const email = emailMatch ? emailMatch[1].toLowerCase() : fromRaw.toLowerCase().trim()
          const nameMatch = fromRaw.match(/^([^<]+)/)
          const name = nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, '') : email

          if (!email || !email.includes('@')) continue

          const existing = senderMap.get(email)
          const msgDate = dateStr ? new Date(dateStr) : new Date()

          if (existing) {
            existing.count++
            if (existing.subjects.length < 3 && subject) {
              existing.subjects.push(subject)
            }
            if (msgDate > existing.latestDate) {
              existing.latestDate = msgDate
            }
          } else {
            senderMap.set(email, {
              email,
              name: name || email,
              count: 1,
              subjects: subject ? [subject] : [],
              latestDate: msgDate,
            })
          }
        } catch (err) {
          // Skip individual message errors
          console.warn('[Gmail] Error fetching message:', msg.id, err)
        }
      }

      // Convert to array and sort by count (most emails first)
      const results = Array.from(senderMap.values())
        .sort((a, b) => b.count - a.count)

      console.log('[Gmail] Found unique senders:', results.length)

      return results
    } catch (error) {
      console.error('Error scanning senders:', error)
      throw error
    }
  }
}
