import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// Clean up env vars (remove trailing newlines)
const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\\n/g, '').trim();
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').replace(/\\n/g, '').trim();

console.log('Using URL:', url.substring(0, 30) + '...');

const supabase = createClient(url, key);

const { data, error } = await supabase
  .from('ghostwriter_prompts')
  .select('*')
  .eq('is_active', true)
  .single();

if (error) {
  console.error('Error:', error.message);
  process.exit(1);
}

console.log('=== AKTIVER GHOSTWRITER PROMPT ===');
console.log('Name:', data.name);
console.log('Erstellt:', data.created_at);
console.log('Aktualisiert:', data.updated_at);
console.log('');
console.log('=== PROMPT TEXT ===');
console.log(data.prompt_text);
