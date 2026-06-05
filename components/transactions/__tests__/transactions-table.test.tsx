import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import type { TxnListItem } from "@/lib/repos/transactions";

vi.mock("@/app/(app)/transactions/actions", () => ({
  correctCategory: vi.fn(async () => ({ ok: true })),
  deleteTransactions: vi.fn(async () => ({ ok: true, deleted: 2 })),
}));

import { deleteTransactions } from "@/app/(app)/transactions/actions";

afterEach(() => vi.clearAllMocks());

function row(over: Partial<TxnListItem> = {}): TxnListItem {
  return {
    id: "t1",
    bookedAt: "2026-05-10",
    amountMinor: -1500,
    currency: "PLN",
    merchant: "BIEDRONKA",
    rawDescription: "BIEDRONKA 123",
    category: "Groceries",
    categorySource: "rule",
    aiConfidence: null,
    ...over,
  };
}

const ROWS: TxnListItem[] = [
  row({ id: "t1", merchant: "BIEDRONKA" }),
  row({ id: "t2", merchant: "MPK" }),
];

const PROPS = { categories: ["Groceries", "Transport"], categoryColors: {} };

describe("TransactionsTable bulk delete", () => {
  it("select-all toggles every row and shows the count", () => {
    render(<TransactionsTable rows={ROWS} {...PROPS} />);
    fireEvent.click(screen.getByLabelText(/select all transactions/i));
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();
  });

  it("selecting a single row shows the action bar with a count of 1", () => {
    render(<TransactionsTable rows={ROWS} {...PROPS} />);
    fireEvent.click(screen.getByLabelText(/select transaction BIEDRONKA/i));
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument();
  });

  it("confirming a delete calls the server action with the selected ids", async () => {
    render(<TransactionsTable rows={ROWS} {...PROPS} />);
    fireEvent.click(screen.getByLabelText(/select all transactions/i));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
    await waitFor(() =>
      expect(deleteTransactions).toHaveBeenCalledWith({ ids: ["t1", "t2"] }),
    );
  });

  it("prunes the action bar when selected rows disappear from the rows prop (stale revalidation)", () => {
    const { rerender } = render(<TransactionsTable rows={ROWS} {...PROPS} />);
    fireEvent.click(screen.getByLabelText(/select all transactions/i));
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();

    // Revalidation removes one of the selected rows; its id lingers in selectedIds.
    rerender(<TransactionsTable rows={[row({ id: "t2", merchant: "MPK" })]} {...PROPS} />);
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument();

    // All selected rows gone → bar disappears entirely.
    rerender(<TransactionsTable rows={[row({ id: "t3", merchant: "NEW" })]} {...PROPS} />);
    expect(screen.queryByText(/selected/i)).not.toBeInTheDocument();
  });
});
