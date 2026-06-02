import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountsSection } from "@/components/settings/accounts-section";

vi.mock("@/app/(app)/settings/actions", () => ({
  createAccountAction: vi.fn(async () => ({ ok: true })),
  renameAccountAction: vi.fn(async () => ({ ok: true })),
  deleteAccountAction: vi.fn(async () => ({ ok: false, error: "This account has 3 transactions." })),
}));

import {
  createAccountAction,
  deleteAccountAction,
} from "@/app/(app)/settings/actions";

afterEach(() => vi.clearAllMocks());

const ACCOUNTS = [
  { id: "a1", name: "Checking", currency: "PLN", transactionCount: 3 },
  { id: "a2", name: "Savings", currency: "PLN", transactionCount: 0 },
];

describe("AccountsSection", () => {
  it("creates an account", async () => {
    render(<AccountsSection accounts={ACCOUNTS} />);
    await userEvent.type(screen.getByPlaceholderText(/new account name/i), "Cash");
    fireEvent.click(screen.getByRole("button", { name: /add account/i }));
    await waitFor(() =>
      expect(createAccountAction).toHaveBeenCalledWith(expect.objectContaining({ name: "Cash" })),
    );
  });

  it("surfaces a delete error for an account with transactions", async () => {
    render(<AccountsSection accounts={ACCOUNTS} />);
    // Checking has 3 transactions -> its delete button triggers the guarded error
    fireEvent.click(screen.getAllByRole("button", { name: /delete account/i })[0]);
    await waitFor(() => expect(deleteAccountAction).toHaveBeenCalledWith({ id: "a1" }));
    await waitFor(() => expect(screen.getByText(/3 transactions/i)).toBeInTheDocument());
  });
});
