-- ============================================================
-- Axis Training Systems — 042: the calculators, tunable without a deploy
-- ============================================================
--
-- The public tools (RPE chart, attempt planner, weight converter, score tiers)
-- were module-level constants in src/components/Tools.tsx. Changing "the
-- conservative opener is 90% of the training max" to 89% meant editing a
-- TypeScript literal, running a build and pushing a deploy. The owner is a
-- coach, not a release engineer, so this table gives those numbers a home the
-- admin portal can write.
--
-- ── OVERRIDES, NOT VALUES ───────────────────────────────────────────────────
--
-- The row does NOT hold a calculator's settings. It holds the DIFFERENCE
-- between the code's defaults and what the owner asked for, and the client
-- merges it over `defaultCalculatorConfig()` (src/lib/calculators.ts) field by
-- field. Three consequences, and they are the reason for the shape:
--
--   1. An EMPTY TABLE CHANGES NOTHING. Before anybody opens the panel there are
--      zero rows here, and every calculator behaves exactly as it shipped. So
--      this migration is safe to apply to a live site in the middle of a day.
--
--   2. A ROW ONLY CARRIES WHAT WAS ACTUALLY CHANGED. An owner who nudges the
--      aggressive third attempt writes `{"profiles":{"aggressive":{...}}}` and
--      nothing else. The conservative profile keeps tracking the code, so a
--      later correction to a default reaches every site that never overrode it.
--
--   3. A BAD VALUE CANNOT BREAK A PAGE. The merge clamps: an RPE fraction must
--      land in (0, 1.2], an attempt percentage in [0.5, 1.15], a rounding
--      increment in [0.5, 10], and an attempt triple that goes BACKWARDS
--      (second below opener) is discarded whole rather than silently re-sorted,
--      because a re-sorted attempt plan is a wrong answer wearing a right one's
--      clothes. Malformed shapes fall back field by field. The database
--      therefore does not need a CHECK per number, and deliberately has none:
--      the ranges are product judgement that will move, and a CHECK constraint
--      that has to be migrated every time an opinion changes is the deploy this
--      table exists to avoid.
--
-- ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
--
-- The Dots, Wilks and IPF GL coefficients, and the IPF weight-class boundaries,
-- stay hardcoded in the client. They are not preferences, they are published
-- standards: an editable Wilks polynomial is a score nobody else can reproduce,
-- and an editable 83kg class is a lie about which platform an athlete stood on.
-- Only the TIER CUTOFFS ("Elite starts at 380") are opinion, and only those are
-- editable, under the 'scores' key.
--
-- ── PERMISSION ──────────────────────────────────────────────────────────────
--
-- Writes gate on is_axis_admin() OR has_permission('manage_calculators'), the
-- key seeded by 040. If 040 has not been applied yet, has_permission() answers
-- false for a key it has never heard of (016), so this migration is safe to run
-- out of order: the policy simply resolves to admin-only until the key exists.
--
-- Reads are OPEN, anon included, because these calculators are the public
-- pre-signup surface. That is safe by construction: nothing secret can be here.
-- The whole vocabulary is four keys of tuning numbers a visitor can already
-- read off the rendered page.
--
-- Re-runnable: create-if-not-exists, drop-then-create policies, no seed.
-- ============================================================


-- ── 1. The table ────────────────────────────────────────────────────────────
--
-- One row per calculator, keyed by the calculator itself. Not a singleton with
-- four columns, because the four are edited and reset independently: the panel
-- has a Save and a Reset per section, and "reset the RPE chart" has to be a
-- write that cannot disturb the attempt percentages.
--
-- The CHECK on `calculator` is the same controlled-vocabulary argument 019 makes
-- for site_settings.key: this table is admin-writable, and an open key space is
-- a place to scribble. Add a key here when you add a calculator.

create table if not exists public.calculator_settings (
  calculator text primary key
    check (calculator in ('rpe', 'attempts', 'converter', 'scores')),
  -- jsonb so each calculator's override shape can differ (a chart of fractions,
  -- a pair of attempt profiles, a list of plates, a set of tier cutoffs) and can
  -- grow a field without a schema change. `{}` means "nothing overridden".
  params     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  -- Nullable: a service-role write has no auth.uid(). The FK is to profiles for
  -- the same reason 029's settings tables use one — so the panel can say who
  -- last touched a number, and so a deleted account leaves the row intact.
  updated_by uuid references public.profiles (id) on delete set null
);


-- ── 2. Touch trigger ────────────────────────────────────────────────────────
--
-- Reuses 029's settings_touch_at_by() rather than defining a fifth copy. It
-- stamps updated_at and coalesces updated_by so a service-role write does not
-- null out the last human author.

drop trigger if exists calculator_settings_touch_trg on public.calculator_settings;
create trigger calculator_settings_touch_trg
  before insert or update on public.calculator_settings
  for each row execute function public.settings_touch_at_by();


-- ── 3. Guard trigger ────────────────────────────────────────────────────────
--
-- Two refusals, both about SHAPE rather than value.
--
-- The calculator key is already covered by the CHECK above; it is repeated here
-- so the failure arrives as a sentence naming the four keys instead of
-- "violates check constraint calculator_settings_calculator_check", which tells
-- a person nothing about what to type instead.
--
-- The params guard is the one that earns its keep. `params jsonb not null` is
-- happy to store `[]`, `"hello"`, `42` or `null`::jsonb — all valid JSON, none
-- of them a set of overrides. The merge on the client reads `params.profiles`
-- off whatever arrives and would find undefined on every field, so a scalar
-- would not corrupt a page; it would just be a row that silently does nothing,
-- which is worse than an error because the owner would keep saving into it.

create or replace function public.calculator_settings_guard()
returns trigger language plpgsql as $$
begin
  if new.calculator is null
     or new.calculator not in ('rpe', 'attempts', 'converter', 'scores') then
    raise exception
      'Unknown calculator %. The calculators are rpe, attempts, converter and scores.',
      coalesce(quote_literal(new.calculator), 'null')
      using errcode = '23514';
  end if;

  -- jsonb_typeof answers null for a SQL NULL and 'null' for the JSON null
  -- literal; both are refused, along with array / string / number / boolean.
  if new.params is null or jsonb_typeof(new.params) <> 'object' then
    raise exception
      'Calculator settings must be a JSON object of overrides, not %. Use {} to mean "use the defaults".',
      coalesce(jsonb_typeof(new.params), 'nothing')
      using errcode = '22023';
  end if;

  return new;
end $$;

-- Owner-owned table, touches no protected data, but the search_path is locked
-- anyway per 017's hardening convention.
alter function public.calculator_settings_guard() set search_path = '';

revoke all on function public.calculator_settings_guard() from public, anon;
grant  execute on function public.calculator_settings_guard() to authenticated, service_role;

drop trigger if exists calculator_settings_guard_trg on public.calculator_settings;
create trigger calculator_settings_guard_trg
  before insert or update on public.calculator_settings
  for each row execute function public.calculator_settings_guard();


-- ── 4. RLS ──────────────────────────────────────────────────────────────────
--
-- Read: everyone, signed in or not. The tools render before anybody has an
-- account — that is the point of them — so a signed-out visitor must be able to
-- read the RPE chart the owner adjusted. The public policy is `using (true)`
-- and calls NO helper, for the reason 029 spells out at locations: anon cannot
-- execute is_axis_admin() or has_permission() (revoked in 011/016), so a policy
-- that made anon evaluate one would raise "permission denied for function" on
-- every anonymous page load.
--
-- Write: admin, or a coach the admin trusted with manage_calculators.

alter table public.calculator_settings enable row level security;

drop policy if exists "public reads calculator settings" on public.calculator_settings;
drop policy if exists "staff write calculator settings"  on public.calculator_settings;

create policy "public reads calculator settings"
  on public.calculator_settings for select to anon, authenticated
  using (true);

create policy "staff write calculator settings"
  on public.calculator_settings for all to authenticated
  using      (public.is_axis_admin() or public.has_permission('manage_calculators'))
  with check (public.is_axis_admin() or public.has_permission('manage_calculators'));

revoke all on public.calculator_settings from anon, authenticated;
grant  select (calculator, params, updated_at) on public.calculator_settings to anon;
grant  select, insert, update, delete on public.calculator_settings to authenticated;


-- ── 5. Verify ───────────────────────────────────────────────────────────────
--
-- The table starts empty, and an empty table is the shipped behaviour:
--
--   select count(*) from public.calculator_settings;                    -- 0
--
-- anon can read it, and cannot write it:
--
--   set role anon;
--   select calculator, params from public.calculator_settings;          -- ok, 0 rows
--   insert into public.calculator_settings (calculator, params)
--     values ('rpe', '{}'::jsonb);                                      -- denied by RLS
--   reset role;
--
-- The guard refuses a shape that is valid JSON but is not a set of overrides.
-- Run as an admin (or service_role) so RLS is not what refuses it:
--
--   insert into public.calculator_settings (calculator, params)
--     values ('attempts', '[]'::jsonb);      -- ERROR: must be a JSON object … not array
--   insert into public.calculator_settings (calculator, params)
--     values ('attempts', '42'::jsonb);      -- ERROR: … not number
--   insert into public.calculator_settings (calculator, params)
--     values ('bench', '{}'::jsonb);         -- ERROR: Unknown calculator 'bench' …
--   insert into public.calculator_settings (calculator, params)
--     values ('attempts', '{}'::jsonb);      -- ok: "nothing overridden"
--
-- A plain coach is refused; the same coach, granted the key, lands. Substitute
-- a real coach profile id for :coach.
--
--   -- as an admin:
--   delete from public.staff_permissions
--    where profile_id = :coach and permission = 'manage_calculators';
--
--   -- as that coach:
--   insert into public.calculator_settings (calculator, params)
--     values ('attempts', '{"profiles":{"aggressive":{"open":0.91,"second":0.97,"third":1.05}}}'::jsonb)
--     on conflict (calculator) do update set params = excluded.params;   -- denied by RLS
--
--   -- as an admin (granted_by is read for the tier check, so it must be the
--   -- admin's own id — see 016):
--   insert into public.staff_permissions (profile_id, permission, granted, granted_by)
--     values (:coach, 'manage_calculators', true, auth.uid());
--
--   -- as that coach, the same statement now lands, and stamps them:
--   select calculator, params, updated_by from public.calculator_settings
--    where calculator = 'attempts';
--
-- Resetting a section is a write of {}, not a delete, so the row keeps its
-- audit trail of who reset it and when:
--
--   update public.calculator_settings set params = '{}'::jsonb where calculator = 'attempts';
-- ============================================================
