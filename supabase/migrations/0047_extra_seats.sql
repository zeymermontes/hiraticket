-- Paid extra agent seats beyond the plan's included agents (250 MXN/mo each). allowed agents =
-- plan.limits.agents + extra_seats. Over that (and not in trial) prompts to remove an agent or buy a seat.
alter table public.subscriptions
  add column if not exists extra_seats int not null default 0;
