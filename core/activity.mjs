import {requireThat} from './util.mjs';

export function clearActivity(state,keys){
  requireThat(Array.isArray(keys)&&keys.length&&keys.every(k=>typeof k==='string'&&/^(job|removal)\/[0-9a-f-]{36}$/.test(k)),'invalid_selection');
  state.db.exec('BEGIN IMMEDIATE');
  try{
    for(const k of new Set(keys)){
      const j=state.get(k);requireThat(j,'stale_plan');
      requireThat(k.startsWith('removal/')?j.status==='completed':j.status!=='running','activity_pending');
      state.remove(k);
      if(k.startsWith('removal/'))state.remove('removal-plan/'+j.id);
    }
    state.db.exec('COMMIT');
  }catch(e){state.db.exec('ROLLBACK');throw e;}
  return new Set(keys).size;
}
