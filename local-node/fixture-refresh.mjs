import { SOURCES } from "./harvester/source-registry/sources.mjs";
import { checkFootballDataSource } from "./harvester/football-data/harvester.mjs";
import { parseFootballDataFixtures } from "./harvester/football-data/parser.mjs";

console.log("CFI LOCAL DATA NODE");
console.log("MODE: LOCAL_PARSE");
console.log("");

for (const source of SOURCES) {
  console.log(`[SOURCE] ${source.id} enabled=${source.enabled}`);

  if (!source.enabled) continue;

  if (source.id === "football-data") {
    const check = await checkFootballDataSource(source);
    console.log(check);

    const parsed = await parseFootballDataFixtures();
    console.log(parsed);
  }
}

console.log("");
console.log("BigDB writes performed: NO");
console.log("Production Discovery calls performed: NO");
