"""Pagination guidance: use the reader, never a shell loop; failures are incomplete (#36)."""
from pathlib import Path
import unittest

CAPABILITIES = (Path(__file__).resolve().parents[1] / "skills" / "vercel-security-audit"
                / "references" / "capabilities.md").read_text(encoding="utf-8")


class SafePaginationTests(unittest.TestCase):
    def test_reader_follows_pages_not_a_shell_loop(self):
        self.assertIn("### Safe pagination with the reader", CAPABILITIES)
        self.assertIn("Do not write your own shell loop", CAPABILITIES)
        self.assertIn('`echo "$json"`', CAPABILITIES)
        self.assertIn("unquoted `$FLAGS` does not word-split", CAPABILITIES)

    def test_only_an_explicit_null_cursor_ends_the_list(self):
        self.assertIn("`pagination.next` is explicitly null", CAPABILITIES)
        self.assertIn("It is never end-of-list", CAPABILITIES)
        self.assertIn("`partialResult`", CAPABILITIES)
        self.assertIn("never as a negative finding about the unread pages", CAPABILITIES)


if __name__ == "__main__":
    unittest.main()
