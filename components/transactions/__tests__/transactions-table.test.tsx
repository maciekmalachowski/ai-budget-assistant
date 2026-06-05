import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import type { TxnListItem } from "@/lib/repos/transactions";

vi.mock("@/app/(app)/transactions/actions", () => ({
  correctCategory: vi.fn(async () => ({ ok: true })),
  deleteTransactions: vi.fn(async () => ({ ok: true, deleted: 2 })),
  updateNotes: vi.fn(async () => ({ ok: true })),
}));

import { deleteTransactions, updateNotes } from "@/app/(app)/transactions/actions";

afterEach(() => vi.clearAllMocks());

function row(over: Partial<TxnListItem> = {}): TxnListItem {
  return {
    id: "t1",
    bookedAt: "2026-05-10",
    amountMinor: -1500,
    currency: "PLN",
    merchant: "BIEDRONKA",
    rawDescription: "BIEDRONKA 123",
    title: null,
    counterparty: null,
    counterpartyAccount: null,
    notes: null,
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

describe("TransactionsTable row expansion", () => {
  it("expands a row to reveal counterparty, raw description, and notes", () => {
    render(
      <TransactionsTable
        rows={[row({ id: "t1", merchant: "BIEDRONKA", counterparty: "JULIA ZAKRZEWSKA", rawDescription: "Przelew JULIA" })]}
        {...PROPS}
      />,
    );
    expect(screen.queryByText(/JULIA ZAKRZEWSKA/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /expand details for BIEDRONKA/i }));
    expect(screen.getByText(/JULIA ZAKRZEWSKA/)).toBeInTheDocument();
    expect(screen.getByText(/Przelew JULIA/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^notes$/i)).toBeInTheDocument();
  });

  it("saves edited notes via the updateNotes action", async () => {
    render(<TransactionsTable rows={[row({ id: "t1", merchant: "BIEDRONKA" })]} {...PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /expand details for BIEDRONKA/i }));
    await userEvent.type(screen.getByLabelText(/^notes$/i), "rent for May");
    fireEvent.click(screen.getByRole("button", { name: /save notes/i }));
    await waitFor(() =>
      expect(updateNotes).toHaveBeenCalledWith({ transactionId: "t1", notes: "rent for May" }),
    );
  });
});
