import io
from unittest import mock

from django.core.management import call_command
from django.test import TestCase

from accounts.models import User


class ResetPasswordTests(TestCase):
    def test_lists_accounts_and_sets_a_new_password(self):
        User.objects.create_user("owner", password="old-password-1", role=User.Role.HR_ADMIN, first_name="Ada")
        out = io.StringIO()
        with mock.patch("getpass.getpass", side_effect=["short", "New-Pass-2026!", "New-Pass-2026!"]):
            call_command("reset_password", "owner", stdout=out)
        text = out.getvalue()
        self.assertIn("owner (Ada) - HR Admin", text)
        self.assertIn("too short", text)
        self.assertTrue(User.objects.get(username="owner").check_password("New-Pass-2026!"))

    def test_creates_the_hr_admin_when_there_is_no_account(self):
        answers = iter(["owner", "Ada", "Obi", "ada@example.com"])
        with mock.patch("builtins.input", lambda *a: next(answers)), \
                mock.patch("getpass.getpass", side_effect=["New-Pass-2026!", "New-Pass-2026!"]):
            call_command("reset_password", stdout=io.StringIO())
        user = User.objects.get(username="owner")
        self.assertEqual(user.role, User.Role.HR_ADMIN)
        self.assertTrue(user.check_password("New-Pass-2026!"))
