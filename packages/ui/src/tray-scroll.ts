type ScrollEdges = {
  readonly startOpacity: number;
  readonly endOpacity: number;
};

const INITIAL_SCROLL_EDGES: ScrollEdges = Object.freeze({
  startOpacity: 0,
  endOpacity: 0,
});

// The tray reaches full edge emphasis over the first or last 24px of its scroll range.
const EDGE_FADE_DISTANCE_PX = 24;
const SCROLL_EDGE_EPSILON = 1;

function trayScrollEdges(scrollTop: number, maxScroll: number): ScrollEdges {
  if (maxScroll <= SCROLL_EDGE_EPSILON) return INITIAL_SCROLL_EDGES;
  return {
    startOpacity: Math.min(1, Math.max(0, scrollTop) / EDGE_FADE_DISTANCE_PX),
    endOpacity: Math.min(1, Math.max(0, maxScroll - scrollTop) / EDGE_FADE_DISTANCE_PX),
  };
}

export { INITIAL_SCROLL_EDGES, trayScrollEdges };
export type { ScrollEdges };
