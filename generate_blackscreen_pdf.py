#!/usr/bin/env python3
"""Generate a black-screen DOS-style SWIFT PDF matching 5.99B.pdf theme."""
import xml.etree.ElementTree as ET
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.colors import black, white, green

INPUT_XML = "blackScreen.xml"
OUTPUT_PDF = "500M.pdf"

# Match the original PDF page size (1654 x 2339 points)
PAGE_WIDTH = 1654
PAGE_HEIGHT = 2339

FONT_NAME = "Courier-Bold"
FONT_SIZE = 13
LINE_HEIGHT = 17
MARGIN_X = 24
MARGIN_Y = 24


def get_text(node, tag, default=""):
    el = node.find(tag)
    return (el.text or default).strip() if el is not None else default


def draw_text(c, x, y, text, color=white, font_name=FONT_NAME, font_size=FONT_SIZE):
    c.setFillColor(color)
    c.setFont(font_name, font_size)
    c.drawString(x, y, text)


def field_line(c, x, y, label, value, prefix="> "):
    if value:
        text = f"{prefix}{label} : {value}"
    else:
        text = f"{prefix}{label}"
    draw_text(c, x, y, text)
    return y - LINE_HEIGHT


def plain_line(c, x, y, label, value):
    if label:
        text = f"{label}: {value}"
    else:
        text = value
    draw_text(c, x, y, text)
    return y - LINE_HEIGHT


def progress_line(c, x, y, percent, label):
    # Align all progress lines so SVR labels end at same x position
    prefix = f"Upload in Process: {percent}%"
    # Target right edge for label
    target_x = 600  # approximate point where labels should align
    prefix_w = c.stringWidth(prefix, FONT_NAME, FONT_SIZE)
    label_w = c.stringWidth(label, FONT_NAME, FONT_SIZE)
    gap_w = target_x - x - prefix_w - label_w
    char_w = c.stringWidth(".", FONT_NAME, FONT_SIZE)
    dots = "." * max(int(gap_w / char_w), 1)
    text = f"{prefix}{dots}{label}"
    draw_text(c, x, y, text)
    return y - LINE_HEIGHT


def license_line(c, x, y, lic_id, text):
    # LANG4XGEPAY01 (License)active port-basic slot <slot-id> port <port-list> activated
    # XML text is like "LANG4XGEPAY01 - active port-basic slot activated"
    if " - " in text:
        code, rest = text.split(" - ", 1)
    else:
        code = lic_id
        rest = text
    line = f"{code} (License){rest} <slot-id> port <port-list> activated"
    draw_text(c, x, y, line)
    return y - LINE_HEIGHT


def wrap_text(c, text, max_chars):
    lines = []
    while text:
        chunk = text[:max_chars]
        text = text[max_chars:]
        lines.append(chunk)
    return lines


def main():
    tree = ET.parse(INPUT_XML)
    root = tree.getroot()

    c = canvas.Canvas(OUTPUT_PDF, pagesize=(PAGE_WIDTH, PAGE_HEIGHT))
    c.setTitle("SWIFT Message - TrueFin USD")
    c.setAuthor("TrueFin USD System")

    # Black background
    c.setFillColor(black)
    c.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)

    x = MARGIN_X
    y = PAGE_HEIGHT - MARGIN_Y - LINE_HEIGHT

    meta = root.find("Meta")
    network = get_text(meta, "Network") if meta is not None else "SWIFT NET"
    printed_date = "02/07/2026"
    printed_time = get_text(meta, "PrintedTime")
    printer_label = get_text(meta, "PrinterLabel")
    doc_ref = get_text(meta, "DocumentRef")

    # Top border line: "--------------------------------------------------SWIFT NET--------------------------------------------------"
    # Center the network text in dashes spanning full width minus margins
    usable_width = PAGE_WIDTH - 2 * MARGIN_X
    # Approx chars: usable_width / char_width
    char_w = c.stringWidth("-", FONT_NAME, FONT_SIZE)
    total_chars = int(usable_width / char_w)
    net_text = network
    pad = total_chars - len(net_text)
    left_dash = pad // 2
    right_dash = pad - left_dash
    top_line = "-" * left_dash + net_text + "-" * right_dash
    draw_text(c, x, y, top_line)
    y -= LINE_HEIGHT * 1.5

    # Top left date/time and right doc ref
    # Use footer date/time for top? Original uses 02/06/2025 - 10:01:23 PRINTER IN 2025-06
    # We'll use printed date/time and printer label
    header_left = f"{printed_date} - {printed_time} {printer_label}"
    draw_text(c, x, y, header_left)
    draw_text(c, PAGE_WIDTH - MARGIN_X - c.stringWidth(doc_ref, FONT_NAME, FONT_SIZE), y, doc_ref)
    y -= LINE_HEIGHT * 1.5

    header = root.find("MessageHeader")
    if header is not None:
        y = field_line(c, x, y, "FUNDS TYPE", get_text(header, "FundsType"))
        y = field_line(c, x, y, "UPLOAD FORMAT", get_text(header, "UploadFormat"))
        y = field_line(c, x, y, "FILE EXTENSION", get_text(header, "FileExtension"))
        y = field_line(c, x, y, "FILE FORMAT", get_text(header, "FileFormat"))
        y = field_line(c, x, y, "FILE FORMAT OPTION", get_text(header, "FileFormatOption"))
        y = field_line(c, x, y, "ENCODING", get_text(header, "Encoding"))
        y = field_line(c, x, y, "CURRENCY", get_text(header, "Currency"))
        amount = get_text(header, "Amount")
        y = field_line(c, x, y, "AMOUNT", f"EUR {amount}")
        y = field_line(c, x, y, "DATE", "02/07/2026")
        y = field_line(c, x, y, "TIME", get_text(header, "Time"))

    codes = root.find("TransactionCodes")
    if codes is not None:
        y = field_line(c, x, y, "REFERENCE NUMBER", get_text(codes, "ReferenceNumber"))
        y = field_line(c, x, y, "TRANSACTION CODE", get_text(codes, "TransactionCode"))
        y = field_line(c, x, y, "CLEARING CODE", get_text(codes, "ClearingCode"))
        y = field_line(c, x, y, "TRANSFER DATA ENCRYPTION CODE", get_text(codes, "TransferDataEncryptionCode"))
        y = field_line(c, x, y, "UPLOAD CODE", get_text(codes, "UploadCode"))
        y = field_line(c, x, y, "PERMIT CODE", get_text(codes, "PermitCode"))
        y = field_line(c, x, y, "FINAL RELEASE CODE", get_text(codes, "FinalReleaseCode"))
        y = field_line(c, x, y, "DOWNLOADING CODE", get_text(codes, "DownloadingCode"))
        y = field_line(c, x, y, "ACCESS CODE", get_text(codes, "AccessCode").lower())
        y = field_line(c, x, y, "INTERBANKING BLOCKING CODE", get_text(codes, "InterbankingBlockingCode"))

    server = root.find("ServerInfo")
    if server is not None:
        y = field_line(c, x, y, "IDENTITY CODE", get_text(server, "IdentityCode"))
        y = field_line(c, x, y, "SERVER GLOBAL ID (ORIGIN)", get_text(server, "ServerGlobalIDOrigin"))
        y = field_line(c, x, y, "SERVER GLOBAL IP", get_text(server, "ServerGlobalIP"))
        y = field_line(c, x, y, "CLIENT NUMBER", get_text(server, "ClientNumber"))
        y = field_line(c, x, y, "PERMIT ARRIVAL MONEY NUMBER", get_text(server, "PermitArrivalMoneyNumber"))
        y = field_line(c, x, y, "WTS(WINDOW TERMINAL SERVER)", get_text(server, "WindowsTerminalServer"))
        y = field_line(c, x, y, "LOGIN DOMAIN", get_text(server, "LoginDomain"))
        y = field_line(c, x, y, "LOGON SERVER", get_text(server, "LogonServer"))

    farm = root.find("FarmAndUser")
    if farm is not None:
        y = field_line(c, x, y, "FARM NAME", get_text(farm, "FarmName"))
        y = field_line(c, x, y, "USER NAME", get_text(farm, "UserName"))
        y = field_line(c, x, y, "USER ID", get_text(farm, "UserID"))
        y = field_line(c, x, y, "CLEARING HOUSE NUMBER", get_text(farm, "ClearingHouseNumber"))

    ids = root.find("TransactionIdentifiers")
    if ids is not None:
        y = field_line(c, x, y, "TRANSACTION ID", get_text(ids, "TransactionID"))
        y = field_line(c, x, y, "FINAL BLOCKING CODE", get_text(ids, "FinalBlockingCode"))
        y = field_line(c, x, y, "TRANSFER CODE", get_text(ids, "TransferCode"))
        y = field_line(c, x, y, "UNIQUE TRANSACTION NUMBER", get_text(ids, "UniqueTransactionNumber"))
        y = field_line(c, x, y, "IMAD NUMBER", get_text(ids, "IMADNumber"))

    sender = root.find("SenderOrderingCustomer")
    if sender is not None:
        y = field_line(c, x, y, "SENDER/ORDERING CUSTOMER", "")
        y = field_line(c, x, y, "SENDER BANK NAME", get_text(sender, "BankName"))
        y = field_line(c, x, y, "SENDER BANK ADDRESS", get_text(sender, "BankAddress"))
        y = field_line(c, x, y, "SENDER BANK ACCOUNT NAME", get_text(sender, "AccountName"))
        y = field_line(c, x, y, "SENDER BANK ACCOUNT NUMBER", get_text(sender, "AccountNumber"))

    upload = root.find("UploadStatus")
    if upload is not None:
        y = plain_line(c, x, y, "IPSVR", get_text(upload, "IPSVRType"))
        status = get_text(upload, "Status")
        # Simplify status to match original style
        if "UPLOAD SUCCESSFUL" in status.upper():
            status = "FUNDS UPLOAD SUCCESSFUL"
        y = plain_line(c, x, y, "", status)
        y = plain_line(c, x, y, "AMOUNT", get_text(upload, "Amount"))
        y = plain_line(c, x, y, "CURRENCY", get_text(upload, "Currency"))
        y = plain_line(c, x, y, "IPIP VER", get_text(upload, "IPIPVersion"))

        progress = upload.find("Progress")
        if progress is not None:
            for step in progress.findall("Step"):
                label = step.text or ""
                pct = int((step.get("percent") or "0"))
                y = progress_line(c, x, y, pct, label)

        access = get_text(upload, "AccessGranted").lower()
        if access == "true":
            y = plain_line(c, x, y, "ACCESS GRANTED", "......")

    licenses = root.find("LicenseActivations")
    if licenses is not None:
        for lic in licenses.findall("License"):
            lid = lic.get("id", "")
            text = (lic.text or "").strip()
            y = license_line(c, x, y, lid, text)

    hw = root.find("HardwareVersions")
    if hw is not None:
        y = plain_line(c, x, y, "PCB Version", get_text(hw, "PCBVersion"))
        y = plain_line(c, x, y, "EPLD Version", get_text(hw, "EPLDVersion"))
        y = plain_line(c, x, y, "FPGA1 Version", get_text(hw, "FPGAVersion"))
        y = plain_line(c, x, y, "INFO", get_text(hw, "INFOVersion"))

    cert = root.find("CertificateChain")
    if cert is not None:
        y = plain_line(c, x, y, "", "CERTIFICATE CHAIN")
        y = plain_line(c, x, y, "", get_text(cert, "BeginCertificate"))
        cert_data = get_text(cert, "CertificateData").replace(" ", "").replace("\n", "")
        # Wrap certificate data to fit page
        char_w = c.stringWidth("M", FONT_NAME, FONT_SIZE)
        max_chars = int((PAGE_WIDTH - 2 * MARGIN_X) / char_w)
        for line in wrap_text(c, cert_data, max_chars):
            draw_text(c, x, y, line)
            y -= LINE_HEIGHT
        # Dashed line border for END CERTIFICATE like original
        end_text = "END CERTIFICATE"
        pad = total_chars - len(end_text)
        left_dash = pad // 2
        right_dash = pad - left_dash
        end_line = "-" * left_dash + end_text + "-" * right_dash
        draw_text(c, x, y, end_line)
        y -= LINE_HEIGHT

    completion = root.find("Completion")
    if completion is not None:
        y -= LINE_HEIGHT
        y = plain_line(c, x, y, "", get_text(completion, "AccessStatus"))
        y = plain_line(c, x, y, "", f"COMPLETED {get_text(completion, 'ProgressCompleted')}")
        y = plain_line(c, x, y, "", get_text(completion, "FinalAccess"))

    footer = root.find("Footer")
    if footer is not None:
        y -= LINE_HEIGHT
        end_msg = get_text(footer, "EndOfMessage")
        usable = int((PAGE_WIDTH - 2 * MARGIN_X) / char_w)
        msg_len = len(end_msg)
        pad = usable - msg_len
        left = pad // 2
        right = pad - left
        dotted = "." * left + end_msg + "." * right
        draw_text(c, x, y, dotted)
        y -= LINE_HEIGHT
        y = plain_line(c, x, y, "DATE", "02/07/2026")
        y = plain_line(c, x, y, "TIME", get_text(footer, "Time"))

    c.save()
    print(f"Created {OUTPUT_PDF}")


if __name__ == "__main__":
    main()
