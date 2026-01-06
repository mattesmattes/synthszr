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
   */
  async fetchEmailsFromSenders(
    senderEmails: string[],
    maxResults: number = 50,
    afterDate?: Date,
    beforeDate?: Date
  ): Promise<EmailMessage[]> {
    // Build query for multiple senders - search everywhere (not just inbox)
    const fromQuery = senderEmails.map(email => `from:${email}`).join(' OR ')
    let query = `(${fromQuery})`

    // Add date filter if provided
    if (afterDate) {
      const dateStr = afterDate.toISOString().split('T')[0].replace(/-/g, '/')
      query += ` after:${dateStr}`
    }

    // Add before date filter if provided (for specific date searches)
    if (beforeDate) {
      // Gmail's before: is exclusive, so add one day
      const nextDay = new Date(beforeDate)
      nextDay.setDate(nextDay.getDate() + 1)
      const dateStr = nextDay.toISOString().split('T')[0].replace(/-/g, '/')
      query += ` before:${dateStr}`
    }

    // Log the query for debugging
    console.log('[Gmail] Search query:', query)
    console.log('[Gmail] Searching for emails from:', senderEmails.length, 'senders')

    try {
      // List messages matching the query
      // Note: By default this searches all mail, but excludes Spam and Trash
      // Add includeSpamTrash: true if needed
      const listResponse = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults,
        includeSpamTrash: false, // Set to true to include spam/trash
      })

      console.log('[Gmail] Found messages:', listResponse.data.messages?.length || 0)

      const messages = listResponse.data.messages || []
      const emails: EmailMessage[] = []

      // Fetch full message details for each
      for (const msg of messages) {
        if (!msg.id) continue

        const fullMessage = await this.gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full',
        })

        const email = this.parseMessage(fullMessage.data)
        if (email) {
          emails.push(email)
        }
      }

      return emails
    } catch (error) {
      console.error('Error fetching emails:', error)
      throw error
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
   * Scan unique senders from the last N days
   * Returns aggregated sender info with email count and sample subjects
   */
  async scanUniqueSenders(
    days: number = 30,
    maxMessages: number = 500
  ): Promise<Array<{
    email: string
    name: string
    count: number
    subjects: string[]
    latestDate: Date
  }>> {
    const afterDate = new Date()
    afterDate.setDate(afterDate.getDate() - days)
    const dateStr = afterDate.toISOString().split('T')[0].replace(/-/g, '/')

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
