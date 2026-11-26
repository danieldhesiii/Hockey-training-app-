// Initial offline installation must not consume the reload guard for a later
// explicitly accepted update. Another tab updating must not discard this draft.
export function watchAppUpdates(registration,serviceWorker,{onReady,onReload,onOfflineReady=()=>{}}) {
  let applied=false,reloading=false;
  const reload=()=>{if(!reloading){reloading=true;onReload();}};
  serviceWorker.addEventListener('controllerchange',()=>{if(applied)reload();});
  if(registration.waiting)onReady(registration.waiting);
  const watch=worker=>{
    if(!worker)return;
    const changed=()=>{
      if(worker.state==='installed'&&serviceWorker.controller)onReady(worker);
      if(worker.state==='activated')onOfflineReady();
    };
    worker.addEventListener('statechange',changed);changed();
  };
  watch(registration.installing);
  registration.addEventListener('updatefound',()=>watch(registration.installing));
  return {async apply(){
    applied=true;
    // Resolve the current waiting worker, not an obsolete handle from a banner.
    if(registration.waiting)registration.waiting.postMessage({type:'SKIP_WAITING'});
    else reload();
  }};
}
