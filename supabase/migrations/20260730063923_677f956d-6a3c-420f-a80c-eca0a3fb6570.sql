CREATE TABLE public.waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  source text NOT NULL DEFAULT 'ai-hacker-simulator',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.waitlist TO anon;
GRANT INSERT, SELECT ON public.waitlist TO authenticated;
GRANT ALL ON public.waitlist TO service_role;

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can join the waitlist"
ON public.waitlist FOR INSERT TO anon, authenticated
WITH CHECK (email IS NOT NULL AND char_length(email) BETWEEN 3 AND 254);