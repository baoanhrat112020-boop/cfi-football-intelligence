export function isDryRun(request:Request){
  try{
    const u=new URL(request.url);
    if(u.searchParams.get('source')==='suggest'&&u.searchParams.get('dry_run')==='true')return true;
  }catch{}
  return request.headers.get('x-cfi-dry-run')==='1';
}

export const DRY_RUN_AUDIT={status:'SKIPPED',reason:'DRY_RUN'};
