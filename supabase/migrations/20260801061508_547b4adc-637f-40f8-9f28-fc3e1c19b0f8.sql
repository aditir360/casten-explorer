CREATE TABLE public.family_networks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  join_code text NOT NULL UNIQUE,
  owner_name text NOT NULL,
  owner_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id uuid NOT NULL REFERENCES public.family_networks(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  role text NOT NULL DEFAULT 'guardian',
  mode text NOT NULL DEFAULT 'standard',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.family_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id uuid NOT NULL REFERENCES public.family_networks(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  title text NOT NULL,
  detail text,
  severity text NOT NULL DEFAULT 'info',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX family_members_network_idx ON public.family_members(network_id);
CREATE INDEX family_events_network_idx ON public.family_events(network_id, created_at DESC);

GRANT ALL ON public.family_networks TO service_role;
GRANT ALL ON public.family_members TO service_role;
GRANT ALL ON public.family_events TO service_role;

ALTER TABLE public.family_networks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.family_gen_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text; i int;
BEGIN
  LOOP
    c := '';
    FOR i IN 1..8 LOOP
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    END LOOP;
    c := substr(c,1,4) || '-' || substr(c,5,4);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.family_networks WHERE join_code = c);
  END LOOP;
  RETURN c;
END; $$;

CREATE OR REPLACE FUNCTION public.family_snapshot(_code text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'network', to_jsonb(n),
    'members', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at)
                         FROM public.family_members m WHERE m.network_id = n.id), '[]'::jsonb),
    'events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC)
                        FROM (SELECT * FROM public.family_events WHERE network_id = n.id
                              ORDER BY created_at DESC LIMIT 25) e), '[]'::jsonb)
  )
  FROM public.family_networks n
  WHERE n.join_code = upper(trim(_code));
$$;

CREATE OR REPLACE FUNCTION public.family_create_network(_owner_name text, _owner_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n public.family_networks; m public.family_members;
BEGIN
  IF coalesce(trim(_owner_name),'') = '' OR coalesce(trim(_owner_email),'') = '' THEN
    RAISE EXCEPTION 'Name and email are required';
  END IF;
  INSERT INTO public.family_networks(join_code, owner_name, owner_email)
  VALUES (public.family_gen_code(), trim(_owner_name), lower(trim(_owner_email)))
  RETURNING * INTO n;
  INSERT INTO public.family_members(network_id, name, email, role, mode)
  VALUES (n.id, trim(_owner_name), lower(trim(_owner_email)), 'owner', 'standard')
  RETURNING * INTO m;
  INSERT INTO public.family_events(network_id, member_id, title, detail, severity)
  VALUES (n.id, m.id, 'Network created', 'Your family network is live. Share the join code to add people.', 'info');
  RETURN public.family_snapshot(n.join_code);
END; $$;

CREATE OR REPLACE FUNCTION public.family_add_member(_code text, _name text, _email text, _role text, _mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n public.family_networks; m public.family_members; cnt int;
BEGIN
  SELECT * INTO n FROM public.family_networks WHERE join_code = upper(trim(_code));
  IF n.id IS NULL THEN RAISE EXCEPTION 'Network not found'; END IF;
  IF coalesce(trim(_name),'') = '' THEN RAISE EXCEPTION 'Name is required'; END IF;
  SELECT count(*) INTO cnt FROM public.family_members WHERE network_id = n.id;
  IF cnt >= 6 THEN RAISE EXCEPTION 'A network can hold up to 6 members'; END IF;
  INSERT INTO public.family_members(network_id, name, email, role, mode)
  VALUES (n.id, trim(_name), nullif(lower(trim(_email)),''),
          CASE WHEN _role IN ('owner','guardian','senior','child') THEN _role ELSE 'guardian' END,
          CASE WHEN _mode IN ('standard','senior_shield','junior_guard') THEN _mode ELSE 'standard' END)
  RETURNING * INTO m;
  INSERT INTO public.family_events(network_id, member_id, title, detail, severity)
  VALUES (n.id, m.id, m.name || ' joined the network', 'Protection mode set to ' || m.mode || '.', 'info');
  RETURN public.family_snapshot(n.join_code);
END; $$;

CREATE OR REPLACE FUNCTION public.family_remove_member(_code text, _member_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n public.family_networks; m public.family_members;
BEGIN
  SELECT * INTO n FROM public.family_networks WHERE join_code = upper(trim(_code));
  IF n.id IS NULL THEN RAISE EXCEPTION 'Network not found'; END IF;
  SELECT * INTO m FROM public.family_members WHERE id = _member_id AND network_id = n.id;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Member not found'; END IF;
  IF m.role = 'owner' THEN RAISE EXCEPTION 'The network owner cannot be removed'; END IF;
  DELETE FROM public.family_members WHERE id = m.id;
  INSERT INTO public.family_events(network_id, title, detail, severity)
  VALUES (n.id, m.name || ' was removed', 'They no longer receive alerts from this network.', 'info');
  RETURN public.family_snapshot(n.join_code);
END; $$;

CREATE OR REPLACE FUNCTION public.family_set_mode(_code text, _member_id uuid, _mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n public.family_networks; m public.family_members;
BEGIN
  SELECT * INTO n FROM public.family_networks WHERE join_code = upper(trim(_code));
  IF n.id IS NULL THEN RAISE EXCEPTION 'Network not found'; END IF;
  UPDATE public.family_members
     SET mode = CASE WHEN _mode IN ('standard','senior_shield','junior_guard') THEN _mode ELSE 'standard' END
   WHERE id = _member_id AND network_id = n.id
  RETURNING * INTO m;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Member not found'; END IF;
  INSERT INTO public.family_events(network_id, member_id, title, detail, severity)
  VALUES (n.id, m.id, m.name || ' switched protection mode', 'Now using ' || m.mode || '.', 'info');
  RETURN public.family_snapshot(n.join_code);
END; $$;

CREATE OR REPLACE FUNCTION public.family_log_threat(_code text, _member_id uuid, _title text, _detail text, _severity text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n public.family_networks;
BEGIN
  SELECT * INTO n FROM public.family_networks WHERE join_code = upper(trim(_code));
  IF n.id IS NULL THEN RAISE EXCEPTION 'Network not found'; END IF;
  IF coalesce(trim(_title),'') = '' THEN RAISE EXCEPTION 'Describe the threat'; END IF;
  INSERT INTO public.family_events(network_id, member_id, title, detail, severity)
  VALUES (n.id, _member_id, left(trim(_title), 160), left(coalesce(trim(_detail),''), 500),
          CASE WHEN _severity IN ('info','warning','danger') THEN _severity ELSE 'warning' END);
  RETURN public.family_snapshot(n.join_code);
END; $$;

REVOKE ALL ON FUNCTION public.family_gen_code() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_snapshot(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_create_network(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_add_member(text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_remove_member(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_set_mode(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_log_threat(text, uuid, text, text, text) TO anon, authenticated;