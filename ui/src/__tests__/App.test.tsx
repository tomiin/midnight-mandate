import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { App } from "../App";

describe("App", () => {
  it("renders without crashing", () => {
    render(<App />);
    expect(screen.getByText("Mandate")).toBeInTheDocument();
  });

  it("shows connect wallet button when disconnected", () => {
    render(<App />);
    expect(screen.getByText("Connect wallet")).toBeInTheDocument();
  });
});
