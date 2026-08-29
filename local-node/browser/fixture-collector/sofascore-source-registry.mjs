const host = "www.sofascore.com";

function makeUrl(path) {
  return ["https:/", "/", host, path].join("");
}

export const SOFASCORE_CROSSCHECK_SOURCES = [
  {
    id: "sofascore-argentina-reserve",
    provider: "sofascore",
    url: makeUrl("/football/tournament/argentina/campeonato-de-reserva-de-primera-division/18817"),
    competition: "Campeonato de Reserva de Primera Division",
    country: "Argentina",
    target_class: "RESERVE",
    tournament_id: "18817"
  },
  {
    id: "sofascore-turkey-u19",
    provider: "sofascore",
    url: makeUrl("/football/tournament/turkey/u19-lig-elit-a-grup-1/13959"),
    competition: "U19 Elit A Ligi",
    country: "Turkey",
    target_class: "YOUTH",
    tournament_id: "13959"
  }
];
