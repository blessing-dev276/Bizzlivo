import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your Supabase project credentials.'
  )
}

// Not parameterized with the Database generic: supabase-js's join/embed
// inference needs a `Relationships` array per table, which is a lot of
// metadata to hand-maintain for an MVP. Query results are cast to the
// interfaces in `types/database.ts` at each call site instead.
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
