import { useState } from "react";
import { WelcomeCard } from "./components/WelcomeCard.jsx";

export function App() {
  const [count, setCount] = useState(0);

  return (
    <main>
      <h1>React Review AI Demo</h1>
      <WelcomeCard title="Read-only React review" />
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Review interactions: {count}
      </button>
      <img src="/demo-logo.svg" />
    </main>
  );
}
