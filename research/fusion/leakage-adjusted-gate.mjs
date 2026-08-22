export function assessLeakageAdjustedGate(input={}){
  const externalPretrainedModel=Boolean(input.externalPretrainedModel);
  const historicalOnly=Boolean(input.historicalOnly);
  const matchedCleanControl=Boolean(input.matchedCleanControl);
  const prospectiveUnseen=Boolean(input.prospectiveUnseen);
  if(!externalPretrainedModel) return {pass:true,reason:null,adjustedValidationRequired:false};
  if(prospectiveUnseen) return {pass:true,reason:null,adjustedValidationRequired:false};
  if(historicalOnly && !matchedCleanControl){
    return {pass:false,reason:'EXTERNAL_MODEL_CLEAN_CONTROL_REQUIRED',adjustedValidationRequired:true};
  }
  return {pass:true,reason:null,adjustedValidationRequired:historicalOnly};
}
