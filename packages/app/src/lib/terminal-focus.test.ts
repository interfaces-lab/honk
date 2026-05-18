import { afterEach, describe, expect, it } from "vitest";

import { isTerminalFocused } from "./terminal-focus";

class MockHTMLElement {
  isConnected = false;
  className = "";
  closestSelector: string | null = null;

  readonly classList = {
    contains: (value: string) => this.className.split(/\s+/).includes(value),
  };

  closest(selector: string): MockHTMLElement | null {
    return selector === this.closestSelector && this.isConnected ? this : null;
  }
}

const originalDocument = globalThis.document;
const originalHTMLElement = globalThis.HTMLElement;

function setActiveElement(activeElement: MockHTMLElement) {
  globalThis.HTMLElement = MockHTMLElement as unknown as typeof HTMLElement;
  globalThis.document = { activeElement } as unknown as Document;
}

afterEach(() => {
  if (originalDocument === undefined) {
    delete (globalThis as { document?: Document }).document;
  } else {
    globalThis.document = originalDocument;
  }

  if (originalHTMLElement === undefined) {
    delete (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement;
  } else {
    globalThis.HTMLElement = originalHTMLElement;
  }
});

describe("isTerminalFocused", () => {
  it("returns false for detached xterm helper textareas", () => {
    const detached = new MockHTMLElement();
    detached.className = "xterm-helper-textarea";

    setActiveElement(detached);

    expect(isTerminalFocused()).toBe(false);
  });

  it("returns true for connected xterm helper textareas", () => {
    const attached = new MockHTMLElement();
    attached.className = "xterm-helper-textarea";
    attached.isConnected = true;

    setActiveElement(attached);

    expect(isTerminalFocused()).toBe(true);
  });

  it("returns true for connected elements inside any xterm viewport", () => {
    const activeElement = new MockHTMLElement();
    activeElement.isConnected = true;
    activeElement.closestSelector = ".xterm";

    setActiveElement(activeElement);

    expect(isTerminalFocused()).toBe(true);
  });

  it("returns false for connected non-terminal elements", () => {
    const activeElement = new MockHTMLElement();
    activeElement.isConnected = true;

    setActiveElement(activeElement);

    expect(isTerminalFocused()).toBe(false);
  });
});
