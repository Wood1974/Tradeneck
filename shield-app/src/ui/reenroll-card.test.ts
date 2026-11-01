import { describe, expect, it } from "vitest";
import { reenrollCardHtml, reenrollDone } from "./reenroll-card";

describe("the enrol-again card", () => {
  it("is not offered in a browser or when signed out", () => {
    expect(reenrollCardHtml()).toBe("");
  });
  it("says the key is the new one and shortens its id", () => {
    const text = reenrollDone("abcdefghijklmnop");
    expect(text).toContain("accepted Apple's proof for the new key (abcdefgh…)");
    expect(text).toContain("from now on");
  });
});
