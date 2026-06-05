import { describe, it, expect } from "vitest";
import { ChartJS } from "@/components/charts/chart-setup";

// Importing chart-setup must register the controllers our charts rely on. Without these,
// <Chart type="bar"> / <Doughnut> throw "'<type>' is not a registered controller" at runtime
// in the browser — a failure neither SSR (canvas-only) nor a mocked react-chartjs-2 test catches.
describe("chart-setup registration", () => {
  it.each(["bar", "line", "doughnut"])("registers the %s controller", (type) => {
    expect(() => ChartJS.registry.getController(type)).not.toThrow();
  });
});
