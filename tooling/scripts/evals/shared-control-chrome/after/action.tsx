import { Button } from "@honk/ui/button";

export function Action({ onRun }: { onRun: () => void }) {
  return <Button onClick={onRun}>Run</Button>;
}
