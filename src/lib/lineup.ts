// the lineup optimizer is shared with the server's daily auto-pilot
import type { Player } from './types';

export * from '../../supabase/functions/_shared/lineup';

// out of the lineup for now: on the injury report as out or on IR, or suspended (a day-to-day player still dresses)
export const hurt = (p: Player) => !!p.injury_status && /^(out|ir|injured|long|suspen)/i.test(p.injury_status);
