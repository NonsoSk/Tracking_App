import io

from django.test import SimpleTestCase

from .cv_details import find_phone, heading_name, label_pairs, name_from_email, name_from_filename, split_name
from .cv_parser import extract_text, heuristic_extract, parse_cv

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
TEXT_BOX_VML = (f'<w:r {W} xmlns:v="urn:schemas-microsoft-com:vml"><w:pict><v:shape><v:textbox><w:txbxContent>'
                '<w:p><w:r><w:t>{name}</w:t></w:r></w:p><w:p><w:r><w:t>{line}</w:t></w:r></w:p>'
                '</w:txbxContent></v:textbox></v:shape></w:pict></w:r>')
# How Word saves a text box today: the modern shape, plus an old-style copy for older readers (read once).
TEXT_BOX_BOTH = (
    f'<w:r {W} xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
    'xmlns:v="urn:schemas-microsoft-com:vml"><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:wsp>'
    '<wps:txbx><w:txbxContent><w:p><w:r><w:t>{name}</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp>'
    '</w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t>{name}</w:t>'
    '</w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>')


def word_file(build) -> bytes:
    import docx

    document = docx.Document()
    build(document)
    out = io.BytesIO()
    document.save(out)
    return out.getvalue()


def add_xml(paragraph, xml):
    from docx.oxml import parse_xml

    paragraph._p.append(parse_xml(xml))


class WordReadingTests(SimpleTestCase):
    def test_a_name_in_a_text_box_is_read(self):
        def build(document):
            add_xml(document.add_paragraph(), TEXT_BOX_VML.format(name="ADAEZE NWANKWO",
                                                                  line="adaeze.n@example.com | 0803 123 4567"))
            document.add_paragraph("PROFESSIONAL SUMMARY")
            document.add_paragraph("Accountant with five years in manufacturing.")
        text = extract_text(word_file(build), "cv.docx").text
        self.assertIn("ADAEZE NWANKWO", text)
        data = heuristic_extract(text)
        self.assertEqual((data["first_name"], data["last_name"], data["phone"]), ("Adaeze", "Nwankwo", "08031234567"))

    def test_a_text_box_saved_twice_is_read_once(self):
        def build(document):
            add_xml(document.add_paragraph(), TEXT_BOX_BOTH.format(name="Tunde Bakare"))
        text = extract_text(word_file(build), "cv.docx").text
        self.assertEqual(text.count("Tunde Bakare"), 1)

    def test_a_personal_data_table_and_the_header(self):
        def build(document):
            document.sections[0].header.paragraphs[0].text = "CURRICULUM VITAE"
            document.add_paragraph("PERSONAL DATA")
            table = document.add_table(rows=6, cols=2)
            for row, (label, value) in zip(table.rows, [
                    ("Name", "Mrs. Ngozi Grace Eze"), ("Sex", "Female"), ("Date of Birth", "14/02/1996"),
                    ("State of Origin", "Anambra State"), ("L.G.A", "Nnewi North"), ("Phone No", "+234 (0) 805 222 3333")]):
                row.cells[0].text, row.cells[1].text = label, value
        text = extract_text(word_file(build), "cv.docx").text
        self.assertTrue(text.startswith("CURRICULUM VITAE"))
        data = heuristic_extract(text)
        self.assertEqual((data["first_name"], data["last_name"]), ("Ngozi Grace", "Eze"))
        self.assertEqual((data["gender"], str(data["date_of_birth"])), ("female", "1996-02-14"))
        self.assertEqual((data["state_of_origin"], data["lga"]), ("Anambra", "Nnewi North"))
        self.assertEqual(data["location"], "")  # where they are from is not where they live
        self.assertEqual(data["phone"], "+2348052223333")


class NameTests(SimpleTestCase):
    def name(self, text, filename=""):
        data = heuristic_extract(text, filename)
        return data["first_name"], data["last_name"]

    def test_surname_and_other_names_lines(self):
        self.assertEqual(self.name("CURRICULUM VITAE\nPERSONAL DATA\nSurname: OKONKWO\nOther Names: Emeka John\n"
                                   "Sex: Male"), ("Emeka John", "Okonkwo"))

    def test_surname_first_with_a_comma_after_a_job_title(self):
        self.assertEqual(self.name("ACCOUNTS OFFICER\nOKAFOR, Chinedu James\nchinedu@example.com"),
                         ("Chinedu James", "Okafor"))

    def test_surname_in_capitals_first(self):
        self.assertEqual(self.name("ADEBAYO Oluwaseun Michael\n12 Aba Road, Port Harcourt"),
                         ("Oluwaseun Michael", "Adebayo"))

    def test_titles_and_a_role_beside_the_name(self):
        self.assertEqual(self.name("Engr. (Mrs) Bisola Ade-Johnson | Process Engineer\nLagos"),
                         ("Bisola", "Ade-Johnson"))

    def test_labels_on_one_line(self):
        data = heuristic_extract("Name: Ibrahim Musa Sani     Sex: M     Date of Birth: 4/5/1995\n"
                                 "State of Origin/LGA: Kano/Nassarawa\nPhone: 0703 444 5555")
        self.assertEqual((data["first_name"], data["last_name"], data["gender"]), ("Ibrahim Musa", "Sani", "male"))
        self.assertEqual((str(data["date_of_birth"]), data["state_of_origin"], data["lga"]),
                         ("1995-05-04", "Kano", "Nassarawa"))

    def test_a_referee_is_never_taken_for_the_candidate(self):
        text = "Professional summary\nHardworking accountant.\nREFERENCES\nName: Dr. Bello Ahmed\nPhone: 0803 000 0000"
        data = heuristic_extract(text, "Grace Udo CV.pdf")
        self.assertEqual((data["first_name"], data["last_name"]), ("Grace", "Udo"))

    def test_from_the_file_name_then_the_email(self):
        data = heuristic_extract("PROFESSIONAL SUMMARY\nAccountant.\nEMAIL: kemi.adeyemi92@gmail.com",
                                 "CV_Updated (1).pdf")
        self.assertEqual((data["first_name"], data["last_name"]), ("Kemi", "Adeyemi"))
        self.assertEqual(data["notes"], ["Name taken from the email address: check it."])
        self.assertEqual(name_from_filename("Chinedu_Okafor_CV_2026.docx"), ("Chinedu", "Okafor"))
        self.assertEqual(name_from_filename("OKAFOR Chinedu - Resume.pdf"), ("Chinedu", "Okafor"))
        self.assertEqual(name_from_filename("My CV final.pdf"), ("", ""))
        self.assertEqual(name_from_filename("Accounts Officer CV.pdf"), ("", ""))
        self.assertEqual(name_from_email("info@company.com"), ("", ""))

    def test_a_scan_with_no_text_still_gets_the_name_from_the_file(self):
        parsed = parse_cv(b"%PDF-1.4 not really", "Amina Yusuf CV.pdf")
        self.assertEqual((parsed["first_name"], parsed["last_name"]), ("Amina", "Yusuf"))
        self.assertIn("Name taken from the file name: check it.", parsed["notes"])

    def test_a_list_of_skills_is_not_a_name(self):
        data = heuristic_extract("PROFILE\nGraduate of Human Resource Management.\nSKILLS\nRecruitment, onboarding, payroll",
                                 "Grace Udo - Resume.docx")
        self.assertEqual((data["first_name"], data["last_name"]), ("Grace", "Udo"))
        self.assertEqual(heading_name(["Recruitment, Onboarding, Payroll"]), ("", ""))
        self.assertEqual(heading_name(["excel and word"]), ("", ""))
        # A name below the first section heading is not a heading name.
        self.assertEqual(heading_name(["PROFESSIONAL SUMMARY", "Tunde Bakare"]), ("", ""))

    def test_what_is_not_a_name(self):
        for line in ("Port Harcourt", "Professional Summary", "J. K.", "Accounts Payable Officer", "08031234567",
                     "Curriculum Vitae", "Rivers State", "Available on request"):
            self.assertEqual(heading_name([line]), ("", ""), line)
        self.assertEqual(split_name("J. K."), ("", ""))


class PhoneTests(SimpleTestCase):
    def test_groupings(self):
        for text, number in [("Tel: 08031 234 567", "08031234567"), ("+234 (0) 803 123 4567", "+2348031234567"),
                             ("Phone: 0803-123-4567 / 0805 222 3333", "08031234567"),
                             ("234 806 111 2222", "+2348061112222")]:
            self.assertEqual(find_phone(text, []), number, text)

    def test_years_are_never_a_phone_number(self):
        self.assertEqual(find_phone("Accountant, Dangote 2015 - 2019\nGraduated 2014", []), "")
        self.assertEqual(heuristic_extract("John Doe\nAccountant 2015 - 2019 2019 - 2023")["phone"], "")

    def test_a_labelled_landline(self):
        pairs = label_pairs(["Telephone: 084 123456 7"])
        self.assertEqual(find_phone("", [v for k, v in pairs if k == "phone"]), "0841234567")
