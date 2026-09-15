import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseAiScoreBodyText } from "./aiscore-parser.mjs";

const SOURCE_URL="https://www.aiscore.com/today-matches";
const TIME_ZONE="Asia/Ho_Chi_Minh";
const OUTPUT=resolve("local-node/cache/browser/aiscore-today-fixtures.json");
const AUDIT=resolve("local-node/cache/browser/aiscore-today-audit.json");
const INGEST_URL=process.env.CFI_PC_NODE_INGEST_URL
  || "https://kovmddkkzttquupdgmel.supabase.co/functions/v1/cfi-pc-node-ingest";

function localDate(){
  const p=new Intl.DateTimeFormat("en-CA",{
    timeZone:TIME_ZONE,
    year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(new Date());
  const g=t=>p.find(x=>x.type===t)?.value??"";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

async function saveJson(file,data){
  await mkdir(dirname(file),{recursive:true});
  await writeFile(file,JSON.stringify(data,null,2),"utf8");
}

function detectBlock(text){
  const x=String(text??"").toLowerCase();
  return[
    "verify you are human",
    "access denied",
    "captcha",
    "checking your browser",
    "unusual traffic",
    "temporarily blocked"
  ].find(marker=>x.includes(marker))??null;
}

async function upload(targetDate,fixtures){
  const key=String(process.env.CFI_PC_NODE_KEY??"").trim();

  if(!key){
    return{
      status:"SKIPPED",
      reason:"CFI_PC_NODE_KEY_MISSING"
    };
  }

  const response=await fetch(INGEST_URL,{
    method:"POST",
    headers:{
      "content-type":"application/json",
      "x-cfi-node-key":key
    },
    body:JSON.stringify({
      action:"FIXTURE_DISCOVERY_BATCH",
      node_id:process.env.CFI_NODE_ID||"LOCAL_NODE",
      source:"AISCORE",
      target_date:targetDate,
      generated_at:new Date().toISOString(),
      fixtures
    })
  });

  const text=await response.text();
  let body;
  try{body=JSON.parse(text);}catch{body={raw:text.slice(0,1000)};}

  return{
    status:response.ok?"ACCEPTED":"ERROR",
    httpStatus:response.status,
    body
  };
}

const targetDate=localDate();
const browser=await chromium.launch({headless:true});

let audit;

try{
  const context=await browser.newContext({
    locale:"en-GB",
    timezoneId:TIME_ZONE,
    viewport:{width:1440,height:1200}
  });

  const page=await context.newPage();
  const startedAt=Date.now();

  try{
    const response=await page.goto(SOURCE_URL,{
      waitUntil:"domcontentloaded",
      timeout:45000
    });

    await page.waitForTimeout(2500);

    const bodyText=await page.locator("body").innerText({
      timeout:15000
    });

    const blockMarker=detectBlock(bodyText);
    const parsed=blockMarker
      ? {fixtures:[],rejected:[],stats:{lines:0,parsed:0,unique:0,rejected:0}}
      : parseAiScoreBodyText(bodyText,{
          targetDate,
          timeZone:TIME_ZONE,
          sourceUrl:SOURCE_URL
        });

    const uploadResult=parsed.fixtures.length
      ? await upload(targetDate,parsed.fixtures)
      : {status:"SKIPPED",reason:blockMarker?"SOURCE_BLOCKED":"ZERO_FIXTURES"};

    const manifest={
      contract:"CFI_AISCORE_TODAY_FIXTURES_V1",
      generatedAt:new Date().toISOString(),
      targetDate,
      timeZone:TIME_ZONE,
      source:"AISCORE",
      sourceUrl:SOURCE_URL,
      count:parsed.fixtures.length,
      fixtures:parsed.fixtures
    };

    await saveJson(OUTPUT,manifest);

    audit={
      contract:"CFI_AISCORE_TODAY_AUDIT_V1",
      generatedAt:new Date().toISOString(),
      status:parsed.fixtures.length
        ? (uploadResult.status==="ERROR"?"PASS_LOCAL_UPLOAD_ERROR":"PASS")
        : (blockMarker?"SOURCE_BLOCKED":"ZERO_FIXTURES"),
      targetDate,
      httpStatus:response?.status()??null,
      finalUrl:page.url(),
      title:await page.title(),
      bodyChars:bodyText.length,
      blocked:Boolean(blockMarker),
      blockMarker,
      elapsedMs:Date.now()-startedAt,
      parsed:parsed.stats,
      upload:uploadResult,
      canonicalWriteAttempted:false,
      decisionUse:false,
      rejected:parsed.rejected.slice(0,100)
    };

    await saveJson(AUDIT,audit);
  }finally{
    await context.close();
  }
}finally{
  await browser.close();
}

console.log("CFI AISCORE TODAY SUMMARY");
console.dir({
  status:audit?.status,
  targetDate:audit?.targetDate,
  httpStatus:audit?.httpStatus,
  parsed:audit?.parsed,
  upload:audit?.upload,
  canonicalWriteAttempted:false,
  decisionUse:false
},{depth:null});
