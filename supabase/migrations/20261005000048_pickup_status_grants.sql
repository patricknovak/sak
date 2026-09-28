-- pickup_status is read by every GM: its read-only helpers have to be callable by them
grant execute on function public._acq_used(int), public._acq_allowed(int), public._playoffs_on() to authenticated;
