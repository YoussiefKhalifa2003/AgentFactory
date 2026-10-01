export type BodyType = "slim" | "regular" | "broad";
export type HeadShape = "round" | "oval" | "square";
export type HairStyle = "short" | "wavy" | "bun" | "undercut" | "long" | "fade" | "curly" | "none";
export type EyeShape = "round" | "almond" | "narrow" | "wide" | "sleepy";
export type BrowStyle = "straight" | "arch" | "thick";
export type MouthStyle = "smile" | "neutral" | "smirk";
export type Outfit = "hoodie" | "blazer" | "apron" | "lab" | "cardigan" | "tee";
export type Accessory = "glasses" | "headphones" | "cap" | "scarf" | "none";

export type AgentLook = {
  body: BodyType;
  head: HeadShape;
  skin: string;
  hair: HairStyle;
  hairColor: string;
  eyes: EyeShape;
  brows: BrowStyle;
  mouth: MouthStyle;
  outfit: Outfit;
  accessory: Accessory;
};

export const SKINS = ["#f6d0b0", "#f0c4a0", "#e8b896", "#d9a07e", "#f3dcc8", "#e2b089", "#d4ae8c", "#f0d5c0"];
export const HAIR_COLORS = ["#c47a4a", "#8b5a32", "#d4a017", "#6b4a8a", "#c45c2c", "#d8b48a", "#5c7a62", "#4a6b8a"];
export const BODIES: BodyType[] = ["slim", "regular", "broad"];
export const HEADS: HeadShape[] = ["round", "oval", "square"];
export const HAIRS: HairStyle[] = ["short", "wavy", "bun", "undercut", "long", "fade", "curly", "none"];
export const EYES: EyeShape[] = ["round", "almond", "narrow", "wide", "sleepy"];
export const BROWS: BrowStyle[] = ["straight", "arch", "thick"];
export const MOUTHS: MouthStyle[] = ["smile", "neutral", "smirk"];
export const OUTFITS: Outfit[] = ["hoodie", "blazer", "apron", "lab", "cardigan", "tee"];
export const ACCESSORIES: Accessory[] = ["none", "glasses", "headphones", "cap", "scarf"];

function hashName(name: string) {
  let h = 2166136261;
  for (const ch of name.toLowerCase()) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(list: T[], n: number) {
  return list[n % list.length];
}

export function lookFromName(name: string, pigment?: string): AgentLook {
  const h = hashName(name || "agent");
  return {
    body: pick(BODIES, h),
    head: pick(HEADS, h >>> 3),
    skin: pick(SKINS, h >>> 5),
    hair: pick(HAIRS, h >>> 7),
    hairColor: pigment || pick(HAIR_COLORS, h >>> 9),
    eyes: pick(EYES, h >>> 11),
    brows: pick(BROWS, h >>> 13),
    mouth: pick(MOUTHS, h >>> 15),
    outfit: pick(OUTFITS, h >>> 17),
    accessory: pick(ACCESSORIES, h >>> 19),
  };
}

export function randomLook(seed?: number): AgentLook {
  const n = seed ?? Math.floor(Math.random() * 0xffffffff);
  return lookFromName(`rand-${n}`);
}

export function parseLook(raw: unknown, name = "agent", pigment?: string): AgentLook {
  const fallback = lookFromName(name, pigment);
  if (!raw || typeof raw !== "object") return fallback;
  const row = raw as Partial<AgentLook>;
  return {
    body: BODIES.includes(row.body as BodyType) ? (row.body as BodyType) : fallback.body,
    head: HEADS.includes(row.head as HeadShape) ? (row.head as HeadShape) : fallback.head,
    skin: typeof row.skin === "string" ? row.skin : fallback.skin,
    hair: HAIRS.includes(row.hair as HairStyle) ? (row.hair as HairStyle) : fallback.hair,
    hairColor: typeof row.hairColor === "string" ? row.hairColor : fallback.hairColor,
    eyes: EYES.includes(row.eyes as EyeShape) ? (row.eyes as EyeShape) : fallback.eyes,
    brows: BROWS.includes(row.brows as BrowStyle) ? (row.brows as BrowStyle) : fallback.brows,
    mouth: MOUTHS.includes(row.mouth as MouthStyle) ? (row.mouth as MouthStyle) : fallback.mouth,
    outfit: OUTFITS.includes(row.outfit as Outfit) ? (row.outfit as Outfit) : fallback.outfit,
    accessory: ACCESSORIES.includes(row.accessory as Accessory)
      ? (row.accessory as Accessory)
      : fallback.accessory,
  };
}

export function lookSvg(look: AgentLook, pigment: string, size = 256) {
  const skin = "#f6d0b0";
  const hair =
    look.hair === "none" ? "" : `<ellipse cx="128" cy="90" rx="70" ry="34" fill="${pigment}"/>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
    <rect width="256" height="256" rx="64" fill="color-mix(in srgb, ${pigment} 16%, #fff7ee)"/>
    <ellipse cx="128" cy="232" rx="86" ry="40" fill="${pigment}"/>
    <circle cx="128" cy="130" r="66" fill="${skin}"/>
    ${hair}
  </svg>`)}`;
}

export function portraitFor(agent: { name: string; pigment: string; pfp?: string | null; look?: unknown }, apiUrl?: string) {
  if (agent.pfp) {
    if (agent.pfp.startsWith("http") || agent.pfp.startsWith("data:")) return agent.pfp;
    return `${apiUrl || ""}${agent.pfp}`;
  }
  return lookSvg(parseLook(agent.look, agent.name, agent.pigment), agent.pigment);
}

