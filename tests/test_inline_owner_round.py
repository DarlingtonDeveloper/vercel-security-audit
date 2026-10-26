"""Offline contracts for the inline owner round (issue #40); no owner is contacted."""
from pathlib import Path
import unittest

SKILL = Path(__file__).resolve().parents[1] / "skills/vercel-security-audit"


def section(text, start, end):
    return text.split(start, 1)[1].split(end, 1)[0]


class InlineOwnerRoundTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.skill = (SKILL / "SKILL.md").read_text()
        cls.step4 = section(cls.skill, "### 4. Assess findings", "### 5. Draft the guided report")
        cls.round = section((SKILL / "references/browser-evidence.md").read_text(),
                            "### Inline owner round before the first report", "## Accidental exposure")

    def test_round_sits_in_step_four_before_drafting(self):
        self.assertIn("#### Inline owner round before the first report", self.step4)
        self.assertIn("before drafting the first report", self.step4)
        self.assertIn("browser-evidence.md#inline-owner-round-before-the-first-report", self.step4)

    def test_round_reconciles_with_single_collection_pass(self):
        for text in (self.step4, self.round):
            self.assertIn("not a second collection pass", text)
        self.assertIn("collection still finishes before the first report", self.step4)
        self.assertIn("Finish one planned collection pass", self.skill.split("### 5.", 1)[1])

    def test_round_is_batched_scoped_and_skippable(self):
        for clause in ("one batched round", "still needs_confirmation", "owner statement could resolve",
                       "Owner confirmation question groups", '"skip" or "don\'t know"', "Do not run follow-up rounds"):
            self.assertIn(clause, self.step4)
        for clause in ("one batched message", "grouped by domain",
                       "needs_confirmation checks whose missing fact an owner statement could resolve",
                       "safe per-check questions", "Owner confirmation question groups",
                       '"skip" or "don\'t know"', "Do not ask follow-up rounds"):
            self.assertIn(clause, self.round)

    def test_unavailable_not_reviewed_checks_are_included_but_unauthorised_are_not(self):
        for text in (self.step4, self.round):
            for clause in ("not_reviewed checks whose collection was unavailable",
                           "no acceptable pre-exposure selection mechanism",
                           "unauthorised (including declined or unauthorised optional checks)" if text is self.step4
                           else "unauthorised, including declined or unauthorised optional checks",
                           "out of scope", "never use the round to expand scope"):
                self.assertIn(clause.lower(), text.lower())
        self.assertIn("when a safe per-check question exists for that check in the list above", self.round)
        self.assertIn("no per-check questions for the optional checks", self.round)
        policy = section((SKILL / "references/evidence-assessment.md").read_text(),
                         "## Owner statements from the inline round", "\n## ")
        for clause in ("still only an owner statement", "keep the observed setting unknown",
                       "Keep the collection gap and its reason recorded", "leaves the check not_reviewed",
                       "unauthorised or out of scope are never asked"):
            self.assertIn(clause, policy)

    def test_answers_are_labelled_statements_without_broader_access(self):
        for clause in ("timestamped owner statement", "separately from observed evidence",
                       "never becomes observed configuration", "never authorises broader access"):
            self.assertIn(clause, self.step4)
        for clause in ("UTC statement time", "role alias", "never become observed configuration",
                       "never authorise broader access", "neither changes the status"):
            self.assertIn(clause, self.round)

    def test_secrets_are_never_requested_and_only_present_user_is_asked(self):
        self.assertIn("Never request secrets, credentials", self.step4)
        self.assertIn("never contact other Owners", self.step4)
        for clause in ("never secrets, credentials, recovery codes", "Ask only the person already in the conversation",
                       "Do not contact other Owners", "do not repeat, quote or record it",
                       "accidental exposure procedure"):
            self.assertIn(clause, self.round)

    def test_noninteractive_hosts_skip_and_keep_handoff_questionnaire(self):
        for text in (self.step4, self.round):
            self.assertIn("Noninteractive hosts", text)
            self.assertIn("skip", text)
        step6 = self.skill.split("### 6. Human review and handoff", 1)[1]
        for clause in ("Reuse answers from the step 4 inline owner round", "without re-asking",
                       "questionnaire carries every unresolved question", "do not contact Owners"):
            self.assertIn(clause, step6)

    def test_assessment_policy_keeps_statements_from_promoting_status(self):
        text = section((SKILL / "references/evidence-assessment.md").read_text(),
                       "## Owner statements from the inline round", "\n## ")
        for clause in ("never observed configuration", "the answer itself does not promote a check status",
                       "cannot establish list completeness, enforcement", "leaves the status unchanged",
                       "never authorises broader access"):
            self.assertIn(clause, text)

    def test_report_records_round_and_reuses_answers(self):
        template = (SKILL / "references/report-template.md").read_text()
        self.assertIn("inline owner round run with UTC time, or skipped with reason", template)
        self.assertIn("including inline owner round answers, without re-asking", template)
        model = (SKILL / "references/report-model.md").read_text()
        self.assertIn("inline owner round", model)
        self.assertIn("needs no new field or schema version", model)


if __name__ == "__main__":
    unittest.main()
