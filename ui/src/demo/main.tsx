import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DemoApp } from "./DemoApp";
// Self-hosted, not Google Fonts: a privacy app shouldn't send every
// visitor's IP to a third party just to draw its headings.
import "@fontsource/archivo/400.css";
import "@fontsource/archivo/800.css";
import "../index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DemoApp />
  </StrictMode>,
);
