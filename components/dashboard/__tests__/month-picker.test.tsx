import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DashboardMonthPicker } from "@/components/dashboard/month-picker";

const push = vi.fn();
let search = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(search),
}));

beforeEach(() => {
  push.mockClear();
  search = "";
});

describe("DashboardMonthPicker", () => {
  it("renders a friendly label per month and reflects the selected value", () => {
    render(<DashboardMonthPicker months={["2026-06", "2026-05"]} selected="2026-05" />);
    expect(screen.getByRole("option", { name: /june 2026/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/dashboard month/i)).toHaveValue("2026-05");
  });

  it("pushes ?month= when a different month is chosen", () => {
    render(<DashboardMonthPicker months={["2026-06", "2026-05"]} selected="2026-06" />);
    fireEvent.change(screen.getByLabelText(/dashboard month/i), { target: { value: "2026-05" } });
    expect(push).toHaveBeenCalledWith(expect.stringContaining("month=2026-05"));
  });

  it("preserves other existing query params when the month changes", () => {
    search = "foo=bar&month=2026-06";
    render(<DashboardMonthPicker months={["2026-06", "2026-05"]} selected="2026-06" />);
    fireEvent.change(screen.getByLabelText(/dashboard month/i), { target: { value: "2026-05" } });
    const url = push.mock.calls[0][0] as string;
    expect(url).toContain("foo=bar");
    expect(url).toContain("month=2026-05");
    expect(url).not.toContain("month=2026-06"); // the old month value is replaced, not appended
  });
});
