-- Women's soccer on: the WSL (England, 2026-27, September to May) and the NWSL (its last weeks and the playoffs to the
-- final in November) were set up on ESPN's free feed with the rest of soccer (migrations 148 and 168) and left off;
-- the landing pages have promised them as coming. On, they come in with the next fixtures pull, rounds cut from the
-- schedule as every ESPN competition's are, and offer pick'em, last one standing, Call the score and the daily streak.
-- Safe to run twice; switching one back off hides it from the start page and stops its pulls.
update public.competitions set active = true where id in ('wsl', 'nwsl') and not active;
