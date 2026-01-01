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
    afterDate?: Date
  ): Promise<EmailMessage[]> {
    // Build query for multiple senders - search everywhere (not just inbox)
    const fromQuery = senderEmails.map(email => `from:${email}`).join(' OR ')
    let query = `(${fromQuery})`

    // Add date filter if provided
    if (afterDate) {
      const dateStr = afterDate.toISOString().split('T')[0].replace(/-/g, '/')
      query += ` after:${dateStr}`
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
}
