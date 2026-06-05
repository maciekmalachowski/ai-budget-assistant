"use client";

// Register the Chart.js pieces our charts use, once per client bundle. Chart components
// import this module for its side effect (ES-module singleton) so registration can't double-run.
// Chart.js v4 is tree-shakeable: the *controllers* (Bar/Line/Doughnut) must be registered, not
// just the elements — using <Chart type="bar"> / <Doughnut> without them throws at runtime
// ("'bar' is not a registered controller").
import {
  Chart as ChartJS,
  BarController,
  LineController,
  DoughnutController,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(
  BarController,
  LineController,
  DoughnutController,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Tooltip,
  Legend,
);

export { ChartJS };
