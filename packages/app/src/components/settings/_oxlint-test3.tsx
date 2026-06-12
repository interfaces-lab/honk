import { Text } from "@honk/multikit/text";

const TEXT_SPAN_RENDER = <span />;

function TestText() {
  return (
    <Text render={TEXT_SPAN_RENDER} size="xs">
      hello
    </Text>
  );
}
