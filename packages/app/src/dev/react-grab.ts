import { init, type ReactGrabAPI } from "react-grab/core";

declare global {
  interface Window {
    __REACT_GRAB__?: ReactGrabAPI;
  }
}

if (import.meta.env.DEV && typeof window !== "undefined" && !window.__REACT_GRAB__) {
  window.__REACT_GRAB__ = init();
  window.dispatchEvent(new CustomEvent("react-grab:init", { detail: window.__REACT_GRAB__ }));
}
