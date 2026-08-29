export const SOURCES = [
  {
    id: "football-data",
    type: "csv",
    enabled: true,
    role: ["historical", "fixtures"],
    baseUrl: "https://www.football-data.co.uk/",
    checkEveryMinutes: 15
  },
  {
    id: "openfootball",
    type: "git",
    enabled: true,
    role: ["historical", "aliases"],
    baseUrl: "https://github.com/openfootball",
    checkEveryMinutes: 60
  }
];
