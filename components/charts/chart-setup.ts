"use client";

// Register the Chart.js pieces our charts use, once per client bundle. Chart components
// import this module for its side effect (ES-module singleton) so registration can't double-run.
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Tooltip, Legend);

export { ChartJS };
