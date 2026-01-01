import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function fixConstraint() {
  console.log('Updating newsletter_sources constraint...')

  // Drop old unique constraint and add new composite one
  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      ALTER TABLE newsletter_sources DROP CONSTRAINT IF EXISTS newsletter_sources_email_key;
      ALTER TABLE newsletter_sources ADD CONSTRAINT newsletter_sources_name_email_key UNIQUE (name, email);
    `
  })

  if (error) {
    console.error('Error updating constraint:', error.message)
    console.log('\nYou may need to run this SQL manually in Supabase Dashboard:')
    console.log(`
ALTER TABLE newsletter_sources DROP CONSTRAINT IF EXISTS newsletter_sources_email_key;
ALTER TABLE newsletter_sources ADD CONSTRAINT newsletter_sources_name_email_key UNIQUE (name, email);
    `)
  } else {
    console.log('✅ Constraint updated successfully!')
  }
}

fixConstraint()
