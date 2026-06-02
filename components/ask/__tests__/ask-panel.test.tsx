import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AskPanel } from "@/components/ask/ask-panel";

describe("AskPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens when '/' is pressed and submits a question", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ answer: "You spent **PLN 100**.", toolCalls: [] }),
    });
    render(<AskPanel />);
    // panel is closed initially
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.keyDown(window, { key: "/" });
    const textarea = await screen.findByPlaceholderText(/how much did i spend/i);
    await userEvent.type(textarea, "How much?");
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => expect(screen.getByText("PLN 100").tagName).toBe("STRONG"));
    expect(fetch).toHaveBeenCalledWith("/api/ask", expect.objectContaining({ method: "POST" }));
  });

  it("shows an error message when the request fails", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Sorry, I couldn't answer that." }),
    });
    render(<AskPanel />);
    fireEvent.click(screen.getByRole("button", { name: /ask ai/i }));
    const textarea = await screen.findByPlaceholderText(/how much did i spend/i);
    await userEvent.type(textarea, "bad");
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByText("Sorry, I couldn't answer that.")).toBeInTheDocument());
  });
});
