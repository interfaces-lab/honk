export function Action({ onRun }: { onRun: () => void }) {
  return <button onClick={onRun}>Run</button>;
}
