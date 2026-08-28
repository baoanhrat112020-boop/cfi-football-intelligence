const SEASONS = [
  { id: "2021", label: "2020/21" },
  { id: "2122", label: "2021/22" },
  { id: "2223", label: "2022/23" },
  { id: "2324", label: "2023/24" },
  { id: "2425", label: "2024/25" },
  { id: "2526", label: "2025/26" }
];

const DIVISIONS = [
  ["E0",  "England Premier League"],
  ["E1",  "England Championship"],
  ["E2",  "England League One"],
  ["E3",  "England League Two"],
  ["EC",  "England National League"],

  ["SC0", "Scotland Premiership"],
  ["SC1", "Scotland Championship"],
  ["SC2", "Scotland League One"],
  ["SC3", "Scotland League Two"],

  ["D1",  "Germany Bundesliga"],
  ["D2",  "Germany 2. Bundesliga"],

  ["I1",  "Italy Serie A"],
  ["I2",  "Italy Serie B"],

  ["SP1", "Spain La Liga"],
  ["SP2", "Spain Segunda Division"],

  ["F1",  "France Ligue 1"],
  ["F2",  "France Ligue 2"],

  ["N1",  "Netherlands Eredivisie"],
  ["B1",  "Belgium First Division A"],
  ["P1",  "Portugal Primeira Liga"],
  ["T1",  "Turkey Super Lig"],
  ["G1",  "Greece Super League"]
];

export const HISTORICAL_SOURCES = SEASONS.flatMap(
  season =>
    DIVISIONS.map(([competition, league]) => ({
      id: `football-data-${season.id}-${competition}`,
      season: season.label,
      seasonCode: season.id,
      competition,
      league,
      evidenceClass: "HT_FT_PRIMARY",
      url:
        `https://www.football-data.co.uk/mmz4281/${season.id}/${competition}.csv`
    }))
);

if (HISTORICAL_SOURCES.length !== 132) {
  throw new Error(
    `HISTORICAL_REGISTRY_COUNT_MISMATCH_${HISTORICAL_SOURCES.length}`
  );
}
