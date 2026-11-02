import { hash,stableRead } from './util.mjs';
export const receiptKey=(home,id)=>'receipt/'+hash(home)+'/'+id;
export function normalized(state,row,raw){
 const r=state.get(receiptKey(row.home,row.id));if(!r)return {raw,assets:[]};
 const imported=Buffer.from(r.imported,'base64');
 if(raw.length>=imported.length&&raw.subarray(0,imported.length).equals(imported))return {raw:Buffer.concat([Buffer.from(r.original,'base64'),raw.subarray(imported.length)]),assets:r.assets??[]};
 return {raw,assets:[]};
}
export async function remember(state,payload,rows,home,project){
 for(const f of payload.files){const row=rows.find(x=>x.id===f.id);if(!row)continue;const raw=await stableRead(row.file);
  state.set(receiptKey(home,f.id),{original:f.raw,imported:raw.toString('base64'),assets:payload.assets??[],project,hash:hash(raw),checkedAt:new Date().toISOString()});
 }
}
