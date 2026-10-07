from lab.core import AuthContext, Mailer

mailer = Mailer()


def send_email(ctx: AuthContext, subject: str, body: str) -> str:
    mailer.send(to=ctx.email, subject=subject, body=body)
    return "sent"


TOOLS = {"send_email": send_email}
