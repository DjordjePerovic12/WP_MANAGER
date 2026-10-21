// League definitions for career mode.
//
// Our real data covers the clubs that play in the European cups, which is not a
// full domestic league anywhere except the Adriatic region. Other leagues are
// topped up with generated domestic clubs (fictional names and players).

export interface LeagueDef {
  id: string;
  name: string;
  /** IOC country codes of the real clubs that play in it */
  countries: string[];
  /** number of teams; generated clubs fill the gaps */
  size: number;
  /** names for generated clubs (fictional) */
  fillerNames: [string, string][];
  /** quality (average attribute level) of generated clubs: [weakest, strongest] */
  fillerQuality: [number, number];
}

export const LEAGUES: LeagueDef[] = [
  {
    id: 'adriatic',
    name: 'Adriatic League',
    countries: ['SRB', 'MNE', 'CRO', 'BIH'],
    size: 0, // every real club, no generated ones
    fillerNames: [],
    fillerQuality: [9, 11],
  },
  {
    id: 'ita',
    name: 'Italian Serie A1',
    countries: ['ITA'],
    size: 12,
    fillerNames: [['Aquila Lucana', 'AQL'], ['Tirreno Nuoto', 'TIR'], ['Delfini Adriatici', 'DAD'], ['Sirene di Sicilia', 'SDS'], ['Ponte Vecchio PN', 'PVE'], ['Lago Maggiore Nuoto', 'LMN']],
    fillerQuality: [9, 11.5],
  },
  {
    id: 'gre',
    name: 'Greek A1 Ethniki',
    countries: ['GRE'],
    size: 12,
    fillerNames: [['Aegean Tritons', 'AET'], ['Thessaloniki Waves', 'THW'], ['Ionian Dolphins', 'IOD'], ['Patras Nautical', 'PNA'], ['Cretan Sharks', 'CRS'], ['Piraeus Marina', 'PIM']],
    fillerQuality: [8.5, 11],
  },
  {
    id: 'esp',
    name: 'Spanish División de Honor',
    countries: ['ESP'],
    size: 12,
    fillerNames: [['Costa Brava WP', 'CBR'], ['Club Náutico Levante', 'CNL'], ['Mediterrània Sant Pol', 'MSP'], ['Bahía de Cádiz', 'BCA'], ['Meseta Castellana WP', 'MCA'], ['Galicia Atlántica', 'GAT'], ['Sevilla Guadalquivir', 'SGU']],
    fillerQuality: [8.5, 11],
  },
  {
    id: 'ger',
    name: 'German Wasserball-Liga',
    countries: ['GER'],
    size: 8,
    fillerNames: [['Hamburg Elbe WSV', 'HEW'], ['Rhein Wasserfreunde', 'RWF']],
    fillerQuality: [8.5, 10],
  },
  {
    id: 'hun',
    name: 'Hungarian OB I',
    countries: ['HUN'],
    size: 12,
    fillerNames: [['Duna Vízilabda', 'DUN'], ['Tisza Hullám', 'TIS'], ['Balaton Sirály', 'BAL'], ['Szeged Csillagok', 'SZC'], ['Debrecen Delfinek', 'DED'], ['Pécs Mecsek VSE', 'PEC'], ['Győr Rába VK', 'GYR'], ['Miskolc Avas', 'MIS'], ['Eger Vár VK', 'EGV']],
    fillerQuality: [10, 13],
  },
];
