-- 0022_resubmit_declined_claims.sql
-- A declined reimbursement can be corrected and resubmitted, instead of
-- being raised again from scratch. Editing a declined claim addresses the
-- reason it was turned down and sends it back for review: status returns to
-- 'requested' and the decision (who/when/why) is cleared. A claim that has
-- been PAID stays locked — its numbers are somebody's accounts.
--
-- Safe to run on a live database and only needs running once. Re-runnable:
-- every statement is create-or-replace / drop-then-create.

-- ── Editing now covers a declined claim, and resubmits it ──────────────────
create or replace function public.edit_claim(
  p_claim_id uuid, p_zone text, p_reason text, p_lines jsonb
) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_claim public.claims;
  v_line jsonb;
  v_desc text;
  v_amount int;
  v_total int := 0;
  v_count int := 0;
begin
  select * into v_claim from public.claims where id = p_claim_id for update;
  if v_claim.id is null then
    raise exception 'Claim not found.';
  end if;
  if v_claim.claimed_by <> auth.uid() and not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  -- Requested (still open) or declined (being corrected) can be edited; paid
  -- cannot.
  if v_claim.status not in ('requested', 'declined') then
    raise exception 'This claim has already been paid — it can no longer be changed.';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'A claim needs at least one line. Cancel it instead.';
  end if;
  if nullif(trim(coalesce(p_reason,'')), '') is null then
    raise exception 'A reason for the purchase is required.';
  end if;

  delete from public.claim_lines where claim_id = p_claim_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_desc := nullif(trim(coalesce(v_line->>'description','')), '');
    v_amount := nullif(v_line->>'amount_cents','')::int;
    if v_desc is null then
      raise exception 'Each line needs a description.';
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'Each line needs an amount greater than zero.';
    end if;
    insert into public.claim_lines (claim_id, description, amount_cents, sort_order)
    values (p_claim_id, v_desc, v_amount, v_count);
    v_total := v_total + v_amount;
    v_count := v_count + 1;
  end loop;

  -- Editing sends it back for review: a declined claim becomes requested
  -- again and its decision is wiped; a requested claim is unaffected by this.
  update public.claims
  set zone = nullif(trim(coalesce(p_zone,'')), ''),
      reason = trim(p_reason),
      status = 'requested',
      admin_note = null,
      decided_at = null,
      decided_by = null,
      updated_at = now()
  where id = p_claim_id;

  return jsonb_build_object('total_cents', v_total, 'line_count', v_count);
end;
$$;

grant execute on function public.edit_claim(uuid, text, text, jsonb) to authenticated;

-- ── Withdrawing now covers a declined claim too ────────────────────────────
create or replace function public.cancel_claim(p_claim_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_claim public.claims;
begin
  select * into v_claim from public.claims where id = p_claim_id for update;
  if v_claim.id is null then
    raise exception 'Claim not found.';
  end if;
  if v_claim.claimed_by <> auth.uid() and not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  -- A declined claim can be withdrawn instead of resubmitted; a paid one
  -- cannot.
  if v_claim.status not in ('requested', 'declined') then
    raise exception 'This claim has already been paid.';
  end if;
  delete from public.claims where id = p_claim_id;
end;
$$;

grant execute on function public.cancel_claim(uuid) to authenticated;

-- ── Receipts can be managed while a claim is declined (until it is paid) ───
-- So the claimant can swap or add a receipt as part of correcting it.
drop policy if exists claim_receipts_insert on public.claim_receipts;
create policy claim_receipts_insert on public.claim_receipts for insert to authenticated
  with check (exists (select 1 from public.claims c
                      where c.id = claim_id
                        and c.claimed_by = auth.uid()
                        and c.status in ('requested', 'declined')));

drop policy if exists claim_receipts_delete on public.claim_receipts;
create policy claim_receipts_delete on public.claim_receipts for delete to authenticated
  using (exists (select 1 from public.claims c
                 where c.id = claim_id
                   and c.claimed_by = auth.uid()
                   and c.status in ('requested', 'declined')));
