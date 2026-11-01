export type Pos = "SPR" | "DIS" | "FLD";

export type SeedAthlete = {
  id: string;
  name: string;
  gender: "B" | "G";
  positions: Pos[];
  flex: boolean;
  note: string;
  rank: number;
};

/** Lowercase, strip diacritics and every non-alphanumeric character. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const TYPED = `Aiden FitzHarris|Sprinter|Boys
Aiden Jean-Marie|Sprinter|Boys
Madeline Larkin|Sprinter/Distance|Girls
Michael Carey|Distance|Boys
Allyson Fanning|Sprinter|Girls
Amelia Hoyt|Flex|Girls
Benjamin Bellamy|Sprinter|Boys
Ben Cabrera|Distance|Boys
Beya Salerno|Flex|Boys
Bobby Lynch|Sprinter|Boys
Camila Taverez|Flex|Girls
Carson Powell|Sprinter|Boys
Cecilia Cruz|Field|Girls
Charlotte Ruffener|Distance|Girls
Claire Creech|Sprinter|Girls
Colin Lewis|Distance|Boys
Connor Scully|Distance|Boys
Daniel Berger|Distance|Boys
Daniel Dratch|Distance|Boys
Daniel Zvonik|Flex|Boys
Diyar Thabit|Flex|Boys
Dominic Segars|Flex|Boys
Donovan Mansano|Flex|Boys
Dylan Diaz|Sprinter|Boys
Eddy Goodglass|Distance|Boys
Emily Rostanazo|Distance|Girls
Emma Doyle|Field (thrower)|Girls
Ethan Lopez|Distance|Boys
Ethan Ureña-Barbosa|Field (thrower)|Boys
Finnian Dill|Distance|Boys
Gabby Abreu|Sprinter|Girls
Grace Otto|Distance|Girls
Heaven Somuah|Flex|Girls
Himavanth Mypati|Flex|Boys
Hudson Alarcon|Distance|Boys
Isabella Fisher|Distance|Girls
Jack Baxter|Field (thrower)|Boys
James Chowanski|Sprinter|Boys
Jasmine Urena|Sprinter|Girls
Jason Porter|Flex|Boys
Jeff Dong|Sprinter|Boys
John Dillon|Flex|Boys
Josh Oppong|Flex|Boys
Justin Alexis|Distance|Boys
Kaiel Johnson|Flex|Boys
Kaitlyn Hartwig|Distance|Girls
Kalliope Enos|Flex|Girls
Kassandra Enos|Distance|Girls
Kelly Carey|Sprinter|Girls
Kingston Allen|Distance|Boys
Leah Jones|Distance|Girls
Leona Cushna|Distance|Girls
Liah Marcella|Flex|Girls
Lila Cabrera|Distance|Girls
Logan Kelly|Flex|Boys
Luke Potter|Distance|Boys
Lydia Semo|Flex|Girls
Macie Stermer|Flex|Girls
Madison Gargiulo|Flex|Girls
Marc Henke|Sprinter|Boys
Matthew Brischoux|Distance|Boys
Michael McCafferty|Distance|Boys
MJ Ihim|Field (thrower)|Boys
Noah Padilla|Distance|Boys
Noemi Goitia|Distance|Girls
Owen Vallinino|Flex|Boys
Quetzi Juarez|Flex|Girls
Ava Liebert|Distance|Girls
Rishith Muthabathula|Field (thrower)|Boys
Samery De los Santos|Flex|Girls
Sky Appleton|Distance|Girls
Sophia Kababik|Flex|Girls
Sophia Sterling|Flex|Girls
Tai Zhang|Field (thrower)|Boys
Tyler Henriquez|Flex|Boys
Yael Perez|Sprinter|Girls
Zion Felix|Sprinter|Boys`;

const SCREENSHOT_BOYS = `Abubakar Diallo, Aiden Schultze, Albert Kirienko, Alex Clayton, Andrew Cummiskey, Anthony Czumack, Antonio Bulusan, Avaneesh Nanjappa, Ayonitemi Adebayo, Ben Huang, Benjamin Miller, Braden Work, Brandon Lee, Brayden Forsstrom, Brayden Peck, Carter Talkowski, Cash McLendon, Christian Cibirka, Colin Greene, Colin Veit, Daniel Cibirka, David Holloway, Desmond Hunt, Evan Davis, Gabriel Colsant, Ilunga Salerno, Jack Ferrara, Jackson Howell, James McGuirk, Jayce Borg, Jayden Scott, Jovan Naranjo, Justen Tolbert, Mason Cotton, Matthew Argenio, Matthew DeLoughery, Matthew Finn, Matthew Lee, Mitchell Stewart, Oliver Grammerstorf, Owen Wissner, Quinn Petrose, Ryan Mauer, Sam Louis, Spencer Olsen, Vero Lambert, Will Bengyak`;

const SCREENSHOT_GIRLS = `Alina Scheiman, Anderson Farina, Callie Laudato, Catherine Larkin, D'Amour McNeil, Ella Hessari, Faith Caoili, Jingwa Fonkem, Jorie Greene, Karlee King, Madeline VanDerHeide, Madison Riccardi, Maia Blacksmith, Makenzie Bencivengo, Marisa Barnsby, Melody Vergara, Naomi Locy, Olivia Cibirka, Patricia King, Rachel Schwartz, Rosie Kelly, Sadie Steiner, Shea Fern, Sofia Sabin, Stephanie Ryabov, Victoria Weber, Violet Pruitt`;

const ALL: Pos[] = ["SPR", "DIS", "FLD"];

function parsePositions(raw: string): { positions: Pos[]; flex: boolean; note: string } {
  const lower = raw.toLowerCase();
  if (lower.includes("flex")) return { positions: [...ALL], flex: true, note: "" };
  const positions: Pos[] = [];
  if (lower.includes("sprint")) positions.push("SPR");
  if (lower.includes("distance")) positions.push("DIS");
  if (lower.includes("field")) positions.push("FLD");
  if (positions.length === 0) return { positions: [...ALL], flex: true, note: "" };
  return { positions, flex: false, note: lower.includes("thrower") ? "Thrower" : "" };
}

/** Builds the deduped athlete pool. Explicitly typed positions win over screenshot defaults (Flex). */
export function seedAthletes(): SeedAthlete[] {
  const byId = new Map<string, SeedAthlete>();
  let rank = 0;
  for (const line of TYPED.split("\n")) {
    const [name, pos, gender] = line.split("|").map((s) => s.trim());
    if (!name) continue;
    const id = normalizeName(name);
    const parsed = parsePositions(pos ?? "Flex");
    byId.set(id, { id, name, gender: gender === "Girls" ? "G" : "B", ...parsed, rank: rank++ });
  }
  const addDefault = (list: string, gender: "B" | "G") => {
    for (const raw of list.split(",")) {
      const name = raw.trim();
      if (!name) continue;
      const id = normalizeName(name);
      if (byId.has(id)) continue;
      byId.set(id, { id, name, gender, positions: [...ALL], flex: true, note: "", rank: rank++ });
    }
  };
  addDefault(SCREENSHOT_BOYS, "B");
  addDefault(SCREENSHOT_GIRLS, "G");
  return [...byId.values()];
}
