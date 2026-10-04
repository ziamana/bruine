import { readAvailableSkills } from "../setup/skills.js";

/** The skills a web page or an interface is built with: how it is designed, and how it feels. */
export const UI_SKILLS = ["impeccable", "make-interfaces-feel-better"] as const;

/**
 * Words that say the task is a web page or an interface. It leans inclusive: a false match costs
 * two skill loads the model may skip (the reminder is conditional), a miss costs a plain-looking
 * page. "interface" alone is left out because it is also a TypeScript keyword.
 */
const WEB_TASK =
  /\b(?:sites?(?:\s+(?:web|internet))?|web\s?sites?|web\s?apps?|landing(?:\s+page)?|home\s?page|page\s+(?:web|d['’]accueil)|front[- ]?end|dashboard|tableau\s+de\s+bord|html|css|tailwind|maquette|mock-?ups?|portfolio|boutique(?:\s+en\s+ligne)?|e-?commerce|interface\s+(?:utilisateur|graphique|web)|user\s+interface|ui|ux|gui|web\s+design|design\s+system|re-?design)\b/i;

/** Whether a prompt asks for a web page or an interface. */
export function isUiTask(text: string): boolean {
  return WEB_TASK.test(text);
}

/**
 * The reminder that goes after such a prompt, naming the skills that are installed. The catalogue
 * the model already has only says "load a skill when the task clearly matches", and a model
 * skips that; this names the two and says to load them before any code. It is conditional, so a
 * false match does no harm. Undefined when it does not apply.
 */
export function uiSkillsHint(text: string, available: readonly string[]): string | undefined {
  if (!isUiTask(text)) return undefined;
  const names = UI_SKILLS.filter((name) => available.includes(name));
  if (names.length === 0) return undefined;
  const list = names.map((name) => `\`${name}\``).join(" and ");
  return [
    "<system-reminder>",
    `If this task builds or changes a web page, a site or an interface: call the \`skill\` tool for ${list} first, read what they say, and apply it to the design and the details. Do this before writing any code.`,
    "Where the page needs pictures, draw them yourself as detailed inline SVG with depth, light, shadow and texture; never grey boxes, emoji or placeholders.",
    "When the user asks for a complete or professional site, plan all of it first with todo_write: every page a real site of that kind has, and for each page the features people expect (a shop: a home with many sections, a catalogue with filters, sort and search, a product page, a cart, a checkout, an account, a journal, legal pages, a 404 and a contact page). Build all of it. A first version that works is not the end: go through the pages again to add detail, content and polish.",
    "Invent the brand name and the content for the business the user describes. The name of the working folder or of this tool is not the brand.",
    "Before you say it is done, open every page in the browser at desktop and at phone width, look at the screenshots, and fix whatever is cut off, overlapping, low in contrast or empty.",
    "</system-reminder>",
  ].join("\n");
}

/** A prompt's content with the reminder after it, when it applies. */
export function withUiSkillsHint<T extends { type: "text"; text: string } | { type: string }>(
  text: string,
  parts: T[],
  available: readonly string[],
): Array<T | { type: "text"; text: string }> {
  const hint = uiSkillsHint(text, available);
  return hint === undefined ? parts : [...parts, { type: "text", text: hint }];
}

/** The names of the skills this session can load. */
export async function availableSkillNames(homeSkillsDir: string, cwd: string): Promise<string[]> {
  try {
    return (await readAvailableSkills(homeSkillsDir, cwd)).map((skill) => skill.name);
  } catch {
    return [];
  }
}

/** The reminder block, so a transcript can show the prompt without it. */
export function stripReminders(text: string): string {
  return text.replace(/\s*<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "\n").trim();
}
