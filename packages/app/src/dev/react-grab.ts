import { init, type Options, type ReactGrabAPI } from "react-grab/core";

declare global {
  interface Window {
    __REACT_GRAB__?: ReactGrabAPI;
  }
}

const REACT_GRAB_OPTIONS: Options = {
  freezeReactUpdates: false,
  telemetry: false,
};

if (import.meta.env.DEV && typeof window !== "undefined" && !window.__REACT_GRAB__) {
  window.__REACT_GRAB__ = init(REACT_GRAB_OPTIONS);
  window.dispatchEvent(new CustomEvent("react-grab:init", { detail: window.__REACT_GRAB__ }));
}
