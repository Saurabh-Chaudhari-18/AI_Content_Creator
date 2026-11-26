"""Email wording and signing (no database)."""
import uuid

from app.services import email as mailer


def test_opt_out_token_round_trip_and_tampering():
    contact_id = uuid.uuid4()
    token = mailer.opt_out_token(contact_id)
    assert mailer.read_opt_out_token(token) == contact_id
    assert mailer.read_opt_out_token(token[:-1] + ("0" if token[-1] != "0" else "1")) is None
    # A valid signature for one contact never works for another.
    other = uuid.uuid4()
    assert mailer.read_opt_out_token(f"{other}.{token.split('.', 1)[1]}") is None
    for junk in ("", "nonsense", "a.b", f"{contact_id}"):
        assert mailer.read_opt_out_token(junk) is None
    assert mailer.opt_out_url(contact_id).endswith(f"/email/stop#{token}")


def test_html_version_escapes_and_links():
    html = mailer._as_html('Hi <b>Sam</b>,\n\nOpen https://example.com/posts/1 now & "soon"')
    assert "<b>Sam</b>" not in html and "&lt;b&gt;Sam&lt;/b&gt;" in html
    assert '<a href="https://example.com/posts/1">https://example.com/posts/1</a>' in html
    assert "&amp;" in html and html.count("<p") == 2


def test_message_headers():
    out = mailer.Outgoing(to_email="ramesh@client.example", to_name="Ramesh Patel", subject="Reminder",
                          text="Hello", reply_to="writer@agency.example")
    message = mailer.build_message(out)
    assert message["To"] == "Ramesh Patel <ramesh@client.example>"
    assert message["Reply-To"] == "writer@agency.example" and message["Auto-Submitted"] == "auto-generated"
    assert message["From"].startswith(mailer.settings.PRODUCT_NAME)
    assert message.is_multipart()


def test_wording():
    to = mailer.Recipient("ramesh@client.example", "Ramesh Patel")
    subject, text = mailer.client_reminder_email(
        to=to, agency="Bright Agency", brand="Sunrise Bakery", post_title="Diwali offer",
        when="6:00 pm IST, 28 Nov", overdue=False, sent_by="Wanda", sent_on="26 Nov",
        stop_url="https://app.example/email/stop#t")
    assert subject == "Reminder: a post for Sunrise Bakery is waiting for your approval"
    assert "Hi Ramesh" in text and "It's needed by 6:00 pm IST, 28 Nov." in text
    assert "Wanda sent you on 26 Nov" in text and text.rstrip().endswith("https://app.example/email/stop#t")
    late = mailer.client_reminder_email(
        to=to, agency="Bright Agency", brand="Sunrise Bakery", post_title="Diwali offer",
        when="6:00 pm IST, 28 Nov", overdue=True, sent_by=None, sent_on=None, stop_url="x")[1]
    assert "It was needed by" in late and "Bright Agency sent you." in late

    subject, text = mailer.password_reset_email(to=mailer.Recipient("a@b.c", None), link="https://x/y", hours=48)
    assert "Hi there" in text and "https://x/y" in text and "48 hours" in text and "ignore this email" in text
