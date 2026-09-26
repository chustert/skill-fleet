/**
 * Terminal questions for the installer, built on node:readline so the package
 * has no dependencies. The checkbox's key handling is a pure function,
 * checkboxReducer, so it can be tested without a terminal.
 */

import readline from "node:readline";

const color = (code) => (text) =>
  process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${text}\x1b[0m` : text;
export const bold = color("1");
export const dim = color("2");
export const cyan = color("36");
export const green = color("32");
export const yellow = color("33");

/**
 * Apply one key press to the checkbox state { cursor, checked, done, cancelled }.
 * Arrows or j and k move, space toggles, a toggles every choice, enter
 * confirms, and Ctrl+C or Escape cancels.
 */
export function checkboxReducer(state, key, count) {
  const next = { ...state, checked: [...state.checked] };
  switch (key.name) {
    case "up":
    case "k":
      next.cursor = (state.cursor - 1 + count) % count;
      break;
    case "down":
    case "j":
      next.cursor = (state.cursor + 1) % count;
      break;
    case "space":
      next.checked[state.cursor] = !state.checked[state.cursor];
      break;
    case "a": {
      const all = state.checked.every(Boolean);
      next.checked = next.checked.map(() => !all);
      break;
    }
    case "return":
    case "enter":
      next.done = true;
      break;
    case "escape":
      next.cancelled = true;
      break;
    case "c":
      if (key.ctrl) next.cancelled = true;
      break;
    default:
      break;
  }
  return next;
}

export class CancelledError extends Error {
  constructor() {
    super("Cancelled. Nothing was written.");
  }
}

/** Ask the user to pick any number of choices. Resolves to the chosen values. */
export function checkbox({ message, choices, input = process.stdin, output = process.stdout }) {
  return new Promise((resolve, reject) => {
    let state = { cursor: 0, checked: choices.map((c) => Boolean(c.checked)), done: false, cancelled: false };
    let drawn = 0;
    const draw = () => {
      if (drawn) readline.moveCursor(output, 0, -drawn);
      readline.clearScreenDown(output);
      const lines = [`${bold("?")} ${message} ${dim("(space to toggle, enter to confirm)")}`];
      choices.forEach((choice, index) => {
        const pointer = index === state.cursor ? cyan("❯") : " ";
        const box = state.checked[index] ? green("◉") : "◯";
        const hint = choice.hint ? ` ${dim(choice.hint)}` : "";
        lines.push(`${pointer} ${box} ${choice.label}${hint}`);
      });
      output.write(lines.join("\n") + "\n");
      drawn = lines.length;
    };
    const finish = () => {
      input.off("keypress", onKey);
      if (input.isTTY) input.setRawMode(false);
      input.pause();
    };
    const onKey = (_text, key = {}) => {
      state = checkboxReducer(state, key, choices.length);
      if (state.cancelled) {
        finish();
        reject(new CancelledError());
        return;
      }
      draw();
      if (state.done) {
        finish();
        const chosen = choices.filter((_, index) => state.checked[index]);
        readline.moveCursor(output, 0, -drawn);
        readline.clearScreenDown(output);
        output.write(`${green("✔")} ${message} ${cyan(chosen.map((c) => c.label).join(", ") || "none")}\n`);
        resolve(chosen.map((c) => c.value));
      }
    };
    readline.emitKeypressEvents(input);
    if (input.isTTY) input.setRawMode(true);
    input.resume();
    input.on("keypress", onKey);
    draw();
  });
}

/** Ask a yes-or-no question. An empty answer takes the default. */
export async function confirm({ message, initial = true, input = process.stdin, output = process.stdout }) {
  const rl = readline.createInterface({ input, output });
  let cancelled = false;
  rl.on("SIGINT", () => {
    cancelled = true;
    rl.close();
  });
  try {
    const answer = await new Promise((resolve) => {
      rl.question(`${bold("?")} ${message} ${dim(initial ? "(Y/n)" : "(y/N)")} `, resolve);
      rl.on("close", () => resolve(null));
    });
    if (cancelled || answer === null) throw new CancelledError();
    const normalized = answer.trim().toLowerCase();
    if (!normalized) return initial;
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}
