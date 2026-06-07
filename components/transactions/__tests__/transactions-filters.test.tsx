import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TransactionsFilters } from "@/components/transactions/transactions-filters";

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

describe("TransactionsFilters month filter", () => {
  it("renders 'All months' plus a friendly label per month with data", () => {
    render(<TransactionsFilters categories={["Groceries"]} months={["2026-06", "2026-05"]} />);
    expect(screen.getByRole("option", { name: /all months/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /june 2026/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /may 2026/i })).toBeInTheDocument();
  });

  it("pushes ?month= when a month is chosen", () => {
    render(<TransactionsFilters categories={[]} months={["2026-06"]} />);
    fireEvent.change(screen.getByLabelText(/filter by month/i), { target: { value: "2026-06" } });
    expect(push).toHaveBeenCalledWith(expect.stringContaining("month=2026-06"));
  });

  it("clears the month param when 'All months' is reselected", () => {
    search = "month=2026-06";
    render(<TransactionsFilters categories={[]} months={["2026-06"]} />);
    fireEvent.change(screen.getByLabelText(/filter by month/i), { target: { value: "" } });
    expect(push).toHaveBeenCalledWith(expect.not.stringContaining("month="));
  });
});
