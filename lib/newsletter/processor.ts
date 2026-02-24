import { runNewsletterFetch } from './fetcher'

export interface NewsletterProcessResult {
  success: boolean
  message?: string
  processed?: number
  articles?: number
  errors?: number
  status?: number
}

export interface NewsletterProcessOptions {
  forceSince?: string | Date
  labelPattern?: string
  labelsOnly?: boolean
}

export async function processNewsletters(options?: NewsletterProcessOptions): Promise<NewsletterProcessResult> {
  const result = await runNewsletterFetch({
    force: !!options?.forceSince,
    targetDate: options?.forceSince ? new Date(options.forceSince).toISOString().split('T')[0] : undefined,
  })
  return {
    success: result.success,
    message: `Processed ${result.newsletters} newsletters and ${result.articles} articles`,
    processed: result.newsletters,
    articles: result.articles,
    errors: result.errors,
  }
}
