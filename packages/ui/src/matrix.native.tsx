import * as React from "react";
import { StyleSheet, View, useColorScheme, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { resolveNativeTheme } from "./theme";

const GRID_DEFAULT = 5;
const CELL_SIZE = 4;
const DOT_SIZE = 2;
const WORKING_DURATION_MS = 1_200;
const ATTENTION_DURATION_MS = 1_400;
const WORKING_PHASE_SPAN = 0.6;
const INACTIVE_OPACITY = 0.35;
const REDUCED_OPACITY = 0.55;
const ATTENTION_MASK_RADIUS = 1.125;
const ATTENTION_CORE_RADIUS = 0.275;
const ATTENTION_RING_RADIUS = 0.825;
const SAMPLE_COUNT = 16;

const SAMPLE_INPUT_RANGE = Array.from(
  { length: SAMPLE_COUNT + 1 },
  (_, index) => index / SAMPLE_COUNT,
);

const ATTENTION_OPACITY = {
  core: [
    0.35, 1, 1, 1, 1, 1, 1, 0.7135, 0.35, 0.7195, 0.8725, 0.7195, 0.35, 0.35, 0.35, 0.35, 0.35,
  ],
  ring: [
    0.16, 0.4995, 0.7131, 0.7376, 0.6, 0.5665, 0.4711, 0.3284, 0.16, 0.3311, 0.402, 0.3311, 0.16,
    0.16, 0.16, 0.16, 0.16,
  ],
  outer: [
    0.08, 0.1417, 0.1806, 0.185, 0.16, 0.1539, 0.1366, 0.1106, 0.08, 0.1111, 0.124, 0.1111, 0.08,
    0.08, 0.08, 0.08, 0.08,
  ],
} as const;

const ATTENTION_REST = {
  core: 0.35,
  ring: 0.16,
  outer: 0.08,
} as const;

const WORKING_OPACITY_STOPS = [
  [0, 0.2],
  [0.45, 0.88],
  [0.72, 0.42],
  [1, 0.2],
] as const;

const WORKING_SCALE_STOPS = [
  [0, 0.78],
  [0.45, 1],
  [0.72, 0.9],
  [1, 0.78],
] as const;

const layout = StyleSheet.create({
  root: {
    flexDirection: "row",
    flexShrink: 0,
    flexWrap: "wrap",
  },
  cell: {
    alignItems: "center",
    height: CELL_SIZE,
    justifyContent: "center",
    width: CELL_SIZE,
  },
  dot: {
    borderRadius: 999,
    height: DOT_SIZE,
    width: DOT_SIZE,
  },
});

type AttentionBand = "core" | "ring" | "outer";
type MatrixVariant = "working" | "attention";

interface MatrixProps {
  grid?: number;
  variant?: MatrixVariant;
  isActive?: boolean;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

function diagonalPath(index: number, grid: number): number {
  const row = Math.floor(index / grid);
  const col = index % grid;
  const maxPath = Math.max(1, (grid - 1) * 2);
  return (row + (grid - 1 - col)) / maxPath;
}

function attentionBand(index: number, grid: number): AttentionBand | null {
  const center = (grid - 1) / 2;
  const scale = Math.max(1, center);
  const row = Math.floor(index / grid);
  const col = index % grid;
  const radius = Math.hypot(col - center, row - center) / scale;
  if (radius > ATTENTION_MASK_RADIUS) return null;
  if (radius < ATTENTION_CORE_RADIUS) return "core";
  return radius < ATTENTION_RING_RADIUS ? "ring" : "outer";
}

function sampleStops(phase: number, stops: readonly (readonly [number, number])[]): number {
  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1];
    const next = stops[index];
    if (previous === undefined || next === undefined || phase > next[0]) continue;
    const span = next[0] - previous[0];
    const progress = span === 0 ? 0 : (phase - previous[0]) / span;
    return previous[1] + (next[1] - previous[1]) * progress;
  }
  return stops.at(-1)?.[1] ?? 1;
}

function shiftedSamples(path: number, stops: readonly (readonly [number, number])[]): number[] {
  const shift = path * WORKING_PHASE_SPAN;
  return SAMPLE_INPUT_RANGE.map((progress) => sampleStops((progress + shift) % 1, stops));
}

function MatrixDot({
  color,
  isAnimating,
  opacityRange,
  progress,
  restingOpacity,
  scaleRange,
}: {
  readonly color: string;
  readonly isAnimating: boolean;
  readonly opacityRange: readonly number[] | null;
  readonly progress: SharedValue<number>;
  readonly restingOpacity: number;
  readonly scaleRange: readonly number[] | null;
}): React.ReactElement {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity:
      isAnimating && opacityRange !== null
        ? interpolate(progress.value, SAMPLE_INPUT_RANGE, opacityRange)
        : restingOpacity,
    transform: [
      {
        scale:
          isAnimating && scaleRange !== null
            ? interpolate(progress.value, SAMPLE_INPUT_RANGE, scaleRange)
            : 1,
      },
    ],
  }));

  return <Animated.View style={[layout.dot, { backgroundColor: color }, animatedStyle]} />;
}

function Matrix({
  grid = GRID_DEFAULT,
  variant = "working",
  isActive = true,
  color,
  style,
}: MatrixProps): React.ReactElement {
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const theme = resolveNativeTheme(mode);
  const reducedMotion = useReducedMotion();
  const resolvedGrid = Math.max(1, Math.round(grid));
  const isAnimating = isActive && !reducedMotion;
  const resolvedColor = color ?? theme.colors.accent;
  const progress = useDerivedValue<number>(
    () =>
      isAnimating
        ? withRepeat(
            withTiming(1, {
              duration: variant === "attention" ? ATTENTION_DURATION_MS : WORKING_DURATION_MS,
              easing: Easing.linear,
              reduceMotion: ReduceMotion.System,
            }),
            -1,
            false,
            undefined,
            ReduceMotion.System,
          )
        : 0,
    [isAnimating, variant],
  );

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[
        layout.root,
        { height: resolvedGrid * CELL_SIZE, width: resolvedGrid * CELL_SIZE },
        style,
      ]}
    >
      {Array.from({ length: resolvedGrid * resolvedGrid }, (_, slot) => {
        const row = Math.floor(slot / resolvedGrid);
        const col = slot % resolvedGrid;
        const key = `matrix-${row}-${col}`;
        if (variant === "attention") {
          const band = attentionBand(slot, resolvedGrid);
          if (band === null) return <View key={key} style={layout.cell} />;
          return (
            <View key={key} style={layout.cell}>
              <MatrixDot
                color={resolvedColor}
                isAnimating={isAnimating}
                opacityRange={ATTENTION_OPACITY[band]}
                progress={progress}
                restingOpacity={ATTENTION_REST[band]}
                scaleRange={null}
              />
            </View>
          );
        }

        const path = diagonalPath(slot, resolvedGrid);
        return (
          <View key={key} style={layout.cell}>
            <MatrixDot
              color={resolvedColor}
              isAnimating={isAnimating}
              opacityRange={shiftedSamples(path, WORKING_OPACITY_STOPS)}
              progress={progress}
              restingOpacity={reducedMotion ? REDUCED_OPACITY : INACTIVE_OPACITY}
              scaleRange={shiftedSamples(path, WORKING_SCALE_STOPS)}
            />
          </View>
        );
      })}
    </View>
  );
}

export { Matrix };
export type { MatrixProps, MatrixVariant };
