import { Text } from "@multi/ui/text";

const TEXT_SPAN_RENDER = <span />;

function TestText() {
  return (
    <Text render={TEXT_SPAN_RENDER} size="xs">
      hello
    </Text>
  );
}
