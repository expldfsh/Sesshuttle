import {bundleBytes} from './bundle.mjs';
import {attachmentReview,inheritedOmissions} from './attachment-policy.mjs';
import {seal} from './crypto.mjs';
import {hash,requireThat} from './util.mjs';
import {withSpaceWriter} from './space-writer.mjs';

const digest=/^[0-9a-f]{64}$/;
const uuid=/^[0-9a-f-]{36}$/i;
const unique=items=>[...new Set(items)];
const metaRows=h=>[...h.versions,...(h.trash??[]).flatMap(b=>b.versions)];
function describe(p){
  const chunks=new Set(),files=p.files.map(f=>{
    const assets=[],reports=new Map((f.attachmentReport??[]).map(a=>[a.path,a]));
    for(const a of f.artifacts??[]){
      for(const c of a.chunks)chunks.add(c.hash);
      if(a.kind==='asset'){assets.push({path:a.path,hash:a.hash,bytes:a.bytes,chunks:a.chunks.map(c=>c.hash)});reports.delete(a.path);}
    }
    for(const a of [...reports.values(),...(f.omittedAttachments??[])])assets.push({path:a.path,missing:true,bytes:a.bytes??0});
    return {id:f.id,title:f.title??(f.id===p.logicalId?p.title:f.id),kind:f.kind,project:f.originProject?.name??f.project,assets};
  });
  if(p.format===1)for(const a of p.assets??[])files.find(f=>f.id===p.logicalId).assets.push({path:a.path,hash:a.hash,bytes:Buffer.byteLength(a.data,'base64'),chunks:[]});
  const header={};
  for(const key of ['logicalId','title','source','project','originProject','projectId','updatedAt','device','messages','kind','parent','agent','archived','issues','continuation'])if(p[key]!==undefined)header[key]=p[key];
  header.bytes=bundleBytes(p);header.omittedImageCount=attachmentReview(p).optional.length+inheritedOmissions(p).length;
  return {header,files,chunks};
}

// Follow ancestry, including missing intermediate versions recorded in the recycle bin.
// Several live branches remain a conflict; wall-clock order never resolves it.
function survivingTips(candidates,available,metadata){
  const live=new Set(available),rows=new Map(metadata.map(v=>[v.id,v.parents??[]]));
  const collect=(starts,stopAtLive)=>{
    const found=new Set(),visited=new Set(),stack=[...starts];
    while(stack.length){const v=stack.pop();if(visited.has(v))continue;visited.add(v);
      if(live.has(v)){found.add(v);if(stopAtLive)continue;}
      stack.push(...(rows.get(v)??[]));
    }
    return found;
  };
  let tips=[...collect(candidates,true)];
  if(!tips.length)tips=[...live];
  const ancestors=collect(tips.flatMap(v=>rows.get(v)??[]),false);
  return tips.filter(v=>!ancestors.has(v));
}

async function catalog(vault){
  const heads=await vault.allHeads(),inventory=(await vault.inventory()).objects,versions=new Map();
  const prefix=vault.prefix+'versions/';
  for(const key of [...inventory.keys()].filter(k=>k.startsWith(prefix)).sort()){
    const v=key.slice(prefix.length);requireThat(digest.test(v),'corrupt_data');versions.set(v,describe(await vault.version(v)));
  }
  for(const h of heads)for(const v of metaRows(h))requireThat(versions.get(v.id)?.header.logicalId===h.logicalId,'missing_remote_object');
  return {heads,inventory,versions};
}
const isBin=action=>action==='restore'||action==='purgeBin';
const purges=action=>action==='purge'||action==='purgeBin';

export async function cloudBins(vault){
  const marker=await vault.open();
  const bins=(await vault.allHeads()).flatMap(h=>(h.trash??[]).map(b=>({id:b.id,logicalId:h.logicalId,title:b.title,at:b.at,count:b.versions.length})));
  return {bins,pending:marker.pending?{id:marker.pending.id,owner:marker.writer?.name}:null,space:vault.space};
}

export async function cloudRemovalPlan(vault,request){
  const {ids,versions:choices={},action,binId}=request;
  requireThat(['trash','purge','restore','purgeBin'].includes(action)&&Array.isArray(ids)&&ids.length&&ids.every(x=>uuid.test(x)),'invalid_selection');
  requireThat(choices&&typeof choices==='object'&&Object.keys(choices).every(k=>ids.includes(k)),'invalid_selection');
  const marker=await vault.open();requireThat(!marker.pending,'cloud_cleanup_pending');
  const {heads,inventory,versions}=await catalog(vault),selected=new Set(),changes=[],items=[];
  const references=new Map();
  function addReference(id,ref){if(!references.has(id))references.set(id,[]);references.get(id).push(ref);}
  for(const h of heads){
    for(const v of h.versions)addReference(v.id,{title:h.title,logicalId:h.logicalId,place:'cloudActive',at:v.at});
    for(const b of h.trash??[])for(const v of b.versions)addReference(v.id,{title:b.title,logicalId:h.logicalId,place:'cloudBin',binId:b.id,at:v.at});
  }
  for(const logical of unique(ids)){
    const head=heads.find(h=>h.logicalId===logical),bin=head?.trash?.find(b=>b.id===binId);
    const available=isBin(action)?bin?.versions:head?.versions;
    if(!available?.length){requireThat(!isBin(action)&&!choices[logical]?.length,'stale_plan');continue;}
    const picked=choices[logical]??available.map(v=>v.id);
    requireThat(Array.isArray(picked)&&picked.every(v=>available.some(old=>old.id===v)),'stale_plan');
    const chosen=available.filter(v=>picked.includes(v.id));
    chosen.forEach(v=>selected.add(v.id));
    const rest=head.versions.filter(v=>!picked.includes(v.id));
    let active,tips;
    if(action==='restore'){
      active=[...head.versions,...chosen];
      tips=survivingTips([...head.tips,...bin.tips.filter(v=>picked.includes(v))],active.map(v=>v.id),metaRows(head));
    }else if(action==='purgeBin'){active=head.versions;tips=head.tips;}
    else{active=rest;tips=survivingTips(head.tips,rest.map(v=>v.id),metaRows(head));}
    if(chosen.length)changes.push({head,bin,chosen,active,tips});
    items.push({id:logical,title:bin?.title??head.title,project:versions.get(available.at(-1).id).header.originProject?.name??head.project,
      versions:available.map(v=>({id:v.id,at:v.at,device:v.device?.name??v.device?.id,selected:picked.includes(v.id),current:head.tips.includes(v.id),bytes:versions.get(v.id).header.bytes,files:versions.get(v.id).files})),
      nextTips:tips.map(id=>{const info=metaRows(head).find(v=>v.id===id);return {id,at:info?.at,device:info?.device?.name??info?.device?.id};})});
  }
  const keepChunks=new Set(),keepAssets=new Map(),wantedChunks=new Set(),retained=[];
  const affectedIds=new Set([...ids,...(request.inspectIds??[])]);
  for(const v of selected)for(const f of versions.get(v).files)affectedIds.add(f.id);
  const exclusiveVersions=new Set();
  for(const [id,v] of versions){
    const refs=references.get(id)??[{title:v.header.title,place:'unlistedVersion',logicalId:v.header.logicalId}];
    const kept=refs.filter(r=>!selected.has(id)||(isBin(action)?r.binId!==binId:r.place!=='cloudActive'));
    if(selected.has(id)){for(const c of v.chunks)wantedChunks.add(c);if(!kept.length){exclusiveVersions.add(id);continue;}}
    for(const c of v.chunks)keepChunks.add(c);
    for(const f of v.files)for(const a of f.assets)if(a.hash){
      if(!keepAssets.has(a.hash))keepAssets.set(a.hash,new Map());
      keepAssets.get(a.hash).set(id,{id,title:kept[0].title,place:kept[0].place});
    }
    if(v.files.some(f=>affectedIds.has(f.id)))for(const ref of kept)retained.push({id,...ref,members:v.files.filter(f=>affectedIds.has(f.id)).map(f=>f.title)});
  }
  let freeBytes=0;
  const erase=[];
  if(purges(action)){
    for(const id of exclusiveVersions)erase.push('versions/'+id);
    for(const c of wantedChunks)if(!keepChunks.has(c))erase.push('blobs/'+c);
    for(const key of erase)freeBytes+=inventory.get(vault.prefix+key)??0;
  }
  for(const i of items)for(const v of i.versions){
    v.files=v.files.map(f=>({...f,assets:f.assets.map(a=>{
      const {chunks,...asset}=a;
      const shared=keepAssets.has(a.hash),partial=chunks?.some(c=>keepChunks.has(c));
      const disposition=a.missing?'absent':!v.selected?'kept':action==='trash'?(shared?'recycledShared':'recycled'):action==='restore'?'restored':shared?'shared':partial?'partlyShared':'removed';
      return {...asset,disposition,sharedWith:shared?[...keepAssets.get(a.hash).values()]:[]};
    })}));
  }
  const signature=hash(JSON.stringify({space:vault.space,format:marker.format,request,
    heads:heads.map(h=>[h.logicalId,h.etag]).sort(),versions:[...versions.keys()].sort(),erase:erase.sort(),freeBytes}));
  const preview={space:vault.space,upgrade:marker.format===1,items,retained,freeBytes,count:selected.size,signature};
  return {preview,transaction(operation){
    const updates=changes.map(({head,bin,chosen,active,tips})=>{
      let trash=[...(head.trash??[])];const picked=new Set(chosen.map(v=>v.id));
      if(action==='trash')trash.push({id:operation,at:new Date().toISOString(),title:head.title,tips:head.tips,versions:chosen});
      if(isBin(action))trash=trash.map(b=>b!==bin?b:{...b,versions:b.versions.filter(v=>!picked.has(v.id))}).filter(b=>b.versions.length);
      // When a middle version disappears permanently, retain the links between its
      // surviving ancestors and descendants for subsequent branch selection.
      if(purges(action)){
        const all=new Map(metaRows(head).map(v=>[v.id,v]));
        const reconnect=v=>{
          const parents=[],stack=[...(v.parents??[])],seen=new Set();
          while(stack.length){const p=stack.pop();if(seen.has(p))continue;seen.add(p);if(picked.has(p))stack.push(...(all.get(p)?.parents??[]));else parents.push(p);}
          return {...v,parents};
        };
        active=active.map(reconnect);trash=trash.map(b=>({...b,versions:b.versions.map(reconnect)}));
      }
      const next={...(tips.length?versions.get(tips[0]).header:{}),format:1,logicalId:head.logicalId,tips,versions:active,trash,lastRemoval:operation};
      return {logicalId:head.logicalId,expected:head.etag,next};
    });
    return {id:operation,updates,erase};
  }};
}

async function applyPending(vault,guard,progress){
  const transaction=guard.state().pending;
  for(const change of transaction.updates){
    const current=await vault.rawHead(change.logicalId);
    if(current?.lastRemoval===transaction.id)continue;
    requireThat(current?.etag===change.expected,'stale_plan');
    const path='heads/'+change.logicalId;
    await vault.store.put(vault.prefix+path,seal(change.next,vault.key,vault.space,path),change.expected);
  }
  for(const [i,key] of transaction.erase.entries()){
    requireThat(/^(versions|blobs)\/[0-9a-f]{64}$/.test(key),'corrupt_data');
    if(i%25===0)progress?.(i,transaction.erase.length);
    await vault.store.remove(vault.prefix+key);
  }
  const completed=[...(guard.state().completed??[]).filter(x=>x!==transaction.id).slice(-127),transaction.id];
  await guard.update({pending:null,completed});
}

export async function changeCloud(vault,request,signature,operation,{upgrade=false,progress}={}){
  requireThat(uuid.test(operation),'invalid_selection');
  return withSpaceWriter(vault,async guard=>{
    if(guard.state().completed?.includes(operation))return;
    if(!guard.state().pending){
      requireThat(request&&signature,'stale_plan');
      const plan=await cloudRemovalPlan(vault,request);
      requireThat(plan.preview.signature===signature&&plan.preview.count,'stale_plan');
      requireThat(!plan.preview.upgrade||upgrade,'cloud_upgrade_required');
      await guard.update({format:2,pending:plan.transaction(operation)});
    }
    await applyPending(vault,guard,progress);
  },{resume:operation});
}
