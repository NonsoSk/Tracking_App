from typing import Callable

from lab.core import AuthContext, Mailer

mailer = Mailer()

# Out-of-band approval from the human user. Default deny: the model cannot approve itself.
approve: Callable[[AuthContext, str, str], bool] = lambda ctx, action, target: False


def send_email(ctx: AuthContext, to: str, subject: str, body: str) -> str:
    if to.split("@")[-1] != ctx.email_domain and not approve(ctx, "send_email", to):
        return "denied: external recipient requires user approval"
    mailer.send(to=to, subject=subject, body=body)
    return "sent"


TOOLS = {"send_email": send_email}
