import { formatClock } from '../engine/time';
import type { Workout } from '../engine/types';
import { makeWorkout } from '../engine/workout';
import { IntervalsClient, type NewEvent } from '../intervals/client';
import type { ProposalChange } from './types';

// Applying an approved change. Rules:
// - Demo mode: changes apply locally only.
// - Intervals: new sessions are created as Preburner-tagged events (external_id,
//   so re-applying is idempotent). TrainerRoad-owned events are never edited or
//   deleted — TR would re-sync them — so remove/move hides them locally and adds
//   a NOTE on the Intervals calendar to mirror the change in TrainerRoad.

export interface ApplyContext {
  mode: 'demo' | 'intervals';
  client?: IntervalsClient;
  ftp: number;
  workouts: Workout[];
}

export interface ApplyEffect {
  addLocal?: Workout[];
  hideIds?: string[];
}

const icuId = (id: string) => (id.startsWith('icu-') ? Number(id.slice(4)) : undefined);

function sessionEvent(change: ProposalChange, date: string): NewEvent {
  const s = change.session!;
  return {
    start_date_local: `${date}T${s.startMin ? formatClock(s.startMin, false) : '00:00'}:00`,
    category: 'WORKOUT',
    type: 'Ride',
    name: s.title,
    description: [s.structure, `\nPlanned by Preburner coach: ${change.reason}`].filter(Boolean).join('\n'),
    moving_time: Math.round(s.durationMin * 60),
    external_id: `preburner-${change.id}`,
    tags: ['preburner'],
  };
}

function noteEvent(change: ProposalChange, text: string): NewEvent {
  return { start_date_local: `${change.date}T00:00:00`, category: 'NOTE', name: `Preburner: ${text}`.slice(0, 120), description: change.reason, external_id: `preburner-note-${change.id}` };
}

export async function applyChange(change: ProposalChange, ctx: ApplyContext): Promise<ApplyEffect> {
  const target = change.targetWorkoutId ? ctx.workouts.find((w) => w.id === change.targetWorkoutId) : undefined;
  const local = (date: string) =>
    makeWorkout({
      id: `preburner-${change.id}`,
      date,
      title: change.session!.title,
      durationMin: change.session!.durationMin,
      intensity: change.session!.intensity,
      ifactor: change.session!.ifactor,
      ftp: ctx.ftp,
      source: 'preburner',
      description: change.session!.structure,
    });

  if (ctx.mode === 'demo' || !ctx.client) {
    switch (change.action) {
      case 'add':
        return { addLocal: [local(change.date)] };
      case 'remove':
        return { hideIds: target ? [target.id] : [] };
      case 'move':
        return target ? { hideIds: [target.id], addLocal: [{ ...target, id: `${target.id}-moved-${change.id}`, date: change.newDate!, startMin: null }] } : {};
      case 'replace':
        return { hideIds: target ? [target.id] : [], addLocal: [local(target?.date ?? change.date)] };
      default:
        return {};
    }
  }

  const client = ctx.client;
  const ownedByPreburner = target?.source === 'preburner';
  switch (change.action) {
    case 'add': {
      await client.upsertEvents([sessionEvent(change, change.date)]);
      return {}; // picked up on the next sync
    }
    case 'note': {
      await client.upsertEvents([noteEvent(change, change.note ?? change.reason)]);
      return {};
    }
    case 'remove': {
      if (!target) return {};
      if (ownedByPreburner && icuId(target.id)) {
        await client.deleteEvent(icuId(target.id)!);
        return { hideIds: [target.id] };
      }
      await client.upsertEvents([noteEvent(change, `skip ${target.title}`)]);
      return { hideIds: [target.id] };
    }
    case 'move': {
      if (!target || !change.newDate) return {};
      if (ownedByPreburner && icuId(target.id)) {
        await client.updateEvent(icuId(target.id)!, { start_date_local: `${change.newDate}T00:00:00` });
        return {};
      }
      await client.upsertEvents([noteEvent(change, `move ${target.title} to ${change.newDate}`)]);
      return { hideIds: [target.id], addLocal: [{ ...target, id: `${target.id}-moved-${change.id}`, date: change.newDate, startMin: null, source: 'preburner' }] };
    }
    case 'replace': {
      if (!target) return {};
      await client.upsertEvents([sessionEvent(change, target.date)]);
      if (ownedByPreburner && icuId(target.id)) await client.deleteEvent(icuId(target.id)!);
      else await client.upsertEvents([noteEvent({ ...change, date: target.date }, `replace ${target.title} with ${change.session?.title}`)]);
      return { hideIds: [target.id] };
    }
  }
}
