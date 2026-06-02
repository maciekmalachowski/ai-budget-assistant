import { render, screen } from "@testing-library/react";
import { Markdown } from "@/components/ui/markdown";

describe("Markdown", () => {
  it("renders bold and bullet lists", () => {
    render(<Markdown>{"You spent **a lot**.\n\n- groceries\n- rent"}</Markdown>);
    expect(screen.getByText("a lot").tagName).toBe("STRONG");
    expect(screen.getByText("groceries").closest("li")).not.toBeNull();
  });
});
