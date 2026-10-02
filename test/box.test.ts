import { afterEach, expect, test } from "vitest";
import { SetupFrame } from "../src/setup/frame.js";
import { SetupCardPicker, SetupThemePicker } from "../src/setup/welcome.js";
import { QuestionForm } from "../src/ui/questions.js";
import { ASCII_ICONS, UNICODE_ICONS } from "../src/render/chars.js";
import { resetColorDepth } from "../src/ui/palette.js";
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; resetColorDepth(); });

for (const ascii of [false, true]) {
  test.each([100, 60, 30])(`shared box preserves ${ascii ? "ASCII" : "Unicode"} rendering at %i columns`, width => {
    process.env.KUMO_ASCII = ascii ? "1" : "0";
    process.env.LANG = "en_US.UTF-8";
    process.env.KUMO_COLOR = "basic";
    resetColorDepth();
    const frame = new SetupFrame("Models", { render: () => ["→ Local", "  Remote"], invalidate() {} }, { step: 1, help: "↑/↓ move · Enter select · Esc back", rows: () => 30 });
    const cards = new SetupCardPicker([{ value: "ask", label: "Ask", description: "Confirm every command and write." }, { value: "auto", label: "Auto", description: "Kumo decides; risky actions still ask.", recommended: true }], () => 30);
    cards.setSelectedIndex(1);
    const question = new QuestionForm([{ id: "cache", header: "review", question: "Which database should store the local cache?", options: [{ label: "SQLite", description: "Local storage without a service." }, { label: "Redis", description: "Shared storage with a server." }] }], ascii ? ASCII_ICONS : UNICODE_ICONS, "0.0.1");
    expect({ frame: frame.render(width), cards: cards.render(width), theme: new SetupThemePicker("dark").render(width), questions: question.render(width) }).toMatchSnapshot();
  });
}
