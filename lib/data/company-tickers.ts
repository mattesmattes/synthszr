/**
 * Company Stock Ticker Mappings
 *
 * Manually maintained mapping of company names to stock tickers.
 * Used for real-time stock quotes via EODHD API.
 *
 * NOTE: This file is NOT auto-generated. Edit manually as needed.
 */

/**
 * Company name to stock ticker mapping for real-time quotes
 * Used by stock-synthszr batch endpoints
 */
export const COMPANY_TICKERS: Record<string, { symbol: string; exchange: string }> = {
  // Big Tech
  'apple': { symbol: 'AAPL', exchange: 'US' },
  'microsoft': { symbol: 'MSFT', exchange: 'US' },
  'google': { symbol: 'GOOGL', exchange: 'US' },
  'alphabet': { symbol: 'GOOGL', exchange: 'US' },
  'amazon': { symbol: 'AMZN', exchange: 'US' },
  'meta': { symbol: 'META', exchange: 'US' },
  'facebook': { symbol: 'META', exchange: 'US' },
  'nvidia': { symbol: 'NVDA', exchange: 'US' },
  'tesla': { symbol: 'TSLA', exchange: 'US' },
  'netflix': { symbol: 'NFLX', exchange: 'US' },

  // AI & Cloud
  'salesforce': { symbol: 'CRM', exchange: 'US' },
  'snowflake': { symbol: 'SNOW', exchange: 'US' },
  'palantir': { symbol: 'PLTR', exchange: 'US' },
  'crowdstrike': { symbol: 'CRWD', exchange: 'US' },
  'cloudflare': { symbol: 'NET', exchange: 'US' },

  // Semiconductors
  'intel': { symbol: 'INTC', exchange: 'US' },
  'amd': { symbol: 'AMD', exchange: 'US' },
  'qualcomm': { symbol: 'QCOM', exchange: 'US' },
  'broadcom': { symbol: 'AVGO', exchange: 'US' },
  'tsmc': { symbol: 'TSM', exchange: 'US' },
  'asml': { symbol: 'ASML', exchange: 'US' },
  'arm': { symbol: 'ARM', exchange: 'US' },

  // Social & Media
  'snap': { symbol: 'SNAP', exchange: 'US' },
  'snapchat': { symbol: 'SNAP', exchange: 'US' },
  'pinterest': { symbol: 'PINS', exchange: 'US' },
  'spotify': { symbol: 'SPOT', exchange: 'US' },
  'disney': { symbol: 'DIS', exchange: 'US' },
  'warner bros': { symbol: 'WBD', exchange: 'US' },
  'paramount': { symbol: 'PARA', exchange: 'US' },
  'comcast': { symbol: 'CMCSA', exchange: 'US' },
  'charter communications': { symbol: 'CHTR', exchange: 'US' },
  'charter-communications': { symbol: 'CHTR', exchange: 'US' },

  // E-commerce & Payments
  'shopify': { symbol: 'SHOP', exchange: 'US' },
  'paypal': { symbol: 'PYPL', exchange: 'US' },
  'square': { symbol: 'SQ', exchange: 'US' },
  'block': { symbol: 'SQ', exchange: 'US' },
  'ebay': { symbol: 'EBAY', exchange: 'US' },
  'etsy': { symbol: 'ETSY', exchange: 'US' },

  // Consulting & IT Services
  'accenture': { symbol: 'ACN', exchange: 'US' },

  // DevOps & Developer Tools
  'gitlab': { symbol: 'GTLB', exchange: 'US' },

  // Enterprise & SaaS
  'oracle': { symbol: 'ORCL', exchange: 'US' },
  'sap': { symbol: 'SAP', exchange: 'US' },
  'ibm': { symbol: 'IBM', exchange: 'US' },
  'adobe': { symbol: 'ADBE', exchange: 'US' },
  'servicenow': { symbol: 'NOW', exchange: 'US' },
  'workday': { symbol: 'WDAY', exchange: 'US' },
  'zoom': { symbol: 'ZM', exchange: 'US' },
  'slack': { symbol: 'CRM', exchange: 'US' },
  'atlassian': { symbol: 'TEAM', exchange: 'US' },
  'twilio': { symbol: 'TWLO', exchange: 'US' },
  'docusign': { symbol: 'DOCU', exchange: 'US' },

  // Automotive
  'volkswagen': { symbol: 'VOW3', exchange: 'XETRA' },
  'vw': { symbol: 'VOW3', exchange: 'XETRA' },
  'bmw': { symbol: 'BMW', exchange: 'XETRA' },
  'mercedes': { symbol: 'MBG', exchange: 'XETRA' },
  'daimler': { symbol: 'MBG', exchange: 'XETRA' },
  'porsche': { symbol: 'P911', exchange: 'XETRA' },
  'ford': { symbol: 'F', exchange: 'US' },
  'gm': { symbol: 'GM', exchange: 'US' },
  'general motors': { symbol: 'GM', exchange: 'US' },
  'rivian': { symbol: 'RIVN', exchange: 'US' },
  'lucid': { symbol: 'LCID', exchange: 'US' },

  // Finance & Payments
  'jpmorgan': { symbol: 'JPM', exchange: 'US' },
  'goldman sachs': { symbol: 'GS', exchange: 'US' },
  'morgan stanley': { symbol: 'MS', exchange: 'US' },
  'bank of america': { symbol: 'BAC', exchange: 'US' },
  'visa': { symbol: 'V', exchange: 'US' },
  'mastercard': { symbol: 'MA', exchange: 'US' },
  'coinbase': { symbol: 'COIN', exchange: 'US' },
  'global payments': { symbol: 'GPN', exchange: 'US' },
  'global-payments': { symbol: 'GPN', exchange: 'US' },

  // German & European Industrial
  'siemens': { symbol: 'SIE', exchange: 'XETRA' },
  'schneider electric': { symbol: 'SU', exchange: 'PA' },
  'schneider': { symbol: 'SU', exchange: 'PA' },
  'allianz': { symbol: 'ALV', exchange: 'XETRA' },
  'deutsche bank': { symbol: 'DBK', exchange: 'XETRA' },
  'bayer': { symbol: 'BAYN', exchange: 'XETRA' },
  'basf': { symbol: 'BAS', exchange: 'XETRA' },
  'adidas': { symbol: 'ADS', exchange: 'XETRA' },
  'zalando': { symbol: 'ZAL', exchange: 'XETRA' },
  'delivery hero': { symbol: 'DHER', exchange: 'XETRA' },

  // Chinese Tech
  'tencent': { symbol: '0700', exchange: 'HK' },
  'baidu': { symbol: 'BIDU', exchange: 'US' },
  'alibaba': { symbol: 'BABA', exchange: 'US' },
  'jd': { symbol: 'JD', exchange: 'US' },
  'jd.com': { symbol: 'JD', exchange: 'US' },
  'netease': { symbol: 'NTES', exchange: 'US' },
  'pinduoduo': { symbol: 'PDD', exchange: 'US' },
  'pdd': { symbol: 'PDD', exchange: 'US' },
  'nio': { symbol: 'NIO', exchange: 'US' },
  'xpeng': { symbol: 'XPEV', exchange: 'US' },
  'li auto': { symbol: 'LI', exchange: 'US' },
  'byd': { symbol: '1211', exchange: 'HK' },
  'xiaomi': { symbol: '1810', exchange: 'HK' },
  'meituan': { symbol: '3690', exchange: 'HK' },
  'bilibili': { symbol: 'BILI', exchange: 'US' },
  'trip.com': { symbol: 'TCOM', exchange: 'US' },
  'ctrip': { symbol: 'TCOM', exchange: 'US' },
  'weibo': { symbol: 'WB', exchange: 'US' },
  'didi': { symbol: 'DIDIY', exchange: 'US' },
  'kuaishou': { symbol: '1024', exchange: 'HK' },
  'sea limited': { symbol: 'SE', exchange: 'US' },
  'grab': { symbol: 'GRAB', exchange: 'US' },

  // Korean
  'samsung': { symbol: '005930', exchange: 'KO' },

  // Others
  'uber': { symbol: 'UBER', exchange: 'US' },
  'airbnb': { symbol: 'ABNB', exchange: 'US' },
  'doordash': { symbol: 'DASH', exchange: 'US' },
  'roblox': { symbol: 'RBLX', exchange: 'US' },
  'unity': { symbol: 'U', exchange: 'US' },
  'robinhood': { symbol: 'HOOD', exchange: 'US' },
  'aes': { symbol: 'AES', exchange: 'US' },
  'hp': { symbol: 'HPQ', exchange: 'US' },
  'viatris': { symbol: 'VTRS', exchange: 'US' },
  'everest group': { symbol: 'EG', exchange: 'US' },
  'everest-group': { symbol: 'EG', exchange: 'US' },
}

/**
 * Get ticker info for a company by name (case-insensitive)
 */
export function getCompanyTicker(name: string): { symbol: string; exchange: string } | undefined {
  const key = name.toLowerCase()
  return COMPANY_TICKERS[key] || COMPANY_TICKERS[key.replace(/-/g, ' ')]
}
