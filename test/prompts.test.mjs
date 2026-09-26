import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, test } from "node:test";
import { checkbox, checkboxReducer, CancelledError, confirm } from "../lib/prompts.mjs";

const start = { cursor: 0, checked: [true, false, false], done: false, cancelled: false };

describe("checkbox keys", () => {
  test("arrows and j and k move and wrap", () => {
    assert.equal(checkboxReducer(start, { name: "down" }, 3).cursor, 1);
    assert.equal(checkboxReducer(start, { name: "k" }, 3).cursor, 2);
    assert.equal(checkboxReducer({ ...start, cursor: 2 }, { name: "j" }, 3).cursor, 0);
  });

  test("space toggles the current choice and a toggles all", () => {
    assert.deepEqual(checkboxReducer(start, { name: "space" }, 3).checked, [false, false, false]);
    assert.deepEqual(checkboxReducer(start, { name: "a" }, 3).checked, [true, true, true]);
    const all = { ...start, checked: [true, true, true] };
    assert.deepEqual(checkboxReducer(all, { name: "a" }, 3).checked, [false, false, false]);
  });

  test("enter confirms and Ctrl+C or Escape cancels", () => {
    assert.equal(checkboxReducer(start, { name: "return" }, 3).done, true);
    assert.equal(checkboxReducer(start, { name: "c", ctrl: true }, 3).cancelled, true);
    assert.equal(checkboxReducer(start, { name: "escape" }, 3).cancelled, true);
    assert.equal(checkboxReducer(start, { name: "c" }, 3).cancelled, false);
  });
});

describe("prompts over a stream", () => {
  const choices = [
    { label: "Claude Code", value: "claude", checked: true },
    { label: "Cursor", value: "cursor", checked: true },
    { label: "Kiro", value: "kiro", checked: false },
  ];

  test("the checkbox resolves to the chosen values", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const answer = checkbox({ message: "Tools?", choices, input, output });
    input.emit("keypress", "", { name: "down" });
    input.emit("keypress", " ", { name: "space" });
    input.emit("keypress", "", { name: "down" });
    input.emit("keypress", " ", { name: "space" });
    input.emit("keypress", "\r", { name: "return" });
    assert.deepEqual(await answer, ["claude", "kiro"]);
  });

  test("Ctrl+C cancels the checkbox", async () => {
    const input = new PassThrough();
    const answer = checkbox({ message: "Tools?", choices, input, output: new PassThrough() });
    input.emit("keypress", "", { name: "c", ctrl: true });
    await assert.rejects(answer, CancelledError);
  });

  test("confirm takes the default on an empty answer and reads y and n", async () => {
    for (const [typed, initial, expected] of [["\n", true, true], ["\n", false, false], ["y\n", false, true],
      ["no\n", true, false]]) {
      const input = new PassThrough();
      const answer = confirm({ message: "Go?", initial, input, output: new PassThrough() });
      input.write(typed);
      assert.equal(await answer, expected, JSON.stringify(typed));
    }
  });
});
