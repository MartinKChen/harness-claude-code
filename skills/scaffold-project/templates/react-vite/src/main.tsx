import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found — check index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <main>
      <h1>App</h1>
    </main>
  </StrictMode>,
);
