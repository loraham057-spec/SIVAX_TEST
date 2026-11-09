-- Add country column to users table
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS country TEXT;
