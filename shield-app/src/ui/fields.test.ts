import { describe, expect, it } from "vitest";
import { EMAIL_ATTRS, passwordField } from "./fields";

describe("password field", () => {
  it("is masked to start with, and carries a SHOW button tied to the input", () => {
    const html = passwordField("pw", "current-password");
    expect(html).toContain('id="pw" type="password"');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain('data-pw-toggle="pw"');
    expect(html).toContain('aria-controls="pw"');
    expect(html).toContain(">SHOW<");
  });

  it("asks the keyboard not to capitalise or correct", () => {
    expect(EMAIL_ATTRS).toContain('autocapitalize="none"');
    expect(EMAIL_ATTRS).toContain('autocorrect="off"');
    expect(passwordField("pw", "new-password")).toContain('autocorrect="off"');
  });

  it("escapes the id", () => {
    expect(passwordField('a"b', "new-password")).not.toContain('id="a"b"');
  });
});
