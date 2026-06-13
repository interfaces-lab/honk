import { useState } from "react";
export function Bad() {
  const [items, setItems] = useState([1, 2, 3]);
  const addItem = () => {
    items.push(4);
    setItems(items);
  };
  return <button onClick={addItem}>add</button>;
}
