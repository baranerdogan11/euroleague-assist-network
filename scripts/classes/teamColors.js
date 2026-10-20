/**
 * Club accent colours, tuned to read on the cream background (pure
 * whites and bright yellows are swapped for the club's darker brand
 * colour). Primary drives dots, edges and UI accent; secondary is
 * reserved for future use.
 */
export const TEAM_COLORS = {
  IST: ["#0A3B7C", "#9EC1E6"], // Anadolu Efes — navy
  MIL: ["#D7141A", "#1a1a1a"], // Olimpia Milano — red
  BES: ["#1a1a1a", "#B5B5B5"], // Besiktas — black
  RED: ["#D81E2A", "#1a1a1a"], // Crvena Zvezda — red
  DUB: ["#0C2D57", "#C9A227"], // Dubai — navy
  BAR: ["#A50044", "#004D98"], // Barcelona — blaugrana
  MUN: ["#DC052D", "#0066B2"], // Bayern — red
  ULK: ["#0C2B5B", "#F2C300"], // Fenerbahce — navy
  HTA: ["#D1202A", "#1a1a1a"], // Hapoel Tel Aviv — red
  BAS: ["#1F4E9C", "#D71920"], // Baskonia — blue
  ASV: ["#5E9A2A", "#1a1a1a"], // ASVEL — green (brand lime darkened)
  TEL: ["#1E4AA8", "#F2C300"], // Maccabi — blue (yellow washes out)
  OLY: ["#D7141A", "#1a1a1a"], // Olympiacos — red
  PAN: ["#0A7A3A", "#1a1a1a"], // Panathinaikos — green
  PRS: ["#1a1a1a", "#B9A77A"], // Paris — black
  PAR: ["#1a1a1a", "#8A8A8A"], // Partizan — black
  MAD: ["#1C3D8A", "#FEBE10"], // Real Madrid — navy
  PAM: ["#E8701A", "#1a1a1a"], // Valencia — orange
  VIR: ["#1a1a1a", "#B5B5B5"], // Virtus Bologna — black
  ZAL: ["#0C8B3F", "#1a1a1a"], // Zalgiris — green
};

/** Filled from meta.json at startup (code → full club name). */
export const TEAM_NAMES = {};
export const TEAM_SHORT = {};

export function setTeamNames(clubs) {
  for (const c of clubs) {
    TEAM_NAMES[c.code] = c.name;
    TEAM_SHORT[c.code] = c.short || c.name;
  }
}
