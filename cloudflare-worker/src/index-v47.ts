import base from './index-v46';

type Env={CFI_DB_BASE_URL?:string;CFI_DB_KEY?:string;AI?:Ai};

export default{
 async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const u=new URL(request.url);
  if(u.pathname==='/health')return Response.json({status:'OK',service:'CFI Football Intelligence',version:'CFI_FINAL_V5.0.1',webApp:true,gptAction:true});
  return base.fetch(request,env,ctx);
 }
} satisfies ExportedHandler<Env>;
