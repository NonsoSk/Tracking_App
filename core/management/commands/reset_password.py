"""Set a new password for a portal sign-in, or create the first HR Admin. For reset-password.bat."""

import getpass
import sys

from django.contrib.auth.password_validation import ValidationError, validate_password
from django.core.management.base import BaseCommand

from accounts.models import User


class Command(BaseCommand):
    help = "Show the portal's sign-in accounts and set a new password for one (or create an HR Admin if there is none)."

    def add_arguments(self, parser):
        parser.add_argument("username", nargs="?", help="The account to reset; asked for when left out.")

    def handle(self, *args, **options):
        accounts = User.objects.filter(is_active=True).order_by("username")
        if not accounts.exists():
            self.stdout.write("There is no sign-in account yet. Let's create your HR Admin account.")
            from core.management.commands.import_workbooks import Command as ImportCommand

            ImportCommand(stdout=self.stdout, stderr=self.stderr).create_admin()
            return
        self.stdout.write("Sign-in accounts on this portal:")
        for user in accounts:
            role = "Superuser" if user.is_superuser and user.role != User.Role.HR_ADMIN else user.get_role_display()
            name = f" ({user.get_full_name()})" if user.get_full_name() else ""
            self.stdout.write(f"  {user.username}{name} - {role}")
        username = options["username"]
        while not username:
            username = input("\nUsername to set a new password for: ").strip()
        user = accounts.filter(username__iexact=username).first()
        if not user:
            self.stderr.write(f"There is no account called {username}.")
            sys.exit(1)
        while True:
            first = getpass.getpass("New password (typing is hidden): ")
            try:
                validate_password(first, user)
            except ValidationError as exc:
                self.stdout.write(" ".join(exc.messages))
                continue
            if getpass.getpass("New password again: ") != first:
                self.stdout.write("The passwords did not match. Try again.")
                continue
            break
        user.set_password(first)
        user.save(update_fields=["password"])
        self.stdout.write(self.style.SUCCESS(f"Done. Sign in as {user.username} with the new password."))
