from lab.core import AuthContext, Mailer

mailer = Mailer()


def send_email(ctx: AuthContext, to: str, subject: str, body: str) -> str:
    mailer.send(to=to, subject=subject, body=body)
    return "sent"


TOOLS = {"send_email": send_email}
