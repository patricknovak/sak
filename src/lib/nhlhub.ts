// Client for the nhl-hub edge function (a caching proxy in front of the NHL's public API).
import { supabase } from './supabase';

export async function hub<T>(task: string, q: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ task, ...q }).toString();
  const { data, error } = await supabase.functions.invoke(`nhl-hub?${qs}`, { method: 'GET' });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export interface NewsStory { id: string; source: string; headline: string; summary: string; date: string; url: string; image: string | null; tags: string[] }
export interface Leader { id: number; name: string; num: number; pos: string; team: string; logo: string | null; headshot: string | null; value: number }
export interface Leaders { skaters: Record<string, Leader[]>; goalies: Record<string, Leader[]> }
export interface ClubPerson { id: number; name: string; num: number; pos: string; shoots: string; ht: number; wt: number; born: string; country: string; headshot: string | null }
export interface ClubSkater { id: number; name: string; pos: string; gp: number; g: number; a: number; pts: number; pm: number; pim: number; ppg: number; sog: number; pct: number; toi: string }
export interface ClubGoalie { id: number; name: string; gp: number; gs: number; w: number; l: number; otl: number; gaa: number; svp: number; so: number }
export interface XPost { id: string; text: string; at: string; url: string; author: { name: string; handle: string; avatar: string | null }; likes: number; reposts: number; link: { url: string; title: string | null } | null; image: string | null }
export interface XFeed { configured: boolean; accounts: { handle: string; name: string; url: string }[]; posts: XPost[] }
