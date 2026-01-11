/**
 * Convert TipTap JSON content to email-friendly HTML
 * Shared module for newsletter email generation
 */

export interface TiptapNode {
  type: string
  content?: TiptapNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, string> }>
  attrs?: Record<string, string | number>
}

export interface TiptapDoc {
  type: string
  content?: TiptapNode[]
}

// Known public companies for Synthszr Vote
const KNOWN_COMPANIES: Record<string, string> = {
  'Apple': 'apple',
  'Microsoft': 'microsoft',
  'Google': 'google',
  'Alphabet': 'alphabet',
  'Amazon': 'amazon',
  'Meta': 'meta',
  'Facebook': 'facebook',
  'Nvidia': 'nvidia',
  'Tesla': 'tesla',
  'Netflix': 'netflix',
  'Salesforce': 'salesforce',
  'Snowflake': 'snowflake',
  'Palantir': 'palantir',
  'CrowdStrike': 'crowdstrike',
  'Uber': 'uber',
  'Airbnb': 'airbnb',
  'Spotify': 'spotify',
  'AMD': 'amd',
  'Intel': 'intel',
  'Oracle': 'oracle',
  'IBM': 'ibm',
  'SAP': 'sap',
  'Shopify': 'shopify',
  'PayPal': 'paypal',
  'Block': 'block',
  'Square': 'square',
  'Coinbase': 'coinbase',
  'Robinhood': 'robinhood',
  'Zoom': 'zoom',
  'DocuSign': 'docusign',
  'Datadog': 'datadog',
  'MongoDB': 'mongodb',
  'Cloudflare': 'cloudflare',
  'Twilio': 'twilio',
  'ServiceNow': 'servicenow',
  'Workday': 'workday',
  'Atlassian': 'atlassian',
  'Adobe': 'adobe',
  'Autodesk': 'autodesk',
  'Intuit': 'intuit',
  'Electronic Arts': 'electronic-arts',
  'EA': 'electronic-arts',
  'Activision': 'activision',
  'Unity': 'unity',
  'Roblox': 'roblox',
  'DoorDash': 'doordash',
  'Instacart': 'instacart',
  'Pinterest': 'pinterest',
  'Snap': 'snap',
  'Twitter': 'twitter',
  'Reddit': 'reddit',
  'Rivian': 'rivian',
  'Lucid': 'lucid',
  'NIO': 'nio',
  'BYD': 'byd',
  'Xiaomi': 'xiaomi',
  'Alibaba': 'alibaba',
  'Tencent': 'tencent',
  'Baidu': 'baidu',
  'JD.com': 'jd',
  'Samsung': 'samsung',
}

// Known premarket companies (pre-IPO / private)
// All premarket companies from glitch.green API (synced with tiptap-renderer.tsx)
const KNOWN_PREMARKET_COMPANIES: Record<string, string> = {
  // AI/ML Infrastructure
  'Hugging Face': 'Hugging Face',
  'Dataiku': 'Dataiku',
  'DataRobot': 'DataRobot',
  'Anyscale': 'Anyscale',
  'Lambda': 'Lambda',
  'Replicate': 'Replicate',
  'Fireworks AI': 'Fireworks AI',
  'Together AI': 'Together AI',
  'SambaNova Systems': 'SambaNova Systems',
  'Pinecone': 'Pinecone',
  // AI Foundation Models
  'Anthropic': 'Anthropic',
  'OpenAI': 'OpenAI',
  'Mistral AI': 'Mistral AI',
  'Cohere': 'Cohere',
  'Perplexity': 'Perplexity',
  // AI Applications
  'Lovable': 'Lovable',
  'Runway': 'Runway',
  'ElevenLabs': 'ElevenLabs',
  'Midjourney': 'Midjourney',
  'Stability AI': 'Stability AI',
  'Character.AI': 'Character.AI',
  'Adept': 'Adept',
  'Scale AI': 'Scale AI',
  'Pika': 'Pika',
  'HeyGen': 'HeyGen',
  'Luma AI': 'Luma AI',
  'Suno': 'Suno',
  'Glean': 'Glean',
  'Hebbia': 'Hebbia',
  'Writer': 'Writer',
  'Typeface': 'Typeface',
  'Jasper': 'Jasper',
  'Grammarly': 'Grammarly',
  // AI Agents & Automation
  'Cognition': 'Cognition',
  'Inflection AI': 'Inflection AI',
  'Sierra': 'Sierra',
  'Decagon': 'Decagon',
  'Replicant': 'Replicant',
  // Developer Tools
  'Vercel': 'Vercel',
  'Replit': 'Replit',
  'Supabase': 'Supabase',
  'dbt Labs': 'dbt Labs',
  'Neo4j': 'Neo4j',
  'Kong': 'Kong',
  'Astronomer': 'Astronomer',
  // Robotics & Autonomous
  'Waymo': 'Waymo',
  'Nuro': 'Nuro',
  'Covariant': 'Covariant',
  'Physical Intelligence': 'Physical Intelligence',
  'Skydio': 'Skydio',
  'Shield AI': 'Shield AI',
  'Relativity Space': 'Relativity Space',
  'Applied Intuition': 'Applied Intuition',
  // Enterprise AI
  'Gong': 'Gong',
  'Clari': 'Clari',
  'Outreach': 'Outreach',
  'Highspot': 'Highspot',
  'AlphaSense': 'AlphaSense',
  'Dataminr': 'Dataminr',
  'ThoughtSpot': 'ThoughtSpot',
  // Healthcare AI
  'Viz.ai': 'Viz.ai',
  'Hippocratic AI': 'Hippocratic AI',
  'Insitro': 'Insitro',
  'Spring Health': 'Spring Health',
  // Security
  'Snorkel AI': 'Snorkel AI',
  'Vanta': 'Vanta',
  'Socure': 'Socure',
  // AI Hardware & Infrastructure
  'Weights & Biases': 'Weights & Biases',
  'Cerebras': 'Cerebras',
  'Groq': 'Groq',
  // Big Tech Private
  'Stripe': 'Stripe',
  'SpaceX': 'SpaceX',
  'Databricks': 'Databricks',
  'ByteDance': 'ByteDance',
  'Epic Games': 'Epic Games',
  // Design & Productivity
  'Canva': 'Canva',
  'Discord': 'Discord',
  'Figma': 'Figma',
  'Notion': 'Notion',
  'Airtable': 'Airtable',
  'Miro': 'Miro',
  'Retool': 'Retool',
  'Webflow': 'Webflow',
  'Linear': 'Linear',
  'Loom': 'Loom',
  'Calendly': 'Calendly',
  // HR & Fintech
  'Deel': 'Deel',
  'Rippling': 'Rippling',
  'Gusto': 'Gusto',
  'Plaid': 'Plaid',
  'Chime': 'Chime',
  'Klarna': 'Klarna',
  'Revolut': 'Revolut',
  'Checkout.com': 'Checkout.com',
  // Logistics & Commerce
  'Flexport': 'Flexport',
  'Bolt': 'Bolt',
  'Faire': 'Faire',
  'Rappi': 'Rappi',
  'Shein': 'Shein',
  // Other notable
  'xAI': 'xAI',
  'Safe Superintelligence': 'Safe Superintelligence',
  'World Labs': 'World Labs',
  'Magic Leap': 'Magic Leap',
  'Anysphere': 'Anysphere',
  // === Auto-synced from glitch.green API ===
  '11x': '11x',
  '6sense': '6sense',
  'Abacus.AI': 'Abacus.AI',
  'Abnormal AI': 'Abnormal AI',
  'Abridge': 'Abridge',
  'Activ Surgical': 'Activ Surgical',
  'Ada': 'Ada',
  'Aera Technology': 'Aera Technology',
  'Affectiva': 'Affectiva',
  'Affinity': 'Affinity',
  'Afiniti': 'Afiniti',
  'Afresh': 'Afresh',
  'AiDash': 'AiDash',
  'Alation': 'Alation',
  'Ambience Healthcare': 'Ambience Healthcare',
  'AMP Robotics': 'AMP Robotics',
  'Amperity': 'Amperity',
  'Anaconda': 'Anaconda',
  'Anumana': 'Anumana',
  'Anvilogic': 'Anvilogic',
  'Apptronik': 'Apptronik',
  'Aquant': 'Aquant',
  'Arbol': 'Arbol',
  'Arize AI': 'Arize AI',
  'ArteraAI': 'ArteraAI',
  'Arthur': 'Arthur',
  'Asapp': 'Asapp',
  'Asimov': 'Asimov',
  'AssemblyAI': 'AssemblyAI',
  'AssetWatch': 'AssetWatch',
  'Ataccama': 'Ataccama',
  'Atomwise': 'Atomwise',
  'Augment': 'Augment',
  'Augury': 'Augury',
  'Automation Anywhere': 'Automation Anywhere',
  'Avathon': 'Avathon',
  'Avidbots Corp.': 'Avidbots Corp.',
  'Bark Technologies': 'Bark Technologies',
  'Baseten': 'Baseten',
  'BeeHero': 'BeeHero',
  'Beyond Limits': 'Beyond Limits',
  'Bidgely': 'Bidgely',
  'Bigfoot Biomedical': 'Bigfoot Biomedical',
  'BigHat Biosciences': 'BigHat Biosciences',
  'BigID': 'BigID',
  'Bluecore': 'Bluecore',
  'BoostUp.ai': 'BoostUp.ai',
  'Botkeeper': 'Botkeeper',
  'Brain Corp': 'Brain Corp',
  'Brightseed': 'Brightseed',
  'Bubble': 'Bubble',
  'Built Robotics': 'Built Robotics',
  'Butlr': 'Butlr',
  'CallMiner': 'CallMiner',
  'Canoe Intelligence': 'Canoe Intelligence',
  'Captions': 'Captions',
  'Caresyntax': 'Caresyntax',
  'Casana': 'Casana',
  'Cast AI': 'Cast AI',
  'Catalyte': 'Catalyte',
  'Celestial AI': 'Celestial AI',
  'Ceres AI': 'Ceres AI',
  'Clarifai': 'Clarifai',
  'Clarify': 'Clarify',
  'Clarity AI': 'Clarity AI',
  'Clay': 'Clay',
  'Clear Labs': 'Clear Labs',
  'Cleerly': 'Cleerly',
  'Climavision': 'Climavision',
  'Clinc': 'Clinc',
  'Clio': 'Clio',
  'CloudTrucks': 'CloudTrucks',
  'CloudZero': 'CloudZero',
  'CodaMetrix': 'CodaMetrix',
  'Comet': 'Comet',
  'CommerceIQ': 'CommerceIQ',
  'Concentric AI': 'Concentric AI',
  'ConcertAI': 'ConcertAI',
  'Contextual AI': 'Contextual AI',
  'Conversica': 'Conversica',
  'Copper': 'Copper',
  'Cortex': 'Cortex',
  'Corvus Insurance': 'Corvus Insurance',
  'Covera Health': 'Covera Health',
  'Cowbell': 'Cowbell',
  'Cresta': 'Cresta',
  'Crunchbase': 'Crunchbase',
  'Crusoe': 'Crusoe',
  'Cyberhaven': 'Cyberhaven',
  'Cyera': 'Cyera',
  'CytoVale': 'CytoVale',
  'd-Matrix': 'd-Matrix',
  'DataBank': 'DataBank',
  'Databook': 'Databook',
  'Daybreak': 'Daybreak',
  'Deep Instinct': 'Deep Instinct',
  'Defined.ai': 'Defined.ai',
  'Delfi Diagnostics': 'Delfi Diagnostics',
  'Delphia': 'Delphia',
  'Descartes Labs': 'Descartes Labs',
  'Dexterity': 'Dexterity',
  'Dialpad': 'Dialpad',
  'Digital Diagnostics': 'Digital Diagnostics',
  'Digits': 'Digits',
  'Domino Data Lab': 'Domino Data Lab',
  'Dooly': 'Dooly',
  'Dremio': 'Dremio',
  'DriveWealth': 'DriveWealth',
  'Dstillery': 'Dstillery',
  'Dyno Therapeutics': 'Dyno Therapeutics',
  'EdgeQ': 'EdgeQ',
  'Eightfold.ai': 'Eightfold.ai',
  'Eko Health': 'Eko Health',
  'Elephas': 'Elephas',
  'EliseAI': 'EliseAI',
  'Embodied': 'Embodied',
  'Encharge AI': 'Encharge AI',
  'Enigma': 'Enigma',
  'Enlitic': 'Enlitic',
  'Esperanto Technologies': 'Esperanto Technologies',
  'Etched': 'Etched',
  'EvenUP': 'EvenUP',
  'Everstream Analytics': 'Everstream Analytics',
  'Evozyne': 'Evozyne',
  'Fairmatic': 'Fairmatic',
  'Federato': 'Federato',
  'Fetcherr': 'Fetcherr',
  'Fiddler AI': 'Fiddler AI',
  'Forethought': 'Forethought',
  'Formation Bio': 'Formation Bio',
  'Foundry': 'Foundry',
  'FourKites': 'FourKites',
  'Fulfil Solutions': 'Fulfil Solutions',
  'FundGuard': 'FundGuard',
  'Fundraise Up': 'Fundraise Up',
  'Gatik': 'Gatik',
  'Generally Intelligent': 'Generally Intelligent',
  'Generate:Biomedicines': 'Generate:Biomedicines',
  'Genesis Therapeutics': 'Genesis Therapeutics',
  'Genesys': 'Genesys',
  'Genies': 'Genies',
  'Globality': 'Globality',
  'Golden': 'Golden',
  'GrubMarket': 'GrubMarket',
  'GumGum': 'GumGum',
  'Guru': 'Guru',
  'H2O.ai': 'H2O.ai',
  'Halcyon': 'Halcyon',
  'Harbinger Health': 'Harbinger Health',
  'Hayden AI': 'Hayden AI',
  'HeadSpin': 'HeadSpin',
  'HealthJoy': 'HealthJoy',
  'HighRadius': 'HighRadius',
  'Hive.ai': 'Hive.ai',
  'Hume': 'Hume',
  'Hungryroot': 'Hungryroot',
  'Husk Power Systems': 'Husk Power Systems',
  'HyperScience': 'HyperScience',
  'Iambic Therapeutics': 'Iambic Therapeutics',
  'Icertis': 'Icertis',
  'Immunai': 'Immunai',
  'Impact Analytics': 'Impact Analytics',
  'Infinitus': 'Infinitus',
  'Innovaccer': 'Innovaccer',
  'Insider': 'Insider',
  'Insurify': 'Insurify',
  'Intenseye': 'Intenseye',
  'Interos': 'Interos',
  'InterVenn': 'InterVenn',
  'Invoca': 'Invoca',
  'Inworld AI': 'Inworld AI',
  'Iterable': 'Iterable',
  'Jerry': 'Jerry',
  'K Health': 'K Health',
  'KarmaCheck': 'KarmaCheck',
  'Kika': 'Kika',
  'Klarity': 'Klarity',
  'Kneron': 'Kneron',
  'KoBold Metals': 'KoBold Metals',
  'Kontakt.io': 'Kontakt.io',
  'Kore.ai': 'Kore.ai',
  'Labelbox': 'Labelbox',
  'Lark': 'Lark',
  'Laurel': 'Laurel',
  'LeanTaaS': 'LeanTaaS',
  'Legion': 'Legion',
  'Leia': 'Leia',
  'Lightmatter': 'Lightmatter',
  'Lightning AI': 'Lightning AI',
  'Lily AI': 'Lily AI',
  'LinkSquares': 'LinkSquares',
  'Liquid AI': 'Liquid AI',
  'MagicSchool AI': 'MagicSchool AI',
  'MainFunc': 'MainFunc',
  'MangoBoost': 'MangoBoost',
  'Mashgin': 'Mashgin',
  'MatX': 'MatX',
  'Mercor': 'Mercor',
  'Metropolis Technologies': 'Metropolis Technologies',
  'Miso Robotics': 'Miso Robotics',
  'Monarch Tractor': 'Monarch Tractor',
  'Moonwalk Biosciences': 'Moonwalk Biosciences',
  'Morning Consult': 'Morning Consult',
  'Mosaic Tech': 'Mosaic Tech',
  'Motion': 'Motion',
  'Motive': 'Motive',
  'Mutiny': 'Mutiny',
  'Mythic': 'Mythic',
  'Nauto': 'Nauto',
  'Nayya': 'Nayya',
  'Netradyne': 'Netradyne',
  'Neuron7.ai': 'Neuron7.ai',
  'Nexar': 'Nexar',
  'Nooks': 'Nooks',
  'Notable': 'Notable',
  'Nucleai AI': 'Nucleai AI',
  'o9 Solutions': 'o9 Solutions',
  'Observe.AI': 'Observe.AI',
  'ON Platform': 'ON Platform',
  'One Concern': 'One Concern',
  'OpenEvidence': 'OpenEvidence',
  'OpenSpace': 'OpenSpace',
  'OpenTrons': 'OpenTrons',
  'OpenWeb': 'OpenWeb',
  'Opkey': 'Opkey',
  'Osaro': 'Osaro',
  'Otter.ai': 'Otter.ai',
  'Outrider': 'Outrider',
  'Overjet': 'Overjet',
  'Owkin': 'Owkin',
  'Paro': 'Paro',
  'Parry Labs': 'Parry Labs',
  'Path Robotics': 'Path Robotics',
  'Pathos': 'Pathos',
  'Pearl': 'Pearl',
  'Pendo': 'Pendo',
  'Percipient.ai': 'Percipient.ai',
  'Persado': 'Persado',
  'Petal': 'Petal',
  'Phantom AI': 'Phantom AI',
  'Phenom People': 'Phenom People',
  'Physna': 'Physna',
  'Picsart': 'Picsart',
  'Pilot': 'Pilot',
  'Placer.ai': 'Placer.ai',
  'Planck': 'Planck',
  'PlusAI': 'PlusAI',
  'Potrero Medical': 'Potrero Medical',
  'Primer': 'Primer',
  'Proscia': 'Proscia',
  'Pryon': 'Pryon',
  'Qualified.com': 'Qualified.com',
  'Quantifind': 'Quantifind',
  'Qventus': 'Qventus',
  'Rad AI': 'Rad AI',
  'RapidAI': 'RapidAI',
  'RapidSOS': 'RapidSOS',
  'Raydiant': 'Raydiant',
  'Read AI': 'Read AI',
  'Rebellion Defense': 'Rebellion Defense',
  'Red6': 'Red6',
  'Regard': 'Regard',
  'Rescale': 'Rescale',
  'Ripcord': 'Ripcord',
  'Rokid': 'Rokid',
  'Saama': 'Saama',
  'SAFE Security': 'SAFE Security',
  'SafeGraph': 'SafeGraph',
  'Salt Security': 'Salt Security',
  'Saronic': 'Saronic',
  'SchooLinks': 'SchooLinks',
  'ScienceLogic': 'ScienceLogic',
  'SeekOut': 'SeekOut',
  'Seekr': 'Seekr',
  'Simbe': 'Simbe',
  'SiSense': 'SiSense',
  'Snappt': 'Snappt',
  'Socket': 'Socket',
  'Soft Robotics': 'Soft Robotics',
  'Solidus Labs': 'Solidus Labs',
  'Sortera Technologies': 'Sortera Technologies',
  'Speak': 'Speak',
  'Splice': 'Splice',
  'Spot AI': 'Spot AI',
  'Sprig': 'Sprig',
  'Stack AV': 'Stack AV',
  'Standard AI': 'Standard AI',
  'Starship Technologies': 'Starship Technologies',
  'Strider': 'Strider',
  'Suki': 'Suki',
  'Suzy': 'Suzy',
  'Sword Health': 'Sword Health',
  'Syllable': 'Syllable',
  'Synack': 'Synack',
  'Synthego': 'Synthego',
  'Synthesized': 'Synthesized',
  'Syntiant': 'Syntiant',
  'Tekion': 'Tekion',
  'Tempo': 'Tempo',
  'Tennr': 'Tennr',
  'Tensordyne': 'Tensordyne',
  'Tenstorrent': 'Tenstorrent',
  'Terray Therapeutics': 'Terray Therapeutics',
  'TIFIN': 'TIFIN',
  'TigerGraph': 'TigerGraph',
  'Tome': 'Tome',
  'Tomorrow.io': 'Tomorrow.io',
  'Tonal': 'Tonal',
  'Tractian': 'Tractian',
  'Tredence': 'Tredence',
  'True Anomaly': 'True Anomaly',
  'TrueAccord': 'TrueAccord',
  'Turing': 'Turing',
  'UJET': 'UJET',
  'Uniphore': 'Uniphore',
  'UVeye': 'UVeye',
  'Vannevar Labs': 'Vannevar Labs',
  'VAST Data': 'VAST Data',
  'Vectra AI': 'Vectra AI',
  'Verbit': 'Verbit',
  'Verge Genomics': 'Verge Genomics',
  'VergeSense': 'VergeSense',
  'Versatile': 'Versatile',
  'Viam': 'Viam',
  'Vianai': 'Vianai',
  'Vic.ai': 'Vic.ai',
  'Vicarious': 'Vicarious',
  'Volley': 'Volley',
  'Waabi': 'Waabi',
  'Weka': 'Weka',
  'Well': 'Well',
  'WorkFusion': 'WorkFusion',
  'Xaira Therapeutics': 'Xaira Therapeutics',
  'Yellow.ai': 'Yellow.ai',
  'You.com': 'You.com',
  'Yurts': 'Yurts',
  'ZEDEDA': 'ZEDEDA',
  'ZeroEyes': 'ZeroEyes',
  'Zeta': 'Zeta',
  'Zignal Labs': 'Zignal Labs',
  'Zilliz': 'Zilliz',
  'Zinier': 'Zinier',
}

// Rating badge styles (email-safe inline styles)
const RATING_STYLES = {
  BUY: 'background-color: #39FF14; color: #000; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; text-decoration: none;',
  HOLD: 'background-color: #9CA3AF; color: #000; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; text-decoration: none;',
  SELL: 'background-color: #FF6600; color: #000; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; text-decoration: none;',
}

interface RatingData {
  company: string
  displayName: string
  rating: 'BUY' | 'HOLD' | 'SELL'
  type: 'public' | 'premarket'
  isin?: string
}

/**
 * Fetch ratings for companies from APIs
 */
async function fetchRatings(
  publicCompanies: string[],
  premarketCompanies: string[],
  baseUrl: string
): Promise<Map<string, { rating: 'BUY' | 'HOLD' | 'SELL'; type: 'public' | 'premarket'; isin?: string }>> {
  const ratingsMap = new Map<string, { rating: 'BUY' | 'HOLD' | 'SELL'; type: 'public' | 'premarket'; isin?: string }>()

  try {
    const [publicResponse, premarketResponse] = await Promise.all([
      publicCompanies.length > 0
        ? fetch(`${baseUrl}/api/stock-synthszr/batch-ratings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companies: publicCompanies }),
          }).then(r => r.json()).catch(() => ({ ok: false, ratings: [] }))
        : Promise.resolve({ ok: true, ratings: [] }),
      premarketCompanies.length > 0
        ? fetch(`${baseUrl}/api/premarket/batch-ratings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companies: premarketCompanies }),
          }).then(r => r.json()).catch(() => ({ ok: false, ratings: [] }))
        : Promise.resolve({ ok: true, ratings: [] }),
    ])

    // Process public ratings
    if (publicResponse.ok && publicResponse.ratings) {
      for (const r of publicResponse.ratings) {
        if (r.rating) {
          ratingsMap.set(r.company.toLowerCase(), { rating: r.rating, type: 'public' })
        }
      }
    }

    // Process premarket ratings
    if (premarketResponse.ok && premarketResponse.ratings) {
      for (const r of premarketResponse.ratings) {
        if (r.rating) {
          ratingsMap.set(r.company.toLowerCase(), { rating: r.rating, type: 'premarket', isin: r.isin })
        }
      }
    }
  } catch (error) {
    console.error('[tiptap-to-html] Failed to fetch ratings:', error)
  }

  return ratingsMap
}

/**
 * Find companies mentioned in text
 * Supports: natural mentions, possessive forms, compound words, and explicit {Company} tags
 */
function findCompaniesInText(text: string): { public: Array<{ apiName: string; displayName: string }>; premarket: Array<{ apiName: string; displayName: string }> } {
  const publicCompanies: Array<{ apiName: string; displayName: string }> = []
  const premarketCompanies: Array<{ apiName: string; displayName: string }> = []

  // Find public companies (natural mentions or {Company} explicit tags)
  for (const [displayName, apiName] of Object.entries(KNOWN_COMPANIES)) {
    const regex = new RegExp(`\\b${displayName}s?(-[\\wäöüÄÖÜß]+)*\\b`, 'gi')
    const explicitRegex = new RegExp(`\\{${displayName}\\}`, 'gi')
    if (regex.test(text) || explicitRegex.test(text)) {
      publicCompanies.push({ apiName, displayName })
    }
  }

  // Find premarket companies (natural mentions or {Company} explicit tags)
  for (const [displayName, apiName] of Object.entries(KNOWN_PREMARKET_COMPANIES)) {
    const escapedName = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`\\b${escapedName}s?\\b`, 'gi')
    const explicitRegex = new RegExp(`\\{${escapedName}\\}`, 'gi')
    if (regex.test(text) || explicitRegex.test(text)) {
      premarketCompanies.push({ apiName, displayName })
    }
  }

  return { public: publicCompanies, premarket: premarketCompanies }
}

/**
 * Remove {Company} explicit tags from text
 */
function stripExplicitCompanyTags(text: string): string {
  return text.replace(/\{([^}]+)\}/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Generate HTML for vote badges
 * Uses italic style for the text, regular (not-italic) for badges
 */
function generateVoteBadgesHtml(ratings: RatingData[], baseUrl: string, postSlug?: string): string {
  if (ratings.length === 0) return ''

  const badges = ratings.map((r, idx) => {
    const style = RATING_STYLES[r.rating]
    const label = r.rating === 'BUY' ? 'Buy' : r.rating === 'HOLD' ? 'Hold' : 'Sell'
    const prefix = idx === 0 ? 'Synthszr Vote: ' : ', '

    // Link to analysis dialog on the blog post
    const href = postSlug
      ? `${baseUrl}/posts/${postSlug}?${r.type === 'premarket' ? 'premarket' : 'stock'}=${encodeURIComponent(r.displayName)}`
      : '#'

    return `${prefix}<a href="${href}" style="color: inherit; text-decoration: none;">${r.displayName}</a> <a href="${href}" style="${style}">${label}</a>`
  }).join('')

  return `<span style="margin-left: 8px; white-space: nowrap; font-style: italic;"><em>${badges}</em></span>`
}

/**
 * Convert post content to email-friendly HTML (sync version for backwards compatibility)
 * Handles both TipTap JSON objects and JSON strings
 */
export function generateEmailContent(post: { content?: unknown; excerpt?: string }): string {
  const rawContent = post.content

  // If content is a JSON string, parse it first
  if (typeof rawContent === 'string') {
    try {
      const parsed = JSON.parse(rawContent)
      if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
        return convertTiptapToHtml(parsed as TiptapDoc)
      }
    } catch {
      // Not JSON, might be HTML string - use as is
      return rawContent
    }
    // If we couldn't parse it and it's a string, return as is
    return rawContent
  }

  // If content is TipTap JSON object, convert to basic HTML
  if (rawContent && typeof rawContent === 'object') {
    return convertTiptapToHtml(rawContent as TiptapDoc)
  }

  // Fallback to excerpt
  return post.excerpt || ''
}

/**
 * Convert post content to email-friendly HTML with Synthszr Vote badges
 * Async version that fetches ratings from APIs
 */
export async function generateEmailContentWithVotes(
  post: { content?: unknown; excerpt?: string; slug?: string },
  baseUrl: string
): Promise<string> {
  const rawContent = post.content
  let doc: TiptapDoc | null = null

  // Parse content
  if (typeof rawContent === 'string') {
    try {
      const parsed = JSON.parse(rawContent)
      if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
        doc = parsed as TiptapDoc
      } else {
        return rawContent
      }
    } catch {
      return rawContent
    }
  } else if (rawContent && typeof rawContent === 'object') {
    doc = rawContent as TiptapDoc
  }

  if (!doc || !doc.content) {
    return post.excerpt || ''
  }

  // First pass: find all Synthszr Take paragraphs and collect companies
  const synthszrTakeParagraphs: { index: number; text: string }[] = []

  doc.content.forEach((node, index) => {
    if (node.type === 'paragraph') {
      const text = extractTextFromNode(node)
      if (/synthszr take:?/i.test(text)) {
        // Get text from surrounding paragraphs too (news context)
        let contextText = text
        // Look at previous 3 nodes for context
        for (let i = Math.max(0, index - 3); i < index; i++) {
          contextText = extractTextFromNode(doc!.content![i]) + ' ' + contextText
        }
        synthszrTakeParagraphs.push({ index, text: contextText })
      }
    }
  })

  // Collect all companies mentioned
  const allPublicCompanies = new Set<string>()
  const allPremarketCompanies = new Set<string>()
  const paragraphCompanies = new Map<number, { public: Array<{ apiName: string; displayName: string }>; premarket: Array<{ apiName: string; displayName: string }> }>()

  for (const para of synthszrTakeParagraphs) {
    const companies = findCompaniesInText(para.text)
    paragraphCompanies.set(para.index, companies)
    companies.public.forEach(c => allPublicCompanies.add(c.apiName))
    companies.premarket.forEach(c => allPremarketCompanies.add(c.apiName))
  }

  // Fetch ratings if any companies found
  let ratingsMap = new Map<string, { rating: 'BUY' | 'HOLD' | 'SELL'; type: 'public' | 'premarket'; isin?: string }>()
  if (allPublicCompanies.size > 0 || allPremarketCompanies.size > 0) {
    ratingsMap = await fetchRatings(
      Array.from(allPublicCompanies),
      Array.from(allPremarketCompanies),
      baseUrl
    )
  }

  // Convert to HTML with vote badges
  const htmlParts = doc.content.map((node, index) => {
    const baseHtml = convertNodeToHtml(node)

    // Check if this is a Synthszr Take paragraph
    const companies = paragraphCompanies.get(index)
    if (companies && (companies.public.length > 0 || companies.premarket.length > 0)) {
      // Build ratings for this paragraph
      const ratings: RatingData[] = []

      for (const c of companies.public) {
        const ratingData = ratingsMap.get(c.apiName.toLowerCase())
        if (ratingData) {
          ratings.push({
            company: c.apiName,
            displayName: c.displayName,
            rating: ratingData.rating,
            type: 'public',
          })
        }
      }

      for (const c of companies.premarket) {
        const ratingData = ratingsMap.get(c.apiName.toLowerCase())
        if (ratingData) {
          ratings.push({
            company: c.apiName,
            displayName: c.displayName,
            rating: ratingData.rating,
            type: 'premarket',
            isin: ratingData.isin,
          })
        }
      }

      if (ratings.length > 0) {
        const voteBadges = generateVoteBadgesHtml(ratings, baseUrl, post.slug)
        // Insert badges before closing </p> tag
        return baseHtml.replace(/<\/p>$/, `${voteBadges}</p>`)
      }
    }

    return baseHtml
  })

  return htmlParts.join('\n')
}

/**
 * Extract plain text from a TipTap node
 */
function extractTextFromNode(node: TiptapNode): string {
  if (node.type === 'text') {
    return node.text || ''
  }
  if (node.content) {
    return node.content.map(extractTextFromNode).join('')
  }
  return ''
}

/**
 * Convert a single TipTap node to HTML
 */
function convertNodeToHtml(node: TiptapNode): string {
  switch (node.type) {
    case 'paragraph':
      return `<p>${renderContent(node.content)}</p>`
    case 'heading': {
      const level = node.attrs?.level || 2
      return `<h${level}>${renderContent(node.content)}</h${level}>`
    }
    case 'bulletList':
      return `<ul>${node.content?.map(li => `<li>${renderContent(li.content?.[0]?.content)}</li>`).join('')}</ul>`
    case 'orderedList':
      return `<ol>${node.content?.map(li => `<li>${renderContent(li.content?.[0]?.content)}</li>`).join('')}</ol>`
    case 'blockquote':
      return `<blockquote>${renderContent(node.content)}</blockquote>`
    case 'horizontalRule':
      return '<hr />'
    default:
      return renderContent(node.content)
  }
}

/**
 * Convert TipTap document to HTML (sync version)
 */
export function convertTiptapToHtml(doc: TiptapDoc): string {
  if (!doc.content) return ''
  return doc.content.map(convertNodeToHtml).join('\n')
}

/**
 * Render TipTap node content with marks (bold, italic, links)
 * Includes special styling for "Synthszr Take:" sections
 */
function renderContent(content?: TiptapNode[]): string {
  if (!content) return ''

  return content.map(node => {
    if (node.type === 'text') {
      let text = node.text || ''

      // Remove {Company} explicit tags from display
      text = stripExplicitCompanyTags(text)

      // Check if text contains "Synthszr Take:" and style it
      const synthszrPattern = /(Synthszr Take:?)/gi
      const hasBoldMark = node.marks?.some(m => m.type === 'bold')

      // If "Synthszr Take:" is not already bold, wrap it with styling
      if (!hasBoldMark && synthszrPattern.test(text)) {
        text = text.replace(synthszrPattern, '<strong style="background-color: #CCFF00; padding: 2px 6px;">$1</strong>')
      }

      // Apply marks
      if (node.marks) {
        for (const mark of node.marks) {
          switch (mark.type) {
            case 'bold':
              // Check if this is "Synthszr Take:" - add background styling
              if (/synthszr take:?/i.test(text)) {
                text = `<strong style="background-color: #CCFF00; padding: 2px 6px;">${text}</strong>`
              } else {
                text = `<strong>${text}</strong>`
              }
              break
            case 'italic':
              text = `<em>${text}</em>`
              break
            case 'link':
              text = `<a href="${mark.attrs?.href || '#'}">${text}</a>`
              break
          }
        }
      }

      return text
    }

    return ''
  }).join('')
}
