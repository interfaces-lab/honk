import { EnvironmentId } from "@honk/shared/environment";
import { ProjectId } from "@honk/shared/base-schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PROJECT_KEY,
  readStoredProjectCwd,
  readStoredProjectSelection,
  writeStoredProjectSelection,
} from "./project-state";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function stubBrowserStorage(localStorage = new MemoryStorage()) {
  const eventTarget = new EventTarget();
  vi.stubGlobal("window", {
    localStorage,
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
  });
  vi.stubGlobal(
    "CustomEvent",
    class TestCustomEvent extends Event {
      constructor(type: string) {
        super(type);
      }
    },
  );
  return localStorage;
}

const environmentId = EnvironmentId.make("environment:selected-project");
const projectId = ProjectId.make("project:selected");

describe("project-state", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores selected project identity and mirrors cwd for cwd-only startup fallback", () => {
    const localStorage = stubBrowserStorage();
    localStorage.setItem(PROJECT_KEY, "/fallback-cwd");

    writeStoredProjectSelection({
      environmentId,
      projectId,
      cwd: "/selected",
    });

    expect(readStoredProjectSelection()).toEqual({
      environmentId,
      projectId,
      cwd: "/selected",
    });
    expect(readStoredProjectCwd()).toBe("/selected");
  });

  it("falls back to cwd-only stored project state", () => {
    const localStorage = stubBrowserStorage();
    localStorage.setItem(PROJECT_KEY, "/fallback-cwd");

    expect(readStoredProjectSelection()).toBeNull();
    expect(readStoredProjectCwd()).toBe("/fallback-cwd");
  });
});
